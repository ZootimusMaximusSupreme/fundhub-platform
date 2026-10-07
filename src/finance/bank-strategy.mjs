// FinanceOS bank strategy (wave 5, unit W2) — GET/POST /api/money/banks.
//
// Owner, 2026-10-06 (docs/finance/finance-os-direction-2026-10-06.md, last
// section): which accounts to open based on your location, banking
// relationships built on purpose, funding rounds planned ahead, and credit card
// stacking. Four answers on one read:
//
//   location           the state(s) the bank match uses for this client
//   recommended_banks  banks near you that want an account first, and the steps
//   card_stacking      the order to apply for cards, spacing, what each pull costs
//   next_round         the date, the estimated amount, and what is left to do
//   relationships      the tracker: banks planned, opened, deposits, history
//
// THE RULE THIS FILE LIVES BY (board, ops/workflows/finance-os-wave5-2026-10-06.md):
// never invent a rule, amount, bank, score or step. Every recommendation carries
// a `source` saying where its rule is written down. Where the repo holds no rule,
// the value is STAFF-SET and reads "not set" until a staff member sets it.
//
// WHERE EACH RULE COMES FROM
//   The bank book    the `lenders` table (138): the Legacy Strong datapoints and
//                    the Carl Barton 0% card book, loaded by
//                    scripts/lenders-import-alec.mjs. Per bank: requires_account_
//                    opening, relationship_required, minimum_deposit, stated_
//                    requirements, insider_tips, priority_tier, bureaus_pulled,
//                    intro_offers. Each fact is cited by the row's external_row_id.
//   The bank match   src/lenders/match.mjs via matchForClient (src/lenders/store.mjs):
//                    home OR business state, protected bureaus held back, no
//                    business no business cards, book tier then bureau rotation.
//   The funding walk src/underwrite/funding-sequence.mjs (owner law 2026-09-26):
//                    prime personal → personal funding → companies (name + NAICS)
//                    → lender list → apply forever. "Personal comes before business."
//   Next Funding     src/blueprint/next-funding-sequence.mjs: the staff-set date
//   Sequence         the file is ready for the next round (custom field).
//   UnderwriteIQ     the stored funding estimate (custom field total_funding_
//                    estimate, then the newest pull's fundingEstimate — the
//                    precedence matchForClient uses), the engine's fundable,
//                    can_card_stack and needs_inquiry_cleanup flags.
//   Application      Fundhub's five-step order (src/underwrite/black-report-node.mjs,
//   order            src/deliverables/lender-list.mjs): one at a time, personal
//                    before business.
//   Owner rule       inquiries cost fundability (owner-set 2026-09-29, written in
//                    marketing/landing-pages/slo/preview/reorg-draft-build.mjs).
//   Checklist        how to open a business checking account (waypoint
//                    business_checking, db/migrations/362_waypoint_definitions_seed.sql).
//
// STAFF-SET, BECAUSE NO REPO RULE EXISTS: the day to open an account, how much to
// deposit when the bank book lists no minimum, the next-round date, and the
// number of days between card applications at two different banks.
//
// ONE CONFLICT, NAMED: docs/legacy-strong/README.md calls the dollar field of
// bank-datapoints-active-banks.md "limits"; the importer that filled
// lenders.minimum_deposit (scripts/lenders-extract-bureaus.mjs) reads it as "how
// much has to be deposited". This file uses the column as stored and cites it.
//
// NOTHING HERE MOVES MONEY. "Record a deposit" writes down one staff saw land.

import { matchForClient } from "../lenders/store.mjs";
import { parseBureaus } from "../lenders/match.mjs";
import { isBusinessLenderTable, isPersonalLenderTable } from "../lenders/tables.mjs";
import { listBusinessInfo } from "./business-info.mjs";
import { inquiriesSummary } from "./credit-overview.mjs";
import { evaluateFundingSequence } from "../underwrite/funding-sequence.mjs";
import { computeUnderwrite } from "../underwrite/engine.mjs";
import { toBureaus } from "../underwrite/adapter.mjs";
import { applyStackedBusinessFunding } from "../underwrite/business-funding.mjs";
import { linesForEngine } from "../tradelines/index.mjs";
import { isCapitalBlueprintBuyer } from "../blueprint/coach-exception.mjs";
import {
  NEXT_SEQUENCE_READY_DATE_KEY,
  parseReadyDate,
  setNextFundingSequenceReadyDate
} from "../blueprint/next-funding-sequence.mjs";
import { updateBankRelationshipTodoState } from "../blueprint/bank-relationship.mjs";

/* ------------------------------------------------------------------ *
 * Small readers
 * ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

const BUREAU_NAME = { EX: "Experian", EQ: "Equifax", TU: "TransUnion", "D&B": "Dun & Bradstreet",
  "EX Biz": "Experian Business", "EQ Biz": "Equifax Business" };

function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
}

/** "a, b and c" — read out loud, never a slash list. */
function andList(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  return xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
}

