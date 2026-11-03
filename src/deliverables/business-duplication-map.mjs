// DOCUMENT 5 — Business Duplication Map (free bonus of the $297 Funding Roadmap).
//
// Built "in reverse order" (owner, 2026-10-02): the /roadmap sales page already
// shows a sample of this document (marketing/landing-pages/slo/slo-01-sales.html,
// the `duplication:` entry of `var P`). This is the real document that sample
// shows. Its NUMBERS come from the client's file and UnderwriteIQ engine.
// Preparation advice was updated by the owner on 2026-11-02; the historical
// sales sample is not the source of current filing instructions.
//
// OWNER FACTS (final, 2026-10-02):
//   * The map checks personal + business credit: how fundable the client is off
//     the business.
//   * The business side is the Experian Business check, and only Experian
//     Business: business credit score, blemishes, business balances, the NAICS
//     code, the business name, and the exact fix for each so a lender sees a
//     credible business. No DUNS, no net-30, no vendor accounts.
//   * Updated 2026-11-02: prepare three or four separate single-member LLC
//     plans with actual ownership, activity, state requirements and evidence.
//     Review around 12 months; do not assume filings or funding from time.
//
// WHERE EVERY FACT COMES FROM — nothing on this page is typed in:
//   personal decision, funding  → the tier engine run on the stored pull
//                                 (decision_label, preapprovals)
//   median score                 → the CLIENT dict (same engine run)
//   each company's name, state,  → the client's saved `businesses` rows
//     start date, NAICS
//   each company's Experian      → crs_results.result.businessReports[] (the
//     Business check               Experian Business reports the credit pull
//                                  bought, src/finance/crs-pull.mjs), each scored
//                                  by the same tier engine (businessSignals and
//                                  preapprovals.business) in
//                                  src/underwrite/letter-pack.mjs
//   name + NAICS flags           → src/underwrite/company-audit.mjs
//   the age bands                → src/underwrite/business-funding.mjs
//                                  businessAgeMultiplier (0.5 / 1 / 2)
//   the funding order            → src/underwrite/funding-sequence.mjs
//   the company set-up rules     → src/underwrite/company-audit.mjs standing
//                                  rules (website, LinkedIn, shell LLC)
//
// A FACT THAT IS NOT ON THE FILE IS SAID TO BE NOT ON THE FILE. No NAICS code
// saved → "not on the file". No Experian Business report → "not on the file".
// Nothing is filled in to make the page look complete.
//
// PURE. No I/O, no engine call, no clock unless the caller passes none. The
// engine scoring of each company happens in letter-pack.mjs, which hands the
// results in as `scoredReports`.

import { esc } from "./escape.mjs";
import { usd, median } from "./format.mjs";
import { cover, ctaPage, section, table, chip, renderDocument, GOLD, isGold, PB } from "./chrome.mjs";
import {
  auditCompany,
  websiteSuggestion,
  linkedInSuggestion,
  shellLlcSuggestion
} from "../underwrite/company-audit.mjs";
import { businessAgeMultiplier, finiteAgeMonths } from "../underwrite/business-funding.mjs";
import { FUNDING_SEQUENCE_STEPS } from "../underwrite/funding-sequence.mjs";

/** The document's identity, in the shape DELIVERABLE_DOCS uses. */
export const BUSINESS_DUPLICATION_MAP_DOC = Object.freeze({
  key: "business_duplication_map",
  filename: "business_duplication_map.html",
  title: "Business Duplication Map",
  footerLabel: "business duplication map",
  variant: ""
});

/** Review horizon; the dates do not create a business or approve funding. */
export const PLAN_QUARTERS = 8;

const MONTH_NAMES = Object.freeze(["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"]);

const NUMBER_WORDS = Object.freeze(["zero", "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty"]);

/** "two" for 2, "21" past twenty. */
function word(n) {
  return NUMBER_WORDS[n] || String(n);
}

/** The engine's age multiplier, in the words the sales-page sample uses. */
function multiplierWords(m) {
  if (m === 0.5) return "half your card funding";
  if (m === 1) return "equal to your card funding";
  if (m === 2) return "double your card funding";
  return `${m} times your card funding`;
}

