// db/seed/299_restore_u02_pack_email_2026_10_20.sql against real Postgres.
//
// A fresh database built by db/migrate.mjs already holds the pack-ready email, written by seed/009. So each
// test opens ONE transaction, deletes the row the way the 2026-10-11/12 test run did on live, runs the
// restore file, compares, and rolls back. Nothing is left behind and no other test sees the delete.
//
// Never point this at production (CLAUDE.md section 12): it is scratch-only like every .pg.test.mjs.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../db.mjs";
import { PACK_TEMPLATE_SQL, judgePackTemplate } from "../pulse/coverage/gap-underwrite.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RESTORE = fs.readFileSync(path.join(ROOT, "db/seed/299_restore_u02_pack_email_2026_10_20.sql"), "utf8");
const KEY = "EMAIL-U02-ANALYZER-FUNDING-DELIVERY";

const ROW_SQL = `SELECT t.template_key, t.channel, t.subject, t.body, t.compliance_passed, t.approved_by
  FROM message_templates t
 WHERE t.org_id = $1 AND t.template_key = $2`;

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

/* The pulse's own read and judge (gap-underwrite:uw-pack-email-not-queued, template half). */
const pulseSays = async (c, org) => judgePackTemplate((await c.query(PACK_TEMPLATE_SQL, [org, KEY])).rows[0]);

describe("seed 299 restores the pack-ready email", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  after(close);

  test("FAIL then PASS: the pulse goes red when the row is deleted, and green with every byte back after the restore", async () => {
    await inRolledBackTx(async (c) => {
      const org = await fundhubOrg(c);
      const seeded = (await c.query(ROW_SQL, [org, KEY])).rows;
      assert.equal(seeded.length, 1, "seed/009 did not write the pack email");
      assert.equal(await pulseSays(c, org), null, "the pulse is not green on the pack email on a fresh database");

      await c.query("DELETE FROM message_templates WHERE org_id = $1 AND template_key = $2", [org, KEY]);
      assert.equal(await pulseSays(c, org), `${KEY} has no row, so no pack-ready email can be queued`);

      await c.query(RESTORE);
      assert.deepEqual((await c.query(ROW_SQL, [org, KEY])).rows, seeded, "the restored words are not seed/009's words");
      assert.equal(await pulseSays(c, org), null);
    });
  });

  test("safe to run again: a second run adds nothing, and a row a person edited is left alone", async () => {
    await inRolledBackTx(async (c) => {
      const org = await fundhubOrg(c);
      await c.query("UPDATE message_templates SET subject = 'Edited by a person' WHERE org_id = $1 AND template_key = $2", [org, KEY]);

      await c.query(RESTORE);
      await c.query(RESTORE);

      const rows = (await c.query(ROW_SQL, [org, KEY])).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].subject, "Edited by a person");
    });
  });

  test("only the Fundhub company is written", async () => {
    await inRolledBackTx(async (c) => {
      const org = await fundhubOrg(c);
      const other = (await c.query(
        "INSERT INTO orgs (slug, name) VALUES ('restore-299-other-co', 'Other Co') RETURNING id")).rows[0].id;
      await c.query("DELETE FROM message_templates WHERE org_id = $1 AND template_key = $2", [org, KEY]);

      await c.query(RESTORE);

      assert.equal((await c.query(ROW_SQL, [other, KEY])).rows.length, 0, "the restore wrote a row for another company");
      assert.equal((await c.query(ROW_SQL, [org, KEY])).rows.length, 1);
    });
  });
});
