// Pay links, entitlements and Pay presses: three money tripwires, read only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). These checks, their SQL and their helpers used to live in
// src/pulse/coverage/gap-payments.mjs. They moved here unchanged so the morning lane (which imports
// them back) and the hourly beat pay-links run the same SQL and the same verdicts. A beat may import
// only from src/pulse/beats/lib, so the truth lives here. The other five payments checks stay in the
// lane file.
//
//   payments:pay-link-webhook          money reached an open pay link and the link was never settled
//   payments:paid-no-entitlement       a payment that maps to a product grant is missing the grant
//   payments:checkout-started-no-link  someone pressed Pay and we never made their checkout link
//
// db is anything with query(sql, params): the morning pool, or the hourly read box.
// Never takes a card payment. Never mints a Commas catalog product. Never writes.

/** commas-inbox-sweeper runs every minute. Red after 3 times that schedule. */
export const LINK_WEBHOOK_GRACE_MS = 3 * 60 * 1000;

/** The id scripts/sim/push-payment.mjs gives every simulated receipt. No card was charged. */
export const SIM_RECEIPT_PREFIX = "sim-pay-";

/** The Pay press writes its event first and the link a moment later. This long and still no link is a break. */
export const CHECKOUT_LINK_WAIT_MS = 10 * 60 * 1000;
/** A Pay press older than this is old news. The morning job runs daily, so 3 days covers a long weekend gap. */
export const CHECKOUT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
/* A test client is one nobody is selling to. The first three parts are the same
   pattern gap-consent.mjs and gap-portal.mjs use (a drift test holds them equal).
   The last part adds the e2e+ and demo+ addresses the test runners mint: they
   are not on a reserved domain, so the shared pattern alone lets them through. */
export const TEST_CLIENT_EMAIL_RE =
  String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$|^(e2e|demo)\+`;

export const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not take a card payment. Do not mint a Commas catalog product.";

export function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function countOf(result) {
  const n = Number(result?.rows?.[0]?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/* An open link (created or sent) that money has already reached, in one of two ways.
   rec:   a payment.succeeded row in the Commas inbox, processed more than the grace
          ago, carries this link's ref, and the link still is not settled. The webhook
          was recorded. The settling was not.
   money: a succeeded payment from the same client, after the link was minted, for the
          same amount in cents as this link, and its ref is not any OTHER link of ours.
          (Its own ref counts: the link was paid through and never settled.) The amount
          tie is what keeps a $1 prove payment from lighting up a $297 link.
   Grace sits on the receipt: one the sweeper has not finished yet is not a break.
   Simulated receipts (sim-pay-) are test money. They are counted apart (sim_n).
   A webhook that never arrived leaves no row at all, so this cannot see that case. */
export const PAY_LINK_WEBHOOK_SQL = `
  /* gap:pay-link-webhook */
  SELECT count(*) FILTER (WHERE x.rec OR x.money)::int AS n,
         count(*) FILTER (WHERE x.rec)::int AS rec_n,
         count(*) FILTER (WHERE x.money AND NOT x.rec)::int AS money_n,
         count(*) FILTER (WHERE x.sim AND NOT x.rec AND NOT x.money)::int AS sim_n
    FROM (
      SELECT
        EXISTS (
          SELECT 1
            FROM commas_inbox ci
           WHERE ci.org_id = pl.org_id
             AND ci.event_type = 'payment.succeeded'
             AND ci.status IN ('done', 'ignored')
             AND COALESCE(ci.processed_at, ci.received_at) < $2::timestamptz
             AND COALESCE(ci.payment_id, '') NOT LIKE $3::text
             AND position(pl.link_ref in ci.raw_body) > 0
        ) AS rec,
        EXISTS (
          SELECT 1
            FROM commas_inbox ci
           WHERE ci.org_id = pl.org_id
             AND ci.event_type = 'payment.succeeded'
             AND ci.status IN ('done', 'ignored')
             AND COALESCE(ci.payment_id, '') LIKE $3::text
             AND position(pl.link_ref in ci.raw_body) > 0
        ) AS sim,
        EXISTS (
          SELECT 1
            FROM transactions t
           WHERE t.org_id = pl.org_id
             AND t.client_id = pl.client_id
             AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
             AND COALESCE(t.is_demo, false) = false
             AND COALESCE(t.provider_ref, '') NOT LIKE $3::text
             AND t.created_at >= pl.created_at
             AND t.created_at < $2::timestamptz
             AND round(t.amount_paid * 100) = pl.amount_cents
             AND NOT EXISTS (
               SELECT 1
                 FROM payment_links other
                WHERE other.org_id = t.org_id
                  AND other.id <> pl.id
                  AND other.link_ref = t.raw_payload ->> 'ref'
             )
        ) AS money
        FROM payment_links pl
       WHERE pl.org_id = $1::uuid
         AND COALESCE(pl.is_demo, false) = false
         AND pl.link_ref IS NOT NULL
         AND pl.status IN ('created', 'sent')
    ) x
