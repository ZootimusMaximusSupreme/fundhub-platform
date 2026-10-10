// Plaid liabilities → card due dates. Reads each linked bank login's credit card
// bills from Plaid and writes them onto the card's statement cycle.
//
// LOANS TOO (wave 4, H2): student loans and mortgages from the same read are
// written onto the loan's statement cycle the same way — due day, monthly
// payment, exact next due date in raw — so the reminder job
// (src/workflows/finance-os-card-due-reminders.mjs, loanCycles) and the
// overview's debt.loans pick them up. 451 allows loans in that table.
//
// This file holds no network code. The one Plaid call goes through
// ./providers/plaid-http.mjs (CLAUDE.md §12). It never moves money: it reads
// what is owed and when, and writes that down.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY account_statement_cycles (097) AND NOT card_liabilities (083)
// ═══════════════════════════════════════════════════════════════════════════
// card_liabilities hangs every row off `tradeline_id uuid NOT NULL` and its
// `source` CHECK allows only 'crs' and 'manual'. A tradeline exists only where a
// soft pull put one. A Plaid card is a `bank_accounts` row with no tradeline, so
// 083 has nowhere to put it without weakening the CRS path — 097's header makes
// exactly this argument and was written for exactly this case: cards that did
// NOT come from a credit report. 097 keys on bank_account_id, allows
// source='provider', and holds the due day, the last statement, the minimum and
// the APR. So that is the home.
//
// WHAT DOES NOT FIT A COLUMN GOES IN `raw`, VERBATIM. 097 stores the due date as
// a day of the month (the next one is computed by statement-cycles.mjs). Plaid
// also tells us the exact next due date, the last payment and whether the card
// is overdue. Those are kept in `raw` under Plaid's own field names so the
// reminder job can read the exact date Plaid gave instead of re-deriving it.
//
// NULL MEANS UNKNOWN. A Plaid figure that is null stays null. toCents() in
// money.mjs turns null into 0, so it is never called on a null here.
//
// ONE BAD ITEM NEVER STOPS THE REST. An Item that was not set up for the
// liabilities product answers with a Plaid error. That error is recorded in the
// result and the next Item is read. Nothing is written for an Item that failed.
// Plaid has no field telling us in advance which Items carry liabilities, so
// asking is the only way to find out.

import { toCents } from "../commissions/money.mjs";
import { plaidConfigFromEnv, decryptPlaidToken, SEAM_REASONS } from "./plaid.mjs";
import { saveStatementCycle, BankAccountWriteError } from "./accounts.mjs";

const cents = (v) => (v === null || v === undefined ? null : toCents(v));

function dayOf(isoDate) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const d = Number(isoDate.slice(8, 10));
  return d >= 1 && d <= 31 ? d : null;
}

/* The purchase APR is the rate a card bill is charged under. Plaid sends a
   percentage (15.24 = 15.24%); 097 wants a fraction. Divided HERE, explicitly,
   rather than handed to readApr() as a percentage, because readApr() reads any
   value <= 1 as an already-divided fraction — a real 0.5% APR would be stored as
   50%. A fraction in, a fraction stored. */
function purchaseApr(aprs) {
  if (!Array.isArray(aprs) || aprs.length === 0) return null;
  const pick = aprs.find((a) => a?.apr_type === "purchase_apr") || null;
  const pct = pick?.apr_percentage;
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return Math.round((pct / 100) * 100000) / 100000;
}

/**
 * toCycleInput(credit, { asOf }) — one parsed `liabilities.credit[]` row → the
 * input saveStatementCycle() takes. Pure.
 *
 * Returns null when Plaid gave neither a due date nor a minimum: writing such a
 * row would only wipe a due day a person may have typed in by hand, and adds
 * nothing.
 */
