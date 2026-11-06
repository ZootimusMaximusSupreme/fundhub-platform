#!/usr/bin/env node
// Uses only CRS's free stored-report reevaluation. Never orders a new check.
// Production --apply must prove the newly loaded list through one known receipt.
import { parseLeadSortArgs, reevaluateFinishedOffersIq, isToolEntryPoint, runToolMain } from "./offersiq-lead-sort-tools.mjs";

export async function main(args = process.argv.slice(2)) {
  const options = parseLeadSortArgs(args);
  if (options.help) {
    console.log("--environment sandbox|production [--org UUID] [--page-size 100] [--apply --loaded-proof-request UUID]. Default: read-only preview, no CRS call.");
    return;
  }
  const { pool, close } = await import("../src/db.mjs");
  const { safeOffersIqSummary } = await import("../src/finance/offersiq.mjs");
  const { persistOffersIqLeadSort } = await import("../src/finance/offersiq-lead-sort-store.mjs");
  const db = await pool().connect();
  try {
    if (!options.apply) await db.query("BEGIN READ ONLY");
    console.log(JSON.stringify(await reevaluateFinishedOffersIq({ db, ...options,
      persist: persistOffersIqLeadSort, summarize: safeOffersIqSummary })));
  } finally {
    if (!options.apply) await db.query("ROLLBACK");
    db.release();
    await close();
  }
}

if (isToolEntryPoint(import.meta.url)) await runToolMain(() => main());
