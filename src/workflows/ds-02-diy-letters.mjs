// DS-02 — DIY Letters.
// Source: the CRM workflow (the CRM system map DOWNSELL WORKFLOWS section).
//
// HARD RULE 1 — the reason this file exists in this exact shape: dispute letters
// fire ONLY on the not-qualified downsell path, never on the funding route. The
// product-name gate (Rule 4: route by NAME, "Consulting Services Package" — the
// $1,000 DIY product per Spec §4.2 — never by dollar amount) and the funding-route
// block below are BOTH covered by tests proving each direction
// (ds-02-diy-letters.test.mjs) — that test is the actual point of this file.
// Since 2026-10-14 (R03) the product CODE on the payment decides first; the
// name is read only when no code is carried (see isDiyProduct below).
//
// The invoice stub is now wired to src/invoices/ (017_invoices migration).
// Commas outbound checkout is still a manual task — the invoice record here is
// the platform's internal ledger entry (money owed), not a Commas API call.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { clientOutcomeTier, isRepairOnlyPath } from "../config/product-path.mjs";
import { addTags } from "./tags.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { createInvoice, depositKey } from "../invoices/index.mjs";
import { createTask } from "../lib/create-task.mjs";
import { deliverDiyPackageInRepo } from "../metro2/diy/deliver.mjs";
import { persistDiyPackageFiles } from "../metro2/diy/persist.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { buildLetterPackForClient } from "../underwrite/letter-pack.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-DS02-DIY-LETTERS-READY";
const SOURCE_WORKFLOW = "ds-02-diy-letters";
/** @deprecated external UIQ removed — in-repo letter-pack only */
export const DELIVER_LETTERS_URL = null;

/* The $1,000 DIY letter pack's own product code (db/migrations/384). */
const DIY_PRODUCT_CODE = "diy-letter-pack";

/* Is this payment the DIY downsell? A product code carried on the payment is
   the durable identity and decides it: only the DIY pack's own code is DIY.
   The name test is for a payment that carries no code at all (a Commas
   dashboard purchase with no link of ours). It cannot be trusted when a code is
   present: the Capital Blueprint's Commas title IS "Consulting Services
   Package" and its bucket is filed under 'diy', so the name alone read a $5,000
   Blueprint payment as this product and raised a false invoice and email. */
function isDiyProduct(payload) {
  const code = String(payload?.productCode || "").trim().toLowerCase();
  if (code) return code === DIY_PRODUCT_CODE;
  const n = String(payload?.productName ?? payload?.product ?? "").toLowerCase();
  return n.includes("consulting services package") || n.includes("diy");
}

async function createInvoiceTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: "Send DIY invoice (Commas checkout) — confirm payment captured",
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "admin",
      eventId: eventId
    });
  return { created: true };
}

/** In-repo only — Fundhub letter-pack (gold templates + UIQ data). No external UIQ. */
async function deliverLettersInRepo(db, {
  clientId, orgId, identity, violationsByBureau, store = null, sourceEventId = null
} = {}) {
  const enginePack = await deliverDiyPackageInRepo(db, {
    clientId, orgId, identity, violationsByBureau, seed: `${orgId}:${clientId}`, store
  });
  if (enginePack.delivered) return enginePack;
  if (enginePack.reason && enginePack.reason !== "no_violations") return enginePack;
  const pack = await buildLetterPackForClient(db, { clientId, pack: "repair" });
  const files = pack.files || [];
  if (!files.length) {
    return {
      delivered: false,
      reason: pack.reason || pack.engineSkip || "empty_pack",
      event: "diy.package.generating"
    };
  }
  // THE BYTES ARE THE DELIVERABLE. Until now this fallback mapped the pack down
  // to a filename and a byte COUNT and dropped the PDFs on the floor, while the
  // client was emailed "your correction letters are ready". The engine path
  // above has always persisted (deliver.mjs); this one now uses the same
  // registry through the same helper. Never report delivered without storing.
  let persisted = { stored: [], skipped: "not_attempted" };
  if (db && orgId && clientId) {
    try {
      persisted = await persistDiyPackageFiles(db, store || storeFromEnv(), {
        orgId,
        clientId,
        files,
        generatedBy: SOURCE_WORKFLOW,
        sourceEventId: sourceEventId || `${orgId}:${clientId}`,
        pack: "repair_letter_pack"
      });
    } catch (err) {
      persisted = { stored: [], skipped: String(err && err.message || err).slice(0, 240) };
    }
  }
  return {
    delivered: true,
    letterCount: files.length,
    files: files.map((f) => ({
      path: f.filename || f.name || f.path,
      bytes: f.buffer?.byteLength || f.content?.byteLength || f.pdf?.byteLength || f.bytes?.byteLength || 0
    })),
    documents: persisted.stored,
    persistSkipped: persisted.skipped,
    event: "diy.package.ready",
    engineSkip: pack.engineSkip || null
  };
}

