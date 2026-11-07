// Apply gate, seasoning clock and approval odds — Finance OS wave 3, unit L4.
// GET /api/money/banks?view=apply_gate  ·  POST /api/money/banks {action: "set_apply_override"}
//
// Owner calls (Chris, 2026-11-07; board ops/workflows/finance-os-cfo-build-2026-11-06.txt,
// OWNER CALLS part 3):
//   * Seasoning: "the clock runs per opened account; at 30 days the client sees
//     'Congrats. Your <bank> account is seasoned.' 60 and 90 days are better
//     ('the more seasoning, the better')."
//   * Apply gate: "even after 30 days, applying stays LOCKED unless UnderwriteIQ
//     says fundable, inquiries are clean, and the account is seasoned ('we
//     gatekeep them... otherwise they're going to fuck it up')."
//   * Application limits: "the bank book's Bank of America '2 cards in 30 days'
//     is guidance, not a hard block. With a large deposit at Bank of America,
//     4 cards in 1 day is possible. Show the book's limit; staff decide."
//
// THREE ANSWERS ON ONE READ
//   gate       "Can you apply yet?" Three checks, and every one must be true:
//                fundable      UnderwriteIQ's own fundable gate (fundability.now.tier,
//                              src/finance/fundability.mjs — the engine's uw.fundable)
//                no_inquiries  UnderwriteIQ's inquiry check (fundability factor
//                              no_inquiries — optimization.needs_inquiry_cleanup)
//                seasoned      at least one bank account on the client's plan has been
//                              open 30+ days (owner rule; open day from the bank
//                              relationship tracker, readRelationships in
//                              src/finance/bank-strategy.mjs — read only)
//              An unknown is never a pass, so an unknown keeps the gate locked.
//              The bank book's application limits ride along as GUIDANCE: they
//              never lock the gate on their own.
//   seasoning  one clock per opened account on the plan: day N of 30, with 60 and
//              90 marked as better, and the congrats line at 30.
//   odds       one line per bank on Giovanni's list (lenders.active, through the
//              bank match matchForClient: state-gated, bureau-protected,
//              business-gated, in the match's own order):
//                not_yet  the file is not ready: UnderwriteIQ does not say fundable,
//                         or inquiries are not clean (or either is unknown)
//                wait     the file is ready, but this bank is not: its account is not
//                         open or not seasoned yet (the bank book says it wants an
//                         account), the gate's first seasoned account is not there
//                         yet (a bank that wants no account), or the bank book's
//                         application limit is reached and staff have not allowed
//                         more
//                ready    every check is green for this bank
//              "Ready" is the gate, never a promise of approval. No dollar figure
//              is printed here: UnderwriteIQ is the only source for funding
//              dollars, and its figure lives on the Fundability page.
//
// APPLICATION LIMITS come from the bank's own words in the bank book
// (lenders.stated_requirements / insider_tips), read, never assumed:
//   "Max of 2 card approvals within 30 days."           (Bank of America)
//   "Max of 3 card approvals within a year."            (Bank of America)
//   "no more than two approvals within a rolling 65-day window" (Citi)
//   "Citi card approval every eight days"               (Citi)
// The client's approvals at that bank are counted from `applications`
// (status 'Approved', the bank's answer, dated by status_updated_date) — card
// approvals only, because every limit the book states is about cards. When the
// count reaches the book's number, the bank reads "wait" until the oldest
// approval in the window ages out, and staff can allow more
// (apply_gate_overrides, migration 577). An override lifts that limit only.
//
// RULES THIS FILE KEEPS
//   * Unknown is null, never 0. A day nobody recorded is never guessed.
//   * Every reason carries a `source` saying where its rule is written down.
//   * Read only, except setApplyOverride (staff only, append only).
//   * Every query carries org_id and client_id. Demo rows are left out.
//   * Logos are never drawn. buildApplyGate() keeps the bank book's logo_path;
//     applyGate() adds `logo` from the shared lookup (src/banking/institution-logos.mjs
//     findLogos: Plaid first, then the bank book, else null and the name only).

import { fundability as readFundability, addMonths } from "./fundability.mjs";
import {
  readRelationships, relationshipSignals, seasoningRule, isoDay, addDays, daysBetween, bookSource
} from "./bank-strategy.mjs";
import { matchForClient } from "../lenders/store.mjs";
import { isBusinessLenderTable, isPersonalLenderTable } from "../lenders/tables.mjs";
import { findLogos } from "../banking/institution-logos.mjs";

/* ------------------------------------------------------------------ *
 * The owner's numbers
 * ------------------------------------------------------------------ */

/** Owner rule, 2026-11-07: an account is seasoned at 30 days. */
export const SEASON_DAYS = 30;
/** Owner rule, 2026-11-07: "60 and 90 days are better." Marked on the clock. */
export const BETTER_DAYS = Object.freeze([60, 90]);
/** How far back approvals are read. The longest limit the book states is 2 years. */
export const APPROVAL_LOOKBACK_MONTHS = 36;

