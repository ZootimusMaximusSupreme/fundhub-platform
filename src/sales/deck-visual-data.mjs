// The numbers the closer's new slide visuals draw (sales-slides build, unit W1,
// 2026-10-29). Board: ops/workflows/weekend-2026-10-24.md sections 10.2 and 10.8.
//
// WHAT THIS IS. One pure function, buildDeckVisualData(), that turns the stored
// credit pull into the `engine.visual` object the deck hands to the visuals. Every
// dollar in it is the UnderwriteIQ CRS engine's own (vendor/underwriteiq-full/api/
// lite/crs). Nothing here is a new rule about credit. When the engine cannot give a
// value the value is null, never a guess, and the visual shows its "not on this
// file yet" state.
//
// WHY A SECOND ENGINE RUN AT ALL. A live pull stores the bureau reports, the
// scores, the tier and one dollar estimate (src/finance/crs-map.mjs, crs-pull.mjs).
// It does not store the once-fixed amount, the reasons or the negative items, so
// the deck cannot read them off the row (10.2 item 1). The engine works them out
// when it prints the client's own report (src/underwrite/black-report-client.mjs).
// This file runs the same engine on the same stored pull, the same way
// letter-pack.mjs and paydown-simulator.mjs already do (runTierEngineFromCrsResult).
//
// THE LEVERS ARE THE ENGINE'S OWN. estimatePreapprovals() moves the amount for
// only a few reasons (10.2 item 3): card use (the utilization band), the tier
// (1.0, 0.6 or 0), a thin file (0.6) and business age. So each lever here changes
// the engine's signals the way buildProjectedSignals() in engine.js does, then
// asks the engine's own routeOutcome() and estimatePreapprovals() for the answer:
//
//   paydown   every card to 10% of its limit. engine.js calls that 9% in the
//             "excellent" band; the same three lines are used here.
//   clean     every derogatory resolved. engine.js zeroes the counts but leaves the
//             per-bureau clean flags alone and passes TODAY's tier to the estimator,
//             so a repair-only file projects $0 and a funding-plus-repair file keeps
//             its 0.6 cut (10.2 item 2). Here the bureau flags are cleared too and
//             the tier is re-checked with routeOutcome() on the cleaned file. A
//             bankruptcy is a public record; engine.js leaves it alone and so does
//             this.
//   accounts  the thin-file cut lifted. Only for a file that is thin.
//
// They stack in that order. Each lever's `totalAfter` is the running total after
// that lever. `applies` is true only when the lever moved the amount or the tier,
// so a lever that changes nothing does not show.
//
// THE TOTAL IS THE REPO'S OWN SUM. scoreBuyerTotal() in crs-pull.mjs adds the
// personal money and every company's business money the way the pull did. It is
// called here once per lever, with a runner that returns the lever-adjusted result.
//
// F15 STILL HOLDS. todayTotal is the headline the deck already quotes. When the
// deck has one stored (the number the client portal shows), todayTotal is that
// number and nothing else. When none is stored, which is every $0 file because the
// portal's reader drops zero, it is the engine's own answer for the same pull.
// newCompany (what ONE more company would add) is priced on the engine's
// personalCard.base with the engine's age rule, before any tier or card-use cut,
// and is never added to todayTotal, to a lever, or to optimizedTotal. Each company
// already on the file is priced at its own report's `final`, the part of the
// headline that company supplies.
//
// THE CLOCK. The engine's identity gate calls any report older than 30 days
// "stale" and routes the file to manual review, which is $0. Re-running a stored
// pull later therefore reads as a different file than the one that was priced. The
// engine is run here with referenceDate set to the day the reports were pulled, so
// it reproduces what the pull said. (runTierEngineFromCrsResult passes no date; its
// `runEngine` seam is how the date is set without touching that file.)
//
// ONE NUMBER ON THE SCREEN. If the stored headline, or the stored tier, does not
// match what the engine just worked out for the same pull, the money chain is
// withheld (null) instead of putting two different amounts next to each other.
// The lists (cards, items, mismatches, companies) do not depend on that and stay.
//
// fundability is null on purpose. src/finance/fundability.mjs counts the checks of
// the older UnderwriteIQ Lite engine and looks ahead only along the client's OWN
// plan (waypoints and open dispute items). A client who has not bought has no plan,
// and the module cannot add accounts, so it has no honest "after" for this file.
// Building one here would be a new rule, so it stays null until Chris says what
// "after" means for that count.
//
// Pure. No database, no network. One thing the report date does not pin: a
// company's age is read from today's date (derive-business-signals.js), so a
// company that crosses the 12 or 24 month line between the pull and the call
// prices differently from the stored headline. The check above then withholds the
// money instead of showing a second number.

