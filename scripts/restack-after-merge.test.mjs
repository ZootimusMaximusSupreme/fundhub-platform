import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveHead, catchUpAfterShip, directChildren, main, mainBaseBody, nextQueuedPr, orderOf, recordedParentHead, restackChild, restackMergedDelta } from "./restack-after-merge.mjs";

const repo = "ZootimusMaximusSupreme/fundhub-platform";
const parentSha = "a".repeat(40);
const childSha = "b".repeat(40);
const merged = { number: 40, merged: true, base: { ref: "main" }, labels: [{ name: "ship-order/1" }],
  head: { ref: "codex/parent", sha: parentSha, repo: { full_name: repo } } };
const child = { number: 41, state: "open", base: { ref: "codex/parent" },
  head: { ref: "codex/child", sha: childSha, repo: { full_name: repo } },
  labels: [{ name: "ship-order/2" }] };

test("child selection includes legacy direct children but ignores unrelated and foreign PRs", () => {
  const foreign = { ...child, number: 42, head: { ...child.head, repo: { full_name: "else/repo" } } };
  const wrongBase = { ...child, number: 43, base: { ref: "codex/unrelated" } };
  const legacy = { ...child, number: 44, labels: [] };
  assert.equal(orderOf(child), 2);
  assert.equal(orderOf({ ...child, labels: ["ship-order/2", "ship-order/3"] }), null);
  assert.deepEqual(directChildren([foreign, wrongBase, legacy, child], merged, repo).map((pr) => pr.number), [41, 44]);
});

test("unlabeled legacy parent selects only PRs based on its branch", () => {
  const legacyParent = { ...merged, labels: [] };
  const legacyChild = { ...child, labels: [] };
  const unrelatedMain = { ...child, number: 45, base: { ref: "main" }, labels: [] };
  assert.deepEqual(directChildren([unrelatedMain, legacyChild], legacyParent, repo)
    .map((pr) => pr.number), [41]);
});

test("recorded parent tip must be one exact SHA", () => {
  const marker = "c".repeat(40);
  assert.equal(recordedParentHead({ body: `Release manifest\nStack parent head: ${marker}\n` }), marker);
  assert.equal(recordedParentHead({ body: `Stack parent head: ${marker}\nStack parent head: ${marker}` }), null);
  assert.equal(recordedParentHead({ body: "Stack parent head: not-a-sha" }), null);
});

test("main retarget metadata preserves ownership and evidence but removes the old parent receipt", () => {
  const body = `Ordered change 2.\nBase: codex/parent\nOwner lane: ar\nStack parent head: ${parentSha}\n\nScope and evidence remain here.`;
  assert.equal(mainBaseBody(body), "Ordered change 2.\nBase: main\nOwner lane: ar\n\nScope and evidence remain here.");
  assert.equal(mainBaseBody("Owner lane: ci\nEvidence remains."), "Owner lane: ci\nEvidence remains.\n\nBase: main");
});

test("moving the exact archive tag preserves its prior tip first", () => {
  const old = "d".repeat(40);
  const head = "e".repeat(40);
  const canonical = "refs/tags/archive/codex/child";
  const history = `refs/tags/archive/codex/child-${old.slice(0, 8)}`;
  const calls = [];
  const pushed = new Set();
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "git" && args[0] === "rev-parse") return head;
    if (program === "git" && args[0] === "ls-remote") {
      const ref = args.at(-1);
      return ref === canonical ? `${pushed.has(canonical) ? head : old}\t${ref}`
        : pushed.has(history) ? `${old}\t${ref}` : "";
    }
    if (program === "git" && args[0] === "push") pushed.add(args.at(-1));
    return "";
  };
  archiveHead("codex/child", run);
  const historyPush = calls.findIndex((call) => call[0] === "git" && call[1] === "push" && call.at(-1) === history);
  const canonicalPush = calls.findIndex((call) => call[0] === "git" && call[1] === "push" && call.at(-1) === canonical);
  assert.ok(historyPush >= 0 && historyPush < canonicalPush);
});