/** Book dollars (numeric) → integer cents. Null/blank/negative → null. Never 0 for unknown. */
export function dollarsToCents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** "$10,000" from cents, for sentences. Null → null. */
export function moneyWords(cents) {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  const whole = cents % 100 === 0;
  const dollars = Math.floor(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const c = String(Math.abs(cents) % 100).padStart(2, "0");
  return (cents < 0 ? "-$" : "$") + dollars + (whole ? "" : "." + c);
}

/** YYYY-MM-DD from a date, a timestamp or a string. Null when unreadable. */
export function isoDay(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseReadyDate(s);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** day + n calendar days, as YYYY-MM-DD (UTC noon, so no clock edge). */
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a, b) {
  const ms = new Date(`${b}T12:00:00.000Z`) - new Date(`${a}T12:00:00.000Z`);
  return Math.round(ms / 86400000);
}

/** Whole calendar months from a to b: opened Aug 15, today Oct 6 → 1. */
export function monthsBetween(a, b) {
  if (!a || !b || b < a) return 0;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  let m = (by - ay) * 12 + (bm - am);
  if (bd < ad) m -= 1;
  return Math.max(0, m);
}

/* ------------------------------------------------------------------ *
 * Sources — every recommendation says where its rule is written
 * ------------------------------------------------------------------ */

/** A bank book fact: label for people, ref for staff (column · book row id). */
export function bookSource(lender, field) {
  return {
    label: `Bank book · ${lender?.name || "this bank"}`,
    ref: `lenders.${field} · ${lender?.external_row_id || lender?.id || "row"}`
  };
}

export const SOURCES = Object.freeze({
  match: Object.freeze({ label: "Fundhub bank match", ref: "src/lenders/match.mjs" }),
  walk: Object.freeze({
    label: "Fundhub funding order (owner law 2026-09-26)",
    ref: "src/underwrite/funding-sequence.mjs"
  }),
  nextSequence: Object.freeze({
    label: "Next Funding Sequence date, set by staff",
    ref: `clients.custom_fields.${NEXT_SEQUENCE_READY_DATE_KEY} (src/blueprint/next-funding-sequence.mjs)`
  }),
  estimateField: Object.freeze({
    label: "UnderwriteIQ funding estimate on your file",
    ref: "clients.custom_fields.total_funding_estimate"
  }),
  estimatePull: Object.freeze({
    label: "UnderwriteIQ funding estimate from your newest credit pull",
    ref: "crs_results.result.fundingEstimate"
  }),
  engine: Object.freeze({ label: "UnderwriteIQ", ref: "src/underwrite/engine.mjs (fundable)" }),
  creditFile: Object.freeze({
    label: "Your credit file",
    ref: "inquiriesSummary (src/finance/credit-overview.mjs)"
  }),
  staffPlan: Object.freeze({ label: "Set by staff", ref: "blueprint_bank_relationship_todos (461)" }),
  staffDeposit: Object.freeze({ label: "Recorded by staff", ref: "bank_relationship_deposits (461)" }),
  /* Fundhub's own five-step application order, printed in the UnderwriteIQ
     report and the lender list: fix utilization first · lowest score floor
     first · one at a time ("Wait for the decision before you send the next one.
     Never shotgun applications.") · work up the list · personal before business. */
  applicationOrder: Object.freeze({
    label: "Fundhub application order (UnderwriteIQ report)",
    ref: "src/underwrite/black-report-node.mjs · Application Order Warning; src/deliverables/lender-list.mjs"
  }),
  ownerInquiries: Object.freeze({
    label: "Owner rule, 2026-09-29",
    ref: "marketing/landing-pages/slo/preview/reorg-draft-build.mjs · OWNER-SET 2026-09-29: inquiries cost fundability"
  }),
  inquiryFlag: Object.freeze({
    label: "UnderwriteIQ",
    ref: "src/underwrite/vendor/underwriter.cjs · optimization.needs_inquiry_cleanup (any inquiry)"
  }),
  checklistChecking: Object.freeze({
    label: "Fundhub checklist · Open a business checking account",
    ref: "waypoint_definitions.business_checking (db/migrations/362_waypoint_definitions_seed.sql)"
  })
});

/* The checklist's own words for opening a business checking account (362). */
export const BUSINESS_CHECKING_HOW = "Open it in the LLC name, using the EIN. Take your filing paperwork and your EIN letter with you.";
/* The application order's own words for spacing (src/underwrite/black-report-node.mjs). */
export const ONE_AT_A_TIME = "One at a time: wait for the decision before you send the next one. Never shotgun applications.";
export const INQUIRY_RULE = "Inquiries cost fundability. Any more than zero should come off.";

/* ------------------------------------------------------------------ *
 * Reading the bank book's own words
 * ------------------------------------------------------------------ */

/** The clauses of the book's free text, stated requirements first. */
function clauses(lender) {
  const out = [];
  for (const field of ["stated_requirements", "insider_tips"]) {
    const raw = lender && lender[field];
    if (!raw) continue;
    for (const part of String(raw).split(/[;\n]+|(?<=[.!?])\s+/)) {
      const t = text(part);
      if (t) out.push({ field, text: t.replace(/[.;]+$/, "") });
    }
  }
  return out;
}

/* SEASONING. A bank's own sentence that names a number of days money must sit
   in the account (or the account must be open) before you apply:
     "Checking account + 30-day seasoning required."      (Bank of America)
     "30+ days of liquidity seasoning strongly improves odds" (Chase)
     "Open checking account 30 days prior when possible"  (BOK Financial)
   The number is read from the bank's words, never assumed. */
const SEASONING_PATTERNS = [
  /(\d{1,3})\s*\+?\s*-?\s*days?\b[^.;]{0,40}?\bseason/i,
  /\bseason(?:ed|ing)?\b[^.;]{0,40}?(\d{1,3})\s*\+?\s*-?\s*days?\b/i,
  /\bopen[^.;]{0,60}?(\d{1,3})\s*\+?\s*days?\s+(?:prior|before)\b/i,
  /(\d{1,3})\s*\+?\s*days?\s+(?:of\s+)?account\s+open/i
];

/** → { days, quote, field } from the bank's own words, or null. */
export function seasoningRule(lender) {
  for (const c of clauses(lender)) {
    for (const re of SEASONING_PATTERNS) {
      const m = re.exec(c.text);
      if (m) {
        const days = Number(m[1]);
        if (Number.isInteger(days) && days > 0 && days <= 365) {
          return { days, quote: c.text.slice(0, 200), field: c.field };
        }
      }
    }
  }
  return null;
}

/* NO ACCOUNT NEEDED. The book sometimes flags "account opening: yes" on a bank
   whose own notes say the opposite ("No business checking required" — Elan,
   American Express, First Citizens online). A recommendation may not rest on a
   fact the book contradicts, so such a bank is not listed as a bank to open. It
   stays in the card list (you apply there directly) and is named in left_out. */
const NO_ACCOUNT_PATTERNS = [
  /\bno\s+(?:business\s+|biz\s+)?(?:checking|bank)(?:\s+account)?\s+(?:is\s+)?(?:required|needed|necessary)\b/i,
  /\b(?:business\s+|biz\s+)?checking(?:\s+account)?\s+(?:is\s+)?not\s+(?:required|needed)\b/i,
  /\bno\s+account\s+(?:is\s+)?required\b/i,
  /\bchecking[- ]free\b/i
];

/** → the book's own sentence saying no account is needed, or null. */
export function noAccountNeeded(lender) {
  for (const c of clauses(lender)) {
    if (NO_ACCOUNT_PATTERNS.some((re) => re.test(c.text))) return { quote: c.text.slice(0, 200), field: c.field };
  }
  return null;
}

/* SPACING. A bank's own sentence about the gap before the next application
   there: Citi's "1 in 8" / "2 in 65", American Express's "1–3 months of use →
   then apply", US Bank's "spend for 3+ months → apply Biz Platinum", First
   American's "wait 1-2 weeks". Quoted as written; nothing is computed from it. */
const SPACING_PATTERNS = [
  /\b\d\s+in\s+\d{1,3}\b/i,
  /\bwait\b/i,
  /\b\d+\s*[–-]?\s*\d*\s*\+?\s*months?\s+of\s+use\b/i,
  /\bspend\s+(?:for\s+)?\d+\s*\+?\s*months?\b/i,
  /\bsame[- ]day\b/i,
  /\bapplying\s+again\b/i
];

/** → { quote, field } — the bank's own spacing sentence, or null. */
export function spacingRule(lender) {
  for (const c of clauses(lender)) {
    if (SPACING_PATTERNS.some((re) => re.test(c.text))) return { quote: c.text.slice(0, 220), field: c.field };
  }
  return null;
}

/* WHY. Up to two of the bank's own sentences about accounts, deposits,
   seasoning or a relationship — the words a client should read before going in. */
const WHY_WORDS = /\b(checking|season|liquidity|deposit|relationship|snapshot|branch|balance|banker|RM)\b/i;

export function whyQuotes(lender, max = 2) {
  const seen = new Set();
  const out = [];
  for (const c of clauses(lender)) {
    if (!WHY_WORDS.test(c.text)) continue;
    const key = c.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: c.text.slice(0, 200), source: bookSource(lender, c.field) });
    if (out.length >= max) break;
  }
  return out;
}

const TABLE_WORDS = {
  OnlineBizCC: "Business credit card (apply online)",
  InBranchBizCC: "Business credit card (apply in a branch)",
  BizLOC_Stated: "Business line of credit",
  BizLOC_Documented: "Business line of credit (with documents)",
  PersonalCC: "Personal credit card",
  PersonalLoans: "Personal loan",
  PersonalLOC: "Personal line of credit"
};

export function productWords(lender) {
  const base = TABLE_WORDS[lender?.lender_table] || "Account";
  const named = text(lender?.product_name);
  /* Some scraped rows carry a fragment ("TCM)") in product_name; only a name
     with real words is shown. */
  return named && /[a-z]{3}/i.test(named) && !/^\W|\)$/.test(named) ? `${base}: ${named}` : base;
}

const yes = (v) => String(v ?? "").trim().toLowerCase() === "yes";

/* ------------------------------------------------------------------ *
 * Banks near you
 * ------------------------------------------------------------------ */

/**
 * The bank book's relationship signals for one lender row.
 *   account      requires_account_opening = yes
 *   relationship relationship_required = yes
 *   deposit      minimum_deposit > 0
 *   seasoning    the bank's words name a number of days
 * contradicted   the bank's own notes say no account is needed
 */
