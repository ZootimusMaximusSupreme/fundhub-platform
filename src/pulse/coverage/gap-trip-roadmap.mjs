// Coverage batch 2026-10-10, workflow W8 "Whole trips" (level L4).
//
//   trip:roadmap   Did every buyer who paid for the $297 roadmap in the last 60 days get every step
//                  the company owes, and what is the first step that is missing?
//
// THE LADDER (the brief's order).
//
//    1 roadmap_paid       client   paid the roadmap (payment_links, purpose diagnostic, link slo_*)
//    2 pull_form_filled   client   filled the pull form (payment_links.identity_stored_at), or a
//                                  credit file is already on record
//    3 pack_delivered     system   the pack is saved whole and the pack-ready email was queued
//    4 portal_sign_in     client   signed in to the portal
//
// Every judgement below is the one another lane already makes, so the trip and those lanes cannot
// disagree:
//   * the reminder owed to a buyer who has not filled the form after 2 hours is gap-soft-pull.mjs
//     (PAID_FORM_HOURS, NUDGE_KEYS, NUDGE_DEAD_STATUSES), and a buyer on a company, test or bot address
//     is owed none (classifyVisitor, the same call that lane makes);
//   * the pack is due 2 hours after the credit pull finished (gap-underwrite.mjs GRACE_MS), and "whole"
//     and "told" are judgePackFiles and judgePackEmail from that file, called on this buyer's row;
//   * a buyer who has held access for 72 hours and never signed in is portal:paid-client-never-signed-in
//     (gap-portal.mjs SIGN_IN_GRACE).
//
// WHAT IS RED (and only this):
//   * a paid buyer is past 2 hours with an empty form and no reminder went out;
//   * the credit pull finished 2 hours ago and no pack file was saved;
//   * a saved pack older than 30 minutes is not whole (a promised file is missing, a file is empty or
//     came from the short printer, the free map is missing), or no pack-ready email was queued;
//   * access has been held for 72 hours and the buyer never signed in.
//
// WHAT IS NEVER RED: a buyer who has not filled the form yet (inside 2 hours, or reminded), a pack
// whose only gap is a summary this run cannot say is owed, a buyer who signed in.
//
// READ ONLY. One SELECT. ctx.db is a shared pool: never BEGIN, COMMIT, ROLLBACK or SET here. No web
// call, no text, no email, no credit pull, no AI call. A failed read is a skip with the reason.

// ONE JUDGE, TWO CLOCKS (2026-10-20). The trip's SQL, ladder and verdict live in
// src/pulse/beats/lib/roadmap-trip-truth.mjs, so this lane and the hourly beat roadmap-delivery give
// the same verdict. This file reads the rows and hands them to the judge.

import {
  clip, nowOf, readRows, runnerOf, skipWhy
} from "./money-reads.mjs";
import { skipRow } from "./trip-kit.mjs";
import { ID, TRIP_SQL, judgeRoadmap, tripParams } from "../beats/lib/roadmap-trip-truth.mjs";

export * from "../beats/lib/roadmap-trip-truth.mjs";

/**
 * @param {{ db?: object, scope?: Function, orgId?: string, now?: Date }} [ctx]
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the roadmap trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  try {
    const got = await readRows(run, ID, "the roadmap trips", TRIP_SQL, tripParams(orgId, now));
    if (got.skip) return [got.skip];
    return [judgeRoadmap({ rows: got.rows, now })];
  } catch (err) {
    return [skipRow(ID, `could not judge the roadmap trips: ${clip(err)}`)];
  }
}

