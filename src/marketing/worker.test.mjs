// The marketing worker (src/marketing/worker.mjs, netlify/functions/marketing-worker-background.mjs).
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Steps 2 and 4. Plan unit U22.
//
// Whole passes on a FAKE CLOCK with fake deps: no database, no network, no texts.
// sleep() moves the fake clock forward, so a nine-minute pass runs in milliseconds.
// The real SQL runs against Postgres in src/http/marketing-health.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  runPass, makeWorkerHandler, secretMatches, claimForGroup, drainSummary, heldReasonOf,
  drainWorthRetrying, groupKinds, STOP_TAKING_MS, DRAIN_EVERY_MS, GROUP_CAPS, AUTH_HEADER
} from "./worker.mjs";

const T0 = Date.parse("2026-10-12T15:00:00.000Z");
const MIN = 60 * 1000;

/**
 * A fake world: a clock, a job queue, an outbox and a drain heartbeat.
 * jobs: [{ id, kind, run_after? (ms from T0), status? }]
 */
function world({ jobs = [], drainResult = { skipped: "empty" }, outboxWaiting = () => 0, lastDrain = null } = {}) {
  const clock = { t: T0, waiters: [] };
  const advance = (ms) => {
    clock.t += ms;
    const due = clock.waiters.filter((w) => w.at <= clock.t);
    clock.waiters = clock.waiters.filter((w) => w.at > clock.t);
    for (const w of due) w.resolve();
  };
  /** A promise that resolves once the fake clock has moved `ms` forward. */
  const after = (ms) => new Promise((resolve) => clock.waiters.push({ at: clock.t + ms, resolve }));

  const queue = jobs.map((j) => ({
    status: "queued", attempts: 0, ...j,
    run_after: T0 + (j.run_after || 0), created_at: T0
  }));
  const hb = { drain: lastDrain ? { at: T0 + lastDrain.ago, detail: lastDrain.detail } : null };
  const calls = {
    beats: [], reclaim: [], drains: [], buzzes: [], claims: [], finished: [], failed: [],
    next: [], wakes: 0, sleeps: []
  };
  const isDue = (j, kinds) => j.status === "queued" && j.run_after <= clock.t && kinds.includes(j.kind);

  const deps = {
    beat: async (name, detail) => { calls.beats.push({ name, detail, at: clock.t }); },
    lastDrain: async () => ({ at: hb.drain ? new Date(hb.drain.at) : null, detail: hb.drain ? hb.drain.detail : null }),
    outboxWaiting: async () => outboxWaiting(clock.t - T0),
    reclaimStale: async (opts) => { calls.reclaim.push(opts); return []; },
    drainOutbox: async () => { calls.drains.push(clock.t - T0); return typeof drainResult === "function" ? drainResult(clock.t - T0) : drainResult; },
    recordDrain: async (result) => { hb.drain = { at: clock.t, detail: drainSummary(result) }; },
    sendDueBuzzes: async () => { calls.buzzes.push(clock.t - T0); return { sent: 0, retrying: 0, gave_up: 0, skipped: 0 }; },
    // Deliberately does NOT drop 'offer' by itself: the worker must never ask for it.
    claim: async ({ group, kinds, limit }) => {
      calls.claims.push({ group, kinds: [...kinds], limit, at: clock.t - T0 });
      const out = [];
      for (const j of queue) {
        if (out.length >= limit) break;
        if (isDue(j, kinds)) { j.status = "running"; out.push({ ...j }); }
      }
      return out;
    },
    finishJob: async (id, result) => {
      const j = queue.find((x) => x.id === id);
      if (!j || j.status !== "running") return null;
      j.status = "done"; j.result = result;
      calls.finished.push(id);
      return { ...j };
    },
    failJob: async (id, err, opts) => {
      const j = queue.find((x) => x.id === id);
      calls.failed.push({ id, error: String(err && err.message), final: opts.final });
      if (j) { j.status = "failed"; j.error = String(err && err.message); }
      return j ? { ...j } : null;
    },
    nextRunAfter: async ({ kinds }) => {
      calls.next.push([...kinds]);
      const times = queue.filter((j) => j.status === "queued" && kinds.includes(j.kind)).map((j) => j.run_after);
      return times.length ? new Date(Math.min(...times)) : null;
    },
    wake: async () => { calls.wakes += 1; return { ok: true, started: true, status: 202, reason: null }; },
    now: () => new Date(clock.t),
    /* A fake wait. It lets every pending promise settle first; if the race it was part
       of has already ended (a job finished first and the worker aborted the wait), the
       clock does not move — exactly as a real timer that was cleared. */
    sleep: async (ms, signal) => {
      await new Promise((r) => setImmediate(r));
      if (signal && signal.aborted) return;
      calls.sleeps.push(ms);
      advance(ms);
      await new Promise((r) => setImmediate(r));
    },
    log: () => {}
  };

  /** Re-queue a running job `ms` from now (what a handler's requeueJob does). */
  const requeue = (id, ms) => {
    const j = queue.find((x) => x.id === id);
    j.status = "queued"; j.run_after = clock.t + ms;
  };

  return { clock, after, queue, calls, deps, requeue, elapsed: () => clock.t - T0 };
}