import { createRequire } from "node:module";
import crsEngineBridge from "../finance/vendor/crs-engine.cjs";
import { runTierEngineFromCrsResult, CODE_TO_NAME } from "../finance/crs-tier.mjs";
import { scoreBuyerTotal } from "../finance/crs-pull.mjs";
import { businessFundingDollars } from "../underwrite/business-funding.mjs";
import { scoreCompanyReports } from "../underwrite/letter-pack.mjs";
import { buildBlackReportClient, mergeStoredUnderwrite } from "../underwrite/black-report-client.mjs";
import { rankedRevolving, openRevolving, targetBal } from "../deliverables/derive.mjs";
import { parsePct } from "../deliverables/format.mjs";

/* The estimator and the router are not on the engine's export list, so they are
   loaded the way black-report-client.mjs loads the lender matcher. Same relative
   path on purpose: it resolves from src/<folder>/ and from the bundled function,
   and netlify.toml ships vendor/underwriteiq-full/** for it. */
const require = createRequire(import.meta.url);
const { estimatePreapprovals } = require("../../vendor/underwriteiq-full/api/lite/crs/estimate-preapprovals.js");
const { routeOutcome } = require("../../vendor/underwriteiq-full/api/lite/crs/route-outcome.js");
const { matchLenders } = require("../../vendor/underwriteiq-full/api/lite/crs/lender-matrix.js");

const FULL = "FULL_FUNDING";
const FUNDING_PLUS_REPAIR = "FUNDING_PLUS_REPAIR";
const REPAIR_ONLY = "REPAIR_ONLY";

/** The three tiers a closer talks about. A premium file is a full-funding file. */
const TIER_LABEL = Object.freeze({
  PREMIUM_STACK: FULL,
  FULL_FUNDING: FULL,
  FUNDING_PLUS_REPAIR,
  REPAIR_ONLY
});

export const DECK_VISUAL_LEVERS = Object.freeze([
  Object.freeze({ key: "paydown", label: "Pay the cards down" }),
  Object.freeze({ key: "clean", label: "Clean the file" }),
  Object.freeze({ key: "accounts", label: "Add accounts" })
]);

const BUREAU_CODE = Object.freeze({ experian: "EX", transunion: "TU", equifax: "EQ" });
const BUREAU_ORDER = Object.freeze(["EX", "TU", "EQ"]);

function tierLabel(outcome) {
  return TIER_LABEL[String(outcome || "")] ?? null;
}

function numberOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The empty object, in the exact shape of the 10.8 contract. */
export function emptyDeckVisual({ source = "none", todayTotal = null, companies = [] } = {}) {
  return {
    source,
    pulledOn: null,
    todayTotal,
    availableCredit: null,
    reportedEmployers: [],
    lenderReach: null,
    levers: DECK_VISUAL_LEVERS.map(({ key, label }) => ({ key, label, applies: false, totalAfter: null })),
    optimizedTotal: null,
    tierNow: null,
    tierAfter: null,
    cards: [],
    items: [],
    mismatches: [],
    companies,
    newCompany: null,
    fundability: null
  };
}

/* ── the three levers, on a copy of the engine's own signals ──────────────── */

const UTIL_CODES = new Set(["UTIL_CARD_OVER_10", "UTIL_OVERALL_HIGH"]);

