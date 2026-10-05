#!/usr/bin/env node
/**
 * Push the full local repo (all branches + tags) to GitHub.
 *
 * Env (gitignored .env or credentials/github-pat.txt via loadEnv):
 *   GITHUB_TOKEN — personal access token with repo (push) scope
 *   GITHUB_REPO  — optional, default ZootimusMaximusBackup/fundhub-platform
 *
 * Adds/updates remote `origin`, pushes main (--force-with-lease), other branches, tags.
 * Removes remote `gitlab` if present. Never removes GitHub remotes.
 * Never prints the token.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";
import { spawnSync } from "node:child_process";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function readTokenFromPatFile() {
  const patPath = path.join(repoRoot, "credentials", "github-pat.txt");
  if (!fs.existsSync(patPath)) return "";
  const raw = fs.readFileSync(patPath, "utf8").trim();
  if (!raw) return "";
  const line = raw.split("\n").map((l) => l.trim()).find(Boolean) || "";
  if (line.startsWith("ghp_") || line.startsWith("github_pat_")) return line;
  const m = line.match(/^(?:GITHUB_TOKEN=)?(ghp_[^\s]+|github_pat_[^\s]+)/);
  return m ? m[1] : line;
}

let token = String(process.env.GITHUB_TOKEN ?? "").trim();
if (!token) token = readTokenFromPatFile();

let repo = String(process.env.GITHUB_REPO ?? "ZootimusMaximusBackup/fundhub-platform").trim();

if (!token) {
  console.error("GITHUB_TOKEN missing — add a GitHub PAT with repo scope to .env or credentials/github-pat.txt");
  console.error("https://github.com/settings/tokens");
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || "").trim();
    throw new Error(`${cmd} failed (${res.status}): ${err.slice(0, 500)}`);
  }
  return (res.stdout || "").trim();
}

function githubFetch(path, { method = "GET" } = {}) {
  const url = `https://api.github.com${path}`;
  const args = ["-sS", "-w", "\n%{http_code}"];
  if (method !== "GET") args.push("-X", method);
  args.push("-H", `Authorization: Bearer ${token}`);
  args.push("-H", "Accept: application/vnd.github+json");
  args.push("-H", "X-GitHub-Api-Version: 2022-11-28");
  args.push(url);
  const res = spawnSync("/usr/bin/curl", args, { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`GitHub API request failed: ${(res.stderr || "").slice(0, 300)}`);
  }
  const raw = (res.stdout || "").trim();
  const lastNl = raw.lastIndexOf("\n");
  const body = lastNl >= 0 ? raw.slice(0, lastNl) : raw;
  const code = lastNl >= 0 ? raw.slice(lastNl + 1).trim() : "000";
  return { body, code: Number(code) };
}

function remoteUrlFor(repoPath) {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repoPath}.git`;
}

try {
  const { body, code } = githubFetch("/user");
  if (code !== 200) {
    let msg = "GitHub token rejected";
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) msg = parsed.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const who = JSON.parse(body);
  if (!who.login) throw new Error("GitHub token rejected");

  const publicRemote = `https://github.com/${repo}.git`;
  const existing = run("git", ["remote"]);
  if (!existing.split("\n").includes("origin")) {
    run("git", ["remote", "add", "origin", publicRemote]);
    console.log("added remote origin");
  } else {
    run("git", ["remote", "set-url", "origin", publicRemote]);
    console.log("updated remote origin");
  }

  const remoteUrl = remoteUrlFor(repo);
  console.log(`pushing as ${who.login} to ${repo} ...`);

  const dryRun = spawnSync("git", ["push", "--dry-run", remoteUrl, "main"], {
    encoding: "utf8",
  });
  const dryText = `${dryRun.stderr || ""}${dryRun.stdout || ""}`;
  if (dryRun.status !== 0 && /403|401|denied|permission/i.test(dryText)) {
    throw new Error(
      "GitHub rejected push — token needs repo scope (contents write) on " +
        `${repo}. Update GITHUB_TOKEN in .env or credentials/github-pat.txt, then re-run.`
    );
  }

  const fetched = spawnSync(
    "git",
    ["fetch", remoteUrl, "+refs/heads/*:refs/remotes/origin/*"],
    { encoding: "utf8" }
  );
  if (fetched.status !== 0) {
    const fetchErr = `${fetched.stderr || ""}${fetched.stdout || ""}`;
    if (!/couldn't find remote ref|no such ref/i.test(fetchErr)) {
      throw new Error(
        `git fetch failed (${fetched.status}): ${fetchErr.replaceAll(token, "[token]").slice(0, 300)}`
      );
    }
  }

  const branches = run("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);
  const branchCount = branches.length;

  let expectedMain = "";
  const expectedRes = spawnSync("git", ["rev-parse", "--verify", "refs/remotes/origin/main"], {
    encoding: "utf8",
  });
  if (expectedRes.status === 0) expectedMain = (expectedRes.stdout || "").trim();
  const mainArgs = ["push", remoteUrl];
  if (expectedMain) mainArgs.push(`--force-with-lease=refs/heads/main:${expectedMain}`);
  mainArgs.push("main");
  run("git", mainArgs, { stdio: "inherit" });
  run("git", ["push", remoteUrl, "--tags"], { stdio: "inherit" });

  for (const branch of branches) {
    if (branch === "main") continue;
    run("git", ["push", remoteUrl, branch], { stdio: "inherit" });
  }

  for (const branch of branches) {
    const tip = run("git", ["rev-parse", branch]);
    run("git", ["update-ref", `refs/remotes/origin/${branch}`, tip]);
    run("git", ["branch", "--set-upstream-to", `origin/${branch}`, branch]);
  }

  const localMain = run("git", ["rev-parse", "main"]);
  const listed = spawnSync("git", ["ls-remote", remoteUrl, "refs/heads/main"], {
    encoding: "utf8",
  });
  if (listed.status !== 0) {
    const listErr = `${listed.stderr || ""}${listed.stdout || ""}`.replaceAll(token, "[token]");
    throw new Error(`GitHub main check failed: ${listErr.slice(0, 300)}`);
  }
  const remoteMain = (listed.stdout || "").split(/\s+/)[0];
  if (remoteMain !== localMain) {
    throw new Error("GitHub main does not match this machine after push");
  }
  console.log(`main matches GitHub ${localMain}`);

  const remoteLines = run("git", ["remote"]).split("\n").map((l) => l.trim()).filter(Boolean);
  if (remoteLines.includes("gitlab")) {
    run("git", ["remote", "remove", "gitlab"]);
    console.log("removed GitLab remote gitlab");
  }

  console.log(`done — ${branchCount} branch(es) and tags on GitHub (${repo})`);
} catch (err) {
  console.error(String(err.message || err));
  process.exit(1);
}