test("ship receipt catches up only the first ordered PR based on main", () => {
  const first = { ...child, base: { ref: "main" }, labels: [{ name: "ship-order/2" }] };
  const later = { ...first, number: 42, labels: [{ name: "ship-order/3" }] };
  const legacy = { ...first, number: 43, labels: [] };
  assert.equal(nextQueuedPr([later, legacy, first], repo).number, 41);
  const calls = [];
  const rebased = "c".repeat(40);
  let tagPushed = false;
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "gh" && args[0] === "api" && args[1] === `repos/${repo}/pulls/41`) {
      return JSON.stringify(first);
    }
    if (program === "git" && args[0] === "rev-parse") {
      return args[1] === "HEAD" ? rebased : childSha;
    }
    if (program === "git" && args[0] === "merge-base") throw new Error("behind");
    if (program === "git" && args[0] === "ls-remote") {
      return tagPushed ? `${rebased}\trefs/tags/archive/codex/child` : "";
    }
    if (program === "git" && args[0] === "push" && args.at(-1) === "refs/tags/archive/codex/child") {
      tagPushed = true;
    }
    return "";
  };
  assert.deepEqual(catchUpAfterShip({ prs: [later, legacy, first], repo, run }),
    [{ number: 41, state: "caught-up" }]);
  const rebase = calls.findIndex((call) => call[0] === "git" && call[1] === "rebase" && call[2] === "origin/main");
  const tag = calls.findIndex((call) => call[0] === "git" && call[1] === "push" && call.at(-1) === "refs/tags/archive/codex/child");
  const push = calls.findIndex((call) => call[0] === "git" && call[1] === "push" && call.at(-1) === "HEAD:refs/heads/codex/child");
  const auto = calls.findIndex((call) => call[0] === "gh" && call[1] === "pr" && call[2] === "merge");
  assert.ok(rebase < tag && tag < push && push < auto);
  assert.ok(calls[push].includes(`--force-with-lease=refs/heads/codex/child:${childSha}`));
});

test("ship receipt conflict comments and leaves the branch unchanged", () => {
  const first = { ...child, base: { ref: "main" } };
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "gh" && args[0] === "api" && args[1] === `repos/${repo}/pulls/41`) return JSON.stringify(first);
    if (program === "git" && args[0] === "rev-parse") return childSha;
    if (program === "git" && args[0] === "merge-base") throw new Error("behind");
    if (program === "git" && args[0] === "rebase" && args[1] === "origin/main") throw new Error("conflict");
    return "";
  };
  assert.deepEqual(catchUpAfterShip({ prs: [first], repo, run }), [{ number: 41, state: "conflict" }]);
  assert.ok(calls.some((call) => call[0] === "gh" && call.includes(`repos/${repo}/issues/41/comments`)
    && call.some((value) => value.includes("@ZootimusMaximusSupreme"))));
  assert.equal(calls.some((call) => call[1] === "push"), false);
});

test("only a main ship receipt dispatches the catch-up path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-receipt-event-"));
  const eventPath = path.join(root, "event.json");
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    return "[]";
  };
  try {
    fs.writeFileSync(eventPath, JSON.stringify({ ref: "refs/heads/main",
      head_commit: { message: "ship: abcdef12 is live" } }));
    assert.deepEqual(main({ eventPath, repo, run }), []);
    assert.ok(calls.some((call) => call[0] === "gh" && call[1] === "api"));
    calls.length = 0;
    fs.writeFileSync(eventPath, JSON.stringify({ ref: "refs/heads/main",
      head_commit: { message: "Unrelated change" } }));
    assert.deepEqual(main({ eventPath, repo, run }), []);
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function runner({ rebaseConflict = false, current = child, fetched = childSha,
  parentAncestor = true, mainAncestor = true } = {}) {
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "git" && args[0] === "rev-parse") return fetched;
    if (program === "git" && args[0] === "ls-remote" && args[1] === "--tags") {
      return calls.some(call => call[0] === "git" && call[1] === "push" &&
        call.at(-1) === "refs/tags/archive/codex/child")
        ? `${fetched}\trefs/tags/archive/codex/child` : "";
    }
    if (program === "git" && args[0] === "merge-base" && args[1] === "--is-ancestor") {
      if ((args[2] === parentSha && !parentAncestor) || (args[2] === "origin/main" && !mainAncestor)) {
        throw new Error("not an ancestor");
      }
    }
    if (program === "git" && args[0] === "rebase" && args[1] === "--onto" && rebaseConflict) {
      throw new Error("conflict");
    }
    if (program === "gh" && args[0] === "api" && args[1] === `repos/${repo}/pulls/41`) {
      return JSON.stringify(current);
    }
    return "";
  };
  return { run, calls };
}

