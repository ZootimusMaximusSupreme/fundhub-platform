// Finish-853 batch 26 (repair cycle 1): a very small SQL reader for practice tests.
// Tests only; nothing here is product code. Fake data, no network, no database.
//
// WHY THIS EXISTS. The first batch 26 stand-ins answered a statement by regular expressions and
// built the result columns themselves. A checker broke the product on purpose (dropped a column from
// a SELECT list, wrote 'posted' where the SQL said 'queued', counted the wrong outcome in an
// aggregate) and the tests stayed green, because the stand-in never read that part of the
// statement. This file reads the part that was not read:
//
//   evalSql(text, ctx)          one SQL expression: column, $n, literals, CASE, COALESCE, comparisons,
//                               ||, + and -, ::casts, count(*) [FILTER (WHERE ...)] [OVER ()], SUM.
//   selectList(sql, pick)       the output columns the SELECT names, in order, with their expressions.
//   projectRow(items, ctx)      one result row built ONLY from those named columns.
//   runUpdate / runInsert       an UPDATE or INSERT ... ON CONFLICT DO UPDATE ... RETURNING applied to
//                               stand-in rows by what the statement says.
//   orderRows                   ORDER BY as the statement spells it (direction, NULLS LAST).
//
// RULE OF THE FILE: anything it cannot read, it throws. A statement the product changed into a shape
// this file does not know is a red test, never a quiet pass.
import { plainSql } from "./s3-scoped-rows.mjs";

/* ───────────────────────────── text helpers ───────────────────────────── */

/** SQL text with comments removed and runs of white space collapsed. Quotes are kept as they are. */
export function cleanSql(sql) {
  let out = "";
  const text = String(sql);
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += " ";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      out += " ";
    } else out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Walk text and call fn(char, index, depth) for every character outside quotes. Return what fn returns when not undefined. */
function scanTop(text, fn) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      i += 1;
      while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1;
      continue;
    }
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    const got = fn(ch, i, depth);
    if (got !== undefined) return got;
  }
  return undefined;
}

/** Split on a top-level separator (a single character such as ","). */
export function splitTop(text, sep = ",") {
  const parts = [];
  let last = 0;
  scanTop(text, (ch, i, depth) => {
    if (ch === sep && depth === 0) { parts.push(text.slice(last, i)); last = i + 1; }
    return undefined;
  });
  parts.push(text.slice(last));
  return parts.map((p) => p.trim()).filter((p) => p.length);
}

/** Index of the first top-level (depth 0) match of a word, or -1. `word` is plain text such as "WHERE". */
function findTop(text, word, from = 0) {
  const re = new RegExp(`^${word.replace(/ /g, "\\s+")}\\b`, "i");
  const hit = scanTop(text, (ch, i, depth) => {
    if (depth !== 0 || i < from) return undefined;
    if (i > 0 && /\w/.test(text[i - 1])) return undefined;
    return re.test(text.slice(i)) ? i : undefined;
  });
  return hit === undefined ? -1 : hit;
}

/* ─────────────────────────────── tokens ──────────────────────────────── */

