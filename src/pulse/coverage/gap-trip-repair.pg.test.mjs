// trip:repair: the SQL itself, on a real Postgres. Read only. Skips unless DATABASE_URL is set.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-trip-repair.pg.test.mjs
//
// Same harness as gap-trip-funding.pg.test.mjs: every statement runs in BEGIN READ ONLY and is rolled
// back, and every table is shadowed by the made-up rows of the scenario with its columns pinned to
// the real table (trip-test-kit.mjs).

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { COUNT_SQL, TRIP_SQL, judgeRepair, tripParams } from "./gap-trip-repair.mjs";
import { HAS_DB, ORG, OTHER_ORG, closeShadowDb, emptyWorld, runWorld, uid } from "./trip-test-kit.mjs";

const NOW = new Date();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

const TABLES = [
  "clients", "sales", "products", "payment_links", "repair_programs", "pii_identity", "crs_results",
  "client_consents", "contracts", "contract_templates", "dispute_letters", "dispute_cases",
  "dispute_responses", "repair_decision_log", "cards", "pipelines", "pipeline_stages"
];

after(async () => {
  if (HAS_DB) await closeShadowDb();
});

function world() {
  const w = emptyWorld(TABLES);
  const ids = { board: uid(), stages: {}, repairProduct: uid(), otherProduct: uid() };
  w.pipelines.rows.push({ id: ids.board, org_id: ORG, key: "optimization" });
  for (const k of ["intake", "awaiting_documents", "analysis", "letters_generated", "ready_to_send", "in_transit",
    "awaiting_response", "response_received", "round_complete", "stalled", "cancelled"]) {
    ids.stages[k] = uid();
    w.pipeline_stages.rows.push({ id: ids.stages[k], pipeline_id: ids.board, key: k });
  }
  w.products.rows.push(
    { id: ids.repairProduct, org_id: ORG, code: "repair-bundle", category: "repair" },
    { id: ids.otherProduct, org_id: ORG, code: "diy-letter-pack", category: "consulting" }
  );
  return { w, ids };
}

function addClient(w, over = {}) {
  const id = uid();
  w.clients.rows.push({
    id, org_id: ORG, client_code: `FH-${String(w.clients.rows.length + 1).padStart(6, "0")}`,
    email: `buyer${w.clients.rows.length}@gmail.com`, is_demo: false, custom_fields: {},
    created_at: ago(90 * DAY), updated_at: ago(DAY), ...over
  });
  return id;
}

function bought(w, ids, c, at, product = "repairProduct") {
  w.sales.rows.push({
    id: uid(), org_id: ORG, client_id: c, product_id: ids[product], status: "active", sold_at: at,
    is_demo: false, agreed_success_fee_percent: null
  });
}

function program(w, c, at) {
  w.repair_programs.rows.push({ org_id: ORG, client_id: c, created_at: at, status: "active" });
}

function card(w, ids, c, stage, enteredAt) {
  w.cards.rows.push({
    org_id: ORG, client_id: c, pipeline_id: ids.board, stage_id: ids.stages[stage],
    entered_at: enteredAt, updated_at: enteredAt, is_demo: false, partner_id: null
  });
}

async function judge(w) {
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  const count = await runWorld(COUNT_SQL, w, tripParams(ORG, NOW));
  assert.equal(count.rows[0].n, out.rows.length, "COUNT_SQL and TRIP_SQL must find the same customers");
  return { rows: out.rows, verdict: judgeRepair({ rows: out.rows, now: NOW }) };
}

const skip = HAS_DB ? false : "DATABASE_URL is not set";

test("SQL: nobody bought repair is a nothing-to-judge", { skip }, async () => {
  const { w } = world();
  addClient(w);
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 0);
  assert.equal(verdict.status, "na");
});

test("SQL: a product that is not repair does not start the repair trip", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(3 * HOUR), "otherProduct");
  const { rows } = await judge(w);
  assert.equal(rows.length, 0);
});

test("SQL RED: bought 3 hours ago and no program", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(3 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "repair program opened"/);
});

