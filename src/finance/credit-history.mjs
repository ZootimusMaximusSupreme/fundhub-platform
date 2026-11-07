// Credit over time — the back end of the "Credit over time" card on the Credit
// section (/app/financeos.html#credit and /app/money-credit.html).
//
// Spec item 4, owner-set 2026-11-06 (ops/workflows/finance-os-cfo-build-2026-11-06.txt):
// one line per bureau from every saved credit pull, and for each saved
// business one line per score its saved Experian Business report carries. A
// month with no pull is a gap, never a made-up point.
//
// PURE. Rows in, series out. No query, no pull, no provider call. The caller
// (src/finance/credit-overview.mjs) hands over the crs_results and businesses
// rows it already read, scoped to one org AND one client.
//
// WHERE EACH NUMBER COMES FROM — nothing here decides a number on its own:
//
//   bureau scores, per pull  triMerge([row])          src/pulse/beats/lib/lenders-credit.mjs
//                            (FICO range only, sandbox pulls never painted,
//                            sample reports flagged) — the same reader the score
//                            tiles use, so a line's newest point IS the tile.
//   cards used, per pull     clientUtilizationPct()   src/underwrite/adapter.mjs
//                            over that pull's own accounts (normalizeFromCrs,
//                            src/tradelines/index.mjs); when the pull carries no
//                            accounts, the `utilization` the analyzer stored on
//                            the pull, as utilisation() reads it.
//   business scores          result.businessReports[] (src/finance/crs-pull.mjs
//                            orderSavedBusinessReports), report.data.scoreInformation,
//                            read with the same name/state match, sandbox skip and
//                            1-100 range as businessScoreFromPulls()
//                            (src/http/client-detail.mjs). Every score field the
//                            report carries becomes its own line, under the
//                            report's own field name (commercialScore, fsrScore).
//
// THE GAP RULE. Points are only ever real pulls. Two neighbouring points are
// joined by a line only when no calendar month passed between them without a
// pull AND no pull between them lacked that score. Otherwise the second point
// carries gap_before: true and the screen breaks the line there. The month is
// read off the stored timestamp's calendar date (UTC), the same date the
// screen prints.
import { triMerge, isSampleResult } from "../http/client-detail.mjs";
import { safeObject, num } from "../pulse/beats/lib/lenders-credit.mjs";
import { normalizeFromCrs } from "../tradelines/index.mjs";
import { clientUtilizationPct } from "../underwrite/adapter.mjs";

export const BUREAUS = Object.freeze(["experian", "equifax", "transunion"]);

