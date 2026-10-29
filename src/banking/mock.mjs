// The mock banking provider. Satisfies the exact plaid.mjs interface so that
// provider.mjs can dispatch to either one and no call site can tell which
// answered.
//
// NOTHING HERE TRANSMITS, for the same reason nothing in plaid.mjs does: there
// is no fetch(), no http client and no scheduler in this file and none may be
// added. This module invents its data. That is the entire point of it.
//
//
// *** DETERMINISTIC. NO Math.random() ANYWHERE. ***
//
// Every figure is produced by a seeded PRNG (mulberry32) whose seed is derived
// from the item id. The same item id yields byte-identical accounts, balances,
// holdings and transaction amounts on every call, forever.
//
// WHY IT MATTERS MORE THAN IT LOOKS. getAccounts() is expected to be re-read, and
// the store upserts on (plaid_item_id, plaid_account_id). If the mock drifted
// between runs, every refresh would either rewrite every balance with new
// nonsense or — worse, if the ids drifted too — append a second copy of every
// account. The owner would watch his net worth change every time he reloaded a
// page and would have no way to tell that from a real change. A mock that is not
// deterministic is not a mock, it is a random number generator wearing a costume.
//
// THE ONE THING THAT MOVES IS DATES. Transaction dates and balance_as_of are
// relative to `today`, because a bank's history genuinely is. `today` is an
// injectable parameter with the clock as its default, so a test pins it and gets
// a byte-identical answer while production still gets a plausible recent history.
//
//
// *** THE MOCK DOES NOT KNOW WHOSE MONEY IT IS, AND SAYS SO. ***
//
// This file generates accounts that a human would read as business ("Northwind
// Trading Operating") and accounts a human would read as personal ("Everyday
// Checking"). It returns entity_kind NOWHERE.
//
// It would be trivial to tag them, and it would be wrong. plaid.mjs's getAccounts
// header states the rule: accounts arriving from a bank carry no ownership
// information this product can trust, and every row written must keep
// bank_accounts.entity_kind at its 'unknown' default until a human or a document
// establishes otherwise. A mock that helpfully filled in entity_kind would train
// the whole system against a signal the real provider cannot supply, and the day
// someone flipped BANKING_PROVIDER to plaid, every account would go from
// confidently classified to 'unknown' and the Banking Surface screen would empty
// out with no code having changed.
//
// So the mock is deliberately as ignorant as the real thing. The names are a hint
// for the human doing the classifying, not an answer.

import { SEAM_REASONS } from "./plaid.mjs";

/* -------------------------------------------------------------------------- *
 * Seeded randomness
 * -------------------------------------------------------------------------- */

/** FNV-1a. Any string → a stable uint32 seed. */
function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, and good enough for fake bank balances. Returns a
 *  function producing floats in [0, 1). Chosen over a hand-rolled LCG because
 *  the low bits of an LCG cycle visibly, and "every mock balance ends in 00"
 *  is the kind of tell that makes a demo look broken. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max]. */
function intBetween(rnd, min, max) {
  return min + Math.floor(rnd() * (max - min + 1));
}

/* -------------------------------------------------------------------------- *
 * Calendar helpers — ISO strings only, no Date crossing a boundary.
 * See src/banking/statement-cycles.mjs for why.
 * -------------------------------------------------------------------------- */

function todayIso(today) {
  if (typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)) return today;
  const d = today instanceof Date ? today : new Date();
  return d.toISOString().slice(0, 10);
}

/** `iso` shifted by `days` (negative goes backwards). */
function shiftDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- *
 * The account set
 *
 * Fixed templates, seeded amounts. The SHAPE is stable so a human clicking
 * around sees a coherent picture; the NUMBERS vary per item so two clients do
 * not look identical.
 * -------------------------------------------------------------------------- */

/* Business and personal accounts coexist, and so do two credit cards and a
   brokerage — the brief's requirement, and also the interesting case: a funding
   decision that cannot see business and personal side by side is the one that
   gets made wrong. */
