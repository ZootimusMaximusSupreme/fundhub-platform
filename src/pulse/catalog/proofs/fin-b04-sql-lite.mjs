// A small, read-only stand-in for Postgres, used only by tests.
//
// WHY IT EXISTS. There is no local Postgres on this Mac, and the display lane's
// saved-result checks are SQL. A test that hands the SQL a canned answer cannot
// go red when the SQL is wrong. This runs the real SQL text over rows a test
// holds in memory, so a bad row is counted bad and a lost condition shows.
//
// WHAT IT IS NOT. It is not Postgres. It reads exactly the shapes the display
// contracts use (SELECT with count(), FILTER, LEFT JOIN, EXISTS, IN, CASE, jsonb
// ->> / ->, regex, LIKE, interval, AT TIME ZONE) and throws on anything else.
// It uses SQL's three-valued logic (null is "unknown"). It refuses a table or a
// column that the repo's own migrations do not define, so a contract cannot
// quietly name a column nobody writes.
//
// It never writes anything. There is no INSERT, UPDATE or DELETE in its grammar.

import fs from "node:fs";
import path from "node:path";

// ── column catalog, read from db/schema and db/migrations ───────────────────

const CONSTRAINT_START = /^(constraint|primary|unique|foreign|check|exclude|like)\b/i;

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  let quote = null;
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function tableName(raw) {
  return String(raw).replace(/^public\./i, "").replace(/"/g, "").toLowerCase();
}

/** Map of table name to the set of column names every migration adds to it. */
export function readColumnCatalog(root) {
  const catalog = new Map();
  const add = (table, column) => {
    if (!catalog.has(table)) catalog.set(table, new Set());
    catalog.get(table).add(String(column).replace(/"/g, "").toLowerCase());
  };
  for (const dir of ["schema", "migrations"]) {
    const folder = path.join(root, "db", dir);
    for (const file of fs.readdirSync(folder).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = stripComments(fs.readFileSync(path.join(folder, file), "utf8"));
      const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(/gi;
      let m;
      while ((m = create.exec(sql))) {
        const table = tableName(m[1]);
        let depth = 1;
        let i = create.lastIndex;
        while (i < sql.length && depth > 0) {
          if (sql[i] === "(") depth += 1;
          if (sql[i] === ")") depth -= 1;
          i += 1;
        }
        for (const part of splitTopLevel(sql.slice(create.lastIndex, i - 1))) {
          const item = part.trim();
          if (!item || CONSTRAINT_START.test(item)) continue;
          const name = item.match(/^("?)([a-z_][\w]*)\1/i);
          if (name) add(table, name[2]);
        }
      }
      const alter = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+([^;]*);/gi;
      while ((m = alter.exec(sql))) {
        const table = tableName(m[1]);
        const adds = m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_]\w*)"?/gi);
        for (const a of adds) add(table, a[1]);
      }
    }
  }
  return catalog;
}

// ── tokens ──────────────────────────────────────────────────────────────────

const OPS = ["->>", "->", "::", "<>", "!=", "<=", ">=", "||", "!~*", "!~", "~*", "~", "=", "<", ">", "+", "-", "*", "/", "(", ")", ",", "."];

function tokenize(sql) {
  const out = [];
  let i = 0;
  const s = stripComments(sql);
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === "'") {
      let j = i + 1;
      let v = "";
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { v += "'"; j += 2; continue; }
        if (s[j] === "'") break;
        v += s[j];
        j += 1;
      }
      out.push({ t: "str", v });
      i = j + 1;
      continue;
    }
    if (ch === "$" && /\d/.test(s[i + 1] || "")) {
      const m = /^\$(\d+)/.exec(s.slice(i));
      out.push({ t: "param", v: Number(m[1]) });
      i += m[0].length;
      continue;
    }
    if (/\d/.test(ch)) {
      const m = /^\d+(?:\.\d+)?/.exec(s.slice(i));
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (!op) throw new Error(`sql-lite: cannot read ${JSON.stringify(s.slice(i, i + 12))}`);
    out.push({ t: "op", v: op });
    i += op.length;
  }
  return out;
}

// ── parser ──────────────────────────────────────────────────────────────────

const RESERVED = new Set(["left", "join", "on", "where", "from", "group", "order", "limit", "and", "or", "not",
  "filter", "select", "as", "is", "in", "like", "ilike", "then", "else", "end", "when", "case", "inner", "cross"]);

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek(o = 0) { return this.tokens[this.pos + o]; }
  next() { return this.tokens[this.pos++]; }
  isKw(word, o = 0) { const t = this.peek(o); return !!t && t.t === "id" && t.v.toLowerCase() === word; }
  isOp(v, o = 0) { const t = this.peek(o); return !!t && t.t === "op" && t.v === v; }
  eatKw(word) { if (this.isKw(word)) { this.pos += 1; return true; } return false; }
  eatOp(v) { if (this.isOp(v)) { this.pos += 1; return true; } return false; }
  needKw(word) { if (!this.eatKw(word)) throw new Error(`sql-lite: expected ${word.toUpperCase()}, got ${JSON.stringify(this.peek())}`); }
  needOp(v) { if (!this.eatOp(v)) throw new Error(`sql-lite: expected ${v}, got ${JSON.stringify(this.peek())}`); }

  parseSelect() {
    this.needKw("select");
    const distinct = this.eatKw("distinct");
    const items = [];
    do {
      const expr = this.parseExpr();
      let alias = null;
      if (this.eatKw("as")) alias = this.next().v;
      items.push({ expr, alias });
    } while (this.eatOp(","));
    this.needKw("from");
    const from = this.parseFromItem();
    const joins = [];
    while (this.isKw("left")) {
      this.next();
      this.eatKw("outer");
      this.needKw("join");
      const item = this.parseFromItem();
      this.needKw("on");
      joins.push({ from: item, on: this.parseExpr() });
    }
    let where = null;
    if (this.eatKw("where")) where = this.parseExpr();
    return { type: "select", distinct, items, from, joins, where };
  }

  parseFromItem() {
    const name = this.next();
    if (!name || name.t !== "id") throw new Error("sql-lite: expected a table name");
    if (name.v.toLowerCase() === "jsonb_array_elements") {
      this.needOp("(");
      const expr = this.parseExpr();
      this.needOp(")");
      this.eatKw("as");
      return { kind: "elements", expr, alias: this.next().v };
    }
    let alias = name.v;
    const t = this.peek();
    if (this.eatKw("as")) alias = this.next().v;
    else if (t && t.t === "id" && !RESERVED.has(t.v.toLowerCase())) alias = this.next().v;
    return { kind: "table", name: name.v.toLowerCase(), alias };
  }

  parseExpr() { return this.parseOr(); }

  parseOr() {
    let l = this.parseAnd();
    while (this.eatKw("or")) l = { type: "or", l, r: this.parseAnd() };
    return l;
  }

  parseAnd() {
    let l = this.parseNot();
    while (this.eatKw("and")) l = { type: "and", l, r: this.parseNot() };
    return l;
  }

  parseNot() {
    if (this.isKw("not") && !this.isKw("exists", 1)) { this.next(); return { type: "not", e: this.parseNot() }; }
    return this.parsePredicate();
  }

  parsePredicate() {
    const l = this.parseConcat();
    if (this.isKw("is")) {
      this.next();
      const not = this.eatKw("not");
      if (this.eatKw("null")) return { type: "isnull", e: l, not };
      if (this.eatKw("distinct")) { this.needKw("from"); return { type: "isdistinct", l, r: this.parseConcat(), not: !not }; }
      if (this.eatKw("true")) return { type: "istruth", e: l, want: true, not };
      if (this.eatKw("false")) return { type: "istruth", e: l, want: false, not };
      throw new Error("sql-lite: unsupported IS form");
    }
    let not = false;
    if (this.isKw("not") && (this.isKw("in", 1) || this.isKw("like", 1) || this.isKw("ilike", 1))) { this.next(); not = true; }
    if (this.eatKw("in")) {
      this.needOp("(");
      if (this.isKw("select")) {
        const select = this.parseSelect();
        this.needOp(")");
        return { type: "in", e: l, select, not };
      }
      const list = [];
      do list.push(this.parseConcat()); while (this.eatOp(","));
      this.needOp(")");
      return { type: "in", e: l, list, not };
    }
    if (this.isKw("like") || this.isKw("ilike")) {
      const ci = this.next().v.toLowerCase() === "ilike";
      return { type: "like", e: l, pat: this.parseConcat(), not, ci };
    }
    const t = this.peek();
    if (t && t.t === "op" && ["=", "<>", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      this.next();
      if (t.v === "=" && this.isKw("any")) {
        this.next();
        this.needOp("(");
        const arr = this.parseExpr();
        this.needOp(")");
        return { type: "anyeq", l, arr };
      }
      return { type: "cmp", op: t.v === "!=" ? "<>" : t.v, l, r: this.parseConcat() };
    }
    if (t && t.t === "op" && ["~", "~*", "!~", "!~*"].includes(t.v)) {
      this.next();
      return { type: "regex", e: l, pat: this.parseConcat(), not: t.v.startsWith("!"), ci: t.v.endsWith("*") };
    }
    return l;
  }

  parseConcat() {
    let l = this.parseAdd();
    while (this.eatOp("||")) l = { type: "concat", l, r: this.parseAdd() };
    return l;
  }

  parseAdd() {
    let l = this.parseMul();
    for (;;) {
      if (this.eatOp("+")) l = { type: "arith", op: "+", l, r: this.parseMul() };
      else if (this.isOp("-")) { this.next(); l = { type: "arith", op: "-", l, r: this.parseMul() }; }
      else return l;
    }
  }

  parseMul() {
    let l = this.parsePostfix();
    for (;;) {
      if (this.eatOp("*")) l = { type: "arith", op: "*", l, r: this.parsePostfix() };
      else if (this.eatOp("/")) l = { type: "arith", op: "/", l, r: this.parsePostfix() };
      else return l;
    }
  }

  parsePostfix() {
    let e = this.parsePrimary();
    for (;;) {
      if (this.eatOp("::")) { e = { type: "cast", e, to: this.next().v.toLowerCase() }; continue; }
      if (this.isOp("->>") || this.isOp("->")) {
        const op = this.next().v;
        e = { type: "json", op, e, key: this.parsePrimary() };
        continue;
      }
      if (this.isKw("at") && this.isKw("time", 1) && this.isKw("zone", 2)) {
        this.pos += 3;
        e = { type: "attz", e, zone: this.parsePrimary() };
        continue;
      }
      return e;
    }
  }

  parsePrimary() {
    const t = this.next();
    if (!t) throw new Error("sql-lite: unexpected end");
    if (t.t === "num") return { type: "lit", v: t.v };
    if (t.t === "str") return { type: "lit", v: t.v };
    if (t.t === "param") return { type: "param", n: t.v };
    if (t.t === "op" && t.v === "-") return { type: "arith", op: "-", l: { type: "lit", v: 0 }, r: this.parsePostfix() };
    if (t.t === "op" && t.v === "*") return { type: "star" };
    if (t.t === "op" && t.v === "(") {
      if (this.isKw("select")) {
        const select = this.parseSelect();
        this.needOp(")");
        return { type: "scalar", select };
      }
      const e = this.parseExpr();
      this.needOp(")");
      return e;
    }
    if (t.t !== "id") throw new Error(`sql-lite: unexpected ${JSON.stringify(t)}`);
    const word = t.v.toLowerCase();
    if (word === "null") return { type: "lit", v: null };
    if (word === "true") return { type: "lit", v: true };
    if (word === "false") return { type: "lit", v: false };
    if (word === "interval") {
      const s = this.next();
      return { type: "interval", ms: intervalMs(s.v) };
    }
    if (word === "exists" || (word === "not" && this.isKw("exists"))) {
      const not = word === "not";
      if (not) this.next();
      this.needOp("(");
      const select = this.parseSelect();
      this.needOp(")");
      return { type: "exists", select, not };
    }
    if (word === "case") {
      const whens = [];
      let other = { type: "lit", v: null };
      while (this.eatKw("when")) {
        const cond = this.parseExpr();
        this.needKw("then");
        whens.push({ cond, then: this.parseExpr() });
      }
      if (this.eatKw("else")) other = this.parseExpr();
      this.needKw("end");
      return { type: "case", whens, other };
    }
    if (this.isOp("(")) {
      this.next();
      const call = { type: "call", name: word, args: [], distinct: false, filter: null };
      if (this.isOp("*")) { this.next(); call.args.push({ type: "star" }); }
      else if (!this.isOp(")")) {
        call.distinct = this.eatKw("distinct");
        do call.args.push(this.parseExpr()); while (this.eatOp(","));
      }
      this.needOp(")");
      if (this.isKw("filter")) {
        this.next();
        this.needOp("(");
        this.needKw("where");
        call.filter = this.parseExpr();
        this.needOp(")");
      }
      return call;
    }
    if (this.isOp(".")) {
      this.next();
      const col = this.next();
      return { type: "col", table: t.v, name: col.v.toLowerCase() };
    }
    return { type: "col", table: null, name: t.v.toLowerCase() };
  }
}

function intervalMs(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(second|minute|hour|day|week)s?\s*$/i.exec(text);
  if (!m) throw new Error(`sql-lite: unsupported interval ${JSON.stringify(text)}`);
  const unit = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5 }[m[2].toLowerCase()];
  return Number(m[1]) * unit;
}

// ── evaluation ──────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;

class Wall { constructor(ms) { this.ms = ms; } }

function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.toLowerCase()] = typeof v === "string" && ISO.test(v) ? new Date(v) : v;
  }
  return out;
}

