// Pure tests for src/marketing/model-usage.mjs: the prices (copied from the claude-api skill,
// cache 2026-09-25), what an unknown model costs (NULL, never 0), and how the cost caps count
// unpriced calls (at the highest known rate, never as free).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MODEL_PRICES, HIGHEST_KNOWN_RATE, PRICES_SOURCE, DEFAULT_MAX_BATCH_USD, DEFAULT_MAX_MONTH_USD,
  costUsd, worstCaseUsd, tokensOf, costTotals, logUsage, costStatus
} from "./model-usage.mjs";

const T = (input_tokens = 0, output_tokens = 0, cache_read_tokens = 0, cache_write_tokens = 0) =>
  ({ input_tokens, output_tokens, cache_read_tokens, cache_write_tokens });

describe("MODEL_PRICES (US dollars per million tokens)", () => {
  test("claude-opus-5-5: $4 input, $20 output, $0.20 cache read, cache write 1.25x input", () => {
    assert.deepEqual({ ...MODEL_PRICES["claude-opus-5-5"] }, { input: 4, output: 20, cache_read: 0.2, cache_write: 5 });
  });

  test("claude-sonnet-5-5: $2 input, $10 output, $0.20 cache read, cache write 1.25x input", () => {
    assert.deepEqual({ ...MODEL_PRICES["claude-sonnet-5-5"] }, { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 });
  });

  test("only those two models are priced", () => {
    assert.deepEqual(Object.keys(MODEL_PRICES).sort(), ["claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  test("the source is cited: the claude-api skill and its cache date", () => {
    assert.match(PRICES_SOURCE, /claude-api skill/);
    assert.match(PRICES_SOURCE, /2026-09-25/);
    const src = fs.readFileSync(new URL("./model-usage.mjs", import.meta.url), "utf8");
    assert.match(src, /Source: the claude-api skill/);
    assert.match(src, /cached: 2026-09-25/);
  });

  test("the highest known rate is Opus 5.5's", () => {
    assert.deepEqual({ ...HIGHEST_KNOWN_RATE }, { input: 4, output: 20, cache_read: 0.2, cache_write: 5 });
  });
});

describe("costUsd", () => {
  test("a million of each token on Opus 5.5 is $29.20", () => {
    assert.equal(costUsd("claude-opus-5-5", T(1e6, 1e6, 1e6, 1e6)), 29.2);
  });

  test("a small Sonnet 5.5 call", () => {
    // 1,000 in × $2/M + 500 out × $10/M = $0.002 + $0.005
    assert.equal(costUsd("claude-sonnet-5-5", T(1000, 500)), 0.007);
    // cache: 10,000 read × $0.20/M + 2,000 written × $2.50/M = $0.002 + $0.005
    assert.equal(costUsd("claude-sonnet-5-5", T(0, 0, 10000, 2000)), 0.007);
  });

  test("an unknown model is null, never 0", () => {
    assert.equal(costUsd("gpt-4o-mini", T(1000, 1000)), null);
    assert.equal(costUsd("claude-opus-5-5-20260401", T(1000, 1000)), null);
    assert.equal(costUsd("", T(1)), null);
  });

  test("worstCaseUsd counts at the highest known rate", () => {
    assert.equal(worstCaseUsd(T(1e6, 1e6, 1e6, 1e6)), 29.2);
  });
});

describe("tokensOf", () => {
  test("reads an Anthropic usage object, including cache tokens", () => {
    assert.deepEqual(tokensOf({ usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } }), T(10, 20, 30, 40));
  });

  test("explicit counts win; junk and negatives are 0", () => {
    assert.deepEqual(tokensOf({ inputTokens: 5, usage: { input_tokens: 99, output_tokens: -3 }, cacheReadTokens: "x" }), T(5, 0, 0, 0));
  });
});

describe("costTotals (the cap check)", () => {
  test("unpriced rows count at the highest known rate, never as free, and are reported", () => {
    const out = costTotals(
      { month_priced_usd: "1.500000", month_null_input: 1e6, month_null_output: 0, unpriced_rows: 2,
        batch_priced_usd: "0.500000", batch_null_output: 1e6 },
      { maxBatchUsd: 40, maxMonthUsd: 300 }
    );
    assert.deepEqual(out, { batch_usd: 20.5, month_usd: 5.5, unpriced_rows: 2, batch_capped: false, month_capped: false });
  });

  test("reaching a cap exactly counts as reached", () => {
    const out = costTotals({ month_priced_usd: "300", batch_priced_usd: "40" }, { maxBatchUsd: 40, maxMonthUsd: 300 });
    assert.equal(out.batch_capped, true);
    assert.equal(out.month_capped, true);
  });

  test("an unpriced call alone can reach the cap", () => {
    // 2M output tokens of an unknown model = 2 × $20 = $40 at the highest rate
    const out = costTotals({ batch_null_output: 2e6, month_null_output: 2e6, unpriced_rows: 1 }, { maxBatchUsd: 40, maxMonthUsd: 300 });
    assert.equal(out.batch_usd, 40);
    assert.equal(out.batch_capped, true);
  });

  test("missing caps use the spec defaults ($40 batch, $300 month), never no cap", () => {
    assert.equal(DEFAULT_MAX_BATCH_USD, 40);
    assert.equal(DEFAULT_MAX_MONTH_USD, 300);
    const out = costTotals({ month_priced_usd: "300", batch_priced_usd: "40" }, {});
    assert.equal(out.batch_capped, true);
    assert.equal(out.month_capped, true);
    const under = costTotals({ month_priced_usd: "299.99", batch_priced_usd: "39.99" }, { maxBatchUsd: null, maxMonthUsd: "" });
    assert.equal(under.batch_capped, false);
    assert.equal(under.month_capped, false);
  });

  test("no batch asked: batch_usd null and never capped", () => {
    const out = costTotals({ month_priced_usd: "2" }, { hasBatch: false });
    assert.equal(out.batch_usd, null);
    assert.equal(out.batch_capped, false);
    assert.equal(out.month_usd, 2);
  });

  test("an empty month is $0 spent (no rows is a real zero, not unknown)", () => {
    assert.deepEqual(costTotals({}, { hasBatch: true }), { batch_usd: 0, month_usd: 0, unpriced_rows: 0, batch_capped: false, month_capped: false });
  });
});

describe("logUsage and costStatus (fake database)", () => {
  const ORG = "00000000-0000-0000-0000-0000000000aa";

  test("logUsage stores the served model and its price; an unknown model gets cost NULL", async () => {
    const calls = [];
    const db = { query: async (sql, p) => { calls.push(p); return { rows: [{ id: "u1" }] }; } };
    await logUsage(db, { orgId: ORG, jobId: null, batchId: null, model: "claude-sonnet-5-5", usage: { input_tokens: 1000, output_tokens: 500 } });
    await logUsage(db, { orgId: ORG, model: "some-fallback-model", inputTokens: 1000, outputTokens: 500 });
    assert.deepEqual(calls[0], [ORG, null, null, "claude-sonnet-5-5", 1000, 500, 0, 0, "0.007000"]);
    assert.deepEqual(calls[1], [ORG, null, null, "some-fallback-model", 1000, 500, 0, 0, null]);
  });

  test("logUsage refuses a row with no org or no model", async () => {
    const db = { query: async () => { throw new Error("must not reach the database"); } };
    await assert.rejects(logUsage(db, { model: "claude-opus-5-5" }), /orgId/);
    await assert.rejects(logUsage(db, { orgId: ORG, model: "  " }), /model/);
  });

  test("costStatus asks for the org, the batch and the Arizona month of `now`", async () => {
    let params;
    const db = { query: async (sql, p) => { params = p; return { rows: [{ month_priced_usd: "12.5", batch_priced_usd: "3", unpriced_rows: 0 }] }; } };
    const out = await costStatus(db, { orgId: ORG, batchId: "00000000-0000-0000-0000-0000000000bb", maxBatchUsd: 40, maxMonthUsd: 300, now: new Date("2026-10-05T12:00:00Z") });
    assert.deepEqual(params, [ORG, "00000000-0000-0000-0000-0000000000bb", "2026-10-05T12:00:00.000Z"]);
    assert.deepEqual(out, { batch_usd: 3, month_usd: 12.5, unpriced_rows: 0, batch_capped: false, month_capped: false });
  });
});