export function relationshipSignals(lender) {
  const depositCents = dollarsToCents(lender?.minimum_deposit);
  const season = seasoningRule(lender);
  const noAcct = noAccountNeeded(lender);
  const any = yes(lender?.requires_account_opening) || yes(lender?.relationship_required) ||
    (depositCents !== null && depositCents > 0) || !!season;
  return {
    account: yes(lender?.requires_account_opening),
    relationship: yes(lender?.relationship_required),
    deposit_cents: depositCents !== null && depositCents > 0 ? depositCents : null,
    seasoning: season,
    contradicted: noAcct,
    any,
    is_relationship_bank: any && !noAcct
  };
}

/** The steps to build the relationship, each from one book field. */
export function relationshipSteps(lender, signals = relationshipSignals(lender)) {
  const name = lender?.name || "this bank";
  const personal = isPersonalLenderTable(lender?.lender_table);
  const kind = personal ? "a checking account" : "a business checking account";
  /* How to open a business account: the checklist's own step (362), word for word. */
  const how = personal ? null : { text: BUSINESS_CHECKING_HOW, source: SOURCES.checklistChecking };
  const steps = [];
  if (signals.account) {
    steps.push({ step: "open_account", text: `Open ${kind} at ${name}.`, how, source: bookSource(lender, "requires_account_opening") });
  } else if (signals.relationship) {
    steps.push({ step: "open_account", text: `Open an account at ${name}. The bank book says it wants a relationship first.`,
      how, source: bookSource(lender, "relationship_required") });
  } else {
    steps.push({ step: "open_account", text: `Open ${kind} at ${name}.`, how,
      source: signals.deposit_cents ? bookSource(lender, "minimum_deposit") : bookSource(lender, signals.seasoning?.field || "stated_requirements") });
  }
  if (signals.deposit_cents) {
    steps.push({ step: "deposit", text: `Deposit ${moneyWords(signals.deposit_cents)}.`, amount_cents: signals.deposit_cents,
      source: bookSource(lender, "minimum_deposit") });
  } else {
    steps.push({ step: "deposit", text: "Deposit amount: not set. Staff set it with the plan.", amount_cents: null,
      source: SOURCES.staffPlan, not_set: true });
  }
  if (signals.seasoning) {
    steps.push({ step: "season", text: `Leave it there ${signals.seasoning.days}+ days before you apply.`,
      days: signals.seasoning.days, quote: signals.seasoning.quote, source: bookSource(lender, signals.seasoning.field) });
  }
  return steps;
}

/** One recommended bank, from a matched lender row merged with its book facts. */
export function recommendBank(lender, { states = [] } = {}) {
  const signals = relationshipSignals(lender);
  const serves = (Array.isArray(lender.covers_states) && lender.covers_states.length)
    ? lender.covers_states.join(", ")
    : (lender.footprint === "national" ? "All states" : null);
  const why = [];
  if (lender.lane === "home" || lender.lane === "business") {
    why.push({ text: `Serves ${serves} — your ${lender.lane === "home" ? "home" : "business"} state.`, source: bookSource(lender, "eligible_states") });
  } else if (lender.footprint === "national") {
    why.push({ text: "Serves all states.", source: bookSource(lender, "eligible_states") });
  }
  if (lender.priority_tier != null) {
    why.push({ text: `Tier ${lender.priority_tier} in the bank book.`, source: bookSource(lender, "priority_tier") });
  }
  for (const q of whyQuotes(lender)) why.push(q);
  return {
    lender_id: lender.id || null,
    name: lender.name,
    products: [productWords(lender)],
    lender_table: lender.lender_table,
    serves_state: serves,
    lane: lender.lane || null,
    tier: lender.priority_tier ?? null,
    minimum_deposit_cents: signals.deposit_cents,
    seasoning_days: signals.seasoning ? signals.seasoning.days : null,
    why,
    relationship_steps: relationshipSteps(lender, signals),
    source: bookSource(lender, "external_row_id"),
    states_matched: states
  };
}

/**
 * recommendedBanks(matches, { states }) → { banks, left_out }
 *
 * matches: matchForClient(...).matches, already state-gated, bureau-protected
 * and business-gated, in the bank match's own order (book tier, then bureau
 * rotation, then name), each merged with its book facts.
 *
 * A bank is listed when the bank book says it wants an account or a
 * relationship (account opening, relationship required, a minimum deposit, or a
 * seasoning period in its own words) AND its own notes do not say an account is
 * not needed. One entry per bank name; a second product at the same bank joins
 * the first entry's products.
 */
export function recommendedBanks(matches = [], { states = [] } = {}) {
  const banks = [];
  const byName = new Map();
  const leftOut = [];
  for (const m of Array.isArray(matches) ? matches : []) {
    if (!m || !m.name) continue;
    const sig = relationshipSignals(m);
    if (!sig.any) continue;
    const key = String(m.name).trim().toLowerCase();
    if (!sig.is_relationship_bank) {
      if (!leftOut.some((x) => x.name.toLowerCase() === key)) {
        leftOut.push({ name: m.name, reason: "book_says_no_account_needed", quote: sig.contradicted.quote,
          source: bookSource(m, sig.contradicted.field) });
      }
      continue;
    }
    const seen = byName.get(key);
    if (seen) {
      const p = productWords(m);
      if (!seen.products.includes(p)) seen.products.push(p);
      continue;
    }
    const rec = recommendBank(m, { states });
    byName.set(key, rec);
    banks.push(rec);
  }
  /* A bank listed through one of its rows is not also "left out" by another. */
  return { banks, left_out: leftOut.filter((x) => !byName.has(x.name.trim().toLowerCase())) };
}

/* ------------------------------------------------------------------ *
 * Card stacking
 * ------------------------------------------------------------------ */

const CARD_TABLES = new Set(["PersonalCC", "OnlineBizCC", "InBranchBizCC"]);
/* How many banks the screen lists in each group (personal, business). A display
   size, not a rule — the full counts travel with the list. */
export const STACK_SHOWN_PER_GROUP = 6;

/** A product name worth showing: real words, not a scraped fragment like "TCM)". */
function cardName(m) {
  const n = text(m.product_name);
  return n && /[a-z]{3}/i.test(n) && !/^\W|\)$/.test(n) ? n : null;
}

/* One line per bank, in the order the bank's first card appears. A bank's other
   cards ride on the same line, in the match's order, so the plan never reads as
   "apply at the same bank four times in a row" — the bank book only gives an
   order between one bank's own cards when it says so (spacing_rule). */
function byIssuer(rows) {
  const out = [];
  const at = new Map();
  for (const m of rows) {
    const key = String(m.name || "").trim().toLowerCase();
    if (!key) continue;
    if (at.has(key)) { at.get(key).rows.push(m); continue; }
    const g = { key, rows: [m] };
    at.set(key, g);
    out.push(g);
  }
  return out;
}

/**
 * cardStacking(matches, { relationships, inquiries, perGroup }) → the stacking plan.
 *
 * ORDER, and where it is written:
 *   1. personal cards before business cards — Fundhub's application order
 *      ("Personal before business", src/underwrite/black-report-node.mjs) and
 *      the funding walk (src/underwrite/funding-sequence.mjs: "Personal comes
 *      before business");
 *   2. inside each, the bank match's own order: book tier first, then bureau
 *      rotation (spread the pulls across bureaus), then name (src/lenders/match.mjs).
 *      The application order's "lowest score floor first" cannot reorder this
 *      list today: no bank in the book states a score floor (match.mjs measured
 *      0 rows), so the book's tier order stands.
 * SPACING: Fundhub's "One at a time: wait for the decision before you send the
 * next one" for every application, plus a bank's own words when the book has
 * them. A number of days between banks: no repo rule — "not set".
 * INQUIRY: the bureaus that bank pulls (book), and the client's current count
 * on each from their credit file.
 */