const handler = (run) => ({ load: async () => ({ run }) });

describe("runPass: order and the reclaim", () => {
  test("beats 'worker' first, then takes back claims older than 16 minutes, before any claim", async () => {
    const w = world({ jobs: [{ id: "j1", kind: "write_slot" }] });
    const order = [];
    const deps = {
      ...w.deps,
      beat: async (name, detail) => { order.push(`beat:${name}:${detail.state}`); },
      reclaimStale: async (opts) => { order.push(`reclaim:${opts.olderThanMin}`); return [{ id: "old", kind: "write_slot" }]; },
      claim: async (opts) => { order.push("claim"); return w.deps.claim(opts); }
    };
    const registry = { write_slot: { group: "writer", ...handler(async () => ({ ok: 1 })) } };
    const s = await runPass({ deps, registry });
    assert.deepEqual(order.slice(0, 3), ["beat:worker:running", "reclaim:16", "claim"]);
    assert.equal(order.at(-1), "beat:worker:done");
    assert.equal(s.reclaimed, 1);
    assert.equal(s.done, 1);
    assert.equal(s.stopped, "idle");
  });
});

describe("runPass: the outbox drain, at most once a minute", () => {
  test("a pass that runs 4 minutes drains at 0, 1, 2, 3 and 4 minutes — never closer than a minute — and records each on the heartbeat", async () => {
    const w = world({ jobs: [{ id: "long", kind: "write_slot" }], drainResult: { committed_sha: "a".repeat(40), ids: [1] } });
    const registry = { write_slot: { group: "writer", ...handler(async () => { await w.after(4 * MIN); return {}; }) } };
    const recorded = [];
    const deps = { ...w.deps, recordDrain: async (r) => { recorded.push(r); return w.deps.recordDrain(r); } };
    const s = await runPass({ deps, registry });
    assert.deepEqual(w.calls.drains, [0, 1, 2, 3, 4].map((m) => m * MIN));
    for (let i = 1; i < w.calls.drains.length; i++) {
      assert.ok(w.calls.drains[i] - w.calls.drains[i - 1] >= DRAIN_EVERY_MS);
    }
    assert.equal(recorded.length, 5, "every drain is recorded on the outbox_drain heartbeat");
    assert.equal(s.drains, 5);
    assert.equal(s.last_drain.committed_sha, "a".repeat(40));
  });

  test("another pass drained 30 seconds ago: this pass waits for the minute, then drains the waiting save", async () => {
    let drained = false;
    const w = world({
      lastDrain: { ago: -30 * 1000, detail: { committed_sha: "b".repeat(40), held_reason: null } },
      drainResult: () => { drained = true; return { committed_sha: "c".repeat(40), ids: [7] }; },
      outboxWaiting: () => (drained ? 0 : 1)
    });
    const s = await runPass({ deps: w.deps, registry: {} });
    assert.deepEqual(w.calls.drains, [30 * 1000]);
    assert.equal(s.stopped, "idle");
    assert.equal(w.calls.wakes, 0);
  });

  test("saves held for no token: one drain, no waiting for the next minute, no re-wake", async () => {
    const w = world({ drainResult: { skipped: "no_token" }, outboxWaiting: () => 3 });
    const s = await runPass({ deps: w.deps, registry: {} });
    assert.deepEqual(w.calls.drains, [0]);
    assert.equal(s.stopped, "idle");
    assert.equal(s.last_drain.held_reason, "no_token");
    assert.equal(w.calls.wakes, 0);
    assert.ok(w.elapsed() < MIN);
  });
});

