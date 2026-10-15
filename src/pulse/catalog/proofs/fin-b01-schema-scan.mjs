// Reads db/schema and db/migrations and answers "does this table have this column".
// Test tool for the live display checks: a check that names a column the database
// does not have would fail on its first live read, so a test refuses it here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function sqlFiles() {
  return ["db/schema", "db/migrations"].flatMap((dir) => {
    const full = path.join(ROOT, dir);
    return fs.existsSync(full)
      ? fs.readdirSync(full).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(full, f))
      : [];
  });
}

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

// Split the inside of a CREATE TABLE (...) at top-level commas.
function topLevelParts(body) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const c of body) {
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

let CACHE = null;

export function schemaColumns() {
  if (CACHE) return CACHE;
  const tables = new Map();
  const add = (table, col) => {
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table).add(col);
  };
  for (const file of sqlFiles()) {
    const text = stripComments(fs.readFileSync(file, "utf8"));
    const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
    for (let m = create.exec(text); m; m = create.exec(text)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < text.length && depth > 0; i += 1) {
        if (text[i] === "(") depth += 1;
        if (text[i] === ")") depth -= 1;
      }
      for (const part of topLevelParts(text.slice(start, i - 1))) {
        const first = /^\s*"?([a-z_][a-z0-9_]*)"?\s+\S/i.exec(part);
        if (!first) continue;
        if (/^(constraint|primary|unique|check|foreign|exclude|like)$/i.test(first[1])) continue;
        add(m[1].toLowerCase(), first[1].toLowerCase());
      }
    }
    const alter = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?([^;]*);/gi;
    for (let m = alter.exec(text); m; m = alter.exec(text)) {
      const cols = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
      for (let c = cols.exec(m[2]); c; c = cols.exec(m[2])) add(m[1].toLowerCase(), c[1].toLowerCase());
      const ren = /RENAME\s+COLUMN\s+"?[a-z_][a-z0-9_]*"?\s+TO\s+"?([a-z_][a-z0-9_]*)"?/gi;
      for (let c = ren.exec(m[2]); c; c = ren.exec(m[2])) add(m[1].toLowerCase(), c[1].toLowerCase());
    }
  }
  CACHE = tables;
  return tables;
}

/** Returns the list of "table.column" the schema does not have. */
export function missingColumns(columns) {
  const tables = schemaColumns();
  const missing = [];
  for (const { table, column } of columns) {
    if (!table) continue;
    const cols = tables.get(String(table).toLowerCase());
    const root = String(column).split(".")[0].toLowerCase();
    if (!cols) missing.push(`${table} (no such table)`);
    else if (!cols.has(root)) missing.push(`${table}.${root}`);
  }
  return [...new Set(missing)];
}
