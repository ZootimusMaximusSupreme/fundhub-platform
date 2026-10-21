// db/migrations/502_bank_apply_links_2026_10_21.sql against real Postgres.
//
// A fresh database has no lenders (scripts load them, not migrations), so each test opens ONE
// transaction, puts in the two bank rows the way live holds them, runs the migration, checks, and rolls
// back. Scratch-only like every .pg.test.mjs (CLAUDE.md section 12).

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../db.mjs";
import { SQL_APPLY_URLS } from "../pulse/beats/beat-apply-links.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "db/migrations/502_bank_apply_links_2026_10_21.sql"), "utf8");

const BLUE_RIDGE = {
  id: "b004d840-ff34-4bf5-8188-0eb6461c966e",
  table: "OnlineBizCC",
  name: "Blue Ridge Bank",
  old: "https://www.mybrb.bank/loans/credit-cards/business-credit-cards.html",
  now: "https://www.mybrb.bank/business/credit/cards.html"
};
const LANDMARK = {
  id: "373b7a55-9fb5-46bb-b74c-0b31aae85889",
  table: "InBranchBizCC",
  name: "Landmark National Bank",
  old: "https://www.banklandmark.com/business/additional-business-services/business-credit-cards/"
};

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

/* A bank row the way live holds it (2026-10-21), fresh inside the transaction. */
async function putLiveRow(c, bank, url) {
  await c.query("DELETE FROM lenders WHERE id = $1::uuid", [bank.id]);
  await c.query(
    `INSERT INTO lenders (id, org_id, lender_table, name, application_url, active, last_updated_by, last_updated_date)
     SELECT $1::uuid, o.id, $2::lender_table, $3, $4, true, 'alec-legacy-strong-import', DATE '2026-09-18'
       FROM orgs o WHERE o.slug = 'fundhub'`,
    [bank.id, bank.table, bank.name, url]);
}

const row = async (c, bank) => (await c.query(
  "SELECT application_url, last_updated_by, last_updated_date::text AS d, active, name FROM lenders WHERE id = $1::uuid",
  [bank.id])).rows[0];

/* The addresses the pulse reads for a lender (beat apply-links, step url-shape). */
const pulseUrlsFor = async (c, bank) => (await c.query(SQL_APPLY_URLS)).rows
  .filter((r) => (r.lender_ids || []).includes(bank.id)).map((r) => r.url);

describe("migration 502 fixes the two dead bank Apply links", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  after(close);

  test("FAIL then PASS: the pulse reads both dead addresses before; after, Blue Ridge's new page and nothing for Landmark", async () => {
    await inRolledBackTx(async (c) => {
      await putLiveRow(c, BLUE_RIDGE, BLUE_RIDGE.old);
      await putLiveRow(c, LANDMARK, LANDMARK.old);
      assert.deepEqual(await pulseUrlsFor(c, BLUE_RIDGE), [BLUE_RIDGE.old]);
      assert.deepEqual(await pulseUrlsFor(c, LANDMARK), [LANDMARK.old]);

      await c.query(MIGRATION);

      const br = await row(c, BLUE_RIDGE);
      assert.equal(br.application_url, BLUE_RIDGE.now);
      const lm = await row(c, LANDMARK);
      assert.equal(lm.application_url, null);
      for (const r of [br, lm]) {
        assert.equal(r.last_updated_by, "pulse apply-links fix 2026-10-21");
        assert.equal(r.d, "2026-10-21");
        assert.equal(r.active, true, "the lender must stay on");
      }
      assert.equal(lm.name, "Landmark National Bank", "the lender row is kept");
      assert.deepEqual(await pulseUrlsFor(c, BLUE_RIDGE), [BLUE_RIDGE.now]);
      assert.deepEqual(await pulseUrlsFor(c, LANDMARK), []);
    });
  });

  test("rows a person already fixed by hand are left alone, and a second run changes nothing", async () => {
    await inRolledBackTx(async (c) => {
      const brHand = "https://www.mybrb.bank/business/credit/small-business-card.html";
      const lmHand = "https://www.banklandmark.com/business/business-debit-card/";
      await putLiveRow(c, BLUE_RIDGE, brHand);
      await putLiveRow(c, LANDMARK, lmHand);
      await c.query(MIGRATION);
      await c.query(MIGRATION);
      assert.equal((await row(c, BLUE_RIDGE)).application_url, brHand);
      assert.equal((await row(c, LANDMARK)).application_url, lmHand);
      assert.equal((await row(c, BLUE_RIDGE)).last_updated_by, "alec-legacy-strong-import");
      assert.equal((await row(c, LANDMARK)).last_updated_by, "alec-legacy-strong-import");
    });
  });

  test("a database without these lenders changes nothing", async () => {
    await inRolledBackTx(async (c) => {
      await c.query("DELETE FROM lenders WHERE id = ANY($1::uuid[])", [[BLUE_RIDGE.id, LANDMARK.id]]);
      const before = (await c.query("SELECT count(*)::int AS n FROM lenders")).rows[0].n;
      await c.query(MIGRATION);
      assert.equal((await c.query("SELECT count(*)::int AS n FROM lenders")).rows[0].n, before);
      assert.equal((await c.query(
        "SELECT count(*)::int AS n FROM lenders WHERE last_updated_by = 'pulse apply-links fix 2026-10-21'")).rows[0].n, 0);
    });
  });
});
