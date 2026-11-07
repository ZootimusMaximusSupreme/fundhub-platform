// "Your path": the Capital Blueprint checklist, the bank steps, the ChexSystems
// check and the cash deposit plan as ONE ordered list, for the paid buyer's
// dashboard (GET /api/blueprint/plan, field `path`).
//
// OWNER-SET 2026-11-06 (ops/workflows/finance-os-cfo-build-2026-11-06.txt,
// spec items 5, 7 and 8): Blueprint and Finance OS read as one dashboard. Bank
// steps come from the bank book. "You have $X in cash. Put $X here, $Y there."
// A ChexSystems check comes before any bank account opens. Progress for each
// finished step, and never a guessed credit score.
//
// PURE, AND ON PURPOSE IT IMPORTS NOTHING. Every input is a payload another
// read already built: the client's checklist (src/progress/read.mjs), the bank
// strategy read (src/finance/bank-strategy.mjs: recommended_banks and the
// relationships tracker), the saved business plan (src/blueprint/
// business-plans.mjs), the engine's funding opportunity (src/blueprint/
// funding-opportunity.mjs) and the engine's own reading of the first and the
// newest saved credit pull (src/waypoints/blueprint-path-read.mjs). That is
// what lets the demo build embed this file exactly as the server runs it.
//
// THE RULES THIS FILE KEEPS
//   * Money is integer cents. Unknown is null, never 0.
//   * Personal and business cash are never added together. The cash plan uses
//     connected PERSONAL cash when the client has it, otherwise the cash they
//     reported on the plan.
//   * Every number names where it came from. A bank, a deposit amount or a step
//     the inputs do not hold is never made up: a deposit with no staff target
//     and no bank book minimum reads "Deposit amount: not set".
//   * No dates are guessed. Seasoning counts only from a recorded opening day.
//   * The funding amounts are the engine's own (preapprovals, then
//     projectedPreapproval). No credit score number appears here.
//   * NO POINTS (owner correction, Chris 2026-11-07: "That's not a real form
//     of gamification"). Each step shows what UnderwriteIQ actually measures:
//     a card's use before and after, a fundability check on or off, the
//     engine's own funding change with the modifier that moved, the business
//     funding the first LLC unlocks by the engine's business rule, or "Bank
//     requirement" for the steps UnderwriteIQ cannot see (it reads no bank
//     data). Milestones measured on the pulls: all cards together under 10%,
//     and score over 700. Nothing is shown that the saved pulls do not show.

/** The stored waypoint (db/migrations/574) and the plan's own progress key for it. */
export const CHEXSYSTEMS_WAYPOINT_KEY = "check_chexsystems";
export const CHEXSYSTEMS_PROGRESS_KEY = "chexsystems";
/** What the upload is filed as (src/pulse/beats/lib/document-kinds.mjs). */
export const CHEXSYSTEMS_UPLOAD_SUBTYPE = "chexsystems_report";
export const CHEXSYSTEMS_URL = "https://www.chexsystems.com";

/* The words on the ChexSystems step and its helper answers. Owner-set
   2026-11-06, spec item 8. The answers say three things and no more: it is not
   a credit report, asking for your own report has no credit score impact, and
   errors are disputed before you apply. */
export const CHEXSYSTEMS_GUIDE = Object.freeze({
  title: "Check your ChexSystems report",
  why: "Banks read it before they open an account. Check it first so nothing surprises you.",
  steps: Object.freeze([
    "Go to chexsystems.com and ask for your free consumer disclosure report.",
    "Prove it is you when they ask.",
    "Look for any account closed with money owed.",
    "Upload it here. Your AI helper and the Fundhub team review it with you."
  ]),
  link: Object.freeze({ label: "chexsystems.com", url: CHEXSYSTEMS_URL }),
  /* Owner order 2026-11-07: a short "be careful" note, then how to open the
     account. Every line is already in the repo: the checklist's own words for a
     business checking account (362, BUSINESS_CHECKING_HOW in
     src/finance/bank-strategy.mjs), the bank-readiness question (identity and
     business documents, src/blueprint/business-plans.mjs), and the bank book's
     deposit and seasoning steps (relationshipSteps). */
  caution: "Be careful: fix or dispute anything wrong before you open an account.",
  opening: Object.freeze([
    "Bring your photo ID, your LLC filing papers and your EIN letter.",
    "Open it in the LLC name, using the EIN.",
    "Deposit the amount on your plan once the account is open.",
    "Leave the money there for the days the bank book names before you apply."
  ]),
  answers: Object.freeze([
    Object.freeze({ q: "Is it a credit report?",
      a: "No. ChexSystems is a report about bank accounts. It is not a credit report. Banks read it before they open an account." }),
    Object.freeze({ q: "Does checking it hurt my credit score?",
      a: "No. Asking for your own ChexSystems report has no credit score impact." }),
    Object.freeze({ q: "What if something on it is wrong?",
      a: "Dispute the error with ChexSystems before you apply at a bank. Ask the Fundhub team if you want a second look." })
  ]),
  source: Object.freeze({ label: "Owner-set 2026-11-06 (spec item 8)", ref: "ops/workflows/finance-os-cfo-build-2026-11-06.txt" })
});

/* The header over the steps. Owner words, Chris 2026-11-07. */
export const PATH_HEADER = "Every number comes from UnderwriteIQ: funding in dollars and its six fundability checks. Business and bank steps unlock business funding and bank approvals. They do not change your personal credit.";

/* The six personal fundability checks, in the order src/finance/fundability.mjs
   PERSONAL_CHECKS shows them (pinned equal by blueprint-path.test.mjs). */
export const FUNDABILITY_CHECK_KEYS = Object.freeze(["score_700", "utilization_30", "no_negatives", "anchor_card", "no_inquiries", "file_depth"]);

/* WHICH FINDINGS ARE PERSONAL CREDIT PROBLEMS THE ENGINE MEASURES. The engine's
   own categories (optimization-findings.js): card and overall utilization,
   inquiries, and negative items (derogatory marks and public records). Business,
   personal-data, file-depth and strategy findings earn nothing here — the
   file-depth and anchor-card ideas are already the fundability checks. Advice
   (severity "info") is never an improvement. */
export const MEASURED_CATEGORIES = Object.freeze(["utilization", "inquiries", "derogatory", "public_records"]);
const ADVICE_SEVERITY = "info";

