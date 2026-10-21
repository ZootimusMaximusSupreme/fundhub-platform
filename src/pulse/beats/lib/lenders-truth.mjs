// The lender book and the bank match, and the two checks that judge them. Read only.
//
// ONE READ, TWO CLOCKS (2026-10-20). Three things moved here unchanged, so the morning lane and the
// hourly beat lender-book run the same code (a beat may import only from src/pulse/beats/lib):
//
//   listLenders, matchForClient, publicLender, SELECT_COLS, MAX_LENDER_ROWS
//       used to be src/lenders/store.mjs. The desk list (GET /api/read/lenders), the client control
//       panel's bank match (GET /api/read/lender-matches), the round planner and the sales cockpit read
//       them. src/lenders/store.mjs imports them back and re-exports them; every caller is unchanged.
//   LENDER_LOGO_PLACEHOLDER, logoPathOrPlaceholder
//       used to be src/lenders/resolve-logo.mjs, which re-exports them.
//   crm-data:lenders, crm-data:lender-matches (checkLenders, checkLenderMatches, LENDER_COUNT_SQL,
//   readLenderCount), the client pick every record read shares (CLIENT_PICK_SQL, pickRecordClient,
//   noClientRow, UUID_RE), and the lane's row helpers (row, clip, errText, one, RECON)
//       used to be src/pulse/coverage/gap-crm-links.mjs, which imports them back.
//
// readLenderBook, at the bottom, is the hourly beat's read: the same pieces, in the lane's order.
//
// The pure matcher is ./lender-match.mjs and the credit-file readers are ./lenders-credit.mjs (both
// moved here the same day). Every statement below is a SELECT. Nothing is written.

import { isLenderTable } from "./lender-tables.mjs";
import { matchLenders, resolveCreditProfile, resolveMatchStates } from "./lender-match.mjs";
import { orgDemoModeEnabled } from "./org-demo-mode.mjs";
import { triMerge, utilisation } from "./lenders-credit.mjs";

export const CHECK_IDS = Object.freeze(["crm-data:lenders", "crm-data:lender-matches"]);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── the lender reads (from src/lenders/store.mjs) ── */

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

/* The book is past a thousand rows. A 500 cap cut the desk list and the CSV
   export off part way down the alphabet, so banks that exist read as missing. */
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

/**
 * @param {{ query: Function }} db  a pool, a client, or the pulse read box
 * @param {object} filters
 */
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

/* ── the logo placeholder (from src/lenders/resolve-logo.mjs) ── */

export const LENDER_LOGO_PLACEHOLDER = "/assets/lenders/placeholder.svg";

/**
 * A lender with no local mark gets the placeholder tile, never an empty box.
 * @param {string|null|undefined} logoPath
 * @returns {string}
 */
export function logoPathOrPlaceholder(logoPath) {
  const s = logoPath == null ? "" : String(logoPath).trim();
  return s || LENDER_LOGO_PLACEHOLDER;
}

/**
 * Round-planning match for one client.
 */
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

/** crs_results.result is jsonb, but a text column shows up as a string here. */
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

/* ── the two checks (from src/pulse/coverage/gap-crm-links.mjs) ── */

export const RECON = "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse.";

export function clip(s, n = 400) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

export function row(id, status, detail, suggestedFix = null) {
  return {
    id,
    status,
    detail: clip(detail, 500),
    suggestedFix: suggestedFix ? clip(suggestedFix, 300) : null
  };
}

export function errText(err) {
  return clip(err && err.message ? err.message : err, 140);
}

export async function one(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && out.rows && out.rows[0]) || {};
}

export const LENDER_COUNT_SQL = `
  /* gap:crm-lender-count */
  SELECT count(*)::int AS n
    FROM lenders
   WHERE org_id = $1::uuid
     AND COALESCE(is_demo, false) = false
`;

export const CLIENT_PICK_SQL = `
  /* gap:crm-client */
  SELECT id::text AS id
    FROM clients
   WHERE org_id = $1::uuid
     AND COALESCE(is_demo, false) = false
   ORDER BY created_at DESC
   LIMIT 1
`;

