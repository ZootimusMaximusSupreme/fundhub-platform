// Bill cleanup — two things worth a look on a client's repeat bills: a price
// that went up, and the same charge twice.
//
// Finance OS CFO build, wave 3, unit F (spec item 9, owner-set 2026-11-06):
// "Bill cleanup (lower priority). Flag a price jump or a double charge on a
// repeat bill." Shown on the Strategy screen as "Things to check", the look of
// the approved wireframe (ops/workflows/finance-os-cfo-demo-2026-11-06.html).
//
// ONLY REPEAT BILLS. A merchant is checked only when src/banking/recurring.mjs
// calls it a bill (medium or high confidence) on the same rows. Two coffees on
// one Tuesday are two coffees, not a double charge; the detector's grouping
// (account + normaliseMerchant) and its sign rule (negative = money out) are
// used as they are, so "a bill" means the same thing here and on every other
// money screen.
//
// THE TWO FLAGS, AND WHAT KEEPS THEM QUIET
//
//   price_jump     The newest price is at least $1.00 more than a price that held
//                  STEADY — the same amount to the cent, at least twice in a row
//                  just before it. A utility bill that moves every month never
//                  has a steady price, so it is never flagged. A price that went
//                  down is good news, not a cleanup item.
//   double_charge  Two separate charges (two provider ids) of the same amount on
//                  the same bill within 3 days of each other. If the same amount
//                  came back from that merchant within 10 days, it was refunded
//                  and is not flagged.
//
// Only what happened in the last 90 days is flagged; older history is still
// read, because a steady price needs history to be steady.
//
// MONEY IS INTEGER CENTS; amounts here are the SIZE of a charge (positive).
// Nothing here moves money, cancels a bill or contacts a merchant: it points.
//
// findBillProblems() is PURE (rows in, answer out, `now` is a parameter).
// loadBillCleanup() is the one read, org_id and client_id on every statement.

import {
  detectRecurringBills,
  normaliseMerchant,
  parseDay,
  formatDay,
  dayNumber
} from "./recurring.mjs";
import { accountMap } from "./income.mjs";

export const FLAG_WINDOW_DAYS = 90;
export const PRICE_JUMP_MIN_CENTS = 100;
export const STEADY_CHARGES = 2;
export const DOUBLE_CHARGE_DAYS = 3;
export const REFUND_MATCH_DAYS = 10;
/** How far back the read looks: enough paydays of history for the detector. */
export const READ_DAYS = 210;
export const ROW_CAP = 6000;

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

function intCents(v) {
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return Number.isSafeInteger(v) ? v : null;
}

function pick(row, ...names) {
  for (const n of names) if (row[n] !== undefined) return row[n];
  return undefined;
}

/* One row → a charge or a refund on a merchant, or null. The detector's own
   filters: posted (not pending), whole cents, a day, a merchant name. */
function readMove(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (pick(row, "is_pending", "isPending") === true) return null;
  const providerId = text(pick(row, "provider_transaction_id", "providerTransactionId"));
  const accountId = text(pick(row, "bank_account_id", "bankAccountId"));
  const cents = intCents(pick(row, "amount_cents", "amountCents"));
  const day = parseDay(pick(row, "posted_on", "postedOn"));
  const merchantKey = normaliseMerchant(pick(row, "merchant_name", "merchantName"));
  if (!providerId || !accountId || cents === null || cents === 0 || !day || !merchantKey) return null;
  return { providerId, accountId, cents, day, n: dayNumber(day), merchantKey };
}

/**
 * findBillProblems(rows, { now, accounts }) → { ok, as_of, checked_bills, flags }
 *
 * rows      bank_transactions rows for ONE client, both signs (a refund is the
 *           positive row that clears a double charge).
 * accounts  the client's accounts (name, mask, kind for the words on screen).
 */
