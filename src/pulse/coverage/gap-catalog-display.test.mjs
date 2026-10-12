import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECK_IDS,
  DISPLAY_RESULT_CASES,
  DISPLAY_TRACKING_CASES,
  SQL_BATCHES,
  TABLE_NAMES,
  gapChecks,
  judgeDisplayResult,
  naVerify,
} from "./gap-catalog-display.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";

function fakeDb(overrides = {}, failOn = null) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      if (failOn && sql.includes(`'${failOn}'`)) throw new Error(`read failed for ${failOn}`);
      const tables = [...sql.matchAll(/SELECT '([^']+)'::text AS table_name/g)].map((match) => match[1]);
      return {
        rows: tables.map((table) => ({
          table_name: table,
          row_count: 1,
          complete_count: 1,
          ...(overrides[table] || {}),
        })),
      };
    },
  };
}

test("the lane owns exact deep display cases with one check id each", () => {
  assert.ok(DISPLAY_RESULT_CASES.length >= 40, "the saved-result display batch unexpectedly shrank");
  assert.ok(DISPLAY_TRACKING_CASES.length >= 700, "the exact display tracking batch unexpectedly shrank");
  assert.equal(CHECK_IDS.length, DISPLAY_TRACKING_CASES.length);
  assert.equal(new Set(CHECK_IDS).size, CHECK_IDS.length);
  assert.ok(TABLE_NAMES.length >= 20, "too few saved-result tables are judged");
  for (const entry of DISPLAY_RESULT_CASES) {
    assert.ok(entry.sourceFile.endsWith(".json"));
    assert.ok(entry.surface);
    assert.ok(entry.control);
    assert.ok(TABLE_NAMES.includes(entry.table));
  }
});

test("every query is read only and checks saved row values", () => {
  const sql = SQL_BATCHES.join("\n");
  assert.ok(SQL_BATCHES.length >= 2);
  assert.match(sql, /complete_count/);
  assert.match(sql, /to_jsonb\(t\)/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
  for (const table of TABLE_NAMES) assert.match(sql, new RegExp(`FROM "${table}" t`));
});

test("complete saved results pass and missing results stay red", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG });
  assert.equal(rows.length, DISPLAY_TRACKING_CASES.length);
  assert.ok(rows.some((row) => row.status === "PASS"));
  assert.ok(rows.some((row) => row.status === "FAIL"));
  assert.ok(db.calls.every((call) => call.params[0] === ORG));

  const table = TABLE_NAMES[0];
  const broken = await gapChecks({ db: fakeDb({ [table]: { row_count: 3, complete_count: 1 } }), orgId: ORG });
  const affected = broken.filter((row) => DISPLAY_RESULT_CASES.find((entry) => entry.id === row.id)?.table === table);
  assert.ok(affected.length > 0);
  assert.ok(affected.every((row) => row.status === "FAIL"));
  assert.match(affected[0].suggestedFix, /Do not auto-fix\. Chris fixes reds\./);
});

test("empty results are verified nothing-to-judge and read failures stay unchecked", async () => {
  const entry = DISPLAY_RESULT_CASES[0];
  const empty = judgeDisplayResult(entry, { row_count: 0, complete_count: 0 });
  assert.equal(empty.status, "na");
  assert.deepEqual(empty.na, { code: "catalog-display-empty", args: { table: entry.table } });
  assert.equal(await naVerify["catalog-display-empty"]({ table: entry.table }, {
    db: fakeDb({ [entry.table]: { row_count: 0, complete_count: 0 } }),
    orgId: ORG,
  }), true);

  const failed = await gapChecks({ db: fakeDb({}, TABLE_NAMES[0]), orgId: ORG });
  assert.ok(failed.some((row) => row.status === "skip"));
  assert.ok(failed.some((row) => row.status === "PASS"));

  const retired = DISPLAY_TRACKING_CASES.find((item) => item.retired);
  assert.ok(retired);
  const retiredResult = judgeDisplayResult(retired);
  assert.equal(retiredResult.status, "na");
  assert.equal(await naVerify["catalog-display-retired-autopsy"]({
    sourceFile: retired.sourceFile,
    surface: retired.surface,
    control: retired.control,
  }), true);
});
