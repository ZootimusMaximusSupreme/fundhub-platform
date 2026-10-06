// @ts-check
// GitHub client for the app's own repo saves (the repo outbox).
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 2, trap 7 (§4): the
// client lives here, in src/messaging/providers/, and EVERY call goes through
// transmit() behind the ADAPTERS fence (src/lib/outbound-fetch.mjs). A commit
// changes a record at a vendor (our repository), so with ADAPTERS_DRY_RUN unset
// or not an off value, every call comes back `blocked` and nothing leaves.
// src/repo/github.mjs re-exports the read helpers for the writer and the rules
// routes; src/repo/outbox.mjs drives the write sequence.
//
// The write sequence (one commit per drain):
//   getRef -> listCommits(20) -> getContents (edit rows) -> createTree
//   (base_tree + inline contents) -> createCommit -> updateRef (force:false)
//
// THE TOKEN IS GITHUB_REPO_TOKEN ONLY: a fine-grained token for this one
// repository with Contents read and write. GITHUB_TOKEN is the laptop's push
// token and is never read here. A missing or masked value ("****abcd") is no
// token at all. The token is only ever sent in the Authorization header and is
// never logged; transmit() redacts errors.
//
// createTree refuses any path outside src/repo/allow-list.mjs, so even a
// caller that skipped the outbox cannot write elsewhere.
//
// NEVER THROWS. Every function returns transmit()'s shape ({ok, blocked,
// status, error, ...}) plus the fields it reads out of GitHub's answer.

import { transmit, ADAPTERS } from "../../lib/outbound-fetch.mjs";
import { isAllowedRepoPath } from "../../repo/allow-list.mjs";

export const PROVIDER = "github-repo";
/* Declared so src/lib/no-unfenced-transmit.test.mjs checks that this file goes
   through the fenced HTTP helper. */
export const TRANSMITS = true;

export const API_BASE = "https://api.github.com";
export const DEFAULT_REPO = "ZootimusMaximusSupreme/fundhub-platform";
export const DEFAULT_BRANCH = "main";
export const API_VERSION = "2022-11-28";
export const TIMEOUT_MS = 15_000;
export const COMMITS_TO_CHECK = 20;

/** Every app commit's author. The address is the one src/messaging/providers/resend.mjs sends from. */
export const APP_AUTHOR = Object.freeze({ name: "Fundhub app", email: "noreply@fundhub.ai" });

/** @typedef {Record<string, any>} Env */
/** @typedef {{env?: Env, fetchImpl?: Function}} GhOpts */
/** @typedef {{ok:boolean, blocked:boolean, transmitted?:boolean, status:number, body:any,
               headers:Record<string,string>, error:string|null, fence?:string|null}} GhResult */

/* transmit()'s options are declared only by its default values; this names the
   full set this file passes (fence, what, env, fetchImpl, timeoutMs, asText). */
const send = /** @type {(url: string, init: object, opts: object) => Promise<GhResult>} */ (transmit);

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const BRANCH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * GITHUB_REPO_TOKEN, or null when it is missing, empty or masked.
 * @param {Env} [env]
 */
export function repoToken(env = process.env) {
  const raw = env?.GITHUB_REPO_TOKEN;
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t || t.includes("*")) return null;
  return t;
}

/**
 * { token, repo, branch } with the spec defaults.
 * @param {Env} [env]
 */
export function repoConfig(env = process.env) {
  const repo = String(env?.GITHUB_REPO ?? "").trim();
  const branch = String(env?.GITHUB_BRANCH ?? "").trim();
  return {
    token: repoToken(env),
    repo: REPO_RE.test(repo) && !repo.includes("..") ? repo : DEFAULT_REPO,
    branch: BRANCH_RE.test(branch) && !branch.includes("..") ? branch : DEFAULT_BRANCH
  };
}

const encodePath = (p) => String(p).split("/").map(encodeURIComponent).join("/");

/**
 * The one place a request is built. Returns transmit()'s result unchanged.
 * @param {string} method
 * @param {string} route
 * @param {GhOpts & {body?: any, headers?: Record<string,string>, what?: string, asText?: boolean}} [opts]
 * @returns {Promise<GhResult>}
 */
async function call(method, route, { env = process.env, fetchImpl, body, headers = {}, what, asText = false } = {}) {
  const { token, repo } = repoConfig(env);
  if (!token) {
    return {
      ok: false, blocked: false, transmitted: false, status: 0, body: null, headers: {},
      error: "GITHUB_REPO_TOKEN is not set (or is masked)", fence: ADAPTERS
    };
  }
  /** @type {{method: string, headers: Record<string,string>, body?: string}} */
  const init = {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "fundhub-app",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers
    }
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return send(`${API_BASE}/repos/${repo}${route}`, init, {
    fence: ADAPTERS, what: what || `github ${method} ${route.split("?")[0]}`,
    env, fetchImpl, timeoutMs: TIMEOUT_MS, asText
  });
}

