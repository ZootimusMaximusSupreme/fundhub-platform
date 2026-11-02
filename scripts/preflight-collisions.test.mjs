// The pre-ship collision scan: parsing and overlap logic. No git, no network.

import { test } from "node:test";
import assert from "node:assert/strict";

import { blockingOverlaps, chooseMainUpdate, excludeExpectedBase, fileHandoffs, findOverlaps, inheritedOrderedRefs, isOlderOpenPr, orderChain, orderPrChain, orderedChildRefs, parsePorcelain, parseWorktrees, resolveFileHandoffs, stackAncestorNumbers } from "./preflight-collisions.mjs";
import { FILE_OVERLAP_CUTOVER } from "./release-control.mjs";

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

test("only active worktrees and open PRs block; unattached local refs still warn", () => {
  const sources = [
    { label: "branch old", kind: "branch", active: false, files: ["src/shared.mjs"] },
    { label: "branch editing", kind: "branch", active: true, files: ["src/shared.mjs"] },
    { label: "PR #9 ready", kind: "pr", prNumber: 9, prCreatedAt: "2026-11-03T10:00:00Z", files: ["src/shared.mjs"] },
    { label: "unsaved in worktree", kind: "worktree", files: ["src/shared.mjs"] }
  ];
  const { withMine } = findOverlaps(["src/shared.mjs"], sources);
  const currentPr = { number: 450, headRefName: "codex/new", createdAt: "2026-11-03T10:00:00Z" };
  assert.deepEqual(blockingOverlaps(withMine, sources, { currentPr, openPrs: [currentPr] }).map((item) => item.label),
    ["branch editing", "PR #9 ready", "unsaved in worktree"]);
  assert.deepEqual(blockingOverlaps(withMine, [sources[0]]), []);
});

test("legacy open PR warns on peer overlap; post-cutover PR blocks only on older peers", () => {
  const legacyCurrent = { number: 270, headRefName: "codex/calendar-task-dedupe", createdAt: "2026-10-29T22:14:51Z", baseRefName: "main" };
  const older = { number: 280, headRefName: "feat/qualification-bucket", createdAt: "2026-10-30T12:00:00Z", baseRefName: "main" };
  const newer = { number: 325, headRefName: "codex/crm-phone-formatting", createdAt: "2026-10-31T12:00:00Z", baseRefName: "main" };
  const sources = [
    { label: `PR #${older.number} ${older.headRefName}`, kind: "pr", prNumber: older.number, prCreatedAt: older.createdAt, files: ["docs/journeys/CHANGELOG.md"] },
    { label: `PR #${newer.number} ${newer.headRefName}`, kind: "pr", prNumber: newer.number, prCreatedAt: newer.createdAt, files: ["docs/journeys/CHANGELOG.md"] },
    { label: "unsaved in fh-y (fh-y)", kind: "worktree", files: ["docs/journeys/CHANGELOG.md"] }
  ];
  const { withMine } = findOverlaps(["docs/journeys/CHANGELOG.md"], sources);
  assert.equal(Date.parse(legacyCurrent.createdAt) < Date.parse(FILE_OVERLAP_CUTOVER), true);
  assert.deepEqual(blockingOverlaps(withMine, sources, { currentPr: legacyCurrent, openPrs: [legacyCurrent, older, newer] }).map((x) => x.label),
    ["unsaved in fh-y (fh-y)"]);

  const newCurrent = { number: 450, headRefName: "codex/new", createdAt: "2026-11-03T10:00:00Z", baseRefName: "main" };
  assert.deepEqual(blockingOverlaps(withMine, sources, { currentPr: newCurrent, openPrs: [newCurrent, older, newer] }).map((x) => x.label),
    [`PR #${older.number} ${older.headRefName}`, `PR #${newer.number} ${newer.headRefName}`, "unsaved in fh-y (fh-y)"]);
  const peerYounger = { number: 451, headRefName: "codex/later", createdAt: "2026-11-03T11:00:00Z", baseRefName: "main" };
  const withYounger = [...sources, { label: `PR #${peerYounger.number} ${peerYounger.headRefName}`, kind: "pr", prNumber: peerYounger.number, prCreatedAt: peerYounger.createdAt, files: ["docs/journeys/CHANGELOG.md"] }];
  const overlapYounger = findOverlaps(["docs/journeys/CHANGELOG.md"], withYounger).withMine;
  assert.deepEqual(blockingOverlaps(overlapYounger, withYounger, { currentPr: newCurrent, openPrs: [newCurrent, older, newer, peerYounger] }).map((x) => x.label),
    [`PR #${older.number} ${older.headRefName}`, `PR #${newer.number} ${newer.headRefName}`, "unsaved in fh-y (fh-y)"]);
});

