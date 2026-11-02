// GET /api/read/message-tests with a stand-in database and a stand-in sign-in: the gate and the answer's
// shape, with no Postgres. The real front door and the real SQL are message-tests.pg.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/read/message-tests.mjs";
import { REPORT_SQL } from "../messaging/experiment-report.mjs";

const ORG = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-20T18:00:00Z");

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

/* A stand-in database that records every statement and answers the report with no rows. */
function fakeDb(onQuery) {
  const asked = [];
  return { asked, query: async (sql, params) => { asked.push(sql); return onQuery ? onQuery(sql, params) : { rows: [] }; } };
}

/* A stand-in sign-in: the way requireAuth works, it answers the request itself (a 401) and returns null. */
const signedInAs = (staff) => async (req, r) => {
  if (!staff) { r.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  return staff;
};

const call = async (staff, { method = "GET", db = fakeDb() } = {}) => {
  const r = res();
  await handler({ method, headers: {}, query: {} }, r, { db, requireAuth: signedInAs(staff), now: () => NOW });
  return { r, db };
};

test("an owner and an admin get every test, with the clock and counts only", async () => {
  for (const role of ["owner", "admin"]) {
    const { r, db } = await call({ id: "s1", role, org_id: ORG });
    assert.equal(r.code, 200, role);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.as_of, NOW.toISOString());
    assert.deepEqual(r.body.tests.map((t) => t.name), ["resume-proof", "nobook-proof"]);
    assert.equal(db.asked.length, 1);
    assert.equal(db.asked[0], REPORT_SQL, "one read, and it is the report");
  }
});

test("any other staff role is a 403 and the database is not asked anything", async () => {
  for (const role of ["setter", "closer", "csm", "funding_advisor", "sales_manager", "inquiry_specialist", "", undefined]) {
    const { r, db } = await call({ id: "s1", role, org_id: ORG });
    assert.equal(r.code, 403, String(role));
    assert.equal(r.body.tests, undefined);
    assert.equal(db.asked.length, 0, `${role}: nothing was read`);
  }
});

test("no sign-in is a 401 and nothing is read", async () => {
  const { r, db } = await call(null);
  assert.equal(r.code, 401);
  assert.equal(r.body.tests, undefined);
  assert.equal(db.asked.length, 0);
});

test("a session with no company is a 403, never a read across every company", async () => {
  for (const org_id of [null, undefined, "", "not-a-uuid"]) {
    const { r, db } = await call({ id: "s1", role: "owner", org_id });
    assert.equal(r.code, 403, String(org_id));
    assert.equal(db.asked.length, 0);
  }
});

test("only GET: every other method is a 405 that names GET, before anything else happens", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const { r, db } = await call({ id: "s1", role: "owner", org_id: ORG }, { method });
    assert.equal(r.code, 405, method);
    assert.equal(r.headers.Allow, "GET");
    assert.equal(db.asked.length, 0);
  }
});

test("the company is the session's: the one read is for that company and no other", async () => {
  const seen = [];
  const db = fakeDb((sql, params) => { seen.push(params); return { rows: [] }; });
  await call({ id: "s1", role: "owner", org_id: ORG }, { db });
  assert.equal(seen[0][0], ORG);
});

test("a database that is down is a 503 with db down; any other fault is thrown, not hidden", async () => {
  const down = fakeDb(() => { throw Object.assign(new Error("Connection terminated unexpectedly"), { code: "08006" }); });
  const { r } = await call({ id: "s1", role: "owner", org_id: ORG }, { db: down });
  assert.equal(r.code, 503);
  assert.equal(r.body.db, "down");

  const broken = fakeDb(() => { throw new Error("column x does not exist"); });
  const r2 = res();
  await assert.rejects(
    handler({ method: "GET", headers: {}, query: {} }, r2,
      { db: broken, requireAuth: signedInAs({ id: "s1", role: "owner", org_id: ORG }), now: () => NOW }),
    /column x does not exist/);
  assert.equal(r2.code, null, "no answer was written for our own bug");
});
