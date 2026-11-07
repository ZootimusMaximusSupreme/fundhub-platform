// The Fundhub Fundability Score — model "fh-score-v0". SERVER ONLY.
//
// Owner, Chris 2026-11-07: "have our own Fundhub fundability score based on
// UnderwriteIQ... we wouldn't tell people how it's really built... as we change
// UnderwriteIQ we can change those scoring models."
//
// PRIVATE. The browser gets { model, score, band, band_label, reasons } and
// nothing else: never the weights, never a part's points, never this math.
// src/finance/fundhub-score.test.mjs fails if a file under public/ names the
// weights object, and if a scored result carries any key past those five.
//
// INPUTS — ONLY UnderwriteIQ's own outputs, read the way src/finance/fundability.mjs
// reads them (that file is not changed by this one):
//   the six checks      personalChecks(): score_700, utilization_30, no_negatives,
//                       anchor_card, no_inquiries, file_depth, each with the value
//                       the engine measured (score, use %, counts, the anchor limit)
//   the tier            tierOf(): the engine's own `fundable` gate
//   funding reach       the full report engine's figure today against its own
//                       "once fixed" figure (opportunity.personal currentCents /
//                       projectedCents, src/blueprint/funding-opportunity.mjs)
//
// UNKNOWN LOWERS NOTHING AND RAISES NOTHING. A part whose input is unknown is
// left out of the points AND out of the most points possible. So an unknown
// always lands between "known fail" and "known pass" — never above the pass,
// never below the fail (the test checks this on every part).
//
// MONOTONE. Each part's credit only goes up as its check gets better, and a
// passed check earns its full weight. Fixing a check never lowers the score.
// Learning that an unknown check passes never lowers it either.
//
// NO PULL, NO SCORE. No bureau with a score on file → score null, reason
// "needs a credit report". Never 0.

/**
 * owner-set 2026-11-07: draft v0, Chris tunes as UnderwriteIQ changes; formula is private
 *
 * Each part: weight (the most points it can add; the weights add up to 100) and,
 * where a near-miss earns part credit, where that credit runs out. The 700 line,
 * the 30% line, the $5,000 anchor and the 3-account depth are the engine's own
 * lines (src/underwrite/vendor/underwriter.cjs). The "zero at" ends are v0
 * draft numbers for Chris to tune. `close_at` splits Building from Close; the
 * Fundable band needs the engine's own fundable tier, whatever the points say.
 */
const FUNDHUB_SCORE_WEIGHTS = Object.freeze({
  model: "fh-score-v0",
  parts: Object.freeze({
    score_700: Object.freeze({ weight: 20, zero_at: 580, full_at: 700 }),
    utilization_30: Object.freeze({ weight: 15, full_at: 30, zero_at: 80 }),
    no_negatives: Object.freeze({ weight: 20, zero_at: 2 }),
    anchor_card: Object.freeze({ weight: 15, full_at_cents: 500000 }),
    no_inquiries: Object.freeze({ weight: 10, zero_at: 6 }),
    file_depth: Object.freeze({ weight: 5, full_at: 3 }),
    funding_reach: Object.freeze({ weight: 15 })
  }),
  close_at: 70,
  reasons_shown: 3
});

/** The model name, the only piece of the model a screen may show. */
export const FUNDHUB_SCORE_MODEL = FUNDHUB_SCORE_WEIGHTS.model;

/** The bands, in order. The words are what a client reads. */
export const FUNDHUB_BANDS = Object.freeze({
  building: "Building",
  close: "Close",
  fundable: "Fundable"
});

/** The order parts are ranked in when two gaps tie. */
const PART_ORDER = Object.freeze(["score_700", "utilization_30", "no_negatives", "anchor_card", "no_inquiries", "file_depth", "funding_reach"]);

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function dollars(c) { return `$${Math.round(c / 100).toLocaleString("en-US")}`; }

/* How much of a part is earned, 0 to 1, or null when the part is unknown. A pass
   is always 1. A fail earns part credit only by distance to the engine's line. */
function credit(key, check, funding) {
  const cfg = FUNDHUB_SCORE_WEIGHTS.parts[key];
  if (key === "funding_reach") {
    const now = funding && funding.today_cents;
    const fixed = funding && funding.when_fixed_cents;
    if (!isNum(now) || !isNum(fixed) || fixed <= 0 || now < 0) return null;
    return clamp01(now / fixed);
  }
  if (!check || (check.passed !== true && check.passed !== false)) return null;
  if (check.passed === true) return 1;
  const v = check.value;
  switch (key) {
    case "score_700":
      return isNum(v) ? clamp01((v - cfg.zero_at) / (cfg.full_at - cfg.zero_at)) : 0;
    case "utilization_30":
      return isNum(v) ? clamp01((cfg.zero_at - v) / (cfg.zero_at - cfg.full_at)) : 0;
    case "no_negatives":
    case "no_inquiries":
      return isNum(v) ? clamp01(1 - v / cfg.zero_at) : 0;
    case "anchor_card":
      // A fail below the $5,000 line is part credit by limit, never a full pass.
      return isNum(v) ? Math.min(clamp01(v / cfg.full_at_cents), 0.99) : 0;
    case "file_depth":
      return isNum(v) ? Math.min(clamp01(v / cfg.full_at), 0.99) : 0;
    default:
      return null;
  }
}