/* The problem in plain words. Anything not listed uses the engine's own target. */
const FINDING_WORDS = Object.freeze({
  UTIL_MODERATE: "Card use between 10% and 30%",
  UTIL_OVERALL_HIGH: "Card use over 30%",
  INQUIRY_REMOVAL: "Inquiry removal",
  INQUIRY_DUPLICATE: "Duplicate inquiries"
});

const OVERALL_UTIL_CODES = Object.freeze(["UTIL_MODERATE", "UTIL_OVERALL_HIGH"]);
/* Steps UnderwriteIQ cannot see. Owner words, Chris 2026-11-07. */
export const BANK_REQUIREMENT = "Bank requirement";
export const BANK_REQUIREMENT_WORDS = "Bank requirement. UnderwriteIQ does not read bank data, so your credit and funding numbers do not move.";
const BANK_STEP_KEYS = new Set(["get_ein", "business_checking", CHEXSYSTEMS_WAYPOINT_KEY]);

/* THE CARD TARGET. 10% of each card's limit — the Credit Optimization Roadmap's
   paydown target, PAYDOWN_TARGET_FRACTION in src/waypoints/definitions.mjs
   (pinned equal by blueprint-path.test.mjs). Copied, not imported, so this file
   stays import-free. */
export const CARD_TARGET_PCT = 10;

/* Steps that must be finished before a bank step is the next thing to do. A
   personal checking account needs only the ChexSystems check. */
const BUSINESS_GATES = Object.freeze(["form_llc", "get_ein", CHEXSYSTEMS_WAYPOINT_KEY]);
const PERSONAL_GATES = Object.freeze([CHEXSYSTEMS_WAYPOINT_KEY]);
/* The generic checklist step the bank steps stand in for when there are any. */
const GENERIC_BANK_KEY = "business_checking";

const DONE_STATES = new Set(["done", "completed", "verified"]);
const HIDDEN_STATES = new Set(["skipped", "not_applicable"]);
const ACTIONABLE = new Set(["open", "in_progress", "in_review"]);

const isCents = (v) => Number.isSafeInteger(v) && v >= 0;
const rows = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);

/** "$5,000" from cents (whole dollars when even). Null stays null. */
export function money(cents) {
  if (!Number.isSafeInteger(cents)) return null;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = abs % 100 ? "." + String(abs % 100).padStart(2, "0") : "";
  return `${cents < 0 ? "-" : ""}$${dollars}${rest}`;
}

/** The same rule as slugify() in src/waypoints/definitions.mjs (pinned by test),
 *  so a card's finding and its paydown_<creditor> waypoint name the same card. */
export function cardSlug(textValue) {
  return String(textValue || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32)
    .replace(/_$/, "");
}

function bankSlug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "bank";
}

function article(word) {
  return /^[aeiou]/i.test(String(word || "")) ? "an" : "a";
}

function day(iso) {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;
}

function humanCode(code) {
  const s = String(code || "").toLowerCase().replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Finding";
}

/* ------------------------------------------------------------------ *
 * What UnderwriteIQ measured — the first saved pull against the newest
 * ------------------------------------------------------------------ */

/**
 * measuredFindings(findings) → the personal credit problems the engine flags, one per
 * problem: a card over 10% is one problem however many bureaus report it.
 * Each: { id, code, category, card, label }.
 */
export function measuredFindings(findings = []) {
  const out = new Map();
  for (const f of rows(findings)) {
    if (!f || typeof f.code !== "string") continue;
    if (!MEASURED_CATEGORIES.includes(f.category) || f.severity === ADVICE_SEVERITY) continue;
    const card = f.code === "UTIL_CARD_OVER_10" ? text(f.accountData?.creditorName) : null;
    if (f.code === "UTIL_CARD_OVER_10" && !card) continue; // a card we cannot name is not counted
    const id = card ? `${f.code}:${cardSlug(card)}` : f.code;
    if (out.has(id)) continue;
    out.set(id, {
      id, code: f.code, category: f.category, card,
      label: card ? `${card} over 10%` : (FINDING_WORDS[f.code] || text(f.targetState) || humanCode(f.code))
    });
  }
  return [...out.values()];
}

/**
 * measureCredit({ baseline, newest }) → every personal credit improvement the
 * engine can show between two saved pulls, and every one still open.
 *   baseline / newest: { reportId, asOf, findings, checks:[{key,label,passed,value}],
 *                        fundable, personalCents, blocks, modifiers, cards }
 * A finding is `cleared` when the first pull flags it and the newest does not,
 * `open` when the newest flags it. A check is `turned_on` when it failed on
 * the first pull and passes on the newest, `off` while it fails, `on` when it
 * already passed, `unknown` when the engine could not read it. With one pull,
 * the first pull IS the newest, so nothing is cleared yet.
 */
export function measureCredit({ baseline = null, newest = null } = {}) {
  if (!newest) return null;
  const first = baseline || newest;
  const now = new Map(measuredFindings(newest.findings).map((f) => [f.id, f]));
  const before = new Map(measuredFindings(first.findings).map((f) => [f.id, f]));
  const findings = [];
  for (const [id, f] of before) if (!now.has(id)) findings.push({ ...f, kind: "finding", state: "cleared" });
  for (const f of now.values()) findings.push({ ...f, kind: "finding", state: "open" });
  const checks = [];
  const nowChecks = rows(newest.checks);
  const beforeChecks = new Map(rows(first.checks).map((c) => [c.key, c]));
  for (const key of FUNDABILITY_CHECK_KEYS) {
    const c = nowChecks.find((x) => x?.key === key);
    if (!c) continue;
    const b = beforeChecks.get(key);
    const state = c.passed === true ? (b?.passed === false ? "turned_on" : "on")
      : c.passed === false ? "off" : "unknown";
    checks.push({ id: `check:${key}`, key, kind: "check", label: text(c.label) || humanCode(key), state,
      value: Number.isFinite(c.value) ? c.value : null });
  }
  /* Card use per card on each pull, read the way the paydown step closes
     itself (src/waypoints/definitions.mjs mergeByCreditor). */
  const cardsBefore = new Map(rows(first.cards).map((c) => [c.key, c]));
  const cards = rows(newest.cards).map((c) => ({ key: c.key, name: c.name, nowPct: c.utilPct ?? null,
    beforePct: cardsBefore.get(c.key)?.utilPct ?? null }));
  return {
    firstReportId: first.reportId ?? null,
    firstAsOf: first.asOf ?? null,
    newestReportId: newest.reportId ?? null,
    newestAsOf: newest.asOf ?? null,
    samePull: !baseline || first.reportId === newest.reportId,
    findings,
    checks,
    cards
  };
}