const CARD_TABLES = new Set(["PersonalCC", "OnlineBizCC", "InBranchBizCC"]);

export const SOURCES = Object.freeze({
  owner: Object.freeze({
    label: "Owner rule, 2026-11-07",
    ref: "ops/workflows/finance-os-cfo-build-2026-11-06.txt · OWNER CALLS, part 3"
  }),
  engine: Object.freeze({
    label: "UnderwriteIQ",
    ref: "src/finance/fundability.mjs · now.tier (uw.fundable)"
  }),
  inquiries: Object.freeze({
    label: "UnderwriteIQ",
    ref: "src/finance/fundability.mjs · factor no_inquiries (optimization.needs_inquiry_cleanup)"
  }),
  tracker: Object.freeze({
    label: "Your bank plan",
    ref: "blueprint_bank_relationship_todos.opened_on (461), readRelationships in src/finance/bank-strategy.mjs"
  }),
  approvals: Object.freeze({
    label: "Your applications",
    ref: "applications.status = 'Approved' · status_updated_date"
  }),
  override: Object.freeze({
    label: "Set by your Fundhub team",
    ref: "apply_gate_overrides (577)"
  })
});

export const READY_IS_NOT_A_PROMISE = "Ready means every check is green. It is not a promise of approval.";
export const LIMIT_IS_GUIDANCE = "A large deposit can allow more. Your Fundhub team decides.";

/* ------------------------------------------------------------------ *
 * Small readers
 * ------------------------------------------------------------------ */

function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
}

/** The tracker's own key for a bank: its name, lower case (planBank in bank-strategy). */
export function bankKey(name) {
  const t = text(name);
  return t ? t.toLowerCase() : null;
}

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

/** "Jan 6, 2027" from YYYY-MM-DD. Null stays null. */
export function niceDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** A logo file the bank book points at, or null. Only our own lender logo files. */
export function safeLogo(path) {
  const p = text(path);
  return p && /^\/assets\/lenders\/[A-Za-z0-9._-]+\.(png|svg|jpg|jpeg|webp)$/i.test(p) ? p : null;
}

/* ------------------------------------------------------------------ *
 * The bank book's application limits
 * ------------------------------------------------------------------ */

const NUM_WORDS = Object.freeze({
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12
});

function readCount(v) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (/^\d{1,3}$/.test(s)) return Number(s);
  return Object.prototype.hasOwnProperty.call(NUM_WORDS, s) ? NUM_WORDS[s] : null;
}

function unitOf(word) {
  const w = String(word || "").toLowerCase();
  if (w.startsWith("day")) return "day";
  if (w.startsWith("week")) return "week";
  if (w.startsWith("month")) return "month";
  if (w.startsWith("year")) return "year";
  return null;
}

const N = "(\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const LIMIT_PATTERNS = [
  /* "Max of 2 card approvals within 30 days." / "Max of 3 card approvals within a year." */
  { re: new RegExp(`\\bmax(?:imum)?\\s+(?:of\\s+)?${N}\\s+(?:card\\s+)?approvals?\\s+(?:within|in)\\s+(?:a\\s+(?:rolling\\s+)?)?${N}?\\s*-?\\s*(days?|weeks?|months?|years?)\\b`, "i"),
    read: (m) => ({ max: readCount(m[1]), amount: m[2] ? readCount(m[2]) : 1, unit: unitOf(m[3]) }) },
  /* "no more than two approvals within a rolling 65-day window" */
  { re: new RegExp(`\\bno\\s+more\\s+than\\s+${N}\\s+(?:card\\s+)?approvals?\\s+(?:within|in)\\s+(?:a\\s+)?(?:rolling\\s+)?${N}\\s*-?\\s*(days?|weeks?|months?|years?)\\b`, "i"),
    read: (m) => ({ max: readCount(m[1]), amount: readCount(m[2]), unit: unitOf(m[3]) }) },
  /* "Citi card approval every eight days" */
  { re: new RegExp(`\\b(?:card\\s+)?approval\\s+every\\s+${N}\\s+(days?|weeks?|months?)\\b`, "i"),
    read: (m) => ({ max: 1, amount: readCount(m[1]), unit: unitOf(m[2]) }) }
];

/** The book's own clauses (stated requirements first), split as bank-strategy splits them. */
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

/** "30 days", "a year", "2 years" — the window said out loud. */
export function windowWords(limit) {
  if (!limit) return null;
  const { amount, unit } = limit;
  if (amount === 1) return unit === "day" ? "1 day" : `a ${unit}`;
  return `${amount} ${unit}s`;
}

/**
 * applicationLimits(lender) → [{ max, amount, unit, kind: "cards", quote, field }]
 * Every limit the bank's own words state, once each, in the book's order.
 */
