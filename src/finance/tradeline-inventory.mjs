// Tradeline inventory and the banks a client already uses — Finance OS wave 4,
// unit TL (ops/workflows/finance-os-wave4-brief.txt).
//
// OWNER, Chris 2026-11-07: "when we scan their credit, we look at what trade
// lines are already on their reports... those are the easiest banks we can
// always monetize... we can't tell them to apply to Chase when they already
// have Chase bank accounts and Chase credit cards... no overlap with credit
// cards they already have... tradeline tracking for business and personal...
// they can also input their own... so we know what they have at all times,
// through Plaid."
//
// THIS IS IN ADDITION TO UNDERWRITEIQ. Nothing here feeds the engine, changes a
// funding number or a fundability check, or edits src/underwrite/** or
// src/finance/fundability.mjs. It reads what the client holds and tells the bank
// plan two things: which banks are an existing relationship, and which products
// the client already has.
//
// WHERE EACH ACCOUNT COMES FROM ("sources", shown as chips on the screen)
//   report   the saved credit pulls (crs_results, genuine pulls only — the same
//            CRS_SQL the bank plan reads). For each bureau, the newest pull that
//            carries that bureau's lines: an account that dropped off the newest
//            report is not shown as held. Plus each saved business's Experian
//            Business report (result.businessReports[], src/finance/crs-pull.mjs),
//            read with the same keys the UnderwriteIQ engine reads
//            (vendor/underwriteiq-full/api/lite/crs/extract-tradelines.js).
//   plaid    bank_accounts on a Plaid login: cards, loans, checking, savings.
//            The bank is Plaid's own institution name.
//   you      typed by the client: the Accounts page's "Add account by hand"
//            (bank_accounts with raw.entered_by = 'client') and this unit's
//            "Add an account" (finance_tradeline_entries, migration 590).
//   fundhub  typed by staff: hand accounts staff entered and the card-stack
//            screen's tradelines (source 'manual', staff-only door).
//
// ONE ROW PER REAL ACCOUNT. The same card on three bureaus, on Plaid and typed
// by hand is merged into one row only when the match is plain: the same bank,
// the same kind of account, and the same last 4 digits, or the same limit with
// no other card at that bank that could be it. Anything less stays two rows.
// This is a display merge: no number in this file reaches a funding total.
//
// BANKS: A MATCH MUST BE CERTAIN. A name matches a bank on Giovanni's list
// (lenders.active, migration 504) only through KNOWN_BANKS below: exact names
// and a few distinctive prefixes ("JPMCB CARD SERVICES" is Chase, "BK OF AMER"
// is Bank of America). A look-alike name ("Citizens Bank", "First National
// Bank") never matches from a report or a typed name, because many banks carry
// it. No entry, no match: the account still shows, with no bank tag.
//
// EXISTING RELATIONSHIP = an open account, not an authorized-user line, at a
// bank on the list. Those banks are tagged and ranked first in the bank plan
// (recommended banks, card stacking, the deposit plan) and in the approval odds
// ("easiest to monetize"). Personal before business still holds in card
// stacking (src/underwrite/funding-sequence.mjs).
//
// NO OVERLAP. A card line never recommends a product the client already holds
// open at that bank. "Held" means every distinctive word of the bank book's
// product name is in the account's own name (Plaid's name, or the card name the
// client typed), at the same bank, of the same kind. The line then says "You
// already have this" and moves to the bank book's next product at that bank;
// when the book lists no other product the line leaves the apply order. An
// unnamed book product ("Business credit card") is never called held.
//
// SCOPE. Every query names org_id and client_id (lenders: org_id). Nothing here
// moves money, sends anything or deletes a row.

import { normalizeTradeline, extractTradelineRecords } from "../tradelines/index.mjs";
import { bureauOf } from "./crs-map.mjs";
import { findLogos, bankName as plaidBankName } from "../banking/institution-logos.mjs";
import { isBusinessLenderTable, isPersonalLenderTable, LENDER_TABLES } from "../lenders/tables.mjs";
import { bankStrategy, productWords, CRS_SQL } from "./bank-strategy.mjs";
import { bankSteps, depositPlanRows } from "../waypoints/blueprint-path.mjs";
import { dollarsToCents } from "./money-accounts.mjs";

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

export const SOURCE_ORDER = Object.freeze(["report", "plaid", "you", "fundhub"]);
export const SOURCE_WORDS = Object.freeze({ report: "Report", plaid: "Plaid", you: "Added by you", fundhub: "Added by Fundhub" });

export const TYPE_WORDS = Object.freeze({
  card: "Credit card", line: "Line of credit", loan: "Loan", mortgage: "Mortgage",
  checking: "Checking", savings: "Savings", deposit: "Bank account", other: "Account"
});

/** The "Add an account" types, and the kind each one is in the inventory. */
export const ENTRY_TYPES = Object.freeze({
  credit_card: { type: "card", label: "Credit card" },
  line_of_credit: { type: "line", label: "Line of credit" },
  loan: { type: "loan", label: "Loan" },
  checking: { type: "checking", label: "Checking" },
  savings: { type: "savings", label: "Savings" }
});
const LIMIT_TYPES = new Set(["credit_card", "line_of_credit"]);

export const RELATIONSHIP_WORDS = "Existing relationship";
export const ALREADY_HAVE_WORDS = "You already have this";
export const INVENTORY_SOURCE = Object.freeze({
  label: "Your accounts",
  ref: "src/finance/tradeline-inventory.mjs (credit reports, Plaid, added by you)"
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());
const list = (v) => (Array.isArray(v) ? v : []);
function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
}
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function safeObject(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string") {
    try { const o = JSON.parse(v); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
  }
  return null;
}
/** "2021-03-15" or "2021-03" → "2021-03". Anything else → null. */
export function monthOf(v) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?/.exec(String(v ?? "").trim());
  return m ? `${m[1]}-${m[2]}` : null;
}
/** Bureau dollars ("$2,000", 2000) → integer cents. Unreadable or below zero → null. */
function reportCents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
/** The same loose compare the business credit lines use (credit-history.mjs). */
export function companyKey(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Bank names — a match must be certain
 * ------------------------------------------------------------------ */

/**
 * nameKey(name) → "jpmcb card services" | null
 * Lower case, a parenthetical dropped ("PNC Bank (0% BT only)"), "&" as "and",
 * every other mark a space, "N.A." as "na".
 */
export function nameKey(name) {
  if (name === null || name === undefined) return null;
  let s = String(name).toLowerCase();
  s = s.replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\bn a\b/g, "na").replace(/\s+/g, " ").trim();
  return s || null;
}

/* The banks on Giovanni's list that can be named with certainty.
     exact     whole names, as bureaus, Plaid and people write them
     prefixes  a distinctive start: "chase ink" is a Chase account
     book      names trusted only when the BANK BOOK uses them. Giovanni's
               "Citizens Bank" row is Citizens; a report line that just says
               "CITIZENS BANK" could be any of several banks, so it is not.
   A name that is not here never matches. Add a bank here, with its names,
   when Giovanni's list gains one. */
