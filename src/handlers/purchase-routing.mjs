// purchase-routing — the missing first link in the event chain.
//
// THE PROBLEM THIS EXISTS FOR. Fundhub is event-based: landing a card on
// funding_card_stacking / apply_now emits round.started, which assigns the
// funding advisor, provisions the inbox and messages the client. That cascade
// already works. Nothing, however, listened for the PAYMENT and performed the
// move, so a human had to drag the card. When nobody did, no advisor was
// assigned, the client's portal never moved, and the 24-hour guarantee ran out
// unnoticed — the first automatic warning being "deals going cold" seven days
// later, on a screen only the sales manager opens.
//
// WHY A SEPARATE HANDLER AND NOT A FEW LINES INSIDE money-chain. The bus
// (src/events/bus.mjs) wraps each handler in its own try/catch and dead-letters
// its failures individually. Inline, a throw here would reject out of
// recordPurchase AFTER the sale and payment rows had already committed. Kept
// separate, a failure to place a card cannot damage the money record — it lands
// in failed_events where /api/read/failed-events shows it.
//
// HOW THE FOUR SITUATIONS ARE TOLD APART — owner's routing rule, and the two
// signals it needs. These answer different questions and BOTH are required:
//
//   1. WHAT THEY BOUGHT -> products.category on ACTIVE, NET-PAID sales.
//      'funding' and 'repair' are the two categories that own a board. This is
//      the same basis money-chain.mjs:818 already routes on ("the most recent
//      ACTIVE sale whose product category is 'funding'"), and
//      db/migrations/181 was written around it on purpose: funding-mastery is
//      a $5,000 course filed under 'consulting' precisely so it is NOT a
//      funding signal. Category, not product code: REPAIR_PRODUCT_CODES in
//      src/affiliates/economics.mjs lists only 'repair-bundle', so routing on
//      it would silently give the $200 'repair-trial' buyer no repair card at
//      all. Category catches both.
//
//   2. WHETHER FUNDING IS STILL OWED -> clients.outcome_tier via
//      isFundingPath() (src/config/product-path.mjs), the existing notion of
//      which path a client is on. It cannot decide which boards they belong on
//      by itself: it is the CRS recommendation, not a purchase, so it reads the
//      same for someone who bought funding and someone who only signed for it.
//      Its one job here is separating "both active" from "repair now, funding
//      later" once the purchases are known.
//
//   bought funding, no repair          -> funding board, apply_now
//   bought repair, not on funding path -> repair board, intake
//   bought both                        -> both boards; funding card starts held
//   bought repair, on the funding path -> repair board + client:funding tag,
//                                         and NO funding card
//
// Never funding_altfin (cards move there only from Lendflow webhooks) and never
// inquiry_removal (it starts itself — src/handlers/inquiry-gate.mjs).
//
// AND, SINCE 2026-09-06, THE REPAIR PROGRAM ITSELF. A funding card lands on
// apply_now and round.started fans out from there into an advisor, an inbox and
// a message to the client. The repair card landed on intake and fanned out into
// nothing, so a repair buyer got a card and silence — no rounds, no document
// request, no welcome, no task. src/workflows/repair-enrollment.mjs is that
// missing fan-out and this handler calls it last.
//
// SAFE TO FIRE TWICE. State is re-derived from the sales table on every event,
// never from the payload, and a card is placed ONLY when the client has no card
// on that pipeline yet. A replayed event, a duplicated webhook or a second
// payment on the same sale therefore finds the card already there and does
// nothing. That same rule is what stops a client sitting on `funded` being
// dragged back to `apply_now` by a late installment payment.

import { on } from "../events/registry.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { clientOutcomeTier, isFundingPath } from "../config/product-path.mjs";
import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { addTags } from "../workflows/tags.mjs";
import { FUNDING_PAUSED_HOLD } from "../inquiry-ops/doc-gate.mjs";
import { PAUSED_TAG } from "../crs/snapshot-negatives.mjs";
import { ensureRepairEnrollment } from "../workflows/repair-enrollment.mjs";

/** One greppable line per bail. */
export const NO_ROUTE = "[purchase-routing] no route";

export const FUNDING_PIPELINE = "funding_card_stacking";
export const FUNDING_STAGE = "apply_now";
export const REPAIR_PIPELINE = "optimization";
export const REPAIR_STAGE = "intake";

/** The tag S-06 and F-01 already use for "this is a funding client". */
export const FUNDING_TAG = "client:funding";

/** products.category values that own a board. */
export const FUNDING_CATEGORY = "funding";
export const REPAIR_CATEGORY = "repair";

