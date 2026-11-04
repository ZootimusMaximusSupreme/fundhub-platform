// POST /api/setter-dashboard — save checklist, complete handoff, or send.
import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid, ROLE_SETS } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { updateSetterHandoff } from "../src/setter/dashboard.mjs";
import { evaluateLeadOffersIq, getOffersIqStatus } from "../src/finance/offersiq.mjs";

const ACTIONS = new Set(["save", "save_survey", "save_address", "log_dial", "undo_dial", "complete", "send_intro_video", "send_handoff", "offersiq_status", "evaluate_offersiq"]);
export const OFFERSIQ_TERMS_URL = "https://fundhub.ai/terms/#offer-matching";
export const OFFERSIQ_CONSENT_VERSION = "offersiq-2026-11-04";

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const database = deps.db ?? db;
  const staff = deps.requireAuth
    ? await deps.requireAuth(req, res, { db: database })
    : await requireAuth(req, res, { db: database });
  if (!staff || !requireRole(res, staff, ROLE_SETS.SETTER)) return;
  if (!isUuid(staff.org_id)) return res.status(403).json({ ok: false, error: "forbidden" });
  const input = req.body || {};
  if (!isUuid(input.client_id)) return res.status(400).json({ ok: false, error: "invalid_client_id" });
  if (!ACTIONS.has(input.action)) return res.status(400).json({ ok: false, error: "invalid_action" });
  if (input.operation_id != null && !isUuid(input.operation_id)) return res.status(400).json({ ok: false, error: "invalid_operation_id" });
  if (input.action === "undo_dial" && !isUuid(input.event_id)) return res.status(400).json({ ok: false, error: "invalid_event_id" });
  if (input.action === "evaluate_offersiq" && !isUuid(input.operation_id)) {
    return res.status(400).json({ ok: false, error: "invalid_operation_id" });
  }
  try {
    if (input.action === "offersiq_status") {
      const result = await (deps.getOffersIqStatus ?? getOffersIqStatus)(database, staff, { clientId: input.client_id }, deps);
      return res.status(result.status).json(result.body);
    }
    if (input.action === "evaluate_offersiq") {
      const result = await (deps.evaluateLeadOffersIq ?? evaluateLeadOffersIq)(database, staff, {
        clientId: input.client_id,
        operationId: input.operation_id,
        consent: {
          accepted: input.consent_accepted === true,
          termsUrl: OFFERSIQ_TERMS_URL,
          consentVersion: OFFERSIQ_CONSENT_VERSION,
          consentTimestamp: new Date().toISOString()
        }
      }, deps);
      return res.status(result.status).json(result.body);
    }
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
