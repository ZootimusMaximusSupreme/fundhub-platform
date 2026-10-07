// Capital Blueprint — next funding sequence planner: what is read, and how the
// rows become the planner's inputs.
//
// The math is in next-sequence-math.mjs (pure). The one function that answers
// "what is this client's date" is computeNextSequenceDate in
// next-sequence-plan.mjs. This file holds the two halves they share, so the
// GET /api/money/banks read (which already has the client's credit rows in hand)
// and the daily alert read the same facts the same way:
//
//   readSequenceFacts   four reads: the funding rounds, the applications on them,
//                       the saved payment plan, and the linked cards.
//   assembleInputs      credit rows + those facts → the planner's inputs. Pure.
//   planFromRows        assembleInputs, then the math. Pure.
//
// NOTHING HERE WRITES. Every query carries org_id and client_id.
//
// WHICH CREDIT PULL. The inquiries come from the newest pull that carries a
// score, with sandbox pulls skipped — the same pick src/finance/credit-overview.mjs
// inquiriesSummary and triMerge make, so the planner and the Credit tab count the
// same inquiries. A newer sandbox pull with no score and an empty inquiry list
// must not wipe out the real file.

import { triMerge } from "../http/client-detail.mjs";
import { parseBureaus } from "../lenders/match.mjs";
import { readSavedPlan } from "../finance/payment-strategy.mjs";
import { linesForEngine } from "../tradelines/index.mjs";
import {
  BUREAU_CODES, SENT_STATUSES, isoDay, overallCardUse, planNextSequence
} from "./next-sequence-math.mjs";
import { NEXT_SEQUENCE_READY_DATE_KEY } from "./next-funding-sequence.mjs";

function safeObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { const p = JSON.parse(v); return p && typeof p === "object" ? p : null; } catch { return null; }
}

