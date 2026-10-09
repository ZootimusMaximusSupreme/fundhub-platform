// Money-movement breakage for the morning pulse. Read only.
// Tripwire is existing Recon (AG-07). Do not add another watcher.
// Never takes a card payment. Never mints a Commas catalog product.
//
// slice-18-billing.mjs already names the billing and checkout-expiry sweepers.
// slice-10-contracts.mjs already names the contract chaser and the sign door.
// This file does not repeat those. It only reads the four breaks below.
//
// Review notes (Claude, 2026-10-08):
//   * The pay link check used to require commas_session_id IS NULL. Every link
//     we mint through Commas gets that id at mint, so on production the check
//     could never fail. It is gone. Grace now sits on the payment, not the link.
//   * The route check read source files. The pulse runs inside the bundled
//     Netlify function, where those files do not exist, so it would have read
//     "dead" every morning. It now calls the real webhook router in process,
//     with an unsigned empty post and a database that refuses every read.
//   * Simulated receipts (provider_ref sim-pay-...) are test money. They are
//     counted, named in the PASS line, and kept out of the FAIL.
//
// Second review (Claude, 2026-10-08):
//   * The pay link check fired on any money from the same client, whatever the
//     amount. Chris's own $1 prove payment lit it red on a $297 link. The money
//     must now match the link's amount in cents.
//   * It could not see "the webhook was recorded and the link was never settled".
//     That is a processed payment.succeeded inbox row that carries the link ref
//     while the link still reads created or sent. It is now the first thing it reads.
//   * A webhook that never arrived leaves no row anywhere (src/payments/commas-api.mjs
//     says so). No read-only check can see that. It is written on the board, not faked.
//   * The site GET has a timeout, so a hung site cannot eat the whole lane's step.
//
// Tier 1 tripwires (Claude, 2026-10-09). Four more reads, after the first four.
// Each asks one yes-or-no question a paying customer would feel:
//   payments:paid-product-unmapped     did a customer pay and we cannot tell who or what?
//   payments:commas-inbox-waiting      is a paid receipt sitting in the inbox, unclaimed?
//   payments:checkout-started-no-link  did someone press Pay and we never made their link?
//   payments:card-declined-no-followup did a card fail and nobody reached out?
// A failed read on these four is a skip with the reason, never a PASS.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_ATTEMPTS, STALE_CLAIM_MINUTES } from "../../payments/commas-inbox.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** commas-inbox-sweeper runs every minute. Red after 3 times that schedule. */
export const LINK_WEBHOOK_GRACE_MS = 3 * 60 * 1000;

/** The id scripts/sim/push-payment.mjs gives every simulated receipt. No card was charged. */
export const SIM_RECEIPT_PREFIX = "sim-pay-";

export const CHECK_IDS = Object.freeze([
  "payments:invoice-stuck",
  "payments:pay-link-webhook",
  "payments:paid-no-entitlement",
  "payments:commas-webhook-route",
  "payments:paid-product-unmapped",
  "payments:commas-inbox-waiting",
  "payments:checkout-started-no-link",
  "payments:card-declined-no-followup"
]);

/** How far back a paid order is read. Older than this is history, not a morning break. */
export const PAID_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
/** The inbox sweeper runs every minute. A receipt this old and still unclaimed means no clock is working. */
export const INBOX_WAIT_MS = 10 * 60 * 1000;
/** A claimed row is taken back after STALE_CLAIM_MINUTES. Still claimed 5 minutes after that means no clock took it back. */
export const INBOX_PROCESSING_WAIT_MS = (STALE_CLAIM_MINUTES + 5) * 60 * 1000;
/** The Pay press writes its event first and the link a moment later. This long and still no link is a break. */
export const CHECKOUT_LINK_WAIT_MS = 10 * 60 * 1000;
/** A Pay press older than this is old news. The morning job runs daily, so 3 days covers a long weekend gap. */
export const CHECKOUT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
/** A card that failed less than this long ago may still be getting its reach-out. */
export const DECLINE_WAIT_MS = 60 * 60 * 1000;
/** A decline older than this is old news. */
export const DECLINE_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/* A test client is one nobody is selling to. The first three parts are the same
   pattern gap-consent.mjs and gap-portal.mjs use (a drift test holds them equal).
   The last part adds the e2e+ and demo+ addresses the test runners mint: they
   are not on a reserved domain, so the shared pattern alone lets them through. */
