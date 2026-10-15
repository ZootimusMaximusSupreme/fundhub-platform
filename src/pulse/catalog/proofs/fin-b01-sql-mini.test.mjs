import assert from "node:assert/strict";
import test from "node:test";

import { parseContractSql, runContractSql } from "./fin-b01-sql-mini.mjs";
import { missingColumns, schemaColumns } from "./fin-b01-schema-scan.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const SQL = `/* display-result:mini */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE a.kind NOT IN ('x', 'y') OR NULLIF(BTRIM(COALESCE(a.name, '')), '') IS NULL
         OR a.cfg->>'n' !~ '^[0-9]+$' OR p.id IS NULL)::int AS bad_count
  FROM things a
  LEFT JOIN parents p ON p.org_id = a.org_id AND p.id = a.parent_id
 WHERE a.org_id = $1::uuid AND a.live = true`;

const good = { org_id: ORG, id: "t1", kind: "x", name: "ok", cfg: { n: 3 }, parent_id: "p1", live: true };
const parents = [{ org_id: ORG, id: "p1" }];

test("the runner counts sample rows and bad rows, and only this company's", () => {
  const out = runContractSql(SQL, { things: [good, { ...good, id: "t2", org_id: OTHER }, { ...good, id: "t3", live: false }], parents }, [ORG]);
  assert.equal(out.sample_count, 1);
  assert.equal(out.bad_count, 0);
});

test("each wrong field turns one row bad", () => {
  const bad = [
    { ...good, id: "k", kind: "z" },
    { ...good, id: "n", name: "   " },
    { ...good, id: "j", cfg: { n: "abc" } },
    { ...good, id: "p", parent_id: "missing" },
  ];
  const out = runContractSql(SQL, { things: [good, ...bad], parents }, [ORG]);
  assert.equal(out.sample_count, 5);
  assert.equal(out.bad_count, 4);
});

test("unknown (NULL) is not bad on its own, as in Postgres", () => {
  const sql = SQL.replace("a.kind NOT IN ('x', 'y') OR ", "");
  const out = runContractSql(sql, { things: [{ ...good, kind: null }], parents }, [ORG]);
  assert.equal(out.bad_count, 0);
  const nullIn = runContractSql(SQL, { things: [{ ...good, kind: null }], parents }, [ORG]);
  assert.equal(nullIn.bad_count, 0, "NULL NOT IN (...) is unknown, not true");
});

test("IS DISTINCT FROM treats NULL as a value", () => {
  const sql = `SELECT count(*)::int AS sample_count, count(*) FILTER (WHERE a.kind IS DISTINCT FROM 'x')::int AS bad_count
    FROM things a WHERE a.org_id = $1::uuid`;
  const out = runContractSql(sql, { things: [good, { ...good, kind: null }, { ...good, kind: "y" }] }, [ORG]);
  assert.equal(out.bad_count, 2);
});

test("a statement that is not the one allowed shape, or that writes, is refused", () => {
  assert.throws(() => parseContractSql("SELECT 1"), /sample_count/);
  assert.throws(() => parseContractSql(SQL.replace("SELECT", "DELETE FROM x; SELECT")), /only read/);
  assert.throws(() => parseContractSql(SQL.replace(/\s+WHERE a\.org_id[\s\S]*$/, "")), /WHERE/);
  assert.throws(() => runContractSql(SQL.replace("BTRIM", "NOPE"), { things: [good], parents }, [ORG]), /unknown function/);
});

test("the schema scan knows real tables and columns and refuses a made-up one", () => {
  assert.ok(schemaColumns().has("agents"));
  assert.deepEqual(missingColumns([{ table: "agents", column: "guardrails" }, { table: "agents", column: "org_id" }]), []);
  assert.deepEqual(missingColumns([{ table: "agents", column: "no_such_column" }]), ["agents.no_such_column"]);
  assert.deepEqual(missingColumns([{ table: "no_such_table", column: "id" }]), ["no_such_table (no such table)"]);
});
