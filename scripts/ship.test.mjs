// scripts/ship.test.mjs — M0 step 8 (spec docs/specs/marketing-machine-2026-10-04.md):
// ship stays in step with GitHub.
//
//   - what counts as "nothing to ship" (machine-only folders and the ship log),
//     proved on a real throwaway git repo, not on a copy of the rule
//   - the pull order, proved with a fake git runner: ff-only first, then
//     rebase --autostash, then abort with one plain line; a failed pull never stops
//     the ship and never waits for a person
//   - the push after the ship-log commit, through scripts/github-push-whole-repo.mjs,
//     never undoing the deploy
//
// Nothing here ships, deploys, pulls or pushes the real repo. Importing ship.mjs runs
// nothing: its flow only runs when node is asked to run ship.mjs itself.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  pullMain,
  pushToGitHub,
  hasShippableChange,
  shipDiffPathspecs,
  isDirectRun,
  redact,
  reasonLine,
  GIT_NO_PROMPT,
  PULL_TIMEOUT_MS,
  PUSH_TIMEOUT_MS
} from "./ship.mjs";
import { MACHINE_ONLY_PATHS, isMachineOnlyChange, isMachinePath, skipDiffPathspecs } from "./ship-machine-paths.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIP = path.join(HERE, "ship.mjs");
const SRC = fs.readFileSync(SHIP, "utf8");

// ── a real throwaway git repo, isolated from the Mac's own git settings ─────────

function cleanGitEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  return {
    ...env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "ship test",
    GIT_AUTHOR_EMAIL: "ship-test@example.invalid",
    GIT_COMMITTER_NAME: "ship test",
    GIT_COMMITTER_EMAIL: "ship-test@example.invalid",
    ...extra
  };
}

function tempRepo(branch = "main") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-u08-"));
  const env = cleanGitEnv();
  const raw = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
  const must = (args) => {
    const r = raw(args);
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  must(["init", "-q", "-b", branch]);
  must(["config", "commit.gpgsign", "false"]);
  const write = (rel, text) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  const commit = (msg) => {
    must(["add", "-A"]);
    must(["commit", "-q", "--allow-empty", "-m", msg]);
    return must(["rev-parse", "HEAD"]);
  };
  // The runner shape ship.mjs uses: (args, opts) -> { ok, status, out, timedOut }.
  const gitFn = (args) => {
    const r = raw(args);
    return { ok: r.status === 0, status: r.status, out: (r.stdout || "") + (r.stderr || ""), timedOut: false };
  };
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { dir, env, must, write, commit, gitFn, cleanup };
}

/** One repo: a base commit holding every file the cases touch, then one commit per case. */
function shipCase(change) {
  const repo = tempRepo();
  try {
    for (const f of ["src/a.mjs", "marketing/ads/RULES.md", "marketing/ads/VOICE.md", "marketing/ads/registry.json",
      "marketing/ads/banned-live.json", "marketing/ads/angles.json", "marketing/brain/old.md", "ops/ship-log.md", "netlify.toml"]) {
      repo.write(f, `base ${f}\n`);
    }
    const base = repo.commit("base");
    change(repo);
    const head = repo.commit("change");
    return { ships: hasShippableChange(base, head, { git: repo.gitFn }), base, head, repo };
  } catch (e) {
    repo.cleanup();
    throw e;
  }
}

function shipsAfter(change) {
  const c = shipCase(change);
  c.repo.cleanup();
  return c.ships;
}