const WORDS = new Set([
  "case", "when", "then", "else", "end", "and", "or", "not", "is", "null", "true", "false",
  "in", "like", "ilike", "distinct", "from", "filter", "over", "where", "any", "both", "as",
]);

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < text.length) {
        if (text[j] === "'" && text[j + 1] === "'") { value += "'"; j += 2; continue; }
        if (text[j] === "'") break;
        value += text[j];
        j += 1;
      }
      tokens.push({ t: "str", v: value });
      i = j + 1;
      continue;
    }
    if (ch === "$" && /\d/.test(text[i + 1] || "")) {
      let j = i + 1;
      while (/\d/.test(text[j] || "")) j += 1;
      tokens.push({ t: "param", v: Number(text.slice(i + 1, j)) });
      i = j;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (/[\d.]/.test(text[j] || "")) j += 1;
      tokens.push({ t: "num", v: Number(text.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (/[\w]/.test(text[j] || "")) j += 1;
      const word = text.slice(i, j);
      tokens.push({ t: WORDS.has(word.toLowerCase()) ? "kw" : "id", v: word, lc: word.toLowerCase() });
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (["::", "||", "<>", "!=", ">=", "<="].includes(two)) { tokens.push({ t: "op", v: two }); i += 2; continue; }
    if ("=<>+-*/(),.[]".includes(ch)) { tokens.push({ t: "op", v: ch }); i += 1; continue; }
    throw new Error(`stand-in SQL reader: cannot read "${ch}" in: ${text}`);
  }
  return tokens;
}

/* ─────────────────────────────── parser ──────────────────────────────── */

function parse(text) {
  const tokens = tokenize(text);
  let p = 0;
  const peek = (o = 0) => tokens[p + o];
  const is = (v, o = 0) => { const t = tokens[p + o]; return t && (t.t === "op" || t.t === "kw") && (t.lc || t.v) === v; };
  const eat = (v) => { if (!is(v)) throw new Error(`stand-in SQL reader: expected ${v} near token ${p} in: ${text}`); p += 1; };

  function orExpr() {
    let left = andExpr();
    while (is("or")) { p += 1; left = { k: "or", a: left, b: andExpr() }; }
    return left;
  }
  function andExpr() {
    let left = notExpr();
    while (is("and")) { p += 1; left = { k: "and", a: left, b: notExpr() }; }
    return left;
  }
  function notExpr() {
    if (is("not")) { p += 1; return { k: "not", a: notExpr() }; }
    return cmpExpr();
  }
  function cmpExpr() {
    const left = concatExpr();
    if (is("is")) {
      p += 1;
      let negate = false;
      if (is("not")) { p += 1; negate = true; }
      if (is("null")) { p += 1; return { k: "isnull", a: left, negate }; }
      if (is("true")) { p += 1; return { k: "istruth", a: left, want: true, negate }; }
      if (is("false")) { p += 1; return { k: "istruth", a: left, want: false, negate }; }
      if (is("distinct")) { p += 1; eat("from"); return { k: "distinct", a: left, b: concatExpr(), negate }; }
      throw new Error(`stand-in SQL reader: unknown IS form in: ${text}`);
    }
    for (const op of ["=", "<>", "!=", "<=", ">=", "<", ">"]) {
      if (is(op)) {
        p += 1;
        if (op === "=" && peek() && peek().lc === "any" && is("(", 1)) {
          p += 2;
          const inner = orExpr();
          eat(")");
          return { k: "any", a: left, b: inner };
        }
        return { k: "cmp", op: op === "!=" ? "<>" : op, a: left, b: concatExpr() };
      }
    }
    if (is("in")) {
      p += 1; eat("(");
      const list = [orExpr()];
      while (is(",")) { p += 1; list.push(orExpr()); }
      eat(")");
      return { k: "in", a: left, list };
    }
    if (is("ilike") || is("like")) {
      const ci = is("ilike");
      p += 1;
      return { k: "like", a: left, b: concatExpr(), ci };
    }
    return left;
  }
  function concatExpr() {
    let left = addExpr();
    while (is("||")) { p += 1; left = { k: "concat", a: left, b: addExpr() }; }
    return left;
  }
  function addExpr() {
    let left = mulExpr();
    while (is("+") || is("-")) { const op = peek().v; p += 1; left = { k: "arith", op, a: left, b: mulExpr() }; }
    return left;
  }
  function mulExpr() {
    let left = unary();
    while (is("*") || is("/")) { const op = peek().v; p += 1; left = { k: "arith", op, a: left, b: unary() }; }
    return left;
  }
  function unary() {
    if (is("-")) { p += 1; return { k: "arith", op: "-", a: { k: "lit", v: 0 }, b: unary() }; }
    return postfix();
  }
  function postfix() {
    let node = primary();
    while (is("::")) {
      p += 1;
      const name = peek();
      if (!name || (name.t !== "id" && name.t !== "kw")) throw new Error(`stand-in SQL reader: bad cast in: ${text}`);
      p += 1;
      let type = (name.lc || name.v.toLowerCase());
      if (is("(")) { while (!is(")")) p += 1; p += 1; }
      if (is("[")) { p += 1; eat("]"); type += "[]"; }
      node = { k: "cast", a: node, type };
    }
    return node;
  }
  function primary() {
    const t = peek();
    if (!t) throw new Error(`stand-in SQL reader: unexpected end of: ${text}`);
    if (t.t === "num") { p += 1; return { k: "lit", v: t.v }; }
    if (t.t === "str") { p += 1; return { k: "lit", v: t.v, str: true }; }
    if (t.t === "param") { p += 1; return { k: "param", n: t.v }; }
    if (is("null")) { p += 1; return { k: "lit", v: null }; }
    if (is("true")) { p += 1; return { k: "lit", v: true }; }
    if (is("false")) { p += 1; return { k: "lit", v: false }; }
    if (is("(")) {
      p += 1;
      const inner = orExpr();
      eat(")");
      return inner;
    }
    if (is("case")) {
      p += 1;
      const arms = [];
      let other = { k: "lit", v: null };
      while (is("when")) {
        p += 1;
        const cond = orExpr();
        eat("then");
        arms.push([cond, orExpr()]);
      }
      if (is("else")) { p += 1; other = orExpr(); }
      eat("end");
      return { k: "case", arms, other };
    }
    if (t.t === "id" || (t.t === "kw" && ["any", "filter", "over", "both"].includes(t.lc))) {
      p += 1;
      if (is("(")) {
        p += 1;
        const name = (t.lc || t.v.toLowerCase());
        if (name === "trim" && peek() && peek().lc === "both") {
          p += 1;
          p += 1; // the character to trim, a quoted string
          eat("from");
          const inner = orExpr();
          eat(")");
          return { k: "fn", name: "btrim", args: [inner] };
        }
        const args = [];
        let star = false;
        if (is("*")) { p += 1; star = true; } else if (!is(")")) {
          args.push(orExpr());
          while (is(",")) { p += 1; args.push(orExpr()); }
        }
        eat(")");
        const call = { k: "fn", name, args, star };
        if (peek() && peek().lc === "filter" && is("(", 1)) {
          p += 2;
          eat("where");
          call.filter = orExpr();
          eat(")");
        }
        if (peek() && peek().lc === "over" && is("(", 1)) {
          p += 2;
          eat(")");
          call.over = true;
        }
        return call;
      }
      if (is(".") && peek(1) && (peek(1).t === "id" || peek(1).t === "kw")) {
        p += 1;
        const col = peek();
        p += 1;
        return { k: "col", alias: (t.lc || t.v.toLowerCase()), name: col.lc || col.v.toLowerCase() };
      }
      return { k: "col", alias: null, name: (t.lc || t.v.toLowerCase()) };
    }
    if (is("*")) { p += 1; return { k: "star" }; }
    throw new Error(`stand-in SQL reader: cannot read near "${t.v}" in: ${text}`);
  }

  const ast = orExpr();
  if (p < tokens.length) throw new Error(`stand-in SQL reader: leftover "${tokens[p].v}" in: ${text}`);
  return ast;
}

const parsed = new Map();
const astOf = (text) => {
  const key = cleanSql(text);
  if (!parsed.has(key)) parsed.set(key, parse(key));
  return parsed.get(key);
};

/* ───────────────────────────── evaluation ────────────────────────────── */

const isNil = (v) => v === null || v === undefined;

function lookupColumn(node, ctx) {
  const rows = ctx.rows || {};
  if (node.alias) {
    if (!(node.alias in rows)) {
      throw new Error(`stand-in SQL reader: no row named "${node.alias}" in scope for ${node.alias}.${node.name}`);
    }
    const row = rows[node.alias];
    if (isNil(row)) return null;
    return row[node.name] === undefined ? null : row[node.name];
  }
  if (ctx.row && node.name in ctx.row) return ctx.row[node.name] === undefined ? null : ctx.row[node.name];
  for (const alias of Object.keys(rows)) {
    const row = rows[alias];
    if (row && node.name in row) return row[node.name] === undefined ? null : row[node.name];
  }
  return null;
}

function castTo(value, type) {
  if (isNil(value)) return null;
  switch (type) {
    case "jsonb": case "json":
      if (typeof value === "string") { try { return JSON.parse(value); } catch { return value; } }
      return value;
    case "date": return String(value).slice(0, 10);
    case "int": case "integer": case "bigint": case "smallint": return Number(value);
    case "boolean": return value === true || value === "true";
    case "interval": {
      const m = /^\s*(-?\d+(?:\.\d+)?)\s+seconds?\s*$/i.exec(String(value));
      if (!m) throw new Error(`stand-in SQL reader: cannot read interval "${value}"`);
      return { __interval: Number(m[1]) };
    }
    case "text": case "varchar": return typeof value === "object" ? value : String(value);
    default: return value; // uuid, timestamptz, enum names, arrays: the stand-in keeps the value as it is
  }
}

const same = (a, b) => (typeof a === "number" && typeof b === "number" ? a === b : String(a) === String(b));
function compare(op, a, b) {
  if (isNil(a) || isNil(b)) return null;
  if (op === "=") return same(a, b);
  if (op === "<>") return !same(a, b);
  const num = typeof a === "number" && typeof b === "number";
  const x = num ? a : String(a);
  const y = num ? b : String(b);
  if (op === "<") return x < y;
  if (op === ">") return x > y;
  if (op === "<=") return x <= y;
  return x >= y;
}

/** Evaluate a SQL expression. ctx: { params, rows: {alias: row}, row, excluded via rows.excluded, group, window, now }. */
export function evalSql(text, ctx = {}) {
  return ev(astOf(text), ctx);
}

function ev(node, ctx) {
  switch (node.k) {
    case "lit": return node.v;
    case "param": {
      const v = (ctx.params || [])[node.n - 1];
      return v === undefined ? null : v;
    }
    case "col": return lookupColumn(node, ctx);
    case "cast": return castTo(ev(node.a, ctx), node.type);
    case "not": { const v = ev(node.a, ctx); return isNil(v) ? null : !v; }
    case "and": {
      const a = ev(node.a, ctx);
      if (a === false) return false;
      const b = ev(node.b, ctx);
      if (b === false) return false;
      return a === null || b === null ? null : true;
    }
    case "or": {
      const a = ev(node.a, ctx);
      if (a === true) return true;
      const b = ev(node.b, ctx);
      if (b === true) return true;
      return a === null || b === null ? null : false;
    }
    case "isnull": { const v = isNil(ev(node.a, ctx)); return node.negate ? !v : v; }
    case "istruth": { const v = ev(node.a, ctx) === node.want; return node.negate ? !v : v; }
    case "distinct": {
      const a = ev(node.a, ctx); const b = ev(node.b, ctx);
      const diff = isNil(a) || isNil(b) ? !(isNil(a) && isNil(b)) : !same(a, b);
      return node.negate ? !diff : diff;
    }
    case "cmp": return compare(node.op, ev(node.a, ctx), ev(node.b, ctx));
    case "any": {
      const v = ev(node.a, ctx); const list = ev(node.b, ctx);
      if (isNil(v) || isNil(list)) return null;
      return (Array.isArray(list) ? list : [list]).some((x) => same(x, v));
    }
    case "in": {
      const v = ev(node.a, ctx);
      if (isNil(v)) return null;
      return node.list.some((n) => same(ev(n, ctx), v));
    }
    case "like": {
      const v = ev(node.a, ctx); const pat = ev(node.b, ctx);
      if (isNil(v) || isNil(pat)) return null;
      const body = String(pat).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
      return new RegExp(`^${body}$`, node.ci ? "i" : "").test(String(v));
    }
    case "concat": {
      const a = ev(node.a, ctx); const b = ev(node.b, ctx);
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      if (isNil(a) || isNil(b)) return null;
      return `${a}${b}`;
    }
    case "arith": {
      const a = ev(node.a, ctx); const b = ev(node.b, ctx);
      if (isNil(a) || isNil(b)) return null;
      if (b && typeof b === "object" && "__interval" in b) {
        return { plusSeconds: node.op === "+" ? b.__interval : -b.__interval };
      }
      if (node.op === "+") return Number(a) + Number(b);
      if (node.op === "-") return Number(a) - Number(b);
      if (node.op === "*") return Number(a) * Number(b);
      return Number(a) / Number(b);
    }
    case "case": {
      for (const [cond, value] of node.arms) if (ev(cond, ctx) === true) return ev(value, ctx);
      return ev(node.other, ctx);
    }
    case "fn": return callFn(node, ctx);
    case "star": throw new Error("stand-in SQL reader: a bare * is not a value");
    default: throw new Error(`stand-in SQL reader: unknown node ${node.k}`);
  }
}

function callFn(node, ctx) {
  const name = node.name;
  if (name === "count" || name === "sum") {
    const rows = node.over ? (ctx.window || ctx.group) : ctx.group;
    if (!rows) throw new Error(`stand-in SQL reader: ${name}() needs rows to aggregate`);
    const kept = node.filter ? rows.filter((r) => ev(node.filter, r) === true) : rows;
    if (name === "count") {
      if (node.star) return kept.length;
      return kept.filter((r) => !isNil(ev(node.args[0], r))).length;
    }
    const values = kept.map((r) => ev(node.args[0], r)).filter((v) => !isNil(v));
    return values.length ? values.reduce((n, v) => n + Number(v), 0) : null;
  }
  const args = node.args.map((a) => ev(a, ctx));
  switch (name) {
    case "now": return ctx.now || new Date().toISOString();
    case "coalesce": { for (const a of args) if (!isNil(a)) return a; return null; }
    case "nullif": return same(args[0], args[1]) ? null : args[0];
    case "btrim": return isNil(args[0]) ? null : String(args[0]).trim();
    case "lower": return isNil(args[0]) ? null : String(args[0]).toLowerCase();
    case "concat_ws": {
      const [sep, ...rest] = args;
      return rest.filter((v) => !isNil(v)).join(sep);
    }
    default: throw new Error(`stand-in SQL reader: does not know the function ${name}()`);
  }
}

/* ───────────────────────── select lists and rows ─────────────────────── */

/**
 * The output columns of one SELECT in a statement. `pick` chooses which SELECT: a number (the nth,
 * counting from 0) or a RegExp tested against the text of each SELECT list.
 * Returns [{ expr, name, star }].
 */
export function selectList(sql, pick = 0) {
  const text = cleanSql(sql);
  const lists = [];
  // Find every SELECT keyword outside quotes, at any depth.
  let inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "'") { inQuote = !inQuote; continue; }
    if (inQuote) continue;
    if (/^select\b/i.test(text.slice(i)) && (i === 0 || !/\w/.test(text[i - 1]))) {
      let j = i + 6;
      let depth = 0;
      let end = -1;
      let q = false;
      for (; j < text.length; j += 1) {
        const ch = text[j];
        if (ch === "'") { q = !q; continue; }
        if (q) continue;
        if (ch === "(") depth += 1;
        else if (ch === ")") { if (depth === 0) { end = j; break; } depth -= 1; }
        else if (depth === 0 && /^from\b/i.test(text.slice(j)) && !/\w/.test(text[j - 1])) { end = j; break; }
      }
      if (end === -1) end = text.length;
      lists.push(text.slice(i + 6, end).trim());
    }
  }
  const raw = typeof pick === "number" ? lists[pick] : lists.find((l) => pick.test(l));
  if (raw === undefined) throw new Error(`stand-in SQL reader: no SELECT list matched ${String(pick)} in: ${plainSql(sql)}`);
  return itemsOf(raw.replace(/^DISTINCT\s+ON\s*\([^)]*\)\s*/i, "").replace(/^DISTINCT\s+/i, ""));
}

