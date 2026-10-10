// Past-due plans for the morning pulse. Read only. Report only. (coverage batch W2, 2026-10-10)
//
//   subscriptions:past-due          Is every past-due plan on our own billing rail either being retried on
//                                   schedule, or in a person's hands? A plan nobody is working is a customer
//                                   who stopped paying and nobody knows.
//   subscriptions:addon-paid-no-plan Did every partner who paid for a monthly add-on get the plan? A partner
//                                   who paid and has no plan paid for nothing, and nothing bills the next month.
//
// THE RAIL, IN FOUR LINES (src/workflows/subscription-billing-sweeper.mjs, src/subscriptions/billing*.mjs)
//   * The sweeper runs hourly at :17 and takes plans that are due: status active or past_due, not
//     cancelled, not ended, with next_charge_at, billing_interval and a price above zero.
//   * A plan whose provider is 'commas_subscription' is billed by Commas itself. Our rail never touches
//     it, so it is left out here too (PROCESSOR_BILLED_PROVIDERS, held equal by a drift test).
//   * A charge attempt is one subscription_charges row. A failed one may be retried after
//     RETRY_BACKOFF_MINUTES (15 minutes, 4 hours, then 1 day), up to MAX_ATTEMPTS (4). After that the
//     row is 'abandoned': "Dunning is a human decision", and nothing asks the human.
//   * An 'in_flight' row means we called out and never heard back. We DO NOT KNOW if money moved, so
//     the sweeper never retries it. A person must read the processor.
//
// WHAT THE ROW CALLS RED (one plan is enough)
//   not-schedulable   past due, and the sweeper's own filter can never pick it up (no next_charge_at,
//                     no interval, or no price). No clock will ever try it.
//   never-tried       due for 2 sweeps or more, and no attempt row exists for it.
//   retry-missed      failed, tries left, and its retry time passed 2 sweeps ago.
//   money-unknown     in_flight for 2 sweeps or more.
//   out-of-tries      abandoned, or failed with every try used: a person must decide.
//   paid-not-cleared  its newest attempt succeeded and the plan still reads past_due.
//
// TODAY'S TRUTH, SAID PLAINLY: src/subscriptions/charger.mjs ships an EMPTY charger list, so the sweeper
// skips every due plan before it writes an attempt row. A past-due plan on our own rail is therefore
// never retried, and this row goes red for it. That is correct. It is the break.
//
// A failed read is a skip with the reason, never a PASS. No charge, no text, no plan changed.

import { PARTNER_ADD_ONS } from "../../config/offers.mjs";
import { INBOX_PROCESSING_WAIT_MS } from "./gap-payments.mjs";
import {
  HOUR_MS, TEST_CLIENT_EMAIL_RE, TRIP, ageOf, intOf, nowOf, plural, readRow, readRows, row, runnerOf, skipWhy, testClientSql, toDate
} from "./money-reads.mjs";

export const CHECK_IDS = Object.freeze(["subscriptions:past-due", "subscriptions:addon-paid-no-plan"]);

/** The sweeper runs hourly (SWEEP_CRON "17 * * * *"). Two sweeps is the wait before a plan is called unworked. */
export const SWEEP_EVERY_MS = HOUR_MS;
export const SWEEPS_BEFORE_RED = 2;
export const WORK_WAIT_MS = SWEEPS_BEFORE_RED * SWEEP_EVERY_MS;

/** src/subscriptions/billing.mjs MAX_ATTEMPTS and RETRY_BACKOFF_MINUTES. Held equal by a drift test. */
export const MAX_ATTEMPTS = 4;
export const RETRY_BACKOFF_MINUTES = Object.freeze([15, 240, 1440]);
/** src/subscriptions/billing.mjs PROCESSOR_BILLED_PROVIDERS. Held equal by a drift test. */
export const PROCESSOR_BILLED_PROVIDERS = Object.freeze(["commas_subscription"]);

export const MAX_ROWS = 200;

/* Every past-due plan on our own rail, with its newest attempt (by period, then by touch). */
export const PAST_DUE_SQL = `
  /* gap:subscriptions-past-due */
  SELECT s.id::text AS id,
         s.tier,
         s.status,
         s.price_cents::text AS price_cents,
         s.billing_interval,
         s.next_charge_at,
         s.updated_at,
         COALESCE(c.client_code, p.slug, 'no code') AS who,
         ch.status AS charge_status,
         ch.attempt AS charge_attempt,
         ch.next_retry_at AS charge_retry_at,
         ch.updated_at AS charge_updated_at
    FROM subscriptions s
    LEFT JOIN clients c ON c.id = s.client_id AND c.org_id = s.org_id
    LEFT JOIN partners p ON p.id = s.partner_id AND p.org_id = s.org_id
    LEFT JOIN LATERAL (
      SELECT x.status, x.attempt, x.next_retry_at, x.updated_at
        FROM subscription_charges x
       WHERE x.subscription_id = s.id
       ORDER BY x.period_start DESC, x.updated_at DESC
       LIMIT 1
    ) ch ON true
   WHERE s.org_id = $1::uuid
     AND s.status = 'past_due'
     AND s.effective_to IS NULL
     AND s.cancelled_at IS NULL
     AND COALESCE(s.is_demo, false) = false
     AND lower(btrim(s.provider)) <> ALL($2::text[])
     AND NOT (c.id IS NOT NULL AND ${testClientSql("c.email", "$3")})
   ORDER BY s.updated_at
   LIMIT ${MAX_ROWS}
`;

