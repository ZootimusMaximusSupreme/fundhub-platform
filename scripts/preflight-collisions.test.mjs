// The pre-ship collision scan: parsing and overlap logic. No git, no network.

import { test } from "node:test";
import assert from "node:assert/strict";

import { chooseMainUpdate, excludeExpectedBase, findOverlaps, orderChain, orderPrChain, parsePorcelain, parseWorktrees } from "./preflight-collisions.mjs";

test("parsePorcelain keeps the new path on a rename and strips quotes", () => {
  const text = " M src/a.mjs\n?? docs/new.md\nR  old.mjs -> src/b.mjs\n M \"has space.md\"";
  assert.deepEqual(parsePorcelain(text), ["src/a.mjs", "docs/new.md", "src/b.mjs", "has space.md"]);
});

test("parseWorktrees reads branch and prunable flags", () => {
  const text = [
    "worktree /repo", "HEAD abc", "branch refs/heads/main", "",
    "worktree /tmp/x", "HEAD def", "detached", "prunable gitdir file points to non-existent location", "",
    "worktree /dev/fh-y", "HEAD 123", "branch refs/heads/claude/y", ""
  ].join("\n");
  assert.deepEqual(parseWorktrees(text), [
    { path: "/repo", branch: "main", prunable: false },
    { path: "/tmp/x", branch: null, prunable: true },
    { path: "/dev/fh-y", branch: "claude/y", prunable: false }
  ]);
});

test("findOverlaps reports files shared with this branch", () => {
  const { withMine } = findOverlaps(["src/a.mjs", "src/b.mjs"], [
    { label: "branch x", files: ["src/b.mjs", "src/c.mjs"] },
    { label: "PR #9 y", files: ["src/d.mjs"] }
  ]);
  assert.deepEqual(withMine, [{ label: "branch x", files: ["src/b.mjs"] }]);
});

test("findOverlaps lists hot files touched by two or more other sources", () => {
  const { withMine, hot } = findOverlaps([], [
    { label: "branch x", files: ["src/c.mjs", "src/c.mjs"] },
    { label: "PR #9 y", files: ["src/c.mjs", "src/e.mjs"] },
    { label: "unsaved in fh-z (z)", files: ["src/e.mjs", "src/c.mjs"] }
  ]);
  assert.deepEqual(withMine, []);
  assert.deepEqual(hot, [
    { file: "src/c.mjs", labels: ["PR #9 y", "branch x", "unsaved in fh-z (z)"] },
    { file: "src/e.mjs", labels: ["PR #9 y", "unsaved in fh-z (z)"] }
  ]);
});

test("main refresh attempts a safe Git fast-forward and preserves divergent history", () => {
  assert.deepEqual(chooseMainUpdate({ mainExists: true, behind: 7, canFastForward: true, worktreePath: "/repo", dirty: true }),
    { action: "merge" });
  assert.deepEqual(chooseMainUpdate({ mainExists: true, behind: 7, canFastForward: false, worktreePath: "/repo", dirty: false }),
    { action: "none", reason: "local main diverged from origin/main" });
  assert.deepEqual(chooseMainUpdate({ mainExists: true, behind: 7, canFastForward: true, worktreePath: "/repo", dirty: false }),
    { action: "merge" });
  assert.deepEqual(chooseMainUpdate({ mainExists: true, behind: 7, canFastForward: true, worktreePath: null, dirty: false }),
    { action: "branch" });
  assert.deepEqual(chooseMainUpdate({ mainExists: false, behind: 0, canFastForward: true, worktreePath: null, dirty: false }),
    { action: "create" });
});

test("chain warning orders unmerged ancestors and deduplicates local and remote refs", () => {
  const chain = orderChain([
    { name: "origin/base", sha: "a", ahead: 2, ancestor: true },
    { name: "base", sha: "a", ahead: 2, ancestor: true },
    { name: "middle", sha: "b", ahead: 5, ancestor: true },
    { name: "unrelated", sha: "c", ahead: 1, ancestor: false },
    { name: "landed", sha: "d", ahead: 0, ancestor: true },
    { name: "current", sha: "e", ahead: 6, ancestor: true }
  ], "current");
  assert.deepEqual(chain, ["base", "middle"]);
});

test("an expected stack parent is excluded while unrelated collisions remain", () => {
  const sources = [
    { refName: "parent", label: "branch parent", files: ["src/shared.mjs"] },
    { refName: "parent", label: "PR #2 parent", files: ["src/shared.mjs"] },
    { refName: "other", label: "PR #3 other", files: ["src/shared.mjs"] }
  ];
  const { withMine } = findOverlaps(["src/shared.mjs"], excludeExpectedBase(sources, "origin/parent"));
  assert.deepEqual(withMine, [{ label: "PR #3 other", files: ["src/shared.mjs"] }]);
});

test("PR base metadata keeps chain order even when a parent head moved", () => {
  assert.deepEqual(orderPrChain([
    { headRefName: "first", baseRefName: "main" },
    { headRefName: "second", baseRefName: "first" },
    { headRefName: "third", baseRefName: "second" }
  ], "third"), ["first", "second"]);
});
