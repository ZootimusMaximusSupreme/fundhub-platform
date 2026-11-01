/* /api/agents — Agent Editor write half.
 *
 * Lives under src/http/ so npm test's src/** glob picks it up (CLAUDE.md §12).
 * Stubs db.query the same way consent-capture.test.mjs does: answer the
 * verifySession lookup, then the handler's own SQL.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/agents.mjs";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const STAFF = "44444444-4444-4444-8444-444444444444";
const AGENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const realQuery = db.query;
let calls = [];

function stubDb({ session = null, answers = [] } = {}) {
  calls = [];
  db.query = async (text, params) => {
    calls.push({ text, params });
    if (/FROM live JOIN staff s/i.test(text)) {
      if (!session) return { rows: [] };
      const pick = (key, fallback) => (key in session ? session[key] : fallback);
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 3_600_000),
        staff_id: pick("staffId", STAFF), org_id: pick("orgId", ORG_A),
        role: pick("role", "owner"), email: "e@example.com",
        name: "A Staffer", status: pick("status", "active"), active_flag: "true"
      }] };
    }
    for (const [pattern, result] of answers) {
      if (pattern.test(text)) return typeof result === "function" ? result(params) : result;
    }
    return { rows: [] };
  };
}

function mkRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  };
}

const mkReq = (body = {}) => ({
  method: "POST",
  headers: { authorization: "Bearer tok" },
  query: {},
  body
});

const agentRow = (over = {}) => ({
  id: AGENT, org_id: ORG_A, code: "AG-01", name: "Lead Follow-up",
  agent_class: "client_facing", channel: "sms", status: "draft",
  runtime: null, runtime_ref: null, runtime_notes: null,
  prompt: "x".repeat(60),
  guardrails: { block: "y".repeat(20), triggers: ["lead.created"] },
  owner_label: "Sarah Whitfield",
  went_live_at: null, retired_at: null, sort_order: 30,
  ...over
});

beforeEach(() => { calls = []; });
afterEach(() => { db.query = realQuery; });

describe("/api/agents", () => {
  test("refuses non-POST", async () => {
    stubDb({ session: { role: "owner" } });
    const r = mkRes();
    await handler({ method: "GET", headers: { authorization: "Bearer tok" }, body: {} }, r);
    assert.equal(r.statusCode, 405);
    assert.equal(r.body.error, "method_not_allowed");
  });

  test("save updates prompt and guardrails for the session org", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/SELECT[\s\S]*FROM agents/i, { rows: [agentRow()] }],
        [/UPDATE agents/i, (params) => ({
          rows: [agentRow({
            name: params[2], channel: params[3], agent_class: params[4],
            owner_label: params[5], prompt: params[6],
            guardrails: JSON.parse(params[7])
          })]
        })]
      ]
    });
    const r = mkRes();
    await handler(mkReq({
      action: "save", code: "AG-01", name: "Renamed",
      channel: "email", agent_class: "client_facing",
      owner_label: "Jordan Blake",
      prompt: "z".repeat(80),
      guardrails: { block: "w".repeat(25), triggers: ["a"] }
    }), r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.agent.name, "Renamed");
    assert.equal(r.body.agent.channel, "email");
    assert.equal(r.body.agent.prompt, "z".repeat(80));
    const saveCall = calls.find((c) => /UPDATE agents/i.test(c.text));
    assert.equal(saveCall.params[0], ORG_A);
  });

  test("save of a missing code is not_found", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [[/SELECT[\s\S]*FROM agents/i, { rows: [] }]]
    });
    const r = mkRes();
    await handler(mkReq({
      action: "save", code: "AG-99", name: "X", prompt: "p", guardrails: {}
    }), r);
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.error, "not_found");
  });

  test("promote sets live and fills runtime when missing", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/SELECT[\s\S]*FROM agents/i, { rows: [agentRow()] }],
        [/UPDATE agents/i, (params) => ({
          rows: [agentRow({
            status: "live", runtime: params[2], runtime_notes: params[3],
            went_live_at: new Date().toISOString()
          })]
        })]
      ]
    });
    const r = mkRes();
    await handler(mkReq({ action: "promote", code: "AG-01" }), r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.agent.status, "live");
    assert.equal(r.body.agent.runtime, "internal");
  });

  test("create inserts a draft agent", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [
        [/SELECT code FROM agents/i, { rows: [{ code: "AG-01" }] }],
        [/MAX\(sort_order\)/i, { rows: [{ m: 30 }] }],
        [/INSERT INTO agents/i, (params) => ({
          rows: [agentRow({
            code: params[1], name: params[2], agent_class: params[3],
            channel: params[4], status: "draft", prompt: null, guardrails: {}
          })]
        })]
      ]
    });
    const r = mkRes();
    await handler(mkReq({
      action: "create", name: "New agent", channel: "sms", agent_class: "client_facing"
    }), r);
    assert.equal(r.statusCode, 201);
    assert.equal(r.body.agent.code, "AG-02");
    assert.equal(r.body.agent.status, "draft");
  });

  test("run refuses Setter Chris", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [[/SELECT[\s\S]*FROM agents/i, { rows: [agentRow({
        code: "AG-04", name: "Setter Chris", agent_class: "client_facing",
        channel: "sms", status: "live"
      })] }]]
    });
    const r = mkRes();
    await handler(mkReq({ action: "run", code: "AG-04", message: "hi" }), r);
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.error, "not_a_drill");
  });

  test("run refuses a draft closer drill", async () => {
    stubDb({
      session: { role: "owner", orgId: ORG_A },
      answers: [[/SELECT[\s\S]*FROM agents/i, { rows: [agentRow({
        code: "OP-06", name: "Closer drill (beta)", agent_class: "ops",
        channel: "internal", status: "draft"
      })] }]]
    });
    const r = mkRes();
    await handler(mkReq({ action: "run", code: "OP-06", message: "Start D1" }), r);
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.error, "not_live");
  });
});