export function toCycleInput(credit, { asOf } = {}) {
  if (!credit || typeof credit !== "object") return null;
  if (!credit.next_payment_due_date && credit.minimum_payment_amount == null) return null;
  return {
    statement_close_day: dayOf(credit.last_statement_issue_date),
    payment_due_day: dayOf(credit.next_payment_due_date),
    last_statement_date: credit.last_statement_issue_date ?? null,
    last_statement_balance_cents: cents(credit.last_statement_balance),
    minimum_payment_cents: cents(credit.minimum_payment_amount),
    apr: purchaseApr(credit.aprs),
    source: "provider",
    raw: {
      source: "plaid",
      product: "liabilities",
      as_of: asOf ?? null,
      next_payment_due_date: credit.next_payment_due_date ?? null,
      last_payment_amount_cents: cents(credit.last_payment_amount),
      last_payment_date: credit.last_payment_date ?? null,
      is_overdue: credit.is_overdue ?? null,
      plaid: credit
    }
  };
}

/**
 * toLoanCycleInput(loan, { asOf }) — one parsed loan row from fetchLiabilities
 * (`kind` 'student' or 'mortgage') → the input saveStatementCycle() takes. Pure.
 *
 * Same columns a card uses, per 451: payment_due_day is the due day and
 * minimum_payment_cents is the monthly payment. The exact next due date goes in
 * raw.next_payment_due_date — the field loanDueOn() (card-due-reminders.mjs)
 * and the overview already read. The balance owed is Plaid's account
 * balances.current, kept in raw.current_balance_cents; the column of record for
 * it stays bank_accounts.current_balance_cents (451), which the account sync
 * writes — this read does not touch bank_accounts.
 *
 * apr stays null: Plaid sends a loan's INTEREST RATE, not an APR, and the 097
 * column is an APR. The rate is kept in raw under Plaid's name.
 *
 * Returns null when Plaid gave neither a due date nor a payment — nothing to
 * remind, and writing would wipe a due day typed in by hand.
 */
export function toLoanCycleInput(loan, { asOf } = {}) {
  if (!loan || typeof loan !== "object") return null;
  if (!loan.next_payment_due_date && loan.payment_amount == null) return null;
  return {
    statement_close_day: dayOf(loan.last_statement_issue_date),
    payment_due_day: dayOf(loan.next_payment_due_date),
    last_statement_date: loan.last_statement_issue_date ?? null,
    last_statement_balance_cents: cents(loan.last_statement_balance),
    minimum_payment_cents: cents(loan.payment_amount),
    apr: null,
    source: "provider",
    raw: {
      source: "plaid",
      product: "liabilities",
      loan_kind: loan.kind ?? null,
      as_of: asOf ?? null,
      next_payment_due_date: loan.next_payment_due_date ?? null,
      payment_field: loan.payment_field ?? null,
      current_balance_cents: cents(loan.current_balance),
      last_payment_amount_cents: cents(loan.last_payment_amount),
      last_payment_date: loan.last_payment_date ?? null,
      is_overdue: loan.is_overdue ?? null,
      past_due_amount_cents: cents(loan.past_due_amount),
      interest_rate_percentage: loan.interest_rate_percentage ?? null,
      plaid: loan
    }
  };
}

/** Linked, consented, real Plaid logins for one client. Mock items
 *  (`mock:<client>`) carry no Plaid token and are skipped by the filter. */
export async function activePlaidItems(db, { orgId, clientId }) {
  const res = await db.query(
    `SELECT id, plaid_item_id, encrypted_access_token, institution_name
       FROM plaid_items
      WHERE org_id = $1 AND client_id = $2
        AND link_state = 'active'
        AND consent_granted_at IS NOT NULL
        AND encrypted_access_token IS NOT NULL
        AND plaid_item_id IS NOT NULL
        AND plaid_item_id NOT LIKE 'mock:%'
      ORDER BY created_at`,
    [orgId, clientId]
  );
  return res.rows;
}

/**
 * syncClientLiabilities(db, { orgId, clientId, env, asOf, fetchLiabilities })
 *
 * @param {string} orgId  from the SESSION or the sweeper's own query — never a body.
 * @param {string} asOf   ISO instant the read happened. Required: no clock here.
 *
 * @returns {{ ok, reason?, items: Array<{ itemRowId, ok, errorCode?, error?,
 *             written, skipped: Array }>, written }}
 *
 * `ok` is false only when nothing could be tried at all (Plaid not configured,
 * missing ids). A per-Item Plaid error is reported inside `items` and does not
 * make the whole sync fail.
 */
