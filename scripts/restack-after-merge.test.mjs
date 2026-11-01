import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { directChildren, main, orderOf, restackChild } from "./restack-after-merge.mjs";

const repo = "ZootimusMaximusSupreme/fundhub-platform";
const parentSha = "a".repeat(40);
const childSha = "b".repeat(40);
const merged = { number: 40, merged: true, base: { ref: "main" }, labels: [{ name: "ship-order/1" }],
  head: { ref: "codex/parent", sha: parentSha, repo: { full_name: repo } } };
const child = { number: 41, state: "open", base: { ref: "codex/parent" },
  head: { ref: "codex/child", sha: childSha, repo: { full_name: repo } },
  labels: [{ name: "ship-order/2" }] };

test("ordered child selection ignores unrelated and foreign PRs", () => {
  const foreign = { ...child, number: 42, head: { ...child.head, repo: { full_name: "else/repo" } } };
  const wrongBase = { ...child, number: 43, base: { ref: "codex/unrelated" } };
  const legacy = { ...child, number: 44, labels: [] };
  assert.equal(orderOf(child), 2);
  assert.equal(orderOf({ ...child, labels: ["ship-order/2", "ship-order/3"] }), null);
  assert.deepEqual(directChildren([foreign, wrongBase, legacy, child], merged, repo).map((pr) => pr.number), [41]);
});

function runner({ rebaseConflict = false, current = child, fetched = childSha,
  parentAncestor = true, mainAncestor = true } = {}) {
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "git" && args[0] === "rev-parse") return fetched;
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
  const push = calls.findIndex((call) => call[0] === "git" && call[1] === "push");
  const retarget = calls.findIndex((call) => call[0] === "gh" && call.includes("base=main"));
  const auto = calls.findIndex((call) => call[0] === "gh" && call[1] === "pr" && call[2] === "merge");
  assert.deepEqual(calls[rebase].slice(0, 5), ["git", "rebase", "--onto", "origin/main", parentSha]);
  assert.ok(rebase < push && push < retarget && retarget < auto);
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
  assert.equal(calls.some((call) => call[1] === "push" || call[1] === "rebase"), false);
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
