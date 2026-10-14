// Shared constants and read-only SQL for the checkout daily check and hourly beat.
// Keep this module declarative so the beat import closure has no side effects.

import { DAY_MS, HOUR_MS, testClientSql } from "./money-truth-utils.mjs";

export const CHECK_IDS = Object.freeze([
  "checkout:paid-service",
  "checkout:repair-price",
  "checkout:funnel-door",
  "checkout:funnel-no-sale"
]);

/** A request that was priced and has no link this long is stuck at quoted. Same wait gap-payments uses for a Pay press. */
export const QUOTED_WAIT_MS = 10 * 60 * 1000;
/** Money recorded and the round not staged this long. The Commas inbox retries a stuck receipt until a claim goes stale, plus 5 minutes. */
export const PAID_STAGE_WAIT_MS = 20 * 60 * 1000;
/** A round waits on a person: the longest gap-soft-pull lets a person-queued pull wait. */
export const STAGED_WAIT_HOURS = 48;
export const STAGED_WAIT_MS = STAGED_WAIT_HOURS * HOUR_MS;
/** Money taken and the round closed failed: the same hour gap-payments gives a reach-out. */
export const FAILED_PAID_WAIT_MS = 60 * 60 * 1000;
/** How far back an expired or failed request is looked at for money that came after. */
export const RECENT_MS = 30 * DAY_MS;
/** How many live links are asked about in one morning. The lane has a 20 second budget. */
export const MAX_LINK_CHECKS = 5;

/** Repair plan names the /roadmap widget offers. */
export const REPAIR_PLAN_KEYS = Object.freeze(["REPAIR_TRIAL", "REPAIR_DFY"]);
export const REPAIR_PRICES = Object.freeze({ REPAIR_TRIAL: 20000, REPAIR_DFY: 100000 });

/** Funnel: how many presses must be in the window before "nobody paid" means something. */
export const FUNNEL_MIN_PRESSES = 3;
export const FUNNEL_WINDOW_DAYS = 7;
/** A press younger than this may still be on its way to the card box. */
export const FUNNEL_PRESS_GRACE_MS = DAY_MS;
export const FUNNEL_PATH = "/api/public/funnel-checkout";

export const PAID_SERVICE_SQL = `
  /* gap:checkout-paid-service */
  SELECT count(*) FILTER (WHERE NOT x.is_test)::int AS real_n,
         count(*) FILTER (WHERE x.is_test)::int AS test_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.status = 'quoted' AND x.requested_at < $2::timestamptz)::int AS quoted_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.status = 'awaiting_payment' AND x.no_link
                            AND x.requested_at < $2::timestamptz)::int AS no_link_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.status = 'paid' AND x.paid_at < $3::timestamptz)::int AS paid_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.status = 'staged' AND x.paid_at < $4::timestamptz)::int AS staged_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.status IN ('awaiting_payment', 'cancelled')
                            AND x.paid_at IS NULL AND x.money_arrived)::int AS unrecorded_n,
         count(*) FILTER (WHERE NOT x.is_test AND x.status = 'failed' AND x.paid_at IS NOT NULL
                            AND x.resolved_at < $5::timestamptz)::int AS failed_paid_n,
         min(x.requested_at) FILTER (WHERE NOT x.is_test AND (
               (x.status = 'quoted' AND x.requested_at < $2::timestamptz)
            OR (x.status = 'awaiting_payment' AND x.no_link AND x.requested_at < $2::timestamptz)
            OR (x.status = 'paid' AND x.paid_at < $3::timestamptz)
            OR (x.status = 'staged' AND x.paid_at < $4::timestamptz)
            OR (x.status IN ('awaiting_payment', 'cancelled') AND x.paid_at IS NULL AND x.money_arrived)
            OR (x.status = 'failed' AND x.paid_at IS NOT NULL AND x.resolved_at < $5::timestamptz))) AS oldest
    FROM (
      SELECT r.status, r.requested_at, r.paid_at, r.resolved_at,
             (btrim(COALESCE(r.checkout_url, '')) = '') AS no_link,
             ${testClientSql("c.email", "$7")} AS is_test,
             EXISTS (
               SELECT 1
                 FROM commas_inbox ci
                WHERE ci.org_id = r.org_id
                  AND ci.event_type = 'payment.succeeded'
                  AND COALESCE(ci.payment_id, '') NOT LIKE $8::text
                  AND ci.received_at < $3::timestamptz
                  AND position(r.id::text in ci.raw_body) > 0
             ) AS money_arrived
        FROM paid_service_requests r
        LEFT JOIN clients c ON c.id = r.client_id AND c.org_id = r.org_id
       WHERE r.org_id = $1::uuid
         AND (r.status IN ('quoted', 'awaiting_payment', 'paid', 'staged')
              OR (r.status IN ('cancelled', 'failed') AND COALESCE(r.resolved_at, r.requested_at) >= $6::timestamptz))
    ) x
`;

