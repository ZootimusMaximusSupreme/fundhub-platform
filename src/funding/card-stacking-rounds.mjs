// Card Stacking round emitter — staff advance funding_card_stacking cards;
// we emit the same canonical round.* events Lendflow does for Alt-Fin so
// money-chain + the 16 Inngest workflows fire unchanged.
//
// Stage map (funding_card_stacking only):
//   apply_now       → round.started
//   round_submitted → round.submitted
//   approved        → round.approved
//   action_required → (none)
//   funded          → round.funded  (hard-requires funded_amount > 0, AND every
//                     bank yes on the round either priced or explicitly excluded,
//                     AND at least one priced bank yes to bill against)
//   closed          → round.closeout  (staff closes ONE round; the engagement is
//                     complete only when the whole funding sequence closes)
//
// Idempotency key includes roundNumber so round 2 can re-enter the same stages.

import { emit } from "../events/bus.mjs";
import {
  resolveSuccessFee,
  sumConfirmedApprovals,
  listConfirmedApprovals,
  listExcludedApprovals,
  listUnpricedApprovals,
  unpricedApprovalNames,
  NO_CONFIRMED_APPROVALS
} from "./success-fee.mjs";

export const PIPELINE_KEY = "funding_card_stacking";
export const PRODUCT = "card_stacking";

/** stage key → canonical event name, or null for stage-only moves */
export const STAGE_TO_EVENT = Object.freeze({
  apply_now: "round.started",
  round_submitted: "round.submitted",
  approved: "round.approved",
  action_required: null,
  funded: "round.funded",
  closed: "round.closeout"
});

export function eventForStage(stageKey) {
  if (!stageKey) return null;
  return Object.prototype.hasOwnProperty.call(STAGE_TO_EVENT, stageKey)
    ? STAGE_TO_EVENT[stageKey]
    : null;
}

/**
 * Sum of confirmed approvals on a funding round — Approved applications that
 * carry a real recorded amount. Used here to PREFILL the funded amount when
 * staff omit it; the same number is also the fee basis under the 2026-08-30
 * decision (docs/finance/CLOSEOUT-FEE-BASIS.md). One definition, in success-fee.mjs.
 */
export async function sumApprovedApplications(db, fundingRoundId) {
  return sumConfirmedApprovals(db, { fundingRoundId });
}

export async function latestRoundForClient(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT * FROM funding_rounds
      WHERE org_id = $1 AND client_id = $2
      ORDER BY round_number DESC
      LIMIT 1`,
    [orgId, clientId]
  );
  return r.rows[0] || null;
}

/** One client's round. An explicitly requested round must never resolve to
 * another round: that would attach approvals and fee events to the wrong work. */
export async function roundFor(db, { orgId, clientId, roundNumber } = {}) {
  if (roundNumber != null) {
    const rn = Number(roundNumber);
    if (!Number.isInteger(rn) || rn <= 0) return null;
    const r = await db.query(
      `SELECT * FROM funding_rounds
        WHERE org_id = $1 AND client_id = $2 AND round_number = $3
        LIMIT 1`,
      [orgId, clientId, rn]
    );
    return r.rows[0] || null;
  }
  return latestRoundForClient(db, { orgId, clientId });
}

export async function nextRoundNumber(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT COALESCE(MAX(round_number), 0)::int AS max
       FROM funding_rounds
      WHERE org_id = $1 AND client_id = $2`,
    [orgId, clientId]
  );
  return (r.rows[0]?.max || 0) + 1;
}

function isPresent(v) {
  return v !== undefined && v !== null && v !== "";
}

/**
 * Funded means a separately recorded funded/available amount, NOT a bank's
 * approved limit. Never infer it from approvedAmount or Approved applications:
 * that silently marks an approval as funded and emits the event that starts
 * closeout, a success-fee invoice and client notifications.
 *
 * The explicit figure still needs operational/provider verification; a staff
 * entry is not proof of disbursement. Approved sums remain a UI suggestion and
 * the separately agreed success-fee basis, never a substitute for this input.
 */
