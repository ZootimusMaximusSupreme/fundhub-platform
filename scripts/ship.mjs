#!/usr/bin/env node
// scripts/ship.mjs — database changes + the Netlify production deploy, one command.
//
//   npm run ship            # does it
//   npm run ship -- --dry   # says what it would do, changes nothing
//
// WHY THIS EXISTS. Netlify does not run our full build on push (laptop ship path),
// so nothing applies DB migrations from Netlify's build alone — every deploy is a laptop build. A laptop build never receives
// Netlify's hidden MIGRATION_DATABASE_URL, so its migrate step falls back to the
// restricted app role and dies on the first new table ("permission denied for
// schema public", 2026-09-06 and twice on 2026-09-16). This script applies the
// pending database changes FIRST, with an owner-level connection, so the build's own
// migrate step finds nothing left to do and the deploy goes through.
//
// HOW THE DATABASE CHANGES GO IN. Through the Supabase Management API with
// SUPABASE_ACCESS_TOKEN — the same key .mcp.json already sends for the Supabase MCP,
// so nothing new is stored anywhere. Each file runs as ONE request holding the file
// plus its schema_migrations row, which Postgres executes as a single transaction
// (a multi-statement simple query is one implicit transaction). The script proves
// that on the live connection before it applies anything. If MIGRATION_DATABASE_URL
// is set instead, it uses db/migrate.mjs unchanged.
//
// ORDER, and why:
//   1. main only, clean tree — an uncommitted file would ship without a record.
//   2. pull GitHub's main (spec M0 step 8, "ship stays in step with GitHub"). Once the
//      repo outbox is live, every save in the Command Center is a commit on GitHub, so
//      GitHub's main moves between ships while this Mac's main carries ship-log commits
//      and local merges. So: `git pull --ff-only` first; if that cannot fast-forward,
//      `git pull --rebase=merges --autostash` (local merges keep their shape); if that
//      clashes, `git rebase --abort`, one plain line naming the file, and the ship goes
//      on with this Mac's main exactly as before. A pull NEVER stops the ship
//      (CLAUDE.md §11: no guard ever blocks npm run ship). No prompts, and a time limit,
//      so it never hangs. The one stop: if the pull could not be undone and the folder
//      is left half way through a pull, deploying it would ship a broken tree.
//   3. skip when nothing but the ship log and the machine-only folders
//      (scripts/ship-machine-paths.mjs) changed since the last ship — every production
//      deploy costs Netlify credits (the 2026-08-06 lesson). Rule, voice and registry
//      files still ship.
//   4. lint and two guards.
//   5. database changes, then 6. one `netlify deploy --prod`.
//   7. /api/health must answer pending 0 for this build's list.
//   8. re-register the app with Inngest (PUT /api/inngest) — Inngest keeps the job
//      list it was last handed, so a job added in a ship never runs without this
//      (board N25, 2026-09-18). Then the ship is written to ops/ship-log.md and
//      committed. A failed run writes nothing, so the next run tries again.
//   9. push to GitHub with scripts/github-push-whole-repo.mjs (main, every local
//      branch, every tag) — but only when GitHub's main is already inside this Mac's
//      main. That script leases main on the copy it fetches a moment before, so on its
//      own it would overwrite commits GitHub has and this Mac lacks. A push that is
//      skipped or fails is one line; the site is already live and nothing is undone.

import { loadEnv } from "./load-env.mjs";
import { reregisterInngest } from "./inngest-register.mjs";
import { skipDiffPathspecs } from "./ship-machine-paths.mjs";
loadEnv();
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHIP_LOG = "ops/ship-log.md";
const LOG = path.join(ROOT, SHIP_LOG);
const PROJECT_REF = "oqpnlusrotpxfenysfxz"; // CLAUDE.md §11
const SITE = "https://fundhub.ai";
const DRY = process.argv.includes("--dry");

/** One pull or one fetch may take this long before it is stopped. */
export const PULL_TIMEOUT_MS = 90_000;
/** The whole-repo push (main, every branch, every tag) may take this long. */
export const PUSH_TIMEOUT_MS = 10 * 60_000;
/** Git must never wait for a person: no password prompt, no editor. */
export const GIT_NO_PROMPT = Object.freeze({ GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_EDITOR: "true" });