export async function checkLenders(db, readers, orgId) {
  const id = "crm-data:lenders";
  try {
    const count = Number((await one((fn) => fn(db), LENDER_COUNT_SQL, [orgId])).n);
    const list = await readers.listLenders(db, { orgId, limit: 5 });
    if (!Array.isArray(list)) {
      return row(id, "FAIL", "the bank list read did not return a list", `Open Lenders. Restore listLenders. ${RECON}`);
    }
    if (!Number.isFinite(count) || count === 0) {
      return row(
        id,
        "FAIL",
        "the bank book is empty, so the client control panel has no bank to open",
        `Load the lender book on Lenders. ${RECON}`
      );
    }
    if (list.length === 0) {
      return row(
        id,
        "FAIL",
        `${count} banks are on file and the bank list read came back empty`,
        `Open Lenders from the client control panel. The list should show. ${RECON}`
      );
    }
    return row(id, "PASS", `${count} banks on file and the bank list read returned banks`);
  } catch (err) {
    return row(id, "FAIL", `the bank list read threw: ${errText(err)}`, `Open Lenders. Restore the bank list read. ${RECON}`);
  }
}

export async function checkLenderMatches(db, readers, orgId, clientId, lenderCount) {
  const id = "crm-data:lender-matches";
  try {
    const result = await readers.matchForClient(db, { orgId, clientId });
    if (!result || !result.summary || !Array.isArray(result.matches)) {
      return row(
        id,
        "FAIL",
        result ? "the bank match read did not return a match list for a client on file" : "a client is on file and the bank match read says there is no such client",
        `Open the client control panel. Restore the bank match read. ${RECON}`
      );
    }
    const book = result.summary.lender_count;
    if (lenderCount > 0 && Number(book) === 0) {
      return row(
        id,
        "FAIL",
        "banks are on file but the client match read says the bank book is empty",
        `Open Lenders and the client control panel. The bank list should show. ${RECON}`
      );
    }
    const n = result.summary.match_count == null ? result.matches.length : result.summary.match_count;
    return row(id, "PASS", `the bank match read answered for a client on file with ${n} matches`);
  } catch (err) {
    return row(id, "FAIL", `the bank match read threw: ${errText(err)}`, `Open the client control panel. Restore the bank match read. ${RECON}`);
  }
}

/* ── the client pick and the count the match check holds against (from gap-crm-links.mjs gapChecks) ── */

/** The newest real client, the one every record read runs for. A failed read is pickError, not a throw. */
export async function pickRecordClient(db, orgId) {
  let clientId = null;
  let pickError = null;
  try {
    const picked = await one((fn) => fn(db), CLIENT_PICK_SQL, [orgId]);
    clientId = UUID_RE.test(String(picked.id || "")) ? String(picked.id) : null;
  } catch (err) {
    pickError = errText(err);
  }
  return { clientId, pickError };
}

/** The row a client read gives when there is no client to read for: skip when none, red when the pick failed. */
export function noClientRow(idName, pickError) {
  const why = pickError ? `could not pick a client (${pickError})` : "no client on file — the record reads were not run";
  const status = pickError ? "FAIL" : "skip";
  const fix = pickError ? `Read the clients table. ${RECON}` : null;
  return row(idName, status, why, fix);
}

/** Banks on file, for the match check. A failed read counts as 0, so the match check cannot go red on it. */
export async function readLenderCount(db, orgId) {
  let lenderCount = 0;
  try {
    lenderCount = Number((await one((fn) => fn(db), LENDER_COUNT_SQL, [orgId])).n) || 0;
  } catch {
    lenderCount = 0;
  }
  return lenderCount;
}

/* ── the hourly beat's read: the two checks, in the lane's order, with the lane's own pick ── */

/**
 * crm-data:lenders and crm-data:lender-matches, exactly as gap-crm-links.mjs runs them: the book check,
 * then the newest real client, then the match check held against the banks on file. `db` answers
 * query(sql, params) with { rows }; `readers` defaults to the real lender reads in this file.
 */
export async function readLenderBook({ db, orgId, readers = { listLenders, matchForClient } } = {}) {
  const lenders = await checkLenders(db, readers, orgId);
  const { clientId, pickError } = await pickRecordClient(db, orgId);
  if (!clientId) return [lenders, noClientRow("crm-data:lender-matches", pickError)];
  const lenderCount = await readLenderCount(db, orgId);
  return [lenders, await checkLenderMatches(db, readers, orgId, clientId, lenderCount)];
}
