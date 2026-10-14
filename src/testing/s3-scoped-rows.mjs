// Stand-in rows that answer a statement by the conditions its SQL text really
// names (slice S3 proofs). A test that hands back a fixed answer proves the
// answer was used; one built on these helpers goes red when the handler or the
// logic under it stops binding `org_id` or `client_id`, because the other
// company's row is then still in the answer and the statement acts on it.
//
// What is judged after WHERE (an alias such as `c.` is ignored): `column = $N`,
// `column = 'literal'`, `column IS NOT DISTINCT FROM $N`, `column IS NULL`,
// the optional filter `($N IS NULL OR column = $N)` (no filter when $N is null),
// a group of equalities joined by OR, `(a = $N OR b = $N)` (any one may match),
// and a flag-or-equality group `($N::boolean OR column = $M)` (every row when $N is
// true, else only the rows where the column equals $M).
// Every condition is an AND. Any other parenthesised group with an OR in it is not
// judged (it keeps every row). Nothing else is run.
import assert from "node:assert/strict";

const COLUMN = String.raw`\b(?:[a-z]\w*\.)?([a-z_]\w*)`;
const EQUALS = new RegExp(`${COLUMN}\\s*=\\s*\\$(\\d+)`, "gi");
const LITERAL = new RegExp(`${COLUMN}\\s*=\\s*'([^']*)'`, "gi");
const SAME_AS = new RegExp(`${COLUMN}\\s+IS\\s+NOT\\s+DISTINCT\\s+FROM\\s+\\$(\\d+)`, "gi");
const IS_NULL = new RegExp(`${COLUMN}\\s+IS\\s+NULL\\b`, "gi");
const OPTIONAL = new RegExp(`\\(\\s*\\$(\\d+)(?:::\\w+)?\\s+IS\\s+NULL\\s+OR\\s+${COLUMN}\\s*=\\s*\\$\\1(?:::\\w+)?\\s*\\)`, "gi");
const ANY_OF = new RegExp(`\\(\\s*((?:${COLUMN}\\s*=\\s*\\$\\d+)(?:\\s+OR\\s+${COLUMN}\\s*=\\s*\\$\\d+)+)\\s*\\)`, "gi");
const FLAG_OR = new RegExp(`\\(\\s*\\$(\\d+)(?:::\\w+)?\\s+OR\\s+${COLUMN}\\s*=\\s*\\$(\\d+)(?:::\\w+)?\\s*\\)`, "gi");
const nullable = (v) => (v === undefined ? null : v);

/** The rows a statement's WHERE clause keeps. No WHERE keeps every row. */
export function rowsWhere(rows, sql, params = []) {
  const where = /\bWHERE\b([\s\S]*)$/i.exec(sql);
  if (!where) return rows.slice();
  const optional = [...where[1].matchAll(OPTIONAL)]
    .map((m) => [m[2], nullable(params[Number(m[1]) - 1])])
    .filter(([, value]) => value !== null);
  const anyOf = [...where[1].matchAll(ANY_OF)]
    .map((m) => [...m[1].matchAll(EQUALS)].map((t) => [t[1], params[Number(t[2]) - 1]]));
  const gated = [...where[1].matchAll(FLAG_OR)]
    .filter((m) => !params[Number(m[1]) - 1])
    .map((m) => [m[2], params[Number(m[3]) - 1]]);
  const tail = where[1].replace(OPTIONAL, " ").replace(ANY_OF, " ").replace(FLAG_OR, " ").replace(/\([^()]*\bOR\b[^()]*\)/gi, " ");
  const equals = [...tail.matchAll(EQUALS)].map((m) => [m[1], params[Number(m[2]) - 1]]);
  const literals = [...tail.matchAll(LITERAL)].map((m) => [m[1], m[2]]);
  const same = [...tail.matchAll(SAME_AS)].map((m) => [m[1], nullable(params[Number(m[2]) - 1])]);
  const nulls = [...tail.matchAll(IS_NULL)].map((m) => m[1]);
  return rows.filter((row) =>
    equals.concat(optional, gated).every(([column, value]) => String(row[column]) === String(value))
    && anyOf.every((terms) => terms.some(([column, value]) => String(row[column]) === String(value)))
    && literals.every(([column, value]) => String(row[column]) === value)
    && same.every(([column, value]) => nullable(row[column]) === value)
    && nulls.every((column) => nullable(row[column]) === null));
}