export const LIVE_LINKS_SQL = `
  /* gap:checkout-paid-service-links */
  SELECT r.id::text AS id, r.checkout_url
    FROM paid_service_requests r
    LEFT JOIN clients c ON c.id = r.client_id AND c.org_id = r.org_id
   WHERE r.org_id = $1::uuid
     AND r.status = 'awaiting_payment'
     AND btrim(COALESCE(r.checkout_url, '')) <> ''
     AND r.checkout_expires_at > $2::timestamptz
     AND NOT ${testClientSql("c.email", "$3")}
   ORDER BY r.requested_at DESC
   LIMIT ${MAX_LINK_CHECKS}
`;

export const REPAIR_PRICE_SQL = `
  /* gap:checkout-repair-price */
  SELECT e.id::text AS event_id,
         e.created_at,
         e.payload ->> 'offer_key' AS offer_key,
         e.payload ->> 'link_ref' AS link_ref,
         e.payload ->> 'amount_cents' AS event_cents,
         pl.id::text AS link_id,
         pl.amount_cents::text AS link_cents,
         pl.purpose AS link_purpose
    FROM events e
    LEFT JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
    LEFT JOIN payment_links pl ON pl.org_id = e.org_id AND pl.link_ref = e.payload ->> 'link_ref'
   WHERE e.org_id = $1::uuid
     AND e.name = 'slo.repair_checkout_started'
     AND COALESCE(e.is_demo, false) = false
     AND COALESCE(e.payload ->> 'demo', '') <> 'true'
     AND e.created_at >= $2::timestamptz
     AND NOT ${testClientSql("c.email", "$3")}
   ORDER BY e.created_at DESC
   LIMIT 50
`;

export const FUNNEL_PRESSES_SQL = `
  /* gap:checkout-funnel-no-sale */
  SELECT p.item,
         count(*)::int AS presses_n,
         count(*) FILTER (WHERE p.paid)::int AS paid_n,
         min(p.created_at) AS first_at,
         max(p.created_at) AS last_at
    FROM (
      SELECT e.created_at,
             COALESCE(e.payload ->> 'item', 'unknown') AS item,
             (
               EXISTS (
                 SELECT 1
                   FROM commas_inbox ci
                  WHERE ci.org_id = e.org_id
                    AND ci.event_type = 'payment.succeeded'
                    AND COALESCE(ci.payment_id, '') NOT LIKE $5::text
                    AND position(e.payload ->> 'ref' in ci.raw_body) > 0
               )
               OR EXISTS (
                 SELECT 1
                   FROM transactions t
                  WHERE t.org_id = e.org_id
                    AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
                    AND COALESCE(t.provider_ref, '') NOT LIKE $5::text
                    AND t.raw_payload ->> 'ref' = e.payload ->> 'ref'
               )
             ) AS paid
        FROM events e
       WHERE e.org_id = $1::uuid
         AND e.name = 'funnel.checkout_started'
         AND COALESCE(e.is_demo, false) = false
         AND COALESCE(e.payload ->> 'demo', '') <> 'true'
         AND e.created_at >= $2::timestamptz
         AND e.created_at < $3::timestamptz
         AND COALESCE(e.payload ->> 'email', '') !~* $4::text
         AND e.payload ->> 'ref' IS NOT NULL
    ) p
   GROUP BY p.item
   ORDER BY p.item
`;
