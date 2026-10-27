// Postgres-backed tests for GET /api/read/inquiries.
// Skipped without DATABASE_URL, like the other *.pg.test.mjs files.
//
// The endpoint is thin — readHandler supplies auth, paging and redaction, and
// read-api.test.mjs covers those. What is NOT covered there is this file's own
// SQL: the join that turns a client_id into a name, and the three filters. Those
// are what these tests pin.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import handler from "../../api/read/inquiries.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

/* The endpoint imports the real requireAuth, so these drive it through the
   module's default export with a session minted for a real staff row. */
async function call(query, token) {
  const r = res();
  await handler({ method: "GET", query, headers: { authorization: "Bearer " + token } }, r);
  return r;
}

describe("GET /api/read/inquiries", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, clientA, clientB, token;
  const MARK = "inqtest";

  before(async () => {
    org = await resolveDefaultOrg(db);
    const { createSession } = await import("../auth/session.mjs");
    const s = await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND status = 'active'
         AND role IN ('owner','admin','inquiry_specialist','funding_advisor')
       ORDER BY (role = 'owner') DESC, created_at LIMIT 1`, [org]);
    if (!s.rows[0]) throw new Error("no active specialist-desk staff — run scripts/seed-staff.mjs");
    token = (await createSession(db, { staffId: s.rows[0].id, orgId: s.rows[0].org_id })).token;

    const mk = async (fn, ln) => (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [org, fn, ln, `${fn}.${ln}.${MARK}@example.com`.toLowerCase()])).rows[0].id;

    clientA = await mk("Inqtest", "Alpha");
    clientB = await mk("Inqtest", "Bravo");

    await db.query(
      `INSERT INTO inquiry_log (org_id, client_id, bureau, inquiry, status, call_attempts, outcome)
       VALUES ($1,$2,'Equifax','Synchrony ${MARK}','Confirmed · Removed',2,'removed'),
              ($1,$2,'TransUnion','Barclays ${MARK}','New',0,NULL),
              ($1,$3,'Equifax','Discover ${MARK}','Filed',1,NULL)`,
      [org, clientA, clientB]);
  });

  after(async () => {
    await db.query(`DELETE FROM inquiry_log WHERE client_id = ANY($1)`, [[clientA, clientB]]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [[clientA, clientB]]);
    await close();
  });

  const mine = (body) => body.items.filter((i) => String(i.inquiry || "").includes(MARK));

  test("returns the queue with a joined client_name", async () => {
    const r = await call({ limit: "200" }, token);
    assert.equal(r.code, 200);
    const rows = mine(r.body);
    assert.equal(rows.length, 3);
    // The join is the point: a screen shows a person, not a uuid.
    for (const row of rows) {
      assert.match(row.client_name, /^Inqtest (Alpha|Bravo)$/,
        `client_name did not resolve: ${JSON.stringify(row.client_name)}`);
    }
  });

  test("every column the screen renders is present", async () => {
    const r = await call({ limit: "200" }, token);
    const row = mine(r.body)[0];
    for (const k of ["id", "client_id", "bureau", "inquiry", "status",
                     "call_attempts", "outcome", "client_name"]) {
      assert.ok(k in row, `column ${k} missing — the screen renders it`);
    }
  });

  test("?client_id= scopes to one client", async () => {
    const r = await call({ client_id: clientB, limit: "200" }, token);
    assert.equal(r.code, 200);
    const rows = mine(r.body);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].client_name, "Inqtest Bravo");
  });

  test("?bureau= filters, and does not silently match everything", async () => {
    const eq = mine((await call({ bureau: "Equifax", limit: "200" }, token)).body);
    assert.equal(eq.length, 2);
    assert.ok(eq.every((i) => i.bureau === "Equifax"));

    const none = mine((await call({ bureau: "Experian", limit: "200" }, token)).body);
    assert.equal(none.length, 0, "an unmatched bureau returned rows");
  });

  test("?status= filters on the exact stored string", async () => {
    const r = await call({ status: "New", limit: "200" }, token);
    assert.equal(mine(r.body).length, 1);
  });

  test("call_attempts survives as a number the screen can add up", async () => {
    const r = await call({ limit: "200" }, token);
    const total = mine(r.body).reduce((a, i) => a + Number(i.call_attempts), 0);
    assert.equal(total, 3, "call_attempts did not round-trip as a number");
  });

  test("a malformed client_id is a 400, not a 500", async () => {
    const r = await call({ client_id: "zzz" }, token);
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "invalid_parameter");
  });

  test("no session is a 401, and returns no rows", async () => {
    const r = res();
    await handler({ method: "GET", query: {}, headers: {} }, r);
    assert.equal(r.code, 401);
    assert.equal(r.body.items, undefined);
  });
});
