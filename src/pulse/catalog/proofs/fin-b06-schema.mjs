// Offline schema reader for the fin-b06 live checks. There is no local Postgres on the build Mac, so a
// new display check cannot be run against a database here. What it CAN do is prove that every table and
// every column the SQL names really exists in db/schema + db/migrations. A check that names a column that
// does not exist would only ever "skip" on the live server, so this guard is what keeps it honest.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

// Split on semicolons that are not inside a $$ ... $$ body or a quoted string.
function statements(sql) {
  const out = [];
  let depthDollar = false;
  let inQuote = false;
  let cur = "";
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (!inQuote && sql.startsWith("$$", i)) { depthDollar = !depthDollar; cur += "$$"; i += 1; continue; }
    if (!depthDollar && ch === "'") inQuote = !inQuote;
    if (!depthDollar && !inQuote && ch === ";") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function topLevelParts(body) {
  const parts = [];
  let depth = 0;
  let cur = "";
  let inQuote = false;
  for (const ch of body) {
    if (ch === "'") inQuote = !inQuote;
    if (!inQuote && ch === "(") depth += 1;
    if (!inQuote && ch === ")") depth -= 1;
    if (!inQuote && depth === 0 && ch === ",") { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const CONSTRAINT_WORDS = /^(constraint|primary|unique|foreign|check|exclude|like)\b/i;

function tableName(raw) {
  return String(raw).replace(/^public\./i, "").replace(/"/g, "").toLowerCase();
}

// Tables that exist but are not made by a .sql file. db/migrate.mjs creates schema_migrations itself, and the
// app role can read it (src/http/health.mjs does).
const EXTRA_TABLES = Object.freeze({ schema_migrations: Object.freeze(["key", "applied_at"]) });

export function loadSchema(root = ROOT) {
  const tables = new Map();
  for (const [name, columns] of Object.entries(EXTRA_TABLES)) tables.set(name, new Set(columns));
  const dirs = [path.join(root, "db/schema"), path.join(root, "db/migrations")];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) {
      const text = stripComments(fs.readFileSync(path.join(dir, file), "utf8"));
      for (const stmt of statements(text)) {
        const create = /^\s*create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(([\s\S]*)\)\s*(?:partition[\s\S]*)?$/i.exec(stmt);
        if (create) {
          const name = tableName(create[1]);
          const cols = tables.get(name) || new Set();
          for (const part of topLevelParts(create[2])) {
            if (CONSTRAINT_WORDS.test(part)) continue;
            const col = /^"?([a-z_][\w]*)"?\s+\S/i.exec(part);
            if (col) cols.add(col[1].toLowerCase());
          }
          tables.set(name, cols);
          continue;
        }
        const alter = /^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+([\s\S]*)$/i.exec(stmt);
        if (alter) {
          const name = tableName(alter[1]);
          const cols = tables.get(name) || new Set();
          for (const part of topLevelParts(alter[2])) {
            const add = /^add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][\w]*)"?/i.exec(part);
            if (add) cols.add(add[1].toLowerCase());
            const drop = /^drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_][\w]*)"?/i.exec(part);
            if (drop) cols.delete(drop[1].toLowerCase());
            const rename = /^rename\s+column\s+"?([a-z_][\w]*)"?\s+to\s+"?([a-z_][\w]*)"?/i.exec(part);
            if (rename) { cols.delete(rename[1].toLowerCase()); cols.add(rename[2].toLowerCase()); }
          }
          tables.set(name, cols);
        }
      }
    }
  }
  return tables;
}

const KEYWORDS = new Set([
  "left", "right", "inner", "outer", "full", "cross", "join", "on", "where", "group", "order", "limit", "union",
  "lateral", "and", "or", "not", "using", "natural", "filter", "select", "from", "as", "is", "in", "case", "when",
  "then", "else", "end"
]);

/**
 * Every table named after FROM or JOIN must exist, and every alias.column must be a real column of the table
 * that alias stands for. Aliases that stand for a values list or a json element are not checked.
 */
export function schemaProblems(sql, schema = loadSchema()) {
  let text = stripComments(sql).replace(/'(?:[^']|'')*'/g, "''");
  text = text.replace(/\bdistinct\s+from\b/gi, "distinct");
  text = text.replace(/\bextract\s*\(\s*\w+\s+from\b/gi, "extract(x,");
  const aliases = new Map();
  const problems = [];
  const fromRe = /\b(?:from|join)\s+([a-z_][\w.]*)(?![\w.]|\s*\()(?:\s+(?:as\s+)?([a-z_]\w*))?/gi;
  let match;
  while ((match = fromRe.exec(text))) {
    const table = tableName(match[1]);
    const maybeAlias = match[2] && !KEYWORDS.has(match[2].toLowerCase()) ? match[2].toLowerCase() : null;
    const alias = maybeAlias || table;
    if (!schema.has(table)) { problems.push(`table ${table} is not in db/schema or db/migrations`); continue; }
    aliases.set(alias, table);
  }
  const colRe = /\b([a-z_]\w*)\.([a-z_]\w*)\b/gi;
  while ((match = colRe.exec(text))) {
    const alias = match[1].toLowerCase();
    const column = match[2].toLowerCase();
    const table = aliases.get(alias);
    if (!table) continue; // a values list, a json element, or a schema-qualified name
    if (!schema.get(table).has(column)) problems.push(`${table} (${alias}) has no column ${column}`);
  }
  return problems;
}
