// lender-store: the two lender readers the hourly beat lender-book hands to the shared lender checks.
//
// WHY A COPY. The morning lane (src/pulse/coverage/gap-crm-links.mjs) runs crm-data:lenders and
// crm-data:lender-matches with the real readers, listLenders and matchForClient in src/lenders/store.mjs.
// A file under src/pulse/beats/lib may import only from this folder, so the hourly beat cannot load
// store.mjs. This file is those two readers and everything they call, copied word for word:
//
//   orgDemoModeEnabled                                     src/demo/exclude-demo.mjs
//   LENDER_LOGO_PLACEHOLDER, logoPathOrPlaceholder         src/lenders/resolve-logo.mjs
//   asArray, asInt, pickCreditScore                        src/finance/crs-map.mjs
//   FICO_MIN, FICO_MAX, FICO_MODEL, ficoOf, scoresFromResult, ficoFromBureau, isSampleResult,
//   triMerge, latestWithScores, byNewest, safeObject, num,
//   UTILISATION_BANDS, utilisation                         src/http/client-detail.mjs
//   SELECT_COLS, MAX_LENDER_ROWS, publicLender, listLenders,
//   matchForClient, safeResult                             src/lenders/store.mjs
//   matchLenders, resolveMatchStates, resolveCreditProfile ./lender-match.mjs (whole copy of src/lenders/match.mjs)
//   isLenderTable                                          ./lender-tables.mjs (whole copy of src/lenders/tables.mjs)
//
// THE ORIGINALS STAY WHERE THEY ARE and every other caller keeps using them. Each block below is the
// original's text from its first line to its closing line, unchanged (only "export" may differ).
// lender-store.test.mjs reads every original and fails on any difference, fails if this file grows a
// declaration that is not on that list, and runs the real readers and these copies on the same rows and
// compares the answers. When an original changes, copy the named block over again.
//
// READ ONLY. Every query is a SELECT handed to db.query; the beat's db is the read box (ctx.read).
// No fetch, no clock of its own beyond what the originals use, no write.

import { matchLenders, resolveMatchStates, resolveCreditProfile } from "./lender-match.mjs";
import { isLenderTable } from "./lender-tables.mjs";

// ---------------- from src/demo/exclude-demo.mjs ----------------

export async function orgDemoModeEnabled(db, orgId) {
  if (!orgId) return false;
  const r = await db.query(`SELECT demo_mode_enabled FROM orgs WHERE id = $1`, [orgId]);
  return r.rows[0]?.demo_mode_enabled === true;
}

// ---------------- from src/lenders/resolve-logo.mjs ----------------

export const LENDER_LOGO_PLACEHOLDER = "/assets/lenders/placeholder.svg";

export function logoPathOrPlaceholder(logoPath) {
  const s = logoPath == null ? "" : String(logoPath).trim();
  return s || LENDER_LOGO_PLACEHOLDER;
}

// ---------------- from src/finance/crs-map.mjs ----------------

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function asInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).trim());
  return Number.isInteger(n) ? n : null;
}

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

// ---------------- from src/http/client-detail.mjs ----------------

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

export function isSampleResult(result) {
  const r = safeObject(result);
  if (!r || typeof r !== "object") return false;
  return r.simulated === true || String(r.environment || "").toLowerCase() === "simulated";
}

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