/** engine.js buildProjectedSignals(), utilization block, line for line. */
function payDownCards(cs, findings) {
  const hasUtilFindings = findings.some((f) => UTIL_CODES.has(f.code));
  if (!hasUtilFindings || !(cs.utilization.totalLimit > 0)) return;
  cs.utilization.pct = 9;
  cs.utilization.band = "excellent";
  cs.utilization.totalBalance = Math.round(cs.utilization.totalLimit * 0.09);
}

/** engine.js zeroes the derogatory counts; the per-bureau flags are cleared as well
 *  so the router sees a cleaned file. Bankruptcy flags are left as they are. */
function cleanFile(cs) {
  const d = cs.derogatories;
  d.active = 0;
  d.chargeoffs = 0;
  d.collections = 0;
  d.active30 = 0;
  d.active60 = 0;
  d.active90 = 0;
  d.active120Plus = 0;
  d.worstSeverity = 0;
  cs.paymentHistory.recentActivity = false;
  const pulled = Object.values(cs.bureauNegatives || {}).filter((b) => b && b.pulled);
  for (const b of pulled) {
    b.clean = true;
    b.count = 0;
    b.items = [];
  }
  cs.allBureausClean = pulled.length > 0;
  cs.anyBureauClean = pulled.length > 0;
}

/** The thin-file cut lifted (derive-consumer-signals.js: fewer than 3 main accounts). */
function addAccounts(cs) {
  cs.tradelines.thinFile = false;
}

/** engine.js lines 238-251: a requested bureau that returned nothing, or returned
 *  a file with no accounts, makes the pull incomplete. */
function hasIncompleteBureaus(engineResult, merged) {
  const asked = (Array.isArray(merged?.bureausPulled) ? merged.bureausPulled : [])
    .map((code) => CODE_TO_NAME[code])
    .filter(Boolean);
  const available = engineResult.normalized?.meta?.availableBureaus || [];
  const expected = asked.length ? asked : available;
  const have = new Set(available);
  const missing = expected.filter((b) => !have.has(b));
  const noData = available.filter((b) => !engineResult.consumerSignals?.bureauNegatives?.[b]?.pulled);
  return missing.length + noData.length > 0;
}

/**
 * projectEngineRun(engineResult, merged, upTo) → { outcome, preapprovals }
 *
 * The engine's answer for the same file with the first `upTo` levers applied
 * (0 is the engine's own answer, untouched). `recheckTier: false` passes today's
 * tier through the way engine.js does for projectedPreapproval; it exists so a
 * test can prove the lever signals match the engine's own projection.
 */
export function projectEngineRun(engineResult, merged, upTo, { recheckTier = true } = {}) {
  if (upTo <= 0) return engineResult;
  const cs = structuredClone(engineResult.consumerSignals);
  if (upTo >= 1) payDownCards(cs, engineResult.findings || []);
  if (upTo >= 2) cleanFile(cs);
  if (upTo >= 3) addAccounts(cs);
  let outcome = engineResult.outcome;
  if (recheckTier) {
    outcome = routeOutcome(cs, engineResult.businessSignals, engineResult.identityGate).outcome;
    // engine.js Q8: never fund off an incomplete pull.
    const funded = outcome === "FULL_FUNDING" || outcome === "PREMIUM_STACK";
    if (funded && hasIncompleteBureaus(engineResult, merged)) outcome = "MANUAL_REVIEW";
  }
  return { outcome, preapprovals: estimatePreapprovals(cs, engineResult.businessSignals, outcome) };
}

/* ── the lists, from the same engine run ─────────────────────────────────── */

function reportDateOf(merged, createdAt) {
  const pulled = Object.values(merged?.bureaus || {})
    .map((report) => Date.parse(report?.responseDetail?.dateRequested))
    .filter(Number.isFinite);
  if (pulled.length) return new Date(Math.max(...pulled));
  for (const fallback of [merged?.pulledAt, createdAt]) {
    const t = Date.parse(fallback);
    if (Number.isFinite(t)) return new Date(t);
  }
  return undefined;
}

/** One row per open card with a limit, highest use first. The balances and the 10%
 *  target are the client report's own (collapsed bureau copies, derive.mjs). */