export function applicationLimits(lender) {
  const out = [];
  const seen = new Set();
  for (const c of clauses(lender)) {
    for (const p of LIMIT_PATTERNS) {
      const m = p.re.exec(c.text);
      if (!m) continue;
      const lim = p.read(m);
      if (!isNum(lim.max) || lim.max < 1 || !isNum(lim.amount) || lim.amount < 1 || !lim.unit) continue;
      const key = `${lim.max}/${lim.amount}/${lim.unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...lim, kind: "cards", quote: c.text.slice(0, 200), field: c.field });
    }
  }
  return out;
}

/** The first day still inside the window ending today: an approval counts when it is after this day. */
export function windowStart(today, limit) {
  if (!today || !limit) return null;
  if (limit.unit === "day") return addDays(today, -limit.amount);
  if (limit.unit === "week") return addDays(today, -7 * limit.amount);
  if (limit.unit === "month") return addMonths(today, -limit.amount);
  if (limit.unit === "year") return addMonths(today, -12 * limit.amount);
  return null;
}

/** The day an approval made on `day` leaves the window. */
export function windowEnd(day, limit) {
  if (!day || !limit) return null;
  if (limit.unit === "day") return addDays(day, limit.amount);
  if (limit.unit === "week") return addDays(day, 7 * limit.amount);
  if (limit.unit === "month") return addMonths(day, limit.amount);
  if (limit.unit === "year") return addMonths(day, 12 * limit.amount);
  return null;
}

/**
 * limitStatus(limit, approvalDays, today) → { in_window, reached, frees_on }
 * approvalDays: YYYY-MM-DD of each card approval at this bank.
 */
export function limitStatus(limit, approvalDays = [], today) {
  const start = windowStart(today, limit);
  const inWin = (Array.isArray(approvalDays) ? approvalDays : [])
    .filter((d) => typeof d === "string" && start && d > start && d <= today)
    .sort();
  const reached = inWin.length >= limit.max;
  /* To drop below the limit, the oldest (count - max + 1) approvals must age out;
     the last of those decides the day. */
  const frees = reached ? windowEnd(inWin[inWin.length - limit.max], limit) : null;
  return { in_window: inWin.length, reached, frees_on: frees };
}

/* ------------------------------------------------------------------ *
 * The seasoning clock
 * ------------------------------------------------------------------ */

/**
 * seasoningClock(rel, { today, bookDays }) → one clock, or null for a skipped row.
 *
 * rel: one readRelationships() line. bookDays: the bank book's own seasoning
 * days for this bank, when it states one.
 *
 * milestone
 *   not_opened   on the plan, not opened yet — the clock starts the day it opens
 *   day_unknown  open, but the day it opened is not recorded — nothing is counted
 *   seasoning    fewer than 30 days
 *   seasoned     30 to 59 days
 *   seasoned_60  60 to 89 days
 *   seasoned_90  90 days or more
 */
export function seasoningClock(rel, { today, bookDays = null } = {}) {
  if (!rel || rel.status === "skipped") return null;
  const bank = text(rel.bank) || text(rel.bank_key) || "Your bank";
  const opened = isoDay(rel.opened_on);
  const base = {
    relationship_id: rel.id || null,
    bank,
    bank_key: bankKey(rel.bank_key || rel.bank),
    account_kind: text(rel.account_kind),
    lender_id: rel.lender_id || null,
    logo_path: safeLogo(rel.logo_path),
    opened_on: opened,
    target_days: SEASON_DAYS,
    better_days: [...BETTER_DAYS],
    book_days: isNum(bookDays) && bookDays > 0 ? bookDays : null,
    source: SOURCES.tracker
  };
  if (!opened) {
    if (rel.status === "open") {
      return { ...base, day: null, milestone: "day_unknown", seasoned: null, seasoned_on: null, next_mark: null,
        congrats: null,
        text: `Your ${bank} account is open, but the day it opened is not recorded yet, so the clock cannot start. Your Fundhub team records it.` };
    }
    return { ...base, day: null, milestone: "not_opened", seasoned: false, seasoned_on: null, next_mark: null,
      congrats: null, text: `Not open yet. The clock starts the day you open your ${bank} account.` };
  }
  const day = Math.max(0, daysBetween(opened, today));
  const seasonedOn = addDays(opened, SEASON_DAYS);
  const congrats = day >= SEASON_DAYS ? `Congrats. Your ${bank} account is seasoned.` : null;
  let milestone;
  let next = null;
  let words;
  if (day < SEASON_DAYS) {
    milestone = "seasoning";
    next = { days: SEASON_DAYS, on: seasonedOn };
    words = `Day ${day} of ${SEASON_DAYS}. Seasoned on ${niceDay(seasonedOn)}.`;
  } else if (day < BETTER_DAYS[0]) {
    milestone = "seasoned";
    next = { days: BETTER_DAYS[0], on: addDays(opened, BETTER_DAYS[0]) };
    words = `Day ${day}. ${BETTER_DAYS[0]} days is even better, on ${niceDay(next.on)}.`;
  } else if (day < BETTER_DAYS[1]) {
    milestone = "seasoned_60";
    next = { days: BETTER_DAYS[1], on: addDays(opened, BETTER_DAYS[1]) };
    words = `Day ${day}. ${BETTER_DAYS[1]} days is even better, on ${niceDay(next.on)}.`;
  } else {
    milestone = "seasoned_90";
    words = `Day ${day}. ${BETTER_DAYS[1]}+ days. The more seasoning, the better.`;
  }
  return { ...base, day, milestone, seasoned: day >= SEASON_DAYS, seasoned_on: seasonedOn, next_mark: next,
    congrats, text: words };
}

/** The best clock for one bank: the account open longest wins; an unknown day loses to a known one. */
function bestClock(clocks = []) {
  let best = null;
  for (const c of clocks) {
    if (!c) continue;
    if (!best) { best = c; continue; }
    const a = isNum(c.day) ? c.day : -1;
    const b = isNum(best.day) ? best.day : -1;
    if (a > b || (a === b && c.milestone === "day_unknown" && best.milestone === "not_opened")) best = c;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

function factor(fund, key) {
  const list = fund && fund.now && Array.isArray(fund.now.factors) ? fund.now.factors : [];
  return list.find((f) => f && f.key === key) || null;
}

/** The gate components the engine's fundable flag is made of, named when they fail. */
const FUNDABLE_PARTS = ["score_700", "utilization_30", "no_negatives"];

/**
 * gateChecks({ fundability, clocks }) → { status, checks }
 * status "open" only when all three checks are true. Unknown keeps it locked.
 */
export function gateChecks({ fundability: fund, clocks = [] } = {}) {
  const hasPull = !!(fund && fund.has_pull);
  const tier = fund && fund.now ? fund.now.tier : null;

  /* 1. Fundable — the engine's own gate, as fundability.mjs reads it. */
  let fundable;
  let fundableText;
  if (!hasPull) {
    fundable = null;
    fundableText = "No credit pull on file yet. UnderwriteIQ reads your file after your soft pull.";
  } else if (tier === "fundable") {
    fundable = true;
    fundableText = "UnderwriteIQ says your file is fundable.";
  } else if (tier === "not_fundable") {
    fundable = false;
    const misses = FUNDABLE_PARTS.map((k) => factor(fund, k)).filter((f) => f && f.passed === false).map((f) => f.label);
    fundableText = misses.length
      ? `UnderwriteIQ says not yet. Still to do: ${misses.join(", ")}.`
      : "UnderwriteIQ says your file is not fundable yet.";
  } else {
    fundable = null;
    fundableText = "UnderwriteIQ cannot tell yet. A number it needs is not on file.";
  }

  /* 2. Inquiries clean — the engine's own inquiry check. */
  const inq = factor(fund, "no_inquiries");
  let clean;
  let cleanText;
  if (!hasPull || !inq || inq.passed === null || inq.passed === undefined) {
    clean = null;
    cleanText = "Your hard inquiry count is not on file yet.";
  } else if (inq.passed === true) {
    clean = true;
    cleanText = "No hard inquiries on your file.";
  } else {
    clean = false;
    const n = isNum(inq.value) ? inq.value : null;
    cleanText = n === null
      ? "Hard inquiries are on your file. They come off before you apply."
      : `${n} hard ${n === 1 ? "inquiry is" : "inquiries are"} on your file. They come off before you apply.`;
  }

  /* 3. Seasoned — at least one bank account on the plan open 30+ days. */
  const live = clocks.filter(Boolean);
  const seasonedOnes = live.filter((c) => c.seasoned === true);
  let seasoned;
  let seasonedText;
  if (seasonedOnes.length) {
    seasoned = true;
    const names = [...new Set(seasonedOnes.map((c) => c.bank))];
    seasonedText = `Your ${names.join(" and ")} ${names.length === 1 ? "account is" : "accounts are"} seasoned ${SEASON_DAYS}+ days.`;
  } else {
    const counting = live.filter((c) => c.milestone === "seasoning").sort((a, b) => b.day - a.day)[0];
    const unknown = live.find((c) => c.milestone === "day_unknown");
    if (counting) {
      seasoned = false;
      seasonedText = `Your ${counting.bank} account is on day ${counting.day} of ${SEASON_DAYS}. Seasoned on ${niceDay(counting.seasoned_on)}.`;
    } else if (unknown) {
      seasoned = null;
      seasonedText = unknown.text;
    } else if (live.length) {
      seasoned = false;
      seasonedText = `Open your ${live[0].bank} account and leave money in it ${SEASON_DAYS} days.`;
    } else {
      seasoned = false;
      seasonedText = `No bank account on your plan is open yet. Open one and leave money in it ${SEASON_DAYS} days.`;
    }
  }

  const checks = [
    { key: "fundable", label: "UnderwriteIQ says fundable", passed: fundable, text: fundableText, source: SOURCES.engine },
    { key: "no_inquiries", label: "No hard inquiries", passed: clean, text: cleanText, source: SOURCES.inquiries },
    { key: "seasoned", label: `A bank account seasoned ${SEASON_DAYS}+ days`, passed: seasoned, text: seasonedText,
      source: SOURCES.owner }
  ];
  return { status: checks.every((c) => c.passed === true) ? "open" : "locked", checks };
}

/* ------------------------------------------------------------------ *
 * Approval odds per bank
 * ------------------------------------------------------------------ */

/** One entry per bank name, in the match's own order; the bank's other rows ride along. */
export function groupBanks(matches = [], extraById = new Map()) {
  const out = [];
  const at = new Map();
  for (const m of Array.isArray(matches) ? matches : []) {
    if (!m || !m.name) continue;
    const row = { ...m, ...(extraById.get(String(m.id)) || {}) };
    const key = bankKey(m.name);
    if (at.has(key)) { at.get(key).rows.push(row); continue; }
    const g = { key, name: text(m.name), rows: [row] };
    at.set(key, g);
    out.push(g);
  }
  return out;
}

function productName(m) {
  const n = text(m.product_name);
  return n && /[a-z]{3}/i.test(n) && !/^\W|\)$/.test(n) ? n : null;
}

function kindOf(rows) {
  const p = rows.some((r) => isPersonalLenderTable(r.lender_table));
  const b = rows.some((r) => isBusinessLenderTable(r.lender_table));
  return p && b ? "both" : (b ? "business" : (p ? "personal" : null));
}

function limitWords(bank, lim) {
  return `The bank book says up to ${lim.max} card ${lim.max === 1 ? "approval" : "approvals"} in ${windowWords(lim)} at ${bank}.`;
}

/**
 * oddsForBank(group, ctx) → one odds line.
 * ctx = { today, gate, clocks (this bank's), approvals (this bank's card approval days),
 *         override (newest staff decision for this bank, or null), viewer }
 */
export function oddsForBank(group, { today, gate, clocks = [], approvals = [], override = null, viewer = "client" } = {}) {
  const rows = group.rows || [];
  const name = group.name;
  const relRow = rows.find((r) => relationshipSignals(r).is_relationship_bank) || null;
  const seasonRow = rows.find((r) => seasoningRule(r)) || null;
  const bookDays = seasonRow ? seasoningRule(seasonRow).days : null;
  const needDays = Math.max(SEASON_DAYS, bookDays || 0);
  const limits = [];
  const seenLimit = new Set();
  for (const r of rows) {
    for (const lim of applicationLimits(r)) {
      const k = `${lim.max}/${lim.amount}/${lim.unit}`;
      if (seenLimit.has(k)) continue;
      seenLimit.add(k);
      limits.push({ ...lim, source: bookSource(r, lim.field) });
    }
  }
  const check = (k) => (gate.checks.find((c) => c.key === k) || {}).passed;
  const fundable = check("fundable");
  const clean = check("no_inquiries");
  const firstSeasoned = check("seasoned");
  const reasons = [];
  let status;
  let readyOn = null;

  if (fundable !== true || clean !== true) {
    status = "not_yet";
    for (const c of gate.checks) {
      if ((c.key === "fundable" || c.key === "no_inquiries") && c.passed !== true) reasons.push({ text: c.text, source: c.source });
    }
  } else {
    status = "ready";
    const clock = bestClock(clocks);
    if (relRow) {
      const signal = relationshipSignals(relRow);
      const bookRef = bookSource(relRow, signal.seasoning ? signal.seasoning.field
        : (signal.account ? "requires_account_opening" : (signal.relationship ? "relationship_required" : "minimum_deposit")));
      if (!clock || clock.milestone === "not_opened") {
        status = "wait";
        reasons.push({ text: `Open your ${name} account first. Then leave money in it ${needDays} days.`, source: bookRef });
      } else if (clock.milestone === "day_unknown") {
        status = "wait";
        reasons.push({ text: clock.text, source: SOURCES.tracker });
      } else if (clock.day < needDays) {
        status = "wait";
        readyOn = addDays(clock.opened_on, needDays);
        reasons.push({
          text: `Your ${name} account is on day ${clock.day} of ${needDays}. Seasoned on ${niceDay(readyOn)}.`,
          source: bookDays && bookDays > SEASON_DAYS ? bookSource(seasonRow, seasoningRule(seasonRow).field) : SOURCES.owner
        });
      }
    } else if (firstSeasoned !== true) {
      status = "wait";
      reasons.push({ text: `Applying opens when your first bank account is seasoned ${SEASON_DAYS} days.`, source: SOURCES.owner });
    }

    const allow = override && override.allow_more === true;
    for (const lim of limits) {
      const st = limitStatus(lim, approvals, today);
      lim.in_window = st.in_window;
      lim.reached = st.reached;
      lim.frees_on = st.frees_on;
      if (!st.reached) continue;
      if (allow) {
        reasons.push({ text: `Your Fundhub team cleared more applications at ${name}.`, source: SOURCES.override });
        continue;
      }
      status = "wait";
      if (st.frees_on && (!readyOn || st.frees_on > readyOn)) readyOn = st.frees_on;
      reasons.push({
        text: `${limitWords(name, lim)} You have ${st.in_window} approved there. ${LIMIT_IS_GUIDANCE}`,
        source: lim.source
      });
    }
    if (status === "ready") {
      reasons.unshift({
        text: relRow
          ? `Your file is fundable, inquiries are clean, and your ${name} account is seasoned.`
          : "Your file is fundable, inquiries are clean, and your first bank account is seasoned.",
        source: SOURCES.owner
      });
    }
  }

  const products = [...new Set(rows.map(productName).filter(Boolean))];
  const logo = rows.map((r) => safeLogo(r.logo_path)).find(Boolean) || null;
  return {
    bank: name,
    bank_key: group.key,
    lender_id: rows[0].id || null,
    logo_path: logo,
    kind: kindOf(rows),
    products,
    wants_account: !!relRow,
    book_seasoning_days: bookDays,
    status,
    ready_on: status === "ready" ? null : readyOn,
    reasons,
    limits: limits.map((l) => ({
      text: limitWords(name, l),
      quote: l.quote,
      max: l.max,
      window: { amount: l.amount, unit: l.unit },
      in_window: isNum(l.in_window) ? l.in_window : null,
      reached: l.reached === true,
      frees_on: l.frees_on || null,
      source: l.source
    })),
    override: override
      ? {
        allow_more: override.allow_more === true,
        set_on: isoDay(override.created_at),
        /* The note is staff's own words for staff. The client never reads it. */
        note: viewer === "staff" ? text(override.note) : null,
        source: SOURCES.override
      }
      : null
  };
}

/* ------------------------------------------------------------------ *
 * The whole payload — pure
 * ------------------------------------------------------------------ */

/**
 * buildApplyGate({ today, fundability, matches, extra, relationships, approvals, overrides, viewer, asOf })
 *
 * fundability   the GET /api/money/fundability payload (src/finance/fundability.mjs)
 * matches       matchForClient(...).matches (Giovanni's list, active, state-gated)
 * extra         lenders rows by id/name: logo_path, minimum_deposit, requires_account_opening,
 *               relationship_required, external_row_id, stated_requirements, insider_tips
 * relationships readRelationships(...) lines
 * approvals     [{ lender_id, bank, lender_table, decided_on }] — status 'Approved' rows
 * overrides     [{ bank_key, bank_name, allow_more, note, created_at }] — newest first per bank
 */
export function buildApplyGate({
  today, asOf = null, fundability: fund = null, matches = [], extra = [], relationships = [],
  approvals = [], overrides = [], viewer = "client", client = null
} = {}) {
  const extraById = new Map((Array.isArray(extra) ? extra : []).filter((e) => e && e.id).map((e) => [String(e.id), e]));
  const extraByName = new Map();
  for (const e of Array.isArray(extra) ? extra : []) {
    const k = bankKey(e && e.name);
    if (!k) continue;
    if (!extraByName.has(k)) extraByName.set(k, []);
    extraByName.get(k).push(e);
  }
  const groups = groupBanks(matches, extraById);

  /* Book rows behind each tracker line: its lender_id, else the bank's name — so
     the clock can show the book's logo and the book's own seasoning days. */
  const bookFor = (rel) => {
    if (rel.lender_id && extraById.has(String(rel.lender_id))) return [extraById.get(String(rel.lender_id))];
    return extraByName.get(bankKey(rel.bank_key || rel.bank)) || [];
  };
  const clocks = (Array.isArray(relationships) ? relationships : []).map((rel) => {
    const book = bookFor(rel);
    const seasonRow = book.find((b) => seasoningRule(b));
    const logo = book.map((b) => safeLogo(b.logo_path)).find(Boolean) || null;
    return seasoningClock({ ...rel, logo_path: logo }, { today, bookDays: seasonRow ? seasoningRule(seasonRow).days : null });
  }).filter(Boolean);

  const gate = gateChecks({ fundability: fund, clocks });

  /* Approval days per bank, cards only. The product type is the application's
     own, else its book row's. An approval with no known product type is not
     counted against a card limit; it is counted in `unknown_type_approvals`. */
  const lenderTableById = new Map();
  for (const g of groups) for (const r of g.rows) if (r.id) lenderTableById.set(String(r.id), r.lender_table);
  for (const e of extraById.values()) if (e.lender_table && !lenderTableById.has(String(e.id))) lenderTableById.set(String(e.id), e.lender_table);
  const nameById = new Map();
  for (const g of groups) for (const r of g.rows) if (r.id) nameById.set(String(r.id), g.key);
  for (const e of extraById.values()) if (!nameById.has(String(e.id))) nameById.set(String(e.id), bankKey(e.name));
  const approvalDays = new Map();
  let unknownType = 0;
  for (const a of Array.isArray(approvals) ? approvals : []) {
    const day = isoDay(a.decided_on);
    if (!day) continue;
    const key = (a.lender_id && nameById.get(String(a.lender_id))) || bankKey(a.bank);
    if (!key) continue;
    const table = text(a.lender_table) || (a.lender_id ? lenderTableById.get(String(a.lender_id)) : null) || null;
    if (!table) { unknownType += 1; continue; }
    if (!CARD_TABLES.has(table)) continue;
    if (!approvalDays.has(key)) approvalDays.set(key, []);
    approvalDays.get(key).push(day);
  }

  const overrideByBank = new Map();
  for (const o of Array.isArray(overrides) ? overrides : []) {
    const k = bankKey(o && (o.bank_key || o.bank_name));
    if (!k) continue;
    const seen = overrideByBank.get(k);
    if (!seen || String(o.created_at || "") > String(seen.created_at || "")) overrideByBank.set(k, o);
  }

  const clocksByBank = new Map();
  for (const c of clocks) {
    if (!c.bank_key) continue;
    if (!clocksByBank.has(c.bank_key)) clocksByBank.set(c.bank_key, []);
    clocksByBank.get(c.bank_key).push(c);
  }

  const odds = groups.map((g) => oddsForBank(g, {
    today, gate,
    clocks: clocksByBank.get(g.key) || [],
    approvals: approvalDays.get(g.key) || [],
    override: overrideByBank.get(g.key) || null,
    viewer
  }));

  const guidance = [];
  for (const o of odds) {
    for (const l of o.limits) guidance.push({ bank: o.bank, text: l.text, quote: l.quote, source: l.source });
  }

  const counts = { ready: 0, wait: 0, not_yet: 0 };
  for (const o of odds) counts[o.status] += 1;

  return {
    ok: true,
    view: "apply_gate",
    as_of: asOf ? new Date(asOf).toISOString() : null,
    today,
    client: client ? { id: client.id || null, name: client.name || null } : null,
    viewer,
    can_override: viewer === "staff",
    has_pull: !!(fund && fund.has_pull),
    /* True when UnderwriteIQ read a sample report, never a bureau. */
    sample: !!(fund && fund.sample),
    gate: { status: gate.status, checks: gate.checks, guidance },
    seasoning: clocks,
    odds,
    counts,
    unknown_type_approvals: unknownType,
    rules: {
      seasoning_days: SEASON_DAYS,
      better_days: [...BETTER_DAYS],
      ready_note: READY_IS_NOT_A_PROMISE,
      limit_note: LIMIT_IS_GUIDANCE,
      source: SOURCES.owner
    }
  };
}

/* ------------------------------------------------------------------ *
 * The reads
 * ------------------------------------------------------------------ */

const EXTRA_SQL = `
  SELECT id, name, lender_table, logo_path, minimum_deposit, requires_account_opening, relationship_required,
         stated_requirements, insider_tips, external_row_id
    FROM lenders
   WHERE org_id = $1::uuid AND COALESCE(is_demo, false) = false
     AND (id = ANY($2::uuid[]) OR lower(btrim(name)) = ANY($3::text[]))
   ORDER BY priority_tier NULLS LAST, lower(name), id`;

/* The client's card approvals: the bank's answer, dated the day the status was set.
   A legacy row with no client_id is tied to the client through its funding round. */
export const APPROVALS_SQL = `
  SELECT a.id, a.lender_id,
         COALESCE(NULLIF(btrim(a.lender_name), ''), NULLIF(btrim(a.bank), '')) AS bank,
         a.lender_table::text AS lender_table,
         (COALESCE(a.status_updated_date, a.updated_at) AT TIME ZONE 'UTC')::date::text AS decided_on
    FROM applications a
    LEFT JOIN funding_rounds r ON r.id = a.funding_round_id AND r.org_id = a.org_id
   WHERE a.org_id = $1::uuid
     AND (a.client_id = $2::uuid OR (a.client_id IS NULL AND r.client_id = $2::uuid))
     AND a.status = 'Approved'
     AND COALESCE(a.is_demo, false) = false
     AND COALESCE(a.status_updated_date, a.updated_at) >= $3::date
   ORDER BY decided_on ASC, a.id`;

export const OVERRIDES_SQL = `
  SELECT DISTINCT ON (bank_key) id, bank_key, bank_name, allow_more, note, created_at
    FROM apply_gate_overrides
   WHERE org_id = $1::uuid AND client_id = $2::uuid
   ORDER BY bank_key, created_at DESC, id DESC`;

export async function readApprovals(db, { orgId, clientId, today }) {
  const since = addMonths(today, -APPROVAL_LOOKBACK_MONTHS);
  return (await db.query(APPROVALS_SQL, [orgId, clientId, since])).rows;
}

export async function readOverrides(db, { orgId, clientId }) {
  try {
    return (await db.query(OVERRIDES_SQL, [orgId, clientId])).rows;
  } catch (e) {
    /* Before migration 577 is applied (a branch preview runs on the old shape),
       there is no table to read. No decision can have been stored, so none is
       read. Any other failure is real and is thrown. */
    if (e && e.code === "42P01") {
      console.error("apply gate: apply_gate_overrides is not there yet (migration 577)");
      return [];
    }
    throw e;
  }
}

/**
 * applyGate(db, { orgId, clientId, asOf, viewer }) → the payload, or null when the
 * client is not in that org (the caller answers 404). Read only.
 */
export async function applyGate(db, {
  orgId, clientId, asOf = new Date(), viewer = "client",
  fundability = readFundability, match = matchForClient, logos = findLogos
} = {}) {
  const today = new Date(asOf).toISOString().slice(0, 10);
  const fund = await fundability(db, { orgId, clientId, asOf });
  if (!fund) return null;
  const [matched, relationships, approvals, overrides] = await Promise.all([
    match(db, { orgId, clientId }),
    readRelationships(db, { orgId, clientId, today }),
    readApprovals(db, { orgId, clientId, today }),
    readOverrides(db, { orgId, clientId })
  ]);
  const matches = (matched && matched.matches) || [];
  const ids = [...new Set([
    ...matches.map((m) => m.id),
    ...relationships.map((r) => r.lender_id),
    ...approvals.map((a) => a.lender_id)
  ].filter(Boolean).map(String))];
  const names = [...new Set(relationships.map((r) => bankKey(r.bank_key || r.bank)).filter(Boolean))];
  const extra = ids.length || names.length ? (await db.query(EXTRA_SQL, [orgId, ids, names])).rows : [];
  const payload = buildApplyGate({
    today, asOf, fundability: fund, matches, extra, relationships, approvals, overrides, viewer,
    client: fund.client || null
  });
  /* Each bank's own logo (owner rule 2026-11-07): the shared lookup gives Plaid's
     logo first, then the bank book's file, else null (the name stands alone). It
     never throws; a failed look leaves every logo null. */
  const asks = [
    ...payload.seasoning.map((c) => ({ lenderId: c.lender_id, name: c.bank })),
    ...payload.odds.map((o) => ({ lenderId: o.lender_id, name: o.bank }))
  ];
  if (asks.length) {
    const found = await logos(db, { orgId, banks: asks });
    const pick = (i) => (Array.isArray(found) && found[i] && found[i].logo) || null;
    const n = payload.seasoning.length;
    payload.seasoning = payload.seasoning.map((c, i) => ({ ...c, logo: pick(i) }));
    payload.odds = payload.odds.map((o, i) => ({ ...o, logo: pick(n + i) }));
  }
  return payload;
}

/* ------------------------------------------------------------------ *
 * Staff write: allow more applications at one bank (or stop allowing more)
 * ------------------------------------------------------------------ */

export class ApplyGateInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * setApplyOverride(db, { orgId, clientId, input, staffId }) → { ok, id, bank_key, allow_more }
 * input = { bank, allow_more: true | false, note? }. Staff only (the handler checks).
 * The bank must be a bank in this org's bank book. Append only.
 */
export async function setApplyOverride(db, { orgId, clientId, input = {}, staffId = null } = {}) {
  const name = text(input.bank ?? input.bank_name);
  if (!name || name.length > 120) throw new ApplyGateInputError("bank_required", "Pick the bank.");
  if (input.allow_more !== true && input.allow_more !== false) {
    throw new ApplyGateInputError("allow_more_required", "Say if more applications are allowed at this bank (true or false).");
  }
  const note = input.note === undefined || input.note === null ? null : text(input.note);
  if (note && note.length > 500) throw new ApplyGateInputError("note_too_long", "Keep the note under 500 letters.");
  const key = bankKey(name);
  const book = await db.query(
    `SELECT name FROM lenders WHERE org_id = $1::uuid AND lower(btrim(name)) = $2 AND COALESCE(is_demo, false) = false
      ORDER BY priority_tier NULLS LAST, id LIMIT 1`,
    [orgId, key]
  );
  if (!book.rows[0]) return { ok: false, error: "not_found" };
  const r = await db.query(
    /* clock_timestamp(), not now(): two decisions in one transaction still sort in the order written. */
    `INSERT INTO apply_gate_overrides (org_id, client_id, bank_key, bank_name, allow_more, note, set_by, created_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, clock_timestamp())
     RETURNING id, bank_key, allow_more, created_at`,
    [orgId, clientId, key, text(book.rows[0].name) || name, input.allow_more, note, staffId || null]
  );
  return { ok: true, id: r.rows[0].id, bank_key: r.rows[0].bank_key, allow_more: r.rows[0].allow_more };
}

export default applyGate;
