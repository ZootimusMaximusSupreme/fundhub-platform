// GET /api/read/eeo-aggregate — bias-audit aggregates only.
//
// COMPLIANCE REVIEW REQUIRED — adverse-impact analysis data (053_eeo_selfid.sql).
//
// NOT under api/hiring/* — hiring endpoints carry applicant PII and the scoring
// trail. This reads v_eeo_aggregate only, which suppresses cells under 5 responses.
// The raw eeo_responses table is never projected here.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { fetchEeoAggregate } from "../../src/hiring/eeo-selfid.mjs";

export const fetchRows = async (db, { limit, offset, query, staff }) => {
  // The caller's company only, from the session — never from the query string.
  const rows = await fetchEeoAggregate(db, { orgId: staff.org_id, roleKey: query.role || null });
  return rows.slice(offset, offset + limit + 1);
};

const run = readHandler({ roles: ROLE_SETS.COMPLIANCE, fetch: fetchRows });

export default (req, res) => run(req, res, { db, requireAuth });
