// Fundhub treasury. Client FinanceOS balances and transfer rows never enter this model.
import { asStaff } from "../partners/rls.mjs";
import { db as sharedDb, pool } from "../db.mjs";
import { detectRecurringBills } from "../banking/recurring.mjs";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = value => typeof value === "string" && DAY.test(value) &&
  !value.startsWith("0000-") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const KINDS = new Set(["crs", "ad", "tech"]);
const STATUSES = new Set(["planned", "approved"]);
const cents = value => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const dayOf = value => value instanceof Date ? value.toISOString().slice(0, 10) :
  String(value || "").slice(0, 10);
const phoenixDay = value => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(value));
const monthOf = date => String(date).slice(0, 7) + "-01";
const endOfMonth = date => new Date(Date.UTC(Number(String(date).slice(0, 4)),
  Number(String(date).slice(5, 7)), 0)).toISOString().slice(0, 10);

export function calculateCompanyCash({ account, obligations = [], pulls = [], metaSpendCents = null,
  processorReceiptsCents = null, asOf = new Date() }) {
  const now = new Date(asOf);
  const today = phoenixDay(now);
  const month = monthOf(today);
  const monthEnd = endOfMonth(today);
  const missing = [];
  const verifiedInvoice = row => row.invoice_verified_at &&
    Number.isFinite(new Date(row.invoice_verified_at).getTime()) &&
    new Date(row.invoice_verified_at).getTime() <= now.getTime() &&
    cents(row.amount_cents) !== null && validDay(dayOf(row.invoice_covers_through_on)) &&
    dayOf(row.invoice_covers_through_on) <= today &&
    dayOf(row.invoice_covers_through_on) <= phoenixDay(row.invoice_verified_at);
  const selected = account?.selected_for_cash === true && account?.business_confirmed_at &&
    account?.account_type === "depository" && account?.holder_category !== "personal" &&
    account?.currency_code === "USD";
  const balance = selected ? cents(account.current_balance_cents) : null;
  const withdrawable = selected ? cents(account.available_balance_cents) : null;
  const stamp = selected ? new Date(account.balance_as_of).getTime() : NaN;
  if (balance === null || !Number.isFinite(stamp) || stamp > now.getTime() ||
    now.getTime() - stamp > 7 * 24 * 60 * 60 * 1000) missing.push("business_bank_balance");

  const current = obligations.filter(row => dayOf(row.billing_month) === month &&
    row.status !== "cancelled");
  if (!current.some(row => row.kind === "ad" && row.status === "approved" &&
    cents(row.amount_cents) !== null)) missing.push("ad_review");
  if (!current.some(row => row.kind === "tech" && row.status === "approved" &&
    cents(row.amount_cents) !== null)) missing.push("tech_review");
  if (!current.some(row => row.kind === "crs")) missing.push("crs_invoice");
  let crsReserve = 0;
  for (const row of obligations) {
    if (row.kind !== "crs" || row.status === "cancelled" || dayOf(row.billing_month) > month) continue;
    if (!verifiedInvoice(row)) {
      missing.push("crs_invoice");
      continue;
    }
    if (row.status === "paid") {
      if (row.paid_transaction_posted !== true) missing.push("crs_payment_unverified");
    } else crsReserve += cents(row.amount_cents);
  }
  if (missing.includes("crs_invoice")) crsReserve = null;

  let adReserve = 0;
  let techDue = 0;
  for (const row of obligations) {
    if (row.kind === "crs" || row.status === "cancelled") continue;
    if (row.status === "paid") {
      if (row.paid_transaction_posted !== true) missing.push("payment_unverified");
      continue;
    }
    if (!STATUSES.has(row.status)) continue;
    if (row.kind === "ad" && row.status === "approved" && dayOf(row.billing_month) <= month) {
      const amount = cents(row.amount_cents);
      if (amount === null) missing.push("ad_amount");
      else adReserve += amount;
    }
    if (row.kind === "tech" && dayOf(row.billing_month) <= month) {
      const amount = cents(row.amount_cents);
      if (amount === null) missing.push("tech_amount");
      if (!row.due_on && amount !== 0) missing.push("tech_due_date");
      if (row.due_on && dayOf(row.due_on) <= monthEnd && amount !== null) techDue += amount;
    }
  }
  const realPulls = pulls.filter(row => row.status === "fulfilled" && row.provider === "crs_softview");
  const unpricedPullCount = realPulls.filter(row => cents(row.cost_cents) === null).length;
  const pricedPullCents = realPulls.reduce((sum, row) => sum + (cents(row.cost_cents) ?? 0), 0);
  const currentInvoice = current.find(row => row.kind === "crs" && verifiedInvoice(row));
  for (const pull of realPulls) {
    const resolvedTime = pull.resolved_at ? new Date(pull.resolved_at).getTime() : NaN;
    const resolved = Number.isFinite(resolvedTime) ? phoenixDay(pull.resolved_at) : null;
    if (resolved && currentInvoice && resolved <= dayOf(currentInvoice.invoice_covers_through_on) &&
      resolvedTime <= new Date(currentInvoice.invoice_verified_at).getTime()) continue;
    const cost = cents(pull.cost_cents);
    if (cost === null || cost < 0) missing.push("crs_uncovered_pull_cost");
    else if (crsReserve !== null) crsReserve += cost;
  }
  const knownDeductions = (crsReserve ?? 0) + adReserve + techDue;
  const knownRemaining = balance === null ? null : balance - knownDeductions;
  return {
    month, bank_posted_cents: balance, bank_available_cents: withdrawable,
    bank_balance_as_of: selected ? account.balance_as_of : null,
    crs_reserve_cents: crsReserve, crs_fulfilled_pull_count: realPulls.length,
    crs_unpriced_pull_count: unpricedPullCount, crs_priced_pull_cents: pricedPullCents,
    ad_approved_unpaid_cents: adReserve, tech_due_cents: techDue,
    meta_spend_cents: cents(metaSpendCents),
    processor_receipts_cents: cents(processorReceiptsCents),
    known_remaining_cents: knownRemaining,
    available_cents: missing.length ? null : knownRemaining,
    missing: [...new Set(missing)]
  };
}

