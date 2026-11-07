// The reads behind "your path" (src/waypoints/blueprint-path.mjs), for
// GET /api/blueprint/plan. READ ONLY. Every query names client_id AND org_id.
//
//   1. ChexSystems upload METADATA: the file id, its name, when it came in and
//      the vault review status. Nothing inside the report is read.
//   2. Connected PERSONAL cash, from the Money overview's own cash groups
//      (src/finance/money-overview.mjs, cash.personal). Business cash is never
//      read into the cash plan.
//   3. What UnderwriteIQ measured on the FIRST and the NEWEST saved genuine
//      credit pull (owner rule, Chris 2026-11-07: points come only from the
//      engine). For each pull: the CRS engine's own findings and preapproval
//      dollars (src/finance/crs-tier.mjs, the same call the plan already makes
//      for the newest pull), and the six personal fundability checks
//      (src/finance/fundability.mjs readEngine + personalChecks), each run on
//      that pull's own accounts. Nothing is estimated in between.

import { moneyOverview } from "../finance/money-overview.mjs";
import { readEngine, personalChecks, fundability, tierOf, businessRead } from "../finance/fundability.mjs";
import { businessAgeMultiplier } from "../underwrite/business-funding.mjs";
import { linesForEngine } from "../tradelines/index.mjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { buildFundingOpportunity } from "../blueprint/funding-opportunity.mjs";
import { buildBlueprintPath, CHEXSYSTEMS_UPLOAD_SUBTYPE } from "./blueprint-path.mjs";
import { auditCompany, websiteSuggestion, linkedInSuggestion, shellLlcSuggestion } from "../underwrite/company-audit.mjs";
import { buildBlackReportClient, hasBlackReportSource } from "../underwrite/black-report-client.mjs";
import { revolvingAccounts, mergeByCreditor } from "./definitions.mjs";

/* The subtype is a literal, so the two parameters stay client then org. */
export const CHEXSYSTEMS_UPLOADS_SQL = `SELECT d.id, d.subtype, d.title, d.generated_at, d.metadata->>'original_filename' AS filename,
       r.status AS review_status, r.reviewed_at
  FROM documents d
  LEFT JOIN document_vault_reviews r ON r.document_id = d.id AND r.org_id = d.org_id AND r.client_id = d.client_id
 WHERE d.client_id = $1::uuid AND d.org_id = $2::uuid
   AND d.kind = 'client_upload' AND d.subtype = '${CHEXSYSTEMS_UPLOAD_SUBTYPE}'
 ORDER BY d.generated_at DESC, d.id
 LIMIT 5`;

const object = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const iso = (v) => (v instanceof Date ? v.toISOString() : (typeof v === "string" ? v : null));

/** { cents, isFloor, accounts } from the Money overview's personal cash group, or null. */
export async function readConnectedPersonalCash(db, { orgId, clientId, asOf = new Date() } = {}) {
  const overview = await moneyOverview(db, { orgId, clientId, asOf });
  const personal = overview?.cash?.personal;
  if (!personal || !Number.isSafeInteger(personal.cents) || !(Number(personal.accounts) > 0)) return null;
  return { cents: personal.cents, isFloor: personal.is_floor === true, accounts: Number(personal.accounts) };
}

/* ── one business at a time (owner rule, Chris 2026-11-07) ───────────────────
   Each business on the plan gets the optimization checklist that already lives
   in src/underwrite/company-audit.mjs: the name check, the approved industry
   code, a website (banks check online presence), a LinkedIn business page
   (lenders like to see it), then the LLC and EIN status from the plan's own
   evidence. The shell-LLC guidance is shown once for the list. No price is
   shown for another business: that is an open owner decision. */
const EVIDENCE_WORDS = { reviewed: "Reviewed by the Fundhub team", evidence_received: "Received, waiting for review",
  rejected: "Needs attention", unavailable: "Needs a business review", not_added: "Not added yet" };

