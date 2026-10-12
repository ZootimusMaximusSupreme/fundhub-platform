import assert from "node:assert/strict";
import test from "node:test";

import { changedWiredItems, proofPlan, redByFamily, splitTestTargets } from "./proof-plan.mjs";

test("changed proof rows are selected once and targets are deduplicated", () => {
  const old = { items: [
    { id: "same", state: "wired", proof: { tests: ["a.test.mjs"], lanes: [], beats: [] } },
    { id: "changed", state: "red", proof: { tests: [], lanes: [], beats: [] } },
  ] };
  const current = { items: [
    { id: "same", state: "wired", proof: { tests: ["a.test.mjs"], lanes: [], beats: [] } },
    { id: "changed", state: "wired", proof: { tests: ["b.test.mjs", "b.test.mjs"], lanes: ["gap-x.mjs"], beats: [] } },
    { id: "new", state: "wired", proof: { tests: ["b.test.mjs"], lanes: [], beats: ["beat-y.mjs"] } },
    { id: "red", state: "red", family: "button", proof: { tests: ["never.test.mjs"] } },
  ] };

  const changed = changedWiredItems(current, old);
  assert.deepEqual(changed.map((item) => item.id), ["changed", "new"]);
  assert.deepEqual(proofPlan(changed), {
    rows: 2,
    tests: ["b.test.mjs"],
    lanes: ["gap-x.mjs"],
    beats: ["beat-y.mjs"],
  });
});

test("red report groups failures without running them", () => {
  assert.deepEqual(redByFamily({ items: [
    { state: "red", family: "route" },
    { state: "wired", family: "route" },
    { state: "red", family: "button" },
    { state: "red", family: "route" },
  ] }), [["route", 2], ["button", 1]]);
});

test("Playwright specs never go to Node's test runner", () => {
  assert.deepEqual(splitTestTargets([
    "src/a.test.mjs",
    "e2e/a.spec.mjs",
    "src/b.pg.test.mjs",
  ]), {
    node: ["src/a.test.mjs", "src/b.pg.test.mjs"],
    browser: ["e2e/a.spec.mjs"],
  });
});
