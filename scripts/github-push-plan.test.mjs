import assert from "node:assert/strict";
import { test } from "node:test";
import { planBranchPushes, requireMainFastForward, publicationPushes } from "./github-push-plan.mjs";
import fs from "node:fs";

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

test("main-only publication preserves the helper's authenticated path and excludes other refs", () => {
  assert.deepEqual(publicationPushes("remote", ["other-owner"], { mainOnly: true }),
    [["push", "--no-follow-tags", "remote", "refs/heads/main:refs/heads/main"]]);
  assert.deepEqual(publicationPushes("remote", ["other-owner"]),
    [["push", "remote", "main"], ["push", "remote", "--tags"], ["push", "remote", "other-owner"]]);
  const source = fs.readFileSync(new URL("./github-push-whole-repo.mjs", import.meta.url), "utf8");
  assert.match(source, /const mainOnly = process\.argv\.includes\("--main-only"\)/);
  assert.match(source, /const branches = mainOnly \? \["main"\]/);
  assert.match(source, /for \(const args of publicationPushes\(remoteUrl, branchesToPush, \{ mainOnly \}\)\)/);
});
