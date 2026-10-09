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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** commas-inbox-sweeper runs every minute. Red after 3 times that schedule. */
export const LINK_WEBHOOK_GRACE_MS = 3 * 60 * 1000;

/** The id scripts/sim/push-payment.mjs gives every simulated receipt. No card was charged. */
export const SIM_RECEIPT_PREFIX = "sim-pay-";

export const CHECK_IDS = Object.freeze([
  "payments:invoice-stuck",
  "payments:pay-link-webhook",
  "payments:paid-no-entitlement",
  "payments:commas-webhook-route"
]);

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

/**
 * Four read-only checks. ctx: { db, orgId, now, fetchImpl (or fetch), baseUrl, readText, handleWebhook }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
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
    await checkCommasWebhookRoute({ readText, handleWebhookImpl, fetchImpl, baseUrl: ctx.baseUrl || null })
  ];
}
