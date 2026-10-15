// Test kit for the finish-853 batch 14 live checks (Journeys editor and Lenders desk).
//
// A live display check is one read-only SQL text that goes red when a saved result is wrong. This kit
// lets a test RUN that exact text over stand-in rows, with no Postgres on the machine:
//
//   1. schemaColumns() reads the real table and column names from db/schema and db/migrations, so a
//      stand-in table can only hold columns the product really has. A typo in a contract ("no such
//      column") fails the test.
//   2. portableSql() spells the Postgres text for SQLite: $1 becomes ?1, casts and BTRIM are plain,
//      jsonb_array_elements becomes json_each, and the Postgres regular-expression operators (~ and !~)
//      become a regexp() call. jsonb_typeof, jsonb_array_length and regexp_replace are registered as
//      functions with the Postgres answers ('object', 'array', 'string', 'number', 'boolean', 'null'), so a
//      JSON string, a number and a list are told apart the way Postgres tells them apart.
//   3. makeStandIn() builds an in-memory database whose tables hold the real column names.
//
// SQLite does not enforce the product's CHECK constraints or foreign keys, so a stand-in row can hold a
// value the real database would refuse. That is on purpose: it shows a contract still goes red if a
// constraint were ever dropped.
//
// Tests only. Nothing here is imported by the live bundle.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../../..");

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function matchingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      i += 1;
      while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function topLevelParts(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "'") {
      i += 1;
      while (i < body.length && !(body[i] === "'" && body[i + 1] !== "'")) i += body[i] === "'" ? 2 : 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts;
}

const NOT_COLUMN = /^(constraint|primary|unique|foreign|check|exclude|like)\b/i;
const NAME = String.raw`(?:public\.)?"?([a-z_][a-z0-9_]*)"?`;

let SCHEMA = null;

/** table -> Set of column names, from every db/schema and db/migrations file in apply order. */
export function schemaColumns() {
  if (SCHEMA) return SCHEMA;
  const tables = new Map();
  const files = [];
  for (const dir of ["db/schema", "db/migrations"]) {
    const full = path.join(REPO_ROOT, dir);
    for (const name of fs.readdirSync(full).filter((n) => n.endsWith(".sql")).sort()) files.push(path.join(full, name));
  }
  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, "utf8"));
    const create = new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${NAME}\s*\(`, "gi");
    let m;
    while ((m = create.exec(text))) {
      const open = m.index + m[0].length - 1;
      const close = matchingParen(text, open);
      if (close < 0) continue;
      const table = m[1].toLowerCase();
      const cols = tables.get(table) || new Set();
      for (const part of topLevelParts(text.slice(open + 1, close))) {
        const piece = part.trim();
        if (!piece || NOT_COLUMN.test(piece)) continue;
        const col = /^"?([a-z_][a-z0-9_]*)"?/i.exec(piece);
        if (col) cols.add(col[1].toLowerCase());
      }
      tables.set(table, cols);
    }
    const alter = new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${NAME}\s+([^;]*);`, "gi");
    while ((m = alter.exec(text))) {
      const table = m[1].toLowerCase();
      const cols = tables.get(table) || new Set();
      const actions = m[2];
      for (const add of actions.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) cols.add(add[1].toLowerCase());
      for (const drop of actions.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) cols.delete(drop[1].toLowerCase());
      for (const ren of actions.matchAll(/rename\s+column\s+"?([a-z_][a-z0-9_]*)"?\s+to\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
        cols.delete(ren[1].toLowerCase());
        cols.add(ren[2].toLowerCase());
      }
      tables.set(table, cols);
    }
  }
  SCHEMA = tables;
  return tables;
}

const UNIT_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

/** The fixed "now" the stand-in runs at, so a test is the same on every day. */
export const NOW = new Date("2026-10-14T12:00:00.000Z");

/**
 * Turn `<operand> ~ 'pattern'` and `<operand> !~ 'pattern'` into regexp('pattern', <operand>) calls.
 * The operand is a function call (COALESCE(...), BTRIM(...)) or a plain alias.column. The pattern is a
 * single-quoted literal. A `~` left over after this means the contract used a shape this kit cannot run,
 * and the kit throws instead of running something different.
 */
