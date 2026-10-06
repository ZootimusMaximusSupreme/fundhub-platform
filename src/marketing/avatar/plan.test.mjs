// The avatar plan: its steps, the search ceiling, the worst-case cost and the cap guard.
// Pure. Unit X1; design §6 slice 5a and §5 rule 13.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  STEPS, STEPS_TOTAL, nextStep, RUN_SEARCH_CEILING, INFO_SEARCH_RESERVE, searchesPerCall,
  worstCallUsd, worstRunUsd, fitCalls, capStopSentence, researchModel, dollars, DEFAULT_RUN_CAP_USD
} from "./plan.mjs";

describe("the ten saved steps", () => {
  test("in the design's order", () => {
    assert.equal(STEPS_TOTAL, 10);
    assert.deepEqual(STEPS.map((s) => s.key), [
      "foundation", "overview", "quotes", "sort", "word_bank", "new_info", "facts", "avatar", "check", "save"
    ]);
    assert.deepEqual(STEPS.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(nextStep("check"), "save");
    assert.equal(nextStep("save"), "done");
  });
});

describe("searches", () => {
  test("at most 184 a run: 4 rounds x 5 families x 8, plus 3 x 8 for new information", () => {
    assert.equal(RUN_SEARCH_CEILING, 184);
    assert.equal(INFO_SEARCH_RESERVE, 24);
  });

  test("each call gets a share of what is left, never more than 8, and 0 when it is spent", () => {
    assert.equal(searchesPerCall({ used: 0, calls: 5, reserve: 24 }), 8);
    assert.equal(searchesPerCall({ used: 150, calls: 5, reserve: 24 }), 2);
    assert.equal(searchesPerCall({ used: 160, calls: 5, reserve: 24 }), 0);
    assert.equal(searchesPerCall({ used: 170, calls: 3 }), 4);
    assert.equal(searchesPerCall({ used: 184, calls: 3 }), 0);
  });
});

describe("cost", () => {
  test("worst cases come from the price table: a write on Opus, a search on Sonnet with its search fee", () => {
    // 25,000 in x $4 + 16,000 out x $20 per million.
    assert.equal(worstCallUsd("write", {}), 0.42);
    // 150,000 in x $2 + 8,000 out x $10 per million, plus 8 searches at 1 cent.
    assert.equal(worstCallUsd("search", {}), 0.46);
    // The whole run's worst case fits under the default $20 cap.
    assert.ok(worstRunUsd({}) < DEFAULT_RUN_CAP_USD, `worst run ${worstRunUsd({})}`);
  });

  test("MARKETING_RESEARCH_MODEL moves the searches and checks to another Claude model", () => {
    assert.equal(researchModel({}), "claude-sonnet-5-5");
    assert.equal(researchModel({ MARKETING_RESEARCH_MODEL: "claude-opus-5-5" }), "claude-opus-5-5");
    assert.equal(researchModel({ MARKETING_RESEARCH_MODEL: "gpt-4o" }), "claude-sonnet-5-5");
    assert.equal(worstCallUsd("search", { MARKETING_RESEARCH_MODEL: "claude-opus-5-5" }), 0.84);
  });

  test("fitCalls: all, some (shrink first), or none (stop, naming the cap)", () => {
    const base = { perCallUsd: 0.46, calls: 5, runCapUsd: 20, monthUsedUsd: 0, monthCapUsd: 300 };
    assert.deepEqual(fitCalls({ ...base, spentUsd: 1 }), { fit: 5, stop: null });
    assert.deepEqual(fitCalls({ ...base, spentUsd: 19 }), { fit: 2, stop: null });
    assert.deepEqual(fitCalls({ ...base, spentUsd: 19.9 }), { fit: 0, stop: { cap: "run", capUsd: 20 } });
    assert.deepEqual(fitCalls({ ...base, spentUsd: 0, monthUsedUsd: 299.8 }), { fit: 0, stop: { cap: "month", capUsd: 300 } });
    assert.deepEqual(fitCalls({ ...base, calls: 0, spentUsd: 0 }), { fit: 0, stop: null });
  });

  test("the cap sentences, in the design's words", () => {
    assert.equal(capStopSentence({ cap: "run", capUsd: 20, afterStep: 6 }),
      "Stopped at the $20 run cap after step 6. What it found so far is saved. Raise the cap in Settings and tap Retry to finish.");
    assert.equal(capStopSentence({ cap: "month", capUsd: 300, afterStep: 2 }),
      "Stopped at the $300 month cap. What it found so far is saved. Raise it in Settings or wait for next month.");
    assert.equal(dollars(1.84), "$1.84");
    assert.equal(dollars(20), "$20");
    assert.equal(dollars(null), "unknown");
  });
});