test("successful restack leases the old SHA before retargeting and auto-merge", () => {
  const { run, calls } = runner();
  assert.deepEqual(restackChild({ child, merged, repo, run }), { number: 41, state: "restacked" });
  const rebase = calls.findIndex((call) => call[0] === "git" && call[1] === "rebase" && call[2] === "--onto");
  const tagPush = calls.findIndex((call) => call[0] === "git" && call[1] === "push" &&
    call.at(-1) === "refs/tags/archive/codex/child");
  const push = calls.findIndex((call) => call[0] === "git" && call[1] === "push" &&
    call.at(-1) === "HEAD:refs/heads/codex/child");
  const retarget = calls.findIndex((call) => call[0] === "gh" && call.includes("base=main"));
  const auto = calls.findIndex((call) => call[0] === "gh" && call[1] === "pr" && call[2] === "merge");
  assert.deepEqual(calls[rebase].slice(0, 5), ["git", "rebase", "--onto", "origin/main", parentSha]);
  assert.ok(rebase < tagPush && tagPush < push && push < retarget && retarget < auto);
  assert.ok(calls[push].includes(`--force-with-lease=refs/heads/codex/child:${childSha}`));
});

test("conflict aborts, comments and never pushes or retargets", () => {
  const { run, calls } = runner({ rebaseConflict: true });
  assert.deepEqual(restackChild({ child, merged, repo, run }), { number: 41, state: "conflict" });
  assert.ok(calls.some((call) => call[0] === "git" && call[1] === "rebase" && call[2] === "--abort"));
  assert.ok(calls.some((call) => call[0] === "gh" && call.includes(`repos/${repo}/issues/41/comments`)
    && call.some((value) => value.includes("@ZootimusMaximusSupreme"))));
  assert.equal(calls.some((call) => call[1] === "push" || call.includes("base=main")), false);
});

test("changed or already-restacked PR never gets a force push", () => {
  const changed = runner({ fetched: "c".repeat(40) });
  assert.equal(restackChild({ child, merged, repo, run: changed.run }).state, "changed");
  const moved = runner({ current: { ...child, head: { ...child.head, sha: "c".repeat(40) }, base: { ref: "main" } } });
  assert.equal(restackChild({ child, merged, repo, run: moved.run }).state, "already-moved");
  assert.equal([...changed.calls, ...moved.calls].some((call) => call[1] === "push"), false);
});

test("automatic base retarget still rebases an unchanged child", () => {
  const retargeted = { ...child, base: { ref: "main" } };
  const { run, calls } = runner({ current: retargeted });
  assert.equal(restackChild({ child: retargeted, merged, repo, run }).state, "restacked");
  assert.ok(calls.some((call) => call[1] === "push"));
  assert.equal(calls.some((call) => call.includes("base=main")), false);
});

test("GitHub-native restack queues an exact child already based on current main", () => {
  const retargeted = { ...child, base: { ref: "main" } };
  const { run, calls } = runner({ current: retargeted, parentAncestor: false });
  assert.equal(restackChild({ child: retargeted, merged, repo, run }).state, "already-restacked");
  assert.ok(calls.some((call) => call[0] === "gh" && call[1] === "pr" && call[2] === "merge"));
  assert.ok(calls.some((call) => call[0] === "git" && call[1] === "push" &&
    call.at(-1) === "refs/tags/archive/codex/child"));
  assert.equal(calls.some((call) => call[1] === "rebase" ||
    (call[1] === "push" && call.at(-1) === "HEAD:refs/heads/codex/child")), false);
});

test("rewritten parent uses the child's recorded old parent tip", () => {
  const recorded = "c".repeat(40);
  const current = { ...child, body: `Owner lane: ci\nStack parent head: ${recorded}` };
  const { run, calls } = runner({ current, parentAncestor: false });
  assert.equal(restackChild({ child, merged, repo, run }).state, "restacked");
  assert.ok(calls.some((call) => call[0] === "git" && call[1] === "rebase" &&
    call[2] === "--onto" && call[3] === "origin/main" && call[4] === recorded));
  assert.ok(calls.some((call) => call[1] === "push" && call.at(-1) === "HEAD:refs/heads/codex/child"));
});