`;

/* Same resolver reconcileFromTransactions uses (resolve_product_id on the
   product name), so this names exactly the payments that reconcile would grant.
   Simulated receipts are counted apart (sim_n): test money is not a customer. */
export const PAID_NO_ENTITLEMENT_SQL = `
  /* gap:paid-no-entitlement */
  SELECT count(DISTINCT t.id) FILTER (WHERE COALESCE(t.provider_ref, '') NOT LIKE $3::text)::int AS n,
         count(DISTINCT t.id) FILTER (WHERE COALESCE(t.provider_ref, '') LIKE $3::text)::int AS sim_n
    FROM transactions t
    JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
    JOIN product_entitlements pe
      ON pe.org_id = t.org_id
     AND lower(btrim(pe.product_code)) = lower(btrim(p.code))
   WHERE t.org_id = $1::uuid
     AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
     AND COALESCE(t.is_demo, false) = false
     AND t.client_id IS NOT NULL
     AND t.created_at < $2::timestamptz
     AND NOT EXISTS (
       SELECT 1
         FROM entitlements e
        WHERE e.org_id = t.org_id
          AND e.client_id = t.client_id
          AND e.source_transaction_id = t.id
          AND lower(btrim(e.entitlement_code)) = lower(btrim(pe.entitlement_code))
     )
`;

export function skipWhy({ db, orgId }, what) {
  if (!db) return `no database in this run — ${what} not read`;
  if (!orgId) return `no org id in this run — ${what} not read`;
  return null;
}

export function intOf(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function checkPayLinkWebhook({ db, orgId, now }) {
  const id = "payments:pay-link-webhook";
  const why = skipWhy({ db, orgId }, "pay link webhooks");
  if (why) return row(id, "skip", why);
  const cutoff = new Date(now.getTime() - LINK_WEBHOOK_GRACE_MS).toISOString();
  try {
    const result = await db.query(PAY_LINK_WEBHOOK_SQL, [orgId, cutoff, `${SIM_RECEIPT_PREFIX}%`]);
    const n = countOf(result);
    const recN = intOf(result?.rows?.[0]?.rec_n);
    const moneyN = intOf(result?.rows?.[0]?.money_n);
    const simN = intOf(result?.rows?.[0]?.sim_n);
    const simNote = simN > 0 ? ` (${plural(simN, "open link")} with a simulated receipt left out: no card was charged)` : "";
    if (n === 0) {
      return row(
        id,
        "PASS",
        `no open pay link has a processed Commas payment for its ref, or matching money from its own client, waiting to be settled${simNote}`
      );
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "pay link")} minted and still open after money landed: ` +
        `${recN} with a processed Commas payment.succeeded row for the link ref, ` +
        `${moneyN} with a payment from the same client for the same amount that came through no other link of ours.${simNote}`,
      `${RECON} Read payment_links, commas_inbox (by link ref) and transactions for that link. Settle or void the link in the existing pay link flow. Do not mint another link.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read pay link webhooks: ${String(err?.message || err).slice(0, 180)}`,
      `${RECON} Read payment_links and commas_inbox. Do not mint another link.`
    );
  }
}