const say = (s) => console.log(s);
function fail(msg) {
  console.error(`\n✗ SHIP STOPPED: ${msg}\n`);
  process.exit(1);
}
function run(cmd, args, { quiet = false, env, timeout } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: quiet ? "pipe" : "inherit", env: env || process.env, timeout, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, status: r.status, out: (r.stdout || "") + (r.stderr || ""), timedOut: r.error?.code === "ETIMEDOUT" };
}
const git = (...a) => run("git", a, { quiet: true }).out.trim();
const gitRun = (args, opts = {}) => run("git", args, { quiet: true, ...opts });

// ── helpers (exported for scripts/ship.test.mjs; nothing here runs on import) ──

/** Hide any GitHub token that could ride along in git's or the push script's output. */
export function redact(text, env = process.env) {
  let s = String(text ?? "");
  const t = String(env?.GITHUB_TOKEN ?? "").trim();
  if (t.length >= 8) s = s.split(t).join("[token]");
  return s
    .replace(/\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]+/g, "[token]")
    .replace(/x-access-token:[^@\s]+@/g, "x-access-token:[token]@");
}

/** The one line worth showing from a failed git or push run. */
export function reasonLine(text, env = process.env) {
  const lines = redact(text, env).split("\n").map((l) => l.trim()).filter(Boolean);
  const pick = lines.find((l) => /^(fatal|error):|\[(remote )?rejected\]/i.test(l)) || lines.at(-1) || "no message";
  return pick.length > 200 ? `${pick.slice(0, 197)}...` : pick;
}

function safeCall(gitFn, args, opts = {}) {
  try {
    const r = gitFn(args, opts) || {};
    return { ok: !!r.ok, status: r.status ?? (r.ok ? 0 : 1), out: String(r.out ?? ""), timedOut: !!r.timedOut };
  } catch (e) {
    return { ok: false, status: null, out: String(e?.message || e), timedOut: false };
  }
}

/**
 * Step 2: bring GitHub's main into this Mac's main. Never throws.
 * `git(args, { timeout, env })` runs git in the repo and answers { ok, out, timedOut }.
 * Answers { ok, how, restored, line }: ok = GitHub's main is now inside this Mac's main;
 * restored = after a failed pull the folder is back on main, at the same commit, clean.
 * Only restored === false stops the ship.
 */
