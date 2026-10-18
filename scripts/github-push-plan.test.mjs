import assert from "node:assert/strict";
import { test } from "node:test";
import { planBranchPushes, requireMainFastForward } from "./github-push-plan.mjs";

test("pushes unfinished branches and skips branches already contained in the main being pushed", () => {
  const { active, merged } = planBranchPushes(
    ["main", "fin/b01", "codex/call-invite-push", "codex/two-ios-apps-launch"],
    (branch) => branch === "fin/b01"
  );
  assert.deepEqual(active, ["codex/call-invite-push", "codex/two-ios-apps-launch"]);
  assert.deepEqual(merged, ["fin/b01"]);
});

test("refuses to push an old local main over newer GitHub commits", () => {
  assert.doesNotThrow(() => requireMainFastForward(true));
  assert.throws(() => requireMainFastForward(false), /refusing to overwrite newer GitHub commits/);
});
