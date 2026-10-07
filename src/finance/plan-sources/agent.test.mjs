// Plan source 'agent' (src/finance/plan-sources/agent.mjs): what the money
// helper put on the client's plan, in the board's pin shape.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { name, pins, mark, buildAgentPin, MARKS } from "./agent.mjs";
import { normalizePin, PIN_KINDS } from "./index.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const ID = "9b3c1a2e-4d5f-4a6b-8c7d-0e1f2a3b4c5d";
const REMINDER = { id: ID, purpose: "reminder", date: "2026-10-14", kind: "other", title: "Pay Business Amex", detail: null, amount_cents: "13500", status: "planned" };

describe("the agent plan source", () => {
  test("its name, and a reminder as a pin the registry accepts", () => {
    assert.equal(name, "agent");
    const p = buildAgentPin(REMINDER);
    assert.deepEqual(p, {
      id: `agent:${ID}`, date: "2026-10-14", kind: "other", title: "Reminder: Pay Business Amex",
      detail: "Set by your money helper.", amount_cents: 13500, bank: null, container_id: null,
      status: "planned", source: "agent", can_mark: [...MARKS]
    });
    const n = normalizePin(p, "agent", { from: "2026-10-01", to: "2026-10-31", markable: true });
    assert.equal(n.title, "Reminder: Pay Business Amex");
    assert.deepEqual(n.can_mark, ["done", "missed"]);
    assert.ok(PIN_KINDS.includes(n.kind));
  });

  test("a plan step keeps its own kind and title; a done row offers no mark", () => {
    const p = buildAgentPin({ ...REMINDER, purpose: "plan", kind: "pay_down", title: "Pay down Business Amex", status: "done", amount_cents: null });
    assert.deepEqual([p.title, p.kind, p.amount_cents, p.can_mark], ["Pay down Business Amex", "pay_down", null, []]);
  });

  test("pins() reads this client's rows in the window, never cancelled ones", async () => {
    const seen = [];
    const out = await pins({ query: async (sql, params) => { seen.push({ sql, params }); return { rows: [REMINDER] }; } },
      { orgId: ORG, clientId: CLIENT, from: "2026-10-01", to: "2026-10-31" });
    assert.match(seen[0].sql, /FROM money_agent_pins[\s\S]*org_id = \$1 AND client_id = \$2 AND status <> 'cancelled'/);
    assert.deepEqual(seen[0].params, [ORG, CLIENT, "2026-10-01", "2026-10-31"]);
    assert.equal(out[0].id, `agent:${ID}`);
  });

  test("mark(): planned → done on this client's row; anything else is refused or unchanged", async () => {
    const db = { query: async (sql) => (/UPDATE money_agent_pins/.test(sql) ? { rows: [{ ...REMINDER, status: "done" }] } : { rows: [] }) };
    const r = await mark(db, { orgId: ORG, clientId: CLIENT, pinId: `agent:${ID}`, status: "done" });
    assert.deepEqual([r.ok, r.changed, r.pin.status], [true, true, "done"]);
    assert.deepEqual(await mark(db, { orgId: ORG, clientId: CLIENT, pinId: `agent:${ID}`, status: "skipped" }), { ok: false, reason: "bad_status" });
    assert.deepEqual(await mark(db, { orgId: ORG, clientId: CLIENT, pinId: "dues:whatever", status: "done" }), { ok: false, reason: "not_found" });
    const unchanged = { query: async (sql) => (/UPDATE/.test(sql) ? { rows: [] } : { rows: [{ ...REMINDER, status: "missed" }] }) };
    const u = await mark(unchanged, { orgId: ORG, clientId: CLIENT, pinId: `agent:${ID}`, status: "done" });
    assert.deepEqual([u.ok, u.changed, u.pin.status], [true, false, "missed"]);
  });
});
