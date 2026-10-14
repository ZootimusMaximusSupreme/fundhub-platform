// Stand-in rows that answer a statement by the conditions its SQL text really
// names (slice S3 proofs). A test that hands back a fixed answer proves the
// answer was used; one built on these helpers goes red when the handler or the
// logic under it stops binding `org_id` or `client_id`, because the other
// company's row is then still in the answer and the statement acts on it.
//
// What is judged after WHERE (an alias such as `c.` is ignored): `column = $N`,
// `column = 'literal'`, `column IS NOT DISTINCT FROM $N` and `column IS NULL`.
// the optional filter `($N IS NULL OR column = $N)` (no filter when $N is null) and
// a group of equalities joined by OR, `(a = $N OR b = $N)` (any one may match).
// Every condition is an AND. Any other parenthesised group with an OR in it is not
// judged (it keeps every row). Nothing else is run.

const COLUMN = String.raw`\b(?:[a-z]\w*\.)?([a-z_]\w*)`;
const EQUALS = new RegExp(`${COLUMN}\\s*=\\s*\\$(\\d+)`, "gi");
const LITERAL = new RegExp(`${COLUMN}\\s*=\\s*'([^']*)'`, "gi");
const SAME_AS = new RegExp(`${COLUMN}\\s+IS\\s+NOT\\s+DISTINCT\\s+FROM\\s+\\$(\\d+)`, "gi");
const IS_NULL = new RegExp(`${COLUMN}\\s+IS\\s+NULL\\b`, "gi");
const OPTIONAL = new RegExp(`\\(\\s*\\$(\\d+)(?:::\\w+)?\\s+IS\\s+NULL\\s+OR\\s+${COLUMN}\\s*=\\s*\\$\\1(?:::\\w+)?\\s*\\)`, "gi");
const ANY_OF = new RegExp(`\\(\\s*((?:${COLUMN}\\s*=\\s*\\$\\d+)(?:\\s+OR\\s+${COLUMN}\\s*=\\s*\\$\\d+)+)\\s*\\)`, "gi");
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
  const tail = where[1].replace(OPTIONAL, " ").replace(ANY_OF, " ").replace(/\([^()]*\bOR\b[^()]*\)/gi, " ");
  const equals = [...tail.matchAll(EQUALS)].map((m) => [m[1], params[Number(m[2]) - 1]]);
  const literals = [...tail.matchAll(LITERAL)].map((m) => [m[1], m[2]]);
  const same = [...tail.matchAll(SAME_AS)].map((m) => [m[1], nullable(params[Number(m[2]) - 1])]);
  const nulls = [...tail.matchAll(IS_NULL)].map((m) => m[1]);
  return rows.filter((row) =>
    equals.concat(optional).every(([column, value]) => String(row[column]) === String(value))
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
