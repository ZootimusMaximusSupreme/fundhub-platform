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
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * tablesDb({ tables: { clients: [...], ... }, rules: [[match, answer], ...], strict, autoInsert })
 * Returns a fakeDb with `.calls`, `.tables` and `.find(re)`.
 * autoInsert: an `INSERT INTO t (cols) VALUES ($1, $2, 'x', now())` statement for a table in
 * `tables` adds a row built from the statement itself (a $n takes its param, a literal its
 * value, anything else null), gives it a fresh id, and answers it for RETURNING.
 */
export function tablesDb({ tables = {}, rules = [], strict = false, autoInsert = false } = {}) {
  let idSeq = 0;
  const insertRule = autoInsert ? [[(sql) => INSERT.test(sql) && (() => { const t = INSERT.exec(sql)[1].toLowerCase(); return t in tables; })(), (sql, params) => {
    const m = INSERT.exec(sql);
    const name = m[1].toLowerCase();
    const cols = m[2].split(",").map((c) => c.trim());
    const exprs = splitValues(m[3]);
    const row = { id: `a${String(++idSeq).padStart(7, "0")}-0000-4000-8000-000000000000` };
    cols.forEach((col, i) => {
      const e = exprs[i] || "";
      const p = /^\$(\d+)/.exec(e);
      if (p) row[col] = params[Number(p[1]) - 1];
      else if (/^'.*'$/.test(e)) row[col] = e.slice(1, -1);
      else if (/^(true|false)$/i.test(e)) row[col] = e.toLowerCase() === "true";
      else if (/^-?\d+(\.\d+)?$/.test(e)) row[col] = Number(e);
      else row[col] = null;
    });
    tables[name].push(row);
    return [{ ...row }];
  }]] : [];
  const fake = fakeDb([
    ...rules,
    ...insertRule,
    [(sql) => TABLE.test(sql), (sql, params) => {
      const name = TABLE.exec(sql)[1].toLowerCase();
      if (!(name in tables)) {
        if (strict) throw new Error(`no stand-in table ${name}`);
        return [];
      }
      // The WHERE of the statement's own FROM clause, never a subquery's earlier WHERE.
      const from = sql.search(new RegExp(`\\bFROM\\s+(?:public\\.)?${name}\\b`, "i"));
      return rowsWhere(tables[name], sql.slice(from), params).map((r) => ({ ...r }));
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