export function findBillProblems(rows, { now, accounts = [] } = {}) {
  if (now === undefined || now === null) throw new TypeError("findBillProblems: `now` is required. There is no clock in here.");
  const today = parseDay(now instanceof Date ? now.toISOString() : now);
  if (!today) throw new TypeError(`findBillProblems: unparseable \`now\`: ${String(now)}`);
  if (!Array.isArray(rows)) throw new TypeError("findBillProblems: `rows` must be an array");

  const detection = detectRecurringBills(rows, { now: formatDay(today) });
  const bills = new Map(detection.bills.map((b) => [`${b.bankAccountId} ${b.merchantKey}`, b]));
  const acct = accountMap(accounts);

  const charges = new Map();
  const refunds = new Map();
  const seen = new Set();
  for (const r of rows) {
    const m = readMove(r);
    if (!m) continue;
    const key = `${m.accountId} ${m.merchantKey}`;
    if (!bills.has(key)) continue;
    const id = `${m.accountId} ${m.providerId}`;
    if (seen.has(id)) continue; // the same provider row twice is one charge, never a double charge
    seen.add(id);
    const into = m.cents < 0 ? charges : refunds;
    if (!into.has(key)) into.set(key, []);
    into.get(key).push({ ...m, size: Math.abs(m.cents) });
  }

  const todayN = dayNumber(today);
  const recent = (n) => todayN - n >= 0 && todayN - n <= FLAG_WINDOW_DAYS;
  const flags = [];

  for (const [key, list] of charges) {
    const bill = bills.get(key);
    const a = acct.get(bill.bankAccountId) || null;
    const base = {
      name: bill.merchantKey,
      merchant_key: bill.merchantKey,
      cadence: bill.cadence,
      bank_account_id: bill.bankAccountId,
      account_name: a ? a.name : null,
      account_mask: a ? a.mask : null,
      /* personal / business / unknown — whose money pays this bill. */
      money_kind: a ? a.kind : "unknown"
    };
    const sorted = [...list].sort((x, y) => x.n - y.n || x.providerId.localeCompare(y.providerId));

    /* Same charge twice. Each charge belongs to at most one pair; a refund of
       the same amount soon after clears the pair. */
    const paired = new Set();
    const back = [...(refunds.get(key) || [])].sort((x, y) => x.n - y.n);
    for (let i = 0; i < sorted.length; i += 1) {
      if (paired.has(i)) continue;
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (paired.has(j)) continue;
        if (sorted[j].n - sorted[i].n > DOUBLE_CHARGE_DAYS) break;
        if (sorted[j].size !== sorted[i].size) continue;
        paired.add(i);
        paired.add(j);
        const refund = back.find((r) => !r.used && r.size === sorted[j].size && r.n >= sorted[i].n && r.n - sorted[j].n <= REFUND_MATCH_DAYS);
        if (refund) { refund.used = true; break; }
        if (!recent(sorted[j].n)) break;
        flags.push({
          key: `double_charge:${bill.bankAccountId}:${bill.merchantKey}:${formatDay(sorted[j].day)}`,
          kind: "double_charge",
          ...base,
          on: formatDay(sorted[i].day),
          amount_cents: sorted[i].size,
          charges: [sorted[i], sorted[j]].map((c) => ({ on: formatDay(c.day), amount_cents: c.size }))
        });
        break;
      }
    }

    /* A price that went up after holding steady. Days with more than one charge
       are left out of the price line: which of two charges is "the price" is
       not something the data says. */
    const perDay = new Map();
    for (const c of sorted) perDay.set(c.n, perDay.has(c.n) ? null : c);
    const line = [...perDay.values()].filter(Boolean);
    if (line.length >= STEADY_CHARGES + 1) {
      let i = line.length - 1;
      const newSize = line[i].size;
      while (i > 0 && line[i - 1].size === newSize) i -= 1; // the first charge at the new price
      let k = i - 1;
      const oldSize = k >= 0 ? line[k].size : null;
      let steady = 0;
      while (k >= 0 && line[k].size === oldSize) { steady += 1; k -= 1; }
      if (oldSize !== null && steady >= STEADY_CHARGES && newSize - oldSize >= PRICE_JUMP_MIN_CENTS && recent(line[i].n)) {
        flags.push({
          key: `price_jump:${bill.bankAccountId}:${bill.merchantKey}:${formatDay(line[i].day)}`,
          kind: "price_jump",
          ...base,
          on: formatDay(line[i].day),
          from_cents: oldSize,
          to_cents: newSize,
          change_cents: newSize - oldSize,
          charges: line.slice(Math.max(0, i - STEADY_CHARGES), line.length).map((c) => ({ on: formatDay(c.day), amount_cents: c.size }))
        });
      }
    }
  }

  flags.sort((x, y) => (y.on > x.on ? 1 : y.on < x.on ? -1 : x.key.localeCompare(y.key)));
  return { ok: true, as_of: formatDay(today), window_days: FLAG_WINDOW_DAYS, checked_bills: bills.size, flags };
}

/* ── the read ────────────────────────────────────────────────────────────── */

const ACCOUNTS_SQL = `
  SELECT a.id::text AS id, a.account_type, a.closed_at, a.entity_kind, a.name, a.official_name, a.mask,
         e.kind AS container_kind
    FROM bank_accounts a
    LEFT JOIN entities e ON e.id = a.entity_id AND e.org_id = a.org_id AND e.archived_at IS NULL
   WHERE a.client_id = $1 AND a.org_id = $2`;

/* Dates as text: node-postgres moves a `date` a day east of UTC otherwise. */
const ROWS_SQL = `
  SELECT t.bank_account_id::text AS bank_account_id, t.provider_transaction_id, t.amount_cents,
         t.posted_on::text AS posted_on, t.merchant_name, t.is_pending
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.org_id = t.org_id
   WHERE t.org_id = $1 AND a.client_id = $2
     AND t.is_pending = false
     AND t.posted_on IS NOT NULL
     AND t.posted_on >= $3::date AND t.posted_on <= $4::date
     AND NOT (t.raw ? 'fundhub_removed_at')
   ORDER BY t.posted_on DESC, t.id ASC
   LIMIT $5`;

/**
 * loadBillCleanup(db, { orgId, clientId, asOf }) → findBillProblems()'s answer
 * plus `capped`, or { ok: false, reason } when the read failed. Read-only.
 */
export async function loadBillCleanup(db, { orgId, clientId, asOf = new Date() } = {}) {
  if (!orgId || !clientId) throw new TypeError("loadBillCleanup: orgId and clientId are required");
  const today = new Date(asOf).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - READ_DAYS * 86_400_000).toISOString().slice(0, 10);
  try {
    const [accounts, moves] = await Promise.all([
      db.query(ACCOUNTS_SQL, [clientId, orgId]),
      db.query(ROWS_SQL, [orgId, clientId, from, today, ROW_CAP + 1])
    ]);
    const capped = moves.rows.length > ROW_CAP;
    const rows = capped ? moves.rows.slice(0, ROW_CAP) : moves.rows;
    return { ...findBillProblems(rows, { now: today, accounts: accounts.rows }), capped };
  } catch (e) {
    return { ok: false, reason: "read_failed", message: e && e.message ? e.message : "The bank history could not be read." };
  }
}

export default findBillProblems;
