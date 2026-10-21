// readClientProgress — every fact the client progress page needs, in one read.
//
// BUILT TO A WRITTEN CONTRACT. The orchestrator wrote the JSON shape before
// either side existed so the endpoint and the screen could be built at the same
// time. Where this file could not honour a field exactly it says so in a
// comment beginning DEVIATION and the branch's report repeats it; it does not
// quietly return something else, because a second lane is coding against the
// same document.
//
// MOSTLY FACTS, AND HERE IS EXACTLY WHERE IT IS NOT.
//
// The aim is api/read/portal-summary.mjs:20's rule — numbers, booleans, dates,
// identifiers and enums, with the words a client reads living in the front end.
// This endpoint does NOT fully reach it, and an earlier version of this comment
// claimed it did. It does not, in seven places, and every one of them is English a
// client can read:
//
//   timeline[].text          chosen from the allowlist in ./timeline.mjs
//   stage.roundLabel         roundLadderEntry().title, e.g. "Round 2 FCRA /
//                            method of verification"
//   paidServices[].components[].label   from src/waypoints/pricing.mjs
//   waypoints[].title        stored on the waypoint row
//   waypoints[].paidAlternative.label   stored on the waypoint row
//   scores.business[].name   the business's own stored name
//   ownedNotReady[].name     entitlement_catalog.name, else SUBTYPE_TITLES in
//                            src/documents/kinds.mjs (added 2026-09-18, hole N13)
//
// All seven are read from somewhere else rather than authored here, but they are
// still the compliance surface, and saying otherwise understated it for the one
// person reviewing this. The timeline is the one that matters most, which is why
// ./timeline.mjs picks its words from a closed list instead of printing a stored
// machine name.
//
// EXACTLY THREE OF THOSE STRINGS NAME A REGULATOR, and none of them says
// anything happened:
//
//   "CFPB complaint"                          stage.roundLabel — the rung's name
//   "State attorney general complaint"        stage.roundLabel — the rung's name
//   "CFPB and state attorney general filings" a PRICE LINE for an add-on the
//                                             client can buy, from
//                                             src/waypoints/pricing.mjs
//
// The third is the one worth reading twice. It is the label on a $20 line item,
// so it describes a product, not an event — but it does put the word "filings"
// in front of a client, and that is disclosed rather than argued away. It is not
// changed here because src/waypoints/pricing.mjs is another lane's file.
// src/http/client-progress.pg.test.mjs holds these three by exact value, so a
// FOURTH regulator string cannot appear in this payload without failing a test.
//
// NULL MEANS UNKNOWN AND MUST SURVIVE (CLAUDE.md §12). Not one field in here
// substitutes 0, "" or a value from a neighbouring column for something the
// database did not answer.
//
// NOTHING HERE SAYS "credit repair" (owner-set). The internal tables, the
// entitlement codes and the letters keep their names — renaming a stored value
// breaks the feature silently — and the seven client-facing strings above are
// funding-optimisation and capital-readiness wording.
//
// ROUNDS 4 AND 5 ARE NEVER RETURNED AS FILED unless a client said they filed.
// See ./escalations.mjs. Nothing in this branch writes that report, so `filed`
// is false for every client today.
//
// COMPLIANCE REVIEW REQUIRED — fee timing. `paidServices` quotes a price for a
// self-serve dispute round. It charges nobody: there is no processor call in
// this file, no stored card token is readable from it, and the only rail this
// repository has is a hosted checkout link a human clicks.

// THE READ LIVES IN src/pulse/beats/lib/progress-read.mjs (2026-10-20), unchanged, so the hourly beat
// client-progress runs this exact read for the newest paying client (a beat may import only from
// src/pulse/beats/lib). Every name is re-exported here, so GET /api/read/client-progress and every other caller
// import from this file as before. Only the env is added here: the referral link reads process.env, as it always
// did. Change the read there.

import { readClientProgress as readProgressWith } from "../pulse/beats/lib/progress-read.mjs";

export {
  PAID_ROUND_SERVICE_KIND,
  DOCUMENT_ENTITLEMENTS,
  ownedNotReady,
  nextStepOf,
  waitingOn,
  publicServiceKey,
  paidRoundOffer,
  roundNumber,
  scoresOfResult
} from "../pulse/beats/lib/progress-read.mjs";

/**
 * @param {object} db
 * @param {{orgId: string, clientId: string, now?: Date}} opts
 * @returns {Promise<object>} the contract payload, without the `ok` envelope.
 */
export async function readClientProgress(db, { orgId, clientId, now = new Date() } = {}) {
  return readProgressWith(db, { orgId, clientId, now, env: process.env });
}
