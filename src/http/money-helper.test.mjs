// /api/money/helper — the gate for both callers, the thread read, and sending a
// message. Stubbed principal, db and workers; no network, no Postgres. The
// routing and the writes are tested in src/finance/money-helper.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import handler, { helperPayload } from "../../api/money/helper.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { PULSE_REGISTRY } from "../pulse/registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const STAFF_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG = "org-1";
const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: STAFF_ID, role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});
const NOW = () => new Date("2026-10-07T17:00:00Z");
const TURN_ROW = { id: "t1", org_id: ORG, client_id: MINE, kind: "message", actor: "client", input: "hi", status: "answered", reply: "Hello.", actions: [], brain: "rules", model: null, reason: "bridge_off", created_at: new Date(), answered_at: new Date() };

function spies({ payload = { ok: true, turns: [] }, sent = { ok: true, turn: TURN_ROW, queued: false } } = {}) {
  const calls = { build: [], send: [] };
  return {
    calls,
    deps: {
      helperPayload: async (_db, args) => { calls.build.push(args); return payload; },
      submitMessage: async (_db, args) => { calls.send.push(args); return typeof sent === "function" ? sent(args) : sent; }
    }
  };
}

async function call(req, principal, { inOrg, s = spies() } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, env: {}, ...s.deps });
  return { res, calls: s.calls };
}

describe("the route", () => {
  test("money/helper is routed, and the pulse watches the endpoint and the page", () => {
    assert.equal(ROUTES["money/helper"], handler);
    const keys = PULSE_REGISTRY.map((r) => r.id);
    assert.ok(keys.includes("money/helper"));
    assert.ok(keys.includes("money-helper"));
  });

  test("only GET and POST", async () => {
    const { res } = await call({ method: "DELETE", query: {} }, clientP());
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  });
});

describe("GET — the thread", () => {
  test("a client reads their own thread; ?client_id is never read", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual([calls.build[0].clientId, calls.build[0].orgId, calls.build[0].staff], [MINE, ORG, false]);
  });

  test("a login with no client file is refused", async () => {
    const { res, calls } = await call({ method: "GET", query: {} }, clientP(null));
    assert.equal(res.statusCode, 403);
    assert.equal(calls.build.length, 0);
  });

  test("staff: FINANCE roles only, a client_id, in their org", async () => {
    const ok = await call({ method: "GET", query: { client_id: MINE } }, staffP("owner"));
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.calls.build[0].staff, true);
    assert.equal((await call({ method: "GET", query: { client_id: MINE } }, staffP("setter"))).res.statusCode, 403);
    assert.equal((await call({ method: "GET", query: {} }, staffP("owner"))).res.statusCode, 400);
    assert.equal((await call({ method: "GET", query: { client_id: OTHER } }, staffP("admin"))).res.statusCode, 404);
  });

  test("unsigned → 401; a gone file → 404", async () => {
    assert.equal((await call({ method: "GET", query: {} }, null)).res.statusCode, 401);
    assert.equal((await call({ method: "GET", query: {} }, clientP(), { s: spies({ payload: null }) })).res.statusCode, 404);
  });
});

describe("POST — send a message", () => {
  test("a client's message goes to the router as the client's; the answer comes back shaped", async () => {
    const { res, calls } = await call({ method: "POST", query: {}, body: { action: "send", message: "What is due?", client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual([calls.send[0].clientId, calls.send[0].actor, calls.send[0].input], [MINE, "client", "What is due?"]);
    assert.equal(res.body.turn.reason_words, "Answered by the rules helper: the AI helper's computer is off right now.");
    assert.equal("reason" in res.body.turn, false, "a client gets the reason in plain words only");
  });

  test("staff role-play on a client's file is recorded as staff; queued turns answer 202", async () => {
    const s = spies({ sent: { ok: true, turn: { ...TURN_ROW, status: "queued", reply: null, brain: null, reason: null }, queued: true } });
    const { res, calls } = await call({ method: "POST", query: {}, body: { action: "send", message: "hi", client_id: MINE } }, staffP("sales_manager"), { s });
    assert.equal(res.statusCode, 202);
    assert.deepEqual([calls.send[0].actor, calls.send[0].staffId], ["staff", STAFF_ID]);
    assert.equal(res.body.queued, true);
  });

  test("the router's refusals keep their meaning", async () => {
    const cases = [["message_required", 400], ["helper_off", 409], ["helper_stopped", 409], ["too_many", 429]];
    for (const [error, code] of cases) {
      const s = spies({ sent: { ok: false, error, message: "words" } });
      const { res } = await call({ method: "POST", query: {}, body: { action: "send", message: "x" } }, clientP(), { s });
      assert.equal(res.statusCode, code, error);
      assert.equal(res.body.error, error);
    }
  });

  test("Do task is W5's endpoint, not this one; a body that is not JSON is refused", async () => {
    assert.equal((await call({ method: "POST", query: {}, body: { action: "do_task", task_id: "x" } }, clientP())).res.statusCode, 400);
    assert.equal((await call({ method: "POST", query: {}, body: "not json" }, clientP())).res.statusCode, 400);
  });
});

describe("the GET payload", () => {
  test("the helper's status in words, the turns, and what is still pending", async () => {
    const rows = [
      { ...TURN_ROW, id: "t1" },
      { ...TURN_ROW, id: "t2", status: "queued", reply: null, brain: null, reason: null, answered_at: null }
    ];
    const fake = {
      async query(sql) {
        if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) return { rows: [{ id: MINE, first_name: "Test", last_name: "Test" }] };
        if (/FROM agent_bridge_heartbeats/.test(sql)) return { rows: [{ last_at: new Date("2026-10-07T16:59:50Z") }] };
        if (/FROM agents WHERE org_id/.test(sql)) return { rows: [{ code: "FOS-01", name: "FinanceOS Money Helper", status: "shadow", prompt: "p", guardrails: {} }] };
        if (/FROM money_helper_threads/.test(sql)) return { rows: [] };
        if (/FROM money_helper_turns/.test(sql)) return { rows: [...rows].reverse() };
        return { rows: [] };
      }
    };
    const p = await helperPayload(fake, { orgId: ORG, clientId: MINE, staff: false, env: {}, now: new Date("2026-10-07T17:00:00Z") });
    assert.deepEqual(p.client, { id: MINE, name: "Test Test" });
    assert.deepEqual([p.helper.code, p.helper.status, p.helper.on, p.helper.sends_texts, p.helper.brain, p.helper.bridge_on, p.helper.halted], ["FOS-01", "shadow", true, false, "mac", true, false]);
    assert.deepEqual(p.turns.map((t) => t.id), ["t1", "t2"]);
    assert.equal(p.pending, 1);
  });
});

describe("the endpoint never sends", () => {
  test("no send path in the handler", () => {
    const src = fs.readFileSync(path.join(HERE, "../../api/money/helper.mjs"), "utf8");
    assert.doesNotMatch(src, /sendTemplated|dispatchMessage|composeAgentReply|fetch\(/);
  });
});