/**
 * Rules for one table, to hand to fakeDb / callShared.
 *   SELECT ... FROM <table>  answers the rows the WHERE clause keeps.
 *   UPDATE <table> ...       runs `set(row, params, sql)` on each row the WHERE
 *                            clause keeps and answers them (RETURNING) with the
 *                            count. Rows the clause does not keep are untouched.
 *   DELETE FROM <table> ...  removes the rows the WHERE clause keeps from `rows`.
 * `rows` is the live array: read it after the call to see what changed.
 */
export function tableRules(table, rows, { set = () => {} } = {}) {
  const isSelect = new RegExp(`^\\s*SELECT[\\s\\S]*?\\bFROM\\s+${table}\\b`, "i");
  const isUpdate = new RegExp(`^\\s*UPDATE\\s+${table}\\b`, "i");
  const isDelete = new RegExp(`^\\s*DELETE\\s+FROM\\s+${table}\\b`, "i");
  return [
    [(sql) => isDelete.test(sql), (sql, params) => {
      const hit = rowsWhere(rows, sql, params);
      for (const row of hit) rows.splice(rows.indexOf(row), 1);
      return { rows: hit.map((row) => ({ ...row })), rowCount: hit.length };
    }],
    [(sql) => isUpdate.test(sql), (sql, params) => {
      const hit = rowsWhere(rows, sql, params);
      for (const row of hit) set(row, params, sql);
      return { rows: hit.map((row) => ({ ...row })), rowCount: hit.length };
    }],
    [(sql) => isSelect.test(sql), (sql, params) => rowsWhere(rows, sql, params).map((row) => ({ ...row }))]
  ];
}

/** Every `SELECT ... FROM clients WHERE id = $1 AND org_id = $2`, the org boundary each staff door asks first. */
export function clientsRule(clients) {
  return [
    (sql) => /^\s*SELECT[\s\S]*?\bFROM\s+clients\b/i.test(sql),
    (sql, params) => rowsWhere(clients, sql, params).map((row) => ({ "?column?": 1, ...row }))
  ];
}

/** One line of SQL for exact-text pins: `--` comments dropped, white space collapsed, none inside ( ). */
export function plainSql(sql) {
  return String(sql).replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
}

/**
 * Fails, naming the pin, when the statement no longer says one of the clauses a row's words
 * depend on. `pins` is { name: "clause as the SQL spells it" }. Params alone cannot show a
 * dropped or flipped condition, because the value is still bound.
 */
export function assertSqlHas(sql, pins) {
  const text = plainSql(sql);
  for (const [name, clause] of Object.entries(pins)) {
    assert.ok(text.includes(plainSql(clause)), `${name}: the statement no longer says: ${clause}`);
  }
}

/**
 * What Postgres itself refuses at bind time, so a stand-in can refuse it too. Returns a sentence, or null.
 *   - every $1..$n the call supplies must appear in the statement (a dropped condition leaves its value
 *     unused: "bind message supplies 3 parameters, but prepared statement requires 2");
 *   - a value used only in `IS [NOT] NULL` tests is bound for nothing: the condition it was supplied for
 *     is gone (`org_id = $2` turned into `$2 IS NOT NULL` keeps every row).
 */
export function bindProblem(sql, params = []) {
  const text = String(sql).replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
  const supplied = Array.isArray(params) ? params.length : 0;
  const used = new Set([...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  for (let k = 1; k <= supplied; k++) {
    if (!used.has(k)) return `value $${k} is supplied but the statement never uses it`;
    const tests = text.match(new RegExp(`\\$${k}(?!\\d)(?:::\\w+(?:\\[\\])?)?\\s+IS\\s+(?:NOT\\s+)?NULL\\b`, "gi")) || [];
    const all = text.match(new RegExp(`\\$${k}(?!\\d)`, "g")) || [];
    if (tests.length === all.length) return `value $${k} is only ever tested for NULL, so no condition uses it`;
  }
  for (const k of used) if (k > supplied) return `the statement uses $${k} but the call supplies ${supplied} values`;
  return null;
}

/** bindProblem as a throw, for a stand-in that answers by hand. Postgres code 08P01 (protocol violation). */
export function assertBind(sql, params = []) {
  const problem = bindProblem(typeof sql === "string" ? sql : (sql && sql.text) || "", params);
  if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
}
