// The stand-in row helper that the slice S3 proofs lean on. If it kept a row it
// should have dropped, a proof built on it would go green for a handler that lost
// a company or client condition, so each rule it judges is pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";

import { rowsWhere, tableRules } from "./s3-scoped-rows.mjs";

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
