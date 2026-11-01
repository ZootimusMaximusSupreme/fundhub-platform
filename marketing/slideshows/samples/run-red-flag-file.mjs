#!/usr/bin/env node
// Runs the red-flag sample file (./red-flag-file.mjs) through the real
// UnderwriteIQ engine and writes ./red-flag-file.result.json.
//
//   node marketing/slideshows/samples/run-red-flag-file.mjs           write the JSON
//   node marketing/slideshows/samples/run-red-flag-file.mjs --check   exit 1 if a fresh run differs from the saved JSON
//
// No database, no network, no bureau. SIMULATED file (see red-flag-file.mjs).
//
// THE ENGINE. vendor/underwriteiq-full/api/lite/crs (the CRS engine), called the
// way the product calls it after a pull: runTierEngineFromCrsResult()
// (src/finance/crs-tier.mjs) and scoreBuyerTotal() (src/finance/crs-pull.mjs).
// It is the same engine that printed the old /roadmap sample
// (ops/workflows/2026-10-02-roadmap-sample-content/w1-samples.json).
//
// TODAY is the engine's own answer for the file as it stands.
//
// AFTER is worked out three ways, and the JSON keeps all three, because the
// product has two "after" functions and they disagree on a file like this one:
//   1. after_fixed_file (THE HEADLINE). The engine run a second time on the
//      same file with only the fixes applied: each card paid down to 10% of its
//      limit (src/waypoints/definitions.mjs PAYDOWN_TARGET_FRACTION) and the
//      inquiries the dispute floor disputes taken off
//      (src/metro2/diy/personal-info-floor.mjs inquiryHasAccount). Every balance
//      on the slide and the figure come from one engine run.
//   2. engine_projection. The engine's own projectedPreapproval (engine.js
//      buildProjectedSignals). It assumes 9% card use but keeps TODAY's tier,
//      so a funding-plus-repair file keeps its 0.6 cut. This is the "after
//      optimization" figure the client's funding snapshot prints
//      (src/underwrite/black-report-client.mjs preapproval_after). The board
//      records that flaw: ops/workflows/weekend-2026-10-24.md 10.2 item 2.
//   3. present_deck_projection. The closer's Present deck
//      (src/sales/deck-visual-data.mjs buildDeckVisualData), which re-checks
//      the tier on the cleaned signals and also assumes 9% card use.
//
// THE CLOCK. The engine reads the clock in places (derive-business-signals.js,
// optimization-findings.js monthsAgo, the identity gate's 30-day freshness test).
// So the run pins the clock to the file's pull day, PULLED_AT, before any engine
// module loads. The same file then prints the same figures on any day, and two
// runs write byte-identical JSON.

import { mock } from "node:test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const repo = (p) => new URL(`../../../${p}`, import.meta.url).href;

const {
  buildRedFlagFile, SAMPLE_NOTICE, PULLED_AT, PERSON, SCORES, CARDS, AUTO_LOAN, INQUIRIES
} = await import("./red-flag-file.mjs");

// Pin the clock first. Engine modules load after this line.
process.removeAllListeners("warning"); // mock timers print an "experimental" note
mock.timers.enable({ apis: ["Date"], now: Date.parse(PULLED_AT) });

const crsEngine = (await import(repo("src/finance/vendor/crs-engine.cjs"))).default;
const { runTierEngineFromCrsResult } = await import(repo("src/finance/crs-tier.mjs"));
const { scoreBuyerTotal } = await import(repo("src/finance/crs-pull.mjs"));
const { buildDeckVisualData } = await import(repo("src/sales/deck-visual-data.mjs"));
const { buildBlackReportClient, mergeStoredUnderwrite } = await import(repo("src/underwrite/black-report-client.mjs"));
const { accountKeysFromPull, inquiryHasAccount } = await import(repo("src/metro2/diy/personal-info-floor.mjs"));
const { PAYDOWN_TARGET_FRACTION } = await import(repo("src/waypoints/definitions.mjs"));

