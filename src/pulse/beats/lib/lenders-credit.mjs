// The credit-file readers the lender match screens on. Pure: no imports, no I/O.
//
// ONE COPY, TWO CLOCKS (2026-10-20). These functions used to live in src/finance/crs-map.mjs
// (pickCreditScore, asArray, asInt) and src/http/client-detail.mjs (triMerge, utilisation,
// isSampleResult and their helpers). They moved here, unchanged, because the lender match
// (matchForClient in ./lenders-truth.mjs) reads the credit file through them and the hourly beat
// lender-book runs that match; a beat may import only from src/pulse/beats/lib. Both old files
// import these back and re-export the public names, so every caller imports from there as before.
// Change them here.

/* ── from src/finance/crs-map.mjs ── */

export function asArray(v) {
  return Array.isArray(v) ? v : [];
}

export function asInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).trim());
  return Number.isInteger(n) ? n : null;
}

/**
 * pickCreditScore — the credit score out of a bureau's `scores` array.
 *
 * A bureau returns several models and only some of them are credit scores. The
 * sandbox's TransUnion file carries FICO 9 twice AND a "CreditVision Income
 * Estimator" whose scoreValue is the string "47 B"; Experian carries its FICO 9
 * equivalent plus an "Income Insight".
 *
 * THE FILTER IS READ OFF THE DATA, NOT INVENTED. In every sample the vendor
 * ships, exactly the credit-score models carry BOTH an integer scoreValue and an
 * integer scoreMaximumValue; the income estimators carry a null maximum and a
 * non-numeric value. So: keep the entries that have both, then prefer a model
 * whose name says FICO or Fair Isaac.
 *
 * The fallback matters because Equifax's model name is not in any sample this
 * repo has seen. Rather than guess the string, an unnamed-but-numerically-valid
 * score is accepted AND the model name is recorded alongside it, so a human can
 * confirm what was read instead of trusting that it was right.
 */
export function pickCreditScore(scores) {
  const rows = asArray(scores).map((s) => ({
    value: asInt(s?.scoreValue),
    max: asInt(s?.scoreMaximumValue),
    model: String(s?.modelName ?? "").trim()
  }));

  /* FICO / Fair Isaac wins even when the bureau omits scoreMaximumValue.
     Equifax live files do that, and the old "must have a max" filter then
     picked IncomeView (81) over FICO 9. */
  const fico = rows.find((s) =>
    s.value !== null && s.value >= 300 && s.value <= 850 && /fico|fair\s*isaac/i.test(s.model)
  );
  if (fico) return { value: fico.value, model: fico.model || null };

  const candidates = rows.filter((s) => s.value !== null && s.max !== null && s.value >= 300 && s.value <= 850);
  if (!candidates.length) return { value: null, model: null };
  return { value: candidates[0].value, model: candidates[0].model || null };
}

/* ── from src/http/client-detail.mjs ── */

// NOTHING IS INVENTED. Every value is derived from something the analyzer
// actually stored. crs_results.result is the raw analysis.completed payload
// (src/handlers/client-lifecycle.mjs:135), so `scores` and `utilization` are read
// from there if the analyzer sent them and reported as null if it did not — a
// screen showing "—" is correct; a screen showing a made-up 720 is not.

/* FICO range only. IncomeView / other bureau add-ons (e.g. Equifax 42) are
   not credit scores and must not paint on a card. */
const FICO_MIN = 300;
const FICO_MAX = 850;
const FICO_MODEL = /fico|fair\s*isaac/i;

function ficoOf(value, model) {
  const n = num(value);
  if (n === null || n < FICO_MIN || n > FICO_MAX) return null;
  if (model && String(model).trim() && !FICO_MODEL.test(String(model))) return null;
  return n;
}

