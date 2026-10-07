// @ts-check
// The Mac runner for the FinanceOS Money Helper: answers queued chat turns with
// Claude Code on Chris's Mac. Started by `npm run money:run-queue`
// (scripts/money-agent-run-queue.mjs). Same pattern as src/marketing/run-queue.mjs.
//
// WHAT IT DOES, in a loop:
//   * beats agent_bridge_heartbeats every 15 seconds while it runs — that beat
//     is how the app knows to queue a client's message for the Mac at all;
//   * takes back turns a stopped run left 'running' (src/finance/money-helper.mjs
//     reclaimStale); a turn that already had MAX_ATTEMPTS model tries is
//     answered by the rules brain instead of tried again;
//   * claims the oldest queued turn (FOR UPDATE SKIP LOCKED) and runs
//     processTurn — the same function the server path runs — with every model
//     call routed to Claude Code (routeModelCallsToClaudeCode). The child never
//     sees ANTHROPIC_API_KEY, so nothing is billed to the API;
//   * looks again at once after a turn, every 3 seconds when nothing waits.
//
// STOPPING (Ctrl-C): every turn this process holds goes back in the queue, the
// `claude` children are ended, and the heartbeat is marked stale so the app
// answers with rules at once instead of waiting on a computer that went away.

import os from "node:os";
import { claimNextTurn, requeueTurn, reclaimStale, processTurn, beat, bridgeOff, loadAgent } from "./money-helper.mjs";
import { routeModelCallsToClaudeCode, stopClaudeCodeCalls } from "../agents/claude-code.mjs";

/** How long to wait between looks when nothing was waiting. Short: a person is waiting on "Thinking…". */
export const POLL_MS = 3_000;
/** How often the heartbeat is written. src/finance/money-helper.mjs BRIDGE_FRESH_MS is four of these. */
export const BEAT_MS = 15_000;

const short = (id) => String(id || "").slice(0, 8);
const reasonOf = (err) => String((err && typeof err === "object" && "message" in err ? err.message : err) ?? "unknown error")
  .replace(/\s+/g, " ").trim().slice(0, 200) || "unknown error";
const secs = (ms) => `${Math.max(0, Math.round(ms / 1000))}s`;

/** A wait the stop() call can cut short. */
function realSleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, Math.max(0, ms));
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); resolve(undefined); }, { once: true });
  });
}

/**
 * makeHelperRunner({ db, env, log, deps }) → { run({ once }), stop(), running }
 * deps (tests): claimNextTurn, requeueTurn, reclaimStale, processTurn, beat, bridgeOff,
 * loadAgent, sleep, now, stopCalls, route, setInterval, clearInterval.
 * @param {{ db: any, env?: Record<string, any>, log?: (line: string) => void, deps?: any }} opts
 */
export function makeHelperRunner({ db, env = process.env, log = (l) => console.log(l), deps = {} }) {
  const claim = deps.claimNextTurn || claimNextTurn;
  const requeue = deps.requeueTurn || requeueTurn;
  const reclaim = deps.reclaimStale || reclaimStale;
  const runTurn = deps.processTurn || processTurn;
  const beatFn = deps.beat || beat;
  const offFn = deps.bridgeOff || bridgeOff;
  const agentOf = deps.loadAgent || loadAgent;
  const sleep = deps.sleep || realSleep;
  const now = deps.now || (() => new Date());
  const stopCalls = deps.stopCalls || stopClaudeCodeCalls;
  const route = deps.route || routeModelCallsToClaudeCode;
  const every = deps.setInterval || setInterval;
  const stopEvery = deps.clearInterval || clearInterval;

  let stopping = false;
  const ac = new AbortController();
  /** @type {Set<string>} turn ids this process holds */
  const running = new Set();
  /** @type {any} */
  let beatTimer = null;

  async function heartbeat() {
    try {
      await beatFn(db, { detail: { host: os.hostname(), pid: process.pid, running: running.size } });
    } catch (err) {
      log(`heartbeat not written: ${reasonOf(err)}`);
    }
  }

  /** @param {any} turn @param {{ useAi: boolean, fallbackReason?: string | null }} how */
  async function answer(turn, how) {
    running.add(String(turn.id));
    const t0 = Date.now();
    log(`turn ${short(turn.id)} (${turn.kind}) started`);
    try {
      const agent = await agentOf(db, { orgId: turn.org_id });
      const done = await runTurn(db, turn, { env, now: now(), useAi: how.useAi, fallbackReason: how.fallbackReason || null, agent });
      running.delete(String(turn.id));
      if (stopping) return;
      const why = done && done.reason ? ` (${String(done.reason).slice(0, 100)})` : "";
      log(`turn ${short(turn.id)} ${done && done.status === "failed" ? "failed" : `answered by ${(done && done.brain) || "?"}`} in ${secs(Date.now() - t0)}${why}`);
    } catch (err) {
      running.delete(String(turn.id));
      if (stopping) return;
      log(`turn ${short(turn.id)} stopped on an error: ${reasonOf(err)} — back in the queue`);
      await requeue(db, turn.id).catch(() => null);
    }
  }

  /** One look. Returns how many turns ran. */
  async function cycle() {
    const r = await reclaim(db, { now: now() });
    if (r && r.requeued) log(`took back ${r.requeued} turn(s) a stopped run left behind`);
    let ran = 0;
    for (const t of (r && r.giveUp) || []) {
      if (stopping) return ran;
      await answer(t, { useAi: false, fallbackReason: "ai_gave_up" });
      ran += 1;
    }
    if (stopping) return ran;
    const turn = await claim(db);
    if (!turn) return ran;
    await answer(turn, { useAi: true });
    return ran + 1;
  }

  return {
    running,
    get stopping() { return stopping; },

    /** Loop until stopped (or, with once, until a look finds nothing). */
    async run({ once = false } = {}) {
      route(true);
      await heartbeat();
      beatTimer = every(heartbeat, BEAT_MS);
      if (beatTimer && typeof beatTimer.unref === "function") beatTimer.unref();
      let total = 0;
      try {
        while (!stopping) {
          let ran = 0;
          try { ran = await cycle(); } catch (err) { if (!stopping) log(`problem: ${reasonOf(err)}`); }
          total += ran;
          if (stopping) break;
          if (ran > 0) continue;
          if (once) break;
          await sleep(POLL_MS, ac.signal);
        }
      } finally {
        stopEvery(beatTimer);
        if (!stopping) await offFn(db).catch(() => null);
      }
      return { ran: total };
    },

    /** Put what is running back in the queue, end the `claude` children, mark the bridge off. */
    async stop() {
      stopping = true;
      ac.abort();
      stopEvery(beatTimer);
      const back = [];
      for (const id of [...running]) {
        try {
          if (await requeue(db, id)) back.push(id);
        } catch (err) {
          log(`could not put ${short(id)} back (${reasonOf(err)}); it is taken back on its own after 10 minutes`);
        }
      }
      stopCalls();
      await offFn(db).catch(() => null);
      return { requeued: back };
    }
  };
}

export default makeHelperRunner;
