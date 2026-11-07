// The pre-ship collision scan: parsing, overlap logic and isolated local Git.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { blockingOverlaps, chooseMainUpdate, excludeExpectedBase, excludePublishedBranchFiles, fileHandoffs, findOverlaps, inheritedOrderedRefs, isOlderOpenPr, orderChain, orderPrChain, orderedChildRefs, parsePorcelain, parseWorktrees, plannedStackAncestors, publishedUpdateProof, recordedExpectedParent, resolveFileHandoffs, stackAncestorNumbers } from "./preflight-collisions.mjs";
import { FILE_OVERLAP_CUTOVER } from "./release-control.mjs";

test("parsePorcelain keeps the new path on a rename and strips quotes", () => {
  const text = " M src/a.mjs\n?? docs/new.md\nR  old.mjs -> src/b.mjs\n M \"has space.md\"";
  assert.deepEqual(parsePorcelain(text), ["src/a.mjs", "docs/new.md", "src/b.mjs", "has space.md"]);
});

function recordedParentFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-preflight-parent-"));
  const cwd = path.join(dir, "work");
  const remote = path.join(dir, "origin.git");
  const parentWork = path.join(dir, "parent-work");
  fs.mkdirSync(cwd);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--bare", remote);
  git("init", "-b", "main");
  git("config", "user.name", "Preflight test");
  git("config", "user.email", "preflight@example.invalid");
  fs.writeFileSync(path.join(cwd, "shared.txt"), "main\n");
  git("add", "."); git("commit", "-m", "main");
  const main = git("rev-parse", "HEAD");
  git("remote", "add", "origin", remote);
  git("push", "origin", "main");
  git("switch", "-c", "codex/parent");
  fs.writeFileSync(path.join(cwd, "shared.txt"), "old parent\n");
  git("commit", "-am", "old parent");
  const base = git("rev-parse", "HEAD");
  git("switch", "-c", "codex/child");
  fs.writeFileSync(path.join(cwd, "shared.txt"), "child own change\n");
  git("commit", "-am", "child");
  const head = git("rev-parse", "HEAD");
  git("push", "origin", "codex/child");
  git("update-ref", "refs/heads/codex/parent", main, base);
  git("worktree", "add", parentWork, "codex/parent");
  fs.writeFileSync(path.join(parentWork, "shared.txt"), "restacked parent\n");
  execFileSync("git", ["commit", "-am", "restacked parent"], { cwd: parentWork, stdio: "ignore" });
  const parentHead = git("rev-parse", "codex/parent");
  git("push", "origin", "codex/parent");
  const archive = `refs/tags/archive/codex/parent-${base.slice(0, 8)}`;
  git("update-ref", archive, base);
  git("push", "origin", archive);
  const prs = [
    { number: 2, headRefName: "codex/parent", headRefOid: parentHead, baseRefName: "main", labels: [{ name: "ship-order/2" }], body: "", files: [{ path: "shared.txt" }], createdAt: "2026-11-03T10:00:00Z" },
    { number: 3, headRefName: "codex/child", headRefOid: head, baseRefName: "codex/parent", labels: [{ name: "ship-order/3" }], body: `Stack parent head: ${base}`, files: [{ path: "shared.txt" }], createdAt: "2026-11-03T11:00:00Z" }
  ];
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const ghFile = path.join(dir, "prs.json");
  fs.writeFileSync(path.join(bin, "gh"), `#!${process.execPath}\nprocess.stdout.write(require('node:fs').readFileSync(process.env.PREFLIGHT_TEST_PRS));\n`, { mode: 0o755 });
  const scan = (expectedBase = base) => {
    fs.writeFileSync(ghFile, JSON.stringify(prs));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./preflight-collisions.mjs", import.meta.url)), "--no-fetch", "--json", "--expected-base", expectedBase], {
      cwd, encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PREFLIGHT_TEST_PRS: ghFile }
    });
    assert.notEqual(result.status, null, result.error?.message);
    return { status: result.status, report: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
  };
  return { dir, cwd, git, base, head, main, parentHead, parentWork, archive, prs, scan };
}