export const KNOWN_BANKS = Object.freeze([
  { key: "chase", name: "Chase",
    exact: ["chase", "chase bank", "chase bank usa", "chase bank usa na", "chase bank na", "chase card", "chase card services",
      "chase card svcs", "chase auto", "chase auto finance", "chase home finance", "chase mortgage", "jpmcb", "jpmcb card",
      "jpmcb card services", "jpmcb card svcs", "jpmcb auto", "jpmcb auto finance", "jpmcb home", "jpmorgan chase",
      "jpmorgan chase bank", "jpmorgan chase bank na", "jp morgan chase", "jp morgan chase bank", "jp morgan chase bank na"],
    prefixes: ["chase", "jpmcb", "jpmorgan chase", "jp morgan chase"], book: [] },
  { key: "american_express", name: "American Express",
    exact: ["american express", "amex", "american express national bank", "american express centurion bank",
      "american express bank", "american express bank fsb"],
    prefixes: ["american express", "amex"], book: [] },
  { key: "bank_of_america", name: "Bank of America",
    exact: ["bank of america", "bank of america na", "bk of amer", "bk of america", "bankamerica", "bofa",
      "bank of america card services"],
    prefixes: ["bank of america", "bk of amer", "bofa"], book: [] },
  { key: "wells_fargo", name: "Wells Fargo",
    exact: ["wells fargo", "wells fargo bank", "wells fargo bank na", "wells fargo card ser", "wells fargo card services",
      "wells fargo card svcs", "wells fargo dealer services", "wells fargo dealer svc", "wells fargo home mortgage",
      "wells fargo auto", "wfbna", "wfbna card", "wf crd svc", "wfds"],
    prefixes: ["wells fargo"], book: [] },
  { key: "pnc", name: "PNC Bank",
    exact: ["pnc", "pnc bank", "pnc bank na", "pnc card services", "pnc mortgage"],
    prefixes: ["pnc"], book: [] },
  { key: "truist", name: "Truist",
    exact: ["truist", "truist bank", "truist financial", "suntrust", "suntrust bank", "suntrust banks", "bb and t",
      "branch banking and trust"],
    prefixes: ["truist", "suntrust"], book: [] },
  { key: "navy_federal", name: "Navy Federal Credit Union",
    exact: ["navy federal credit union", "navy federal", "navy fcu", "navy federal cr union", "navy federal cu", "nfcu"],
    prefixes: ["navy federal", "navy fcu"], book: [] },
  { key: "citizens", name: "Citizens Bank",
    exact: ["citizens bank na", "citizens one", "citizens one auto", "citizens financial group"],
    prefixes: ["citizens one"], book: ["citizens bank"] },
  { key: "elan", name: "Elan Financial",
    exact: ["elan financial", "elan financial service", "elan financial services"],
    prefixes: ["elan financial"], book: ["elan"] },
  { key: "fnbo", name: "First National Bank of Omaha",
    exact: ["first national bank of omaha", "fnb omaha", "fnbo"],
    prefixes: ["first national bank of omaha", "fnbo"], book: ["fnbo evergreen"] },
  { key: "flagstar", name: "Flagstar Bank",
    exact: ["flagstar", "flagstar bank", "flagstar bank fsb", "flagstar bank na", "flagstar bank national association"],
    prefixes: ["flagstar"], book: [] }
]);

const BANK_BY_KEY = new Map(KNOWN_BANKS.map((b) => [b.key, b]));
/* Longest prefix first, so "jp morgan chase" is tried before a shorter start. */
const PREFIXES = KNOWN_BANKS.flatMap((b) => b.prefixes.map((p) => ({ p, b }))).sort((x, y) => y.p.length - x.p.length);

/**
 * bankIdentity(name, { book }) → { key, name } | null
 * Exact names first, then a distinctive prefix followed by more words. `book`
 * also trusts the bank book's own names (see KNOWN_BANKS.book).
 */