describe("runPass: buzzes", () => {
  test("sends the due buzzes at the start of a pass and every 30 seconds while it runs", async () => {
    const w = world({ jobs: [{ id: "j", kind: "write_slot" }] });
    const registry = { write_slot: { group: "writer", ...handler(async () => { await w.after(2 * MIN); return {}; }) } };
    await runPass({ deps: w.deps, registry });
    assert.equal(w.calls.buzzes[0], 0);
    for (let i = 1; i < w.calls.buzzes.length; i++) assert.ok(w.calls.buzzes[i] - w.calls.buzzes[i - 1] >= 30 * 1000);
    assert.ok(w.calls.buzzes.length >= 4, `buzzes checked ${w.calls.buzzes.length} times in 2 minutes`);
  });

  test("the real deps hand sendDueBuzzes the send() passed in — never a real text from a test", async () => {
    const sent = [];
    const send = async (m) => { sent.push(m); return { ok: true, status: "sent" }; };
    const due = { id: "b1", org_id: "o", kind: "scripts_ready", body: "Your scripts are ready.", attempts: 0 };
    let leased = false;
    const db = {
      query: async (sql) => {
        if (/FROM marketing_settings LIMIT 2/.test(sql)) return { rows: [{ quiet_start: "21:00:00", quiet_end: "07:00:00", timezone: "America/Phoenix" }] };
        if (/SELECT DISTINCT ON \(b\.org_id, b\.kind\)/.test(sql)) return { rows: [due] };
        if (/SET attempts = attempts \+ 1/.test(sql)) { leased = true; return { rows: [{ attempts: 1 }] }; }
        if (/SET sent_at/.test(sql)) return { rows: [] };
        if (/FROM \(\s*SELECT org_id FROM marketing_settings/.test(sql)) return { rows: [] };
        if (/FROM marketing_heartbeats/.test(sql)) return { rows: [] };
        if (/FROM repo_outbox/.test(sql)) return { rows: [{ n: 0 }] };
        if (/UPDATE marketing_jobs/.test(sql)) return { rows: [] };
        throw new Error(`unexpected SQL in this test: ${sql.slice(0, 80)}`);
      }
    };
    const clock = { t: T0 };
    const s = await runPass({
      db, env: {}, send, registry: {},
      deps: { now: () => new Date(clock.t), sleep: async (ms) => { clock.t += ms; }, wake: async () => { throw new Error("no wake expected"); }, log: () => {} }
    });
    assert.equal(leased, true);
    assert.deepEqual(sent, [{ id: "b1", notification: { title: "Your scripts are ready.", body: "Your scripts are ready." } }]);
    assert.equal(s.buzzes.sent, 1);
    assert.equal(s.last_drain.held_reason, "no_token", "no GITHUB_REPO_TOKEN in env: the real drain says no_token without a call");
    assert.deepEqual(s.errors, []);
  });
});

describe("runPass: jobs", () => {
  test("runs at most 3 writer-group jobs at once (5 queued: 3, then 2), and every one finishes", async () => {
    const ids = ["w1", "w2", "w3", "w4", "w5"];
    const w = world({ jobs: ids.map((id) => ({ id, kind: "write_slot" })) });
    let running = 0;
    let most = 0;
    const registry = {
      write_slot: {
        group: "writer",
        ...handler(async () => { running += 1; most = Math.max(most, running); await w.after(40 * 1000); running -= 1; return { written: true }; })
      }
    };
    const s = await runPass({ deps: w.deps, registry });
    assert.equal(most, 3);
    assert.equal(GROUP_CAPS.writer, 3);
    assert.deepEqual(w.calls.finished.sort(), ids);
    assert.equal(s.done, 5);
    assert.ok(w.calls.claims.every((c) => c.limit <= 3), JSON.stringify(w.calls.claims));
  });

  test("other groups run 1 at a time each", async () => {
    const w = world({ jobs: [{ id: "l1", kind: "meta_load" }, { id: "l2", kind: "meta_load" }, { id: "s1", kind: "start_batch" }, { id: "s2", kind: "start_batch" }] });
    const now = { loader: 0, system: 0 };
    const most = { loader: 0, system: 0 };
    const job = (g) => handler(async () => { now[g] += 1; most[g] = Math.max(most[g], now[g]); await w.after(20 * 1000); now[g] -= 1; return {}; });
    const registry = { meta_load: { group: "loader", ...job("loader") }, start_batch: { group: "system", ...job("system") } };
    const s = await runPass({ deps: w.deps, registry });
    assert.deepEqual(most, { loader: 1, system: 1 });
    assert.equal(s.done, 4);
  });

  test("queue empty but a job re-queued 10 s out: the pass waits 10 s and runs it again in the same pass", async () => {
    const w = world({ jobs: [{ id: "poll", kind: "meta_video_poll" }] });
    let runs = 0;
    const registry = {
      meta_video_poll: {
        group: "loader",
        ...handler(async (job) => {
          runs += 1;
          if (runs === 1) { w.requeue(job.id, 10 * 1000); return { polling: true }; }
          return { ready: true };
        })
      }
    };
    const s = await runPass({ deps: w.deps, registry });
    assert.equal(runs, 2);
    assert.ok(w.calls.sleeps.includes(10 * 1000), `waited ${JSON.stringify(w.calls.sleeps)}`);
    assert.equal(s.handed_back, 1, "the first run handed its job back (re-queued)");
    assert.equal(s.done, 1);
    assert.equal(s.stopped, "idle");
    assert.equal(w.calls.wakes, 0, "nothing left: no re-wake");
    assert.ok(w.elapsed() < MIN);
  });

  test("a job due after minute 9 is not waited for (the clock or a re-wake takes it)", async () => {
    const w = world({ jobs: [{ id: "later", kind: "write_slot", run_after: 20 * MIN }] });
    const registry = { write_slot: { group: "writer", ...handler(async () => ({})) } };
    const s = await runPass({ deps: w.deps, registry });
    assert.equal(s.stopped, "idle");
    assert.equal(s.claimed, 0);
    assert.ok(w.elapsed() < MIN);
    assert.equal(w.calls.wakes, 0, "20 minutes out is past the next pass's 9 minutes: no re-wake");
  });

  test("stops taking work at minute 9 and wakes itself when work is left", async () => {
    const w = world({ jobs: [{ id: "poll", kind: "meta_video_poll" }] });
    let runs = 0;
    const registry = {
      meta_video_poll: { group: "loader", ...handler(async (job) => { runs += 1; w.requeue(job.id, 10 * 1000); return {}; }) }
    };
    const s = await runPass({ deps: w.deps, registry });
    // The last re-queue lands exactly on minute 9, so the pass ends at 8:50 without
    // waiting for it ('idle'), or at minute 9 itself — either way nothing is taken after.
    assert.ok(["minute_9", "idle"].includes(String(s.stopped)));
    assert.ok(w.elapsed() >= STOP_TAKING_MS - 15 * 1000, `ran ${w.elapsed() / 1000}s`);
    assert.ok(w.elapsed() <= STOP_TAKING_MS, `ran ${w.elapsed() / 1000}s`);
    assert.ok(runs >= 50, `re-ran the poll ${runs} times in 9 minutes`);
    const lastClaim = Math.max(...w.calls.claims.map((c) => c.at));
    assert.ok(lastClaim < STOP_TAKING_MS, "no claim at or after minute 9");
    assert.equal(s.rewoke, true);
    assert.equal(w.calls.wakes, 1);
  });

  test("a job still running at minute 9 is allowed to finish; nothing new is taken", async () => {
    const w = world({ jobs: [{ id: "a", kind: "write_slot" }, { id: "b", kind: "write_slot", run_after: 9.5 * MIN }] });
    const registry = {
      write_slot: { group: "writer", ...handler(async (job) => { if (job.id === "a") await w.after(10 * MIN); return {}; }) }
    };
    const s = await runPass({ deps: w.deps, registry });
    assert.equal(s.stopped, "minute_9");
    assert.deepEqual(w.calls.finished, ["a"], "the job running at minute 9 finished");
    assert.ok(w.elapsed() >= 10 * MIN, "the pass waited for it");
    assert.equal(w.queue.find((j) => j.id === "b").status, "queued", "b came due at 9:30 and was not taken");
    assert.ok(w.calls.claims.every((c) => c.at < STOP_TAKING_MS));
    assert.equal(s.rewoke, true, "b is left, so the next pass is woken");
    assert.equal(w.calls.wakes, 1);
  });

  test("a job that never ends: the pass gives up waiting at minute 14 and still writes its last heartbeat", async () => {
    const w = world({ jobs: [{ id: "hang", kind: "write_slot" }] });
    const registry = { write_slot: { group: "writer", ...handler(() => new Promise(() => {})) } };
    const s = await runPass({ deps: w.deps, registry });
    assert.equal(s.stopped, "minute_9");
    assert.equal(s.still_running, 1);
    assert.ok(w.elapsed() >= 14 * MIN && w.elapsed() < 15 * MIN, `returned at ${w.elapsed() / 1000}s`);
    assert.equal(w.calls.beats.at(-1).detail.state, "done");
    assert.equal(w.queue.find((j) => j.id === "hang").status, "running", "left for reclaimStale (16 minutes)");
  });

  test("a handler that throws fails the job with its reason; final:true is passed on", async () => {
    const w = world({ jobs: [{ id: "x", kind: "write_slot" }, { id: "y", kind: "write_slot" }] });
    const registry = {
      write_slot: {
        group: "writer",
        ...handler(async (job) => {
          if (job.id === "x") throw new Error("the model took longer than 5 minutes");
          throw Object.assign(new Error("cost cap reached"), { final: true });
        })
      }
    };
    const s = await runPass({ deps: w.deps, registry });
    assert.equal(s.failed, 2);
    const byId = Object.fromEntries(w.calls.failed.map((f) => [f.id, f]));
    assert.deepEqual(byId.x, { id: "x", error: "the model took longer than 5 minutes", final: false });
    assert.deepEqual(byId.y, { id: "y", error: "cost cap reached", final: true });
  });
});

describe("runPass: never 'offer'", () => {
  test("'offer' in the registry by mistake is never asked for, waited for or run", async () => {
    const w = world({ jobs: [{ id: "off", kind: "offer" }, { id: "ok", kind: "write_slot" }] });
    let offerRan = false;
    const registry = {
      offer: { group: "system", ...handler(async () => { offerRan = true; return {}; }) },
      write_slot: { group: "writer", ...handler(async () => ({})) }
    };
    assert.deepEqual([...groupKinds(registry).entries()], [["writer", ["write_slot"]]]);
    await runPass({ deps: w.deps, registry });
    assert.equal(offerRan, false);
    assert.ok(w.calls.claims.length > 0);
    assert.ok(w.calls.claims.every((c) => !c.kinds.includes("offer")), JSON.stringify(w.calls.claims));
    assert.ok(w.calls.next.every((k) => !k.includes("offer")));
    assert.equal(w.queue.find((j) => j.id === "off").status, "queued", "the offer row was never touched");
  });

  test("a claim that hands back an offer row anyway is refused, never run", async () => {
    const w = world({});
    let ran = false;
    const registry = { write_slot: { group: "writer", ...handler(async () => { ran = true; return {}; }) } };
    let once = true;
    const deps = { ...w.deps, claim: async () => (once ? (once = false, [{ id: "o1", kind: "offer" }]) : []) };
    const s = await runPass({ deps, registry });
    assert.equal(ran, false);
    assert.equal(s.claimed, 0);
  });

  test("claimForGroup: one short transaction — a transaction-scoped lock, the group's running count, then a claim that excludes offer", async () => {
    const seen = [];
    const db = {
      query: async (sql, params) => {
        seen.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
        if (/count\(\*\)::int AS n/.test(sql)) return { rows: [{ n: 1 }] };
        if (/WITH picked AS/.test(sql)) return { rows: [{ id: "j", kind: "write_slot", run_after: new Date(), created_at: new Date() }] };
        return { rows: [] };
      }
    };
    const out = await claimForGroup(db, { group: "writer", kinds: ["write_slot", "offer"], limit: 3 });
    assert.equal(out.length, 1);
    assert.match(seen[0].sql, /^SELECT pg_advisory_xact_lock\(/, "a transaction-scoped lock, never a session lock");
    assert.doesNotMatch(seen.map((s) => s.sql).join(" "), /pg_advisory_lock\(|pg_try_advisory_lock\(/);
    assert.match(seen[1].sql, /status = 'running' AND kind <> 'offer'/);
    assert.deepEqual(seen[1].params, [["write_slot"]]);
    assert.match(seen[2].sql, /FOR UPDATE SKIP LOCKED/);
    assert.match(seen[2].sql, /kind <> 'offer'/);
    assert.deepEqual(seen[2].params, [2, ["write_slot"], ["offer"]], "3 allowed, 1 already running → claim 2");
  });

  test("claimForGroup claims nothing when the group is full across passes", async () => {
    const seen = [];
    const db = { query: async (sql) => { seen.push(sql); return { rows: [{ n: 3 }] }; } };
    assert.deepEqual(await claimForGroup(db, { group: "writer", kinds: ["write_slot"], limit: 3 }), []);
    assert.equal(seen.length, 2);
  });

  test("the real reclaim never touches 'offer' and waits 16 minutes", async () => {
    const seen = [];
    const db = {
      query: async (sql, params) => {
        seen.push({ sql, params });
        if (/FROM repo_outbox/.test(sql)) return { rows: [{ n: 0 }] };
        return { rows: [] };
      }
    };
    const clock = { t: T0 };
    await runPass({
      db, env: {}, registry: {}, send: async () => ({ ok: true, status: "sent" }),
      deps: { now: () => new Date(clock.t), sleep: async (ms) => { clock.t += ms; }, log: () => {} }
    });
    const reclaim = seen.find((x) => /UPDATE marketing_jobs/.test(x.sql) && /status = 'running'/.test(x.sql));
    assert.ok(reclaim, "the pass ran reclaimStale");
    assert.match(reclaim.sql, /kind <> 'offer'/);
    assert.deepEqual(reclaim.params, [16]);
  });
});

describe("the door", () => {
  const req = (headers = {}) => new Request("https://fundhub.ai/.netlify/functions/marketing-worker-background", { method: "POST", headers });

  test("no secret set is a closed door, whatever the header says", async () => {
    let ran = 0;
    const h = makeWorkerHandler({ env: {}, pass: async () => { ran += 1; return {}; } });
    for (const headers of [{}, { [AUTH_HEADER]: "" }, { [AUTH_HEADER]: "anything" }]) {
      const r = await h(req(headers));
      assert.equal(r.status, 404);
    }
    assert.equal(ran, 0);
  });

  test("a masked copy of the secret is treated as unset", async () => {
    let ran = 0;
    const masked = "****************abcd";
    const h = makeWorkerHandler({ env: { MARKETING_WORKER_SECRET: masked }, pass: async () => { ran += 1; return {}; } });
    assert.equal((await h(req({ [AUTH_HEADER]: masked }))).status, 404);
    assert.equal(ran, 0);
  });

  test("the wrong secret gets 404; the right one runs one pass with this db and env", async () => {
    const calls = [];
    const env = { MARKETING_WORKER_SECRET: "s3cret-for-this-test-only" };
    const db = { query: async () => ({ rows: [] }) };
    const h = makeWorkerHandler({ db, env, pass: async (ctx) => { calls.push(ctx); return { stopped: "idle" }; } });
    assert.equal((await h(req({ [AUTH_HEADER]: "s3cret-for-this-test-onlyX" }))).status, 404);
    assert.equal((await h(req({}))).status, 404);
    assert.equal(calls.length, 0);
    const ok = await h(req({ [AUTH_HEADER]: env.MARKETING_WORKER_SECRET }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { stopped: "idle" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].db, db);
    assert.equal(calls[0].env, env);
  });

  test("a pass that throws still answers 200 with the reason", async () => {
    const env = { MARKETING_WORKER_SECRET: "another-test-secret" };
    const h = makeWorkerHandler({ env, pass: async () => { throw new Error("boom"); } });
    const r = await h(req({ [AUTH_HEADER]: "another-test-secret" }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, error: "boom" });
  });

  test("the deployed function refuses a request with no header (default export only)", async () => {
    const mod = await import("../../netlify/functions/marketing-worker-background.mjs");
    assert.deepEqual(Object.keys(mod), ["default"]);
    const r = await mod.default(req({ [AUTH_HEADER]: "not-the-secret" }));
    assert.equal(r.status, 404);
  });

  test("secretMatches", () => {
    assert.equal(secretMatches(null, "x"), false);
    assert.equal(secretMatches("abc", "abc"), true);
    assert.equal(secretMatches("abc", "abcd"), false);
    assert.equal(secretMatches("abc", null), false);
    assert.equal(secretMatches("abc", ""), false);
  });
});

describe("the drain record", () => {
  test("drainSummary keeps the outcome, never file contents", () => {
    assert.deepEqual(drainSummary({ skipped: "dry_run", reason: "ADAPTERS_DRY_RUN is not set" }), { held_reason: "dry_run", skipped: "dry_run" });
    assert.deepEqual(drainSummary({ skipped: "no_token" }), { held_reason: "no_token", skipped: "no_token" });
    assert.deepEqual(drainSummary({ committed_sha: "d".repeat(40), ids: [1, 2], deduped: [], rejected: [{ id: 3, error: "x" }] }),
      { held_reason: null, committed_sha: "d".repeat(40), committed: 2, rejected: 1 });
    assert.deepEqual(drainSummary({ error: "GitHub would not move the branch: HTTP 422", ids: [4] }),
      { held_reason: null, error: "GitHub would not move the branch: HTTP 422" });
    assert.deepEqual(drainSummary(null), { held_reason: null });
  });

  test("heldReasonOf and drainWorthRetrying", () => {
    assert.equal(heldReasonOf({ skipped: "busy" }), null);
    assert.equal(heldReasonOf({ skipped: "dry_run" }), "dry_run");
    assert.equal(drainWorthRetrying(null), true);
    assert.equal(drainWorthRetrying({ held_reason: "no_token" }), false);
    assert.equal(drainWorthRetrying({ skipped: "busy", held_reason: null }), false);
    assert.equal(drainWorthRetrying({ error: "refused", held_reason: null }), false);
    assert.equal(drainWorthRetrying({ error: "502", retry: true, held_reason: null }), true);
    assert.equal(drainWorthRetrying({ committed_sha: "e".repeat(40), held_reason: null }), true);
  });
});