const OUT = here("./red-flag-file.result.json");
const referenceDate = new Date(PULLED_AT);
const runEngine = (args) => crsEngine.runCRSEngine({ ...args, referenceDate });
const runTier = (pull, opts) => runTierEngineFromCrsResult(pull, opts, { runEngine });
/* The same tier options finishStored() builds after a real pull (crs-pull.mjs). */
const tierOpts = {
  submittedName: PERSON.name,
  submittedAddress: PERSON.addressLine,
  formData: { name: PERSON.name, email: null, phone: null }
};

/* Whole percent, rounded the engine's way (optimization-findings.js), so these
   match the engine's own card sentences exactly. */
const pct = (balance, limit) => Math.round((balance / limit) * 100);

/* ── the fixes ─────────────────────────────────────────────────────────────── */

const todayFile = buildRedFlagFile();
const targetOf = (card) => Math.round(card.limit * PAYDOWN_TARGET_FRACTION);
const paidDown = Object.fromEntries(CARDS.map((c) => [c.ref, targetOf(c)]));
const accountKeys = accountKeysFromPull(todayFile);
const disputed = INQUIRIES.filter((i) => !inquiryHasAccount(i.creditorName, accountKeys));
const kept = INQUIRIES.filter((i) => inquiryHasAccount(i.creditorName, accountKeys));
const fixedFile = buildRedFlagFile({ balances: paidDown, inquiries: kept });

/* ── the engine runs ───────────────────────────────────────────────────────── */

function engineView(run, fundingEstimate) {
  const p = run.preapprovals;
  const cs = run.consumerSignals;
  return {
    outcome: run.outcome,
    decision_label: run.decision_label,
    decision_explanation: run.decision_explanation,
    fundable: run.outcome === "FULL_FUNDING" || run.outcome === "PREMIUM_STACK",
    funding_total: fundingEstimate,
    funding: {
      personal_card: { base: p.personalCard.base, final: p.personalCard.final, offer_band: p.personalCard.offerBand },
      personal_loan: { base: p.personalLoan.base, final: p.personalLoan.final, offer_band: p.personalLoan.offerBand },
      business: { final: p.business.final, cap_reason: p.business.capReason },
      total_personal: p.totalPersonal,
      total_combined: p.totalCombined,
      modifiers: p.personalCard.modifiers,
      confidence_band: p.confidenceBand
    },
    per_bureau_funding: "The CRS engine prints one funding figure for the whole file, not one per bureau.",
    signals: {
      median_score: cs.scores.median,
      scores: cs.scores.perBureau,
      card_use: { total_balance: cs.utilization.totalBalance, total_limit: cs.utilization.totalLimit, pct: cs.utilization.pct, band: cs.utilization.band },
      card_use_note: "The engine sums every bureau copy of each card, so its dollar totals are three times one account's. The percent is right. See black-report-client.mjs F43.",
      anchors: cs.anchors,
      inquiries: cs.inquiries,
      negatives_by_bureau: Object.fromEntries(Object.entries(cs.bureauNegatives).map(([b, v]) => [b, { clean: v.clean, count: v.count }])),
      thin_file: cs.tradelines.thinFile
    },
    reason_codes: run.reason_codes,
    consumer_summary: run.consumer_summary,
    engine_suggestions_note: "As printed. The engine repeats each card sentence once per bureau copy, and its overall card-use line counts the dollars three times (the percent is right). Quote the per-card sentences once, and take overall dollars from person.cards_total. NO_INSTALLMENT counts only OPEN loans; the paid-off Toyota loan is on the file, so do not put that sentence on a slide.",
    engine_suggestions: run.suggestions.fullSuggestions.map((s) => ({
      code: s.code, severity: s.severity, problem: s.problem, why_it_matters: s.whyItMatters, action: s.action
    })),
    engine_cta: run.suggestions.cta
  };
}

const today = scoreBuyerTotal(runTier, todayFile, tierOpts);
const after = scoreBuyerTotal(runTier, fixedFile, tierOpts);

