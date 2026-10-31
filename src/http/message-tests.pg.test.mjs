/* GET /api/read/message-tests against a real Postgres, through the real front door.
 *
 * WHY THROUGH THE FRONT DOOR. A handler file is not a route (CLAUDE.md §12): netlify/functions/api.mjs holds
 * a hand-written ROUTES map, and a handler missing from it answers 404 on the deploy target. Calling the
 * front door proves the "read/message-tests" entry as well as the handler. The handler is also called
 * directly, with a fixed clock, for the answer's content.
 *
 * Lives under src/http/ because npm test globs src/** and scripts/** only (CLAUDE.md §12); it imports
 * the api/ handler.
 *
 * Every row is built by the test, in companies of its own, and removed after. Nothing is sent.
 * SKIPS unless DATABASE_URL is a loopback scratch or CI database. A skip is not a pass.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/read/message-tests.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

const HAS_DB = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SLUGS = ["ab-http-pg-main", "ab-http-pg-other"];
const NONCE = `${process.pid}-${Date.now()}`;
const NOW = new Date("2026-11-20T18:00:00Z");
const S = new Date("2026-11-10T16:00:00Z");
const H = 3600 * 1000;

let front;
let orgId;
let otherOrgId;
const token = {};
let seq = 0;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(tok, { method = "GET" } = {}) {
  const r = res();
  await handler({ method, headers: tok ? { authorization: `Bearer ${tok}` } : {}, query: {} }, r, { db, now: () => NOW });
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}

const door = (tok, method = "GET") => front(
  new Request("https://fundhub.test/api/read/message-tests", { method, headers: tok ? { authorization: `Bearer ${tok}` } : {} }), {});

async function staff(org, role, tag) {
  const id = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
    [org, `${tag}.${NONCE}@sample-leads.com`, `Message tests ${tag}`, role]
  )).rows[0].id;
  return (await createSession(db, { staffId: id, orgId: org })).token;
}

async function person(org, tag, key, when, goalAt) {
  seq += 1;
  const id = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name) VALUES ($1,$2,'Rae','Sample') RETURNING id`,
    [org, `${tag}.${NONCE}.${seq}@sample-leads.com`]
  )).rows[0].id;
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, to_address, created_at)
     VALUES ($1,$2,'outbound','sms',$3,'private words that must never leave the door','internal',$4,'sent','+15550001111',$5)`,
    [org, id, key, `ref-${NONCE}-${seq}`, when]
  );
  if (goalAt) await db.query(`INSERT INTO events (org_id, name, client_id, payload, created_at) VALUES ($1,'booking.created',$2,'{}',$3)`, [org, id, goalAt]);
  return id;
}

async function purge() {
  if (!HAS_DB) return;
  const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [SLUGS])).rows.map((r) => r.id);
  if (orgs.length) {
    await db.query(`DELETE FROM messages WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM events WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM clients WHERE org_id = ANY($1)`, [orgs]);
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE org_id = ANY($1))`, [orgs]);
    await db.query(`DELETE FROM staff WHERE org_id = ANY($1)`, [orgs]);
  }
  await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [SLUGS]);
}

before(async () => {
  if (!HAS_DB) return;
  ({ default: front } = await import("../../netlify/functions/api.mjs"));
  await purge();
  orgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'AB Http Main') RETURNING id`, [SLUGS[0]])).rows[0].id;
  otherOrgId = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1,'AB Http Other') RETURNING id`, [SLUGS[1]])).rows[0].id;
  token.owner = await staff(orgId, "owner", "owner");
  token.admin = await staff(orgId, "admin", "admin");
  token.setter = await staff(orgId, "setter", "setter");
  token.closer = await staff(orgId, "closer", "closer");
  token.csm = await staff(orgId, "csm", "csm");
  token.otherOwner = await staff(otherOrgId, "owner", "otherowner");

  // Main company: the never-booked test has started (a B message at S) with two people on each side.
  await person(orgId, "b1", "SMS-NOBOOK-02-B", new Date(S.getTime()), new Date(S.getTime() + 24 * H));
  await person(orgId, "b2", "SMS-NOBOOK-02-B", new Date(S.getTime() + H), null);
  await person(orgId, "a1", "SMS-NOBOOK-02", new Date(S.getTime() + 2 * H), null);
  await person(orgId, "a2", "SMS-NOBOOK-02", new Date(S.getTime() + 3 * H), new Date(S.getTime() + 48 * H));
  // The other company has one person of its own.
  await person(otherOrgId, "o1", "SMS-NOBOOK-02", new Date(S.getTime() + H), null);
});

after(async () => {
  if (!HAS_DB) return;
  await purge();
  await close();
});

test("the route is live: an owner gets a 200 from the real front door", { skip: !HAS_DB }, async () => {
  const r = await door(token.owner);
  assert.notEqual(r.status, 404, "read/message-tests is missing from the ROUTES map in netlify/functions/api.mjs");
  assert.equal(r.status, 200);
  const body = JSON.parse(await r.text());
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.tests));
});

test("it returns every test, with the counts, the words and the clock", { skip: !HAS_DB }, async () => {
  const r = await call(token.owner);
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.as_of, NOW.toISOString());
  assert.deepEqual(r.body.tests.map((t) => t.name), ["resume-proof", "nobook-proof"]);

  const nobook = r.body.tests[1];
  assert.equal(nobook.label, "Never-booked chase, message 2: real proof or not");
  assert.equal(nobook.goal, "booking.created");
  assert.equal(nobook.min_per_arm, 30);
  assert.equal(nobook.started_at, S.toISOString());
  assert.deepEqual(nobook.arms.A, { people: 2, reached: 1, waiting: 0 });
  assert.deepEqual(nobook.arms.B, { people: 2, reached: 1, waiting: 0 });
  assert.equal(nobook.verdict.winner, null);
  assert.equal(nobook.verdict.text, "A and B are even so far: 1 of 2 booked (50%) vs 1 of 2 (50%). Not enough people yet to call it.");

  const resume = r.body.tests[0];
  assert.deepEqual(resume.arms.A, { people: 0, reached: 0, waiting: 0 });
  assert.equal(resume.started_at, null);
});

test("owner and admin may read it; every other staff role is turned away with a 403", { skip: !HAS_DB }, async () => {
  assert.equal((await call(token.admin)).code, 200);
  for (const role of ["setter", "closer", "csm"]) {
    const r = await call(token[role]);
    assert.equal(r.code, 403, role);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.tests, undefined, `${role} learns nothing`);
    assert.equal((await door(token[role])).status, 403, `${role} through the front door`);
  }
});

test("no sign-in is a 401, and it reads nothing", { skip: !HAS_DB }, async () => {
  const r = await call(null);
  assert.equal(r.code, 401);
  assert.equal(r.body.tests, undefined);
  assert.equal((await door(null)).status, 401);
  assert.equal((await door("not-a-real-token")).status, 401);
});

test("GET only: any other method is a 405 that names the one it takes", { skip: !HAS_DB }, async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = await call(token.owner, { method });
    assert.equal(r.code, 405, method);
    assert.equal(r.headers.Allow, "GET");
  }
});

test("a company sees only its own people", { skip: !HAS_DB }, async () => {
  const other = (await call(token.otherOwner)).body.tests[1];
  assert.equal(other.started_at, null, "no B message in that company");
  assert.equal(other.earlier_people, 1, "its one person got version A before any B");
  assert.deepEqual(other.arms.A, { people: 0, reached: 0, waiting: 0 });
});

test("the answer holds counts and sentences only: no name, no address, no message words", { skip: !HAS_DB }, async () => {
  const text = (await (await door(token.owner)).text());
  assert.ok(!text.includes("private words"), "message text must not leave");
  assert.ok(!text.includes("sample-leads.com"), "an address must not leave");
  assert.ok(!text.includes("Rae"), "a name must not leave");
  assert.ok(!text.includes("+1555"), "a phone number must not leave");
});

test("a database that does not answer is a 503 with db down, not a lie about our code", { skip: !HAS_DB }, async () => {
  const dead = { query: async () => { throw Object.assign(new Error("Connection terminated unexpectedly"), { code: "08006" }); } };
  const r = res();
  // Auth runs on the live pool (the token is real); only the report read is cut off.
  await handler({ method: "GET", headers: { authorization: `Bearer ${token.owner}` }, query: {} }, r,
    { db: new Proxy(db, { get: (t, k) => (k === "query" ? (sql, p) => (/message-tests:report/.test(sql) ? dead.query() : t.query(sql, p)) : t[k]) }), now: () => NOW });
  assert.equal(r.code, 503);
  assert.equal(r.body.db, "down");
});
