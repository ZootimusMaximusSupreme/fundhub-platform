// Finish-853 batch 02, repair cycle 1: "Email unsent invoices", the handler run end to end and then
// judged by the live check's own SQL.
//
// Row (desks-e.json, public/app/ops-admin.html): "email_invoice_backlog (server): emails every
// invoice the client was never told about, bounded to 200".
//
// What a fresh checker found: the live SQL could not tell a button that emails nobody, or only some,
// from a button nobody pressed; and the test that runs the handler
// (src/http/s2-message-routes-outbound.test.mjs) was only grepped. That test is now attached to the
// row. This file adds the missing join: the REAL handler (api/messages-outbound.mjs, action
// email_invoice_backlog) is run against the same stand-in queue, and what it saved (the invoices'
// emailed stamp and the message each one points at, with its final status) is run through the exact
// live SQL on an in-memory database whose tables carry the real column names.
//
// Practice test with fake data. No network, no database, no vendor.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../../../api/messages-outbound.mjs";
import { makeRes, req, runWithSharedDb, staffSession } from "../../../testing/handler-harness.mjs";
import { queueDb, QUEUE_ORG } from "./s2-queue-db.mjs";
import { refuseNetwork } from "./s2-route-kit.mjs";
import { reset } from "../../../messaging/providers/memory.mjs";
import { makeStandIn } from "./fin-b02-sql-kit.mjs";
import { FIN_B02_RESULT_CONTRACTS } from "./fin-b02-display-contracts.mjs";

const CONTRACT = FIN_B02_RESULT_CONTRACTS[3];
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const ID = (n) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

refuseNetwork({ before, after });
beforeEach(() => reset());

const CLIENTS = { [CLIENT]: { first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "+16025550100" } };
const TEMPLATES = {
  "INVOICE-SENT-EMAIL": {
    subject: "Your invoice from {{invoice.company}} — {{invoice.amount}}",
    body: "Hi {{contact.first_name}}, {{invoice.kind}} is {{invoice.amount}}, due {{invoice.due}}. Ref {{invoice.reference}}.",
  },
};

function invoice(n, over = {}) {
  return {
    id: ID(n), org_id: QUEUE_ORG, client_id: CLIENT, first_name: "Dana", last_name: "Whitfield",
    client_email: "dana@example.test", amount_due: "497.00", source: "setup_fee", due_at: "2026-10-15T00:00:00Z",
    status: "sent", emailed_at: null, created_at: `2026-10-0${n}T00:00:00Z`, ...over,
  };
}

/** Press the button, then lay what was saved into a stand-in database and run the live SQL on it. */
async function pressBacklog(invoices, body = { action: "email_invoice_backlog" }) {
  const byId = Object.fromEntries(invoices.map((i) => [i.id, i]));
  const fake = queueDb({ templates: TEMPLATES, clients: CLIENTS, invoices: byId, extra: [staffSession({ role: "owner", org_id: QUEUE_ORG })] });
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body }), res));

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const s = makeStandIn(["invoices", "messages"]);
  try {
    for (const inv of invoices) {
      const update = fake.state.invoiceUpdates.find((u) => u.params[0] === inv.id);
      // An invoice emailed before this press had its own email then; lay that one in too.
      const before = !update && inv.emailed_at ? `earlier-${inv.id}` : null;
      if (before) {
        s.insert("messages", {
          id: before, org_id: inv.org_id, client_id: inv.client_id, direction: "outbound", channel: "email",
          template_key: "INVOICE-SENT-EMAIL", provider_ref: `invoice:${inv.id}:sent`, to_address: "dana@example.test", status: "sent", created_at: now,
        });
      }
      s.insert("invoices", {
        id: inv.id, org_id: inv.org_id, client_id: inv.client_id, status: inv.status, amount_due: inv.amount_due,
        emailed_at: update || before ? now : null, email_message_id: update ? update.params[2] : before, is_demo: false,
      });
    }
    for (const m of fake.state.messages) {
      s.insert("messages", {
        id: m.id, org_id: m.org_id, client_id: m.client_id, direction: "outbound", channel: m.channel,
        template_key: m.template_key, provider_ref: m.provider_ref, to_address: m.to_address, status: m.status, created_at: now,
      });
    }
    return { res, fake, verdict: s.run(CONTRACT.sql, QUEUE_ORG) };
  } finally { s.close(); }
}

