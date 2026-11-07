#!/usr/bin/env node
// Bank logos backfill — one Plaid logo for every bank already linked.
//
// Owner rule (Chris, 2026-11-07): every bank the product shows carries that
// bank's own logo, from Plaid. New links and the daily refresh save the logo by
// themselves (src/banking/plaid-link.mjs, src/banking/plaid-refresh.mjs). This
// script is for the banks linked before plaid_institutions (migration 575) existed.
//
//   node --env-file=.env scripts/plaid-institution-logos-backfill.mjs             # dry run: lists the banks, no Plaid call, no write
//   node --env-file=.env scripts/plaid-institution-logos-backfill.mjs --confirm   # asks Plaid once per bank and saves the logo
//   ... --confirm --force      also re-reads banks already read this month
//   ... --limit 50             at most 50 banks
//
// WHAT IT TOUCHES. It reads the distinct Plaid institution ids on plaid_items
// (no access token, no account, no person). With --confirm it calls Plaid's
// /institutions/get_by_id — read only, no money moves — and writes ONLY the
// plaid_institutions row for that bank: name, logo, primary_color, url and when
// it was read. Nothing on plaid_items, bank_accounts or any client row changes.
//
// It runs by hand, once, after migration 575 ships. It is not a scheduled job,
// so it has no heartbeat row. Plaid keys are read from env the way every Plaid
// call in this repo reads them; none is printed.
import { pool, close } from "../src/db.mjs";
import { backfillInstitutionLogos } from "../src/banking/institution-logos.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Nothing was read or written.");
    process.exitCode = 1;
    return;
  }
  const confirm = process.argv.includes("--confirm");
  const force = process.argv.includes("--force");
  const limit = Number(arg("--limit")) || 500;

  const report = await backfillInstitutionLogos(pool(), { env: process.env, confirm, force, limit });

  if (!confirm) {
    console.log(`Dry run. ${report.institutions} linked bank(s) would be asked for a logo:`);
    for (const id of report.ids) console.log(`  ${id}`);
    console.log("Run again with --confirm to ask Plaid and save the logos.");
    return;
  }
  console.log(`Banks: ${report.institutions}. Saved: ${report.saved} (${report.withLogo} with a logo, ` +
    `${report.saved - report.withLogo} where Plaid has none). Skipped (read this month): ${report.skipped}.`);
  for (const f of report.failed) console.log(`  not saved: ${f.institutionId} — ${f.reason}${f.errorCode ? ` (${f.errorCode})` : ""}`);
  if (report.failed.length) process.exitCode = 1;
}

main().then(() => close(), async (e) => { console.error(e?.message || e); await close(); process.exit(1); });