test("SQL GREEN: bought and enrolled, waiting for documents", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(3 * HOUR));
  program(w, c, ago(3 * HOUR));
  card(w, ids, c, "awaiting_documents", ago(2 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 waiting \(1 at "ID read and accepted"\)/);
});

test("SQL: a paid repair link starts the trip even with no sale row", { skip }, async () => {
  const { w } = world();
  const c = addClient(w);
  w.payment_links.rows.push({
    org_id: ORG, client_id: c, purpose: "repair", status: "paid", link_ref: "x", paid_at: ago(5 * HOUR),
    updated_at: ago(5 * HOUR), identity_stored_at: null, is_demo: false
  });
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 1);
  assert.equal(verdict.status, "FAIL");
});

test("SQL RED: every letter gate is in place and a file sits in Analysis for two hours", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(10 * DAY));
  program(w, c, ago(10 * DAY));
  w.pii_identity.rows.push({ org_id: ORG, client_id: c, verified_legal_name: "Pat Buyer", verified_at: ago(9 * DAY) });
  w.crs_results.rows.push({ org_id: ORG, client_id: c, created_at: ago(9 * DAY), is_demo: false });
  w.contracts.rows.push({ org_id: ORG, client_id: c, template_key: "REPAIR_AGREEMENT", status: "signed", signed_at: ago(8 * DAY) });
  card(w, ids, c, "analysis", ago(2 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "round 1 letters made"/);
});

test("SQL: a live dispute authorization is a gate; a revoked one is not", { skip }, async () => {
  const { w, ids } = world();
  const live = addClient(w);
  const revoked = addClient(w);
  for (const c of [live, revoked]) {
    bought(w, ids, c, ago(10 * DAY));
    program(w, c, ago(10 * DAY));
    w.pii_identity.rows.push({ org_id: ORG, client_id: c, verified_legal_name: "Pat Buyer", verified_at: ago(9 * DAY) });
    w.crs_results.rows.push({ org_id: ORG, client_id: c, created_at: ago(9 * DAY), is_demo: false });
  }
  w.client_consents.rows.push({
    org_id: ORG, client_id: live, kind: "dispute_authorization", granted_at: ago(8 * DAY), expires_at: null, revoked_at: null
  });
  w.client_consents.rows.push({
    org_id: ORG, client_id: revoked, kind: "dispute_authorization", granted_at: ago(8 * DAY), expires_at: null, revoked_at: ago(DAY)
  });
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  const by = Object.fromEntries(out.rows.map((r) => [r.client_id, r]));
  assert.ok(by[live].authorized_at, "a live authorization is a gate");
  assert.equal(by[revoked].authorized_at, null, "a revoked one is not");
});

test("SQL: a signed credit repair agreement is a gate through the template subtype", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(10 * DAY));
  w.contract_templates.rows.push({ org_id: ORG, template_key: "CUSTOM_ONE", subtype: "credit_repair" });
  w.contracts.rows.push({ org_id: ORG, client_id: c, template_key: "CUSTOM_ONE", status: "signed", signed_at: ago(8 * DAY) });
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  assert.ok(out.rows[0].authorized_at);
});

test("SQL GREEN: mailed letters waiting inside the bureau's clock", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(20 * DAY));
  program(w, c, ago(20 * DAY));
  w.pii_identity.rows.push({ org_id: ORG, client_id: c, verified_legal_name: "Pat Buyer", verified_at: ago(19 * DAY) });
  w.dispute_letters.rows.push({ org_id: ORG, client_id: c, round: "R1", created_at: ago(10 * DAY), mailed_at: ago(9 * DAY) });
  w.dispute_cases.rows.push({
    id: uid(), org_id: ORG, client_id: c, round: "R1", status: "awaiting_response", response_due_at: new Date(NOW.getTime() + 20 * DAY).toISOString()
  });
  card(w, ids, c, "awaiting_response", ago(9 * DAY));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 waiting \(1 at "bureau answer read and confirmed"\)/);
});

