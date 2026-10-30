// POST /api/setter-dashboard — save checklist, complete handoff, or send.
import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid, ROLE_SETS } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { updateSetterHandoff } from "../src/setter/dashboard.mjs";

const ACTIONS = new Set(["save", "save_survey", "log_dial", "complete", "send_intro_video", "send_handoff"]);

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const database = deps.db ?? db;
  const staff = await requireAuth(req, res, { db: database });
  if (!staff || !requireRole(res, staff, ROLE_SETS.SETTER)) return;
  if (!isUuid(staff.org_id)) return res.status(403).json({ ok: false, error: "forbidden" });
  const input = req.body || {};
  if (!isUuid(input.client_id)) return res.status(400).json({ ok: false, error: "invalid_client_id" });
  if (!ACTIONS.has(input.action)) return res.status(400).json({ ok: false, error: "invalid_action" });
  try {
    const result = await updateSetterHandoff(database, staff, input, deps);
    return res.status(result.status).json(result.body);
  } catch (error) {
    if (dbDown(res, error)) return;
    if (/SETTER_INTRO_VIDEO_URL/.test(String(error?.message || ""))) {
      return res.status(503).json({ ok: false, error: "intro_video_not_configured" });
    }
    if (/closer staff|lead phone/.test(String(error?.message || ""))) {
      return res.status(409).json({ ok: false, error: "setter_send_needs_contact" });
    }
    throw error;
  }
}
