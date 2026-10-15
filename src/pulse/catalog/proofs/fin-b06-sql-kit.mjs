// A tiny builder for the fin-b06 display checks. One definition is printed twice: once as the read-only
// SQL the live pulse runs, and once as a JavaScript judge that a test runs over stand-in rows. There is no
// local Postgres on the build Mac, so this is how a check is made to go red on purpose before it ships.
//
// Every predicate is two-valued by construction (no bare NULL comparisons), so SQL three-valued logic and
// the JavaScript judge agree. Regular expressions use only the subset both engines read the same way.

const SQL_NAME = /^[a-z_][a-z0-9_]*$/;

function name(value) {
  if (!SQL_NAME.test(value)) throw new Error(`not a plain sql name: ${value}`);
  return value;
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function text(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ---- values -------------------------------------------------------------------------------------

/** alias.column */
export function c(alias, column) {
  name(alias); name(column);
  return { sql: `${alias}.${column}`, ev: (ctx) => (ctx[alias] ? ctx[alias][column] ?? null : null) };
}

/** A literal string, number or boolean. */
export function lit(value) {
  if (typeof value === "number") return { sql: String(value), ev: () => value };
  if (typeof value === "boolean") return { sql: value ? "true" : "false", ev: () => value };
  return { sql: quote(value), ev: () => String(value) };
}

/** expr->>'key' for one key, or a path of keys: expr->'a'->>'b'. */
export function jtext(expr, ...keys) {
  if (!keys.length) throw new Error("jtext needs a key");
  const last = keys[keys.length - 1];
  const middle = keys.slice(0, -1).map((key) => `->${quote(key)}`).join("");
  return {
    sql: `${expr.sql}${middle}->>${quote(last)}`,
    ev: (ctx, db) => {
      let value = expr.ev(ctx, db);
      for (const key of keys) {
        if (value === null || value === undefined || typeof value !== "object") return null;
        value = value[key];
      }
      return value === undefined ? null : text(value);
    }
  };
}

/** expr->'key' : the json value itself, so jtype() can ask what it is. */
export function jsonGet(expr, key) {
  return {
    sql: `${expr.sql}->${quote(key)}`,
    ev: (ctx, db) => {
      const value = expr.ev(ctx, db);
      if (value === null || value === undefined || typeof value !== "object") return null;
      return value[key] === undefined ? null : value[key];
    }
  };
}

/** A hand-written expression with its stand-in judge, for the few things the builder has no word for. */
export function custom(sqlText, evFn) {
  return { sql: `(${sqlText})`, ev: evFn };
}

/** jsonb_typeof(expr) */
export function jtype(expr) {
  return {
    sql: `jsonb_typeof(${expr.sql})`,
    ev: (ctx, db) => {
      const value = expr.ev(ctx, db);
      if (value === null || value === undefined) return null;
      if (Array.isArray(value)) return "array";
      if (typeof value === "object") return "object";
      return typeof value;
    }
  };
}

/** char_length(expr::text) */
export function charLength(expr) {
  return { sql: `char_length(${expr.sql}::text)`, ev: (ctx, db) => { const v = text(expr.ev(ctx, db)); return v === null ? null : [...v].length; } };
}

/** expr as a number when it reads as one, else NULL. Never raises. */
export function numberFrom(expr) {
  const re = "^[0-9]*[.]?[0-9]+$";
  return {
    sql: `CASE WHEN ${expr.sql}::text ~ '${re}' THEN (${expr.sql}::text)::numeric END`,
    ev: (ctx, db) => { const v = text(expr.ev(ctx, db)); return v !== null && new RegExp(re).test(v) ? Number(v) : null; }
  };
}

/** 'sha256:' + hex sha256 of the UTF-8 words, the way src/contracts/send.mjs bodyHash writes it. */
export function bodyHash(expr, sha256Hex) {
  return {
    sql: `('sha256:' || encode(sha256(convert_to(COALESCE(${expr.sql}, ''), 'UTF8')), 'hex'))`,
    ev: (ctx, db) => `sha256:${sha256Hex(String(text(expr.ev(ctx, db)) ?? ""))}`
  };
}

// ---- predicates ---------------------------------------------------------------------------------

export function isNull(expr) { return { sql: `${expr.sql} IS NULL`, ev: (ctx, db) => expr.ev(ctx, db) === null || expr.ev(ctx, db) === undefined }; }
export function notNull(expr) { return { sql: `${expr.sql} IS NOT NULL`, ev: (ctx, db) => !isNull(expr).ev(ctx, db) }; }

/** NULL, empty, or only spaces. */
export function blank(expr) {
  return {
    sql: `NULLIF(BTRIM(COALESCE(${expr.sql}::text, '')), '') IS NULL`,
    ev: (ctx, db) => { const v = text(expr.ev(ctx, db)); return v === null || v.trim() === ""; }
  };
}

const plain = (v) => (v instanceof Date ? v.toISOString() : String(v));
const same = (a, b) => (a === null || a === undefined || b === null || b === undefined)
  ? (a === null || a === undefined) && (b === null || b === undefined)
  : plain(a) === plain(b);

/** a IS DISTINCT FROM b */
export function distinct(a, b) {
  return { sql: `${a.sql} IS DISTINCT FROM ${b.sql}`, ev: (ctx, db) => !same(a.ev(ctx, db), b.ev(ctx, db)) };
}

/** a = b, with NULL on either side counting as "not equal". Use this for join keys (the planner can use an index). */
export function eq(a, b) {
  return {
    sql: `${a.sql} = ${b.sql}`,
    ev: (ctx, db) => {
      const l = a.ev(ctx, db); const r = b.ev(ctx, db);
      return l !== null && l !== undefined && r !== null && r !== undefined && plain(l) === plain(r);
    }
  };
}

/** a IS NOT DISTINCT FROM b */
export function equal(a, b) {
  return { sql: `${a.sql} IS NOT DISTINCT FROM ${b.sql}`, ev: (ctx, db) => same(a.ev(ctx, db), b.ev(ctx, db)) };
}

export function oneOf(expr, list) {
  const values = list.map(quote).join(", ");
  return { sql: `COALESCE(${expr.sql} IN (${values}), false)`, ev: (ctx, db) => { const v = text(expr.ev(ctx, db)); return v !== null && list.includes(v); } };
}

export function notOneOf(expr, list) {
  const inner = oneOf(expr, list);
  return { sql: `NOT ${inner.sql}`, ev: (ctx, db) => !inner.ev(ctx, db) };
}

function comparable(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const asNumber = Number(value);
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(asNumber) ? asNumber : value;
}

function compare(op, jsOp) {
  return (a, b) => ({
    sql: `COALESCE(${a.sql} ${op} ${b.sql}, false)`,
    ev: (ctx, db) => {
      const l = a.ev(ctx, db); const r = b.ev(ctx, db);
      if (l === null || l === undefined || r === null || r === undefined) return false;
      return jsOp(comparable(l), comparable(r));
    }
  });
}
export const gt = compare(">", (a, b) => a > b);
export const gte = compare(">=", (a, b) => a >= b);
export const lt = compare("<", (a, b) => a < b);
export const lte = compare("<=", (a, b) => a <= b);

/** Timestamp columns: a < b where either may be a Date or an ISO string in the stand-in rows. */
export function earlier(a, b) {
  return {
    sql: `COALESCE(${a.sql} < ${b.sql}, false)`,
    ev: (ctx, db) => {
      const l = a.ev(ctx, db); const r = b.ev(ctx, db);
      if (l === null || l === undefined || r === null || r === undefined) return false;
      return new Date(l).getTime() < new Date(r).getTime();
    }
  };
}

/** expr <= now() - interval 'N minutes'. now comes from db.now in the stand-in. */
export function olderThanMinutes(expr, minutes) {
  const n = Number(minutes);
  if (!Number.isInteger(n) || n <= 0) throw new Error("minutes must be a positive whole number");
  return {
    sql: `COALESCE(${expr.sql} < now() - interval '${n} minutes', false)`,
    ev: (ctx, db) => {
      const v = expr.ev(ctx, db);
      if (v === null || v === undefined) return false;
      return new Date(v).getTime() < new Date(db.now).getTime() - n * 60_000;
    }
  };
}

/** expr > now() */
export function afterNow(expr) {
  return {
    sql: `COALESCE(${expr.sql} > now(), false)`,
    ev: (ctx, db) => {
      const v = expr.ev(ctx, db);
      return v !== null && v !== undefined && new Date(v).getTime() > new Date(db.now).getTime();
    }
  };
}

/** lower(btrim(expr)) */
export function lowerTrim(expr) {
  return { sql: `lower(btrim(${expr.sql}))`, ev: (ctx, db) => { const v = text(expr.ev(ctx, db)); return v === null ? null : v.trim().toLowerCase(); } };
}

/** btrim(expr) */
export function trimmed(expr) {
  return { sql: `btrim(${expr.sql})`, ev: (ctx, db) => { const v = text(expr.ev(ctx, db)); return v === null ? null : v.trim(); } };
}

/** alias.is_demo IS NOT TRUE */
export function notDemo(alias) {
  name(alias);
  return { sql: `${alias}.is_demo IS NOT TRUE`, ev: (ctx) => !(ctx[alias] && ctx[alias].is_demo === true) };
}

/** expr > now() - interval 'N days'. */
export function newerThanDays(expr, days) {
  const n = Number(days);
  if (!Number.isInteger(n) || n <= 0) throw new Error("days must be a positive whole number");
  return {
    sql: `COALESCE(${expr.sql} > now() - interval '${n} days', false)`,
    ev: (ctx, db) => {
      const v = expr.ev(ctx, db);
      if (v === null || v === undefined) return false;
      return new Date(v).getTime() > new Date(db.now).getTime() - n * 86_400_000;
    }
  };
}

/** Both engines must read the pattern the same way: only [], ., ^, $, ?, +, *, | and () are used. */
export function matches(expr, pattern) {
  if (/[\\]/.test(pattern)) throw new Error("use [.] and [0-9] classes; no backslashes in shared patterns");
  const re = new RegExp(pattern);
  return {
    sql: `COALESCE(${expr.sql}::text ~ ${quote(pattern)}, false)`,
    ev: (ctx, db) => { const v = text(expr.ev(ctx, db)); return v !== null && re.test(v); }
  };
}

export function notMatches(expr, pattern) {
  const inner = matches(expr, pattern);
  return { sql: `NOT ${inner.sql}`, ev: (ctx, db) => !inner.ev(ctx, db) };
}

export function and(...parts) {
  const items = parts.filter(Boolean);
  return { sql: items.map((p) => `(${p.sql})`).join(" AND "), ev: (ctx, db) => items.every((p) => p.ev(ctx, db)) };
}

export function or(...parts) {
  const items = parts.filter(Boolean);
  return { sql: items.map((p) => `(${p.sql})`).join("\n         OR "), ev: (ctx, db) => items.some((p) => p.ev(ctx, db)) };
}

export function not(part) {
  return { sql: `NOT (${part.sql})`, ev: (ctx, db) => !part.ev(ctx, db) };
}

/** EXISTS (SELECT 1 FROM table alias WHERE ...) correlated to the outer aliases. */
export function exists(table, alias, where) {
  name(table); name(alias);
  return {
    sql: `EXISTS (SELECT 1 FROM ${table} ${alias} WHERE ${where.sql})`,
    ev: (ctx, db) => (db[table] || []).some((row) => where.ev({ ...ctx, [alias]: row }, db))
  };
}

/** Never-exists, for "has no row" conditions. */
export function missing(table, alias, where) {
  const inner = exists(table, alias, where);
  return { sql: `NOT ${inner.sql}`, ev: (ctx, db) => !inner.ev(ctx, db) };
}

/** EXISTS over the elements of a jsonb array column (a non-array counts as empty). */
export function existsElement(arrayExpr, alias, where) {
  name(alias);
  const arr = `CASE WHEN jsonb_typeof(${arrayExpr.sql}) = 'array' THEN ${arrayExpr.sql} ELSE '[]'::jsonb END`;
  return {
    sql: `EXISTS (SELECT 1 FROM jsonb_array_elements(${arr}) ${alias} WHERE ${where.sql})`,
    ev: (ctx, db) => {
      const value = arrayExpr.ev(ctx, db);
      const list = Array.isArray(value) ? value : [];
      return list.some((el) => where.ev({ ...ctx, [alias]: { __json: el } }, db));
    }
  };
}

/** Whole element of a jsonb_array_elements alias, for jtext(elem('f'), 'x'). */
export function elem(alias) {
  name(alias);
  return { sql: alias, ev: (ctx) => (ctx[alias] ? ctx[alias].__json : null) };
}

/** True when the client has a paid-or-not Blueprint transaction. resolve_product_id is stood in by tx._product_code. */
export function hasBlueprintTransaction(clientExpr, orgAlias, productCode) {
  const code = quote(String(productCode).toLowerCase());
  return {
    sql: `EXISTS (SELECT 1 FROM transactions tx JOIN products pr ON pr.id = resolve_product_id(tx.org_id, tx.product_name)\n                  WHERE tx.org_id = ${orgAlias}.org_id AND tx.client_id = ${clientExpr.sql}\n                    AND lower(pr.code) = ${code})`,
    ev: (ctx, db) => {
      const clientId = clientExpr.ev(ctx, db);
      const orgId = ctx[orgAlias] ? ctx[orgAlias].org_id : null;
      return (db.transactions || []).some((tx) => tx.org_id === orgId && tx.client_id === clientId
        && String(tx._product_code || "").toLowerCase() === String(productCode).toLowerCase());
    }
  };
}

// ---- the check ----------------------------------------------------------------------------------

/**
 * One part of a check: the base table (always scoped to the company in $1), optional LEFT JOINs, a
 * population filter, and the "this one is wrong" predicate.
 */
export function part({ table, alias, joins = [], where = null, bad }) {
  name(table); name(alias);
  return { table, alias, joins, where, bad };
}

/** A fixed lookup list, joined as (VALUES ...) alias(cols). Built at module load from repo constants. */
export function valuesTable(alias, columns, rows, on) {
  name(alias); columns.forEach(name);
  const body = rows.map((row) => `(${row.map(quote).join(", ")})`).join(",\n    ");
  return {
    table: `__values_${alias}`,
    alias,
    values: { columns, rows: rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]]))) },
    sqlFrom: `(VALUES\n    ${body}\n  ) ${alias}(${columns.join(", ")})`,
    on
  };
}