function iso(v) {
  if (!v) return null;
  const t = new Date(v);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/* Same loose compare as companyKey() in src/http/client-detail.mjs, so this
   reader and the Credit tab's business score match the same report. */
function companyKey(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** "2026-09-30T04:30:03Z" → 2026*12 + 8. Null when there is no date. */
export function monthIndex(at) {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(at || ""));
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

/**
 * withGaps — one series over an ordered list of pulls.
 *
 * `pulls` is the list of pull dates, oldest first. `values[i]` is the score at
 * pull i, or null when that pull did not carry it. Returns one point per
 * non-null value. `gap_before` is true when the line must not be drawn from the
 * point before: a pull in between lacked the score, or a whole calendar month
 * passed with no pull at all. An unknown date never joins a line.
 */
export function withGaps(pulls = [], values = [], extra = () => ({})) {
  const out = [];
  let prev = -1;
  for (let i = 0; i < pulls.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    let gap = false;
    if (prev >= 0) {
      const a = monthIndex(pulls[prev]);
      const b = monthIndex(pulls[i]);
      gap = i - prev > 1 || a === null || b === null || b - a > 1;
    }
    out.push({ pulled_at: pulls[i], value: v, gap_before: gap, ...extra(i) });
    prev = i;
  }
  return out;
}

function byOldest(a, b) {
  const d = new Date(a.created_at || 0) - new Date(b.created_at || 0);
  return d !== 0 ? d : String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

/* ------------------------------------------------------------------ *
 * Personal
 * ------------------------------------------------------------------ */

/**
 * scoredPulls — every stored pull that carries at least one FICO, oldest
 * first, with the row kept beside its scores. triMerge() over a one-row list
 * IS that row's scores, with its sandbox and FICO-range rules.
 */
export function scoredPulls(crsRows = []) {
  const out = [];
  for (const row of Array.isArray(crsRows) ? crsRows : []) {
    const t = triMerge([row]);
    if (t.experian == null && t.equifax == null && t.transunion == null) continue;
    out.push({
      row,
      pulled_at: iso(row.created_at),
      experian: t.experian,
      equifax: t.equifax,
      transunion: t.transunion,
      sample: t.sample === true
    });
  }
  return out.sort((a, b) => String(a.pulled_at || "").localeCompare(String(b.pulled_at || "")));
}

/**
 * scorePoints — one point per stored pull that carries at least one FICO,
 * oldest first. The `history` field of the credit read and the trends read
 * (src/finance/money-trends.mjs) are built from this. Moved here from
 * credit-overview.mjs, unchanged; credit-overview.mjs re-exports it.
 */
export function scorePoints(crsRows = []) {
  return scoredPulls(crsRows).map((p) => ({
    pulled_at: p.pulled_at,
    experian: p.experian,
    equifax: p.equifax,
    transunion: p.transunion,
    sample: p.sample
  }));
}

/**
 * usageAtPull — how much of the card limits were used on ONE pull, or null.
 *
 * The pull's own accounts first, through the same engine rule the "Cards used"
 * tile uses (clientUtilizationPct). When the pull carries no accounts, the
 * `utilization` percent the analyzer stored on it. When it has neither, null:
 * that pull gets no point, never a 0.
 */
export function usageAtPull(row) {
  const lines = normalizeFromCrs(row);
  if (lines.length > 0) {
    const u = clientUtilizationPct(lines);
    if (u.pct !== null) {
      return { percent: Math.round(u.pct * 10) / 10, partial: u.partial === true, source: "report_accounts" };
    }
  }
  const result = safeObject(row && row.result);
  const stored = result ? num(result.utilization) : null;
  if (stored !== null && stored >= 0) {
    return { percent: Math.round(stored * 10) / 10, partial: false, source: "credit_report" };
  }
  return null;
}

/** The personal half: three bureau lines and a cards-used line. */
export function personalHistory(crsRows = []) {
  const pulls = scoredPulls(crsRows);
  const dates = pulls.map((p) => p.pulled_at);
  const series = BUREAUS.map((bureau) => ({
    bureau,
    points: withGaps(dates, pulls.map((p) => p[bureau]), (i) => ({ sample: pulls[i].sample }))
      .map(({ value, ...p }) => ({ ...p, score: value }))
  }));
  const usage = pulls.map((p) => usageAtPull(p.row));
  return {
    pulls: pulls.map((p) => ({ pulled_at: p.pulled_at, sample: p.sample })),
    series,
    usage: withGaps(dates, usage.map((u) => (u ? u.percent : null)), (i) => ({
      partial: usage[i].partial, source: usage[i].source, sample: pulls[i].sample
    })).map(({ value, ...p }) => ({ ...p, percent: value }))
  };
}

/* ------------------------------------------------------------------ *
 * Businesses
 * ------------------------------------------------------------------ */

/* A business score is Experian's 1-100 scale. Same range as firstScore100()
   in src/http/client-detail.mjs: a FICO-sized number is not a business score. */
function score100(v) {
  const n = num(v);
  return n !== null && n >= 0 && n <= 100 ? n : null;
}

/**
 * reportScores — every score a saved Experian Business report carries, under
 * the report's own field names. Reads `report.data || report`, then each entry
 * of `scoreInformation` that is an object with a 1-100 `score`, exactly where
 * deriveBusinessSignals() reads commercialScore.score and fsrScore.score
 * (vendor/underwriteiq-full/api/lite/crs/derive-business-signals.js).
 */
export function reportScores(report) {
  const r = safeObject(report) || {};
  const data = safeObject(r.data) || r;
  const info = data && typeof data === "object" ? safeObject(data.scoreInformation) : null;
  const out = {};
  if (!info || typeof info !== "object") return out;
  for (const [field, entry] of Object.entries(info)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const s = score100(entry.score);
    if (s !== null) out[field] = s;
  }
  return out;
}

/* The stored report for one saved company on one pull, or null. Same match as
   businessScoreFromPulls(): the name compared loosely, the state too when both
   sides have one. */
function reportFor(result, wantName, wantState) {
  const rows = Array.isArray(result.businessReports) ? result.businessReports : [];
  const row = rows.find((b) => {
    if (!b || companyKey(b.name) !== wantName) return false;
    const st = companyKey(b.state);
    return !wantState || !st || st === wantState;
  });
  return row ? safeObject(row.report) || {} : null;
}

/**
 * businessHistory — one entry per saved business, oldest company first (the
 * order the pull orders their reports in). Each carries one line per score
 * field its saved reports actually hold. A business with no saved report is
 * listed with has_report:false and no lines.
 */
export function businessHistory(crsRows = [], businesses = []) {
  /* Every stored, non-sandbox pull is a chance for a company's report: a pull
     between two reports that did not carry one breaks the line. */
  const pulls = [...(Array.isArray(crsRows) ? crsRows : [])]
    .map((r) => ({ ...r, result: safeObject(r.result) }))
    .filter((r) => r.result && String(r.result.environment || "").toLowerCase() !== "sandbox")
    .sort(byOldest);
  const dates = pulls.map((r) => iso(r.created_at));

  const ordered = [...(Array.isArray(businesses) ? businesses : [])].sort((a, b) => {
    const d = new Date(a.created_at || 0) - new Date(b.created_at || 0);
    return d !== 0 ? d : String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });

  return ordered.map((biz) => {
    const entity = safeObject(biz && biz.entity_data) || {};
    const wantName = companyKey(biz && biz.name);
    const wantState = companyKey(entity.state);
    const found = pulls.map((r) => {
      if (!wantName) return null;
      const report = reportFor(r.result, wantName, wantState);
      return report ? { scores: reportScores(report), sample: isSampleResult(r.result) } : null;
    });
    const fields = [];
    for (const f of found) {
      if (!f) continue;
      for (const k of Object.keys(f.scores)) if (!fields.includes(k)) fields.push(k);
    }
    const reports = found
      .map((f, i) => (f ? { pulled_at: dates[i], sample: f.sample } : null))
      .filter(Boolean);
    return {
      id: text(biz && biz.id),
      name: text(biz && biz.name),
      state: text(entity.state) ? String(entity.state).trim().toUpperCase() : null,
      has_report: reports.length > 0,
      reports,
      series: fields.map((field) => ({
        field,
        points: withGaps(dates, found.map((f) => (f && f.scores[field] !== undefined ? f.scores[field] : null)),
          (i) => ({ sample: found[i].sample }))
          .map(({ value, ...p }) => ({ ...p, score: value }))
      }))
    };
  });
}

/* ------------------------------------------------------------------ *
 * The field on the credit read
 * ------------------------------------------------------------------ */

/**
 * buildCreditHistory — the `credit_history` field of GET /api/money/credit.
 * Pure. The rows must already be scoped to one org and one client.
 */
export function buildCreditHistory({ crsRows = [], businesses = [] } = {}) {
  return {
    personal: personalHistory(crsRows),
    businesses: businessHistory(crsRows, businesses)
  };
}

export default buildCreditHistory;