describe("anything to ship? machine-only folders and the ship log do not count", () => {
  test("the five machine-only folders are the spec's list, and ship reads it from ship-machine-paths.mjs", () => {
    assert.deepEqual([...MACHINE_ONLY_PATHS], [
      "marketing/ads/scripts/machine/",
      "marketing/ads/ideas/",
      "marketing/ads/videos/",
      "marketing/brain/",
      "ops/page-requests/"
    ]);
    assert.match(SRC, /import \{ skipDiffPathspecs \} from "\.\/ship-machine-paths\.mjs";/);
    for (const p of MACHINE_ONLY_PATHS) assert.ok(!SRC.includes(p), `ship.mjs keeps its own copy of ${p}`);
    assert.deepEqual(shipDiffPathspecs(), [".", ":(exclude)ops/ship-log.md", ...skipDiffPathspecs()]);
  });

  test("each machine-only folder alone -> skip", () => {
    const files = {
      "marketing/ads/scripts/machine/": "marketing/ads/scripts/machine/091-batch.md",
      "marketing/ads/ideas/": "marketing/ads/ideas/2026-10-05-idea.md",
      "marketing/ads/videos/": "marketing/ads/videos/91/take-notes.json",
      "marketing/brain/": "marketing/brain/notes/ad-91.md",
      "ops/page-requests/": "ops/page-requests/roadmap-hero.md"
    };
    assert.deepEqual(Object.keys(files), [...MACHINE_ONLY_PATHS]);
    for (const file of Object.values(files)) {
      assert.equal(shipsAfter((r) => r.write(file, "machine save\n")), false, `${file} alone should not ship`);
    }
  });

  test("all five machine folders at once, a deleted machine file, and the ship log -> skip", () => {
    assert.equal(shipsAfter((r) => {
      r.write("marketing/ads/scripts/machine/a.md", "x");
      r.write("marketing/ads/ideas/b.md", "x");
      r.write("marketing/ads/videos/c.json", "{}");
      r.write("marketing/brain/d.md", "x");
      r.write("ops/page-requests/e.md", "x");
    }), false);
    assert.equal(shipsAfter((r) => fs.rmSync(path.join(r.dir, "marketing/brain/old.md"))), false);
    assert.equal(shipsAfter((r) => r.write("ops/ship-log.md", "| 2026-10-05 21:00 | abcdef12 | 0 | ok |\n")), false);
    assert.equal(shipsAfter((r) => {
      r.write("ops/ship-log.md", "row\n");
      r.write("marketing/brain/x.md", "x");
    }), false);
  });

  test("rule, voice and registry files still ship (outbox writes them, but they change the machine)", () => {
    for (const file of ["marketing/ads/RULES.md", "marketing/ads/VOICE.md", "marketing/ads/registry.json",
      "marketing/ads/banned-live.json", "marketing/ads/angles.json"]) {
      assert.equal(shipsAfter((r) => r.write(file, "changed by Chris\n")), true, `${file} must ship`);
    }
  });

  test("any other path ships, including look-alikes and mixes", () => {
    assert.equal(shipsAfter((r) => r.write("src/a.mjs", "changed\n")), true);
    assert.equal(shipsAfter((r) => r.write("netlify.toml", "changed\n")), true);
    assert.equal(shipsAfter((r) => r.write("marketing/ads/scripts/other.md", "x")), true, "a sibling of machine/ ships");
    assert.equal(shipsAfter((r) => r.write("marketing/ads/scripts/machine-notes.md", "x")), true, "a name that only starts like machine/ ships");
    assert.equal(shipsAfter((r) => r.write("marketing/brainstorm.md", "x")), true);
    assert.equal(shipsAfter((r) => {
      r.write("marketing/brain/x.md", "x");
      r.write("src/a.mjs", "changed\n");
    }), true, "machine + code ships");
  });

  test("moving a code file into a machine folder ships (the delete counts)", () => {
    assert.equal(shipsAfter((r) => {
      fs.rmSync(path.join(r.dir, "src/a.mjs"));
      r.write("marketing/brain/a.mjs", "base src/a.mjs\n");
    }), true);
  });

  test("a git error ships, as before (never a silent skip)", () => {
    const repo = tempRepo();
    try {
      repo.write("src/a.mjs", "x");
      const base = repo.commit("base");
      assert.equal(hasShippableChange(base, "0000000000000000000000000000000000000000", { git: repo.gitFn }), true);
      assert.equal(hasShippableChange(base, "HEAD", { git: () => { throw new Error("spawn git ENOENT"); } }), true);
    } finally {
      repo.cleanup();
    }
  });

  test("isMachineOnlyChange: empty is not machine-only; odd paths are not machine paths", () => {
    assert.equal(isMachineOnlyChange([]), false);
    assert.equal(isMachineOnlyChange(["marketing/brain/a.md", "ops/page-requests/b.md"]), true);
    assert.equal(isMachineOnlyChange(["marketing/brain/a.md", "marketing/ads/RULES.md"]), false);
    for (const odd of ["marketing/brain/../../netlify.toml", "marketing/brain//a.md", "marketing/brain/", "Marketing/Brain/a.md",
      "marketing\\brain\\a.md", "marketing/brain", "", null, 7]) {
      assert.equal(isMachinePath(odd), false, `${String(odd)} is not a machine path`);
    }
    assert.equal(isMachinePath("./marketing/brain/a.md"), true);
  });
});

// ── pull order, with a fake git runner ───────────────────────────────────────