/** businessChecklist(businessPlans) → { list, shell } | null. Pure. */
export function businessChecklist(businessPlans = null) {
  const plans = Array.isArray(businessPlans?.businesses) ? businessPlans.businesses : [];
  const existing = Array.isArray(businessPlans?.existingBusinesses) ? businessPlans.existingBusinesses : [];
  const linked = new Set(plans.map((b) => b.businessId).filter(Boolean));
  const entries = [
    ...plans.map((b) => ({ planId: b.id ?? null, businessId: b.businessId ?? null, name: b.name ?? null, activity: b.activity ?? null,
      naics: b.naics ?? null, website: b.website ?? null, formed: b.formationStatus === "reported_formed",
      formation: b.evidence?.formation?.status ?? "not_added", ein: b.evidence?.ein?.status ?? "not_added" })),
    ...existing.filter((b) => !linked.has(b.id)).map((b) => ({ planId: null, businessId: b.id ?? null, name: b.name ?? null,
      activity: b.activity ?? null, naics: b.naics ?? null, website: b.website ?? null, formed: true, formation: null, ein: null }))
  ];
  if (!entries.length) return { list: [], shell: shellLlcSuggestion({ companyCount: 0 }).suggestion, canAddMore: true };
  const website = websiteSuggestion();
  const linkedIn = linkedInSuggestion();
  const list = entries.map((e, i) => {
    const audit = auditCompany({ name: e.name, naics: e.naics });
    return {
      planId: e.planId, businessId: e.businessId, name: e.name, activity: e.activity, first: i === 0,
      items: [
        { key: "name_check", label: "Name check", status: audit.nameSuggestion.change ? "review" : (e.name ? "done" : "missing"),
          text: audit.nameSuggestion.why },
        { key: "naics", label: "Industry code (NAICS)", status: audit.naicsSuggestion.status === "approved" ? "done" : audit.naicsSuggestion.status,
          text: audit.naicsSuggestion.status === "missing" ? "Pick one from the approved list that matches what the business actually does." : audit.naicsSuggestion.why },
        { key: "website", label: "Website", status: e.website ? "done" : "needed",
          text: e.website ? "Website saved." : "Needed: banks check online presence." , why: website.why },
        { key: "linkedin", label: "LinkedIn business page", status: "recommended",
          text: "Recommended: lenders like to see it.", why: linkedIn.why },
        { key: "llc", label: "LLC filing", status: e.formed ? "done" : (e.formation === "evidence_received" ? "review" : "to_do"),
          text: e.formation == null ? "On your file." : (e.formed ? "Reported formed." : "Not filed yet.") + (e.formation ? ` Filing proof: ${EVIDENCE_WORDS[e.formation] || "Not added yet"}.` : "") },
        { key: "ein", label: "EIN", status: e.ein === "reviewed" ? "done" : (e.ein === "evidence_received" ? "review" : (e.ein == null ? "on_file" : "to_do")),
          text: e.ein == null ? "Check the EIN letter on your file." : `EIN letter: ${EVIDENCE_WORDS[e.ein] || "Not added yet"}.` }
      ]
    };
  });
  return { list, shell: shellLlcSuggestion({ companyCount: entries.length }).suggestion, canAddMore: true };
}

/** The engine's fundability for the client's whole file — the same read the
 *  FinanceOS fundability page shows (src/finance/fundability.mjs `now`). */
export async function readFundabilityNow(db, { orgId, clientId, asOf = new Date() } = {}) {
  const read = await fundability(db, { orgId, clientId, asOf });
  if (!read?.now) return null;
  return {
    score: read.now.score, score_max: read.now.score_max, unknown: read.now.unknown, tier: read.now.tier,
    /* Each business the Fundability read lists, with its own estimate. */
    businesses: (Array.isArray(read.businesses) ? read.businesses : []).map((b) => ({
      business_id: b.business_id ?? null, name: b.name ?? null, age_months: b.age_months ?? null,
      estimate_cents: b.now?.funding_estimate_cents ?? null, multiplier: b.now?.multiplier ?? null }))
  };
}