export async function readCompanyCash(db, { orgId, asOf = new Date(), metaSpend = readCompanyMetaSpend,
  recurrence = detectRecurringBills } = {}) {
  const source = db === sharedDb ? pool() :
    typeof db.connect === "function" && typeof db.totalCount === "number" ? db : null;
  if (source) {
    // Meta spend is display-only. Read it before checking out the cash snapshot
    // so a one-connection pool cannot deadlock on asStaff's separate query.
    const spend = await metaSpend({ orgId, month: monthOf(phoenixDay(asOf)) });
    const client = await source.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await readCompanyCash(client, { orgId, asOf,
        metaSpend: async () => spend, recurrence });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the original error */ }
      throw error;
    } finally { client.release(); }
  }
  const month = monthOf(phoenixDay(asOf));
  const bank = await db.query(`SELECT a.*,i.institution_name FROM company_bank_accounts a
    JOIN company_plaid_items i ON i.id=a.company_plaid_item_id AND i.org_id=a.org_id
    WHERE a.org_id=$1 AND a.selected_for_cash=true`, [orgId]);
  const obligations = await db.query(`SELECT o.*, (t.id IS NOT NULL AND t.posted_on IS NOT NULL AND NOT t.is_pending
                       AND t.removed_at IS NULL AND t.company_bank_account_id=a.id
                       AND -t.amount_cents=o.amount_cents) AS paid_transaction_posted
                FROM company_cash_obligations o
                LEFT JOIN company_bank_transactions t ON t.id=o.paid_bank_transaction_id AND t.org_id=o.org_id
                LEFT JOIN company_bank_accounts a ON a.id=t.company_bank_account_id AND a.org_id=o.org_id
                     AND a.selected_for_cash=true
               WHERE o.org_id=$1 ORDER BY o.due_on NULLS LAST,o.created_at DESC`, [orgId]);
  const pulls = await db.query(`SELECT status,provider,cost_cents,resolved_at FROM soft_pull_requests
               WHERE org_id=$1 AND resolved_at >= ($2::date AT TIME ZONE 'America/Phoenix')
                 AND resolved_at < (($2::date + interval '1 month') AT TIME ZONE 'America/Phoenix')`, [orgId, month]);
  const spend = await metaSpend({ orgId, month });
  const selected = bank.rows[0] ?? null;
  const businessSelected = selected && selected.business_confirmed_at &&
    selected.account_type === "depository" && selected.holder_category !== "personal" &&
    selected.currency_code === "USD";
  const recent = businessSelected ? await db.query(`SELECT id,
      company_bank_account_id AS bank_account_id,plaid_transaction_id AS provider_transaction_id,
      amount_cents,posted_on,merchant_name,is_pending,owner_category
    FROM company_bank_transactions WHERE org_id=$1 AND company_bank_account_id=$2
      AND removed_at IS NULL AND posted_on >= ($3::date - interval '13 months')
    ORDER BY posted_on DESC,id DESC LIMIT 1000`, [orgId, selected.id, month]) : { rows: [] };
  const detected = businessSelected ? recurrence(recent.rows, { now: asOf,
    accountIds: [selected.id], accountIsBusiness: { [selected.id]: true } }) : null;
  const summary = calculateCompanyCash({ account: bank.rows[0] ?? null, obligations: obligations.rows,
    pulls: pulls.rows, metaSpendCents: spend, asOf });
  return { summary, account: bank.rows[0] ? {
    id: bank.rows[0].id, name: bank.rows[0].name, mask: bank.rows[0].mask,
    institution_name: bank.rows[0].institution_name ?? null
  } : null, obligations: obligations.rows.map(({ paid_transaction_posted, ...row }) => ({
    ...row, paid_transaction_posted
  })), recurring_candidates: detected ? [...detected.bills, ...detected.candidates]
    .map(row => ({ ...row, is_confirmed_tech: false })) : [] };
}

