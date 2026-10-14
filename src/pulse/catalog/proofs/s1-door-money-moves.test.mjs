// Slice 1 (money routes): a funded card move, a repair enrollment, and the
// per-ad "Turn on" switch. The real api/ handlers run on a stand-in database.
// Meta is replaced by a recorder; nothing leaves this process.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";

import campaignsWrite from "../../../../api/campaigns/write.mjs";
import pipelineCards from "../../../../api/pipeline-cards.mjs";
import repairEnroll from "../../../../api/repair/enroll.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { encryptToken } from "../../../adplatforms/tokens.mjs";
import {
  ORG_ID, OTHER_ORG_ID, STAFF_ID, accountSession, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";
import { clause, rolesLetIn, shelf } from "./s1-proof-kit.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const ROUND_ID = "f0000000-0000-4000-8000-000000000001";

async function run(handler, request, rules, deps) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res, deps));
  return { res, fake };
}

// ── pipeline-cards: a Funded move needs a real dollar amount ──────────────
function fundedRules({ approvals = [], excluded = [], sale = null } = {}) {
  return [
    staffSession({ role: "owner" }),
    [/SELECT id FROM clients WHERE id = \$1::uuid/, [{ id: CLIENT_ID }]],
    [/SELECT ps\.id AS stage_id, ps\.pipeline_id FROM pipeline_stages/, [{ stage_id: "5e000000-0000-4000-8000-0000000000f1", pipeline_id: "9e000000-0000-4000-8000-000000000001" }]],
    [/SELECT custom_fields FROM clients/, [{ custom_fields: {} }]],
    [/FROM funding_rounds\s+WHERE org_id = \$1 AND client_id = \$2/, [{ id: ROUND_ID, round_number: 1, status: "submitted", funded_amount: null, approved_amount: null }]],
    [/AND status = 'Approved'\s+AND approval_excluded_at IS NULL\s+AND \(approved_amount IS NULL/, []],
    [/AND status = 'Approved'\s+AND approval_excluded_at IS NULL\s+AND approved_amount IS NOT NULL/, approvals],
    [/approval_excluded_at IS NOT NULL/, excluded],
    [/FROM funding_round_sales frs/, sale ? [sale] : []],
    [/SELECT id FROM cards WHERE client_id = \$1 AND pipeline_id = \$2/, [{ id: "ca000000-0000-4000-8000-000000000001" }]],
    [/INSERT INTO events/, [{ id: "e0000000-0000-4000-8000-000000000001" }]],
  ];
}

const FUNDED_BODY = { client_id: CLIENT_ID, pipeline_key: "funding_card_stacking", stage_key: "funded", round_number: 1 };

test("pipeline-cards: a Funded move saves the dollar amount and fires round.funded with the billing facts", async () => {
  assert.equal(ROUTES["pipeline-cards"], pipelineCards);
  const rules = fundedRules({
    approvals: [{ id: "a1", approved_amount: "40000", bank: "Chase" }, { id: "a2", approved_amount: "20000", bank: "Amex" }],
    sale: { sale_id: "5a1e0000-0000-4000-8000-000000000001", agreed_success_fee_percent: "10" },
  });
  const { res, fake } = await run(pipelineCards, req("POST", { body: { ...FUNDED_BODY, funded_amount: 55000 } }), rules);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.funded_amount, 55000);
  assert.equal(res.body.round_event.event, "round.funded");
  assert.equal(res.body.round_event.round_number, 1);
  const [move] = fake.find(/UPDATE cards SET stage_id = \$2/);
  assert.deepEqual(move.params, ["ca000000-0000-4000-8000-000000000001", "5e000000-0000-4000-8000-0000000000f1"]);
  const events = fake.find(/INSERT INTO events/);
  const funded = events.find((c) => c.params[1] === "round.funded");
  assert.ok(funded, "the money chain starts only through this event");
  const payload = typeof funded.params[5] === "string" ? JSON.parse(funded.params[5]) : funded.params[5];
  assert.equal(payload.fundedAmount, 55000);
  assert.equal(payload.approvedAmount, 60000, "the fee basis is the confirmed approvals total");
  assert.equal(payload.feePercent, 10);
  assert.equal(payload.fundingRoundId, ROUND_ID);
});

test("pipeline-cards: a Funded move with no dollar amount is refused 400 and the card does not move", async () => {
  const allExcluded = fundedRules({ excluded: [{ id: "a1", approved_amount: null, bank: "Chase" }] });
  const { res, fake } = await run(pipelineCards, req("POST", { body: FUNDED_BODY }), allExcluded);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "funded_amount_required");
  assert.equal(fake.find(/UPDATE cards SET stage_id/).length, 0);
  assert.equal(fake.find(/INSERT INTO cards/).length, 0);
  assert.equal(fake.find(/INSERT INTO events/).length, 0, "no round.* event is fired for a refused move");
});

