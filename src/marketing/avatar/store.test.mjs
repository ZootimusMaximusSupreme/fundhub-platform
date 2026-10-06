// The avatar run's row in words (design §3.0 word table, §3.2 row 1). Pure. Unit X1.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { avatarJobView, avatarStepsView, avatarRunCap } from "./store.mjs";

const row = (over = {}) => ({
  id: "j1", kind: "avatar", status: "running", attempts: 0, error: null,
  created_at: "2026-10-06T19:00:00Z", finished_at: null, result: null,
  payload: { campaign: "partner", step: "foundation", run_cap_usd: 20, progress: {} },
  ...over
});

describe("avatarJobView", () => {
  test("a brand-new run: step 1 of 10, a measured $0, no searches", () => {
    const v = avatarJobView(row({ status: "queued" }));
    assert.equal(v.sentence, "Running: step 1 of 10, writing down the business facts. $0 spent so far, 0 searches.");
    assert.equal(v.cost_so_far_usd, 0);
    assert.equal(v.step_n, 1);
    assert.equal(v.steps_total, 10);
  });

  test("searching: the round, the quotes so far, the spend and searches from the ledger", () => {
    const v = avatarJobView(row({
      payload: { campaign: "partner", step: "quotes", run_cap_usd: 20, progress: {
        steps: { foundation: { status: "done" }, overview: { status: "done" } },
        quotes: { round: 2, kept: [{ quote: "a b c", verbatim: true }, { quote: "d e f", verbatim: false }] }
      } }
    }), { cost_usd: 1.9, searches: 23, fetches: 0 });
    assert.equal(v.sentence, "Running: step 3 of 10, searching the web for buyer quotes, round 2. 2 new quotes so far. $1.90 spent so far, 23 searches.");
    assert.equal(v.round, 2);
    assert.equal(v.counts_so_far.verbatim, 1);
  });

  test("the first quote round before it has started still says round 1", () => {
    const v = avatarJobView(row({ payload: { campaign: "partner", step: "quotes", progress: { steps: { foundation: { status: "done" } } } } }), { cost_usd: 0.056, searches: 0 });
    assert.match(v.sentence, /^Running: step 3 of 10, searching the web for buyer quotes, round 1\./);
  });

  test("stopped at the cap: the stop sentence; resumable", () => {
    const stop = "Stopped at the $20 run cap after step 6. What it found so far is saved. Raise the cap in Settings and tap Retry to finish.";
    const v = avatarJobView(row({ status: "failed", error: stop, payload: { campaign: "partner", step: "new_info", progress: { stopped_at_cap: { cap: "run", sentence: stop } } } }));
    assert.equal(v.sentence, stop);
    assert.equal(v.resumable, true);
  });

  test("failed for another reason: 'Could not finish:' and the reason; a retry waiting says so", () => {
    assert.equal(avatarJobView(row({ status: "failed", error: "No Anthropic key is set on the site. An agent must set it." })).sentence,
      "Could not finish: No Anthropic key is set on the site. An agent must set it.");
    const waiting = avatarJobView(row({ status: "queued", attempts: 1, error: "Step 3: 1 of the quote searches in round 1 failed." }), { cost_usd: 0.1, searches: 8 });
    assert.match(waiting.sentence, /Trying again: Step 3: 1 of the quote searches in round 1 failed\.$/);
  });

  test("done: the run's own done sentence", () => {
    const v = avatarJobView(row({ status: "done", result: { sentence: "Done. 141 new quotes, 455 kept. Version 2, built on the server. Not reviewed." }, payload: { campaign: "partner", step: "done", progress: {} } }));
    assert.equal(v.sentence, "Done. 141 new quotes, 455 kept. Version 2, built on the server. Not reviewed.");
    assert.equal(v.step_n, 10);
  });
});

describe("avatarStepsView and the run cap", () => {
  test("ten steps, each with its state", () => {
    const steps = avatarStepsView(row({ payload: { campaign: "partner", step: "overview", progress: { steps: { foundation: { status: "done", attempts: 1 } } } } }));
    assert.equal(steps.length, 10);
    assert.deepEqual(steps.slice(0, 3).map((s) => s.status), ["done", "next", "not_started"]);
  });

  test("the cap comes from Settings run_caps.avatar, else $20", () => {
    assert.equal(avatarRunCap({ run_caps: { avatar: 35 } }), 35);
    assert.equal(avatarRunCap({ run_caps: {} }), 20);
    assert.equal(avatarRunCap(null), 20);
    assert.equal(avatarRunCap({ run_caps: { avatar: -1 } }), 20);
  });
});
