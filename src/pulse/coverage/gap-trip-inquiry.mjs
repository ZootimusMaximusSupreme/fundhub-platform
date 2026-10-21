// The inquiry-removal trip, start to end, for the morning pulse. Report only. Read only.
// Morning wrapper around the beat-safe inquiry-trip truth (src/pulse/beats/lib/inquiry-trip-truth.mjs).
// The SQL and verdict live in one place so the hourly beat inquiry-trip and this lane cannot disagree.
// ctx.db is a shared pool: never BEGIN, COMMIT, ROLLBACK or SET here. A failed read is a skip with the reason.

import { clip, nowOf, readRows, runnerOf, skipWhy } from "./money-reads.mjs";
import { skipRow } from "./trip-kit.mjs";
import {
  CHECK_IDS, TRIP_SQL, judgeInquiry, tripParams
} from "../beats/lib/inquiry-trip-truth.mjs";

export * from "../beats/lib/inquiry-trip-truth.mjs";

const ID = CHECK_IDS[0];

/**
 * @param {{ db?: object, scope?: Function, orgId?: string, now?: Date }} [ctx]
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the inquiry trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  try {
    const got = await readRows(run, ID, "the inquiry trips", TRIP_SQL, tripParams(orgId, now));
    if (got.skip) return [got.skip];
    return [judgeInquiry({ rows: got.rows, now })];
  } catch (err) {
    return [skipRow(ID, `could not judge the inquiry trips: ${clip(err)}`)];
  }
}
