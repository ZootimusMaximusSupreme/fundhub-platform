// Money-movement breakage for the morning pulse. Read only.
// Tripwire is existing Recon (AG-07). Do not add another watcher.
// Never takes a card payment. Never mints a Commas catalog product.
//
// slice-18-billing.mjs already names the billing and checkout-expiry sweepers.
// slice-10-contracts.mjs already names the contract chaser and the sign door.
// This file does not repeat those. It only reads the four breaks below.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** commas-inbox-sweeper runs every minute. Red after 3 times that schedule. */
export const LINK_WEBHOOK_GRACE_MS = 3 * 60 * 1000;

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

const PAY_LINK_WEBHOOK_SQL = `
  /* gap:pay-link-webhook */
  SELECT count(*)::int AS n
    FROM payment_links pl
   WHERE pl.org_id = $1::uuid
     AND COALESCE(pl.is_demo, false) = false
     AND pl.checkout_url IS NOT NULL
     AND btrim(pl.checkout_url) <> ''
     AND pl.link_ref IS NOT NULL
     AND pl.commas_session_id IS NULL
     AND pl.status IN ('created', 'sent')
     AND pl.created_at < $2::timestamptz
     AND EXISTS (
       SELECT 1
         FROM transactions t
        WHERE t.org_id = pl.org_id
          AND t.client_id = pl.client_id
          AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
          AND t.created_at >= pl.created_at
     )
     AND NOT EXISTS (
       SELECT 1
         FROM commas_inbox ci
        WHERE ci.org_id = pl.org_id
          AND position(pl.link_ref in ci.raw_body) > 0
     )
`;

const PAID_NO_ENTITLEMENT_SQL = `
  /* gap:paid-no-entitlement */
  SELECT count(DISTINCT t.id)::int AS n
    FROM transactions t
    JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
    JOIN product_entitlements pe
      ON pe.org_id = t.org_id
     AND lower(btrim(pe.product_code)) = lower(btrim(p.code))
   WHERE t.org_id = $1::uuid
     AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
     AND t.client_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM entitlements e
        WHERE e.org_id = t.org_id
          AND e.client_id = t.client_id
          AND e.source_transaction_id = t.id
          AND lower(btrim(e.entitlement_code)) = lower(btrim(pe.entitlement_code))
     )
`;

async function checkInvoiceStuck({ db, orgId }) {
  const id = "payments:invoice-stuck";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — stuck invoices not read");
  }
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

async function checkPayLinkWebhook({ db, orgId, now }) {
  const id = "payments:pay-link-webhook";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — pay link webhooks not read");
  }
  const cutoff = new Date(now.getTime() - LINK_WEBHOOK_GRACE_MS).toISOString();
  try {
    const n = await readCount(db, PAY_LINK_WEBHOOK_SQL, [orgId, cutoff]);
    if (n === 0) {
      return row(id, "PASS", "no minted pay link has a succeeded payment and a missing Commas inbox row");
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "pay link")} minted, a payment succeeded, and no Commas inbox row recorded the link ref.`,
      `${RECON} Read payment_links and commas_inbox for that link ref. Do not mint another link.`
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

async function checkPaidNoEntitlement({ db, orgId }) {
  const id = "payments:paid-no-entitlement";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — entitlements not read");
  }
  try {
    const n = await readCount(db, PAID_NO_ENTITLEMENT_SQL, [orgId]);
    if (n === 0) {
      return row(id, "PASS", "every succeeded payment that has a product mapping also has its entitlement row");
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "succeeded payment")} mapped to a product entitlement and missing that grant.`,
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

/** True when the live Commas webhook door is still wired. No HTTP call. */
export function commasWebhookRouteAlive(readText = defaultReadText) {
  const api = readText("netlify/functions/api.mjs");
  const router = readText("src/http/router.mjs");
  const handler = readText("api/webhooks/[provider].mjs");
  const prefix =
    /path\.startsWith\("webhooks\/"\)/.test(api) &&
    /route\s*=\s*webhooks/.test(api);
  const commas =
    /handleCommasWebhook/.test(router) &&
    /commas:\s*\{[^}]*fn:\s*handleCommasWebhook/s.test(router);
  const door = /handleWebhook/.test(handler) && /export default async function handler/.test(handler);
  return prefix && commas && door;
}

function checkCommasWebhookRoute(readText) {
  const id = "payments:commas-webhook-route";
  try {
    if (commasWebhookRouteAlive(readText)) {
      return row(id, "PASS", "Commas webhook door is wired (webhooks/ prefix and handleCommasWebhook)");
    }
    return row(
      id,
      "FAIL",
      "Commas webhook route is dead (missing webhooks prefix, commas handler, or webhook entry).",
      `${RECON} Wire POST /api/webhooks/commas back through the existing webhook handler. Do not add another door.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `Commas webhook route is dead: ${String(err?.message || err).slice(0, 180)}`,
      `${RECON} Wire POST /api/webhooks/commas back through the existing webhook handler. Do not add another door.`
    );
  }
}

/**
 * Four read-only checks. ctx: { db, orgId, now, readText }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const readText = typeof ctx.readText === "function" ? ctx.readText : defaultReadText;
  return [
    await checkInvoiceStuck({ db, orgId }),
    await checkPayLinkWebhook({ db, orgId, now }),
    await checkPaidNoEntitlement({ db, orgId }),
    checkCommasWebhookRoute(readText)
  ];
}
