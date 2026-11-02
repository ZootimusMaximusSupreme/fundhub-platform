// GET /api/company-brain/library — browse approved staff instructions.
// The role and company always come from the signed-in session.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { canQueryBrain } from "../../src/company-brain/access.mjs";
import { listLibraryFiles } from "../../src/company-brain/library.mjs";

export default async function handler(req, res, deps = {}) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const database = deps.db || db;
  const staff = deps.requireAuth
    ? await deps.requireAuth(req, res, { db: database })
    : await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
  if (!canQueryBrain(staff.role)) {
    return res.status(403).json({ ok: false, error: "forbidden_role" });
  }
  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });

  const list = deps.listLibraryFiles || listLibraryFiles;
  const result = await list(database, { orgId: staff.org_id, role: staff.role });
  if (!result.ok) return res.status(502).json({ ok: false, error: result.reason || "list_failed" });
  return res.status(200).json({ ok: true, files: result.files });
}
