/* Pure CSV parse/serialize for lenders. No invented rows — importer only
   materializes what the file contains. */

import { LENDER_CSV_COLUMNS, isLenderTable } from "./tables.mjs";

const MONEY = new Set([
  "typical_approval_range",
  "average_starting_loc",
  "max_known_loc",
  "minimum_deposit",
  "minimum_revenue_threshold"
]);

const INT = new Set(["priority_tier", "repayment_terms_months"]);
const FLOAT = new Set(["minimum_time_in_business_years", "apr_range_pct"]);
const BOOL = new Set(["active"]);

/* EXPORTED, and it is the only quote-aware CSV splitter in this repo. A second
   one would be the "two functions doing the same thing" bug CLAUDE.md §8 warns
   about — src/autopsy/parse.mjs imports this rather than writing its own.
   Behaviour is unchanged; only the visibility moved. */
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function escapeCsv(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function coerce(col, raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  if (BOOL.has(col)) {
    const lower = s.toLowerCase();
    if (["1", "true", "yes", "y", "active"].includes(lower)) return true;
    if (["0", "false", "no", "n", "inactive"].includes(lower)) return false;
    return null;
  }
  if (INT.has(col) || MONEY.has(col) || FLOAT.has(col)) {
    const n = Number(s.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return s;
}

/**
 * @param {string} text
 * @returns {{ rows: object[], errors: string[] }}
 */
export function parseLenderCsv(text) {
  const errors = [];
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { rows: [], errors: ["CSV is empty."] };

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const unknown = headers.filter((h) => h && !LENDER_CSV_COLUMNS.includes(h));
  if (unknown.length) {
    errors.push(`Unknown columns ignored: ${unknown.join(", ")}`);
  }
  if (!headers.includes("name")) {
    return { rows: [], errors: ["CSV must include a name column."] };
  }
  if (!headers.includes("lender_table")) {
    return { rows: [], errors: ["CSV must include a lender_table column."] };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!LENDER_CSV_COLUMNS.includes(key)) continue;
      row[key] = coerce(key, cells[c]);
    }
    if (!row.name) {
      errors.push(`Row ${i + 1}: missing name — skipped.`);
      continue;
    }
    if (!isLenderTable(row.lender_table)) {
      errors.push(`Row ${i + 1}: invalid lender_table "${row.lender_table}" — skipped.`);
      continue;
    }
    if (row.priority_tier != null && ![1, 2, 3].includes(Number(row.priority_tier))) {
      errors.push(`Row ${i + 1}: priority_tier must be 1, 2, or 3 — cleared.`);
      row.priority_tier = null;
    }
    // Unknown CSV active is not permission to reactivate a disabled lender.
    // New-row import explicitly supplies active=true when no value was given.
    rows.push(row);
  }
  return { rows, errors };
}

/**
 * @param {object[]} rows
 * @returns {string}
 */
export function serializeLenderCsv(rows) {
  const header = LENDER_CSV_COLUMNS.join(",");
  const body = (Array.isArray(rows) ? rows : []).map((r) =>
    LENDER_CSV_COLUMNS.map((col) => {
      let v = r[col];
      if (col === "active") v = v === false ? "false" : "true";
      return escapeCsv(v);
    }).join(",")
  );
  return [header, ...body].join("\n") + (body.length ? "\n" : "");
}
