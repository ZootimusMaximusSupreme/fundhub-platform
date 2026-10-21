#!/usr/bin/env node
// Prove the morning pulse the way it really runs: from a built Netlify bundle,
// against the live database, read-only.
//
//   npm run pulse:prove                 build the api bundle, run every coverage step from inside it
//   npm run pulse:prove -- --repo       skip the build, run from this checkout (faster, less true)
//   npm run pulse:prove -- --lanes=gap-sms,gap-email
//   npm run pulse:prove -- --beats      the HOURLY pulse: build every hourly shift (netlify/functions/pulse-hourly.mjs,
//                                       pulse-hourly-b.mjs, pulse-hourly-c.mjs) the way Netlify does, unzip them, and
//                                       run each shift's beats from inside the bundle, one shift after the other, each
//                                       in its own budget
//                                       (see proveBeats() at the bottom)
//   npm run pulse:prove -- --beats --read-delay=120  add 120 ms before every database round trip
//   npm run pulse:prove -- --beats --slow-apply-links=10500 --read-delay=120
//                                                      hold one worker for 10.5 s while the rest of its shift still runs
//   npm run pulse:prove -- --beats --fixture       also run one built-in fixture beat (green) through the runner
//   npm run pulse:prove -- --beats --fixture=red   the same fixture, forced red: proves the text path with a fake sink
//
// WHY. Green unit tests have lied about the pulse three ways (2026-10-08):
//   1. A folder scan found no check files in the shipped bundle, so 0 rows ran, with no error.
//   2. All coverage in one Inngest step took ~61 s; Netlify cuts each step at 26 s.
//   3. Checks that read repo files at run time passed on a laptop and went red on the server.
// This script catches all three, because it runs the bundle the server runs.
//
// SAFE. One proof connection plus the runner's three beat connections use DATABASE_URL's role (the app role the
// pulse uses), each inside BEGIN READ ONLY with every query in its own SAVEPOINT; all ROLLBACK. Any write is refused and
// counted. Any BEGIN/COMMIT/SET sent to ctx.db is refused and counted (ctx.db is a shared pool in
// production). fetch allows GET and HEAD only, so no model call can be billed. Any module that opens its own pool gets a dead
// address. No text, no email, no AI call, no Plaid, no credit pull.
//
// A red row that names a masked key (a row of asterisks) is this laptop's .env, not production.
// Netlify keeps secret keys hidden; the live pulse reads the real value.
//
// Exit 1 when: the bundle is missing a listed coverage file, a step throws, a query errors, a write
// or transaction control is tried, a POST is tried, or a step takes more than 20 s.

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DB_SETTINGS_SQL } from "../../src/pulse/beats/readbox.mjs";
import { isPartialLaneOnlyNotChecked, isRunnerOnlyNotChecked, unknownRequestedLanes } from "./prove-policy.mjs";
import { formatProofFetchTrace, makeProofFetchTrace, proofFetch } from "./prove-fetch-trace.mjs";
import { hedgedSiteFetch } from "./site-hedge.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STEP_LIMIT_MS = 20000;
const MAX_PRINTED_FINDINGS = 80;
const args = process.argv.slice(2);
const FROM_REPO = args.includes("--repo");
const LANES = (args.find((a) => a.startsWith("--lanes=")) || "").slice(8).split(",").filter(Boolean);
const clip = (s, n = 200) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
// The live site host. A request to it that stays silent gets one more connection (scripts/pulse/site-hedge.mjs).
const SITE_HOST = new URL(process.env.URL || "https://fundhub.ai").host;
const hedgeLine = (rows) => `  site requests that needed a second connection: ${rows.length}${rows.length ? ` (${rows.map((r) => `${r.method} ${r.path} -> ${r.winner ? `answer ${r.winner}` : "no answer"} ${r.ms} ms`).join("; ")})` : ""}`;

/* The hourly pulse proof is a separate flow. It runs here, before the morning-pulse flow below, and exits. Everything
   it needs is a function declaration (hoisted) or a const above this line; it must not touch the consts below. */
if (args.includes("--beats")) {
  await proveBeats();
  process.exit(0);
}

const { GAP_LANES: REQUESTABLE_GAP_LANES } = await import(pathToFileURL(path.join(REPO, "src/pulse/coverage/run-slices.mjs")).href);
const unknownLanes = unknownRequestedLanes(LANES, REQUESTABLE_GAP_LANES);
if (unknownLanes.length) fail(`unknown requested lane${unknownLanes.length === 1 ? "" : "s"}: ${unknownLanes.join(", ")}`);

loadDotEnv(path.join(REPO, ".env"));
const REAL_DATABASE_URL = process.env.DATABASE_URL;
if (!REAL_DATABASE_URL) fail("DATABASE_URL is not set (.env).");
process.env.DATABASE_URL = "postgres://escape-blocked.invalid:5432/blocked";
process.env.MIGRATION_DATABASE_URL = "postgres://escape-blocked.invalid:5432/blocked";
const pg = createRequire(path.join(REPO, "package.json"))("pg");
const siteHedges = [];
const realFetch = hedgedSiteFetch(globalThis.fetch, { siteHost: SITE_HOST, log: siteHedges });

const root = FROM_REPO ? REPO : buildBundle();
const listed = (await import(pathToFileURL(path.join(REPO, "src/pulse/coverage/modules.mjs")).href));
const want = [...listed.SLICE_FILES, ...listed.GAP_FILES].map(([name]) => name);
const missingFiles = want.filter((name) => !fs.existsSync(path.join(root, "src/pulse/coverage", name)));

const log = { queries: [], fetches: [], refused: [] };
const webTrace = makeProofFetchTrace();
globalThis.fetch = guardedFetch();
const plainC = await openClient(false);
const staffC = await openClient(true);
const plain = wrapDb(plainC, "plain");
const staff = wrapDb(staffC, "staff");

const { runCoverageSteps } = await import(pathToFileURL(path.join(root, "src/workflows/daily-pulse.mjs")).href);
const { GAP_LANES } = await import(pathToFileURL(path.join(root, "src/pulse/coverage/run-slices.mjs")).href);
const lanes = LANES.length ? GAP_LANES.filter((l) => LANES.includes(l)) : GAP_LANES;

const run = async (db) => {
  const steps = [];
  const step = {
    async run(name, fn) {
      const t0 = Date.now();
      try {
        const out = await fn();
        steps.push({ name, ms: Date.now() - t0, rows: Array.isArray(out) ? out : [] });
        return out;
      } catch (err) {
        steps.push({ name, ms: Date.now() - t0, threw: clip(err && err.message) });
        throw err;
      }
    }
  };
  const rows = await runCoverageSteps({ step, db, env: process.env, fetchImpl: globalThis.fetch, staffScope: (fn) => fn(staff), lanes });
  return { steps, rows };
};

const prod = await run(plain);
const blind = await run(staff);

