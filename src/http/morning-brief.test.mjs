import { test } from "node:test";
import assert from "node:assert/strict";
import handler, { parseBriefDate, parseBriefKind } from "../../api/read/morning-brief.mjs";

function resCapture() {
  const out = { statusCode: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) {
      out.statusCode = code;
      return { json(body) { out.body = body; } };
    }
  };
}

test("a bad date or kind is refused", () => {
  assert.equal(parseBriefDate("2026-13-40"), null);
  assert.equal(parseBriefDate("2026-10-05"), "2026-10-05");
  assert.equal(parseBriefKind("noon"), null);
  assert.equal(parseBriefKind("evening"), "evening");
  assert.equal(parseBriefKind(""), "morning");
});

test("the read door returns the stored brief for an owner", async () => {
  const res = resCapture();
  const row = { id: "b1", kind: "morning", text_body: "Good morning, Chris." };
  await handler(
    { method: "GET", query: { date: "2026-10-05", kind: "morning" } },
    res,
    {
      requireAuth: async () => ({ org_id: "11111111-1111-4111-8111-111111111111", role: "owner" }),
      db: {
        query: async () => ({ rows: [row] })
      }
    }
  );
  assert.equal(res.out.statusCode, 200);
  assert.equal(res.out.body.ok, true);
  assert.equal(res.out.body.brief.text_body, "Good morning, Chris.");
});

test("a missing day is a 404, not an invented brief", async () => {
  const res = resCapture();
  await handler(
    { method: "GET", query: { date: "2026-10-05" } },
    res,
    {
      requireAuth: async () => ({ org_id: "11111111-1111-4111-8111-111111111111", role: "owner" }),
      db: { query: async () => ({ rows: [] }) }
    }
  );
  assert.equal(res.out.statusCode, 404);
  assert.equal(res.out.body.error, "no_brief");
});

// Tenant isolation. The handler writes no SQL of its own, so the org-scope lint
// (src/http/read-endpoints-org-scope.test.mjs) excuses it on the strength of
// readMorningBrief(). These two cases are the proof behind that excuse.
test("the read binds the SESSION's company, never one from the query string", async () => {
  const SESSION_ORG = "11111111-1111-4111-8111-111111111111";
  const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const res = resCapture();
  await handler(
    { method: "GET", query: { date: "2026-10-05", kind: "morning", org_id: OTHER_ORG, orgId: OTHER_ORG } },
    res,
    {
      requireAuth: async () => ({ org_id: SESSION_ORG, role: "owner" }),
      db: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } }
    }
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /org_id\s*=\s*\$1\b/);
  assert.equal(calls[0].params[0], SESSION_ORG);
  assert.ok(!calls[0].params.includes(OTHER_ORG), "an org id from the query string reached the SQL");
});

test("a session with no company is refused and reads nothing", async () => {
  const calls = [];
  const res = resCapture();
  await handler(
    { method: "GET", query: { date: "2026-10-05" } },
    res,
    {
      requireAuth: async () => ({ org_id: null, role: "owner" }),
      db: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } }
    }
  );
  assert.equal(res.out.statusCode, 403);
  assert.equal(calls.length, 0);
});
