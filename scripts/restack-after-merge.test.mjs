import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { catchUpAfterShip, directChildren, main, nextQueuedPr, orderOf, recordedParentHead, restackChild } from "./restack-after-merge.mjs";

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
