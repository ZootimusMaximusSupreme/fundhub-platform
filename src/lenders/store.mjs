/* DB access for lenders + bureau observations. */

import { INLINE_EDIT_FIELDS, LENDER_CSV_COLUMNS, isLenderTable } from "./tables.mjs";
import { isTipRow } from "./tips.mjs";
import { buildObservation } from "./observations.mjs";
import { parseLenderCsv, serializeLenderCsv } from "./csv.mjs";
import {
  matchLenders,
  resolveMatchState,
  resolveMatchStates,
  resolveCreditProfile
} from "./match.mjs";
/* THE TWO READS THE DESK AND THE BANK MATCH USE live in src/pulse/beats/lib/lenders-truth.mjs
   (2026-10-20): listLenders, matchForClient, publicLender and the column list. The hourly beat
   lender-book runs the same reads (a beat may import only from the beat library). One copy; re-exported
   below so every caller imports from here as before. */
import {
  MAX_LENDER_ROWS,
  SELECT_COLS,
  listLenders,
  matchForClient,
  publicLender
} from "../pulse/beats/lib/lenders-truth.mjs";

export { listLenders, matchForClient };

export async function getLender(db, { orgId, id }) {
  const r = await db.query(
    `SELECT ${SELECT_COLS} FROM lenders WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, id]
  );
  return publicLender(r.rows[0] || null);
}

function stamp(staff) {
  const by = (staff && (staff.name || staff.email || staff.id)) || "system";
  const date = new Date().toISOString().slice(0, 10);
  return { last_updated_by: String(by).slice(0, 200), last_updated_date: date };
}

const WRITABLE = new Set([
  ...LENDER_CSV_COLUMNS.filter((c) => c !== "lender_table"),
  "lender_table",
  "logo_path",
  ...INLINE_EDIT_FIELDS
]);

/**
 * Partial update — auto-stamps last_updated_*.
 */
export async function updateLender(db, { orgId, id, patch, staff }) {
  const meta = stamp(staff);
  const sets = [];
  const params = [orgId, id];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!WRITABLE.has(k)) continue;
    if (k === "lender_table" && !isLenderTable(v)) continue;
    params.push(v);
    const cast = k === "lender_table" ? "::lender_table" : "";
    sets.push(`${k} = $${params.length}${cast}`);
  }
  if (!sets.length) return getLender(db, { orgId, id });
  params.push(meta.last_updated_by);
  sets.push(`last_updated_by = $${params.length}`);
  params.push(meta.last_updated_date);
  sets.push(`last_updated_date = $${params.length}::date`);
  const r = await db.query(
    `UPDATE lenders SET ${sets.join(", ")}
      WHERE org_id = $1::uuid AND id = $2::uuid
      RETURNING ${SELECT_COLS}`,
    params
  );
  return publicLender(r.rows[0] || null);
}

export async function createLender(db, { orgId, row, staff }) {
  if (!isLenderTable(row?.lender_table)) {
    const err = new Error("invalid_lender_table");
    err.code = "invalid_lender_table";
    throw err;
  }
  const name = String(row?.name || "").trim();
  if (!name) {
    const err = new Error("name_required");
    err.code = "name_required";
    throw err;
  }
  const meta = stamp(staff);
  const cols = ["org_id", "lender_table", "name", "last_updated_by", "last_updated_date"];
  const vals = [orgId, row.lender_table, name, meta.last_updated_by, meta.last_updated_date];
  for (const k of LENDER_CSV_COLUMNS) {
    if (k === "lender_table" || k === "name") continue;
    if (row[k] === undefined) continue;
    cols.push(k);
    vals.push(row[k]);
  }
  if (row.logo_path !== undefined && !cols.includes("logo_path")) {
    cols.push("logo_path");
    vals.push(row.logo_path);
  }
  const placeholders = vals.map((_, i) => {
    const col = cols[i];
    if (col === "org_id") return `$${i + 1}::uuid`;
    if (col === "lender_table") return `$${i + 1}::lender_table`;
    if (col === "last_updated_date") return `$${i + 1}::date`;
    return `$${i + 1}`;
  });
  const r = await db.query(
    `INSERT INTO lenders (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING ${SELECT_COLS}`,
    vals
  );
  return publicLender(r.rows[0]);
}

/**
 * Upsert by (org_id, external_row_id) when present, else insert.
 * @returns {{ imported: number, updated: number, errors: string[] }}
 */
export async function importLendersCsv(db, { orgId, text, staff, logoByExternalId = null }) {
  const { rows, errors } = parseLenderCsv(text);
  let imported = 0;
  let updated = 0;
  let skipped_tips = 0;
  for (const row of rows) {
    if (isTipRow(row.name)) {
      skipped_tips++;
      continue;
    }
    try {
      const logoPath = logoByExternalId && row.external_row_id
        ? logoByExternalId[row.external_row_id]
        : undefined;
      const payload = logoPath ? { ...row, logo_path: logoPath } : row;
      if (row.external_row_id) {
        const existing = await db.query(
          `SELECT id FROM lenders
            WHERE org_id = $1::uuid AND external_row_id = $2
            LIMIT 1`,
          [orgId, row.external_row_id]
        );
        if (existing.rows[0]) {
          // Blank CSV cells mean unknown, not a staff-authorized deletion.
          // Preserve existing Apply URLs and inactive state on partial imports.
          // Staff may still clear a URL intentionally with updateLender.
          const patch = { ...payload };
          if (patch.application_url == null) delete patch.application_url;
          if (patch.active == null) delete patch.active;
          await updateLender(db, {
            orgId,
            id: existing.rows[0].id,
            patch,
            staff
          });
          updated++;
          continue;
        }
      }
      await createLender(db, { orgId, row: { ...payload, active: payload.active ?? true }, staff });
      imported++;
    } catch (e) {
      errors.push(`${row.name}: ${e.message || e.code || "failed"}`);
    }
  }
  return { imported, updated, errors, parsed: rows.length, skipped_tips };
}

export async function exportLendersCsv(db, { orgId, ...filters }) {
  const rows = await listLenders(db, { orgId, ...filters, limit: MAX_LENDER_ROWS, forExport: true });
  return serializeLenderCsv(rows);
}

export async function logObservation(db, { orgId, input, staff }) {
  // Fill expected from lender row when not supplied.
  let expected = input.expected_bureaus_raw;
  let lenderName = input.lender_name;
  let lenderTable = input.lender_table;
  if (input.lender_row_id && (expected == null || !lenderName)) {
    const L = await getLender(db, { orgId, id: input.lender_row_id });
    if (L) {
      if (expected == null) expected = L.bureaus_pulled;
      if (!lenderName) lenderName = L.name;
      if (!lenderTable) lenderTable = L.lender_table;
    }
  }
  const row = buildObservation({
    ...input,
    expected_bureaus_raw: expected,
    lender_name: lenderName,
    lender_table: lenderTable,
    created_by: (staff && (staff.name || staff.email || staff.id)) || null
  });
  const r = await db.query(
    `INSERT INTO lender_bureau_observations (
       org_id, application_id, client_id, funding_round_id,
       lender_name, lender_table, lender_row_id, expected_bureaus_raw,
       observed_bureau, observation_source, mismatch_flag, review_status,
       notes, created_by
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       $5, $6::lender_table, $7::uuid, $8,
       $9, $10, $11, $12::lender_observation_review_status,
       $13, $14
     ) RETURNING *`,
    [
      orgId,
      row.application_id,
      row.client_id,
      row.funding_round_id,
      row.lender_name,
      row.lender_table,
      row.lender_row_id,
      row.expected_bureaus_raw,
      row.observed_bureau,
      row.observation_source,
      row.mismatch_flag,
      row.review_status,
      row.notes,
      row.created_by
    ]
  );
  return r.rows[0];
}

export async function listObservations(db, {
  orgId,
  mismatch_only = false,
  review_status = "pending",
  limit = 100,
  offset = 0
} = {}) {
  const params = [orgId];
  const where = ["org_id = $1::uuid"];
  if (mismatch_only) where.push("mismatch_flag = true");
  if (review_status) {
    params.push(review_status);
    where.push(`review_status = $${params.length}::lender_observation_review_status`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  params.push(Math.max(Number(offset) || 0, 0));
  const r = await db.query(
    `SELECT *
       FROM lender_bureau_observations
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return r.rows;
}

export async function reviewObservation(db, { orgId, id, review_status, notes, staff }) {
  const params = [orgId, id, review_status];
  let sql = `UPDATE lender_bureau_observations
                SET review_status = $3::lender_observation_review_status`;
  if (notes != null) {
    params.push(notes);
    sql += `, notes = $${params.length}`;
  }
  if (staff) {
    params.push(String(staff.name || staff.email || staff.id || "").slice(0, 200));
    sql += `, created_by = COALESCE(created_by, $${params.length})`;
  }
  sql += ` WHERE org_id = $1::uuid AND id = $2::uuid RETURNING *`;
  const r = await db.query(sql, params);
  return r.rows[0] || null;
}

export {
  matchLenders,
  resolveMatchState,
  resolveMatchStates,
  resolveCreditProfile,
  publicLender
};
