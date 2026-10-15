// A rehearsal pull is not a credit file.
//
// src/finance/crs-pull.mjs `simulate: true` runs the whole pull path and replaces
// only the bureau call. It still emits analysis.completed (same event id, same
// `source: "crs"`), stamped `simulated: true`, and the canned answer has no score
// at all: scores = { ex: null, eq: null, tu: null }.
//
// U-03 and U-04 copy `scores.ex` straight onto the client. On a rehearsal that
// copies a null over the score the client really has, and U-03 also re-runs the
// funding-pause check against a file with no negatives, which reopens a paused
// gate. They call this first and stop.
//
// ONLY a rehearsal with no Experian score counts. The walkthrough tool
// (scripts/sim/push-credit.mjs) stamps the same `simulated: true` but carries a
// full file with real numbers, and the manual walkthrough needs U-03 and U-04 to
// run on it. A simulated payload WITH an Experian score is left to run.

/** True when this analysis.completed payload is a simulated pull that carries no
 *  Experian score, so there is no file to sync and nothing it may write. Never
 *  throws; an unreadable payload answers false so a real pull is never skipped. */
export function isEmptyRehearsal(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.simulated !== true) return false;
  const ex = payload.scores?.ex;
  if (ex === null || ex === undefined || ex === "") return true;
  return !Number.isFinite(Number(ex));
}