/* GitHub puts the reason in body.message; keep it with the status. */
function withReason(res) {
  const msg = res?.body && typeof res.body === "object" && typeof res.body.message === "string"
    ? res.body.message : null;
  return msg ? { ...res, error: `${res.status} ${msg}`.slice(0, 300) } : res;
}

/** Is this the "someone else moved the branch first" answer? (422 not a fast forward, or 409) */
export function isBranchMoved(res) {
  if (!res || res.blocked) return false;
  if (res.status === 409) return true;
  if (res.status !== 422) return false;
  const msg = `${res.body?.message ?? ""} ${res.error ?? ""}`;
  return /fast[- ]?forward/i.test(msg);
}

/**
 * The commit the branch points at.
 * @param {GhOpts} [opts]
 * @returns {Promise<GhResult & {sha: string|null}>}
 */
export async function getRef({ env, fetchImpl } = {}) {
  const { branch } = repoConfig(env);
  const res = withReason(await call("GET", `/git/ref/heads/${encodePath(branch)}`, { env, fetchImpl }));
  return { ...res, sha: res.ok ? res.body?.object?.sha ?? null : null };
}

function decodeBase64(text) {
  return Buffer.from(String(text || "").replace(/\s/g, ""), "base64").toString("utf8");
}

/**
 * Read one file through the Contents API, with an ETag.
 *
 *   200 -> { content, sha, etag, notModified:false }
 *   304 -> { notModified:true, etag } (the caller keeps its copy; free on GitHub's rate limit)
 *   404 -> { missing:true, content:null }
 *
 * @param {string} path
 * @param {GhOpts & {ref?: string, etag?: string}} [opts]
 * @returns {Promise<GhResult & {content: string|null, sha: string|null, etag: string|null,
 *                               notModified: boolean, missing: boolean}>}
 */
export async function getContents(path, { ref, etag, env, fetchImpl } = {}) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const route = `/contents/${encodePath(path)}${q}`;
  const headers = etag ? { "If-None-Match": etag } : {};
  const res = await call("GET", route, { env, fetchImpl, headers, what: `github read ${path}` });
  const tag = res.headers?.etag ?? null;
  const base = { content: null, sha: null, etag: tag, notModified: false, missing: false };
  if (res.status === 304) {
    return { ...res, ...base, ok: true, error: null, notModified: true, etag: tag || etag || null };
  }
  if (res.status === 404 && !res.blocked) {
    return { ...res, ...base, ok: true, error: null, missing: true };
  }
  if (!res.ok) return { ...withReason(res), ...base };
  const b = res.body || {};
  if (Array.isArray(b) || b.type === "dir") {
    return { ...res, ...base, ok: false, error: `${path} is a folder, not a file` };
  }
  if (b.encoding === "base64") {
    return { ...res, ...base, content: decodeBase64(b.content), sha: b.sha ?? null };
  }
  // Over 1 MB the Contents API answers without the bytes: ask for the raw file.
  const raw = await call("GET", route, {
    env, fetchImpl, asText: true, what: `github read raw ${path}`,
    headers: { Accept: "application/vnd.github.raw+json" }
  });
  if (!raw.ok) return { ...withReason(raw), ...base };
  return { ...raw, ...base, content: String(raw.body ?? ""), sha: b.sha ?? null, etag: raw.headers?.etag ?? tag };
}

/**
 * List one folder through the Contents API (a read; the Ideas tab's campaign
 * picker and stage rows, unit X3).
 *
 *   200 -> { entries: [{name, path, type:'file'|'dir', sha}] }
 *   404 -> { missing:true, entries:[] }
 *
 * @param {string} path
 * @param {GhOpts & {ref?: string}} [opts]
 * @returns {Promise<GhResult & {entries: {name: string, path: string, type: string, sha: string|null}[],
 *                               missing: boolean}>}
 */
export async function listFolder(path, { ref, env, fetchImpl } = {}) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await call("GET", `/contents/${encodePath(path)}${q}`, { env, fetchImpl, what: `github list ${path}` });
  if (res.status === 404 && !res.blocked) return { ...res, ok: true, error: null, entries: [], missing: true };
  if (!res.ok) return { ...withReason(res), entries: [], missing: false };
  if (!Array.isArray(res.body)) return { ...res, ok: false, error: `${path} is a file, not a folder`, entries: [], missing: false };
  const entries = res.body
    .filter((e) => e && typeof e.name === "string")
    .map((e) => ({ name: e.name, path: String(e.path ?? `${path}/${e.name}`), type: String(e.type ?? "file"), sha: e.sha ?? null }));
  return { ...res, entries, missing: false };
}

/**
 * The last `perPage` commits reachable from `sha` (default: the branch).
 * @param {GhOpts & {sha?: string, perPage?: number}} [opts]
 * @returns {Promise<GhResult & {commits: {sha: string|null, message: string, tree: string|null}[]}>}
 */
