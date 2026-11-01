#!/usr/bin/env node
// Move PRs based on a merged branch onto main, including older unlabeled stacks.
// GitHub may already restack a native stack. In that case this is a no-op.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function orderOf(pr) {
  const values = (pr.labels || []).map((label) => typeof label === "string" ? label : label.name);
  const orders = values.map((value) => /^ship-order\/(\d+)$/.exec(value || ""))
    .filter(Boolean).map((match) => Number(match[1]));
  return orders.length === 1 && Number.isSafeInteger(orders[0]) && orders[0] > 0
    ? orders[0] : null;
}

export function recordedParentHead(pr) {
  const matches = [...(pr.body || "").matchAll(/^Stack parent head: ([a-f0-9]{40})[ \t]*$/gim)];
  return matches.length === 1 ? matches[0][1].toLowerCase() : null;
}

export function directChildren(prs, merged, repo) {
  const parentOrder = orderOf(merged);
  const nextOrder = parentOrder === null ? null : parentOrder + 1;
  return prs.filter((pr) => pr.state === "open"
    && pr.head?.repo?.full_name === repo
    && (pr.base?.ref === merged.head.ref
      || (nextOrder !== null && pr.base?.ref === "main" && orderOf(pr) === nextOrder)))
    .sort((a, b) => a.number - b.number);
}

export function nextQueuedPr(prs, repo) {
  return prs.filter((pr) => pr.state === "open" && pr.base?.ref === "main"
    && pr.head?.repo?.full_name === repo && orderOf(pr) !== null)
    .sort((a, b) => orderOf(a) - orderOf(b) || a.number - b.number)[0] || null;
}

export function command(program, args, options = {}) {
  return execFileSync(program, args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options
  }).trim();
}

function assertBranch(branch, run) {
  run("git", ["check-ref-format", "--branch", branch]);
}

function latestPr(repo, number, run) {
  return JSON.parse(run("gh", ["api", `repos/${repo}/pulls/${number}`]));
}

function comment(repo, number, body, run) {
  run("gh", ["api", "--method", "POST", `repos/${repo}/issues/${number}/comments`, "-f", `body=${body}`]);
}

function archiveHead(branch, run) {
  const ref = `refs/tags/archive/${branch}`;
  const head = run("git", ["rev-parse", "HEAD"]);
  const old = run("git", ["ls-remote", "--tags", "origin", ref]).split(/\s+/)[0];
  if (old === head) return;
  run("git", ["tag", "-f", `archive/${branch}`, head]);
  run("git", old
    ? ["push", `--force-with-lease=${ref}:${old}`, "origin", ref]
    : ["push", "origin", ref]);
  const verified = run("git", ["ls-remote", "--tags", "origin", ref]).split(/\s+/)[0];
  if (verified !== head) throw new Error(`Could not verify archive tag for ${branch}`);
}

export function restackChild({ child, merged, repo, run = command }) {
  const branch = child.head.ref;
  const oldHead = child.head.sha;
  const parentHead = merged.head.sha;
  assertBranch(branch, run);
  if (!/^[a-f0-9]{40}$/i.test(oldHead) || !/^[a-f0-9]{40}$/i.test(parentHead)) {
    throw new Error(`PR #${child.number} has an invalid head SHA`);
  }

  // A parent may have been auto-deleted, but its commit remains in the child's history.
  run("git", ["fetch", "origin", "refs/heads/main:refs/remotes/origin/main",
    `refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  const fetchedHead = run("git", ["rev-parse", `refs/remotes/origin/${branch}`]);
  if (fetchedHead !== oldHead) return { number: child.number, state: "changed" };
  const current = latestPr(repo, child.number, run);
  if (![merged.head.ref, "main"].includes(current.base?.ref) || current.head?.sha !== oldHead) {
    return { number: child.number, state: "already-moved" };
  }
  let rebaseBase = parentHead;
  try {
    run("git", ["merge-base", "--is-ancestor", parentHead, fetchedHead]);
  } catch {
    // GitHub can rebase a native stack before this workflow starts. The exact
    // child head must already contain current main before it enters the queue.
    if (current.base?.ref === "main") {
      let onMain = false;
      try {
        run("git", ["merge-base", "--is-ancestor", "origin/main", fetchedHead]);
        onMain = true;
      } catch { /* try the recorded parent tip below */ }
      if (onMain) {
        run("git", ["switch", "-C", `restack-pr-${child.number}`, fetchedHead]);
        archiveHead(branch, run);
        run("gh", ["pr", "merge", String(child.number), "--repo", repo, "--auto", "--squash"]);
        return { number: child.number, state: "already-restacked" };
      }
    }
    const recorded = recordedParentHead(current);
    if (!recorded || recorded === fetchedHead) {
      comment(repo, child.number,
        `@ZootimusMaximusSupreme PR #${child.number} needs a manual restack after #${merged.number} merged. Its previous parent tip was not recorded. I left the branch unchanged.`, run);
      return { number: child.number, state: "not-stacked" };
    }
    try {
      run("git", ["merge-base", "--is-ancestor", recorded, fetchedHead]);
    } catch {
      comment(repo, child.number,
        `@ZootimusMaximusSupreme PR #${child.number} needs a manual restack after #${merged.number} merged. Its recorded parent tip is not in the branch history. I left the branch unchanged.`, run);
      return { number: child.number, state: "not-stacked" };
    }
    rebaseBase = recorded;
  }

  run("git", ["switch", "-C", `restack-pr-${child.number}`, fetchedHead]);
  try {
    run("git", ["rebase", "--onto", "origin/main", rebaseBase]);
  } catch {
    try { run("git", ["rebase", "--abort"]); } catch { /* no active rebase */ }
    comment(repo, child.number,
      `@ZootimusMaximusSupreme PR #${child.number} could not be restacked after #${merged.number} merged. The rebase conflicts with current main. I left the branch and PR unchanged for a manual fix.`, run);
    return { number: child.number, state: "conflict" };
  }

  // A native GitHub restack or another agent may have moved the PR while this ran.
  const beforePush = latestPr(repo, child.number, run);
  if (![merged.head.ref, "main"].includes(beforePush.base?.ref) || beforePush.head?.sha !== oldHead) {
    return { number: child.number, state: "already-moved" };
  }
  archiveHead(branch, run);
  run("git", ["push", `--force-with-lease=refs/heads/${branch}:${oldHead}`, "origin", `HEAD:refs/heads/${branch}`]);
  if (beforePush.base.ref !== "main") {
    run("gh", ["api", "--method", "PATCH", `repos/${repo}/pulls/${child.number}`, "-f", "base=main"]);
  }
  run("gh", ["pr", "merge", String(child.number), "--repo", repo, "--auto", "--squash"]);
  return { number: child.number, state: "restacked" };
}