/* The rows the Fundability read itself reads (src/finance/fundability.mjs
   fundability(): CRS_SQL, TRADELINE_SQL, LIABILITY_SQL, BUSINESS_SQL), here so a
   business the read does not list yet can be sized by its own exports.
   UnderwriteIQ (src/underwrite/**, src/finance/fundability.mjs) is not changed:
   owner rule, Chris 2026-11-07. Every read is scoped to the client AND the org. */
export const POINT_CLIENT_SQL = `SELECT custom_fields FROM clients WHERE id = $1 AND org_id = $2`;
export const POINT_CRS_SQL = `
  SELECT id, provider, is_demo, result, created_at
    FROM crs_results
   WHERE client_id = $1 AND org_id = $2
     AND is_demo IS NOT TRUE
   ORDER BY created_at DESC`;
export const POINT_TRADELINE_SQL = `
  SELECT * FROM tradelines
   WHERE client_id = $1 AND org_id = $2
     AND is_demo IS NOT TRUE
   ORDER BY apr ASC NULLS LAST, lender ASC`;
export const POINT_LIABILITY_SQL = `
  SELECT * FROM card_liabilities
   WHERE client_id = $1 AND org_id = $2
   ORDER BY as_of DESC`;
export const POINT_BUSINESS_SQL = `
  SELECT id, name, age_months, entity_data, created_at, updated_at
    FROM businesses
   WHERE client_id = $1 AND org_id = $2
   ORDER BY created_at ASC, id`;

/**
 * readBusinessPoint(db, { orgId, clientId }) → { uw, tier, checks, scored }, the
 * personal engine read that src/finance/fundability.mjs businessRead() sizes a
 * business from, built with that file's own exports (readEngine, personalChecks,
 * tierOf) from the same rows. Null when the client is not in the org.
 */
export async function readBusinessPoint(db, { orgId, clientId } = {}, { readEngineImpl = readEngine } = {}) {
  const args = [clientId, orgId];
  const [client, crs, lines, liabilities, businesses] = await Promise.all([
    db.query(POINT_CLIENT_SQL, args), db.query(POINT_CRS_SQL, args), db.query(POINT_TRADELINE_SQL, args),
    db.query(POINT_LIABILITY_SQL, args), db.query(POINT_BUSINESS_SQL, args)
  ]);
  if (!client.rows[0]) return null;
  const cf = object(client.rows[0].custom_fields);
  const newestFirst = [...crs.rows].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const bizOrdered = [...businesses.rows].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  const { tradelines } = linesForEngine(lines.rows, newestFirst);
  const read = readEngineImpl({ lines: tradelines, liabilities: liabilities.rows, crsRows: newestFirst, customFields: cf, businesses: bizOrdered });
  const scored = Array.isArray(read?.adapter?.available) && read.adapter.available.length > 0;
  return { uw: read?.uw ?? null, tier: tierOf(read?.uw, { scored }), checks: personalChecks(read), scored };
}

/**
 * measurePull(row, { analysis, runEngine, readEngineImpl }) → what UnderwriteIQ
 * says about ONE saved pull: { reportId, asOf, findings, checks, fundable,
 * personalCents, blocks, modifiers, cards }. A part the engine cannot read is null.
 * `cards` is each card's use on that pull, read the way the paydown step closes
 * itself: the highest balance any bureau reports over the lowest limit
 * (src/waypoints/definitions.mjs mergeByCreditor), from the pull's own accounts.
 */