/** A whole, non-negative count, or null. Same refusals as the adapter's count(). */
function count(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && v.trim().toLowerCase() === "null") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** pg hands bigint back as a string. Integer cents, or null. */
function cents(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * A `date` column read as 'YYYY-MM-DD'. node-postgres turns a `date` into a Date
 * at LOCAL midnight, so a Date here is read with local parts; a timestamptz Date
 * is an instant and goes through isoDay (UTC). Strings pass through isoDay.
 */
function dateColumn(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return isoDay(v);
}

/** Bureau codes from free text ("EX/TU", "Experian"). Only the three personal bureaus; null when none. */
function bureausOf(raw) {
  const codes = [...new Set(parseBureaus(raw).filter((c) => BUREAU_CODES.includes(c)))];
  return codes.length ? codes : null;
}

/* ------------------------------------------------------------------ *
 * The credit pull the inquiries come from
 * ------------------------------------------------------------------ */

/**
 * pickInquiryPull(crsRows) → { on, bureausPulled, list } or null.
 *   on             the day the pull ran
 *   bureausPulled  ['EX', ...] — the bureaus that answered
 *   list           [{ bureau, date, creditor }] or null when the payload carries no list
 */
export function pickInquiryPull(crsRows = []) {
  const rows = [...(Array.isArray(crsRows) ? crsRows : [])]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  for (const row of rows) {
    const t = triMerge([row]);
    if (t.experian == null && t.equifax == null && t.transunion == null) continue;
    const result = safeObject(row.result);
    if (!result) continue;
    let pulled = [];
    if (Array.isArray(result.bureausPulled)) pulled = result.bureausPulled;
    else if (result.bureaus_pulled) pulled = parseBureaus(result.bureaus_pulled);
    const bureausPulled = [...new Set(pulled.map((c) => String(c).toUpperCase()).filter((c) => BUREAU_CODES.includes(c)))];
    const list = Array.isArray(result.inquiries)
      ? result.inquiries.filter((i) => i && typeof i === "object").map((i) => ({
        bureau: bureausOf(i.source || i.sourceType) ? bureausOf(i.source || i.sourceType)[0] : null,
        date: isoDay(i.date || i.inquiryDate),
        creditor: i.creditorName || i.creditor || null
      })).filter((i) => i.bureau)
      : null;
    return { on: isoDay(row.created_at), bureausPulled, list };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The four reads
 * ------------------------------------------------------------------ */

const ROUNDS_SQL = `
  SELECT id, round_number, status, funded_amount, approved_amount, created_at, updated_at
    FROM funding_rounds
   WHERE client_id = $1::uuid AND org_id = $2::uuid AND COALESCE(is_demo, false) = false
   ORDER BY round_number ASC, created_at ASC`;

/* One row per bank application on the client's rounds. The bureau it pulls: the
   one staff saw (lender_bureau_observations), else the bank book. Dates cast to
   text: a `date` through node-postgres moves with the server's zone. */
const APPS_SQL = `
  SELECT a.id, a.status, COALESCE(a.lender_name, a.bank) AS lender_name, a.lender_id,
         a.submitted_date::text AS submitted_on,
         a.status_updated_date AS status_at, a.created_at,
         fr.round_number,
         l.bureaus_pulled AS book_bureaus,
         (SELECT o.observed_bureau
            FROM lender_bureau_observations o
           WHERE o.application_id = a.id AND o.org_id = a.org_id
             AND btrim(COALESCE(o.observed_bureau, '')) <> ''
           ORDER BY o.created_at DESC LIMIT 1) AS observed_bureau
    FROM applications a
    JOIN funding_rounds fr ON fr.id = a.funding_round_id AND fr.org_id = a.org_id
    LEFT JOIN lenders l ON l.id = a.lender_id AND l.org_id = a.org_id
   WHERE fr.client_id = $1::uuid AND fr.org_id = $2::uuid
     AND COALESCE(a.is_demo, false) = false AND COALESCE(fr.is_demo, false) = false
   ORDER BY fr.round_number ASC, a.created_at ASC, a.id`;

const CARDS_SQL = `
  SELECT current_balance_cents, credit_limit_cents, closed_at, balance_as_of
    FROM bank_accounts
   WHERE client_id = $1::uuid AND org_id = $2::uuid AND account_type = 'credit'`;

/** One application row → what the planner reads. The day it was sent: the day staff typed, else the day its status last changed, else the day the row was made. */
export function normalizeApplication(r) {
  const status = r.status ? String(r.status).trim() : null;
  const sent = SENT_STATUSES.includes(status);
  const exact = isoDay(r.submitted_on);
  const statusOn = isoDay(r.status_at);
  return {
    id: r.id ? String(r.id) : null,
    status,
    lender_name: r.lender_name ? String(r.lender_name).trim() : null,
    lender_id: r.lender_id ? String(r.lender_id) : null,
    round_number: Number.isInteger(Number(r.round_number)) ? Number(r.round_number) : null,
    applied_on: sent ? exact || statusOn || isoDay(r.created_at) : null,
    applied_on_exact: sent ? !!exact : false,
    decided_on: status === "Approved" ? statusOn : null,
    bureaus: bureausOf(r.observed_bureau) || bureausOf(r.book_bureaus)
  };
}

/** Rounds with `funded` and `funded_on`. A funded round's day: the day of its latest approval, else the day the row last changed. */
export function normalizeRounds(rows = [], applications = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const funded = String(r.status || "").trim().toLowerCase() === "funded" || Number(r.funded_amount) > 0;
    const approvals = applications
      .filter((a) => a.round_number === Number(r.round_number) && a.decided_on)
      .map((a) => a.decided_on)
      .sort();
    return {
      id: r.id ? String(r.id) : null,
      round_number: Number(r.round_number),
      status: r.status ? String(r.status).trim() : null,
      funded,
      funded_on: funded ? approvals[approvals.length - 1] || isoDay(r.updated_at) || isoDay(r.created_at) : null
    };
  });
}

/** The saved plan → the one date this planner needs: when card use crosses 30%. */
export function normalizePlan(saved) {
  if (!saved) return null;
  const summary = saved.summary && typeof saved.summary === "object" ? saved.summary : {};
  const c = (Array.isArray(summary.crossings) ? summary.crossings : []).find((x) => x && Number(x.pct) === 30);
  return {
    saved_on: isoDay(saved.saved_at),
    as_of: isoDay(saved.as_of),
    crossing30: c ? { on: isoDay(c.on), already: c.already === true, earliest: c.earliest === true } : null
  };
}

/** Linked credit cards → overall card use and the oldest balance day among the cards counted. */
export function normalizeLinked(rows = []) {
  const cards = (Array.isArray(rows) ? rows : []).map((r) => ({
    closed: !!r.closed_at,
    limit_cents: cents(r.credit_limit_cents),
    balance_cents: cents(r.current_balance_cents),
    as_of: isoDay(r.balance_as_of)
  }));
  const use = overallCardUse(cards);
  if (!use) return null;
  const counted = cards.filter((c) => !c.closed && c.limit_cents !== null && c.limit_cents > 0);
  const days = counted.map((c) => c.as_of);
  return { ...use, as_of: days.every(Boolean) ? days.slice().sort()[0] : null, cards: counted.length };
}

/**
 * readSequenceFacts(db, { orgId, clientId }) → { rounds, applications, plan, linked, reconsiderations }.
 * Read only.
 */
export async function readSequenceFacts(db, { orgId, clientId }) {
  const [rounds, apps, saved, cards] = await Promise.all([
    db.query(ROUNDS_SQL, [clientId, orgId]),
    db.query(APPS_SQL, [clientId, orgId]),
    readSavedPlan(db, { orgId, clientId }),
    db.query(CARDS_SQL, [clientId, orgId])
  ]);
  const applications = apps.rows.map(normalizeApplication);
  return {
    rounds: normalizeRounds(rounds.rows, applications),
    applications,
    plan: normalizePlan(saved),
    linked: normalizeLinked(cards.rows),
    /* Open decline reconsiderations. Nothing on main tracks one yet (the decline
       defense unit adds that). null means "not tracked", which is not "none open"
       and is not a blocker; when a tracker lands, its reader goes here as
       { open: n, source }. */
    reconsiderations: null
  };
}

/* ------------------------------------------------------------------ *
 * Rows → inputs → answer
 * ------------------------------------------------------------------ */

/**
 * The engine's reading of the file, in the planner's words. The engine reports an
 * unknown score as 0 (src/underwrite/engine.mjs note 2), so a score under 300 is
 * "unknown" here, never "a score of 0".
 */
export function fileFromUnderwrite(underwrite, pullOn = null) {
  if (!underwrite) return { ran: false, score: null, negatives: null, util_pct: null, on: pullOn };
  const m = underwrite.metrics || {};
  return {
    ran: true,
    score: Number.isFinite(m.score) && m.score >= 300 ? m.score : null,
    negatives: Number.isFinite(m.negative_accounts) ? m.negative_accounts : null,
    util_pct: Number.isFinite(m.utilization_pct) ? m.utilization_pct : null,
    on: pullOn
  };
}

/**
 * assembleInputs(raw) → the planner's inputs. Pure.
 *
 * raw: { asOf (Date|string), customFields, crsRows, tradelineRows, underwrite,
 *        facts (readSequenceFacts) }
 */
export function assembleInputs({
  asOf, customFields = {}, crsRows = [], tradelineRows = [], underwrite = null, facts = null
} = {}) {
  const cf = safeObject(customFields) || {};
  const f = facts || { rounds: [], applications: [], plan: null, linked: null, reconsiderations: null };
  const pull = pickInquiryPull(crsRows);
  /* The accounts the engine reads: the stored rows, else the lines inside the
     newest pull that carries any (src/tradelines/index.mjs linesForEngine). */
  const { tradelines } = linesForEngine(tradelineRows, crsRows);
  return {
    asOf: isoDay(asOf),
    staffDate: isoDay(cf[NEXT_SEQUENCE_READY_DATE_KEY]),
    pull,
    counts: { EX: count(cf.crs_inquiries_ex), EQ: count(cf.crs_inquiries_eq), TU: count(cf.crs_inquiries_tu) },
    accounts: tradelines.map((t) => ({
      lender: t.lender || null,
      kind: t.kind || null,
      opened_on: dateColumn(t.opened_on),
      closed: !!t.closed_at
    })),
    applications: f.applications,
    rounds: f.rounds,
    file: fileFromUnderwrite(underwrite, pull ? pull.on : null),
    linked: f.linked,
    plan: f.plan,
    reconsiderations: f.reconsiderations
  };
}

/** assembleInputs, then the math. Pure. */
export function planFromRows(raw) {
  return planNextSequence(assembleInputs(raw));
}