/** The items of a list such as a SELECT or RETURNING list. */
export function itemsOf(raw) {
  return splitTop(raw, ",").map((item) => {
    const as = /^(.*?)\s+AS\s+([A-Za-z_]\w*)$/is.exec(item);
    if (as) return { expr: as[1].trim(), name: as[2].toLowerCase() };
    if (/^\*$/.test(item)) return { star: "*" };
    const starred = /^(\w+)\.\*$/.exec(item);
    if (starred) return { star: starred[1].toLowerCase() };
    const dotted = /^(?:\w+)\.(\w+)$/.exec(item);
    if (dotted) return { expr: item, name: dotted[1].toLowerCase() };
    if (/^\w+$/.test(item)) return { expr: item, name: item.toLowerCase() };
    throw new Error(`stand-in SQL reader: a computed output column needs a name: ${item}`);
  });
}

/** One result row built only from the columns the list names. */
export function projectRow(items, ctx) {
  const out = {};
  for (const item of items) {
    if (item.star) {
      const sources = item.star === "*" ? Object.values(ctx.rows || {}) : [(ctx.rows || {})[item.star]];
      for (const row of sources) Object.assign(out, row || {});
    } else {
      const value = evalSql(item.expr, ctx);
      out[item.name] = value === undefined ? null : value;
    }
  }
  return out;
}

