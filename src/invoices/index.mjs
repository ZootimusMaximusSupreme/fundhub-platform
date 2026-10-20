// src/invoices/index.mjs — canonical invoice helpers.
//
// Invoices record money OWED. Money RECEIVED goes in sale_payments / transactions.
//
// Pattern mirrors commission_ledger: idempotent upserts via ON CONFLICT DO NOTHING,
// no deletes, status transitions validated here.
//
// FLAG for Darwin/Chris: due_at policy (net 30? on demand?) is not set here —
// callers must pass it or leave null. See 017_invoices.sql for full notes.
//
// ── 031 RECONCILIATION ───────────────────────────────────────────────────────
// 031_invoices.sql renamed three columns and this file was not updated with it,
// so every write here raised SQLSTATE 42703 against a real database and took the
// F-07 and DS-02 workflows down mid-flight. The renames:
//     amount       -> amount_due
//     provider_ref -> external_ref
//     issued_at    -> sent_at
// It also retired 'overdue' as a stored status (it is computed in
// v_invoice_aging) and added 'reminded' and 'escalated' to the AR ladder, so the
// transition guards below had to move with it.
//
// This went unnoticed because the only tests covering these functions run
// against in-memory fakes that still modelled the pre-031 column names — a
// structural check passing over a dead feature. There is now a *.pg.test.mjs
// beside this file that runs the real SQL against real Postgres.
//
// `source` is the canonical column; `invoice_type` is the legacy 017 vocabulary
// and 031 keeps the two in sync with trg_invoices_sync_legacy_type in BOTH
// directions. Callers may pass either. Passing `source` is preferred, because
// deriving it from invoice_type is lossy: 'deposit' and 'platform_fee' cannot
// say which product they came from and land on 'other'.

/* The AR ladder states a payment or a send may still act on. 'overdue' is
   deliberately absent — 031 removed it as a stored value. */
const OPEN_STATUSES = ["draft", "sent", "reminded", "escalated", "partially_paid"];

/** @param {object} db — pg pool/client */
export async function createInvoice(db, {
  orgId,
  clientId,
  invoiceType = null, // legacy: 'deposit' | 'success_fee' | 'platform_fee'
  source = null,      // canonical: funding_success_fee | diy_letters | repair_bundle | backend_selling | other
  sourceEventId = null,
  amount,
  currency = "USD",
  saleId = null,
  fundingRoundId = null,
  dueAt = null,
  provider = null,
  providerRef = null,
  idempotencyKey = null,
  notes = null,
}) {
  if (!invoiceType && !source) {
    throw new Error("createInvoice: pass source (preferred) or invoiceType — invoices.source is NOT NULL");
  }
  const result = await db.query(
    `INSERT INTO invoices
       (org_id, client_id, invoice_type, source, source_event_id, amount_due, currency,
        sale_id, funding_round_id, due_at,
        provider, external_ref, idempotency_key, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     -- Bare DO NOTHING, not a targeted one. 031 defines THREE unique dimensions
     -- on this table — idempotency_key, source_event_id and (provider,
     -- external_ref) — and naming only the first means a replay that collides on
     -- either of the others raises 23505 instead of being absorbed. The
     -- migration's own comment calls for exactly this.
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [orgId, clientId, invoiceType, source, sourceEventId, amount, currency,
     saleId, fundingRoundId, dueAt,
     provider, providerRef, idempotencyKey, notes]
  );
  // DO NOTHING means rows[] may be empty on duplicate
  return result.rows[0] ?? null;
}

/** Mark an invoice as sent (draft → sent). */
export async function markSent(db, { invoiceId, issuedAt = new Date() }) {
  const result = await db.query(
    `UPDATE invoices
        SET status = 'sent', sent_at = $2
      WHERE id = $1
        AND status = 'draft'
     RETURNING *`,
    [invoiceId, issuedAt]
  );
  return result.rows[0] ?? null;
}

/** Mark an invoice as escalated (AR-04 automated collections handoff). */
export async function markEscalated(db, { invoiceId, escalatedAt = new Date() }) {
  const result = await db.query(
    `UPDATE invoices
        SET status = 'escalated', escalated_at = $2
      WHERE id = $1
        AND status = ANY($3)
     RETURNING *`,
    [invoiceId, escalatedAt, ["sent", "reminded", "partially_paid"]]
  );
  return result.rows[0] ?? null;
}

/** Mark an invoice as paid. Any open rung of the AR ladder may settle. */
export async function markPaid(db, { invoiceId, paidAt = new Date() }) {
  const result = await db.query(
    `UPDATE invoices
        SET status = 'paid', paid_at = $2
      WHERE id = $1
        AND status = ANY($3)
     RETURNING *`,
    [invoiceId, paidAt, OPEN_STATUSES]
  );
  return result.rows[0] ?? null;
}

/** Void an invoice. Idempotent — already-voided rows return unchanged. */
export async function voidInvoice(db, { invoiceId, notes = null }) {
  const result = await db.query(
    `UPDATE invoices
        SET status = 'void', voided_at = now(),
            notes = COALESCE($2, notes)
      WHERE id = $1
        AND status != 'paid'
     RETURNING *`,
    [invoiceId, notes]
  );
  return result.rows[0] ?? null;
}

/** Fetch a single invoice by id. */
export async function getInvoice(db, { invoiceId }) {
  const result = await db.query(`SELECT * FROM invoices WHERE id = $1`, [invoiceId]);
  return result.rows[0] ?? null;
}

/** Announce a canonical invoice.* event. Usually one per invoice; a partial
 *  receipt can supply its own key because one invoice may be paid in parts. */
export async function announceInvoice(db, name, row, { idempotencyKey = null } = {}) {
  if (!row?.id || !name) return null;
  const { emit } = await import("../events/bus.mjs");
  return emit(db, name, {
    invoiceId: row.id,
    invoice_number: invoiceDisplayNumber(row),
    amount_due: row.amount_due,
    source: row.source || null,
    invoice_type: row.invoice_type || null,
    funding_round_id: row.funding_round_id || null,
    status: row.status || null
  }, {
    orgId: row.org_id,
    clientId: row.client_id,
    idempotencyKey: idempotencyKey || `${name}:${row.id}`
  });
}

export function invoiceDisplayNumber(row) {
  if (!row?.id) return "";
  return `INV-${String(row.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function formatBalanceDue(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/** Idempotency key for a success-fee invoice on a funding round. */
export function successFeeKey(saleId, fundingRoundId) {
  return `invoice|success_fee|${saleId}|${fundingRoundId}`;
}

/** Idempotency key for a deposit invoice on a sale. */
export function depositKey(saleId) {
  return `invoice|deposit|${saleId}`;
}
