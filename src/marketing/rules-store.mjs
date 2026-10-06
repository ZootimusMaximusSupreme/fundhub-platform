// @ts-check
// Chris's copy rules as the Rules screen reads and changes them: GET and POST
// marketing/rules, and the "Make this a rule" box on POST marketing/scripts/fix.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.8 (rules row), §7.1 (Part 0
// and banned-live.json), §8.1 tab 5 (add or edit a rule, ban a phrase, see
// recent changes) and §6 Step 2 "Reads". Shapes: docs/specs/marketing-machine-api.md
// §6.3 (plan unit U26).
//
// READING. Part 0 is the section of marketing/ads/RULES.md under the heading
// "# PART 0 — CHRIS'S RULES", one "N. text" line per rule (readPart0 in
// src/repo/edit-ops.mjs parses it; the outbox applies edits with the same code).
// banned-live.json is a list of plain phrases. Both are read from GitHub at ONE
// commit (the branch head, pinned by getRef, then both files at that sha), so
// rules_sha names exactly what was read. When GitHub cannot be reached — no
// GITHUB_REPO_TOKEN, the dry-run fence, an error, or no answer inside the
// deadline — the copies bundled with the function are read instead
// (netlify.toml included_files), rules_sha is the deploy's commit (COMMIT_REF)
// or null, and source says 'bundle'. A bundle can be older than main: outbox
// commits carry [skip ci] and do not rebuild the site.
//
// CHANGING. A change is never written here. It is ONE outbox 'edit' row (mode
// edit, op part0_add_rule / part0_edit_rule / ban_phrase) queued inside the
// caller's transaction; the worker re-applies the op to the newest copy of the
// file when it commits, so a change made elsewhere is never overwritten.
// "recent" is read back from those outbox rows: waiting (not committed yet),
// committed (with the commit), or failed (the last try was refused; the reason
// is on the row and the outbox tries again next pass).

import fs from "node:fs";
import path from "node:path";
import { getRef as ghGetRef, getContents as ghGetContents, repoToken } from "../repo/github.mjs";
import { RULES_PATH, BANNED_PATH, readPart0, applyEdit, validateEdit } from "../repo/edit-ops.mjs";
import { candidateRoots } from "./flywheel-status.mjs";
import { InvalidError } from "./http.mjs";

/** The three changes POST marketing/rules takes, and the outbox op each one queues. */
export const RULE_ACTIONS = Object.freeze({ add: "part0_add_rule", edit: "part0_edit_rule", ban: "ban_phrase" });
const ACTION_OF_OP = Object.freeze(Object.fromEntries(Object.entries(RULE_ACTIONS).map(([a, op]) => [op, a])));

/** Longest rule and longest banned phrase (the same caps src/repo/edit-ops.mjs enforces). */
export const MAX_RULE_CHARS = 1000;
export const MAX_PHRASE_CHARS = 200;

/** How many recent rule changes GET answers with. */
export const RECENT_LIMIT = 20;

/** How long GET waits for GitHub before it reads the bundled copy instead. */
export const GITHUB_DEADLINE_MS = 8000;

/** The rules could not be read from GitHub or from the bundle. The route answers 503. */
export class RulesUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "RulesUnavailableError";
  }
}

const oneLine = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/* ── reading the files ───────────────────────────────────────────────────── */

/** A promise that gives up after ms with {timedOut:true}. Never rejects. */
function withDeadline(promise, ms) {
  /** @type {any} */
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
  return Promise.race([promise.catch((err) => ({ error: String(err?.message || err) })), late])
    .finally(() => clearTimeout(timer));
}

/**
 * The bundled copy of a repo file (the first of candidateRoots() that has it),
 * or null when no copy is found.
 * @param {string} rel
 * @param {string[]} [roots]
 */
export function readBundled(rel, roots = candidateRoots()) {
  for (const root of roots) {
    try {
      return fs.readFileSync(path.join(root, rel), "utf8");
    } catch { /* not here — try the next place */ }
  }
  return null;
}