test("pipeline-cards: a Funded move with a bank yes that has no amount is refused 400 naming the bank", async () => {
  const rules = fundedRules();
  rules.splice(5, 0, [/approved_amount IS NULL OR approved_amount <= 0/, [{ id: "a1", lender_id: null, bank: "Chase" }]]);
  const { res, fake } = await run(pipelineCards, req("POST", { body: { ...FUNDED_BODY, funded_amount: 5000 } }), rules);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "approval_amounts_missing");
  assert.deepEqual(res.body.missing_approval_banks, ["Chase"]);
  assert.equal(fake.find(/UPDATE cards SET stage_id/).length, 0);
});

// ── repair/enroll ──────────────────────────────────────────────────────────
const PROGRAM_ID = "7e000000-0000-4000-8000-000000000001";

const FOREIGN_CLIENT = "c2000000-0000-4000-8000-000000000002";
// Two clients, one in each company: kept only while the SQL names both the id and the company.
const CLIENTS = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, shelf(
  [{ id: CLIENT_ID, org_id: ORG_ID }, { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID }],
  [
    clause(/WHERE id = \$1/, (row, [id]) => row.id === id),
    clause(/AND org_id = \$2/, (row, [, org]) => row.org_id === org),
  ],
)];

function enrollRules() {
  return [
    staffSession({ role: "closer" }),
    CLIENTS,
    [/INSERT INTO repair_programs/, (sql, p) => [{
      id: PROGRAM_ID, org_id: p[0], client_id: p[1], program: p[2], rounds_cap: p[3],
      price_total: String(p[4]), amount_paid: String(p[5]), status: "active",
    }]],
    [/INSERT INTO entitlements/, [{ id: "e1000000-0000-4000-8000-000000000001" }]],
    [/SELECT ps\.id AS stage_id, ps\.pipeline_id FROM pipeline_stages/, [{ stage_id: "5e000000-0000-4000-8000-0000000000a1", pipeline_id: "9e000000-0000-4000-8000-000000000002" }]],
    [/FROM message_templates/, [{ body: "Welcome", subject: "Welcome", compliance_passed: true }]],
    [/SELECT first_name, last_name, email, phone, custom_fields FROM clients/, [{ first_name: "Ana", last_name: "Lee", email: "ana@example.test", phone: null, custom_fields: {} }]],
    [/INSERT INTO conversations/, [{ id: "c0c00000-0000-4000-8000-000000000001" }]],
    [/INSERT INTO messages/, [{ id: "3e000000-0000-4000-8000-000000000001" }]],
    [/INSERT INTO events/, [{ id: "e0000000-0000-4000-8000-000000000002" }]],
  ];
}

test("repair/enroll records price and amount paid, grants the letter pack, fires repair.enrolled, moves the card and queues the welcome email", async () => {
  assert.equal(ROUTES["repair/enroll"], repairEnroll);
  const { res, fake } = await run(repairEnroll, req("POST", {
    body: { client_id: CLIENT_ID, program: "trial", price_total: 200, amount_paid: 150 },
  }), enrollRules());
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.program, {
    id: PROGRAM_ID, client_id: CLIENT_ID, program: "trial", rounds_cap: 2, price_total: 200, amount_paid: 150, status: "active",
  });
  const [program] = fake.find(/INSERT INTO repair_programs/);
  assert.deepEqual(program.params, [ORG_ID, CLIENT_ID, "trial", 2, 200, 150]);

  const [grant] = fake.find(/INSERT INTO entitlements/);
  assert.equal(grant.params[2], "metro2-letter-pack");
  assert.equal(grant.params[5], STAFF_ID);
  assert.equal(grant.params[6], "repair_enroll:trial");

  const enrolled = fake.find(/INSERT INTO events/).filter((c) => c.params[1] === "repair.enrolled");
  assert.ok(enrolled.length >= 1, "the events table records the enrollment");
  assert.equal(enrolled[0].params[3], `repair.enrolled:${PROGRAM_ID}`, "keyed on the program so a retry does not stack");

  const stage = fake.find(/SELECT ps\.id AS stage_id/)[0];
  assert.equal(stage.params[1], "intake", "the card lands on the intake column");
  assert.ok(fake.find(/INSERT INTO cards/).length >= 1, "the card is placed");

  const [email] = fake.find(/INSERT INTO messages/);
  assert.equal(email.params[3], "EMAIL-REPAIR-WELCOME");
  assert.equal(email.params[2], "email");
  assert.equal(email.params[0], ORG_ID);
  assert.equal(email.params[1], CLIENT_ID);
});