/* THE WHOLE MORNING, FROM THE BUNDLE. Fold, audit and scorecard, on the rows the coverage steps just made. Nothing is
   saved (persist:false), nothing is sent, the board file goes to a temp folder. The question it answers: after the
   fold and the audit, which rows are still "not checked", and did the audit itself run? */
let full = null;
let fullErr = null;
let fullMs = 0;
const fullEnv = { ...process.env };
for (const k of Object.keys(fullEnv)) if (/^(GMAIL|GOOGLE_)/.test(k)) delete fullEnv[k];
try {
  const { runDailyPulse } = await import(pathToFileURL(path.join(root, "src/pulse/daily-pulse.mjs")).href);
  const wf = await import(pathToFileURL(path.join(root, "src/workflows/index.mjs")).href);
  const t0 = Date.now();
  full = await runDailyPulse({
    dryRun: true, sendPulseText: false, recordRun: false, persist: false,
    db: plain, staffScope: (fn) => fn(staff), env: fullEnv, fetchImpl: globalThis.fetch,
    boardDir: fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-prove-board-")),
    gateRelayDirs: null, coverageRows: prod.rows, functions: wf.functions
  });
  fullMs = Date.now() - t0;
} catch (err) { fullErr = err; }
for (const c of [plainC, staffC]) { try { await c.query("ROLLBACK"); } catch { /* closing */ } try { await c.end(); } catch { /* closing */ } }

const byId = new Map(blind.rows.map((r) => [r.id, r.status]));
const blindRows = prod.rows.filter((r) => byId.has(r.id) && byId.get(r.id) !== r.status);
const threw = prod.steps.filter((s) => s.threw);
const slow = prod.steps.filter((s) => s.ms > STEP_LIMIT_MS);
const laneSkips = prod.rows.filter((r) => r.checkId === "step" || r.checkId === "threw" || r.checkId === "not-listed");
const sqlErrors = log.queries.filter((q) => q.error && !q.refused);
const count = (s) => prod.rows.filter((r) => r.status === s).length;

console.log(`\nPulse proof — ${FROM_REPO ? "from this checkout" : `from a built bundle (${root})`}`);
console.log(`steps ${prod.steps.length}, rows ${prod.rows.length}: PASS ${count("PASS")}, FAIL ${count("FAIL")}, skip ${count("skip")}, not checked ${count("not checked")}`);
const slowest = [...prod.steps].sort((a, b) => b.ms - a.ms).slice(0, 5);
console.log(`slowest: ${slowest.map((s) => `${s.name} ${(s.ms / 1000).toFixed(1)}s`).join(", ")}`);
const redRows = prod.rows.filter((x) => x.status === "FAIL");
for (const r of redRows.slice(0, MAX_PRINTED_FINDINGS)) console.log(`  RED  ${r.id}: ${clip(r.detail, 160)}`);
if (redRows.length > MAX_PRINTED_FINDINGS) console.log(`  ... and ${redRows.length - MAX_PRINTED_FINDINGS} more red findings`);
const EXPECTED_OPEN_UNTIL_RECEIPTS = /^wf:/;
let finalCounts = null;
let laptopOnly = [];
let waitingOnReceipts = [];
let partialLaneOnly = [];
let notChecked = [];
const auditRows = [];
if (full) {
  const { toContractCheck } = await import(pathToFileURL(path.join(root, "src/pulse/scorecard.mjs")).href);
  const final = full.checks.map((c) => ({ raw: c, row: toContractCheck(c) }));
  finalCounts = { total: final.length, green: 0, red: 0, na: 0, not_checked: 0 };
  for (const f of final) finalCounts[f.row.status] = (finalCounts[f.row.status] || 0) + 1;
  const notCheckedAll = final.filter((f) => f.row.status === "not_checked").map((f) => ({ id: f.row.id, why: clip(f.row.reason || f.raw.detail, 130) }));
  /* This laptop is not the live server: its copies of the secret keys are masks, it has no Gmail login, and it is not on
     Netlify. Those rows are green on the live server (this morning's stored card says so). They are printed apart and
     are never counted green. */
  const runnerOnly = (row) => isRunnerOnlyNotChecked(row, { ci: process.env.CI === "true" });
  laptopOnly = notCheckedAll.filter(runnerOnly);
  partialLaneOnly = notCheckedAll.filter((n) => !runnerOnly(n) && isPartialLaneOnlyNotChecked(n, { partial: LANES.length > 0 }));
  /* Until the run receipts ship, a workflow that was handed an event cannot show it ran. Closed list, printed by name. */
  waitingOnReceipts = notCheckedAll.filter((n) => !runnerOnly(n) && !partialLaneOnly.includes(n) && EXPECTED_OPEN_UNTIL_RECEIPTS.test(n.id));
  notChecked = notCheckedAll.filter((n) => !runnerOnly(n) && !partialLaneOnly.includes(n) && !EXPECTED_OPEN_UNTIL_RECEIPTS.test(n.id)).map((n) => `${n.id}: ${n.why}`);
  for (const f of final) if (String(f.row.id).startsWith("audit:")) auditRows.push(`${f.row.status.padEnd(11)} ${f.row.id}: ${clip(f.row.proof || f.row.reason || f.raw.detail, 150)}`);
}
if (full) {
  console.log(`\nThe whole morning, from the bundle (nothing saved, nothing sent): ${(fullMs / 1000).toFixed(1)} s`);
  console.log(`final rows ${finalCounts.total}: green ${finalCounts.green}, red ${finalCounts.red}, nothing to judge ${finalCounts.na}, NOT CHECKED ${finalCounts.not_checked}; claims folded into a real check: ${full.folded}`);
  for (const a of auditRows) console.log(`  ${a}`);
  console.log(`  laptop only (green on the live server this morning, never counted green here): ${laptopOnly.length}${laptopOnly.length ? ` (${laptopOnly.map((n) => n.id).join(", ")})` : ""}`);
  console.log(`  outside this targeted lane run: ${partialLaneOnly.length}${partialLaneOnly.length ? ` (${partialLaneOnly.map((n) => n.id).join(", ")})` : ""}`);
  console.log(`  waiting on run receipts (handed an event, nothing records that it ran): ${waitingOnReceipts.length}${waitingOnReceipts.length ? ` (${waitingOnReceipts.map((n) => n.id).join(", ")})` : ""}`);
  for (const n of notChecked.slice(0, 80)) console.log(`  NOT CHECKED  ${n}`);
  if (notChecked.length > 80) console.log(`  ... and ${notChecked.length - 80} more`);
}
const problems = [
  ...(fullErr ? [`the whole-morning run threw: ${clip(fullErr && fullErr.stack ? fullErr.stack.split("\n").slice(0, 3).join(" | ") : fullErr, 300)}`] : []),
  ...(full && full.checks.some((c) => c.id === "audit:crashed") ? ["the self-audit crashed (audit:crashed is in the run)"] : []),
  ...(full && finalCounts.green + finalCounts.red + finalCounts.na + finalCounts.not_checked !== finalCounts.total ? ["the final counts do not add up"] : []),
  ...(full && fullMs > 20000 ? [`the whole-morning run took ${(fullMs / 1000).toFixed(1)} s (limit 20 s; Netlify cuts at 26 s)`] : []),
  ...missingFiles.map((f) => `bundle is missing ${f}`),
  ...threw.map((s) => `${s.name} threw: ${s.threw}`),
  ...laneSkips.map((r) => `${r.id}: ${clip(r.detail, 160)}`),
  ...slow.map((s) => `${s.name} took ${(s.ms / 1000).toFixed(1)} s (limit ${STEP_LIMIT_MS / 1000} s; Netlify cuts at 26 s)`),
  ...sqlErrors.map((q) => `SQL error (${q.db}): ${clip(q.error, 140)} — ${clip(q.sql, 80)}`),
  ...log.refused.map((x) => `refused: ${x}`),
  ...blindRows.map((r) => `${r.id} is ${r.status} on the app role but ${byId.get(r.id)} with staff access — the check cannot see the rows`)
];
if (siteHedges.length || problems.length) console.log(hedgeLine(siteHedges));
if (problems.length) {
  for (const entry of webTrace.slowOrFailed()) console.log(`  web timing: ${formatProofFetchTrace(entry)}`);
  console.log(`\nPROBLEMS (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("\nOK: every listed file is in the bundle, no step threw or passed 20 s, no SQL error, nothing tried to write.");
process.exit(0);

/* ---------- helpers ---------- */

function fail(msg) { console.error(`pulse:prove: ${msg}`); process.exit(1); }

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]] != null) continue;
    process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

/** The same bundler Netlify uses, with this repo's [functions] settings from netlify.toml. */
function buildBundle(entry = "netlify/functions/api.mjs") {
  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const zisi = [
    path.join(REPO, "node_modules/@netlify/zip-it-and-ship-it/dist/main.js"),
    path.join(npmRoot, "netlify-cli/node_modules/@netlify/zip-it-and-ship-it/dist/main.js")
  ].find((p) => fs.existsSync(p));
  if (!zisi) fail("cannot find @netlify/zip-it-and-ship-it (install netlify-cli globally).");
  const toml = fs.readFileSync(path.join(REPO, "netlify.toml"), "utf8");
  const block = toml.split(/^\[functions\]\s*$/m)[1]?.split(/^\[/m)[0] || "";
  const list = (key) => {
    const m = block.match(new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  };
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-pulse-prove-"));
  const script = `
    const { zipFunction } = await import(${JSON.stringify(pathToFileURL(zisi).href)});
    const r = await zipFunction(${JSON.stringify(path.isAbsolute(entry) ? entry : path.join(REPO, entry))}, ${JSON.stringify(out)}, {
      basePath: ${JSON.stringify(REPO)}, repositoryRoot: ${JSON.stringify(REPO)},
      config: { "*": { nodeBundler: "esbuild", includedFiles: ${JSON.stringify(list("included_files"))}, externalNodeModules: ${JSON.stringify(list("external_node_modules"))} } }
    });
    console.log(r.path);`;
  console.log(`building the ${path.basename(entry, ".mjs")} bundle (about a minute) ...`);
  const zip = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n").pop();
  const dir = path.join(out, "bundle");
  fs.mkdirSync(dir);
  execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
  return dir;
}

async function openClient(asStaff) {
  const client = new pg.Client({
    connectionString: REAL_DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(REAL_DATABASE_URL) ? undefined : { rejectUnauthorized: false }
  });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL statement_timeout = '20s'");
  if (asStaff) {
    await client.query("SELECT set_config('fundhub.actor', 'staff', true)");
    await client.query("SELECT set_config('fundhub.partner_id', '', true)");
  }
  return client;
}

/** One query at a time per connection, each in its own savepoint, so one error never poisons the rest. */
function wrapDb(client, label) {
  let n = 0;
  let chain = Promise.resolve();
  const runOne = async (sql, params) => {
    const text = String(typeof sql === "string" ? sql : (sql && sql.text) || "");
    if (/^\s*(begin|commit|rollback|end|start\s+transaction|set\s)/i.test(text)) {
      log.refused.push(`transaction control on ctx.db (${label}): ${clip(text, 60)}`);
      throw new Error(`pulse:prove refused transaction control: ${clip(text, 60)}`);
    }
    const sp = `pp_${label}_${++n}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const r = await client.query(sql, params);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      log.queries.push({ db: label, sql: text, rows: r.rowCount });
      return r;
    } catch (err) {
      try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* keep the real error */ }
      const msg = String((err && err.message) || err);
      const refused = /read-only transaction/i.test(msg);
      if (refused) log.refused.push(`write on ${label}: ${clip(text, 80)}`);
      log.queries.push({ db: label, sql: text, error: msg, refused });
      throw err;
    }
  };
  return {
    query(sql, params) {
      const p = chain.then(() => runOne(sql, params));
      chain = p.catch(() => {});
      return p;
    }
  };
}