/**
 * Read RULES.md and banned-live.json at one commit.
 *
 * @param {{env?: Record<string, any>, deadlineMs?: number,
 *          deps?: {getRef?: Function, getContents?: Function, fetchImpl?: Function,
 *                  readBundled?: (rel: string) => string|null}}} [opts]
 * @returns {Promise<{rules_sha: string|null, source: 'github'|'bundle', rules: string,
 *                    banned: string|null, github_error: string|null}>}
 *   banned is null when the file does not exist (no phrase banned yet).
 * @throws RulesUnavailableError when neither GitHub nor the bundle has RULES.md.
 */
export async function readRuleFiles({ env = process.env, deadlineMs = GITHUB_DEADLINE_MS, deps = {} } = {}) {
  const getRef = deps.getRef ?? ghGetRef;
  const getContents = deps.getContents ?? ghGetContents;
  const bundled = deps.readBundled ?? ((rel) => readBundled(rel));
  const fetchImpl = deps.fetchImpl;

  let githubError = null;
  if (repoToken(env)) {
    const fromGithub = (async () => {
      const ref = await getRef({ env, fetchImpl });
      if (!ref.ok || !ref.sha) return { error: ref.error || "GitHub did not say which commit main is on" };
      const [rules, banned] = await Promise.all([
        getContents(RULES_PATH, { ref: ref.sha, env, fetchImpl }),
        getContents(BANNED_PATH, { ref: ref.sha, env, fetchImpl })
      ]);
      if (!rules.ok || rules.missing || typeof rules.content !== "string") {
        return { error: rules.missing ? `${RULES_PATH} is not on main` : rules.error || `${RULES_PATH} could not be read` };
      }
      if (!banned.ok) return { error: banned.error || `${BANNED_PATH} could not be read` };
      return { sha: ref.sha, rules: rules.content, banned: banned.missing ? null : banned.content };
    })();
    const got = await withDeadline(fromGithub, deadlineMs);
    if (got && got.sha) {
      return { rules_sha: got.sha, source: "github", rules: got.rules, banned: got.banned, github_error: null };
    }
    githubError = got?.timedOut ? `GitHub did not answer within ${Math.round(deadlineMs / 1000)} seconds` : got?.error || "GitHub could not be read";
  } else {
    githubError = "GITHUB_REPO_TOKEN is not set (or is masked)";
  }

  const rules = bundled(RULES_PATH);
  if (typeof rules !== "string") {
    throw new RulesUnavailableError(
      `The rules file could not be read from GitHub (${githubError}) or from the copy built into the site.`
    );
  }
  const sha = String(env?.COMMIT_REF ?? "").trim();
  return {
    rules_sha: /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null,
    source: "bundle",
    rules,
    banned: bundled(BANNED_PATH),
    github_error: githubError
  };
}

/**
 * Part 0 as [{n, text}], in file order.
 * @throws RulesUnavailableError when RULES.md has no Part 0 heading.
 */
export function parsePart0(rulesText) {
  try {
    return readPart0(rulesText);
  } catch (err) {
    throw new RulesUnavailableError(`The rules file has no Part 0 to show (${String(err?.message || err)}).`);
  }
}

/**
 * banned-live.json as a list of phrases. A missing file is an empty list.
 * @throws RulesUnavailableError when the file is not a list of text.
 */
export function parseBanned(text) {
  if (text == null) return [];
  let list;
  try { list = JSON.parse(text); } catch {
    throw new RulesUnavailableError(`${BANNED_PATH} is not valid JSON.`);
  }
  if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) {
    throw new RulesUnavailableError(`${BANNED_PATH} is not a list of plain phrases.`);
  }
  return list;
}

/* ── the outbox rows behind "recent" ─────────────────────────────────────── */

/** @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} Db */

const RULE_OPS = Object.values(RULE_ACTIONS);

