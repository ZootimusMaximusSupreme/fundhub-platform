#!/usr/bin/env node
// One-off: write today's FinanceOS trend snapshot and the rebuilt past days for
// the FinanceOS test client (wave 4, H6). Owner-set 2026-10-06: sample data is fine.
//
// WHAT IT WRITES (only with --apply):
//   * finance_account_daily — today's row per open account (source 'snapshot'),
//     and estimated past days for open checking/savings rebuilt from
//     bank_transactions (source 'backfill', estimated true);
//   * finance_client_daily  — today's rollup, plus one estimated rollup per
//     rebuilt day (cash per kind only; debt and cards used stay null).
// It goes through the same writers the daily job uses
// (src/finance/money-trends.mjs snapshotClient / backfillClient). Nothing is
// inserted by hand here. Never deletes anything. Safe to re-run: one row per
// (account, day) and per (client, day), and an estimate never overwrites a
// real snapshot.
//
// NEEDS MIGRATION 458 LIVE (the two tables). The dry run does not — it only
// reads accounts and transactions, inside BEGIN READ ONLY … ROLLBACK.
//
//   node --env-file=.env scripts/finance-os-backfill-trends.mjs            # dry run, read-only
//   node --env-file=.env scripts/finance-os-backfill-trends.mjs --apply    # writes

import { db, pool, close } from "../src/db.mjs";
import { planBackfill, snapshotClient, backfillClient, buildSnapshot, BACKFILL_DAYS } from "../src/finance/money-trends.mjs";

const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";

const APPLY = process.argv.slice(2).includes("--apply");

/* Every dry-run read sits inside BEGIN READ ONLY … ROLLBACK on one connection. */
async function readOnly(fn) {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN READ ONLY");
    return await fn(conn);
  } finally {
    await conn.query("ROLLBACK");
    conn.release();
  }
}

const dollars = (c) => (c === null || c === undefined ? "—" : `$${(c / 100).toFixed(2)}`);

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — client ${CLIENT}, org ${ORG}, today ${today}`);

  const seen = await readOnly(async (conn) => {
    const c = await conn.query(`SELECT id FROM clients WHERE id = $1 AND org_id = $2`, [CLIENT, ORG]);
    if (!c.rows[0]) return null;
    const accounts = await conn.query(
      `SELECT id, name, account_type, current_balance_cents, available_balance_cents, credit_limit_cents,
              balance_as_of, entity_kind, entity_id, closed_at, provider
         FROM bank_accounts WHERE client_id = $1 AND org_id = $2`, [CLIENT, ORG]);
    const entities = await conn.query(
      `SELECT id, kind, name FROM entities WHERE client_id = $1 AND org_id = $2 AND archived_at IS NULL`, [CLIENT, ORG]);
    const plan = await planBackfill(conn, { orgId: ORG, clientId: CLIENT, today, days: BACKFILL_DAYS });
    const tables = await conn.query(`SELECT to_regclass('finance_client_daily') IS NOT NULL AS ready`);
    return { snap: buildSnapshot({ day: today, accounts: accounts.rows, entities: entities.rows }), plan, ready: tables.rows[0].ready };
  });
  if (!seen) throw new Error("test client not found in that org");

  const r = seen.snap.rollup;
  console.log(`snapshot ${today}: ${seen.snap.accounts.length} open accounts`);
  console.log(`  cash personal ${dollars(r.cash_personal_cents)} · business ${dollars(r.cash_business_cents)} · not sure yet ${dollars(r.cash_unknown_cents)} (never added)`);
  console.log(`  debt ${dollars(r.debt_total_cents)} (personal ${dollars(r.debt_personal_cents)}, business ${dollars(r.debt_business_cents)}) · cards used ${r.cards_used_pct ?? "—"}%`);
  for (const a of seen.plan.accounts) {
    const p = a.points;
    console.log(`backfill ${a.name} (${a.kind}): ${p.length} estimated day(s)` +
      (p.length ? ` ${p[0].day} ${dollars(p[0].cents)} → ${p[p.length - 1].day} ${dollars(p[p.length - 1].cents)}` : ""));
  }
  console.log(`backfill rollups: ${seen.plan.rollups.length} estimated day(s)`);

  if (!APPLY) {
    console.log("dry run: nothing written. Add --apply to write.");
    return;
  }
  if (!seen.ready) throw new Error("migration 458 is not live yet (finance_client_daily missing) — ship first");

  const s = await snapshotClient(db, { orgId: ORG, clientId: CLIENT, day: today });
  const b = await backfillClient(db, { orgId: ORG, clientId: CLIENT, today });
  console.log(`wrote snapshot (${s.accounts} accounts) and ${b.accountRows} estimated account-day row(s), ${b.rollupRows} estimated rollup(s)`);
}

main().then(() => close(), async (e) => { console.error(e?.message || e); await close(); process.exit(1); });
