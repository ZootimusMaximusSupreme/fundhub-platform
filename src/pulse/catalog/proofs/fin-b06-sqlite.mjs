// Runs the PRINTED SQL of a batch 06 check for real, over the same stand-in rows the JavaScript judge reads.
//
// There is no local Postgres on the build Mac. The JavaScript judge and the SQL are printed from one definition
// (fin-b06-sql-kit.mjs), but they are two separate renderings, so a typo or a wrong NULL rule in the SQL would
// not show up in a judge-only test. This runs the SQL text in SQLite (node:sqlite, built in to Node 22) after a
// small, mechanical dialect step, and the test compares its sample_count and bad_count with the judge's.
//
// What it proves: the printed SQL parses, runs, and counts the same rows as the judge. What it does not prove:
// Postgres itself. Postgres-only behaviour (its regular expression flavour, collation, timestamp parsing) is
// stood in by JavaScript functions here. The dialect step only rewrites the handful of Postgres spellings the
// kit prints; anything it does not know is left as is, so SQLite refuses it and the test fails loudly.

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function iso(value) {
  return new Date(value).toISOString();
}

function cell(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return ISO.test(value) ? iso(value) : value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

/** The Postgres spellings the kit prints, in SQLite's. `nowIso` is the stand-in clock. */
export function toSqliteDialect(sql, { orgId, nowIso }) {
  const now = new Date(nowIso).getTime();
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.split("$1::uuid").join(`'${orgId}'`);

  // "now() - interval 'N minutes|days'" becomes the moment itself, worked out here.
  out = out.replace(/now\(\)\s*-\s*interval\s*'(\d+)\s+(minutes|days)'/g, (_m, n, unit) =>
    `'${new Date(now - Number(n) * (unit === "days" ? 86_400_000 : 60_000)).toISOString()}'`);
  out = out.replace(/now\(\)/g, `'${new Date(now).toISOString()}'`);
  // "<column> +|- interval 'N minutes'": shifted by the stand-in function.
  out = out.replace(/([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*([+-])\s*interval\s*'(\d+)\s+minutes'/g,
    (_m, col, sign, n) => `fh_shift(${col}, ${sign === "-" ? "-" : ""}${Number(n)})`);
  out = out.replace(/'(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)'::timestamptz/g, (_m, at) => `'${iso(at)}'`);

  // sha256 fingerprint of the words, the way src/contracts/send.mjs writes it.
  out = out.replace(/\('sha256:' \|\| encode\(sha256\(convert_to\(COALESCE\(([^]*?), ''\), 'UTF8'\)\), 'hex'\)\)/g,
    (_m, inner) => `('sha256:' || fh_sha256(COALESCE(${inner}, '')))`);

  // A text array column: 'x' = ANY(p.tags)
  out = out.replace(/COALESCE\('([^']*)' = ANY\((\w+\.\w+)\), false\)/g,
    (_m, word, col) => `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = '${word}')`);

  // jsonb_array_elements(<jsonb expr>) <alias>  (the alias is the element itself in the kit's SQL)
  out = out.replace(/jsonb_array_elements\(CASE WHEN jsonb_typeof\(([\w.]+)\) = 'array' THEN \1 ELSE '\[\]'::jsonb END\) (\w+)/g,
    (_m, col, alias) => `(SELECT value AS ${alias} FROM json_each(CASE WHEN jsonb_typeof(${col}) = 'array' THEN ${col} ELSE '[]' END)) ${alias}`);

  // (VALUES ...) alias(col, col, col)  becomes a select that names its columns
  out = out.replace(/\(VALUES([\s\S]*?)\)\s+(\w+)\(([\w,\s]+)\)/g, (_m, rows, alias, cols) => {
    const names = cols.split(",").map((c) => c.trim());
    return `(SELECT ${names.map((n, i) => `column${i + 1} AS ${n}`).join(", ")} FROM (VALUES${rows})) ${alias}`;
  });

  // Postgres ->> gives text ('true' for a JSON true, a string without quotes); SQLite gives a number or a boolean.
  out = out.replace(/([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?(?:->'[^']*')*)->>'([^']*)'/g, "fh_jtext($1, '$2')");

  out = out.replace(/\)::int AS bad_count/g, ") AS bad_count").replace(/count\(\*\)::int AS/g, "count(*) AS");
  out = out.replace(/(substr\((?:[^()]|\([^()]*\))*\))::int/g, "CAST($1 AS INTEGER)");
  out = out.replace(/(\((?:[^()]|\([^()]*\))*\))::numeric/g, "CAST($1 AS NUMERIC)");
  out = out.replace(/(\((?:[^()]|\([^()]*\))*\))::timestamptz/g, "fh_ts($1)");
  out = out.replace(/::(?:text|jsonb|uuid|numeric|int)\b/g, "");
  out = out.replace(/char_length\(/g, "length(").replace(/\bbtrim\(/gi, "trim(");
  out = out.replace(/\s~\s/g, " REGEXP ");
  return out;
}

function openDatabase(tablesSql, db, now) {
  const lite = new DatabaseSync(":memory:");
  lite.function("regexp", { deterministic: true }, (pattern, value) => (value === null || value === undefined ? 0 : new RegExp(pattern).test(String(value)) ? 1 : 0));
  lite.function("fh_sha256", { deterministic: true }, (text) => createHash("sha256").update(String(text ?? ""), "utf8").digest("hex"));
  lite.function("fh_jtext", { deterministic: true }, (json, key) => {
    if (json === null || json === undefined) return null;
    let value;
    try { value = JSON.parse(String(json)); } catch { return null; }
    if (value === null || typeof value !== "object") return null;
    const found = value[key];
    if (found === undefined || found === null) return null;
    return typeof found === "object" ? JSON.stringify(found) : String(found);
  });
  lite.function("fh_shift", { deterministic: true }, (text, minutes) => {
    if (text === null || text === undefined) return null;
    const at = new Date(String(text));
    return Number.isNaN(at.getTime()) ? null : new Date(at.getTime() + Number(minutes) * 60_000).toISOString();
  });
  lite.function("fh_ts", { deterministic: true }, (text) => {
    if (text === null || text === undefined) return null;
    const at = new Date(String(text));
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  });
  lite.function("resolve_product_id", { deterministic: true }, (_org, name) => name);
  lite.function("jsonb_typeof", { deterministic: true }, (text) => {
    if (text === null || text === undefined) return null;
    let value;
    try { value = JSON.parse(text); } catch { return "string"; }
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value === "object" ? "object" : typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string";
  });

  // Every table the SQL names, with every column it reads, whether or not the stand-in world has rows for it.
  const columns = new Map();
  const aliasTable = new Map();
  for (const hit of tablesSql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\s+([a-z_][a-z0-9_]*)\b/g)) {
    if (["VALUES", "SELECT"].includes(hit[1].toUpperCase())) continue;
    aliasTable.set(hit[2], hit[1]);
    if (!columns.has(hit[1])) columns.set(hit[1], new Set());
  }
  for (const hit of tablesSql.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
    const table = aliasTable.get(hit[1]);
    if (table) columns.get(table).add(hit[2]);
  }
  for (const [table, rows] of Object.entries(db)) {
    if (!Array.isArray(rows)) continue;
    if (!columns.has(table)) columns.set(table, new Set());
    for (const row of rows) for (const key of Object.keys(row)) if (!key.startsWith("_")) columns.get(table).add(key);
  }
  columns.get("transactions")?.add("product_name");
  if (!columns.has("products")) columns.set("products", new Set());
  columns.get("products").add("id").add("code");

  for (const [table, set] of columns) {
    const names = [...set];
    // A stand-in table the SQL never names and that holds no rows has no columns to make.
    if (!names.length) continue;
    lite.exec(`CREATE TABLE ${table} (${names.map((n) => `"${n}"`).join(", ")})`);
    const rows = Array.isArray(db[table]) ? db[table] : [];
    const insert = lite.prepare(`INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`);
    for (const row of rows) {
      const values = names.map((n) => (table === "transactions" && n === "product_name" ? (row._product_code ?? null) : cell(row[n])));
      insert.run(...values);
    }
  }
  for (const code of new Set((db.transactions || []).map((tx) => String(tx._product_code || "").toLowerCase()).filter(Boolean))) {
    lite.prepare("INSERT INTO products (id, code) VALUES (?, ?)").run(code, code);
  }
  void now;
  return lite;
}

/** Run one printed check (the contract's `sql`) over stand-in rows. Returns { sample_count, bad_count }. */
export function runPrintedSql(sql, db, { orgId, nowIso }) {
  const translated = toSqliteDialect(sql, { orgId, nowIso });
  const lite = openDatabase(translated, db, nowIso);
  try {
    const row = lite.prepare(translated).get();
    return { sample_count: Number(row.sample_count), bad_count: Number(row.bad_count) };
  } finally {
    lite.close();
  }
}