/** The three bands, each read off businessAgeMultiplier — never a second copy of the numbers. */
export const AGE_BANDS = Object.freeze([
  Object.freeze({ label: "under 12 months", sample: 6 }),
  Object.freeze({ label: "12 to 24 months", sample: 18 }),
  Object.freeze({ label: "24 months and up", sample: 30 })
].map((b) => Object.freeze({
  label: b.label,
  multiplier: businessAgeMultiplier(b.sample),
  words: multiplierWords(businessAgeMultiplier(b.sample))
})));

function finite(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v) {
  return String(v ?? "").trim();
}

/** A calendar month as a plain { year, month } pair, month 0-11, read in UTC. */
function monthOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/**
 * "2025-08", "2025-08-14" or "2025-08-14T00:00:00Z" → { year, month }. Read off
 * the digits, not through Date, so a bare "2025-08" never slides a month on a
 * time-zone offset. Anything else is unknown.
 */
export function parseStartMonth(raw) {
  const m = text(raw).match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[T ].*)?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (!Number.isInteger(year) || month < 0 || month > 11) return null;
  return { year, month };
}

function addMonths({ year, month }, n) {
  const total = year * 12 + month + n;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Whole months from one calendar month to another, the way the engine counts (days ignored). */
function monthsFrom(a, b) {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

function monthLabel(ym) {
  return `${MONTH_NAMES[ym.month]} ${ym.year}`;
}

function quarterIndex(ym) {
  return ym.year * 4 + Math.floor(ym.month / 3);
}

function quarterLabel(qi) {
  return `Q${(qi % 4) + 1} ${Math.floor(qi / 4)}`;
}

/* ─────────────────────────────────────────────────── company name match ── */

const ENTITY_SUFFIX = /\b(?:l\s*l\s*c|llc|pllc|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp)\b/g;

/**
 * A company name with case, punctuation and the entity word taken off, so
 * "RIVERA SUPPLY, LLC" and "Rivera Supply LLC" read the same. Only used to ask
 * "is this the same name?" — never printed.
 */
export function nameKey(raw) {
  return text(raw).toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(ENTITY_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The scored report that belongs to a saved company: same name and state, else same name. */
function reportFor(company, scoredReports) {
  const name = text(company.name).toLowerCase();
  const state = text(company.state).toUpperCase();
  const list = Array.isArray(scoredReports) ? scoredReports : [];
  return list.find((r) => text(r?.name).toLowerCase() === name && text(r?.state).toUpperCase() === state)
    || list.find((r) => nameKey(r?.name) && nameKey(r?.name) === nameKey(company.name))
    || null;
}

/* ──────────────────────────────────────────────── the Experian checks ── */

const NOT_ON_FILE = "NOT ON FILE";
const NO_REPORT_FIX = "No Experian Business report for this company is on the file.";
const UNREADABLE_FIX = "The Experian Business report on the file could not be read.";

function missingRow(label, reportState) {
  return {
    label,
    status: reportState === "unreadable" ? "NOT READ" : NOT_ON_FILE,
    kind: "line",
    fix: reportState === "unreadable" ? UNREADABLE_FIX : NO_REPORT_FIX
  };
}

function scoreRow(signals) {
  const s = signals?.scores || {};
  const score = finite(s.intelliscore);
  const band = text(s.intelliscoreBand).toLowerCase();
  if (score === null) {
    return {
      label: "Business credit score",
      status: "NO SCORE",
      kind: "line",
      fix: "Experian Business has no score for this company yet. It builds as business accounts report."
    };
  }
  if (band === "excellent" || band === "good") {
    return { label: "Business credit score", status: `${score} ${band.toUpperCase()}`, kind: "line",
      fix: "Keep it reporting." };
  }
  return {
    label: "Business credit score",
    status: `${score} ${(band || "low").toUpperCase()}`,
    kind: band === "fair" ? "mid" : "solid",
    fix: "Pay every business account on time. The score climbs as on-time payments report."
  };
}

/** The blemishes Experian Business shows, each with its exact fix. */
export function blemishesOf(signals) {
  const out = [];
  const pr = signals?.publicRecords || {};
  if (pr.bankruptcy) {
    out.push(["Bankruptcy", "A bankruptcy on this company stops business funding on it. "
      + "Build on your other companies while it shows."]);
  }
  if (pr.judgment) {
    out.push(["Judgment", "Pay or settle the judgment and have the release filed so "
      + "Experian Business updates it."]);
  }
  if (pr.taxLien) {
    out.push(["Tax lien", "Pay the tax lien and have the release filed so Experian Business "
      + "updates it."]);
  }
  const dbt = finite(signals?.dbt?.current);
  if (dbt !== null && dbt > 30) {
    out.push(["Late payments", `Bills are paid ${dbt} days past their due date on average. `
      + "Pay every business bill by its due date."]);
  }
  const ucc = finite(signals?.ucc?.count) || 0;
  if (ucc > 0) {
    out.push([ucc === 1 ? "1 UCC filing" : `${ucc} UCC filings`,
      "A UCC filing is a lender's claim on the company's assets. Pay off the loan behind it and "
      + "have the lender file the release."]);
  }
  return out;
}

function blemishRow(signals) {
  const found = blemishesOf(signals);
  if (!found.length) {
    return { label: "Blemishes", status: "NONE", kind: "line", fix: "Nothing to fix." };
  }
  const lines = found.map(([what, fix]) => `${what}: ${fix}`);
  return { label: "Blemishes", status: `${found.length} FOUND`, kind: "solid", fix: lines.join(" "), lines };
}

function balanceRow(signals) {
  const pct = finite(signals?.bizUtilization?.pct);
  if (pct === null) {
    return {
      label: "Business balances",
      status: "NONE REPORTED",
      kind: "line",
      fix: "No business balances report yet. This fills in once a business card reports."
    };
  }
  if (pct < 10) {
    return { label: "Business balances", status: `${pct}% USED`, kind: "line",
      fix: "Keep it under 10%." };
  }
  return {
    label: "Business balances",
    status: `${pct}% USED`,
    kind: pct >= 80 ? "solid" : "mid",
    fix: "Pay it down under 10% before you apply. Balances over 10% lower this company's "
      + "business funding."
  };
}


function naicsRow(audit) {
  const n = audit.naicsSuggestion;
  if (n.status === "approved") {
    return { label: "NAICS code", status: `${n.from} OK`, kind: "line", fix: n.why };
  }
  if (n.status === "not_on_list") {
    return { label: "NAICS code", status: `${n.from} REVIEW`, kind: "mid", fix: n.why };
  }
  return { label: "NAICS code", status: NOT_ON_FILE, kind: "mid", fix: n.why };
}

function nameRow(company, audit, signals) {
  const problems = [];
  let status = "OK";
  let kind = "line";
  if (audit.nameSuggestion.change) {
    status = "FLAGGED";
    kind = "solid";
    problems.push(audit.nameSuggestion.suggestion);
  }
  const experianName = text(signals?.profile?.name);
  if (experianName && nameKey(experianName) !== nameKey(company.name)) {
    if (status === "OK") { status = "DOES NOT MATCH"; kind = "solid"; }
    problems.push(`Experian Business lists the company as "${experianName}". Use one exact name everywhere.`);
  }
  if (signals?.fraudShield?.nameVerified === false) {
    if (status === "OK") { status = "NOT VERIFIED"; kind = "mid"; }
    problems.push("Experian could not match the name to the address. Use the same name and "
      + "address everywhere the company is listed.");
  }
  return {
    label: "Business name",
    status,
    kind,
    fix: problems.length ? problems.join(" ") : "One exact name everywhere. Keep it.",
    ...(problems.length > 1 ? { lines: problems } : {})
  };
}

/* The engine's hard-block reason codes (vendor derive-business-signals.js), in plain words. */
const BLOCK_WORDS = Object.freeze({
  BUSINESS_INACTIVE: "Experian Business does not show the company as active",
  OFAC_MATCH: "Experian Business shows a government watch-list match",
  BUSINESS_BANKRUPTCY: "a bankruptcy",
  BUSINESS_JUDGMENT: "a judgment",
  BUSINESS_TAX_LIEN: "a tax lien",
  BUSINESS_VERIFICATION_FAILED: "Experian could not verify the name and address",
  BUSINESS_NEGATIVE_ITEMS: "blemishes on the Experian Business file",
  BUSINESS_UCC_LIEN: "a UCC filing"
});

/** Why the engine gave a company $0, in plain words, off the engine's own fields. */
export function zeroReasons(signals, business) {
  const out = [];
  const reasons = Array.isArray(signals?.hardBlock?.reasons) ? signals.hardBlock.reasons : [];
  const named = new Set(["BUSINESS_BANKRUPTCY", "BUSINESS_JUDGMENT", "BUSINESS_TAX_LIEN"]);
  const hasNamed = reasons.some((r) => named.has(r));
  const items = Array.isArray(signals?.bizNegativeItems?.items) ? signals.bizNegativeItems.items : [];
  for (const r of reasons) {
    let w = BLOCK_WORDS[r];
    /* BUSINESS_NEGATIVE_ITEMS is the engine's umbrella over bankruptcy,
       judgment, tax lien and late payments. The first three have their own
       codes, so the umbrella only adds what they do not already say. */
    if (r === "BUSINESS_NEGATIVE_ITEMS") {
      if (items.includes("high_dbt")) w = "late payments";
      else if (hasNamed) continue;
    }
    if (w && !out.includes(w)) out.push(w);
  }
  if (finite(business?.multiplier) === 0) {
    out.push("Experian Business has no start date for the company, so it has no age yet");
  }
  if (finite(business?.modifiers?.outcome) === 0) {
    out.push("business funding waits until your personal file qualifies");
  }
  return out;
}

/**
 * One saved company, checked.
 *
 * @param {object} company        { name, state, ageMonths, incorporatedDate, naics }
 * @param {object|null} scored    { signals, business, error } from letter-pack, or null
 * @param {{year:number,month:number}} asOf
 */
export function companyFacts(company, scored, asOf) {
  const name = text(company?.name);
  const state = text(company?.state).toUpperCase();
  const audit = auditCompany({ name, naics: company?.naics ?? null });
  const reportState = !scored ? "missing" : (scored.error || !scored.signals?.available ? "unreadable" : "scored");
  const signals = reportState === "scored" ? scored.signals : null;

  // Age: the date Experian Business holds (what a lender sees), else the start
  // date the client saved, else the saved age in months. Unknown stays unknown.
  let start = null;
  let ageSource = null;
  const experianStart = parseStartMonth(signals?.profile?.incorporatedDate);
  const savedStart = parseStartMonth(company?.incorporatedDate);
  if (experianStart) { start = experianStart; ageSource = "experian"; }
  else if (savedStart) { start = savedStart; ageSource = "saved_date"; }
  let ageMonths = start ? Math.max(0, monthsFrom(start, asOf)) : null;
  if (ageMonths === null) {
    const saved = finiteAgeMonths(company?.ageMonths);
    if (saved !== null) { ageMonths = Math.floor(saved); ageSource = "saved_age"; }
  }
  const turnsAt = (n) => {
    if (ageMonths === null || ageMonths >= n) return null;
    return start ? addMonths(start, n) : addMonths(asOf, n - ageMonths);
  };

  const checks = reportState === "scored"
    ? [scoreRow(signals), blemishRow(signals), balanceRow(signals), naicsRow(audit),
      nameRow({ name }, audit, signals)]
    : [missingRow("Business credit score", reportState), missingRow("Blemishes", reportState),
      missingRow("Business balances", reportState), naicsRow(audit),
      nameRow({ name }, audit, null)];

  let funding = { amount: null, multiplier: null, reasons: [] };
  if (reportState === "scored") {
    const amount = finite(scored.business?.final);
    funding = {
      amount,
      multiplier: finite(scored.business?.multiplier),
      reasons: amount === 0 ? zeroReasons(signals, scored.business) : []
    };
  }

  return {
    name,
    state,
    ageMonths,
    ageSource,
    report: reportState,
    checks,
    funding,
    turns12: turnsAt(12),
    turns24: turnsAt(24)
  };
}

/* ──────────────────────────────────────────────────── the quarterly plan ── */

/** Quarterly preparation reviews plus known formation milestones, not auto-filings. */
export function quarterlyPlan(companies, asOf) {
  const first = quarterIndex(asOf);
  const last = first + PLAN_QUARTERS - 1;
  const existing = Array.isArray(companies) ? companies : [];
  const reviews = [
    "Review existing businesses and plan three or four separate single-member LLCs. Save each business's actual activity, owner and state requirements before filing.",
    "Review each plan's formation document and EIN confirmation. Keep formation, ownership and operating dates separate.",
    "Review each business profile and suitable bank relationships. Check available cash and current account requirements before setting dates.",
    "Review saved progress alongside personal-credit work. Update missing documents, actual account dates and the next review.",
    "Review the roughly 12-month preparation horizon. Recheck actual documents, operating history and the current credit file; elapsed time does not approve funding.",
    "Review each business's current records and banking evidence. Change the next step when its circumstances change.",
    "Review actual income, activity and operating history for each business. Keep unverified facts open for review.",
    "Reassess the current file and business preparation before choosing any application steps."
  ];
  const rows = reviews.slice(0, PLAN_QUARTERS).map((step, i) => ({ q: first + i, order: 0, step }));
  for (const c of existing) {
    const label = c.name || "Your company";
    for (const [months, date] of [[12, c.turns12], [24, c.turns24]]) {
      if (date && quarterIndex(date) <= last) {
        rows.push({ q: Math.max(first, quarterIndex(date)), order: 1,
          step: `${label} reaches its recorded ${months}-month formation milestone. Review its current credit file and actual operating history; age alone does not approve funding.` });
      }
    }
  }
  return rows.sort((a, b) => a.q - b.q || a.order - b.order)
    .map((r) => ({ quarter: quarterLabel(r.q), step: r.step }));
}

/* ───────────────────────────────────────────────────────────── the facts ── */

/**
 * Everything the map prints, worked out once, from the file.
 *
 * @param {object}   args
 * @param {object}  [args.engine]         the tier-engine result for this client
 * @param {object}  [args.client]         the CLIENT dict built from the same engine run
 * @param {object[]}[args.companies]      saved companies: { name, state, ageMonths, incorporatedDate, naics }
 * @param {object[]}[args.scoredReports]  each stored Experian Business report scored by the
 *                                        engine: { name, state, signals, business, error }
 * @param {Date}    [args.now]
 */
export function duplicationMapFacts({
  engine = null,
  client = null,
  companies = [],
  scoredReports = [],
  now = new Date()
} = {}) {
  const asOf = monthOf(now) || monthOf(new Date());
  const pre = engine?.preapprovals || {};
  const personal = {
    decision: text(engine?.decision_label) || null,
    outcome: text(engine?.outcome) || null,
    median: finite(median(client?.scores || {})),
    personalFunding: finite(pre.totalPersonal),
    cardFunding: finite(pre.personalCard?.final),
    onHold: pre.suppressedByOutcome === true
  };
  const saved = (Array.isArray(companies) ? companies : []).filter((c) => text(c?.name));
  const list = saved
    .map((c) => companyFacts(c, reportFor(c, scoredReports), asOf))
    .sort((a, b) => (b.ageMonths ?? -1) - (a.ageMonths ?? -1));
  const scored = list.filter((c) => c.report === "scored" && c.funding.amount !== null);
  return {
    asOf,
    asOfLabel: monthLabel(asOf),
    personal,
    companies: list,
    scoredCount: scored.length,
    businessFundingTotal: scored.length ? scored.reduce((s, c) => s + c.funding.amount, 0) : null,
    ageBands: AGE_BANDS,
    plan: quarterlyPlan(list, asOf),
    setup: [websiteSuggestion(), linkedInSuggestion(), shellLlcSuggestion({ companyCount: list.length })]
      .map((row) => row.suggestion),
    order: FUNDING_SEQUENCE_STEPS.map((s) => ({ position: s.position, id: s.id, title: s.title }))
  };
}

/* ─────────────────────────────────────────────────────────── the page ── */

function bandWordsFor(multiplier) {
  const band = AGE_BANDS.find((b) => b.multiplier === multiplier);
  return band ? band.words : null;
}

function companyLine(c) {
  const bits = [];
  if (c.state) bits.push(c.state);
  bits.push(c.ageMonths === null ? "age not on the file"
    : `${c.ageMonths} month${c.ageMonths === 1 ? "" : "s"} old`);
  return bits.join(", ");
}

function fundingLine(c) {
  if (c.report === "missing") {
    return `The last credit pull did not bring back an Experian Business report for ${c.name}, `
      + "so UnderwriteIQ has not scored it.";
  }
  if (c.report === "unreadable" || c.funding.amount === null) {
    return `UnderwriteIQ could not score the Experian Business report on file for ${c.name}.`;
  }
  if (c.funding.amount > 0) {
    const words = bandWordsFor(c.funding.multiplier);
    return `UnderwriteIQ gives ${c.name} ${usd(c.funding.amount)} in business funding today.`
      + (words ? ` Its age band: ${words}.` : "");
  }
  const why = c.funding.reasons.length ? ` Why: ${c.funding.reasons.join("; ")}.` : "";
  return `UnderwriteIQ gives ${c.name} $0 in business funding today.${why}`;
}

/**
 * The Business Duplication Map body: cover, five numbered sections, closing panel.
 *
 * @param {object} client  the CLIENT dict (cover, footer, closing panel)
 * @param {object} map     duplicationMapFacts() output. Missing → worked out from nothing,
 *                         which prints "not on the file" wherever a fact is needed.
 * @param {object} [opts]  { look: "gold" } — the hosted look
 */
export function buildBusinessDuplicationMap(client, map, opts = { look: GOLD }) {
  const c = client || {};
  const m = map && typeof map === "object" ? map : duplicationMapFacts({ client: c });
  const p = m.personal || {};
  const companies = Array.isArray(m.companies) ? m.companies : [];
  const h = [cover(c, "business duplication map", "Business Duplication Map", opts)];
  const gold = isGold(opts);
  const callout = (inner, cls = "co") => (gold
    ? `<div class="${cls}"><p>${inner}</p></div>`
    : `<p><b>${inner}</b></p>`);

  // 01 — both files
  h.push(section("01", "both files", "How Fundable You Are Off the Business"));
  h.push(`<p${gold ? ' class="lead"' : ""}>Why you need this: prepare each business with clear records `
    + "and the next useful step. This map checks your personal file and every saved company, "
    + "then sets review points for your separate business plans.</p>");
  const dash = (v) => (v === null || v === undefined || v === "" ? "-" : v);
  const bizTotal = m.businessFundingTotal === null || m.businessFundingTotal === undefined
    ? "Not on the file"
    : usd(m.businessFundingTotal);
  h.push(table(["check", "your file"], [
    ["Personal decision", dash(p.decision)],
    ["Median score", dash(p.median)],
    ["Personal funding today", usd(p.personalFunding)],
    ["Card funding (what company funding is based on)", usd(p.cardFunding)],
    ["Companies on your file", String(companies.length)],
    ["Companies with an Experian Business report", String(m.scoredCount ?? 0)],
    ["Business funding today", bizTotal]
  ].map((r) => r.map(esc)), [], opts));
  if (p.onHold) {
    const decided = p.decision ? `UnderwriteIQ's decision on your personal file is "${esc(p.decision)}", so it`
      : "UnderwriteIQ";
    h.push(callout(`${decided} shows $0 for personal and business funding today. Fix the personal `
      + "file first for funding readiness. Business documents and preparation can move alongside your credit work."));
  }
  h.push("<p><b>The funding order:</b></p>");
  h.push(`<ol class="${gold ? "fh-ol" : "plain"}">`
    + (m.order || []).map((s) => `<li>${esc(s.title)}${s.id === "companies" ? " (this map)" : ""}</li>`).join("")
    + "</ol>");

  // 02 — your business today
  h.push(PB);
  h.push(section("02", "your business today", "Your Business Today: Experian Business Check"));
  if (!companies.length) {
    h.push("<p>No company is on your file yet, so there is no Experian Business check to run. "
      + "Review your starting situation and separate business plans below.</p>");
  } else {
    h.push("<p>Experian Business is the business file a lender reads. Each company below is "
      + "checked the same way, with the exact fix next to anything that needs one.</p>");
    for (const co of companies) {
      h.push(`<h3>${esc(co.name)}</h3><p class="small">${esc(companyLine(co))}</p>`);
      h.push(table(["experian business check", "status", "the fix"],
        co.checks.map((r) => [esc(r.label), gold ? chip(r.status, r.kind) : esc(r.status),
          // One fix per line when a check found more than one thing.
          Array.isArray(r.lines) ? r.lines.map(esc).join("<br>") : esc(r.fix)]),
        [], opts));
      h.push(callout(esc(fundingLine(co)), "co info"));
    }
  }

  // 03 — what a company can get as it ages
  h.push(section("03", "by age", "What a Company Can Get as It Ages"));
  if (p.cardFunding === null) {
    h.push("<p>Your card funding is not on the file, so the dollar side of this table cannot be "
      + "worked out yet.</p>");
  } else if (p.cardFunding <= 0) {
    h.push(callout(`UnderwriteIQ puts your card funding at ${esc(usd(p.cardFunding))} today, so a `
      + "company adds $0 until the personal file is fixed. Work your Credit Optimization Roadmap "
      + "first. Prepare the business plans alongside that work and record each actual filing date."));
  } else {
    h.push(`<p>UnderwriteIQ puts your card funding at <b>${esc(usd(p.cardFunding))}</b> today. `
      + "The model uses each company's recorded age to calculate an estimate; it is not a funding approval.</p>");
  }
  h.push(table(["company age", "business funding"],
    (m.ageBands || AGE_BANDS).map((b) => [esc(b.label), esc(b.words)]), [], opts));
  h.push("<p>The company's own Experian Business file can lower this: high balances cut it, and "
    + "a blemish or a lien stops it.</p>");
  for (const co of companies) {
    if (co.turns24) {
      h.push(`<p>${esc(co.name)} reaches its recorded 24-month formation milestone in ${esc(monthLabel(co.turns24))}. `
        + "Recheck its actual operating history and current file then; age alone does not approve funding.</p>");
    } else if (co.ageMonths !== null) {
      h.push(`<p>${esc(co.name)} is past 24 months, so it is already in the top band.</p>`);
    }
  }

  // 04 — the quarterly plan
  h.push(PB);
  h.push(section("04", "quarterly reviews", "Your Business Preparation Reviews"));
  h.push(`<p>Starting ${esc(m.asOfLabel || "")}. Review three or four separate single-member LLC plans `
    + "and existing businesses. Each keeps its own documents, dates and next steps.</p>");
  h.push(table(["quarter", "step"], (m.plan || []).map((r) => [esc(r.quarter), esc(r.step)]), [], opts));
  h.push(callout("These are preparation and review points, not automatic filing or funding dates. "
    + "Keep planned businesses separate from formed businesses. Review actual ownership, "
    + "operating history, evidence and current lender requirements before applying."));

  // 05 — set every company up the same way
  h.push(section("05", "set up", "Set Up Every Company the Same Way"));
  const setup = [
    "Use the NAICS code that matches what the business actually does. A reference-list code is not an approval.",
    "Use one exact name everywhere the company is listed.",
    ...(m.setup || [])
  ];
  h.push(`<ul class="${gold ? "fh-check" : "plain"}">` + setup.map((s) => `<li>${esc(s)}</li>`).join("")
    + "</ul>");

  h.push(ctaPage(c, opts));
  return h.join("");
}

/**
 * The map as a complete hosted page, in the same frame as the other four.
 *
 * @param {object} args
 * @param {object} args.client      the CLIENT dict from buildBlackReportClient()
 * @param {object} [args.map]       duplicationMapFacts() output
 * @param {string} [args.fontsHref] see renderDeliverableHtml()
 * @returns {{ key: string, filename: string, title: string, html: string }}
 */
export function renderBusinessDuplicationMapHtml({ client, map = null, fontsHref = "" } = {}) {
  if (!client || typeof client !== "object") {
    throw new Error("renderBusinessDuplicationMapHtml: client is required");
  }
  const spec = BUSINESS_DUPLICATION_MAP_DOC;
  const html = renderDocument({
    body: buildBusinessDuplicationMap(client, map, { look: GOLD }),
    client,
    footerLabel: spec.footerLabel,
    title: spec.title,
    variant: spec.variant,
    fontsHref
  });
  return { key: spec.key, filename: spec.filename, title: spec.title, html };
}
