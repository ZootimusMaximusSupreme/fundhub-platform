#!/usr/bin/env node
// npm run marketing:run-queue — run the dashboard's AI jobs with Claude Code on this Mac.
//
//   npm run marketing:run-queue            keep going: run what waits, then look every 60 s
//   npm run marketing:run-queue -- --once  run everything that waits now, then stop
//
// Set MARKETING_AI_RUNNER=local on Netlify first: then the site leaves the AI jobs queued
// ("Waiting for your Mac to run it.") and this picks them up. The work is
// src/marketing/run-queue.mjs; the Claude Code call is src/agents/claude-code.mjs.
//
// Reads the repo's .env (DATABASE_URL). Uses the `claude` command and Chris's Claude
// sign-in; the Anthropic API key is never handed to it, so nothing is billed to the API.
// Waiting script rows are written onto this checkout (no GitHub token). The same
// process accepts original video bytes into marketing/ads/filmed (no re-encode, no Drive).
// Ctrl-C stops cleanly: the job that was running goes back in the queue. Ctrl-C twice
// quits at once (a job left running is taken back by itself after 16 minutes).

import "./load-env.mjs";
import { db, close, dbTarget } from "../src/db.mjs";
import { makeQueueRunner } from "../src/marketing/run-queue.mjs";
import { findClaudeBinary } from "../src/agents/claude-code.mjs";
import { FILMED_PORT, filmedDir, startFilmedReceive } from "../src/marketing/filmed-receive.mjs";

const once = process.argv.includes("--once");
const stamp = () => new Date().toLocaleTimeString("en-US", { timeZone: "America/Phoenix", hour: "numeric", minute: "2-digit", second: "2-digit" });
const log = (line) => console.log(`${stamp()}  ${line}`);

if (!process.env.DATABASE_URL) {
  log("Stopped: DATABASE_URL is not in .env, so the queue cannot be read.");
  process.exit(1);
}
const bin = findClaudeBinary(process.env);
if (!bin) {
  log("Stopped: the claude command was not found. Install Claude Code, or put CLAUDE_CODE_BIN=<its path> in .env.");
  process.exit(1);
}

const runner = makeQueueRunner({ db, env: process.env, log });

const filmedPort = Number(process.env.FUNDHUB_FILMED_PORT) || FILMED_PORT;
/** @type {Awaited<ReturnType<typeof startFilmedReceive>> | null} */
let filmed = null;
try {
  filmed = await startFilmedReceive({ dir: filmedDir(), port: filmedPort, host: "0.0.0.0" });
  log(`Video files land in ${filmed.dir}`);
  log(`Phone push (original file, no re-encode): PUT http://${filmed.lan || "this Mac"}:${filmed.port}/takes/<file name>`);
} catch (err) {
  const code = err && typeof err === "object" && "code" in err ? /** @type {any} */ (err).code : "";
  if (code === "EADDRINUSE") log(`Video receive port ${filmedPort} is already open. Leaving it. Script files still copy.`);
  else log(`Video receive did not start (${String((err && err.message) || err).slice(0, 160)}). Script files still copy.`);
}

async function stopFilmed() {
  if (!filmed) return;
  const drop = filmed;
  filmed = null;
  await drop.close().catch(() => {});
}

let quitting = false;
async function quit(signal) {
  if (quitting) {
    log("Quit now. A job left running goes back in the queue by itself after 16 minutes.");
    process.exit(130);
  }
  quitting = true;
  log("Stopping. Putting the running job back in the queue...");
  try {
    const { requeued } = await runner.stop();
    log(requeued.length ? `Put back ${requeued.length} job(s). They run next time.` : "Nothing was running.");
  } catch (err) {
    log(`Could not put the job back (${String((err && err.message) || err).slice(0, 160)}). It goes back by itself after 16 minutes.`);
  }
  await stopFilmed();
  await close().catch(() => {});
  process.exit(signal === "SIGINT" ? 130 : 143);
}
process.on("SIGINT", () => { quit("SIGINT"); });
process.on("SIGTERM", () => { quit("SIGTERM"); });

log(`Mac queue runner on. Database ${dbTarget()}. Claude Code at ${bin}.`);
log(once ? "Running everything that waits now, then stopping." : "Running what waits, then looking every 60 seconds. Ctrl-C stops.");
try {
  const { ran } = await runner.run({ once });
  if (!quitting) {
    log(`Done. ${ran} job(s) ran.`);
    await stopFilmed();
    await close().catch(() => {});
    process.exit(0);
  }
} catch (err) {
  log(`Stopped on an error: ${String((err && err.message) || err).slice(0, 300)}`);
  await stopFilmed();
  await close().catch(() => {});
  process.exit(1);
}
