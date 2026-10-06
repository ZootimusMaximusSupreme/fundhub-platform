// The Mac queue runner (src/marketing/run-queue.mjs, `npm run marketing:run-queue`).
// The worker's real runPass, with a fake queue in memory and a FAKE `claude` command
// (src/agents/fixtures/fake-claude.mjs). No database, no network, no real Claude Code.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeQueueRunner, macAsk, POLL_MS } from "./run-queue.mjs";
import { AI_JOB_KINDS } from "./ai-runner.mjs";
import { callModel } from "../agents/model.mjs";
import { routeModelCallsToClaudeCode, claudeCodeRouting, CLAUDE_CODE } from "../agents/claude-code.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let dir;
let bin;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-queue-"));
  bin = path.join(dir, "claude");
  fs.copyFileSync(path.resolve(HERE, "../agents/fixtures/fake-claude.mjs"), bin);
  fs.chmodSync(bin, 0o755);
});
after(() => {
  routeModelCallsToClaudeCode(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** An in-memory marketing_jobs queue behind the worker's deps. */
function queueWorld(jobs) {
  const queue = jobs.map((j) => ({ status: "queued", attempts: 0, run_after: 0, ...j }));
  const calls = { claims: [], finished: [], failed: [], reclaim: [], requeued: [] };
  const passDeps = {
    claim: async ({ kinds, limit }) => {
      calls.claims.push([...kinds]);
      const out = [];
      for (const j of queue) {
        if (out.length >= limit) break;
        if (j.status === "queued" && kinds.includes(j.kind)) { j.status = "running"; out.push({ ...j }); }
      }
      return out;
    },
    finishJob: async (id, result) => {
      const j = queue.find((x) => x.id === id);
      if (!j || j.status !== "running") return null;
      j.status = "done"; j.result = result; calls.finished.push(id);
      return { ...j };
    },
    failJob: async (id, err) => {
      const j = queue.find((x) => x.id === id);
      calls.failed.push({ id, error: String(err && err.message) });
      if (j) j.status = "failed";
      return j ? { ...j } : null;
    },
    reclaimStale: async (opts) => { calls.reclaim.push(opts); return []; },
    nextRunAfter: async () => null
  };
  const requeueJob = async (_db, id) => {
    calls.requeued.push(id);
    const j = queue.find((x) => x.id === id);
    if (j && j.status === "running") { j.status = "queued"; return { ...j }; }
    return null;
  };
  return { queue, calls, passDeps, requeueJob };
}

const noOffers = { query: async () => ({ rows: [] }) };

/* A clock for passes whose job never ends (the Ctrl-C tests): each wait takes a few
   real milliseconds and moves the pass's clock the whole way, so the pass reaches its
   own 14-minute limit in well under a second instead of holding the test open. */
function fastClock() {
  let t = Date.parse("2026-10-12T15:00:00.000Z");
  return {
    now: () => new Date(t),
    sleep: (ms, signal) => new Promise((resolve) => {
      const h = setTimeout(() => { t += ms; resolve(undefined); }, 5);
      if (signal) signal.addEventListener("abort", () => { clearTimeout(h); resolve(undefined); }, { once: true });
    })
  };
}

describe("makeQueueRunner — the AI jobs, with the worker's own pass", () => {
  test("--once: runs every queued AI job through Claude Code, one line each, then stops", async () => {
    const w = queueWorld([
      { id: "aaaaaaaa-1", kind: "write_slot" },
      { id: "bbbbbbbb-2", kind: "avatar" }
    ]);
    const log = path.join(dir, "once.jsonl");
    const hostEnv = { PATH: process.env.PATH, HOME: process.env.HOME, FAKE_CLAUDE_MODE: "text", FAKE_CLAUDE_LOG: log, ANTHROPIC_API_KEY: "sk-ant-x" };
    const registry = {
      // A handler that calls the model the way the real ones do: provider 'anthropic'.
      write_slot: { group: "writer", load: async () => ({ run: async () => {
        const out = await callModel({ provider: "anthropic", model: "claude-opus-5-5", user: "write it", hostEnv, findBinary: () => bin });
        return { text: out.text, served: out.servedModel };
      } }) },
      avatar: { group: "research", load: async () => ({ run: async () => { throw new Error("boom"); } }) }
    };
    const lines = [];
    let copyOpts = null;
    const runner = makeQueueRunner({
      db: noOffers, env: {}, log: (l) => lines.push(l),
      deps: {
        registry, passDeps: w.passDeps, requeueJob: w.requeueJob,
        runDue: async (_db, opts) => { copyOpts = opts; return { jobs: [] }; }
      }
    });
    const out = await runner.run({ once: true });
    routeModelCallsToClaudeCode(false);

    assert.equal(out.ran, 2);
    const done = w.queue.find((j) => j.id === "aaaaaaaa-1");
    assert.equal(done.status, "done");
    assert.deepEqual(done.result, { text: "Hello from the fake.", served: CLAUDE_CODE });
    assert.deepEqual(w.calls.failed, [{ id: "bbbbbbbb-2", error: "boom" }], "a handler that throws fails through the worker's failJob");
    assert.deepEqual(w.calls.reclaim, [{ olderThanMin: 16, kinds: [...AI_JOB_KINDS] }, { olderThanMin: 16, kinds: [...AI_JOB_KINDS] }]);
    for (const kinds of w.calls.claims) for (const k of kinds) assert.ok(AI_JOB_KINDS.includes(k), `only AI kinds are claimed (got ${k})`);
    assert.deepEqual(copyOpts.assetKinds, ["copy"]);

    assert.ok(lines.includes("write_slot aaaaaaaa started"));
    assert.ok(lines.some((l) => /^write_slot aaaaaaaa done in \d+s$/.test(l)));
    assert.ok(lines.some((l) => /^avatar bbbbbbbb failed after \d+s: boom$/.test(l)));
    const runs = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(runs.length, 1, "one claude -p for the one model call");
    assert.equal(runs[0].anthropicKey, false);
  });

  test("the Write offer jobs run with Claude Code's ask and model claude-code", async () => {
    const offerCalls = [];
    let gave = false;
    const db = { query: async (sql) => {
      if (/kind = 'offer' AND status = 'queued'/.test(sql) && !gave) { gave = true; return { rows: [{ id: "cccccccc-3", org_id: "org-1" }] }; }
      return { rows: [] };
    } };
    const lines = [];
    const runner = makeQueueRunner({
      db, env: {}, log: (l) => lines.push(l),
      deps: {
        registry: {}, passDeps: queueWorld([]).passDeps, route: () => {},
        runOfferJob: async (_db, o) => { offerCalls.push(o); return { ok: true, status: "done" }; },
        runDue: async () => ({ jobs: [] })
      }
    });
    const out = await runner.run({ once: true });
    assert.equal(out.ran, 1);
    assert.equal(offerCalls.length, 1);
    assert.equal(offerCalls[0].jobId, "cccccccc-3");
    assert.equal(offerCalls[0].orgId, "org-1");
    assert.equal(offerCalls[0].modelName, CLAUDE_CODE);
    assert.equal(typeof offerCalls[0].ask, "function");
    assert.ok(lines.some((l) => /^offer cccccccc done in \d+s$/.test(l)));
  });

  test("Write ad copy jobs: only the copy kind, one line each", async () => {
    const lines = [];
    let calls = 0;
    const runner = makeQueueRunner({
      db: noOffers, env: {}, log: (l) => lines.push(l),
      deps: {
        registry: {}, passDeps: queueWorld([]).passDeps, route: () => {},
        runDue: async (_db, o) => {
          calls += 1;
          assert.deepEqual(o.assetKinds, ["copy"]);
          return { jobs: calls === 1 ? [{ job_id: "dddddddd-4", status: "succeeded" }, { job_id: "eeeeeeee-5", status: "failed", error: "no provider" }] : [] };
        }
      }
    });
    const out = await runner.run({ once: true });
    assert.equal(out.ran, 2);
    assert.ok(lines.includes("ad copy dddddddd done"));
    assert.ok(lines.includes("ad copy eeeeeeee failed: no provider"));
  });

  test("not --once: an empty look waits 60 seconds, then looks again", async () => {
    const sleeps = [];
    let runner;
    runner = makeQueueRunner({
      db: noOffers, env: {}, log: () => {},
      deps: {
        registry: {}, passDeps: queueWorld([]).passDeps, route: () => {}, runDue: async () => ({ jobs: [] }),
        sleep: async (ms) => { sleeps.push(ms); if (sleeps.length === 2) await runner.stop(); }
      }
    });
    await runner.run({ once: false });
    assert.deepEqual(sleeps, [POLL_MS, POLL_MS]);
    assert.equal(POLL_MS, 60_000);
  });
});

describe("Ctrl-C", () => {
  test("stop() puts the running job back in the queue, ends the claude calls, and the cut-off job is never counted as a failed try", async () => {
    const w = queueWorld([{ id: "ffffffff-6", kind: "deep_research" }]);
    let release;
    let started;
    const startedP = new Promise((r) => { started = r; });
    const registry = {
      deep_research: { group: "research", load: async () => ({ run: () => { started(); return new Promise((_, rej) => { release = rej; }); } }) }
    };
    let stopped = 0;
    const runner = makeQueueRunner({
      db: noOffers, env: {}, log: () => {},
      deps: { registry, passDeps: { ...w.passDeps, ...fastClock() }, requeueJob: w.requeueJob, route: () => {}, stopCalls: () => { stopped += 1; return 1; }, runDue: async () => ({ jobs: [] }) }
    });
    runner.run({ once: true });
    await startedP;
    assert.equal(runner.running.get("ffffffff-6"), "job");
    const out = await runner.stop();
    assert.deepEqual(out.requeued, ["ffffffff-6"]);
    assert.equal(stopped, 1);
    assert.equal(w.queue[0].status, "queued", "back in the queue: the next run picks it up");
    release(new Error("killed by Ctrl-C"));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(w.calls.failed, [], "the killed call is not a failed try");
  });

  test("a running offer goes back to queued too", async () => {
    const seen = [];
    let release;
    let started;
    const startedP = new Promise((r) => { started = r; });
    let gave = false;
    const db = { query: async (sql, params) => {
      seen.push({ sql, params });
      if (/kind = 'offer' AND status = 'queued'/.test(sql) && !gave) { gave = true; return { rows: [{ id: "99999999-7", org_id: "o" }] }; }
      if (/SET status = 'queued', claimed_at = NULL/.test(sql)) return { rows: [{ id: params[0] }] };
      return { rows: [] };
    } };
    const runner = makeQueueRunner({
      db, env: {}, log: () => {},
      deps: {
        registry: {}, passDeps: queueWorld([]).passDeps, route: () => {}, stopCalls: () => 0,
        runOfferJob: () => { started(); return new Promise((r) => { release = r; }); },
        runDue: async () => ({ jobs: [] })
      }
    });
    runner.run({ once: true });
    await startedP;
    const out = await runner.stop();
    assert.deepEqual(out.requeued, ["99999999-7"]);
    const back = seen.find((s) => /SET status = 'queued', claimed_at = NULL/.test(s.sql));
    assert.match(back.sql, /kind = 'offer' AND status = 'running'/);
    release({ ok: false });
  });
});

describe("macAsk", () => {
  test("shapes a Claude Code answer the way the offer writer reads askAnthropic", async () => {
    const asked = [];
    const ask = macAsk(async (args) => { asked.push(args); return { mode: "live", text: "T", error: null, status: 200, stopReason: "end_turn", usage: { input_tokens: 1, output_tokens: 2 } }; });
    const out = await ask({ system: "S", user: "U", maxTokens: 10, timeoutMs: 1000 });
    assert.deepEqual(asked, [{ provider: "claude-code", system: "S", user: "U", maxTokens: 10, timeoutMs: 1000 }]);
    assert.deepEqual(out, { text: "T", error: null, status: 200, mode: "live", usage: { input_tokens: 1, output_tokens: 2 }, model: "claude-code", stopReason: "end_turn", timedOut: false });
    const slow = await macAsk(async () => ({ mode: "live", text: null, error: "claude-code timeout: no answer", usage: null }))({});
    assert.equal(slow.timedOut, true);
  });

  test("the switch is off unless the runner turned it on", () => {
    assert.equal(claudeCodeRouting(), false);
  });
});