export async function resolveFundedAmount(_db, { fundedAmount } = {}) {
  if (!isPresent(fundedAmount)) return null;
  const n = Number(fundedAmount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* The empty case of the rule below, phrased for a person.
   A round with NO bank yes at all is not a smaller version of a round with a
   blank approval on it — it is the same money leak with nothing on screen to
   point at, which is why it went unnoticed for a whole live walk. */
function noConfirmedApprovalRefusal() {
  return (
    "Cannot move to Funded — no bank on this round has said yes with a dollar " +
    "amount recorded against it. We bill a percent of the approvals that carry " +
    "an amount, so a round closed with no bank yes on it is a round this client " +
    "is never invoiced for. " +
    "Open the client's Funding tab, press Bank yes on the bank that approved and " +
    "type the amount in the Approved $ box beside it. " +
    "If no bank approved, this round did not fund — leave it where it is."
  );
}

/**
 * Every bank yes on the round that is still worth nothing on the bill, phrased
 * for a person. Empty list → nothing blocking.
 */
function missingAmountRefusal(names) {
  const one = names.length === 1;
  return (
    `Cannot move to Funded — ${one ? "1 bank approval has" : `${names.length} bank approvals have`} ` +
    `no dollar amount recorded: ${names.join(", ")}. ` +
    "We bill a percent of the approvals that have an amount on them, so an approval " +
    "left blank is money this client is never invoiced for. " +
    "Open the client's Funding tab, type the amount in the Approved $ box beside " +
    `${one ? "that bank" : "each bank"} and press Bank yes. ` +
    `If the approval was withdrawn or the client never used it, mark it as not counting instead — ` +
    "that is recorded against your name and lets this round close."
  );
}

/**
 * Guard: a funded move requires (a) no bank yes left without a dollar amount,
 * (b) at least one bank yes that DOES carry one, and (c) funded_amount > 0.
 *
 * (a) came second in time but comes FIRST here, and it is not overridable by
 * sending a funded amount. The success fee is a percent of approvals that carry
 * a recorded amount (docs/finance/CLOSEOUT-FEE-BASIS.md), so a round closing with a
 * blank approval on it is revenue that is never invoiced — and once the round
 * is closed nobody ever goes back for it. Staff can still close the round: they
 * either fill the amount in, or say on the record that the approval does not
 * count (setApprovalExclusion, src/applications/status.mjs).
 *
 * Returns { ok:true, fundedAmount } or
 * { ok:false, reason, message, suggestedFundedAmount, missingApprovals }.
 */
export async function guardFundedAmount(db, {
  orgId,
  clientId,
  fundedAmount,
  approvedAmount,
  roundNumber
} = {}) {
  const round = await roundFor(db, { orgId, clientId, roundNumber });
  if (!round) {
    return {
      ok: false,
      reason: "funding_round_not_found",
      message: "Cannot move to Funded — the specified funding round does not exist for this client.",
      suggestedFundedAmount: null,
      round: null
    };
  }

  // Already funded with a real amount — idempotent re-move may omit the body field.
  // Nothing below runs: re-parking a card on a column it already sits on must
  // not start refusing, or the board deadlocks on its own history.
  if (round && round.status === "funded" && Number(round.funded_amount) > 0) {
    return {
      ok: true,
      fundedAmount: Number(round.funded_amount),
      approvedAmount: round.approved_amount != null ? Number(round.approved_amount) : null,
      round,
      alreadyFunded: true
    };
  }

  /* A round with NO approvals at all is untouched by this — listUnpricedApprovals
     comes back empty. That hole is closed by the confirmed-approval rule that
     runs straight after it. */
  const unpriced = round?.id
    ? await listUnpricedApprovals(db, { orgId, fundingRoundId: round.id })
    : [];
  if (unpriced.length) {
    const names = unpricedApprovalNames(unpriced);
    return {
      ok: false,
      reason: "approval_amounts_missing",
      message: missingAmountRefusal(names),
      missingApprovals: unpriced.map((row) => ({
        applicationId: row.id,
        lenderId: row.lender_id || null,
        bank: String(row.bank || "").trim() || null
      })),
      missingApprovalBanks: names,
      suggestedFundedAmount: null,
      round
    };
  }

  /* AND THE EMPTY CASE — no bank yes on this round at all.
     Measured 2026-09-16 on the live walk: round 1 on Sim Eight-Funding had zero
     application rows, fell straight through the rule above, and was marked
     funded for $25,000 unopposed. Nothing was billed for it, and that refusal
     was correct — F-07 writes a named reason rather than a $0 invoice
     (docs/finance/CLOSEOUT-FEE-BASIS.md) — so the round simply closed for free.
     The fee is a percent of confirmed approvals. With none there is nothing to
     bill, so the door stays shut and the refusal says which box to type in.
     A blank approval already gets the better, bank-naming refusal above; this
     one only fires when there is nothing on the round at all. */
  const confirmed = round?.id
    ? await listConfirmedApprovals(db, { orgId, fundingRoundId: round.id })
    : [];
  /* THE ONE THING THIS RULE MUST NOT DO IS DEADLOCK THE ESCAPE.
     "Confirmed" deliberately leaves out an approval a human has marked as not
     counting. So a round where staff excluded EVERY approval also comes back
     empty here — and that round is one somebody has already looked at, written
     a reason against and decided bills nothing. Refusing it would lock the door
     the exclusion escape exists to open, and there would then be no way to close
     the round at all. It closes, and F-07 still writes a named reason instead of
     a $0 invoice (docs/finance/CLOSEOUT-FEE-BASIS.md).
     What is refused below is a round with NOTHING recorded on it — no bank yes
     anybody filled in and none anybody excluded. */
  const excused = confirmed.length
    ? []
    : (round?.id ? await listExcludedApprovals(db, { orgId, fundingRoundId: round.id }) : []);
  if (!confirmed.length && !excused.length) {
    return {
      ok: false,
      reason: NO_CONFIRMED_APPROVALS,
      message: noConfirmedApprovalRefusal(),
      suggestedFundedAmount: null,
      round
    };
  }

  const suggested = await sumApprovedApplications(db, round?.id);
  const resolved = await resolveFundedAmount(db, {
    fundingRoundId: round?.id,
    fundedAmount,
    approvedAmount
  });

  if (resolved == null || !(resolved > 0)) {
    return {
      ok: false,
      reason: "funded_amount_required",
      message:
        "Cannot move to funded without a funded amount greater than zero. " +
        "Enter funded_amount from separately verified available funding; a bank approval is not proof the client funded. " +
        (suggested != null
          ? `Approved applications total ${suggested} (reference only; not automatically funded).`
          : "No Approved application amounts found; enter the verified funded amount."),
      suggestedFundedAmount: suggested,
      round
    };
  }

  return {
    ok: true,
    fundedAmount: resolved,
    // No fallback to the funded amount. Calling money that funded an "approved
    // amount" is how the funded figure used to end up billed as an approval.
    // Nothing confirmed is null, and null means unknown (CLAUDE.md §12).
    approvedAmount: approvedAmount != null && Number(approvedAmount) > 0
      ? Number(approvedAmount)
      : suggested,
    round,
    alreadyFunded: false
  };
}

function buildPayload({
  stageKey,
  roundNumber,
  approvedAmount,
  fundedAmount,
  feePercent = null,
  saleId = null,
  fundingRoundId = null
}) {
  return {
    applicationId: null,
    stage: stageKey,
    lendflowStatus: null,
    approvedAmount: approvedAmount != null ? Number(approvedAmount) : null,
    fundedAmount: fundedAmount != null ? Number(fundedAmount) : null,
    offerCount: null,
    rail: "card_stacking",
    source: "card_stacking",
    product: PRODUCT,
    roundNumber,
    /* Closing a round is ONE round done, not the job done (owner, 2026-10-20). A
       funding sequence has about six rounds, and the whole engagement is complete
       only when the sequence closes. No control closes a sequence yet, so no round
       event claims it. The Closed column still says stage "closed", which is what
       N-04 and the inquiry gate read. */
    engagementComplete: false,
    // Only round.funded carries these three, and only they make an invoice
    // possible. Without feePercent, F-07 made a task instead of a bill for
    // every funded round this system has ever had. In PERCENT UNITS: 10 = 10%.
    feePercent,
    saleId,
    fundingRoundId
  };
}

/**
 * Emit the canonical round.* event for a Card Stacking stage transition.
 * Caller is responsible for the funded-amount guard before move+emit.
 */
export async function emitCardStackingRoundTransition(db, {
  orgId,
  clientId,
  stageKey,
  roundNumber,
  approvedAmount = null,
  fundedAmount = null
} = {}) {
  const eventName = eventForStage(stageKey);
  if (!eventName) {
    return { emitted: false, reason: "stage_only", eventName: null };
  }
  if (!orgId || !clientId) {
    return { emitted: false, reason: "missing_ids", eventName };
  }

  let rn = roundNumber != null ? Number(roundNumber) : null;
  if (roundNumber != null && (!Number.isInteger(rn) || rn <= 0)) {
    return { emitted: false, reason: "invalid_round_number", eventName };
  }
  if (eventName === "round.started") {
    if (rn == null || !(rn > 0)) {
      // Re-parking on apply_now during an open round must reuse that round
      // number (idempotent). Only allocate N+1 after funded/closed (or first).
      const latest = await latestRoundForClient(db, { orgId, clientId });
      const status = latest ? String(latest.status || "") : "";
      if (latest && status !== "funded" && status !== "closed") {
        rn = Number(latest.round_number);
      } else {
        rn = await nextRoundNumber(db, { orgId, clientId });
      }
    }
  } else if (rn == null || !(rn > 0)) {
    const latest = await latestRoundForClient(db, { orgId, clientId });
    rn = latest ? Number(latest.round_number) : 1;
  }

  /* round.funded is the billing event, so it carries the billing facts, read
     from the database at the moment of funding and frozen on the event:

       approvedAmount  the CONFIRMED approvals total — the fee basis
       feePercent      the rate agreed on this client's sale, in percent units
       saleId          } together these two are F-07's idempotency key, which
       fundingRoundId  } is what stops a replay billing the client twice

     Every one of these was missing before, which is why no funded round has
     ever produced an invoice. approvedAmount here is deliberately NOT the
     caller's typed roll-up: only a bank yes with a recorded amount is a
     confirmed approval, and nothing confirmed means null, never the funded
     amount and never zero. */
  const billing = eventName === "round.funded";
  // Defense in depth: this exporter may be called without moveCardToStage's guard.
  // Do not publish a billable event from an approval-only/empty funded amount.
  if (billing && (!isPresent(fundedAmount) || !Number.isFinite(Number(fundedAmount)) || Number(fundedAmount) <= 0)) {
    return { emitted: false, reason: "funded_amount_required", eventName, roundNumber: rn };
  }
  let fee = { confirmedApprovedAmount: null, feePercent: null, saleId: null, fundingRoundId: null };
  if (billing) {
    const row = await roundFor(db, { orgId, clientId, roundNumber: rn });
    if (!row) {
      // Never emit a round.funded event for a missing/stale round number. Its
      // idempotency key would describe one round while its billing evidence
      // came from another (the previously implicit latest-round fallback).
      return { emitted: false, reason: "funding_round_not_found", eventName, roundNumber: rn };
    }
    const resolved = await resolveSuccessFee(db, { orgId, fundingRoundId: row.id });
    fee = { ...resolved, fundingRoundId: row.id };
  }

  const payload = buildPayload({
    stageKey,
    roundNumber: rn,
    approvedAmount: billing ? fee.confirmedApprovedAmount : approvedAmount,
    fundedAmount,
    feePercent: fee.feePercent,
    saleId: fee.saleId,
    fundingRoundId: fee.fundingRoundId
  });

  const idempotencyKey = `card_stacking:${clientId}:${rn}:${stageKey}:${eventName}`;
  const res = await emit(db, eventName, payload, {
    orgId,
    clientId,
    idempotencyKey
  });

  return {
    emitted: true,
    eventName,
    roundNumber: rn,
    payload,
    id: res.id,
    deduped: res.deduped,
    idempotencyKey
  };
}
