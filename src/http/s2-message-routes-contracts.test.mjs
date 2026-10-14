// POST /api/contracts action=remind (one contract) and action=run_reminders
// (the whole-company chase), through the REAL handler with a stand-in queue and
// the in-memory provider. Each test judges what the staff member is told and
// what the signer is actually mailed. No network, no database, no vendor.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/contracts.mjs";
import { accountSession, makeRes, req, runWithSharedDb, staffSession, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { queueDb, QUEUE_ORG } from "../pulse/catalog/proofs/s2-queue-db.mjs";
import { refuseNetwork, splitRoles, STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";
import { recorded, reset } from "../messaging/providers/memory.mjs";

const CONTRACT = "c3000000-0000-4000-8000-000000000001";
const SIGNER = "c4000000-0000-4000-8000-000000000001";
const SIGNER_2 = "c4000000-0000-4000-8000-000000000002";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const DAY = 86400000;

refuseNetwork({ before, after });
const savedSecret = process.env.CONTRACT_URL_SECRET;
before(() => { process.env.CONTRACT_URL_SECRET = "fake-contract-link-secret-long-enough-for-signing"; });
after(() => {
  if (savedSecret === undefined) delete process.env.CONTRACT_URL_SECRET; else process.env.CONTRACT_URL_SECRET = savedSecret;
});
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
const PAT = { id: SIGNER_2, signer_index: 1, name: "Pat Counter", email: "pat@example.test", role_label: "Counterparty", client_id: null };

/* The stand-in finds a contract by its id AND the company on the signed-in
   person, and lists the sweep's contracts by company, so a handler that asks for
   the wrong company is told no. */
async function run(body, {
  role = "owner", org_id = QUEUE_ORG, who = null, contract = contractRow(), signers = [signerRow()], chases = 0,
  lastChase = chases ? "2026-10-05T00:00:00Z" : null, templates = { "CONTRACT-REMIND-EMAIL": REMIND_TEMPLATE }, settings,
} = {}) {
  const fake = queueDb({
    templates,
    clients: { [CLIENT]: { first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "+16025550100" } },
    ...(settings ? { settings } : {}),
    extra: [
      ...(who || [staffSession({ role, org_id })]),
      [/FROM contract_signers\s+WHERE contract_id/, signers],
      [/FROM contracts c\s+LEFT JOIN staff s/, (_s, p) => (contract && p[0] === contract.org_id ? [contract] : [])],
      [/FROM contracts\s+WHERE id = \$1::uuid AND org_id = \$2::uuid/, (_s, p) => (
        contract && p[0] === contract.id && p[1] === contract.org_id ? [contract] : [])],
      [/count\(\*\)::int AS n, max\(created_at\) AS last/, [{ n: chases, last: lastChase }]],
      [/UPDATE contract_signers/, []],
      [/UPDATE contracts SET link_expires_at/, []],
    ],
  });
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body, headers: { host: "app.example.test" } }), res));
  return { res, fake };
}
const mailedTo = (fake) => fake.state.messages.map((m) => m.to_address);

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

  test("only people who have not signed are queued, and in a sequence only the one whose turn it is", async () => {
    const dana = signerRow();
    const pat = { ...signerRow(), ...PAT };
    const cases = [
      ["a sequence queues only the first who has not signed", [dana, pat], contractRow(), ["dana@example.test"], "Dana Whitfield"],
      ["the first signer already signed: only the second is queued", [signerRow({ status: "signed" }), pat], contractRow(), ["pat@example.test"], "Pat Counter"],
      ["a parallel contract queues everyone who has not signed", [dana, pat], contractRow({ signing_order: "parallel" }), ["dana@example.test", "pat@example.test"], "Dana Whitfield"],
      ["someone who declined is not queued", [signerRow({ status: "declined" }), pat], contractRow({ signing_order: "parallel" }), ["pat@example.test"], "Pat Counter"],
    ];
    for (const [why, signers, contract, expected, waiting] of cases) {
      reset();
      const { res, fake } = await run({ action: "remind", id: CONTRACT }, { signers, contract });
      assert.equal(res.statusCode, 200, why);
      assert.deepEqual(mailedTo(fake), expected, why);
      assert.equal(res.body.waiting_on.name, waiting, why);
      // The client on file gets exactly the one email (or none) at their own address.
      const toDana = recorded().filter((m) => m.to === "dana@example.test").length;
      assert.equal(toDana, expected.includes("dana@example.test") ? 1 : 0, why);
    }
  });

  test("when everyone has signed or declined, nobody is mailed and staff are told so", async () => {
    const { res, fake } = await run({ action: "remind", id: CONTRACT }, {
      signers: [signerRow({ status: "signed" }), { ...signerRow(), ...PAT, status: "declined" }],
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "nobody_waiting");
    assert.equal(fake.state.messages.length, 0);
    assert.equal(recorded().length, 0);
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

  test("the fourth reminder is the last: the next is refused", async () => {
    const fourth = await run({ action: "remind", id: CONTRACT }, { chases: 3 });
    assert.equal(fourth.res.statusCode, 200);
    assert.equal(fourth.res.body.reminder, 4);
    assert.equal(fourth.fake.state.messages[0].provider_ref, `contract:${CONTRACT}:${SIGNER}:chase4`);
    // The count is read for this company and this contract only.
    assert.deepEqual(fourth.fake.find(/count\(\*\)::int AS n/)[0].params, [QUEUE_ORG, `contract:${CONTRACT}:%:chase%`]);

    reset();
    for (const chases of [4, 7]) {
      const { res, fake } = await run({ action: "remind", id: CONTRACT }, { chases });
      assert.equal(res.statusCode, 409, String(chases));
      assert.equal(res.body.error, "chase_limit");
      assert.match(res.body.message, new RegExp(`already had ${chases} reminders`));
      assert.equal(fake.state.messages.length, 0);
      assert.equal(recorded().length, 0);
    }
  });

  test("every staff role may remind the one person holding up one contract; a client's own login may not", async () => {
    for (const role of STAFF_ROLES) {
      reset();
      const { res, fake } = await run({ action: "remind", id: CONTRACT }, { role });
      assert.equal(res.statusCode, 200, role);
      assert.equal(fake.state.messages.length, 1, role);
    }
    const portal = await run({ action: "remind", id: CONTRACT }, { who: accountSession({ kind: "client", clientId: CLIENT }) });
    assert.ok([401, 403].includes(portal.res.statusCode));
    assert.equal(portal.fake.state.messages.length, 0);
  });

  test("a contract in another company is 404 and nobody is mailed", async () => {
    const { res, fake } = await run({ action: "remind", id: CONTRACT }, { org_id: OTHER_ORG_ID });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "not_found");
    assert.deepEqual(fake.find(/FROM contracts\s+WHERE id/)[0].params, [CONTRACT, OTHER_ORG_ID]);
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
  const sweep = (options = {}, body = { action: "run_reminders", after_days: 3 }) => run(body, options);

  test("an owner chases every overdue unsigned contract and is told how many people were reminded", async () => {
    const { res, fake } = await sweep({ chases: 0 });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.considered, 1);
    assert.equal(res.body.result.reminded, 1);
    assert.match(res.body.message, /Reminded 1 person/);
    assert.equal(fake.state.messages.length, 1);
    assert.equal(fake.state.messages[0].provider_ref, `contract:${CONTRACT}:${SIGNER}:chase1`);
    assert.equal(recorded().length, 1);
    // Looked for in this company only, among sent or viewed contracts older than the days asked for.
    const [list] = fake.find(/FROM contracts c\s+LEFT JOIN staff s/);
    assert.deepEqual([list.params[0], list.params[2]], [QUEUE_ORG, "3"]);
    assert.match(list.sql, /c\.status IN \('sent', 'viewed'\)/);
  });

  test("a contract that has had every reminder, or one reminded in the last few days, is left alone", async () => {
    for (const [why, options] of [
      ["four reminders already", { chases: 4 }],
      ["reminded yesterday", { chases: 1, lastChase: new Date(Date.now() - DAY).toISOString() }],
    ]) {
      reset();
      const { res, fake } = await sweep(options);
      assert.equal(res.statusCode, 200, why);
      assert.equal(res.body.result.reminded, 0, why);
      assert.equal(res.body.result.considered, 0, why);
      assert.equal(fake.state.messages.length, 0, why);
      assert.equal(recorded().length, 0, why);
    }
    // A reminder last sent more than three days ago is due again.
    const due = await sweep({ chases: 1, lastChase: new Date(Date.now() - 4 * DAY).toISOString() });
    assert.equal(due.res.body.result.reminded, 1);
    assert.equal(due.fake.state.messages[0].provider_ref, `contract:${CONTRACT}:${SIGNER}:chase2`);
  });

  test("another company's contracts are never chased", async () => {
    const { res, fake } = await sweep({ org_id: OTHER_ORG_ID });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.considered, 0);
    assert.equal(fake.state.messages.length, 0);
    assert.equal(recorded().length, 0);
  });

  test("only an owner or an admin may run the company-wide chase; every other staff role is refused and nothing is mailed", async () => {
    const { admitted, refused } = splitRoles(["owner", "admin"]);
    for (const role of admitted) {
      reset();
      const { res, fake } = await sweep({ role });
      assert.equal(res.statusCode, 200, role);
      assert.equal(fake.state.messages.length, 1, role);
    }
    assert.equal(refused.length, 6);
    for (const role of refused) {
      const { res, fake } = await sweep({ role });
      assert.equal(res.statusCode, 403, role);
      assert.deepEqual(res.body.required, ["owner", "admin"], role);
      assert.equal(fake.state.messages.length, 0, role);
      assert.equal(fake.find(/FROM contracts c/).length, 0, role);
    }
  });
});
