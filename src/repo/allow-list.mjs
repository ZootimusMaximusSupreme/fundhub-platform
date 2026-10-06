// @ts-check
// The only places the app may write in the repo.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 2 ("The allow-list")
// and the §3c rule it lands with: the GitHub token is "used only by code that
// refuses any path outside the marketing folders". This file is that refusal.
// It runs twice: when a save is queued (src/repo/outbox.mjs enqueueRepoWrite) and
// again inside the GitHub client right before a tree is built
// (src/messaging/providers/github-repo.mjs createTree). Migration 412 adds a
// traversal guard on the column underneath both.
//
// "NORMALISE, THEN ALLOW" — the normal form is the only form accepted. A path
// that would only become allowed after cleaning (./x, a/../b, a//b, a\b, an
// encoded dot) is refused outright rather than cleaned: a path that needs
// rewriting to look safe came from somewhere that should not be trusted.
//
// The list is exactly the spec list, plus the funnel builder's own folder (build
// unit X4). The flywheel folder is NOT on it (a later unit adds it, with its own
// review).

import path from "node:path";

/** Folders the app may write anywhere below. Each ends with "/". */
export const ALLOWED_DIRS = Object.freeze([
  "marketing/ads/scripts/machine/",
  "marketing/ads/ideas/",
  "marketing/ads/videos/",
  "marketing/brain/",
  "ops/page-requests/",
  // Build unit X4 (owner order 2026-10-05): the pages of a dashboard-built funnel,
  // saved to the repo when the push proves them live. Its own folder only; the
  // hand-made pages beside it (marketing/landing-pages/*.html, slo/) stay off.
  "marketing/landing-pages/funnels/"
]);

/** Single files the app may write. */
export const ALLOWED_FILES = Object.freeze([
  "marketing/ads/RULES.md",
  "marketing/ads/VOICE.md",
  "marketing/ads/banned-live.json",
  "marketing/ads/registry.json",
  "marketing/ads/angles.json"
]);

export const MAX_PATH_LENGTH = 300;

/* One path segment: starts with a letter, digit or underscore (so never "." or
   ".." and never a hidden file), then plain filename characters. ASCII only, so
   no look-alike letters and no control characters. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9 _.,()+@-]*$/;

export class RepoPathError extends Error {
  constructor(message, input) {
    super(message);
    this.name = "RepoPathError";
    this.code = "repo_path_refused";
    this.path = typeof input === "string" ? input.slice(0, MAX_PATH_LENGTH) : null;
  }
}

function refuse(input, why) {
  throw new RepoPathError(`repo path refused: ${why}`, input);
}

/**
 * The normal form of a repo path, or a RepoPathError. Never rewrites: anything
 * not already in normal form is refused.
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeRepoPath(input) {
  if (typeof input !== "string") refuse(input, "not a string");
  const p = /** @type {string} */ (input);
  if (!p.length) refuse(p, "empty");
  if (p.length > MAX_PATH_LENGTH) refuse(p, `longer than ${MAX_PATH_LENGTH} characters`);
  if (p.includes("\\")) refuse(p, "backslash");
  if (p.includes("%")) refuse(p, "percent-encoding");
  if (/[\u0000-\u001f\u007f]/.test(p)) refuse(p, "control character");
  if (p.startsWith("/")) refuse(p, "absolute path");
  if (p.startsWith("~")) refuse(p, "home-folder path");
  if (p.includes(":")) refuse(p, "colon");
  if (p.endsWith("/")) refuse(p, "ends with a slash (a folder, not a file)");
  const segments = p.split("/");
  for (const s of segments) {
    if (s === "") refuse(p, "empty segment (//)");
    if (s === "." || s === "..") refuse(p, `"${s}" segment`);
    if (!SEGMENT.test(s)) refuse(p, `segment "${s.slice(0, 40)}" has a character that is not allowed`);
    if (/[ .]$/.test(s)) refuse(p, `segment "${s.slice(0, 40)}" ends with a space or a dot`);
  }
  // Belt and braces: the normal form must be the input itself.
  if (path.posix.normalize(p) !== p) refuse(p, "not in normal form");
  return p;
}

/** True when the path is in normal form and inside the spec list. */
export function isAllowedRepoPath(input) {
  let p;
  try { p = normalizeRepoPath(input); } catch { return false; }
  if (ALLOWED_FILES.includes(p)) return true;
  return ALLOWED_DIRS.some((dir) => p.startsWith(dir) && p.length > dir.length);
}

/**
 * The normal path when it is allowed; a RepoPathError otherwise.
 * @param {unknown} input
 * @returns {string}
 */
export function assertAllowedRepoPath(input) {
  const p = normalizeRepoPath(input);
  if (!isAllowedRepoPath(p)) {
    refuse(p, "outside the folders the app may write (src/repo/allow-list.mjs)");
  }
  return p;
}
