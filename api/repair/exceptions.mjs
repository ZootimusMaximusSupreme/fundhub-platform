// /api/repair/exceptions — stalled repair cards + low-confidence parses.
// Owner, admin, and Specialist (inquiry_specialist). Human confirm only.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { SUPER_ROLES } from "../../src/http/middleware/requireRole.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { confirmHeldParse } from "../../src/repair/parse-loop.mjs";

const ALLOWED = new Set(["owner", "admin", "inquiry_specialist", ...SUPER_ROLES]);

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;
  const orgId = principal.orgId;
  const role = principal.role || principal.staffRole;
  if (!orgId || !isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "no_org_on_session" });
  }
  if (!ALLOWED.has(role) && !SUPER_ROLES.has?.(role) && !["owner", "admin"].includes(role)) {
    // SUPER_ROLES may be a Set or array depending on export — fall back
    const superList = SUPER_ROLES instanceof Set ? SUPER_ROLES : new Set(SUPER_ROLES || []);
    if (!superList.has(role) && role !== "owner" && role !== "admin") {
      return res.status(403).json({ ok: false, error: "role_forbidden" });
    }
  }

  if (req.method === "GET") {
    let stalled = [];
    let lowConfidenceParses = [];
    try {
      const s = await db.query(
        `SELECT c.id AS card_id, c.client_id, cl.email, ps.key AS stage_key, c.updated_at
           FROM cards c
           JOIN pipeline_stages ps ON ps.id = c.stage_id
           JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'optimization'
           LEFT JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
             AND cl.custom_fields->>'crm_archived_at' IS NULL
          WHERE c.org_id = $1 AND ps.key = 'stalled'
            AND cl.id IS NOT NULL
          ORDER BY c.updated_at DESC LIMIT 100`,
        [orgId]
      );
      stalled = s.rows;
    } catch { /* tables may not be migrated yet in some envs */ }
    try {
      // Two kinds of parse need a person, and both belong in this one queue.
      //
      // 1. confidence < 0.85 — the reader was unsure.
      // 2. heldForEscalation — the reader was SURE, and wanted to move an item
      //    into R4, which is where the CFPB and state attorney general
      //    complaints the client signs under penalty of perjury get released.
      //    A machine may not make that crossing alone (owner-set 2026-08-28,
      //    enforced in src/metro2/rounds/state.mjs applyItemOutcome).
      //
      // Case 2 is ABOVE the confidence threshold, so the old WHERE clause hid it
      // and nobody would ever have seen it to confirm it.
      const p = await db.query(
        `SELECT id, case_id, client_id, confidence, confirmed, created_at,
                COALESCE(parse_json->>'heldForEscalation', 'false') = 'true' AS held_for_escalation
           FROM dispute_responses
          WHERE org_id = $1 AND COALESCE(confirmed, false) = false
            AND EXISTS (
              SELECT 1 FROM clients active_client
               WHERE active_client.id = dispute_responses.client_id
                 AND active_client.org_id = dispute_responses.org_id
                 AND active_client.custom_fields->>'crm_archived_at' IS NULL
            )
            AND (
              (confidence IS NOT NULL AND confidence < 0.85)
              OR COALESCE(parse_json->>'heldForEscalation', 'false') = 'true'
            )
          ORDER BY created_at DESC LIMIT 100`,
        [orgId]
      );
      lowConfidenceParses = p.rows;
    } catch { /* */ }
    return res.status(200).json({ ok: true, stalled, lowConfidenceParses });
  }

  if (req.method === "POST") {
    let body = {};
    try { body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}"); }
    catch { return res.status(400).json({ ok: false, error: "invalid_json" }); }
    if (body.action === "confirm_parse" && body.responseId) {
      try {
        const result = await confirmHeldParse(db, {
          orgId,
          responseId: body.responseId,
          confirmedBy: principal.staffId || null,
          confirmedOutcomes: body.outcomes || body.confirmedOutcomes || null
        });
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.reason || "confirm_failed" });
        }
        return res.status(200).json({ ok: true, ...result });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e.message || e) });
      }
    }
    return res.status(400).json({ ok: false, error: "unsupported_action" });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}
