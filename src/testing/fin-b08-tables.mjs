// A small table stand-in for the finish-853 batch 08 route tests. It answers every
// `SELECT ... FROM <table> ... WHERE ...` from an in-memory list by the conditions the statement
// itself names (see s3-scoped-rows.mjs), after Postgres's own bind rule. Statements the test names in
// `rules` are answered by hand first. A table the test did not give is an empty table.
// Tests only; nothing here is product code.
import { fakeDb } from "./handler-harness.mjs";
import { rowsWhere, bindProblem } from "./s3-scoped-rows.mjs";

const TABLE = /^\s*(?:WITH[\s\S]*?\)\s*)?SELECT[\s\S]*?\bFROM\s+(?:public\.)?([a-z_][a-z0-9_]*)\b/i;

/**
 * tablesDb({ tables: { clients: [...], ... }, rules: [[match, answer], ...], strict })
 * Returns a fakeDb with `.calls`, `.tables` and `.find(re)`.
 */
export function tablesDb({ tables = {}, rules = [], strict = false } = {}) {
  const fake = fakeDb([
    ...rules,
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
