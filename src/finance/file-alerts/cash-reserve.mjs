// Alert 3 — cash fell below six months of minimum payments.
//
// The offer (owner-set 2026-09-29): "The system flags when their cash drops below
// six months of minimum payments, since a missed payment damages the file before
// round two." (The product word is "the next funding sequence" — owner-set
// 2026-10-06 — and that is the word the text uses.)
//
// PURE. No database, no clock. The numbers are the Finance OS overview's own
// (src/finance/money-overview.mjs): cash per kind from the banking surface, and
// each card's and loan's minimum from the same rows the Money page shows.
//
// CASH IS NEVER ADDED ACROSS KINDS. Personal cash is measured against personal
// minimums and business cash against business minimums, as two separate checks
// that fire and re-arm separately. There is no combined figure anywhere here.
// A card or loan whose kind has not been sorted yet is counted in NEITHER check
// (unknown is not personal — src/finance/banking-surface.mjs); the screen lists
// them as "not counted yet".
//
// WHAT COUNTS AS A MONTHLY MINIMUM
//   * each open card's minimum due, and each open loan's monthly payment — from
//     statement cycles, exactly as the overview reads them;
//   * each open Fundhub payment plan's next unpaid payment (Clarity Payments).
//     Those plans carry no personal / business tag, so they are counted against
//     ONE kind — CLARITY_CASH_KIND in ./common.mjs (personal) — never both.
//   A card with nothing owed counts as zero. A card or loan whose minimum is not
//   on file is NOT counted as zero: it is unknown, the need becomes "at least",
//   and the check still works on what is known (a shortfall against a floor is a
//   real shortfall).
//
// THREE STATES, NOT TWO. 'below' (cash is fully known and under the need), 'ok'
// (cash covers it), 'unknown' (we cannot say: no cash accounts, a balance missing,
// a balance stale, no minimums on file). Only 'below' alerts and only 'ok'
// re-arms. 'unknown' changes nothing — we do not claim the cash recovered, or
// fell, on a number we do not have.

import {
  TEMPLATES, RESERVE_MONTHS, CLARITY_CASH_KIND, toCentsOrNull, dollars
} from "./common.mjs";

export const CASH_KINDS = Object.freeze(["personal", "business"]);

/**
 * evaluateReserve({ kind, cash, debts, clarityMonthlyCents, staleBalance }) → one verdict
 *
 *   kind                 'personal' | 'business'
 *   cash                 overview.cash[kind] — { cents, is_floor, accounts }
 *   debts                debtsFromOverview(overview) — { kind, balance_cents, min_cents } per card and loan
 *   clarityMonthlyCents  what the client owes Fundhub this month, or null
 *   staleBalance         true when a cash account of this kind has an old balance
 */
export function evaluateReserve({ kind, cash, debts = [], clarityMonthlyCents = null, staleBalance = false } = {}) {
  const mine = (Array.isArray(debts) ? debts : []).filter((d) => d && (d.kind || "unknown") === kind);

  let known = 0;
  let counted = 0;
  let unknownMinimums = 0;
  for (const d of mine) {
    const bal = toCentsOrNull(d.balance_cents);
    if (bal !== null && bal <= 0) continue; // nothing owed on it
    const min = toCentsOrNull(d.min_cents);
    if (min === null) { unknownMinimums += 1; continue; }
    known += min;
    counted += 1;
  }
  const clarity = kind === CLARITY_CASH_KIND ? toCentsOrNull(clarityMonthlyCents) : null;
  if (clarity !== null && clarity > 0) { known += clarity; counted += 1; }

  const cashCents = toCentsOrNull(cash?.cents);
  const base = {
    kind,
    months: RESERVE_MONTHS,
    cash_cents: cashCents,
    cash_is_floor: !!cash?.is_floor,
    cash_accounts: Number.isFinite(Number(cash?.accounts)) ? Number(cash.accounts) : 0,
    minimums_cents: counted > 0 ? known : null,
    minimums_is_floor: unknownMinimums > 0,
    unknown_minimums: unknownMinimums,
    clarity_cents: clarity !== null && clarity > 0 ? clarity : null,
    need_cents: counted > 0 ? RESERVE_MONTHS * known : null,
    short_cents: null
  };
  const unknown = (reason) => ({ ...base, state: "unknown", reason });

  if (counted === 0) return unknown(unknownMinimums > 0 ? "minimums_unknown" : "no_minimums");
  if (cashCents === null) return unknown(base.cash_accounts === 0 ? "no_cash_accounts" : "cash_unknown");
  if (staleBalance) return unknown("balance_stale");

  const need = base.need_cents;
  if (base.cash_is_floor) {
    // A total with a hole in it is a floor. Covering the need with a floor is a
    // real "ok"; falling short of it proves nothing.
    return cashCents >= need ? { ...base, state: "ok", reason: "covered" } : unknown("cash_is_a_floor");
  }
  if (cashCents < need) return { ...base, state: "below", reason: "below_need", short_cents: need - cashCents };
  return { ...base, state: "ok", reason: "covered" };
}

/**
 * planCashReserve(verdict, { clientId, episode }) → the alert, or null when the
 * verdict is not 'below'. `episode` is which drop this is (1 for the first), so
 * the key is the same for every retry of one drop and new for the next.
 */
export function planCashReserve(verdict, { clientId, episode = 1 } = {}) {
  if (!verdict || verdict.state !== "below") return null;
  const kind = verdict.kind;
  const need = `${verdict.minimums_is_floor ? "at least " : ""}${dollars(verdict.need_cents)}`;
  const cash = dollars(verdict.cash_cents);
  return {
    alert: true,
    kind: "cash_reserve",
    key: `fpa:cash:${clientId}:${kind}:${episode}`,
    templateKey: TEMPLATES.cash_reserve,
    bankAccountId: null,
    label: `${kind} cash`,
    threshold: verdict.months,
    dueOn: null,
    cashKind: kind,
    tags: { cash: kind, cash_amount: cash, need, months: String(verdict.months) },
    body: `Fundhub alert: your ${kind} cash is ${cash}. ${verdict.months} months of your ${kind} minimum payments is ${need}. A missed payment can hurt your file before your next funding sequence.`,
    detail: {
      cash_kind: kind,
      episode,
      cash_cents: verdict.cash_cents,
      minimums_cents: verdict.minimums_cents,
      minimums_is_floor: verdict.minimums_is_floor,
      need_cents: verdict.need_cents,
      short_cents: verdict.short_cents,
      months: verdict.months,
      clarity_cents: verdict.clarity_cents
    }
  };
}

export default evaluateReserve;
