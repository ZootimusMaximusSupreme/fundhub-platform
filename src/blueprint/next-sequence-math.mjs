// Capital Blueprint — the next funding sequence planner: the math.
//
// THE QUESTION. A funding sequence is about six rounds of applications. After
// one funds, when has the file recovered enough to start the next sequence, so
// the closer can be told the day it is ready?
//
// PURE. No database, no network, no clock. `asOf` is an argument. The reads live
// in next-sequence-facts.mjs and next-sequence-plan.mjs; this file only turns
// what was read into a date, with the reason and the source of every window.
//
// THE RULE THIS FILE LIVES BY (owner, 2026-10-06): never invent a window, a
// bank script or an amount. Every number below is written down somewhere, and
// WINDOWS says where. An input that is missing makes that factor "unknown" and
// the answer "partial". It is never guessed and never counted as zero.
//
// WHERE EACH WINDOW COMES FROM
//   Inquiries, per bureau
//     under 3 in the last 6 months AND under 6 in the last 12 months
//       Legacy Strong page "Hard inquiries - Bureau stacking"
//       (credentials/notion-scrape/output/hard-inquiries-bureau-stacking--f3a39877).
//       "Last 6 Months: ... less than three inquiries in the past six months, you
//       can apply ... Last 12 Months: ... less than six inquiries on one bureau's
//       report in the last year, you can apply."
//     matter most inside 6 months, stop mattering after 12, drop off at 24
//       Legacy Strong pages "Live Bootcamp (FUNDING) - July 2026"
//       (live-bootcamp-funding-july-2026--395c3aa7: "24 months -> disappear / drop
//       off", "over 12 months -> no longer mater", "within 6 months (sometimes) ->
//       matter most"), "Factors Of Credit Score" (factors-of-credit-score--ff7e0bb0:
//       "weighed the heaviest in the first 6 months and don't matter after 12
//       months") and "Inquiry Training" (inquiry-training--ab7693a7: "The only
//       inquiries that matter are within the past 12 months").
//   New credit spacing
//     about every 6 months
//       Legacy Strong page "Factors Of Credit Score": "Apply for new credit
//       products every 6 months to avoid looking risky to the banks".
//   When a new card counts toward the funding estimate
//     24 months old
//       src/underwrite/vendor/underwriter.cjs (`seasoned = ageMonths >= 24`). This
//       does not decide when to apply. It tells the closer when the estimate
//       will include a new card, so it rides along as a note.
//   Card use (utilization)
//     30% or less
//       src/underwrite/vendor/underwriter.cjs (`fundable` needs `util <= 30`,
//       `target_util_pct: 30`), restated in src/underwrite/report.mjs.
//   Fundable
//     score 700 or more and no negative items (same file).
//   One at a time
//     "wait for the decision before you send the next one"
//       src/underwrite/black-report-node.mjs, Application Order Warning.
//
// HOW THE FACTORS COMBINE. Every factor must be met, so the suggested date is the
// LATEST date any factor names. That is the only rule this file adds, and it is
// logic, not a window. A factor that is unknown does not move the date, but it
// turns `confidence` to "partial", and the closer alert only goes out on
// "computed" with no blockers.
//
// WORDS. The push after a sequence is "the next funding sequence". A sequence
// holds about six rounds, so "round" only ever means one of those.

import { addMonths, parseDay } from "../../public/app/money-strategy-math.js";

/* ------------------------------------------------------------------ *
 * Windows and sources
 * ------------------------------------------------------------------ */

export const WINDOWS = Object.freeze({
  inquiryRecent: Object.freeze({ months: 6, under: 3 }),
  inquiryYear: Object.freeze({ months: 12, under: 6 }),
  inquiryStopsMattering: Object.freeze({ months: 12 }),
  inquiryDropsOff: Object.freeze({ months: 24 }),
  newCreditSpacing: Object.freeze({ months: 6 }),
  engineSeasoned: Object.freeze({ months: 24 }),
  utilizationTarget: Object.freeze({ pct: 30 }),
  fundableMinScore: 700
});

const legacy = (page, folder) =>
  `Legacy Strong page "${page}" (credentials/notion-scrape/output/${folder}/FULL.md)`;

