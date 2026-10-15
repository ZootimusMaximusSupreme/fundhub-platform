// A very small SQL runner for the live display checks (finish-the-853, batch 01).
//
// WHY IT EXISTS. There is no Postgres on the Mac that builds these checks, so a
// check's SQL could only be read, never run. This runs the SAME text the live
// pulse sends, over rows a test makes up, so a test can see the check go green on
// good rows and red on a wrong one, and see it stay red when the SQL is changed.
//
// WHAT IT RUNS. Exactly one shape:
//   SELECT count(*)::int AS sample_count,
//          count(*) FILTER (WHERE <bad>)::int AS bad_count
//     FROM <table> <alias> [LEFT JOIN <table> <alias> ON <cond>]...
//    WHERE <cond>
// with three-valued logic (NULL is "unknown", as in Postgres). A statement it
// cannot parse throws, so a check can never pass because the runner shrugged.
//
// It is a test tool. It never touches a database and nothing live imports it.

// A JSON null inside a jsonb value is not SQL NULL: jsonb_typeof says 'null' and
// ->> says NULL. A key that is absent altogether is SQL NULL for both.
const JSON_NULL = Symbol("json-null");

const KEYWORDS = new Set(["AND", "OR", "NOT", "IS", "NULL", "DISTINCT", "FROM", "IN", "TRUE", "FALSE"]);

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === "'") {
      let j = i + 1;
      let s = "";
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") { s += "'"; j += 2; continue; }
        if (text[j] === "'") break;
        s += text[j];
        j += 1;
      }
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    const num = /^[0-9]+(?:\.[0-9]+)?/.exec(text.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const par = /^\$[0-9]+/.exec(text.slice(i));
    if (par) { out.push({ t: "param", v: Number(par[0].slice(1)) }); i += par[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(text.slice(i));
    if (id) {
      const up = id[0].toUpperCase();
      out.push(KEYWORDS.has(up) ? { t: "kw", v: up } : { t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = ["->>", "->", "::", "<>", "<=", ">=", "!=", "!~", "||"].find((o) => text.startsWith(o, i))
      || ("=<>~(),+-*".includes(c) ? c : null);
    if (!op) throw new Error(`sql-mini: cannot read "${text.slice(i, i + 20)}"`);
    out.push({ t: "op", v: op });
    i += op.length;
  }
  return out;
}

// --- three-valued logic ------------------------------------------------------
const and3 = (a, b) => (a === false || b === false ? false : (a === null || b === null ? null : true));
const or3 = (a, b) => (a === true || b === true ? true : (a === null || b === null ? null : false));
const not3 = (a) => (a === null ? null : !a);

function looseEq(a, b) {
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b))) return a === Number(b);
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a))) return b === Number(a);
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function compare(a, b) {
  if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function jsonType(v) {
  if (v === JSON_NULL) return "null";
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  return "string";
}

function castTo(v, type) {
  if (v === null || v === undefined) return null;
  switch (type.toLowerCase()) {
    case "int": case "integer": case "bigint": case "numeric": case "float": case "float8": {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(n)) throw new Error(`sql-mini: invalid input syntax for ${type}: "${v}"`);
      return /^(int|integer|bigint)$/i.test(type) ? Math.trunc(n) : n;
    }
    case "text": case "varchar": case "uuid": case "date": case "timestamptz":
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    case "boolean": case "bool":
      return typeof v === "boolean" ? v : /^(t|true|1|yes|on)$/i.test(String(v));
    case "jsonb": case "json":
      return v;
    default:
      throw new Error(`sql-mini: unknown cast ::${type}`);
  }
}