function cardsOf(reportClient) {
  const open = openRevolving({ revolving: rankedRevolving(reportClient) });
  const cards = [];
  for (const row of open) {
    const limit = numberOrNull(row[3]);
    if (!(limit > 0)) continue;
    cards.push({
      creditor: String(row[0]),
      limit,
      balance: numberOrNull(row[2]),
      target: targetBal(row),
      usePct: parsePct(row[4])
    });
  }
  return cards;
}

/** Reported headroom on open revolving cards only. An unknown balance or limit
 *  withholds the whole total, including when the card has no preset limit. */
function availableCreditOf(reportClient) {
  const open = openRevolving({ revolving: rankedRevolving(reportClient) });
  if (!open.length) return null;
  let total = 0;
  for (const row of open) {
    const limit = numberOrNull(row[3]);
    const balance = numberOrNull(row[2]);
    if (limit == null || balance == null || limit < 0 || balance < 0) return null;
    total += Math.max(0, limit - balance);
  }
  return total;
}

function plainCreditor(name) {
  const s = String(name ?? "").trim();
  return !s || s.toLowerCase() === "unknown" ? "Unnamed creditor" : s;
}

/** engine derive-consumer-signals.js bureauNegatives test, word for word. */
function isNegativeCopy(t) {
  return Boolean(
    t.isDerogatory
    || t.currentRatingType === "ChargeOff"
    || t.adverseRatings?.highest?.type === "CollectionOrChargeOff"
    || (t.latePayments && (t.latePayments._30 > 0 || t.latePayments._60 > 0 || t.latePayments._90 > 0))
  );
}

function kindOfCopy(t, medicalCreditors) {
  if (t.currentRatingType === "ChargeOff") return "charge_off";
  if (t.adverseRatings?.highest?.type === "CollectionOrChargeOff") {
    return medicalCreditors.has(String(t.creditorName)) ? "medical" : "collection";
  }
  const lates = t.latePayments || {};
  if (lates._30 > 0 || lates._60 > 0 || lates._90 > 0 || /^Late/.test(String(t.currentRatingType))) return "late";
  return "other";
}

function publicRecordName(record) {
  const type = String(record?.type || "").trim();
  if (!type || type === "unknown") return "Public record";
  return type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
}

function orderedBureaus(set) {
  return BUREAU_ORDER.filter((code) => set.has(code));
}

/** The engine's negative items: one row per account, the bureaus that carry it. */
function itemsOf(engineResult) {
  const medical = new Set(
    (engineResult.findings || [])
      .filter((f) => f.code === "MEDICAL_COLLECTION")
      .map((f) => String(f.accountData?.creditorName))
  );
  const groups = new Map();
  const add = (creditor, kind, balance, source) => {
    const key = [creditor.toLowerCase(), kind, balance ?? ""].join("|");
    if (!groups.has(key)) groups.set(key, { creditor, kind, bureaus: new Set() });
    const code = BUREAU_CODE[source];
    if (code) groups.get(key).bureaus.add(code);
  };
  for (const t of engineResult.normalized?.tradelines || []) {
    if (!isNegativeCopy(t)) continue;
    add(plainCreditor(t.creditorName), kindOfCopy(t, medical), numberOrNull(t.currentBalance), t.source);
  }
  for (const record of engineResult.normalized?.publicRecords || []) {
    const key = [record.filedDate || "", record.dispositionType || "", record.docketId || ""].join("/");
    add(publicRecordName(record), "public_record", key, record.source);
  }
  return [...groups.values()].map((g) => ({ creditor: g.creditor, kind: g.kind, bureaus: orderedBureaus(g.bureaus) }));
}

const known = (s) => (s && s !== "unknown" ? String(s).trim() : "");

function nameText(n) {
  return [n.first, n.middle, n.last].map(known).filter(Boolean).join(" ");
}