/**
 * A fake repo for pullMain. `pull` decides how each pull goes; the fake keeps HEAD,
 * the branch and the tree the way real git would after each step.
 */
function fakeGit({ ff = "ok", rebase = "ok", unmerged = [], abortWorks = true, throwOnPull = false } = {}) {
  const calls = [];
  const state = { head: "a1a1a1a1", branch: "main", dirty: false, rebasing: false };
  const fn = (args, opts = {}) => {
    calls.push({ args: [...args], opts });
    const key = args.join(" ");
    const res = (ok, out = "", extra = {}) => ({ ok, status: ok ? 0 : 1, out, timedOut: false, ...extra });
    if (throwOnPull && args[0] === "pull") throw new Error("spawnSync git ENOENT");
    if (key === "rev-parse HEAD") return res(true, `${state.head}\n`);
    if (key === "branch --show-current") return res(true, `${state.branch}\n`);
    if (key === "status --porcelain") return res(true, state.dirty ? "UU marketing/ads/RULES.md\n" : "");
    if (key === "pull --ff-only origin main") {
      if (ff === "ok") { state.head = "b2b2b2b2"; return res(true, "Fast-forward\n"); }
      if (ff === "timeout") return res(false, "", { status: null, timedOut: true });
      return res(false, "hint: Diverging branches can't be fast-forwarded\nfatal: Not possible to fast-forward, aborting.\n");
    }
    if (key === "pull --rebase=merges --autostash origin main") {
      if (rebase === "ok") { state.head = "c3c3c3c3"; return res(true, "Successfully rebased and updated refs/heads/main.\n"); }
      if (rebase === "conflict") {
        state.rebasing = true; state.branch = ""; state.dirty = true; state.head = "d4d4d4d4";
        return res(false, "CONFLICT (content): Merge conflict in marketing/ads/RULES.md\nerror: could not apply 1234abc... rules\n");
      }
      if (rebase === "timeout") {
        state.rebasing = true; state.branch = ""; state.head = "d4d4d4d4";
        return res(false, "", { status: null, timedOut: true });
      }
      return res(false, "fatal: unable to access 'https://github.com/ZootimusMaximusSupreme/fundhub-platform.git/': Could not resolve host: github.com\n");
    }
    if (key === "diff --name-only --diff-filter=U") return res(true, unmerged.map((f) => `${f}\n`).join(""));
    if (key === "rebase --abort") {
      if (!state.rebasing) return res(false, "fatal: No rebase in progress?\n");
      if (!abortWorks) return res(false, "error: could not abort\n");
      state.rebasing = false; state.branch = "main"; state.dirty = false; state.head = "a1a1a1a1";
      return res(true, "");
    }
    return res(false, `fake git does not know: ${key}`);
  };
  const named = () => calls.map((c) => c.args.join(" "));
  return { fn, calls, named, state };
}

function assertNoPrompt(call) {
  assert.equal(call.opts.env?.GIT_TERMINAL_PROMPT, "0", `${call.args.join(" ")} may prompt`);
  assert.equal(call.opts.env?.GIT_EDITOR, "true", `${call.args.join(" ")} may open an editor`);
  assert.ok(Number.isFinite(call.opts.timeout) && call.opts.timeout > 0 && call.opts.timeout <= 120_000,
    `${call.args.join(" ")} has no time limit`);
}

