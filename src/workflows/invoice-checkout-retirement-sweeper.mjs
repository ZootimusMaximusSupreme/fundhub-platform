// Recovery for Commas URLs left payable when an invoice is closed or a partial
// payment changes its balance. The event handler tries first; this clock finds
// only aged, expired fee-invoice links and never touches Whop or other offers.
import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { retireInvoiceCheckoutLink } from "../payment-links/retire-invoice-checkout.mjs";

export const SOURCE_WORKFLOW = "invoice-checkout-retirement-sweeper";
export const SWEEP_CRON = "55 * * * *";
export const MAX_LINKS_PER_SWEEP = 4;

export async function sweepInvoiceCheckoutRetirement(conn = db, {
  retireLink = retireInvoiceCheckoutLink,
  env = process.env,
  fetchImpl = fetch,
  limit = MAX_LINKS_PER_SWEEP
} = {}) {
  const capped = Math.max(0, Math.min(MAX_LINKS_PER_SWEEP, Math.trunc(Number(limit) || 0)));
  if (!capped) return { scanned: 0, retired: 0, failed: 0 };
  const candidates = (await conn.query(
    `SELECT pl.id, pl.org_id, pl.invoice_id
       FROM payment_links pl
       JOIN invoices i ON i.id = pl.invoice_id
         AND i.org_id = pl.org_id AND i.client_id = pl.client_id
      WHERE pl.provider = 'commas' AND pl.status = 'expired'
        AND pl.invoice_id IS NOT NULL AND pl.commas_session_id IS NOT NULL
        AND pl.updated_at < now() - interval '5 minutes'
        AND (i.source = 'funding_success_fee' OR i.invoice_type = 'success_fee')
      ORDER BY pl.updated_at ASC, pl.id ASC
      LIMIT $1`,
    [capped]
  )).rows;
  let retired = 0;
  let failed = 0;
  for (const row of candidates) {
    try {
      await retireLink(conn, {
        linkId: row.id, orgId: row.org_id, invoiceId: row.invoice_id, env, fetchImpl
      });
      retired++;
    } catch (err) {
      failed++;
      await conn.query(
        `UPDATE payment_links
            SET provider_retire_last_error = $4
          WHERE id = $1 AND org_id = $2 AND invoice_id = $3 AND status = 'expired'`,
        [row.id, row.org_id, row.invoice_id, String(err?.message || err).slice(0, 180)]
      );
    }
  }
  // A failed provider call remains expired and retryable. The heartbeat records
  // a failed run; the deep pulse sees the saved error before a customer retries.
  if (failed) throw new Error(`${failed} Commas invoice checkout retirement attempts failed`);
  return { scanned: candidates.length, retired, failed };
}

export async function handle({ db: handleDb = db, step } = {}) {
  const run = () => sweepInvoiceCheckoutRetirement(handleDb);
  return step?.run ? step.run("retire-invoice-checkouts", run) : run();
}

export const invoiceCheckoutRetirementSweeper = inngest.createFunction(
  { id: SOURCE_WORKFLOW, name: "Retire stale Commas invoice checkouts" },
  { cron: SWEEP_CRON }, handle
);
