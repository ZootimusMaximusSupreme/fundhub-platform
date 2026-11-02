import assert from "node:assert/strict";
import { test } from "node:test";
import handler, { MEET_CALL_SCOPE_SQL } from "../../api/read/meet-presence.mjs";

const ORG = "11000000-0000-4000-8000-000000000001";
const STAFF = "22000000-0000-4000-8000-000000000002";
const CLIENT = "33000000-0000-4000-8000-000000000003";
const BOOKING = "44000000-0000-4000-8000-000000000004";
const call = { booking_id: BOOKING, starts_at: "2026-11-02T18:00:00Z", meeting_url: "https://meet.google.com/abc-defg-hij" };
function response() { return { code: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } }; }
const observed = { status: "available", checkedAt: "2026-11-02T18:00:00Z", reason: null,
  presence: { conferenceActive: true, participantCount: 1, participants: [{ displayName: "Guest", identity: "unidentified" }], verifiedLeadJoined: null } };
async function run({ role = "closer", roles, rows = [call], query = { client_id: CLIENT }, method = "GET", store = new Map(), clock = () => 1_793_642_400_000 } = {}) {
  const queries = []; let providerCalls = 0;
  const res = response();
  await handler({ method, query }, res, { staff: { id: STAFF, org_id: ORG, role, roles },
    db: { async query(sql, params) { queries.push({ sql, params }); return { rows }; } },
    cache: store, clock, readPresence: async input => { providerCalls++; assert.equal(input.meetingUrl, call.meeting_url); return observed; } });
  return { res, queries, providerCalls };
}

test("scope/assignment SQL runs before Google and never uses query tenancy or room URLs", async () => {
  const out = await run();
  assert.equal(out.res.code, 200); assert.equal(out.providerCalls, 1);
  assert.deepEqual(out.queries[0].params, [CLIENT, ORG, false, STAFF]);
  assert.match(MEET_CALL_SCOPE_SQL, /c.id = \$1 AND c.org_id = \$2/);
  assert.match(MEET_CALL_SCOPE_SQL, /t.assignee_staff_id = \$4/);
  assert.match(MEET_CALL_SCOPE_SQL, /t.done IS NOT TRUE/);
  assert.match(MEET_CALL_SCOPE_SQL, /b.status IN \('booked', 'rescheduled'\)/);
  assert.equal(out.res.headers["Cache-Control"], "no-store");
  assert.equal(out.res.body.bookingId, BOOKING); assert.equal(out.res.body.presence.verifiedLeadJoined, null);
});

test("a foreign, unassigned, cancelled, archived or unowned call returns no provider information", async () => {
  const out = await run({ rows: [] });
  assert.equal(out.res.code, 403); assert.equal(out.providerCalls, 0); assert.equal(out.queries.length, 1);
  assert.match(MEET_CALL_SCOPE_SQL, /t.org_id = c.org_id AND t.client_id = c.id/);
  assert.match(MEET_CALL_SCOPE_SQL, /crm_archived_at/);
  assert.doesNotMatch(MEET_CALL_SCOPE_SQL, /assignee_staff_id IS NULL/);
});

test("assigned closer is personal-only; only primary owner/admin/sales_manager get privilege", async () => {
  const assigned = await run({ role: "setter", roles: ["setter", "closer", "admin", "sales_manager"] });
  assert.equal(assigned.res.code, 200); assert.equal(assigned.queries[0].params[2], false);
  for (const role of ["owner", "admin", "sales_manager"]) {
    const out = await run({ role }); assert.equal(out.res.code, 200); assert.equal(out.queries[0].params[2], true);
  }
  for (const role of ["setter", "outbound_rep", "client", "affiliate", "partner"]) {
    const out = await run({ role, roles: role === "setter" ? ["setter", "sales_manager"] : [role, "closer"] });
    assert.equal(out.res.code, 403); assert.equal(out.providerCalls, 0); assert.equal(out.queries.length, 0);
  }
});

test("method and arbitrary room/user/org inputs are refused before scoped reads", async () => {
  assert.equal((await run({ method: "POST" })).res.code, 405);
  for (const query of [{ client_id: "not-uuid" }, { client_id: CLIENT, room: "abc-defg-hij" }, { client_id: CLIENT, org_id: ORG }, { client_id: CLIENT, google_user_id: "123" }]) {
    const out = await run({ query }); assert.equal(out.res.code, 400); assert.equal(out.queries.length, 0); assert.equal(out.providerCalls, 0);
  }
});

test("12-second cache still checks DB assignment on every request and cannot survive revocation", async () => {
  const store = new Map(); let at = 1_793_642_400_000;
  const one = await run({ store, clock: () => at });
  const two = await run({ store, clock: () => at + 1000 });
  assert.equal(one.providerCalls, 1); assert.equal(two.providerCalls, 0); assert.equal(two.queries.length, 1);
  const revoked = await run({ store, rows: [] }); assert.equal(revoked.res.code, 403); assert.equal(revoked.providerCalls, 0);
  at += 12_001;
  assert.equal((await run({ store, clock: () => at })).providerCalls, 1);
});


test("unsigned requests cannot reach scope SQL or Google", async () => {
  const res = response(); let queries = 0;
  await handler({ method: "GET", query: { client_id: CLIENT }, headers: {} }, res, { db: { async query() { queries++; throw new Error("must not read"); } } });
  assert.equal(res.code, 401); assert.equal(queries, 0);
});