function guardedFetch() {
  const memo = new Map();
  return async function fetchImpl(input, init = {}) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      log.refused.push(`${method} ${clip(url, 100)}`);
      throw new Error(`pulse:prove blocked ${method} — read-only proof run`);
    }
    const key = `${method} ${url} ${(init && init.redirect) || ""}`;
    if (!memo.has(key)) {
      try {
        memo.set(key, await proofFetch(realFetch, url, {
          method, redirect: (init && init.redirect) || "follow", headers: init && init.headers, signal: AbortSignal.timeout(15000)
        }, method, webTrace));
      } catch (err) {
        memo.set(key, { error: String((err && err.message) || err) });
      }
    }
    const hit = memo.get(key);
    log.fetches.push({ method, url, status: hit.status });
    if (hit.error) throw new Error(hit.error);
    const res = new Response([101, 204, 205, 304].includes(hit.status) ? null : hit.body, { status: hit.status, headers: hit.headers });
    Object.defineProperty(res, "url", { value: hit.url });
    return res;
  };
}

/* =====================================================================================================
   --beats : prove the HOURLY pulse from a built bundle, against live data, READ ONLY.

   WHAT RUNS. Every hourly shift function (pulse-hourly at minute 7, pulse-hourly-b at 37, pulse-hourly-c at 52; the
   literal SHIFT_FUNCTIONS list below) is built the way
   Netlify builds them (same bundler, same netlify.toml settings), unzipped, and src/pulse/runner.mjs is imported from
   INSIDE an unzipped folder. Every beat must be in exactly one shift (src/pulse/beats/shifts.mjs), and each
   function's BEATS must be its shift. Then, ONE SHIFT AT A TIME, the way the server runs them (two invocations half
   an hour apart), runPulse({ mode: "prove", sinks: fakes, only: <that shift> }) runs the shift's beats, and every
   guard below is judged for that shift on its own: its own 22 s budget, its own 13 s beat window, its own boxes:
     - the read box is REAL: BEGIN READ ONLY on DATABASE_URL, rolled back, destroyed (src/pulse/beats/readbox.mjs)
     - the GET and HEAD probes are REAL (the live site and, for a bank beat, the bank's own page)
     - the text and the buzz go to RECORDING FAKES. The runner is not live, so it could not build a real sender
       even if this script forgot to hand it fakes.
     - the records database the runner reads (org, open incidents, last results, bank links) is a READ ONLY
       connection. mode "prove" never calls a write function; the connection would refuse one anyway.
   SAFE. fetch allows GET and HEAD only; any other method is refused, counted and fails the proof. DATABASE_URL is
   replaced with a dead address before the bundle loads, so no module can open a pool of its own. No text, no email,
   no model call, no Plaid, no credit pull, no card charge.

   EXIT 1 when: the beat list is empty; a beat file on disk is not on the list; a listed beat file is missing from the
   bundle; the beat list does not load; a beat is in no shift or in two, or a shift names a beat that is not listed;
   a shift function's schedule or BEATS disagree with shifts.mjs; the bundle cannot load a function or the runner; a
   beat hit its deadline or was cut; any read was refused as SQL; anything tried to
   send through anything but the declared sinks (a non-GET/HEAD fetch); a shift's run took more than 22 s; the cold load
   took more than 8 s; the process crashed. A RED beat is printed, not a failure of the proof: red means the proof
   saw a real break (or this laptop's masked key), and that is the pulse doing its job.
   ===================================================================================================== */
