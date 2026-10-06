// src/ads/store.mjs — write and read the client_ad_attribution row (286).
//
// The writer stores RAW UTMs only. lane and variant are generated columns in
// the database, and ad_id is filled by a database trigger (407: the leading
// digits of utm_content, else the Meta ad set id + ad name match); nothing here
// computes any of them. First touch wins: on a second capture for the same
// client, each column keeps its existing value and only fills a blank
// (COALESCE(existing, new)).

const KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing_path", "referrer_domain"];

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 512) : null;
}

/** Upsert the row. Returns the stored row (with derived columns) or null when there was nothing to store. */
export async function upsertClientAdAttribution(db, { orgId, clientId, attribution }) {
  if (!orgId || !clientId || !attribution || typeof attribution !== "object") return null;
  const vals = KEYS.map((k) => clean(attribution[k]));
  if (!vals.some(Boolean)) return null;
  const r = await db.query(
    `INSERT INTO client_ad_attribution
       (client_id, org_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, referrer_domain)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (client_id) DO UPDATE SET
       utm_source      = COALESCE(client_ad_attribution.utm_source,      EXCLUDED.utm_source),
       utm_medium      = COALESCE(client_ad_attribution.utm_medium,      EXCLUDED.utm_medium),
       utm_campaign    = COALESCE(client_ad_attribution.utm_campaign,    EXCLUDED.utm_campaign),
       utm_content     = COALESCE(client_ad_attribution.utm_content,     EXCLUDED.utm_content),
       utm_term        = COALESCE(client_ad_attribution.utm_term,        EXCLUDED.utm_term),
       landing_path    = COALESCE(client_ad_attribution.landing_path,    EXCLUDED.landing_path),
       referrer_domain = COALESCE(client_ad_attribution.referrer_domain, EXCLUDED.referrer_domain),
       updated_at      = now()
     RETURNING client_id, org_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
               landing_path, referrer_domain, lane::text AS lane, ad_id, variant, captured_at, updated_at`,
    [clientId, orgId, ...vals]
  );
  return r.rows[0] || null;
}

/** One client's row, org-bound. null when the client has no attribution row. */
export async function readClientAdAttribution(db, { orgId, clientId }) {
  if (!orgId || !clientId) return null;
  const r = await db.query(
    `SELECT client_id, org_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            landing_path, referrer_domain, lane::text AS lane, ad_id, variant, captured_at, updated_at
       FROM client_ad_attribution
      WHERE org_id = $1 AND client_id = $2`,
    [orgId, clientId]
  );
  return r.rows[0] || null;
}

/* Leads, bookings and PAYMENTS per (lane, ad_id, variant), org-bound,
   optionally windowed on the lead's capture time. A cancelled booking is not a
   booked call. Leads are DISTINCT clients so a client with two bookings still
   counts once.

   A PAYMENT IS TIED TO AN AD THROUGH THE ORDER'S OWN AD TAGS (2026-10-05).
   The $297/$147 checkout (api/public/slo-checkout.mjs) writes the page's ad
   tags into this same client_ad_attribution row, first touch, and the order
   itself is the client's payment_links row. So a payment counts for the ad on
   the paying client's row. "Paid" is the rule src/slo/buyer.mjs
   sloClientPriorFile already uses: status 'paid' and not a demo order. The
   transactions table is NOT added on top — the same payment lands in both
   (119: commas_session_id is "the same value recorded as
   transactions.provider_ref"), and counting both would count one sale twice.

   paid_cents is what the payment webhook REPORTED (payment_links.
   paid_amount_cents), never the asked amount standing in for it. NULL when no
   paid row in the group reported an amount; payments_amount_unknown says how
   many paid rows did not, so a short total is visible rather than silent.

   Bookings and payments are each counted per client in their own subquery
   before the GROUP BY, so a client with two bookings and one payment is two
   books and one payment — never multiplied into each other. */
export async function adAttributionRollup(db, { orgId, from = null, to = null }) {
  if (!orgId) return [];
  const r = await db.query(
    `SELECT a.lane::text AS lane, a.ad_id, a.variant,
            count(DISTINCT a.client_id)::int AS leads,
            min(a.captured_at) AS first_lead_at,
            max(a.captured_at) AS last_lead_at,
            coalesce(sum(b.books), 0)::int AS books,
            min(b.first_book_at) AS first_book_at,
            max(b.last_book_at) AS last_book_at,
            coalesce(sum(p.payments), 0)::int AS payments,
            sum(p.paid_cents)::bigint AS paid_cents,
            coalesce(sum(p.amount_unknown), 0)::int AS payments_amount_unknown,
            min(p.first_paid_at) AS first_paid_at,
            max(p.last_paid_at) AS last_paid_at
       FROM client_ad_attribution a
       LEFT JOIN LATERAL (
              SELECT count(*) AS books,
                     min(bk.created_at) AS first_book_at,
                     max(bk.created_at) AS last_book_at
                FROM bookings bk
               WHERE bk.client_id = a.client_id AND bk.org_id = a.org_id
                 AND bk.status IS DISTINCT FROM 'cancelled'
            ) b ON true
       LEFT JOIN LATERAL (
              SELECT count(*) AS payments,
                     sum(pl.paid_amount_cents) AS paid_cents,
                     count(*) FILTER (WHERE pl.paid_amount_cents IS NULL) AS amount_unknown,
                     min(pl.paid_at) AS first_paid_at,
                     max(pl.paid_at) AS last_paid_at
                FROM payment_links pl
               WHERE pl.client_id = a.client_id AND pl.org_id = a.org_id
                 AND pl.status = 'paid' AND pl.is_demo = false
            ) p ON true
      WHERE a.org_id = $1
        AND ($2::timestamptz IS NULL OR a.captured_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR a.captured_at <  $3::timestamptz)
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3`,
    [orgId, from, to]
  );
  // bigint arrives from pg as a string. Cents stay whole numbers; NULL stays NULL.
  return r.rows.map((row) => ({
    ...row,
    paid_cents: row.paid_cents == null ? null : Number(row.paid_cents)
  }));
}

/* Fill visitor ad numbers that were NULL and can now be found by the Meta ad
   set id + ad name match (407, fundhub_reresolve_ad_numbers). Never changes a
   number already set. Org-bound; returns how many rows it filled. Throws when
   the database does not have 407 yet — the caller (the daily Meta sync)
   reports that and carries on. */
export async function reresolveAdNumbers(db, { orgId }) {
  if (!orgId) return 0;
  const r = await db.query(
    `SELECT fundhub_reresolve_ad_numbers($1::uuid) AS filled`,
    [orgId]
  );
  return Number(r.rows?.[0]?.filled) || 0;
}