/* What the client's own report prints from today's run (funding snapshot). */
const client = buildBlackReportClient({
  crsResult: mergeStoredUnderwrite(today.tierResult, todayFile),
  personal: { name: PERSON.name, address: PERSON.addressLine },
  now: referenceDate
});

/* What the closer's Present deck prints for the same pull. */
const deck = buildDeckVisualData({
  crs: { result: todayFile, created_at: PULLED_AT },
  engine: { available: true, total: null, outcome: null, sample: true },
  name: PERSON.name,
  businesses: []
});

const proj = today.tierResult.projectedPreapproval;
const totalLimit = CARDS.reduce((n, c) => n + c.limit, 0);
const totalToday = CARDS.reduce((n, c) => n + c.balance, 0);
const totalAfter = CARDS.reduce((n, c) => n + targetOf(c), 0);

const result = {
  _meta: {
    simulated: true,
    notice: SAMPLE_NOTICE,
    what: "One simulated person, one credit file, run through the real UnderwriteIQ CRS engine for today and again with the fixes applied. Every dollar figure below is printed by the engine. None is typed in.",
    sample_file: "marketing/slideshows/samples/red-flag-file.mjs",
    runner: "marketing/slideshows/samples/run-red-flag-file.mjs",
    engine: "vendor/underwriteiq-full/api/lite/crs/engine.js runCRSEngine, through src/finance/crs-tier.mjs runTierEngineFromCrsResult and src/finance/crs-pull.mjs scoreBuyerTotal",
    clock: `Pinned to the pull day, ${PULLED_AT}, so the result is the same on every run.`,
    reproduce: [
      "node marketing/slideshows/samples/run-red-flag-file.mjs",
      "node marketing/slideshows/samples/run-red-flag-file.mjs --check"
    ]
  },
  headline: {
    today: today.fundingEstimate,
    after: after.fundingEstimate,
    difference: after.fundingEstimate - today.fundingEstimate,
    times_larger: Math.round((after.fundingEstimate / today.fundingEstimate) * 100) / 100,
    tier_today: today.tierResult.outcome,
    tier_after: after.tierResult.outcome,
    method: "Today: the engine on the file as it stands. After: the engine run a second time on the same file with only the fixes below applied."
  },
  person: {
    name: PERSON.name,
    name_note: "Made up. Sample address and employer.",
    address: PERSON.addressLine,
    employer: PERSON.employer,
    has_llc: PERSON.hasLLC,
    scores: { experian: SCORES.EX, equifax: SCORES.EQ, transunion: SCORES.TU, median: today.tierResult.consumerSignals.scores.median },
    scores_note: "Scores are inputs on the file. The engine does not compute a new score, so the fixed-file run keeps the same scores.",
    cards: CARDS.map((c) => ({
      creditor: c.creditor, opened: c.opened, limit: c.limit,
      balance_today: c.balance, pct_used_today: pct(c.balance, c.limit),
      paydown_target: targetOf(c), pct_used_after: pct(targetOf(c), c.limit),
      amount_to_pay: c.balance - targetOf(c), bureaus: "Experian, Equifax, TransUnion"
    })),
    cards_total: {
      limit: totalLimit, balance_today: totalToday, pct_used_today: pct(totalToday, totalLimit),
      balance_after: totalAfter, pct_used_after: pct(totalAfter, totalLimit), amount_to_pay: totalToday - totalAfter
    },
    installment: {
      creditor: AUTO_LOAN.creditor, status: "Closed, paid in full", opened: AUTO_LOAN.opened, closed: AUTO_LOAN.closed,
      original_amount: AUTO_LOAN.high, late_payments: 0, bureaus: "Experian, Equifax, TransUnion"
    },
    inquiries: INQUIRIES.map((i) => ({
      who_pulled: i.creditorName, bureau: { EX: "Experian", EQ: "Equifax", TU: "TransUnion" }[i.bureau],
      date: i.date, why: i.why, disputed: disputed.includes(i),
      dispute_rule: disputed.includes(i)
        ? "No account from this company is on the file (personal-info-floor.mjs PI-INQUIRY-UNMATCHED)."
        : "Kept. The Chase card on the file explains it."
    })),
    negatives: [],
    negatives_note: "No late payments, collections, charge-offs or public records. The engine reads every bureau as clean.",
    late_payments: 0
  },
  fixes_applied: [
    {
      fix: "Pay each card down to 10% of its limit",
      rule: `src/waypoints/definitions.mjs PAYDOWN_TARGET_FRACTION = ${PAYDOWN_TARGET_FRACTION}`,
      changes: CARDS.map((c) => ({ creditor: c.creditor, balance_from: c.balance, balance_to: targetOf(c) }))
    },
    {
      fix: "Dispute the inquiries with no account behind them, taken off the fixed file",
      rule: "src/metro2/diy/personal-info-floor.mjs inquiryHasAccount",
      removed: disputed.map((i) => ({ who_pulled: i.creditorName, bureau: i.bureau, date: i.date })),
      kept: kept.map((i) => ({ who_pulled: i.creditorName, bureau: i.bureau, date: i.date })),
      effect_on_funding: "None. The engine's amount moves only on card use, the tier and a thin file (estimate-preapprovals.js). The engine says it itself: inquiries are cleanup only and do not affect funding."
    }
  ],
  nothing_else_changed: "Same person, same scores, same accounts, same limits, same dates, same pull day.",
  why_the_jump: [
    "Today the cards are 88% used. The engine puts that in its critical band and cuts the amount to 0.4.",
    "Card use of 30% or more also keeps the file out of full funding, so it lands in funding plus repair, which cuts it to 0.6. Together that is 0.24 of the file's base.",
    "At 10% the engine reads card use as good (0.9) and the clean file routes to full funding (1.0).",
    "The base is the file's own: the $20,000 American Express limit times 5.5, plus the $28,000 Toyota loan times 3 (estimate-preapprovals.js)."
  ],
  today: engineView(today.tierResult, today.fundingEstimate),
  after_fixed_file: engineView(after.tierResult, after.fundingEstimate),
  other_after_figures: {
    note: "The product's two projection functions print different 'after' figures for this file. Both are engine output. Do not mix them with the headline on one slide.",
    engine_projection: {
      total: proj?.totalCombined ?? null,
      what: "engine.js projectedPreapproval. Assumes 9% card use, keeps today's tier (0.6). The client's funding snapshot prints this as 'after optimization'.",
      client_report_prints: { preapproval_now: client.preapproval_now, preapproval_after: client.preapproval_after, util_pct: client.util_pct, util_total_balance: client.util_total_balance, util_total_limit: client.util_total_limit, util_target_balance: client.util_target_balance }
    },
    present_deck_projection: {
      total: deck.optimizedTotal,
      today_total: deck.todayTotal,
      tier_now: deck.tierNow,
      tier_after: deck.tierAfter,
      levers: deck.levers,
      what: "src/sales/deck-visual-data.mjs. Assumes 9% card use and re-checks the tier. Paying the cards to under 9.5% overall (the engine rounds the percent) is what this figure needs."
    }
  }
};

const json = `${JSON.stringify(result, null, 2)}\n`;
mock.timers.reset();

if (process.argv.includes("--check")) {
  const saved = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  if (saved !== json) {
    console.error(`red-flag-file.result.json differs from a fresh run (saved ${sha(saved).slice(0, 12)}, fresh ${sha(json).slice(0, 12)}).`);
    process.exit(1);
  }
  console.log(`red-flag-file.result.json matches a fresh run (sha256 ${sha(json)}).`);
} else {
  writeFileSync(OUT, json);
  console.log(`Wrote ${OUT}`);
  console.log(`Today ${today.tierResult.outcome} $${today.fundingEstimate.toLocaleString("en-US")} -> after ${after.tierResult.outcome} $${after.fundingEstimate.toLocaleString("en-US")}`);
  console.log(`Engine projection $${(proj?.totalCombined ?? 0).toLocaleString("en-US")}, Present deck $${(deck.optimizedTotal ?? 0).toLocaleString("en-US")}`);
}