/**
 * fundabilityLine(now) → "Fundability 5 of 6 · Fundable", from the engine's own
 * fundability read of the client's file (src/finance/fundability.mjs, `now`:
 * score, score_max, unknown, tier — the same numbers the FinanceOS
 * fundability page shows; tier is the engine's `fundable` gate). Null when the
 * engine had nothing scored to read.
 */
export function fundabilityLine(now = null) {
  if (!now || !Number.isSafeInteger(now.score)) return null;
  const max = Number.isSafeInteger(now.score_max) ? now.score_max : FUNDABILITY_CHECK_KEYS.length;
  const fundable = now.tier === "fundable";
  return {
    score: now.score, max, unknown: Number.isSafeInteger(now.unknown) ? now.unknown : null,
    tier: fundable ? "fundable" : "not_fundable_yet",
    text: `Fundability ${now.score} of ${max} · ${fundable ? "Fundable" : "Not fundable yet"}`,
    source: { label: "UnderwriteIQ fundability on your file", ref: "src/finance/fundability.mjs (now.score, now.tier = uw.fundable)" }
  };
}

const pct = (n) => `${Math.round(n)}%`;

/** "Card use 30% → 5%" (two pulls), "Card use 30% · target 10%" (still above). */
function cardUseLabel(card, samePull) {
  if (!card || card.nowPct == null) return null;
  if (!samePull && card.beforePct != null && card.beforePct !== card.nowPct) return `Card use ${pct(card.beforePct)} → ${pct(card.nowPct)}`;
  return card.nowPct > CARD_TARGET_PCT ? `Card use ${pct(card.nowPct)} · target ${CARD_TARGET_PCT}%` : `Card use ${pct(card.nowPct)}`;
}

/**
 * stepImpact(step, ctx) → { label, kind, iq } — what UnderwriteIQ measures for
 * one step. ctx: { measured, businessUnlock, firstBusinessKey }.
 */
export function stepImpact(step, { measured = null, businessUnlock = null } = {}) {
  if (step.kind === "bank" || step.kind === "chexsystems" || BANK_STEP_KEYS.has(step.key)) {
    return { label: BANK_REQUIREMENT, kind: "bank",
      iq: step.key === "get_ein" ? "Banks ask for it. UnderwriteIQ does not score it." : BANK_REQUIREMENT_WORDS };
  }
  if (step.key === "form_llc") {
    if (businessUnlock && isCents(businessUnlock.cents) && businessUnlock.cents > 0) {
      return { label: `UnderwriteIQ estimate: ${money(businessUnlock.cents)} business funding`, kind: "business_funding",
        iq: `UnderwriteIQ estimate, the same as your Fundability business slice: your card funding${isCents(businessUnlock.cardFundingCents) ? ` (${money(businessUnlock.cardFundingCents)})` : ""} × ${businessUnlock.multiplier} ${businessUnlock.ageWords}. Each business is judged on its own and never added together. It does not change your personal credit.` };
    }
    return { label: "Unlocks business funding", kind: "business_funding",
      iq: "UnderwriteIQ needs a credit report on file to size business funding. It does not change your personal credit." };
  }
  if (step.state === "ongoing") {
    const first = rows(measured?.newestFindings).find((f) => f.code === "FUNDING_FIRST");
    return { label: "Protects your funding", kind: "ongoing",
      iq: first ? `UnderwriteIQ's top item: ${text(first.targetState) || "Secure funding before new accounts"}.` : "Keeps your file steady while we work." };
  }
  if (!measured) return { label: "Needs a credit report", kind: "none", iq: "UnderwriteIQ needs a credit report on file first." };
  if (step.verifyKind === "paydown" && /^paydown_/.test(step.key)) {
    const slug = step.key.replace(/^paydown_/, "").replace(/_\d+$/, "");
    const card = measured.cards.find((c) => c.key === slug);
    const label = cardUseLabel(card, measured.samePull);
    return label
      ? { label, kind: "card_use", iq: `UnderwriteIQ reads this card's balance and limit on each credit pull. The target is ${CARD_TARGET_PCT}% of the limit.` }
      : { label: "Card use measured on your next pull", kind: "card_use", iq: "Your newest credit pull does not show this card's balance and limit." };
  }
  if (/inquir/.test(step.key)) {
    const check = measured.checks.find((c) => c.key === "no_inquiries");
    const on = check && (check.state === "on" || check.state === "turned_on");
    return { label: on ? "Fundability check on" : "Fundability check off", kind: "check", iq: "UnderwriteIQ check: no hard inquiries." };
  }
  if (/^blueprint_dispute_/.test(step.key)) {
    return { label: "Measured on your credit pulls", kind: "none", iq: "UnderwriteIQ reads any change on your next credit pull." };
  }
  return { label: "No UnderwriteIQ change", kind: "none", iq: "UnderwriteIQ does not measure this step." };
}

/**
 * pathMilestones(ctx) → what UnderwriteIQ measured on the pulls rather than in
 * one step: all cards together under 10% (with the engine's own funding change
 * and the modifier that moved), score over 700 (the fundable gate), then any
 * other measured problem or fundability check that moved or is still open.
 */
