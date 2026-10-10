// The client's credit, in one read — the back end of /app/money-credit.html.
//
// "Like Credit Karma": the three personal scores with the date each was pulled,
// the business score, how much of their card limits they use, how many accounts
// are open, how many inquiries and negative items are on file, the score over
// time when more than one pull is stored, and UnderwriteIQ's own sentences.
//
// NOTHING NEW IS READ OR INVENTED. Every number comes from a reader that
// already exists and already decides that number for the staff screens:
//
//   scores, per pull         triMerge()           src/http/client-detail.mjs
//                            (FICO range only, sandbox pulls never painted,
//                            sample reports flagged)
//   business score           businessCredit()     src/http/client-detail.mjs
//                            (given the pulls: the Experian Business report a
//                            CRS pull stored on result.businessReports[])
//   accounts                 linesForEngine()     src/tradelines/index.mjs
//   utilization              clientUtilizationPct src/underwrite/adapter.mjs,
//                            then utilisation()   src/http/client-detail.mjs
//   inquiries / negatives    the same custom fields toBureaus() reads
//   suggestions              the same four engine calls api/read/underwrite.mjs
//                            makes, and the text is returned word for word
//
// UNKNOWN IS NULL, NEVER 0. A count nobody measured is null and named in
// `missing`. A screen that shows "0 negative items" on a file nobody counted is
// telling the client their file is clean when we do not know that.
//
// THE SUGGESTIONS ARE FILTERED, NOT EDITED. Same rule as pickTip() in
// ./money-overview.mjs: a sentence resting on a number nobody entered, an
// unrecognised sentence, and the engine's fallback lines are left out, because
// this read is client-facing. Every sentence that passes is the engine's string,
// unchanged.
import {
  triMerge, businessCredit, businessScoreFromPulls, utilisation, UTILISATION_BANDS
} from "../http/client-detail.mjs";
import { linesForEngine } from "../tradelines/index.mjs";
import { clientUtilizationPct, toBureaus } from "../underwrite/adapter.mjs";
import { computeUnderwrite, buildSuggestions } from "../underwrite/engine.mjs";
import { applyStackedBusinessFunding } from "../underwrite/business-funding.mjs";
import { buildReport } from "../underwrite/report.mjs";
import { evaluateUtilization } from "../alerts/evaluate.mjs";

/* The same three custom fields toBureaus() reads (src/underwrite/adapter.mjs). */
const INQUIRY_FIELDS = Object.freeze({
  experian: "crs_inquiries_ex",
  equifax: "crs_inquiries_eq",
  transunion: "crs_inquiries_tu"
});
const BUREAUS = Object.freeze(["experian", "equifax", "transunion"]);
const BUREAU_OF_CODE = Object.freeze({ EX: "experian", EQ: "equifax", TU: "transunion" });

