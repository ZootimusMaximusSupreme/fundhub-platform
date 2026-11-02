// No-DB source regression: CSV import must not erase known bank Apply URLs or
// reactivate disabled lender products when the file leaves those cells blank.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLenderCsv } from "./csv.mjs";
import { importLendersCsv, updateLender } from "./store.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const staff = { name: "Synthetic CI Operator" };

function fakeDb() {
  const writes = [];
  const db = {
    async query(sql, params = []) {
      if (/SELECT id FROM lenders/.test(sql)) {
        return { rows: params[0] === A && params[1] === "legacy-1" ? [{ id: ID }] : [] };
      }
      if (/UPDATE lenders SET/.test(sql)) {
        writes.push({ sql, params });
        return { rows: [{ id: ID, org_id: A, name: "Test Bank", active: false }] };
      }
      if (/INSERT INTO lenders/.test(sql)) {
        writes.push({ sql, params });
        return { rows: [{ id: ID, org_id: A, name: "New Bank", active: true }] };
      }
      throw new Error("unexpected SQL: " + sql);
    }
  };
  return { writes, db };
}

test("CSV parser distinguishes absent, blank, and explicit active values", () => {
  const noColumn = parseLenderCsv("lender_table,name,external_row_id\nOnlineBizCC,Test Bank,legacy-1\n");
  assert.equal(noColumn.rows[0].active, undefined);
  const blank = parseLenderCsv("lender_table,name,active\nOnlineBizCC,Test Bank,\n");
  assert.equal(blank.rows[0].active, null);
  const explicit = parseLenderCsv("lender_table,name,active\nOnlineBizCC,Test Bank,false\n");
  assert.equal(explicit.rows[0].active, false);
  assert.deepEqual(noColumn.errors, []);
  assert.deepEqual(blank.errors, []);
  assert.deepEqual(explicit.errors, []);
});

test("blank URL and blank or absent active never produce destructive UPDATEs", async () => {
  const { db, writes } = fakeDb();
  for (const text of [
    "lender_table,name,external_row_id,application_url\nOnlineBizCC,Test Bank,legacy-1,\n",
    "lender_table,name,external_row_id,application_url,active\nOnlineBizCC,Test Bank,legacy-1,,\n",
    "lender_table,name,external_row_id\nOnlineBizCC,Test Bank,legacy-1\n"
  ]) {
    const result = await importLendersCsv(db, { orgId: A, text, staff });
    assert.equal(result.updated, 1);
    assert.deepEqual(result.errors, []);
  }
  assert.equal(writes.length, 3);
  for (const { sql, params } of writes) {
    const updateClause = sql.split(/\bWHERE\b/)[0];
    assert.doesNotMatch(updateClause, /\bapplication_url\s*=/);
    assert.doesNotMatch(updateClause, /\bactive\s*=/);
    assert.equal(params[0], A);
    assert.equal(params[1], ID);
  }
});

test("valid URL and explicit active update; direct staff null may still clear", async () => {
  const { db, writes } = fakeDb();
  const text = "lender_table,name,external_row_id,application_url,active\n" +
    "OnlineBizCC,Test Bank,legacy-1,https://example.test/new,false\n";
  const result = await importLendersCsv(db, { orgId: A, text, staff });
  assert.equal(result.updated, 1);
  const updateClause = writes[0].sql.split(/\bWHERE\b/)[0];
  assert.match(updateClause, /\bapplication_url\s*=/);
  assert.match(updateClause, /\bactive\s*=/);
  assert.ok(writes[0].params.includes("https://example.test/new"));
  assert.ok(writes[0].params.includes(false));

  await updateLender(db, { orgId: A, id: ID, patch: { application_url: null }, staff });
  assert.match(writes[1].sql, /\bapplication_url\s*=\s*\$3/);
  assert.equal(writes[1].params[2], null);
});

test("a genuinely new CSV row still defaults active and allows blank URL", async () => {
  const { db, writes } = fakeDb();
  const text = "lender_table,name,external_row_id,application_url\n" +
    "OnlineBizCC,New Bank,new-key,\n";
  const result = await importLendersCsv(db, { orgId: A, text, staff });
  assert.equal(result.imported, 1);
  assert.deepEqual(result.errors, []);
  assert.match(writes[0].sql, /INSERT INTO lenders/);
  assert.ok(writes[0].params.includes(true));
  assert.ok(writes[0].params.includes(null));
});