function byNewest(a, b) {
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

function safeObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

// ---------------- from src/lenders/store.mjs ----------------

export const SELECT_COLS = `
  id, org_id, lender_table, name, product_name, logo_path, application_url, lender_row_url,
  eligible_states,
  bureaus_pulled, business_bureau_pulled, double_pull, multiple_llc_allowed,
  stated_requirements, docs_requested, application_method, approval_speed,
  typical_approval_range, average_starting_loc, max_known_loc, apr_terms,
  repayment_terms, draw_period_renewal, relationship_required,
  deposit_balance_impact, known_friendly_states, insider_tips, priority_tier,
  last_updated_by, last_updated_date, notes, active, branch_location_info,
  prequal_soft_pull, intro_offers, requires_account_opening, minimum_deposit,
  underwriter_interaction, relationship_manager, documentation_required,
  minimum_time_in_business_years, minimum_revenue_threshold, collateral_required,
  renewal_terms, loan_type, apr_range_pct, repayment_terms_months, funding_speed,
  loc_type, external_row_id, created_at, updated_at, is_demo
`;

export const MAX_LENDER_ROWS = 5000;

export function publicLender(row) {
  if (!row) return null;
  const out = { ...row };
  for (const k of [
    "typical_approval_range", "average_starting_loc", "max_known_loc",
    "minimum_deposit", "minimum_revenue_threshold", "apr_range_pct",
    "minimum_time_in_business_years"
  ]) {
    if (out[k] != null) out[k] = Number(out[k]);
  }
  if (out.priority_tier != null) out.priority_tier = Number(out.priority_tier);
  out.active = out.active !== false;
  out.is_demo = !!out.is_demo;
  if (out.is_demo && out.name && !String(out.name).startsWith("DEMO")) out.name = "DEMO · " + out.name;
  out.logo_path = logoPathOrPlaceholder(out.logo_path);
  return out;
}

export async function listLenders(db, {
  orgId,
  lender_table = null,
  bureau = null,
  priority_tier = null,
  active = null,
  state = null,
  q = null,
  limit = MAX_LENDER_ROWS,
  offset = 0,
  includeDemo = null,
  forExport = false
} = {}) {
  const params = [orgId];
  const where = ["org_id = $1::uuid"];
  if (lender_table && isLenderTable(lender_table)) {
    params.push(lender_table);
    where.push(`lender_table = $${params.length}::lender_table`);
  }
  if (priority_tier != null && priority_tier !== "") {
    params.push(Number(priority_tier));
    where.push(`priority_tier = $${params.length}`);
  }
  if (active === true || active === false || active === "true" || active === "false") {
    params.push(active === true || active === "true");
    where.push(`active = $${params.length}`);
  }
  if (bureau) {
    params.push(`%${String(bureau).trim()}%`);
    where.push(`bureaus_pulled ILIKE $${params.length}`);
  }
  if (state) {
    params.push(`%${String(state).trim()}%`);
    where.push(`(eligible_states ILIKE $${params.length} OR eligible_states IS NULL OR btrim(eligible_states) = '' OR btrim(eligible_states) ~* '^all(\\s+states)?$' OR btrim(eligible_states) = '*')`);
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`(name ILIKE $${params.length} OR notes ILIKE $${params.length})`);
  }
  const demoOn = forExport ? false : (includeDemo == null ? await orgDemoModeEnabled(db, orgId) : !!includeDemo);
  if (!demoOn) where.push("COALESCE(is_demo, false) = false");
  params.push(Math.min(Math.max(Number(limit) || MAX_LENDER_ROWS, 1), MAX_LENDER_ROWS));
  params.push(Math.max(Number(offset) || 0, 0));
  const sql = `
    SELECT ${SELECT_COLS}
      FROM lenders
     WHERE ${where.join(" AND ")}
     ORDER BY priority_tier NULLS LAST, lower(name), id
     LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const r = await db.query(sql, params);
  return r.rows.map(publicLender);
}

export async function matchForClient(db, {
  orgId,
  clientId,
  lenderTable = null,
  recentInquiryDays = 30
} = {}) {
  const clientR = await db.query(
    `SELECT id, custom_fields
       FROM clients
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, clientId]
  );
  const client = clientR.rows[0];
  if (!client) return null;

  const cf = client.custom_fields || {};
  const bizR = await db.query(
    `SELECT entity_data
       FROM businesses
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at ASC`,
    [orgId, clientId]
  );
  /* THE HOME ADDRESS. The soft-pull consent form asks for the client's own
     current street address ("Enter your current street address, city, state,
     and ZIP") and api/soft-pull-approve.mjs stores it on
     pii_identity.addresses. That is the only place a personal state is held,
     and without it an Arizona client with a Florida business reads as Florida
     only. Same direct read src/inquiry-ops/call-scheduler.mjs already does for
     the dispute return address — the state alone, no SSN and no reveal. */
  let identityAddresses = [];
  try {
    const idR = await db.query(
      `SELECT addresses
         FROM pii_identity
        WHERE org_id = $1::uuid AND client_id = $2::uuid
        LIMIT 1`,
      [orgId, clientId]
    );
    const raw = idR.rows[0]?.addresses;
    identityAddresses = Array.isArray(raw)
      ? raw
      : (typeof raw === "string" ? JSON.parse(raw || "[]") : []);
  } catch {
    /* No identity row, or the column is unreadable. Unknown stays unknown:
       the home lane is simply empty, and an unknown state blocks nobody. */
    identityAddresses = [];
  }

  const { home, business, states } = resolveMatchStates(cf, bizR.rows, identityAddresses);

  /* THE CREDIT FILE (funding finding 7). Five rows, not one: triMerge walks
     back past sandbox fixtures and past pulls that carried no score, so
     handing it only the newest row returns nothing whenever the newest row is
     one of those. Same extraction the closer's credit panel uses, so the score
     the matcher screens on is the score on the screen beside it. */
  const crs = await db.query(
    `SELECT result, outcome_tier, created_at
       FROM crs_results
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 5`,
    [orgId, clientId]
  );
  const merged = triMerge(crs.rows);
  const util = utilisation(crs.rows, { custom_fields: cf });
  const newest = crs.rows[0] || null;
  const payload = safeResult(newest && newest.result);
  const credit = resolveCreditProfile({
    scores: { EX: merged.experian, EQ: merged.equifax, TU: merged.transunion },
    utilizationPct: util.percent,
    tier: newest ? newest.outcome_tier : null,
    // Stored estimate, same precedence as tierReasoning(): the CRM field the
    // client was actually quoted wins over the raw engine number.
    fundingEstimate: cf.total_funding_estimate ?? payload.fundingEstimate ?? null,
    pulledAt: merged.asOf || (newest ? newest.created_at : null)
  });

  const inq = await db.query(
    `SELECT bureau, status, created_at
       FROM inquiry_log
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 200`,
    [orgId, clientId]
  );

  // Resolved once and handed to both gates. listLenders would otherwise look
  // it up again, and matchLenders now defaults to excluding demo rows, which
  // would drop them even with Demo Mode on unless it is told.
  const demoMode = await orgDemoModeEnabled(db, orgId);

  const lenders = await listLenders(db, {
    orgId,
    lender_table: lenderTable,
    active: true,
    limit: MAX_LENDER_ROWS,
    includeDemo: demoMode
  });

  const cases = await db.query(
    `SELECT id, selected_bureaus_raw, case_status, gate_override_by, gate_override_at
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND case_status::text = ANY($3::text[])`,
    [orgId, clientId, ["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"]]
  );

  /* IS THERE A COMPANY? Owner rule 2026-09-06: no business on file, no
     business credit cards. Two things count as a business being on file — a
     row in `businesses`, or a business state written on the client record.
     Either one is enough; requiring both would hold back cards from a client
     who does have a company we only half recorded. This is a real false, not
     an unknown: the query above returns every business row this client has,
     so an empty result plus no business state IS "no company". */
  const businessOnFile = bizR.rows.length > 0 || !!business;

  return matchLenders({
    lenders,
    homeState: home,
    businessState: business,
    businessOnFile,
    clientStates: states,
    inquiryLog: inq.rows,
    cases: cases.rows,
    lenderTable,
    recentInquiryDays,
    includeDemo: demoMode,
    credit
  });
}

function safeResult(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
