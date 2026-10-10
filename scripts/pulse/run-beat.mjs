#!/usr/bin/env node
// Run ONE pulse beat by hand, read-only.
//
//   node scripts/pulse/run-beat.mjs <beat-id>             LIVE, read-only. Real read box on DATABASE_URL
//                                                          (BEGIN READ ONLY, ROLLBACK), real GET/HEAD
//                                                          probe against https://fundhub.ai. Prints the
//                                                          BeatResult JSON on stdout.
//   node scripts/pulse/run-beat.mjs --selftest <beat-id>   No network, no database. Runs the beat's
//                                                          selfTest.pass and selfTest.fail through the
//                                                          fake ctx and prints both.
//   node scripts/pulse/run-beat.mjs --probe                THE SAFETY PROBE. Opens the real read box, runs
//                                                          SELECT 1, then goes AROUND the allow-list on
//                                                          purpose (straight to the connection) with an
//                                                          INSERT, UPDATE, DELETE, CREATE TEMP TABLE and
//                                                          two ways to flip the transaction to read-write,
//                                                          and asserts POSTGRES ITSELF refuses each
//                                                          (SQLSTATE 25006). Then sends the checker's two
//                                                          "several commands in one string" payloads on the
//                                                          extended protocol and asserts Postgres refuses
//                                                          them whole. Prints PASS or FAIL.
//
// Exit codes: 0 green / probe PASS, 1 red beat / probe FAIL / selftest problems, 2 the script could not run.
//
// WHAT IT CAN NEVER DO. No write, no POST, no send, no model call. The only SQL it sends is what the read
// box allows (a single SELECT/WITH/SHOW inside BEGIN READ ONLY) and, in --probe, statements built so that
// they change nothing even if the wall were missing (WHERE false) and that Postgres must refuse first.
// A beat file is checked by the static pin BEFORE it is imported, so a beat that imports a database
// module or calls fetch is never executed. process.env.DATABASE_URL is replaced with a dead address
// before any beat code loads, so nothing that opens its own pool can reach the database.
//
// On a laptop, secret keys in .env are masks (rows of asterisks). A beat treats a mask as "skip this step"
// (ctx.live is false here), which is not a break.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = "https://fundhub.ai";
const argv = process.argv.slice(2);

const usage = () => {
  console.error("usage: node scripts/pulse/run-beat.mjs <beat-id> | --selftest <beat-id> | --probe");
  process.exit(2);
};
if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) usage();

const PROBE = argv.includes("--probe");
const SELFTEST = argv.includes("--selftest");
const beatId = argv.find((a) => !a.startsWith("-")) ?? null;
if (!PROBE && !beatId) usage();
if (argv.some((a) => a.startsWith("-") && !["--probe", "--selftest", "--help", "-h"].includes(a))) usage();

process.on("unhandledRejection", (err) => { console.error(`run-beat: unhandled rejection (carrying on): ${String((err && err.message) || err).slice(0, 200)}`); });
setTimeout(() => { console.error("run-beat: hard stop after 45 s"); process.exit(2); }, 45_000).unref();

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]] != null) continue;
    process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
const dbTarget = (url) => { try { const u = new URL(url); return `${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`; } catch { return "(unreadable)"; } };
const stop = (msg, code = 2) => { console.error(`run-beat: ${msg}`); process.exit(code); };

/* The selftest needs no database and no .env. Everything else reads .env, keeps the real
   DATABASE_URL, and poisons the one in process.env so no module can open a pool of its own. */
let REAL_DATABASE_URL = null;
if (!SELFTEST) {
  loadDotEnv(path.join(REPO, ".env"));
  REAL_DATABASE_URL = process.env.DATABASE_URL || null;
  if (!REAL_DATABASE_URL) stop("DATABASE_URL is not set (.env).");
}
process.env.DATABASE_URL = "postgres://escape-blocked.invalid:5432/blocked";
process.env.MIGRATION_DATABASE_URL = "postgres://escape-blocked.invalid:5432/blocked";

