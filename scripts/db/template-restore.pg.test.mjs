// Migration 497 against a real Postgres. Local scratch database ONLY (127.0.0.1/localhost and a
// name with ci, test or scratch); anything else skips. Every test runs in one transaction that is
// always rolled back, so nothing is left behind even on a scratch database.
//
// The behaviour tests run 497's exact statement against a private org made inside the
// transaction (only the slug literal differs), so suites running at the same time on the shared
// scratch database cannot disturb the before/after comparison, and the real fundhub rows are
// never touched. template-restore.test.mjs proves the shipped file targets 'fundhub' only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, close } from "../../src/db.mjs";
import { isLocalScratchDatabaseUrl } from "../../src/verification/scratch-guard.mjs";
import { MIGRATION, ORG_SLUG, RESTORE_KEYS, insertOnlyProblems, parseRestoreRows, stageSeedRows } from "./template-restore.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRATCH = isLocalScratchDatabaseUrl(process.env.DATABASE_URL);
const SKIP = SCRATCH ? false : "local scratch database only; live databases refused";
const SQL = fs.readFileSync(path.join(ROOT, MIGRATION), "utf8");
const ROWS = parseRestoreRows(SQL);
const FIELDS = "template_key, channel, subject, body, compliance_passed";
const ORG_FILTER = ` WHERE o.slug = '${ORG_SLUG}'\n`;

after(async () => { if (SCRATCH) await close(); });

async function inRollback(fn) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
}

/** A private org and 497's statement aimed at it (the slug literal is the only difference). */
async function privateOrg(client, sql = SQL) {
  const slug = `tpl-restore-pg-${randomUUID()}`;
  const id = (await client.query(`INSERT INTO orgs (slug, name) VALUES ($1, 'Template Restore PG Test') RETURNING id`, [slug])).rows[0].id;
  assert.ok(sql.includes(ORG_FILTER));
  return { id, sql: sql.replace(ORG_FILTER, ` WHERE o.slug = '${slug}'\n`) };
}

/* Compare by key in code-point order on both sides. Postgres ORDER BY uses the
   database collation, which on CI sorts lowercase keys (payment_link_notice)
   among the uppercase ones; the generated 497 JSON uses code-point order. */
const byKey = (rows) => [...rows].sort((a, b) => (a.template_key < b.template_key ? -1 : a.template_key > b.template_key ? 1 : 0));

const snapshot = async (client, orgId) => (await client.query(
  `SELECT ctid::text AS ctid, ${FIELDS} FROM message_templates WHERE org_id = $1 ORDER BY template_key`, [orgId]
)).rows;

test("497 carries exactly the copy the repo's SQL seeds produce", { skip: SKIP }, async () => {
  await inRollback(async (client) => {
    const staged = await stageSeedRows(client, { root: ROOT });
    assert.equal(staged.length, RESTORE_KEYS.length);
    assert.deepEqual(byKey(ROWS), byKey(staged));
  });
});

/** Fill the private org, then lose two templates and hand-edit a third, as production did. */
async function setUp(client) {
  const org = await privateOrg(client);
  await client.query(org.sql);
  const first = (await client.query(`SELECT ${FIELDS} FROM message_templates WHERE org_id = $1 ORDER BY template_key`, [org.id])).rows;
  assert.deepEqual(byKey(first), byKey(ROWS), "decoded rows match 497's JSON exactly");
  const gone = ["SMS-S00-WELCOME", "CONTRACT-SEND-EMAIL"];
  const edited = "EMAIL-S00-WELCOME";
  await client.query(`DELETE FROM message_templates WHERE org_id = $1 AND template_key = ANY($2::text[])`, [org.id, gone]);
  await client.query(
    `UPDATE message_templates SET body = 'OWNER EDIT', compliance_passed = false WHERE org_id = $1 AND template_key = $2`,
    [org.id, edited]
  );
  await client.query(
    `INSERT INTO message_templates (org_id, template_key, channel, body) VALUES ($1, 'OWNER-ONLY-KEY', 'sms', 'kept')`,
    [org.id]
  );
  return { org, gone, edited };
}

test("PASS: 497 puts back only the missing keys and leaves every existing row alone", { skip: SKIP }, async () => {
  await inRollback(async (client) => {
    const { org, gone, edited } = await setUp(client);
    const before = await snapshot(client, org.id);
    await client.query(org.sql);
    const afterRows = await snapshot(client, org.id);
    const by = new Map(afterRows.map((r) => [r.template_key, r]));
    // the two lost templates are back, exactly as seeded
    for (const key of gone) {
      const { ctid, ...row } = by.get(key);
      assert.ok(ctid);
      assert.deepEqual(row, ROWS.find((r) => r.template_key === key));
    }
    // every row that existed is the same physical row (same ctid): not rewritten, not even a no-op update
    assert.deepEqual(afterRows.filter((r) => !gone.includes(r.template_key)), before);
    assert.equal(by.get(edited).body, "OWNER EDIT");
    assert.equal(by.get(edited).compliance_passed, false);
    assert.equal(by.get("OWNER-ONLY-KEY").body, "kept");
    assert.equal(afterRows.length, before.length + gone.length);
    // no other company's template was written by this transaction (xmin = this transaction's id)
    const elsewhere = (await client.query(
      `SELECT count(*)::int AS n FROM message_templates
        WHERE org_id <> $1 AND xmin::text = (txid_current() % 4294967296)::text`,
      [org.id]
    )).rows[0].n;
    assert.equal(elsewhere, 0);
    assert.deepEqual(insertOnlyProblems(SQL), []);
  });
});

test("FAIL: an overwrite version of 497 would erase the owner's edit, and the checker refuses it", { skip: SKIP }, async () => {
  const overwrite = SQL.replace(/DO NOTHING;\s*$/,
    "DO UPDATE SET body = EXCLUDED.body, compliance_passed = EXCLUDED.compliance_passed;\n");
  assert.notEqual(overwrite, SQL);
  assert.notDeepEqual(insertOnlyProblems(overwrite), []);
  await inRollback(async (client) => {
    const { org, edited } = await setUp(client);
    const before = await snapshot(client, org.id);
    await client.query(org.sql.replace(/DO NOTHING;\s*$/,
      "DO UPDATE SET body = EXCLUDED.body, compliance_passed = EXCLUDED.compliance_passed;\n"));
    const afterRows = await snapshot(client, org.id);
    const row = afterRows.find((r) => r.template_key === edited);
    assert.notEqual(row.body, "OWNER EDIT", "the overwrite version clobbers an edit, which is why 497 must not be one");
    assert.notDeepEqual(afterRows.filter((r) => before.some((b) => b.template_key === r.template_key)), before,
      "the PASS test's same-row check goes red on a rewrite");
  });
});
