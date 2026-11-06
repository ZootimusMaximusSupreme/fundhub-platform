#!/usr/bin/env node
// Preview all finished receipts; --apply stores only the new internal ranking.
// node --env-file=<selected-environment-file> scripts/offersiq-lead-sort-rescore.mjs --environment sandbox [--apply]
import { parseLeadSortArgs, rescoreFinishedOffersIq, isToolEntryPoint, runToolMain } from "./offersiq-lead-sort-tools.mjs";

export async function main(args = process.argv.slice(2)) {
  const options = parseLeadSortArgs(args);
  if (options.help) {
    console.log("--environment sandbox|production [--org UUID] [--page-size 100] [--apply]. Default: read-only sandbox preview.");
    return;
  }
  const { pool, close } = await import("../src/db.mjs");
  const { persistOffersIqLeadSort } = await import("../src/finance/offersiq-lead-sort-store.mjs");
  const db = await pool().connect();
  try {
    if (!options.apply) await db.query("BEGIN READ ONLY");
    console.log(JSON.stringify(await rescoreFinishedOffersIq({ db, ...options, persist: persistOffersIqLeadSort })));
  } finally {
    if (!options.apply) await db.query("ROLLBACK");
    db.release();
    await close();
  }
}

if (isToolEntryPoint(import.meta.url)) await runToolMain(() => main());