export const SOURCES = Object.freeze({
  inquiryRule: Object.freeze({
    label: "Fundhub bureau-stacking rule: under 3 inquiries in 6 months and under 6 in 12 months, per bureau",
    ref: legacy("Hard inquiries - Bureau stacking", "hard-inquiries-bureau-stacking--f3a39877")
  }),
  inquiryAges: Object.freeze({
    label: "Fundhub inquiry ages: they matter most inside 6 months, stop mattering after 12, and drop off at 24",
    ref: `${legacy("Live Bootcamp (FUNDING) - July 2026", "live-bootcamp-funding-july-2026--395c3aa7")}; ` +
      `${legacy("Factors Of Credit Score", "factors-of-credit-score--ff7e0bb0")}; ` +
      `${legacy("Inquiry Training", "inquiry-training--ab7693a7")}`
  }),
  newCredit: Object.freeze({
    label: "Fundhub new-credit spacing: about 6 months between new credit",
    ref: `${legacy("Factors Of Credit Score", "factors-of-credit-score--ff7e0bb0")}: "Apply for new credit products every 6 months"`
  }),
  engineSeasoning: Object.freeze({
    label: "UnderwriteIQ counts a card toward your funding once it is 24 months old",
    ref: "src/underwrite/vendor/underwriter.cjs (seasoned = 24 months or more)"
  }),
  engineUtilization: Object.freeze({
    label: "UnderwriteIQ: card use of 30% or less",
    ref: "src/underwrite/vendor/underwriter.cjs (fundable needs utilization 30 or less; target_util_pct 30)"
  }),
  engineFundable: Object.freeze({
    label: "UnderwriteIQ: fundable needs a score of 700 or more and no negative items",
    ref: "src/underwrite/vendor/underwriter.cjs (fundable)"
  }),
  linkedCards: Object.freeze({
    label: "Your linked cards, the same card-use number as the Strategy tab",
    ref: "bank_accounts credit accounts (src/finance/plan-sources/payoff.mjs overall card use)"
  }),
  creditFile: Object.freeze({
    label: "Your credit file",
    ref: "crs_results + tradelines through UnderwriteIQ (src/finance/bank-strategy.mjs runUnderwrite)"
  }),
  paymentPlan: Object.freeze({
    label: "Your saved payment plan",
    ref: "payment_strategy_plans.summary.crossings (db/migrations/463_payment_strategy_plans.sql; src/finance/payment-strategy.mjs savePlan)"
  }),
  applications: Object.freeze({
    label: "The applications on your funding rounds",
    ref: "applications + funding_rounds (db/schema/001_init.sql, db/migrations/138_lenders.sql)"
  }),
  applicationOrder: Object.freeze({
    label: "Fundhub application order: wait for the decision before you send the next one",
    ref: "src/underwrite/black-report-node.mjs · Application Order Warning"
  }),
  staffDate: Object.freeze({
    label: "Next funding sequence date, set by staff",
    ref: "clients.custom_fields.blueprint_next_sequence_ready_date (src/blueprint/next-funding-sequence.mjs)"
  })
});

export const BUREAU_CODES = Object.freeze(["EX", "EQ", "TU"]);
export const BUREAU_NAMES = Object.freeze({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" });

/* Applications that were actually sent to a bank (they pull credit). 'Apply' is
   still a to-do. 'Applied', 'Missing Docs' and 'Action Required' have no final
   answer yet. */
export const SENT_STATUSES = Object.freeze(["Applied", "Approved", "Denied", "Missing Docs", "Action Required"]);
export const OPEN_STATUSES = Object.freeze(["Applied", "Missing Docs", "Action Required"]);

/* ------------------------------------------------------------------ *
 * Small readers
 * ------------------------------------------------------------------ */

/** 'YYYY-MM-DD' from a Date, a timestamp string or a date string. Unreadable → null. */
export function isoDay(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v).trim());
  return m && parseDay(m[1]) ? m[1] : null;
}

/** day + n calendar days (UTC noon, so no clock edge). */
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The first day something dated `day` is MORE than `months` months old.
 * A thing counts through the day it turns `months` months old; the next day is
 * the first clear one. Chosen so the planner never names a date a day early.
 */
export function dayAfterMonths(day, months) {
  const end = addMonths(day, months);
  return end ? addDays(end, 1) : null;
}

const maxDay = (days) => days.reduce((a, b) => (a === null || b > a ? b : a), null);

function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
}

/** "Experian, Equifax and TransUnion" */
function andList(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  return xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
}

const plural = (n, one, many) => (n === 1 ? one : many);