export function bankIdentity(name, { book = false } = {}) {
  const k = nameKey(name);
  if (!k) return null;
  for (const b of KNOWN_BANKS) {
    if (b.exact.includes(k) || (book && b.book.includes(k))) return { key: b.key, name: b.name };
  }
  for (const { p, b } of PREFIXES) {
    if (k.startsWith(`${p} `)) return { key: b.key, name: b.name };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Product names — "You already have this"
 * ------------------------------------------------------------------ */

const GENERIC_WORDS = new Set(["card", "cards", "credit", "the", "a", "an", "of", "and", "for", "from", "by", "with",
  "account", "visa", "mastercard", "signature", "world", "elite", "program", "bank", "financial", "services",
  "service", "na", "inc", "co"]);
const SCOPE_WORDS = new Set(["business", "personal"]);

/** The words of a product name that say WHICH product it is, without the bank's own name. */
export function productTokens(name, bankKey = null) {
  const k = nameKey(name);
  if (!k) return new Set();
  const bankWords = new Set();
  const b = bankKey ? BANK_BY_KEY.get(bankKey) : null;
  if (b) for (const n of [b.name, ...b.prefixes, ...b.exact]) for (const w of nameKey(n).split(" ")) bankWords.add(w);
  const out = new Set();
  for (let w of k.split(" ")) {
    if (w === "biz") w = "business";
    if (!w || GENERIC_WORDS.has(w) || bankWords.has(w)) continue;
    out.add(w);
  }
  return out;
}

/** A product name worth matching: at least one word beyond "business" or "personal". */
export function isNamedProduct(name, bankKey = null) {
  const t = productTokens(name, bankKey);
  for (const w of t) if (!SCOPE_WORDS.has(w)) return true;
  return false;
}

/** "Business Ink Cash / Ink Unlimited / Ink Preferred" → three names. */
export function splitProducts(v) {
  return String(v ?? "").split("/").map(text).filter(Boolean);
}

/* E's productWords() bases ("Business credit card (apply online)"): a card line
   whose `card` is one of these names no product. */
const GENERIC_BASES = new Set([...LENDER_TABLES.map((t) => productWords({ lender_table: t })), "Account"]);

/** The named products a bank-plan line offers, in its own order. */
export function lineProducts(card, others = [], bankKey = null) {
  const out = [];
  for (const raw of [card, ...list(others)]) {
    if (!raw || GENERIC_BASES.has(String(raw).trim())) continue;
    for (const p of splitProducts(raw)) if (isNamedProduct(p, bankKey) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** recommended_banks[].products ("Business credit card (apply in a branch): Ink Cash / Ink Unlimited") → named products. */
export function namedFromProductWords(products = [], bankKey = null) {
  const out = [];
  for (const s of list(products)) {
    const str = String(s ?? "");
    const at = str.indexOf(": ");
    if (at < 0) continue;
    for (const p of splitProducts(str.slice(at + 2))) if (isNamedProduct(p, bankKey) && !out.includes(p)) out.push(p);
  }
  return out;
}

function familyOfTable(table) {
  if (["PersonalCC", "OnlineBizCC", "InBranchBizCC"].includes(table)) return "card";
  if (["BizLOC_Stated", "BizLOC_Documented", "PersonalLOC"].includes(table)) return "line";
  if (table === "PersonalLoans") return "loan";
  return null;
}

/**
 * holdsProduct(bank, product, { family, scope }) → true when an open account the
 * client holds at that bank IS this product: every distinctive word of the
 * product's name is in the account's own name (a business account also counts
 * the word "business", a personal one "personal"), it is the same kind of
 * account, and it is on the same side: a business card never holds a personal
 * product ("Blue Business Cash" is not "Blue Cash"), nor the other way round.
 * An account's side is its group, else "business" when its own name says so.
 */
export function holdsProduct(bank, product, { family = "card", scope = null } = {}) {
  if (!bank || !isNamedProduct(product, bank.key)) return false;
  const want = productTokens(product, bank.key);
  return list(bank.accounts).some((a) => {
    if (family && a.type !== family) return false;
    const side = a.scope || (a.tokens.has("business") ? "business" : null);
    if (scope && side && side !== scope) return false;
    for (const w of want) if (!a.tokens.has(w)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Reading each source (pure)
 * ------------------------------------------------------------------ */

function reportType(raw, kind) {
  const acct = String(raw.accountType ?? raw.account_type ?? "");
  const loan = String(raw.loanType ?? "");
  if (/mortgage/i.test(acct) || /mortgage|realestate|real estate/i.test(loan)) return "mortgage";
  if (/homeequity|home equity|heloc|lineofcredit|line of credit|creditline/i.test(loan) || kind === "loc") return "line";
  if (/revolving|^open$/i.test(acct) || /creditcard|credit card|charge/i.test(loan)) return "card";
  if (/install/i.test(acct) || kind === "installment") return "loan";
  return acct || loan ? "other" : "card";
}

const CLOSED_WORDS = /closed|paid|transfer|sold|refinanc|charge.?off|repossess|foreclos|bankrupt/i;

/** "XXXXXXXXXXXX1234" → "1234". An identifier that does not END in four digits ("426684XXXXXX") → null. */
export function trailingLast4(v) {
  const m = /(\d{4})$/.exec(String(v ?? "").trim());
  return m ? m[1] : null;
}

function lineBureau(raw) {
  const code = bureauOf(raw.sourceType) || bureauOf(raw.bureau) || null;
  return code || "unknown";
}

/**
 * reportItems(crsRows) → one item per line on the client's current personal
 * reports. Per bureau, the newest pull that carries that bureau's lines.
 * Collections are left out: a collection is not an account the client holds.
 */
export function reportItems(crsRows = []) {
  const pulls = [...list(crsRows)].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const taken = new Set();
  const out = [];
  for (const pull of pulls) {
    const result = safeObject(pull && pull.result);
    if (!result) continue;
    const byBureau = new Map();
    for (const raw of extractTradelineRecords(result)) {
      if (!raw || typeof raw !== "object") continue;
      const b = lineBureau(raw);
      if (!byBureau.has(b)) byBureau.set(b, []);
      byBureau.get(b).push(raw);
    }
    for (const [bureau, lines] of byBureau) {
      if (taken.has(bureau)) continue;
      taken.add(bureau);
      for (const raw of lines) {
        if (/collection/i.test(String(raw.loanType ?? "")) || /collection/i.test(String(raw.accountType ?? ""))) continue;
        const n = normalizeTradeline(raw, { source: "crs", sourceRef: pull.id ?? null, asOf: pull.created_at ?? null });
        if (!n) continue;
        const status = String(raw.accountStatusType ?? raw.accountStatus ?? "");
        const rating = String(raw.currentRatingType ?? "");
        const closed = CLOSED_WORDS.test(status) || /charge.?off|collection|repossess|foreclos|bankrupt/i.test(rating) || !!text(raw.accountClosedDate);
        out.push({
          source: "report",
          ref: `report:${pull.id ?? "pull"}:${n.account_ref ?? out.length}`,
          creditor: n.lender,
          bank: bankIdentity(n.lender),
          type: reportType(raw, n.kind),
          names: [],
          limit_cents: n.credit_limit_cents,
          opened: monthOf(n.opened_on),
          opened_day: n.opened_on,
          /* The bureau's own masked number, not any other id the record carries. */
          last4: trailingLast4(raw.accountIdentifier ?? raw.accountNumber ?? raw.account_number),
          account_ref: n.account_ref,
          status: closed ? "closed" : "open",
          reported_on: text(raw.accountReportedDate),
          authorized_user: /authori[sz]ed/i.test(String(raw.accountOwnershipType ?? "")),
          bureaus: bureau === "unknown" ? [] : [bureau],
          group: "personal",
          group_set: false
        });
      }
    }
  }
  return out;
}

/** The Experian Business report saved for one business, newest pull first (credit-history.mjs's match). */
function businessReportFor(pulls, biz) {
  const wantName = companyKey(biz && biz.name);
  if (!wantName) return null;
  const entity = safeObject(biz && biz.entity_data) || {};
  const wantState = companyKey(entity.state);
  for (const pull of pulls) {
    const result = safeObject(pull && pull.result);
    const rows = result && Array.isArray(result.businessReports) ? result.businessReports : [];
    const row = rows.find((b) => {
      if (!b || companyKey(b.name) !== wantName) return false;
      const st = companyKey(b.state);
      return !wantState || !st || st === wantState;
    });
    if (row) return { report: safeObject(row.report) || {}, pullId: pull.id ?? null };
  }
  return null;
}

/**
 * businessReportItems(crsRows, businesses, groupOf) → the lines on each saved
 * business's newest Experian Business report. The keys are the ones the
 * UnderwriteIQ engine reads (data.tradePaymentExperiences || data.tradeLines;
 * businessName, accountType, accountStatus, creditLimitAmount, dateOpened).
 * A line with no lender name is counted, not shown: it cannot be matched.
 */
export function businessReportItems(crsRows = [], businesses = [], groupOf = () => null) {
  const pulls = [...list(crsRows)].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const out = [];
  let withoutName = 0;
  for (const biz of list(businesses)) {
    const found = businessReportFor(pulls, biz);
    if (!found) continue;
    const data = safeObject(found.report.data) || found.report;
    const trades = Array.isArray(data.tradePaymentExperiences) ? data.tradePaymentExperiences
      : (Array.isArray(data.tradeLines) ? data.tradeLines : []);
    const group = groupOf(biz);
    trades.forEach((t, i) => {
      if (!t || typeof t !== "object") return;
      const name = text(t.businessName);
      if (!name) { withoutName += 1; return; }
      const kind = String(t.accountType ?? "");
      out.push({
        source: "report",
        ref: `bizreport:${found.pullId ?? "pull"}:${biz.id ?? companyKey(biz.name)}:${i}`,
        creditor: name,
        bank: bankIdentity(name),
        type: /card/i.test(kind) ? "card" : (/line/i.test(kind) ? "line" : (/loan|lease|install/i.test(kind) ? "loan" : "other")),
        names: [],
        limit_cents: reportCents(t.creditLimitAmount),
        opened: monthOf(t.dateOpened),
        opened_day: null,
        last4: null,
        account_ref: null,
        status: /closed/i.test(String(t.accountStatus ?? "")) ? "closed" : "open",
        authorized_user: false,
        bureaus: ["EXB"],
        business_report: true,
        group: group || "unsorted",
        group_set: !!group
      });
    });
  }
  return { items: out, withoutName };
}

function plaidType(type, subtype) {
  const t = String(type ?? "").toLowerCase();
  const s = String(subtype ?? "").toLowerCase();
  if (t === "credit") return /line of credit/.test(s) ? "line" : "card";
  if (t === "loan") {
    if (/line of credit|home equity|heloc/.test(s)) return "line";
    if (/mortgage/.test(s)) return "mortgage";
    return "loan";
  }
  if (t === "depository") {
    if (/checking/.test(s)) return "checking";
    if (/savings|money market|\bcd\b|hsa/.test(s)) return "savings";
    return "deposit";
  }
  return null;
}

/**
 * accountItems(rows, groupOfAccount) → bank_accounts rows as items. A row on a
 * Plaid login is "plaid" and its bank is Plaid's institution name; a row with
 * no login was typed in ("you" when the client typed it, else "fundhub").
 * Investment and unknown account types are not bank relationships here.
 */
export function accountItems(rows = [], groupOfAccount = () => "unsorted") {
  const out = [];
  for (const r of list(rows)) {
    const type = plaidType(r.account_type, r.account_subtype);
    if (!type) continue;
    const plaid = !!r.plaid_item_id;
    const institution = plaid ? plaidBankName(r.institution_name) : null;
    const enteredBy = text(r.entered_by);
    const appKind = text(r.app_kind);
    const names = [text(r.name), text(r.official_name)].filter(Boolean);
    const g = groupOfAccount(r);
    out.push({
      source: plaid ? "plaid" : (enteredBy === "client" || appKind === "self" ? "you" : "fundhub"),
      ref: `${plaid ? "plaid" : "hand"}:${r.id}`,
      creditor: institution || text(r.name),
      institution,
      institution_id: plaid ? text(r.plaid_institution_id) : null,
      bank: plaid ? (bankIdentity(institution) || bankIdentity(r.name)) : bankIdentity(r.name),
      type,
      names,
      limit_cents: type === "card" || type === "line" ? cents(r.credit_limit_cents) : null,
      opened: null,
      opened_day: null,
      last4: /^\d{4}$/.test(String(r.mask ?? "")) ? String(r.mask) : null,
      account_ref: null,
      status: r.closed_at ? "closed" : "open",
      authorized_user: false,
      bureaus: [],
      group: g,
      group_set: g !== "unsorted" && g !== null
    });
  }
  return out;
}

/** tradelines rows typed on the staff card-stack screen (source 'manual'). */
export function staffLineItems(rows = [], groupOfEntity = () => null) {
  return list(rows).map((r) => {
    const g = r.entity_id ? groupOfEntity(r.entity_id) : null;
    const kind = String(r.kind ?? "");
    return {
      source: "fundhub",
      ref: `staff:${r.id}`,
      creditor: text(r.lender),
      bank: bankIdentity(r.lender),
      type: kind === "loc" ? "line" : (kind === "installment" ? "loan" : "card"),
      names: [text(r.lender)].filter(Boolean),
      limit_cents: cents(r.credit_limit_cents),
      opened: monthOf(r.opened_on instanceof Date ? r.opened_on.toISOString() : r.opened_on),
      opened_day: null,
      last4: /^\d{4}$/.test(String(r.last4 ?? "")) ? String(r.last4) : null,
      account_ref: null,
      status: r.closed_at ? "closed" : "open",
      authorized_user: false,
      bureaus: [],
      group: g || "personal",
      group_set: !!g
    };
  });
}

/** finance_tradeline_entries rows (migration 590) as items. */
export function entryItems(rows = [], groupOfEntry = () => "personal") {
  return list(rows).map((r) => {
    const t = ENTRY_TYPES[r.account_type] || { type: "other" };
    const creditor = text(r.creditor);
    const product = text(r.product);
    const g = groupOfEntry(r);
    return {
      source: r.entered_by === "staff" ? "fundhub" : "you",
      ref: `entry:${r.id}`,
      entry_id: r.id,
      creditor,
      product,
      bank: bankIdentity(creditor) || (product ? bankIdentity(`${creditor} ${product}`) : null),
      type: t.type,
      names: [product, creditor && product ? `${creditor} ${product}` : null].filter(Boolean),
      limit_cents: cents(r.limit_cents),
      opened: monthOf(r.opened_month),
      opened_day: null,
      last4: null,
      account_ref: null,
      status: "open",
      authorized_user: false,
      bureaus: [],
      group: g,
      group_set: true
    };
  });
}

/* ------------------------------------------------------------------ *
 * Groups: Personal, each business, Not sorted yet
 * ------------------------------------------------------------------ */

/**
 * buildGroups({ entities, businesses }) → { groups, groupOfEntity, groupOfBusiness, groupOfAccount, groupOfEntry }
 *
 * Personal is the client's own file. With one personal container, it IS
 * Personal; with more (each person is a container), each extra one is its own
 * group. Each business container is a group; a saved business with no container
 * is a group too (by name), unless a container already carries the same name.
 */
export function buildGroups({ entities = [], businesses = [] } = {}) {
  const ents = list(entities).filter((e) => e && e.id);
  const personal = ents.filter((e) => e.kind === "personal");
  const bizEnts = ents.filter((e) => e.kind === "business");
  const groups = [{ key: "personal", kind: "personal", name: "Personal", container_id: null, archived: false }];
  const byEntity = new Map();
  if (personal.length === 1) byEntity.set(String(personal[0].id), "personal");
  else {
    for (const p of personal) {
      const key = `entity:${p.id}`;
      byEntity.set(String(p.id), key);
      groups.push({ key, kind: "personal", name: text(p.name) || "Personal", container_id: p.id, archived: !!p.archived_at });
    }
  }
  const containerNames = new Map();
  for (const c of bizEnts) {
    const key = `entity:${c.id}`;
    byEntity.set(String(c.id), key);
    containerNames.set(companyKey(c.name), key);
    groups.push({ key, kind: "business", name: text(c.name) || "Business", container_id: c.id, archived: !!c.archived_at });
  }
  const byBusinessName = new Map();
  for (const b of list(businesses)) {
    const entity = safeObject(b && b.entity_data) || {};
    const linked = entity.entity_id && byEntity.has(String(entity.entity_id)) ? byEntity.get(String(entity.entity_id)) : null;
    const nk = companyKey(b && b.name);
    if (!nk) continue;
    if (linked) { if (!byBusinessName.has(nk)) byBusinessName.set(nk, linked); continue; }
    if (containerNames.has(nk)) { byBusinessName.set(nk, containerNames.get(nk)); continue; }
    if (byBusinessName.has(nk)) continue;
    const key = `business:${nk}`;
    byBusinessName.set(nk, key);
    groups.push({ key, kind: "business", name: text(b.name), container_id: null, archived: false });
  }

  const groupOfEntity = (id) => (id && byEntity.has(String(id)) ? byEntity.get(String(id)) : null);
  const groupOfBusiness = (b) => {
    const entity = safeObject(b && b.entity_data) || {};
    return groupOfEntity(entity.entity_id) || byBusinessName.get(companyKey(b && b.name)) || null;
  };
  const groupOfAccount = (r) => {
    const g = groupOfEntity(r.entity_id);
    if (g) return g;
    return r.entity_kind === "personal" ? "personal" : "unsorted";
  };
  const groupOfEntry = (r) => {
    if (r.scope !== "business") return "personal";
    if (r.entity_id) return groupOfEntity(r.entity_id) || "unsorted";
    const nk = companyKey(r.business_name);
    if (byBusinessName.has(nk)) return byBusinessName.get(nk);
    /* The saved business was renamed or removed: the entry keeps its own group
       under the name it was saved with, so it is never lost. */
    const key = `business:${nk}`;
    if (!groups.some((g) => g.key === key)) groups.push({ key, kind: "business", name: text(r.business_name), container_id: null, archived: false });
    byBusinessName.set(nk, key);
    return key;
  };
  return { groups, groupOfEntity, groupOfBusiness, groupOfAccount, groupOfEntry };
}

/* ------------------------------------------------------------------ *
 * One row per real account
 * ------------------------------------------------------------------ */

function bankKeyOf(item) {
  return item.bank ? `bank:${item.bank.key}` : (nameKey(item.creditor) ? `name:${nameKey(item.creditor)}` : null);
}

/* Pass 1: the same report line on three bureaus. Only with an open date (or the
   vendor's own account id): the same bank, kind, day opened and limit. */
function mergeReportLines(items) {
  const out = [];
  const byKey = new Map();
  for (const it of items) {
    const bk = bankKeyOf(it);
    const key = it.opened_day
      ? `${bk}|${it.type}|${it.opened_day}|${it.limit_cents ?? ""}|${it.group}`
      : (it.account_ref ? `ref:${bk}|${it.account_ref}` : null);
    const seen = key ? byKey.get(key) : null;
    if (!seen) { const copy = { ...it, sources: ["report"], refs: [it.ref], names: [...it.names] }; out.push(copy); if (key) byKey.set(key, copy); continue; }
    for (const b of it.bureaus) if (!seen.bureaus.includes(b)) seen.bureaus.push(b);
    seen.refs.push(it.ref);
    /* The newest-reported line says whether it is still open. */
    if (String(it.reported_on || "") > String(seen.reported_on || "")) { seen.status = it.status; seen.reported_on = it.reported_on; }
    if (seen.last4 === null && it.last4) seen.last4 = it.last4;
    seen.authorized_user = seen.authorized_user && it.authorized_user;
  }
  return out;
}

/* The words that name WHICH card an account is (its own names, without the
   bank's name or the words business/personal). */
function cardWords(item) {
  const key = item.bank ? item.bank.key : null;
  const out = new Set();
  for (const n of [item.product, ...list(item.names)]) for (const w of productTokens(n, key)) if (!SCOPE_WORDS.has(w)) out.add(w);
  return out;
}
function subsetOf(a, b) {
  for (const w of a) if (!b.has(w)) return false;
  return true;
}
/* "Ink Business Cash" and "Ink Unlimited" are two cards; "Ink" and "Ink
   Business Cash" could be one. */
function namesDisagree(a, b) {
  const x = cardWords(a);
  const y = cardWords(b);
  return x.size > 0 && y.size > 0 && !subsetOf(x, y) && !subsetOf(y, x);
}
function conflict(a, b) {
  return (a.last4 && b.last4 && a.last4 !== b.last4) ||
    (a.limit_cents != null && b.limit_cents != null && a.limit_cents !== b.limit_cents) ||
    (a.opened && b.opened && a.opened !== b.opened) ||
    namesDisagree(a, b);
}
function strong(a, b) {
  return !!(a.last4 && b.last4 && a.last4 === b.last4) ||
    (a.limit_cents != null && b.limit_cents != null && a.limit_cents > 0 && a.limit_cents === b.limit_cents);
}
function groupsMeet(a, b) {
  return a.group === b.group || a.group === "unsorted" || b.group === "unsorted" ||
    (a.sources.includes("report") && !a.group_set) || (b.source === "report" && !b.group_set);
}

function absorb(into, it) {
  if (!into.sources.includes(it.source)) into.sources.push(it.source);
  into.sources.sort((x, y) => SOURCE_ORDER.indexOf(x) - SOURCE_ORDER.indexOf(y));
  into.refs.push(it.ref);
  for (const n of it.names) if (!into.names.includes(n)) into.names.push(n);
  if (!into.product && it.product) into.product = it.product;
  if (!into.bank && it.bank) into.bank = it.bank;
  if (!into.institution && it.institution) { into.institution = it.institution; into.institution_id = it.institution_id; }
  if (it.source === "plaid") {
    if (it.limit_cents != null) into.limit_cents = it.limit_cents;
    into.status = it.status;
  } else if (into.limit_cents == null && it.limit_cents != null) into.limit_cents = it.limit_cents;
  if (!into.opened && it.opened) into.opened = it.opened;
  if (!into.last4 && it.last4) into.last4 = it.last4;
  if (it.entry_id && !into.entry_id) into.entry_id = it.entry_id;
  /* Where the client (or staff) sorted it wins over the report's default. */
  if (it.group_set && (!into.group_set || into.group === "unsorted")) { into.group = it.group; into.group_set = true; }
  else if (into.group === "unsorted" && it.group !== "unsorted") into.group = it.group;
}

/**
 * mergeItems(items) → one row per real account. Report lines first, then each
 * other source in turn. An incoming row joins an earlier one only when:
 *   - the same bank (or, with no known bank, the same name) and the same kind;
 *   - nothing disagrees (last 4, limit, month opened);
 *   - and the same last 4, or the same limit with exactly one row that could
 *     be it (and no second incoming row with that limit) — or, for a typed row
 *     with no limit or last 4, exactly one row of that bank and kind in the
 *     same group.
 * Never two rows from the same source.
 */
export function mergeItems(items = []) {
  const all = list(items);
  const out = mergeReportLines(all.filter((i) => i.source === "report"));
  for (const source of ["plaid", "fundhub", "you"]) {
    const batch = all.filter((i) => i.source === source);
    for (const it of batch) {
      const bk = bankKeyOf(it);
      const fits = bk ? out.filter((x) => !x.sources.includes(source) && bankKeyOf(x) === bk && x.type === it.type && groupsMeet(x, it) && !conflict(x, it)) : [];
      const strongs = fits.filter((x) => strong(x, it));
      const twin = batch.some((o) => o !== it && bankKeyOf(o) === bk && o.type === it.type && o.limit_cents != null && o.limit_cents === it.limit_cents);
      let target = null;
      if (strongs.length === 1 && (strongs[0].last4 && it.last4 && strongs[0].last4 === it.last4 || !twin)) target = strongs[0];
      else if (!strongs.length && it.limit_cents == null && !it.last4) {
        const same = fits.filter((x) => x.group === it.group && it.group !== "unsorted");
        if (same.length === 1) target = same[0];
      }
      if (target) absorb(target, it);
      else out.push({ ...it, sources: [it.source], refs: [it.ref], names: [...it.names] });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The inventory (pure)
 * ------------------------------------------------------------------ */

/* Bureaus write names in capitals ("CAPITAL ONE"). Screens do not show
   all-caps body text (UI-STANDARDS §3), so a name with no small letters is
   shown in title case; the raw name stays on the row as `creditor`. */
const KEEP_CAPS = new Set(["USA", "NA", "FCU", "CU", "LLC", "FSB", "NB"]);
const SMALL_WORDS = new Set(["of", "and", "the", "for"]);
export function readableName(v) {
  const s = text(v);
  if (!s || /[a-z]/.test(s)) return s;
  return s.split(" ").map((w, i) => {
    if (KEEP_CAPS.has(w)) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(lower)) return lower;
    return lower.replace(/(^|[/&-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }).join(" ");
}

function displayName(it) {
  return it.product || it.names[0] || (it.bank && it.bank.name) || readableName(it.creditor) || "Account";
}

/** Giovanni's list by bank: { key → { key, name, lenderIds, logoPath, rows } } — book names trusted. */
export function bookBanks(lenders = []) {
  const out = new Map();
  for (const l of list(lenders)) {
    if (!l || !l.name) continue;
    const id = bankIdentity(l.name, { book: true });
    if (!id) continue;
    if (!out.has(id.key)) out.set(id.key, { key: id.key, name: id.name, lenderIds: [], rows: [] });
    const b = out.get(id.key);
    if (l.id && !b.lenderIds.includes(l.id)) b.lenderIds.push(l.id);
    b.rows.push(l);
  }
  return out;
}

/**
 * buildInventory({ entities, businesses, crsRows, accounts, staffLines, entries, lenders })
 *   → { groups, items, relationships, counts }
 * Pure: every row must already be scoped to one org and one client.
 */
export function buildInventory({ entities = [], businesses = [], crsRows = [], accounts = [], staffLines = [], entries = [], lenders = [] } = {}) {
  const g = buildGroups({ entities, businesses });
  const biz = businessReportItems(crsRows, businesses, g.groupOfBusiness);
  const raw = [
    ...reportItems(crsRows),
    ...biz.items,
    ...accountItems(accounts, g.groupOfAccount),
    ...staffLineItems(staffLines, g.groupOfEntity),
    ...entryItems(entries, g.groupOfEntry)
  ];
  const book = bookBanks(lenders);
  const merged = mergeItems(raw).map((it) => {
    const inBook = !!(it.bank && book.has(it.bank.key));
    return { ...it, name: displayName(it), in_book: inBook };
  });

  const counts = { open: 0, closed: 0, report: 0, plaid: 0, you: 0, fundhub: 0, business_report_lines_without_name: biz.withoutName };
  for (const it of merged) {
    counts[it.status === "closed" ? "closed" : "open"] += 1;
    for (const s of it.sources) counts[s] += 1;
  }

  /* Existing relationships: open, not an authorized-user line, at a bank on the list. */
  const rels = new Map();
  for (const it of merged) {
    if (it.status !== "open" || it.authorized_user || !it.in_book) continue;
    const kind = (g.groups.find((x) => x.key === it.group) || {}).kind || "unsorted";
    if (!rels.has(it.bank.key)) {
      const b = book.get(it.bank.key);
      rels.set(it.bank.key, { key: it.bank.key, bank: b.name, lender_ids: [...b.lenderIds], accounts: 0, types: [], scopes: [], items: [], institution_id: null });
    }
    const r = rels.get(it.bank.key);
    r.accounts += 1;
    if (!r.types.includes(it.type)) r.types.push(it.type);
    if (kind !== "unsorted" && !r.scopes.includes(kind)) r.scopes.push(kind);
    r.items.push(it.refs[0]);
    if (!r.institution_id && it.institution_id) r.institution_id = it.institution_id;
  }
  const relationships = [...rels.values()].sort((a, b) => a.bank.localeCompare(b.bank));
  for (const it of merged) it.existing_relationship = rels.has(it.bank ? it.bank.key : "");

  const groups = g.groups.map((grp) => {
    const mine = merged.filter((it) => it.group === grp.key);
    return { ...grp, items: mine.filter((it) => it.status === "open"), closed: mine.filter((it) => it.status === "closed").length };
  });
  const unsorted = merged.filter((it) => it.group === "unsorted");
  if (unsorted.length) {
    groups.push({ key: "unsorted", kind: "unsorted", name: "Not sorted yet", container_id: null, archived: false,
      items: unsorted.filter((it) => it.status === "open"), closed: unsorted.filter((it) => it.status === "closed").length });
  }
  /* An archived container shows only while it still holds something. */
  const shown = groups.filter((grp) => !grp.archived || grp.items.length || grp.closed);
  return { groups: shown, items: merged, relationships, counts, book };
}

/* ------------------------------------------------------------------ *
 * What the bank plan reads: the banks the client holds, and what at each
 * ------------------------------------------------------------------ */

/**
 * holdingsOf(inventory) → { banks: Map(key → { key, name, accounts: [{ type, scope, tokens }], deposit: { personal, business } }) }
 * Open accounts only, never an authorized-user line.
 */
export function holdingsOf(inventory) {
  const banks = new Map();
  if (!inventory) return { banks };
  const kindOf = new Map(list(inventory.groups).map((g) => [g.key, g.kind]));
  for (const it of list(inventory.items)) {
    if (it.status !== "open" || it.authorized_user || !it.bank) continue;
    const scope = kindOf.get(it.group) === "business" ? "business" : (kindOf.get(it.group) === "personal" ? "personal" : null);
    if (!banks.has(it.bank.key)) banks.set(it.bank.key, { key: it.bank.key, name: it.bank.name, accounts: [], deposit: { personal: false, business: false } });
    const b = banks.get(it.bank.key);
    const tokens = new Set();
    for (const n of [it.product, ...it.names]) for (const w of productTokens(n, it.bank.key)) tokens.add(w);
    if (scope) tokens.add(scope);
    b.accounts.push({ type: it.type, scope, tokens });
    if (["checking", "savings", "deposit"].includes(it.type) && scope) b.deposit[scope] = true;
  }
  return { banks };
}

function relationshipTag(bank) {
  const types = [...new Set(bank.accounts.map((a) => a.type))];
  return { text: RELATIONSHIP_WORDS, accounts: bank.accounts.length, types, source: INVENTORY_SOURCE };
}

/** Existing relationships first; otherwise the order stays exactly as it was. */
export function existingFirst(rows = []) {
  const withRel = list(rows).filter((r) => r && r.existing_relationship);
  const rest = list(rows).filter((r) => !(r && r.existing_relationship));
  return [...withRel, ...rest];
}

function bankOfName(name, holdings) {
  const id = bankIdentity(name, { book: true });
  return id && holdings && holdings.banks.get(id.key) ? holdings.banks.get(id.key) : null;
}

/** One card-stacking line, tagged; with no-overlap applied to its products. */
export function tagCardLine(line, holdings) {
  const bank = bankOfName(line.issuer, holdings);
  const id = bankIdentity(line.issuer, { book: true });
  const products = lineProducts(line.card, line.other_cards, id ? id.key : null);
  const scope = line.kind === "business" || line.kind === "personal" ? line.kind : null;
  const held = bank ? products.filter((p) => holdsProduct(bank, p, { family: "card", scope })) : [];
  const remaining = products.filter((p) => !held.includes(p));
  const out = {
    ...line,
    existing_relationship: bank ? relationshipTag(bank) : null,
    has_account: !!(bank && scope && bank.deposit[scope]),
    you_have: held,
    next_product: held.length && remaining.length ? remaining[0] : null,
    already_have: held.length > 0 && remaining.length === 0
  };
  if (held.length && remaining.length) {
    out.card = remaining[0];
    out.other_cards = remaining.slice(1);
  }
  return out;
}

/**
 * applyHoldingsToBankPlan(payload, holdings) → the GET /api/money/banks payload
 * with every bank, card line and deposit-plan row tagged, existing
 * relationships ranked first, and no product the client already holds left in
 * the apply order. The deposit plan is rebuilt with the bank path's own
 * functions (src/waypoints/blueprint-path.mjs) from the ranked banks.
 */
export function applyHoldingsToBankPlan(payload, holdings) {
  if (!payload || typeof payload !== "object") return payload;
  const out = { ...payload };
  const hb = holdings && holdings.banks instanceof Map ? holdings : { banks: new Map() };

  if (Array.isArray(payload.recommended_banks)) {
    out.recommended_banks = existingFirst(payload.recommended_banks.map((b) => {
      const bank = bankOfName(b.name, hb);
      const id = bankIdentity(b.name, { book: true });
      const family = familyOfTable(b.lender_table) || "card";
      const scope = isBusinessLenderTable(b.lender_table) ? "business" : (isPersonalLenderTable(b.lender_table) ? "personal" : null);
      const products = namedFromProductWords(b.products, id ? id.key : null);
      const held = bank ? products.filter((p) => holdsProduct(bank, p, { family, scope })) : [];
      const remaining = products.filter((p) => !held.includes(p));
      return {
        ...b,
        existing_relationship: bank ? relationshipTag(bank) : null,
        has_account: !!(bank && scope && bank.deposit[scope]),
        you_have: held,
        next_product: held.length ? (remaining[0] || null) : null
      };
    }));
  }

  if (payload.card_stacking && Array.isArray(payload.card_stacking.items)) {
    const tagged = payload.card_stacking.items.map((it) => tagCardLine(it, hb));
    const keep = tagged.filter((it) => !it.already_have);
    const have = tagged.filter((it) => it.already_have);
    const ordered = [
      ...existingFirst(keep.filter((it) => it.kind === "personal")),
      ...existingFirst(keep.filter((it) => it.kind === "business")),
      ...keep.filter((it) => it.kind !== "personal" && it.kind !== "business")
    ].map((it, i) => ({ ...it, order: i + 1 }));
    out.card_stacking = {
      ...payload.card_stacking,
      items: ordered,
      shown: ordered.length,
      already_have: have.map((it) => ({ issuer: it.issuer, lender_id: it.lender_id ?? null, kind: it.kind, products: it.you_have,
        text: ALREADY_HAVE_WORDS, existing_relationship: it.existing_relationship, logo: it.logo ?? null, logo_source: it.logo_source ?? null }))
    };
  }

  if (Array.isArray(payload.deposit_plan) && Array.isArray(out.recommended_banks)) {
    const steps = bankSteps({ recommended: out.recommended_banks, relationships: list(payload.relationships) }).filter((s) => s && s.bank);
    const rows = depositPlanRows(steps);
    out.deposit_plan = rows.map((row, i) => {
      const bank = bankOfName(row.name, hb);
      const scope = steps[i] && steps[i].bank ? steps[i].bank.accountKind : null;
      return { ...row, existing_relationship: bank ? relationshipTag(bank) : null, has_account: !!(bank && scope && bank.deposit[scope]) };
    });
  }

  out.holdings = {
    banks: [...hb.banks.values()].map((b) => ({ key: b.key, bank: b.name, accounts: b.accounts.length,
      types: [...new Set(b.accounts.map((a) => a.type))] })),
    source: INVENTORY_SOURCE
  };
  return out;
}

/**
 * applyHoldingsToApplyGate(payload, holdings) → the approval odds (unit L4,
 * GET /api/money/banks?view=apply_gate) with each bank line tagged and existing
 * relationships first. Every line stays: odds are per bank.
 */
export function applyHoldingsToApplyGate(payload, holdings) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.odds)) return payload;
  const hb = holdings && holdings.banks instanceof Map ? holdings : { banks: new Map() };
  const odds = payload.odds.map((o) => {
    const bank = bankOfName(o.bank, hb);
    const id = bankIdentity(o.bank, { book: true });
    const products = [];
    for (const p of list(o.products)) for (const s of splitProducts(p)) if (isNamedProduct(s, id ? id.key : null) && !products.includes(s)) products.push(s);
    const side = o.kind === "business" || o.kind === "personal" ? o.kind : null;
    const held = bank ? products.filter((p) => holdsProduct(bank, p, { family: null, scope: side })) : [];
    return { ...o, existing_relationship: bank ? relationshipTag(bank) : null, you_have: held,
      next_product: held.length ? (products.find((p) => !held.includes(p)) || null) : null };
  });
  return { ...payload, odds: existingFirst(odds) };
}

/* ------------------------------------------------------------------ *
 * "Add an account" — the client's own entry (migration 590)
 * ------------------------------------------------------------------ */

const blank = (v) => v === null || v === undefined || String(v).trim() === "";

/**
 * readTradelineEntry(body, { now }) → the checked entry, or throws TypeError
 * naming the field. { creditor, product?, type, limit?, opened?, belongs_to }
 * belongs_to: "personal" | "entity:<uuid>" | "business:<name key>".
 */
export function readTradelineEntry(body = {}, { now = new Date() } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const creditor = text(b.creditor);
  if (!creditor) throw new TypeError("bank or lender is required, like Chase");
  if (creditor.length > 120) throw new TypeError("bank or lender must be 120 characters or fewer");
  const product = text(b.product);
  if (product && product.length > 120) throw new TypeError("card name must be 120 characters or fewer");
  const type = String(b.type ?? "").trim().toLowerCase();
  if (!ENTRY_TYPES[type]) throw new TypeError(`type must be one of ${Object.keys(ENTRY_TYPES).join(", ")}`);

  const limit = dollarsToCents(b.limit, "limit");
  if (limit !== null && !LIMIT_TYPES.has(type)) throw new TypeError("a limit is only for a credit card or a line of credit");
  if (limit !== null && limit <= 0) throw new TypeError("limit must be more than $0");

  let opened = null;
  if (!blank(b.opened)) {
    opened = monthOf(b.opened);
    if (!opened) throw new TypeError("opened must be a month, like 2021-03");
    const thisMonth = new Date(now).toISOString().slice(0, 7);
    if (opened > thisMonth) throw new TypeError("opened cannot be in the future");
    if (opened < "1950-01") throw new TypeError("opened must be 1950 or later");
  }

  const owner = String(b.belongs_to ?? "personal").trim();
  let belongs;
  if (owner === "personal" || owner === "") belongs = { scope: "personal" };
  else if (owner.startsWith("entity:") && isUuid(owner.slice(7))) belongs = { scope: "business", entityId: owner.slice(7) };
  else if (owner.startsWith("business:") && text(owner.slice(9))) belongs = { scope: "business", businessKey: companyKey(owner.slice(9)) };
  else throw new TypeError("belongs to must be personal or one of your businesses");

  return { creditor, product, type, limit, opened, ...belongs };
}

/**
 * addTradelineEntry(db, { orgId, clientId, input, by }) → { ok: true, entry_id } | { ok: false, reason }
 * The business is proven to be this client's before the one write.
 */
export async function addTradelineEntry(db, { orgId, clientId, input, by = {} }) {
  if (!orgId) throw new TypeError("orgId is required");
  if (!isUuid(clientId)) throw new TypeError("client_id must be a uuid");
  const cid = String(clientId).trim();
  let entityId = null;
  let businessName = null;
  if (input.scope === "business" && input.entityId) {
    const ent = (await db.query(
      `SELECT id, kind, archived_at FROM entities WHERE id = $1 AND org_id = $2 AND client_id = $3`,
      [input.entityId, orgId, cid]
    )).rows[0];
    if (!ent) return { ok: false, reason: "business_not_found" };
    if (ent.kind !== "business") return { ok: false, reason: "not_a_business_container" };
    if (ent.archived_at) return { ok: false, reason: "container_archived" };
    entityId = ent.id;
  } else if (input.scope === "business") {
    const rows = (await db.query(
      `SELECT id, name, entity_data FROM businesses WHERE org_id = $1 AND client_id = $2 ORDER BY created_at ASC`,
      [orgId, cid]
    )).rows || [];
    const hit = rows.find((r) => companyKey(r.name) === input.businessKey);
    if (!hit) return { ok: false, reason: "business_not_found" };
    const linked = (safeObject(hit.entity_data) || {}).entity_id;
    if (linked && isUuid(String(linked))) {
      const ent = (await db.query(
        `SELECT id, kind, archived_at FROM entities WHERE id = $1 AND org_id = $2 AND client_id = $3`,
        [String(linked), orgId, cid]
      )).rows[0];
      if (ent && ent.kind === "business" && !ent.archived_at) entityId = ent.id;
    }
    if (!entityId) businessName = text(hit.name);
  }
  const res = await db.query(
    `INSERT INTO finance_tradeline_entries
       (org_id, client_id, creditor, product, account_type, limit_cents, opened_month, scope, entity_id, business_name, entered_by, entered_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [orgId, cid, input.creditor, input.product ?? null, input.type, input.limit ?? null, input.opened ?? null,
      input.scope, entityId, businessName, by.kind === "staff" ? "staff" : "client", isUuid(by.id) ? by.id : null]
  );
  return { ok: true, entry_id: res.rows[0] ? res.rows[0].id : null };
}

/* ------------------------------------------------------------------ *
 * The reads
 * ------------------------------------------------------------------ */

export const ENTITIES_SQL = `SELECT id, kind, name, archived_at FROM entities
  WHERE org_id = $1 AND client_id = $2 ORDER BY created_at, id`;
export const BUSINESSES_SQL = `SELECT id, name, entity_data, created_at FROM businesses
  WHERE org_id = $1 AND client_id = $2 ORDER BY created_at ASC, id`;
export const ACCOUNTS_SQL = `SELECT ba.id, ba.name, ba.official_name, ba.mask, ba.account_type, ba.account_subtype,
         ba.credit_limit_cents, ba.entity_kind, ba.entity_id, ba.plaid_item_id, ba.closed_at,
         ba.raw->>'entered_by' AS entered_by, ba.raw->'fundhub_application'->>'kind' AS app_kind,
         p.plaid_institution_id, p.institution_name
    FROM bank_accounts ba
    LEFT JOIN plaid_items p ON p.id = ba.plaid_item_id AND p.org_id = ba.org_id AND p.client_id = ba.client_id
   WHERE ba.org_id = $1 AND ba.client_id = $2
   ORDER BY ba.created_at, ba.id`;
export const STAFF_LINES_SQL = `SELECT id, lender, kind, credit_limit_cents, opened_on, last4, entity_id, closed_at
    FROM tradelines
   WHERE org_id = $1 AND client_id = $2 AND source = 'manual'
   ORDER BY created_at, id`;
export const ENTRIES_SQL = `SELECT id, creditor, product, account_type, limit_cents, opened_month, scope, entity_id,
         business_name, entered_by, created_at
    FROM finance_tradeline_entries
   WHERE org_id = $1 AND client_id = $2
   ORDER BY created_at, id`;
export const BOOK_SQL = `SELECT id, name, product_name, lender_table, logo_path
    FROM lenders
   WHERE org_id = $1 AND active = true AND COALESCE(is_demo, false) = false
   ORDER BY priority_tier NULLS LAST, lower(name), id`;

/** readTradelineInventory(db, { orgId, clientId }) → buildInventory()'s answer. Read only. */
export async function readTradelineInventory(db, { orgId, clientId }) {
  if (!orgId) throw new TypeError("orgId is required");
  if (!isUuid(clientId)) throw new TypeError("client_id must be a uuid");
  const cid = String(clientId).trim();
  const q = (sql, params) => db.query(sql, params).then((r) => (r && Array.isArray(r.rows) ? r.rows : []));
  const [entities, businesses, crsRows, accounts, staffLines, entries, lenders] = await Promise.all([
    q(ENTITIES_SQL, [orgId, cid]),
    q(BUSINESSES_SQL, [orgId, cid]),
    q(CRS_SQL, [cid, orgId]),
    q(ACCOUNTS_SQL, [orgId, cid]),
    q(STAFF_LINES_SQL, [orgId, cid]),
    q(ENTRIES_SQL, [orgId, cid]),
    q(BOOK_SQL, [orgId])
  ]);
  return buildInventory({ entities, businesses, crsRows, accounts, staffLines, entries, lenders });
}

function itemView(it, logo) {
  return {
    id: it.refs[0],
    name: it.name,
    bank: it.bank ? it.bank.name : null,
    bank_key: it.bank ? it.bank.key : null,
    in_book: it.in_book,
    creditor: it.creditor,
    type: it.type,
    type_words: TYPE_WORDS[it.type] || TYPE_WORDS.other,
    /* A limit belongs to a card or a line of credit. For a loan the bureau's
       "high credit" is the amount borrowed, not a limit, so it is not shown as one. */
    limit_cents: it.type === "card" || it.type === "line" ? (it.limit_cents ?? null) : null,
    opened: it.opened ?? null,
    status: it.status,
    authorized_user: !!it.authorized_user,
    sources: [...it.sources],
    source_words: it.sources.map((s) => SOURCE_WORDS[s]),
    bureaus: [...it.bureaus],
    existing_relationship: !!it.existing_relationship,
    logo: logo ? logo.logo : null,
    logo_source: logo ? logo.logo_source : null
  };
}

/**
 * tradelineView(db, { orgId, clientId }) → GET /api/money/accounts?view=tradelines.
 * Every bank shows its own logo in H's order (src/banking/institution-logos.mjs):
 * Plaid's first, then the bank book's, else the name only.
 */
export async function tradelineView(db, { orgId, clientId }) {
  const inv = await readTradelineInventory(db, { orgId, clientId });
  const bookFirstId = (key) => {
    const b = key ? inv.book.get(key) : null;
    return b && b.lenderIds.length ? b.lenderIds[0] : null;
  };
  const shownItems = inv.groups.flatMap((g) => g.items);
  const asks = [
    ...shownItems.map((it) => ({
      institutionId: it.institution_id || null,
      lenderId: it.bank ? bookFirstId(it.bank.key) : null,
      name: it.bank ? it.bank.name : (it.institution || it.creditor)
    })),
    ...inv.relationships.map((r) => ({ institutionId: r.institution_id, lenderId: r.lender_ids[0] || null, name: r.bank }))
  ];
  const found = asks.length ? await findLogos(db, { orgId, banks: asks }) : [];
  const logoAt = new Map(shownItems.map((it, i) => [it, found[i]]));
  const relLogo = (i) => found[shownItems.length + i] || { logo: null, logo_source: null };

  const businesses = inv.groups.filter((g) => g.kind === "business" && !g.archived);
  return {
    view: "tradelines",
    client_id: clientId,
    groups: inv.groups.map((g) => ({
      key: g.key, kind: g.kind, name: g.name, container_id: g.container_id, archived: g.archived,
      closed: g.closed, items: g.items.map((it) => itemView(it, logoAt.get(it)))
    })),
    relationships: inv.relationships.map((r, i) => ({
      key: r.key, bank: r.bank, text: RELATIONSHIP_WORDS, accounts: r.accounts,
      types: r.types.map((t) => TYPE_WORDS[t] || TYPE_WORDS.other), scopes: r.scopes, lender_ids: r.lender_ids,
      logo: relLogo(i).logo, logo_source: relLogo(i).logo_source
    })),
    counts: inv.counts,
    add: {
      types: Object.entries(ENTRY_TYPES).map(([value, t]) => ({ value, label: t.label, limit: LIMIT_TYPES.has(value) })),
      belongs_to: [{ value: "personal", label: "Personal" },
        ...businesses.map((g) => ({ value: g.key, label: g.name }))]
    },
    source: INVENTORY_SOURCE
  };
}

/**
 * bankStrategyWithHoldings(db, opts, { read }) → bankStrategy()'s payload with
 * the client's holdings applied (applyHoldingsToBankPlan). The inventory is an
 * extra: if its read fails the bank plan still answers, untouched. `read` is
 * bankStrategy, swappable in tests.
 */
export async function bankStrategyWithHoldings(db, opts = {}, { read = bankStrategy } = {}) {
  const payload = await read(db, opts);
  if (!payload || payload.ok === false) return payload;
  let holdings;
  try {
    holdings = holdingsOf(await readTradelineInventory(db, { orgId: opts.orgId, clientId: opts.clientId }));
  } catch (e) {
    console.error("banks: tradeline inventory skipped", e && e.message ? e.message : e);
    return payload;
  }
  const out = applyHoldingsToBankPlan(payload, holdings);
  /* A card line that left the apply order still shows its bank's own logo
     (H's order: Plaid, then the bank book). The other lines get theirs from
     attachBankLogos() in api/money/banks.mjs. */
  const have = out.card_stacking && Array.isArray(out.card_stacking.already_have) ? out.card_stacking.already_have : [];
  if (have.length) {
    const found = await findLogos(db, { orgId: opts.orgId, banks: have.map((h) => ({ lenderId: h.lender_id, name: h.issuer })) });
    out.card_stacking.already_have = have.map((h, i) => ({ ...h, ...(found[i] || {}) }));
  }
  return out;
}

export default tradelineView;
