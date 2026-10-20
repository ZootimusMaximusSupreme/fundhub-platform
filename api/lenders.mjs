// POST /api/lenders — create / inline-save / CSV import for the lender database.
//
// Actions: save | create | import
// Every save stamps last_updated_by / last_updated_date from the session.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import {
  createLender,
  updateLender,
  importLendersCsv,
  getLender
} from "../src/lenders/store.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { INLINE_EDIT_FIELDS, isLenderTable } from "../src/lenders/tables.mjs";

const ACTIONS = new Set(["save", "create", "import"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      message: "Use POST with action save, create, or import."
    });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.LENDERS)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  const action = String(body.action || "").trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({
      ok: false,
      error: "unknown_action",
      message: "Unknown action. Use save, create, or import."
    });
  }

  try {
    if (action === "import") {
      const text = body.csv != null ? String(body.csv) : "";
      if (!text.trim()) {
        return res.status(400).json({
          ok: false,
          error: "csv_required",
          message: "Paste or upload a CSV with lender_table and name columns."
        });
      }
      const result = await importLendersCsv(database, { orgId, text, staff });
      return res.status(200).json({ ok: true, ...result });
    }

    if (action === "create") {
      if (!isLenderTable(body.lender_table)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_lender_table",
          message: "lender_table must be one of the seven lender product names."
        });
      }
      const lender = await createLender(database, { orgId, row: body, staff });
      return res.status(200).json({ ok: true, lender });
    }

    // save
    if (!isUuid(body.id)) {
      return res.status(400).json({
        ok: false,
        error: "id_required",
        message: "Save needs the lender id."
      });
    }
    const patch = {};
    if (body.patch && typeof body.patch === "object") {
      Object.assign(patch, body.patch);
    } else {
      for (const k of INLINE_EDIT_FIELDS) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      for (const k of [
        "name", "application_url", "eligible_states", "business_bureau_pulled",
        "double_pull", "multiple_llc_allowed", "application_method",
        "approval_speed", "apr_terms", "repayment_terms", "draw_period_renewal",
        "relationship_required", "deposit_balance_impact", "known_friendly_states",
        "notes", "lender_table", "typical_approval_range", "average_starting_loc",
        "max_known_loc", "branch_location_info", "prequal_soft_pull", "intro_offers"
      ]) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
    }
    // The screen turns an emptied Name box into null. `lenders.name` is NOT NULL
    // with a non-empty check (db/migrations/138_lenders.sql:60), so refuse both
    // null and blank text in words before either can reach Postgres.
    if (patch.name !== undefined && (patch.name == null || String(patch.name).trim() === "")) {
      return res.status(400).json({
        ok: false,
        error: "name_required",
        message: "Name is required."
      });
    }
    if (patch.active != null) {
      patch.active = patch.active === true || patch.active === "true" || patch.active === 1;
    }
    if (patch.priority_tier != null && patch.priority_tier !== "") {
      patch.priority_tier = Number(patch.priority_tier);
    }

    const lender = await updateLender(database, {
      orgId, id: body.id, patch, staff
    });
    if (!lender) {
      const existing = await getLender(database, { orgId, id: body.id });
      if (!existing) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      // The row is there but the UPDATE changed nothing. Never answer ok:true
      // with lender:null — the screen writes that straight back into its row
      // cache, the row loses its id, and its next Save posts id:"undefined".
      return res.status(409).json({
        ok: false,
        error: "save_failed",
        message: "That lender was not saved. Reload the page and try again."
      });
    }
    return res.status(200).json({ ok: true, lender });
  } catch (err) {
    if (err.code === "invalid_lender_table" || err.code === "name_required") {
      return res.status(400).json({ ok: false, error: err.code, message: err.message });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