export const TEST_CLIENT_EMAIL_RE =
  String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$|^(e2e|demo)\+`;

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not take a card payment. Do not mint a Commas catalog product.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function countOf(result) {
  const n = Number(result?.rows?.[0]?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function readCount(db, sql, params) {
  const result = await db.query(sql, params);
  return countOf(result);
}

const INVOICE_STUCK_SQL = `
  /* gap:invoice-stuck */
  SELECT (
    (SELECT count(*)::int
       FROM v_invoice_aging a
       JOIN invoices i ON i.id = a.invoice_id AND i.org_id = a.org_id
      WHERE a.org_id = $1::uuid
        AND COALESCE(i.is_demo, false) = false
        AND a.status_reconciled = false
        AND a.status NOT IN ('void', 'written_off'))
    +
    (SELECT count(*)::int
       FROM invoices i
       JOIN payment_links pl ON pl.invoice_id = i.id AND pl.org_id = i.org_id
      WHERE i.org_id = $1::uuid
        AND COALESCE(i.is_demo, false) = false
        AND COALESCE(pl.is_demo, false) = false
        AND pl.status = 'paid'
        AND i.status NOT IN ('paid', 'partially_paid', 'void', 'written_off'))
  ) AS n
`;

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
const PAY_LINK_WEBHOOK_SQL = `
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
const PAID_NO_ENTITLEMENT_SQL = `
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

function skipWhy({ db, orgId }, what) {
  if (!db) return `no database in this run — ${what} not read`;
  if (!orgId) return `no org id in this run — ${what} not read`;
  return null;
}

async function checkInvoiceStuck({ db, orgId }) {
  const id = "payments:invoice-stuck";
  const why = skipWhy({ db, orgId }, "stuck invoices");
  if (why) return row(id, "skip", why);
  try {
    const n = await readCount(db, INVOICE_STUCK_SQL, [orgId]);
    if (n === 0) {
      return row(id, "PASS", "no invoice whose dunning state disagrees with the money, and no paid link left on an open invoice");
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "invoice")} stuck (dunning state does not match the money, or a paid link still sits on an open invoice).`,
      `${RECON} Read v_invoice_aging where status_reconciled is false, and any open invoice whose payment link is already paid.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read stuck invoices: ${String(err?.message || err).slice(0, 180)}`,
      `${RECON} Read v_invoice_aging. Do not write the invoice from this pulse.`
    );
  }
}