describe("pull before the checks: ff-only, then rebase --autostash, then abort — never blocks", () => {
  test("ff-only first, with no prompt and a time limit; when it works nothing else runs", () => {
    const g = fakeGit({ ff: "ok" });
    const r = pullMain({ git: g.fn });
    assert.equal(r.ok, true);
    assert.equal(r.how, "ff-only");
    const pulls = g.calls.filter((c) => c.args[0] === "pull");
    assert.equal(pulls.length, 1);
    assert.deepEqual(pulls[0].args, ["pull", "--ff-only", "origin", "main"]);
    assertNoPrompt(pulls[0]);
    assert.equal(pulls[0].opts.timeout, PULL_TIMEOUT_MS);
    assert.ok(!g.named().includes("rebase --abort"));
  });

  test("ff-only fails -> git pull --rebase --autostash (merges kept), same no-prompt and time limit", () => {
    const g = fakeGit({ ff: "diverged", rebase: "ok" });
    const r = pullMain({ git: g.fn });
    assert.equal(r.ok, true);
    assert.equal(r.how, "rebase");
    const pulls = g.calls.filter((c) => c.args[0] === "pull");
    assert.deepEqual(pulls.map((c) => c.args), [
      ["pull", "--ff-only", "origin", "main"],
      ["pull", "--rebase=merges", "--autostash", "origin", "main"]
    ]);
    pulls.forEach(assertNoPrompt);
    assert.equal(r.line.includes("\n"), false);
  });

  test("a rebase clash -> git rebase --abort, one plain line naming the file, and the ship goes on", () => {
    const g = fakeGit({ ff: "diverged", rebase: "conflict", unmerged: ["marketing/ads/RULES.md"] });
    const r = pullMain({ git: g.fn });
    assert.equal(r.ok, false);
    assert.equal(r.how, "conflict");
    assert.equal(r.restored, true, "the folder is back on main at the same commit, so the deploy runs");
    const order = g.named();
    assert.ok(order.indexOf("diff --name-only --diff-filter=U") > order.indexOf("pull --rebase=merges --autostash origin main"));
    assert.ok(order.indexOf("rebase --abort") > order.indexOf("diff --name-only --diff-filter=U"), "the clash is named before the abort");
    assert.equal(g.state.head, "a1a1a1a1");
    assert.match(r.line, /marketing\/ads\/RULES\.md/);
    assert.match(r.line, /Shipping this Mac's main as it is\./);
    assert.equal(r.line.includes("\n"), false, "one line");
  });

  test("several clashing files still make one line", () => {
    const g = fakeGit({ ff: "diverged", rebase: "conflict", unmerged: ["marketing/ads/RULES.md", "marketing/ads/VOICE.md", "x.md"] });
    const r = pullMain({ git: g.fn });
    assert.match(r.line, /RULES\.md \(and 2 more\)/);
    assert.equal(r.line.includes("\n"), false);
    assert.equal(r.restored, true);
  });

  test("GitHub not answering: ff-only times out -> no second wait, one line, the ship goes on", () => {
    const g = fakeGit({ ff: "timeout" });
    const r = pullMain({ git: g.fn, timeout: 5_000 });
    assert.equal(r.ok, false);
    assert.equal(r.restored, true);
    assert.equal(g.calls.filter((c) => c.args[0] === "pull").length, 1, "a timed-out pull is not tried again");
    assert.match(r.line, /did not answer within 5 seconds/);
  });

  test("a rebase that times out half way is aborted and the ship goes on", () => {
    const g = fakeGit({ ff: "diverged", rebase: "timeout" });
    const r = pullMain({ git: g.fn });
    assert.ok(g.named().includes("rebase --abort"));
    assert.equal(r.restored, true);
    assert.equal(g.state.branch, "main");
    assert.match(r.line, /no answer within 90 seconds/);
  });

  test("no network: both pulls fail -> one line with git's reason, the ship goes on", () => {
    const g = fakeGit({ ff: "diverged", rebase: "network" });
    const r = pullMain({ git: g.fn });
    assert.equal(r.ok, false);
    assert.equal(r.how, "failed");
    assert.equal(r.restored, true);
    assert.match(r.line, /^Could not pull from GitHub \(fatal: unable to access/);
    assert.equal(r.line.includes("\n"), false);
  });

  test("git itself blowing up on the pull never throws and never stops the ship", () => {
    const g = fakeGit({ throwOnPull: true });
    let r;
    assert.doesNotThrow(() => { r = pullMain({ git: g.fn }); });
    assert.equal(r.ok, false);
    assert.equal(r.restored, true);
    assert.match(r.line, /Shipping this Mac's main as it is\./);
  });

  test("only a pull that cannot be undone (folder left mid-pull) is reported as not restored", () => {
    const g = fakeGit({ ff: "diverged", rebase: "conflict", unmerged: ["a.md"], abortWorks: false });
    const r = pullMain({ git: g.fn });
    assert.equal(r.restored, false);
    assert.match(r.line, /could not be undone/);
    assert.match(r.line, /Nothing was deployed/);
  });

  test("ship.mjs: the pull runs after the main + clean checks and before the skip check and the checks", () => {
    const main = SRC.slice(SRC.indexOf("async function main()"));
    const clean = main.indexOf('fail("uncommitted changes.');
    const pull = main.indexOf("pullMain({ git: gitRun })");
    const head = main.indexOf('const head = git("rev-parse"');
    const skip = main.indexOf("hasShippableChange(prev,");
    const lint = main.indexOf('run("node", ["scripts/lint.mjs"])');
    const deploy = main.indexOf('run("netlify", ["deploy", "--prod"');
    assert.ok(clean > 0 && pull > clean, "pull comes after the main + clean-tree check");
    assert.ok(head > pull, "the shipped commit is read after the pull");
    assert.ok(skip > pull && lint > skip && deploy > lint, "pull, then skip check, then checks, then deploy");
  });

  test("ship.mjs: between the pull and the deploy, the pull can stop the ship only when the folder was left mid-pull", () => {
    const main = SRC.slice(SRC.indexOf("async function main()"));
    const pullBlock = main.slice(main.indexOf("// ── 2. in step with GitHub"), main.indexOf("// ── 3. anything to ship?"));
    const stops = pullBlock.match(/fail\([^)]*\)|process\.exit\(\d\)/g) || [];
    assert.deepEqual(stops, ["fail(pull.line)"]);
    assert.match(pullBlock, /if \(pull\.restored === false\) fail\(pull\.line\);/);
    assert.ok(!/\bthrow\b/.test(pullBlock));
  });

  test("a dry run does not pull", () => {
    const main = SRC.slice(SRC.indexOf("async function main()"));
    const pullBlock = main.slice(main.indexOf("// ── 2. in step with GitHub"), main.indexOf("// ── 3. anything to ship?"));
    assert.match(pullBlock, /if \(DRY\) \{\s*say\("  \(dry run: would pull GitHub's main here; nothing pulled\)"\);\s*\} else \{/);
  });

  test("no-prompt settings", () => {
    assert.equal(GIT_NO_PROMPT.GIT_TERMINAL_PROMPT, "0");
    assert.equal(GIT_NO_PROMPT.GIT_EDITOR, "true");
    assert.ok(PULL_TIMEOUT_MS > 0 && PULL_TIMEOUT_MS <= 120_000);
  });
});

// ── push after the ship-log commit ───────────────────────────────────────────

function fakePush({ fetch = "ok", inside = "yes", push = "ok", pushOut = "", throwOnPush = false } = {}) {
  const calls = [];
  const git = (args, opts = {}) => {
    calls.push({ kind: "git", args: [...args], opts });
    if (args[0] === "fetch") {
      if (fetch === "ok") return { ok: true, status: 0, out: "", timedOut: false };
      if (fetch === "timeout") return { ok: false, status: null, out: "", timedOut: true };
      return { ok: false, status: 128, out: "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com\n", timedOut: false };
    }
    if (args[0] === "merge-base") {
      if (inside === "yes") return { ok: true, status: 0, out: "", timedOut: false };
      if (inside === "no") return { ok: false, status: 1, out: "", timedOut: false };
      return { ok: false, status: 128, out: "fatal: Not a valid object name refs/remotes/origin/main\n", timedOut: false };
    }
    return { ok: false, status: 1, out: "unknown", timedOut: false };
  };
  const runCmd = (cmd, args, opts = {}) => {
    calls.push({ kind: "run", cmd, args: [...args], opts });
    if (throwOnPush) throw new Error("spawnSync node ENOENT");
    if (push === "ok") return { ok: true, status: 0, out: "done — 12 branch(es) and tags on GitHub\n", timedOut: false };
    if (push === "timeout") return { ok: false, status: null, out: "", timedOut: true };
    return { ok: false, status: 1, out: pushOut, timedOut: false };
  };
  return { git, runCmd, calls };
}

describe("push after the ship-log commit, through github-push-whole-repo.mjs — never undoes the deploy", () => {
  test("it pushes with node scripts/github-push-whole-repo.mjs, no prompt, with a time limit", () => {
    const f = fakePush();
    const r = pushToGitHub({ git: f.git, runCmd: f.runCmd });
    assert.equal(r.ok, true);
    assert.equal(r.pushed, true);
    const push = f.calls.find((c) => c.kind === "run");
    assert.equal(push.cmd, "node");
    assert.deepEqual(push.args, ["scripts/github-push-whole-repo.mjs"]);
    assert.equal(push.opts.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(push.opts.timeout, PUSH_TIMEOUT_MS);
    const order = f.calls.map((c) => (c.kind === "run" ? "push" : c.args[0]));
    assert.deepEqual(order, ["fetch", "merge-base", "push"], "GitHub's main is checked before the push");
    assert.deepEqual(f.calls[0].args, ["fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
    assertNoPrompt(f.calls[0]);
    assert.deepEqual(f.calls[1].args, ["merge-base", "--is-ancestor", "refs/remotes/origin/main", "refs/heads/main"]);
  });

  test("a failed push is one line, hides the token, and does not throw", () => {
    const token = "ghp_" + "A".repeat(36);
    const f = fakePush({
      push: "fail",
      pushOut: `pushing as someone ...\nTo https://x-access-token:${token}@github.com/x/y.git\n ! [rejected]        u08 -> u08 (non-fast-forward)\ngit failed (1): \n`
    });
    let r;
    assert.doesNotThrow(() => { r = pushToGitHub({ git: f.git, runCmd: f.runCmd, env: { GITHUB_TOKEN: token } }); });
    assert.equal(r.ok, false);
    assert.equal(r.line.includes("\n"), false);
    assert.ok(!r.line.includes(token), "the token never shows");
    assert.match(r.line, /\[rejected\]/);
    assert.match(r.line, /The site is live and the ship is logged/);
  });

  test("a push that cannot even start, or runs out of time, is still one line", () => {
    const thrown = fakePush({ throwOnPush: true });
    const r1 = pushToGitHub({ git: thrown.git, runCmd: thrown.runCmd });
    assert.equal(r1.ok, false);
    assert.match(r1.line, /ENOENT/);
    const slow = fakePush({ push: "timeout" });
    const r2 = pushToGitHub({ git: slow.git, runCmd: slow.runCmd });
    assert.match(r2.line, /no answer within 10 minutes/);
  });

  test("GitHub has commits this Mac lacks -> no push (the push script would overwrite them)", () => {
    const f = fakePush({ inside: "no" });
    const r = pushToGitHub({ git: f.git, runCmd: f.runCmd });
    assert.equal(r.pushed, false);
    assert.equal(f.calls.some((c) => c.kind === "run"), false, "github-push-whole-repo.mjs is not run");
    assert.match(r.line, /would overwrite them/);
  });

  test("cannot read or compare GitHub's main -> no push, one line", () => {
    for (const opts of [{ fetch: "fail" }, { fetch: "timeout" }, { inside: "error" }]) {
      const f = fakePush(opts);
      const r = pushToGitHub({ git: f.git, runCmd: f.runCmd });
      assert.equal(r.pushed, false);
      assert.equal(f.calls.some((c) => c.kind === "run"), false);
      assert.equal(r.line.includes("\n"), false);
    }
  });

  test("ship.mjs: the push runs after the ship-log commit, and nothing after it can stop the ship", () => {
    const main = SRC.slice(SRC.indexOf("async function main()"));
    const logged = main.indexOf("fs.appendFileSync(LOG");
    const committed = main.indexOf('run("git", ["commit", "-q", "-m", `ship: ${head} is live');
    const push = main.indexOf("pushToGitHub({ git: gitRun, runCmd: run })");
    assert.ok(logged > 0 && committed > logged, "the ship is logged and committed");
    assert.ok(push > committed, "the push comes after the ship-log commit");
    const after = main.slice(push);
    assert.ok(!/\bfail\(|process\.exit\(|\bthrow\b/.test(after), "nothing after the push can turn a live ship into a failure");
  });
});

// ── the same pull and push checks against real git (a throwaway GitHub stand-in) ──

/**
 * A bare repo stands in for GitHub; "mac" is this Mac's clone, "app" is the outbox
 * writing to GitHub. Nothing here touches the real repo or the network.
 */
function fakeGitHub() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "ship-u08-gh-"));
  const env = cleanGitEnv();
  const at = (dir) => (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
    assert.equal(r.status, 0, `git ${args.join(" ")} in ${path.basename(dir)} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const bare = path.join(top, "github.git");
  at(top)(["init", "-q", "--bare", "-b", "main", bare]);
  const clone = (name) => {
    at(top)(["clone", "-q", bare, name]);
    const dir = path.join(top, name);
    at(dir)(["config", "commit.gpgsign", "false"]);
    at(dir)(["checkout", "-q", "-B", "main"]);
    return dir;
  };
  const app = clone("app");
  const write = (dir, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const commit = (dir, msg) => { at(dir)(["add", "-A"]); at(dir)(["commit", "-q", "-m", msg]); return at(dir)(["rev-parse", "HEAD"]); };
  write(app, "marketing/ads/RULES.md", "rule 1\n");
  write(app, "src/a.mjs", "export const a = 1;\n");
  commit(app, "base");
  at(app)(["push", "-q", "origin", "main"]);
  const mac = clone("mac");
  // The runner shape ship.mjs uses, run inside the Mac's clone.
  const macGit = (args, opts = {}) => {
    const r = spawnSync("git", args, { cwd: mac, encoding: "utf8", env: opts.env || env, timeout: opts.timeout });
    return { ok: r.status === 0, status: r.status, out: (r.stdout || "") + (r.stderr || ""), timedOut: r.error?.code === "ETIMEDOUT" };
  };
  return { top, env, app, mac, at, write, commit, macGit, cleanup: () => fs.rmSync(top, { recursive: true, force: true }) };
}

describe("real git: the pull order and the push check do what the fakes say", () => {
  test("GitHub ahead, Mac behind -> ff-only pulls it", () => {
    const gh = fakeGitHub();
    try {
      gh.write(gh.app, "marketing/brain/ad-91.md", "note\n");
      const appHead = gh.commit(gh.app, "app: brain note [skip ci]");
      gh.at(gh.app)(["push", "-q", "origin", "main"]);
      const r = pullMain({ git: gh.macGit, env: gh.env });
      assert.equal(r.ok, true, r.line);
      assert.equal(r.how, "ff-only");
      assert.equal(gh.at(gh.mac)(["rev-parse", "HEAD"]), appHead);
    } finally {
      gh.cleanup();
    }
  });

  test("both moved (outbox commit on GitHub; ship-log commit and a local merge on the Mac) -> rebase, merge kept", () => {
    const gh = fakeGitHub();
    try {
      gh.write(gh.app, "marketing/brain/ad-91.md", "note\n");
      const appHead = gh.commit(gh.app, "app: brain note [skip ci]");
      gh.at(gh.app)(["push", "-q", "origin", "main"]);
      gh.at(gh.mac)(["checkout", "-q", "-b", "mm-u99"]);
      gh.write(gh.mac, "src/b.mjs", "export const b = 2;\n");
      gh.commit(gh.mac, "unit work");
      gh.at(gh.mac)(["checkout", "-q", "main"]);
      gh.at(gh.mac)(["merge", "-q", "--no-ff", "-m", "Merge mm-u99", "mm-u99"]);
      gh.write(gh.mac, "ops/ship-log.md", "| 2026-10-05 21:00 | abcd1234 | 0 | ok |\n");
      gh.commit(gh.mac, "ship: abcd1234 is live");
      const r = pullMain({ git: gh.macGit, env: gh.env });
      assert.equal(r.ok, true, r.line);
      assert.equal(r.how, "rebase");
      gh.at(gh.mac)(["merge-base", "--is-ancestor", appHead, "HEAD"]);
      assert.equal(gh.at(gh.mac)(["rev-list", "--merges", "--count", `${appHead}..HEAD`]), "1", "the local merge is still a merge");
      assert.match(gh.at(gh.mac)(["log", "--format=%s", `${appHead}..HEAD`]), /^Merge mm-u99$/m);
      assert.equal(gh.at(gh.mac)(["show", "HEAD:src/b.mjs"]), "export const b = 2;", "the merged unit's work is still on main");
      // A rebase copies local commits, the merged unit's commit included, so the old
      // branch tip is no longer inside main (recorded in the U08 manifest).
      assert.notEqual(spawnSync("git", ["merge-base", "--is-ancestor", "mm-u99", "HEAD"], { cwd: gh.mac, env: gh.env }).status, 0);
      assert.equal(gh.at(gh.mac)(["status", "--porcelain"]), "");
      assert.equal(gh.at(gh.mac)(["branch", "--show-current"]), "main");
    } finally {
      gh.cleanup();
    }
  });

  test("both changed RULES.md -> abort, one line naming RULES.md, Mac's main exactly as before", () => {
    const gh = fakeGitHub();
    try {
      gh.write(gh.app, "marketing/ads/RULES.md", "rule 1 from the app\n");
      gh.commit(gh.app, "app: rules edit [skip ci]");
      gh.at(gh.app)(["push", "-q", "origin", "main"]);
      gh.write(gh.mac, "marketing/ads/RULES.md", "rule 1 from the Mac\n");
      const macHead = gh.commit(gh.mac, "rules on the Mac");
      const r = pullMain({ git: gh.macGit, env: gh.env });
      assert.equal(r.ok, false);
      assert.equal(r.how, "conflict");
      assert.equal(r.restored, true);
      assert.match(r.line, /both changed marketing\/ads\/RULES\.md, so nothing was pulled\. Shipping this Mac's main as it is\./);
      assert.equal(gh.at(gh.mac)(["rev-parse", "HEAD"]), macHead);
      assert.equal(gh.at(gh.mac)(["status", "--porcelain"]), "");
      assert.equal(gh.at(gh.mac)(["branch", "--show-current"]), "main");
      assert.equal(fs.readFileSync(path.join(gh.mac, "marketing/ads/RULES.md"), "utf8"), "rule 1 from the Mac\n");
    } finally {
      gh.cleanup();
    }
  });

  test("push check: GitHub has a commit the Mac lacks -> the push script is not run; once pulled, it is", () => {
    const gh = fakeGitHub();
    try {
      gh.write(gh.app, "marketing/brain/ad-91.md", "note\n");
      gh.commit(gh.app, "app: brain note [skip ci]");
      gh.at(gh.app)(["push", "-q", "origin", "main"]);
      gh.write(gh.mac, "ops/ship-log.md", "| row |\n");
      gh.commit(gh.mac, "ship: abcd1234 is live");
      const ran = [];
      const runCmd = (cmd, args) => { ran.push([cmd, ...args].join(" ")); return { ok: true, status: 0, out: "", timedOut: false }; };
      const before = pushToGitHub({ git: gh.macGit, runCmd, env: gh.env });
      assert.equal(before.pushed, false);
      assert.deepEqual(ran, []);
      assert.match(before.line, /would overwrite them/);
      assert.equal(pullMain({ git: gh.macGit, env: gh.env }).ok, true);
      const after = pushToGitHub({ git: gh.macGit, runCmd, env: gh.env });
      assert.equal(after.pushed, true, after.line);
      assert.deepEqual(ran, ["node scripts/github-push-whole-repo.mjs"]);
    } finally {
      gh.cleanup();
    }
  });
});

// ── small pieces ─────────────────────────────────────────────────────────────

describe("helpers", () => {
  test("redact hides GitHub tokens however they appear", () => {
    const t = "github_pat_" + "B".repeat(40);
    assert.equal(redact(`a ${t} b`, {}), "a [token] b");
    assert.equal(redact("https://x-access-token:abc123@github.com/x", {}), "https://x-access-token:[token]@github.com/x");
    assert.equal(redact("plain secretvalue99 here", { GITHUB_TOKEN: "secretvalue99" }), "plain [token] here");
  });

  test("reasonLine picks git's error line, else the last line", () => {
    assert.equal(reasonLine("remote: x\nfatal: no access\nmore\n", {}), "fatal: no access");
    assert.equal(reasonLine("one\ntwo\n", {}), "two");
    assert.equal(reasonLine("", {}), "no message");
    assert.ok(reasonLine("x".repeat(500), {}).length <= 200);
  });

  test("isDirectRun is true only for ship.mjs itself (so importing it in a test runs nothing)", () => {
    const url = new URL("./ship.mjs", import.meta.url).href;
    assert.equal(isDirectRun(SHIP, url), true);
    assert.equal(isDirectRun(fileURLToPath(import.meta.url), url), false);
    assert.equal(isDirectRun(undefined, url), false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-u08-link-"));
    try {
      const link = path.join(dir, "ship-link.mjs");
      fs.symlinkSync(SHIP, link);
      assert.equal(isDirectRun(link, url), true, "a symlinked path to ship.mjs still runs it");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("node scripts/ship.mjs still runs its flow when run directly (stops at step 1 off main)", () => {
    // A throwaway repo on another branch stands in for this one through GIT_DIR, so the
    // real ship stops at its very first check: no pull, no deploy, nothing written.
    const repo = tempRepo("u08-not-main");
    try {
      const env = cleanGitEnv({ GIT_DIR: path.join(repo.dir, ".git"), GIT_WORK_TREE: repo.dir });
      const seen = spawnSync("git", ["branch", "--show-current"], { cwd: path.join(HERE, ".."), encoding: "utf8", env });
      assert.equal(seen.stdout.trim(), "u08-not-main", "the stand-in repo is what git sees");
      const r = spawnSync(process.execPath, [SHIP, "--dry"], { cwd: path.join(HERE, ".."), encoding: "utf8", env, timeout: 60_000 });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /SHIP STOPPED: on branch "u08-not-main"\. Ship from main\./);
      assert.ok(!r.stdout.includes("pulling GitHub's main"), "it stopped before the pull");
    } finally {
      repo.cleanup();
    }
  });
});