test("rewritten parent without a recorded old tip is commented and left open", () => {
  const { run, calls } = runner({ parentAncestor: false });
  assert.equal(restackChild({ child, merged, repo, run }).state, "not-stacked");
  assert.ok(calls.some((call) => call[0] === "gh" && call.includes(`repos/${repo}/issues/41/comments`)
    && call.some((value) => value.includes("@ZootimusMaximusSupreme"))));
  assert.equal(calls.some((call) => call[1] === "rebase" || call[1] === "push"), false);
});

test("real Git restack keeps only the child commit after a parent rewrite", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "restack-graph-"));
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  const git = (...args) => execFileSync("git", args, {
    cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  try {
    fs.mkdirSync(work);
    execFileSync("git", ["init", "--bare", origin]);
    git("init", "-b", "main");
    git("config", "user.name", "Restack test");
    git("config", "user.email", "restack@test.invalid");
    git("remote", "add", "origin", origin);
    fs.writeFileSync(path.join(work, "base.txt"), "base\n");
    git("add", "base.txt");
    git("commit", "-m", "base");
    const base = git("rev-parse", "HEAD");
    git("push", "origin", "main");

    git("switch", "-c", "parent");
    fs.writeFileSync(path.join(work, "parent.txt"), "old\n");
    git("add", "parent.txt");
    git("commit", "-m", "old parent");
    const oldParent = git("rev-parse", "HEAD");
    git("push", "origin", "parent");

    git("switch", "-c", "child");
    fs.writeFileSync(path.join(work, "child.txt"), "own\n");
    git("add", "child.txt");
    git("commit", "-m", "child work");
    const childHead = git("rev-parse", "HEAD");
    git("push", "origin", "child");

    git("switch", "parent");
    git("reset", "--hard", base);
    fs.writeFileSync(path.join(work, "parent.txt"), "new\n");
    git("add", "parent.txt");
    git("commit", "-m", "rewritten parent");
    const newParent = git("rev-parse", "HEAD");
    git("push", "--force", "origin", "parent");

    git("switch", "main");
    fs.writeFileSync(path.join(work, "parent.txt"), "new\n");
    git("add", "parent.txt");
    git("commit", "-m", "squashed parent");
    git("push", "origin", "main");

    const current = { ...child, head: { ...child.head, ref: "child", sha: childHead },
      base: { ref: "parent" }, body: `Stack parent head: ${oldParent}` };
    const mergedParent = { ...merged, head: { ...merged.head, ref: "parent", sha: newParent } };
    const run = (program, args) => {
      if (program === "gh" && args[0] === "api" && args[1] === `repos/${repo}/pulls/41`) {
        return JSON.stringify(current);
      }
      if (program === "gh" && args[0] === "api" && args[1] === "--method" &&
        args[2] === "PATCH" && args[3] === `repos/${repo}/pulls/41`) return "";
      if (program === "gh" && args[0] === "pr" && args[1] === "merge") return "";
      if (program !== "git") throw new Error(`Unexpected ${program} ${args.join(" ")}`);
      return git(...args);
    };
    assert.equal(restackChild({ child: current, merged: mergedParent, repo, run }).state, "restacked");
    git("fetch", "origin", "main", "child");
    assert.equal(git("rev-list", "--count", "origin/main..origin/child"), "1");
    assert.equal(git("log", "-1", "--format=%s", "origin/child"), "child work");
    assert.equal(git("show", "origin/child:parent.txt"), "new");
    assert.equal(git("show", "origin/child:child.txt"), "own");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retargeted child without merged parent or current main is left open", () => {
  const retargeted = { ...child, base: { ref: "main" } };
  const { run, calls } = runner({ current: retargeted, parentAncestor: false, mainAncestor: false });
  assert.equal(restackChild({ child: retargeted, merged, repo, run }).state, "not-stacked");
  assert.equal(calls.some((call) => call[1] === "push" || (call[0] === "gh" && call[1] === "pr" && call[2] === "merge")), false);
});

test("forked ordered chain is reported without rewriting either child", () => {
  const eventPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "restack-test-")), "event.json");
  fs.writeFileSync(eventPath, JSON.stringify({ action: "closed", pull_request: merged }));
  const sibling = { ...child, number: 42, labels: [{ name: "ship-order/2" }] };
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "gh" && args.includes("--slurp")) return JSON.stringify([[child, sibling]]);
    return "";
  };
  assert.throws(() => main({ eventPath, repo, run }), /forks/);
  assert.equal(calls.filter((call) => call.includes("repos/ZootimusMaximusSupreme/fundhub-platform/issues/41/comments")
    || call.includes("repos/ZootimusMaximusSupreme/fundhub-platform/issues/42/comments")).length, 2);
  assert.equal(calls.some((call) => call[0] === "git"), false);
  fs.rmSync(path.dirname(eventPath), { recursive: true });
});

