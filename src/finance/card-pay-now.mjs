// @ts-check
// "Pay this card now" — FinanceOS unit I6 (owner ask, Chris, 2026-11-07).
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ FUNDHUB NEVER MOVES THE MONEY FOR A CARD PAYMENT. Plaid cannot do it.     │
// └───────────────────────────────────────────────────────────────────────────┘
//
// WHAT PLAID'S DOCS SAY (read on the web 2026-11-07, before this was built):
//   * Auth — "Credit-type accounts, including credit cards, cannot receive
//     payments directly via electronic interbank transfers." and "Auth data
//     cannot be used to set up credit card payments." https://plaid.com/docs/auth/
//   * Transfer — "Supported account types are debitable checking, savings, or
//     cash management accounts." and "Plaid Transfer does not support peer to
//     peer transfers or transfers between two accounts held by the same person."
//     https://plaid.com/docs/transfer/creating-transfers/ (the transfer engine,
//     src/finance/money-transfers.mjs, already refuses a card as a destination:
//     its view marks such a move blocked "card_payment").
//   * Liabilities — a card's data holds last_payment_date, last_payment_amount
//     and next_payment_due_date, and no payee or payment link.
//     https://plaid.com/docs/api/products/liabilities/
//   * Institutions — /institutions/get_by_id with include_optional_metadata
//     answers the bank's `url`, "The URL for the institution's website".
//     https://plaid.com/docs/api/institutions/
//
// SO THE BUTTON IS A LINK, NOT A TRANSFER:
//   1. "Pay now" opens the card company's OWN website, the `url` Plaid gave for
//      that bank (stored once per bank in plaid_institutions, migration 575,
//      unit H). The client signs in there and pays there. No url → no link; the
//      row says to pay in the card's app. A url is never typed in by hand here.
//   2. "I paid" saves one card_payment_claims row (migration 581): which card,
//      which due date, the day they paid, and the amount if they typed one.
//   3. Plaid CONFIRMS it later. The claim is matched against what Plaid shows
//      for that card: the liabilities read's last_payment_date (kept on the
//      statement-cycle row's raw by src/banking/plaid-liabilities.mjs), or a
//      posted payment on the card's own transactions. Nothing is marked
//      confirmed on the client's word alone.
//
// No step-up (passkey) and no consent screen: nothing here moves money or opens
// a bank connection. The transfer guards (PR #387) stay where money moves.
//
// RULES: money is integer cents; unknown is null, never 0; every client query
// names org_id AND client_id. plaid_institutions holds no client data (it is a
// bank's public logo and website), and is reached only through this client's
// own plaid_items rows.
//
// Pure: payLink, isCardPayment, paymentsSeen, claimStatus, buildPayNow,
// validateCardPaid. Reads: cardPayNow. Writes: recordCardPaid, withdrawCardPaid.

import { ACCOUNT_SQL, CYCLE_SQL, LIABILITY_SQL, buildMoneyOverview } from "./money-overview.mjs";
import { parseIsoDate, formatIsoDate, daysBetween } from "../banking/statement-cycles.mjs";

/** "I paid" a few days after paying still matches: the payment may post first. */
export const SEEN_BEFORE_DAYS = 3;
/** A card payment can take days to post (two weekends and a holiday). After this
 *  many days with nothing seen, the row says the bank has not shown it yet. */
export const SEEN_AFTER_DAYS = 10;
/** A due date the bank moved a few days (off a weekend) is still the same bill.
 *  Same number as EXACT_WINS_DAYS in src/finance/plan-sources/dues.mjs. */
export const SAME_DUE_DAYS = 10;
/** How far back "the day you paid" may go. */
export const CLAIM_MAX_AGE_DAYS = 30;
/** How far from today a due date on an "I paid" may be. */
export const DUE_WINDOW_DAYS = 62;
/** How much history is read for the card's payments and claims. */
export const LOOKBACK_DAYS = 90;
/** The biggest amount accepted: $1,000,000,000.00 (the 581 CHECK). */
export const MAX_AMOUNT_CENTS = 100_000_000_000;