/** The names of the output columns (a star is reported as "*"). */
export const namesOf = (items) => items.map((i) => (i.star ? "*" : i.name));

/**
 * Sort rows by an ORDER BY clause as the statement spells it. `ctxOf(row)` gives the evaluation scope of a row.
 * `orderText` is the text after ORDER BY, up to LIMIT.
 */
export function orderRows(rows, orderText, ctxOf = (row) => ({ row })) {
  const terms = splitTop(cleanSql(orderText), ",").map((term) => {
    const m = /^(.*?)(?:\s+(ASC|DESC))?(?:\s+NULLS\s+(FIRST|LAST))?$/i.exec(term);
    const desc = (m[2] || "ASC").toUpperCase() === "DESC";
    // Postgres: NULLs sort as the largest value, so they are last ascending and first descending.
    const nullsLast = m[3] ? m[3].toUpperCase() === "LAST" : !desc;
    return { expr: m[1].trim(), desc, nullsLast };
  });
  return [...rows].sort((a, b) => {
    for (const term of terms) {
      const x = evalSql(term.expr, ctxOf(a)); const y = evalSql(term.expr, ctxOf(b));
      if (isNil(x) && isNil(y)) continue;
      if (isNil(x)) return term.nullsLast ? 1 : -1;
      if (isNil(y)) return term.nullsLast ? -1 : 1;
      const num = typeof x === "number" && typeof y === "number";
      const c = num ? x - y : String(x).localeCompare(String(y));
      if (c !== 0) return term.desc ? -c : c;
    }
    return 0;
  });
}