function addressText(a) {
  const street = [known(a.line1), known(a.line2)].filter(Boolean).join(" ");
  const place = [known(a.city), [known(a.state), known(a.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, place].filter(Boolean).join(", ");
}

function valuesByBureau(list, text) {
  const out = { EX: null, TU: null, EQ: null };
  for (const code of BUREAU_ORDER) {
    const seen = [];
    for (const entry of list) {
      if (BUREAU_CODE[entry.source] !== code) continue;
      const value = text(entry);
      if (value && !seen.includes(value)) seen.push(value);
    }
    out[code] = seen.length ? seen.join(" / ") : null;
  }
  return out;
}

/** Name and address mismatches, only when the engine's own finding fired. */
function mismatchesOf(engineResult) {
  const fired = new Set((engineResult.findings || []).map((f) => f.code));
  const identity = engineResult.normalized?.identity || {};
  const out = [];
  if (fired.has("NAME_VARIATIONS")) {
    out.push({ field: "name", values: valuesByBureau(identity.names || [], nameText) });
  }
  if (fired.has("MULTIPLE_ADDRESSES")) {
    out.push({ field: "address", values: valuesByBureau(identity.addresses || [], addressText) });
  }
  return out;
}

/** Employer names as reported by the bureaus. These can be old; the client must
 * confirm the current employer before entering one on a financing application. */
function reportedEmployersOf(engineResult) {
  const entries = engineResult.normalized?.identity?.employers;
  if (!Array.isArray(entries)) return [];
  const byName = new Map();
  for (const entry of entries) {
    const name = known(entry?.name);
    const bureau = BUREAU_CODE[entry?.source];
    if (!name || !bureau) continue;
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name, bureaus: [] });
    const row = byName.get(key);
    if (!row.bureaus.includes(bureau)) row.bureaus.push(bureau);
  }
  return [...byName.values()].map((row) => ({
    name: row.name,
    bureaus: orderedBureaus(new Set(row.bureaus))
  }));
}

function companyRows(businesses, amountOf) {
  return (Array.isArray(businesses) ? businesses : []).map((b) => ({
    name: b?.name ?? null,
    incorporatedDate: b?.incorporated_date ?? null,
    ageMonths: numberOrNull(b?.age_months),
    amount: amountOf ? amountOf(b) : null
  }));
}

const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/* ── the builder ─────────────────────────────────────────────────────────── */

/**
 * buildDeckVisualData({ crs, engine, name, businesses }) → the 10.8 contract.
 *
 * @param {object|null} input.crs        newest crs_results row: { result, outcome_tier, created_at }
 * @param {object}      input.engine     the deck's engine object, after the stored-total override
 *                                       (buildCloserDeck): { available, total, outcome, sample }
 * @param {string}      input.name       the client's name as the pull was ordered under it
 * @param {object[]}    input.businesses the deck's businesses: { name, age_months, incorporated_date }
 *
 * Never throws: this runs inside the Present screen's payload. A file the engine
 * cannot read comes back as source "none", and the slides show today's content.
 */