export function cardStacking(matches = [], { relationships = [], inquiries = null, perGroup = STACK_SHOWN_PER_GROUP } = {}) {
  const cards = (Array.isArray(matches) ? matches : []).filter((m) => m && CARD_TABLES.has(m.lender_table));
  const personal = byIssuer(cards.filter((m) => isPersonalLenderTable(m.lender_table)));
  const business = byIssuer(cards.filter((m) => isBusinessLenderTable(m.lender_table)));
  const relByName = new Map((Array.isArray(relationships) ? relationships : [])
    .filter((r) => r && r.bank_key).map((r) => [String(r.bank_key).trim().toLowerCase(), r]));
  const byBureau = inquiries && inquiries.by_bureau ? inquiries.by_bureau : {};
  const BUREAU_KEY = { EX: "experian", EQ: "equifax", TU: "transunion" };
  const cap = Math.max(0, perGroup);

  function line(g, order, kind) {
    const m = g.rows[0];
    const bureaus = [...new Set(g.rows.flatMap((r) =>
      (Array.isArray(r.bureaus) && r.bureaus.length ? r.bureaus : parseBureaus(r.bureaus_pulled))))];
    const names = bureaus.map((b) => BUREAU_NAME[b] || b);
    const now = bureaus.map((b) => {
      const n = byBureau[BUREAU_KEY[b]];
      return typeof n === "number" ? `${BUREAU_NAME[b]} has ${n} now` : null;
    }).filter(Boolean);
    const spRow = g.rows.find((r) => spacingRule(r));
    const sp = spRow ? spacingRule(spRow) : null;
    const seasonRow = g.rows.find((r) => seasoningRule(r) && relationshipSignals(r).is_relationship_bank);
    const season = seasonRow ? seasoningRule(seasonRow) : null;
    const rel = relByName.get(g.key) || null;
    const why = [];
    if (kind === "personal") why.push({ text: "Personal card. Personal comes before business.", source: SOURCES.walk });
    if (m.priority_tier != null) why.push({ text: `Tier ${m.priority_tier} in the bank book.`, source: bookSource(m, "priority_tier") });
    const offerRow = g.rows.find((r) => text(r.intro_offers));
    if (offerRow) why.push({ text: text(offerRow.intro_offers), source: bookSource(offerRow, "intro_offers") });
    if (m.lane === "home" || m.lane === "business") why.push({ text: `Serves your ${m.lane} state.`, source: bookSource(m, "eligible_states") });
    let gate = null;
    if (season) {
      gate = {
        text: rel && rel.opened_on
          ? `Apply after your ${m.name} account has ${season.days} days of seasoning (${addDays(rel.opened_on, season.days)}).`
          : `Open your ${m.name} account first and wait ${season.days}+ days.`,
        source: bookSource(seasonRow, season.field)
      };
    }
    const named = g.rows.map(cardName).filter(Boolean);
    return {
      order,
      card: named[0] || productWords(m),
      other_cards: [...new Set(named.slice(1))],
      issuer: m.name,
      lender_id: m.id || null,
      kind,
      intro_offer: offerRow ? text(offerRow.intro_offers) : null,
      why,
      spacing_rule: sp ? { text: sp.quote, source: bookSource(spRow, sp.field) } : null,
      relationship_gate: gate,
      inquiry_impact: bureaus.length
        ? { bureaus, text: `One hard pull on ${andList(names)} per card.${now.length ? " " + andList(now) + "." : ""}`,
          source: bookSource(m, "bureaus_pulled") }
        : { bureaus: [], text: "Which bureau it pulls: not in the bank book.", source: bookSource(m, "bureaus_pulled") }
    };
  }

  const items = [];
  for (const g of personal.slice(0, cap)) items.push(line(g, items.length + 1, "personal"));
  for (const g of business.slice(0, cap)) items.push(line(g, items.length + 1, "business"));
  return {
    order_rule: {
      text: "Personal cards first, then business cards. Inside each: bank book tier, then spread the pulls across the three bureaus.",
      sources: [SOURCES.applicationOrder, SOURCES.walk, SOURCES.match]
    },
    spacing: {
      text: ONE_AT_A_TIME,
      source: SOURCES.applicationOrder,
      days_between: null,
      days_text: "Days between two banks: not set. No Fundhub rule names a number; staff decide it."
    },
    items,
    shown: items.length,
    personal_banks: personal.length,
    business_banks: business.length,
    total_cards: cards.length
  };
}

/* ------------------------------------------------------------------ *
 * The bank relationship tracker (rows: 403 + 461)
 * ------------------------------------------------------------------ */

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * relationshipView(row, { today, deposits, book, containers }) → one tracker line.
 *
 * status
 *   planned    on the plan, not opened yet
 *   seasoning  opened; fewer days than the bank's own seasoning rule
 *   seasoned   opened; the bank's seasoning days have passed
 *   open       opened; the bank book names no seasoning period — or the row
 *              was marked done (the Blueprint tracker can do that) with no
 *              open day recorded, so nothing can be counted from it
 *   skipped    staff took it off the plan
 */
export function relationshipView(row, { today, deposits = [], book = null, containers = new Map() } = {}) {
  const opened = isoDay(row.opened_on);
  const planned = isoDay(row.planned_open_on);
  const season = book ? seasoningRule(book) : null;
  const bookDeposit = book ? dollarsToCents(book.minimum_deposit) : null;
  const staffDeposit = num(row.planned_deposit_cents);
  const deps = (Array.isArray(deposits) ? deposits : [])
    .map((d) => ({ id: d.id, amount_cents: num(d.amount_cents), deposited_on: isoDay(d.deposited_on), note: text(d.note) }))
    .filter((d) => d.amount_cents !== null && d.deposited_on)
    .sort((a, b) => (a.deposited_on < b.deposited_on ? -1 : a.deposited_on > b.deposited_on ? 1 : 0));
  const total = deps.reduce((s, d) => s + d.amount_cents, 0);
  const daysOpen = opened ? Math.max(0, daysBetween(opened, today)) : null;

  let status;
  let statusText;
  if (row.state === "skipped") {
    status = "skipped";
    statusText = "Skipped";
  } else if (!opened && row.state === "done") {
    status = "open";
    statusText = "Open · day not recorded";
  } else if (opened) {
    if (season && daysOpen < season.days) {
      status = "seasoning";
      statusText = `Open · ${daysOpen} of ${season.days} days seasoned`;
    } else if (season) {
      status = "seasoned";
      statusText = `Open · seasoned ${season.days}+ days`;
    } else {
      status = "open";
      statusText = "Open";
    }
  } else {
    status = "planned";
    statusText = planned ? "Planned" : "Planned · date not set";
  }

  const container = row.entity_id ? containers.get(String(row.entity_id)) || null : null;
  const name = text(row.bank_name) || (book && book.name) || row.bank_key;
  return {
    id: row.id,
    bank: name,
    bank_key: row.bank_key,
    account_kind: row.account_kind,
    lender_id: row.lender_id || (book && book.id) || null,
    container_id: row.entity_id || null,
    container_name: container ? container.name : null,
    status,
    status_text: statusText,
    planned_open_on: planned,
    planned_deposit_cents: staffDeposit,
    /* What to deposit: staff's own number first, then the bank book's minimum,
       else nothing — "not set". Which one it is travels with it. */
    deposit_plan_cents: staffDeposit ?? bookDeposit ?? null,
    deposit_plan_source: staffDeposit !== null ? SOURCES.staffPlan : (bookDeposit !== null ? bookSource(book, "minimum_deposit") : null),
    opened_on: opened,
    days_open: daysOpen,
    months_of_history: opened ? monthsBetween(opened, today) : null,
    deposits: deps,
    deposits_total_cents: deps.length ? total : null,
    seasoning: season ? { days: season.days, quote: season.quote, source: bookSource(book, season.field) } : null,
    seasoned_on: opened && season ? addDays(opened, season.days) : null,
    notes: text(row.notes),
    source: SOURCES.staffPlan
  };
}

