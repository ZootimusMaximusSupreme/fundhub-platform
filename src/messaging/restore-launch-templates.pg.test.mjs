// db/seed/298_restore_launch_templates_2026_10_20.sql against real Postgres.
//
// A fresh database built by db/migrate.mjs already holds the five launch messages, written by the
// original seeds (008, 012, 013, 016, 295). So each test opens ONE transaction, deletes the rows the way
// the 2026-10-11/12 test run did on live, runs the restore file, compares, and rolls back. Nothing is
// left behind and no other test sees the delete (it is never committed).
//
// Never point this at production (CLAUDE.md section 12): it is scratch-only like every .pg.test.mjs.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../db.mjs";
import { EMAIL_PATH, TEXT_PATH, TEMPLATE_SQL, judgeTemplates } from "../pulse/beats/lib/send-path.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RESTORE = fs.readFileSync(path.join(ROOT, "db/seed/298_restore_launch_templates_2026_10_20.sql"), "utf8");
const KEYS = ["CONTRACT-SEND-EMAIL", "EMAIL-S00-WELCOME", "EMAIL-S04-01-CONFIRM", "SMS-DOC-01-REQUEST", "SMS-S00-WELCOME"];

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

/* The pulse's own read and judge (beats email-path and text-path, step template-ready), kept to the five
   keys this file restores so a launch row this file does not own cannot turn the result. */
const pulseProblems = async (c) => {
  const email = await c.query(TEMPLATE_SQL, [EMAIL_PATH.channel, [...EMAIL_PATH.templates]]);
  const sms = await c.query(TEMPLATE_SQL, [TEXT_PATH.channel, [...TEXT_PATH.templates]]);
  return [
    ...judgeTemplates({ rows: email.rows, path: EMAIL_PATH }).problems,
    ...judgeTemplates({ rows: sms.rows, path: TEXT_PATH }).problems
  ].filter((p) => KEYS.some((k) => p.startsWith(`${k} `)));
};

describe("seed 298 restores the five launch messages", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  after(close);

  test("FAIL then PASS: the pulse goes red when the rows are deleted, and green with every byte back after the restore", async () => {
    await inRolledBackTx(async (c) => {
      const org = await fundhubOrg(c);
      const seeded = (await c.query(ROWS_SQL, [org, KEYS])).rows;
      assert.deepEqual(seeded.map((r) => r.template_key), KEYS, "the original seeds did not write all five");
      assert.deepEqual(await pulseProblems(c), [], "the pulse template check is not green on these five on a fresh database");

      await c.query("DELETE FROM message_templates WHERE org_id = $1 AND template_key = ANY($2::text[])", [org, KEYS]);
      assert.deepEqual((await pulseProblems(c)).sort(), [
        "CONTRACT-SEND-EMAIL is missing.", "EMAIL-S00-WELCOME is missing.", "EMAIL-S04-01-CONFIRM is missing.",
        "SMS-DOC-01-REQUEST is missing.", "SMS-S00-WELCOME is missing."
      ]);

      await c.query(RESTORE);
      const back = (await c.query(ROWS_SQL, [org, KEYS])).rows;
      assert.deepEqual(back, seeded, "the restored words are not the words the original seeds wrote");
      assert.deepEqual(await pulseProblems(c), []);
    });
  });

  test("safe to run again: a second run adds nothing, and a row a person edited is left alone", async () => {
    await inRolledBackTx(async (c) => {
      const org = await fundhubOrg(c);
      await c.query(
        "UPDATE message_templates SET body = 'Edited by a person' WHERE org_id = $1 AND template_key = 'SMS-S00-WELCOME'", [org]);
      await c.query("DELETE FROM message_templates WHERE org_id = $1 AND template_key = 'SMS-DOC-01-REQUEST'", [org]);

      await c.query(RESTORE);
      await c.query(RESTORE);

      const rows = (await c.query(ROWS_SQL, [org, KEYS])).rows;
      assert.deepEqual(rows.map((r) => r.template_key), KEYS);
      assert.equal(rows.find((r) => r.template_key === "SMS-S00-WELCOME").body, "Edited by a person");
      const n = await c.query(
        "SELECT count(*)::int AS n FROM message_templates WHERE org_id = $1 AND template_key = ANY($2::text[])", [org, KEYS]);
      assert.equal(n.rows[0].n, 5);
    });
  });

  test("only the Fundhub company is written", async () => {
    await inRolledBackTx(async (c) => {
      const org = await fundhubOrg(c);
      const other = (await c.query(
        "INSERT INTO orgs (slug, name) VALUES ('restore-298-other-co', 'Other Co') RETURNING id")).rows[0].id;
      await c.query("DELETE FROM message_templates WHERE org_id = $1 AND template_key = ANY($2::text[])", [org, KEYS]);

      await c.query(RESTORE);

      assert.equal((await c.query(ROWS_SQL, [other, KEYS])).rows.length, 0, "the restore wrote rows for another company");
      assert.equal((await c.query(ROWS_SQL, [org, KEYS])).rows.length, 5);
    });
  });
});