export function pullMain({ git, env = process.env, timeout = PULL_TIMEOUT_MS }) {
  const net = { timeout, env: { ...env, ...GIT_NO_PROMPT } };
  const before = safeCall(git, ["rev-parse", "HEAD"]).out.trim();
  const isRestored = () =>
    !!before &&
    safeCall(git, ["branch", "--show-current"]).out.trim() === "main" &&
    safeCall(git, ["rev-parse", "HEAD"]).out.trim() === before &&
    safeCall(git, ["status", "--porcelain"]).out.trim() === "";
  const asIs = "Shipping this Mac's main as it is.";
  const notUndone = "The pull could not be undone, so this folder is half way through a pull (git rebase --abort did not finish). Nothing was deployed.";

  const ff = safeCall(git, ["pull", "--ff-only", "origin", "main"], net);
  if (ff.ok) return { ok: true, how: "ff-only", restored: true, line: "Pulled GitHub's main (fast-forward, or already up to date)." };

  if (ff.timedOut) {
    // The network is the slow part; a second try would only wait again.
    if (!isRestored()) return { ok: false, how: "timeout", restored: false, line: notUndone };
    return { ok: false, how: "timeout", restored: true, line: `GitHub did not answer within ${Math.round(timeout / 1000)} seconds, so nothing was pulled. ${asIs}` };
  }

  const rb = safeCall(git, ["pull", "--rebase=merges", "--autostash", "origin", "main"], net);
  if (rb.ok) return { ok: true, how: "rebase", restored: true, line: "Pulled GitHub's newer main and put this Mac's own commits on top of it." };

  const clash = safeCall(git, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").map((s) => s.trim()).filter(Boolean);
  safeCall(git, ["rebase", "--abort"]);
  if (!isRestored()) return { ok: false, how: clash.length ? "conflict" : "failed", restored: false, clash, line: notUndone };
  if (clash.length) {
    const more = clash.length > 1 ? ` (and ${clash.length - 1} more)` : "";
    return { ok: false, how: "conflict", restored: true, clash, line: `GitHub's main and this Mac both changed ${clash[0]}${more}, so nothing was pulled. ${asIs}` };
  }
  const why = rb.timedOut ? `no answer within ${Math.round(timeout / 1000)} seconds` : reasonLine(rb.out || ff.out, env);
  return { ok: false, how: "failed", restored: true, clash, line: `Could not pull from GitHub (${why}), so nothing was pulled. ${asIs}` };
}

/** Pathspecs for the "anything to ship?" diff: everything but the ship log and the machine-only folders. */
export function shipDiffPathspecs() {
  return [".", `:(exclude)${SHIP_LOG}`, ...skipDiffPathspecs()];
}

/**
 * Step 3: did anything that ships change between the last ship and now?
 * git diff --quiet answers 0 for no difference; a difference (1) or an error ships,
 * as before.
 */
export function hasShippableChange(prev, head, { git }) {
  const r = safeCall(git, ["diff", "--quiet", "--no-renames", prev, head, "--", ...shipDiffPathspecs()]);
  return !r.ok;
}

/**
 * Step 9: push to GitHub through scripts/github-push-whole-repo.mjs. Never throws and
 * never stops the ship: the deploy is live and logged before this runs.
 * It pushes only when GitHub's main (fetched just now) is already inside this Mac's
 * main, because the push script leases main on the copy it fetches itself and would
 * otherwise overwrite GitHub's newer commits.
 */
export function pushToGitHub({ git, runCmd, env = process.env, timeout = PUSH_TIMEOUT_MS, fetchTimeout = PULL_TIMEOUT_MS }) {
  const live = "The site is live and the ship is logged;";
  const net = { timeout: fetchTimeout, env: { ...env, ...GIT_NO_PROMPT } };
  const f = safeCall(git, ["fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"], net);
  if (!f.ok) {
    const why = f.timedOut ? `no answer within ${Math.round(fetchTimeout / 1000)} seconds` : reasonLine(f.out, env);
    return { ok: false, pushed: false, line: `Did not push to GitHub: could not read GitHub's main (${why}). ${live} the next ship pushes.` };
  }
  const inside = safeCall(git, ["merge-base", "--is-ancestor", "refs/remotes/origin/main", "refs/heads/main"]);
  if (!inside.ok) {
    const line = inside.status === 1
      ? `Did not push to GitHub: GitHub's main has commits this Mac does not have, and the push would overwrite them. ${live} the next ship pulls them first.`
      : `Did not push to GitHub: could not compare GitHub's main with this Mac's main (${reasonLine(inside.out, env)}). ${live} the next ship pushes.`;
    return { ok: false, pushed: false, line };
  }
  let r;
  try {
    r = runCmd("node", ["scripts/github-push-whole-repo.mjs"], { quiet: true, timeout, env: { ...env, ...GIT_NO_PROMPT } }) || {};
  } catch (e) {
    r = { ok: false, out: String(e?.message || e) };
  }
  if (r.ok) return { ok: true, pushed: true, line: "Pushed to GitHub: main, every local branch and every tag." };
  const why = r.timedOut ? `no answer within ${Math.round(timeout / 60_000)} minutes` : reasonLine(r.out, env);
  return { ok: false, pushed: false, line: `The push to GitHub failed (${why}). ${live} the next ship pushes again.` };
}

/** True when this file is the one node was asked to run (not imported by a test). */
export function isDirectRun(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (!argv1) return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return fs.realpathSync(path.resolve(argv1)) === fs.realpathSync(self);
  } catch {
    return path.resolve(argv1) === self;
  }
}

