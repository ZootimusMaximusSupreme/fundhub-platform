// Saved company-bank and cash-obligation integrity, shared by the hourly beat and daily gap.
// One scoped SELECT. No Plaid call, transfer, or balance calculation occurs here.
import { row, runnerOf } from "./money-truth-utils.mjs";

export const CHECK_IDS = Object.freeze(["company-cash:integrity"]);
export const COMPANY_CASH_INTEGRITY_SQL = `
WITH items AS (
 SELECT i.*, s.id AS linker_id, s.org_id AS linker_org, s.role AS linker_role
   FROM company_plaid_items i
   LEFT JOIN staff s ON s.id=i.linked_by_staff_id
  WHERE i.org_id=$1::uuid
), accounts AS (
 SELECT a.*, i.id AS item_id, i.org_id AS item_org,
        i.consent_granted_at, i.consent_text,
        confirmer.id AS confirmer_id, confirmer.org_id AS confirmer_org,
        confirmer.role AS confirmer_role
   FROM company_bank_accounts a
   LEFT JOIN company_plaid_items i ON i.id=a.company_plaid_item_id
   LEFT JOIN staff confirmer ON confirmer.id=a.business_confirmed_by_staff_id
  WHERE a.org_id=$1::uuid
), paid AS (
 SELECT o.id, o.org_id, o.amount_cents, o.paid_bank_transaction_id,
        t.id AS transaction_id, t.org_id AS transaction_org,
        t.company_bank_account_id, t.amount_cents AS debit_cents,
        t.posted_on, t.is_pending, t.removed_at,
        a.id AS account_id, a.org_id AS account_org, a.selected_for_cash
   FROM company_cash_obligations o
   LEFT JOIN company_bank_transactions t ON t.id=o.paid_bank_transaction_id
   LEFT JOIN company_bank_accounts a ON a.id=t.company_bank_account_id
  WHERE o.org_id=$1::uuid AND o.status='paid'
), crs_duplicates AS (
 SELECT billing_month FROM company_cash_obligations
  WHERE org_id=$1::uuid AND kind='crs' AND status<>'cancelled'
  GROUP BY billing_month HAVING count(*)>1
), payment_duplicates AS (
 SELECT paid_bank_transaction_id FROM company_cash_obligations
  WHERE org_id=$1::uuid AND paid_bank_transaction_id IS NOT NULL
  GROUP BY paid_bank_transaction_id HAVING count(*)>1
)
SELECT (SELECT count(*)::int FROM items) AS linked_items_n,
       (SELECT count(*)::int FROM accounts) AS accounts_n,
       (SELECT count(*)::int FROM accounts WHERE selected_for_cash) AS selected_n,
       (SELECT count(*)::int FROM items WHERE linker_id IS NULL
         OR linker_org IS DISTINCT FROM org_id OR linker_role IS DISTINCT FROM 'owner'
         OR NULLIF(btrim(plaid_item_id),'') IS NULL
         OR NULLIF(btrim(encrypted_access_token),'') IS NULL
         OR NULLIF(btrim(consent_text),'') IS NULL OR consent_granted_at IS NULL)::int AS bad_items_n,
       (SELECT count(*)::int FROM accounts WHERE item_id IS NULL
         OR item_org IS DISTINCT FROM org_id)::int AS wrong_item_n,
       (SELECT count(*)::int FROM accounts WHERE selected_for_cash AND (
         account_type IS DISTINCT FROM 'depository' OR currency_code IS DISTINCT FROM 'USD'
         OR holder_category='personal' OR item_id IS NULL OR item_org IS DISTINCT FROM org_id
         OR NULLIF(btrim(consent_text),'') IS NULL OR consent_granted_at IS NULL
         OR business_confirmed_at IS NULL OR confirmer_id IS NULL
         OR confirmer_org IS DISTINCT FROM org_id OR confirmer_role IS DISTINCT FROM 'owner'))::int AS bad_selected_n,
       (SELECT count(*)::int FROM paid WHERE amount_cents IS NULL
         OR paid_bank_transaction_id IS NULL OR transaction_id IS NULL
         OR transaction_org IS DISTINCT FROM org_id OR account_id IS NULL
         OR account_org IS DISTINCT FROM org_id OR selected_for_cash IS DISTINCT FROM true
         OR posted_on IS NULL OR is_pending IS DISTINCT FROM false OR removed_at IS NOT NULL
         OR debit_cents IS NULL OR debit_cents>=0 OR debit_cents IS DISTINCT FROM -amount_cents)::int AS bad_paid_n,
       (SELECT count(*)::int FROM company_cash_obligations o
          LEFT JOIN staff creator ON creator.id=o.created_by_staff_id
         WHERE o.org_id=$1::uuid AND (creator.id IS NULL
           OR creator.org_id IS DISTINCT FROM o.org_id OR creator.role IS DISTINCT FROM 'owner'
           OR (o.status<>'paid' AND o.paid_bank_transaction_id IS NOT NULL)))::int AS bad_obligations_n,
       (SELECT count(*)::int FROM crs_duplicates) AS duplicate_crs_months_n,
       (SELECT count(*)::int FROM payment_duplicates) AS duplicate_payment_n
`.trim();