test("SQL RED: the bureau's answer is 6 days past its due date", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(60 * DAY));
  program(w, c, ago(60 * DAY));
  w.pii_identity.rows.push({ org_id: ORG, client_id: c, verified_legal_name: "Pat Buyer", verified_at: ago(59 * DAY) });
  w.dispute_letters.rows.push({ org_id: ORG, client_id: c, round: "R1", created_at: ago(50 * DAY), mailed_at: ago(49 * DAY) });
  w.dispute_cases.rows.push({
    id: uid(), org_id: ORG, client_id: c, round: "R1", status: "awaiting_response", response_due_at: ago(6 * DAY)
  });
  card(w, ids, c, "awaiting_response", ago(48 * DAY));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "bureau answer read and confirmed"/);
});

test("SQL: a closed case does not set the bureau's due date", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(60 * DAY));
  program(w, c, ago(60 * DAY));
  card(w, ids, c, "awaiting_response", ago(48 * DAY));
  w.dispute_cases.rows.push({
    id: uid(), org_id: ORG, client_id: c, round: "R1", status: "closed", response_due_at: ago(30 * DAY)
  });
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  assert.equal(out.rows[0].response_due_at, null);
});

test("SQL: a confirmed answer on round 1 is the answer read; one on round 2 is not", { skip }, async () => {
  const { w, ids } = world();
  const a = addClient(w);
  const b = addClient(w);
  const caseA = uid();
  const caseB = uid();
  for (const [c, cs, round] of [[a, caseA, "R1"], [b, caseB, "R2"]]) {
    bought(w, ids, c, ago(50 * DAY));
    program(w, c, ago(50 * DAY));
    w.dispute_cases.rows.push({ id: cs, org_id: ORG, client_id: c, round, status: "open", response_due_at: null });
    w.dispute_responses.rows.push({ org_id: ORG, client_id: c, case_id: cs, confirmed: true, confirmed_at: ago(5 * DAY) });
  }
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  const by = Object.fromEntries(out.rows.map((r) => [r.client_id, r]));
  assert.ok(by[a].answer_read_at);
  assert.equal(by[b].answer_read_at, null);
});

test("SQL: a later round's letters mean round 1 is behind the client", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(55 * DAY));
  program(w, c, ago(55 * DAY));
  w.pii_identity.rows.push({ org_id: ORG, client_id: c, verified_legal_name: "Pat Buyer", verified_at: ago(54 * DAY) });
  w.dispute_letters.rows.push({ org_id: ORG, client_id: c, round: "R1", created_at: ago(40 * DAY), mailed_at: ago(39 * DAY) });
  w.dispute_letters.rows.push({ org_id: ORG, client_id: c, round: "R2", created_at: ago(5 * DAY), mailed_at: null });
  card(w, ids, c, "letters_generated", ago(5 * DAY));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 finished/);
});

test("SQL: demo clients, test addresses, archived clients and other companies are left out", { skip }, async () => {
  const { w, ids } = world();
  const bad = [
    addClient(w, { is_demo: true }),
    addClient(w, { email: "walk@example.com" }),
    addClient(w, { custom_fields: { synthetic: "true" } }),
    addClient(w, { custom_fields: { crm_archived_at: ago(DAY) } })
  ];
  for (const c of bad) bought(w, ids, c, ago(5 * HOUR));
  const other = uid();
  w.clients.rows.push({
    id: other, org_id: OTHER_ORG, client_code: "OTHER", email: "x@gmail.com", is_demo: false,
    custom_fields: {}, created_at: ago(90 * DAY), updated_at: ago(DAY)
  });
  w.sales.rows.push({
    id: uid(), org_id: OTHER_ORG, client_id: other, product_id: ids.repairProduct, status: "active",
    sold_at: ago(5 * HOUR), is_demo: false, agreed_success_fee_percent: null
  });
  const { rows } = await judge(w);
  assert.equal(rows.length, 0);
});

test("SQL: a trip that started before the window is not followed", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  bought(w, ids, c, ago(61 * DAY));
  const { rows } = await judge(w);
  assert.equal(rows.length, 0);
});