async function main() {
  // ── 1. main, clean ──────────────────────────────────────────────────────────
  const branch = git("branch", "--show-current");
  if (branch !== "main") fail(`on branch "${branch}". Ship from main.`);
  if (git("status", "--porcelain")) fail("uncommitted changes. Commit them first, then ship.");

  // ── 2. in step with GitHub ──────────────────────────────────────────────────
  say("→ pulling GitHub's main");
  if (DRY) {
    say("  (dry run: would pull GitHub's main here; nothing pulled)");
  } else {
    const pull = pullMain({ git: gitRun });
    if (pull.restored === false) fail(pull.line);
    say(`  ${pull.line}`);
  }
  const head = git("rev-parse", "--short=8", "HEAD");

  // ── 3. anything to ship? ────────────────────────────────────────────────────
  function lastShipped() {
    if (!fs.existsSync(LOG)) return null;
    const rows = fs.readFileSync(LOG, "utf8").split("\n").filter((l) => /^\| \d{4}-\d{2}-\d{2}/.test(l));
    const last = rows.at(-1);
    return last ? last.split("|")[2].trim() : null;
  }
  const prev = lastShipped();
  if (prev && run("git", ["cat-file", "-e", `${prev}^{commit}`], { quiet: true }).ok) {
    if (!hasShippableChange(prev, "HEAD", { git: gitRun })) {
      say(`Nothing to ship: main (${head}) matches the last ship (${prev}). The ship log and the machine-only folders do not count.`);
      process.exit(0);
    }
  }
  say(`Shipping main at ${head}${prev ? ` (last ship ${prev})` : ""}${DRY ? " — DRY RUN" : ""}.`);

  // ── 4. checks ───────────────────────────────────────────────────────────────
  say("\n→ checks");
  if (!run("node", ["scripts/lint.mjs"]).ok) fail("lint failed.");
  if (!run("node", ["--test", "src/security/migrations-production-only.test.mjs", "src/http/routes.test.mjs"], { quiet: true }).ok) {
    fail("a guard test failed: run node --test src/security/migrations-production-only.test.mjs src/http/routes.test.mjs");
  }
  const { EXPECTED_MIGRATIONS } = await import(pathToFileURL(path.join(ROOT, "db/expected-migrations.mjs")).href);
  const onDisk = [];
  for (const d of ["schema", "migrations", "seed"]) {
    const dir = path.join(ROOT, "db", d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) onDisk.push(`${d}/${f}`);
  }
  const unlisted = onDisk.filter((k) => !EXPECTED_MIGRATIONS.includes(k));
  if (unlisted.length) fail(`db files missing from db/expected-migrations.mjs (run npm run migrations:manifest): ${unlisted.join(", ")}`);
  say("  lint and guards pass");

  // ── 5. database changes ─────────────────────────────────────────────────────
  // The key is set for Claude's shell by .claude/settings.local.json (gitignored), not for
  // Chris's own terminal — so read it from the same file when the shell does not have it.
  function supabaseToken() {
    if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
    try {
      const local = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude/settings.local.json"), "utf8"));
      return String(local?.env?.SUPABASE_ACCESS_TOKEN || "");
    } catch {
      return "";
    }
  }
  const TOKEN = supabaseToken();
  async function sql(query) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) throw new Error(`Supabase answered ${res.status}: ${typeof body === "string" ? body.slice(0, 400) : body.message || JSON.stringify(body).slice(0, 400)}`);
    return body;
  }

  say("\n→ database");
  let applied = 0;
  if (process.env.MIGRATION_DATABASE_URL && !process.env.MIGRATION_DATABASE_URL.includes("*")) {
    say("  owner connection found in the environment — using db/migrate.mjs");
    if (DRY) say("  (dry run: not running it)");
    else if (!run("node", ["db/migrate.mjs"]).ok) fail("db/migrate.mjs failed. Nothing was deployed.");
  } else {
    if (!TOKEN) fail("no SUPABASE_ACCESS_TOKEN and no MIGRATION_DATABASE_URL, so the database changes cannot be applied.");
    const done = new Set((await sql("SELECT key FROM schema_migrations")).map((r) => r.key));
    const pending = onDisk.filter((k) => !done.has(k));
    say(`  ${pending.length} pending${pending.length ? ": " + pending.join(", ") : ""}`);
    if (pending.length && !DRY) {
      // Prove a multi-statement request is one transaction before trusting it with DDL.
      const probe = await sql("SELECT set_config('fundhub.ship_probe', 'same', true); SELECT current_setting('fundhub.ship_probe', true) AS v;");
      if (!Array.isArray(probe) || probe.at(-1)?.v !== "same") {
        fail("the Supabase connection did not run two statements as one transaction, so nothing was applied.");
      }
      for (const key of pending) {
        const body = fs.readFileSync(path.join(ROOT, "db", key), "utf8");
        const quotedKey = key.replace(/'/g, "''");
        try {
          await sql(`${body}\n;\nINSERT INTO schema_migrations (key) VALUES ('${quotedKey}');`);
        } catch (e) {
          fail(`${key} failed and was rolled back: ${e.message}`);
        }
        const check = await sql(`SELECT 1 AS ok FROM schema_migrations WHERE key = '${quotedKey}'`);
        if (!check.length) fail(`${key} ran but is not recorded. Nothing was deployed.`);
        say(`  ✔ ${key}`);
        applied += 1;
      }
    }
  }

  // ── 6. deploy ───────────────────────────────────────────────────────────────
  say("\n→ deploy");
  if (DRY) {
    say("  (dry run: would run netlify deploy --prod, re-register with Inngest, log the ship, then push to GitHub)");
    say("\nDry run finished. Nothing changed.");
    process.exit(0);
  }
  if (!run("netlify", ["deploy", "--prod", "--build", "--message", `ship ${head}`]).ok) {
    fail(`netlify deploy failed. ${applied} database change(s) were applied and stay applied; the next ship will skip them.`);
  }

  // ── 7–8. prove it and record it ─────────────────────────────────────────────
  say("\n→ checking the live site");
  let health = null;
  for (let i = 0; i < 12; i++) {
    try {
      const r = await fetch(`${SITE}/api/health`, { headers: { "cache-control": "no-cache" } });
      health = await r.json();
      if (health.ok && health.pending === 0 && health.expected === EXPECTED_MIGRATIONS.length) break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!health || health.pending !== 0 || health.expected !== EXPECTED_MIGRATIONS.length) {
    fail(`deployed, but /api/health does not show this build yet: ${JSON.stringify(health)}`);
  }
  say(`  live: ${health.migrations} database changes applied, ${health.pending} pending`);

  say("\n→ re-registering with Inngest (the timed and event jobs)");
  try {
    const { modified } = await reregisterInngest({ site: SITE });
    say(`  ${SITE}/api/inngest: Successfully registered (modified: ${modified})`);
  } catch (e) {
    fail(`deployed and live, but Inngest was NOT re-registered, so new or changed jobs will not run: ${e.message}. Nothing was logged, so the next npm run ship deploys and tries again. To retry without a deploy: node scripts/inngest-register.mjs`);
  }

  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "America/Phoenix" }).slice(0, 16);
  if (!fs.existsSync(LOG)) {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.writeFileSync(LOG, [
      "# Ship log",
      "",
      "One line per production ship, written by `npm run ship` (scripts/ship.mjs) only after",
      "fundhub.ai/api/health answered pending 0 for the shipped build. Arizona time.",
      "",
      "| When | Commit | Database changes applied | Live check |",
      "|---|---|---|---|",
      ""
    ].join("\n"));
  }
  fs.appendFileSync(LOG, `| ${stamp} | ${head} | ${applied} | ${health.migrations} applied, ${health.pending} pending |\n`);
  run("git", ["add", SHIP_LOG], { quiet: true });
  run("git", ["commit", "-q", "-m", `ship: ${head} is live\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>`], { quiet: true });
  say(`\n✔ Shipped ${head}. Logged in ops/ship-log.md.`);

  // ── 9. push to GitHub (never undoes the deploy) ─────────────────────────────
  say("\n→ pushing to GitHub");
  const pushed = pushToGitHub({ git: gitRun, runCmd: run });
  say(`  ${pushed.line}\n`);
}

if (isDirectRun()) await main();