const { openReadBox, readDbSettings, DB_SETTINGS_SQL, PulseRefused } = await import(pathToFileURL(path.join(REPO, "src/pulse/beats/readbox.mjs")).href);
const { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource, BEAT_ID_RE } = await import(pathToFileURL(path.join(REPO, "src/pulse/beats/contract.mjs")).href);
const { makeBeatCtx, makeFakeCtx } = await import(pathToFileURL(path.join(REPO, "src/pulse/beats/ctx.mjs")).href);
const { makeProbe } = await import(pathToFileURL(path.join(REPO, "src/messaging/providers/pulse-probe.mjs")).href);

function newClient() {
  const pg = createRequire(path.join(REPO, "package.json"))("pg");
  const local = /localhost|127\.0\.0\.1/.test(REAL_DATABASE_URL);
  const client = new pg.Client({
    connectionString: REAL_DATABASE_URL,
    ssl: local ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000
  });
  client.on("error", () => { /* a dropped connection is reported by the query that was using it */ });
  return client;
}
const connect = async () => { const c = newClient(); await c.connect(); return c; };

/* ---------------- --probe ---------------- */

async function safetyProbe() {
  const lines = [];
  let failed = false;
  const say = (ok, text) => { lines.push(`${ok ? "  ok  " : " FAIL "} ${text}`); if (!ok) failed = true; };

  console.log("PULSE READ-BOX SAFETY PROBE");
  console.log(`database: ${dbTarget(REAL_DATABASE_URL)}`);

  let client = null;
  const t0 = Date.now();
  let box;
  try {
    box = await openReadBox({ connect: async () => (client = await connect()) });
  } catch (err) {
    console.log(` FAIL  the read box did not open: ${String((err && err.message) || err).slice(0, 200)}`);
    console.log("FAIL");
    process.exit(1);
  }
  say(true, `opened the read box in ${Date.now() - t0} ms (BEGIN READ ONLY, statement_timeout 4 s, staff scope)`);

  const mode = await box.read("SHOW transaction_read_only");
  say(mode.rows[0]?.transaction_read_only === "on", `SHOW transaction_read_only = ${mode.rows[0]?.transaction_read_only}`);
  const one = await box.read("SELECT 1 AS one, current_user AS who");
  say(one.rows[0]?.one === 1, `SELECT 1 through the box -> ${one.rows[0]?.one} (as ${one.rows[0]?.who})`);
  const staff = await box.read("SELECT current_setting('fundhub.actor', true) AS actor");
  say(staff.rows[0]?.actor === "staff", `staff scope is set inside the box (fundhub.actor = ${staff.rows[0]?.actor})`);

  // WALL 1: the allow-list.
  const walls = [
    "INSERT INTO job_heartbeats (job) VALUES ('probe')", "UPDATE job_heartbeats SET job = job", "DELETE FROM job_heartbeats",
    "SELECT 1; DELETE FROM job_heartbeats", "SELECT set_config('transaction_read_only','off',true)", "COMMIT", "SELECT pg_sleep(30)",
    // The enders. Wall 2 cannot stop these (a COMMIT ends the READ ONLY transaction), so wall 1 and the
    // extended protocol must. Includes the two strings the checker used to fool the old scanner.
    "END", "ABORT", "ROLLBACK", "BEGIN", "SELECT 1; COMMIT; SELECT 2",
    "SELECT 1 --x\r; COMMIT; SELECT 2",
    `SELECT $${"a".repeat(90)}$ ' $${"a".repeat(90)}$ ; COMMIT ; SELECT 2 -- '\n`
  ];
  let refusedCount = 0;
  for (const sql of walls) {
    try { await box.read(sql); } catch (err) { if (err instanceof PulseRefused) refusedCount++; }
  }
  say(refusedCount === walls.length, `wall 1 (allow-list) refused ${refusedCount} of ${walls.length} sample writes before they were sent`);
  say(box.report().refused.length === walls.length, `the box recorded each refusal (${box.report().refused.length})`);

  // WALL 2: Postgres itself. Go AROUND wall 1: straight to the connection.
  // Every attempt is built to change nothing even if it were allowed (WHERE false, a temp table inside a
  // transaction that is rolled back), except the last two, which only try to flip the mode.
  // 25006 = read_only_sql_transaction. Flipping the mode inside a transaction is refused by Postgres
  // with 25001 = active_sql_transaction ("cannot set transaction read-write mode inside a read-only
  // transaction"), measured live on 2026-10-09. Either code is Postgres refusing; anything else is not.
  const attempts = [
    ["INSERT (zero rows)", "INSERT INTO job_heartbeats (job) SELECT job FROM job_heartbeats WHERE false", ["25006"]],
    ["UPDATE (zero rows)", "UPDATE job_heartbeats SET job = job WHERE false", ["25006"]],
    ["DELETE (zero rows)", "DELETE FROM job_heartbeats WHERE false", ["25006"]],
    ["CREATE TEMP TABLE", "CREATE TEMP TABLE pulse_probe_tmp (a int)", ["25006"]],
    ["SET LOCAL transaction_read_only = off", "SET LOCAL transaction_read_only = off", ["25006", "25001"]],
    ["set_config('transaction_read_only','off')", "SELECT set_config('transaction_read_only', 'off', true)", ["25006", "25001"]]
  ];
  let n = 0;
  for (const [label, sql, codes] of attempts) {
    const sp = `pb_${++n}`;
    await client.query(`SAVEPOINT ${sp}`);
    let outcome;
    let message = "";
    try { await client.query(sql); outcome = "ALLOWED"; }
    catch (err) { outcome = err && err.code ? err.code : "error"; message = String((err && err.message) || err).slice(0, 90); }
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    const refused = codes.includes(outcome);
    say(refused, `wall 2 (Postgres) vs ${label}: ${refused ? `refused ${outcome} "${message}"` : outcome === "ALLOWED" ? "ALLOWED (the wall is NOT up)" : `unexpected ${outcome} "${message}"`}`);
    if (outcome === "ALLOWED") break;
  }

  const after = await box.read("SHOW transaction_read_only");
  say(after.rows[0]?.transaction_read_only === "on", `after all attempts the transaction is still read-only (${after.rows[0]?.transaction_read_only})`);

  // WALL 3: the protocol. Go around wall 1 AND the box: a second raw connection, read-only, sends the two
  // checker strings the way a scanner mistake would let them through. Sent on the extended protocol (what the
  // box uses for every user read) Postgres must refuse them before it runs any part. Nothing in them writes.
  const hostile = [
    ["lone CR ends a -- comment", "SELECT 1 --x\r; COMMIT; SELECT 2"],
    ["90-character dollar-quote tag", `SELECT $${"a".repeat(90)}$ ' $${"a".repeat(90)}$ ; COMMIT ; SELECT 2 -- '\n`]
  ];
  let raw = null;
  try {
    raw = await connect();
    await raw.query("BEGIN READ ONLY");
    for (const [label, sql] of hostile) {
      await raw.query("SAVEPOINT pw3");
      let msg = "";
      let ran = false;
      try { await raw.query({ text: sql, values: [], queryMode: "extended" }); ran = true; } catch (err) { msg = String((err && err.message) || err); }
      await raw.query("ROLLBACK TO SAVEPOINT pw3");
      say(!ran && /multiple commands/i.test(msg), `protocol wall vs ${label}: ${ran ? "RAN (the wall is NOT up)" : `refused "${msg.slice(0, 70)}"`}`);
    }
    const ro = (await raw.query("SELECT current_setting('transaction_read_only') AS ro")).rows[0]?.ro;
    say(ro === "on", `the raw connection is still read-only after both (${ro})`);
  } catch (err) {
    say(false, `protocol wall check could not run: ${String((err && err.message) || err).slice(0, 120)}`);
  } finally {
    if (raw) { try { await raw.query("ROLLBACK"); } catch { /* gone */ } await raw.end().catch(() => {}); }
  }

  const rep = await box.close();
  say(rep.commitsSent === 0, `COMMIT was never sent (commitsSent = ${rep.commitsSent})`);
  say(rep.readOnlyAtClose === true && rep.leaked === false, `the connection was still read-only when the box closed (readOnlyAtClose = ${rep.readOnlyAtClose}, leaked = ${rep.leaked})`);
  say(rep.rolledBack === true, `close sent ROLLBACK and it came back (rolledBack = ${rep.rolledBack})`);
  say(rep.destroyed === true, `the connection was destroyed, not handed back (destroyed = ${rep.destroyed})`);

  for (const l of lines) console.log(l);
  console.log(failed ? "FAIL" : "PASS");
  process.exit(failed ? 1 : 0);
}

