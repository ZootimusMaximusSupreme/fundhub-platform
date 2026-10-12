import assert from "node:assert/strict";
import test from "node:test";

import { DISPLAY_RESULT_CONTRACTS } from "../catalog/proofs/display-saved-result.mjs";
import {
  ALWAYS_RED_COUNT,
  CHECK_IDS,
  DISPLAY_RESULT_CASES,
  DISPLAY_TRACKING_CASES,
  PASS_CAPABLE_COUNT,
  SQL_BATCHES,
  gapChecks,
  judgeDisplayResult,
  naVerify,
} from "./gap-catalog-display.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";

function marker(sql) {
  return /display-result:([^*\s]+)/.exec(sql)?.[1] || "unknown";
}

function fakeDb(overrides = {}, failOn = null) {
  return {
    calls: [],
    async query(sql, params) {
      const key = marker(sql);
      this.calls.push({ key, sql, params });
      if (key === failOn) throw new Error(`read failed for ${key}`);
      return { rows: [{ sample_count: 1, bad_count: 0, ...(overrides[key] || {}) }] };
    },
  };
}

test("all 45 deep display controls own one exact contract", () => {
  assert.equal(DISPLAY_RESULT_CONTRACTS.length, 45);
  assert.equal(DISPLAY_RESULT_CASES.length, 45);
  assert.equal(PASS_CAPABLE_COUNT, 27);
  assert.equal(ALWAYS_RED_COUNT, 18);
  assert.equal(PASS_CAPABLE_COUNT + ALWAYS_RED_COUNT, 45);
  assert.equal(new Set(DISPLAY_RESULT_CONTRACTS.map((entry) => entry.control)).size, 45);
  assert.equal(CHECK_IDS.length, DISPLAY_TRACKING_CASES.length);
  assert.equal(new Set(CHECK_IDS).size, CHECK_IDS.length);

  for (const entry of DISPLAY_RESULT_CASES) {
    assert.ok(entry.sourceFile.endsWith(".json"));
    assert.ok(entry.surface);
    assert.equal(entry.contract.control, entry.control);
    assert.ok(entry.contract.requirement.length > 40, entry.control);
    assert.ok(["query", "always-red"].includes(entry.contract.mode));
    assert.equal(entry.contract.mode === "query", typeof entry.contract.sql === "string");
  }
});

test("PASS-capable contracts use exact read-only links, never generic completeness", () => {
  assert.equal(SQL_BATCHES.length, 27);
  for (const sql of SQL_BATCHES) {
    assert.match(sql, /\/\* display-result:[^*]+ \*\//);
    assert.match(sql, /sample_count/);
    assert.match(sql, /bad_count/);
    assert.match(sql, /\$1::uuid/);
    assert.doesNotMatch(sql, /complete_count|to_jsonb\(t\)|DISPLAY_RESULT_TABLE_RULES/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
  }
});

test("query contracts pass only with a real exact sample and no broken links", () => {
  const entry = DISPLAY_RESULT_CASES.find((item) => item.contract.mode === "query");
  assert.ok(entry);

  const clean = judgeDisplayResult(entry, { sample_count: 2, bad_count: 0 });
  assert.equal(clean.status, "PASS");
  assert.match(clean.detail, /exact check/);

  const absent = judgeDisplayResult(entry, { sample_count: 0, bad_count: 0 });
  assert.equal(absent.status, "FAIL");
  assert.match(absent.detail, /no saved receipt or linked result/);

  const broken = judgeDisplayResult(entry, { sample_count: 3, bad_count: 1 });
  assert.equal(broken.status, "FAIL");
  assert.match(broken.detail, /1 of 3/);
  assert.match(broken.suggestedFix, /Do not auto-fix\. Chris fixes reds\./);
});

test("unprovable controls always stay red and name the missing exact link", () => {
  const entries = DISPLAY_RESULT_CASES.filter((item) => item.contract.mode === "always-red");
  assert.equal(entries.length, 18);
  for (const entry of entries) {
    const out = judgeDisplayResult(entry, { sample_count: 99, bad_count: 0 });
    assert.equal(out.status, "FAIL", entry.control);
    assert.match(out.detail, new RegExp(entry.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(out.detail.includes(entry.contract.requirement));
    assert.match(out.suggestedFix, /exact input-to-result receipt/);
  }
});

test("the lane runs each exact query once and keeps the 18 gaps red", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG });
  const resultIds = new Set(DISPLAY_RESULT_CASES.map((entry) => entry.id));
  const focused = rows.filter((row) => resultIds.has(row.id));

  assert.equal(db.calls.length, 27);
  assert.ok(db.calls.every((call) => call.params[0] === ORG));
  assert.equal(focused.filter((row) => row.status === "PASS").length, 27);
  assert.equal(focused.filter((row) => row.status === "FAIL").length, 18);
});

test("a failed exact read stays unchecked while static gaps remain red", async () => {
  const failedKey = marker(SQL_BATCHES[0]);
  const rows = await gapChecks({ db: fakeDb({}, failedKey), orgId: ORG });
  const resultIds = new Set(DISPLAY_RESULT_CASES.map((entry) => entry.id));
  const focused = rows.filter((row) => resultIds.has(row.id));
  assert.ok(focused.some((row) => row.status === "skip"));
  assert.equal(focused.filter((row) => row.status === "FAIL").length, 18);
});

test("only the exact retired redirect can be nothing-to-judge", async () => {
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
