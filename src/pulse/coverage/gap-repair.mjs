// Credit repair breakage for the morning pulse. Read only.
// Workflow registry coverage stays in slice-15-repair.mjs. This file does not repeat it.
// Recon (AG-07) is the only tripwire. Do not add a second watchdog.
// Do not send bureau mail. Do not pull credit. Do not rewrite a dispute letter.
//
// Claude review 2026-10-08: the old file only fired on a card sitting in the
// literal "stalled" stage. Nothing moves a card there when its clock runs out;
// the desk shows its Stuck chip from the clock (src/repair/sla.mjs). A real paid
// file sat in "analysis" for 3 days with no case and no letters and this file
// said PASS. It now reads the same clocks the desk reads.
//
// Where the lines are drawn, so one stuck file is not reported twice:
//  - src/pulse/pipeline-motion.mjs ("pipeline:repair") already reds any card in
//    stalled, letters_generated, ready_to_send or response_received. This file
//    leaves those stages' clocks to it.
//  - repair-case-stuck reads files waiting on a person, a client or a bureau
//    (intake, awaiting_documents, in_transit, awaiting_response) and cases the
//    system itself marked stalled.
//  - repair-letter-round reads the letter engine: a file still in analysis past
//    its hour, an open case with items and no letter, or a card that says
//    letters were made and no letter exists.
//  - fulfillment:next-action (gap-fulfillment.mjs) reads the same late files for
//    the step the screen shows. It is a different symptom, not a copy.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). The SQL and the verdicts live in src/pulse/beats/lib/repair-desk-truth.mjs,
// so this morning lane and the hourly beat repair-trip judge with the same code. This file keeps the lane's
// entry (gapChecks) and the audit's re-check (naVerify), and hands them the reader.

import { stillOwnerHold } from "../owner-hold.mjs";
import { OWNER_HOLD_CODE, letterCheck, stuckCheck } from "../beats/lib/repair-desk-truth.mjs";

export * from "../beats/lib/repair-desk-truth.mjs";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/** The audit asks the lane to prove a "nothing to judge" row again: the same three reads, the same clock. */
export const naVerify = Object.freeze({
  [OWNER_HOLD_CODE]: async (args, ctx = {}) => {
    if (!args || args.check !== "repair-letter-round") return false;
    const db = ctx.db || null;
    const orgId = args.orgId || ctx.orgId || null;
    if (!db || typeof db.query !== "function" || !orgId) return false;
    const now = ctx.now instanceof Date ? ctx.now : new Date();
    return stillOwnerHold(await letterCheck(db, orgId, now), args);
  }
});

/**
 * Live credit-repair breakage. Two checks. SELECT only.
 * @param {{ db?: { query: Function }, orgId?: string, now?: Date }} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx) {
  const src = ctx && typeof ctx === "object" ? ctx : {};
  const db = src.db;
  const orgId = src.orgId;
  if (!db || typeof db.query !== "function" || !orgId) {
    return [
      check("repair-case-stuck", "skip", "no database — stuck repair cases not read", null),
      check("repair-letter-round", "skip", "no database — letter rounds not read", null)
    ];
  }
  const now = src.now instanceof Date ? src.now : new Date();
  return Promise.all([stuckCheck(db, orgId, now), letterCheck(db, orgId, now)]);
}