const TEMPLATES = [
  { key: "biz-operating", name: "Northwind Trading Operating", official: "NORTHWIND TRADING LLC — BUSINESS CHECKING",
    type: "depository", subtype: "checking", floor: 1_200_00, ceil: 48_000_00 },
  { key: "biz-savings",   name: "Northwind Reserve", official: "NORTHWIND TRADING LLC — BUSINESS SAVINGS",
    type: "depository", subtype: "savings",  floor: 5_000_00, ceil: 120_000_00 },
  { key: "per-checking",  name: "Everyday Checking", official: null,
    type: "depository", subtype: "checking", floor: 400_00, ceil: 14_000_00 },
  { key: "per-savings",   name: "Rainy Day", official: null,
    type: "depository", subtype: "savings",  floor: 1_000_00, ceil: 60_000_00 },
  { key: "card-visa",     name: "Rewards Visa", official: "VISA SIGNATURE REWARDS",
    type: "credit", subtype: "credit card", floor: 300_00, ceil: 9_400_00 },
  { key: "card-amex",     name: "Business Platinum", official: "AMERICAN EXPRESS BUSINESS PLATINUM",
    type: "credit", subtype: "credit card", floor: 800_00, ceil: 22_000_00 },
  { key: "brokerage",     name: "Long-Term Brokerage", official: "INDIVIDUAL TAXABLE BROKERAGE",
    type: "investment", subtype: "brokerage", floor: 0, ceil: 0 }
];

/* Recurring merchants, so the detector in recurring.mjs has something real to
   find. Same merchant, same amount, same day each month is exactly the pattern
   it looks for — a mock whose spending was pure noise would make the recurring
   bill feature look broken when it is working. */
const RECURRING = [
  { merchant: "ACME FIBER INTERNET", amountCents: -89_99, day: 4 },
  { merchant: "GLOBEX INSURANCE",    amountCents: -212_40, day: 9 },
  { merchant: "STREAMFLIX",          amountCents: -22_99, day: 17 },
  { merchant: "CITY POWER & LIGHT",  amountCents: -164_11, day: 22 }
];

const ONE_OFF = [
  "CORNER MARKET", "SHELL 41207", "BLUE BOTTLE", "HARDWARE DEPOT",
  "UNITED AIRLINES", "OFFICE SUPPLY CO", "LOCAL DINER", "RIDE SHARE"
];

const HOLDINGS = [
  { symbol: "VTI",  description: "Vanguard Total Stock Market ETF" },
  { symbol: "VXUS", description: "Vanguard Total International Stock ETF" },
  { symbol: "BND",  description: "Vanguard Total Bond Market ETF" },
  { symbol: "AAPL", description: "Apple Inc." }
];

/* -------------------------------------------------------------------------- *
 * Generation
 * -------------------------------------------------------------------------- */

/** A calendar-month step, not 30 days: 30-day hops repeat months near month-end.
 * Repeated month keys produce identical provider transaction IDs, so an import
 * silently overwrites legitimate mock payroll/recurring rows on refresh. */
function calendarMonth(iso, monthsBack) {
  const [year, month] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 - monthsBack, 1)).toISOString().slice(0, 7);
}

