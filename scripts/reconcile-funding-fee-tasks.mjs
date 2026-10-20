// Dry-run: node --env-file=.env scripts/reconcile-funding-fee-tasks.mjs
// Apply only reviewed rounds: node --env-file=.env scripts/reconcile-funding-fee-tasks.mjs --apply <round-uuid>...
// Internal advisor tasks only; never emits round.funded or creates invoices.

import { pathToFileURL } from "node:url";
import { db, close } from "../src/db.mjs";
import { reconcileLegacyFundedFeeTasks } from "../src/funding/reconcile-fee-tasks.mjs";

export async function run(db, args = []) {
  const apply = args.includes("--apply");
  const roundIds = args.filter((arg) => arg !== "--apply");
  if (!apply && roundIds.length) throw new Error("Round IDs require --apply; plain run is read-only preview");
  const result = await reconcileLegacyFundedFeeTasks(db, { apply, roundIds });
  return {
    applied: result.applied,
    candidateCount: result.candidates.length,
    created: result.created,
    rounds: result.candidates.map((row) => ({
      suffix: String(row.id).slice(-8),
      number: row.round_number ?? null
    })),
    outcomes: result.outcomes?.map((row) => ({
      suffix: String(row.roundId).slice(-8), created: row.created, reason: row.reason
    })) || []
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await run(db, process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(`reconcile-funding-fee-tasks: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await close();
  }
}
