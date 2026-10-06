// scripts/netlify-ignore-machine-only.test.mjs — the Netlify skip rule for machine-only
// commits (spec M0 step 8; CLAUDE.md §11, the 2026-08-06 build-credit lesson).
//
// Netlify's ignore command: exit 0 = skip the build, exit 1 = build. This file proves
// it skips only when both commit ids are given, they differ, and every changed file is
// in a machine-only folder — and that it reads the very same list npm run ship reads.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ignore from "./netlify-ignore-machine-only.mjs";
import * as machinePaths from "./ship-machine-paths.mjs";
import { hasShippableChange } from "./ship.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SCRIPT = path.join(HERE, "netlify-ignore-machine-only.mjs");
const A = "1111111111111111111111111111111111111111";
const B = "2222222222222222222222222222222222222222";
const lists = (paths) => () => paths;

function cleanGitEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  for (const k of ["CACHED_COMMIT_REF", "COMMIT_REF"]) delete env[k];
  return {
    ...env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "ignore test",
    GIT_AUTHOR_EMAIL: "ignore-test@example.invalid",
    GIT_COMMITTER_NAME: "ignore test",
    GIT_COMMITTER_EMAIL: "ignore-test@example.invalid",
    ...extra
  };
}

/** A throwaway repo with a base commit and one change commit. */
function twoCommits(change) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netlify-ignore-u08-"));
  const env = cleanGitEnv();
  const must = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  must(["init", "-q", "-b", "main"]);
  must(["config", "commit.gpgsign", "false"]);
  for (const f of ["src/a.mjs", "marketing/ads/RULES.md", "marketing/brain/old.md", "ops/ship-log.md"]) write(f, `base ${f}\n`);
  must(["add", "-A"]);
  must(["commit", "-q", "-m", "base"]);
  const base = must(["rev-parse", "HEAD"]);
  change({ dir, write });
  must(["add", "-A"]);
  must(["commit", "-q", "--allow-empty", "-m", "change"]);
  const head = must(["rev-parse", "HEAD"]);
  const gitFn = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
    return { ok: r.status === 0, status: r.status, out: (r.stdout || "") + (r.stderr || ""), timedOut: false };
  };
  return { dir, env, base, head, gitFn, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe("netlify skip rule — decide()", () => {
  test("missing CACHED_COMMIT_REF or COMMIT_REF -> build (exit 1)", () => {
    const never = () => { throw new Error("git must not run"); };
    assert.equal(ignore.decide({ cachedRef: undefined, commitRef: B, listChanged: never }).code, 1);
    assert.equal(ignore.decide({ cachedRef: A, commitRef: undefined, listChanged: never }).code, 1);
    assert.equal(ignore.decide({ cachedRef: "", commitRef: "", listChanged: never }).code, 1);
    assert.equal(ignore.decide({ cachedRef: "  ", commitRef: B, listChanged: never }).code, 1);
  });

  test("the same commit, or a commit id that is not a plain id -> build", () => {
    const never = () => { throw new Error("git must not run"); };
    assert.equal(ignore.decide({ cachedRef: A, commitRef: A, listChanged: never }).code, 1);
    assert.equal(ignore.decide({ cachedRef: "--output=/tmp/x", commitRef: B, listChanged: never }).code, 1);
    assert.equal(ignore.decide({ cachedRef: A, commitRef: "main", listChanged: never }).code, 1);
  });

  test("only machine paths -> skip (exit 0)", () => {
    const d = ignore.decide({ cachedRef: A, commitRef: B, listChanged: lists([
      "marketing/ads/scripts/machine/091.md",
      "marketing/ads/ideas/i.md",
      "marketing/ads/videos/91/notes.json",
      "marketing/brain/ad-91.md",
      "ops/page-requests/r.md"
    ]) });
    assert.equal(d.code, 0);
    assert.match(d.why, /only machine files changed \(5 files\)/);
  });

  test("any non-machine path -> build, and the reason names it", () => {
    for (const other of ["marketing/ads/RULES.md", "marketing/ads/VOICE.md", "marketing/ads/registry.json",
      "ops/ship-log.md", "netlify.toml", "src/a.mjs", "marketing/ads/scripts/other.md", "marketing/brain/../netlify.toml"]) {
      const d = ignore.decide({ cachedRef: A, commitRef: B, listChanged: lists(["marketing/brain/a.md", other]) });
      assert.equal(d.code, 1, `${other} must build`);
      assert.ok(d.why.includes(other));
    }
  });

  test("no changed files, git failing or git throwing -> build", () => {
    assert.equal(ignore.decide({ cachedRef: A, commitRef: B, listChanged: lists([]) }).code, 1);
    assert.equal(ignore.decide({ cachedRef: A, commitRef: B, listChanged: () => null }).code, 1);
    assert.equal(ignore.decide({ cachedRef: A, commitRef: B, listChanged: () => { throw new Error("boom"); } }).code, 1);
  });
});

describe("netlify skip rule — one list with npm run ship", () => {
  test("it imports the same list ship uses (same object, no copy of its own)", () => {
    assert.strictEqual(ignore.MACHINE_ONLY_PATHS, machinePaths.MACHINE_ONLY_PATHS);
    const src = fs.readFileSync(SCRIPT, "utf8");
    assert.match(src, /from "\.\/ship-machine-paths\.mjs";/);
    for (const p of machinePaths.MACHINE_ONLY_PATHS) assert.ok(!src.includes(p), `the ignore script keeps its own copy of ${p}`);
    const ship = fs.readFileSync(path.join(HERE, "ship.mjs"), "utf8");
    assert.match(ship, /from "\.\/ship-machine-paths\.mjs";/);
  });

  test("on a real repo, the skip rule and ship's skip check agree for every machine-only or code change", () => {
    const cases = [
      { name: "machine only", change: ({ write }) => { write("marketing/brain/n.md", "x"); write("ops/page-requests/p.md", "x"); }, skip: true },
      { name: "rules file", change: ({ write }) => write("marketing/ads/RULES.md", "changed"), skip: false },
      { name: "code", change: ({ write }) => write("src/a.mjs", "changed"), skip: false },
      { name: "machine + code", change: ({ write }) => { write("marketing/brain/n.md", "x"); write("src/a.mjs", "y"); }, skip: false },
      { name: "move code into a machine folder", change: ({ dir, write }) => {
        fs.rmSync(path.join(dir, "src/a.mjs"));
        write("marketing/brain/a.mjs", "base src/a.mjs\n");
      }, skip: false }
    ];
    for (const c of cases) {
      const repo = twoCommits(c.change);
      try {
        const listed = ignore.gitChangedPaths(repo.base, repo.head, { cwd: repo.dir });
        const d = ignore.decide({ cachedRef: repo.base, commitRef: repo.head, listChanged: () => listed });
        assert.equal(d.code === 0, c.skip, `netlify: ${c.name}`);
        assert.equal(!hasShippableChange(repo.base, repo.head, { git: repo.gitFn }), c.skip, `ship: ${c.name}`);
      } finally {
        repo.cleanup();
      }
    }
  });

  test("the one place they differ on purpose: a ship-log-only commit is no change to ship, but Netlify builds it", () => {
    const repo = twoCommits(({ write }) => write("ops/ship-log.md", "| row |\n"));
    try {
      assert.equal(hasShippableChange(repo.base, repo.head, { git: repo.gitFn }), false);
      const listed = ignore.gitChangedPaths(repo.base, repo.head, { cwd: repo.dir });
      assert.deepEqual(listed, ["ops/ship-log.md"]);
      assert.equal(ignore.decide({ cachedRef: repo.base, commitRef: repo.head, listChanged: () => listed }).code, 1);
    } finally {
      repo.cleanup();
    }
  });
});

describe("netlify skip rule — the command Netlify runs", () => {
  function runScript(env, cwd = ROOT) {
    return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8", env: cleanGitEnv(env), timeout: 60_000 });
  }

  test("no commit ids (a laptop, or a first build) -> exit 1, build", () => {
    const r = runScript({});
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^Building: /);
  });

  test("a machine-only change -> exit 0, skip; a code change -> exit 1, build", () => {
    const machine = twoCommits(({ write }) => write("marketing/ads/ideas/new.md", "idea"));
    const code = twoCommits(({ write }) => write("src/a.mjs", "changed"));
    try {
      // git runs in the repo root the script lives in, so point git at the throwaway repo.
      const skip = runScript({ CACHED_COMMIT_REF: machine.base, COMMIT_REF: machine.head, GIT_DIR: path.join(machine.dir, ".git") });
      assert.equal(skip.status, 0, skip.stdout + skip.stderr);
      assert.match(skip.stdout, /^Skipping this build: only machine files changed \(1 file\)\./);
      const build = runScript({ CACHED_COMMIT_REF: code.base, COMMIT_REF: code.head, GIT_DIR: path.join(code.dir, ".git") });
      assert.equal(build.status, 1);
      assert.match(build.stdout, /^Building: src\/a\.mjs changed\./);
    } finally {
      machine.cleanup();
      code.cleanup();
    }
  });

  test("commit ids git does not know -> exit 1, build", () => {
    const r = runScript({ CACHED_COMMIT_REF: A, COMMIT_REF: B });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /git could not list the changed files/);
  });

  test("netlify.toml [build] runs it as the ignore command, and ship's allow rules are untouched", () => {
    const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
    const build = toml.slice(toml.indexOf("[build]\n"), toml.indexOf("\n[", toml.indexOf("[build]\n") + 1));
    const ignores = build.split("\n").filter((l) => /^\s*ignore\s*=/.test(l));
    assert.deepEqual(ignores.map((l) => l.trim()), ['ignore = "node scripts/netlify-ignore-machine-only.mjs"']);
    assert.equal(toml.split("\n").filter((l) => /^\s*ignore\s*=/.test(l)).length, 1, "one ignore line in the whole file");
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude/settings.json"), "utf8"));
    const allow = settings?.permissions?.allow || [];
    assert.ok(allow.includes("Bash(npm run ship)"));
    assert.ok(allow.includes("Bash(node scripts/ship.mjs)"));
  });

  test("it uses node built-ins only (Netlify runs it before installing packages)", () => {
    for (const file of [SCRIPT, path.join(HERE, "ship-machine-paths.mjs")]) {
      const src = fs.readFileSync(file, "utf8");
      const specs = [...src.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
      for (const s of specs) assert.ok(s.startsWith("node:") || s.startsWith("./"), `${path.basename(file)} imports ${s}`);
    }
  });
});