export function pathMilestones({ measured = null, funding = null, opportunity = null, fundabilityNow = null, claimedCards = new Set(), inquiryStep = false } = {}) {
  if (!measured) return [];
  const out = [];
  const overall = measured.findings.filter((f) => OVERALL_UTIL_CODES.includes(f.code));
  if (overall.length) {
    const done = overall.every((f) => f.state === "cleared");
    const moved = (funding?.change?.moved || []).find((m) => m.modifier === "utilization");
    const delta = funding?.change?.deltaCents;
    const lift = rows(opportunity?.steps).find((x) => x?.key === "utilization")?.liftCents;
    const blocks = funding?.change?.blocks;
    out.push({ id: "overall_utilization", title: "All cards together under 10%", state: done ? "done" : "open",
      impact: done ? (moved && Number.isSafeInteger(delta) ? `${delta >= 0 ? "+" : "-"}${money(Math.abs(delta))} funding` : "Done")
        : (isCents(lift) && lift > 0 ? `Worth +${money(lift)}` : "Measured on your next pull"),
      iq: done && moved
        ? `UnderwriteIQ removes its card-use penalty (×${modifierNumber(moved.from)} → ×${modifierNumber(moved.to)})${blocks ? `: personal card ${money(blocks.cardBefore)} → ${money(blocks.cardAfter)} and personal loan ${money(blocks.loanBefore)} → ${money(blocks.loanAfter)}` : ""}.`
        : "UnderwriteIQ measures all your cards together on each credit pull." });
  }
  const score = measured.checks.find((c) => c.key === "score_700");
  if (score && (score.state === "turned_on" || score.state === "off")) {
    const done = score.state === "turned_on";
    out.push({ id: "score_700", title: "Score over 700", state: done ? "done" : "open",
      impact: done ? (fundabilityNow?.tier === "fundable" ? "Fundable" : "Score check on") : "Needed to be fundable",
      iq: `UnderwriteIQ's gate: score 700+, card use 30% or less and no negative items.${Number.isFinite(score.value) ? ` Newest pull: ${score.value}.` : ""}` });
  }
  for (const f of measured.findings) {
    if (OVERALL_UTIL_CODES.includes(f.code)) continue;
    if (f.code === "UTIL_CARD_OVER_10" && claimedCards.has(cardSlug(f.card))) continue;
    if (inquiryStep && ["INQUIRY_REMOVAL", "INQUIRY_DUPLICATE"].includes(f.code)) continue;
    const card = f.code === "UTIL_CARD_OVER_10" ? measured.cards.find((c) => c.key === cardSlug(f.card)) : null;
    out.push({ id: f.id, title: f.label, state: f.state === "cleared" ? "done" : "open",
      impact: cardUseLabel(card, measured.samePull) || (f.state === "cleared" ? "Cleared on your pull" : "Measured on your next pull"),
      iq: f.state === "cleared" ? "UnderwriteIQ no longer flags this on your newest credit pull." : "UnderwriteIQ still flags this on your newest credit pull." });
  }
  for (const c of measured.checks) {
    if (c.key === "score_700" || (inquiryStep && c.key === "no_inquiries")) continue;
    if (!["turned_on", "off"].includes(c.state)) continue;
    out.push({ id: c.id, title: c.label, state: c.state === "turned_on" ? "done" : "open",
      impact: c.state === "turned_on" ? "Fundability check on" : "Fundability check off",
      iq: "One of UnderwriteIQ's six fundability checks." });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Checklist steps
 * ------------------------------------------------------------------ */

function waypointState(w) {
  if (w.completedAt || DONE_STATES.has(w.state)) return "done";
  if (w.closedBy === "ongoing" || w.verifyKind === "no_new_credit") return "ongoing";
  if (w.state === "blocked") return "blocked";
  if (w.state === "awaiting_review") return "in_review";
  if (w.state === "in_progress") return "in_progress";
  return "open";
}

function waypointStep(w) {
  return {
    key: text(w.key) || `waypoint_${w.id}`,
    kind: "waypoint",
    title: text(w.title) || "Checklist step",
    why: text(w.detail),
    state: waypointState(w),
    owner: w.owner === "fundhub" ? "fundhub" : "client",
    waypointId: w.id ?? null,
    closedBy: w.closedBy ?? null,
    verifyKind: w.verifyKind ?? null,
    dueAt: w.dueAt ?? null,
    bank: null,
    waitingOn: []
  };
}

/**
 * The ChexSystems step. The stored waypoint (574) when the checklist has it;
 * otherwise the plan's own client-reported 'chexsystems' progress, so a buyer
 * seeded before 574 still sees the step in the same place.
 * Uploads are metadata only: the file id, its name, when it came in, and the
 * vault review status. Nothing from inside the report is read or kept here.
 */
export function chexsystemsStep({ waypoint = null, stepProgress = [], uploads = [] } = {}) {
  const files = rows(uploads)
    .filter((u) => u && u.documentId)
    .map((u) => ({
      documentId: String(u.documentId),
      filename: text(u.filename),
      receivedAt: u.receivedAt ?? null,
      review: ["accepted", "rejected"].includes(u.review) ? u.review : "pending"
    }));
  let state;
  if (waypoint) state = waypointState(waypoint);
  else {
    const saved = rows(stepProgress).find((p) => p?.stepKey === CHEXSYSTEMS_PROGRESS_KEY && !p.businessPlanId);
    state = saved?.status === "reported_complete" ? "done"
      : saved?.status === "blocked" ? "blocked"
        : saved?.status === "in_progress" ? "in_progress" : "open";
  }
  const newest = files[0] || null;
  let statusText = null;
  if (state !== "done" && newest) {
    if (newest.review === "rejected") { state = "blocked"; statusText = "Your report needs another look. Ask the Fundhub team what to fix."; }
    else { state = "in_review"; statusText = newest.review === "accepted" ? "Reviewed by the Fundhub team. Mark this step done." : "Uploaded. The Fundhub team reviews it with you."; }
  }
  return {
    key: CHEXSYSTEMS_WAYPOINT_KEY,
    kind: "chexsystems",
    title: text(waypoint?.title) || CHEXSYSTEMS_GUIDE.title,
    why: CHEXSYSTEMS_GUIDE.why,
    state,
    statusText,
    owner: "client",
    waypointId: waypoint?.id ?? null,
    /* How the client closes it: the checklist tick when the stored step exists,
       else the plan's own progress key (business-plans save_step). */
    closeWith: waypoint ? "waypoint_tick" : "plan_step",
    closedBy: waypoint?.closedBy ?? "client",
    verifyKind: null,
    dueAt: waypoint?.dueAt ?? null,
    uploads: files,
    bank: null,
    waitingOn: []
  };
}

/* ------------------------------------------------------------------ *
 * Bank steps — the bank book's recommendations and the staff tracker
 * ------------------------------------------------------------------ */

const PERSONAL_TABLE = /^Personal/;
/* The same name rule as institutionKind() in src/finance/bank-strategy.mjs. */
const CREDIT_UNION_NAME = /\bcredit\s+union\b|\bF?CU\b|\bfederal\s+credit\b/i;

function bookQuote(rec) {
  /* The bank book's own stated_requirements sentence first, then any book
     sentence about seasoning or deposits the recommendation carried. */
  const why = rows(rec?.why);
  const stated = why.find((w) => /^lenders\.stated_requirements/.test(String(w?.source?.ref || "")));
  if (stated && text(stated.text)) return { text: text(stated.text), source: stated.source };
  const season = rows(rec?.relationship_steps).find((s) => s?.step === "season" && text(s.quote));
  if (season) return { text: text(season.quote), source: season.source || null };
  const any = why.find((w) => /^lenders\.(insider_tips|stated_requirements)/.test(String(w?.source?.ref || "")) && text(w.text));
  return any ? { text: text(any.text), source: any.source } : null;
}

function sameBank(rec, rel) {
  if (rec?.lender_id && rel?.lender_id && String(rec.lender_id) === String(rel.lender_id)) return true;
  const a = String(rec?.name || "").trim().toLowerCase();
  return !!a && (a === String(rel?.bank_key || "").trim().toLowerCase() || a === String(rel?.bank || "").trim().toLowerCase());
}

function trackerOf(rel, targetCents, seasoningDays) {
  if (!rel) {
    return { stage: "not_planned", planned: false, opened: false, deposited: false, seasoned: seasoningDays == null ? null : false,
      openedOn: null, depositedCents: null, daysOpen: null, seasonedOn: null, text: "Not on your bank plan yet" };
  }
  const opened = !!rel.opened_on || ["open", "seasoning", "seasoned"].includes(rel.status);
  const depositedCents = isCents(rel.deposits_total_cents) ? rel.deposits_total_cents : null;
  const deposited = depositedCents != null && (targetCents != null ? depositedCents >= targetCents : depositedCents > 0);
  const seasoned = seasoningDays == null ? null : rel.status === "seasoned";
  let stage = "planned";
  let words = "Planned";
  if (opened) { stage = "opened"; words = "Open · deposit not recorded"; }
  if (opened && depositedCents != null && !deposited && targetCents != null) {
    words = `Open · ${money(depositedCents)} of ${money(targetCents)} deposited`;
  }
  if (deposited) {
    stage = "deposited";
    words = seasoningDays == null ? "Deposited"
      : (rel.status === "seasoned" ? `Deposited · seasoned ${seasoningDays}+ days`
        : `Deposited · ${Number.isInteger(rel.days_open) ? rel.days_open : 0} of ${seasoningDays} days seasoned`);
    if (seasoned) stage = "seasoned";
  }
  return { stage, planned: true, opened, deposited, seasoned, openedOn: rel.opened_on ?? null, depositedCents,
    daysOpen: Number.isInteger(rel.days_open) ? rel.days_open : null, seasonedOn: rel.seasoned_on ?? null, text: words };
}

/**
 * bankSteps({ recommended, relationships, maxBanks }) → one step per bank, in
 * plan order: the bank match's own order (recommended_banks), then any bank
 * staff put on the tracker that the match did not list. A bank staff skipped is
 * left out. At most `maxBanks` (5, the same cap the cash plan has used).
 *
 * The deposit is the staff-set target on the tracker row (planned_deposit_cents),
 * else the bank book's minimum, else "not set". Stages come from the tracker:
 * planned, opened, deposited, seasoned (when the book names a seasoning period).
 * Each bank carries the logo bank-strategy.mjs pickBankLogo() chose, or null.
 */
export function bankSteps({ recommended = [], relationships = [], maxBanks = 5 } = {}) {
  const rels = rows(relationships).filter((r) => r && r.status !== "skipped");
  const skipped = rows(relationships).filter((r) => r && r.status === "skipped");
  const used = new Set();
  const out = [];
  const keys = new Set();
  const push = (rec, rel) => {
    if (out.length >= maxBanks) return;
    const name = text(rel?.bank) || text(rec?.name);
    if (!name) return;
    const personal = rel ? rel.account_kind === "personal" : PERSONAL_TABLE.test(String(rec?.lender_table || ""));
    const account = personal ? "checking account" : "business checking account";
    let targetCents = null;
    let targetSource = null;
    if (rel && isCents(rel.deposit_plan_cents)) { targetCents = rel.deposit_plan_cents; targetSource = rel.deposit_plan_source || null; }
    else if (!rel && isCents(rec?.minimum_deposit_cents) && rec.minimum_deposit_cents > 0) {
      targetCents = rec.minimum_deposit_cents;
      targetSource = rows(rec.relationship_steps).find((s) => s?.step === "deposit")?.source || rec.source || null;
    }
    const seasoningDays = Number.isInteger(rel?.seasoning?.days) ? rel.seasoning.days
      : (Number.isInteger(rec?.seasoning_days) ? rec.seasoning_days : null);
    const tracker = trackerOf(rel, targetCents, seasoningDays);
    const done = tracker.opened && tracker.deposited && (seasoningDays == null || tracker.seasoned === true);
    let key = `bank_open_${bankSlug(name)}`;
    for (let n = 2; keys.has(key); n += 1) key = `bank_open_${bankSlug(name)}_${n}`;
    keys.add(key);
    const needCents = targetCents == null ? null : Math.max(0, targetCents - (tracker.depositedCents ?? 0));
    out.push({
      key,
      kind: "bank",
      title: targetCents != null
        ? `Open ${article(name)} ${name} ${account} and deposit ${money(targetCents)}`
        : `Open ${article(name)} ${name} ${account}`,
      why: null,
      state: done ? "done" : (tracker.opened ? "in_progress" : "open"),
      owner: "client",
      waypointId: null,
      closedBy: "fundhub",
      verifyKind: null,
      dueAt: null,
      waitingOn: [],
      bank: {
        name,
        kind: rec?.kind === "credit_union" || CREDIT_UNION_NAME.test(name) ? "credit_union" : "bank",
        accountKind: personal ? "personal" : "business",
        /* The day staff set to open it (planned_open_on), or null: "not set". */
        openBy: rel?.planned_open_on ?? null,
        lenderId: rel?.lender_id || rec?.lender_id || null,
        relationshipId: rel?.id ?? null,
        /* The client already banks here, or already holds this product (unit TL,
           src/finance/tradeline-inventory.mjs tags on the bank plan). */
        existingRelationship: !!rec?.existing_relationship,
        hasAccount: rec?.has_account === true,
        containerName: rel?.container_name ?? null,
        logo: rel?.logo || rec?.logo || null,
        targetCents,
        targetSource,
        depositText: targetCents != null ? `Deposit ${money(targetCents)}` : "Deposit amount: not set",
        needCents,
        seasoningDays,
        quote: rec ? bookQuote(rec) : (rel?.seasoning?.quote ? { text: rel.seasoning.quote, source: rel.seasoning.source || null } : null),
        tracker
      }
    });
  };
  for (const rec of rows(recommended)) {
    if (!rec || !text(rec.name)) continue;
    if (skipped.some((s) => sameBank(rec, s))) continue;
    const rel = rels.find((r) => !used.has(r) && sameBank(rec, r)) || null;
    if (rel) used.add(rel);
    push(rec, rel);
  }
  for (const rel of rels) if (!used.has(rel)) { used.add(rel); push(null, rel); }
  return out;
}

/**
 * depositPlanRows(bankSteps) → the `deposit_plan` array on GET /api/money/banks
 * (owner order 2026-11-07; unit A draws it on the trends chart). One row per
 * bank, in plan order:
 *   { lender_id, relationship_id, name, logo (URL string or null), logo_alt, kind, open_by, deposit_cents,
 *     deposit_source, season_days, reason, reason_source, status, deposited_cents }
 * open_by is the day staff set; deposit_cents is the staff target, else the bank
 * book's minimum; both null read "not set". status is planned | opened |
 * deposited | seasoned, from the relationships tracker. No cash is read here.
 */
export function depositPlanRows(steps = []) {
  return rows(steps).filter((s) => s && s.bank).map((s) => {
    const b = s.bank;
    const t = b.tracker || {};
    const status = t.seasoned === true ? "seasoned" : (t.deposited ? "deposited" : (t.opened ? "opened" : "planned"));
    return {
      lender_id: b.lenderId ?? null,
      relationship_id: b.relationshipId ?? null,
      name: b.name,
      logo: b.logo?.src || null,
      logo_alt: b.logo?.src ? (b.logo.alt || `${b.name} logo`) : null,
      kind: b.kind,
      open_by: b.openBy ?? null,
      deposit_cents: b.targetCents ?? null,
      deposit_source: b.targetSource || null,
      season_days: b.seasoningDays ?? null,
      reason: b.quote?.text ?? null,
      reason_source: b.quote?.source ?? null,
      status,
      deposited_cents: t.depositedCents ?? null
    };
  });
}

/* ------------------------------------------------------------------ *
 * The cash deposit plan
 * ------------------------------------------------------------------ */

/* Owner words, Chris 2026-11-07, as a relationship benefit (design review
   2026-11-07: the bank book has no deposit-to-approval formula). */
export const APPROVALS_NOTE = "The more you put in and leave in, the stronger your bank relationship.";

/**
 * allocateDeposits(putCents, banks) → each bank's share of `putCents`, in plan
 * order (owner rule, Chris 2026-11-07: "One step at a time"). Each bank gets up
 * to what it still needs to reach its deposit target (staff-set, else the bank
 * book's minimum). A part is fine: "Start with $1,000. Add $4,000 to reach the
 * bank book amount." A bank whose target is not set gets nothing and says so.
 * The first bank still short is the next one: "Your next $4,000 goes to Chase."
 * The same steps run in the browser for the what-if amount
 * (public/app/blueprint-journey.js allocate()), which is never saved.
 */
export function allocateDeposits(putCents, banks = []) {
  let left = isCents(putCents) ? putCents : 0;
  const rowsOut = [];
  let next = null;
  for (const b of rows(banks).filter((x) => x && x.bank)) {
    const bank = b.bank;
    const base = { key: b.key, bank: bank.name, logo: bank.logo || null, targetCents: bank.targetCents,
      needCents: bank.needCents, depositedCents: bank.tracker?.depositedCents ?? null, openBy: bank.openBy ?? null,
      seasoningDays: bank.seasoningDays ?? null, quote: bank.quote, fromBook: /^Bank book/.test(String(bank.targetSource?.label || "")),
      giveCents: 0 };
    if (b.state === "done" || (bank.targetCents != null && bank.needCents === 0)) {
      rowsOut.push({ ...base, status: "deposited", words: bank.seasoningDays ? `Deposited. Leave it in for ${bank.seasoningDays}+ days.` : "Deposited." });
      continue;
    }
    if (bank.targetCents == null) {
      rowsOut.push({ ...base, status: "not_set", words: "Deposit not set yet." });
      continue;
    }
    const need = bank.needCents;
    const give = Math.min(left, need);
    left -= give;
    const target = base.fromBook ? "the bank book amount" : "the amount on your plan";
    const row = give >= need
      ? { ...base, giveCents: give, status: "covered", words: bank.seasoningDays ? `Fully covered. Leave it in for ${bank.seasoningDays}+ days.` : "Fully covered." }
      : give > 0
        ? { ...base, giveCents: give, status: "partial", words: `Start with ${money(give)}. Add ${money(need - give)} to reach ${target}.` }
        : { ...base, status: "waiting", words: "Waits for more cash." };
    if (!next && row.status !== "covered") next = { key: b.key, bank: bank.name, amountCents: need - give, needCents: need, giveCents: give };
    rowsOut.push(row);
  }
  return { rows: rowsOut, next, leftCents: left };
}

/**
 * depositCashPlan({ reportedCashCents, connectedPersonal, bufferCents, banks })
 * → the "You have $X in cash" card.
 *
 * Cash: connected PERSONAL cash when the client has connected accounts, else the
 * cash they reported on the plan. Business cash is never added in. The cushion
 * (cashBufferCents) is kept; everything above it goes to the banks in plan
 * order (owner rule 2026-11-07: available cash is personal cash minus the
 * cushion). Unknown cash or an unknown cushion plans nothing.
 */
export function depositCashPlan({ reportedCashCents = null, connectedPersonal = null, bufferCents = null, banks = [] } = {}) {
  const connected = connectedPersonal && isCents(connectedPersonal.cents) && Number(connectedPersonal.accounts) > 0;
  const haveCents = connected ? connectedPersonal.cents : (isCents(reportedCashCents) ? reportedCashCents : null);
  const list = rows(banks).filter((b) => b && b.bank);
  const buffer = isCents(bufferCents) ? bufferCents : null;
  const base = {
    haveCents,
    haveSource: connected ? "connected_personal" : (haveCents != null ? "reported_on_plan" : null),
    haveIsFloor: connected ? connectedPersonal.isFloor === true : false,
    bufferCents: buffer,
    freeCents: null,
    note: APPROVALS_NOTE,
    rows: [],
    next: null,
    shortText: null
  };
  if (!list.length) return { ...base, status: "no_banks", message: "Your plan has no bank deposits yet." };
  const unplanned = allocateDeposits(0, list).rows.map((r) => (r.status === "waiting" ? { ...r, words: "Waits for your cash." } : r));
  if (haveCents == null) {
    return { ...base, status: "needs_cash", rows: unplanned, message: "Add the cash you have, or connect your bank, to plan your deposits." };
  }
  if (buffer == null) {
    return { ...base, status: "needs_buffer", rows: unplanned, message: "Set how much cash you keep for bills first. Then the plan puts the rest to work." };
  }
  const free = Math.max(0, haveCents - buffer);
  const plan = allocateDeposits(free, list);
  let message;
  let status;
  let shortText = null;
  if (plan.next) {
    status = "planned";
    message = `Your next ${money(plan.next.amountCents)} goes to ${plan.next.bank}.`;
    const before = plan.rows.slice(0, plan.rows.findIndex((r) => r.key === plan.next.key)).some((r) => r.status === "covered");
    shortText = `${plan.next.bank} needs ${money(plan.next.needCents)}. You have ${money(plan.next.giveCents)} after your ${money(buffer)} cushion${before ? " and the deposits before it" : ""}.`;
  } else if (plan.rows.every((r) => r.status === "not_set")) {
    status = "not_set";
    message = "The Fundhub team sets each deposit amount with you.";
  } else if (plan.rows.some((r) => r.status === "not_set")) {
    /* Covered only when every amount is known: a bank with no amount is named. */
    status = "partly_set";
    message = `Deposit not set yet for ${plan.rows.filter((r) => r.status === "not_set").map((r) => r.bank).join(", ")}.`;
  } else {
    status = "covered";
    message = "Every bank on your plan is covered.";
  }
  return { ...base, status, freeCents: free, rows: plan.rows, next: plan.next, shortText, message };
}

/* ------------------------------------------------------------------ *
 * Funding and card usage — the engine's own numbers
 * ------------------------------------------------------------------ */

const MODIFIER_WORDS = Object.freeze({ utilization: "card use", outcome: "file outcome", thinFile: "thin file" });
const modifierNumber = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Which of the engine's own preapproval modifiers moved between two pulls.
 *  The personal card modifier is read first, then the personal loan one. */
export function modifiersMoved(before = null, after = null) {
  const out = [];
  const seen = new Set();
  for (const block of ["personalCard", "personalLoan"]) {
    const a = before?.[block] || {};
    const b = after?.[block] || {};
    for (const key of Object.keys({ ...a, ...b })) {
      if (seen.has(key)) continue;
      const from = Number.isFinite(a[key]) ? a[key] : null;
      const to = Number.isFinite(b[key]) ? b[key] : null;
      if (from === null || to === null || from === to) continue;
      seen.add(key);
      out.push({ modifier: key, words: MODIFIER_WORDS[key] || key, from, to });
    }
  }
  return out;
}

export function pathFunding({ opportunity = null, businessPlans = null, baseline = null, newest = null } = {}) {
  const personal = opportunity?.personal || {};
  const todayCents = isCents(personal.currentCents) ? personal.currentCents : null;
  const projectedCents = isCents(personal.projectedCents) ? personal.projectedCents : null;
  const modeled = rows(opportunity?.businesses).filter((b) => isCents(b?.currentCents));
  const first = text(rows(businessPlans?.businesses)[0]?.name) || text(rows(businessPlans?.existingBusinesses)[0]?.name);
  /* The change since the first pull: the engine's own dollars on each pull, and
     the modifier that moved. Only when there are two different pulls. */
  let change = null;
  if (baseline && newest && baseline.reportId !== newest.reportId) {
    const beforeCents = isCents(baseline.personalCents) ? baseline.personalCents : null;
    const afterCents = isCents(newest.personalCents) ? newest.personalCents : null;
    const moved = modifiersMoved(baseline.modifiers, newest.modifiers);
    const delta = beforeCents != null && afterCents != null ? afterCents - beforeCents : null;
    const worth = delta == null ? "" : `, worth ${delta >= 0 ? "+" : "-"}${money(Math.abs(delta))}`;
    const movedWords = moved.map((m) => `${m.words} ×${modifierNumber(m.from)} → ×${modifierNumber(m.to)}`).join(", ");
    const bk = baseline.blocks || {};
    const nk = newest.blocks || {};
    const blocks = [bk.cardCents, nk.cardCents, bk.loanCents, nk.loanCents].every(isCents)
      ? { cardBefore: bk.cardCents, cardAfter: nk.cardCents, loanBefore: bk.loanCents, loanAfter: nk.loanCents } : null;
    change = {
      beforeCents, afterCents, deltaCents: delta, moved, blocks,
      firstAsOf: baseline.asOf ?? null, newestAsOf: newest.asOf ?? null,
      text: moved.length
        ? `UnderwriteIQ ${moved.length === 1 ? "modifier" : "modifiers"} moved: ${movedWords}${worth}.`
        : (delta ? `Funding moved ${delta >= 0 ? "+" : "-"}${money(Math.abs(delta))} between your pulls.` : "No funding change between your pulls yet.")
    };
  }
  return {
    todayCents,
    projectedCents,
    liftCents: todayCents != null && projectedCents != null ? projectedCents - todayCents : null,
    asOf: opportunity?.source?.asOf ?? null,
    change,
    source: { label: "UnderwriteIQ, from your saved credit pulls",
      ref: "the engine's pre-approval today and once fixed · src/blueprint/funding-opportunity.mjs" },
    business: modeled.length
      ? { unlocked: true, text: null, items: modeled.map((b) => ({ name: text(b.name), currentCents: b.currentCents })) }
      : { unlocked: false, text: `Unlocks after ${first || "your first business"} is on file`, items: [] }
  };
}

export function pathCards({ utilization = null, waypoints = [] } = {}) {
  const pct = Number.isFinite(utilization?.pct) ? Math.round(utilization.pct) : null;
  const openPaydowns = rows(waypoints).filter((w) => w?.verifyKind === "paydown" && waypointState(w) !== "done").length;
  return {
    todayPct: pct,
    targetPct: CARD_TARGET_PCT,
    atTarget: pct != null ? pct <= CARD_TARGET_PCT : null,
    openPaydowns,
    source: { label: "UnderwriteIQ card use today; the Credit Optimization Roadmap's 10% target per card",
      ref: "the engine's card-use reading on the newest pull · PAYDOWN_TARGET_FRACTION (src/waypoints/definitions.mjs)" }
  };
}

/* ------------------------------------------------------------------ *
 * The whole path
 * ------------------------------------------------------------------ */

/**
 * buildBlueprintPath(inputs) → the `path` field of GET /api/blueprint/plan.
 *
 *   progress           readClientProgress() payload (waypoints in display order)
 *   bankPlan           bankStrategy() payload, or null when it could not load;
 *                      with `local_banks.recommended` (src/finance/local-banks.mjs)
 *                      the bank steps follow that merged plan
 *   businessPlans      readBusinessPlans() payload
 *   opportunity        buildFundingOpportunity() payload (newest pull)
 *   utilization        the newest genuine report's consumerSignals.utilization
 *   credit             { baseline, newest }: the engine's reading of the first
 *                      and the newest saved pull (see measureCredit), or null
 *   fundabilityNow     src/finance/fundability.mjs `now` for the client's file
 *   connectedPersonal  { cents, isFloor, accounts } personal cash, or null
 *   chexUploads        ChexSystems upload metadata, newest first
 *   businesses         per-business checklist (blueprint-path-read.mjs businessChecklist)
 *   businessUnlock     { cents, cardFundingCents, multiplier, ageWords } for the
 *                      first business, by the engine's business rule, or null
 */
export function buildBlueprintPath({ progress = null, bankPlan = null, businessPlans = null, opportunity = null,
  utilization = null, credit = null, fundabilityNow = null, businessUnlock = null, connectedPersonal = null, chexUploads = [], businesses = null } = {}) {
  const waypoints = rows(progress?.waypoints).filter((w) => w && !HIDDEN_STATES.has(w.state));
  /* The plan banks with the local finds merged in (src/finance/local-banks.mjs,
     `local_banks.recommended`) when the bank read carries them, else the bank match's own list. */
  const banks = bankSteps({ recommended: bankPlan?.local_banks?.recommended || bankPlan?.recommended_banks, relationships: bankPlan?.relationships });
  const storedChex = waypoints.find((w) => w.key === CHEXSYSTEMS_WAYPOINT_KEY) || null;
  const chex = chexsystemsStep({ waypoint: storedChex, stepProgress: businessPlans?.stepProgress, uploads: chexUploads });

  const steps = [];
  for (const w of waypoints) {
    if (w.key === CHEXSYSTEMS_WAYPOINT_KEY) { steps.push(chex); continue; }
    if (w.key === GENERIC_BANK_KEY && banks.length) continue;
    steps.push(waypointStep(w));
  }
  /* The ChexSystems step goes before any bank step. A checklist seeded before
     574 has no stored row, so the plan's own step takes the same place: before
     the generic bank step, else after the EIN or the LLC, else at the end. */
  if (!storedChex) {
    let at = steps.findIndex((s) => s.key === GENERIC_BANK_KEY);
    if (at < 0) {
      const gates = ["get_ein", "form_llc"].map((k) => steps.findIndex((s) => s.key === k)).filter((i) => i >= 0);
      at = gates.length ? Math.max(...gates) + 1 : steps.length;
    }
    steps.splice(at, 0, chex);
  }
  const chexAt = steps.findIndex((s) => s.key === CHEXSYSTEMS_WAYPOINT_KEY);
  steps.splice(chexAt + 1, 0, ...banks);

  /* A bank step waits for the steps before it: the LLC, the EIN and the
     ChexSystems check for a business account, the ChexSystems check alone for
     a personal one. A bank already opened is shown as it is. */
  const byKey = new Map(steps.map((s) => [s.key, s]));
  for (const b of banks) {
    if (b.state !== "open") continue;
    const gates = (b.bank.accountKind === "personal" ? PERSONAL_GATES : BUSINESS_GATES)
      .map((k) => byKey.get(k)).filter((s) => s && s.state !== "done");
    if (gates.length) { b.state = "waiting"; b.waitingOn = gates.map((s) => s.title); }
  }

  /* WHAT UNDERWRITEIQ MEASURES, per step and as milestones on the pulls. */
  const measured = measureCredit(credit || {});
  if (measured) measured.newestFindings = rows(credit?.newest?.findings);
  const funding = pathFunding({ opportunity, businessPlans, baseline: credit?.baseline || null, newest: credit?.newest || null });
  const claimedCards = new Set();
  for (const s of steps) {
    const impact = stepImpact(s, { measured, businessUnlock });
    s.impact = impact.label;
    s.impactKind = impact.kind;
    s.iq = impact.iq;
    if (s.verifyKind === "paydown" && /^paydown_/.test(s.key)) claimedCards.add(s.key.replace(/^paydown_/, "").replace(/_\d+$/, ""));
  }
  const milestones = pathMilestones({ measured, funding, opportunity, fundabilityNow, claimedCards,
    inquiryStep: steps.some((s) => /inquir/.test(s.key)) });
  if (measured) delete measured.newestFindings;

  /* The plan picks the next step: the first one the client can act on now, in
     path order; the team's own step only when nothing is the client's. */
  const actionable = steps.filter((s) => ACTIONABLE.has(s.state));
  const next = actionable.find((s) => s.owner === "client") || actionable[0] || null;
  for (const s of steps) s.isNext = s === next;

  const countable = steps.filter((s) => s.state !== "ongoing");
  const done = countable.filter((s) => s.state === "done");

  return {
    version: 1,
    steps,
    milestones,
    next: next ? { key: next.key, kind: next.kind, title: next.title, why: next.why, waypointId: next.waypointId } : null,
    counts: { done: done.length, total: countable.length, percent: countable.length ? Math.round((done.length / countable.length) * 100) : 0 },
    header: PATH_HEADER,
    measured: measured ? { firstAsOf: measured.firstAsOf, newestAsOf: measured.newestAsOf, samePull: measured.samePull } : null,
    fundability: fundabilityLine(fundabilityNow),
    funding,
    cards: pathCards({ utilization, waypoints }),
    cash: depositCashPlan({
      reportedCashCents: businessPlans?.availableCashCents ?? null,
      connectedPersonal,
      bufferCents: businessPlans?.cashBufferCents ?? null,
      banks
    }),
    chexsystems: { ...CHEXSYSTEMS_GUIDE, step: chex },
    businesses: businesses || null,
    milestone: funding.business.unlocked ? null : funding.business.text
  };
}
