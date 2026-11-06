// Paying for the Capital Blueprint creates the client's checklist.
//
// THE OWNER'S RULE THIS SERVES (Chris, 2026-09-17, verbatim): "I think paying
// for the blueprint should create the client checklist. In my opinion, once
// you've paid for it, the payment process generates waypoints — essentially
// step-by-step instructions like 'do this, do this, do this.' It's a process
// where clients check things off before moving forward. Otherwise, they'll get
// overwhelmed."
//
// WHAT WAS TRUE BEFORE THIS FILE. seedClientWaypoints() had exactly ONE caller
// in the product — src/repair/enroll.mjs:166 — so only a client who enrolled in
// a REPAIR program ever got a checklist. A Capital Blueprint buyer got none.
// Measured on production 2026-09-17: Sim Eleven-Blueprint
// (029964c5-4d8e-47ed-88c9-53ac13863fd4) paid $5,000, and holds zero rows in
// client_waypoints. All three clients anywhere in production who have any
// waypoints at all are repair clients.
//
// WHY THE CATALOG FITS. db/migrations/362_waypoint_definitions_seed.sql says in
// its own header that these six tasks ARE the client's own steps out of the
// Credit Optimization Roadmap (scripts/black-reports/fundhub_gen.py). The
// roadmap is the Capital Blueprint's deliverable — it is literally the
// entitlement the Blueprint grants, 'credit-optimization-roadmap'
// (db/migrations/383_blueprint_entitlement.sql). So the Blueprint buyer is the
// person these waypoints were written for. Nothing new is invented here; the
// existing catalog is handed to the existing seeder.
//
// NOTHING IS INVENTED FOR A THIN FILE. seedClientWaypoints() reads the client's
// freshest real credit file itself and expandDefinitions() drops any per-card
// step when there are no cards. A Blueprint buyer whose credit has never been
// pulled gets the steps that need no file (the LLC, the business checking
// account, the EIN, the personal loan, the no-new-credit rule) and simply does
// not get a paydown row. A paydown target is a number off a bureau file; with
// no file there is no number, and NULL means unknown and must survive.

import { seedClientWaypoints } from "./seed.mjs";
import { assignCsmForBlueprintPurchase } from "../blueprint/assign-csm.mjs";
import { OFFERS } from "../config/offers.mjs";
/* 'succeeded' is the whole set of paid statuses. Imported rather than retyped —
   src/entitlements/entitlements.mjs owns that fact and writes down why. */
import { PAID_TRANSACTION_STATUS } from "../entitlements/entitlements.mjs";

/* The product code that buys the roadmap. Read off the offer catalogue rather
   than typed here, because the catalogue is where the owner changes it and a
   second copy of a product code is exactly the defect
   db/migrations/384_diy_letter_pack_product.sql was written to close. Today it
   is 'consulting-package'. */
export const BLUEPRINT_PRODUCT_CODE = OFFERS.UWIQ_DELIVERABLES.productCode;

/* Which products create a checklist. ONE product today, and it is a Set rather
   than an equality test only so that adding the second one is a one-word edit
   instead of a refactor. It is NOT configuration and there is no table behind
   it — nobody has asked for one. */
const CHECKLIST_PRODUCT_CODES = new Set([BLUEPRINT_PRODUCT_CODE, OFFERS.BLUEPRINT_SELF_FUNDING.productCode]);

/** Does buying this product create the client's checklist? */
export function productCreatesChecklist(productCode) {
  const code = String(productCode || "").trim().toLowerCase();
  return !!code && CHECKLIST_PRODUCT_CODES.has(code);
}

/**
 * Build the checklist for a purchase. BEST-EFFORT: never throws.
 *
 * This is the shape src/repair/enroll.mjs:166 already uses, copied deliberately
 * rather than re-reasoned. By the time this runs the payment is taken, the sale
 * row is written and the entitlement is granted. A checklist that could not be
 * built is a checklist to fix — never a reason to lose somebody's payment,
 * their entitlement or their receipt. So the failure is REPORTED in the return
 * value and the caller carries on.
 *
 * IDEMPOTENT, and the idempotence is not added here — it is inherited.
 * client_waypoints carries UNIQUE (client_id, key), upsertWaypoint() is an
 * ON CONFLICT DO UPDATE that deliberately does not touch `state` or
 * `completed_at`, and a paydown row is matched to its card by params rather than
 * by key. So a replayed payment event, a reconcile pass run twice, and a
 * backfill run after both of them all land on the SAME rows. Nothing re-opens a
 * step the client already ticked off.
 *
 * @returns {Promise<object>} the seeder's result, or
 *   { ok: false, seeded: [], error } on failure, or
 *   { ok: true, seeded: [], skipped: 'not_a_checklist_product' } when the
 *   product does not create one.
 */