test("branch with no open PR still treats peer PR overlap as blocking", () => {
  const sources = [{ label: "PR #9 peer", kind: "pr", prNumber: 9, prCreatedAt: "2026-10-29T00:00:00Z", files: ["src/a.mjs"] }];
  const { withMine } = findOverlaps(["src/a.mjs"], sources);
  assert.deepEqual(blockingOverlaps(withMine, sources, { currentPr: null, openPrs: [] }).map((x) => x.label), ["PR #9 peer"]);
});

test("isOlderOpenPr and stack ancestors match release-control overlap ordering", () => {
  assert.equal(isOlderOpenPr({ number: 280, createdAt: "2026-10-30T00:00:00Z" }, Date.parse("2026-11-03T10:00:00Z"), 450), true);
  assert.equal(isOlderOpenPr({ number: 451, createdAt: "2026-11-03T11:00:00Z" }, Date.parse("2026-11-03T10:00:00Z"), 450), false);
  const openPrs = [
    { number: 1, headRefName: "parent", baseRefName: "main" },
    { number: 2, headRefName: "child", baseRefName: "parent" }
  ];
  assert.deepEqual([...stackAncestorNumbers(openPrs, "child")], [1]);
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

test("exact PR file handoff needs the target branch and a clean merge", () => {
  const body = "File handoff: src/pulse/registry.mjs -> codex/slideshow-live-pages\n";
  assert.deepEqual([...fileHandoffs(body, "codex/slideshow-live-pages")], ["src/pulse/registry.mjs"]);
  assert.deepEqual([...fileHandoffs(body, "codex/other")], []);
  const sources = [
    { refName: "older", kind: "branch", label: "branch older", files: ["src/pulse/registry.mjs", "src/other.mjs"] },
    { refName: "older", kind: "pr", label: "PR #355 older", files: ["src/pulse/registry.mjs"] },
    { refName: "unrelated", kind: "pr", label: "PR #356 unrelated", files: ["src/other.mjs"] }
  ];
  const prs = [{ number: 355, headRefName: "older", body }];
  const allowed = resolveFileHandoffs(sources, prs, "codex/slideshow-live-pages", (file) => file === "src/pulse/registry.mjs");
  assert.equal(allowed.accepted.length, 2);
  assert.deepEqual(findOverlaps(["src/pulse/registry.mjs", "src/other.mjs"], allowed.sources).withMine.map((item) => item.label),
    ["branch older", "PR #356 unrelated"]);
  const conflicted = resolveFileHandoffs(sources, prs, "codex/slideshow-live-pages", () => false);
  assert.deepEqual(findOverlaps(["src/pulse/registry.mjs"], conflicted.sources).withMine.map((item) => item.label),
    ["branch older", "PR #355 older"]);
});

test("PR base metadata keeps chain order even when a parent head moved", () => {
  assert.deepEqual(orderPrChain([
    { headRefName: "first", baseRefName: "main" },
    { headRefName: "second", baseRefName: "first" },
    { headRefName: "third", baseRefName: "second" }
  ], "third"), ["first", "second"]);
});

test("an ordered child and its descendants inherit the parent's files without blocking its preflight", () => {
  const ordered = [{ name: "ship-order/2" }];
  const prs = [
    { headRefName: "child", baseRefName: "parent", labels: ordered },
    { headRefName: "grandchild", baseRefName: "child", labels: [{ name: "ship-order/3" }] },
    { headRefName: "unrelated", baseRefName: "main", labels: ordered },
    { headRefName: "unlabeled", baseRefName: "parent", labels: [] },
  ];
  const children = orderedChildRefs(prs, "parent");
  assert.deepEqual([...children], ["child", "grandchild"]);
  const sources = ["child", "grandchild", "unrelated", "unlabeled"].map((refName) =>
    ({ refName, label: `branch ${refName}`, files: ["src/shared.mjs"] }));
  const { withMine } = findOverlaps(["src/shared.mjs"], sources.filter((source) => !children.has(source.refName)));
  assert.deepEqual(withMine.map((source) => source.label), ["branch unrelated", "branch unlabeled"]);
});

test("local branches stacked on an ordered child inherit its files too", () => {
  const children = new Set(["ordered-child"]);
  const sources = [
    { kind: "branch", refName: "local-grandchild" },
    { kind: "branch", refName: "unrelated" },
    { kind: "worktree", refName: "unsaved" }
  ];
  const inherited = inheritedOrderedRefs(sources, children,
    (parent, branch) => parent === "ordered-child" && branch === "local-grandchild");
  assert.deepEqual([...inherited], ["ordered-child", "local-grandchild"]);
});
