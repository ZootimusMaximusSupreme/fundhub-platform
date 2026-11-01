// GET /api/read/setter-dashboard — human setter queue, newest first.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid, ROLE_SETS } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { listSetterQueue } from "../../src/setter/dashboard.mjs";
import { hasSetterIntroVideo } from "../../src/setter/send-actions.mjs";

export default async function handler(req, res, deps = {}) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const database = deps.db ?? db;
  const staff = await requireAuth(req, res, { db: database });
  if (!staff || !requireRole(res, staff, ROLE_SETS.SETTER)) return;
  if (!isUuid(staff.org_id)) return res.status(403).json({ ok: false, error: "forbidden" });
  if (req.query?.client_id && !isUuid(req.query.client_id)) {
    return res.status(400).json({ ok: false, error: "invalid_client_id" });
  }
  try {
    const data = await listSetterQueue(database, staff, {
      ...(req.query || {}), clientId: req.query?.client_id || null,
      ...(req.query?.client_id ? { limit: 1, offset: 0 } : {})
    });
    return res.status(200).json({ ok: true, ...data, intro_video_available: hasSetterIntroVideo(deps.env ?? process.env) });
  } catch (error) {
    if (dbDown(res, error)) return;
    throw error;
  }
}