/* The plain sentence for one part that is not full yet. Tied to its check. */
function gapText(key, check) {
  const v = check ? check.value : null;
  switch (key) {
    case "score_700":
      return isNum(v) ? `Raise your credit score to 700. UnderwriteIQ reads ${v} now.` : "Raise your credit score to 700.";
    case "utilization_30":
      return isNum(v) ? `Pay your cards down to 30% use or less. You use ${Math.round(v)}% now.` : "Pay your cards down to 30% use or less.";
    case "no_negatives":
      return isNum(v) ? `Clear the ${plural(v, "negative item", "negative items")} on your report.` : "Clear the negative items on your report.";
    case "anchor_card":
      return isNum(v) && v > 0
        ? `Have one card 2+ years old with a $5,000+ limit. Your best one counts ${dollars(v)} now.`
        : "Have one card 2+ years old with a $5,000+ limit.";
    case "no_inquiries":
      return isNum(v) ? `Get the ${plural(v, "hard inquiry", "hard inquiries")} off your report.` : "Get the hard inquiries off your report.";
    case "file_depth":
      return isNum(v) ? `Have 3 or more accounts in good standing. You have ${v} now.` : "Have 3 or more accounts in good standing.";
    case "funding_reach":
      return "UnderwriteIQ shows more funding once your file is fixed.";
    default:
      return null;
  }
}

const UNKNOWN_TEXT = Object.freeze({
  score_700: "Your credit score is not on file yet.",
  utilization_30: "Your card use is not on file yet.",
  no_negatives: "Your negative item count is not on file yet.",
  anchor_card: "Some account open dates are not on file yet.",
  no_inquiries: "Your hard inquiry counts are not on file yet.",
  file_depth: "Your accounts are not on file yet."
});

/**
 * fundhubScore({ checks, tier, scored, funding }) → the client-safe result:
 *   { model, score (0-100 | null), band (building | close | fundable | null),
 *     band_label, reasons: [{ check, text }] (at most 3) }
 *
 * checks   personalChecks() output (each { key, passed, value })
 * tier     tierOf(): "fundable" | "not_fundable" | null
 * scored   false when no bureau carries a score (no pull) → score null
 * funding  { today_cents, when_fixed_cents } from the full report engine, or null
 */
export function fundhubScore({ checks = [], tier = null, scored = true, funding = null } = {}) {
  const model = FUNDHUB_SCORE_WEIGHTS.model;
  if (!scored) {
    return { model, score: null, band: null, band_label: null,
      reasons: [{ check: "credit_pull", text: "Your Fundhub score needs a credit report." }] };
  }
  const byKey = new Map((Array.isArray(checks) ? checks : []).filter(Boolean).map((c) => [c.key, c]));
  let earned = 0;
  let possible = 0;
  const gaps = [];
  const unknown = [];
  PART_ORDER.forEach((key, order) => {
    const weight = FUNDHUB_SCORE_WEIGHTS.parts[key].weight;
    const check = byKey.get(key) || null;
    const c = credit(key, check, funding);
    if (c === null) {
      if (UNKNOWN_TEXT[key]) unknown.push({ key, order });
      return;
    }
    earned += weight * c;
    possible += weight;
    if (c < 1) gaps.push({ key, order, missing: weight * (1 - c), check });
  });
  if (possible <= 0) {
    return { model, score: null, band: null, band_label: null,
      reasons: [{ check: "credit_pull", text: "Your Fundhub score needs a credit report." }] };
  }
  const score = Math.round((100 * earned) / possible);
  const band = tier === "fundable" ? "fundable" : (score >= FUNDHUB_SCORE_WEIGHTS.close_at ? "close" : "building");

  gaps.sort((a, b) => (b.missing - a.missing) || (a.order - b.order));
  const reasons = gaps.slice(0, FUNDHUB_SCORE_WEIGHTS.reasons_shown)
    .map((g) => ({ check: g.key, text: gapText(g.key, g.check) }));
  for (const u of unknown) {
    if (reasons.length >= FUNDHUB_SCORE_WEIGHTS.reasons_shown) break;
    reasons.push({ check: u.key, text: UNKNOWN_TEXT[u.key] });
  }
  if (reasons.length === 0) reasons.push({ check: null, text: "Every UnderwriteIQ check passes." });

  return { model, score, band, band_label: FUNDHUB_BANDS[band], reasons };
}

/** The full report engine's today / once-fixed figures, from a fundability payload's `opportunity`. */
export function fundingReachFrom(opportunity) {
  const p = opportunity && opportunity.personal;
  if (!p) return null;
  return { today_cents: isNum(p.currentCents) ? p.currentCents : null,
    when_fixed_cents: isNum(p.projectedCents) ? p.projectedCents : null };
}

export default fundhubScore;