/** Providers whose cards Plaid keeps reading. 'mock' is the sandbox fixture feed. */
const CHECKABLE_PROVIDERS = new Set(["plaid", "mock"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ *
 * Small readers. Absent turns into null, never into 0.
 * ------------------------------------------------------------------ */

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v));

/** @param {unknown} v */
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** 'YYYY-MM-DD' (or the date part of a longer ISO string) → that date, else null. */
function isoDay(v) {
  const s = text(v);
  if (s === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m && parseIsoDate(m[1]) ? m[1] : null;
}

/** 'YYYY-MM-DD' + n days. */
export function addDays(iso, n) {
  const d = parseIsoDate(iso);
  if (!d) return null;
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return formatIsoDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

/* ------------------------------------------------------------------ *
 * Pure rules
 * ------------------------------------------------------------------ */

/**
 * payLink(url) — the card company's website from Plaid, made safe to put in a
 * link. https only, no user:password@, no spaces. Returns { url, site } where
 * site is the host without "www." ("chase.com"), or null.
 * @param {unknown} url
 */
export function payLink(url) {
  const s = text(url);
  if (s === null || s.length > 500 || /\s/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
  return { url: u.href, site: u.hostname.replace(/^www\./i, "").toLowerCase() };
}

/* A card payment arrives on the card as money IN (085's sign: positive = in).
   A refund or a reward is money in too, so the words must say payment. */
const PAYMENT_CATEGORY = /CREDIT_CARD_PAYMENT|^payment\b/i;
const PAYMENT_WORDS = /\bpayment\b|\bautopay\b|\bthank you\b/i;
const NOT_A_PAYMENT = /refund|return|reversal|reward|cash ?back|adjustment|dispute|interest|fee\b/i;

/**
 * isCardPayment(row) — is this posted row on a credit card a payment the client
 * made? Plaid's category says so (LOAN_PAYMENTS_CREDIT_CARD_PAYMENT, or the
 * older "Payment > Credit Card"), or the bank's own words say "payment" and
 * nothing says refund. Pending rows and money out never count.
 * @param {any} row
 */
export function isCardPayment(row) {
  if (!row || row.is_pending === true) return false;
  const amount = cents(row.amount_cents);
  if (amount === null || amount <= 0 || !isoDay(row.posted_on)) return false;
  const category = text(row.category) ?? "";
  const words = text(row.merchant_name) ?? "";
  if (NOT_A_PAYMENT.test(category) || NOT_A_PAYMENT.test(words)) return false;
  return PAYMENT_CATEGORY.test(category) || PAYMENT_WORDS.test(words);
}

/**
 * paymentsSeen({ cycle, transactions }) — every payment Plaid shows for ONE
 * card, newest first, one per day. Two sources:
 *   * the liabilities read: raw.last_payment_date / last_payment_amount_cents
 *     on the card's statement-cycle row (only when raw.source is 'plaid');
 *   * posted payments on the card's own transactions (isCardPayment).
 * @param {{ cycle?: any, transactions?: any[] }} input
 * @returns {{ on: string, amount_cents: number|null, source: string }[]}
 */
export function paymentsSeen({ cycle = null, transactions = [] } = {}) {
  const byDay = new Map();
  const add = (on, amount, source) => {
    const prev = byDay.get(on);
    if (!prev || (prev.amount_cents === null && amount !== null)) byDay.set(on, { on, amount_cents: amount, source });
  };
  const raw = cycle && cycle.raw && typeof cycle.raw === "object" ? cycle.raw : null;
  if (raw && raw.source === "plaid") {
    const on = isoDay(raw.last_payment_date);
    const amount = cents(raw.last_payment_amount_cents);
    if (on) add(on, amount !== null && amount > 0 ? amount : null, "plaid_liabilities");
  }
  for (const t of Array.isArray(transactions) ? transactions : []) {
    if (isCardPayment(t)) add(/** @type {string} */ (isoDay(t.posted_on)), cents(t.amount_cents), "plaid_transactions");
  }
  return [...byDay.values()].sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
}

/**
 * claimStatus(claim, seen, { today, canCheck }) — what one "I paid" says now.
 *   confirmed     Plaid shows a payment from SEEN_BEFORE_DAYS before the day
 *                 they paid to SEEN_AFTER_DAYS after it (the closest one wins).
 *   waiting       nothing yet, and it is still inside that window.
 *   not_seen      the window passed and Plaid shows nothing.
 *   cannot_check  the card is not read through Plaid, so nothing can confirm it.
 * @param {{ paid_on: string }} claim
 * @param {{ on: string, amount_cents: number|null }[]} seen
 * @param {{ today: string, canCheck: boolean }} opts
 */
export function claimStatus(claim, seen, { today, canCheck }) {
  if (!canCheck) return { status: "cannot_check", seen_on: null, seen_amount_cents: null };
  const lo = addDays(claim.paid_on, -SEEN_BEFORE_DAYS);
  const hi = addDays(claim.paid_on, SEEN_AFTER_DAYS);
  if (!lo || !hi) return { status: "waiting", seen_on: null, seen_amount_cents: null };
  let hit = null;
  for (const s of Array.isArray(seen) ? seen : []) {
    if (!s || s.on < lo || s.on > hi) continue;
    const gap = Math.abs(daysBetween(claim.paid_on, s.on) ?? 999);
    if (!hit || gap < hit.gap) hit = { s, gap };
  }
  if (hit) return { status: "confirmed", seen_on: hit.s.on, seen_amount_cents: hit.s.amount_cents };
  if (today > hi) return { status: "not_seen", seen_on: null, seen_amount_cents: null };
  return { status: "waiting", seen_on: null, seen_amount_cents: null };
}

/**
 * buildPayNow — stored rows → one entry per open card. Pure.
 *
 * @param {object} input
 * @param {string} input.today                'YYYY-MM-DD'
 * @param {any[]}  input.cards                debt.cards from buildMoneyOverview (same due dates as the Overview)
 * @param {any[]}  [input.accounts]           ACCOUNT_SQL rows (provider, institution_name)
 * @param {any[]}  [input.cycles]             CYCLE_SQL rows (raw has Plaid's last payment)
 * @param {Record<string,string|null>} [input.urls]  bank_account_id → the bank's website from Plaid
 * @param {any[]}  [input.claims]             card_payment_claims rows, not withdrawn
 * @param {any[]}  [input.transactions]       posted money-in rows on the cards
 */
export function buildPayNow({ today, cards = [], accounts = [], cycles = [], urls = {}, claims = [], transactions = [] }) {
  const acctById = new Map((Array.isArray(accounts) ? accounts : []).filter((a) => a && a.id).map((a) => [String(a.id), a]));
  const cycleById = new Map();
  for (const c of Array.isArray(cycles) ? cycles : []) if (c && c.bank_account_id) cycleById.set(String(c.bank_account_id), c);
  const txById = new Map();
  for (const t of Array.isArray(transactions) ? transactions : []) {
    const k = t && t.bank_account_id ? String(t.bank_account_id) : null;
    if (!k) continue;
    if (!txById.has(k)) txById.set(k, []);
    txById.get(k).push(t);
  }

  return (Array.isArray(cards) ? cards : []).filter((c) => c && c.account_id).map((c) => {
    const id = String(c.account_id);
    const acct = acctById.get(id) || {};
    const cycle = cycleById.get(id) || null;
    const canCheck = CHECKABLE_PROVIDERS.has(String(acct.provider || ""));
    const link = payLink(urls ? urls[id] : null);
    const seen = paymentsSeen({ cycle, transactions: txById.get(id) || [] });
    const dueOn = isoDay(c.due_on);

    /* The newest live "I paid" for THIS bill: its due date within a few days of
       the row's (a bank can move a due date off a weekend). */
    const mine = (Array.isArray(claims) ? claims : [])
      .filter((k) => k && String(k.bank_account_id) === id && isoDay(k.due_on) && isoDay(k.paid_on) && !k.withdrawn_at)
      .filter((k) => dueOn && Math.abs(daysBetween(dueOn, /** @type {string} */ (isoDay(k.due_on))) ?? 999) <= SAME_DUE_DAYS)
      .sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on)) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const k = mine[0] || null;
    const claim = k ? {
      id: String(k.id),
      due_on: isoDay(k.due_on),
      paid_on: isoDay(k.paid_on),
      amount_cents: cents(k.amount_cents),
      by: k.created_by_kind === "staff" ? "staff" : "client",
      ...claimStatus({ paid_on: /** @type {string} */ (isoDay(k.paid_on)) }, seen, { today, canCheck })
    } : null;

    /* With no "I paid", a payment Plaid shows AFTER the last statement is a
       payment on this bill. No statement date known → nothing is claimed. */
    const stmt = isoDay(cycle && cycle.last_statement_date)
      ?? isoDay(cycle && cycle.raw && cycle.raw.plaid && cycle.raw.plaid.last_statement_issue_date);
    const onBill = stmt ? seen.find((s) => s.on > stmt && s.on <= today) || null : null;

    return {
      account_id: id,
      name: text(c.name),
      mask: text(c.mask),
      institution: text(acct.institution_name),
      due_on: dueOn,
      min_due_cents: cents(c.min_due_cents),
      past_due_cents: cents(c.past_due_cents),
      pay_url: link ? link.url : null,
      pay_site: link ? link.site : null,
      can_check: canCheck,
      claim,
      seen: onBill ? { on: onBill.on, amount_cents: onBill.amount_cents } : null
    };
  });
}

/**
 * validateCardPaid(body, { today }) — the "I paid" input, checked. Pure.
 * Returns { ok:true, accountId, dueOn, paidOn, amountCents } or { ok:false, error, message }.
 * @param {any} body
 * @param {{ today: string }} opts
 */
export function validateCardPaid(body, { today }) {
  const b = body && typeof body === "object" ? body : {};
  const bad = (error, message) => ({ ok: false, error, message });
  if (!UUID.test(String(b.account_id || ""))) return bad("account_id_required", "Pick the card you paid.");
  const dueOn = isoDay(b.due_on);
  if (!dueOn || String(b.due_on).length !== 10) return bad("due_on_required", "This card has no due date to mark paid.");
  const gapDue = daysBetween(today, dueOn);
  if (gapDue === null || Math.abs(gapDue) > DUE_WINDOW_DAYS) return bad("due_on_out_of_range", "That due date is too far from today.");
  const paidRaw = b.paid_on === undefined || b.paid_on === null || b.paid_on === "" ? today : b.paid_on;
  const paidOn = isoDay(paidRaw);
  if (!paidOn || String(paidRaw).length !== 10) return bad("paid_on_invalid", "Pick the day you paid.");
  if (paidOn > today) return bad("paid_on_future", "The day you paid can't be after today.");
  if ((daysBetween(paidOn, today) ?? 999) > CLAIM_MAX_AGE_DAYS) {
    return bad("paid_on_too_old", `Pick a day in the last ${CLAIM_MAX_AGE_DAYS} days.`);
  }
  let amountCents = null;
  if (b.amount_cents !== undefined && b.amount_cents !== null && b.amount_cents !== "") {
    /* Whole cents as a JSON number. A string like "35.00" is refused, never read
       as 35 cents. */
    const n = b.amount_cents;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0 || n > MAX_AMOUNT_CENTS) {
      return bad("amount_invalid", "Type the amount you paid, like 35.00, or leave it blank.");
    }
    amountCents = n;
  }
  return { ok: true, accountId: String(b.account_id).toLowerCase(), dueOn, paidOn, amountCents };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/* The Plaid bank behind each open card. plaid_items holds no secret in these
   columns; the access token is never selected. */
const CARD_INSTITUTION_SQL = `
  SELECT a.id::text AS bank_account_id, p.plaid_institution_id
    FROM bank_accounts a
    JOIN plaid_items p ON p.id = a.plaid_item_id AND p.org_id = a.org_id
   WHERE a.client_id = $1 AND a.org_id = $2
     AND a.account_type = 'credit' AND a.closed_at IS NULL
     AND p.plaid_institution_id IS NOT NULL`;

/* plaid_institutions arrives with unit H (migration 575). Until it is on the
   database, there is simply no website to link to. */
const HAS_INSTITUTIONS_SQL = `SELECT to_regclass('public.plaid_institutions') IS NOT NULL AS present`;

/* Each bank's website, reached only through this client's own logins. */
const INSTITUTION_URL_SQL = `
  SELECT DISTINCT i.plaid_institution_id, i.url
    FROM plaid_institutions i
    JOIN plaid_items p ON p.plaid_institution_id = i.plaid_institution_id
   WHERE p.client_id = $1 AND p.org_id = $2 AND i.url IS NOT NULL`;

const CLAIMS_SQL = `
  SELECT id, bank_account_id::text AS bank_account_id, due_on::text AS due_on, paid_on::text AS paid_on,
         amount_cents, created_by_kind, created_at
    FROM card_payment_claims
   WHERE client_id = $1 AND org_id = $2 AND withdrawn_at IS NULL AND paid_on >= $3::date
   ORDER BY paid_on DESC, created_at DESC`;

/* Posted money IN on the cards (085's sign), for the payment check. Dates as
   text so no time zone moves a day. */
const CARD_PAYMENTS_SQL = `
  SELECT bank_account_id::text AS bank_account_id, posted_on::text AS posted_on,
         amount_cents, category, merchant_name, is_pending
    FROM bank_transactions
   WHERE client_id = $1 AND org_id = $2
     AND bank_account_id = ANY($3::uuid[])
     AND is_pending = false AND amount_cents > 0
     AND posted_on IS NOT NULL AND posted_on >= $4::date
     AND NOT (raw ? 'fundhub_removed_at')`;

/** @typedef {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} Queryable */

/**
 * cardPayNow(db, { orgId, clientId, asOf }) → { ok, as_of, today, cards } or
 * null when the client is not in the org. Every client query names org_id AND
 * client_id.
 * @param {Queryable} db
 * @param {{ orgId: string, clientId: string, asOf?: Date }} args
 */
export async function cardPayNow(db, { orgId, clientId, asOf = new Date() }) {
  const asOfIso = new Date(asOf).toISOString();
  const today = asOfIso.slice(0, 10);
  const since = /** @type {string} */ (addDays(today, -LOOKBACK_DAYS));

  const client = await db.query(`SELECT id FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
  if (!client.rows[0]) return null;

  const [accounts, cycles, liabilities, institutions, claims] = await Promise.all([
    db.query(ACCOUNT_SQL, [clientId, orgId]),
    db.query(CYCLE_SQL, [clientId, orgId]),
    db.query(LIABILITY_SQL, [clientId, orgId]),
    db.query(CARD_INSTITUTION_SQL, [clientId, orgId]),
    db.query(CLAIMS_SQL, [clientId, orgId, since])
  ]);
  const cycleRows = cycles.rows.map((r) => r.row ?? r);

  /* The same cards, due dates and minimums the Overview shows: its own pure
     builder on its own three reads. */
  const ov = buildMoneyOverview({
    client: { id: clientId },
    asOf: asOfIso,
    accounts: accounts.rows,
    entities: [],
    txMonths: [],
    bills: [],
    cycles: cycleRows,
    liabilities: liabilities.rows.map((r) => r.row ?? r),
    pricePerContainerCents: null,
    tip: null
  });
  const cards = ov.debt.cards;
  const cardIds = cards.map((c) => c.account_id);

  /** @type {Record<string, string|null>} */
  const urls = {};
  if (institutions.rows.length) {
    const present = await db.query(HAS_INSTITUTIONS_SQL);
    if (present.rows[0] && present.rows[0].present === true) {
      const found = await db.query(INSTITUTION_URL_SQL, [clientId, orgId]);
      const byInst = new Map(found.rows.map((r) => [String(r.plaid_institution_id), r.url]));
      for (const r of institutions.rows) urls[String(r.bank_account_id)] = byInst.get(String(r.plaid_institution_id)) ?? null;
    }
  }

  const transactions = cardIds.length
    ? (await db.query(CARD_PAYMENTS_SQL, [clientId, orgId, cardIds, since])).rows
    : [];

  return {
    ok: true,
    as_of: asOfIso,
    today,
    cards: buildPayNow({ today, cards, accounts: accounts.rows, cycles: cycleRows, urls, claims: claims.rows, transactions })
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * recordCardPaid(db, { orgId, clientId, input, byKind, staffId, today })
 * → { ok:true, claim } | { ok:false, error, message }.
 * The card must be an OPEN credit card on this client's file in this org.
 * Saying "I paid" again for the same due date updates that one row.
 * @param {Queryable} db
 * @param {{ orgId: string, clientId: string, input: any, byKind: "client"|"staff", staffId?: string|null, today: string }} args
 */
export async function recordCardPaid(db, { orgId, clientId, input, byKind, staffId = null, today }) {
  const v = validateCardPaid(input, { today });
  if (!v.ok) return v;
  const card = await db.query(
    `SELECT id FROM bank_accounts
      WHERE id = $1 AND client_id = $2 AND org_id = $3
        AND account_type = 'credit' AND closed_at IS NULL`,
    [v.accountId, clientId, orgId]
  );
  if (!card.rows[0]) return { ok: false, error: "card_not_found", message: "We could not find that card on your file." };
  const by = byKind === "staff" ? "staff" : "client";
  const { rows } = await db.query(
    `INSERT INTO card_payment_claims
       (org_id, client_id, bank_account_id, due_on, paid_on, amount_cents, created_by_kind, created_by_staff_id)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8)
     ON CONFLICT (org_id, client_id, bank_account_id, due_on) WHERE withdrawn_at IS NULL
     DO UPDATE SET paid_on = EXCLUDED.paid_on, amount_cents = EXCLUDED.amount_cents, updated_at = now()
     RETURNING id, due_on::text AS due_on, paid_on::text AS paid_on, amount_cents`,
    [orgId, clientId, v.accountId, v.dueOn, v.paidOn, v.amountCents, by, by === "staff" && staffId && UUID.test(staffId) ? staffId : null]
  );
  const r = rows[0];
  return { ok: true, claim: { id: String(r.id), due_on: r.due_on, paid_on: r.paid_on, amount_cents: cents(r.amount_cents) } };
}

/**
 * withdrawCardPaid(db, { orgId, clientId, claimId }) — "Undo". The row is kept
 * with withdrawn_at set; nothing is deleted.
 * @param {Queryable} db
 * @param {{ orgId: string, clientId: string, claimId: unknown }} args
 */
export async function withdrawCardPaid(db, { orgId, clientId, claimId }) {
  if (!UUID.test(String(claimId || ""))) return { ok: false, error: "claim_id_required", message: "That request was missing a part. Reload and try again." };
  const { rows } = await db.query(
    `UPDATE card_payment_claims SET withdrawn_at = now(), updated_at = now()
      WHERE id = $1 AND client_id = $2 AND org_id = $3 AND withdrawn_at IS NULL
      RETURNING id`,
    [String(claimId), clientId, orgId]
  );
  if (!rows[0]) return { ok: false, error: "claim_not_found", message: "That payment note is already gone. Reload to see the latest." };
  return { ok: true };
}

export default { cardPayNow, recordCardPaid, withdrawCardPaid, buildPayNow, validateCardPaid, claimStatus, paymentsSeen, isCardPayment, payLink };
