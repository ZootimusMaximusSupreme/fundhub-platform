// /api/inquiry — inquiry phone dials for the Specialist desk.
//
// In-repo only. Staff session auth. Postgres cases + PII. Bland via
// src/messaging/providers/bland-voice.mjs and vendor/inquiry-remover prompts.
// No INQUIRY_API_BASE. No external host.
//
//   GET  ?action=cases[&status=]     → open inquiry_removal_cases for this org
//   GET  ?action=status&call_id=     → outbound_calls row
//   POST ?action=launch  body { id | case_id }  → place bureau call
//
// COMPLIANCE REVIEW REQUIRED — bureau dispute phone path.

import { db } from "../src/db.mjs";
import { requireRole } from "../src/http/middleware/requireRole.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { isUuid } from "../src/http/read-api.mjs";
import {
  launchBureauCallForCase,
  BureauCallError
} from "../src/inquiry-ops/bureau-call.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const launch = deps.launchBureauCallForCase ?? launchBureauCallForCase;

  const staff = await requireRole("inquiry_specialist", "admin")(req, res);
  if (!staff) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const action = String(req.query?.action || "").trim().toLowerCase();

  try {
    if (action === "cases") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "method_not_allowed" });
      }
      const status = String(req.query?.status || "").trim();
      const params = [orgId];
      let sql = `
        SELECT id, case_id, client_id, case_status, selected_bureaus_raw,
               call_fired_at, ai_call_status, open_inquiry_count, created_at
          FROM inquiry_removal_cases
         WHERE org_id = $1::uuid`;
      if (status) {
        params.push(status);
        sql += ` AND case_status::text = $2`;
      } else {
        // The Specialist desk is an active-work queue. Completed and canceled
        // cases stay available through the explicit status filter, but do not
        // come back in the default open list.
        sql += ` AND case_status::text NOT IN ('Completed','Canceled')`;
      }
      sql += ` ORDER BY created_at DESC LIMIT 100`;
      const { rows } = await database.query(sql, params);
      return res.status(200).json({ ok: true, cases: rows });
    }

    if (action === "status") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "method_not_allowed" });
      }
      const callId = String(req.query?.call_id || "").trim();
      if (!callId) {
        return res.status(400).json({ ok: false, error: "call_id_required" });
      }
      const { rows } = await database.query(
        `SELECT call_id, client_id, org_id, kind, created_at
           FROM outbound_calls
          WHERE call_id = $1 AND org_id = $2::uuid
          LIMIT 1`,
        [callId, orgId]
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      return res.status(200).json({ ok: true, call: rows[0] });
    }

    if (action === "launch") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "method_not_allowed" });
      }
      const caseId = String(req.body?.id || req.body?.case_id || "").trim();
      if (!isUuid(caseId)) {
        return res.status(400).json({
          ok: false,
          error: "case_id_required",
          message: "Send the inquiry case id to call."
        });
      }
      try {
        const result = await launch(database, {
          orgId,
          caseId,
          staffId: staff.id || staff.email || null,
          env: deps.env || process.env,
          fetchImpl: deps.fetchImpl
        });
        return res.status(200).json({
          ok: true,
          placed: true,
          call_id: result.callId,
          bureau: result.bureau,
          case_id: result.caseId,
          message: `Calling the ${result.bureau} dispute line for this case.`
        });
      } catch (err) {
        if (err instanceof BureauCallError) {
          return res.status(err.status || 400).json({
            ok: false,
            placed: false,
            error: err.code,
            message: err.message
          });
        }
        throw err;
      }
    }

    return res.status(400).json({
      ok: false,
      error: "unknown_action",
      allowed: ["cases", "status", "launch"]
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
