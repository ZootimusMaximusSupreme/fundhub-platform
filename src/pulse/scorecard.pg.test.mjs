// Migration 477 and saveScorecard(), against a real Postgres.
//
// *** THIS FILE SKIPS WITHOUT DATABASE_URL, AND IT SKIPS ON ANY NON-LOOPBACK DATABASE. A SKIPPED PG TEST IS NOT GREEN. ***
// It runs in CI (.github/workflows/tests.yml builds a throwaway Postgres on 127.0.0.1 from db/migrations and sets
// DATABASE_URL). It was NOT run on the machine that wrote it (2026-10-09): that Mac has no Postgres, and the only
// reachable database is production, which this file must never touch. So the guard below refuses anything that is not
// a loopback host. What WAS proved on the live database, read only: the new counts-match expression, evaluated as a
// plain SELECT over literal cards (a four-status card holds; a wrong na_count, an "na" row under the old count, and
// an unknown status all fail), and both stored morning cards (2026-10-08, 2026-10-09) satisfy it with na_count = 0.
// See ops/workflows/zero-unchecked-2026-10-09/manifest-A.md.
//
// Every statement runs inside BEGIN ... ROLLBACK on one client. Nothing is left behind. A row that must be refused is
// tried under a SAVEPOINT so the transaction survives the refusal.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../db.mjs";
import { buildScorecard, saveScorecard } from "./scorecard.mjs";

const HOST = (() => { try { return new URL(process.env.DATABASE_URL || "").hostname; } catch { return ""; } })();
const LOOPBACK = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(HOST);
const SKIP = !process.env.DATABASE_URL
  ? "no DATABASE_URL (this runs in CI; a skipped pg test is not green)"
  : !LOOPBACK
    ? `DATABASE_URL host "${HOST}" is not loopback. This file will not run against a shared database.`
    : false;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(HERE, "../../db/migrations/477_zero_unchecked_na.sql");
const DAY = "2099-01-01";

let ORG = null;

/** Run `work(client)` in a transaction that is always rolled back. */
async function inTx(work) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    return await work(client);
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* the connection is gone; nothing to undo */ }
    client.release();
  }
}

/** The insert is refused, and by one of these constraints. */
async function refused(client, constraints, run) {
  await client.query("SAVEPOINT attempt");
  let err = null;
  try { await run(); } catch (e) { err = e; }
  await client.query("ROLLBACK TO SAVEPOINT attempt");
  assert.ok(err, "the database accepted a card it should refuse");
  assert.ok(constraints.includes(err.constraint), `refused by ${err.constraint || "(no constraint)"}: ${err.message}`);
}

const row = (status) => ({ id: `x-${status}`, group: "backend", status });

function insertCard(client, { checks, green = 0, red = 0, notChecked = 0, na = null, date = DAY }) {
  const cols = ["org_id", "scorecard_date", "checks", "green_count", "red_count", "not_checked_count"];
  const vals = [ORG, date, JSON.stringify(checks), green, red, notChecked];
  if (na !== null) { cols.push("na_count"); vals.push(na); }
  return client.query(
    `INSERT INTO pulse_scorecards (${cols.join(", ")})
     VALUES ($1::uuid, $2::date, $3::jsonb, ${vals.slice(3).map((_, i) => `$${i + 4}`).join(", ")}) RETURNING *`,
    vals
  );
}

