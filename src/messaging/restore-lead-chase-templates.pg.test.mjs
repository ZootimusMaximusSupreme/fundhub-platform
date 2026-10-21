// db/seed/299_restore_lead_chase_templates_2026_10_20.sql against real Postgres.
//
// A fresh database built by db/migrate.mjs already holds the seven new-lead messages, written by the original
// seeds (011, 013, 015, 295). So each test opens ONE transaction, deletes the rows the way the 2026-10-11/12
// test run did on live, runs the restore file, compares, and rolls back. Nothing is left behind and no other
// test sees the delete (it is never committed).
//
// Never point this at production (CLAUDE.md section 12): it is scratch-only like every .pg.test.mjs.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../db.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RESTORE = fs.readFileSync(path.join(ROOT, "db/seed/299_restore_lead_chase_templates_2026_10_20.sql"), "utf8");
const KEYS = [
  "EMAIL-NOBOOK-01", "EMAIL-NOBOOK-02", "EMAIL-NOBOOK-03", "EMAIL-S02-FINISH-APPLICATION",
  "SMS-NOBOOK-01", "SMS-NOBOOK-02", "SMS-NOBOOK-03"
];

const ROWS_SQL = `SELECT t.template_key, t.channel, t.subject, t.body, t.compliance_passed, t.approved_by
  FROM message_templates t
 WHERE t.org_id = $1 AND t.template_key = ANY($2::text[])
 ORDER BY t.template_key`;

async function inRolledBackTx(fn) {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

const fundhubOrg = async (c) => {
  const r = await c.query("SELECT id FROM orgs WHERE slug = 'fundhub'");
  assert.equal(r.rows.length, 1, "the scratch database has no fundhub company");
  return r.rows[0].id;
};

describe("seed 299 restores the seven new-lead messages", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  after(close);

  test("FAIL then PASS: the rows are gone after the delete, and every byte is back after the restore", async () => {
    await inRolledBackTx(async (c) => {
      const org = await fundhubOrg(c);
      const seeded = (await c.query(ROWS_SQL, [org, KEYS])).rows;
      assert.deepEqual(seeded.map((r) => r.template_key), KEYS, "the original seeds did not write all seven");

      await c.query("DELETE FROM message_templates WHERE org_id = $1 AND template_key = ANY($2::text[])", [org, KEYS]);
      assert.equal((await c.query(ROWS_SQL, [org, KEYS])).rows.length, 0);

      await c.query(RESTORE);
      const back = (await c.query(ROWS_SQL, [org, KEYS])).rows;
      assert.deepEqual(back, seeded, "the restored words are not the words the original seeds wrote");
    });
  });

  test("safe to run again: a second run adds nothing, and a row a person edited is left alone", async () => {
    await inRolledBackTx(async (c) => {
      const org = await fundhubOrg(c);
      await c.query(
        "UPDATE message_templates SET body = 'Edited by a person' WHERE org_id = $1 AND template_key = 'SMS-NOBOOK-02'", [org]);
      await c.query("DELETE FROM message_templates WHERE org_id = $1 AND template_key = 'EMAIL-NOBOOK-03'", [org]);

      await c.query(RESTORE);
      await c.query(RESTORE);

      const rows = (await c.query(ROWS_SQL, [org, KEYS])).rows;
      assert.deepEqual(rows.map((r) => r.template_key), KEYS);
      assert.equal(rows.find((r) => r.template_key === "SMS-NOBOOK-02").body, "Edited by a person");
      const n = await c.query(
        "SELECT count(*)::int AS n FROM message_templates WHERE org_id = $1 AND template_key = ANY($2::text[])", [org, KEYS]);
      assert.equal(n.rows[0].n, 7);
    });
  });

  test("only the Fundhub company is written", async () => {
    await inRolledBackTx(async (c) => {
      const org = await fundhubOrg(c);
      const other = (await c.query(
        "INSERT INTO orgs (slug, name) VALUES ('restore-299-other-co', 'Other Co') RETURNING id")).rows[0].id;
      await c.query("DELETE FROM message_templates WHERE org_id = $1 AND template_key = ANY($2::text[])", [org, KEYS]);

      await c.query(RESTORE);

      assert.equal((await c.query(ROWS_SQL, [other, KEYS])).rows.length, 0, "the restore wrote rows for another company");
      assert.equal((await c.query(ROWS_SQL, [org, KEYS])).rows.length, 7);
    });
  });
});