export async function seedChecklistForPurchase(db, {
  orgId, clientId, productCode, now = undefined
} = {}) {
  if (!productCreatesChecklist(productCode)) {
    return { ok: true, seeded: [], skipped: "not_a_checklist_product" };
  }
  if (!orgId || !clientId) {
    return { ok: false, seeded: [], error: "orgId and clientId are required" };
  }
  const csmAssign = await assignCsmForBlueprintPurchase(db, { orgId, clientId, productCode })
    .catch((err) => ({ assigned: false, error: String(err?.message || err) }));

  const args = { orgId, clientId, blueprintDisputeSteps: true };
  if (now !== undefined) args.now = now;
  const seeded = await seedClientWaypoints(db, args)
    .catch((err) => ({ ok: false, seeded: [], error: String(err?.message || err) }));
  return { ...seeded, csmAssign };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BACKFILL — people who already paid.

   WHY IT HAS TO EXIST, and it is the same reason
   src/entitlements/entitlements.mjs reconcileFromTransactions() has to exist.
   The checklist is written ONCE, at the moment a payment is processed. Shipping
   the hook above therefore gives a checklist to nobody who has already paid.
   Measured on production 2026-09-17: one Capital Blueprint buyer, zero
   waypoints.

   WHY IT IS A SEPARATE FUNCTION AND NOT A LINE INSIDE reconcileFromTransactions.
   That function is the entitlements LEDGER reconciler. Its whole documented
   contract is "make the ledger agree with the mapping table", it is INSERT-only
   against one table, and every safety claim in its header is about grants. A
   checklist is not a grant, it lives in a different table, and folding it in
   would mean an operator who wanted to fix one person's entitlements silently
   rewrote their checklist too. So this mirrors that function's SHAPE — same
   resolver, same succeeded-only filter, same additive promise, same
   scope-to-one-client argument — and stays its own call. An operator runs both,
   in either order, as many times as they like.

   THE PRODUCT IS IDENTIFIED BY resolve_product_id(), the shipped resolver from
   db/migrations/010_products.sql — current product name first, then any alias.
   NEVER by the dollar amount. A transaction whose product_name matches nothing
   is counted and left alone; inventing a product for it would be guessing what
   somebody bought.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Give a checklist to every client who already paid for one.
 *
 * ADDITIVE AND RE-RUNNABLE. It calls the same seeder the live purchase path
 * calls, so it inherits the same idempotence: running it twice, or running it
 * after the live hook has already fired, leaves ONE checklist and never
 * re-opens a finished step.
 *
 * Scope it to one client with `clientId`, or leave it out for the whole org.
 *
 * `dryRun: true` resolves and counts exactly as a real run does and writes
 * NOTHING — so the preview is the real answer, not a guess at it.
 *
 * @returns {Promise<{scanned:number, clients:number, seeded:Array, failed:Array,
 *                    unresolved:Array, dryRun:boolean}>}
 *   `failed` and `unresolved` are the two honest gaps: a client whose checklist
 *   could not be built, and a payment whose product name matches no product.
 */
export async function backfillPurchaseChecklists(db, {
  orgId, clientId = null, now = undefined, dryRun = false
} = {}) {
  if (!orgId) throw new Error("backfillPurchaseChecklists: orgId is required");

  const { rows } = await db.query(
    `SELECT t.id AS transaction_id,
            t.client_id,
            t.product_name,
            p.code AS product_code
       FROM transactions t
       LEFT JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
      WHERE t.org_id = $1
        AND lower(btrim(COALESCE(t.status, ''))) = $3
        AND t.client_id IS NOT NULL
        AND ($2::uuid IS NULL OR t.client_id = $2::uuid)
      ORDER BY t.created_at`,
    [orgId, clientId, PAID_TRANSACTION_STATUS]
  );

  const out = {
    scanned: rows.length, clients: 0, seeded: [], failed: [], unresolved: [],
    dryRun: !!dryRun
  };
  const done = new Set();

  for (const r of rows) {
    if (!r.product_code) {
      out.unresolved.push({
        transactionId: r.transaction_id,
        clientId: r.client_id,
        productName: r.product_name
      });
      continue;
    }
    if (!productCreatesChecklist(r.product_code)) continue;
    /* One client who bought the Blueprint twice is seeded once. The second call
       would be harmless — the seeder is idempotent — but a second pass over the
       same rows is work nobody needs and it would double-count the report. */
    const key = String(r.client_id);
    if (done.has(key)) continue;
    done.add(key);
    out.clients += 1;

    if (dryRun) {
      out.seeded.push({ clientId: r.client_id, productCode: r.product_code, keys: null, creditFile: null });
      continue;
    }

    const res = await seedChecklistForPurchase(db, {
      orgId,
      clientId: r.client_id,
      productCode: r.product_code,
      now
    });
    if (res.ok) {
      out.seeded.push({
        clientId: r.client_id,
        productCode: r.product_code,
        keys: res.seeded || [],
        creditFile: res.creditFile || null
      });
    } else {
      out.failed.push({ clientId: r.client_id, error: res.error || "unknown" });
    }
  }
  return out;
}
