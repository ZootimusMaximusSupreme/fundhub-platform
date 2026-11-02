import { test } from "node:test";
import assert from "node:assert/strict";
import { assignFundingAdvisor } from "./assign-advisor.mjs";

function fixture({ linked = null, advisors = [], claimed = [], winner = true } = {}) {
  const state = { linked, tasks: [{ role: "funding_advisor", staffId: linked, done: false }], writes: 0 };
  const db = { async query(sql, params) {
    if (sql.includes("LEFT JOIN staff s")) {
      return { rows: [{ staff_id: state.linked,
        active_staff_id: advisors.includes(state.linked) ? state.linked : null }] };
    }
    if (sql.includes("FROM tasks t JOIN staff s")) {
      return { rows: claimed.map(id => ({ id })) };
    }
    if (sql.includes("FROM staff s") && sql.includes("ORDER BY")) {
      return { rows: advisors.length ? [{ id: advisors[0] }] : [] };
    }
    if (sql.includes("UPDATE clients c")) {
      if (!winner || state.linked !== params[3]) return { rows: [] };
      state.linked = params[2];
      state.writes += 1;
      return { rows: [{ id: params[1] }] };
    }
    if (sql.includes("UPDATE tasks SET assignee_staff_id")) {
      for (const task of state.tasks) {
        if (!task.done && task.role === "funding_advisor" && (!task.staffId || task.staffId === params[3])) task.staffId = params[2];
      }
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 60)}`);
  } };
  return { db, state };
}

test("a paid funding file gets one active advisor and its open work follows", async () => {
  const { db, state } = fixture({ advisors: ["advisor-1"] });
  const first = await assignFundingAdvisor(db, { orgId: "org-1", clientId: "client-1" });
  const replay = await assignFundingAdvisor(db, { orgId: "org-1", clientId: "client-1" });
  assert.equal(first.staffId, "advisor-1");
  assert.equal(first.assigned, true);
  assert.equal(state.tasks[0].staffId, "advisor-1");
  assert.equal(state.writes, 1);
  assert.equal(replay.staffId, "advisor-1");
  assert.equal(replay.assigned, false);
});

test("no active advisor leaves the file visibly unassigned", async () => {
  const { db, state } = fixture();
  const out = await assignFundingAdvisor(db, { orgId: "org-1", clientId: "client-1" });
  assert.deepEqual(out, { assigned: false, reason: "no_active_funding_advisor" });
  assert.equal(state.tasks[0].staffId, null);
});

test("a departed advisor's paid file and open work get an active owner", async () => {
  const { db, state } = fixture({ linked: "former-advisor", advisors: ["advisor-2"] });
  const out = await assignFundingAdvisor(db, { orgId: "org-1", clientId: "client-1" });
  assert.equal(out.staffId, "advisor-2");
  assert.equal(state.linked, "advisor-2");
  assert.equal(state.tasks[0].staffId, "advisor-2");
  assert.equal(state.writes, 1);
});

test("a concurrent assignment winner is read back instead of overwritten", async () => {
  const { db, state } = fixture({ advisors: ["advisor-1"], winner: false });
  const query = db.query;
  let linkedReads = 0;
  db.query = async (sql, params) => {
    if (sql.includes("LEFT JOIN staff s") && ++linkedReads === 2) state.linked = "advisor-1";
    return query(sql, params);
  };
  const out = await assignFundingAdvisor(db, { orgId: "org-1", clientId: "client-1" });
  assert.equal(out.staffId, "advisor-1");
  assert.equal(out.assigned, false);
  assert.equal(state.writes, 0);
});

test("a claimed intake advisor wins over load balancing", async () => {
  const { db, state } = fixture({ advisors: ["advisor-1", "advisor-2"], claimed: ["advisor-2"] });
  const out = await assignFundingAdvisor(db, { orgId: "org-1", clientId: "client-1" });
  assert.equal(out.staffId, "advisor-2");
  assert.equal(state.linked, "advisor-2");
});

test("two conflicting intake claims do not choose an arbitrary owner", async () => {
  const { db, state } = fixture({ advisors: ["advisor-1", "advisor-2"], claimed: ["advisor-1", "advisor-2"] });
  const out = await assignFundingAdvisor(db, { orgId: "org-1", clientId: "client-1" });
  assert.deepEqual(out, { assigned: false, reason: "conflicting_advisor_claims" });
  assert.equal(state.linked, null);
});