function tzOffsetMs(date, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - date.getTime();
}

const and3 = (a, b) => (a === false || b === false ? false : a === null || b === null ? null : true);
const or3 = (a, b) => (a === true || b === true ? true : a === null || b === null ? null : false);
const not3 = (a) => (a === null ? null : !a);

function asMs(v) {
  if (v instanceof Date) return v.getTime();
  if (v instanceof Wall) return v.ms;
  if (typeof v === "string" && ISO.test(v)) return Date.parse(v);
  return null;
}

function compareValues(a, b) {
  const ma = asMs(a);
  const mb = asMs(b);
  if (ma !== null && mb !== null) return ma < mb ? -1 : ma > mb ? 1 : 0;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) throw new Error("sql-lite: cannot compare a number with text");
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

const sameValue = (a, b) => compareValues(a, b) === 0;

function toRegex(pattern, ci) {
  const js = String(pattern)
    .replace(/\[\[:space:\]\]/g, "\\s").replace(/\[:space:\]/g, "\\s")
    .replace(/\[\[:digit:\]\]/g, "\\d").replace(/\[:digit:\]/g, "0-9")
    .replace(/\\y/g, "\\b");
  return new RegExp(js, ci ? "i" : "");
}

function likeRegex(pattern, ci) {
  let out = "^";
  for (const ch of String(pattern)) {
    if (ch === "%") out += "[\\s\\S]*";
    else if (ch === "_") out += "[\\s\\S]";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`, ci ? "i" : "");
}

function textOf(v) {
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function castTo(v, to) {
  if (v === null) return null;
  switch (to) {
    case "int": case "integer": case "int4": case "bigint": {
      if (typeof v === "number") return Math.round(v);
      if (typeof v === "string" && /^\s*-?\d+\s*$/.test(v)) return Number(v);
      throw new Error(`sql-lite: invalid input syntax for type integer: ${JSON.stringify(v)}`);
    }
    case "numeric": case "float8": case "float": {
      const n = Number(v);
      if (Number.isNaN(n)) throw new Error(`sql-lite: invalid input syntax for type numeric: ${JSON.stringify(v)}`);
      return n;
    }
    case "text": case "varchar": return textOf(v);
    case "uuid": return String(v).toLowerCase();
    case "boolean": return v === true || /^(t|true|yes|on|1)$/i.test(String(v));
    case "jsonb": case "json": return v;
    case "timestamptz": case "timestamp": return v instanceof Date ? v : new Date(String(v));
    default: throw new Error(`sql-lite: unsupported cast to ${to}`);
  }
}

/** Read the SQL into a tree. Refuses a write keyword. */
export function parseContract(sql) {
  if (/\b(insert|update|delete|drop|alter|truncate|create)\b/i.test(stripComments(sql).replace(/'[^']*'/g, "''"))) {
    throw new Error("sql-lite: read-only; refusing a write keyword");
  }
  return new Parser(tokenize(sql)).parseSelect();
}

export function runContractSql(sql, options = {}) {
  return runParsed(parseContract(sql), options);
}

/** Run a tree from parseContract (or one of its mutations). */
export function runParsed(tree, { tables = {}, params = [], now, catalog } = {}) {
  if (!catalog) throw new Error("sql-lite: a column catalog is required");
  const clock = new Date(now);
  const data = new Map(Object.entries(tables).map(([name, rows]) => [name.toLowerCase(), rows.map(normalizeRow)]));

  const rowsOf = (name) => {
    if (!catalog.has(name)) throw new Error(`sql-lite: relation "${name}" does not exist in db/schema or db/migrations`);
    return data.get(name) || [];
  };

  function column(scope, ref) {
    if (ref.table) {
      const entry = scope.get(ref.table);
      if (!entry) throw new Error(`sql-lite: missing FROM-clause entry for table "${ref.table}"`);
      if (entry.kind === "elements") {
        throw new Error(`sql-lite: ${ref.table}.${ref.name} is not a column`);
      }
      if (!catalog.get(entry.name).has(ref.name)) {
        throw new Error(`sql-lite: column ${ref.table}.${ref.name} does not exist (table ${entry.name})`);
      }
      return entry.row ? (entry.row[ref.name] ?? null) : null;
    }
    const hit = scope.get(ref.name);
    if (hit && hit.kind === "elements") return hit.value;
    const owners = [...scope.values()].filter((e) => e.kind === "table" && catalog.get(e.name).has(ref.name));
    if (owners.length !== 1) throw new Error(`sql-lite: column "${ref.name}" is ${owners.length ? "ambiguous" : "unknown"}`);
    return owners[0].row ? (owners[0].row[ref.name] ?? null) : null;
  }

  function scan(select, outer) {
    let scopes = [];
    const fromRows = select.from.kind === "table" ? rowsOf(select.from.name) : null;
    if (select.from.kind === "elements") throw new Error("sql-lite: jsonb_array_elements must follow a table");
    for (const row of fromRows) {
      const scope = new Map(outer);
      scope.set(select.from.alias, { kind: "table", name: select.from.name, row });
      scopes.push(scope);
    }
    for (const join of select.joins) {
      const next = [];
      for (const scope of scopes) {
        let matched = false;
        if (join.from.kind === "table") {
          for (const row of rowsOf(join.from.name)) {
            const s = new Map(scope);
            s.set(join.from.alias, { kind: "table", name: join.from.name, row });
            if (evalExpr(join.on, s) === true) { next.push(s); matched = true; }
          }
          if (!matched) {
            const s = new Map(scope);
            s.set(join.from.alias, { kind: "table", name: join.from.name, row: null });
            next.push(s);
          }
        } else {
          throw new Error("sql-lite: jsonb_array_elements is supported inside EXISTS only");
        }
      }
      scopes = next;
    }
    if (select.where) scopes = scopes.filter((s) => evalExpr(select.where, s) === true);
    return scopes;
  }

  // EXISTS / IN / scalar subselects, which may read jsonb_array_elements(...)
  function subRows(select, outer) {
    if (select.from.kind === "elements") {
      const arr = evalExpr(select.from.expr, outer);
      const list = Array.isArray(arr) ? arr : [];
      let scopes = list.map((value) => {
        const s = new Map(outer);
        s.set(select.from.alias, { kind: "elements", value });
        return s;
      });
      if (select.where) scopes = scopes.filter((s) => evalExpr(select.where, s) === true);
      return scopes;
    }
    return scan(select, outer);
  }

  function evalExpr(e, scope) {
    switch (e.type) {
      case "lit": return e.v;
      case "param": {
        if (e.n < 1 || e.n > params.length) throw new Error(`sql-lite: no value for $${e.n}`);
        return params[e.n - 1];
      }
      case "col": return column(scope, e);
      case "interval": return { interval: e.ms };
      case "and": { const l = evalExpr(e.l, scope); if (l === false) return false; return and3(l, evalExpr(e.r, scope)); }
      case "or": { const l = evalExpr(e.l, scope); if (l === true) return true; return or3(l, evalExpr(e.r, scope)); }
      case "not": return not3(evalExpr(e.e, scope));
      case "isnull": { const v = evalExpr(e.e, scope); return e.not ? v !== null : v === null; }
      case "istruth": {
        const v = evalExpr(e.e, scope);
        const hit = v === e.want;
        return e.not ? !hit : hit;
      }
      case "isdistinct": {
        const a = evalExpr(e.l, scope);
        const b = evalExpr(e.r, scope);
        let distinct;
        if (a === null || b === null) distinct = !(a === null && b === null);
        else distinct = !sameValue(a, b);
        return e.not ? distinct : !distinct;
      }
      case "cmp": {
        const a = evalExpr(e.l, scope);
        const b = evalExpr(e.r, scope);
        if (a === null || b === null) return null;
        const c = compareValues(a, b);
        return { "=": c === 0, "<>": c !== 0, "<": c < 0, "<=": c <= 0, ">": c > 0, ">=": c >= 0 }[e.op];
      }
      case "anyeq": {
        const a = evalExpr(e.l, scope);
        const arr = evalExpr(e.arr, scope);
        if (a === null || arr === null) return null;
        let unknown = false;
        for (const item of arr) {
          if (item === null) { unknown = true; continue; }
          if (sameValue(a, item)) return true;
        }
        return unknown ? null : false;
      }
      case "in": {
        const a = evalExpr(e.e, scope);
        if (a === null) return null;
        const items = e.list
          ? e.list.map((x) => evalExpr(x, scope))
          : subRows(e.select, scope).map((s) => evalExpr(e.select.items[0].expr, s));
        let unknown = false;
        let found = false;
        for (const item of items) {
          if (item === null) { unknown = true; continue; }
          if (sameValue(a, item)) { found = true; break; }
        }
        const r = found ? true : unknown ? null : false;
        return e.not ? not3(r) : r;
      }
      case "like": {
        const a = evalExpr(e.e, scope);
        const p = evalExpr(e.pat, scope);
        if (a === null || p === null) return null;
        const r = likeRegex(p, e.ci).test(String(a));
        return e.not ? !r : r;
      }
      case "regex": {
        const a = evalExpr(e.e, scope);
        const p = evalExpr(e.pat, scope);
        if (a === null || p === null) return null;
        const r = toRegex(p, e.ci).test(String(a));
        return e.not ? !r : r;
      }
      case "concat": {
        const a = evalExpr(e.l, scope);
        const b = evalExpr(e.r, scope);
        if (a === null || b === null) return null;
        return `${textOf(a)}${textOf(b)}`;
      }
      case "arith": {
        const a = evalExpr(e.l, scope);
        const b = evalExpr(e.r, scope);
        if (a === null || b === null) return null;
        if (b && typeof b === "object" && "interval" in b) {
          const ms = asMs(a);
          if (ms === null) throw new Error("sql-lite: interval arithmetic needs a timestamp");
          return new Date(e.op === "-" ? ms - b.interval : ms + b.interval);
        }
        const x = Number(a);
        const y = Number(b);
        return { "+": x + y, "-": x - y, "*": x * y, "/": x / y }[e.op];
      }
      case "cast": return castTo(evalExpr(e.e, scope), e.to);
      case "json": {
        const v = evalExpr(e.e, scope);
        const k = evalExpr(e.key, scope);
        if (v === null || k === null) return null;
        const got = typeof v === "object" ? v[k] : undefined;
        if (got === undefined || got === null) return null;
        return e.op === "->>" ? (typeof got === "object" ? JSON.stringify(got) : String(got)) : got;
      }
      case "attz": {
        const v = evalExpr(e.e, scope);
        const zone = evalExpr(e.zone, scope);
        const ms = asMs(v);
        if (ms === null) return null;
        return new Wall(ms + tzOffsetMs(new Date(ms), zone));
      }
      case "case": {
        for (const w of e.whens) if (evalExpr(w.cond, scope) === true) return evalExpr(w.then, scope);
        return evalExpr(e.other, scope);
      }
      case "exists": {
        const any = subRows(e.select, scope).length > 0;
        return e.not ? !any : any;
      }
      case "scalar": {
        const rows = subRows(e.select, scope);
        return rows.length ? evalExpr(e.select.items[0].expr, rows[0]) : null;
      }
      case "call": return callFn(e, scope);
      default: throw new Error(`sql-lite: cannot evaluate ${e.type}`);
    }
  }

  function callFn(e, scope) {
    const a = e.args.map((x) => (x.type === "star" ? null : evalExpr(x, scope)));
    switch (e.name) {
      case "coalesce": return a.find((v) => v !== null) ?? null;
      case "nullif": return a[0] !== null && a[1] !== null && sameValue(a[0], a[1]) ? null : a[0];
      case "btrim": return a[0] === null ? null : String(a[0]).trim();
      case "lower": return a[0] === null ? null : String(a[0]).toLowerCase();
      case "upper": return a[0] === null ? null : String(a[0]).toUpperCase();
      case "length": return a[0] === null ? null : String(a[0]).length;
      case "strpos": {
        if (a[0] === null || a[1] === null) return null;
        return String(a[0]).indexOf(String(a[1])) + 1;
      }
      case "now": return clock;
      case "split_part": {
        if (a[0] === null || a[1] === null || a[2] === null) return null;
        return String(a[0]).split(String(a[1]))[Number(a[2]) - 1] ?? "";
      }
      case "to_char": {
        const ms = asMs(a[0]);
        if (ms === null || a[1] === null) return null;
        const d = new Date(ms);
        const two = (n) => String(n).padStart(2, "0");
        return String(a[1]).replace(/YYYY|MM|DD|HH24|MI|SS/g, (t) => ({
          YYYY: String(d.getUTCFullYear()), MM: two(d.getUTCMonth() + 1), DD: two(d.getUTCDate()),
          HH24: two(d.getUTCHours()), MI: two(d.getUTCMinutes()), SS: two(d.getUTCSeconds())
        })[t]);
      }
      case "jsonb_typeof": {
        const v = a[0];
        if (v === null) return null;
        return Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v === "number" ? "number"
          : typeof v === "boolean" ? "boolean" : "string";
      }
      case "jsonb_array_length": return Array.isArray(a[0]) ? a[0].length : null;
      default: throw new Error(`sql-lite: unsupported function ${e.name}()`);
    }
  }

  // aggregates over the rows the WHERE kept
  function aggregate(e, scopes) {
    if (e.type === "cast") return castTo(aggregate(e.e, scopes), e.to);
    if (e.type !== "call" || e.name !== "count") throw new Error("sql-lite: only count() is an aggregate here");
    let rows = scopes;
    if (e.filter) rows = rows.filter((s) => evalExpr(e.filter, s) === true);
    if (e.args[0].type === "star") return rows.length;
    const seen = new Set();
    let n = 0;
    for (const s of rows) {
      const v = evalExpr(e.args[0], s);
      if (v === null) continue;
      if (e.distinct) { seen.add(textOf(v)); } else n += 1;
    }
    return e.distinct ? seen.size : n;
  }

  const kept = scan(tree, new Map());
  const out = {};
  for (const item of tree.items) out[item.alias || "?column?"] = aggregate(item.expr, kept);
  return out;
}

// ── dropping one condition at a time (for tests) ────────────────────────────

function describe(node) {
  const refs = [];
  const walk = (n) => {
    if (!n || typeof n !== "object" || n.type === "select") return;
    if (n.type === "col") refs.push(n.table ? `${n.table}.${n.name}` : n.name);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v);
    }
  };
  walk(node);
  return `${node.type}(${[...new Set(refs)].slice(0, 4).join(", ")})`;
}

// The boolean slots of a query: the WHERE, and the FILTER of each count().
function slots(tree) {
  const out = [{ name: "WHERE", get: () => tree.where, set: (v) => { tree.where = v; } }];
  tree.items.forEach((item, index) => {
    let call = item.expr;
    while (call && call.type === "cast") call = call.e;
    if (call && call.type === "call" && call.filter) {
      out.push({ name: `item ${index} FILTER`, get: () => call.filter, set: (v) => { call.filter = v; } });
    }
  });
  return out;
}

// Conditions joined by AND / OR, left to right, each with the value that means
// "this condition is not there": true under AND, false under OR.
function leaves(node, parentOp, found = []) {
  if (node.type === "and" || node.type === "or") {
    leaves(node.l, node.type, found);
    leaves(node.r, node.type, found);
  } else if (parentOp) {
    found.push({ node, absent: parentOp === "and" });
  }
  return found;
}

/**
 * Every single condition in the query's WHERE and FILTER, dropped on its own.
 * A test runs the fixtures through each one; a condition no fixture can tell
 * from its absence is a condition nothing proves.
 * Returns [{ label, tree }], each tree a copy with that one condition removed.
 */
export function dropOneCondition(tree) {
  const out = [];
  slots(tree).forEach((slot, slotIndex) => {
    leaves(slot.get(), null).forEach((leaf, leafIndex) => {
      const copy = structuredClone(tree);
      const copySlot = slots(copy)[slotIndex];
      let seen = -1;
      const swap = (node, parentOp) => {
        if (node.type === "and" || node.type === "or") {
          node.l = swap(node.l, node.type);
          node.r = swap(node.r, node.type);
          return node;
        }
        if (parentOp) {
          seen += 1;
          if (seen === leafIndex) return { type: "lit", v: leaf.absent };
        }
        return node;
      };
      copySlot.set(swap(copySlot.get(), null));
      out.push({ label: `${slot.name} #${leafIndex}: ${describe(leaf.node)}`, tree: copy });
    });
  });
  return out;
}
