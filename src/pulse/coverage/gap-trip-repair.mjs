// The credit-repair trip, start to end, for the morning pulse. Report only. Read only.
// Coverage batch 2026-10-10, workflow W8 "Whole trips" (level L4).
//
//   trip:repair   Did every customer who bought a repair plan in the last 60 days get every step
//                 the company owes in round 1, and what is the first step that is missing?
//
// THE LADDER (the brief's order). Who owes each step, and where its fact is read.
//
//    1 repair_purchase  client   an active sale in a repair product, or a paid repair payment link
//    2 enrolled         system   the repair program row (repair_programs; purchase-routing opens it)
//    3 documents_in     client   the ID was read and accepted (pii_identity.verified_legal_name)
//    4 letters_made     system   a round 1 dispute letter exists (dispute_letters)
//    5 letters_mailed   person   a round 1 letter was mailed (dispute_letters.mailed_at)
//    6 answer_read      client   a bureau answer was read and confirmed (dispute_responses.confirmed)
//    7 round_complete   system   the card reached Round Complete, or a later round has letters
//
// WHAT IS RED:
//   * enrolled is missing 1 hour after the purchase (the same hour the Funding card gets);
//   * letters_made is missing 1 hour after the LAST of the three things the letter engine needs
//     (an ID read, a credit file, a signed repair agreement or a live dispute authorization). That
//     is the engine's own clock, STAGE_SLA.analysis. Before all three exist the customer is waiting
//     on themselves, and nothing is red;
//   * round_complete is missing 15 minutes after the answer was confirmed;
//   * the file sits in a stage past the desk's own clock (src/repair/sla.mjs isBreached), or in
//     Stalled, which is the automation's "a person must move this" stage. The trip says WHICH step
//     the file is stuck at; the pipeline:repair and repair-case-stuck rows say the same thing from
//     the stage's side;
//   * a letter was made with no ID read, after 2026-09-06 (the day the letters were gated on a
//     verified name). Letters must carry the name off an ID, never a typed name.
//
// WHAT IS NEVER RED: a customer who has not sent the documents yet, a file waiting on the person
// who presses Send letters, a file waiting for the bureau's answer inside its clock.
//
// READ ONLY. One SELECT. ctx.db is a shared pool: never BEGIN, COMMIT, ROLLBACK or SET here. No web
// call, no text, no email, no letter mailed, no credit pull, no AI call. A failed read is a skip.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). The SQL and the verdict live in src/pulse/beats/lib/repair-trip-truth.mjs,
// so this morning lane and the hourly beat repair-trip judge with the same code. This file only hands the
// lane its reader.

import { clip, nowOf, readRows, runnerOf, skipWhy } from "./money-reads.mjs";
import { skipRow } from "./trip-kit.mjs";
import { CHECK_IDS, TRIP_SQL, judgeRepairWithHolds, tripParams } from "../beats/lib/repair-trip-truth.mjs";

export * from "../beats/lib/repair-trip-truth.mjs";

const ID = CHECK_IDS[0];

async function tripRow(run, orgId, now) {
  const got = await readRows(run, ID, "the repair trips", TRIP_SQL, tripParams(orgId, now));
  if (got.skip) return got.skip;
  return judgeRepairWithHolds({ rows: got.rows, now });
}

/**
 * @param {{ db?: object, scope?: Function, orgId?: string, now?: Date }} [ctx]
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the repair trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  try {
    return [await tripRow(run, orgId, now)];
  } catch (err) {
    return [skipRow(ID, `could not judge the repair trips: ${clip(err)}`)];
  }
}
