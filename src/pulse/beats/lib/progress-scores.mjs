// ONE COPY (2026-10-20). This file used to be src/progress/scores.mjs. It moved here whole, unchanged except its
// import paths, so the hourly beat client-progress runs the same progress read as GET /api/read/client-progress. A beat may import only from src/pulse/beats/lib.
// src/progress/scores.mjs re-exports everything here, so every caller imports from there as before. Change it here.
//
// The score panels behind GET /api/read/client-progress.
//
// OWNER-SET, 2026-09-05: three personal bureaus PLUS business credit, and the
// business side is an ARRAY with one entry per business, because the panel
// TOGGLES between businesses. A single blended number is the wrong answer and
// businessCredit() in src/http/client-detail.mjs gives exactly that — it reads
// `businesses[0]` and throws the rest away. That function is right for the staff
// detail screen it was written for and wrong here, so this file does the
// per-business version instead of widening it.
//
// NULL MEANS NOT PULLED (CLAUDE.md §12). A bureau with no score is `null`, never
// 0 and never "". The front end renders that as "not pulled yet". A zero here
// would read to a client as a catastrophic score, which is the exact failure the
// rule exists to prevent.
//
// NOTHING IS INVENTED. Every number comes from a stored row:
//   personal → crs_results.result, read through triMerge() so the FICO range
//              check, the score-model check and the sandbox-fixture exclusion
//              are the same ones the staff screens already apply.
//   business → businesses.entity_data only, applied per row instead of to the
//              first row only.
//
// THE BUSINESS KEY LIST IS NARROWER THAN businessCredit()'s, ON PURPOSE, AND
// THAT IS A REAL DIFFERENCE WORTH KNOWING. src/http/client-detail.mjs:313-316
// reads FIVE candidates — scores.intelliscore, entity.intelliscore,
// commercialScore.score, then clients.custom_fields.biz_intelliscore and
// custom_fields.intelliscore — and also surfaces an FSR at :317. This file reads
// the first THREE and no FSR, because the last two live on the CLIENT row rather
// than the business row and there is no honest way to attribute one client-level
// number to one of several businesses on a page whose whole point is that the
// panel toggles between them. So if a number is ever stored in custom_fields it
// will show on the staff detail screen and read "not pulled" here.
//
// That is latent, not live: grep of src/, api/, db/ and public/ finds NO writer
// for any of the five keys or for the FSR — every hit is a reader. Nothing in
// this repository has ever stored a business credit score, so today every
// business panel returns `score: null`. Measured 2026-09-05, not assumed.

import { isSampleResult, triMerge } from "./lenders-credit.mjs";

/** The three personal bureaus, in the order the panel draws them. */
export const PERSONAL_BUREAUS = Object.freeze(["experian", "equifax", "transunion"]);

/** The business bureau this repository can actually read a score for. */
export const BUSINESS_BUREAU = "experian_business";

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* An Intelliscore / FSR is 0-100, unlike a FICO. Copied from
   firstScore100() in src/http/client-detail.mjs rather than imported because
   that one is not exported; the bounds are the scale's, not a policy. */
function score100(values) {
  for (const v of values) {
    const n = num(v);
    if (n !== null && n >= 0 && n <= 100) return Math.round(n);
  }
  return null;
}

function asObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

function newestFirst(rows) {
  return [...(rows || [])].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
}

/**
 * ONE crs_results row's three FICOs.
 *
 * triMerge() is asked about a single-row list on purpose. It is the only
 * exported reader of that column shape, and calling it this way inherits its
 * whole contract — the 300-850 bounds, the "the model must say FICO" check, and
 * the refusal to paint a sandbox fixture as somebody's credit file — without
 * copying any of it here or editing a file this lane does not own.
 */
export function scoresOfResult(row) {
  const t = triMerge([row]);
  return { experian: t.experian, equifax: t.equifax, transunion: t.transunion };
}

/**
 * The personal panels: newest non-null score per bureau, each with its OWN
 * pulled date.
 *
 * PER BUREAU, NOT PER PULL. triMerge() picks one result row and reports all
 * three from it, so a bureau that answered last month but not this month reads
 * as null. That is right for a tri-merge — you want the three from one moment —
 * and wrong for a panel, where the honest answer is "651, pulled 12 January"
 * rather than "not pulled". Each bureau therefore walks the rows newest-first
 * and stops at its own first real number, and `pulledAt` says which pull that
 * was, so a stale panel is visibly stale instead of silently current.
 *
 * KNOWN MISMATCH, DISCLOSED RATHER THAN PAPERED OVER. `reportDocumentId` is the
 * NEWEST credit report on file, whichever pull the panel's own number came from.
 * So a January TransUnion panel can link to the March report, and the March
 * report may have no TransUnion score in it. The panel's date is still honest —
 * it says January — but the document behind it is not the document that number
 * was read from. Fixing this properly needs a link from a report document back
 * to the crs_results row it was generated from, and no such column exists.
 * Guessing one by matching timestamps would be worse. Left as is, on the record.
 */