/** The book row behind each tracker line: its own lender_id first, else the bank's name. */
export function pickBookRow(row, byId, byName) {
  if (row.lender_id && byId.has(String(row.lender_id))) return byId.get(String(row.lender_id));
  const rows = byName.get(String(row.bank_key || "").trim().toLowerCase()) || [];
  if (!rows.length) return null;
  /* Several rows can share a name (online and in-branch). Prefer the one that
     carries the relationship facts, so the tracker and the plan read the same
     seasoning and minimum: a seasoning sentence first, then a minimum deposit. */
  return rows.find((r) => seasoningRule(r)) || rows.find((r) => dollarsToCents(r.minimum_deposit)) || rows[0];
}

const REL_SQL = `
  SELECT id, bank_key, bank_name, account_kind, state, notes, lender_id, entity_id,
         planned_open_on::text AS planned_open_on, planned_deposit_cents,
         opened_on::text AS opened_on, created_at, updated_at
    FROM blueprint_bank_relationship_todos
   WHERE org_id = $1::uuid AND client_id = $2::uuid
   ORDER BY created_at ASC, id`;
const DEPOSIT_SQL = `
  SELECT id, relationship_id, amount_cents, deposited_on::text AS deposited_on, note, created_at
    FROM bank_relationship_deposits
   WHERE org_id = $1::uuid AND client_id = $2::uuid
   ORDER BY deposited_on ASC, created_at ASC`;
const BOOK_COLS = `id, name, lender_table, eligible_states, minimum_deposit, requires_account_opening,
  relationship_required, stated_requirements, insider_tips, intro_offers, priority_tier,
  bureaus_pulled, product_name, external_row_id`;

/** Tracker rows, their deposits and their book rows — the read the plan pins share. */
export async function readRelationships(db, { orgId, clientId, today }) {
  const [rels, deps, ents] = await Promise.all([
    db.query(REL_SQL, [orgId, clientId]),
    db.query(DEPOSIT_SQL, [orgId, clientId]),
    db.query(`SELECT id, kind, name FROM entities WHERE org_id = $1::uuid AND client_id = $2::uuid`, [orgId, clientId])
  ]);
  const rows = rels.rows;
  const ids = [...new Set(rows.map((r) => r.lender_id).filter(Boolean).map(String))];
  const names = [...new Set(rows.map((r) => String(r.bank_key || "").trim().toLowerCase()).filter(Boolean))];
  let book = [];
  if (ids.length || names.length) {
    book = (await db.query(
      `SELECT ${BOOK_COLS} FROM lenders
        WHERE org_id = $1::uuid AND COALESCE(is_demo, false) = false
          AND (id = ANY($2::uuid[]) OR lower(btrim(name)) = ANY($3::text[]))
        ORDER BY priority_tier NULLS LAST, lower(name), id`,
      [orgId, ids, names]
    )).rows;
  }
  const byId = new Map(book.map((b) => [String(b.id), b]));
  const byName = new Map();
  for (const b of book) {
    const k = String(b.name || "").trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(b);
  }
  const depsByRel = new Map();
  for (const d of deps.rows) {
    const k = String(d.relationship_id);
    if (!depsByRel.has(k)) depsByRel.set(k, []);
    depsByRel.get(k).push(d);
  }
  const containers = new Map(ents.rows.map((e) => [String(e.id), e]));
  return rows.map((r) => relationshipView(r, {
    today,
    deposits: depsByRel.get(String(r.id)) || [],
    book: pickBookRow(r, byId, byName),
    containers
  }));
}

/* ------------------------------------------------------------------ *
 * The next funding round
 * ------------------------------------------------------------------ */

/** A stored dollar figure → cents. "" / junk / negative → null. 0 is a real 0. */
function storedDollars(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

function safeObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { const p = JSON.parse(v); return p && typeof p === "object" ? p : null; } catch { return null; }
}

/**
 * The funding estimate, same precedence as matchForClient and the closer's
 * tier panel (src/http/client-detail.mjs): the number on the client's file
 * first, then the newest pull's own estimate. Unknown stays null.
 */
export function fundingEstimate(customFields = {}, crsRows = []) {
  const cf = customFields || {};
  const onFile = storedDollars(cf.total_funding_estimate);
  if (onFile !== null) return { cents: onFile, source: SOURCES.estimateField };
  const newest = [...(Array.isArray(crsRows) ? crsRows : [])]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  const result = newest ? safeObject(newest.result) : null;
  const fromPull = result ? storedDollars(result.fundingEstimate) : null;
  if (fromPull !== null) return { cents: fromPull, source: SOURCES.estimatePull };
  return { cents: null, source: null };
}

/** The next-round date staff set (Next Funding Sequence), or null. */
export function nextRoundDate(customFields = {}) {
  return parseReadyDate((customFields || {})[NEXT_SEQUENCE_READY_DATE_KEY]);
}

/**
 * buildNextRound — pure. What is left before the next round, each with its source.
 */
export function buildNextRound({
  today, customFields = {}, crsRows = [], underwrite = null, hasCreditFile = false,
  businesses = [], matchStates = null, relationships = [], canSetDate = false
} = {}) {
  const date = nextRoundDate(customFields);
  const est = fundingEstimate(customFields, crsRows);
  const walk = evaluateFundingSequence({ underwrite, businesses, matchStates });
  const gaps = [];

  if (!hasCreditFile) {
    gaps.push({ id: "no_credit_file", text: "No credit pull on file yet. UnderwriteIQ needs one to say your file is ready.", source: SOURCES.engine });
  } else if (!underwrite || underwrite.fundable !== true) {
    gaps.push({ id: "personal_not_prime", text: "Your personal credit file is not ready yet (UnderwriteIQ: not fundable). Personal comes first.", source: SOURCES.walk });
  }

  const companies = walk.steps.find((s) => s.id === "companies");
  if (companies && companies.onCompanyPath) {
    const rows = Array.isArray(businesses) ? businesses : [];
    if ((companies.blocking || []).includes("company_name_missing")) {
      gaps.push({ id: "company_name_missing", text: "A company on file has no name.", source: SOURCES.walk });
    }
    if ((companies.blocking || []).includes("company_naics_missing")) {
      const named = rows.map((b) => text(b.name)).filter(Boolean);
      const who = named.length ? andList([...new Set(named)]) : "Your company";
      gaps.push({ id: "company_naics_missing", text: `${who} has no NAICS code (industry code) on file.`, source: SOURCES.walk });
    }
  }
  const lenderStep = walk.steps.find((s) => s.id === "lender_list");
  if (lenderStep && (lenderStep.blocking || []).includes("geography_unknown")) {
    gaps.push({ id: "geography_unknown", text: "We do not know your state yet, so we cannot pick banks near you.", source: SOURCES.walk });
  }

  const by = date || today;
  for (const r of Array.isArray(relationships) ? relationships : []) {
    if (!r || r.status === "skipped") continue;
    if (r.status === "planned") {
      gaps.push({ id: `open:${r.id}`, text: `Open your account at ${r.bank}.`, source: SOURCES.staffPlan });
      continue;
    }
    if (r.opened_on && r.seasoning && r.seasoned_on && r.seasoned_on > by) {
      const have = Math.max(0, daysBetween(r.opened_on, by));
      gaps.push({
        id: `season:${r.id}`,
        text: date
          ? `${r.bank} will have ${have} of ${r.seasoning.days} days of seasoning on that day.`
          : `${r.bank} needs ${r.seasoning.days - have} more days of seasoning.`,
        source: r.seasoning.source
      });
    }
  }

  return {
    date,
    date_source: date ? SOURCES.nextSequence : null,
    can_set_date: !!canSetDate,
    estimated_amount_cents: est.cents,
    amount_source: est.source,
    step: { id: walk.currentStepId, title: walk.currentStep ? walk.currentStep.title : null, source: SOURCES.walk },
    readiness_gaps: gaps,
    ready: !!date && gaps.length === 0
  };
}

