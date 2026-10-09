#!/usr/bin/env node
// Prove the morning pulse the way it really runs: from a built Netlify bundle,
// against the live database, read-only.
//
//   npm run pulse:prove                 build the api bundle, run every coverage step from inside it
//   npm run pulse:prove -- --repo       skip the build, run from this checkout (faster, less true)
//   npm run pulse:prove -- --lanes=gap-sms,gap-email
//
// WHY. Green unit tests have lied about the pulse three ways (2026-10-08):
//   1. A folder scan found no check files in the shipped bundle, so 0 rows ran, with no error.
//   2. All coverage in one Inngest step took ~61 s; Netlify cuts each step at 26 s.
//   3. Checks that read repo files at run time passed on a laptop and went red on the server.
// This script catches all three, because it runs the bundle the server runs.
//
// SAFE. Two Postgres connections as DATABASE_URL's role (the app role the pulse uses), each inside
// BEGIN READ ONLY with every query in its own SAVEPOINT; both ROLLBACK. Any write is refused and
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STEP_LIMIT_MS = 20000;
const args = process.argv.slice(2);
const FROM_REPO = args.includes("--repo");
const LANES = (args.find((a) => a.startsWith("--lanes=")) || "").slice(8).split(",").filter(Boolean);
const clip = (s, n = 200) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

loadDotEnv(path.join(REPO, ".env"));
const REAL_DATABASE_URL = process.env.DATABASE_URL;
if (!REAL_DATABASE_URL) fail("DATABASE_URL is not set (.env).");
process.env.DATABASE_URL = "postgres://escape-blocked.invalid:5432/blocked";
process.env.MIGRATION_DATABASE_URL = "postgres://escape-blocked.invalid:5432/blocked";
const pg = createRequire(path.join(REPO, "package.json"))("pg");
const realFetch = globalThis.fetch;

const root = FROM_REPO ? REPO : buildBundle();
const listed = (await import(pathToFileURL(path.join(REPO, "src/pulse/coverage/modules.mjs")).href));
const want = [...listed.SLICE_FILES, ...listed.GAP_FILES].map(([name]) => name);
const missingFiles = want.filter((name) => !fs.existsSync(path.join(root, "src/pulse/coverage", name)));

const log = { queries: [], fetches: [], refused: [] };
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
for (const r of prod.rows.filter((x) => x.status === "FAIL")) console.log(`  RED  ${r.id}: ${clip(r.detail, 160)}`);
const problems = [
  ...missingFiles.map((f) => `bundle is missing ${f}`),
  ...threw.map((s) => `${s.name} threw: ${s.threw}`),
  ...laneSkips.map((r) => `${r.id}: ${clip(r.detail, 160)}`),
  ...slow.map((s) => `${s.name} took ${(s.ms / 1000).toFixed(1)} s (limit ${STEP_LIMIT_MS / 1000} s; Netlify cuts at 26 s)`),
  ...sqlErrors.map((q) => `SQL error (${q.db}): ${clip(q.error, 140)} — ${clip(q.sql, 80)}`),
  ...log.refused.map((x) => `refused: ${x}`),
  ...blindRows.map((r) => `${r.id} is ${r.status} on the app role but ${byId.get(r.id)} with staff access — the check cannot see the rows`)
];
if (problems.length) {
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
function buildBundle() {
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
    const r = await zipFunction(${JSON.stringify(path.join(REPO, "netlify/functions/api.mjs"))}, ${JSON.stringify(out)}, {
      basePath: ${JSON.stringify(REPO)}, repositoryRoot: ${JSON.stringify(REPO)},
      config: { "*": { nodeBundler: "esbuild", includedFiles: ${JSON.stringify(list("included_files"))}, externalNodeModules: ${JSON.stringify(list("external_node_modules"))} } }
    });
    console.log(r.path);`;
  console.log("building the api bundle (about a minute) ...");
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
        const res = await realFetch(url, { method, redirect: (init && init.redirect) || "follow", headers: init && init.headers, signal: AbortSignal.timeout(15000) });
        memo.set(key, { status: res.status, headers: [...res.headers.entries()], body: method === "HEAD" ? "" : await res.text(), url: res.url });
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