export function measurePull(row, { analysis = null, runEngine = runTierEngineFromCrsResult, readEngineImpl = readEngine } = {}) {
  if (!row) return null;
  const result = object(row.result);
  let crs = analysis;
  if (!crs) {
    try { crs = result.consumerSignals ? result : runEngine(result); } catch { crs = null; }
  }
  let checks = null;
  let fundable = null;
  try {
    const { tradelines } = linesForEngine([], [row]);
    const read = readEngineImpl({ lines: tradelines, liabilities: [], crsRows: [row], customFields: {}, businesses: [] });
    checks = personalChecks(read).map((c) => ({ key: c.key, label: c.label, passed: c.passed, value: c.value ?? null }));
    fundable = read?.uw?.fundable === true;
  } catch { checks = null; fundable = null; }
  const personalCents = crs ? buildFundingOpportunity({ analysis: crs }).personal?.currentCents ?? null : null;
  const pre = crs?.preapprovals;
  let cards = [];
  try {
    const source = hasBlackReportSource(result) ? result : (crs && hasBlackReportSource(crs) ? crs : null);
    if (source) {
      cards = mergeByCreditor(revolvingAccounts(buildBlackReportClient({ crsResult: source, personal: null }).revolving))
        .filter((a) => Number.isSafeInteger(a.balanceCents) && Number.isSafeInteger(a.limitCents) && a.limitCents > 0)
        .map((a) => ({ key: a.creditorKey, name: a.creditor, utilPct: Math.round((Math.max(0, a.balanceCents) / a.limitCents) * 100) }));
    }
  } catch { cards = []; }
  const dollars = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null);
  return {
    reportId: row.id ?? null,
    asOf: iso(row.created_at),
    findings: Array.isArray(crs?.findings) ? crs.findings : [],
    checks,
    fundable,
    personalCents,
    /* The engine's own card and loan amounts, beside the total only. */
    blocks: personalCents == null ? null : { cardCents: dollars(pre?.personalCard?.final), loanCents: dollars(pre?.personalLoan?.final) },
    cards,
    /* Shown only beside the engine's own dollars, never on their own. */
    modifiers: personalCents == null ? null : {
      personalCard: object(pre?.personalCard?.modifiers),
      personalLoan: object(pre?.personalLoan?.modifiers)
    }
  };
}

/**
 * firstBusiness({ fundabilityNow, businessPlans, now }) → { name, ageMonths,
 * listed } for the plan's first business, or null. `listed` is the Fundability
 * read's own row for it (matched by business id, then by name), when it has one.
 */
export function firstBusiness({ fundabilityNow = null, businessPlans = null, now = new Date() } = {}) {
  const plan = Array.isArray(businessPlans?.businesses) ? businessPlans.businesses[0] : null;
  const existing = Array.isArray(businessPlans?.existingBusinesses) ? businessPlans.existingBusinesses[0] : null;
  if (!plan && !existing) return null;
  let ageMonths = null;
  const formed = plan ? (plan.formationStatus === "reported_formed" ? plan.formationDate : null) : existing?.formationDate;
  if (plan && plan.formationStatus !== "reported_formed") ageMonths = 0; // a planned business starts at month 0
  else if (formed && /^\d{4}-\d{2}-\d{2}$/.test(formed)) {
    const a = new Date(formed + "T12:00:00Z"), b = new Date(now);
    ageMonths = Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0));
  } else if (Number.isFinite(existing?.ageMonths)) ageMonths = existing.ageMonths;
  const name = plan?.name || existing?.name || null;
  const key = (v) => String(v || "").trim().toLowerCase();
  const listed = (Array.isArray(fundabilityNow?.businesses) ? fundabilityNow.businesses : [])
    .find((b) => (plan?.businessId && b.business_id === plan.businessId) || (name && key(b.name) === key(name))) || null;
  if (listed && Number.isFinite(listed.age_months)) ageMonths = listed.age_months;
  return { name, ageMonths, listed };
}

/**
 * businessUnlockFor({ fundabilityNow, businessPoint, businessPlans, now }) → the
 * UnderwriteIQ estimate for the first business: the SAME number the Fundability
 * read prints for that business slice. A business the Fundability read lists
 * keeps its own funding_estimate_cents; a planned one is sized by that file's own
 * businessRead() on the personal engine read (readBusinessPoint): the engine's
 * card funding × 0.5 under 12 months, × 1 from 12 to 24, × 2 from 24, only while
 * the personal file is fundable. One business, on its own; businesses are never
 * added together. Null when the Fundability read gives no amount.
 */