export function catchUpAfterShip({ prs, repo, run = command }) {
  const next = nextQueuedPr(prs, repo);
  if (!next) return [];
  const branch = next.head.ref;
  const oldHead = next.head.sha;
  assertBranch(branch, run);
  if (!/^[a-f0-9]{40}$/i.test(oldHead)) throw new Error(`PR #${next.number} has an invalid head SHA`);
  run("git", ["fetch", "origin", "refs/heads/main:refs/remotes/origin/main",
    `refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  if (run("git", ["rev-parse", `refs/remotes/origin/${branch}`]) !== oldHead) {
    return [{ number: next.number, state: "changed" }];
  }
  const current = latestPr(repo, next.number, run);
  if (current.state !== "open" || current.base?.ref !== "main" || current.head?.sha !== oldHead) {
    return [{ number: next.number, state: "already-moved" }];
  }
  try {
    run("git", ["merge-base", "--is-ancestor", "origin/main", oldHead]);
    return [{ number: next.number, state: "current" }];
  } catch { /* the ship receipt advanced main */ }
  run("git", ["switch", "-C", `restack-pr-${next.number}`, oldHead]);
  try {
    run("git", ["rebase", "origin/main"]);
  } catch {
    try { run("git", ["rebase", "--abort"]); } catch { /* no active rebase */ }
    comment(repo, next.number,
      `@ZootimusMaximusSupreme PR #${next.number} could not catch up after the latest ship receipt. The rebase conflicts with main. I left the branch and PR unchanged for a manual fix.`, run);
    return [{ number: next.number, state: "conflict" }];
  }
  const beforePush = latestPr(repo, next.number, run);
  if (beforePush.state !== "open" || beforePush.base?.ref !== "main" || beforePush.head?.sha !== oldHead) {
    return [{ number: next.number, state: "already-moved" }];
  }
  archiveHead(branch, run);
  run("git", ["push", `--force-with-lease=refs/heads/${branch}:${oldHead}`, "origin", `HEAD:refs/heads/${branch}`]);
  run("gh", ["pr", "merge", String(next.number), "--repo", repo, "--auto", "--squash"]);
  return [{ number: next.number, state: "caught-up" }];
}

export function main({ eventPath = process.env.GITHUB_EVENT_PATH,
  repo = process.env.GITHUB_REPOSITORY, run = command } = {}) {
  if (!eventPath || !repo) throw new Error("Missing GitHub event path or repository");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  if (event.ref === "refs/heads/main" && /^ship: [a-f0-9]{8} is live\b/.test(event.head_commit?.message || "")) {
    const pages = JSON.parse(run("gh", ["api", "--paginate", "--slurp",
      `repos/${repo}/pulls?state=open&per_page=100`]));
    return catchUpAfterShip({ prs: pages.flat(), repo, run });
  }
  const merged = event.pull_request;
  if (event.action !== "closed" || !merged?.merged || merged.base?.ref !== "main"
    || merged.head?.repo?.full_name !== repo) {
    return [];
  }
  const pages = JSON.parse(run("gh", ["api", "--paginate", "--slurp",
    `repos/${repo}/pulls?state=open&per_page=100`]));
  const children = directChildren(pages.flat(), merged, repo);
  if (children.length > 1) {
    const message = `@ZootimusMaximusSupreme More than one PR is based on #${merged.number}. I left their branches unchanged because the chain has forked; please choose the next PR before restacking.`;
    for (const child of children) comment(repo, child.number, message, run);
    throw new Error(`PR chain forks after PR #${merged.number}`);
  }
  return children.map((child) => restackChild({ child, merged, repo, run }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const results = main();
    for (const result of results) console.log(`PR #${result.number}: ${result.state}`);
    if (results.some((result) => result.state === "conflict")) process.exitCode = 1;
  } catch (error) {
    console.error(`restack: ${error.message}`);
    process.exitCode = 1;
  }
}