function buildTransactions(rnd, { accountId, today, months = 4 }) {
  const rows = [];
  const start = `${calendarMonth(today, months)}-01`;

  // Recurring first, so their dates are stable regardless of how many one-offs
  // the PRNG happens to produce.
  for (const r of RECURRING) {
    for (let m = months; m >= 0; m--) {
      const day = String(Math.min(r.day, 28)).padStart(2, "0");
      const posted = `${calendarMonth(today, m)}-${day}`;
      if (posted < start || posted > today) continue;
      rows.push({
        provider_transaction_id: `mock-tx-${accountId}-${r.merchant.replace(/\W+/g, "")}-${posted}`,
        posted_on: posted,
        // NEGATIVE IS MONEY OUT. 085's rule, and the mock must obey it or every
        // cash-flow number built on this data is inverted.
        amount_cents: r.amountCents,
        description: r.merchant,
        merchant_name: r.merchant,
        pending: false
      });
    }
  }

  // Income — two deposits a month, positive.
  for (let m = months; m >= 0; m--) {
    for (const dayOfMonth of [1, 15]) {
      const posted = `${calendarMonth(today, m)}-${String(dayOfMonth).padStart(2, "0")}`;
      if (posted < start || posted > today) continue;
      rows.push({
        provider_transaction_id: `mock-tx-${accountId}-payroll-${posted}`,
        posted_on: posted,
        amount_cents: intBetween(rnd, 2_100_00, 6_400_00),
        description: "DIRECT DEPOSIT PAYROLL",
        merchant_name: "PAYROLL",
        pending: false
      });
    }
  }

  // One-off spending, seeded.
  const count = intBetween(rnd, 24, 48);
  for (let i = 0; i < count; i++) {
    const posted = shiftDays(today, -intBetween(rnd, 0, months * 30));
    const merchant = ONE_OFF[intBetween(rnd, 0, ONE_OFF.length - 1)];
    rows.push({
      provider_transaction_id: `mock-tx-${accountId}-oneoff-${i}`,
      posted_on: posted,
      amount_cents: -intBetween(rnd, 6_00, 480_00),
      description: merchant,
      merchant_name: merchant,
      pending: false
    });
  }

  rows.sort((a, b) =>
    a.posted_on < b.posted_on ? 1 : a.posted_on > b.posted_on ? -1
      : a.provider_transaction_id < b.provider_transaction_id ? -1 : 1);
  return rows;
}

function buildAccount(rnd, tpl, { itemId, today, index }) {
  const providerAccountId = `mock-acct-${itemId}-${tpl.key}`;
  const mask = String(intBetween(rnd, 1000, 9999));

  const account = {
    provider_account_id: providerAccountId,
    name: tpl.name,
    official_name: tpl.official,
    mask,
    account_type: tpl.type,
    account_subtype: tpl.subtype,
    currency_code: "USD",
    available_balance_cents: null,
    current_balance_cents: null,
    credit_limit_cents: null,
    // A real read is as-of the moment it was taken, not the moment it was
    // stored. Backdated a few hours so nothing implies more freshness than a
    // bank would actually give.
    balance_as_of: `${shiftDays(today, 0)}T12:00:00.000Z`,
    // entity_kind IS DELIBERATELY ABSENT. See the file header.
    statement_cycle: null,
    holdings: null,
    transactions: []
  };

  if (tpl.type === "depository") {
    const current = intBetween(rnd, tpl.floor, tpl.ceil);
    account.current_balance_cents = current;
    // Available trails current by any pending activity — a small, seeded gap
    // rather than an exact copy, because a screen that shows two identical
    // numbers teaches the reader they are the same number.
    account.available_balance_cents = current - intBetween(rnd, 0, 340_00);
    account.transactions = buildTransactions(rnd, { accountId: providerAccountId, today });
  }

  if (tpl.type === "credit") {
    const limit = intBetween(rnd, 5_000_00, 35_000_00);
    const balance = intBetween(rnd, tpl.floor, Math.min(tpl.ceil, limit));
    account.credit_limit_cents = limit;
    // On a credit line, `current` is what is owed and `available` is headroom.
    // src/finance/banking-surface.mjs states the rule that headroom is not cash;
    // the mock must produce data that makes that distinction checkable.
    account.current_balance_cents = balance;
    account.available_balance_cents = limit - balance;

    const closeDay = intBetween(rnd, 1, 28);
    const dueDay = ((closeDay + 24) % 28) + 1;
    account.statement_cycle = {
      statement_close_day: closeDay,
      payment_due_day: dueDay,
      last_statement_date: shiftDays(today, -intBetween(rnd, 3, 30)),
      last_statement_balance_cents: balance,
      minimum_payment_cents: Math.max(25_00, Math.round(balance * 0.02)),
      // APR AS A FRACTION 0..1, matching 096's CHECK and card_liabilities.apr.
      // Written as a fraction here rather than "24.99" so that nothing
      // downstream is tempted to convert it a second time — the double-convert
      // that inflates figures 100-fold has already happened once in this repo.
      apr: Number((intBetween(rnd, 1499, 2999) / 10000).toFixed(5))
    };
  }

  if (tpl.type === "investment") {
    const holdings = HOLDINGS.map((h) => {
      const qty = intBetween(rnd, 5, 400);
      const unitCostCents = intBetween(rnd, 40_00, 320_00);
      const drift = 0.7 + rnd() * 0.9;   // some positions down, some up
      return {
        symbol: h.symbol,
        description: h.description,
        quantity: qty,
        cost_basis_cents: qty * unitCostCents,
        current_value_cents: Math.round(qty * unitCostCents * drift),
        as_of: `${today}T21:00:00.000Z`,
        currency_code: "USD"
      };
    });
    account.holdings = holdings;
    const total = holdings.reduce((s, h) => s + h.current_value_cents, 0);
    account.current_balance_cents = total;
    // A brokerage account's "available" is settled cash, which is not the
    // position value. Left NULL rather than copied from current: NULL means
    // unknown and unknown must survive.
    account.available_balance_cents = null;
  }

  void index;
  return account;
}