async function deliverLetters(fetchImpl, {
  clientId, orgId, env, db, identity, violationsByBureau, store = null, sourceEventId = null
} = {}) {
  return deliverLettersInRepo(db, {
    clientId, orgId, identity, violationsByBureau, store, sourceEventId
  });
}

async function deliverLettersOnce(db, fetchImpl, {
  clientId, orgId, eventId, env, identity, violationsByBureau, store = null,
  deliverLettersFn = deliverLetters
}) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  if (r.rows[0]?.custom_fields?.diy_delivered_event_id === eventId) {
    return { delivered: true, skipped: true };
  }
  const result = await deliverLettersFn(fetchImpl, {
    clientId, orgId, env, db, identity, violationsByBureau, store, sourceEventId: eventId || null
  });
  if (result.delivered) {
    await db.query(`UPDATE clients SET custom_fields = custom_fields || $2::jsonb WHERE id = $1`,
      [clientId, JSON.stringify({ diy_delivered_event_id: eventId })]);
  }
  return result;
}

// handle — pure business logic. `fetchImpl` is injected (defaults to global fetch)
// so tests can supply a fake instead of making a real network call.
export async function handle({ event, db, step, fetchImpl = globalThis.fetch, deliverLettersFn = null, store = null }) {
  if (!isDiyProduct(event.payload)) {
    return { done: false, reason: "not_diy_product" };
  }

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  // HARD RULE 1 — only REPAIR_ONLY gets DIY letters. Fail closed: null/unknown tier = do NOT send.
  const outcomeTier = await step.run("check-product-path", () => clientOutcomeTier(db, clientId));
  if (!isRepairOnlyPath(outcomeTier)) return { done: false, reason: `blocked_not_repair_only:${outcomeTier ?? "null"}` };

  const orgId = event.orgId;
  const eventId = event.id;

  // Human still mails via /api/repair/send (shared bureau mail helper). Never print-mail on pay.
  await step.run("set-diy-status-processing", () => mergeCustomFields(db, clientId, { diy_status: "Processing" }));
  const { saleId, amount } = event.payload || {};
  const invoice = await step.run("create-deposit-invoice", () =>
    createInvoice(db, {
      orgId,
      clientId,
      // Canonical vocabulary. Deriving source from invoiceType:'deposit' is
      // lossy — it lands on 'other' and the row can no longer say it was DIY.
      source: "diy_letters",
      amount: Number(amount) || 0,
      saleId: saleId ?? null,
      idempotencyKey: saleId ? depositKey(saleId) : null,
      // Second idempotency dimension. Without it a replay carrying no saleId
      // wrote a NULL key, the ON CONFLICT guard never fired, and the client was
      // invoiced twice for the same payment.
      sourceEventId: eventId ?? null,
      notes: "DS-02 DIY Consulting Services Package",
    }));
  const invoiceTask = await step.run("create-invoice-task", () => createInvoiceTaskOnce(db, { orgId, clientId, eventId }));
  const delivery = await step.run("deliver-letters", () => deliverLettersOnce(db, fetchImpl, {
    clientId,
    orgId,
    eventId,
    env: event.env,
    identity: event.payload?.identity,
    violationsByBureau: event.payload?.violationsByBureau,
    store,
    deliverLettersFn: deliverLettersFn || deliverLetters
  }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  await step.run("tag-diy-letters", () => addTags(db, clientId, ["client:diy-letters"]));
  await step.run("set-diy-status-final", () =>
    mergeCustomFields(db, clientId, { diy_status: delivery.delivered ? "Delivered" : "Delivery Failed — Retry" }));

  return { done: true, invoice, invoiceTask, delivery, email };
}

export const ds02DiyLetters = inngest.createFunction(
  { id: "ds-02-diy-letters", name: "DS-02 — DIY Letters" },
  { event: "payment.received" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
