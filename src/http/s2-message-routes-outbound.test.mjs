// POST /api/messages-outbound, run through the REAL handler with a stand-in
// queue and the in-memory provider. Three catalog rows are judged here:
//
//   action=dispatch        send every message that is due, subject to the send
//                          switch, the daily cap and the compliance gate
//   action=settings        the company switch for every customer text and email
//   action=email_invoice   email one invoice, or up to 200 never-sent invoices
//   (and _backlog)
//
// Email only: a text is deferred in the night window, which would make the
// outcome depend on the clock. No network, no database, no vendor.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/messages-outbound.mjs";
import {
  makeRes, req, runWithSharedDb, staffSession, STAFF_ID, OTHER_ORG_ID,
} from "../testing/handler-harness.mjs";
import { queueDb, QUEUE_ORG } from "../pulse/catalog/proofs/s2-queue-db.mjs";
import { refuseNetwork, splitRoles, STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";
import { recorded, reset } from "../messaging/providers/memory.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OPTED_OUT_CLIENT = "c2000000-0000-4000-8000-000000000002";
const INVOICE = "a1000000-0000-4000-8000-000000000001";
const INVOICE_2 = "a1000000-0000-4000-8000-000000000002";

refuseNetwork({ before, after });
beforeEach(() => reset());

const CLIENTS = {
  [CLIENT]: { first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "+16025550100" },
  [OPTED_OUT_CLIENT]: { first_name: "Omar", last_name: "Ellis", email: "omar@example.test", phone: "+16025550101" },
};
const TEMPLATES = {
  "INVOICE-SENT-EMAIL": {
    subject: "Your invoice from {{invoice.company}} — {{invoice.amount}}",
    body: "Hi {{contact.first_name}}, {{invoice.kind}} is {{invoice.amount}}, due {{invoice.due}}. Ref {{invoice.reference}}.",
  },
};

function invoiceRow(id, over = {}) {
  return {
    id, org_id: QUEUE_ORG, client_id: CLIENT, first_name: "Dana", last_name: "Whitfield",
    client_email: "dana@example.test", amount_due: "497.00", source: "setup_fee",
    due_at: "2026-10-15T00:00:00Z", status: "sent", emailed_at: null, created_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

function seedQueued(fake, rows) {
  for (const row of rows) {
    fake.state.messages.push({
      id: row.id, org_id: row.org_id || QUEUE_ORG, client_id: row.client_id, channel: "email", template_key: "MANUAL",
      rendered_body: row.body, provider_ref: `proof:${row.id}`, to_address: null, subject: "Hello", status: "queued", attempts: 0,
    });
  }
}

async function run(body, { role = "owner", org_id = QUEUE_ORG, method = "POST", db = {} } = {}) {
  const fake = queueDb({ templates: TEMPLATES, clients: CLIENTS, ...db, extra: [staffSession({ role, org_id })] });
  if (db.seed) seedQueued(fake, db.seed);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req(method, { body }), res));
  return { res, fake };
}

describe("POST /api/messages-outbound action=dispatch", () => {
  test("sends what is due to each client's own address and reports the exact count", async () => {
    const { res, fake } = await run({ action: "dispatch" }, {
      db: { seed: [{ id: "m1", client_id: CLIENT, body: "Your file is ready." }, { id: "m2", client_id: CLIENT, body: "One more thing." }] },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.result.sent, 2);
    assert.equal(res.body.result.blocked, 0);
    assert.equal(res.body.message, "Sent 2 messages.");
    // An email leaves with its unsubscribe link added when a signing secret is set,
    // so judge that the approved words are in what was sent.
    const receipts = recorded();
    assert.deepEqual(receipts.map((r) => r.to), ["dana@example.test", "dana@example.test"]);
    assert.ok(receipts[0].body.includes("Your file is ready."));
    assert.ok(receipts[1].body.includes("One more thing."));
    assert.equal(fake.state.statusUpdates.filter((u) => u.status === "sent").length, 2);
  });

  test("a client who opted out is held by the compliance check, not sent", async () => {
    const { res, fake } = await run({ action: "dispatch" }, {
      db: {
        optedOut: [OPTED_OUT_CLIENT],
        seed: [{ id: "m1", client_id: CLIENT, body: "Hello Dana." }, { id: "m2", client_id: OPTED_OUT_CLIENT, body: "Hello Omar." }],
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.sent, 1);
    assert.equal(res.body.result.blocked, 1);
    assert.match(res.body.message, /Sent 1 message\. 1 was held by the compliance check\./);
    assert.deepEqual(recorded().map((r) => r.to), ["dana@example.test"]);
    assert.equal(fake.state.messages.find((m) => m.id === "m2").status, "blocked");
  });

  test("the send switch off means nothing is claimed and nothing goes out", async () => {
    const { res, fake } = await run({ action: "dispatch" }, {
      db: { settings: { outbound_enabled: false, daily_send_cap: 500 }, seed: [{ id: "m1", client_id: CLIENT, body: "Hi." }] },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.ran, false);
    assert.equal(res.body.result.reason, "paused");
    assert.match(res.body.message, /Sending is paused/);
    assert.equal(fake.state.claims, 0);
    assert.equal(recorded().length, 0);
  });

  test("a spent daily cap stops the drain and says how many went out", async () => {
    const { res, fake } = await run({ action: "dispatch" }, {
      db: { settings: { outbound_enabled: true, daily_send_cap: 5 }, sentToday: 5, seed: [{ id: "m1", client_id: CLIENT, body: "Hi." }] },
    });
    assert.equal(res.body.result.reason, "daily_cap_reached");
    assert.equal(res.body.result.cap, 5);
    assert.equal(res.body.result.sentToday, 5);
    assert.match(res.body.message, /Today's limit of 5 has been reached \(5 sent\)/);
    assert.equal(fake.state.claims, 0);
    assert.equal(recorded().length, 0);
  });

  test("a cap of 5 with 4 already sent lets exactly one more go, and the rest wait", async () => {
    const { res, fake } = await run({ action: "dispatch" }, {
      db: {
        settings: { outbound_enabled: true, daily_send_cap: 5 }, sentToday: 4,
        seed: [{ id: "m1", client_id: CLIENT, body: "First." }, { id: "m2", client_id: CLIENT, body: "Second." }],
      },
    });
    assert.equal(res.body.result.sent, 1);
    assert.equal(recorded().length, 1);
    assert.deepEqual(fake.state.messages.map((m) => m.status).sort(), ["queued", "sent"]);
    // The batch asked for was cut to the room left under the cap.
    assert.equal(fake.find(/UPDATE messages m\s+SET status = 'sending'/)[0].params[1], 1);
  });

  test("a limit in the request is honoured, and another company's queue is never touched", async () => {
    const { res, fake } = await run({ action: "dispatch", limit: 1 }, {
      db: {
        seed: [
          { id: "m1", client_id: CLIENT, body: "Ours one." },
          { id: "m2", client_id: CLIENT, body: "Ours two." },
          { id: "m3", client_id: CLIENT, body: "Theirs.", org_id: OTHER_ORG_ID },
        ],
      },
    });
    assert.equal(res.body.result.sent, 1);
    const status = Object.fromEntries(fake.state.messages.map((m) => [m.id, m.status]));
    assert.deepEqual(status, { m1: "sent", m2: "queued", m3: "queued" });
    const [claim] = fake.find(/UPDATE messages m\s+SET status = 'sending'/);
    assert.equal(claim.params[0], QUEUE_ORG);
    assert.equal(claim.params[1], 1);
    // The company and the batch size are in the statement itself, not only in the parameters.
    assert.match(claim.sql, /\(\$1::uuid IS NULL OR org_id = \$1\)/);
    assert.match(claim.sql, /status = 'queued'/);
    assert.match(claim.sql, /LIMIT \$2/);
  });

  test("only an owner or an admin may dispatch, change settings or email invoices; every other role is refused and nothing moves", async () => {
    const { admitted, refused } = splitRoles(["owner", "admin"]);
    assert.equal(refused.length, 6);
    const ACTIONS = [
      { action: "dispatch" },
      { action: "settings", outbound_enabled: false, daily_send_cap: 9, alert_email: "x@example.test" },
      { action: "email_invoice", invoice_id: INVOICE },
      { action: "email_invoice_backlog" },
    ];
    const db = () => ({ invoices: { [INVOICE]: invoiceRow(INVOICE) }, seed: [{ id: "m1", client_id: CLIENT, body: "Hi." }] });
    for (const role of admitted) {
      for (const body of ACTIONS) {
        reset();
        const { res } = await run(body, { role, db: db() });
        assert.equal(res.statusCode, 200, `${role} ${body.action}`);
      }
    }
    for (const role of refused) {
      for (const body of ACTIONS) {
        reset();
        const { res, fake } = await run(body, { role, db: db() });
        assert.equal(res.statusCode, 403, `${role} ${body.action}`);
        assert.deepEqual(res.body.required, ["owner", "admin"]);
        assert.equal(fake.state.claims, 0, `${role} ${body.action}`);
        assert.equal(fake.state.settingsWrites.length, 0, `${role} ${body.action}`);
        assert.equal(fake.state.invoiceUpdates.length, 0, `${role} ${body.action}`);
        assert.equal(fake.state.messages.filter((m) => m.template_key === "INVOICE-SENT-EMAIL").length, 0, `${role} ${body.action}`);
        assert.equal(recorded().length, 0, `${role} ${body.action}`);
      }
    }
  });

  test("a GET only reads the status, for every staff role, and sends nothing even when told to", async () => {
    for (const role of STAFF_ROLES) {
      const read = await run({ action: "dispatch" }, {
        role, method: "GET", db: { seed: [{ id: "m1", client_id: CLIENT, body: "Hi." }] },
      });
      assert.equal(read.res.statusCode, 200, role);
      assert.equal(read.res.body.action, "status", role);
      assert.equal(read.fake.state.claims, 0, role);
      assert.equal(recorded().length, 0, role);
    }
    const nobody = queueDb({ templates: TEMPLATES, clients: CLIENTS });
    const res = makeRes();
    await runWithSharedDb(nobody, () => handler(req("GET", {}), res));
    assert.equal(res.statusCode, 401);
  });
});

describe("POST /api/messages-outbound action=settings", () => {
  test("an owner pauses sending, caps the day and names the alert address, all saved exactly", async () => {
    const { res, fake } = await run({ action: "settings", outbound_enabled: false, daily_send_cap: 250, alert_email: " alerts@example.test " });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.settings.outbound_enabled, false);
    assert.equal(res.body.settings.daily_send_cap, 250);
    assert.equal(res.body.settings.alert_email, "alerts@example.test");
    assert.match(res.body.message, /Sending is paused/);
    assert.deepEqual(fake.state.settingsWrites, [{
      org_id: QUEUE_ORG, outbound_enabled: false, daily_send_cap: 250, alert_email: "alerts@example.test", updated_by: STAFF_ID,
    }]);
  });

  test("turning it back on keeps the cap that was there, and a silly cap is clamped", async () => {
    const on = await run({ action: "settings", outbound_enabled: true }, {
      db: { settings: { outbound_enabled: false, daily_send_cap: 120, alert_email: null } },
    });
    assert.equal(on.res.body.settings.outbound_enabled, true);
    assert.equal(on.res.body.settings.daily_send_cap, 120);
    assert.match(on.res.body.message, /Sending is on/);

    const clamped = await run({ action: "settings", daily_send_cap: 900000 });
    assert.equal(clamped.res.body.settings.daily_send_cap, 100000);
  });

  test("only the fields named change, a negative cap becomes no cap, and the company is the one on the login", async () => {
    const capOnly = await run({ action: "settings", daily_send_cap: 40 }, {
      db: { settings: { outbound_enabled: false, daily_send_cap: 120, alert_email: "keep@example.test" } },
    });
    assert.deepEqual(capOnly.fake.state.settingsWrites, [{
      org_id: QUEUE_ORG, outbound_enabled: false, daily_send_cap: 40, alert_email: "keep@example.test", updated_by: STAFF_ID,
    }]);
    const negative = await run({ action: "settings", daily_send_cap: -5 });
    assert.equal(negative.res.body.settings.daily_send_cap, 0);
    const theirs = await run({ action: "settings", outbound_enabled: false }, { org_id: OTHER_ORG_ID, db: { orgId: OTHER_ORG_ID } });
    assert.equal(theirs.fake.state.settingsWrites[0].org_id, OTHER_ORG_ID);
    assert.equal(theirs.fake.state.settingsWrites.length, 1);
  });
});

describe("POST /api/messages-outbound action=email_invoice and email_invoice_backlog", () => {
  test("one invoice is queued with its own amount and due date, stamped emailed, and delivered to the client", async () => {
    const { res, fake } = await run({ action: "email_invoice", invoice_id: INVOICE }, {
      db: { invoices: { [INVOICE]: invoiceRow(INVOICE) } },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.message, "Invoice emailed.");
    const queued = fake.state.messages.find((m) => m.template_key === "INVOICE-SENT-EMAIL");
    assert.ok(queued, "an invoice email was queued");
    assert.equal(queued.client_id, CLIENT);
    assert.equal(queued.to_address, "dana@example.test");
    assert.equal(queued.provider_ref, `invoice:${INVOICE}:sent`);
    assert.match(queued.rendered_body, /Setup fee is \$497\.00, due 2026-10-15/);
    assert.match(queued.subject, /Fundhub — \$497\.00/);
    assert.equal(fake.state.invoiceUpdates.length, 1);
    assert.equal(fake.state.invoiceUpdates[0].params[0], INVOICE);
    assert.equal(recorded().filter((r) => r.to === "dana@example.test").length, 1);
  });

  test("a voided invoice is 409, an unknown one is 404, and nothing is queued for either", async () => {
    const voided = await run({ action: "email_invoice", invoice_id: INVOICE }, {
      db: { invoices: { [INVOICE]: invoiceRow(INVOICE, { status: "void" }) } },
    });
    assert.equal(voided.res.statusCode, 409);
    assert.equal(voided.res.body.error, "voided");
    const missing = await run({ action: "email_invoice", invoice_id: INVOICE_2 }, {
      db: { invoices: { [INVOICE]: invoiceRow(INVOICE) } },
    });
    assert.equal(missing.res.statusCode, 404);
    assert.equal(missing.res.body.error, "not_found");
    assert.equal(voided.fake.state.messages.length + missing.fake.state.messages.length, 0);
    assert.equal(recorded().length, 0);
  });

  test("the backlog emails every never-sent invoice once and the bound is 200", async () => {
    const { res, fake } = await run({ action: "email_invoice_backlog", limit: 5000 }, {
      db: { invoices: { [INVOICE]: invoiceRow(INVOICE), [INVOICE_2]: invoiceRow(INVOICE_2) } },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.considered, 2);
    assert.equal(res.body.result.emailed, 2);
    assert.match(res.body.message, /Emailed 2 invoices that had never been sent\./);
    const [read] = fake.find(/FROM invoices i\s+JOIN clients c ON c\.id = i\.client_id\s+WHERE i\.org_id/);
    assert.equal(read.params[0], QUEUE_ORG);
    assert.equal(read.params[1], 200);
    assert.equal(fake.state.messages.filter((m) => m.template_key === "INVOICE-SENT-EMAIL").length, 2);
    // An invoice already emailed, a voided one and another company's are not in the backlog.
    const INVOICE_3 = "a1000000-0000-4000-8000-000000000003";
    const INVOICE_4 = "a1000000-0000-4000-8000-000000000004";
    reset();
    const mixed = await run({ action: "email_invoice_backlog" }, {
      db: { invoices: {
        [INVOICE]: invoiceRow(INVOICE),
        [INVOICE_2]: invoiceRow(INVOICE_2, { emailed_at: "2026-10-02T00:00:00Z" }),
        [INVOICE_3]: invoiceRow(INVOICE_3, { status: "void" }),
        [INVOICE_4]: invoiceRow(INVOICE_4, { org_id: OTHER_ORG_ID }),
      } },
    });
    assert.equal(mixed.res.body.result.considered, 1);
    assert.equal(mixed.res.body.result.emailed, 1);
    assert.deepEqual(mixed.fake.state.messages.map((m) => m.provider_ref), [`invoice:${INVOICE}:sent`]);
  });

  test("an invoice in another company is 404: it is not emailed and not stamped", async () => {
    const { res, fake } = await run({ action: "email_invoice", invoice_id: INVOICE }, {
      org_id: OTHER_ORG_ID, db: { orgId: OTHER_ORG_ID, invoices: { [INVOICE]: invoiceRow(INVOICE) } },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "not_found");
    assert.deepEqual(fake.find(/FROM invoices i\s+JOIN clients c ON c\.id = i\.client_id\s+JOIN orgs o/)[0].params, [INVOICE, OTHER_ORG_ID]);
    assert.equal(fake.state.messages.length, 0);
    assert.equal(fake.state.invoiceUpdates.length, 0);
    assert.equal(recorded().length, 0);
  });
});