export function buildDeckVisualData({ crs = null, engine = null, name = "", businesses = [] } = {}) {
  const storedTotal = numberOrNull(engine?.total);
  const nothing = () => emptyDeckVisual({
    source: "none", todayTotal: storedTotal, companies: companyRows(businesses, null)
  });
  try {
    const merged = crs?.result && typeof crs.result === "object" && !Array.isArray(crs.result) ? crs.result : null;
    if (!engine?.available || !merged?.bureaus || typeof merged.bureaus !== "object") return nothing();

    // The day the reports were pulled, so the engine reads the file as it was priced.
    const referenceDate = reportDateOf(merged, crs?.created_at);
    const runEngine = (args) => crsEngineBridge.runCRSEngine({ ...args, referenceDate });
    const submittedName = String(name || "").trim();
    const tierOpts = {
      submittedName,
      submittedAddress: "",
      formData: { name: submittedName || null, email: null, phone: null }
    };

    // One engine run per report (the personal file, then each company), kept for
    // every lever: the levers change a copy of the signals, not the file.
    const runs = new Map();
    const baseRun = (opts) => {
      const key = opts?.businessReport ?? null;
      if (!runs.has(key)) runs.set(key, runTierEngineFromCrsResult(merged, opts, { runEngine }));
      return runs.get(key);
    };
    // The repo's own sum (personal + each company), on a lever-adjusted run.
    const totalAt = (upTo) => scoreBuyerTotal(
      (_pull, opts) => projectEngineRun(baseRun(opts), merged, upTo), merged, tierOpts
    );

    const today = totalAt(0);
    const personalRun = today.tierResult; // upTo 0 is the engine's own, untouched result
    const nowTier = tierLabel(personalRun.outcome);

    // The headline on the screen and the engine's fresh answer for the same pull must
    // agree, or the chain is withheld (see ONE NUMBER ON THE SCREEN above).
    const sameTier = !engine.outcome || engine.outcome === personalRun.outcome;
    const sameTotal = storedTotal == null || Math.round(storedTotal) === Math.round(today.fundingEstimate);
    const chain = nowTier != null && sameTier && sameTotal;
    const todayTotal = storedTotal != null ? storedTotal : (chain ? today.fundingEstimate : null);

    const visual = emptyDeckVisual({ source: engine.sample ? "sample" : "engine", todayTotal });
    visual.pulledOn = referenceDate ? referenceDate.toISOString().slice(0, 10) : null;

    // The lists come from the same engine run and do not depend on the chain.
    const reportClient = buildBlackReportClient({
      crsResult: mergeStoredUnderwrite(personalRun, merged),
      personal: { name: submittedName }
    });
    visual.cards = cardsOf(reportClient);
    visual.availableCredit = availableCreditOf(reportClient);
    visual.reportedEmployers = reportedEmployersOf(personalRun);
    visual.items = itemsOf(personalRun);
    visual.mismatches = mismatchesOf(personalRun);

    const scored = chain
      ? scoreCompanyReports(merged, { submittedName, submittedAddress: "", runEngine: (_pull, opts) => baseRun(opts) })
      : [];
    visual.companies = companyRows(businesses, (b) => {
      const row = scored.find((r) => sameName(r.name, b?.name));
      return row && !row.error && row.business ? numberOrNull(row.business.final) : null;
    });

    if (!chain) return visual;

    // Same engine matcher used by build-closer-result.js. Its after bucket is
    // additional lenders behind a condition, not a total that includes today.
    try {
      const reach = matchLenders(personalRun.consumerSignals, personalRun.businessSignals, personalRun.outcome);
      if (Array.isArray(reach?.availableNow) && Array.isArray(reach?.afterOptimization)) {
        visual.lenderReach = { now: reach.availableNow.length, after: reach.afterOptimization.length };
      }
    } catch {
      // A failed match is unknown, not zero lenders.
    }

    const steps = [today, totalAt(1), totalAt(2), totalAt(3)];
    visual.levers = DECK_VISUAL_LEVERS.map(({ key, label }, i) => {
      const before = steps[i];
      const after = steps[i + 1];
      const tierBefore = tierLabel(before.tierResult.outcome);
      const tierAfter = tierLabel(after.tierResult.outcome);
      return {
        key,
        label,
        // A lever applies when it moves the amount, or moves the file up a tier.
        applies: after.fundingEstimate !== before.fundingEstimate
          || (tierAfter != null && tierAfter !== tierBefore),
        totalAfter: after.fundingEstimate
      };
    });
    visual.optimizedTotal = steps[3].fundingEstimate;
    visual.tierNow = nowTier;
    visual.tierAfter = tierLabel(steps[3].tierResult.outcome);

    // What ONE more company adds as it ages: the engine's card base times its age
    // rule (0.5 under 12 months, 1.0 under 24, 2.0 after). A picture of what is
    // possible. It is not in todayTotal, any lever, or optimizedTotal.
    const base = numberOrNull(personalRun.preapprovals?.personalCard?.base);
    if (base > 0) {
      visual.newCompany = {
        year1: Math.floor(businessFundingDollars(base, 0)),
        year2: Math.floor(businessFundingDollars(base, 12)),
        after2: Math.floor(businessFundingDollars(base, 24))
      };
    }
    return visual;
  } catch (err) {
    console.error("deck-visual-data: could not build the slide numbers —", err?.message || err);
    return nothing();
  }
}
