// The AI bureau caller's dial plan comes from its own call scripts (owner answer B7, 2026-10-20).

import { test } from "node:test";
import assert from "node:assert/strict";
import { BUREAU_SCRIPTS, DIAL_NUMBER_RE, MIN_MENU_STEPS, bureauDialPlan, menuSteps } from "./bureau-dial-plan.mjs";

test("the real scripts carry a dialable number and a phone menu for EX, EQ and TU", () => {
  const plan = bureauDialPlan({ env: {} });
  assert.deepEqual(plan.map((p) => p.code), ["EX", "EQ", "TU"]);
  for (const p of plan) {
    assert.equal(p.problem, null, p.code);
    assert.match(p.number, DIAL_NUMBER_RE, p.code);
    assert.equal(p.numberOk, true, p.code);
    assert.ok(p.steps >= MIN_MENU_STEPS, `${p.code} has ${p.steps} menu steps`);
    assert.equal(p.menuOk, true, p.code);
  }
});

test("the same three bureaus the caller builds a call for (bureau-call.mjs BUREAU_CONFIGS)", () => {
  assert.deepEqual(BUREAU_SCRIPTS.map((s) => s.code), ["EX", "EQ", "TU"]);
});

test("menuSteps reads only the IVR section: STEP lines or a numbered list", () => {
  const ivr = "intro\n## PHASE 1: IVR (Automated System)\n\nSTEP 1: say Dispute\nSTEP 2: say No\nnot a step\nSTEP 3: press zip\n## PHASE 2: FIRST AGENT\nSTEP 9: not menu";
  assert.equal(menuSteps(ivr).length, 3);
  const list = "## Step-by-Step Script\n1. press 1\n2. ssn\n3. zip\n4. say fraud alert\n## Your Information\n5. not menu";
  assert.equal(menuSteps(list).length, 4);
  assert.deepEqual(menuSteps("no menu heading\nSTEP 1: x"), []);
  assert.deepEqual(menuSteps(undefined), []);
});

test("a bad number, a short menu, or a script that throws is not ok", () => {
  const scripts = [
    { code: "EX", name: "Experian", env: "X", build: () => ({ phoneNumber: "****************1234", task: "## PHASE 1: IVR\nSTEP 1: a\nSTEP 2: b\nSTEP 3: c" }) },
    { code: "EQ", name: "Equifax", env: "Y", build: () => ({ phoneNumber: "+18005550000", task: "## PHASE 1: IVR\nSTEP 1: a" }) },
    { code: "TU", name: "TransUnion", env: "Z", build: () => { throw new Error("missing script"); } }
  ];
  const [ex, eq, tu] = bureauDialPlan({ scripts, env: { X: "set" } });
  assert.equal(ex.numberOk, false);
  assert.equal(ex.menuOk, true);
  assert.equal(ex.numberFrom, "setting");
  assert.equal(eq.numberOk, true);
  assert.equal(eq.menuOk, false);
  assert.equal(eq.numberFrom, "script");
  assert.equal(tu.numberOk, false);
  assert.equal(tu.menuOk, false);
  assert.match(tu.problem, /missing script/);
});
