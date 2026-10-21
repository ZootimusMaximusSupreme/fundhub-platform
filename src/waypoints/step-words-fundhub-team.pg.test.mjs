// 498 against the real migrated table shapes: it rewrites the client checklist
// copy from "your advisor" to "our team" (owner-set 2026-10-20: Capital
// Blueprint has no named human advisor) ONLY on rows that still hold the exact
// old text, on the catalog and on each client's stored step, and leaves owner
// edits, other keys and every other column alone. A replay changes nothing.
//
// Runs the exact migration file against TEMP copies of waypoint_definitions and
// client_waypoints inside a transaction that is always rolled back. Local named
// scratch/test databases only; a live database is refused. Skips otherwise
// (CLAUDE.md §12: a skipped pg test is not a green one — CI runs it).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { newAccountReason } from "./verify.mjs";

const sql498 = readFileSync(new URL("../../db/migrations/498_waypoint_steps_fundhub_team.sql", import.meta.url), "utf8");
const pairs = [...sql498.matchAll(
  /UPDATE waypoint_definitions\s+SET (title|detail) = \$new\$(.*?)\$new\$\s+WHERE key = '([a-z_]+)'\s+AND \1 = \$old\$(.*?)\$old\$;/gs
)].map((m) => ({ field: m[1], next: m[2], key: m[3], old: m[4] }));
const get = (key, field) => pairs.find((p) => p.key === key && p.field === field);
const LOAN_TITLE = get("personal_loan", "title");
const LOAN_DETAIL = get("personal_loan", "detail");
const CREDIT_DETAIL = get("no_new_credit", "detail");

const connectionString = process.env.WAYPOINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no local scratch database */ }
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });
const options = { skip: safe ? false : "no local test/scratch database; live databases refused" };

async function scratch(fn) {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    for (const table of ["waypoint_definitions", "client_waypoints"]) {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    // The real catalog, put back to the exact 362 words.
    await db.query(`INSERT INTO waypoint_definitions SELECT * FROM public.waypoint_definitions`);
    await db.query(`UPDATE waypoint_definitions SET title=$1, detail=$2 WHERE key='personal_loan'`, [LOAN_TITLE.old, LOAN_DETAIL.old]);
    await db.query(`UPDATE waypoint_definitions SET detail=$1 WHERE key='no_new_credit'`, [CREDIT_DETAIL.old]);
    await fn(db);
  } finally { await db.query("ROLLBACK"); db.release(); }
}

async function addStep(db, { key, title, detail = null, state = "not_started", reason = null }) {
  const id = (await db.query(
    `INSERT INTO client_waypoints (org_id, client_id, key, title, detail, owner_kind, state, state_reason)
     VALUES ($1,$2,$3,$4,$5,'client',$6,$7) RETURNING id`,
    [randomUUID(), randomUUID(), key, title, detail, state, reason]
  )).rows[0].id;
  return id;
}
const row = (db, id) => db.query("SELECT * FROM client_waypoints WHERE id=$1", [id]).then((r) => r.rows[0]);
const def = (db, key) => db.query("SELECT * FROM waypoint_definitions WHERE key=$1", [key]).then((r) => r.rows[0]);

test("498 moves exact-old catalog and client steps to our-team words, and a replay is a no-op", options, async () => {
  await scratch(async (db) => {
    const before = await def(db, "paydown_revolving_account");
    const loan = await addStep(db, { key: "personal_loan", title: LOAN_TITLE.old, detail: LOAN_DETAIL.old });
    const rule = await addStep(db, {
      key: "no_new_credit", title: "Do not open new credit while we work on your file", detail: CREDIT_DETAIL.old,
      state: "blocked",
      reason: newAccountReason([{ creditor: "Brand New Bank Card" }]).replace("Let our team know", "Let your advisor know")
    });
    const many = await addStep(db, {
      key: "no_new_credit_x", title: "x", state: "blocked",
      reason: newAccountReason([{ creditor: "A" }, { creditor: "B" }]).replace("Let our team know", "Let your advisor know")
    });

    await db.query(sql498);

    assert.equal((await def(db, "personal_loan")).title, LOAN_TITLE.next);
    assert.equal((await def(db, "personal_loan")).detail, LOAN_DETAIL.next);
    assert.equal((await def(db, "no_new_credit")).detail, CREDIT_DETAIL.next);
    assert.deepEqual(await def(db, "paydown_revolving_account"), before, "another key is untouched");

    const l = await row(db, loan);
    assert.equal(l.title, LOAN_TITLE.next);
    assert.equal(l.detail, LOAN_DETAIL.next);
    const r = await row(db, rule);
    assert.equal(r.detail, CREDIT_DETAIL.next);
    assert.equal(r.state, "blocked", "state is untouched");
    assert.equal(r.state_reason, newAccountReason([{ creditor: "Brand New Bank Card" }]), "reason now reads exactly as the code writes it");
    assert.match((await row(db, many)).state_reason, /Let your advisor know/, "the reason rewrite is scoped to the no_new_credit key");

    // No client-facing catalog title or detail says advisor any more.
    const left = (await db.query(
      `SELECT key FROM waypoint_definitions WHERE title ~* 'advisor' OR coalesce(detail,'') ~* 'advisor'`
    )).rows;
    assert.deepEqual(left, []);

    const snapshot = (await db.query("SELECT * FROM client_waypoints ORDER BY id")).rows;
    await db.query(sql498);
    assert.deepEqual((await db.query("SELECT * FROM client_waypoints ORDER BY id")).rows, snapshot, "a replay changes nothing");
  });
});

test("498 leaves owner-edited copy exactly as the owner saved it", options, async () => {
  await scratch(async (db) => {
    await db.query(`UPDATE waypoint_definitions SET title='Ask us about a personal loan' WHERE key='personal_loan'`);
    const edited = await addStep(db, {
      key: "personal_loan", title: "Ask us about a personal loan", detail: "Owner wrote this. Your advisor is Chris."
    });
    const editedReason = await addStep(db, {
      key: "no_new_credit", title: "Do not open new credit", state: "blocked",
      reason: "Owner note: Let your advisor know if this is not yours."
    });

    await db.query(sql498);

    const d = await def(db, "personal_loan");
    assert.equal(d.title, "Ask us about a personal loan", "edited title kept");
    assert.equal(d.detail, LOAN_DETAIL.next, "the untouched detail on the same row is still fixed");
    const e = await row(db, edited);
    assert.equal(e.title, "Ask us about a personal loan");
    assert.equal(e.detail, "Owner wrote this. Your advisor is Chris.");
    assert.equal((await row(db, editedReason)).state_reason, "Owner note: Let your advisor know if this is not yours.");
  });
});
