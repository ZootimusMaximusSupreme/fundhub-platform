#!/usr/bin/env node
// @ts-check
// scripts/netlify-ignore-machine-only.mjs — Netlify's [build] ignore command.
//
//   ignore = "node scripts/netlify-ignore-machine-only.mjs"   (netlify.toml [build])
//
// Netlify runs this before a build it started itself (a push to GitHub). The exit code
// is the answer:
//   exit 0 = SKIP this build
//   exit 1 = BUILD as normal
//
// It answers SKIP in exactly one case: Netlify names the last commit it built
// (CACHED_COMMIT_REF) and this one (COMMIT_REF), the two differ, and every file that
// changed between them sits in a machine-only folder (scripts/ship-machine-paths.mjs,
// the same list npm run ship uses). Every other case builds: a missing or odd commit
// id, the same commit, no changed files, git failing, or any one other file.
//
// WHY. Once the repo outbox is live (spec M0 step 2) every save in the Command Center is
// a commit on GitHub's main. If this site still builds itself from GitHub, each of those
// commits would start a production build and its migrate step — the 2026-08-06 failure
// that burned the month's build credits. Script drafts, ideas, video notes, brain notes
// and page requests are not code the site runs, so those builds are skipped.
//
// A laptop ship is never skipped by this: `netlify deploy --build` runs the build on
// the Mac and Netlify's CLI does not run the ignore command at all (checked in the CLI's
// @netlify/build, 2026-10-05). npm run ship also only deploys when a non-machine file
// changed.
//
// Node built-ins only: Netlify runs this before it installs packages.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MACHINE_ONLY_PATHS, isMachineOnlyChange, isMachinePath } from "./ship-machine-paths.mjs";

export { MACHINE_ONLY_PATHS };

export const SKIP = 0;
export const BUILD = 1;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// A commit id is hex. Anything else (a branch name, a word starting with "-") is not
// handed to git at all; the build just runs.
const COMMIT_ID = /^[0-9a-f]{7,64}$/i;

/**
 * Files changed between two commits, as git names them. null when git cannot answer.
 * --no-renames: a file moved from code into a machine folder shows as a delete of the
 * code file plus an add, so the move still builds.
 * @param {string} from
 * @param {string} to
 * @param {{ cwd?: string, timeout?: number }} [opts]
 * @returns {string[] | null}
 */
export function gitChangedPaths(from, to, { cwd = ROOT, timeout = 60_000 } = {}) {
  const r = spawnSync("git", ["diff", "--name-only", "--no-renames", "-z", from, to, "--"], {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  return r.stdout.split("\0").filter(Boolean);
}

/**
 * The whole decision, with git passed in so it can be tested.
 * @param {{ cachedRef?: string, commitRef?: string,
 *           listChanged?: (from: string, to: string) => string[] | null }} input
 * @returns {{ code: 0 | 1, why: string }}
 */
export function decide({ cachedRef, commitRef, listChanged = gitChangedPaths }) {
  const from = String(cachedRef ?? "").trim();
  const to = String(commitRef ?? "").trim();
  if (!from || !to) return { code: BUILD, why: "Netlify did not name both the last built commit and this one" };
  if (!COMMIT_ID.test(from) || !COMMIT_ID.test(to)) return { code: BUILD, why: "a commit id is not a plain commit id" };
  if (from.toLowerCase() === to.toLowerCase()) return { code: BUILD, why: "this is the same commit as the last build" };
  let paths;
  try {
    paths = listChanged(from, to);
  } catch {
    paths = null;
  }
  if (!Array.isArray(paths)) return { code: BUILD, why: "git could not list the changed files" };
  if (paths.length === 0) return { code: BUILD, why: "git lists no changed files" };
  if (isMachineOnlyChange(paths)) {
    return { code: SKIP, why: `only machine files changed (${paths.length} file${paths.length === 1 ? "" : "s"})` };
  }
  const other = paths.find((p) => !isMachinePath(p));
  return { code: BUILD, why: `${other} changed` };
}

/**
 * @param {string | undefined} argv1
 * @param {string} moduleUrl
 */
export function isDirectRun(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (!argv1) return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return fs.realpathSync(path.resolve(argv1)) === fs.realpathSync(self);
  } catch {
    return path.resolve(argv1) === self;
  }
}

if (isDirectRun()) {
  let result;
  try {
    result = decide({ cachedRef: process.env.CACHED_COMMIT_REF, commitRef: process.env.COMMIT_REF });
  } catch (e) {
    result = { code: BUILD, why: `the skip check broke (${e?.message || e})` };
  }
  console.log(result.code === SKIP ? `Skipping this build: ${result.why}.` : `Building: ${result.why}.`);
  process.exit(result.code);
}