/** The company's latest rule changes, newest first, as GET marketing/rules shows them. */
export async function recentRuleEdits(db, orgId, { limit = RECENT_LIMIT } = {}) {
  const r = await db.query(
    `SELECT op_id, edit, committed_sha, error, created_at
       FROM repo_outbox
      WHERE org_id = $1
        AND mode = 'edit'
        AND path = ANY($2::text[])
        AND edit ->> 'op' = ANY($3::text[])
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [orgId, [RULES_PATH, BANNED_PATH], RULE_OPS, Math.max(1, Math.min(100, Math.floor(limit)))]
  );
  return r.rows.map(recentView);
}

/** One outbox row as a "recent" entry. */
export function recentView(row) {
  const edit = row.edit || {};
  return {
    op_id: row.op_id,
    action: ACTION_OF_OP[edit.op] ?? edit.op,
    text: edit.op === "ban_phrase" ? edit.phrase ?? null : edit.text ?? null,
    n: edit.op === "part0_edit_rule" ? Number(edit.number) : null,
    state: row.committed_sha ? "committed" : row.error ? "failed" : "waiting",
    committed_sha: row.committed_sha ?? null,
    at: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  };
}

/** The Part 0 edits still waiting in the outbox, oldest first (the order they will land). */
export async function waitingPart0Edits(db, orgId) {
  const r = await db.query(
    `SELECT edit FROM repo_outbox
      WHERE org_id = $1 AND mode = 'edit' AND path = $2 AND committed_sha IS NULL
        AND edit ->> 'op' = ANY($3::text[])
      ORDER BY id`,
    [orgId, RULES_PATH, [RULE_ACTIONS.add, RULE_ACTIONS.edit]]
  );
  return r.rows.map((x) => x.edit);
}

/**
 * The rule numbers Part 0 will have once the waiting edits land: the file's
 * numbers plus the rules added but not committed yet. An edit that would not
 * apply is skipped, the same way the outbox skips it.
 */
export function part0NumbersAfter(rulesText, waitingEdits = []) {
  let text = rulesText;
  for (const edit of waitingEdits) {
    try { text = applyEdit(text, edit); } catch { /* the outbox will refuse it too */ }
  }
  return new Set(readPart0(text).map((r) => r.n));
}

/* ── checking a change ───────────────────────────────────────────────────── */

/**
 * The action, n and text of a POST marketing/rules body, checked (no lookups).
 * @returns {{action: 'add'|'edit'|'ban', n: number|null, text: string}}
 * @throws InvalidError
 */
export function validateRuleInput(body) {
  const b = body || {};
  if (!Object.prototype.hasOwnProperty.call(RULE_ACTIONS, b.action)) {
    throw new InvalidError("action", "action must be add (a new rule), edit (change a rule) or ban (ban a phrase).");
  }
  const action = /** @type {'add'|'edit'|'ban'} */ (b.action);
  if (typeof b.text !== "string" || !oneLine(b.text)) {
    throw new InvalidError("text", action === "ban" ? "Type the phrase to ban first." : "Type the rule first.");
  }
  const text = oneLine(b.text);
  const max = action === "ban" ? MAX_PHRASE_CHARS : MAX_RULE_CHARS;
  if (text.length > max) {
    throw new InvalidError("text", action === "ban"
      ? `A banned phrase can be at most ${max} characters.`
      : `A rule can be at most ${max} characters. Split it into two rules.`);
  }
  let n = null;
  if (action === "edit") {
    if (typeof b.n !== "number" || !Number.isInteger(b.n) || b.n < 0) {
      throw new InvalidError("n", "Say which rule to change: its number in Part 0.");
    }
    n = b.n;
  }
  return { action, n, text };
}

/**
 * The outbox edit for one change, checked by the same code the outbox runs.
 * @param {'add'|'edit'|'ban'} action
 * @param {{n?: number|null, text: string}} change
 */
export function ruleEdit(action, { n = null, text }) {
  const op = RULE_ACTIONS[action];
  const edit = action === "ban" ? { op, phrase: text }
    : action === "edit" ? { op, number: n, text }
      : { op, text };
  return validateEdit(edit, action === "ban" ? BANNED_PATH : RULES_PATH);
}

/** Where each action's edit goes. */
export function rulePath(action) {
  return action === "ban" ? BANNED_PATH : RULES_PATH;
}
