// trip:inquiry: the SQL itself, on a real Postgres. Read only. Skips unless DATABASE_URL is set.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-trip-inquiry.pg.test.mjs
//
// Same harness as gap-trip-funding.pg.test.mjs: BEGIN READ ONLY, always rolled back, every table
// shadowed by the made-up rows of the scenario with its columns pinned to the real table.

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { COUNT_SQL, TRIP_SQL, judgeInquiry, tripParams } from "./gap-trip-inquiry.mjs";
import { HAS_DB, ORG, OTHER_ORG, closeShadowDb, emptyWorld, runWorld, uid } from "./trip-test-kit.mjs";

const NOW = new Date();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

after(async () => {
  if (HAS_DB) await closeShadowDb();
});

function world() {
  return emptyWorld(["clients", "events", "inquiry_removal_cases"]);
}

function addClient(w, over = {}) {
  const id = uid();
  w.clients.rows.push({
    id, org_id: ORG, client_code: `FH-${String(w.clients.rows.length + 1).padStart(6, "0")}`,
    email: `buyer${w.clients.rows.length}@gmail.com`, is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(90 * DAY), updated_at: ago(DAY), ...over
  });
  return id;
}

function event(w, c, name, at, payload = {}, over = {}) {
  w.events.rows.push({
    org_id: ORG, client_id: c, name, created_at: at, is_demo: false, idempotency_key: `${name}:${uid()}`, payload, ...over
  });
}

function irCase(w, c, bureau, over = {}) {
  w.inquiry_removal_cases.rows.push({
    org_id: ORG, client_id: c, funding_round_id: null, case_status: "Queued", selected_bureaus_raw: bureau,
    request_source: "inquiry_gate", open_inquiry_count: 2, letter_provider_id: null, draft_letter_document_id: null,
    letter_draft_html: "<p>letter</p>", call_due_at: null, call_fired_at: null, closed_at: null,
    completed_at: null, cleared_at: null, created_at: ago(3 * DAY), updated_at: ago(3 * DAY), is_demo: false,
    ...over
  });
}

async function judge(w, now = NOW) {
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, now));
  const p = tripParams(ORG, now);
  const count = await runWorld(COUNT_SQL, w, [p[0], p[1], p[2]]);
  assert.equal(count.rows[0].n, out.rows.length, "COUNT_SQL and TRIP_SQL must find the same customers");
  return { rows: out.rows, verdict: judgeInquiry({ rows: out.rows, now }) };
}

const skip = HAS_DB ? false : "DATABASE_URL is not set";

test("SQL: nobody went through the gate is a nothing-to-judge", { skip }, async () => {
  const w = world();
  addClient(w);
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 0);
  assert.equal(verdict.status, "na");
});

test("SQL RED: the deposit was paid 3 hours ago and the gate left nothing", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  event(w, c, "deposit.paid", ago(3 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "inquiry gate ran"/);
});

test("SQL GREEN: the deposit was paid and the gate found nothing to remove", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  event(w, c, "deposit.paid", ago(3 * HOUR));
  event(w, c, "inquiry.gate.clear", ago(3 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 ended/);
});

test("SQL RED: the gate raised three bureaus and made two cases", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  event(w, c, "deposit.paid", ago(3 * DAY));
  event(w, c, "inquiry.gate.raised", ago(3 * DAY), { bureaus: ["EQ", "EX", "TU"] });
  irCase(w, c, "EQ");
  irCase(w, c, "EX");
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /TU has no case/);
});

test("SQL GREEN: three bureaus, three cases, waiting for the calls", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  event(w, c, "deposit.paid", ago(3 * DAY));
  event(w, c, "inquiry.gate.raised", ago(3 * DAY), { bureaus: ["EQ", "EX", "TU"] });
  for (const b of ["EQ", "EX", "TU"]) irCase(w, c, b);
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 waiting \(1 at "bureau call fired"\)/);
});

test("SQL: a cancelled case is not a case for the bureau", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  event(w, c, "inquiry.gate.raised", ago(3 * DAY), { bureaus: ["EQ", "EX"] });
  irCase(w, c, "EQ");
  irCase(w, c, "EX", { case_status: "Canceled" });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /EX has no case/);
});

test("SQL RED: a gate case with open inquiries and no draft letter", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  event(w, c, "inquiry.gate.raised", ago(3 * DAY), { bureaus: ["EQ"] });
  irCase(w, c, "EQ", { letter_draft_html: null });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "draft letter on each case"/);
  assert.match(verdict.detail, /1 of 1 gate cases with open inquiries have no draft letter/);
});