function scoresFromResult(result) {
  const s = (result && result.scores) || {};
  const m = (result && (result.scoreModels || result.score_models)) || {};
  const fromCache = {
    experian: ficoOf(s.ex ?? s.experian, m.ex ?? m.experian),
    equifax: ficoOf(s.eq ?? s.equifax, m.eq ?? m.equifax),
    transunion: ficoOf(s.tu ?? s.transunion, m.tu ?? m.transunion)
  };
  const bureaus = result && result.bureaus;
  if (!bureaus || typeof bureaus !== "object") return fromCache;
  return {
    experian: fromCache.experian ?? ficoFromBureau(bureaus.EX),
    equifax: fromCache.equifax ?? ficoFromBureau(bureaus.EQ),
    transunion: fromCache.transunion ?? ficoFromBureau(bureaus.TU)
  };
}

function ficoFromBureau(report) {
  if (!report || typeof report !== "object") return null;
  const { value, model } = pickCreditScore(report.scores);
  return ficoOf(value, model);
}

/* isSampleResult — was this stored report a walkthrough's SAMPLE, never a
   bureau pull? scripts/sim/push-credit.mjs and src/demo/simulate-client.mjs
   stamp it environment "simulated" (push-credit also sets simulated:true) so
   every screen can tell. The same test as isSampleReport() in
   public/app/client-control-panel.html (live hole 23). Unreadable answers
   false, so a real pull is never labelled. Never throws. */
export function isSampleResult(result) {
  const r = safeObject(result);
  if (!r || typeof r !== "object") return false;
  return r.simulated === true || String(r.environment || "").toLowerCase() === "simulated";
}

/* triMerge — the three bureau FICOs from the most recent CRS result that
   actually has one. Returns { experian, equifax, transunion, spread, asOf,
   source, sample } with nulls where the analyzer sent nothing usable.
   `sample` is true when that result is a sample report (isSampleResult). */
export function triMerge(crsResults = []) {
  const empty = { experian: null, equifax: null, transunion: null,
                  spread: null, asOf: null, source: null, sample: false };
  const latest = latestWithScores(crsResults);
  if (!latest) return empty;

  const { experian, equifax, transunion } = latest.scores;
  const present = [experian, equifax, transunion].filter((v) => v !== null);
  return {
    experian, equifax, transunion,
    spread: present.length >= 2 ? Math.max(...present) - Math.min(...present) : null,
    asOf: latest.created_at || null,
    source: present.length ? "crs_results" : null,
    sample: isSampleResult(latest.result)
  };
}

function latestWithScores(crsResults) {
  for (const r of [...(crsResults || [])].sort(byNewest)) {
    const result = safeObject(r.result);
    if (!result) continue;
    // Sandbox fixtures are not this person's credit file. Never paint them.
    if (String(result.environment || "").toLowerCase() === "sandbox") continue;
    const scores = scoresFromResult(result);
    if (scores.experian != null || scores.equifax != null || scores.transunion != null) {
      return { ...r, result, scores };
    }
  }
  return null;
}

export function byNewest(a, b) {
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

export function safeObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

export function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* UTILISATION BANDS. The thresholds are the standard credit-utilisation bands
   the roadmap is written against; they are a presentation grouping over a number
   the analyzer supplied, not a scoring model of our own. A missing utilisation
   yields band null rather than "unknown" masquerading as a band. */
export const UTILISATION_BANDS = [
  { band: "excellent", max: 10 },
  { band: "good",      max: 30 },
  { band: "high",      max: 50 },
  { band: "severe",    max: Infinity }
];

export function utilisation(crsResults = [], client = {}) {
  const latest = [...(crsResults || [])].sort(byNewest)
    .map((r) => ({ ...r, result: safeObject(r.result) }))
    .find((r) => r.result && r.result.utilization !== undefined);

  const pct = latest ? num(latest.result.utilization)
                     : num(client && client.custom_fields && client.custom_fields.utilization);
  if (pct === null) return { percent: null, band: null, asOf: null };

  const band = UTILISATION_BANDS.find((b) => pct <= b.max).band;
  return { percent: pct, band, asOf: latest ? latest.created_at || null : null };
}
