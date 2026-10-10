import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreFromPlaywrightJson,
  parseSweepDetail,
  checkLivePlaywright,
  LIVE_PLAYWRIGHT_AGENT
} from "./live-playwright-check.mjs";

test("scoreFromPlaywrightJson counts pass and fail", () => {
  const report = {
    suites: [{
      specs: [{
        tests: [
          { results: [{ status: "passed" }, { status: "passed" }] },
          { results: [{ status: "failed" }] }
        ]
      }]
    }]
  };
  const s = scoreFromPlaywrightJson(report);
  assert.equal(s.passed, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.score, 67);
});

test("parseSweepDetail reads JSON suffix", () => {
  const p = parseSweepDetail(`live-playwright {"score":100,"passed":10,"failed":0,"total":10}`);
  assert.equal(p.score, 100);
});

test("checkLivePlaywright FAIL with no db row", async () => {
  const db = {
    async query(sql, params) {
      assert.equal(params[0], LIVE_PLAYWRIGHT_AGENT);
      return { rows: [] };
    }
  };
  const row = await checkLivePlaywright({ db, now: new Date() });
  assert.equal(row.status, "FAIL");
});

test("checkLivePlaywright PASS for fresh 100 score", async () => {
  const now = new Date();
  const db = {
    async query() {
      return {
        rows: [{
          outcome: "pass",
          created_at: now,
          detail: JSON.stringify({ score: 100, passed: 5, failed: 0, total: 5 })
        }]
      };
    }
  };
  const row = await checkLivePlaywright({ db, now });
  assert.equal(row.status, "PASS");
});