/** The payment events that can start fulfilment.
 *  diagnostic.paid is deliberately absent: the $32 soft pull happens BEFORE the
 *  decision, so routing on it would put every lead on a fulfilment board.
 *  round.started / round.funded are absent too — round.started is what this
 *  handler causes, and subscribing to it would be a loop. */
export const ROUTED_EVENTS = Object.freeze([
  "deposit.paid",
  "sale.closed",
  "payment.received"
]);

function bail(event, reason, extra = "") {
  console.warn(
    `${NO_ROUTE}: ${reason} (event=${event?.name || "?"} org=${event?.orgId || "?"}` +
    `${extra ? ` ${extra}` : ""}). Money was recorded; no card was placed.`
  );
  return { routed: false, reason };
}

/* Find the client WITHOUT creating one. resolveClient() in client-lifecycle
   mints a row when the email is new, which is right for the money chain and
   wrong here — this handler runs after it, so the client already exists, and
   inventing one on a stray payment would put a phantom on a board. */
export async function findClient(db, event) {
  if (event?.clientId) return event.clientId;
  const orgId = event?.orgId;
  const email = String(event?.payload?.email || "").trim().toLowerCase();
  if (!orgId || !email) return null;
  const r = await db.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  );
  return r.rows[0]?.id || null;
}

/** What this client has actually PAID for, by product category.
 * An active sale can be just a signed offer. It may not start fulfillment
 * until net front-end money is positive on that same sale.
 * A $32 diagnostic, success fee, or fully refunded purchase cannot qualify.
 * Money-chain writes the payment first; this handler runs afterward.
 */
export async function purchasedCategories(db, orgId, clientId) {
  const r = await db.query(
    `SELECT DISTINCT pr.category AS category
       FROM sales s
       JOIN products pr ON pr.id = s.product_id
      WHERE s.org_id = $1 AND s.client_id = $2 AND s.status = 'active'
              AND EXISTS (
                SELECT 1 FROM sale_payments sp
                WHERE sp.org_id = s.org_id AND sp.sale_id = s.id
                GROUP BY sp.sale_id
                HAVING COALESCE(SUM(CASE
                  WHEN sp.kind IN ('deposit', 'installment') THEN sp.amount
                  WHEN sp.kind = 'refund' THEN -sp.amount
                  ELSE 0
                END), 0) > 0
              )`,
    [orgId, clientId]
  );
  const categories = new Set(r.rows.map((row) => String(row.category || "")));
  return {
    funding: categories.has(FUNDING_CATEGORY),
    repair: categories.has(REPAIR_CATEGORY),
    categories: [...categories].sort()
  };
}

/** Does this client already have a card on this board? */
export async function hasCardOnPipeline(db, orgId, clientId, pipelineKey) {
  const r = await db.query(
    `SELECT c.id
       FROM cards c
       JOIN pipelines p ON p.id = c.pipeline_id
      WHERE c.client_id = $1 AND p.key = $2 AND p.org_id = $3
      LIMIT 1`,
    [clientId, pipelineKey, orgId]
  );
  return !!r.rows[0];
}

/* Place a card only if the board has none for this client.
   This is the whole of the idempotency and the whole of the never-move-backwards
   rule: moveCardToStage is a find-or-create plus a plain UPDATE, so it would
   happily drag a `funded` card back to `apply_now`. It is never asked to.

   A refusal that is not "already there" means the board itself is wrong (the
   pipeline or stage is missing from the seed). That throws, so the bus
   dead-letters it and it shows up on the failed-events screen, instead of being
   swallowed into a {routed:false} nobody reads. */
async function placeCard(db, { orgId, clientId, pipelineKey, stageKey }) {
  if (await hasCardOnPipeline(db, orgId, clientId, pipelineKey)) {
    return { placed: false, reason: "already_on_board" };
  }
  // No amounts passed on purpose. apply_now and intake need none, and an
  // unknown amount must stay NULL rather than becoming a zero (CLAUDE.md §12).
  const move = await moveCardToStage(db, { orgId, clientId, pipelineKey, stageKey });
  if (!move.moved) {
    throw new Error(
      `purchase-routing: could not place ${pipelineKey}/${stageKey} for client ${clientId} ` +
      `(${move.reason}${move.message ? `: ${move.message}` : ""})`
    );
  }
  return { placed: true, created: move.created === true, roundEvent: move.roundEvent || null };
}

