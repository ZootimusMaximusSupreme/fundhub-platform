#!/usr/bin/env node
// npm run money:run-queue — the FinanceOS Money Helper thinks with Claude Code on this Mac.
//
//   npm run money:run-queue            keep going: answer what waits, then look every 3 s
//   npm run money:run-queue -- --once  answer everything that waits now, then stop
//
// While this runs, a client's message in the money helper (/app/money-helper.html,
// GET/POST /api/money/helper) is queued for this Mac and answered here by the AI
// brain (src/finance/money-agent-ai.mjs) through the shared model client — the same
// code the server runs once the API has credit (MONEY_HELPER_RUNNER=server). With
// this off, the app answers with the rules brain at once and says so.
// The work is src/finance/money-helper-runner.mjs.
//
// Reads the repo's .env (DATABASE_URL). Uses the `claude` command and Chris's
// Claude sign-in; the Anthropic API key is never handed to it, so nothing is
// billed to the API. The helper is shadow: it never texts anyone.
// Ctrl-C stops cleanly: the turn that was running goes back in the queue.

import "./load-env.mjs";
import { db, close, dbTarget } from "../src/db.mjs";
import { makeHelperRunner } from "../src/finance/money-helper-runner.mjs";
import { findClaudeBinary } from "../src/agents/claude-code.mjs";

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

const runner = makeHelperRunner({ db, env: process.env, log });

let quitting = false;
async function quit(signal) {
  if (quitting) {
    log("Quit now. A turn left running goes back in the queue by itself after 10 minutes.");
    process.exit(130);
  }
  quitting = true;
  log("Stopping. Putting the running turn back in the queue...");
  try {
    const { requeued } = await runner.stop();
    log(requeued.length ? `Put back ${requeued.length} turn(s). They run next time.` : "Nothing was running.");
  } catch (err) {
    log(`Could not put the turn back (${String((err && err.message) || err).slice(0, 160)}). It goes back by itself after 10 minutes.`);
  }
  await close().catch(() => {});
  process.exit(signal === "SIGINT" ? 130 : 143);
}
process.on("SIGINT", () => { quit("SIGINT"); });
process.on("SIGTERM", () => { quit("SIGTERM"); });

log(`Money helper runner on. Database ${dbTarget()}. Claude Code at ${bin}.`);
log(once ? "Answering everything that waits now, then stopping." : "Answering what waits, then looking every 3 seconds. Ctrl-C stops.");
try {
  const { ran } = await runner.run({ once });
  if (!quitting) {
    log(`Done. ${ran} turn(s) answered.`);
    await close().catch(() => {});
    process.exit(0);
  }
} catch (err) {
  log(`Stopped on an error: ${String((err && err.message) || err).slice(0, 300)}`);
  await close().catch(() => {});
  process.exit(1);
}