function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/* A whole, non-negative count, or null. Same refusals as the adapter's count(). */
function count(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && v.trim().toLowerCase() === "null") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/* pg hands bigint back as a string. Integer cents, or null. */
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function iso(v) {
  if (!v) return null;
  const t = new Date(v);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

function day(v) {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const t = new Date(v);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : null;
}

function safeObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Scores
 * ------------------------------------------------------------------ */

/**
 * scorePoints — one point per stored pull that carries at least one FICO,
 * oldest first. triMerge() over a one-row list IS that row's scores, with its
 * sandbox and FICO-range rules, so the rules live in one place.
 */
export function scorePoints(crsRows = []) {
  const points = [];
  for (const row of Array.isArray(crsRows) ? crsRows : []) {
    const t = triMerge([row]);
    if (t.experian == null && t.equifax == null && t.transunion == null) continue;
    points.push({
      pulled_at: iso(row.created_at),
      experian: t.experian,
      equifax: t.equifax,
      transunion: t.transunion,
      sample: t.sample === true
    });
  }
  return points.sort((a, b) => String(a.pulled_at || "").localeCompare(String(b.pulled_at || "")));
}

/** Each bureau's newest score, with the date of the pull it came from. */
export function personalScores(points = []) {
  const out = {};
  for (const bureau of BUREAUS) {
    const newest = [...points].reverse().find((p) => p[bureau] != null) || null;
    out[bureau] = {
      score: newest ? newest[bureau] : null,
      pulled_at: newest ? newest.pulled_at : null,
      sample: newest ? newest.sample : false
    };
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Accounts, utilization, inquiries, negatives
 * ------------------------------------------------------------------ */

function isOpen(line) {
  if (line.closed_at) return false;
  const raw = safeObject(line.raw) || {};
  const status = String(raw.accountStatusType ?? raw.accountStatus ?? "").toLowerCase();
  return !/closed|paid|transferred/.test(status);
}

/** The accounts the engine is given, as the client sees them. */
export function accountsSummary(lines = [], source = "none") {
  const list = (Array.isArray(lines) ? lines : []).map((l) => {
    const open = isOpen(l);
    return {
      lender: text(l.lender),
      kind: text(l.kind),
      last4: text(l.last4),
      limit_cents: cents(l.credit_limit_cents),
      balance_cents: cents(l.balance_cents),
      opened_on: day(l.opened_on),
      open
    };
  });
  if (source === "none") {
    // No accounts in the table and none in any stored pull: we do not know how
    // many are open, so the count is null, not 0.
    return { open: null, revolving: null, installment: null, source, list: [] };
  }
  const open = list.filter((a) => a.open);
  return {
    open: open.length,
    revolving: open.filter((a) => a.kind === "revolving" || a.kind === "loc").length,
    installment: open.filter((a) => a.kind === "installment").length,
    source,
    list
  };
}

export function utilizationSummary(lines = [], crsRows = [], client = {}) {
  const fromLines = clientUtilizationPct(lines);
  if (fromLines.pct !== null) {
    const pct = Math.round(fromLines.pct * 10) / 10;
    return {
      percent: pct,
      band: UTILISATION_BANDS.find((b) => pct <= b.max).band,
      partial: fromLines.partial,
      source: "accounts"
    };
  }
  const stored = utilisation(crsRows, client);
  return {
    percent: stored.percent,
    band: stored.band,
    partial: false,
    source: stored.percent === null ? null : "credit_report"
  };
}

/**
 * Inquiries per bureau. The custom fields first (what UnderwriteIQ reads). When
 * none of the three is filled in, the newest scored pull's own inquiry list is
 * counted — but only if that pull carries an `inquiries` list at all; a pull
 * with no list is "not known", not "none".
 */
export function inquiriesSummary(customFields = {}, crsRows = []) {
  const cf = customFields || {};
  const byBureau = {};
  for (const b of BUREAUS) byBureau[b] = count(cf[INQUIRY_FIELDS[b]]);
  let source = BUREAUS.some((b) => byBureau[b] !== null) ? "custom_fields" : null;

  if (!source) {
    const newest = [...(Array.isArray(crsRows) ? crsRows : [])]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .find((r) => {
        const t = triMerge([r]);
        return t.experian != null || t.equifax != null || t.transunion != null;
      });
    const result = newest ? safeObject(newest.result) : null;
    if (result && Array.isArray(result.inquiries)) {
      const pulled = Array.isArray(result.bureausPulled) ? result.bureausPulled : [];
      for (const code of pulled) {
        const b = BUREAU_OF_CODE[String(code).toUpperCase()];
        if (b) byBureau[b] = 0;
      }
      for (const inq of result.inquiries) {
        const b = BUREAU_OF_CODE[String(inq?.source || "").toUpperCase()];
        if (b) byBureau[b] = (byBureau[b] ?? 0) + 1;
      }
      if (BUREAUS.some((b) => byBureau[b] !== null)) source = "credit_report";
    }
  }

  const known = BUREAUS.map((b) => byBureau[b]);
  return {
    // One unknown bureau leaves the total unknown, same as the engine.
    total: known.every((n) => n !== null) ? known.reduce((a, n) => a + n, 0) : null,
    by_bureau: byBureau,
    source
  };
}

/* ------------------------------------------------------------------ *
 * UnderwriteIQ
 * ------------------------------------------------------------------ */

/** Client-safe sentences: same filter as pickTip(), every one kept, in order. */
export function usableSuggestions(annotated = []) {
  return (Array.isArray(annotated) ? annotated : [])
    .filter((s) => s && s.recognised !== false && s.restsOnMissingData !== true &&
      s.topic !== "fallback" && typeof s.text === "string" && s.text)
    .map((s) => ({ text: s.text, topic: s.topic ?? null }));
}

/* The same four engine calls as api/read/underwrite.mjs, in the same order.
   Any failure is "no suggestions", never a broken page. */
export function underwriteSuggestions({ lines, liabilities, crsRows, customFields, businesses }) {
  try {
    if (lines.length === 0 && crsRows.length === 0) return [];
    const ageOrder = [...businesses].sort((a, b) =>
      new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const adapter = toBureaus({
      tradelines: lines,
      liabilities,
      crsResults: crsRows,
      customFields: customFields || {},
      businesses: ageOrder
    });
    const underwrite = applyStackedBusinessFunding(
      computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths),
      adapter.businessAges
    );
    const suggestions = buildSuggestions(underwrite, {
      hasLLC: adapter.hasLLC,
      llcAgeMonths: adapter.llcAgeMonths ?? 0
    });
    const report = buildReport({
      underwrite, suggestions, adapter, fundhubUtilization: evaluateUtilization(lines)
    });
    return usableSuggestions(report.suggestions);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * The whole payload
 * ------------------------------------------------------------------ */

/**
 * buildCreditOverview — pure. Rows in, the contract out.
 */
export function buildCreditOverview({
  client = {}, asOf = new Date().toISOString(),
  crsRows = [], tradelineRows = [], liabilities = [], businesses = []
} = {}) {
  const cf = safeObject(client.custom_fields) || {};
  const newestFirst = [...crsRows].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const points = scorePoints(newestFirst);
  const personal = personalScores(points);

  const bizOrder = [...businesses].sort((a, b) =>
    new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  /* The pulls go in too. A live pull stores the Experian Business report on
     crs_results.result.businessReports[], not on the businesses row, so a
     read of the businesses row alone never found a score (wave 3, G4). */
  const biz = businessCredit({
    client: { ...client, custom_fields: cf }, businesses: bizOrder, crsResults: newestFirst
  });
  const bizPull = businessScoreFromPulls(newestFirst, bizOrder[0] || null);

  const { tradelines: lines, source: lineSource } = linesForEngine(tradelineRows, newestFirst);
  const accounts = accountsSummary(lines, lineSource);
  const utilization = utilizationSummary(lines, newestFirst, { ...client, custom_fields: cf });
  const inquiries = inquiriesSummary(cf, newestFirst);
  const negatives = count(cf.crs_negative_items_count);
  const lates = count(cf.crs_late_payments_count);

  const suggestions = underwriteSuggestions({
    lines, liabilities, crsRows: newestFirst, customFields: cf, businesses
  });

  const hasPull = points.length > 0;
  const missing = [];
  if (!hasPull) missing.push("credit_pull");
  for (const b of BUREAUS) if (personal[b].score === null) missing.push(`${b}_score`);
  if (biz.intelliscore === null) missing.push("business_score");
  if (utilization.percent === null) missing.push("utilization");
  if (accounts.open === null) missing.push("open_accounts");
  if (inquiries.total === null) missing.push("inquiries");
  if (negatives === null) missing.push("negative_items");
  if (lates === null) missing.push("late_payments");

  const first = text(client.first_name);
  const last = text(client.last_name);
  return {
    ok: true,
    client: { id: text(client.id), name: [first, last].filter(Boolean).join(" ") || null },
    as_of: iso(asOf),
    has_pull: hasPull,
    // True when any score on the page came off a sample report, never a bureau.
    sample: BUREAUS.some((b) => personal[b].sample === true) ||
      (bizPull.found && bizPull.sample === true && (bizPull.intelliscore !== null || bizPull.fsr !== null)),
    personal,
    business: {
      name: biz.name,
      intelliscore: biz.intelliscore,
      fsr: biz.fsr
    },
    utilization,
    accounts,
    inquiries,
    negative_items: { count: negatives },
    late_payments: { count: lates },
    history: points.length > 1 ? points : [],
    suggestions,
    missing
  };
}

/* Selected columns: crs_results.result is the whole pull and is needed;
   nothing else wide is selected. Demo rows are left out, as the portal does. */
const CRS_SQL = `
  SELECT id, result, created_at
    FROM crs_results
   WHERE client_id = $1 AND org_id = $2
     AND is_demo IS NOT TRUE
   ORDER BY created_at DESC`;
const TRADELINE_SQL = `
  SELECT * FROM tradelines
   WHERE client_id = $1 AND org_id = $2
     AND is_demo IS NOT TRUE
   ORDER BY apr ASC NULLS LAST, lender ASC`;
const LIABILITY_SQL = `
  SELECT * FROM card_liabilities
   WHERE client_id = $1 AND org_id = $2
   ORDER BY as_of DESC`;
const BUSINESS_SQL = `
  SELECT name, age_months, entity_data, created_at, updated_at
    FROM businesses
   WHERE client_id = $1 AND org_id = $2`;

/**
 * creditOverview(db, { orgId, clientId, asOf }) → the contract, or null when the
 * client is not in that org (the caller answers 404). Every query carries
 * org_id AND client_id. Read only.
 */
export async function creditOverview(db, { orgId, clientId, asOf = new Date() } = {}) {
  const clientRes = await db.query(
    `SELECT id, first_name, last_name, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;

  const [crs, lines, liabilities, businesses] = await Promise.all([
    db.query(CRS_SQL, [clientId, orgId]),
    db.query(TRADELINE_SQL, [clientId, orgId]),
    db.query(LIABILITY_SQL, [clientId, orgId]),
    db.query(BUSINESS_SQL, [clientId, orgId])
  ]);

  return buildCreditOverview({
    client,
    asOf: new Date(asOf).toISOString(),
    crsRows: crs.rows,
    tradelineRows: lines.rows,
    liabilities: liabilities.rows,
    businesses: businesses.rows
  });
}

export default creditOverview;