export async function readCompanyMetaSpend({ orgId, month }) {
  const result = await asStaff(tx => tx.query(`SELECT sum(spend_cents)::bigint AS total
    FROM ad_metrics_daily WHERE org_id=$1 AND date >= $2::date
      AND date < ($2::date + interval '1 month')`, [orgId, month]));
  return cents(result.rows[0]?.total);
}

export function validateObligation(input, now = new Date()) {
  const kind = String(input.kind || "").trim();
  const label = String(input.label || "").trim();
  const amount = cents(input.amount_cents);
  const status = String(input.status || "planned").trim();
  const due = input.due_on || null;
  const billingMonth = input.billing_month || null;
  const invoiceRef = input.source_ref ? String(input.source_ref).trim() : null;
  const invoiceVerified = input.invoice_verified === true;
  const invoiceCoversThrough = input.invoice_covers_through_on || null;
  if (!KINDS.has(kind) || !label || label.length > 160 || !STATUSES.has(status) ||
    (input.amount_cents != null && (amount === null || amount < 0)) ||
    (due && !validDay(due)) || !MONTH.test(billingMonth || "") ||
    (invoiceCoversThrough && !validDay(invoiceCoversThrough))) return null;
  if (invoiceVerified && kind !== "crs") return null;
  if (kind === "crs" && invoiceVerified && (amount === null || !invoiceRef ||
    !invoiceCoversThrough || monthOf(invoiceCoversThrough) !== billingMonth ||
    invoiceCoversThrough > phoenixDay(now))) return null;
  if (kind === "ad" && status === "approved" && amount === null) return null;
  return { kind, label, amount, status, due, billingMonth, invoiceRef, invoiceVerified,
    invoiceCoversThrough };
}

