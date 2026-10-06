// /api/marketing/script — one script, with every version and its check results.
//
// Route key "marketing/script" (netlify/functions/api.mjs ROUTES; the key is
// this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §7.8; shape docs/specs/marketing-machine-api.md §6.2 (fixed shape 3).
//
//   GET ?id=<uuid>  → 200 {script:S, versions:[S]}
//       script    the version `id` names (live or replaced)
//       versions  every version of the same script (same root_script_id),
//                 newest first, the live one included
//       400 {error:'invalid', field:'id', message}   id missing or not a uuid
//       404 {error:'not_found', message}              not in this company, an
//           imported row, or a script of a batch that is not released yet
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). Read inside one asStaff()
// transaction (staffRead): ad_scripts forces partner row security.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import {
  staffRead, sendKnownError, sendNotReady, hasCompany, InvalidError, NotFoundError
} from "../../src/marketing/http.mjs";
import { getScriptWithVersions, scriptView } from "../../src/marketing/scripts-store.mjs";

export const ROUTE = "marketing/script";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read one script." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each
  // route's gate from the route's own source.
  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const id = req.query ? req.query.id : undefined;
    if (!isUuid(id)) throw new InvalidError("id", "id must be the script's id (a uuid).");
    const found = await staffRead(database, (tx) => getScriptWithVersions(tx, { orgId, id: String(id) }));
    if (!found) throw new NotFoundError("That script was not found.");
    return res.status(200).json({ script: scriptView(found.row), versions: found.versions.map(scriptView) });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Scripts")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
