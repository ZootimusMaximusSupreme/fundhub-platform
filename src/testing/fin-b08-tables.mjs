// A small table stand-in for the finish-853 batch 08 route tests. It answers every
// `SELECT ... FROM <table> ... WHERE ...` from an in-memory list by the conditions the statement
// itself names (see s3-scoped-rows.mjs), after Postgres's own bind rule. Statements the test names in
// `rules` are answered by hand first. A table the test did not give is an empty table.
// Tests only; nothing here is product code.
import { fakeDb } from "./handler-harness.mjs";
import { rowsWhere, bindProblem } from "./s3-scoped-rows.mjs";

const TABLE = /^\s*(?:WITH[\s\S]*?\)\s*)?SELECT[\s\S]*?\bFROM\s+(?:public\.)?([a-z_][a-z0-9_]*)\b/i;

const INSERT = /^\s*INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:ON\s+CONFLICT[\s\S]*?)?(?:RETURNING\s+([\s\S]*))?$/i;

/** Split a VALUES list on top-level commas. */
function splitValues(list) {
  const out = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of list) {
    if (ch === "'") quote = !quote;
    if (!quote) {
      if (ch === "(" || ch === "[") depth += 1;
      if (ch === ")" || ch === "]") depth -= 1;
    }
    if (ch === "," && depth === 0 && !quote) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const UPDATE = /^\s*UPDATE\s+([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*?)(?:\s+RETURNING\s+([\s\S]*))?$/i;

/** Split on top-level commas (parentheses and quotes respected). */
function splitTop(list) {
  const out = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of list) {
    if (ch === "'") quote = !quote;
    if (!quote) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** One SET expression, evaluated against the row and the call's params. */
function evalExpr(expr, row, params) {
  const e = expr.trim();
  let m;
  if ((m = /^\$(\d+)(?:::[a-z0-9_\[\]]+)?$/i.exec(e))) {
    const v = params[Number(m[1]) - 1];
    return typeof v === "string" && /^\s*[[{]/.test(v) ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
  }
  if (/^NULL$/i.test(e)) return null;
  if (/^now\(\)$/i.test(e)) return "now";
  if ((m = /^'(.*)'(?:::[a-z0-9_]+)?$/.exec(e))) return m[1];
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
  if (/^(true|false)$/i.test(e)) return e.toLowerCase() === "true";
  if ((m = /^COALESCE\(\s*(\$\d+(?:::\w+)?)\s*,\s*([a-z_]+)\s*\)$/i.exec(e))) {
    const v = evalExpr(m[1], row, params);
    return v === null || v === undefined ? row[m[2]] : v;
  }
  if ((m = /^COALESCE\(\s*([a-z_]+)\s*,\s*(\$\d+(?:::\w+)?)\s*\)$/i.exec(e))) {
    return row[m[1]] === null || row[m[1]] === undefined ? evalExpr(m[2], row, params) : row[m[1]];
  }
  if ((m = /^COALESCE\(\s*NULLIF\(\s*btrim\(\s*(\$\d+)(?:::\w+)?\s*\)\s*,\s*''\s*\)\s*,\s*([a-z_]+)\s*\)$/i.exec(e))) {
    const v = String(evalExpr(m[1], row, params) ?? "").trim();
    return v === "" ? row[m[2]] : v;
  }
  if ((m = /^([a-z_]+)\s*\+\s*(\d+)$/i.exec(e))) return Number(row[m[1]] || 0) + Number(m[2]);
  if ((m = /^CASE WHEN ([a-z_]+) IN \(([^)]*)\) THEN '([^']*)' ELSE ([a-z_]+) END$/i.exec(e))) {
    const set = m[2].split(",").map((x) => x.trim().replace(/^'|'$/g, ""));
    return set.includes(String(row[m[1]])) ? m[3] : row[m[4]];
  }
  if ((m = /^CASE WHEN ([a-z_]+) = '([^']*)' THEN '([^']*)' ELSE ([a-z_]+) END$/i.exec(e))) {
    return String(row[m[1]]) === m[2] ? m[3] : row[m[4]];
  }
  return undefined; // not understood: the column is left alone
}

/**
 * The statement's own closing ORDER BY and LIMIT, applied to the rows its WHERE kept. Only plain terms
 * are understood (`[alias.]column [ASC|DESC] [NULLS FIRST|LAST]`); a statement that orders by an
 * expression keeps the stored order and applies no LIMIT, so nothing is dropped on a guess.
 * Without this a stand-in hands back rows in the order the test stored them, and a product that lost
 * or turned its ORDER BY could never be told from one that kept it.
 */
export function orderAndLimit(rows, sql, params = []) {
  const text = String(sql).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim().replace(/;\s*$/, "");
  const tail = /\bORDER\s+BY\s+([^()]+?)(?:\s+LIMIT\s+(\$\d+|\d+))?(?:\s+OFFSET\s+(?:\$\d+|\d+))?\s*$/i.exec(text);
  const limitOnly = tail ? null : /\bLIMIT\s+(\$\d+|\d+)\s*$/i.exec(text);
  const out = rows.slice();
  let simple = true;
  if (tail) {
    const terms = tail[1].split(",").map((t) => t.trim()).map((t) => {
      const m = /^(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)(?:\s+(ASC|DESC))?(?:\s+NULLS\s+(FIRST|LAST))?$/i.exec(t);
      return m ? { col: m[1], desc: /^desc$/i.test(m[2] || ""), nulls: m[3] ? m[3].toUpperCase() : null } : null;
    });
    if (terms.every(Boolean)) {
      const compare = (x, y) => {
        const xt = x instanceof Date ? x.getTime() : x;
        const yt = y instanceof Date ? y.getTime() : y;
        if (typeof xt === "number" && typeof yt === "number") return xt - yt;
        if (typeof xt === "boolean" && typeof yt === "boolean") return Number(xt) - Number(yt);
        return String(xt).localeCompare(String(yt));
      };
      out.sort((a, b) => {
        for (const { col, desc, nulls } of terms) {
          const x = a[col] === undefined ? null : a[col];
          const y = b[col] === undefined ? null : b[col];
          if (x === null || y === null) {
            if (x === y) continue;
            const nullsLast = nulls ? nulls === "LAST" : !desc; // Postgres: NULLs sort as the largest value
            return (x === null) === nullsLast ? 1 : -1;
          }
          const c = compare(x, y);
          if (c !== 0) return desc ? -c : c;
        }
        return 0;
      });
    } else simple = false;
  }
  const limitToken = tail ? tail[2] : limitOnly && limitOnly[1];
  if (limitToken && simple) {
    const n = limitToken.startsWith("$") ? Number(params[Number(limitToken.slice(1)) - 1]) : Number(limitToken);
    if (Number.isFinite(n) && n >= 0) return out.slice(0, n);
  }
  return out;
}

/**
 * tablesDb({ tables: { clients: [...], ... }, rules: [[match, answer], ...], strict, autoInsert, autoUpdate })
 * autoUpdate: an `UPDATE t SET col = $n, col2 = 'x', ... WHERE <conditions> RETURNING ...` on a table in
 * `tables` changes the rows the WHERE keeps (the statement's own conditions, judged by rowsWhere),
 * for the SET expressions it understands, and answers them for RETURNING.
 * Returns a fakeDb with `.calls`, `.tables` and `.find(re)`.
 * autoInsert: an `INSERT INTO t (cols) VALUES ($1, $2, 'x', now())` statement for a table in
 * `tables` adds a row built from the statement itself (a $n takes its param, a literal its
 * value, anything else null), gives it a fresh id, and answers it for RETURNING.
 */
export function tablesDb({ tables = {}, rules = [], strict = false, autoInsert = false, autoUpdate = false, defaults = {} } = {}) {
  let idSeq = 0;
  const insertRule = autoInsert ? [[(sql) => INSERT.test(sql) && (() => { const t = INSERT.exec(sql)[1].toLowerCase(); return t in tables; })(), (sql, params) => {
    const m = INSERT.exec(sql);
    const name = m[1].toLowerCase();
    const cols = m[2].split(",").map((c) => c.trim());
    const exprs = splitValues(m[3]);
    const row = { id: `a${String(++idSeq).padStart(7, "0")}-0000-4000-8000-000000000000`, ...(defaults[name] || {}) };
    cols.forEach((col, i) => {
      const e = exprs[i] || "";
      const p = /^\$(\d+)(::jsonb)?/.exec(e);
      if (p) {
        const v = params[Number(p[1]) - 1];
        row[col] = p[2] && typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v;
      } else if (/^'.*'::jsonb$/.test(e)) row[col] = JSON.parse(e.slice(1, e.lastIndexOf("'")));
      else if (/^'.*'(::\w+)?$/.test(e)) row[col] = e.slice(1, e.lastIndexOf("'"));
      else if (/^(true|false)$/i.test(e)) row[col] = e.toLowerCase() === "true";
      else if (/^-?\d+(\.\d+)?$/.test(e)) row[col] = Number(e);
      else row[col] = null;
    });
    tables[name].push(row);
    return [{ ...row }];
  }]] : [];
  const updateRule = autoUpdate ? [[(sql) => { const m = UPDATE.exec(sql); return !!m && m[1].toLowerCase() in tables; }, (sql, params) => {
    const m = UPDATE.exec(sql);
    const name = m[1].toLowerCase();
    const hit = rowsWhere(tables[name], `WHERE ${m[3]}`, params);
    const sets = splitTop(m[2]).map((a) => { const i = a.indexOf("="); return [a.slice(0, i).trim(), a.slice(i + 1).trim()]; });
    for (const row of hit) {
      const next = {};
      for (const [col, expr] of sets) {
        const v = evalExpr(expr, row, params);
        if (v !== undefined) next[col] = v;
      }
      Object.assign(row, next);
    }
    return { rows: hit.map((r) => ({ ...r })), rowCount: hit.length };
  }]] : [];
  const fake = fakeDb([
    ...rules,
    ...insertRule,
    ...updateRule,
    [(sql) => TABLE.test(sql), (sql, params) => {
      const name = TABLE.exec(sql)[1].toLowerCase();
      if (!(name in tables)) {
        if (strict) throw new Error(`no stand-in table ${name}`);
        return [];
      }
      // The WHERE of the statement's own FROM clause, never a subquery's earlier WHERE.
      const from = sql.search(new RegExp(`\\bFROM\\s+(?:public\\.)?${name}\\b`, "i"));
      return orderAndLimit(rowsWhere(tables[name], sql.slice(from), params), sql.slice(from), params).map((r) => ({ ...r }));
    }],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : (sql && sql.text) || "";
    const args = typeof sql === "string" ? params : (sql && sql.values) || params;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.connect = async () => ({ query: fake.query, release() {} });
  fake.tables = tables;
  return fake;
}

/**
 * Run one `UPDATE t SET col = expr, ... WHERE ... [RETURNING cols]` statement over `rows` and apply the
 * statement's OWN set list to every row its WHERE keeps (the conditions are judged by rowsWhere). Unlike
 * the tablesDb autoUpdate this one is strict: a SET expression it cannot read throws, so a test can
 * never silently ignore a column the product writes. Returns { hit, returning } where `returning` is the
 * RETURNING column list (or null). `rows` is the live array.
 */
export function runUpdate(rows, sql, params = []) {
  const m = UPDATE.exec(String(sql).trim().replace(/;\s*$/, ""));
  if (!m) throw new Error(`runUpdate: not an UPDATE ... SET ... WHERE statement: ${String(sql).slice(0, 80)}`);
  const hit = rowsWhere(rows, `WHERE ${m[3]}`, params);
  const sets = splitTop(m[2]).map((a) => { const i = a.indexOf("="); return [a.slice(0, i).trim(), a.slice(i + 1).trim()]; });
  for (const row of hit) {
    const next = {};
    for (const [col, expr] of sets) {
      const v = evalExpr(expr, row, params);
      if (v === undefined) throw new Error(`runUpdate: cannot read the SET expression for ${col}: ${expr}`);
      next[col] = v;
    }
    Object.assign(row, next);
  }
  const returning = m[4] ? m[4].split(",").map((c) => c.trim()) : null;
  return { hit, returning, columns: sets.map(([c]) => c) };
}