export async function checkPaidNoEntitlement({ db, orgId, now }) {
  const id = "payments:paid-no-entitlement";
  const why = skipWhy({ db, orgId }, "entitlements");
  if (why) return row(id, "skip", why);
  const cutoff = new Date(now.getTime() - LINK_WEBHOOK_GRACE_MS).toISOString();
  try {
    const result = await db.query(PAID_NO_ENTITLEMENT_SQL, [orgId, cutoff, `${SIM_RECEIPT_PREFIX}%`]);
    const n = countOf(result);
    const simRaw = Number(result?.rows?.[0]?.sim_n ?? 0);
    const simN = Number.isFinite(simRaw) ? simRaw : 0;
    const simNote = simN > 0 ? ` (${plural(simN, "simulated receipt")} left out: no card was charged)` : "";
    if (n === 0) {
      return row(id, "PASS", `every succeeded payment that has a product mapping also has its entitlement row${simNote}`);
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "succeeded payment")} mapped to a product entitlement and missing that grant${simNote}.`,
      `${RECON} Read transactions, product_entitlements, and entitlements for that payment. Do not take the payment again.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read entitlements: ${String(err?.message || err).slice(0, 180)}`,
      `${RECON} Read entitlements for the succeeded payment. Do not take the payment again.`
    );
  }
}

/* The test-client test, written once and pasted into each statement. `emails`
   is the SQL for the address to test; `param` is the placeholder holding the
   pattern. The clients row must be joined as `c`. */
export function testClientSql(emails, param) {
  return `(COALESCE(c.is_demo, false)
          OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(${emails}, '') ~* ${param}::text)`;
}

/* Someone pressed Pay and we never made their checkout link. api/public/slo-checkout.mjs
   writes the slo.checkout_started event first (it carries the order ref and the
   client) and the payment_links row after the card session is made. A card
   session that fails leaves the event and no link: the buyer saw an error.
   A press is fine when its own ref has a link, or when the same client got a
   later slo_ link (they pressed again and it worked). Demo presses, agent
   presses and test clients are left out. Presses older than 3 days are old news.
   The repair-plan press (slo-repair-checkout) writes its event after the link,
   so a failed repair press leaves nothing to read. That one is not watched. */
export const CHECKOUT_STARTED_NO_LINK_SQL = `
  /* gap:checkout-started-no-link */
  SELECT count(*)::int AS presses_n,
         count(*) FILTER (WHERE NOT p.has_link)::int AS n,
         min(p.created_at) FILTER (WHERE NOT p.has_link) AS oldest,
         left(
           string_agg(COALESCE(p.ref, 'no ref'), ', ' ORDER BY p.created_at DESC) FILTER (WHERE NOT p.has_link),
           240
         ) AS refs
    FROM (
      SELECT e.created_at, e.payload ->> 'ref' AS ref,
             EXISTS (
               SELECT 1
                 FROM payment_links pl
                WHERE pl.org_id = e.org_id
                  AND (
                    (e.payload ->> 'ref' IS NOT NULL AND pl.link_ref = e.payload ->> 'ref')
                    OR (pl.client_id = e.client_id
                        AND left(pl.link_ref, 4) = 'slo_'
                        AND pl.created_at >= e.created_at - interval '1 minute')
                  )
             ) AS has_link
        FROM events e
        LEFT JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
       WHERE e.org_id = $1::uuid
         AND e.name = 'slo.checkout_started'
         AND COALESCE(e.is_demo, false) = false
         AND COALESCE(e.payload ->> 'demo', '') <> 'true'
         AND COALESCE(e.payload ->> 'actor', 'person') <> 'agent'
         AND e.created_at < $2::timestamptz
         AND e.created_at >= $3::timestamptz
         AND NOT ${testClientSql("c.email, e.payload ->> 'email'", "$4")}
    ) p
`;

export function oneRow(result) {
  const r = result?.rows?.[0];
  return r && typeof r === "object" ? r : null;
}

export function ageOf(then, now) {
  const t = then instanceof Date ? then : new Date(then);
  const ms = now.getTime() - t.getTime();
  if (!Number.isFinite(ms) || ms < 0) return "a short time";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 120) return plural(Math.max(minutes, 1), "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

export async function readTripwire(db, id, what, sql, params) {
  try {
    const r = oneRow(await db.query(sql, params));
    if (!r) return { skip: row(id, "skip", `could not read ${what}: the read came back with no row`) };
    return { r };
  } catch (err) {
    return { skip: row(id, "skip", `could not read ${what}: ${String(err?.message || err).slice(0, 180)}`) };
  }
}

export async function checkCheckoutStartedNoLink({ db, orgId, now }) {
  const id = "payments:checkout-started-no-link";
  const why = skipWhy({ db, orgId }, "Pay presses");
  if (why) return row(id, "skip", why);
  const cutoff = new Date(now.getTime() - CHECKOUT_LINK_WAIT_MS).toISOString();
  const since = new Date(now.getTime() - CHECKOUT_LOOKBACK_MS).toISOString();
  const got = await readTripwire(db, id, "Pay presses", CHECKOUT_STARTED_NO_LINK_SQL, [
    orgId, cutoff, since, TEST_CLIENT_EMAIL_RE
  ]);
  if (got.skip) return got.skip;
  const r = got.r;
  const pressesN = intOf(r.presses_n);
  const n = intOf(r.n);
  if (n === 0) {
    return row(
      id,
      "PASS",
      pressesN === 0
        ? "no real Pay press in the last 3 days is old enough to check"
        : `${pressesN} real Pay ${pressesN === 1 ? "press" : "presses"} in the last 3 days, and each has its checkout link`
    );
  }
  const oldest = r.oldest ? ` The oldest was ${ageOf(r.oldest, now)} ago.` : "";
  const refs = typeof r.refs === "string" && r.refs ? ` Order refs: ${r.refs}.` : "";
  return row(
    id,
    "FAIL",
    `${n} Pay ${n === 1 ? "press" : "presses"} in the last 3 days with no checkout link made, out of ${pressesN} real ${pressesN === 1 ? "press" : "presses"}. ` +
      `The buyer pressed Pay and the link was never made.${oldest}${refs}`,
    `${RECON} Read the slo.checkout_started event for each ref and the card session call in api/public/slo-checkout. Reach the buyer with a fresh link from the existing pay link flow. Do not mint a Commas catalog product.`
  );
}