export async function createCompanyObligation(db, { orgId, staffId, input, now = new Date() }) {
  const value = validateObligation(input, now);
  if (!value) return { ok: false, reason: "invalid_obligation" };
  const result = await db.query(`INSERT INTO company_cash_obligations
    (org_id,kind,label,amount_cents,due_on,billing_month,source_ref,invoice_verified_at,invoice_covers_through_on,status,created_by_staff_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
  [orgId, value.kind, value.label, value.amount, value.due, value.billingMonth,
    value.invoiceRef, value.invoiceVerified ? now.toISOString() : null,
    value.invoiceCoversThrough, value.status, staffId]);
  return { ok: true, obligation: result.rows[0] };
}

export async function updateCompanyObligation(db, { orgId, obligationId, input, now = new Date() }) {
  const value = validateObligation(input, now);
  if (!value) return { ok: false, reason: "invalid_obligation" };
  const result = await db.query(`UPDATE company_cash_obligations SET
    kind=$3,label=$4,amount_cents=$5,due_on=$6,billing_month=$7,source_ref=$8,
    invoice_verified_at=$9,invoice_covers_through_on=$10,status=$11,updated_at=now()
    WHERE id=$1 AND org_id=$2 AND status IN ('planned','approved') RETURNING *`,
  [obligationId, orgId, value.kind, value.label, value.amount, value.due,
    value.billingMonth, value.invoiceRef, value.invoiceVerified ? now.toISOString() : null,
    value.invoiceCoversThrough, value.status]);
  return result.rows[0] ? { ok: true, obligation: result.rows[0] } :
    { ok: false, reason: "obligation_not_editable" };
}

export async function cancelCompanyObligation(db, { orgId, obligationId }) {
  const result = await db.query(`UPDATE company_cash_obligations SET status='cancelled',updated_at=now()
    WHERE id=$1 AND org_id=$2 AND status IN ('planned','approved') RETURNING *`, [obligationId, orgId]);
  return result.rows[0] ? { ok: true, obligation: result.rows[0] } :
    { ok: false, reason: "obligation_not_editable" };
}

export async function matchCompanyPayment(db, { orgId, obligationId, transactionId }) {
  const result = await db.query(`UPDATE company_cash_obligations o
    SET status='paid',paid_bank_transaction_id=t.id,updated_at=now()
    FROM company_bank_transactions t
    JOIN company_bank_accounts a ON a.id=t.company_bank_account_id AND a.org_id=t.org_id
    WHERE o.id=$1 AND o.org_id=$2 AND t.id=$3 AND t.org_id=o.org_id
      AND a.selected_for_cash=true AND t.posted_on IS NOT NULL AND NOT t.is_pending
      AND t.removed_at IS NULL AND t.amount_cents < 0 AND o.status IN ('planned','approved')
      AND o.amount_cents=-t.amount_cents RETURNING o.*`,
    [obligationId, orgId, transactionId]);
  return result.rows[0] ? { ok: true, obligation: result.rows[0] } :
    { ok: false, reason: "payment_not_matching_posted_business_debit" };
}

export async function tagCompanyTransaction(db, { orgId, transactionId, category }) {
  if (!new Set(["crs", "ad", "tech", "other"]).has(category)) return { ok: false, reason: "invalid_category" };
  const result = await db.query(`UPDATE company_bank_transactions t SET owner_category=$3,updated_at=now()
    FROM company_bank_accounts a WHERE t.id=$1 AND t.org_id=$2
      AND a.id=t.company_bank_account_id AND a.org_id=t.org_id AND a.selected_for_cash=true
      AND t.posted_on IS NOT NULL AND NOT t.is_pending AND t.removed_at IS NULL RETURNING t.id`,
    [transactionId, orgId, category]);
  return result.rows[0] ? { ok: true } : { ok: false, reason: "transaction_not_found" };
}
