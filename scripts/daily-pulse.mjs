#!/usr/bin/env node
// Daily pulse CLI. Default is dry-run: writes the board, does not send, does not fix.
//
//   node scripts/daily-pulse.mjs
//   node scripts/daily-pulse.mjs --dry-run
//
// --live sends the Chris SMS and (only if DARWIN_WHATSAPP is set) Darwin WhatsApp.
// Do not pass --live for prove. Do not point verify:e2e at the live database.
//
//   node scripts/daily-pulse.mjs --db
//
// --db also reads the database (DATABASE_URL from .env), so the Recon,
// unrecorded-calls and marketing-machine rows are real instead of "skip". It
// runs inside ONE `BEGIN READ ONLY` transaction that is rolled back — never a
// bare SET (a SET through the pooler stuck the live pool read-only once). It
// refuses --live: a dry run with real reads is the whole point.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isPidAlive,
  readHeartbeat,
  relayDirs
} from "./gate-relay/index.mjs";
import {
  defaultBoardDir,
  REPO_ROOT,
  runDailyPulse
} from "../src/pulse/daily-pulse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  return {
    dryRun: !argv.includes("--live"),
    startRelay: argv.includes("--start-relay"),
    readDb: argv.includes("--db")
  };
}

/* One read-only transaction for the whole run. staffScope mirrors asStaff on
   live: it marks the transaction as staff only while a machine row runs, then
   clears it, so the other rows read as the plain app connection does. */
export async function openReadOnlyDb({ connectionString = process.env.DATABASE_URL, Client = null } = {}) {
  if (!connectionString) throw new Error("--db needs DATABASE_URL (set in .env)");
  const C = Client || (await import("pg")).default.Client;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const client = new C({ connectionString, ssl: local ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const db = { query: (sql, params) => client.query(sql, params) };
  const staffScope = async (fn) => {
    await client.query("SELECT set_config('fundhub.actor', 'staff', true)");
    try {
      return await fn(db);
    } finally {
      await client.query("SELECT set_config('fundhub.actor', '', true)");
    }
  };
  const close = async () => {
    try {
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  };
  return { db, staffScope, close };
}

function startExistingRelay() {
  const child = spawn(process.execPath, [path.join(HERE, "gate-relay/index.mjs"), "watch"], {
    detached: true,
    stdio: "ignore",
    cwd: REPO_ROOT
  });
  child.unref();
  return child.pid;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { dryRun, startRelay, readDb } = parseArgs(argv);
  if (readDb && !dryRun) throw new Error("--db is a read-only dry run; it cannot be combined with --live");
  const dirs = deps.dirs || relayDirs();
  const hb = readHeartbeat(dirs);
  const alive = hb && hb.pid != null && isPidAlive(hb.pid);
  let relay = { running: Boolean(alive), started: false, pid: hb && hb.pid };
  if (!alive && startRelay) {
    // Turn the existing messenger on. Do not build a second tripwire.
    const pid = (deps.startRelay || startExistingRelay)();
    relay = { running: false, started: true, pid };
  }

  const ro = readDb && !deps.db ? await (deps.openDb || openReadOnlyDb)() : null;
  let result;
  try {
    result = await runDailyPulse({
      dryRun,
      env: deps.env || process.env,
      fetchImpl: deps.fetchImpl || globalThis.fetch,
      boardDir: deps.boardDir || defaultBoardDir(deps.env || process.env),
      db: deps.db || (ro && ro.db) || null,
      staffScope: deps.staffScope || (ro && ro.staffScope) || null,
      gateRelayDirs: dirs,
      sendSms: deps.sendSms,
      sendWhatsApp: deps.sendWhatsApp,
      recordRun: !dryRun
    });
  } finally {
    if (ro) await ro.close();
  }

  process.stdout.write(JSON.stringify({
    dryRun: result.dryRun,
    autoFix: result.autoFix,
    date: result.date,
    wrote: result.wrote,
    checks: result.checks
      .filter((c) => c.kind !== "registry")
      .map((c) => `${c.id}: ${c.status} — ${c.detail}`),
    findings: result.findings,
    suggestedFixes: result.suggestedFixes,
    sms: { sent: result.sms.sent, reason: result.sms.reason },
    darwin: { sent: result.darwin.sent, reason: result.darwin.reason },
    relay
  }, null, 2) + "\n");
  return { ...result, relay };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  import("./load-env.mjs").then(() => main()).catch((err) => {
    process.stderr.write(String((err && err.message) || err) + "\n");
    process.exitCode = 1;
  });
}
