// The facts behind the boards: is each card in the stage the facts say, did each card move fire
// its event, do the two records that hold one fact agree. Report only. Read only.
// Never moves a card. Never texts. Never charges. Never pulls credit.
//
// Built for the 2026-10-10 coverage batch, workflow W3 "Pipelines truth".
// Board: ops/workflows/coverage-every-surface-2026-10-10.md, section 3 (P2, P4, P7).
// The shape half (columns count true, ages, dead stages, nobody lost) is gap-pipeline-boards.mjs.
//
//   pipeline:stage-vs-fact   P2  a card is in the stage the real facts say (paid, booked, funded,
//                                case cleared, partner status, invoice status)
//   pipeline:move-receipt    P4  every Funding card move in the last day fired its round event, and
//                                the event's result is there
//   pipeline:two-records     P7  funding round vs funding card, repair case vs repair card, Sales
//                                floor vs Sales board
//
// A card sits where a person or a handler put it. These checks never trust the card. They read the
// fact the card is meant to follow and say where the two disagree.
//
// The brief lists "funding_rounds.status vs the card" and "dispute_cases.status vs the repair card" in
// both P2 and P7. Each is written once here. P2 holds the Funding fact (a funded round, a funded
// card). P7 holds the repair case ladder and the Funding rounds that have no card (and cards that have
// no round), which P2 cannot see because it needs both rows.
//
// What is not invented: "paid" is the two marks the deposit.paid and sale.closed handlers stamp on the
// client (custom_fields.deposit_paid, custom_fields.sale_closed) or an active sale in a client product.
// payment.received alone is not a deposit: the $32 diagnostic fires it too, and that client belongs on
// Diagnostic Paid.

//
// ONE JUDGE, TWO CLOCKS (2026-10-20). The SQL and the verdicts live in
// src/pulse/beats/lib/pipeline-facts-truth.mjs, so this morning lane and the hourly beat
// pipeline-boards judge with the same code. This file only hands the lane its reader: ctx.db (the
// plain role the read routes use) when it has one, else the staff scope. It never sends BEGIN,
// COMMIT or SET on the shared pool.

import { runFactsChecks } from "../beats/lib/pipeline-facts-truth.mjs";

export * from "../beats/lib/pipeline-facts-truth.mjs";

/** ctx.db is what the read routes use (the plain role). The staff scope is only the fallback. */
function bind(ctx) {
  if (ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  if (typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  return null;
}

/**
 * Morning-pulse rows for the facts behind the boards.
 * ctx: { db, scope, now, orgId }. SELECT only. No POST. Nothing is sent.
 */
export async function gapChecks(ctx = {}) {
  return runFactsChecks({ run: bind(ctx), orgId: ctx.orgId, now: ctx.now });
}