test("recorded SHA preflight resolves only a verified ordered parent in real Git", async (t) => {
  const cases = [
    ["restacked own parent", () => {}, 0],
    ["unrelated active alias", (f) => f.git("worktree", "add", "-b", "codex/unrelated", path.join(f.dir, "unrelated"), f.parentHead), 1],
    ["unrelated remote-only all-hex branch PR", (f) => {
      f.git("push", "origin", `${f.parentHead}:refs/heads/${f.base}`);
      f.prs.push({ ...f.prs[0], number: 1, headRefName: f.base, labels: [], createdAt: "2026-11-03T09:00:00Z" });
    }, 1],
    ["dirty parent copy", (f) => fs.appendFileSync(path.join(f.parentWork, "shared.txt"), "unsaved\n"), 1],
    ["wrong marker", (f) => { f.prs[1].body = `Stack parent head: ${f.main}`; }, 1],
    ["multiple markers", (f) => { f.prs[1].body += `\nStack parent head: ${f.base}`; }, 1],
    ["missing marker", (f) => { f.prs[1].body = ""; }, 1],
    ["malformed additional marker", (f) => { f.prs[1].body += "\nStack parent head: invalid"; }, 1],
    ["wrong base branch", (f) => { f.prs[1].baseRefName = "codex/foreign"; }, 1],
    ["multiple predecessor orders", (f) => { f.prs.push({ ...f.prs[0], number: 8, headRefName: "codex/other-parent" }); }, 1],
    ["ambiguous child order", (f) => { f.prs[1].labels.push({ name: "ship-order/4" }); }, 1],
    ["malformed parent order", (f) => { f.prs[0].labels.push({ name: "ship-order/invalid" }); }, 1],
    ["duplicate parent branch metadata", (f) => { f.prs.push({ ...f.prs[0], number: 9, labels: [{ name: "ship-order/1" }] }); }, 1],
    ["annotated exact archive", (f) => {
      f.git("tag", "-fa", f.archive.replace("refs/tags/", ""), f.base, "-m", "exact parent history");
      f.git("push", "--force", "origin", f.archive);
    }, 0],
    ["wrong archive", (f) => f.git("push", "--force", "origin", `${f.main}:${f.archive}`), 1],
    ["missing archive", (f) => f.git("push", "origin", `:${f.archive}`), 1],
    ["archive belongs to different branch", (f) => { f.git("push", "origin", `:${f.archive}`); f.git("push", "origin", `${f.base}:refs/tags/archive/codex/foreign-${f.base.slice(0, 8)}`); }, 1],
    ["changed GitHub parent", (f) => { f.prs[0].headRefOid = f.base; }, 1],
    ["changed local parent", (f) => {
      fs.appendFileSync(path.join(f.parentWork, "shared.txt"), "new local work\n");
      execFileSync("git", ["commit", "-am", "new local work"], { cwd: f.parentWork, stdio: "ignore" });
    }, 1],
    ["changed live remote parent", (f) => {
      f.git("push", "--force", "origin", `${f.base}:refs/heads/codex/parent`);
      f.git("update-ref", "refs/remotes/origin/codex/parent", f.parentHead);
    }, 1],
    ["changed tracking parent", (f) => f.git("update-ref", "refs/remotes/origin/codex/parent", f.base), 1],
    ["changed live remote child", (f) => {
      f.git("push", "--force", "origin", `${f.base}:refs/heads/codex/child`);
      f.git("update-ref", "refs/remotes/origin/codex/child", f.head);
    }, 1],
    ["child PR head outside local source ancestry", (f) => {
      f.prs[1].headRefOid = f.parentHead;
      f.git("push", "--force", "origin", `${f.parentHead}:refs/heads/codex/child`);
    }, 1],
    ["new child own commit still preserves remote/source ancestry", (f) => {
      fs.appendFileSync(path.join(f.cwd, "shared.txt"), "local own fix\n");
      f.git("commit", "-am", "own fix");
    }, 0]
  ];
  for (const [name, change, expectedStatus] of cases) {
    await t.test(name, () => {
      const f = recordedParentFixture();
      try {
        change(f);
        const result = f.scan();
        assert.equal(result.status, expectedStatus, JSON.stringify(result));
        if (expectedStatus === 0) {
          assert.deepEqual(result.report.blocking, []);
          assert.ok(result.report.notes.some((note) => note.startsWith("Verified recorded parent ")));
        } else assert.ok(result.report.blocking.length > 0, JSON.stringify(result));
      } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
    });
  }
});

