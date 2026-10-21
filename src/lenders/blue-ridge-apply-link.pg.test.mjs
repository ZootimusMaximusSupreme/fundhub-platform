// db/migrations/497_blue_ridge_bank_apply_link.sql against real Postgres.
//
// A fresh database has no lenders (scripts load them, not migrations), so each test opens ONE
// transaction, puts in a Blue Ridge row the way live holds it, runs the migration, checks, and rolls back.
// Scratch-only like every .pg.test.mjs (CLAUDE.md section 12).

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../db.mjs";
import { SQL_APPLY_URLS } from "../pulse/beats/beat-apply-links.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "db/migrations/497_blue_ridge_bank_apply_link.sql"), "utf8");

const LENDER_ID = "b004d840-ff34-4bf5-8188-0eb6461c966e";
const OLD = "https://www.mybrb.bank/loans/credit-cards/business-credit-cards.html";
const NEW = "https://www.mybrb.bank/business/credit/cards.html";

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

/* The Blue Ridge row as live holds it (2026-10-20), fresh inside the transaction. */
async function putLiveRow(c, url) {
  await c.query("DELETE FROM lenders WHERE id = $1::uuid", [LENDER_ID]);
  await c.query(
    `INSERT INTO lenders (id, org_id, lender_table, name, application_url, eligible_states, bureaus_pulled,
                          intro_offers, active, last_updated_by, last_updated_date)
     SELECT $1::uuid, o.id, 'OnlineBizCC', 'Blue Ridge Bank', $2, 'VA,NC,SC,GA,TN,KY,WV,MD,DC', 'EQ',
            '0% intro APR — 12 months', true, 'alec-legacy-strong-import', DATE '2026-09-18'
       FROM orgs o WHERE o.slug = 'fundhub'`,
    [LENDER_ID, url]);
}

const row = async (c) => (await c.query(
  "SELECT application_url, last_updated_by, last_updated_date::text AS d, active, name FROM lenders WHERE id = $1::uuid",
  [LENDER_ID])).rows[0];

/* What the pulse reads for this lender (beat apply-links, step url-shape). */
const pulseUrlFor = async (c) => (await c.query(SQL_APPLY_URLS)).rows
  .filter((r) => (r.lender_ids || []).includes(LENDER_ID)).map((r) => r.url);

describe("migration 497 moves Blue Ridge Bank's Apply link", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  after(close);

  test("FAIL then PASS: the pulse reads the dead address before, and the bank's new page after", async () => {
    await inRolledBackTx(async (c) => {
      await putLiveRow(c, OLD);
      assert.deepEqual(await pulseUrlFor(c), [OLD]);

      await c.query(MIGRATION);

      const r = await row(c);
      assert.equal(r.application_url, NEW);
      assert.equal(r.last_updated_by, "pulse apply-links fix 2026-10-20");
      assert.equal(r.d, "2026-10-20");
      assert.equal(r.active, true, "the lender must stay on");
      assert.equal(r.name, "Blue Ridge Bank");
      assert.deepEqual(await pulseUrlFor(c), [NEW]);
    });
  });

  test("a row a person already fixed by hand is left alone, and a second run changes nothing", async () => {
    await inRolledBackTx(async (c) => {
      const handFixed = "https://www.mybrb.bank/business/credit/small-business-card.html";
      await putLiveRow(c, handFixed);
      await c.query(MIGRATION);
      await c.query(MIGRATION);
      const r = await row(c);
      assert.equal(r.application_url, handFixed);
      assert.equal(r.last_updated_by, "alec-legacy-strong-import");
    });
  });

  test("a database without this lender changes nothing", async () => {
    await inRolledBackTx(async (c) => {
      await c.query("DELETE FROM lenders WHERE id = $1::uuid", [LENDER_ID]);
      const res = await c.query(MIGRATION);
      assert.equal(res.rowCount, 0);
    });
  });
});