function intOf(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function checkPayLinkWebhook({ db, orgId, now }) {
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

async function checkPaidNoEntitlement({ db, orgId, now }) {
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

function defaultReadText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * What the source files say about the Commas door: "alive", "dead", or
 * "unreadable". A file we cannot open is not proof of a dead route (the
 * bundled Netlify function ships no source tree), so it is its own answer.
 */
export function commasWebhookFilesState(readText = defaultReadText) {
  let api;
  let router;
  let handler;
  try {
    api = readText("netlify/functions/api.mjs");
    router = readText("src/http/router.mjs");
    handler = readText("api/webhooks/[provider].mjs");
  } catch {
    return "unreadable";
  }
  const prefix =
    /path\.startsWith\("webhooks\/"\)/.test(api) &&
    /route\s*=\s*webhooks/.test(api);
  const commas =
    /handleCommasWebhook/.test(router) &&
    /commas:\s*\{[^}]*fn:\s*handleCommasWebhook/s.test(router);
  const door = /handleWebhook/.test(handler) && /export default async function handler/.test(handler);
  return prefix && commas && door ? "alive" : "dead";
}

/**
 * True when the source files say the Commas webhook door is still wired. No HTTP call.
 * False means dead or unreadable; commasWebhookFilesState tells the two apart.
 */
export function commasWebhookRouteAlive(readText = defaultReadText) {
  return commasWebhookFilesState(readText) === "alive";
}

/** A database that refuses every read. The probe below must never touch data. */
const REFUSING_DB = Object.freeze({
  async query() {
    throw new Error("gap-payments probe: this database is closed to the probe");
  }
});

/**
 * Post an unsigned, empty body to the real Commas branch of the webhook router,
 * in process. A wired door answers 401 bad_signature before it reads anything.
 * A missing provider answers 404. Nothing leaves the machine, nothing is saved,
 * and the env handed in holds a throwaway string, not a real key.
 */
export async function probeCommasDoor(handleWebhookImpl = null) {
  const handleWebhook = handleWebhookImpl || (await import("../../http/router.mjs")).handleWebhook;
  const out = await handleWebhook({
    db: REFUSING_DB,
    provider: "commas",
    rawBody: "{}",
    headers: {},
    env: { COMMAS_WEBHOOK_SECRET: "gap-probe-not-a-key", WEBHOOK_CAPTURE: "0" }
  });
  return out && typeof out === "object" ? Number(out.status) : NaN;
}

const WEBHOOK_URL_PATH = "/api/webhooks/commas";

/** Each lane is one pulse step with a 26 second ceiling. A hung site must be a skip, not a dead step. */
export const PING_TIMEOUT_MS = 8000;

/**
 * GET the door on the site. The webhook function answers 405 to any GET, for
 * any provider name, once the webhooks/ prefix is mounted; an unmounted prefix
 * answers 404. So a 405 proves the prefix is mounted, not that commas is: the
 * 401 from the router probe is the proof for commas. A GET is not uptime and
 * does not touch a payment.
 */
async function pingDoor(fetchImpl, baseUrl) {
  const url = `${String(baseUrl).replace(/\/+$/, "")}${WEBHOOK_URL_PATH}`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(PING_TIMEOUT_MS)
  });
  return { status: Number(res && res.status), url };
}

async function checkCommasWebhookRoute({ readText, handleWebhookImpl, fetchImpl, baseUrl }) {
  const id = "payments:commas-webhook-route";
  const fix = `${RECON} Wire POST /api/webhooks/commas back through the existing webhook handler. Do not add another door.`;

  const files = commasWebhookFilesState(readText);
  if (files === "dead") {
    return row(id, "FAIL", "Commas webhook route is dead (missing webhooks prefix, commas handler, or webhook entry).", fix);
  }

  let status;
  try {
    status = await probeCommasDoor(handleWebhookImpl);
  } catch (err) {
    return row(id, "FAIL", `Commas webhook route is dead: the router would not answer (${String(err?.message || err).slice(0, 160)}).`, fix);
  }
  if (status !== 401) {
    return row(
      id,
      "FAIL",
      status === 404
        ? "Commas webhook route is dead: the router does not know the commas provider (404)."
        : `Commas webhook route is wrong: an unsigned post should answer 401 and answered ${Number.isFinite(status) ? status : "nothing"}.`,
      fix
    );
  }

  const proof = files === "alive" ? "source files and router" : "router in process";
  if (typeof fetchImpl !== "function" || !baseUrl) {
    return row(id, "PASS", `Commas webhook door is wired (${proof}: unsigned post refused 401; site not pinged in this run)`);
  }
  try {
    const ping = await pingDoor(fetchImpl, baseUrl);
    if (ping.status === 405) {
      return row(id, "PASS", `Commas webhook door is wired (${proof}: unsigned post refused 401; ${WEBHOOK_URL_PATH} answers 405 to a GET on the site, so the webhooks/ prefix is mounted)`);
    }
    return row(
      id,
      "FAIL",
      `Commas webhook route is dead on the site: GET ${WEBHOOK_URL_PATH} answered ${Number.isFinite(ping.status) ? ping.status : "nothing"}, not 405.`,
      fix
    );
  } catch (err) {
    return row(id, "skip", `site not reached, so the live webhook door was not read: ${String(err?.message || err).slice(0, 160)}`);
  }
}

// ---- Tier 1 tripwires — Claude, 2026-10-09 ----------------------------------
//
// All four read one row of counts and turn it into a sentence a buyer's day
// would feel. A failed read is a skip with the reason (never a PASS), and a
// skip row carries no suggestedFix. Test money is kept out of every FAIL:
// the demo flag, the sim-pay- receipts, and test clients (TEST_CLIENT_EMAIL_RE).

/* The test-client test, written once and pasted into each statement. `emails`
   is the SQL for the address to test; `param` is the placeholder holding the
   pattern. The clients row must be joined as `c`. */
function testClientSql(emails, param) {
  return `(COALESCE(c.is_demo, false)
          OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(${emails}, '') ~* ${param}::text)`;
}

/* A paid order that nobody can match, read from the money table.
   Two ways to be unmatched:
     no person   the payment row has no client, so nobody can be given access.
                 A partner who pays through a partner link is not a client; that
                 is told apart by the partner link the payment came through.
     no product  the name on the order is in no product and no alias, so
                 reconcileFromTransactions leaves it alone. This alone is NOT a
                 break: a normal Commas payment carries a product id or code in
                 its payload and gets its grant that way (the $1 prove payment
                 has a name that matches nothing and still holds its grant, tied
                 to its own payment row). So an unknown name only counts when the
                 client holds no grant made for that payment or after it. That
                 is the customer's real state: paid, and still locked out.
   Grace sits on the payment (3 minutes), same as the other money reads here. */
export const PAID_PRODUCT_UNMAPPED_SQL = `
  /* gap:paid-product-unmapped */
  SELECT count(*) FILTER (WHERE NOT p.is_test)::int AS paid_n,
         count(*) FILTER (WHERE p.is_test)::int AS test_n,
         count(*) FILTER (WHERE NOT p.is_test AND p.no_client AND NOT p.partner_pays)::int AS no_client_n,
         count(*) FILTER (WHERE NOT p.is_test AND p.no_client AND p.partner_pays)::int AS partner_n,
         count(*) FILTER (WHERE NOT p.is_test AND NOT p.no_client AND p.unmapped AND NOT p.granted)::int AS unmapped_n,
         count(*) FILTER (WHERE NOT p.is_test AND NOT p.no_client AND p.unmapped AND p.granted)::int AS handled_n,
         left(
           string_agg(
             COALESCE(NULLIF(left(p.product_name, 40), ''), 'no product name')
               || ' $' || COALESCE(p.amount_paid::text, '?')
               || ' (order ' || COALESCE(p.provider_ref, 'none')
               || COALESCE(', client ' || p.client_code, ', no client') || ')',
             '; ' ORDER BY p.created_at DESC
           ) FILTER (WHERE NOT p.is_test
                       AND ((p.no_client AND NOT p.partner_pays)
                            OR (NOT p.no_client AND p.unmapped AND NOT p.granted))),
           400
         ) AS sample
    FROM (
      SELECT t.created_at, t.product_name, t.amount_paid, t.provider_ref, c.client_code,
             (t.client_id IS NULL) AS no_client,
             (resolve_product_id(t.org_id, t.product_name) IS NULL) AS unmapped,
             ${testClientSql("c.email", "$5")} AS is_test,
             EXISTS (
               SELECT 1
                 FROM entitlements e
                WHERE e.org_id = t.org_id
                  AND e.client_id = t.client_id
                  AND (e.source_transaction_id = t.id OR e.granted_at >= t.created_at)
             ) AS granted,
             EXISTS (
               SELECT 1
                 FROM payment_links pl
                WHERE pl.org_id = t.org_id
                  AND pl.partner_id IS NOT NULL
                  AND (pl.link_ref = t.raw_payload ->> 'ref' OR pl.id::text = t.raw_payload ->> 'paymentLinkId')
             ) AS partner_pays
        FROM transactions t
        LEFT JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
       WHERE t.org_id = $1::uuid
         AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
         AND COALESCE(t.is_demo, false) = false
         AND COALESCE(t.provider_ref, '') NOT LIKE $3::text
         AND t.created_at >= $4::timestamptz
         AND t.created_at < $2::timestamptz
    ) p
`;

/* A receipt in the Commas inbox that no clock is picking up. Commas sends each
   notice once and never again, so a receipt stuck here is a paid buyer whose
   payment is not yet recorded. Three shapes, all older than the wait:
     pending     never claimed. Whatever attempts it has, the sweeper is not
                 taking it. (webhooks:stuck-failed cannot see a pending row.)
     failed      has tries left, and its last try was over the wait ago. A live
                 sweeper retries it every minute; nobody has.
     processing  claimed, and still claimed long after the sweeper takes a stale
                 claim back, with tries left.
   Rows at the attempt limit are webhooks:stuck-failed's. Not repeated here.
   Simulated receipts (sim-pay-) are counted apart. */
export const COMMAS_INBOX_WAITING_SQL = `
  /* gap:commas-inbox-waiting */
  SELECT count(*) FILTER (WHERE NOT w.sim)::int AS n,
         count(*) FILTER (WHERE NOT w.sim AND w.event_type = 'payment.succeeded')::int AS paid_n,
         count(*) FILTER (WHERE NOT w.sim AND w.status = 'pending')::int AS pending_n,
         count(*) FILTER (WHERE NOT w.sim AND w.status = 'failed')::int AS failed_n,
         count(*) FILTER (WHERE NOT w.sim AND w.status = 'processing')::int AS processing_n,
         count(*) FILTER (WHERE w.sim)::int AS sim_n,
         min(w.received_at) FILTER (WHERE NOT w.sim) AS oldest
    FROM (
      SELECT ci.status, ci.event_type, ci.received_at,
             (COALESCE(ci.payment_id, '') LIKE $3::text) AS sim
        FROM commas_inbox ci
       WHERE ci.org_id = $1::uuid
         AND ci.received_at < $2::timestamptz
         AND (
           ci.status = 'pending'
           OR (ci.status = 'failed'
               AND ci.attempts < $4::int
               AND COALESCE(ci.claimed_at, ci.received_at) < $2::timestamptz)
           OR (ci.status = 'processing'
               AND ci.attempts < $4::int
               AND ci.claimed_at < $5::timestamptz)
         )
    ) w
`;

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

/* A card failed and nobody reached out. payment.failed is the Commas notice.
   Reached out means, after the failure and for that same client: an outbound
   message from a person on staff or from an agent (messages.sender_kind is
   'staff' or 'agent') that was not failed or blocked, or any task, or a later
   paid payment (they paid on a second try). A decline with no client attached
   has nobody to reach: it is counted apart, not a FAIL. Old declines (over 3
   days) and ones under an hour old are left alone.
   An automated message (sender_kind 'system': a drip, a welcome, a coupon) is
   NOT a reach-out. It goes out to every client whatever happened to their card,
   so counting it turned the check green the morning after the next drip. The
   count of declines that got only automated messages is returned as auto_only_n
   so the red line can say why it is red. If a card-decline notice template is
   ever built, this check must be told its key, or it stays red after the system
   has reached out. None exists today. */
export const CARD_DECLINED_NO_FOLLOWUP_SQL = `
  /* gap:card-declined-no-followup */
  SELECT count(*) FILTER (WHERE NOT p.no_client)::int AS declines_n,
         count(*) FILTER (WHERE NOT p.no_client AND NOT p.followed)::int AS n,
         count(*) FILTER (WHERE NOT p.no_client AND NOT p.followed AND p.auto_msg)::int AS auto_only_n,
         count(*) FILTER (WHERE p.no_client)::int AS no_client_n,
         min(p.created_at) FILTER (WHERE NOT p.no_client AND NOT p.followed) AS oldest,
         left(
           string_agg(
             COALESCE(p.client_code, 'no code') || ' (order ' || COALESCE(p.ref, 'none') || ')',
             ', ' ORDER BY p.created_at DESC
           ) FILTER (WHERE NOT p.no_client AND NOT p.followed),
           300
         ) AS sample
    FROM (
      SELECT e.created_at, e.payload ->> 'providerRef' AS ref, c.client_code,
             (e.client_id IS NULL) AS no_client,
             (
               EXISTS (
                 SELECT 1
                   FROM messages m
                  WHERE m.org_id = e.org_id
                    AND m.client_id = e.client_id
                    AND m.direction = 'outbound'
                    AND m.sender_kind IN ('staff', 'agent')
                    AND m.created_at > e.created_at
                    AND lower(COALESCE(m.status, '')) NOT IN ('failed', 'blocked', 'bounced', 'cancelled')
               )
               OR EXISTS (
                 SELECT 1
                   FROM tasks k
                  WHERE k.org_id = e.org_id
                    AND k.client_id = e.client_id
                    AND k.created_at > e.created_at
               )
               OR EXISTS (
                 SELECT 1
                   FROM transactions tx
                  WHERE tx.org_id = e.org_id
                    AND tx.client_id = e.client_id
                    AND lower(btrim(COALESCE(tx.status, ''))) = 'succeeded'
                    AND COALESCE(tx.is_demo, false) = false
                    AND tx.created_at > e.created_at
               )
             ) AS followed,
             EXISTS (
               SELECT 1
                 FROM messages m
                WHERE m.org_id = e.org_id
                  AND m.client_id = e.client_id
                  AND m.direction = 'outbound'
                  AND COALESCE(m.sender_kind, 'system') = 'system'
                  AND m.created_at > e.created_at
                  AND lower(COALESCE(m.status, '')) NOT IN ('failed', 'blocked', 'bounced', 'cancelled')
             ) AS auto_msg
        FROM events e
        LEFT JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
       WHERE e.org_id = $1::uuid
         AND e.name = 'payment.failed'
         AND COALESCE(e.is_demo, false) = false
         AND e.created_at < $2::timestamptz
         AND e.created_at >= $3::timestamptz
         AND COALESCE(e.payload ->> 'providerRef', '') NOT LIKE $4::text
         AND NOT ${testClientSql("c.email, e.payload ->> 'email'", "$5")}
    ) p
`;

function oneRow(result) {
  const r = result?.rows?.[0];
  return r && typeof r === "object" ? r : null;
}

function ageOf(then, now) {
  const t = then instanceof Date ? then : new Date(then);
  const ms = now.getTime() - t.getTime();
  if (!Number.isFinite(ms) || ms < 0) return "a short time";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 120) return plural(Math.max(minutes, 1), "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

async function readTripwire(db, id, what, sql, params) {
  try {
    const r = oneRow(await db.query(sql, params));
    if (!r) return { skip: row(id, "skip", `could not read ${what}: the read came back with no row`) };
    return { r };
  } catch (err) {
    return { skip: row(id, "skip", `could not read ${what}: ${String(err?.message || err).slice(0, 180)}`) };
  }
}

async function checkPaidProductUnmapped({ db, orgId, now }) {
  const id = "payments:paid-product-unmapped";
  const why = skipWhy({ db, orgId }, "paid orders");
  if (why) return row(id, "skip", why);
  const cutoff = new Date(now.getTime() - LINK_WEBHOOK_GRACE_MS).toISOString();
  const since = new Date(now.getTime() - PAID_LOOKBACK_MS).toISOString();
  const got = await readTripwire(db, id, "paid orders", PAID_PRODUCT_UNMAPPED_SQL, [
    orgId, cutoff, `${SIM_RECEIPT_PREFIX}%`, since, TEST_CLIENT_EMAIL_RE
  ]);
  if (got.skip) return got.skip;
  const r = got.r;
  const paidN = intOf(r.paid_n);
  const noClientN = intOf(r.no_client_n);
  const unmappedN = intOf(r.unmapped_n);
  const handledN = intOf(r.handled_n);
  const partnerN = intOf(r.partner_n);
  const testN = intOf(r.test_n);
  const left = [];
  if (handledN > 0) left.push(`${plural(handledN, "order")} with an unknown product name already ${handledN === 1 ? "has" : "have"} access`);
  if (partnerN > 0) left.push(`${plural(partnerN, "partner payment")}`);
  if (testN > 0) left.push(`${plural(testN, "test-client payment")}`);
  const leftNote = left.length ? ` Left out: ${left.join(", ")}.` : "";
  const n = noClientN + unmappedN;
  if (n === 0) {
    return row(
      id,
      "PASS",
      paidN === 0
        ? `no real paid order in the last 30 days to check.${leftNote}`
        : `${plural(paidN, "real paid order")} in the last 30 days, and each has a person plus a known product or access.${leftNote}`
    );
  }
  const parts = [];
  if (noClientN > 0) parts.push(`${plural(noClientN, "order")} with no person attached`);
  if (unmappedN > 0) parts.push(`${plural(unmappedN, "order")} for a product name we do not know, with no access given since`);
  const sample = typeof r.sample === "string" && r.sample ? ` ${r.sample}.` : "";
  return row(
    id,
    "FAIL",
    `${plural(n, "paid order")} in the last 30 days that we cannot match: ${parts.join("; ")}.${sample}${leftNote}`,
    `${RECON} Match each order to its person and product by hand: add the vendor title to the product's aliases through the existing product flow, then give the access in the existing grant flow. Do not take the payment again.`
  );
}

async function checkCommasInboxWaiting({ db, orgId, now }) {
  const id = "payments:commas-inbox-waiting";
  const why = skipWhy({ db, orgId }, "the Commas inbox");
  if (why) return row(id, "skip", why);
  const cutoff = new Date(now.getTime() - INBOX_WAIT_MS).toISOString();
  const processingCutoff = new Date(now.getTime() - INBOX_PROCESSING_WAIT_MS).toISOString();
  const got = await readTripwire(db, id, "the Commas inbox", COMMAS_INBOX_WAITING_SQL, [
    orgId, cutoff, `${SIM_RECEIPT_PREFIX}%`, MAX_ATTEMPTS, processingCutoff
  ]);
  if (got.skip) return got.skip;
  const r = got.r;
  const n = intOf(r.n);
  const simN = intOf(r.sim_n);
  const simNote = simN > 0 ? ` (${plural(simN, "simulated receipt")} left out: no card was charged)` : "";
  if (n === 0) {
    return row(id, "PASS", `no Commas receipt is waiting for a clock to pick it up${simNote}`);
  }
  const paidN = intOf(r.paid_n);
  const oldest = r.oldest ? ` The oldest came in ${ageOf(r.oldest, now)} ago.` : "";
  return row(
    id,
    "FAIL",
    `${plural(n, "Commas receipt")} waiting in the inbox that no clock is picking up: ` +
      `${intOf(r.pending_n)} never tried, ${intOf(r.failed_n)} failed with tries left, ${intOf(r.processing_n)} stuck mid-pass. ` +
      `${n === 1 ? (paidN === 1 ? "It is a paid receipt." : "It is not a paid receipt.") : `${paidN} of them ${paidN === 1 ? "is a paid receipt" : "are paid receipts"}.`}${oldest}${simNote}`,
    `${RECON} Read commas_inbox for those rows. The two inbox clocks (commas-inbox-sweeper and commas-inbox-drain) should have taken them. Commas never sends a notice twice, so keep the row bytes as they are.`
  );
}

async function checkCheckoutStartedNoLink({ db, orgId, now }) {
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

async function checkCardDeclinedNoFollowup({ db, orgId, now }) {
  const id = "payments:card-declined-no-followup";
  const why = skipWhy({ db, orgId }, "card declines");
  if (why) return row(id, "skip", why);
  const cutoff = new Date(now.getTime() - DECLINE_WAIT_MS).toISOString();
  const since = new Date(now.getTime() - DECLINE_LOOKBACK_MS).toISOString();
  const got = await readTripwire(db, id, "card declines", CARD_DECLINED_NO_FOLLOWUP_SQL, [
    orgId, cutoff, since, `${SIM_RECEIPT_PREFIX}%`, TEST_CLIENT_EMAIL_RE
  ]);
  if (got.skip) return got.skip;
  const r = got.r;
  const declinesN = intOf(r.declines_n);
  const noClientN = intOf(r.no_client_n);
  const n = intOf(r.n);
  const noClientNote = noClientN > 0 ? ` (${plural(noClientN, "decline")} with no client attached left out: nobody to reach)` : "";
  if (n === 0) {
    return row(
      id,
      "PASS",
      declinesN === 0
        ? `no real card decline in the last 3 days is old enough to check${noClientNote}`
        : `${plural(declinesN, "real card decline")} in the last 3 days, and each client has a later staff or agent message, task or payment${noClientNote}`
    );
  }
  const oldest = r.oldest ? ` The oldest was ${ageOf(r.oldest, now)} ago.` : "";
  const sample = typeof r.sample === "string" && r.sample ? ` Clients: ${r.sample}.` : "";
  const autoOnlyN = intOf(r.auto_only_n);
  const autoNote = autoOnlyN === 0
    ? ""
    : n === 1
      ? " That client has only had automated drip messages since, and those do not count."
      : ` For ${autoOnlyN} of them the client has only had automated drip messages since, and those do not count.`;
  return row(
    id,
    "FAIL",
    `${plural(n, "card decline")} over an hour old with no staff or agent message, no task and no later payment for that client.${autoNote}${oldest}${sample}${noClientNote}`,
    `${RECON} Reach those clients by hand with a fresh pay link from the existing flow. The payment.failed handler only saves a failed payment row today; it makes no text and no task. Automated drip messages do not count as reaching out. Do not take the card again.`
  );
}

/**
 * Eight read-only checks. ctx: { db, orgId, now, fetchImpl (or fetch), baseUrl, readText, handleWebhook }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 * The first four are the original lane. The last four are the 2026-10-09 tripwires.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const readText = typeof ctx.readText === "function" ? ctx.readText : defaultReadText;
  const fetchImpl = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : (typeof ctx.fetch === "function" ? ctx.fetch : null);
  const handleWebhookImpl = typeof ctx.handleWebhook === "function" ? ctx.handleWebhook : null;
  return [
    await checkInvoiceStuck({ db, orgId }),
    await checkPayLinkWebhook({ db, orgId, now }),
    await checkPaidNoEntitlement({ db, orgId, now }),
    await checkCommasWebhookRoute({ readText, handleWebhookImpl, fetchImpl, baseUrl: ctx.baseUrl || null }),
    await checkPaidProductUnmapped({ db, orgId, now }),
    await checkCommasInboxWaiting({ db, orgId, now }),
    await checkCheckoutStartedNoLink({ db, orgId, now }),
    await checkCardDeclinedNoFollowup({ db, orgId, now })
  ];
}