export const HEALTHY_COMPANY_CASH_COUNTS = Object.freeze({
  linked_items_n: 0, accounts_n: 0, selected_n: 0,
  bad_items_n: 0, wrong_item_n: 0, bad_selected_n: 0,
  bad_paid_n: 0, bad_obligations_n: 0, duplicate_crs_months_n: 0, duplicate_payment_n: 0
});

export async function readCompanyCashTruth(ctx = {}) {
  const id = CHECK_IDS[0], run = runnerOf(ctx);
  const fail = detail => [row(id, "FAIL", detail,
    "Inspect saved company bank consent, selected business account and posted payment matches. Do not call Plaid, edit bank rows or move money from this check.")];
  if (!run) return fail("Company cash integrity was not read: no database reader.");
  try {
    let orgId = ctx.orgId;
    if (!orgId) orgId = (await run(tx => tx.query("SELECT id FROM orgs WHERE is_default ORDER BY created_at LIMIT 1"))).rows?.[0]?.id;
    if (!orgId) return fail("Company cash integrity was not read: no company scope.");
    const out = await run(tx => tx.query(COMPANY_CASH_INTEGRITY_SQL, [orgId]));
    const counts = out.rows?.[0];
    const names = Object.keys(HEALTHY_COMPANY_CASH_COUNTS);
    if (!counts || names.some(name => counts[name] == null || counts[name] === "" ||
      !Number.isSafeInteger(Number(counts[name])) || Number(counts[name]) < 0)) {
      return fail("Company cash integrity returned incomplete counts; no healthy result was established.");
    }
    const bad = names.filter(name => name.startsWith("bad_") || name.startsWith("wrong_") || name.startsWith("duplicate_"));
    if (Number(counts.selected_n) > 1 || bad.some(name => Number(counts[name]) > 0)) {
      return fail(`Saved company cash break: selected ${counts.selected_n}, item ${counts.bad_items_n}, scope ${counts.wrong_item_n}, business account ${counts.bad_selected_n}, paid match ${counts.bad_paid_n}, obligation owner ${counts.bad_obligations_n}, duplicate CRS month ${counts.duplicate_crs_months_n}, duplicate payment ${counts.duplicate_payment_n}. No bank identifiers were exposed.`);
    }
    if (Number(counts.linked_items_n) === 0) {
      return [row(id, "PASS", "No company bank is linked. Stored integrity is clear; no company cash balance or transfer readiness is established.")];
    }
    if (Number(counts.selected_n) === 0) {
      return [row(id, "PASS", `${counts.linked_items_n} company bank link(s) saved, but no selected business bank. No company cash balance or transfer readiness is established.`)];
    }
    return [row(id, "PASS", "Selected company business bank, consent and posted obligation matches are consistent in saved rows. This does not prove a live balance, provider approval or transfer readiness.")];
  } catch {
    return fail("Company cash integrity could not be read; a failed SQL/schema read is not healthy company cash.");
  }
}
