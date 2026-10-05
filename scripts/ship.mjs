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
//   2. skip when nothing but the ship log changed since the last ship — every
//      production deploy costs Netlify credits (the 2026-08-06 lesson).
//   3. lint and two guards.
//   4. database changes, then 5. one `netlify deploy --prod`.
//   6. /api/health must answer pending 0 for this build's list.
//   7. re-register the app with Inngest (PUT /api/inngest) — Inngest keeps the job
//      list it was last handed, so a job added in a ship never runs without this
//      (board N25, 2026-09-18). Then the ship is written to ops/ship-log.md and
//      committed. A failed run writes nothing, so the next run tries again.

import { loadEnv } from "./load-env.mjs";
import { reregisterInngest } from "./inngest-register.mjs";
loadEnv();
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(ROOT, "ops/ship-log.md");
const PROJECT_REF = "oqpnlusrotpxfenysfxz"; // CLAUDE.md §11
const SITE = "https://fundhub.ai";
const DRY = process.argv.includes("--dry");

const say = (s) => console.log(s);
function fail(msg) {
  console.error(`\n✗ SHIP STOPPED: ${msg}\n`);
  process.exit(1);
}
function run(cmd, args, { quiet = false, env } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: quiet ? "pipe" : "inherit", env: env || process.env });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}
const git = (...a) => run("git", a, { quiet: true }).out.trim();

// ── 1. main, clean ────────────────────────────────────────────────────────────
const branch = git("branch", "--show-current");
if (branch !== "main") fail(`on branch "${branch}". Ship from main.`);
if (git("status", "--porcelain")) fail("uncommitted changes. Commit them first, then ship.");
const head = git("rev-parse", "--short=8", "HEAD");

// ── 2. anything to ship? ──────────────────────────────────────────────────────
function lastShipped() {
  if (!fs.existsSync(LOG)) return null;
  const rows = fs.readFileSync(LOG, "utf8").split("\n").filter((l) => /^\| \d{4}-\d{2}-\d{2}/.test(l));
  const last = rows.at(-1);
  return last ? last.split("|")[2].trim() : null;
}
const prev = lastShipped();
if (prev && run("git", ["cat-file", "-e", `${prev}^{commit}`], { quiet: true }).ok) {
  const same = run("git", ["diff", "--quiet", prev, "HEAD", "--", ".", ":(exclude)ops/ship-log.md"], { quiet: true }).ok;
  if (same) {
    say(`Nothing to ship: main (${head}) matches the last ship (${prev}).`);
    process.exit(0);
  }
}
say(`Shipping main at ${head}${prev ? ` (last ship ${prev})` : ""}${DRY ? " — DRY RUN" : ""}.`);

// ── 3. checks ─────────────────────────────────────────────────────────────────
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

// ── 4. database changes ───────────────────────────────────────────────────────
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

// ── 5. deploy ─────────────────────────────────────────────────────────────────
say("\n→ deploy");
if (DRY) {
  say("  (dry run: would run netlify deploy --prod, then re-register with Inngest)");
  say("\nDry run finished. Nothing changed.");
  process.exit(0);
}
if (!run("netlify", ["deploy", "--prod", "--build", "--message", `ship ${head}`]).ok) {
  fail(`netlify deploy failed. ${applied} database change(s) were applied and stay applied; the next ship will skip them.`);
}

// ── 6. prove it and record it ─────────────────────────────────────────────────
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
run("git", ["add", "ops/ship-log.md"], { quiet: true });
run("git", ["commit", "-q", "-m", `ship: ${head} is live\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>`], { quiet: true });
say(`\n✔ Shipped ${head}. Logged in ops/ship-log.md.\n`);