test("repair/enroll refuses a bad program, a bad price and another company's client, and lets only owner, admin, closer and inquiry specialist in; nothing is written", async () => {
  const refused = async (body, status, role = "closer") => {
    const base = enrollRules();
    base[0] = staffSession({ role });
    const { res, fake } = await run(repairEnroll, req("POST", { body }), base);
    assert.equal(res.statusCode, status, JSON.stringify(body));
    assert.equal(fake.find(/INSERT INTO repair_programs/).length, 0);
    return res;
  };
  const ok = { client_id: CLIENT_ID, program: "full", price_total: 1000, amount_paid: 0 };
  assert.equal((await refused({ ...ok, program: "gold" }, 400)).body.error, "invalid_program");
  assert.equal((await refused({ ...ok, price_total: -5 }, 400)).body.error, "invalid_price");
  assert.equal((await refused({ ...ok, client_id: FOREIGN_CLIENT }, 404)).body.error, "not_found");

  const letIn = await rolesLetIn(async (role) => {
    const rules = enrollRules();
    rules[0] = staffSession({ role });
    const { res, fake } = await run(repairEnroll, req("POST", { body: ok }), rules);
    if (res.statusCode === 403) assert.equal(fake.find(/INSERT INTO repair_programs/).length, 0, `${role} was refused but a program was written`);
    return res.statusCode;
  });
  assert.deepEqual(letIn, ["admin", "closer", "inquiry_specialist", "owner"]);
});

// ── campaigns/write resume_ad: turn ONE ad on, only the named staff ids ───
const AD_ID = "ad000000-0000-4000-8000-000000000001";
const FOREIGN_AD_ID = "ad000000-0000-4000-8000-0000000000ff";
const PARTNER_ID = "9a000000-0000-4000-8000-000000000001";
const META_AD = "120210000000000777";
const ENV_KEY = "AD_TOKEN_ENC_KEY";
const hadKey = Object.prototype.hasOwnProperty.call(process.env, ENV_KEY);
const realKey = process.env[ENV_KEY];
let encrypted;

before(() => {
  process.env[ENV_KEY] = crypto.randomBytes(32).toString("base64");
  encrypted = encryptToken("meta-test-token", { partnerId: PARTNER_ID });
});
after(() => {
  if (hadKey) process.env[ENV_KEY] = realKey; else delete process.env[ENV_KEY];
});

function adRules(over = {}) {
  return [
    staffSession({ role: "owner" }),
    // Our ad and another company's ad. Kept only while the SQL names the id and the company.
    [/FROM ads a\s+JOIN ad_platform_connections conn/, (sql, p) => shelf([
      {
        id: AD_ID, org_id: ORG_ID, partner_id: PARTNER_ID, external_id: META_AD, status: "PAUSED", name: "Hook 7",
        fundhub_ad_number: 7, connection_id: "c0000000-0000-4000-8000-0000000000c1", platform: "meta",
        conn_partner_id: PARTNER_ID, encrypted_access_token: encrypted, external_ad_account_id: "act_100200300", ...over,
      },
      {
        id: FOREIGN_AD_ID, org_id: OTHER_ORG_ID, partner_id: PARTNER_ID, external_id: "120210000000000888", status: "PAUSED",
        name: "Hook 8", fundhub_ad_number: 8, connection_id: "c0000000-0000-4000-8000-0000000000c2", platform: "meta",
        conn_partner_id: PARTNER_ID, encrypted_access_token: encrypted, external_ad_account_id: "act_100200300",
      },
    ], [
      clause(/WHERE a\.id = \$1/, (row, [id]) => row.id === id),
      clause(/AND a\.org_id = \$2/, (row, [, org]) => row.org_id === org),
    ])(sql, p)],
    [/INSERT INTO action_log/, [{ id: "a1000000-0000-4000-8000-000000000001" }]],
  ];
}

function metaRecorder(answer = { success: true }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetch };
}

const SWITCH_ENV = { MARKETING_AD_SWITCH_STAFF_IDS: STAFF_ID };

