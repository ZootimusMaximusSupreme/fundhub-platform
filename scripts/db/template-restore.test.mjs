// Migration 497 restores missing Fundhub templates, insert-only, with repo seed copy only.
// No database needed. The scratch-Postgres half is template-restore.pg.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIGRATION, RESTORE_KEYS, buildRestoreSql, insertOnlyProblems, parseRestoreRows,
  seedTextPieces, sqlStatements, templateWriteStatements
} from "./template-restore.mjs";
import { isInactiveTemplateRow } from "../../src/pulse/catalog/proofs/flow-gap-cases.mjs";
import { buildSqlTemplateSnapshot } from "../../src/pulse/catalog/proofs/fin-b22-sql-template-snapshot.mjs";
import { EXPECTED_MIGRATIONS } from "../../db/expected-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL = fs.readFileSync(path.join(ROOT, MIGRATION), "utf8");
const ROWS = parseRestoreRows(SQL);
const NAMED = ["EMAIL-S00-WELCOME", "EMAIL-S04-01-CONFIRM", "CONTRACT-SEND-EMAIL", "SMS-S00-WELCOME", "SMS-DOC-01-REQUEST"];

test("splitter keeps quoted text, $tag$ bodies and DO blocks whole", () => {
  const sql = "-- a; comment\nINSERT INTO message_templates VALUES ('it''s; fine', $h$<a style='x;y'>$h$);\n" +
    "/* b; */ DO $$ BEGIN UPDATE message_templates SET body = 'a;b'; END $$;\nSELECT 1";
  const out = sqlStatements(sql);
  assert.equal(out.length, 3);
  assert.match(out[0], /it''s; fine/);
  assert.match(out[0], /x;y/);
  assert.match(out[1], /^DO \$\$ BEGIN UPDATE message_templates SET body = 'a;b'; END \$\$;$/);
});

test("the restore list: 125 unique keys, the five keys the pulse names, no inactive key", () => {
  assert.equal(RESTORE_KEYS.length, 125);
  assert.equal(new Set(RESTORE_KEYS).size, 125);
  for (const key of NAMED) assert.ok(RESTORE_KEYS.includes(key), key);
  const messages = JSON.parse(fs.readFileSync(path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/messages.json"), "utf8"));
  const inactive = messages.filter(isInactiveTemplateRow).map((row) => row.surface.slice("template:".length));
  assert.ok(inactive.length > 0);
  for (const key of inactive) assert.ok(!RESTORE_KEYS.includes(key), `${key} is inactive and must not be restored`);
});

test("every restore key is written by the repo's own SQL", () => {
  const written = new Set();
  for (const { sql } of templateWriteStatements(ROOT)) {
    for (const key of RESTORE_KEYS) if (sql.includes(`'${key}'`)) written.add(key);
  }
  assert.deepEqual(RESTORE_KEYS.filter((key) => !written.has(key)), []);
});

test("PASS: 497 is one insert-only statement for org fundhub with exactly the restore keys", () => {
  assert.deepEqual(insertOnlyProblems(SQL), []);
  assert.deepEqual(ROWS.map((r) => r.template_key), [...RESTORE_KEYS].sort());
  assert.equal(buildRestoreSql(ROWS), SQL, "497 must be exactly what the generator writes for these rows");
  assert.ok(EXPECTED_MIGRATIONS.includes("migrations/497_restore_missing_sql_templates.sql"));
});

test("FAIL: an overwrite, a delete, an extra key or a missing org filter is caught", () => {
  const variants = {
    overwrite: SQL.replace(/DO NOTHING;\s*$/, "DO UPDATE SET body = EXCLUDED.body;\n"),
    deletes: `${SQL}\nDELETE FROM message_templates WHERE template_key = 'SMS-S00-WELCOME';\n`,
    extraKey: buildRestoreSql([...ROWS, { ...ROWS[0], template_key: "EMAIL-INVENTED" }]),
    droppedKey: buildRestoreSql(ROWS.filter((r) => r.template_key !== "SMS-S00-WELCOME")),
    everyOrg: SQL.replace(" WHERE o.slug = 'fundhub'\n", "\n"),
    draft: buildRestoreSql(ROWS.map((r, i) => (i === 0 ? { ...r, body: "[DRAFT — NO SOURCE COPY]" } : r))),
  };
  for (const [name, sql] of Object.entries(variants)) {
    assert.notDeepEqual(insertOnlyProblems(sql), [], `${name} must be caught`);
  }
});

test("every restored subject and body is text a repo seed spells out (nothing invented)", async () => {
  const pieces = await seedTextPieces(ROOT);
  const invented = ROWS.filter((r) => !pieces.has(r.body) || (r.subject !== null && !pieces.has(r.subject)));
  assert.deepEqual(invented.map((r) => r.template_key), []);
  // and the check can go red
  assert.ok(!pieces.has(`${ROWS[0].body} (edited)`));
});

test("the named keys carry the seeded channel and approval", () => {
  const by = Object.fromEntries(ROWS.map((r) => [r.template_key, r]));
  for (const key of NAMED) {
    assert.equal(by[key].channel, key.startsWith("SMS-") ? "sms" : "email", key);
    assert.equal(by[key].compliance_passed, true, key);
    if (by[key].channel === "email") assert.ok(by[key].subject, key);
    else assert.equal(by[key].subject, null, key);
  }
  assert.equal(by.payment_link_notice.compliance_passed, false, "seeded unapproved, restored unapproved");
});

test("497 does not change the pulse's list of SQL-only templates", () => {
  const saved = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/proofs/fin-b22-sql-template-keys.json"), "utf8"));
  const rebuilt = buildSqlTemplateSnapshot(ROOT);
  assert.ok(!JSON.stringify(rebuilt).includes("497_restore_missing_sql_templates"));
  assert.deepEqual(rebuilt, saved);
});