async function proveBeats() {
  const BEAT_RUN_LIMIT_MS = 22000;
  const COLD_LIMIT_MS = 8000;
  const readDelayArg = args.find((a) => a.startsWith("--read-delay="));
  const READ_DELAY_MS = readDelayArg ? Number(readDelayArg.split("=")[1]) : 0;
  if (!Number.isInteger(READ_DELAY_MS) || READ_DELAY_MS < 0 || READ_DELAY_MS > 1000) fail("--read-delay must be a whole number from 0 to 1000 ms");
  const slowApplyArg = args.find((a) => a.startsWith("--slow-apply-links="));
  const SLOW_APPLY_LINKS_MS = slowApplyArg ? Number(slowApplyArg.split("=")[1]) : 0;
  if (!Number.isInteger(SLOW_APPLY_LINKS_MS) || SLOW_APPLY_LINKS_MS < 0 || SLOW_APPLY_LINKS_MS > 11_000) {
    fail("--slow-apply-links must be a whole number from 0 to 11000 ms");
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const queryRoundTrip = async (client, ...queryArgs) => {
    if (READ_DELAY_MS) await wait(READ_DELAY_MS);
    return client.query(...queryArgs);
  };
  const fixtureArg = args.find((a) => a === "--fixture" || a.startsWith("--fixture="));
  /* green (default) | red | and three NEGATIVE CONTROLS that must make the proof exit 1, so it is known to have teeth:
       hang    a step that never returns            -> "hit its own deadline"
       refuse  a read that is not a read            -> "a read was refused as SQL"
       send    a POST made outside the sinks        -> "tried to send outside the declared sinks" */
  const FIXTURE = fixtureArg ? (fixtureArg.includes("=") ? fixtureArg.split("=")[1] : "green") : null;
  if (FIXTURE && !["green", "red", "hang", "refuse", "send"].includes(FIXTURE)) fail(`unknown fixture "${FIXTURE}"`);
  if (FIXTURE && SLOW_APPLY_LINKS_MS) fail("--fixture and --slow-apply-links cannot be used together");
  const DELAYED_DEADLINE_MODE = READ_DELAY_MS > 0 && !FIXTURE;
  const problems = [];
  const crashes = [];

  loadDotEnv(path.join(REPO, ".env"));
  const REAL_DATABASE_URL = process.env.DATABASE_URL;
  if (!REAL_DATABASE_URL) fail("DATABASE_URL is not set (.env).");
  process.env.DATABASE_URL = "postgres://escape-blocked.invalid:5432/blocked";
  process.env.MIGRATION_DATABASE_URL = "postgres://escape-blocked.invalid:5432/blocked";
  const pgMod = createRequire(path.join(REPO, "package.json"))("pg");
  const nativeFetch = globalThis.fetch;
  const siteHedges = [];
  const realFetch = hedgedSiteFetch(nativeFetch, { siteHost: SITE_HOST, log: siteHedges });

  process.on("uncaughtException", (err) => { crashes.push(`uncaught exception: ${clip(err && err.message)}`); });
  const lateRejections = [];
  process.on("unhandledRejection", (err) => { lateRejections.push(clip(err && err.message)); });

  /* THE HOURLY FUNCTION SHIPS AS ONE FILE. Unlike api.mjs (which Netlify ships with the src/ tree beside it), the
     pulse-hourly graph is a clean ES module graph, so the bundler folds the runner, the alerts, the records and every
     beat (the literal import list in src/pulse/beats/index.mjs) into the single file netlify/functions/pulse-hourly.mjs.
     So there is no src/pulse/runner.mjs inside the zip to import. Two builds instead:
       A. the REAL function, exactly as Netlify builds it: it must build, hold the file, and LOAD from the unzipped
          folder (that loads pg from the zip's node_modules, the trap that 502'd the site once). Its default export
          is never called here (that would be a live run).
       B. a proof entry that re-exports runPulse, the fake sinks and the beat list from the same repo files, built
          with the same settings. Same bundler, same graph, so the code inside B is the code inside A. */
  const href = (dir, rel) => pathToFileURL(path.join(dir, rel)).href;
  /* The hourly shift functions and the schedule each must have. src/pulse/beats/shifts.mjs must name exactly these,
     in this order; each function must run exactly its shift. */
  const SHIFT_FUNCTIONS = Object.freeze([["pulse-hourly", "7 * * * *"], ["pulse-hourly-b", "37 * * * *"], ["pulse-hourly-c", "52 * * * *"]]);
  let rootFn = REPO;
  const shiftRoots = new Map(SHIFT_FUNCTIONS.map(([job]) => [job, REPO]));
  let rootWatch = REPO;
  let rootProof = REPO;
  let proofEntryFile = null;
  if (!FROM_REPO) {
    try {
      rootFn = buildBundle("netlify/functions/pulse-hourly.mjs");
      shiftRoots.set("pulse-hourly", rootFn);
      // Every other hourly shift is its own function (src/pulse/beats/shifts.mjs): build each the same way.
      for (const [job] of SHIFT_FUNCTIONS.slice(1)) shiftRoots.set(job, buildBundle(`netlify/functions/${job}.mjs`));
      // The 5-minute outside watch (one beat, the same runner) is a second function: build it the same way.
      rootWatch = buildBundle("netlify/functions/pulse-outside-watch.mjs");
      // The entry sits inside the repo for the few seconds of the build (the bundler needs it under its base path)
      // and is removed in the finally below. A dot file in scripts/pulse is picked up by nothing.
      proofEntryFile = path.join(REPO, "scripts/pulse", `.prove-entry-${process.pid}.mjs`);
      const rel = (r) => JSON.stringify(`../../${r}`);
      fs.writeFileSync(proofEntryFile, [
        `export { runPulse, RUN_BUDGET_MS, BEATS_PHASE_MS, READ_BOX_COUNT } from ${rel("src/pulse/runner.mjs")};`,
        `export { recordingSinks } from ${rel("src/pulse/alerts.mjs")};`,
        `export { BEAT_FILES, loadBeats } from ${rel("src/pulse/beats/index.mjs")};`,
        `export { SHIFTS, shiftProblems } from ${rel("src/pulse/beats/shifts.mjs")};`,
        ""
      ].join("\n"));
      rootProof = buildBundle(proofEntryFile);
    } catch (err) {
      // A listed beat that is not on disk, or a graph the bundler cannot follow, fails the BUILD. That is a finding.
      console.log(`\nPROBLEMS (1):\n  - the pulse-hourly bundle did not build: ${clip(err && (err.stderr || err.message), 400)}`);
      process.exit(1);
    } finally {
      if (proofEntryFile) fs.rmSync(proofEntryFile, { force: true });
    }
  }
  const t0 = Date.now();
  let BEAT_FILES, loadBeats, runPulse, recordingSinks, SHIFTS, shiftProblems, RUN_BUDGET_MS = BEAT_RUN_LIMIT_MS, BEATS_PHASE_MS = 13000, READ_BOX_COUNT = 3, entryModule;
  const shiftModules = new Map();
  const fnRel = "netlify/functions/pulse-hourly.mjs";
  try {
    if (!fs.existsSync(path.join(rootFn, fnRel))) problems.push("the function bundle does not hold netlify/functions/pulse-hourly.mjs");
    else entryModule = await import(href(rootFn, fnRel));
    shiftModules.set("pulse-hourly", entryModule);
    for (const [job] of SHIFT_FUNCTIONS.slice(1)) {
      const rel = `netlify/functions/${job}.mjs`;
      if (!fs.existsSync(path.join(shiftRoots.get(job), rel))) problems.push(`the ${job} bundle does not hold ${rel}`);
      else shiftModules.set(job, await import(href(shiftRoots.get(job), rel)));
    }
    if (FROM_REPO) {
      ({ BEAT_FILES, loadBeats } = await import(href(REPO, "src/pulse/beats/index.mjs")));
      ({ SHIFTS, shiftProblems } = await import(href(REPO, "src/pulse/beats/shifts.mjs")));
      ({ runPulse, RUN_BUDGET_MS, BEATS_PHASE_MS, READ_BOX_COUNT } = await import(href(REPO, "src/pulse/runner.mjs")));
      ({ recordingSinks } = await import(href(REPO, "src/pulse/alerts.mjs")));
    } else {
      const entryOut = fs.readdirSync(rootProof, { recursive: true }).map(String).find((f) => /(^|\/)\.prove-entry-\d+\.m?js$/.test(f));
      if (!entryOut) throw new Error(`the proof bundle holds no proof entry (it holds: ${fs.readdirSync(rootProof).slice(0, 8).join(", ")})`);
      ({ BEAT_FILES, loadBeats, runPulse, RUN_BUDGET_MS, BEATS_PHASE_MS, READ_BOX_COUNT, recordingSinks, SHIFTS, shiftProblems } = await import(href(rootProof, entryOut)));
    }
  } catch (err) {
    console.log(`  the bundle could not be loaded: ${clip(err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err, 400)}`);
    console.log(`\nPROBLEMS (1):\n  - the bundle could not load the runner or the function: ${clip(err && err.message, 200)}`);
    process.exit(1);
  }
  const coldMs = Date.now() - t0;
  const listed = BEAT_FILES.map(([name]) => name);
  // A beat the bundler could not find fails the BUILD above; a list that does not load fails here.
  let loadedBeats = [];
  try { loadedBeats = await loadBeats(); } catch (err) { problems.push(`the beat list does not load from the bundle: ${clip(err && err.message, 200)}`); }
  if (loadedBeats.length !== listed.length) problems.push(`the bundle loaded ${loadedBeats.length} beat(s) but ${listed.length} are listed`);
  const onDisk = fs.readdirSync(path.join(REPO, "src/pulse/beats")).filter((n) => /^beat-.+\.mjs$/.test(n) && !n.endsWith(".test.mjs"));
  // On disk but not on the list ships nowhere. beats.test.mjs (Guard 2.1) fails the build for that, and so does this proof.
  const unlisted = onDisk.filter((name) => !listed.includes(name));
  // A pulse with no listed beats checks nothing, and a beat file that is not listed ships nowhere: both are failures
  // here, because this proof is the gate that tells the truth about what the live function will run.
  if (listed.length === 0) problems.push("the beat list is empty: the live pulse would check nothing (add the beats to BEAT_FILES in src/pulse/beats/index.mjs)");
  if (unlisted.length) problems.push(`${unlisted.length} beat file(s) are on disk but not on the list, so they would ship nowhere: ${unlisted.join(", ")}`);
  if (entryModule && entryModule.SWEEP_CRON !== "7 * * * *") problems.push(`pulse-hourly SWEEP_CRON is ${entryModule.SWEEP_CRON}`);
  if (entryModule && typeof entryModule.default !== "function") problems.push("the bundled pulse-hourly has no default export");
  for (const [job, cron] of SHIFT_FUNCTIONS.slice(1)) {
    const mod = shiftModules.get(job);
    if (mod && mod.SWEEP_CRON !== cron) problems.push(`${job} SWEEP_CRON is ${mod.SWEEP_CRON}`);
    if (mod && typeof mod.default !== "function") problems.push(`the bundled ${job} has no default export`);
  }
  // The two hourly shifts. Every listed beat is in exactly one shift, and each function runs exactly its own shift,
  // on its own shift's schedule. A beat in no shift would ship and never run; that fails here, before any ship.
  const shiftJobs = Object.keys(SHIFTS || {});
  for (const p of shiftProblems ? shiftProblems(loadedBeats.map((b) => b.id)) : ["the shift list did not load"]) problems.push(`shifts: ${p}`);
  const shiftFunctions = SHIFT_FUNCTIONS.map(([job]) => [job, shiftModules.get(job)]);
  if (shiftJobs.join(",") !== shiftFunctions.map(([job]) => job).join(",")) problems.push(`the shift list names ${shiftJobs.join(", ") || "no shift"}, expected ${SHIFT_FUNCTIONS.map(([job]) => job).join(", ")}`);
  for (const [job, mod] of shiftFunctions) {
    const shift = SHIFTS?.[job];
    if (!mod || !shift) continue;
    if (mod.SWEEP_CRON !== shift.cron) problems.push(`${job} runs at "${mod.SWEEP_CRON}" but its shift says "${shift.cron}"`);
    if (JSON.stringify([...(mod.BEATS || [])]) !== JSON.stringify([...shift.beats])) problems.push(`the bundled ${job} runs ${(mod.BEATS || []).length} beat(s) that are not exactly its shift in src/pulse/beats/shifts.mjs`);
  }
  for (const job of shiftJobs) console.log(`  shift ${job} (${SHIFTS[job].cron}): ${SHIFTS[job].beats.length} beat(s): ${SHIFTS[job].beats.join(", ")}`);
  // The outside watch: it must build, load from its own zip, tick every 5 minutes and run only a beat that is listed.
  if (!FROM_REPO) {
    const watchRel = "netlify/functions/pulse-outside-watch.mjs";
    try {
      if (!fs.existsSync(path.join(rootWatch, watchRel))) problems.push(`the outside-watch bundle does not hold ${watchRel}`);
      else {
        const watchModule = await import(href(rootWatch, watchRel));
        if (watchModule.SWEEP_CRON !== "*/5 * * * *") problems.push(`pulse-outside-watch SWEEP_CRON is ${watchModule.SWEEP_CRON}`);
        if (typeof watchModule.default !== "function") problems.push("the bundled pulse-outside-watch has no default export");
        const ids = new Set(loadedBeats.map((b) => b.id));
        for (const want of watchModule.BEATS || []) if (!ids.has(want)) problems.push(`pulse-outside-watch runs beat "${want}" but the bundle has no such beat`);
        if (!(watchModule.BEATS || []).length) problems.push("pulse-outside-watch runs no beat");
        console.log(`  outside watch: loads from its own bundle, every 5 minutes, runs ${(watchModule.BEATS || []).join(", ")}`);
      }
    } catch (err) {
      problems.push(`the outside watch could not load from its bundle: ${clip(err && err.message, 200)}`);
    }
  }
  if (coldMs > COLD_LIMIT_MS) problems.push(`loading the function and the runner took ${(coldMs / 1000).toFixed(1)} s (limit ${COLD_LIMIT_MS / 1000} s)`);
  console.log(`  ${FROM_REPO ? "from this checkout" : `function bundle: ${rootFn}\n  proof bundle: ${rootProof}`}`);
  if (unlisted.length) console.log(`  ${unlisted.length} beat file(s) are on disk but not on the list, so they are not run here: ${unlisted.join(", ")}`);
  if (FIXTURE) console.log(`  fixture: ${FIXTURE}${["hang", "refuse", "send"].includes(FIXTURE) ? " (a negative control: this run MUST fail)" : ""}`);
  if (SLOW_APPLY_LINKS_MS) console.log(`  capacity fixture: apply-links holds one worker for ${SLOW_APPLY_LINKS_MS} ms; the full beat list still runs`);
  if (READ_DELAY_MS) {
    const timingRule = DELAYED_DEADLINE_MODE
      ? "; real beats are judged against their full unchanged deadlines in this artificial-delay run"
      : "; the built-in fixture keeps the normal under-half-deadline rule";
    console.log(`  artificial delay: ${READ_DELAY_MS} ms before every database round trip${timingRule}`);
  }
  console.log(`  cold load: ${coldMs} ms; listed beats: ${listed.length}${listed.length ? ` (${listed.join(", ")})` : " (the list is EMPTY)"}; loaded from the bundle: ${loadedBeats.length}`);

  // 2. Guards: GET and HEAD only.
  const sendLog = [];
  const fetchLog = [];
  const siteFetchTrace = [];
  const tracedSitePaths = new Set([
    "/api/health", "/api/public/funnel-checkout", "/api/public/slo-repair-checkout",
    "/api/public/survey-submit", "/api/public/slo-interest"
  ]);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      sendLog.push(`${method} ${clip(url, 100)}`);
      throw new Error(`pulse:prove blocked ${method} - read-only proof run`);
    }
    const target = new URL(url);
    fetchLog.push(`${method} ${target.host}`);
    const trace = target.host === "fundhub.ai" && tracedSitePaths.has(target.pathname);
    const started = Date.now();
    try {
      const response = await realFetch(url, init);
      if (trace) siteFetchTrace.push({ path: target.pathname, status: response.status, ms: Date.now() - started });
      return response;
    } catch (err) {
      if (trace) siteFetchTrace.push({
        path: target.pathname, status: 0, ms: Date.now() - started,
        error: String(err?.name || "Error").replace(/[^a-z0-9_]/gi, "").slice(0, 32),
        code: String(err?.cause?.code || "").replace(/[^a-z0-9_]/gi, "").slice(0, 32),
        aborted: init?.signal?.aborted === true
      });
      throw err;
    }
  };

  // 3. The read-only connection the runner uses for its own reads, one query at a time, each in a savepoint.
  const client = new pgMod.Client({
    connectionString: REAL_DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(REAL_DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000
  });
  client.on("error", () => {});
  await client.connect();
  await queryRoundTrip(client, "BEGIN READ ONLY");
  await queryRoundTrip(client, "SET LOCAL statement_timeout = '8s'");
  let n = 0;
  let chain = Promise.resolve();
  const rdbLog = [];
  // db-health asks "is a plain pooled connection stuck read-only?". The proof's reading connection is a
  // READ ONLY transaction by design, so it would always answer "on" (a false break). The fixed settings
  // query therefore runs on its own PLAIN connection, exactly like production's pooled one. Only that text.
  let plainSettings = null;
  const rdb = {
    async settingsQuery(sql) {
      if (sql !== DB_SETTINGS_SQL) throw new Error("pulse:prove: only the fixed settings query may run on the plain connection");
      if (!plainSettings) {
        plainSettings = new pgMod.Client({
          connectionString: REAL_DATABASE_URL,
          ssl: /localhost|127\.0\.0\.1/.test(REAL_DATABASE_URL) ? undefined : { rejectUnauthorized: false },
          connectionTimeoutMillis: 5000
        });
        plainSettings.on("error", () => {});
        await plainSettings.connect();
      }
      return queryRoundTrip(plainSettings, sql);
    },
    query(sql, params) {
      const text = String(typeof sql === "string" ? sql : (sql && sql.text) || "");
      if (text === DB_SETTINGS_SQL) return rdb.settingsQuery(sql);
      if (!/^\s*(select|with|show)\b/i.test(text)) {
        problems.push(`the runner sent a non-read to its reading connection: ${clip(text, 80)}`);
        return Promise.reject(new Error("pulse:prove refused a non-read"));
      }
      const p = chain.then(async () => {
        const sp = `pb_${++n}`;
        await queryRoundTrip(client, `SAVEPOINT ${sp}`);
        try {
          const r = await queryRoundTrip(client, sql, params);
          await queryRoundTrip(client, `RELEASE SAVEPOINT ${sp}`);
          rdbLog.push({ sql: clip(text, 60), rows: r.rowCount });
          return r;
        } catch (err) {
          try { await queryRoundTrip(client, `ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* keep the real error */ }
          rdbLog.push({ sql: clip(text, 60), error: clip(err && err.message, 120) });
          throw err;
        }
      });
      chain = p.catch(() => {});
      return p;
    }
  };
  // The read box gets its connection the way production gives it one: from a pg Pool (src/db.mjs pool().connect()),
  // so the close path is PoolClient.release(true) (destroy), not a bare Client.end(). Same options as db.mjs.
  const boxPool = new pgMod.Pool({
    connectionString: REAL_DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(REAL_DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000
  });
  boxPool.on("error", () => {});
  const connect = async () => {
    const client = await boxPool.connect();
    return {
      query: (...queryArgs) => queryRoundTrip(client, ...queryArgs),
      release: (destroy) => client.release(destroy)
    };
  };

  // 4. The beats: the bundle's own list, plus a built-in fixture when asked.
  const fixtureBeat = FIXTURE && {
    id: "fixture", title: "Proof fixture", kind: "probe", covers: [], box: false,
    reads: [{ host: "SITE", methods: ["GET"] }], steps: ["db", "web"], deadlineMs: FIXTURE === "hang" ? 600 : 8000,
    fixGuide: "Look at the fixture.\n\nLikely causes:\n- none, this is the proof fixture\n- none\nSteps:\n- none\n- none\nFiles: scripts/pulse/prove.mjs",
    async run(ctx) {
      if (FIXTURE === "hang") await ctx.step("db", () => new Promise(() => {}));
      if (FIXTURE === "refuse") await ctx.step("db", async () => ctx.read("DELETE FROM job_heartbeats WHERE false"));
      if (FIXTURE === "send") await ctx.step("db", async () => globalThis.fetch(`${ctx.siteUrl}/api/health`, { method: "POST", body: "{}" }));
      await ctx.step("db", async () => (await ctx.read("SELECT 1 AS n")).rows);
      await ctx.step("web", async () => {
        const url = FIXTURE === "red" ? `${ctx.siteUrl}/pulse-proof-fixture-does-not-exist` : `${ctx.siteUrl}/api/health`;
        const r = await ctx.http.get(url);
        if (!r.ok) throw ctx.fail("web", `the site said ${r.status}`);
      });
      return ctx.done("fixture ok");
    }
  };
  let proofBeats = fixtureBeat ? [fixtureBeat] : null;
  if (SLOW_APPLY_LINKS_MS) {
    const matches = loadedBeats.filter((beat) => beat.id === "apply-links");
    if (matches.length !== 1) {
      problems.push(`the slow apply-links capacity fixture found ${matches.length} apply-links beats, expected exactly 1`);
    } else {
      const sourceBeat = matches[0];
      const [slowStep, ...skippedSteps] = sourceBeat.steps;
      const slowApplyBeat = {
        ...sourceBeat,
        async run(ctx) {
          await ctx.step(slowStep, () => wait(SLOW_APPLY_LINKS_MS));
          for (const step of skippedSteps) ctx.skipStep(step, "capacity proof: this apply-links run is the 10.5 second worker fixture");
          return ctx.done(`capacity proof held apply-links for ${SLOW_APPLY_LINKS_MS} ms`);
        }
      };
      proofBeats = loadedBeats.map((beat) => beat.id === "apply-links" ? slowApplyBeat : beat);
    }
  }
  const sinks = recordingSinks();
  const env = { ...process.env, URL: process.env.URL || "https://fundhub.ai", ADAPTERS_DRY_RUN: "0" };
  delete env.AWS_LAMBDA_FUNCTION_NAME;
  delete env.NETLIFY;

  // 5. The runs. With a fixture: one run of the fixture alone (it proves the guards have teeth). Otherwise each hourly
  // shift, one after the other, the way the server runs them: its own runPulse call with `only` set to its shift,
  // its own 22 s budget, its own 13 s beat window and its own three boxes. The runner loads the beats from the bundle
  // itself, as the live function does, unless a capacity fixture replaced one.
  const runs = FIXTURE
    ? [{ label: "fixture", only: null }]
    : shiftJobs.map((job) => ({ label: `shift ${job}`, only: [...SHIFTS[job].beats] }));
  for (const run of runs) {
    const t1 = Date.now();
    try {
      run.out = await runPulse({ env, mode: "prove", sinks, rdb, connect, ...(proofBeats ? { beats: proofBeats } : {}), ...(run.only ? { only: run.only } : {}) });
    } catch (err) {
      crashes.push(`runPulse threw (${run.label}): ${clip(err && err.message)}`);
    }
    run.ms = Date.now() - t1;
    // Every box the run opened must be destroyed before the next shift starts.
    run.pool = { total: boxPool.totalCount, idle: boxPool.idleCount, waiting: boxPool.waitingCount };
  }
  try { await queryRoundTrip(client, "ROLLBACK"); } catch { /* closing */ }
  try { await client.end(); } catch { /* closing */ }
  if (plainSettings) { try { await plainSettings.end(); } catch { /* closing */ } }
  try { await boxPool.end(); } catch { /* closing */ }
  globalThis.fetch = nativeFetch;

  // 6. Judge, one run at a time. Every guard holds for each shift on its own.
  let ranTotal = 0;
  for (const { label, only, out, ms: runMs, pool: poolBefore } of runs) {
    if (!out) continue;
    ranTotal += out.ran;
    const judgedBeats = (proofBeats || loadedBeats).filter((beat) => !only || only.includes(beat.id));
    const where = runs.length > 1 ? ` (${label})` : "";
    console.log(`\n  ${label}: ${out.ran} beat(s), ${out.failed} red, ${out.timedOut} cut, ${runMs} ms (budget ${RUN_BUDGET_MS / 1000} s), database ${out.ran === 0 ? "not checked (no beats)" : out.dbUp ? "up" : "NOT answering"}`);
    for (const r of out.results) {
      const mark = r.ok ? "green" : "RED";
      console.log(`  ${mark.padEnd(5)} ${r.beatId} ${r.ms === null ? "(cut)" : `${r.ms} ms`}${r.skipped?.length ? ` skipped: ${r.skipped.join(",")}` : ""}${r.ok ? "" : `  at "${r.step}": ${clip(r.detail, 140)}`}`);
    }
    // How much room the shift has. Box time is each beat's own measured time (its worker is busy for all of it,
    // web reads included); the shift has READ_BOX_COUNT workers for the BEATS_PHASE_MS beat window. A cut beat has
    // no time (null), so a run with a cut says so instead of hiding it in the sum.
    const measured = out.results.filter((r) => r.ms !== null);
    const workerMs = measured.reduce((sum, r) => sum + r.ms, 0);
    const capacityMs = READ_BOX_COUNT * BEATS_PHASE_MS;
    const slowest = measured.reduce((top, r) => (r.ms > top.ms ? r : top), { beatId: "none", ms: 0 });
    console.log(`  box time used${where}: ${(workerMs / 1000).toFixed(1)} s of ${(capacityMs / 1000).toFixed(0)} s (${Math.round((100 * workerMs) / capacityMs)}%${measured.length < out.results.length ? `, ${out.results.length - measured.length} cut beat(s) not counted` : ""}); slowest ${slowest.beatId} ${(slowest.ms / 1000).toFixed(1)} s; run ${(runMs / 1000).toFixed(1)} s of ${RUN_BUDGET_MS / 1000} s`);
    if (out.alerts?.body) console.log(`  the text the pulse WOULD send (fake sink, nothing sent): ${out.alerts.body}`);
    if (out.box) console.log(`  box pool after the run: ${poolBefore.total} open, ${poolBefore.idle} idle, ${poolBefore.waiting} waiting`);
    if (out.box) console.log(`  read boxes: ${out.box.count}, ${out.box.reads} reads, ${out.box.errors} errors, ${out.box.refused.length} refused, commitsSent ${out.box.commitsSent}, readOnlyAtClose ${out.box.readOnlyAtClose}, rolledBack ${out.box.rolledBack}, destroyed ${out.box.destroyed}`);
    if (out.error && !/^records:/.test(out.error)) problems.push(`the run reported${where}: ${clip(out.error, 200)}`);
    if (!out.dbUp && out.ran) problems.push(`the runner could not read the database before the beats ran${where}`);
    if (runMs > RUN_BUDGET_MS) problems.push(`the run took ${(runMs / 1000).toFixed(1)} s (budget ${RUN_BUDGET_MS / 1000} s)${where}`);
    if (out.timedOut) problems.push(`${out.timedOut} beat(s) were cut at the beats-phase budget${where}`);
    if (only && out.ran !== judgedBeats.length) problems.push(`${label} ran ${out.ran} beat(s), expected its ${judgedBeats.length}`);
    const deadlines = new Map(judgedBeats.map((beat) => [beat.id, beat.deadlineMs]));
    for (const r of out.results) {
      if (/^deadline \d+ ms passed/.test(String(r.detail))) problems.push(`beat ${r.beatId} hit its own deadline: ${clip(r.detail, 120)}`);
      if (r.step === "no-refusals" || /^refused sql/.test(String(r.detail))) problems.push(`beat ${r.beatId} was refused: ${clip(r.detail, 140)}`);
      const deadlineMs = deadlines.get(r.beatId);
      const injectedSlowApply = Boolean(SLOW_APPLY_LINKS_MS && r.beatId === "apply-links");
      if (injectedSlowApply && r.ms !== null) {
        if (r.ms < SLOW_APPLY_LINKS_MS) problems.push(`the apply-links capacity fixture finished in ${r.ms} ms, before its ${SLOW_APPLY_LINKS_MS} ms hold elapsed`);
        if (deadlineMs && r.ms >= deadlineMs) problems.push(`the apply-links capacity fixture took ${r.ms} ms and reached its ${deadlineMs} ms deadline`);
        if (!String(r.detail).includes(`held apply-links for ${SLOW_APPLY_LINKS_MS} ms`)) problems.push("the apply-links capacity fixture did not return its expected proof detail");
      } else if (r.ms !== null && deadlineMs) {
        const timingLimitMs = DELAYED_DEADLINE_MODE ? deadlineMs : deadlineMs / 2;
        if (r.ms >= timingLimitMs) {
          const timingRule = DELAYED_DEADLINE_MODE
            ? `reached its unchanged ${deadlineMs} ms deadline in artificial-delay mode`
            : `was not under half its ${deadlineMs} ms deadline`;
          problems.push(`beat ${r.beatId} took ${r.ms} ms and ${timingRule}`);
        }
      }
    }
    if (!out.box) problems.push(`the runner returned no read-box report${where}`);
    else {
      const expectedBoxCount = Math.min(READ_BOX_COUNT, judgedBeats.length);
      if (out.box.count !== expectedBoxCount || out.box.reports?.length !== expectedBoxCount) {
        problems.push(`the runner opened ${out.box.count} read box(es), expected exactly ${expectedBoxCount}${where}`);
      }
    }
    for (const [lane, report] of (out.box?.reports || []).entries()) {
      for (const x of report.refused || []) if (x.kind === "sql") problems.push(`read box ${lane + 1}${where} refused SQL: ${clip(x.what, 120)}`);
      if (!report.began || !report.readOnlyVerified) problems.push(`read box ${lane + 1}${where} did not prove BEGIN READ ONLY`);
      if (report.commitsSent !== 0) problems.push(`read box ${lane + 1}${where} saw ${report.commitsSent} COMMIT(s)`);
      if (report.leaked) problems.push(`read box ${lane + 1}${where} leaked out of READ ONLY`);
      if (report.began && !report.rolledBack) problems.push(`read box ${lane + 1}${where} did not ROLLBACK`);
      if (!report.destroyed) problems.push(`read box ${lane + 1}${where} was not destroyed`);
    }
    if (out.records?.written) problems.push(`a non-live run wrote records${where}`);
    if (poolBefore.total > 0) problems.push(`the run left ${poolBefore.total} connection(s) open in the box pool (all three boxes must destroy theirs)${where}`);
  }
  // The capacity fixture holds one worker in apply-links' shift; the whole beat list must still run across the shifts.
  if (SLOW_APPLY_LINKS_MS && ranTotal !== loadedBeats.length) problems.push(`the slow apply-links capacity proof ran ${ranTotal} beat(s), expected the full ${loadedBeats.length}`);
  // Across the shifts every listed beat ran exactly once (a beat in no shift never runs; one in two runs twice).
  if (!FIXTURE && runs.every((run) => run.out)) {
    const ranIds = runs.flatMap((run) => run.out.results.map((r) => r.beatId));
    const missing = loadedBeats.map((b) => b.id).filter((id) => !ranIds.includes(id));
    const twice = [...new Set(ranIds.filter((id, i) => ranIds.indexOf(id) !== i))];
    if (missing.length) problems.push(`these beats ran in no shift: ${missing.join(", ")}`);
    if (twice.length) problems.push(`these beats ran in more than one shift: ${twice.join(", ")}`);
  }
  for (const s of sendLog) problems.push(`something tried to send outside the declared sinks: ${s}`);
  for (const c of crashes) problems.push(c);
  const refusedReads = rdbLog.filter((q) => q.error && /read-only transaction/i.test(q.error));
  for (const q of refusedReads) problems.push(`Postgres refused a write on the reading connection: ${q.sql}`);
  if (lateRejections.length) console.log(`  note: ${lateRejections.length} late rejection(s) were caught by the function's guard (not a failure): ${lateRejections.slice(0, 2).join(" | ")}`);
  console.log(`  web reads made: ${fetchLog.length}${fetchLog.length ? ` (${[...new Set(fetchLog)].slice(0, 4).join(", ")})` : ""}; sink calls: text ${sinks.calls.text.length}, buzz ${sinks.calls.ntfy.length}`);
  console.log(hedgeLine(siteHedges));

  if (problems.length) {
    for (const trace of siteFetchTrace) console.log(`  site fetch headers: ${trace.path} ${trace.status} ${trace.ms} ms${trace.error ? ` (${trace.error}${trace.code ? ` ${trace.code}` : ""}; aborted=${trace.aborted})` : ""}`);
    console.log(`\nPROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\nOK: every listed beat is in the bundle${FIXTURE ? "" : " and in exactly one shift"}, the runner and the functions load, no beat hit its deadline, nothing was refused as SQL, nothing sent outside the fakes, ${FIXTURE ? "the run" : "each shift"} fit its budget, nothing crashed.`);
  process.exit(0);
}