/* ---------------- loading a beat safely ---------------- */

async function loadBeat(id) {
  if (!BEAT_ID_RE.test(id)) stop(`"${id}" is not a beat id`);
  const file = path.join(REPO, `src/pulse/beats/beat-${id}.mjs`);
  if (!fs.existsSync(file)) stop(`no such beat: src/pulse/beats/beat-${id}.mjs`);
  // The pin runs on the SOURCE, before the module is imported, so a beat that does I/O is never executed.
  const pinned = pinBeatSource(fs.readFileSync(file, "utf8"));
  if (pinned.length) stop(`beat-${id}.mjs fails the static pin and was NOT run:\n  ${pinned.join("\n  ")}`);
  const mod = await import(pathToFileURL(file).href);
  const problems = validateBeat(mod, { file: path.basename(file) });
  if (problems.length) stop(`beat-${id}.mjs is not a valid beat:\n  ${problems.join("\n  ")}`);
  return mod;
}

/* ---------------- --selftest ---------------- */

async function selfTest(id) {
  const beat = await loadBeat(id);
  const problems = await checkBeatSelfTest(beat);
  const pass = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  const fail = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  console.log(JSON.stringify({ beat: id, problems, pass, fail }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

/* ---------------- <beat-id>: live, read-only ---------------- */

async function liveRun(id) {
  const beat = await loadBeat(id);
  console.error(`run-beat: ${id} LIVE, read-only. database ${dbTarget(REAL_DATABASE_URL)}, site ${SITE}`);

  let box = null;
  try { box = await openReadBox({ connect }); }
  catch (err) { console.error(`run-beat: the read box did not open (${String((err && err.message) || err).slice(0, 160)}). Beats that read data will go red at "db".`); }

  const plain = async (sql) => {
    if (sql !== DB_SETTINGS_SQL) throw new Error("only the fixed settings query may run outside the box");
    const c = await connect();
    try { return await c.query(sql); } finally { await c.end().catch(() => {}); }
  };
  const state = Array.isArray(beat.needs) && beat.needs.includes("bankLinks") ? { bankLinks: [] } : null;
  if (state) console.error("run-beat: this beat keeps bank-link state; running as a FIRST PASS (empty state).");

  const ctx = makeBeatCtx({
    beat,
    runId: `manual-${Date.now()}`,
    env: process.env,
    siteUrl: SITE,
    state,
    read: box ? box.read : undefined,
    probe: makeProbe({ env: process.env }),
    dbSettings: () => readDbSettings(plain)
  });
  const result = await runBeat(beat, ctx);
  const report = box ? await box.close({ timedOut: result.detail.startsWith("deadline") }) : null;

  console.log(JSON.stringify(result, null, 2));
  if (report) console.error(`run-beat: read box: ${report.reads} reads, ${report.errors} errors, ${report.refused.length} refused, commitsSent ${report.commitsSent}, readOnlyAtClose ${report.readOnlyAtClose}, rolledBack ${report.rolledBack}, destroyed ${report.destroyed}`);
  console.error(`run-beat: ${result.ok ? "GREEN" : `RED at "${result.step}"`} in ${result.ms} ms${result.skipped.length ? `; skipped: ${result.skipped.join(", ")}` : ""}`);
  process.exit(result.ok ? 0 : 1);
}

if (PROBE) await safetyProbe();
else if (SELFTEST) await selfTest(beatId);
else await liveRun(beatId);
