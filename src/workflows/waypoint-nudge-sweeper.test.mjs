// The sweeper is registered, it is on a clock, and one pass cannot send.

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SWEEP_CRON, sweep, handle, waypointNudgeSweeper } from "./waypoint-nudge-sweeper.mjs";
import { functions } from "./index.mjs";
import { runNudges } from "../nudge/run.mjs";

test("it is registered, so something actually runs it", () => {
  assert.ok(
    functions.some((f) => f?.id?.("") === "waypoint-nudge-sweeper" || f === waypointNudgeSweeper),
    "waypointNudgeSweeper is in the exported functions array"
  );
});

test("it runs hourly", () => {
  assert.equal(SWEEP_CRON, "0 * * * *");
});

test("a pass over an empty result set does nothing and does not throw", async () => {
  const calls = [];
  const fakeDb = { query: async (sql, params) => { calls.push([sql, params]); return { rows: [] }; } };
  const tally = await sweep(fakeDb, { orgId: "00000000-0000-0000-0000-000000000000" });
  assert.equal(tally.considered, 0);
  assert.equal(tally.queued, 0);
  assert.equal(tally.failed, 0);
  assert.ok(calls.length >= 1, "it did look");
});

test("handle() is callable the way the journey runner expects", async () => {
  const fakeDb = { query: async () => ({ rows: [] }) };
  const ran = [];
  const step = { run: async (name, fn) => { ran.push(name); return fn(); } };
  const out = await handle({ db: fakeDb, step });
  assert.deepEqual(ran, ["nudge-clock", "nudge-plan", "blueprint-coach-call-plan"]);
  assert.equal(out.considered, 0);
});

test("the real clock and each text candidate run as separate durable steps, with voice receiving the same runner", async () => {
  const at = new Date("2026-10-20T18:00:00Z");
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  const ran = [];
  let active = null;
  const step = { run: async (name, fn) => {
    assert.equal(active, null, "durable steps must not nest");
    ran.push(name); active = name;
    try { return await fn(); } finally { active = null; }
  } };
  const fakeDb = { query: async (sql) => {
    if (sql.includes("WITH due AS")) {
      assert.equal(active, "nudge-plan");
      return { rows: ids.map((id) => ({ id, org_id: id, client_id: id, key: "saved-step", title: "Mail saved letters",
        due_at: at.toISOString(), state: "not_started" })) };
    }
    assert.ok(ids.some((id) => active === `nudge-${id}-1`), "candidate database reads stay inside its own durable step");
    return { rows: [] }; // Stale/missing waypoints are refused before any write.
  } };
  let voiceRuns = 0;
  const out = await runNudges(fakeDb, { now: at, step,
    runCoachCalls: async (_db, options) => {
      voiceRuns++;
      assert.equal(options.step, step);
      assert.equal(options.now.toISOString(), at.toISOString());
      assert.equal(active, null);
      return { considered: 0, placed: 0, failed: 0, results: [] };
    }
  });
  assert.deepEqual(ran, ["nudge-plan", ...ids.map((id) => `nudge-${id}-1`)]);
  assert.equal(out.considered, 2);
  assert.equal(out.skipped, 2);
  assert.equal(voiceRuns, 1);
});

test("durable replay reuses the frozen time and saved plans without repeating database work", async () => {
  const cache = new Map();
  let reads = 0;
  const fakeDb = { query: async () => { reads++; return { rows: [] }; } };
  const step = { run: async (name, fn) => {
    if (!cache.has(name)) cache.set(name, await fn());
    return cache.get(name);
  } };
  const first = await handle({ db: fakeDb, step, now: "2026-10-20T18:00:00Z" });
  const firstReads = reads;
  const replay = await handle({ db: fakeDb, step, now: "2026-10-21T18:00:00Z" });
  assert.equal(replay.at, first.at);
  assert.equal(reads, firstReads);
  assert.ok(cache.has("nudge-clock") && cache.has("nudge-plan") && cache.has("blueprint-coach-call-plan"));
});

test("durable runner control-flow failures are not swallowed as a quiet no-op", async () => {
  const step = { run: async (name, fn) => {
    if (name === "nudge-plan") throw new Error("durable runner yield");
    return fn();
  } };
  await assert.rejects(handle({ db: { query: async () => ({ rows: [] }) }, step }), /durable runner yield/);
});

test("a delayed durable delivery uses its actual clock and drops an obsolete text rung", async () => {
  const plannedAt = new Date("2026-10-20T18:00:00Z");
  const deliveryAt = new Date("2026-10-30T18:00:00Z");
  let reads = 0;
  let voiceClock;
  const db = { query: async (sql) => {
    reads++;
    assert.ok(sql.includes("WITH due AS"), "stale text plans must stop before client reads or writes");
    return { rows: [{ id: "old-step", org_id: "org", client_id: "client", key: "old", title: "Saved step", due_at: plannedAt.toISOString() }] };
  } };
  const clock = () => deliveryAt;
  const out = await runNudges(db, { now: plannedAt, deliveryNow: clock,
    step: { run: async (_name, fn) => fn() },
    runCoachCalls: async (_db, options) => { voiceClock = options.deliveryNow; return { placed: 0 }; }
  });
  assert.equal(reads, 1);
  assert.equal(out.results[0].reasons[0], "stale_nudge_plan");
  assert.equal(voiceClock, clock);
});

test("nothing under src/nudge/ transmits — CLAUDE.md section 12", () => {
  // Outbound transmission is permitted in src/messaging/providers/ and nowhere
  // else. This asserts the rule structurally instead of trusting a comment.
  const here = fileURLToPath(new URL(".", import.meta.url));
  const files = [
    "ladder.mjs", "clock.mjs", "exits.mjs", "run.mjs", "regulator.mjs", "index.mjs"
  ];
  for (const f of files) {
    const src = readFileSync(`${here}../nudge/${f}`, "utf8");
    assert.ok(!/\bfetch\s*\(/.test(src), `${f} must not call fetch`);
    // Comments may NAME the rule; an import may not break it. So this looks at
    // import statements only, not at prose.
    const imports = src.match(/^\s*import[^;]+from\s+["'][^"']+["']/gm) || [];
    for (const line of imports) {
      assert.ok(!/providers\//.test(line), `${f} must not import a provider: ${line.trim()}`);
    }
  }
});
