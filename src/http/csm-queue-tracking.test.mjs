// GET /api/read/csm-queue?view=tracking — the real handler, its real sign-in
// and role gate, over a stand-in database that answers by the SQL text sent.
// Fake data only. A read: nothing is written, sent or pulled.
import assert from "node:assert/strict";
import test from "node:test";

import csmQueueHandler from "../../api/read/csm-queue.mjs";
import { ORG_ID, OTHER_ORG_ID, STAFF_ID, assertOnlySent, assertRoleGate, call, dataCalls } from "../testing/fin-b25-kit.mjs";

const NOW = new Date("2026-11-07T18:00:00.000Z");
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const noWrites = (result) => assert.ok(dataCalls(result).every((c) => !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql)), "a read writes nothing");

const LIST_ROW = {
  client_id: CLIENT, first_name: "Dana", client_name: "Dana Whitfield", client_code: "FH-101",
  assigned_csm_staff_id: STAFF_ID, assigned_csm_name: "Cam CSM", steps_total: 6, steps_done: 2, last_done_at: daysAgo(12),
  step_id: "w-3", step_key: "pay_card", step_title: "Pay Card A down to $400", step_state: "in_progress",
  step_owner: "client", step_due_at: null, step_created_at: daysAgo(30),
  bank_late: 0, bank_known: 1, plans_open: null, plan_late: null, opened_accounts: null, last_team_text_at: null
};

const listRule = (seen) => [/csm:tracking-list/, (sql, params) => {
  seen.push({ sql, params });
  return params[0] === ORG_ID ? [LIST_ROW] : [];
}];

const deps = (over = {}) => ({ now: () => NOW, fundability: async () => null, readRelationships: async () => [], listPlans: async () => [], ...over });

test("view=tracking lists where each client is, falling behind first, for the signed-in company only", async () => {
  const seen = [];
  const result = await call(csmQueueHandler, { role: "csm", query: { view: "tracking", org_id: OTHER_ORG_ID }, rules: [listRule(seen)], deps: deps() });
  assert.equal(result.status, 200);
  assert.equal(result.body.view, "tracking");
  assert.equal(result.body.show, "behind");
  assert.equal(result.body.behind_count, 1);
  const [row] = result.body.items;
  assert.equal(row.client_name, "Dana Whitfield");
  assert.equal(row.steps.current.days_on_step, 12);
  assert.deepEqual(row.behind.map((r) => r.code), ["step_stuck"]);
  assert.deepEqual(row.payments, { bank_late: 0, plan_late: null, total_late: 0 });
  assert.equal(row.apply_gate.state, "locked");
  assert.deepEqual(seen[0].params, [ORG_ID, null, "2026-11-07", 501], "the company comes off the session; a company in the query string is ignored");
  noWrites(result);
});

test("view=tracking&mine=1 passes the signed-in staff member, and bad list values are a plain 400", async () => {
  const seen = [];
  const mine = await call(csmQueueHandler, { role: "csm", query: { view: "tracking", mine: "1" }, rules: [listRule(seen)], deps: deps() });
  assert.equal(mine.status, 200);
  assert.equal(seen[0].params[1], STAFF_ID);
  const bad = await call(csmQueueHandler, { role: "csm", query: { view: "tracking", show: "everyone" }, rules: [listRule([])], deps: deps() });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_parameter");
  assert.match(bad.body.message, /show must be behind or all/);
  const other = await call(csmQueueHandler, { role: "csm", query: { view: "calendar" }, rules: [], deps: deps() });
  assert.equal(other.status, 400);
  assert.deepEqual(dataCalls(other), [], "an unknown view reads nothing");
});

test("view=tracking is for the CSM desk roles only, refused before any data is read", async () => {
  await assertRoleGate(csmQueueHandler, ["owner", "admin", "csm"], { query: { view: "tracking" }, rules: [listRule([])], deps: deps() });
});

test("the queue without a view is unchanged: the same one statement, the same roles", async () => {
  const result = await call(csmQueueHandler, { role: "closer", query: { limit: "2" }, rules: [[/WITH owed AS/, []]] });
  assert.equal(result.status, 200);
  assert.equal(result.body.view, undefined);
  assertOnlySent(result, "csm.queue");
});

test("one client: a bad id is 400, another company's client is 404 with nothing else read, our client is the full position", async () => {
  const bad = await call(csmQueueHandler, { role: "csm", query: { view: "tracking", client_id: "nope" }, rules: [], deps: deps() });
  assert.equal(bad.status, 400);

  const clientRule = [/csm:tracking-client/, (_sql, params) => (params[1] === ORG_ID && params[0] === CLIENT
    ? [{ client_id: CLIENT, first_name: "Dana", client_name: "Dana Whitfield", client_code: "FH-101", assigned_csm_staff_id: STAFF_ID, assigned_csm_name: "Cam CSM" }] : [])];
  const outsider = await call(csmQueueHandler, {
    role: "csm", staff: { org_id: OTHER_ORG_ID }, query: { view: "tracking", client_id: CLIENT }, rules: [clientRule],
    deps: deps({ fundability: async () => assert.fail("no engine read for another company's client") })
  });
  assert.equal(outsider.status, 404);
  assert.deepEqual(outsider.body, { ok: false, error: "not_found" });
  assert.equal(dataCalls(outsider).length, 1);

  const ours = await call(csmQueueHandler, {
    role: "csm", query: { view: "tracking", client_id: CLIENT },
    rules: [clientRule, [/csm:tracking-steps/, [{ id: "w1", key: "pay_card", title: "Pay Card A down to $400", state: "in_progress", owner_kind: "client", due_at: null, created_at: daysAgo(4), completed_at: null, position: 1 }]]],
    deps: deps({ fundability: async () => ({ has_pull: true, now: { score: 6, score_max: 6, tier: "fundable", factors: [{ key: "no_inquiries", passed: true, value: 0 }] } }) })
  });
  assert.equal(ours.status, 200);
  assert.equal(ours.body.client.steps.current.title, "Pay Card A down to $400");
  assert.equal(ours.body.client.apply_gate.state, "locked", "fundable but no seasoned bank account");
  assert.match(ours.body.client.drafts.help, /^Hi Dana, it's Chris at Fundhub\./);
  for (const c of dataCalls(ours)) assert.ok(c.params.includes(ORG_ID), `every statement carries the company: ${c.sql.slice(0, 60)}`);
  noWrites(ours);
});

test("a database that is down answers 503, not a crash", async () => {
  const down = await call(csmQueueHandler, {
    role: "csm", query: { view: "tracking" },
    rules: [[/csm:tracking-list/, Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })]], deps: deps()
  });
  assert.equal(down.status, 503);
});
