// Finance OS entitlement — does this client have an active, paid-for reason to
// see this screen and its suggestions.
//
// Finance OS became a paid monthly add-on (owner-set 2026-09-09): a client does
// not get it just by being a funding or repair client. There was no gate on any
// `subscriptions` row anywhere in this codebase before this file — every use of
// that table so far has been billing bookkeeping, read by a human, not a
// runtime decision. This is the first one, so it is written the way
// isPlaidEnabled() is: pure, never throws, reports rather than gates a
// half-built path.
//
// TIER NAME. 'finance-os', matching subscriptions.tier's free-text convention
// (075_subscriptions.sql — no enum, "the plan the client is on, as the
// addendum names it"). Nothing enforces this spelling at the database level;
// it is the one string this file and the row-writer must agree on.
//
// PRICE IS NOT PART OF THE GATE. price_cents may be NULL — that only means "not
// yet priced", not "not entitled". Chris has not set a number for this tier
// (owner-set 2026-09-09), and a client already on it should not lose access the
// moment a price is decided; that is a separate, later billing decision.

import { db } from "../db.mjs";
import { startSubscription, SubscriptionConflictError } from "../subscriptions/store.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";

export const FINANCE_OS_TIER = "finance-os";
export const FINANCE_OS_BLUEPRINT_MONTHS = 12;
export const FINANCE_OS_BLUEPRINT_NOTE = "Capital Blueprint purchase — Finance OS included for 12 months";

/**
 * financeOsEntitlement(conn, { orgId, clientId, asOf }) →
 *   { entitled: boolean, subscriptionId: string|null, reason: string }
 *
 * `asOf` defaults to a parameter's `now()` rather than this module calling the
 * clock, so a caller checking "was this client entitled last Tuesday" (an
 * audit, a disputed charge) gets the same answer a live check would have given
 * then — the same reason cashflow.mjs takes `now` as an argument.
 *
 * ACTIVE MEANS: status = 'active' (not 'past_due' — 075's own header says
 * status only records the money state, and a lapsed card should not silently
 * keep handing out a paid feature), effective_from <= asOf, effective_to is
 * NULL or after asOf, and a recorded paid period covers asOf. A row without
 * period dates cannot keep premium access open after a Blueprint year ends.
 * The row with the latest effective_from that matches wins,
 * matching how 075 finds "the live row".
 */
async function activeFinanceOsSubscription(conn, { orgId, clientId, asOf }) {
  const res = await conn.query(
    `SELECT id FROM subscriptions
      WHERE org_id = $1 AND client_id = $2 AND tier = $3 AND status = 'active'
        AND effective_from <= $4
        AND (effective_to IS NULL OR effective_to > $4)
        AND current_period_start IS NOT NULL
        AND current_period_end IS NOT NULL
        AND current_period_start <= $4
        AND current_period_end > $4
      ORDER BY effective_from DESC LIMIT 1`,
    [orgId, clientId, FINANCE_OS_TIER, asOf]
  );
  return res.rows[0] || null;
}

/**
 * A purchased Blueprint year is an independent service right, not a change
 * to a separately billed monthly FinanceOS subscription. Prefer an active
 * paid subscription, otherwise require a non-revoked same-tenant Blueprint
 * entitlement tied to a succeeded transaction within 12 calendar months of
 * the saved sale payment time (or the transaction time for legacy rows).
 * Course/document grants are never deleted when the service year expires.
 */
export async function financeOsEntitlement(conn = db, { orgId, clientId, asOf = new Date() } = {}) {
  if (!orgId || !clientId) {
    return { entitled: false, subscriptionId: null, reason: "orgId and clientId are both required" };
  }
  const subscription = await activeFinanceOsSubscription(conn, { orgId, clientId, asOf });
  if (subscription) {
    return { entitled: true, subscriptionId: subscription.id, reason: null };
  }
  const grant = await conn.query(
    `SELECT e.id
       FROM entitlements e
       JOIN transactions t ON t.id = e.source_transaction_id
         AND t.org_id = e.org_id AND t.client_id = e.client_id
       LEFT JOIN sale_payments sp ON sp.transaction_id = t.id AND sp.org_id = t.org_id
       JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
         AND p.org_id = t.org_id
      WHERE e.org_id = $1 AND e.client_id = $2
        AND e.entitlement_code = 'credit-optimization-roadmap'
        AND e.revoked_at IS NULL
        AND (e.expires_at IS NULL OR e.expires_at > $3)
        AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
        AND lower(btrim(p.code)) = $4
        AND COALESCE(sp.paid_at, t.created_at) <= $3
        AND (COALESCE(sp.paid_at, t.created_at) + interval '12 months') > $3
      ORDER BY COALESCE(sp.paid_at, t.created_at) DESC, e.id DESC LIMIT 1`,
    [orgId, clientId, asOf, BLUEPRINT_PRODUCT_CODE]
  );
  if (!grant.rows[0]) {
    return { entitled: false, subscriptionId: null, reason: "no active finance-os subscription or paid Blueprint year" };
  }
  return { entitled: true, subscriptionId: grant.rows[0].id, reason: null, source: "blueprint_included" };
}

export function addUtcMonths(date, months) {
  const d = new Date(date.getTime());
  // Match PostgreSQL calendar-month arithmetic on leap day and month-end:
  // Date#setUTCMonth otherwise overflows Feb 29 into Mar 1 next year.
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const maxDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, maxDay));
  return d;
}

/**
 * ensureFinanceOsForBlueprintPurchase — 12 months Finance OS from pay date.
 * Idempotent when an active finance-os row already covers `paidAt`.
 */
export async function ensureFinanceOsForBlueprintPurchase(conn = db, {
  orgId,
  clientId,
  paidAt = new Date(),
  productCode = BLUEPRINT_PRODUCT_CODE
} = {}) {
  const code = String(productCode || "").trim().toLowerCase();
  if (code !== BLUEPRINT_PRODUCT_CODE) {
    return { created: false, subscriptionId: null, reason: "not_blueprint_product" };
  }
  if (!orgId || !clientId) {
    return { created: false, subscriptionId: null, reason: "orgId and clientId are required" };
  }

  const existing = await activeFinanceOsSubscription(conn, { orgId, clientId, asOf: paidAt });
  if (existing) {
    return { created: false, subscriptionId: existing.id, reason: "already_entitled" };
  }

  const periodStart = paidAt;
  const periodEnd = addUtcMonths(paidAt, FINANCE_OS_BLUEPRINT_MONTHS);

  try {
    const row = await startSubscription(conn, {
      orgId,
      clientId,
      tier: FINANCE_OS_TIER,
      priceCents: null,
      periodStart,
      periodEnd,
      at: paidAt,
      notes: FINANCE_OS_BLUEPRINT_NOTE
    });
    return { created: true, subscriptionId: row.id, periodStart, periodEnd };
  } catch (e) {
    if (e instanceof SubscriptionConflictError) {
      const again = await activeFinanceOsSubscription(conn, { orgId, clientId, asOf: paidAt });
      if (again) {
        return { created: false, subscriptionId: again.id, reason: "already_entitled" };
      }
      return { created: false, subscriptionId: null, reason: e.message };
    }
    throw e;
  }
}

export default financeOsEntitlement;
