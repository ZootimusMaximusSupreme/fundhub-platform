// Repair a lost invoice.sent bus insertion or best-effort Inngest handoff.
// Customer notices remain AR-owned; this clock never writes messages or links.
import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { emit } from "../events/bus.mjs";
import { invoiceDisplayNumber } from "../invoices/index.mjs";
import {
  RECOVERY_CANDIDATE_SQL, CLAIM_RECOVERY_SQL, RELEASE_RECOVERY_SQL
} from "./invoice-sent-recovery-query.mjs";

export const SOURCE_WORKFLOW = "invoice-sent-recovery";
export const SWEEP_CRON = "*/30 * * * *";
export const MAX_INVOICES_PER_SWEEP = 4;

async function announceMissingEvent(conn, invoice) {
  return emit(conn, "invoice.sent", {
    invoiceId: invoice.id,
    invoice_number: invoiceDisplayNumber(invoice),
    amount_due: invoice.amount_due,
    source: invoice.source,
    invoice_type: invoice.invoice_type,
    funding_round_id: invoice.funding_round_id,
    status: invoice.status
  }, {
    orgId: invoice.org_id,
    clientId: invoice.client_id,
    idempotencyKey: `invoice.sent:${invoice.id}`,
    // The normal bus fan-out is intentionally fire-and-forget. This recovery
    // must await one send and release its claim if that send fails.
    skipInngest: true
  });
}

function validSavedEvent(invoice) {
  const payload = invoice.event_payload;
  return invoice.event_id && invoice.event_name === "invoice.sent" &&
    invoice.event_client_id === invoice.client_id &&
    payload?.invoiceId === invoice.id &&
    payload?.source === "funding_success_fee";
}

export async function sweepInvoiceSentRecovery(conn = db, {
  announce = announceMissingEvent,
  sendEvent = (event) => inngest.send(event),
  limit = MAX_INVOICES_PER_SWEEP
} = {}) {
  const capped = Math.max(0, Math.min(MAX_INVOICES_PER_SWEEP, Math.trunc(Number(limit) || 0)));
  if (!capped) return { scanned: 0, announced: 0, dispatched: 0, skipped: 0, failed: 0 };
  const candidates = (await conn.query(RECOVERY_CANDIDATE_SQL, [capped, null])).rows;
  let announced = 0;
  let dispatched = 0;
  let skipped = 0;
  let failed = 0;
  for (const invoice of candidates) {
    try {
      if (!invoice.event_id) {
        const out = await announce(conn, invoice);
        if (!out?.deduped) announced++;
      }
      // Re-read after announcement and immediately before the claim. A receipt,
      // a completed AR-01, or another sweep may have changed the answer.
      const current = (await conn.query(RECOVERY_CANDIDATE_SQL, [1, invoice.id])).rows[0];
      if (!current) { skipped++; continue; }
      if (!validSavedEvent(current)) {
        throw new Error(`Invoice ${invoice.id} has an invalid saved invoice.sent event`);
      }
      const previous = current.event_replayed_at ?? null;
      const claim = (await conn.query(CLAIM_RECOVERY_SQL, [
        current.event_id, current.org_id, current.id, previous
      ])).rows[0];
      if (!claim) { skipped++; continue; }
      try {
        await sendEvent({
          name: "invoice.sent",
          data: {
            id: current.event_id,
            payload: current.event_payload,
            orgId: current.org_id,
            clientId: current.event_client_id
          }
        });
        dispatched++;
      } catch (err) {
        await conn.query(RELEASE_RECOVERY_SQL, [
          current.event_id, current.org_id, previous, claim.replayed_at
        ]);
        throw err;
      }
    } catch (err) {
      failed++;
      console.error(`[invoice-sent-recovery] invoice ${invoice.id}: ${String(err?.message || err)}`);
    }
  }
  if (failed) throw new Error(`${failed} invoice.sent recovery attempts failed`);
  return { scanned: candidates.length, announced, dispatched, skipped, failed };
}

export async function handle({ db: handleDb = db, step } = {}) {
  const run = () => sweepInvoiceSentRecovery(handleDb);
  return step?.run ? step.run("recover-invoice-sent", run) : run();
}

export const invoiceSentRecovery = inngest.createFunction(
  { id: SOURCE_WORKFLOW, name: "Recover missing fee invoice notices" },
  { cron: SWEEP_CRON }, handle
);
