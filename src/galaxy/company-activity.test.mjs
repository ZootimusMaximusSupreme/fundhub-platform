// Unit tests for Galaxy company-activity node shaping (no database).

import { test } from "node:test";
import assert from "node:assert/strict";
import { companyActivity } from "./company-activity.mjs";

function fakeDb(handlers) {
  return {
    async query(sql, params = []) {
      for (const h of handlers) {
        if (h.match(sql, params)) return h.result(sql, params);
      }
      throw new Error("unexpected query: " + sql.replace(/\s+/g, " ").slice(0, 120));
    }
  };
}

test("companyActivity maps open-shift staff to active nodes and respects demo toggle off", async () => {
  let demoMode = true;
  const staffId = "11111111-1111-1111-1111-111111111111";
  const orgId = "22222222-2222-2222-2222-222222222222";

  const db = fakeDb([
    {
      match: (sql) => /SELECT demo_mode_enabled FROM orgs/.test(sql),
      result: () => ({ rows: [{ demo_mode_enabled: demoMode }] })
    },
    {
      match: (sql) => /FROM staff s/.test(sql),
      result: (_sql, params) => {
        const includeDemo = params[1] === true;
        const rows = includeDemo ? [{
          id: staffId,
          name: "Casey Closer",
          role: "closer",
          is_demo: true,
          open_shift_id: "33333333-3333-3333-3333-333333333333",
          shift_started_at: new Date(Date.now() - 3600000),
          events_today: 4,
          events_15m: 2,
          calls_today: 1
        }] : [];
        return { rows };
      }
    },
    {
      match: (sql) => /FROM staff_events e/.test(sql) && /ORDER BY e\.created_at DESC/.test(sql),
      result: () => ({ rows: [
        { staff_id: staffId, at: new Date(), kind: "call_made" }
      ] })
    },
    {
      match: (sql) => /FROM call_outcomes co/.test(sql) && /JOIN clients/.test(sql),
      result: () => ({ rows: [] })
    },
    {
      match: (sql) => /FROM agents/.test(sql),
      result: () => ({ rows: [
        { code: "AG-04", name: "Setter Josh", agent_class: "client_facing", channel: "voice", status: "live", runtime: "bland", went_live_at: new Date(), sort_order: 1, runs_today: 7, runs_15m: 2, blocked_15m: 1 },
        { code: "OP-06", name: "Quiet Ops", agent_class: "ops", channel: "internal", status: "shadow", runtime: "internal", went_live_at: null, sort_order: 2, runs_today: 0, runs_15m: 0, blocked_15m: 0 }
      ] })
    },
    {
      match: (sql) => /FROM clients/.test(sql) && /first_name/.test(sql),
      result: () => ({ rows: [{ name: "Avery Cobalt", is_demo: true }] })
    },
    {
      match: (sql) => /cash_collected_cents/.test(sql),
      result: () => ({ rows: [{ cash_cents: 0, funded_today: 0, deposits_today: 0 }] })
    }
  ]);

  const on = await companyActivity(db, { orgId });
  assert.equal(on.demo_mode, true);
  assert.equal(on.simulated, false);
  assert.equal(on.nodes.length, 3);
  assert.deepEqual(on.clients, ["DEMO · Avery Cobalt"]);
  const human = on.nodes.find((n) => n.kind === "human");
  assert.equal(human.state, "active");
  assert.equal(human.c, "sales");
  assert.equal(human.name, "DEMO · Casey Closer");
  assert.ok(human.ini);
  const agent = on.nodes.find((n) => n.kind === "agent");
  assert.equal(agent.c, "cfa");
  assert.equal(agent.state, "blocked");
  assert.equal(agent.out, 7, "agent size comes from saved runs today");
  assert.equal(agent.stats.at(-2)[1], "7");
  const quiet = on.nodes.find((n) => n.id === "agent:OP-06");
  assert.equal(quiet.state, "idle");
  assert.equal(quiet.out, 0);

  demoMode = false;
  const off = await companyActivity(db, { orgId });
  assert.equal(off.demo_mode, false);
  assert.equal(off.nodes.filter((n) => n.kind === "human").length, 0);
  assert.equal(off.nodes.filter((n) => n.kind === "agent").length, 2);
});
