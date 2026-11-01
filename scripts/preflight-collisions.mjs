#!/usr/bin/env node
// npm run preflight — the pre-ship collision scan (owner call 2026-10-31).
//
// Chris: before an agent opens a pull request or ships, it should "scan the
// branches and scan GitHub, see where we're at", and catch collisions before
// they happen ("pre-damage control"). Everything is built locally in branches
// and worktrees, so the scan reads three places:
//   1. local branches with recent commits that are not on origin/main yet
//   2. other worktrees, including their unsaved (uncommitted) changes
//   3. open pull requests on GitHub (needs the `gh` command; skipped if missing)
// and reports every file this branch shares with any of them.
//
// Refreshes Git metadata, safely fast-forwards local main, and prunes dead
// worktree records. It never commits, pushes, stashes, or resets work.
// Cheap work: Sonnet, or the Codex mini tier, can run it and act on the report.
//
// Usage:
//   npm run preflight                 scan against the current branch
//   npm run preflight -- --days 30    look at branches touched in the last 30 days (default 14)
//   npm run preflight -- --json       machine-readable output
//   npm run preflight -- --no-fetch   skip `git fetch origin`
//   npm run preflight -- --expected-base <branch>  verify a planned stack parent
//
// Exit code: 0 = no shared files with this branch, 1 = shared files found
// (read the report before opening the PR), 2 = could not run.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "origin/main";

function run(cmd, args, opts = {}) {
  const { raw, ...rest } = opts;
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
      ...rest
    });
    return raw ? out : out.trim();
  } catch {
    return null;
  }
}

const git = (args, cwd) => run("git", args, cwd ? { cwd } : {});
// Porcelain output must keep its leading spaces.
const gitRaw = (args, cwd) => run("git", args, cwd ? { cwd, raw: true } : { raw: true });
const lines = (s) => (s ? s.split("\n").map((l) => l.trim()).filter(Boolean) : []);

// `git status --porcelain` -> file paths (renames keep the new path).
// Split raw: the leading space is part of the status code, so never trim it.
export function parsePorcelain(text) {
  return (text || "").split("\n").filter((l) => l.length > 3).map((l) => {
    const p = l.slice(3);
    const arrow = p.indexOf(" -> ");
    return (arrow >= 0 ? p.slice(arrow + 4) : p).replace(/^"|"$/g, "");
  });
}