export function personalPanels(crsResults = [], { reportDocumentId = null } = {}) {
  const rows = newestFirst(crsResults);
  return PERSONAL_BUREAUS.map((bureau) => {
    for (const row of rows) {
      const s = scoresOfResult(row);
      if (s[bureau] != null) {
        return {
          bureau,
          score: s[bureau],
          pulledAt: isoOrNull(row.created_at),
          reportDocumentId: reportDocumentId || null,
          /* True when this number came off a sample report, never a bureau
             pull, so the page says "sample" and not "Pulled" (live hole 23). */
          sample: isSampleResult(row.result)
        };
      }
    }
    return { bureau, score: null, pulledAt: null, reportDocumentId: null, sample: false };
  });
}

/**
 * One panel per business row.
 *
 * `businessId` is `businesses.id` — a primary key, so it is stable across
 * requests, which is what the toggle needs. It is NOT the array index and it is
 * NOT the name: F44 in the 2026-09-03 walkthrough was a business fact that never
 * reached the engine, and an ordinal key would break the toggle the first time a
 * second business was added ahead of the first in the sort.
 *
 * A client with no business row gets an EMPTY ARRAY, not a placeholder panel.
 * There is no business to score, which is a different thing from a business
 * whose score has not been pulled — and that second case is the one that gets a
 * panel with `score: null`.
 *
 * `pulledAt` IS ALWAYS null, AND THAT IS THE FIX, NOT THE GAP.
 *
 * It used to be `businesses.updated_at`. That column is maintained by a database
 * trigger (trg_businesses_updated) on EVERY update to the row, so editing the
 * business address — or its name, or its age — silently repainted the client's
 * business score as freshly pulled. A date we do not have is null. It is never a
 * nearby timestamp that looks like one, and `created_at` is no better: it is
 * when the row was inserted, which is not when anybody pulled a score either.
 *
 * `businesses` has no per-score timestamp anywhere: id, org_id, client_id, name,
 * age_months, entity_data, created_at, updated_at, and nothing inside
 * entity_data (api/soft-pull-approve.mjs:241-260 writes the whole object and
 * stores no pull date). Verified against the real table, 2026-09-05. Until a
 * per-business pull timestamp exists, this stays null and the screen says
 * "date unknown" rather than a date that is wrong.
 */
export function businessPanels(businesses = [], { reportDocumentId = null } = {}) {
  return (Array.isArray(businesses) ? businesses : []).map((biz) => {
    const entity = asObject(biz && biz.entity_data) || {};
    const scores = asObject(entity.scores) || {};
    const commercial = asObject(entity.commercialScore) || {};
    const score = score100([
      scores.intelliscore, entity.intelliscore, commercial.score
    ]);
    return {
      businessId: biz && biz.id ? String(biz.id) : null,
      name: biz && biz.name ? String(biz.name) : null,
      bureau: BUSINESS_BUREAU,
      score,
      pulledAt: null,
      reportDocumentId: score === null ? null : (reportDocumentId || null)
    };
  });
}

/**
 * The middle of three bureau scores.
 *
 * ALL THREE OR NOTHING. "Middle score" is only defined over three numbers. With
 * two on file there is no middle — there is a higher and a lower — and picking
 * one of them would be this file inventing a lending rule that exists nowhere
 * else in this repository. Fewer than three therefore returns null, and null
 * means unknown, which the screen already has words for.
 */
export function middleScore({ experian, equifax, transunion } = {}) {
  const present = [experian, equifax, transunion].filter((v) => v != null);
  if (present.length < 3) return null;
  return present.sort((a, b) => a - b)[1];
}

/**
 * The score series, oldest first — one point per pull that produced at least
 * one score.
 *
 * COSTS NO NEW QUERY. api/read/portal-summary.mjs already loads every
 * crs_results row with no LIMIT and discards all but the newest; this is the
 * mapping function over rows the caller already has.
 *
 * A SHORT SERIES IS NOT A BUG. src/retention/classes.mjs tombstones
 * `crs_results.result` after the configured retention window, so an old row can
 * legitimately come back with nothing in it. Those rows produce no point rather
 * than a point of three nulls, which would draw a hole in the chart where a pull
 * really did happen.
 */
export function scoreSeries(crsResults = []) {
  const out = [];
  for (const row of [...(crsResults || [])].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  )) {
    const s = scoresOfResult(row);
    if (s.experian == null && s.equifax == null && s.transunion == null) continue;
    out.push({ at: isoOrNull(row.created_at), ...s });
  }
  return out;
}

export function isoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