/* ------------------------------------------------------------------ *
 * Inquiries, one bureau at a time
 * ------------------------------------------------------------------ */

/** How many of these inquiry days are inside each window on `day`. Undated ones count in both. */
export function windowCounts(dates, day, undated = 0) {
  let n6 = undated;
  let n12 = undated;
  for (const d of dates) {
    if (d > day) continue; // not on the file yet
    if (day <= addMonths(d, WINDOWS.inquiryRecent.months)) n6 += 1;
    if (day <= addMonths(d, WINDOWS.inquiryYear.months)) n12 += 1;
  }
  return { n6, n12 };
}

const underTheRule = ({ n6, n12 }) =>
  n6 < WINDOWS.inquiryRecent.under && n12 < WINDOWS.inquiryYear.under;

/**
 * bureauPlan({ dates, undated, asOf }) — one bureau against the two limits.
 *
 *   open_now   the bureau is under both limits today
 *   ready_on   the first day it is, when it is not yet (null when open now)
 *   room       how many more applications fit today before a limit is hit
 *   status     ready | waiting | unknown (undated inquiries that never age out)
 *
 * Counts only fall as days pass (no new inquiry is added here), so the first
 * candidate day that passes is the earliest. The candidate days are the days an
 * inquiry leaves a window.
 */
export function bureauPlan({ dates = [], undated = 0, asOf }) {
  const now = windowCounts(dates, asOf, undated);
  const openNow = underTheRule(now);
  const room = openNow
    ? Math.max(0, Math.min(WINDOWS.inquiryRecent.under - now.n6, WINDOWS.inquiryYear.under - now.n12))
    : 0;
  let readyOn = null;
  let status = openNow ? "ready" : "waiting";
  if (!openNow) {
    const days = new Set();
    for (const d of dates) {
      for (const m of [WINDOWS.inquiryRecent.months, WINDOWS.inquiryYear.months]) {
        const c = dayAfterMonths(d, m);
        if (c && c > asOf) days.add(c);
      }
    }
    readyOn = [...days].sort().find((c) => underTheRule(windowCounts(dates, c, undated))) || null;
    if (!readyOn) status = "unknown";
  }
  const newest = maxDay(dates);
  return {
    status,
    open_now: openNow,
    ready_on: readyOn,
    in_6_months: now.n6,
    in_12_months: now.n12,
    room,
    newest_on: newest,
    stops_mattering_on: newest ? dayAfterMonths(newest, WINDOWS.inquiryStopsMattering.months) : null,
    drops_off_on: newest ? dayAfterMonths(newest, WINDOWS.inquiryDropsOff.months) : null
  };
}

/**
 * The inquiry list from the credit pull plus the applications sent after it.
 * A pull cannot show an application sent after the pull ran, so each such
 * application adds one inquiry on its day at each bureau its bank pulls (bank
 * book, or the bureau staff saw). Two applications at one bank on one day are one
 * pull ("Multiple Applications, Single Pull", same Legacy Strong page as the
 * limits). An application sent on or before the pull's day is taken to be on the
 * pull already.
 */