/* -------------------------------------------------------------------------- *
 * The interface. Signatures identical to plaid.mjs.
 * -------------------------------------------------------------------------- */

/**
 * linkAccount({ clientId, publicToken, env }) → { ok, reason, item, clientId, missing[] }
 *
 * Succeeds, which is the one place the mock deliberately differs from plaid.mjs
 * — that module returns not_implemented on purpose and this one exists so the
 * owner has something that works.
 *
 * publicToken is accepted so the signature is the real one and immediately
 * dropped. Even in a mock it is named as credential material, so that nobody
 * copying this file into a real implementation inherits a habit of retaining it.
 */
export async function linkAccount({ clientId = null, publicToken = null, env = process.env } = {}) {
  void publicToken;
  void env;

  if (!clientId) {
    return { ok: false, reason: SEAM_REASONS.NOT_CONFIGURED, item: null, clientId: null,
             missing: ["clientId is required to link an account"] };
  }

  const rnd = mulberry32(hashSeed(`item:${clientId}`));
  return {
    ok: true,
    reason: null,
    clientId,
    missing: [],
    item: {
      provider: "mock",
      provider_item_id: `mock-item-${hashSeed(String(clientId)).toString(16)}`,
      institution_id: "ins_mock_001",
      institution_name: ["First Meridian Bank", "Cascade Credit Union", "Harborline Financial"][intBetween(rnd, 0, 2)],
      // No access token is minted. There is nothing to encrypt because there is
      // nothing real to protect, and generating a fake credential would put a
      // string shaped like a bank token into the database for no reason.
      access_token: null
    }
  };
}

/**
 * getAccounts({ itemId, env, today }) → { ok, reason, accounts, itemId, missing[] }
 *
 * `today` is an EXTRA OPTIONAL parameter that plaid.mjs does not take. Adding it
 * does not break the shared interface — provider.mjs never passes it and the
 * default is the clock — and it is what makes the transaction history pinnable
 * in a test. Every amount is seeded and stable without it; only dates move.
 *
 * `accounts` is null on refusal, never []. See provider.mjs.
 */
export async function getAccounts({ itemId = null, env = process.env, today = null } = {}) {
  void env;

  if (!itemId) {
    return { ok: false, reason: SEAM_REASONS.NOT_CONFIGURED, accounts: null, itemId: null,
             missing: ["itemId is required to read accounts"] };
  }

  const day = todayIso(today);
  const rnd = mulberry32(hashSeed(`accounts:${itemId}`));

  const accounts = TEMPLATES.map((tpl, index) =>
    buildAccount(rnd, tpl, { itemId, today: day, index }));

  return { ok: true, reason: null, accounts, itemId, missing: [] };
}

export default { linkAccount, getAccounts };
