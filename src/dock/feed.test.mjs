import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDockFeed, staffRoles, ownerApprovals } from "./feed.mjs";
import handler from "../../api/read/dock.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-02T05:00:00.000Z");
function response() {
  return { code: null, body: null, headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
}

test("Dock uses all assigned roles once and retains the primary role", () => {
  assert.deepEqual(staffRoles({ role: "csm", roles: ["setter", "setter", "bad_role"] }), ["csm", "setter"]);
  assert.deepEqual(staffRoles({ role: "owner" }), ["owner"]);
  assert.deepEqual(staffRoles({ role: "setter", roles: ["setter", "owner", "admin", "closer"] }), ["setter", "closer"]);
});

test("Dock stacks role task sections and scopes every read to the same staff and org", async () => {
  const calls = [];
  const db = { async query(sql, args) {
    calls.push({ sql, args });
    return { rows: [{ total: args[1] === "csm" ? 2 : 0,
      id: args[1] === "csm" ? "44444444-4444-4444-8444-444444444444" : null,
      client_id: CLIENT, title: "Client follow-up", due_at: "2026-11-02T04:00:00.000Z" }] };
  } };
  const principal = { kind: "staff", staff: { id: STAFF, org_id: ORG,
    role: "inquiry_specialist", roles: ["inquiry_specialist", "csm"] } };
  const feed = await buildDockFeed(db, principal, { now: NOW });
  assert.deepEqual(feed.identity, { kind: "staff", roles: ["inquiry_specialist", "csm"] });
  assert.equal(feed.sections.length, 2);
  assert.equal(feed.sections[0].metrics[0].value, 0);
  assert.equal(feed.sections[1].metrics[0].value, 2);
  assert.equal(feed.sections[1].items[0].urgency, "urgent");
  assert.deepEqual(calls.map(c => c.args), [[ORG, "inquiry_specialist", STAFF], [ORG, "csm", STAFF]]);
  assert(calls.every(c => c.sql.includes("t.assignee_staff_id = $3")));
});

test("Client lookup is pinned to the authenticated client and never returns staff sections", async () => {
  const calls = [];
  const db = { async query(sql, args) { calls.push({ sql, args }); return { rows: [] }; } };
  const feed = await buildDockFeed(db, { kind: "client", clientId: CLIENT, orgId: ORG }, { now: NOW });
  assert.equal(feed, null);
  assert.deepEqual(calls[0].args, [CLIENT, ORG]);
  assert.equal(calls.length, 1);
});

test("Dock route requires GET and a valid principal scope", async () => {
  assert.equal(ROUTES["read/dock"], handler);
  const denied = response();
  await handler({ method: "POST" }, denied);
  assert.equal(denied.code, 405);
  const invalid = response();
  await handler({ method: "GET" }, invalid, { principal: { kind: "client", orgId: ORG, clientId: "nope" } });
  assert.equal(invalid.code, 403);
  assert.equal(invalid.headers["cache-control"], "no-store");
});


test("Owner approvals read three real waiting sources under staff RLS and the signed-in org", async () => {
  let scoped = false;
  const query = async (sql, args) => {
    assert.equal(args[0], ORG);
    for (const table of ["ad_videos", "campaigns", "social_posts"]) {
      assert.match(sql, new RegExp(`FROM ${table} WHERE org_id = \\$1::uuid`));
    }
    return { rows: [{ total: 1, source: "video", id: "v1", title: "Ad 43 take 1", due_at: null }] };
  };
  const approvals = await ownerApprovals(ORG, async fn => { scoped = true; return fn({ query }); });
  assert.equal(scoped, true);
  assert.equal(approvals.total, 1);
  assert.equal(approvals.rows[0].source, "video");
});