test("campaigns/write resume_ad turns exactly one ad ON at Meta, logs first, and only then marks our row ACTIVE", async () => {
  const meta = metaRecorder();
  const { res, fake } = await run(
    campaignsWrite,
    req("POST", { body: { action: "resume_ad", ad_id: AD_ID, request_id: "req-1" } }),
    adRules(),
    { env: SWITCH_ENV, fetch: meta.fetch },
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.ad, { id: AD_ID, status: "ACTIVE" });
  assert.equal(meta.calls.length, 1, "Meta is asked once");
  assert.ok(meta.calls[0].url.endsWith(`/${META_AD}`), "the Meta id comes off our ad row, never the request");
  assert.deepEqual(meta.calls[0].body, { status: "ACTIVE" });
  const logIdx = fake.calls.findIndex((c) => /INSERT INTO action_log/.test(c.sql));
  const rowIdx = fake.calls.findIndex((c) => /UPDATE ads SET status = 'ACTIVE'/.test(c.sql));
  assert.ok(logIdx >= 0 && rowIdx > logIdx, "logged before our ad row says ACTIVE");
  assert.deepEqual(fake.calls[rowIdx].params, [AD_ID]);
  const [logged] = fake.find(/INSERT INTO action_log/);
  assert.equal(logged.params[2], "human", "a person's press, not an agent's");
  assert.equal(logged.params[5], "ad");
  assert.equal(logged.params[6], AD_ID, "the log names our ad row, not the Meta id");
  assert.equal(JSON.parse(logged.params[10]).status, "PAUSED", "the log keeps what it was before");
  assert.equal(JSON.parse(logged.params[11]).status, "ACTIVE", "and what it became");
  assert.equal(fake.find(/UPDATE campaigns|UPDATE ad_sets/).length, 0, "a campaign or ad set is never touched");
});

test("campaigns/write resume_ad refuses a staff id that is not on the list, a Meta id, and a Meta no; our row never turns ACTIVE", async () => {
  const notListed = metaRecorder();
  const first = await run(campaignsWrite, req("POST", { body: { action: "resume_ad", ad_id: AD_ID } }), adRules(),
    { env: {}, fetch: notListed.fetch });
  assert.equal(first.res.statusCode, 403);
  assert.equal(first.res.body.message, "Only Chris can turn ads on.");
  assert.equal(notListed.calls.length, 0);

  // Lock 3 again, from the other side: the list names someone else, so this staff id is not on it.
  const elsewhere = metaRecorder();
  const fourth = await run(campaignsWrite, req("POST", { body: { action: "resume_ad", ad_id: AD_ID } }), adRules(),
    { env: { MARKETING_AD_SWITCH_STAFF_IDS: "5a000000-0000-4000-8000-0000000000ee" }, fetch: elsewhere.fetch });
  assert.equal(fourth.res.statusCode, 403);
  assert.equal(elsewhere.calls.length, 0);

  // Lock 2: a staff id that is on the list still needs an owner or admin role.
  const lettingIn = await rolesLetIn(async (role) => {
    const meta = metaRecorder();
    const rules = adRules();
    rules[0] = staffSession({ role });
    const { res } = await run(campaignsWrite, req("POST", { body: { action: "resume_ad", ad_id: AD_ID } }), rules,
      { env: SWITCH_ENV, fetch: meta.fetch });
    if (res.statusCode === 403) assert.equal(meta.calls.length, 0, `${role} was refused but Meta was called`);
    return res.statusCode;
  });
  assert.deepEqual(lettingIn, ["admin", "owner"]);

  // Lock 1: a client login is not a staff login, whatever list it is on.
  const clientMeta = metaRecorder();
  const asClient = await run(campaignsWrite, req("POST", { body: { action: "resume_ad", ad_id: AD_ID } }),
    [...accountSession({ kind: "client", clientId: CLIENT_ID }), ...adRules().slice(1)], { env: SWITCH_ENV, fetch: clientMeta.fetch });
  assert.ok([401, 403].includes(asClient.res.statusCode), `a client login got ${asClient.res.statusCode}`);
  assert.equal(clientMeta.calls.length, 0);

  // Another company's ad is not ours: 404, and Meta is not called.
  const foreign = metaRecorder();
  const fifth = await run(campaignsWrite, req("POST", { body: { action: "resume_ad", ad_id: FOREIGN_AD_ID } }), adRules(),
    { env: SWITCH_ENV, fetch: foreign.fetch });
  assert.equal(fifth.res.statusCode, 404);
  assert.equal(foreign.calls.length, 0);

  const metaId = metaRecorder();
  const second = await run(campaignsWrite, req("POST", { body: { action: "resume_ad", ad_id: META_AD } }), adRules(),
    { env: SWITCH_ENV, fetch: metaId.fetch });
  assert.equal(second.res.statusCode, 404);
  assert.equal(metaId.calls.length, 0, "a Meta id is never passed through");

  const no = metaRecorder({ error: { message: "nope" } });
  const third = await run(campaignsWrite, req("POST", { body: { action: "resume_ad", ad_id: AD_ID } }), adRules(),
    { env: SWITCH_ENV, fetch: no.fetch });
  assert.equal(third.res.statusCode, 502);
  assert.equal(third.res.body.error, "platform_error");
  assert.equal(third.fake.find(/UPDATE ads SET status = 'ACTIVE'/).length, 0);
});
