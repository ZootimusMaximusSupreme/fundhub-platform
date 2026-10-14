// POST /api/contracts action=remind (one contract) and action=run_reminders
// (the whole-company chase), through the REAL handler with a stand-in queue and
// the in-memory provider. Each test judges what the staff member is told and
// what the signer is actually mailed. No network, no database, no vendor.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/contracts.mjs";
import { makeRes, req, runWithSharedDb, staffSession } from "../testing/handler-harness.mjs";
import { queueDb, QUEUE_ORG } from "../pulse/catalog/proofs/s2-queue-db.mjs";
import { recorded, reset } from "../messaging/providers/memory.mjs";

const CONTRACT = "c3000000-0000-4000-8000-000000000001";
const SIGNER = "c4000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async () => { throw new Error("network refused in this test"); };
  process.env.CONTRACT_URL_SECRET = "fake-contract-link-secret-long-enough-for-signing";
});
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => reset());

const REMIND_TEMPLATE = {
  subject: "Still waiting on your signature: {{contract.title}}",
  body: "Hi {{contact.first_name}}, reminder for {{contract.title}} from {{contract.sender}}. Open {{contract.link}}",
};

function contractRow(over = {}) {
  return {
    id: CONTRACT, org_id: QUEUE_ORG, client_id: CLIENT, staff_id: null, template_key: "SETUP", title: "Setup Agreement",
    status: "sent", signing_order: "sequential", sent_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    link_expires_at: null, sent_by: null, sent_by_name: "Olive", ...over,
  };
}
function signerRow(over = {}) {
  return {
    id: SIGNER, contract_id: CONTRACT, signer_index: 0, status: "sent", name: "Dana Whitfield",
    email: "dana@example.test", role_label: "Client", client_id: CLIENT, signed_at: null, ...over,
  };
}

async function run(body, { role = "owner", contract = contractRow(), signers = [signerRow()], chases = 0, templates = { "CONTRACT-REMIND-EMAIL": REMIND_TEMPLATE }, settings } = {}) {
  const fake = queueDb({
    templates,
    clients: { [CLIENT]: { first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "+16025550100" } },
    ...(settings ? { settings } : {}),
    extra: [
      staffSession({ role }),
      [/FROM contract_signers\s+WHERE contract_id/, signers],
      [/FROM contracts c\s+LEFT JOIN staff s/, [contract]],
      [/FROM contracts\s+WHERE id = \$1/, contract ? [contract] : []],
      [/SELECT id, org_id, client_id, staff_id, template_id/, (_s, p) => (contract && p[0] === contract.id ? [contract] : [])],
      [/count\(\*\)::int AS n, max\(created_at\) AS last/, [{ n: chases, last: chases ? "2026-10-05T00:00:00Z" : null }]],
      [/UPDATE contract_signers/, []],
      [/UPDATE contracts SET link_expires_at/, []],
    ],
  });
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body, headers: { host: "app.example.test" } }), res));
  return { res, fake };
}

describe("POST /api/contracts action=remind", () => {
  test("the one person holding it up is mailed reminder 1 with a fresh link, and staff are told who", async () => {
    const { res, fake } = await run({ action: "remind", id: CONTRACT });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.reminder, 1);
    assert.equal(res.body.max_reminders, 4);
    assert.equal(res.body.queued, 1);
    assert.equal(res.body.delivery.sent, 1);
    assert.deepEqual(res.body.waiting_on, { name: "Dana Whitfield", role: "Client", remaining: 1 });
    assert.match(res.body.message, /Reminder 1 of 4 sent to Dana Whitfield\./);

    const row = fake.state.messages[0];
    assert.equal(row.template_key, "CONTRACT-REMIND-EMAIL");
    assert.equal(row.provider_ref, `contract:${CONTRACT}:${SIGNER}:chase1`);
    assert.equal(row.to_address, "dana@example.test");
    const [mail] = recorded();
    assert.equal(mail.to, "dana@example.test");
    assert.match(mail.subject, /Still waiting on your signature: Setup Agreement/);
    assert.match(mail.body, /Hi Dana, reminder for Setup Agreement from Olive Owner\./);
    assert.match(mail.body, /https?:\/\/[^\s]+/);
  });

  test("a signed, void or draft contract is refused with 409 and nothing is mailed", async () => {
    for (const [status, error] of [["signed", "already_finished"], ["void", "already_finished"], ["draft", "not_sent"]]) {
      const { res, fake } = await run({ action: "remind", id: CONTRACT }, { contract: contractRow({ status }) });
      assert.equal(res.statusCode, 409, status);
      assert.equal(res.body.error, error, status);
      assert.equal(fake.state.messages.length, 0, status);
    }
    assert.equal(recorded().length, 0);
  });

  test("the fourth reminder is the last: a fifth is refused", async () => {
    const { res, fake } = await run({ action: "remind", id: CONTRACT }, { chases: 4 });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "chase_limit");
    assert.match(res.body.message, /already had 4 reminders/);
    assert.equal(fake.state.messages.length, 0);
    assert.equal(recorded().length, 0);
  });

  test("unapproved reminder wording sends nothing and says so in plain words", async () => {
    const { res, fake } = await run({ action: "remind", id: CONTRACT }, {
      templates: { "CONTRACT-REMIND-EMAIL": { ...REMIND_TEMPLATE, compliance_passed: false } },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.queued, 0);
    assert.match(res.body.message, /reminder wording has not been approved yet/);
    assert.equal(fake.state.messages.length, 0);
    assert.equal(recorded().length, 0);
  });

  test("a paused company leaves the reminder queued and unsent", async () => {
    const { res, fake } = await run({ action: "remind", id: CONTRACT }, {
      settings: { outbound_enabled: false, daily_send_cap: 0 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.queued, 1);
    assert.equal(res.body.delivery.paused, true);
    assert.match(res.body.message, /Sending is paused for this company/);
    assert.equal(fake.state.messages[0].status, "queued");
    assert.equal(recorded().length, 0);
  });
});

describe("POST /api/contracts action=run_reminders", () => {
  test("an owner chases every overdue unsigned contract and is told how many people were reminded", async () => {
    const { res, fake } = await run({ action: "run_reminders", after_days: 3 }, {
      contract: contractRow(), chases: 0,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.considered, 1);
    assert.equal(res.body.result.reminded, 1);
    assert.match(res.body.message, /Reminded 1 person/);
    assert.equal(fake.state.messages.length, 1);
    assert.equal(fake.state.messages[0].provider_ref, `contract:${CONTRACT}:${SIGNER}:chase1`);
    assert.equal(recorded().length, 1);
  });

  test("a closer cannot run the company-wide chase", async () => {
    const { res, fake } = await run({ action: "run_reminders" }, { role: "closer" });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body.required, ["owner", "admin"]);
    assert.equal(fake.state.messages.length, 0);
    assert.equal(recorded().length, 0);
  });
});