describe("migration 477 against a real Postgres", { skip: SKIP }, () => {
  before(async () => {
    ORG = (await pool().query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
  });
  after(async () => { await close(); });

  test("a four-status card is accepted, and na_count is stored", async () => {
    await inTx(async (c) => {
      const checks = [row("green"), row("red"), row("not_checked"), row("na"), row("na")];
      const r = (await insertCard(c, { checks, green: 1, red: 1, notChecked: 1, na: 2 })).rows[0];
      assert.equal(r.na_count, 2);
      assert.equal(r.green_count + r.red_count + r.not_checked_count + r.na_count, 5);
    });
  });

  test("a card in the old three-status shape still saves, and na_count falls to its default of 0", async () => {
    await inTx(async (c) => {
      const checks = [row("green"), row("red"), row("not_checked")];
      const r = (await insertCard(c, { checks, green: 1, red: 1, notChecked: 1 })).rows[0];
      assert.equal(r.na_count, 0);
    });
  });

  test("a wrong count is refused: na_count too low, na rows under the old count, or an unknown status", async () => {
    await inTx(async (c) => {
      const two = [row("green"), row("na"), row("na")];
      await refused(c, ["pulse_scorecards_counts_match"], () => insertCard(c, { checks: two, green: 1, na: 1 }));
      await refused(c, ["pulse_scorecards_counts_match"], () => insertCard(c, { checks: two, green: 1, na: 0, notChecked: 2 }));
      await refused(c, ["pulse_scorecards_counts_match"], () => insertCard(c, { checks: [row("green"), row("weird")], green: 1 }));
      await refused(c, ["pulse_scorecards_counts_match"], () => insertCard(c, { checks: [row("green")], green: 2 }));
    });
  });

  test("a negative na_count is refused", async () => {
    await inTx(async (c) => {
      // counts_match (c...) is tried before na_count_ck (n...), so either may be the one that names it.
      await refused(c, ["pulse_scorecards_counts_match", "pulse_scorecards_na_count_ck"],
        () => insertCard(c, { checks: [row("green")], green: 1, na: -1 }));
    });
  });

  test("saveScorecard writes a real card, and a re-run the same morning replaces it", async () => {
    await inTx(async (c) => {
      const build = (n) => {
        const card = buildScorecard({
          now: new Date("2099-01-01T13:00:00Z"),
          checks: [
            { id: "reg:a", kind: "registry", status: "PASS", detail: "answered 200" },
            { id: "job:b", status: "FAIL", detail: "late" },
            { id: "gap-x:e", status: "skip", detail: "no database" },
            ...Array.from({ length: n }, (_, i) => ({
              id: `gap-ads:quiet-${i}`, status: "na", detail: "No ad is running. Judged the day one runs.",
              na: { code: "no-running-ad", args: {} }
            }))
          ]
        });
        card.date = DAY;
        return card;
      };
      const first = await saveScorecard(c, ORG, build(1));
      assert.equal(first.saved, true);
      assert.deepEqual(first.counts, { green: 1, red: 1, na: 1, not_checked: 1 });
      assert.equal(first.legacy, undefined, "with the migration applied the save is not the old shape");

      const second = await saveScorecard(c, ORG, build(3));
      assert.equal(second.id, first.id, "same company, same morning: one row");
      const stored = (await c.query(`SELECT * FROM pulse_scorecards WHERE id = $1`, [second.id])).rows[0];
      assert.equal(stored.na_count, 3);
      assert.equal(stored.not_checked_count, 1);
      assert.equal(stored.checks.filter((x) => x.status === "na").length, 3);
      assert.equal(stored.checks.find((x) => x.status === "na").na_code, "no-running-ad");
    });
  });

  test("the app role can read, add and change a card, can write na_count, and cannot delete one", async (t) => {
    const has = (await pool().query(`SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app'`)).rowCount;
    if (!has) { t.skip("no fundhub_app role in this database, so its privileges were not checked"); return; }
    const p = (await pool().query(
      `SELECT has_table_privilege('fundhub_app', 'public.pulse_scorecards', 'SELECT') AS sel,
              has_table_privilege('fundhub_app', 'public.pulse_scorecards', 'INSERT') AS ins,
              has_table_privilege('fundhub_app', 'public.pulse_scorecards', 'UPDATE') AS upd,
              has_table_privilege('fundhub_app', 'public.pulse_scorecards', 'DELETE') AS del,
              has_column_privilege('fundhub_app', 'public.pulse_scorecards', 'na_count', 'INSERT') AS col_ins,
              has_column_privilege('fundhub_app', 'public.pulse_scorecards', 'na_count', 'UPDATE') AS col_upd`
    )).rows[0];
    assert.deepEqual(p, { sel: true, ins: true, upd: true, del: false, col_ins: true, col_upd: true });
  });

  test("running the migration file a second time changes nothing and breaks nothing", async (t) => {
    const owner = (await pool().query(
      `SELECT pg_get_userbyid(relowner) = current_user AS mine FROM pg_class WHERE relname = 'pulse_scorecards' AND relkind = 'r'`
    )).rows[0]?.mine;
    if (!owner) { t.skip("this login does not own pulse_scorecards, so it cannot re-run the migration"); return; }
    await inTx(async (c) => {
      await c.query(fs.readFileSync(MIGRATION, "utf8"));
      const checks = [row("green"), row("na")];
      const r = (await insertCard(c, { checks, green: 1, na: 1 })).rows[0];
      assert.equal(r.na_count, 1);
      await refused(c, ["pulse_scorecards_counts_match"], () => insertCard(c, { checks, green: 1, na: 0, date: "2099-01-02" }));
      const cons = (await c.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'public.pulse_scorecards'::regclass AND contype = 'c' ORDER BY conname`
      )).rows.map((x) => x.conname);
      assert.ok(cons.includes("pulse_scorecards_counts_match"));
      assert.ok(cons.includes("pulse_scorecards_na_count_ck"));
    });
  });
});