/**
 * judgePastDue(plan, now) -> null when the plan is being worked, else { kind, why }.
 * Pure. `plan` is one row of PAST_DUE_SQL.
 */
export function judgePastDue(plan, now) {
  const next = toDate(plan.next_charge_at);
  const price = Number(plan.price_cents);
  if (!next || !plan.billing_interval || !Number.isFinite(price) || price <= 0) {
    return { kind: "not-schedulable", why: "no clock will try it (it has no next charge date, billing interval or price)" };
  }
  const status = plan.charge_status || null;
  const touched = toDate(plan.charge_updated_at);
  const attempt = Number(plan.charge_attempt);
  if (!status) {
    if (now.getTime() - next.getTime() >= WORK_WAIT_MS) {
      return { kind: "never-tried", why: `due ${ageOf(next, now)} ago and no charge attempt was ever made` };
    }
    return null;
  }
  if (status === "abandoned" || (status === "failed" && Number.isFinite(attempt) && attempt >= MAX_ATTEMPTS)) {
    return { kind: "out-of-tries", why: "every try is used and a person has to decide" };
  }
  if (status === "failed") {
    const retry = toDate(plan.charge_retry_at);
    const dueAt = retry || next;
    if (now.getTime() - dueAt.getTime() >= WORK_WAIT_MS) {
      return { kind: "retry-missed", why: `its retry was due ${ageOf(dueAt, now)} ago and was not tried` };
    }
    return null;
  }
  if (status === "in_flight") {
    if (touched && now.getTime() - touched.getTime() >= WORK_WAIT_MS) {
      return { kind: "money-unknown", why: `a charge went out ${ageOf(touched, now)} ago and never came back, so nobody knows if money moved` };
    }
    return null;
  }
  if (status === "succeeded") {
    if (touched && now.getTime() - touched.getTime() >= WORK_WAIT_MS) {
      return { kind: "paid-not-cleared", why: "its newest charge succeeded and the plan still reads past due" };
    }
    return null;
  }
  return null;
}

const KIND_WORDS = Object.freeze({
  "not-schedulable": "no clock will try it",
  "never-tried": "never tried",
  "retry-missed": "retry missed",
  "money-unknown": "money outcome unknown",
  "out-of-tries": "out of tries",
  "paid-not-cleared": "paid but still past due"
});

async function checkPastDue({ run, orgId, now }) {
  const id = CHECK_IDS[0];
  const why = skipWhy({ run, orgId }, "past-due plans");
  if (why) return row(id, "skip", why);
  const got = await readRows(run, id, "past-due plans", PAST_DUE_SQL, [orgId, [...PROCESSOR_BILLED_PROVIDERS], TEST_CLIENT_EMAIL_RE]);
  if (got.skip) return got.skip;
  const plans = got.rows;
  const bad = [];
  for (const plan of plans) {
    const verdict = judgePastDue(plan, now);
    if (verdict) bad.push({ plan, ...verdict });
  }
  if (bad.length === 0) {
    return row(
      id,
      "PASS",
      plans.length === 0
        ? "no plan on our own billing rail is past due"
        : `${plural(plans.length, "plan")} on our own billing rail ${plans.length === 1 ? "is" : "are"} past due, each with a retry coming or inside its first ${SWEEPS_BEFORE_RED} sweeps`
    );
  }
  const byKind = new Map();
  for (const b of bad) byKind.set(b.kind, (byKind.get(b.kind) || 0) + 1);
  const kinds = [...byKind.entries()].map(([k, c]) => `${c} ${KIND_WORDS[k] || k}`).join(", ");
  const names = bad.slice(0, 4).map((b) => `${b.plan.who} (${b.plan.tier})`).join(", ");
  const oldest = bad
    .map((b) => toDate(b.plan.next_charge_at))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return row(
    id,
    "FAIL",
    `${plural(bad.length, "past-due plan")} nobody is working: ${kinds}. ${names}${bad.length > 4 ? ", and more" : ""}.${oldest ? ` The oldest was due ${ageOf(oldest, now)} ago.` : ""}`,
    `Read subscriptions and subscription_charges for those plans, and the job heartbeat subscription-billing-sweeper. ` +
      `src/subscriptions/charger.mjs ships with no charger, so the sweeper skips a due plan before it writes an attempt. ` +
      `Reach the client for a new card or payment link by hand, or read the processor for an in_flight charge (GET /payments/:id). ${TRIP}`
  );
}

/* ---- a paid monthly add-on with no plan ----------------------------------------------------- */