export async function listCommits({ sha, perPage = COMMITS_TO_CHECK, env, fetchImpl } = {}) {
  const { branch } = repoConfig(env);
  const n = Math.min(Math.max(Number(perPage) || COMMITS_TO_CHECK, 1), 100);
  const res = withReason(await call("GET",
    `/commits?sha=${encodeURIComponent(sha || branch)}&per_page=${n}`, { env, fetchImpl }));
  const commits = res.ok && Array.isArray(res.body)
    ? res.body.map((c) => ({
      sha: c?.sha ?? null,
      message: String(c?.commit?.message ?? ""),
      tree: c?.commit?.tree?.sha ?? null
    }))
    : [];
  return { ...res, commits };
}

/**
 * A tree on top of `baseTree` with each file's full text inline.
 * Refuses (without a request) any path outside the allow-list.
 * @param {GhOpts & {baseTree?: string, files?: {path: string, content: string}[]}} [args]
 * @returns {Promise<GhResult & {sha: string|null}>}
 */
export async function createTree({ baseTree, files, env, fetchImpl } = {}) {
  const list = Array.isArray(files) ? files : [];
  const bad = list.find((f) => !isAllowedRepoPath(f?.path) || typeof f?.content !== "string");
  if (!list.length || bad) {
    return {
      ok: false, blocked: false, transmitted: false, status: 0, body: null, headers: {}, sha: null,
      error: !list.length ? "nothing to write" : `refused to write ${String(bad?.path).slice(0, 120)}: not on the allow-list`,
      fence: ADAPTERS
    };
  }
  const res = withReason(await call("POST", "/git/trees", {
    env, fetchImpl,
    body: {
      base_tree: baseTree,
      tree: list.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content }))
    }
  }));
  return { ...res, sha: res.ok ? res.body?.sha ?? null : null };
}

/* ── commit messages ────────────────────────────────────────────────────── */

/** "Outbox: 1,2,3" trailer ids found in a commit message. */
export function outboxTrailerIds(message) {
  const out = [];
  for (const m of String(message ?? "").matchAll(/^Outbox:\s*([0-9][0-9,\s]*)$/gm)) {
    for (const part of m[1].split(",")) {
      const n = Number(part.trim());
      if (Number.isSafeInteger(n) && n > 0) out.push(n);
    }
  }
  return out;
}

/**
 * The message for an app commit: starts "app:", carries the "Outbox: <ids>"
 * trailer, ends "[skip ci]" (without it, tests.yml would cancel main's running
 * tests on every save).
 * @param {Iterable<number|string>} ids
 * @param {string[]} [paths]
 */
export function commitMessage(ids, paths = []) {
  const list = [...new Set(paths)].sort();
  const subject = list.length === 1
    ? `app: save ${list[0]}`
    : `app: save ${list.length} files`;
  const shown = list.slice(0, 20).map((p) => `- ${p}`);
  if (list.length > 20) shown.push(`- and ${list.length - 20} more`);
  const lines = [subject, ""];
  if (list.length > 1) lines.push(...shown, "");
  lines.push(`Outbox: ${[...ids].map(Number).sort((a, b) => a - b).join(",")}`, "[skip ci]");
  return lines.join("\n");
}

/**
 * A commit authored "Fundhub app". The message must start "app:" and end
 * "[skip ci]"; anything else is refused without a request.
 * @param {GhOpts & {message?: string, tree?: string, parents?: string[]}} [args]
 * @returns {Promise<GhResult & {sha: string|null}>}
 */
export async function createCommit({ message, tree, parents, env, fetchImpl } = {}) {
  const msg = String(message ?? "");
  if (!msg.startsWith("app:") || !msg.endsWith("[skip ci]")) {
    return {
      ok: false, blocked: false, transmitted: false, status: 0, body: null, headers: {}, sha: null,
      error: 'an app commit message must start "app:" and end "[skip ci]"', fence: ADAPTERS
    };
  }
  const res = withReason(await call("POST", "/git/commits", {
    env, fetchImpl,
    body: { message: msg, tree, parents: Array.isArray(parents) ? parents : [], author: { ...APP_AUTHOR } }
  }));
  return { ...res, sha: res.ok ? res.body?.sha ?? null : null };
}

/**
 * Move the branch to `sha`. Never forced: a moved branch answers 422 (isBranchMoved).
 * @param {GhOpts & {sha?: string}} [args]
 * @returns {Promise<GhResult & {sha: string|null}>}
 */
export async function updateRef({ sha, env, fetchImpl } = {}) {
  const { branch } = repoConfig(env);
  const res = withReason(await call("PATCH", `/git/refs/heads/${encodePath(branch)}`, {
    env, fetchImpl, body: { sha, force: false }
  }));
  return { ...res, sha: res.ok ? res.body?.object?.sha ?? sha : null };
}

export default {
  PROVIDER, TRANSMITS, repoToken, repoConfig, getRef, getContents, listFolder, listCommits,
  createTree, createCommit, updateRef, commitMessage, outboxTrailerIds, isBranchMoved
};