/* ------------------------------------------------------------------ *
 * Plan pins (board contract, ops/workflows/finance-os-wave5-2026-10-06.md)
 * ------------------------------------------------------------------ */

function inRange(day, from, to) {
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

const KIND_WORD = { business: "business checking", personal: "checking" };

/**
 * bankPins(relationships, { today, nextDate, from, to }) → pins.
 *
 * Dates come only from the plan, or from the bank's own rule applied to a date
 * staff set: the day staff planned to open it; the day it was opened; each
 * recorded deposit; the day the bank's seasoning period ends; and — when no
 * open day is planned but a next-round date is set — the last day to open so
 * the seasoning is done by that round. No date is made up.
 */
export function bankPins(relationships = [], { today, nextDate = null, from = null, to = null } = {}) {
  const pins = [];
  for (const r of Array.isArray(relationships) ? relationships : []) {
    if (!r || r.status === "skipped") continue;
    const word = KIND_WORD[r.account_kind] || "checking";
    const amount = r.deposit_plan_cents;
    const amountWords = moneyWords(amount);
    const base = { bank: r.bank, container_id: r.container_id || null, source: "bank-strategy" };
    if (r.opened_on) {
      pins.push({ ...base, id: `bank-strategy:open:${r.id}`, date: r.opened_on, kind: "open_account",
        title: `Opened ${word} at ${r.bank}`, detail: "Recorded by staff. This starts your banking history there.",
        amount_cents: null, status: "done" });
      for (const d of r.deposits || []) {
        pins.push({ ...base, id: `bank-strategy:deposit:${d.id}`, date: d.deposited_on, kind: "deposit",
          title: `Deposited ${moneyWords(d.amount_cents)} at ${r.bank}`, detail: "Recorded by staff.",
          amount_cents: d.amount_cents, status: "done" });
      }
      if (r.seasoning && r.seasoned_on) {
        pins.push({ ...base, id: `bank-strategy:seasoned:${r.id}`, date: r.seasoned_on, kind: "checkpoint",
          title: `${r.bank}: ${r.seasoning.days} days of seasoning`,
          detail: `The bank book says: "${r.seasoning.quote}".`,
          amount_cents: null, status: r.seasoned_on <= today ? "done" : "planned" });
      }
      continue;
    }
    /* Marked done with no open day recorded: nothing here has a date. */
    if (r.status !== "planned") continue;
    let date = r.planned_open_on;
    let detail = r.seasoning
      ? `${r.bank} wants ${r.seasoning.days}+ days of seasoning before you apply (bank book).`
      : "Builds your banking history there.";
    if (!date && nextDate && r.seasoning) {
      date = addDays(nextDate, -r.seasoning.days);
      detail = `Last day to open so ${r.bank} has ${r.seasoning.days} days of seasoning by your next round on ${nextDate}.`;
    }
    if (!date) continue;
    pins.push({ ...base, id: `bank-strategy:plan:${r.id}`, date, kind: "open_account",
      title: amountWords ? `Open ${word} at ${r.bank} and deposit ${amountWords}` : `Open ${word} at ${r.bank}`,
      detail, amount_cents: amount ?? null, status: date < today ? "missed" : "planned" });
  }
  return pins.filter((p) => inRange(p.date, from, to));
}

/**
 * roundPins({ nextDate, estimateCents, rounds, today, clientId, from, to }) → pins.
 * The next round on the Next Funding Sequence date, and each past round on the
 * day it was opened. Amounts are what the file says; unknown is null.
 */
export function roundPins({ nextDate = null, estimateCents = null, rounds = [], today, clientId = "", from = null, to = null } = {}) {
  const pins = [];
  const past = Array.isArray(rounds) ? rounds : [];
  for (const r of past) {
    const day = isoDay(r.created_at);
    if (!day) continue;
    const funded = dollarsToCents(r.funded_amount);
    const approved = dollarsToCents(r.approved_amount);
    pins.push({ id: `funding-rounds:round:${r.id}`, date: day, kind: "apply",
      title: `Funding round ${r.round_number}`,
      detail: funded !== null ? `Funded ${moneyWords(funded)}.`
        : approved !== null ? `Approved ${moneyWords(approved)}.` : `Status: ${text(r.status) || "not recorded"}.`,
      amount_cents: funded ?? approved ?? null, bank: null, container_id: null, status: "done", source: "funding-rounds" });
  }
  if (nextDate) {
    const reached = past.some((r) => isoDay(r.created_at) && isoDay(r.created_at) >= nextDate);
    const status = reached ? "done" : nextDate < today ? "missed" : "planned";
    pins.push({ id: `funding-rounds:next:${clientId}:${nextDate}`, date: nextDate, kind: "apply",
      title: "Next funding round: your file is ready",
      detail: "Date set by staff (Next Funding Sequence). Your closer gets a task that day.",
      amount_cents: estimateCents ?? null, bank: null, container_id: null, status, source: "funding-rounds" });
  }
  return pins.filter((p) => inRange(p.date, from, to));
}

/* ------------------------------------------------------------------ *
 * The read
 * ------------------------------------------------------------------ */

/* The same reads and engine calls as api/read/underwrite.mjs, for what this
   page needs from the engine: fundable, can_card_stack and the inquiry flag.
   Any failure is "no answer", never a broken page. */
export function runUnderwrite({ tradelineRows = [], liabilities = [], crsRows = [], customFields = {}, businesses = [] } = {}) {
  try {
    const { tradelines } = linesForEngine(tradelineRows, crsRows);
    if (tradelines.length === 0 && crsRows.length === 0) return { underwrite: null, hasFile: false };
    const ageOrder = [...businesses].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const adapter = toBureaus({ tradelines, liabilities, crsResults: crsRows, customFields: customFields || {}, businesses: ageOrder });
    const underwrite = applyStackedBusinessFunding(
      computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths),
      adapter.businessAges
    );
    return { underwrite, hasFile: true };
  } catch {
    return { underwrite: null, hasFile: crsRows.length > 0 };
  }
}

/** Where the client banks from, as the bank match reads it, plus the container's own info. */
export function buildLocation(summary = {}, businessInfo = new Map(), containers = []) {
  const s = summary || {};
  const states = Array.isArray(s.client_states) ? s.client_states : [];
  const infos = [];
  for (const c of Array.isArray(containers) ? containers : []) {
    if (c.kind !== "business") continue;
    const info = businessInfo.get(String(c.id));
    if (info) infos.push({ container_id: String(c.id), name: info.legal_name || c.name, city: info.city || null, state: info.state || null });
  }
  const biz = s.business_state || null;
  const fromInfo = biz ? infos.find((i) => i.state && i.state.toUpperCase() === String(biz).toUpperCase()) : null;
  let source = null;
  if (fromInfo) source = { label: `Business info for ${fromInfo.name}`, ref: "businesses.entity_data.state (src/finance/business-info.mjs)" };
  else if (biz) source = { label: "Your business on file", ref: "businesses.entity_data.state / custom_fields.business_state" };
  else if (s.home_state) source = { label: "Your home address", ref: "pii_identity.addresses / custom_fields.home_state" };
  const place = fromInfo && fromInfo.city ? `${fromInfo.city}, ${fromInfo.state}` : (states.join(" and ") || null);
  return {
    states,
    home_state: s.home_state || null,
    business_state: biz,
    businesses: infos,
    text: place,
    source,
    match_source: SOURCES.match
  };
}