// --- expression parser/evaluator --------------------------------------------
// The parser builds a closure tree once; `scope` is {alias: row|null}.
function parseExpression(text, usedColumns) {
  const toks = tokenize(text);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => toks[p]?.t === "op" && toks[p].v === v;
  const isKw = (v) => toks[p]?.t === "kw" && toks[p].v === v;
  const eatOp = (v) => { if (!isOp(v)) throw new Error(`sql-mini: expected ${v}`); p += 1; };

  function column(name) {
    const dot = name.indexOf(".");
    const alias = dot > 0 ? name.slice(0, dot) : null;
    const col = dot > 0 ? name.slice(dot + 1) : name;
    usedColumns.add(name);
    return (scope, ctx) => {
      if (alias) {
        if (!(alias in scope)) throw new Error(`sql-mini: unknown alias ${alias}`);
        const row = scope[alias];
        return row == null ? null : (row[col] === undefined ? null : row[col]);
      }
      for (const row of Object.values(scope)) {
        if (row && col in row) return row[col] === undefined ? null : row[col];
      }
      return null;
    };
  }

  function parseFunction(name) {
    eatOp("(");
    const args = [];
    if (!isOp(")")) {
      args.push(parseOr());
      while (isOp(",")) { p += 1; args.push(parseOr()); }
    }
    eatOp(")");
    const ev = (scope, ctx) => args.map((a) => a(scope, ctx));
    switch (name.toLowerCase()) {
      case "coalesce": return (s, c) => { for (const a of args) { const v = a(s, c); if (v !== null && v !== undefined) return v; } return null; };
      case "nullif": return (s, c) => { const [a, b] = ev(s, c); return a !== null && looseEq(a, b) ? null : a; };
      case "btrim": case "trim": return (s, c) => { const [a] = ev(s, c); return a === null ? null : String(a).trim(); };
      case "lower": return (s, c) => { const [a] = ev(s, c); return a === null ? null : String(a).toLowerCase(); };
      case "length": return (s, c) => { const [a] = ev(s, c); return a === null ? null : String(a).length; };
      case "jsonb_typeof": return (s, c) => jsonType(ev(s, c)[0]);
      case "jsonb_array_length": return (s, c) => {
        const [a] = ev(s, c);
        if (a === null) return null;
        if (!Array.isArray(a)) throw new Error("sql-mini: cannot get array length of a non-array");
        return a.length;
      };
      default: throw new Error(`sql-mini: unknown function ${name}`);
    }
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new Error("sql-mini: unexpected end");
    p += 1;
    if (tok.t === "num") return () => tok.v;
    if (tok.t === "str") return () => tok.v;
    if (tok.t === "param") return (s, c) => (c.params[tok.v - 1] === undefined ? null : c.params[tok.v - 1]);
    if (tok.t === "kw" && tok.v === "NULL") return () => null;
    if (tok.t === "kw" && tok.v === "TRUE") return () => true;
    if (tok.t === "kw" && tok.v === "FALSE") return () => false;
    if (tok.t === "op" && tok.v === "(") { const e = parseOr(); eatOp(")"); return e; }
    if (tok.t === "op" && tok.v === "-") { const e = parsePostfix(); return (s, c) => { const v = e(s, c); return v === null ? null : -Number(v); }; }
    if (tok.t === "id") {
      if (isOp("(") && !tok.v.includes(".")) return parseFunction(tok.v);
      return column(tok.v);
    }
    throw new Error(`sql-mini: unexpected ${tok.v}`);
  }

  function parsePostfix() {
    let e = parsePrimary();
    for (;;) {
      if (isOp("::")) {
        p += 1;
        const type = peek();
        if (!type || type.t !== "id") throw new Error("sql-mini: expected a type after ::");
        p += 1;
        const inner = e;
        e = (s, c) => castTo(inner(s, c), type.v);
        continue;
      }
      if (isOp("->>") || isOp("->")) {
        const text = peek().v === "->>";
        p += 1;
        const key = parsePrimary();
        const inner = e;
        e = (s, c) => {
          const base = inner(s, c);
          if (base === null || base === JSON_NULL || typeof base !== "object") return null;
          const k = key(s, c);
          const v = Array.isArray(base) ? base[Number(k)] : base[k];
          if (v === undefined) return null;
          if (v === null) return text ? null : JSON_NULL;
          return text ? (typeof v === "object" ? JSON.stringify(v) : String(v)) : v;
        };
        continue;
      }
      return e;
    }
  }

  function parseConcat() {
    let left = parsePostfix();
    while (isOp("||")) {
      p += 1;
      const right = parsePostfix();
      const l = left;
      left = (s, c) => { const a = l(s, c); const b = right(s, c); return a === null || b === null ? null : String(a) + String(b); };
    }
    return left;
  }

  function parseCompare() {
    const left = parseConcat();
    const t = peek();
    if (!t) return left;
    const cmp = (fn) => {
      p += 1;
      const right = parseConcat();
      return (s, c) => { const a = left(s, c); const b = right(s, c); return a === null || b === null ? null : fn(a, b); };
    };
    if (t.t === "op") {
      if (t.v === "=") return cmp((a, b) => looseEq(a, b));
      if (t.v === "<>" || t.v === "!=") return cmp((a, b) => !looseEq(a, b));
      if (t.v === "<") return cmp((a, b) => compare(a, b) < 0);
      if (t.v === "<=") return cmp((a, b) => compare(a, b) <= 0);
      if (t.v === ">") return cmp((a, b) => compare(a, b) > 0);
      if (t.v === ">=") return cmp((a, b) => compare(a, b) >= 0);
      if (t.v === "~") return cmp((a, b) => new RegExp(String(b)).test(String(a)));
      if (t.v === "!~") return cmp((a, b) => !new RegExp(String(b)).test(String(a)));
    }
    if (t.t === "kw" && t.v === "IS") {
      p += 1;
      let negate = false;
      if (isKw("NOT")) { negate = true; p += 1; }
      if (isKw("NULL")) {
        p += 1;
        return (s, c) => { const isNull = left(s, c) === null; return negate ? !isNull : isNull; };
      }
      if (isKw("DISTINCT")) {
        p += 1;
        if (!isKw("FROM")) throw new Error("sql-mini: expected FROM");
        p += 1;
        const right = parseConcat();
        return (s, c) => {
          const a = left(s, c); const b = right(s, c);
          const same = a === null || b === null ? a === b : looseEq(a, b);
          return negate ? same : !same;
        };
      }
      throw new Error("sql-mini: unsupported IS form");
    }
    let notIn = false;
    if (t.t === "kw" && t.v === "NOT" && toks[p + 1]?.t === "kw" && toks[p + 1].v === "IN") { notIn = true; p += 1; }
    if (isKw("IN")) {
      p += 1;
      eatOp("(");
      const items = [parseOr()];
      while (isOp(",")) { p += 1; items.push(parseOr()); }
      eatOp(")");
      return (s, c) => {
        const a = left(s, c);
        if (a === null) return null;
        let sawNull = false;
        for (const item of items) {
          const v = item(s, c);
          if (v === null) { sawNull = true; continue; }
          if (looseEq(a, v)) return !notIn;
        }
        if (sawNull) return null;
        return notIn;
      };
    }
    return left;
  }

  function parseNot() {
    if (isKw("NOT")) { p += 1; const e = parseNot(); return (s, c) => not3(toBool(e(s, c))); }
    return parseCompare();
  }
  function parseAnd() {
    let left = parseNot();
    while (isKw("AND")) {
      p += 1;
      const right = parseNot();
      const l = left;
      left = (s, c) => and3(toBool(l(s, c)), toBool(right(s, c)));
    }
    return left;
  }
  function parseOr() {
    let left = parseAnd();
    while (isKw("OR")) {
      p += 1;
      const right = parseAnd();
      const l = left;
      left = (s, c) => or3(toBool(l(s, c)), toBool(right(s, c)));
    }
    return left;
  }
  const toBool = (v) => (v === null || v === undefined ? null : v === true || v === false ? v : (() => { throw new Error("sql-mini: a condition must be true or false"); })());

  const root = parseOr();
  if (p < toks.length) throw new Error(`sql-mini: unexpected ${toks[p].v}`);
  return (scope, ctx) => toBool(root(scope, ctx));
}

