// Morning wrapper around the beat-safe funding-trip truth.
// The SQL and verdict live in one place so hourly and daily runs cannot disagree.

import { clip, nowOf, readRows, runnerOf, skipWhy } from "./money-reads.mjs";
import { skipRow } from "./trip-kit.mjs";
import {
  CHECK_IDS, TRIP_SQL, judgeFunding, tripParams
} from "../beats/lib/trip-funding-truth.mjs";

export * from "../beats/lib/trip-funding-truth.mjs";

const ID = CHECK_IDS[0];

export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the funding trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  try {
    const got = await readRows(run, ID, "the funding trips", TRIP_SQL, tripParams(orgId, now));
    if (got.skip) return [got.skip];
    return [judgeFunding({ rows: got.rows, now })];
  } catch (err) {
    return [skipRow(ID, `could not judge the funding trips: ${clip(err)}`)];
  }
}