/** The monthly add-ons, by the products.code that also becomes the plan's tier (src/config/offers.mjs).
    Lead Flow is $99 per booked call and has no plan on purpose (src/subscriptions/partner-addons.mjs). */
export const MONTHLY_ADD_ON_CODES = Object.freeze(
  Object.values(PARTNER_ADD_ONS).filter((a) => a.billing === "monthly").map((a) => String(a.productCode).toLowerCase()).sort()
);

/** The webhook, then the Commas inbox clock, get this long to open the plan before it is a break. */
export const ADDON_GRACE_MS = INBOX_PROCESSING_WAIT_MS;

/* A paid partner add-on link, and whether a plan for that partner and add-on covers the day it was paid.
   activateFromLink opens the plan at the pay time, or finds one already running (already_active). A plan
   that ended before this payment does not cover it: the partner bought again and needs a new one. */
export const ADDON_PAID_NO_PLAN_SQL = `
  /* gap:subscriptions-addon-paid-no-plan */
  SELECT count(*) FILTER (WHERE NOT x.is_test)::int AS paid_n,
         count(*) FILTER (WHERE NOT x.is_test AND NOT x.has_plan)::int AS n,
         count(*) FILTER (WHERE x.is_test)::int AS test_n,
         min(x.paid_at) FILTER (WHERE NOT x.is_test AND NOT x.has_plan) AS oldest,
         left(
           string_agg(x.who || ' (' || x.code || ')', ', ' ORDER BY x.paid_at DESC)
             FILTER (WHERE NOT x.is_test AND NOT x.has_plan),
           240
         ) AS sample
    FROM (
      SELECT pl.paid_at,
             lower(btrim(p.code)) AS code,
             COALESCE(pa.slug, 'no slug') AS who,
             COALESCE(pa.is_demo, false) AS is_test,
             EXISTS (
               SELECT 1
                 FROM subscriptions s
                WHERE s.org_id = pl.org_id
                  AND s.partner_id = pl.partner_id
                  AND lower(btrim(s.tier)) = lower(btrim(p.code))
                  AND s.effective_from <= pl.paid_at + interval '1 minute'
                  AND (s.effective_to IS NULL OR s.effective_to > pl.paid_at)
             ) AS has_plan
        FROM payment_links pl
        JOIN products p ON p.id = pl.product_id
        LEFT JOIN partners pa ON pa.id = pl.partner_id AND pa.org_id = pl.org_id
       WHERE pl.org_id = $1::uuid
         AND pl.partner_id IS NOT NULL
         AND pl.status = 'paid'
         AND COALESCE(pl.is_demo, false) = false
         AND lower(btrim(p.code)) = ANY($2::text[])
         AND pl.paid_at < $3::timestamptz
    ) x
`;

async function checkAddOnPaidNoPlan({ run, orgId, now }) {
  const id = CHECK_IDS[1];
  const why = skipWhy({ run, orgId }, "paid partner add-ons");
  if (why) return row(id, "skip", why);
  const got = await readRow(run, id, "paid partner add-ons", ADDON_PAID_NO_PLAN_SQL, [
    orgId, [...MONTHLY_ADD_ON_CODES], new Date(now.getTime() - ADDON_GRACE_MS).toISOString()
  ]);
  if (got.skip) return got.skip;
  const r = got.r;
  const paid = intOf(r.paid_n);
  const n = intOf(r.n);
  const testNote = intOf(r.test_n) ? ` (${plural(intOf(r.test_n), "demo-partner payment")} left out)` : "";
  if (n === 0) {
    return row(
      id,
      "PASS",
      paid === 0
        ? `no partner has paid for a monthly add-on yet${testNote}`
        : `${plural(paid, "monthly add-on payment")} from partners, and each has its plan${testNote}`
    );
  }
  const oldest = r.oldest ? ` The oldest paid ${ageOf(r.oldest, now)} ago.` : "";
  const sample = typeof r.sample === "string" && r.sample ? ` Partners: ${r.sample}.` : "";
  return row(
    id,
    "FAIL",
    `${plural(n, "partner")} paid for a monthly add-on and no plan covers the payment, so nothing will bill the next month.${oldest}${sample}${testNote}`,
    `Read the paid payment_links row for that partner and the subscriptions rows for the same add-on. ` +
      `src/handlers/payment-links.mjs calls activateFromLink (src/subscriptions/partner-addons.mjs) when the link is marked paid. ` +
      `A staff owner can run POST /api/partner-addons action=activate to reconcile a paid link whose webhook never came back. ${TRIP}`
  );
}

/** Two read-only checks. ctx: { db, scope, orgId, now }. */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const now = nowOf(ctx);
  const orgId = ctx.orgId || null;
  const out = [];
  for (const [id, fn] of [[CHECK_IDS[0], checkPastDue], [CHECK_IDS[1], checkAddOnPaidNoPlan]]) {
    try {
      out.push(await fn({ run, orgId, now }));
    } catch (err) {
      out.push(row(id, "skip", `the check could not run: ${String(err && err.message ? err.message : err).slice(0, 160)}`));
    }
  }
  return out;
}