// --- statement splitter ------------------------------------------------------
function findTopLevel(text, word, from = 0) {
  let depth = 0;
  let inStr = false;
  const re = new RegExp(`^${word.replace(/ /g, "\\s+")}\\b`, "i");
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) { if (c === "'") inStr = false; continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (depth === 0 && (i === 0 || /\s|\)/.test(text[i - 1])) && re.test(text.slice(i))) return i;
  }
  return -1;
}

function matchParen(text, open) {
  let depth = 0;
  let inStr = false;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) { if (c === "'") inStr = false; continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === "(") depth += 1;
    if (c === ")") { depth -= 1; if (depth === 0) return i; }
  }
  throw new Error("sql-mini: unbalanced parenthesis");
}

export function parseContractSql(sql) {
  const text = stripComments(sql).replace(/\s+/g, " ").trim();
  if (/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(text)) throw new Error("sql-mini: a check must only read");
  const head = /^SELECT count\(\*\)::int AS sample_count, count\(\*\) FILTER \(WHERE /i.exec(text);
  if (!head) throw new Error("sql-mini: the statement must start with the sample_count and bad_count select");
  const close = matchParen(text, head[0].length - "WHERE ".length - 1);
  const bad = text.slice(head[0].length, close);
  const rest = text.slice(close + 1);
  if (!/^::int AS bad_count FROM /i.test(rest)) throw new Error("sql-mini: expected ::int AS bad_count FROM");
  let from = rest.replace(/^::int AS bad_count FROM /i, "");
  const whereAt = findTopLevel(from, "WHERE");
  if (whereAt < 0) throw new Error("sql-mini: a check must have a WHERE (the company)");
  const where = from.slice(whereAt + "WHERE ".length);
  from = from.slice(0, whereAt).trim();
  // table alias, then LEFT JOIN table alias ON cond ...
  const parts = [];
  const joinAt = [];
  for (let at = findTopLevel(from, "LEFT JOIN"); at >= 0; at = findTopLevel(from, "LEFT JOIN", at + 1)) joinAt.push(at);
  const first = from.slice(0, joinAt.length ? joinAt[0] : from.length).trim();
  const m = /^([a-z_][a-z0-9_]*)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?$/i.exec(first);
  if (!m) throw new Error(`sql-mini: cannot read FROM "${first}"`);
  const base = { table: m[1], alias: m[2] || m[1] };
  joinAt.forEach((at, i) => {
    const seg = from.slice(at + "LEFT JOIN ".length, joinAt[i + 1] ?? from.length).trim();
    const j = /^([a-z_][a-z0-9_]*)\s+(?:AS\s+)?([a-z_][a-z0-9_]*)\s+ON\s+(.+)$/i.exec(seg);
    if (!j) throw new Error(`sql-mini: cannot read LEFT JOIN "${seg}"`);
    parts.push({ table: j[1], alias: j[2], on: j[3] });
  });
  return { base, joins: parts, bad, where };
}

/**
 * Run one contract statement over made-up rows.
 *   tables: { tableName: [ { column: value, ... } ] }
 *   params: the values for $1, $2 ...
 * Returns { sample_count, bad_count, columns } where `columns` lists every
 * column name the statement reads (so a test can check them against the schema).
 */
export function runContractSql(sql, tables, params = []) {
  const shape = parseContractSql(sql);
  const used = new Set();
  const badFn = parseExpression(shape.bad, used);
  const whereFn = parseExpression(shape.where, used);
  const joinFns = shape.joins.map((j) => ({ ...j, fn: parseExpression(j.on, used) }));
  const ctx = { params };
  const source = (name) => {
    if (!(name in tables)) throw new Error(`sql-mini: no rows given for table ${name}`);
    return tables[name];
  };
  let scopes = source(shape.base.table).map((row) => ({ [shape.base.alias]: row }));
  for (const j of joinFns) {
    const next = [];
    for (const scope of scopes) {
      const hits = source(j.table).filter((row) => j.fn({ ...scope, [j.alias]: row }, ctx) === true);
      if (hits.length) hits.forEach((row) => next.push({ ...scope, [j.alias]: row }));
      else next.push({ ...scope, [j.alias]: null });
    }
    scopes = next;
  }
  const kept = scopes.filter((scope) => whereFn(scope, ctx) === true);
  const bad = kept.filter((scope) => badFn(scope, ctx) === true);
  const aliases = new Map([[shape.base.alias, shape.base.table], ...shape.joins.map((j) => [j.alias, j.table])]);
  const columns = [...used].map((name) => {
    const dot = name.indexOf(".");
    return dot > 0
      ? { table: aliases.get(name.slice(0, dot)), column: name.slice(dot + 1) }
      : { table: shape.joins.length ? null : shape.base.table, column: name };
  });
  return { sample_count: kept.length, bad_count: bad.length, columns, tables: [...aliases.values()] };
}