/* Hold a brand-new funding card. The owner's rule for a client who bought both:
   both boards, but the funding card starts held and releases when repair clears
   the bureau that matters.

   The hold is the one that already exists — clients.custom_fields
   .round_hold_reason = "Funding Paused" plus the funding:paused tag — so the
   existing release path (src/crs/snapshot-negatives.mjs clears both on a clean
   snapshot) picks it up with nothing new invented. moveCardToStage allows
   apply_now while held on purpose, so the card still lands; every stage after it
   is refused until the hold clears.

   Only set when NOTHING is holding them yet. Overwriting a live hold reason
   ("New Inquiries", "Awaiting CRS") would destroy why they are actually held. */
async function holdNewFundingCard(db, clientId) {
  const r = await db.query(
    `SELECT COALESCE(custom_fields->>'round_hold_reason', '') AS reason
       FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  const existing = String(r.rows[0]?.reason || "").trim();
  if (existing) return { held: false, reason: `existing_hold:${existing}` };
  await mergeCustomFields(db, clientId, {
    round_hold_reason: FUNDING_PAUSED_HOLD,
    employee_next_action: "Clear repair before funding"
  });
  await addTags(db, clientId, [PAUSED_TAG]);
  return { held: true, reason: FUNDING_PAUSED_HOLD };
}

/* onPurchaseRoute — a payment landed; put the client on the board that pays for
   the work. Errors are allowed to escape: the bus dead-letters them. */
export async function onPurchaseRoute(event, db) {
  const orgId = event?.orgId;
  if (!orgId) return bail(event, "no_org");

  const clientId = await findClient(db, event);
  if (!clientId) return bail(event, "no_client");

  const bought = await purchasedCategories(db, orgId, clientId);
  if (!bought.funding && !bought.repair) {
    return bail(event, "no_product_path", `client=${clientId} categories=${bought.categories.join("|") || "none"}`);
  }

  // Read before writing anything: whether the funding card is NEW decides
  // whether the both-active hold applies. A client already mid-funding who buys
  // repair months later must not be paused by this.
  const fundingCardExists = bought.funding
    ? await hasCardOnPipeline(db, orgId, clientId, FUNDING_PIPELINE)
    : false;

  const out = {
    routed: false,
    clientId,
    bought: { funding: bought.funding, repair: bought.repair },
    repairCard: null,
    repairProgram: null,
    fundingCard: null,
    hold: null,
    fundingTag: null,
    reason: null
  };

  if (bought.repair) {
    out.repairCard = await placeCard(db, {
      orgId, clientId, pipelineKey: REPAIR_PIPELINE, stageKey: REPAIR_STAGE
    });
  }

  if (bought.funding) {
    // Both active and the funding card is being created now: hold it first, so
    // it is held from the moment it lands rather than a query later.
    if (bought.repair && !fundingCardExists) {
      out.hold = await holdNewFundingCard(db, clientId);
    }
    out.fundingCard = await placeCard(db, {
      orgId, clientId, pipelineKey: FUNDING_PIPELINE, stageKey: FUNDING_STAGE
    });
  } else {
    // Repair now, funding signed for later: the repair board only, plus the tag
    // that says funding is still owed, so it is picked up afterwards.
    const tier = await clientOutcomeTier(db, clientId);
    if (isFundingPath(tier)) {
      await addTags(db, clientId, [FUNDING_TAG]);
      out.fundingTag = FUNDING_TAG;
    }
    out.outcomeTier = tier;
  }

  /* A CARD IS NOT A PROGRAM. Placing the optimization card was, until now, the
     whole of what a repair purchase caused: no enrolment, no rounds, no
     document request, no email, no task. The $1,000 client measured on
     2026-09-06 had a card and nothing else, because the only thing that has
     ever opened a repair program is a button on a screen that lists clients who
     are already enrolled.

     LAST ON PURPOSE. Both boards and the funding tag are settled before this
     runs, so if enrolment throws — and it is allowed to, the bus dead-letters
     it onto /api/read/failed-events — the routing above is already durable and
     a re-dispatch simply finds the cards in place and tries the program again.

     Funding has no equivalent call because round.started already fans out into
     F-01 and the advisor assignment. Repair had no such fan-out at all. */
  if (bought.repair) {
    out.repairProgram = await ensureRepairEnrollment(db, {
      orgId, clientId, eventId: event?.id || null
    });
  }

  out.routed = !!(
    out.repairCard?.placed ||
    out.fundingCard?.placed ||
    out.fundingTag ||
    out.repairProgram?.enrolled ||
    out.repairProgram?.tasks?.count
  );
  if (!out.routed) out.reason = "nothing_to_do";
  return out;
}

export function register() {
  for (const name of ROUTED_EVENTS) on(name, onPurchaseRoute);
}