function rewriteRegex(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const negated = ch === "!" && sql[i + 1] === "~";
    if (ch === "~" || negated) {
      // ~* is the case-insensitive match; !~* is its negation.
      const insensitive = sql[i + (negated ? 2 : 1)] === "*";
      const opLen = (negated ? 2 : 1) + (insensitive ? 1 : 0);
      // The right side: whitespace then a quoted literal.
      let r = i + opLen;
      while (/\s/.test(sql[r] || "")) r += 1;
      if (sql[r] !== "'") throw new Error(`regex operator without a quoted pattern near: ${sql.slice(Math.max(0, i - 40), i + 20)}`);
      let rEnd = r + 1;
      while (rEnd < sql.length && !(sql[rEnd] === "'" && sql[rEnd + 1] !== "'")) rEnd += sql[rEnd] === "'" ? 2 : 1;
      const pattern = sql.slice(r, rEnd + 1);
      // The left side: take it back off the text written so far.
      let l = out.length;
      while (l > 0 && /\s/.test(out[l - 1])) l -= 1;
      const operandEnd = l;
      if (out[l - 1] === ")") {
        let depth = 0;
        let k = l - 1;
        for (; k >= 0; k -= 1) {
          if (out[k] === ")") depth += 1;
          else if (out[k] === "(") { depth -= 1; if (depth === 0) break; }
        }
        l = k;
        while (l > 0 && /[A-Za-z0-9_]/.test(out[l - 1])) l -= 1;
      } else {
        while (l > 0 && /[A-Za-z0-9_.]/.test(out[l - 1])) l -= 1;
      }
      const operand = out.slice(l, operandEnd);
      if (!operand) throw new Error(`regex operator without an operand near: ${sql.slice(Math.max(0, i - 40), i + 20)}`);
      out = `${out.slice(0, l)}${negated ? "NOT " : ""}${insensitive ? "regexp_i" : "regexp"}(${pattern}, ${operand})`;
      i = rEnd + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The Postgres text of a contract, spelled for SQLite.
 *   $1 becomes ?1; casts and BTRIM are plain; ILIKE becomes LIKE (SQLite's LIKE ignores case for plain
 *   letters, the same as ILIKE); ~* is a case-insensitive match; now() and "now() - interval 'N units'" become the fixed
 *   ISO instant (every stand-in timestamp is written in the same ISO shape, so string order is time
 *   order); the jsonb functions become their SQLite twins; ~ and !~ become regexp().
 */
export function portableSql(sql, { now = NOW } = {}) {
  const iso = (ms) => `'${new Date(ms).toISOString()}'`;
  const text = sql
    .replace(/\bnow\(\)\s*-\s*interval\s*'(\d+)\s*(minute|hour|day)s?'/gi,
      (_, n, unit) => iso(now.getTime() - Number(n) * UNIT_MS[unit.toLowerCase()]))
    .replace(/\bnow\(\)/gi, iso(now.getTime()))
    .replace(/::[a-z_]+\b(?:\[\])?/gi, "")
    .replace(/\bILIKE\b/g, "LIKE")
    .replace(/\$(\d+)/g, "?$1")
    .replace(/\bBTRIM\s*\(/gi, "TRIM(")
    .replace(/\bjsonb_array_elements\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)\s+AS\s+(\w+)\s*\(\s*value\s*\)/gi, "json_each($1) AS $2");
  const rewritten = rewriteRegex(text);
  if (/[^!]~|!~/.test(rewritten.replace(/'(?:[^']|'')*'/g, "''"))) throw new Error("a regex operator was left in the SQL");
  return rewritten;
}

/** A stand-in database for the named tables. Each table holds the REAL columns of that table, untyped. */
export function makeStandIn(tableNames, { now = NOW } = {}) {
  const schema = schemaColumns();
  const db = new DatabaseSync(":memory:");
  db.function("regexp", { deterministic: true }, (pattern, value) => (new RegExp(String(pattern)).test(String(value ?? "")) ? 1 : 0));
  db.function("regexp_i", { deterministic: true }, (pattern, value) => (new RegExp(String(pattern), "i").test(String(value ?? "")) ? 1 : 0));
  // regexp_replace(text, pattern, replacement[, flags]) with the Postgres flag letters g (all) and i.
  db.function("regexp_replace", { deterministic: true }, (value, pattern, replacement, flags) => {
    if (value === null || value === undefined) return null;
    const letters = String(flags ?? "");
    const js = `${letters.includes("g") ? "g" : ""}${letters.includes("i") ? "i" : ""}`;
    return String(value).replace(new RegExp(String(pattern), js), String(replacement));
  });
  // jsonb_typeof: what Postgres answers for a JSON value. SQLite hands a function the JSON text of an object or a
  // list, the quoted text of a string from "->", a bare number, or the raw text of a string element from
  // json_each. A SQL NULL is a missing key and stays NULL.
  db.function("jsonb_typeof", { deterministic: true }, (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" || typeof value === "bigint") return "number";
    const text = String(value);
    try {
      const parsed = JSON.parse(text);
      if (parsed === null) return "null";
      if (Array.isArray(parsed)) return "array";
      return typeof parsed === "object" ? "object" : typeof parsed;
    } catch {
      return "string";
    }
  });
  db.function("jsonb_array_length", { deterministic: true }, (value) => {
    if (value === null || value === undefined) return null;
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed.length : null;
    } catch {
      return null;
    }
  });
  const known = new Map();
  for (const name of tableNames) {
    const cols = schema.get(name);
    if (!cols || !cols.size) throw new Error(`no such table in db/schema or db/migrations: ${name}`);
    known.set(name, cols);
    db.exec(`CREATE TABLE ${name} (${[...cols].map((c) => `"${c}"`).join(", ")})`);
  }
  return {
    db,
    tables: [...known.keys()],
    insert(table, row) {
      const cols = known.get(table);
      if (!cols) throw new Error(`stand-in has no table ${table}`);
      const keys = Object.keys(row);
      for (const k of keys) if (!cols.has(k)) throw new Error(`${table} has no column ${k} in db/schema or db/migrations`);
      const values = keys.map((k) => {
        const v = row[k];
        if (v === true) return 1;
        if (v === false) return 0;
        if (v !== null && typeof v === "object") return JSON.stringify(v);
        return v === undefined ? null : v;
      });
      db.prepare(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...values);
    },
    /** Run a contract's exact SQL text for one company. Returns { sample_count, bad_count }. */
    run(sql, orgId) {
      const row = db.prepare(portableSql(sql, { now })).get(orgId);
      return { sample_count: Number(row.sample_count), bad_count: Number(row.bad_count) };
    },
    close() { db.close(); }
  };
}

/** Every table name a SQL text reads: the word after FROM or JOIN (CTE names and functions left out). */
export function tablesIn(sql) {
  const text = stripComments(sql);
  const ctes = new Set([...text.matchAll(/\b([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+AS\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const names = new Set();
  for (const m of text.matchAll(/(?<!distinct\s)\b(?:from|join)\s+([a-z_][a-z0-9_]*)\b/gi)) {
    const word = m[1].toLowerCase();
    if (["select", "jsonb_array_elements", "json_each"].includes(word) || ctes.has(word)) continue;
    names.add(word);
  }
  return [...names];
}