export function applicationInquiries(applications = [], pullOn = null) {
  const out = [];
  const seen = new Set();
  let unknownBureau = 0;
  for (const a of Array.isArray(applications) ? applications : []) {
    if (!a || !SENT_STATUSES.includes(a.status) || !a.applied_on) continue;
    if (pullOn && a.applied_on <= pullOn) continue;
    const bureaus = (Array.isArray(a.bureaus) ? a.bureaus : []).filter((b) => BUREAU_CODES.includes(b));
    if (!bureaus.length) {
      unknownBureau += 1;
      continue;
    }
    const lender = String(a.lender_name || a.id || "").trim().toLowerCase();
    for (const b of bureaus) {
      const key = `${b}|${lender}|${a.applied_on}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ bureau: b, date: a.applied_on, lender: a.lender_name || null, derived: true });
    }
  }
  return { list: out, unknown_bureau: unknownBureau };
}

/** Which limit a bureau is over, in plain words. */
function overLimitWords(p) {
  const bits = [];
  if (p.in_6_months >= WINDOWS.inquiryRecent.under) {
    bits.push(`${p.in_6_months} in the last ${WINDOWS.inquiryRecent.months} months (it needs fewer than ${WINDOWS.inquiryRecent.under})`);
  }
  if (p.in_12_months >= WINDOWS.inquiryYear.under) {
    bits.push(`${p.in_12_months} in the last ${WINDOWS.inquiryYear.months} months (it needs fewer than ${WINDOWS.inquiryYear.under})`);
  }
  return bits.join(" and ");
}

function inquiryTexts(per) {
  return per
    .filter((p) => p.status === "waiting")
    .map((p) => `${p.name} has ${overLimitWords(p)}. It opens on ${p.ready_on}.`);
}

/**
 * inquiriesFactor — all three bureaus must be under both limits.
 *
 * inputs.pull        { on, bureausPulled: ['EX',...], list: [{bureau,date}] | null } | null
 * inputs.counts      { EX, EQ, TU } whole numbers from the file, or null
 * inputs.applications  rows read from the funding rounds
 */
export function inquiriesFactor({ asOf, pull = null, counts = {}, applications = [] } = {}) {
  const pullOn = pull ? pull.on || null : null;
  const derived = applicationInquiries(applications, pullOn);
  const per = [];
  for (const code of BUREAU_CODES) {
    const pulled = !!(pull && Array.isArray(pull.bureausPulled) && pull.bureausPulled.includes(code));
    const fromApps = derived.list.filter((i) => i.bureau === code).map((i) => i.date);
    const base = { bureau: code, name: BUREAU_NAMES[code] };
    if (pulled && Array.isArray(pull.list)) {
      const mine = pull.list.filter((i) => i && i.bureau === code);
      const dated = mine.map((i) => i.date).filter(Boolean);
      const undated = mine.length - dated.length;
      per.push({ ...base, basis: "dates", undated, ...bureauPlan({ dates: [...dated, ...fromApps], undated, asOf }) });
      continue;
    }
    const count = Number.isInteger(counts[code]) && counts[code] >= 0 ? counts[code] : null;
    if (count !== null && count + fromApps.length < WINDOWS.inquiryRecent.under) {
      // Fewer than 3 in all means fewer than 3 in 6 months and fewer than 6 in 12, whatever the days.
      per.push({
        ...base, basis: "count_only", status: "ready", open_now: true, ready_on: null,
        in_6_months: null, in_12_months: null, total: count + fromApps.length, room: null,
        newest_on: null, stops_mattering_on: null, drops_off_on: null, undated: 0
      });
      continue;
    }
    per.push({
      ...base, basis: "none", status: "unknown", open_now: null, ready_on: null,
      in_6_months: null, in_12_months: null, total: count, room: null,
      newest_on: null, stops_mattering_on: null, drops_off_on: null, undated: 0,
      reason: pull ? (pulled ? "no_inquiry_dates" : "bureau_not_pulled") : "no_credit_pull"
    });
  }
  const unknown = per.some((p) => p.status === "unknown") || derived.unknown_bureau > 0;
  const dates = per.map((p) => p.ready_on).filter(Boolean);
  const readyOn = maxDay(dates);
  const status = unknown ? "unknown" : readyOn ? "waiting" : "ready";

  let words;
  if (status === "ready") {
    words = "Every bureau is under both limits now: fewer than 3 inquiries in 6 months and fewer than 6 in 12.";
  } else if (status === "waiting") {
    words = inquiryTexts(per).join(" ");
  } else {
    const missing = per.filter((p) => p.status === "unknown").map((p) => p.name);
    const bits = [];
    if (missing.length) bits.push(`We cannot count the inquiries at ${andList(missing)} yet.`);
    if (derived.unknown_bureau > 0) {
      bits.push(`${derived.unknown_bureau} ${plural(derived.unknown_bureau, "application", "applications")} sent after the last credit pull ` +
        "did not say which bureau the bank pulls.");
    }
    words = bits.join(" ");
  }
  return {
    factor: "inquiries",
    title: "Hard inquiries",
    status,
    ready_on: unknown ? null : readyOn,
    not_before: unknown ? readyOn : null,
    text: words,
    source: SOURCES.inquiryRule,
    also: SOURCES.inquiryAges,
    detail: {
      rule: {
        recent: { months: WINDOWS.inquiryRecent.months, under: WINDOWS.inquiryRecent.under },
        year: { months: WINDOWS.inquiryYear.months, under: WINDOWS.inquiryYear.under }
      },
      pull_on: pullOn,
      from_applications: derived.list.length,
      application_bureau_unknown: derived.unknown_bureau,
      bureaus: per
    }
  };
}

/* ------------------------------------------------------------------ *
 * New credit
 * ------------------------------------------------------------------ */

/** The first day UnderwriteIQ counts a card opened on `openedOn`: the first of the month, 24 months on. */
export function engineSeasonedOn(openedOn) {
  const d = isoDay(openedOn);
  return d ? addMonths(`${d.slice(0, 7)}-01`, WINDOWS.engineSeasoned.months) : null;
}

/**
 * newCreditFactor — about 6 months after the newest new credit.
 *
 * "New credit" is an account that opened, or an application that was sent: an
 * application pulls credit whether or not the bank said yes. The newest of those
 * starts the clock. Open lines with no open date could be newer than any date we
 * hold, so they make the factor unknown rather than letting a guess stand.
 */
export function newCreditFactor({ asOf, accounts = [], applications = [] } = {}) {
  const events = [];
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (a && a.opened_on) events.push({ on: a.opened_on, kind: "account_opened", what: text(a.lender) });
  }
  for (const a of Array.isArray(applications) ? applications : []) {
    if (!a || !SENT_STATUSES.includes(a.status)) continue;
    if (a.applied_on) events.push({ on: a.applied_on, kind: "application", what: text(a.lender_name) });
    if (a.status === "Approved" && a.decided_on) events.push({ on: a.decided_on, kind: "account_opened", what: text(a.lender_name) });
  }
  const undatedOpen = (Array.isArray(accounts) ? accounts : []).filter((a) => a && !a.closed && !a.opened_on).length;
  const newestOn = maxDay(events.map((e) => e.on));
  const newest = newestOn ? events.filter((e) => e.on === newestOn) : [];
  const readyOn = newestOn ? dayAfterMonths(newestOn, WINDOWS.newCreditSpacing.months) : null;

  let status;
  let words;
  if (!newestOn) {
    status = "unknown";
    words = "We have no open dates for your accounts and no applications on file yet.";
  } else if (undatedOpen > 0) {
    status = "unknown";
    words = `${undatedOpen} open ${plural(undatedOpen, "account has", "accounts have")} no open date, so one could be newer than ${newestOn}.`;
  } else if (readyOn <= asOf) {
    status = "ready";
    words = `Your newest new credit was on ${newestOn}. That is more than 6 months ago.`;
  } else {
    status = "waiting";
    words = `Your newest new credit was on ${newestOn}. Fundhub waits about 6 months between new credit, so it opens on ${readyOn}.`;
  }

  const seasoning = [];
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a || a.closed || a.kind !== "revolving" || !a.opened_on) continue;
    const counts = engineSeasonedOn(a.opened_on);
    if (counts && counts > asOf) seasoning.push({ lender: text(a.lender), opened_on: a.opened_on, counts_on: counts });
  }
  seasoning.sort((x, y) => (x.counts_on < y.counts_on ? -1 : x.counts_on > y.counts_on ? 1 : 0));

  return {
    factor: "new_credit",
    title: "New credit",
    status,
    ready_on: status === "unknown" ? null : readyOn,
    not_before: status === "unknown" ? readyOn : null,
    text: words,
    source: SOURCES.newCredit,
    also: SOURCES.engineSeasoning,
    detail: {
      newest_on: newestOn,
      newest: newest.map((e) => ({ kind: e.kind, what: e.what })),
      spacing_months: WINDOWS.newCreditSpacing.months,
      open_accounts_without_date: undatedOpen,
      /* Not a reason to wait. When UnderwriteIQ will START counting each new card
         toward the funding estimate, so nobody expects the estimate to jump early. */
      estimate_counts_new_cards: seasoning
    }
  };
}

/* ------------------------------------------------------------------ *
 * Card use
 * ------------------------------------------------------------------ */

/** Overall card use from linked cards: { num, den } in cents, or null when any piece is unknown. Same rule as payoff pins. */
export function overallCardUse(cards = []) {
  let num = 0;
  let den = 0;
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || c.closed || !Number.isSafeInteger(c.limit_cents) || c.limit_cents <= 0) continue;
    if (!Number.isSafeInteger(c.balance_cents)) return null; // one unread balance: card use is unknown
    num += Math.max(0, c.balance_cents);
    den += c.limit_cents;
  }
  return den > 0 ? { num, den } : null;
}

const pct1 = (num, den) => Math.round((num / den) * 1000) / 10;

/**
 * utilizationFactor — card use back to 30% or less (the engine's target).
 *
 * The number: your linked cards first (the same card use the Strategy tab shows,
 * and today's balances). Without linked cards, the credit file's own number, but
 * only when that file is not older than the sequence's last activity: a file
 * from before the new cards cannot say what you owe now.
 *
 * The date: when card use is above 30%, the date your saved payment plan says it
 * gets there, if that plan was saved after the sequence. No plan, a plan from
 * before the sequence, a plan that missed its own date, or a plan that never gets
 * there all leave the date unknown.
 */
export function utilizationFactor({ asOf, linked = null, file = null, fileStale = false, plan = null, lastActivityOn = null } = {}) {
  const target = WINDOWS.utilizationTarget.pct;
  const linkedRead = !!(linked && Number.isSafeInteger(linked.num) && Number.isSafeInteger(linked.den) && linked.den > 0);
  /* Linked balances are usable when no sequence has happened, or when they were
     taken on or after the sequence's last activity. A balance day we do not know
     cannot be shown to be after it. */
  const linkedOk = linkedRead && (!lastActivityOn || !!(linked.as_of && linked.as_of >= lastActivityOn));
  const fileRead = !!(file && Number.isFinite(file.util_pct));
  const fileOk = fileRead && !fileStale;

  let basis = null;
  let usePct = null;
  let atOrUnder = null;
  let usedAt = null;
  if (linkedOk) {
    basis = "linked_cards";
    usePct = pct1(linked.num, linked.den);
    atOrUnder = linked.num * 100 <= target * linked.den;
    usedAt = linked.as_of || null;
  } else if (fileOk) {
    basis = "credit_file";
    usePct = Math.round(file.util_pct * 10) / 10;
    atOrUnder = file.util_pct <= target;
    usedAt = file.on || null;
  }
  const base = { factor: "utilization", title: "Card use", source: SOURCES.engineUtilization, also: null };
  const detail = (extra) => ({ target_pct: target, basis, use_pct: usePct, as_of: usedAt, ...extra });

  if (basis === null) {
    const why = [];
    if (linkedRead && !linkedOk) {
      why.push(`Your linked card balances are from ${linked.as_of || "a day we do not know"}, before the sequence ended on ${lastActivityOn}.`);
    }
    if (fileRead && fileStale) {
      why.push(`The credit file is from ${file.on}, before the sequence ended on ${lastActivityOn}.`);
    }
    return {
      ...base, status: "unknown", ready_on: null, not_before: null,
      text: why.length ? `${why.join(" ")} Card use needs fresh balances or a new soft pull.` : "We do not have your card balances and limits yet.",
      detail: detail({ reason: why.length ? "balances_older_than_sequence" : "no_balances" })
    };
  }
  const sourceNote = basis === "linked_cards" ? SOURCES.linkedCards : SOURCES.creditFile;
  if (atOrUnder) {
    return {
      ...base, also: sourceNote, status: "ready", ready_on: null, not_before: null,
      text: `Card use is ${usePct}%. The target is ${target}% or less.`,
      detail: detail({ reason: null })
    };
  }

  const crossing = plan && plan.crossing30 ? plan.crossing30 : null;
  const unknown = (reason, words) => ({
    ...base, also: sourceNote, status: "unknown", ready_on: null, not_before: null,
    text: `Card use is ${usePct}%. It needs to be ${target}% or less. ${words}`,
    detail: detail({ reason })
  });
  if (!plan) return unknown("no_saved_plan", "There is no saved payment plan yet, so we cannot say when.");
  if (lastActivityOn && plan.saved_on && plan.saved_on < lastActivityOn) {
    return unknown("plan_predates_sequence", `The saved payment plan is from ${plan.saved_on}, before the sequence ended ${lastActivityOn}. Save a new plan.`);
  }
  if (!crossing) return unknown("plan_has_no_date", "The saved payment plan does not name a date for it.");
  if (crossing.on === null || crossing.on === undefined) {
    return unknown("plan_never_reaches_target", "The saved payment plan never gets card use there.");
  }
  if (crossing.on <= asOf) {
    return unknown("plan_behind", `The saved payment plan said ${crossing.on}, and card use is still above the target.`);
  }
  return {
    ...base, also: SOURCES.paymentPlan, status: "waiting", ready_on: crossing.on, not_before: null,
    text: `Card use is ${usePct}%. It needs to be ${target}% or less. Your saved payment plan gets there on ${crossing.on}.` +
      (crossing.earliest ? " That is the earliest it can be: a rate is missing, so it could take longer." : ""),
    detail: detail({ reason: null, plan_saved_on: plan.saved_on || null, plan_earliest: crossing.earliest === true })
  };
}

/* ------------------------------------------------------------------ *
 * Blockers — things that are not a date
 * ------------------------------------------------------------------ */

export function blockersFor({
  file = null, fileStale = false, fileOn = null, lastActivityOn = null, fundedRounds = 0, applications = [],
  reconsiderations = null
} = {}) {
  const out = [];
  if (!file || file.ran !== true) {
    out.push({
      id: "no_credit_file",
      text: "No credit pull is on file yet. UnderwriteIQ needs one to say your file is ready.",
      source: SOURCES.creditFile
    });
  } else {
    const why = [];
    if (Number.isFinite(file.score) && file.score < WINDOWS.fundableMinScore) {
      why.push(`The score is ${file.score}, and UnderwriteIQ wants ${WINDOWS.fundableMinScore} or more.`);
    }
    if (Number.isFinite(file.negatives) && file.negatives > 0) {
      why.push(`There ${file.negatives === 1 ? "is 1 negative item" : `are ${file.negatives} negative items`} on the file.`);
    }
    if (why.length) {
      out.push({
        id: "not_fundable",
        text: `UnderwriteIQ does not call the file fundable yet. ${why.join(" ")}`,
        source: SOURCES.engineFundable
      });
    }
  }
  if (fileStale) {
    out.push({
      id: "credit_file_stale",
      text: `The credit file is from ${fileOn}, before the sequence ended on ${lastActivityOn}. A new soft pull will show where the file stands now.`,
      source: SOURCES.creditFile
    });
  }
  if (!(fundedRounds > 0)) {
    out.push({
      id: "no_funding_yet",
      text: "No funding round has funded yet. The next funding sequence starts after a first one.",
      source: SOURCES.applications
    });
  }
  const open = (Array.isArray(applications) ? applications : []).filter((a) => a && OPEN_STATUSES.includes(a.status));
  if (open.length) {
    out.push({
      id: "decisions_pending",
      count: open.length,
      text: `${open.length} ${plural(open.length, "application has", "applications have")} no final answer yet. ` +
        "Wait for the decision before you send the next one.",
      source: SOURCES.applicationOrder
    });
  }
  /* A reconsideration someone is still working. The decline-defense unit stores
     these; when it lands, its reader passes { open: n, source } here. Until then
     nothing is tracked, so nothing is open. */
  if (reconsiderations && Number(reconsiderations.open) > 0) {
    const n = Number(reconsiderations.open);
    out.push({
      id: "open_reconsiderations",
      count: n,
      text: `${n} ${plural(n, "bank decline is", "bank declines are")} still being worked. Finish ${plural(n, "it", "them")} before the next funding sequence.`,
      source: reconsiderations.source || SOURCES.applications
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

/**
 * planNextSequence(inputs) — the whole answer. Pure.
 *
 * inputs
 *   asOf            'YYYY-MM-DD'
 *   staffDate       the date staff set, or null (it wins when set)
 *   pull, counts    the credit pull the inquiries come from (see inquiriesFactor)
 *   accounts        [{ lender, kind, opened_on, closed }]
 *   applications    [{ id, status, lender_name, applied_on, decided_on, bureaus }]
 *   rounds          [{ round_number, status, funded, funded_on }]
 *   file            { ran, score, negatives, util_pct, on }   (the engine's reading)
 *   linked          { num, den, as_of } | null                (linked cards)
 *   plan            { saved_on, crossing30: { on, already, earliest } } | null
 *   reconsiderations  { open, source } | null
 *
 * → { ok, as_of, suggested_date, not_before, reasons, blockers, confidence, ready,
 *     staff_date, effective_date, effective_source, flags, after_funding }
 *
 *   reasons[]   one per factor: { factor, title, status: ready | waiting | unknown,
 *               ready_on, not_before, text, source, also, detail }. `ready` with a
 *               null date means nothing to wait for. `unknown` carries no date.
 *   blockers[]  things that are not a date and stop the alert: { id, text, source }
 *   confidence  "computed" when no factor is unknown, else "partial"
 *   ready       computed, no blockers, and the suggested date is today or earlier
 */
export function planNextSequence(inputs = {}) {
  const asOf = isoDay(inputs.asOf);
  if (!asOf) throw new Error("planNextSequence: asOf must be a date");
  const staffDate = isoDay(inputs.staffDate);
  const apps = Array.isArray(inputs.applications) ? inputs.applications : [];
  const rounds = Array.isArray(inputs.rounds) ? inputs.rounds : [];
  const file = inputs.file || null;
  const pull = inputs.pull || null;

  const funded = rounds.filter((r) => r && r.funded);
  const lastFunded = funded.reduce((a, r) => (!a || r.round_number > a.round_number ? r : a), null);
  const sentApps = apps.filter((a) => a && SENT_STATUSES.includes(a.status) && a.applied_on);
  const lastActivityOn = maxDay([
    ...sentApps.map((a) => a.applied_on),
    ...sentApps.filter((a) => a.status === "Approved" && a.decided_on).map((a) => a.decided_on),
    ...funded.map((r) => r.funded_on).filter(Boolean)
  ]);
  const pullOn = pull ? pull.on || null : file && file.on ? file.on : null;
  const fileStale = !!(pullOn && lastActivityOn && pullOn < lastActivityOn);

  const reasons = [
    inquiriesFactor({ asOf, pull, counts: inputs.counts || {}, applications: apps }),
    newCreditFactor({ asOf, accounts: inputs.accounts || [], applications: apps }),
    utilizationFactor({ asOf, linked: inputs.linked || null, file, fileStale, plan: inputs.plan || null, lastActivityOn })
  ];
  const blockers = blockersFor({
    file, fileStale, fileOn: pullOn, lastActivityOn, fundedRounds: funded.length, applications: apps,
    reconsiderations: inputs.reconsiderations || null
  });

  /* The LATEST date any known factor names. A factor that is unknown does not
     move it, but it keeps `confidence` at "partial", and `not_before` carries
     whatever lower bound the unknown factors could still give. */
  const suggested = maxDay(reasons.filter((r) => r.status !== "unknown").map((r) => r.ready_on).filter(Boolean));
  const notBefore = maxDay([suggested, ...reasons.map((r) => r.not_before)].filter(Boolean));
  const unknown = reasons.some((r) => r.status === "unknown");
  const confidence = !unknown && suggested ? "computed" : "partial";
  const ready = confidence === "computed" && blockers.length === 0 && suggested <= asOf;

  const flags = [];
  if (staffDate && suggested && confidence === "computed" && staffDate < suggested) {
    flags.push({
      id: "staff_date_before_suggestion",
      text: `The staff date ${staffDate} is before ${suggested}, the day the file math says the file is ready.`
    });
  }

  return {
    ok: true,
    as_of: asOf,
    suggested_date: suggested,
    not_before: notBefore,
    reasons,
    blockers,
    confidence,
    ready,
    staff_date: staffDate,
    effective_date: staffDate || suggested,
    effective_source: staffDate ? "staff" : suggested ? "suggested" : null,
    flags,
    after_funding: {
      funded_rounds: funded.length,
      last_funded_round: lastFunded ? lastFunded.round_number : null,
      last_funded_on: maxDay(funded.map((r) => r.funded_on).filter(Boolean)),
      last_activity_on: lastActivityOn,
      credit_file_on: pullOn,
      credit_file_stale: fileStale,
      alert_key: lastFunded ? `r${lastFunded.round_number}` : null
    }
  };
}

/** One line a person can read: what the plan says and why. */
export function planSummaryText(plan) {
  if (!plan) return null;
  if (plan.effective_source === "staff") return `Staff set the next funding sequence for ${plan.staff_date}.`;
  if (plan.confidence !== "computed") {
    return plan.not_before
      ? `Fundhub's file math says not before ${plan.not_before}. Some facts are missing.`
      : "Fundhub cannot suggest a date yet. Some facts are missing.";
  }
  const when = plan.suggested_date <= plan.as_of ? "now" : `on ${plan.suggested_date}`;
  if (!plan.blockers.length) return `The file math says the file is ready for the next funding sequence ${when}.`;
  /* The dates are clear but something else is in the way: say the first thing, count the rest. */
  const more = plan.blockers.length - 1;
  return `The dates are clear ${when}, but the file is not ready. ${plan.blockers[0].text}` +
    (more > 0 ? ` ${more} more ${plural(more, "thing", "things")} to fix.` : "");
}