test("the backlog press emails every never-sent invoice, and the live check reads them as told", async () => {
  const { res, fake, verdict } = await pressBacklog([invoice(1), invoice(2), invoice(3)]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.considered, 3);
  assert.equal(res.body.result.emailed, 3);
  const mails = fake.state.messages.filter((m) => m.template_key === "INVOICE-SENT-EMAIL");
  assert.equal(mails.length, 3);
  assert.deepEqual(mails.map((m) => m.to_address), ["dana@example.test", "dana@example.test", "dana@example.test"]);
  assert.deepEqual(mails.map((m) => m.provider_ref).sort(), [1, 2, 3].map((n) => `invoice:${ID(n)}:sent`));
  // Each invoice is stamped and points at its own message, which has left (the stand-in provider took it).
  assert.equal(fake.state.invoiceUpdates.length, 3);
  assert.deepEqual(verdict, { sample_count: 3, bad_count: 0 });
});

test("an invoice already emailed, a voided one, and another company's are left out of the press", async () => {
  const { res, fake, verdict } = await pressBacklog([
    invoice(1),
    invoice(2, { emailed_at: "2026-10-02T00:00:00Z" }),
    invoice(3, { status: "void" }),
    invoice(4, { org_id: "0b000000-0000-4000-8000-000000000009" }),
  ]);
  assert.equal(res.body.result.considered, 1);
  assert.equal(res.body.result.emailed, 1);
  assert.deepEqual(fake.state.messages.map((m) => m.provider_ref), [`invoice:${ID(1)}:sent`]);
  // Judged by the live SQL: the new email and the one sent earlier are both told; the void invoice and
  // the other company's are not this company's results.
  assert.deepEqual(verdict, { sample_count: 2, bad_count: 0 });
});

test("a press that emails none of them leaves the backlog, which the live SQL alone cannot call wrong", async () => {
  // Nobody pressed: three invoices sent, never emailed, nothing written. Not wrong by itself; it is
  // the press test above (every one is emailed, counts equal) that holds "emails every invoice".
  const s = makeStandIn(["invoices", "messages"]);
  try {
    for (const n of [1, 2, 3]) s.insert("invoices", { id: ID(n), org_id: QUEUE_ORG, client_id: CLIENT, status: "sent", amount_due: 100, emailed_at: null, email_message_id: null });
    assert.deepEqual(s.run(CONTRACT.sql, QUEUE_ORG), { sample_count: 0, bad_count: 0 });
  } finally { s.close(); }
});

test("the press stamps each invoice with the message it queued: a stamp with no message link goes red", async () => {
  const { fake, verdict } = await pressBacklog([invoice(1), invoice(2)]);
  assert.deepEqual(verdict, { sample_count: 2, bad_count: 0 });
  // The same saved result with the link taken off one invoice, as a broken stamp would leave it.
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const s = makeStandIn(["invoices", "messages"]);
  try {
    fake.state.invoiceUpdates.forEach((u, i) => {
      s.insert("invoices", { id: u.params[0], org_id: QUEUE_ORG, client_id: CLIENT, status: "sent", amount_due: 497, emailed_at: now, email_message_id: i === 0 ? null : u.params[2], is_demo: false });
    });
    for (const m of fake.state.messages) {
      s.insert("messages", { id: m.id, org_id: m.org_id, client_id: m.client_id, direction: "outbound", channel: m.channel, template_key: m.template_key, provider_ref: m.provider_ref, to_address: m.to_address, status: m.status, created_at: now });
    }
    assert.deepEqual(s.run(CONTRACT.sql, QUEUE_ORG), { sample_count: 2, bad_count: 1 });
  } finally { s.close(); }
});