const CRS_SQL = `SELECT id, result, outcome_tier, created_at FROM crs_results
  WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC`;
const TRADELINE_SQL = `SELECT * FROM tradelines WHERE client_id = $1 AND org_id = $2
  ORDER BY apr ASC NULLS LAST, lender ASC`;
const LIABILITY_SQL = `SELECT * FROM card_liabilities WHERE client_id = $1 AND org_id = $2 ORDER BY as_of DESC`;
const BUSINESS_SQL = `SELECT id, name, age_months, entity_data, created_at FROM businesses
  WHERE client_id = $1 AND org_id = $2 ORDER BY created_at ASC`;

/**
 * bankStrategy(db, { orgId, clientId, asOf }) → the GET /api/money/banks payload,
 * or null when the client is not in that org (the caller answers 404).
 * Read only. Every query carries org_id and client_id.
 */
export async function bankStrategy(db, { orgId, clientId, asOf = new Date(), match = matchForClient } = {}) {
  const asOfIso = new Date(asOf).toISOString();
  const today = asOfIso.slice(0, 10);
  const clientRes = await db.query(
    `SELECT id, first_name, last_name, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;
  const cf = safeObject(client.custom_fields) || {};

  const [matched, info, ents, rels, crs, lines, liabilities, businesses, blueprint] = await Promise.all([
    match(db, { orgId, clientId }),
    listBusinessInfo(db, { orgId, clientId }),
    db.query(`SELECT id, kind, name FROM entities
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND archived_at IS NULL ORDER BY kind, name, id`, [orgId, clientId]),
    readRelationships(db, { orgId, clientId, today }),
    db.query(CRS_SQL, [clientId, orgId]),
    db.query(TRADELINE_SQL, [clientId, orgId]),
    db.query(LIABILITY_SQL, [clientId, orgId]),
    db.query(BUSINESS_SQL, [clientId, orgId]),
    isCapitalBlueprintBuyer(db, { orgId, clientId })
  ]);
  const summary = (matched && matched.summary) || {};
  const rawMatches = (matched && matched.matches) || [];

  /* The match carries the columns the round planner needs; the relationship
     facts (account opening, minimum deposit, intro offer, book row id) come
     from the same rows, read once by id. */
  const ids = rawMatches.map((m) => m.id).filter(Boolean);
  const extra = ids.length
    ? (await db.query(
      `SELECT id, minimum_deposit, requires_account_opening, relationship_required, intro_offers, external_row_id
         FROM lenders WHERE org_id = $1::uuid AND id = ANY($2::uuid[])`, [orgId, ids])).rows
    : [];
  const extraById = new Map(extra.map((e) => [String(e.id), e]));
  const matches = rawMatches.map((m) => ({ ...m, ...(extraById.get(String(m.id)) || {}) }));

  const states = Array.isArray(summary.client_states) ? summary.client_states : [];
  const { banks, left_out: leftOut } = recommendedBanks(matches, { states });
  const inquiries = inquiriesSummary(cf, crs.rows);
  const { underwrite, hasFile } = runUnderwrite({
    tradelineRows: lines.rows, liabilities: liabilities.rows, crsRows: crs.rows, customFields: cf, businesses: businesses.rows
  });
  const stacking = cardStacking(matches, { relationships: rels, inquiries });
  stacking.held = {
    for_bureau_protection: summary.held_for_bureau_protection || null,
    for_no_business: summary.held_for_no_business || null
  };
  const engineSource = { label: "UnderwriteIQ", ref: "src/underwrite/vendor/underwriter.cjs (canCardStack, cardFunding)" };
  stacking.engine = underwrite
    ? {
      can_card_stack: !!(underwrite.personal && underwrite.personal.can_card_stack),
      card_funding_cents: dollarsToCents(underwrite.personal && underwrite.personal.card_funding),
      rule: "UnderwriteIQ can card stack when your highest card limit is at least $5,000.",
      source: engineSource
    }
    : {
      can_card_stack: null,
      card_funding_cents: null,
      rule: "No credit pull on file yet, so UnderwriteIQ cannot say if you can card stack.",
      source: engineSource
    };
  stacking.inquiries = {
    total: inquiries.total,
    by_bureau: inquiries.by_bureau,
    text: inquiries.total === null
      ? "Your inquiry count: not on file yet."
      : `You have ${inquiries.total} inquir${inquiries.total === 1 ? "y" : "ies"} now. Each new card adds a hard pull.`,
    source: SOURCES.creditFile,
    rule: { text: INQUIRY_RULE, source: SOURCES.ownerInquiries },
    /* The engine says the same thing on its own: any inquiry → cleanup. Null when
       there is no file for the engine to read. */
    needs_cleanup: underwrite && underwrite.optimization ? !!underwrite.optimization.needs_inquiry_cleanup : null,
    needs_cleanup_source: SOURCES.inquiryFlag
  };

  const nextRound = buildNextRound({
    today, customFields: cf, crsRows: crs.rows, underwrite, hasCreditFile: hasFile,
    businesses: businesses.rows,
    matchStates: { home: summary.home_state || null, business: summary.business_state || null, states },
    relationships: rels, canSetDate: blueprint
  });

  const name = [client.first_name, client.last_name].map(text).filter(Boolean).join(" ") || null;
  return {
    ok: true,
    client: { id: client.id, name },
    as_of: asOfIso,
    location: buildLocation(summary, info, ents.rows),
    containers: ents.rows.map((e) => ({ id: e.id, kind: e.kind, name: e.name })),
    recommended_banks: banks,
    banks_left_out: leftOut,
    card_stacking: stacking,
    next_round: nextRound,
    relationships: rels,
    not_set: notSetList({ nextRound, relationships: rels, stacking })
  };
}

/** The staff-set values that are still empty — said out loud, never filled in. */
export function notSetList({ nextRound, relationships = [], stacking }) {
  const out = [];
  if (nextRound && !nextRound.date) out.push({ key: "next_round_date", text: "Next round date" });
  if (nextRound && nextRound.estimated_amount_cents === null) out.push({ key: "funding_estimate", text: "Funding estimate (needs a credit pull)" });
  for (const r of relationships) {
    if (r.status !== "planned") continue;
    if (!r.planned_open_on) out.push({ key: `open_date:${r.id}`, text: `Day to open at ${r.bank}` });
    if (r.deposit_plan_cents === null) out.push({ key: `deposit:${r.id}`, text: `Deposit amount at ${r.bank}` });
  }
  if (stacking && stacking.spacing && stacking.spacing.days_between === null) {
    out.push({ key: "stacking_days_between", text: "Days between card applications at two banks" });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Staff writes (POST /api/money/banks)
 * ------------------------------------------------------------------ */

export class BankStrategyInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => { throw new BankStrategyInputError(code, message); };

function readBankName(v) {
  const s = text(v);
  if (!s) fail("bank_required", "Type the bank's name.");
  if (s.length > 120) fail("bank_too_long", "The bank's name must be 120 characters or fewer.");
  return s;
}
function readKind(v) {
  const k = text(v) ? String(v).trim().toLowerCase() : "business";
  if (k !== "business" && k !== "personal") fail("invalid_account_kind", "Account kind must be business or personal.");
  return k;
}
const FIELD_WORDS = {
  planned_open_on: "The day to open",
  opened_on: "The day it was opened",
  deposited_on: "The deposit day"
};
function readDay(v, field, { required = false, today = null } = {}) {
  const words = FIELD_WORDS[field] || field;
  if (v === null || v === undefined || String(v).trim() === "") {
    if (required) fail(`${field}_required`, `${words} is required, like 2026-10-20.`);
    return null;
  }
  const d = parseReadyDate(v);
  if (!d) fail(`invalid_${field}`, `${words} must be a date like 2026-10-20.`);
  if (today && d > today) fail(`${field}_in_future`, `${words} cannot be in the future.`);
  return d;
}
function readCents(v, field, { positive = false } = {}) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || (positive && n === 0)) {
    fail(`invalid_${field}`, positive ? "The amount must be more than $0." : "The amount must be $0 or more.");
  }
  return n;
}
function readNote(v) {
  const s = text(v);
  if (s && s.length > 500) fail("note_too_long", "Notes must be 500 characters or fewer.");
  return s;
}

async function lenderInOrg(db, orgId, lenderId) {
  if (!lenderId) return null;
  if (!isUuid(lenderId)) fail("invalid_lender_id", "lender_id must be a uuid.");
  const r = await db.query(`SELECT id, name FROM lenders WHERE id = $1::uuid AND org_id = $2::uuid`, [lenderId, orgId]);
  if (!r.rows[0]) fail("lender_not_found", "That bank is not in this company's bank book.");
  return r.rows[0];
}
async function containerOfClient(db, orgId, clientId, containerId) {
  if (!containerId) return null;
  if (!isUuid(containerId)) fail("invalid_container_id", "container_id must be a uuid.");
  const r = await db.query(
    `SELECT id, kind FROM entities
      WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid AND archived_at IS NULL`,
    [containerId, orgId, clientId]);
  if (!r.rows[0]) fail("container_not_found", "That container is not on this client's file.");
  return r.rows[0];
}
async function ownedRelationship(db, orgId, clientId, relationshipId) {
  if (!isUuid(relationshipId)) fail("invalid_relationship_id", "relationship_id must be a uuid.");
  const r = await db.query(
    `SELECT id, state, opened_on::text AS opened_on, bank_key, bank_name FROM blueprint_bank_relationship_todos
      WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`, [relationshipId, orgId, clientId]);
  return r.rows[0] || null;
}

/**
 * planBank — a relationship step on the plan: which bank, which container, the
 * day to open (staff-set) and how much to deposit (staff-set). One row per
 * client + bank + account kind, the unique key 403 set. Planning a bank that was
 * skipped puts it back on the plan.
 * A field left out keeps what is stored; a field sent as null clears it.
 */
export async function planBank(db, { orgId, clientId, input = {} }) {
  const lender = await lenderInOrg(db, orgId, input.lender_id || null);
  const name = readBankName(input.bank ?? input.bank_name ?? (lender ? lender.name : null));
  const kind = readKind(input.account_kind);
  await containerOfClient(db, orgId, clientId, input.container_id || null);
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  const plannedOn = readDay(input.planned_open_on, "planned_open_on");
  const plannedCents = readCents(input.planned_deposit_cents, "planned_deposit_cents");
  const notes = readNote(input.notes);
  const r = await db.query(
    `INSERT INTO blueprint_bank_relationship_todos AS t
       (org_id, client_id, bank_key, account_kind, bank_name, lender_id, entity_id,
        planned_open_on, planned_deposit_cents, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (client_id, bank_key, account_kind) DO UPDATE SET
       bank_name = EXCLUDED.bank_name,
       lender_id = COALESCE(EXCLUDED.lender_id, t.lender_id),
       entity_id = COALESCE(EXCLUDED.entity_id, t.entity_id),
       planned_open_on = CASE WHEN $11 THEN EXCLUDED.planned_open_on ELSE t.planned_open_on END,
       planned_deposit_cents = CASE WHEN $12 THEN EXCLUDED.planned_deposit_cents ELSE t.planned_deposit_cents END,
       notes = COALESCE(EXCLUDED.notes, t.notes),
       state = CASE WHEN t.state = 'skipped' THEN 'open' ELSE t.state END,
       updated_at = now()
     RETURNING id, state`,
    [orgId, clientId, name.toLowerCase(), kind, name, lender ? lender.id : null, input.container_id || null,
      plannedOn, plannedCents, notes, has("planned_open_on"), has("planned_deposit_cents")]
  );
  return { ok: true, id: r.rows[0].id, state: r.rows[0].state };
}

/** openAccount — the client really opened it, on this day. Marks the row done. */
export async function openAccount(db, { orgId, clientId, input = {}, today }) {
  const openedOn = readDay(input.opened_on, "opened_on", { required: true, today });
  if (input.relationship_id) {
    const row = await ownedRelationship(db, orgId, clientId, input.relationship_id);
    if (!row) return { ok: false, error: "not_found" };
    await db.query(
      `UPDATE blueprint_bank_relationship_todos SET opened_on = $4::date, state = 'done', updated_at = now()
        WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`,
      [row.id, orgId, clientId, openedOn]);
    return { ok: true, id: row.id };
  }
  const lender = await lenderInOrg(db, orgId, input.lender_id || null);
  const name = readBankName(input.bank ?? input.bank_name ?? (lender ? lender.name : null));
  const kind = readKind(input.account_kind);
  await containerOfClient(db, orgId, clientId, input.container_id || null);
  const r = await db.query(
    `INSERT INTO blueprint_bank_relationship_todos AS t
       (org_id, client_id, bank_key, account_kind, bank_name, lender_id, entity_id, opened_on, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'done')
     ON CONFLICT (client_id, bank_key, account_kind) DO UPDATE SET
       bank_name = EXCLUDED.bank_name,
       lender_id = COALESCE(EXCLUDED.lender_id, t.lender_id),
       entity_id = COALESCE(EXCLUDED.entity_id, t.entity_id),
       opened_on = EXCLUDED.opened_on,
       state = 'done',
       updated_at = now()
     RETURNING id`,
    [orgId, clientId, name.toLowerCase(), kind, name, lender ? lender.id : null, input.container_id || null, openedOn]);
  return { ok: true, id: r.rows[0].id };
}

/**
 * recordDeposit — one deposit staff saw land. Needs an opened account; the
 * deposit cannot be dated before the account was opened or after today.
 */
export async function recordDeposit(db, { orgId, clientId, input = {}, staffId = null, today }) {
  const row = await ownedRelationship(db, orgId, clientId, input.relationship_id);
  if (!row) return { ok: false, error: "not_found" };
  if (!row.opened_on) fail("not_opened", "Record that the account was opened first. Then add deposits.");
  const cents = readCents(input.amount_cents, "amount_cents", { positive: true });
  if (cents === null) fail("amount_cents_required", "Type the amount deposited.");
  const day = readDay(input.deposited_on, "deposited_on", { required: true, today });
  if (day < row.opened_on) fail("deposit_before_open", "A deposit cannot be dated before the account was opened.");
  const r = await db.query(
    `INSERT INTO bank_relationship_deposits (org_id, client_id, relationship_id, amount_cents, deposited_on, note, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [orgId, clientId, row.id, cents, day, readNote(input.note), isUuid(staffId) ? staffId : null]);
  return { ok: true, id: r.rows[0].id };
}

/** setRelationshipState — skip a bank, or put it back on the plan. Reuses the 403 writer. */
export async function setRelationshipState(db, { orgId, clientId, input = {} }) {
  const state = String(input.state || "").trim().toLowerCase();
  if (state !== "skipped" && state !== "open") fail("invalid_state", "State must be skipped or open.");
  const row = await ownedRelationship(db, orgId, clientId, input.relationship_id);
  if (!row) return { ok: false, error: "not_found" };
  if (state === "open" && row.opened_on) fail("already_opened", "This account is already open.");
  return updateBankRelationshipTodoState(db, { orgId, todoId: row.id, state });
}

/** setNextRoundDate — the Next Funding Sequence date, through its own writer (Blueprint buyers only). */
export async function setNextRoundDate(db, { orgId, clientId, input = {} }) {
  return setNextFundingSequenceReadyDate(db, { orgId, clientId, readyDate: input.ready_date });
}

export default bankStrategy;