export function businessUnlockFor({ fundabilityNow = null, businessPoint = null, businessPlans = null, now = new Date() } = {}) {
  if (!fundabilityNow) return null;
  const first = firstBusiness({ fundabilityNow, businessPlans, now });
  if (!first || first.ageMonths === null) return null;
  const { name, ageMonths, listed } = first;
  let cents = null;
  if (listed) cents = listed.estimate_cents;
  else if (businessPoint && businessPoint.uw) cents = businessRead(businessPoint, { row: null, name, source: "blueprint" }, ageMonths).funding_estimate_cents;
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  const multiplier = businessAgeMultiplier(ageMonths);
  const uw = businessPoint?.uw;
  const card = Number(uw?.per_bureau?.[uw?.primary_bureau]?.cardFunding);
  const ageWords = multiplier === 0.5 ? "while the business is under 12 months old" : multiplier === 1 ? "while the business is 12 to 24 months old" : "once the business is 24 months or older";
  return { name, cardFundingCents: !listed && Number.isFinite(card) && card > 0 ? Math.round(card * 100) : null, multiplier, ageMonths, ageWords, cents };
}

/**
 * readBlueprintPath(db, scope, inputs) → the `path` payload.
 * inputs: progress, bankPlan, businessPlans, opportunity, utilization,
 *         newestCredit { row, analysis } | null, firstCreditRow | null,
 *         readConnectedCash (injectable; defaults to the Money overview read),
 *         readFundability (injectable; defaults to src/finance/fundability.mjs),
 *         readPoint (injectable; defaults to readBusinessPoint, read only when
 *           the first business is not yet on the Fundability read),
 *         runEngine, readEngineImpl (injectable for tests).
 */
export async function readBlueprintPath(db, { orgId, clientId, now = new Date() } = {}, {
  progress = null, bankPlan = null, businessPlans = null, opportunity = null, utilization = null,
  newestCredit = null, firstCreditRow = null,
  readConnectedCash = readConnectedPersonalCash, readFundability = readFundabilityNow, readPoint = readBusinessPoint,
  runEngine = runTierEngineFromCrsResult, readEngineImpl = readEngine
} = {}) {
  const [uploads, connectedPersonal, fundabilityNow] = await Promise.all([
    db.query(CHEXSYSTEMS_UPLOADS_SQL, [clientId, orgId]).then((r) => (r.rows || [])
      .filter((d) => d.subtype === CHEXSYSTEMS_UPLOAD_SUBTYPE)
      .map((d) => ({ documentId: String(d.id), filename: d.filename || d.title || null,
        receivedAt: iso(d.generated_at), review: d.review_status || null })))
      .catch(() => []),
    Promise.resolve().then(() => readConnectedCash(db, { orgId, clientId, asOf: now })).catch(() => null),
    Promise.resolve().then(() => readFundability(db, { orgId, clientId, asOf: now })).catch(() => null)
  ]);
  let credit = null;
  if (newestCredit?.row) {
    const newest = measurePull(newestCredit.row, { analysis: newestCredit.analysis, runEngine, readEngineImpl });
    const sameRow = !firstCreditRow || String(firstCreditRow.id) === String(newestCredit.row.id);
    const baseline = sameRow ? newest : measurePull(firstCreditRow, { runEngine, readEngineImpl });
    credit = { baseline, newest };
  }
  /* A planned business is not on the Fundability read yet: size it from the
     same personal engine read (one more read, only then). */
  const first = fundabilityNow ? firstBusiness({ fundabilityNow, businessPlans, now }) : null;
  const businessPoint = first && !first.listed && first.ageMonths !== null
    ? await Promise.resolve().then(() => readPoint(db, { orgId, clientId })).catch(() => null)
    : null;
  return buildBlueprintPath({ progress, bankPlan, businessPlans, opportunity, utilization, credit, fundabilityNow,
    businesses: businessChecklist(businessPlans),
    businessUnlock: businessUnlockFor({ fundabilityNow, businessPoint, businessPlans, now }),
    connectedPersonal, chexUploads: uploads });
}
