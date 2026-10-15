// Test kit for the finish-853 batch 07 live checks (tests only; the live bundle never imports it).
//
// A live display check is one read-only SQL text that goes red when a saved result is wrong. There is
// no Postgres on this Mac, so this kit RUNS that exact text against stand-in rows:
//
//   1. schemaColumns() reads the real table and column names from db/schema and db/migrations, so a
//      stand-in table can only hold columns the product really has, and a column typo in a contract
//      is "no such column" instead of a quiet green.
//   2. portableSql() spells the few Postgres-only things (::casts, $1, BTRIM, now() - interval,
//      jsonb ->>) for SQLite. The contracts are written in the common subset on purpose: no regexes,
//      no arrays, no FILTER over windows.
//   3. makeStandIn() builds an in-memory database whose tables hold the real column names.
//
// Nothing here writes to a real database. SQLite is node:sqlite, in memory.

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

/** table name -> Set of column names, from every db/schema and db/migrations file in apply order. */
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
      const cols = tables.get(m[1].toLowerCase()) || new Set();
      for (const part of topLevelParts(text.slice(open + 1, close))) {
        const piece = part.trim();
        if (!piece || NOT_COLUMN.test(piece)) continue;
        const col = /^"?([a-z_][a-z0-9_]*)"?/i.exec(piece);
        if (col) cols.add(col[1].toLowerCase());
      }
      tables.set(m[1].toLowerCase(), cols);
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

/** The Postgres text of a contract, spelled for SQLite. */
export function portableSql(sql) {
  return sql
    .replace(/\s+FOR\s+UPDATE\b/gi, "")
    .replace(/\bdate_part\(\s*'year'\s*,\s*now\(\)\s*\)/gi, "CAST(strftime('%Y', 'now') AS INTEGER)")
    .replace(/\bdate_part\(\s*'month'\s*,\s*now\(\)\s*\)/gi, "CAST(strftime('%m', 'now') AS INTEGER)")
    .replace(/\bnow\(\)\s*-\s*interval\s*'(\d+)\s*(day|hour|minute)s?'/gi, "datetime('now', '-$1 $2s')")
    .replace(/::(?:uuid|int|integer|bigint|text|numeric|jsonb|json|boolean|date|timestamptz)\b/gi, "")
    .replace(/\$(\d+)/g, "?$1")
    .replace(/\bBTRIM\s*\(/gi, "TRIM(")
    .replace(/\bnow\(\)/gi, "datetime('now')");
}

/** A uuid-shaped default for a stand-in primary key. */
export const UUID_DEFAULT = "(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))))";

/** Columns the product writes as JSON. A stand-in keeps them as text, so a read parses them back. */
const JSON_COLUMNS = new Set(["custom_fields", "entity_data", "metadata", "verification", "payload", "raw", "tags", "removed", "kept"]);

/** Postgres translate(): each character found in `from` becomes the character at the same place in `to`, or nothing. */
function translate(value, from, to) {
  if (value === null || value === undefined) return null;
  let out = "";
  for (const ch of String(value)) {
    const at = String(from).indexOf(ch);
    if (at < 0) out += ch;
    else if (at < String(to).length) out += String(to)[at];
  }
  return out;
}

function bindable(v) {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (v instanceof Date) return v.toISOString().replace("T", " ").slice(0, 19);
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

/**
 * A stand-in database for the named tables. Each table holds the REAL columns of that table,
 * untyped. insert() refuses a column the real table does not have.
 *
 * options.defaults is { table: { column: "<sqlite expression>" } } for the columns the product
 * lets the database fill (an id, a status, a start time), so product code that never names them
 * still leaves a whole row.
 */
export function makeStandIn(tableNames, { defaults = {} } = {}) {
  const schema = schemaColumns();
  const db = new DatabaseSync(":memory:");
  db.function("translate", translate);
  const known = new Map();
  for (const name of tableNames) {
    const cols = schema.get(name);
    if (!cols || !cols.size) throw new Error(`no such table in db/schema or db/migrations: ${name}`);
    known.set(name, cols);
    const own = defaults[name] || {};
    for (const col of Object.keys(own)) {
      if (!cols.has(col)) throw new Error(`${name} has no column ${col} in db/schema or db/migrations`);
    }
    db.exec(`CREATE TABLE ${name} (${[...cols].map((c) => (own[c] ? `"${c}" DEFAULT ${own[c]}` : `"${c}"`)).join(", ")})`);
  }
  return {
    db,
    insert(table, row) {
      const cols = known.get(table);
      if (!cols) throw new Error(`stand-in has no table ${table}`);
      const keys = Object.keys(row);
      for (const k of keys) if (!cols.has(k)) throw new Error(`${table} has no column ${k} in db/schema or db/migrations`);
      const values = keys.map((k) => bindable(row[k]));
      db.prepare(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...values);
    },
    /** Run a contract's exact SQL text for one company. Returns { sample_count, bad_count }. */
    run(sql, orgId) {
      const row = db.prepare(portableSql(sql)).get(orgId);
      return { sample_count: Number(row.sample_count), bad_count: Number(row.bad_count) };
    },
    /** Every row of one table, JSON columns parsed back. For asserting what product code wrote. */
    rows(table) {
      return db.prepare(`SELECT * FROM ${table}`).all().map(readBack);
    },
    /**
     * A pg-shaped handle (query(sql, params) -> { rows, rowCount }) over this stand-in, so the REAL
     * product functions can run against it. Postgres casts and now() are spelled for SQLite.
     */
    pg({ now = null } = {}) {
      return {
        async query(sql, params = []) {
          // `now` pins the clock the way a Postgres transaction does: every now() in it is one instant.
          const text = now ? portableSql(sql).split("datetime('now')").join(`'${now}'`) : portableSql(sql);
          const stmt = db.prepare(text);
          const values = params.map(bindable);
          const out = stmt.all(...values).map(readBack);
          return { rows: out, rowCount: out.length };
        },
      };
    },
    close() { db.close(); }
  };
}

function readBack(row) {
  const out = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (JSON_COLUMNS.has(k) && typeof v === "string") {
      try { out[k] = JSON.parse(v); } catch { /* not JSON: keep the text */ }
    }
  }
  return out;
}
