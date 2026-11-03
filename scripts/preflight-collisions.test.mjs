// The pre-ship collision scan: parsing, overlap logic and isolated local Git.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { blockingOverlaps, chooseMainUpdate, excludeExpectedBase, fileHandoffs, findOverlaps, inheritedOrderedRefs, isOlderOpenPr, orderChain, orderPrChain, orderedChildRefs, parsePorcelain, parseWorktrees, recordedExpectedParent, resolveFileHandoffs, stackAncestorNumbers } from "./preflight-collisions.mjs";
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