test("a merge into a feature branch never triggers restack onto main", () => {
  const eventPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "restack-test-")), "event.json");
  fs.writeFileSync(eventPath, JSON.stringify({ action: "closed",
    pull_request: { ...merged, base: { ref: "codex/another-parent" } } }));
  const run = () => { throw new Error("API must not be called"); };
  assert.deepEqual(main({ eventPath, repo, run }), []);
  fs.rmSync(path.dirname(eventPath), { recursive: true });
});

for (const scenario of ["clean delta", "exact bytes", "real content conflict", "changed remote head", "missing archive", "dirty index", "open parent target"]) {
  test(`real Git duplicate merged child history: ${scenario}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "restack-duplicate-"));
    const origin = path.join(root, "origin.git");
    const work = path.join(root, "work");
    const git = (...args) => execFileSync("git", args, {
      cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    const write = (file, text) => fs.writeFileSync(path.join(work, file), text);
    try {
      fs.mkdirSync(work);
      execFileSync("git", ["init", "--bare", origin], { stdio: "ignore" });
      git("init", "-b", "main");
      git("config", "user.name", "Restack test");
      git("config", "user.email", "restack@test.invalid");
      git("remote", "add", "origin", origin);
      write("base.txt", "base\n");
      git("add", ".");
      git("commit", "-m", "base");
      git("switch", "-c", "parent");
      write("parent.txt", "approved parent\n");
      if (scenario === "real content conflict") write("child.txt", "shared parent line\n");
      git("add", ".");
      git("commit", "-m", "parent feature");
      const parentHead = git("rev-parse", "HEAD");

      git("switch", "-c", "original-child");
      write("child.txt", "initial child draft\n");
      git("add", ".");
      git("commit", "-m", "original child change");
      const originalFirst = git("rev-parse", "HEAD");
      write("child.txt", scenario === "exact bytes" ? "approved child delta  " : "approved child delta\n");
      if (scenario === "exact bytes") write("binary.bin", Buffer.from([0, 255, 13, 10, 32, 0, 1]));
      git("add", ".");
      git("commit", "-m", "final child wording");
      const originalChild = git("rev-parse", "HEAD");
      git("switch", "-c", "child", parentHead);
      git("cherry-pick", "--no-commit", originalFirst);
      git("commit", "-m", "replayed child change");
      git("cherry-pick", "--no-commit", originalChild);
      git("commit", "-m", "replayed final child wording");
      git("merge", "--no-edit", "original-child");
      const childHead = git("rev-parse", "HEAD");
      git("push", "origin", "child");

      if (scenario !== "missing archive") {
        git("tag", "archive/child", childHead);
        git("push", "origin", "refs/tags/archive/child");
      }

      git("switch", "main");
      git("merge", "--squash", "parent");
      git("commit", "-m", "squashed parent");
      write("main-only.txt", "keep unrelated main work\n");
      if (scenario === "real content conflict") write("child.txt", "different main decision\n");
      git("add", ".");
      git("commit", "-m", "later main work");
      git("push", "origin", "main");
      if (scenario === "exact bytes") git("config", "apply.whitespace", "fix");
      if (scenario === "open parent target") {
        git("switch", "-c", "new-parent");
        write("open-parent.txt", "keep the unmerged parent delta\n");
        git("add", ".");
        git("commit", "-m", "unmerged parent work");
        const target = git("rev-parse", "HEAD");
        assert.equal(restackMergedDelta({ base: parentHead, head: childHead,
          branch: "child", number: 41, target, run: (program, args) => {
            assert.equal(program, "git");
            return git(...args);
          } }), true);
        assert.equal(git("show", "HEAD:open-parent.txt"), "keep the unmerged parent delta");
        assert.equal(git("show", "HEAD:main-only.txt"), "keep unrelated main work");
        assert.equal(git("rev-parse", "HEAD:child.txt"), git("rev-parse", `${childHead}:child.txt`));
        assert.equal(git("diff", "--name-only", `${target}..HEAD`), "child.txt");
        git("merge-base", "--is-ancestor", target, "HEAD");
        assert.equal(git("rev-parse", "origin/child"), childHead, "the helper itself never pushes");
        return;
      }

      const current = { ...child, head: { ...child.head, ref: "child", sha: childHead },
        base: { ref: "parent" } };
      const mergedParent = { ...merged, head: { ...merged.head, ref: "parent", sha: parentHead } };
      const calls = [];
      let reads = 0;
      let rebaseFailed = false;
      const run = (program, args) => {
        calls.push([program, ...args]);
        if (program === "gh") {
          if (args[0] === "api" && args[1] === `repos/${repo}/pulls/41`) {
            reads += 1;
            return JSON.stringify(scenario === "changed remote head" && reads > 1
              ? { ...current, head: { ...current.head, sha: "f".repeat(40) } } : current);
          }
          return "";
        }
        try {
          const result = git(...args);
          if (scenario === "dirty index" && args[0] === "rebase" && args[1] === "--abort") {
            write("staged.txt", "keep unrelated staged work\n");
            git("add", "staged.txt");
            write("base.txt", "keep unrelated unstaged work\n");
          }
          return result;
        } catch (error) {
          if (args[0] === "rebase" && args[1] === "--onto") rebaseFailed = true;
          throw error;
        }
      };
      const result = restackChild({ child: current, merged: mergedParent, repo, run });
      assert.equal(rebaseFailed, true, "the fixture must reproduce the original linear-rebase failure");
      git("fetch", "origin", "child");
      if (scenario === "clean delta" || scenario === "exact bytes") {
        assert.equal(result.state, "restacked");
        assert.equal(git("show", "origin/child:main-only.txt"), "keep unrelated main work");
        assert.equal(git("show", "origin/child:parent.txt"), "approved parent");
        assert.equal(git("show", "origin/child:child.txt"), "approved child delta");
        assert.equal(git("rev-parse", "origin/child:child.txt"), git("rev-parse", `${childHead}:child.txt`), "exact original child bytes");
        if (scenario === "exact bytes") {
          assert.equal(git("rev-parse", "origin/child:binary.bin"), git("rev-parse", `${childHead}:binary.bin`));
        }
        assert.equal(git("diff", "--name-only", "origin/main..origin/child"), scenario === "exact bytes" ? "binary.bin\nchild.txt" : "child.txt");
        assert.equal(git("rev-list", "--count", "origin/main..origin/child"), "1");
        assert.equal(git("rev-parse", "refs/tags/archive/child"), git("rev-parse", "origin/child"));
        assert.equal(git("rev-parse", `refs/tags/archive/child-${childHead.slice(0, 8)}`), childHead);
        const archive = calls.findIndex((call) => call[0] === "git" && call[1] === "push" && call.at(-1) === "refs/tags/archive/child");
        const push = calls.findIndex((call) => call[0] === "git" && call[1] === "push" && call.includes(`--force-with-lease=refs/heads/child:${childHead}`));
        const retarget = calls.findIndex((call) => call.includes("base=main"));
        const arm = calls.findIndex((call) => call[0] === "gh" && call[1] === "pr" && call[2] === "merge");
        assert.ok(archive >= 0 && archive < push && push < retarget && retarget < arm);
        assert.ok(calls[retarget].some((value) => value.startsWith("body=") && value.includes("Base: main")), "one API patch updates base and body together");
        assert.ok(calls[arm].includes("--auto"));
      } else {
        assert.equal(result.state, scenario === "changed remote head" ? "already-moved" : "conflict");
        assert.equal(git("rev-parse", "origin/child"), childHead);
        assert.equal(calls.some((call) => call[1] === "push" || call.includes("base=main") || call[1] === "pr"), false);
        if (scenario === "dirty index") {
          assert.equal(fs.readFileSync(path.join(work, "base.txt"), "utf8"), "keep unrelated unstaged work\n");
          assert.equal(git("show", ":staged.txt"), "keep unrelated staged work");
          assert.equal(calls.some((call) => call[0] === "git" && call[1] === "commit"), false);
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