test("an unverified SHA cannot exclude an unrelated source named with that SHA", () => {
  const base = "a".repeat(40);
  const sources = [{ refName: base, kind: "pr", prNumber: 9, sha: "b".repeat(40), files: ["shared.txt"] }];
  assert.deepEqual(excludeExpectedBase(sources, base), sources);
});

test("recorded parent resolution refuses a concurrent local source change during archive reads", () => {
  const f = recordedParentFixture();
  try {
    let changed = false;
    const readGit = (args) => {
      let output;
      try { output = f.git(...args); } catch { return null; }
      if (!changed && args[0] === "ls-remote" && args.includes(f.archive)) {
        changed = true;
        fs.appendFileSync(path.join(f.cwd, "shared.txt"), "concurrent work\n");
        f.git("commit", "-am", "concurrent own work");
      }
      return output;
    };
    assert.equal(recordedExpectedParent(f.prs, "codex/child", f.base, readGit), null);
    assert.equal(changed, true);
    assert.notEqual(f.git("rev-parse", "HEAD"), f.head);
    assert.match(fs.readFileSync(path.join(f.cwd, "shared.txt"), "utf8"), /concurrent work/);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
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

test("a planned ordered child inherits only exact Git-proven ancestor PRs", () => {
  const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40);
  const prs = [
    { number: 1, headRefName: "first", baseRefName: "main", headRefOid: a, labels: ["ship-order/1"] },
    { number: 2, headRefName: "parent", baseRefName: "first", headRefOid: b, labels: ["ship-order/2"] },
    { number: 3, headRefName: "peer", baseRefName: "main", headRefOid: c, labels: ["ship-order/3"] }
  ];
  const readGit = (args) => args[0] === "rev-parse" ? b
    : args[2] === b && args[3] === "HEAD" || [a, b].includes(args[2]) && args[3] === b ? "" : null;
  assert.deepEqual([...plannedStackAncestors(prs, "origin/parent", readGit)], [1, 2]);
  const sources = prs.map((pr) => ({ label: `PR #${pr.number}`, kind: "pr", prNumber: pr.number, files: ["shared.mjs"] }));
  sources.push({ label: "dirty first worktree", kind: "worktree", files: ["shared.mjs"] });
  sources.push({ label: "active peer branch", kind: "branch", active: true, files: ["shared.mjs"] });
  const overlaps = findOverlaps(["shared.mjs"], sources).withMine;
  assert.deepEqual(blockingOverlaps(overlaps, sources, { openPrs: prs, expectedBase: "origin/parent", readGit }).map((o) => o.label),
    ["PR #3", "dirty first worktree", "active peer branch"]);
  assert.deepEqual([...plannedStackAncestors(prs, null, readGit)], []);
  assert.deepEqual([...plannedStackAncestors(prs, "origin/peer", readGit)], []);
  assert.deepEqual([...plannedStackAncestors(prs, "origin/parent", () => null)], []);
  assert.deepEqual([...plannedStackAncestors(prs.map((p) => ({ ...p, labels: [] })), "origin/parent", readGit)], []);
  const moved = prs.map((p) => p.number === 1 ? { ...p, headRefOid: c } : p);
  assert.deepEqual([...plannedStackAncestors(moved, "origin/parent", readGit)], [2]);
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

// Actual Git trees: the controller-rewritten local candidate is NOT descended
// from its published PR head. Eight files change; 72 published files do not.
function publishedUpdateFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-preflight-update-"));
  const cwd = path.join(dir, "work"), remote = path.join(dir, "origin.git"), peerWork = path.join(dir, "peer");
  fs.mkdirSync(cwd);
  const command = (where, args) => execFileSync("git", args, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const git = (...args) => command(cwd, args);
  git("init", "--bare", remote); git("init", "-b", "main");
  git("config", "user.name", "Preflight test"); git("config", "user.email", "preflight@example.invalid");
  const files = Array.from({ length: 80 }, (_, n) => n === 0 ? "policy.txt" : `file-${n}.txt`);
  for (const file of [...files, "manifest566.txt"]) fs.writeFileSync(path.join(cwd, file), "main\n");
  git("add", "."); git("commit", "-m", "main"); const initial = git("rev-parse", "HEAD");
  git("remote", "add", "origin", remote); git("push", "origin", "main");
  git("switch", "-c", "codex/current");
  for (const file of files) fs.writeFileSync(path.join(cwd, file), "published\n");
  fs.writeFileSync(path.join(cwd, "manifest566.txt"), "landed566\n");
  git("commit", "-am", "published"); git("push", "origin", "codex/current"); const published = git("rev-parse", "HEAD");
  git("switch", "-c", "codex/peer", initial);
  for (const file of files) fs.writeFileSync(path.join(cwd, file), "published\n");
  git("commit", "-am", "independent history, identical published files"); const peer = git("rev-parse", "HEAD");
  git("switch", "-c", "codex/old-blake", initial);
  fs.writeFileSync(path.join(cwd, "manifest566.txt"), "stale566\n"); git("commit", "-am", "old manifest");
  git("switch", "main"); fs.writeFileSync(path.join(cwd, "manifest566.txt"), "landed566\n");
  git("commit", "-am", "566 already landed"); git("push", "origin", "main"); const main = git("rev-parse", "HEAD");
  git("switch", "-C", "codex/current", main);
  for (const [n, file] of files.entries()) fs.writeFileSync(path.join(cwd, file), n < 8 ? "candidate\n" : "published\n");
  git("commit", "-am", "rewritten candidate with eight new edits"); const head = git("rev-parse", "HEAD");
  git("worktree", "add", peerWork, "codex/peer");
  git("worktree", "add", path.join(dir, "blake"), "codex/old-blake");
  const prs = [{ number: 437, headRefName: "codex/current", headRefOid: published, baseRefName: "main",
    files: files.map(p => ({ path: p })), labels: [], body: "", createdAt: "2026-11-03T10:00:00Z" }];
  const bin = path.join(dir, "bin"), ghFile = path.join(dir, "prs.json"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');
const file=process.env.PREFLIGHT_TEST_PRS, countFile=file+'.reads';
const count=fs.existsSync(countFile)?Number(fs.readFileSync(countFile))+1:1;fs.writeFileSync(countFile,String(count));
if(count===2&&process.env.PREFLIGHT_FINAL_GIT)for(const args of JSON.parse(process.env.PREFLIGHT_FINAL_GIT))cp.execFileSync('git',args,{stdio:'ignore'});
if(count===2&&process.env.PREFLIGHT_FINAL_WRITE)for(const [file,text] of JSON.parse(process.env.PREFLIGHT_FINAL_WRITE))fs.writeFileSync(file,text);
process.stdout.write(fs.readFileSync(file));\n`, { mode: 0o755 });
  const readGit = args => { try { return git(...args); } catch { return null; } };
  const scan = (finalGit = [], finalWrite = []) => {
    fs.writeFileSync(ghFile, JSON.stringify(prs)); fs.rmSync(ghFile + ".reads", { force: true });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./preflight-collisions.mjs", import.meta.url)), "--no-fetch", "--json"], {
      cwd, encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        PREFLIGHT_TEST_PRS: ghFile, PREFLIGHT_FINAL_GIT: JSON.stringify(finalGit), PREFLIGHT_FINAL_WRITE: JSON.stringify(finalWrite) }
    });
    return { status: result.status, report: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
  };
  return { dir, cwd, remote, peerWork, files, git, command, readGit, published, peer, main, head, prs, scan };
}

test("existing PR updates compare direct trees and keep real competing owners", async t => {
  const cases = [
    ["rewritten nonancestor update has exactly eight real changed files", () => {}, 0],
    ["real peer policy edit blocks", f => { fs.writeFileSync(path.join(f.peerWork, "policy.txt"), "peer owns a new policy\n"); f.command(f.peerWork, ["commit", "-am", "peer policy"]); }, 1],
    ["peer mode change blocks identical bytes", f => { f.command(f.peerWork, ["update-index", "--chmod=+x", "policy.txt"]); f.command(f.peerWork, ["commit", "-m", "peer mode"]); }, 1],
    ["dirty peer stays blocking", f => fs.appendFileSync(path.join(f.peerWork, "policy.txt"), "unsaved\n"), 1],
    ["explicit PR claim stays blocking", f => f.prs.push({ number: 436, headRefName: "codex/peer", headRefOid: f.peer,
      baseRefName: "main", labels: [], body: "", files: [{ path: "policy.txt" }], createdAt: "2026-11-03T09:00:00Z" }), 1],
    ["no own PR retains the original full scope", f => f.prs.splice(0), 1],
    ["invalid PR identity never exempts", f => { f.prs[0].number = 0; }, 2],
    ["duplicate PR identity never exempts", f => f.prs.push({ ...f.prs[0], headRefName: "codex/other" }), 2],
    ["missing tracking ref never exempts", f => f.git("update-ref", "-d", "refs/remotes/origin/codex/current"), 2],
    ["missing live ref never exempts", f => execFileSync("git", ["--git-dir", f.remote, "update-ref", "-d", "refs/heads/codex/current"]), 2],
    ["missing published commit never exempts", f => { f.prs[0].headRefOid = "f".repeat(40); }, 2]
  ];
  for (const [name, change, expected] of cases) await t.test(name, () => {
    const f = publishedUpdateFixture();
    try {
      change(f);
      const result = f.scan();
      assert.equal(result.status, expected, JSON.stringify(result));
      if (expected === 0) {
        assert.throws(() => f.git("merge-base", "--is-ancestor", f.published, f.head));
        assert.throws(() => f.git("merge-base", "--is-ancestor", f.published, f.peer));
        assert.equal(result.report.myFiles, 8);
        assert.deepEqual(result.report.blocking, []);
        assert.ok(!result.report.withMine.some(row => row.files.includes("manifest566.txt")));
      } else if (expected === 1) assert.ok(result.report.blocking.length);
      else assert.equal(result.report, null);
      if (!f.prs.length) assert.equal(result.report.myFiles, 80, "no verified own PR retains the original main-based scope");
    } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
  });
});

test("published-copy filtering never mutates PR or raw worktree claims", () => {
  const f = publishedUpdateFixture();
  try {
    const proof = publishedUpdateProof(f.prs, "codex/current", f.readGit);
    const branch = { kind: "branch", refName: "codex/peer", sha: f.peer, files: ["policy.txt"] };
    const pr = { ...branch, kind: "pr" }, dirty = { ...branch, kind: "worktree" };
    const filtered = excludePublishedBranchFiles([branch, pr, dirty], proof, ["policy.txt"], f.readGit);
    assert.deepEqual(filtered.sources, [pr, dirty]);
    assert.equal(filtered.sources[0], pr); assert.equal(filtered.sources[1], dirty);
    assert.deepEqual(branch.files, ["policy.txt"]);
    assert.deepEqual(filtered.excluded, [{ ref: "refs/heads/codex/peer", sha: f.peer }]);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("full CLI final barrier rejects moving peer, published head and local source", async t => {
  for (const scenario of ["peer", "published", "local", "commit during status"]) await t.test(scenario, () => {
    const f = publishedUpdateFixture();
    try {
      fs.writeFileSync(path.join(f.peerWork, "policy.txt"), "real concurrent peer edit\n");
      f.command(f.peerWork, ["commit", "-am", "peer next edit"]);
      const next = f.command(f.peerWork, ["rev-parse", "HEAD"]);
      f.command(f.peerWork, ["reset", "--hard", f.peer]);
      if (scenario === "commit during status") {
        const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
        fs.writeFileSync(path.join(f.dir, "bin", "git"), `#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2);
const result=cp.spawnSync(${JSON.stringify(realGit)},args,{encoding:'utf8'});
const countFile=${JSON.stringify(path.join(f.dir, "prs.json.reads"))}, marker=${JSON.stringify(path.join(f.dir, "status-race"))};
if(args[0]==='status'&&fs.realpathSync(process.cwd())===fs.realpathSync(${JSON.stringify(f.peerWork)})&&fs.existsSync(countFile)
  &&Number(fs.readFileSync(countFile))>=2&&!fs.existsSync(marker)){
  cp.execFileSync(${JSON.stringify(realGit)},['reset','--hard',${JSON.stringify(next)}],{stdio:'ignore'});fs.writeFileSync(marker,'moved');
}
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??98);
`, { mode: 0o755 });
      }
      const command = scenario === "peer" ? ["-C", f.peerWork, "reset", "--hard", next]
        : scenario === "published" ? ["--git-dir", f.remote, "update-ref", "refs/heads/codex/current", f.main]
          : ["update-ref", "refs/heads/codex/current", f.main];
      const result = f.scan(scenario === "commit during status" ? [] : [command]);
      if (scenario === "commit during status") {
        assert.ok(fs.existsSync(path.join(f.dir, "status-race")), "the real commit during final status was reached");
        assert.equal(f.command(f.peerWork, ["rev-parse", "HEAD"]), next, "the peer actually committed before judging the guard");
      }
      assert.equal(result.status, 2, JSON.stringify(result));
      assert.equal(result.report, null);
      assert.match(result.stderr, /proof changed during collision checks/);
      if (["peer", "commit during status"].includes(scenario)) assert.equal(f.command(f.peerWork, ["rev-parse", "HEAD"]), next);
    } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
  });
});

test("full CLI final barrier detects new relevant dirty claims and worktrees without blocking unrelated dirty work", async t => {
  for (const scenario of ["peer dirty", "new own dirty", "new worktree", "unrelated peer dirty"]) await t.test(scenario, () => {
    const f = publishedUpdateFixture();
    try {
      const finalGit = scenario === "new worktree" ? [["worktree", "add", "--detach", path.join(f.dir, "new-owner"), f.main]] : [];
      const file = scenario === "peer dirty" ? path.join(f.peerWork, "policy.txt")
        : scenario === "new own dirty" ? path.join(f.cwd, "new-own.txt") : path.join(f.peerWork, "unrelated-peer.txt");
      const result = f.scan(finalGit, scenario === "new worktree" ? [] : [[file, "new unsaved work\n"]]);
      assert.equal(result.status, scenario === "unrelated peer dirty" ? 0 : 2, JSON.stringify(result));
      assert.equal(f.git("rev-parse", "codex/peer"), f.peer, "dirty appearance must be caught without a ref change");
      if (result.status === 2) { assert.equal(result.report, null); assert.match(result.stderr, /proof changed during collision checks/); }
      else assert.deepEqual(result.report.blocking, []);
    } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
  });
});
