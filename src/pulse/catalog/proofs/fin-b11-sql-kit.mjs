// Test kit for the finish-853 batch 11 live checks. A live display check is one read-only SQL text
// that goes red when a saved result is wrong. This kit lets a test RUN that exact text over
// stand-in rows with no Postgres on the machine:
//
//   1. schemaColumns() reads the real table and column names from db/schema and db/migrations, so a
//      stand-in table can only hold columns the product really has, and a typo in a contract
//      ("no such column") fails the test.
//   2. portableSql() turns the few Postgres spellings the contracts use (casts, $1, BTRIM, the
//      jsonb functions, now() and interval) into the same statement for SQLite.
//   3. makeStandIn() builds an in-memory database whose tables hold the real column names.
//
// SQLite does not enforce the product's CHECK constraints or foreign keys, so a stand-in row can
// hold a value the real database would refuse. That is on purpose: it lets a test show that a
// contract still goes red if a constraint were ever dropped.
//
// Tests only. Nothing here is imported by the live bundle.

import { randomUUID } from "node:crypto";
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
 * The Postgres text of a contract, spelled for SQLite.
 *   $1 becomes ?1; casts and BTRIM are plain; now() and "now() - interval 'N units'" become the
 *   fixed ISO instant (every stand-in timestamp is written in the same ISO shape, so string order is
 *   time order); the jsonb functions become their json twins.
 */
export function portableSql(sql, { now = NOW } = {}) {
  const iso = (ms) => `'${new Date(ms).toISOString()}'`;
  return sql
    .replace(/\bnow\(\)\s*-\s*interval\s*'(\d+)\s*(minute|hour|day)s?'/gi,
      (_, n, unit) => iso(now.getTime() - Number(n) * UNIT_MS[unit.toLowerCase()]))
    .replace(/\bnow\(\)/gi, iso(now.getTime()))
    .replace(/::(?:uuid|int|integer|bigint|text|numeric|jsonb|json|boolean|date|timestamptz)\b/gi, "")
    .replace(/\$(\d+)/g, "?$1")
    .replace(/\bBTRIM\s*\(/gi, "TRIM(")
    .replace(/\bjsonb_array_length\s*\(/gi, "json_array_length(")
    .replace(/\bjsonb_typeof\s*\(/gi, "json_type(")
    .replace(/\bjsonb_array_elements\s*\(([^()]*(?:\([^()]*\))?[^()]*)\)\s+AS\s+(\w+)\s*\(\s*value\s*\)/gi,
      (_, arg, alias) => `json_each(${arg}) AS ${alias}`);
}

/**
 * A stand-in database for the named tables. Each table holds the REAL columns of that table,
 * untyped. insert() refuses a column the real table does not have.
 */
export function makeStandIn(tableNames, { now = NOW, defaults = false, clock = null } = {}) {
  const schema = schemaColumns();
  const db = new DatabaseSync(":memory:");
  const known = new Map();
  // defaults: the real tables fill id (gen_random_uuid()) and created_at / updated_at (now()) when an
  // INSERT leaves them out. A handler that inserts a row and reads it back needs that, so the stand-in
  // can do it too. The clock is the one the caller's queries use, so a default and a now() agree.
  if (defaults) {
    const tick = clock || (() => new Date(now.getTime()));
    db.function("fh_uuid", () => randomUUID());
    db.function("fh_now", () => tick().toISOString());
  }
  for (const name of tableNames) {
    const cols = schema.get(name);
    if (!cols || !cols.size) throw new Error(`no such table in db/schema or db/migrations: ${name}`);
    known.set(name, cols);
    const colSql = (c) => {
      if (!defaults) return `"${c}"`;
      if (c === "id") return `"${c}" DEFAULT (fh_uuid())`;
      if (c === "created_at" || c === "updated_at") return `"${c}" DEFAULT (fh_now())`;
      return `"${c}"`;
    };
    db.exec(`CREATE TABLE ${name} (${[...cols].map(colSql).join(", ")})`);
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

/** Every table name a SQL text reads: the word after FROM or JOIN. */
export function tablesIn(sql) {
  const names = new Set();
  for (const m of stripComments(sql).matchAll(/(?<!distinct\s)\b(?:from|join)\s+([a-z_][a-z0-9_]*)\b/gi)) {
    const word = m[1].toLowerCase();
    if (!["select", "jsonb_array_elements", "json_each"].includes(word)) names.add(word);
  }
  return [...names];
}
