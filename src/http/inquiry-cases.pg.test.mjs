// Postgres-backed tests for POST /api/inquiry-cases.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**" and "scripts/**"; a test placed in api/ is never collected
// and passes forever by never running (CLAUDE.md §12). The handler is imported
// from here instead.
//
// WHY IT EXISTS. The `clear_inquiry` action called the event bus with the wrong
// number of arguments:
//
//     emitFn("inquiry.removed", { ... })        // wrong
//     emit(db, name, payload, opts)             // the real signature
//
// so the event NAME landed in the `db` slot and src/events/bus.mjs threw
// "event name required". That throw became a 500 — but only AFTER clearInquiry
// had already committed. The inquiry was cleared in the database, the event was
// lost, and the specialist was shown a failure. A partial write with no event is
// the worst shape a write path can have, and nothing tested it.
//
// These tests assert against STORED ROWS, not response shapes: "the event fired"
// is a fact about the events table, not about a JSON body.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs. Run it against a
// scratch database, never production:
//   DATABASE_URL="postgres://…/fundhub_t4" node --test src/http/inquiry-cases.pg.test.mjs

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const EMAIL = "inquiry_cases_pg_test@example.com";
const STAFF_EMAIL = "inquiry_cases_pg_staff@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("POST /api/inquiry-cases", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, orgId, staffId, token, clientId;

  const post = async (body) => {
    const r = res();
    await handler(
      { method: "POST", body, headers: { authorization: "Bearer " + token } },
      r
    );
    return r;
  };

  // Client-only cleanup. Deliberately does NOT touch staff or sessions: each test
  // calls this to start from a clean client, and wiping the staff row here would
  // delete the session created in before() and every request would 401.
  async function wipeClient() {
    await db.query(
      `DELETE FROM events WHERE client_id IN (SELECT id FROM clients WHERE email = $1)`, [EMAIL]);
    await db.query(`DELETE FROM clients WHERE email = $1`, [EMAIL]);
  }

  async function wipeAll() {
    await wipeClient();
    await db.query(
      `DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email = $1)`, [STAFF_EMAIL]);
    await db.query(`DELETE FROM staff WHERE email = $1`, [STAFF_EMAIL]);
  }

  before(async () => {
    ({ default: handler } = await import("../../api/inquiry-cases.mjs"));
    await wipeAll();
    orgId = (await db.query(`SELECT id FROM orgs ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    assert.ok(orgId, "an org must exist — run the seed");

    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'PG Specialist','inquiry_specialist',$2,'active') RETURNING id`,
      [orgId, STAFF_EMAIL]
    )).rows[0].id;
    ({ token } = await createSession(db, { staffId, orgId }));
  });

  after(async () => {
    await wipeAll();
    await close();
  });

  // Builds a case with exactly one open inquiry linked to it.
  async function buildCase() {
    clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,'Clear','Path') RETURNING id`, [orgId, EMAIL]
    )).rows[0].id;
    const caseRow = (await db.query(
      `INSERT INTO inquiry_removal_cases (org_id, client_id, case_id, case_status, open_inquiry_count)
       VALUES ($1,$2,$3,'Queued',1) RETURNING *`,
      [orgId, clientId, `IRC-HTTP-${Date.now()}`]
    )).rows[0];
    const inquiry = (await db.query(
      `INSERT INTO inquiry_log (org_id, client_id, case_id, bureau, inquiry, status, is_open)
       VALUES ($1,$2,$3,'Experian','Some Lender','Pending Removal',true) RETURNING *`,
      [orgId, clientId, caseRow.id]
    )).rows[0];
    return { caseRow, inquiry };
  }

  test("clear_inquiry answers 200 and really writes the inquiry.removed event", async () => {
    await wipeClient();
    const { caseRow, inquiry } = await buildCase();

    const r = await post({ action: "clear_inquiry", inquiry_id: inquiry.id });

    assert.equal(r.code, 200,
      "before the fix this was a 500 from the bus, thrown after the clear had committed");
    assert.equal(r.body.ok, true);
    assert.equal(r.body.case_cleared, true);

    const ev = await db.query(
      `SELECT name, payload FROM events
        WHERE name = 'inquiry.removed' AND client_id = $1`, [clientId]);
    assert.equal(ev.rows.length, 1, "exactly one inquiry.removed row was written");
    assert.equal(ev.rows[0].payload.source, "staff_clear_inquiry");
    assert.equal(ev.rows[0].payload.inquiryRemovalCaseId, caseRow.id,
      "the payload names the case row, so a listener can find it");
    assert.equal(ev.rows[0].payload.caseId, caseRow.case_id,
      "caseId is the human case reference, matching the mark_cleared payload");

    const after = (await db.query(
      `SELECT case_status::text AS case_status FROM inquiry_removal_cases WHERE id = $1`,
      [caseRow.id])).rows[0];
    assert.equal(after.case_status, "Completed");
  });

  test("mark_cleared cannot strand an open inquiry before funding handback", async () => {
    await wipeClient();
    const { caseRow, inquiry } = await buildCase();
    const refused = await post({ action: "mark_cleared", id: caseRow.id });
    assert.equal(refused.code, 409);
    assert.equal(refused.body.error, "inquiries_still_open");
    assert.equal((await db.query(`SELECT case_status::text AS status FROM inquiry_removal_cases WHERE id = $1`, [caseRow.id])).rows[0].status, "Queued");
    assert.equal((await db.query(`SELECT is_open FROM inquiry_log WHERE id = $1`, [inquiry.id])).rows[0].is_open, true);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM events WHERE client_id = $1 AND name = 'inquiry.removed'`, [clientId])).rows[0].n, 0);

    const cleared = await post({ action: "clear_inquiry", inquiry_id: inquiry.id });
    assert.equal(cleared.code, 200);
    assert.equal(cleared.body.case_cleared, true);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM events WHERE client_id = $1 AND name = 'inquiry.removed'`, [clientId])).rows[0].n, 1);
  });

  test("the write and the event agree — no partial write is left behind", async () => {
    await wipeClient();
    const { inquiry } = await buildCase();

    const r = await post({ action: "clear_inquiry", inquiry_id: inquiry.id });
    assert.equal(r.code, 200);

    const cleared = (await db.query(
      `SELECT is_open FROM inquiry_log WHERE id = $1`, [inquiry.id])).rows[0];
    const events = (await db.query(
      `SELECT COUNT(*)::int AS n FROM events WHERE name='inquiry.removed' AND client_id=$1`,
      [clientId])).rows[0];

    assert.equal(cleared.is_open, false, "the inquiry is closed");
    assert.equal(events.n, 1, "and the event exists — the two must never disagree");
  });

  test("a bad inquiry id is refused before anything is written", async () => {
    await wipeClient();
    const r = await post({ action: "clear_inquiry", inquiry_id: "not-a-uuid" });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "inquiry_id_required");
  });
});