test("SQL GREEN: a letter sent through a provider or stored as a document counts as a letter", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  event(w, c, "inquiry.gate.raised", ago(3 * DAY), { bureaus: ["EQ", "EX"] });
  irCase(w, c, "EQ", { letter_draft_html: null, letter_provider_id: "pg_1" });
  irCase(w, c, "EX", { letter_draft_html: "", draft_letter_document_id: uid() });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL RED: a call came due and was never fired, and an idle case is red too", { skip }, async () => {
  const w = world();
  const a = addClient(w);
  const b = addClient(w);
  irCase(w, a, "EQ", { call_due_at: ago(2 * HOUR), case_status: "Scheduled" });
  irCase(w, b, "EQ", { case_status: "Escalated", updated_at: ago(80 * HOUR) });
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 2);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /^2 of 2 customers/);
});

test("SQL GREEN: a call due a minute ago is inside the sweeper's wait", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  irCase(w, c, "EQ", { call_due_at: ago(MIN), case_status: "Scheduled" });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
});

test("SQL RED: every case is completed and no inquiry.removed event followed", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  irCase(w, c, "EQ", { case_status: "Completed", completed_at: ago(2 * HOUR), updated_at: ago(2 * HOUR) });
  irCase(w, c, "EX", { case_status: "Completed", completed_at: ago(2 * HOUR), updated_at: ago(2 * HOUR) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "inquiry\.removed fired"/);
});

test("SQL RED: removed and fired, a funding client, and funding was never marked ready", { skip }, async () => {
  const w = world();
  const c = addClient(w, { custom_fields: { product_path: "Funding" } });
  irCase(w, c, "EQ", { case_status: "Completed", completed_at: ago(3 * HOUR), updated_at: ago(3 * HOUR) });
  event(w, c, "inquiry.removed", ago(2 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "funding ready for the next round"/);
});

test("SQL GREEN: removed, fired, and funding marked ready is a finished trip", { skip }, async () => {
  const w = world();
  const c = addClient(w, { custom_fields: { product_path: "Funding", ready_for_next_round: "true" } });
  irCase(w, c, "EQ", { case_status: "Completed", completed_at: ago(3 * HOUR), updated_at: ago(3 * HOUR), call_fired_at: ago(DAY) });
  event(w, c, "inquiry.removed", ago(2 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 finished/);
});

test("SQL GREEN: a fraud alert is the hold C-03 makes on purpose", { skip }, async () => {
  const w = world();
  const c = addClient(w, { custom_fields: { product_path: "Funding" }, tags: ["fraud:alert-present"] });
  irCase(w, c, "EQ", { case_status: "Completed", completed_at: ago(3 * HOUR), updated_at: ago(3 * HOUR) });
  event(w, c, "inquiry.removed", ago(2 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 ended/);
});

test("SQL: only the newest round's cases are the trip", { skip }, async () => {
  const w = world();
  const c = addClient(w);
  const r1 = uid();
  const r2 = uid();
  irCase(w, c, "EQ", { funding_round_id: r1, case_status: "Completed", completed_at: ago(20 * DAY), created_at: ago(30 * DAY), updated_at: ago(20 * DAY) });
  irCase(w, c, "EQ", { funding_round_id: r2, case_status: "Queued", created_at: ago(DAY), updated_at: ago(DAY) });
  const { rows } = await judge(w);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cases_n, 1);
  assert.equal(rows[0].completed_n, 0);
});

test("SQL: demo clients, test addresses, other companies and old trips are left out", { skip }, async () => {
  const w = world();
  const bad = [addClient(w, { is_demo: true }), addClient(w, { email: "x@example.com" }), addClient(w, { custom_fields: { crm_archived_at: ago(DAY) } })];
  for (const c of bad) irCase(w, c, "EQ");
  const old = addClient(w);
  irCase(w, old, "EQ", { created_at: ago(61 * DAY), updated_at: ago(61 * DAY) });
  const other = uid();
  w.clients.rows.push({
    id: other, org_id: OTHER_ORG, client_code: "OTHER", email: "o@gmail.com", is_demo: false, custom_fields: {}, tags: [],
    created_at: ago(90 * DAY), updated_at: ago(DAY)
  });
  w.inquiry_removal_cases.rows.push({
    org_id: OTHER_ORG, client_id: other, funding_round_id: null, case_status: "Queued", selected_bureaus_raw: "EQ",
    request_source: "inquiry_gate", open_inquiry_count: 1, letter_provider_id: null, draft_letter_document_id: null,
    letter_draft_html: "x", call_due_at: null, call_fired_at: null, closed_at: null, completed_at: null,
    cleared_at: null, created_at: ago(DAY), updated_at: ago(DAY), is_demo: false
  });
  const { rows } = await judge(w);
  assert.equal(rows.length, 0);
});
