// The stand-in row helper that the slice S3 proofs lean on. If it kept a row it
// should have dropped, a proof built on it would go green for a handler that lost
// a company or client condition, so each rule it judges is pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";

import { rowsWhere, tableRules, plainSql, assertSqlHas, bindProblem } from "./s3-scoped-rows.mjs";

const rows = [
  { id: "1", org_id: "A", client_id: "x", state: "open", closed: null },
  { id: "2", org_id: "A", client_id: "y", state: "done", closed: "now" },
  { id: "3", org_id: "B", client_id: "x", state: "open", closed: null }
];
const ids = (sql, params) => rowsWhere(rows, sql, params).map((r) => r.id);

test("equality after WHERE keeps only the rows whose column holds the bound value, alias ignored", () => {
  assert.deepEqual(ids("SELECT 1 FROM t WHERE org_id = $1 AND client_id = $2", ["A", "x"]), ["1"]);
  assert.deepEqual(ids("SELECT 1 FROM t c WHERE c.org_id = $2 AND c.client_id = $1::uuid", ["x", "B"]), ["3"]);
  assert.deepEqual(ids("SELECT 1 FROM t", []), ["1", "2", "3"], "no WHERE keeps every row");
});

test("a condition turned into a no-op filter keeps the other rows, which is what makes a lost condition visible", () => {
  assert.deepEqual(ids("SELECT 1 FROM t WHERE org_id = $1 AND $2::text IS NOT NULL", ["A", "x"]), ["1", "2"]);
});

test("literals, IS NULL, null-safe equality, the optional filter and any-of groups are judged", () => {
  assert.deepEqual(ids("SELECT 1 FROM t WHERE state = 'open' AND closed IS NULL", []), ["1", "3"]);
  assert.deepEqual(ids("SELECT 1 FROM t WHERE closed IS NOT DISTINCT FROM $1", [null]), ["1", "3"]);
  assert.deepEqual(ids("SELECT 1 FROM t WHERE ($1::uuid IS NULL OR client_id = $1::uuid)", ["y"]), ["2"]);
  assert.deepEqual(ids("SELECT 1 FROM t WHERE ($1::uuid IS NULL OR client_id = $1::uuid)", [null]), ["1", "2", "3"]);
  assert.deepEqual(ids("SELECT 1 FROM t WHERE org_id = $1 AND (client_id = $2 OR state = $3)", ["A", "y", "open"]), ["1", "2"]);
});

test("a flag-or-equality group is every row while the flag is true and the equality alone when it is not", () => {
  assert.deepEqual(ids("SELECT 1 FROM t WHERE ($1::boolean OR org_id = $2::uuid) ORDER BY id", [false, "A"]), ["1", "2"]);
  assert.deepEqual(ids("SELECT 1 FROM t WHERE ($1::boolean OR org_id = $2::uuid) ORDER BY id", [false, "B"]), ["3"]);
  assert.deepEqual(ids("SELECT 1 FROM t WHERE ($1::boolean OR org_id = $2::uuid) ORDER BY id", [false, null]), []);
  assert.deepEqual(ids("SELECT 1 FROM t WHERE ($1::boolean OR org_id = $2::uuid) ORDER BY id", [true, null]), ["1", "2", "3"]);
});

test("an exact-text pin goes red on a dropped, flipped or reworded clause and ignores comments and spacing", () => {
  const sql = `SELECT x
       FROM t -- the newest first
      WHERE a = $1
      ORDER BY created_at DESC`;
  assert.equal(plainSql(sql), "SELECT x FROM t WHERE a = $1 ORDER BY created_at DESC");
  assertSqlHas(sql, { order: "ORDER BY created_at   DESC", filter: "WHERE a = $1" });
  assert.throws(() => assertSqlHas(sql.replace("DESC", "ASC"), { order: "ORDER BY created_at DESC" }), /order: the statement no longer says/);
  assert.throws(() => assertSqlHas(sql.replace("a = $1", "$1 IS NOT NULL"), { filter: "WHERE a = $1" }), /filter/);
});

test("table rules answer SELECT, change only the rows UPDATE names, and DELETE only those", async () => {
  const live = rows.map((r) => ({ ...r }));
  const [del, upd, sel] = tableRules("t", live, { set: (row) => { row.state = "touched"; } });
  const run = async (rule, sql, params) => {
    assert.ok(rule[0](sql), `rule should match: ${sql}`);
    return rule[1](sql, params);
  };
  assert.equal((await run(sel, "SELECT * FROM t WHERE org_id = $1", ["A"])).length, 2);
  const changed = await run(upd, "UPDATE t SET state = 'x' WHERE id = $1 AND org_id = $2", ["1", "A"]);
  assert.equal(changed.rowCount, 1);
  assert.deepEqual(live.map((r) => r.state), ["touched", "done", "open"]);
  const wrongCompany = await run(upd, "UPDATE t SET state = 'x' WHERE id = $1 AND org_id = $2", ["1", "B"]);
  assert.equal(wrongCompany.rowCount, 0);
  const removed = await run(del, "DELETE FROM t WHERE client_id = $1 AND org_id = $2", ["x", "A"]);
  assert.equal(removed.rowCount, 1);
  assert.deepEqual(live.map((r) => r.id), ["2", "3"]);
});

test("a statement whose bound values are not all used as conditions is refused, as Postgres refuses it", () => {
  const ok = "SELECT 1 FROM t WHERE org_id = $1 AND ($2::uuid IS NULL OR client_id = $2) LIMIT $3";
  assert.equal(bindProblem(ok, ["A", null, 5]), null);
  assert.match(bindProblem("SELECT 1 FROM t WHERE org_id = $1", ["A", "x"]), /\$2 is supplied but the statement never uses it/, "a dropped condition");
  assert.match(bindProblem("SELECT 1 FROM t WHERE $1::uuid IS NOT NULL AND client_id = $2", ["A", "x"]), /\$1 is only ever tested for NULL/, "a condition turned into a no-op");
  assert.match(bindProblem("SELECT 1 FROM t WHERE org_id = $1 AND client_id = $2", ["A"]), /uses \$2 but the call supplies 1/);
  assert.equal(bindProblem("SELECT 'a $9 b' FROM t -- $4 here\n WHERE x = $1", ["v"]), null, "text in strings and comments is not a placeholder");
  assert.equal(bindProblem("BEGIN"), null);
});