// `git worktree list --porcelain` -> [{ path, branch, prunable }]
export function parseWorktrees(text) {
  const out = [];
  let cur = null;
  for (const l of (text || "").split("\n")) {
    if (l.startsWith("worktree ")) {
      cur = { path: l.slice(9), branch: null, prunable: false };
      out.push(cur);
    } else if (cur && l.startsWith("branch ")) {
      cur.branch = l.slice(7).replace(/^refs\/heads\//, "");
    } else if (cur && l.startsWith("prunable")) {
      cur.prunable = true;
    }
  }
  return out;
}

export function chooseMainUpdate({ mainExists, behind, canFastForward, worktreePath }) {
  if (!mainExists) return { action: "create" };
  if (behind === 0) return { action: "none" };
  if (!canFastForward) return { action: "none", reason: "local main diverged from origin/main" };
  return { action: worktreePath ? "merge" : "branch" };
}

export function orderChain(candidates, current) {
  const byTip = new Map();
  for (const candidate of candidates) {
    if (!candidate.ancestor || candidate.name === current || candidate.ahead <= 0) continue;
    const prior = byTip.get(candidate.sha);
    if (!prior || (prior.name.startsWith("origin/") && !candidate.name.startsWith("origin/"))) {
      byTip.set(candidate.sha, candidate);
    }
  }
  return [...byTip.values()].sort((a, b) => a.ahead - b.ahead || a.name.localeCompare(b.name)).map((c) => c.name);
}

export function orderPrChain(prs, current) {
  const byHead = new Map(prs.map((pr) => [pr.headRefName, pr]));
  const chain = [];
  const seen = new Set([current]);
  let next = byHead.get(current)?.baseRefName;
  while (next && next !== "main" && !seen.has(next)) {
    seen.add(next);
    chain.unshift(next);
    next = byHead.get(next)?.baseRefName;
  }
  return chain;
}

// A later ordered PR inherits its parent's files by design. Keep checking
// other branches, but do not call that inheritance a collision on the parent.
export function orderedChildRefs(prs, current) {
  const children = new Set();
  const queue = [current];
  for (let i = 0; i < queue.length; i++) {
    for (const pr of prs) {
      if (pr.baseRefName !== queue[i] || children.has(pr.headRefName)) continue;
      if (!(pr.labels || []).some((label) => /^ship-order\/[1-9][0-9]*$/.test(label.name || ""))) continue;
      children.add(pr.headRefName);
      queue.push(pr.headRefName);
    }
  }
  return children;
}

export function excludeExpectedBase(sources, expectedBase) {
  if (!expectedBase) return sources;
  const name = expectedBase.replace(/^origin\//, "");
  return sources.filter((source) => source.refName !== name);
}

// A prior PR may hand one file to this branch. The handoff is exact, and Git
// must be able to combine both versions of that file without a conflict.
export function fileHandoffs(body, branch) {
  return new Set((body || "").split("\n").flatMap((line) => {
    const match = /^File handoff: ([A-Za-z0-9][A-Za-z0-9/_.-]*) -> ([A-Za-z0-9][A-Za-z0-9/_-]*)\s*$/.exec(line.trim());
    return match && match[2] === branch && !match[1].split("/").includes("..") ? [match[1]] : [];
  }));
}

export function resolveFileHandoffs(sources, prs, branch, canMerge) {
  const byHead = new Map(prs.map((pr) => [pr.headRefName, pr]));
  const accepted = [];
  const filtered = sources.map((source) => {
    if (source.kind !== "branch" && source.kind !== "pr") return source;
    const owner = byHead.get(source.refName);
    if (!owner) return source;
    const handoffs = fileHandoffs(owner.body, branch);
    const files = source.files.filter((file) => {
      if (!handoffs.has(file) || !canMerge(file, source.refName)) return true;
      accepted.push({ file, owner: owner.number, branch: source.refName });
      return false;
    });
    return { ...source, files };
  }).filter((source) => source.files.length);
  return { sources: filtered, accepted };
}

function canMergeFile(file, ownerBranch) {
  const owner = `origin/${ownerBranch}`;
  const base = git(["merge-base", "HEAD", owner]);
  if (!base) return false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-handoff-"));
  try {
    for (const [name, ref] of [["ours", "HEAD"], ["base", base], ["theirs", owner]]) {
      const content = execFileSync("git", ["show", `${ref}:${file}`], { stdio: ["ignore", "pipe", "ignore"] });
      fs.writeFileSync(path.join(dir, name), content);
    }
    return run("git", ["merge-file", "--quiet", path.join(dir, "ours"), path.join(dir, "base"), path.join(dir, "theirs")]) !== null;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// mine: string[]; sources: [{ label, files: string[] }]
// -> { withMine: [{ label, files }], hot: [{ file, labels }] }
// withMine = sources sharing a file with this branch.
// hot = files that two or more other sources touch (useful from main, before work starts).
export function findOverlaps(mine, sources) {
  const mineSet = new Set(mine);
  const withMine = [];
  const byFile = new Map();
  for (const s of sources) {
    const shared = [...new Set(s.files)].filter((f) => mineSet.has(f)).sort();
    if (shared.length) withMine.push({ label: s.label, files: shared });
    for (const f of new Set(s.files)) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(s.label);
    }
  }
  const hot = [...byFile.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([file, labels]) => ({ file, labels: labels.sort() }))
    .sort((a, b) => b.labels.length - a.labels.length || a.file.localeCompare(b.file));
  return { withMine, hot };
}

function parseArgs(argv) {
  const a = { days: 14, json: false, fetch: true, expectedBase: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") a.json = true;
    else if (argv[i] === "--no-fetch") a.fetch = false;
    else if (argv[i] === "--days") a.days = Number(argv[++i]) || 14;
    else if (argv[i] === "--expected-base") a.expectedBase = argv[++i] ?? "";
  }
  return a;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.expectedBase === "") {
    console.error("preflight: --expected-base needs a branch name.");
    return 2;
  }
  const top = git(["rev-parse", "--show-toplevel"]);
  if (!top) {
    console.error("preflight: not inside a git repository.");
    return 2;
  }
  const notes = [];
  if (args.fetch && git(["fetch", "origin", "--prune", "--quiet"]) === null) {
    notes.push("git fetch failed; comparing against the last fetched origin/main.");
  }
  if (!git(["rev-parse", "--verify", "--quiet", BASE])) {
    console.error(`preflight: ${BASE} not found. Run git fetch origin.`);
    return 2;
  }
  if (git(["worktree", "prune"]) === null) notes.push("Could not prune dead worktree records.");
  const worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"]));
  const mainTree = worktrees.find((wt) => wt.branch === "main" && !wt.prunable && fs.existsSync(wt.path));
  const mainTip = git(["rev-parse", "--verify", "--quiet", "refs/heads/main"]);
  const mainBehind = mainTip ? Number(git(["rev-list", "--count", `main..${BASE}`]) || 0) : 0;
  const mainPlan = chooseMainUpdate({
    mainExists: Boolean(mainTip),
    behind: mainBehind,
    canFastForward: !mainTip || git(["merge-base", "--is-ancestor", "main", BASE]) !== null,
    worktreePath: mainTree?.path
  });
  let mainUpdated = false;
  let mainUpdateReason = mainPlan.reason || null;
  if (mainPlan.reason) notes.push(`Local main stayed ${mainBehind} commit(s) behind: ${mainPlan.reason}.`);
  else if (mainPlan.action !== "none") {
    const update = mainPlan.action === "merge"
      ? git(["merge", "--ff-only", BASE], mainTree.path)
      : mainPlan.action === "branch"
        ? git(["branch", "-f", "main", BASE])
        : git(["branch", "main", BASE]);
    mainUpdated = update !== null;
    if (!mainUpdated) {
      mainUpdateReason = "Git refused or could not write the fast-forward";
      notes.push(`Could not fast-forward local main; it remains ${mainBehind} commit(s) behind ${BASE}. Local files were preserved.`);
    }
  }

  const current = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD";
  const behind = Number(git(["rev-list", "--count", `HEAD..${BASE}`]) || 0);
  if (args.expectedBase && (!git(["rev-parse", "--verify", "--quiet", args.expectedBase])
      || git(["merge-base", "--is-ancestor", args.expectedBase, "HEAD"]) === null)) {
    console.error(`preflight: expected base ${args.expectedBase} is missing or is not an ancestor of HEAD.`);
    return 2;
  }
  const comparisonBase = args.expectedBase || BASE;
  // On main there is no PR work to protect: skip "mine" and show the hot files instead.
  const onMain = current === "main";
  const mine = onMain ? [] : [
    ...new Set([
      ...lines(git(["diff", "--name-only", `${comparisonBase}...HEAD`])),
      ...parsePorcelain(gitRaw(["status", "--porcelain"]))
    ])
  ];

  const sources = [];
  const sinceSec = Math.floor(Date.now() / 1000) - args.days * 86400;

  // 1. Local branches with recent commits not on origin/main.
  const refs = lines(
    git(["for-each-ref", "--format=%(refname:short) %(committerdate:unix)", "refs/heads"])
  );
  for (const r of refs) {
    const [name, ts] = r.split(" ");
    if (name === current || name === "main" || Number(ts) < sinceSec) continue;
    if (Number(git(["rev-list", "--count", `${BASE}..${name}`]) || 0) === 0) continue;
    // Files the branch changed (three dots) that still differ from main today (two dots).
    // This drops work that already landed, e.g. a squash-merged branch never deleted.
    const stillDiffers = new Set(lines(git(["diff", "--name-only", BASE, name])));
    const files = lines(git(["diff", "--name-only", `${BASE}...${name}`])).filter((f) => stillDiffers.has(f));
    if (files.length) sources.push({ label: `branch ${name}`, refName: name, kind: "branch", files });
  }

  // 2. Other worktrees: unsaved changes only (their commits are covered by step 1).
  for (const wt of worktrees) {
    if (wt.prunable || path.resolve(wt.path) === path.resolve(top)) continue;
    if (!fs.existsSync(wt.path)) continue;
    const files = parsePorcelain(gitRaw(["status", "--porcelain"], wt.path));
    if (files.length) {
      sources.push({
        label: `unsaved in ${path.basename(wt.path)} (${wt.branch || "detached"})`,
        kind: "worktree",
        files
      });
    }
  }

  // 3. Open pull requests on GitHub.
  const prJson = run("gh", ["pr", "list", "--state", "open", "--limit", "100",
    "--json", "number,title,headRefName,baseRefName,files,labels,body"], { cwd: top });
  let openPrs = [];
  if (prJson === null) {
    notes.push("GitHub PR list was unavailable; open pull requests were not checked.");
  } else {
    openPrs = JSON.parse(prJson || "[]");
    for (const pr of openPrs) {
      if (pr.headRefName === current) continue;
      const files = (pr.files || []).map((f) => f.path);
      if (files.length) {
        sources.push({ label: `PR #${pr.number} ${pr.headRefName}`, refName: pr.headRefName, kind: "pr", files });
      }
    }
  }

  const openRefs = lines(git(["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads", "refs/remotes/origin"]));
  const openNames = new Set();
  const ancestors = [];
  for (const entry of openRefs) {
    const [name, sha] = entry.split(" ");
    if (!name || ["main", "origin/main", "origin/HEAD"].includes(name)) continue;
    const ahead = Number(git(["rev-list", "--count", `${BASE}..${name}`]) || 0);
    if (ahead <= 0) continue;
    openNames.add(name.replace(/^origin\//, ""));
    if (name === current || name === `origin/${current}`) continue;
    ancestors.push({ name, sha, ahead, ancestor: git(["merge-base", "--is-ancestor", name, "HEAD"]) !== null });
  }
  const prChain = orderPrChain(openPrs, current);
  const chain = prChain.length ? prChain : orderChain(ancestors, current);

  if (args.expectedBase) notes.push(`Expected stack parent ${args.expectedBase} is an ancestor; its own files are excluded from collision warnings.`);
  const childRefs = orderedChildRefs(openPrs, current);
  if (childRefs.size) notes.push(`Excluded ${childRefs.size} ordered child branch(es); their inherited files are already in this branch.`);
  const collisionSources = excludeExpectedBase(sources, args.expectedBase)
    .filter((source) => !childRefs.has(source.refName));
  const handoff = resolveFileHandoffs(collisionSources, openPrs, current, canMergeFile);
  for (const item of handoff.accepted) {
    const note = `PR #${item.owner} handed ${item.file} to ${current}; both file versions merge cleanly.`;
    if (!notes.includes(note)) notes.push(note);
  }
  const { withMine, hot } = findOverlaps(mine, handoff.sources);
  const report = { current, behind, comparisonBase, localMain: { behindBefore: mainBehind, updated: mainUpdated, reason: mainUpdateReason }, openBranches: openNames.size, chain, myFiles: mine.length, scanned: handoff.sources.length, withMine, hot, notes };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Preflight for ${current}: ${mine.length} changed file(s) since ${comparisonBase}, ${collisionSources.length} other branch/worktree/PR source(s) scanned.`);
    if (behind > 0 && onMain) console.log(`- Local main is ${behind} commit(s) behind ${BASE}. Pull before starting new work.`);
    else if (behind > 0) console.log(`- ${current} is ${behind} commit(s) behind ${BASE}. Rebase on it before opening the PR.`);
    if (mainUpdated) console.log(mainPlan.action === "create"
      ? `- Created local main at ${BASE}.`
      : `- Fast-forwarded local main by ${mainBehind} commit(s).`);
    if (chain.length) console.log(`- Built on an unmerged branch; chain order: ${[BASE, ...chain, current].join(" -> ")}`);
    if (openNames.size > 10) console.log(`- Warning: ${openNames.size} branches have commits outside ${BASE}; review the open chain before adding more.`);
    if (mine.length && !withMine.length) console.log("- No shared files with any other branch, worktree or open PR.");
    for (const o of withMine) {
      console.log(`- Shares ${o.files.length} file(s) with ${o.label}:`);
      for (const f of o.files.slice(0, 15)) console.log(`    ${f}`);
      if (o.files.length > 15) console.log(`    ...and ${o.files.length - 15} more`);
    }
    if (!mine.length) {
      console.log(`- ${onMain ? "On main" : `No changes on ${current}`}. Files that two or more other sources are editing:`);
      if (!hot.length) console.log("    none");
      for (const h of hot.slice(0, 20)) {
        const shown = h.labels.slice(0, 4).join(", ");
        const more = h.labels.length > 4 ? ` and ${h.labels.length - 4} more` : "";
        console.log(`    ${h.file}  <- ${h.labels.length} sources: ${shown}${more}`);
      }
      if (hot.length > 20) console.log(`    ...and ${hot.length - 20} more`);
    }
    for (const n of notes) console.log(`- Note: ${n}`);
  }
  return withMine.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