function printJoin(j) {
  if (j.values) return `\n  LEFT JOIN ${j.sqlFrom} ON ${j.on.sql}`;
  return `\n  LEFT JOIN ${name(j.table)} ${name(j.alias)} ON ${j.on.sql}`;
}

function printPart(p) {
  const join = p.joins.map(printJoin).join("");
  const filter = [`${p.alias}.org_id = $1::uuid`, p.where ? p.where.sql : null].filter(Boolean).join("\n   AND ");
  return { from: `  FROM ${p.table} ${p.alias}${join}\n WHERE ${filter}`, bad: p.bad.sql };
}

/** The SQL text. One part prints the flat form; several print a UNION ALL of per-row bad flags. */
export function printCheck(key, parts) {
  name(key.replace(/-/g, "_"));
  const list = Array.isArray(parts) ? parts : [parts];
  if (list.length === 1) {
    const printed = printPart(list[0]);
    return `/* display-result:${key} */\nSELECT count(*)::int AS sample_count,\n       count(*) FILTER (WHERE ${printed.bad})::int AS bad_count\n${printed.from}`;
  }
  const inner = list.map((p) => {
    const printed = printPart(p);
    return `  SELECT (${printed.bad}) AS bad\n${printed.from}`;
  }).join("\n  UNION ALL\n");
  return `/* display-result:${key} */\nSELECT count(*)::int AS sample_count,\n       count(*) FILTER (WHERE x.bad)::int AS bad_count\n  FROM (\n${inner}\n  ) x`;
}

/** Run the same check over stand-in rows. db is { table: [rows] } plus db.now. */
export function judgeCheck(parts, db, orgId) {
  const list = Array.isArray(parts) ? parts : [parts];
  let sample = 0;
  let bad = 0;
  for (const p of list) {
    for (const base of db[p.table] || []) {
      if (base.org_id !== orgId) continue;
      let ctx = { [p.alias]: base };
      for (const j of p.joins) {
        const rows = j.values ? j.values.rows : (db[j.table] || []);
        const found = rows.find((row) => j.on.ev({ ...ctx, [j.alias]: row }, db));
        ctx = { ...ctx, [j.alias]: found || null };
      }
      if (p.where && !p.where.ev(ctx, db)) continue;
      sample += 1;
      if (p.bad.ev(ctx, db)) bad += 1;
    }
  }
  return { sample_count: sample, bad_count: bad };
}

/** The contract the display registry reads. emptyAs "quiet" = green until the first wrong result. */
export function contract({ control, requirement, key, parts, quiet = true }) {
  return Object.freeze({
    control,
    mode: "query",
    requirement,
    sql: printCheck(key, parts),
    ...(quiet ? { emptyAs: "quiet" } : {})
  });
}