/* ───────────────────────── UPDATE and INSERT ─────────────────────────── */

function parseAssignments(text) {
  return splitTop(text, ",").map((part) => {
    const eq = part.indexOf("=");
    if (eq === -1) throw new Error(`stand-in SQL reader: cannot read the assignment: ${part}`);
    return [part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim()];
  });
}

/** Split text at the top-level words given, in order of appearance. Returns { head, <word>: text } for the words found. */
function sections(text, words) {
  const marks = words.map((w) => [w, findTop(text, w)]).filter(([, at]) => at !== -1).sort((a, b) => a[1] - b[1]);
  const out = { head: text.slice(0, marks.length ? marks[0][1] : text.length).trim() };
  marks.forEach(([w, at], k) => {
    const end = k + 1 < marks.length ? marks[k + 1][1] : text.length;
    out[w.toUpperCase()] = text.slice(at + w.length, end).trim();
  });
  return out;
}

/**
 * Apply an UPDATE to stand-in rows. Every row the WHERE keeps is changed by the SET list as the
 * statement spells it (values are worked out from the OLD row, as SQL does) and RETURNING is read.
 * Returns { rows, rowCount }. `rows` is the live array of the table.
 */
export function runUpdate(sql, params, rows, { now } = {}) {
  const text = cleanSql(sql);
  const m = /^UPDATE\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?\s+SET\s+/i.exec(text);
  if (!m) throw new Error(`stand-in SQL reader: not an UPDATE I can read: ${plainSql(sql)}`);
  const table = m[1].toLowerCase();
  const rest = text.slice(m[0].length);
  const parts = sections(rest, ["WHERE", "RETURNING"]);
  const sets = parseAssignments(parts.head);
  const hit = rows.filter((row) => {
    if (parts.WHERE === undefined) return true;
    return evalSql(parts.WHERE, { params, now, rows: { [table]: row }, row }) === true;
  });
  const out = [];
  for (const row of hit) {
    const ctx = { params, now, rows: { [table]: row }, row };
    const next = {};
    for (const [col, expr] of sets) next[col] = evalSql(expr, ctx);
    Object.assign(row, next);
    if (parts.RETURNING !== undefined) {
      out.push(projectRow(itemsOf(parts.RETURNING), { params, now, rows: { [table]: row }, row }));
    }
  }
  return { rows: out, rowCount: hit.length };
}

