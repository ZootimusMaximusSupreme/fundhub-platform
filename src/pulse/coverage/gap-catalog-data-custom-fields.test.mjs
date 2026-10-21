// client_custom_fields is judged on what its one writer saves: typed survey answers (2026-10-20).
import assert from "node:assert/strict";
import test from "node:test";

import { SQL_BATCHES, TABLE_RULES } from "./gap-catalog-data.mjs";
import { CF_SVY_TYPED_COLUMNS, pickTypedSurveyAnswers } from "../../handlers/client-custom-fields.mjs";

test("a client_custom_fields row must hold at least one survey answer the writer saves", () => {
  const rule = TABLE_RULES.client_custom_fields;
  assert.deepEqual(rule.all, ["org_id", "client_id"]);
  assert.deepEqual(rule.any, [...CF_SVY_TYPED_COLUMNS]);
  assert.ok(!rule.all.includes("ai_call_enabled"), "no code writes ai_call_enabled");
  const sql = SQL_BATCHES.find((text) => text.includes("'client_custom_fields'"));
  assert.ok(sql, "the table is read");
  for (const column of CF_SVY_TYPED_COLUMNS) assert.ok(sql.includes(column), `${column} is read`);
});

test("the writer never saves a row with no survey answer, so an empty row is a real break", () => {
  assert.deepEqual(pickTypedSurveyAnswers({}), {});
  assert.deepEqual(pickTypedSurveyAnswers({ cf_svy_your_why: "   " }), {});
  assert.deepEqual(pickTypedSurveyAnswers({ cf_svy_your_why: "Buy a truck" }), { cf_svy_your_why: "Buy a truck" });
});