export async function syncClientLiabilities(db, {
  orgId, clientId, env = process.env, asOf, fetchLiabilities = null
} = {}) {
  if (!orgId || !clientId || !asOf) {
    return { ok: false, reason: SEAM_REASONS.BAD_REQUEST, missing: ["orgId, clientId and asOf are required"], items: [], written: 0 };
  }
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) {
    return { ok: false, reason: SEAM_REASONS.NOT_CONFIGURED, missing: [...cfg.missing, ...cfg.problems], items: [], written: 0 };
  }

  const items = await activePlaidItems(db, { orgId, clientId });
  /* Loaded lazily, the way plaid.mjs and plaid-link.mjs load the client: the
     network module is only pulled in when there is an Item to ask about. */
  const fetchLiab = fetchLiabilities
    || (items.length ? (await import("./providers/plaid-http.mjs")).fetchLiabilities : null);
  const out = { ok: true, reason: null, environment: cfg.environment, items: [], written: 0 };

  for (const item of items) {
    const report = { itemRowId: item.id, ok: false, errorCode: null, error: null, written: 0, loansWritten: 0, skipped: [] };
    out.items.push(report);

    let accessToken;
    try {
      // AAD is Plaid's item id — the value completeLink encrypted with.
      accessToken = decryptPlaidToken(item.encrypted_access_token, { itemId: item.plaid_item_id, env });
    } catch (e) {
      report.errorCode = "token_decrypt_failed";
      report.error = String(e?.message || e).slice(0, 300);
      continue;
    }

    const r = await fetchLiab(accessToken, {
      environment: cfg.environment,
      clientId: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      env
    });
    accessToken = null;
    if (!r.ok) {
      report.errorCode = r.errorCode ?? (r.blocked ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR);
      report.error = r.error ?? null;
      continue;
    }
    report.ok = true;

    const credit = Array.isArray(r.credit) ? r.credit : [];
    const loans = Array.isArray(r.loans) ? r.loans : [];
    if (credit.length === 0 && loans.length === 0) continue;

    const accounts = await db.query(
      `SELECT id, plaid_account_id, account_type, name, mask
         FROM bank_accounts
        WHERE org_id = $1 AND client_id = $2 AND plaid_item_id = $3`,
      [orgId, clientId, item.id]
    );
    const byPlaidId = new Map(accounts.rows.map((a) => [a.plaid_account_id, a]));

    /* Cards, then loans (wave 4, H2). Same store call for both: saveStatementCycle
       accepts a credit or a loan account and refuses anything else. */
    const work = [
      ...credit.map((c) => ({ row: c, loan: false })),
      ...loans.map((l) => ({ row: l, loan: true }))
    ];
    for (const { row: c, loan } of work) {
      const account = byPlaidId.get(c.account_id);
      if (!account) {
        // The card or loan is not in bank_accounts yet — accounts were never
        // synced for it. Reported, not invented: no account row is created here.
        report.skipped.push({ plaidAccountId: c.account_id, reason: "account_not_stored" });
        continue;
      }
      const input = loan ? toLoanCycleInput(c, { asOf }) : toCycleInput(c, { asOf });
      if (!input) {
        report.skipped.push({ bankAccountId: account.id, reason: loan ? "no_due_date_or_payment" : "no_due_date_or_minimum" });
        continue;
      }
      try {
        await saveStatementCycle(db, input, { orgId, clientId, bankAccountId: account.id });
        report.written += 1;
        if (loan) report.loansWritten += 1;
        out.written += 1;
      } catch (e) {
        if (e instanceof BankAccountWriteError) {
          report.skipped.push({ bankAccountId: account.id, reason: e.message });
          continue;
        }
        throw e;
      }
    }
  }

  return out;
}

export default { toCycleInput, toLoanCycleInput, activePlaidItems, syncClientLiabilities };