/**
 * Apply an INSERT (optionally ON CONFLICT (...) DO UPDATE SET ... [WHERE ...]) to stand-in rows.
 * `fill(row)` may add what the database adds itself (an id, a default, a trigger's value).
 * Returns { rows, rowCount, inserted, row }.
 */
export function runInsert(sql, params, rows, { now, fill = (row) => row } = {}) {
  const text = cleanSql(sql);
  const m = /^INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*/i.exec(text);
  if (!m) throw new Error(`stand-in SQL reader: not an INSERT I can read: ${plainSql(sql)}`);
  const table = m[1].toLowerCase();
  const columns = m[2].split(",").map((c) => c.trim().toLowerCase());
  const afterValues = text.slice(m[0].length);
  if (afterValues[0] !== "(") throw new Error(`stand-in SQL reader: VALUES without a list: ${plainSql(sql)}`);
  let close = -1;
  scanTop(afterValues, (ch, i, d) => {
    if (ch === ")" && d === 0 && close === -1) { close = i; return i; }
    return undefined;
  });
  if (close === -1) throw new Error(`stand-in SQL reader: VALUES list not closed: ${plainSql(sql)}`);
  const valueTexts = splitTop(afterValues.slice(1, close), ",");
  if (valueTexts.length !== columns.length) {
    throw new Error(`stand-in SQL reader: ${columns.length} columns but ${valueTexts.length} values in: ${plainSql(sql)}`);
  }
  const tail = afterValues.slice(close + 1).trim();
  const ctx0 = { params, now, rows: {} };
  const proposed = {};
  columns.forEach((col, k) => { proposed[col] = evalSql(valueTexts[k], ctx0); });
  const parts = sections(tail, ["ON CONFLICT", "RETURNING"]);
  let target = null;
  let inserted = false;
  if (parts["ON CONFLICT"] !== undefined) {
    const text = parts["ON CONFLICT"];
    const nothing = /^(?:\([^)]*\)\s*)?DO\s+NOTHING$/i.test(text);
    // ON CONFLICT (cols) [WHERE <partial index predicate>] DO UPDATE SET ... [WHERE <guard>]
    const conflict = /^\(([^)]*)\)\s*(?:WHERE\s+([\s\S]*?)\s+)?DO\s+UPDATE\s+SET\s+([\s\S]*)$/i.exec(text);
    if (nothing) {
      target = fill({ ...proposed });
      rows.push(target);
      inserted = true;
    } else if (!conflict) {
      throw new Error(`stand-in SQL reader: cannot read ON CONFLICT in: ${plainSql(sql)}`);
    } else {
      const keys = conflict[1].split(",").map((c) => c.trim().toLowerCase());
      const predicate = conflict[2];
      const existing = rows.find((row) => keys.every((k) => !isNil(proposed[k]) && same(row[k], proposed[k]))
        && (!predicate || evalSql(predicate, { params, now, rows: { [table]: row }, row }) === true));
      if (existing) {
        const setWhere = sections(conflict[3], ["WHERE"]);
        const ctx = { params, now, rows: { [table]: existing, excluded: proposed }, row: existing };
        const allowed = setWhere.WHERE === undefined || evalSql(setWhere.WHERE, ctx) === true;
        if (allowed) {
          const next = {};
          for (const [col, expr] of parseAssignments(setWhere.head)) next[col] = evalSql(expr, ctx);
          Object.assign(existing, next);
          target = existing;
        }
      } else {
        target = fill({ ...proposed });
        rows.push(target);
        inserted = true;
      }
    }
  } else {
    target = fill({ ...proposed });
    rows.push(target);
    inserted = true;
  }
  if (!target) return { rows: [], rowCount: 0, inserted: false, row: null };
  const out = parts.RETURNING === undefined
    ? []
    : [projectRow(itemsOf(parts.RETURNING), { params, now, rows: { [table]: target }, row: target })];
  return { rows: out, rowCount: 1, inserted, row: target };
}

/** The text of one SQL statement's WHERE clause (after WHERE, before ORDER BY / GROUP BY / LIMIT / RETURNING). */
export function whereOf(sql) {
  const text = cleanSql(sql);
  const parts = sections(text, ["WHERE", "GROUP BY", "ORDER BY", "LIMIT", "RETURNING", "FOR UPDATE"]);
  return parts.WHERE === undefined ? null : parts.WHERE;
}

/** The text after ORDER BY (before LIMIT), or null. */
export function orderOf(sql) {
  const text = cleanSql(sql);
  const parts = sections(text, ["ORDER BY", "LIMIT", "FOR UPDATE"]);
  return parts["ORDER BY"] === undefined ? null : parts["ORDER BY"];
}

/** Keep the rows of a table for which a WHERE text is true under the call's params. */
export function keep(rows, whereText, params, { alias = null, extra = () => ({}), now } = {}) {
  if (!whereText) return rows.slice();
  return rows.filter((row) => evalSql(whereText, {
    params, now, row, rows: { ...(alias ? { [alias]: row } : {}), ...extra(row) },
  }) === true);
}
