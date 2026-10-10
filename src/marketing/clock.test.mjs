// The marketing clock (src/marketing/clock.mjs, netlify/functions/marketing-clock.mjs).
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 4. Plan unit U22.
//
// No database, no network: tick() runs on fake deps, and a fetch spy on globalThis
// fails the test if anything tries to reach the network. The real SQL runs against
// Postgres in src/http/marketing-health.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  tick, batchPart, hasWork, workerKinds, beat, CLOCK_CRON, HEARTBEAT_NAMES, readWaitingWork
} from "./clock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const NO_WORK = Object.freeze({ outbox_waiting: 0, buzzes_due: 0, jobs_due: 0, stale_claims: 0 });
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

/** Fake deps: records every call. weeklyTick (U35) answers `weekly` for each enabled company. */
function fakeDeps({ settings = [{ org_id: ORG_A, enabled: false }], work = NO_WORK, orgs = [ORG_A], weekly = { queued: [] }, late = [] } = {}) {
  const calls = { readSettings: 0, weeklyTick: [], followLateDrafts: 0, readWaitingWork: [], machineOrgIds: 0, beats: [], wakes: 0, logs: [] };
  const deps = {
    readSettings: async () => { calls.readSettings += 1; return settings; },
    weeklyTick: async (s, now) => { calls.weeklyTick.push({ org_id: s.org_id, now }); return typeof weekly === "function" ? weekly(s) : weekly; },
    followLateDrafts: async () => { calls.followLateDrafts += 1; return late; },
    readWaitingWork: async (opts) => { calls.readWaitingWork.push(opts); return work; },
    machineOrgIds: async () => { calls.machineOrgIds += 1; return orgs; },
    beat: async (name, entries) => { calls.beats.push({ name, entries }); return entries.length; },
    wake: async () => { calls.wakes += 1; return { ok: true, started: true, status: 202, reason: null }; },
    log: (line) => { calls.logs.push(line); },
    now: () => new Date("2026-10-12T15:00:00.000Z")
  };
  return { deps, calls };
}

/** Run fn with a globalThis.fetch that records and refuses every call. */
async function withNoNetwork(fn) {
  const real = globalThis.fetch;
  const hits = [];
  globalThis.fetch = /** @type {any} */ (async (url) => { hits.push(String(url)); throw new Error("network is off in this test"); });
  try { return { out: await fn(), hits }; }
  finally { globalThis.fetch = real; }
}

describe("tick: 'enabled' is the weekly-batch switch only", () => {
  test("enabled false: the batch part logs 'disabled' and plans nothing; nothing waiting → no wake", async () => {
    const { deps, calls } = fakeDeps();
    const { out, hits } = await withNoNetwork(() => tick({ deps }));
    assert.deepEqual(hits, [], "the clock made no network call");
    assert.equal(out.ok, true);
    assert.deepEqual(out.batch, [{
      org_id: ORG_A, batch: "disabled", planned: 0, note: "the weekly batch is off; nothing planned"
    }]);
    assert.ok(calls.logs.some((l) => /disabled/.test(l)), `a log line says disabled: ${calls.logs.join(" | ")}`);
    assert.equal(calls.wakes, 0, "nothing waiting, so the worker is not woken");
    assert.equal(out.woke, null);
    // The clock heartbeat is written either way.
    assert.equal(calls.beats.length, 1);
    assert.equal(calls.beats[0].name, "clock");
    assert.deepEqual(calls.beats[0].entries, [{
      orgId: ORG_A, detail: { enabled: false, batch: "disabled", planned: 0, work: NO_WORK }
    }]);
  });

  for (const [what, work] of [
    ["repo_outbox rows wait", { ...NO_WORK, outbox_waiting: 2 }],
    ["a buzz is due", { ...NO_WORK, buzzes_due: 1 }],
    ["a job is queued and due", { ...NO_WORK, jobs_due: 1 }],
    ["a claim went stale (over 16 minutes)", { ...NO_WORK, stale_claims: 1 }]
  ]) {
    test(`enabled false but ${what} → the clock still wakes the worker, once, and plans nothing`, async () => {
      const { deps, calls } = fakeDeps({ work });
      const { out, hits } = await withNoNetwork(() => tick({ deps }));
      assert.deepEqual(hits, []);
      assert.equal(calls.wakes, 1);
      assert.equal(out.woke.started, true);
      assert.equal(out.batch[0].batch, "disabled");
      assert.equal(out.batch[0].planned, 0);
      assert.ok(calls.logs.some((l) => /disabled/.test(l)));
    });
  }

  test("enabled true: the weekly step runs for that company only; enabled false never reaches it (U35)", async () => {
    const queued = [{ kind: "start_batch", batch_id: "b1" }, { kind: "nightly_script_check", day: "2026-10-12" }];
    const { deps, calls } = fakeDeps({
      settings: [{ org_id: ORG_A, enabled: true }, { org_id: ORG_B, enabled: false }], orgs: [ORG_A, ORG_B],
      weekly: { queued, release_at: "2026-10-12T14:00:00.000Z", week_key: "2026-W42", made_batch: "b1" }
    });
    const { out, hits } = await withNoNetwork(() => tick({ deps }));
    assert.deepEqual(hits, []);
    assert.deepEqual(calls.weeklyTick.map((c) => c.org_id), [ORG_A], "the disabled company never reaches the weekly step");
    assert.equal(calls.weeklyTick[0].now.toISOString(), "2026-10-12T15:00:00.000Z", "the tick's own clock is passed on");
    assert.deepEqual(out.batch.map((b) => [b.org_id, b.batch, b.planned]), [[ORG_A, "on", 2], [ORG_B, "disabled", 0]]);
    assert.match(out.batch[0].note, /queued start_batch, nightly_script_check; made this week's batch/);
    assert.deepEqual(calls.beats[0].entries.map((e) => [e.orgId, e.detail.enabled, e.detail.batch, e.detail.planned]),
      [[ORG_A, true, "on", 2], [ORG_B, false, "disabled", 0]]);
  });

  test("enabled true with nothing due: 'on', nothing queued", async () => {
    const { deps, calls } = fakeDeps({ settings: [{ org_id: ORG_A, enabled: true }] });
    const { out } = await withNoNetwork(() => tick({ deps }));
    assert.equal(calls.weeklyTick.length, 1);
    assert.deepEqual(out.batch.map((b) => [b.batch, b.planned]), [["on", 0]]);
    assert.match(out.batch[0].note, /nothing to queue this tick/);
    assert.equal(calls.wakes, 0);
  });

  test("a company whose weekly step throws is logged; the others still run and the clock still beats", async () => {
    const { deps, calls } = fakeDeps({
      settings: [{ org_id: ORG_A, enabled: true }, { org_id: ORG_B, enabled: true }], orgs: [ORG_A, ORG_B],
      weekly: (s) => { if (s.org_id === ORG_A) throw new Error("db hiccup"); return { queued: [{ kind: "voice_export" }] }; }
    });
    const { out } = await withNoNetwork(() => tick({ deps }));
    assert.equal(out.ok, true);
    assert.equal(out.batch[0].error, "db hiccup");
    assert.match(out.batch[0].note, /failed \(db hiccup\); the next tick tries again/);
    assert.equal(out.batch[1].planned, 1);
    assert.equal(calls.beats.length, 1);
  });

  test("late drafts are followed up for every company, even with the weekly switch off", async () => {
    const { deps, calls } = fakeDeps({ late: [{ org_id: ORG_A, batch_id: "33333333-3333-4333-8333-333333333333" }] });
    const { out } = await withNoNetwork(() => tick({ deps }));
    assert.equal(calls.followLateDrafts, 1);
    assert.equal(calls.weeklyTick.length, 0);
    assert.deepEqual(out.late, [{ org_id: ORG_A, batch_id: "33333333-3333-4333-8333-333333333333" }]);
    assert.ok(calls.logs.some((l) => /late drafts: queued finish_batch for 33333333/.test(l)));
  });

  test("no company has settings yet: logs 'disabled', still beats for companies with waiting work, and wakes", async () => {
    const { deps, calls } = fakeDeps({ settings: [], orgs: [ORG_B], work: { ...NO_WORK, outbox_waiting: 1 } });
    const { out } = await withNoNetwork(() => tick({ deps }));
    assert.deepEqual(out.batch, []);
    assert.ok(calls.logs.some((l) => /disabled/.test(l)));
    assert.deepEqual(calls.beats[0].entries, [{ orgId: ORG_B, detail: { enabled: false, batch: "disabled", planned: 0, work: { ...NO_WORK, outbox_waiting: 1 } } }]);
    assert.equal(calls.wakes, 1);
  });

  test("a wake the worker could not take (no secret) is reported, not thrown", async () => {
    const { deps, calls } = fakeDeps({ work: { ...NO_WORK, jobs_due: 1 } });
    deps.wake = async () => ({ ok: true, started: false, status: null, skipped: "no_secret", reason: "MARKETING_WORKER_SECRET is not set" });
    const { out } = await withNoNetwork(() => tick({ deps }));
    assert.equal(out.woke.started, false);
    assert.ok(calls.logs.some((l) => /no_secret/.test(l)));
  });
});

describe("tick counts only the jobs the worker can run", () => {
  test("the kinds it asks about are the registry's, never 'offer'", async () => {
    const { deps, calls } = fakeDeps();
    const registry = {
      write_slot: { group: "writer", load: async () => ({ run: async () => ({}) }) },
      offer: { group: "system", load: async () => ({ run: async () => ({}) }) },
      meta_load: { group: "loader", load: async () => ({ run: async () => ({}) }) }
    };
    await tick({ deps, registry });
    assert.deepEqual(calls.readWaitingWork, [{ kinds: ["meta_load", "write_slot"] }]);
    assert.deepEqual(workerKinds(registry), ["meta_load", "write_slot"]);
  });

  test("readWaitingWork's SQL: waiting saves, due buzzes, due jobs of those kinds (never offer), claims older than 16 minutes", async () => {
    const seen = [];
    const db = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [{ outbox_waiting: 1, buzzes_due: 0, jobs_due: "2", stale_claims: 0 }] }; } };
    const work = await readWaitingWork(db, { kinds: ["write_slot"] });
    assert.deepEqual(work, { outbox_waiting: 1, buzzes_due: 0, jobs_due: 2, stale_claims: 0 });
    const sql = seen[0].sql.replace(/\s+/g, " ");
    assert.match(sql, /FROM repo_outbox WHERE committed_sha IS NULL/);
    assert.match(sql, /sent_at IS NULL AND failed_at IS NULL AND send_after <= now\(\)/);
    assert.match(sql, /status = 'queued' AND kind <> 'offer' AND kind = ANY\(\$1::text\[\]\) AND run_after <= now\(\)/);
    assert.match(sql, /status = 'running' AND kind <> 'offer'/);
    assert.deepEqual(seen[0].params, [["write_slot"], 16]);
    // It is a read: no INSERT, UPDATE or DELETE.
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/i);
  });
});

describe("the clock only reads, queues and wakes — no model, GitHub or Meta call", () => {
  /* Every module the clock loads, followed through static imports under the repo. */
  function importGraph(entry) {
    const seen = new Set();
    const stack = [entry];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      const re = /^\s*(?:import|export)\s[^'"]*?from\s+["'](\.{1,2}\/[^"']+)["']|^\s*import\s+["'](\.{1,2}\/[^"']+)["']/gm;
      let m;
      while ((m = re.exec(src))) {
        const rel = m[1] || m[2];
        const next = path.resolve(path.dirname(file), rel);
        if (existsSync(next)) stack.push(next);
      }
    }
    return [...seen].map((f) => path.relative(ROOT, f));
  }

  const FORBIDDEN = [
    /^src\/agents\/model\.mjs$/,
    /^src\/marketing\/offer-transport\.mjs$/,
    /^src\/messaging\/providers\//,
    /^src\/repo\/(github|outbox)\.mjs$/,
    /^src\/adplatforms\//,
    /^src\/ad-videos\/notify-fanout\.mjs$/
  ];

  test("neither the clock nor its Netlify shell imports a model, GitHub, Meta or texting module", () => {
    for (const entry of ["src/marketing/clock.mjs", "netlify/functions/marketing-clock.mjs"]) {
      const graph = importGraph(path.join(ROOT, entry));
      assert.ok(graph.includes("src/marketing/clock.mjs"));
      const bad = graph.filter((f) => FORBIDDEN.some((re) => re.test(f)));
      assert.deepEqual(bad, [], `${entry} pulls in ${bad.join(", ")}`);
    }
  });

  test("the clock's source writes only its heartbeat, the weekly batch row and queued jobs (no settings row, no delete)", () => {
    const src = readFileSync(path.join(ROOT, "src/marketing/clock.mjs"), "utf8");
    // "ON CONFLICT ... DO UPDATE SET" is the heartbeat's own upsert, not a second write.
    const writes = [...src.matchAll(/(?<!DO )\b(INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual([...new Set(writes)].sort(), [
      "INSERT INTO marketing_batches",   // U35: the week's batch row (ON CONFLICT DO NOTHING)
      "INSERT INTO marketing_heartbeats",
      "INSERT INTO marketing_jobs",      // U35: followLateDrafts (start/release/voice/nightly go through enqueueJob)
      "UPDATE marketing_batches"         // U35: a failed weekly plan back to 'planned' before its retry
    ]);
    assert.doesNotMatch(src, /\bDELETE\b/);
  });
});

describe("the Netlify shell", () => {
  test("SWEEP_CRON matches CLOCK_CRON and netlify.toml, and the schedule sits under [functions.\"marketing-clock\"]", async () => {
    const mod = await import("../../netlify/functions/marketing-clock.mjs");
    assert.equal(mod.SWEEP_CRON, "*/15 * * * *");
    assert.equal(mod.SWEEP_CRON, CLOCK_CRON);
    const toml = readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
    const m = /\[functions\."marketing-clock"\]\s*\n\s*schedule\s*=\s*"([^"]+)"/.exec(toml);
    assert.ok(m, "netlify.toml has no schedule directly under [functions.\"marketing-clock\"]");
    assert.equal(m[1], mod.SWEEP_CRON);
  });

  test("both functions export default only (no named handler) and name no credentials/ path", async () => {
    for (const file of ["netlify/functions/marketing-clock.mjs", "netlify/functions/marketing-worker-background.mjs"]) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      assert.doesNotMatch(src, /export\s+(const|let|var|async\s+function|function)\s+handler\b/, `${file} has a named handler export`);
      assert.doesNotMatch(src, /export\s*\{[^}]*\bhandler\b[^}]*\}/, `${file} re-exports a handler`);
      assert.match(src, /export default /);
      const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      assert.doesNotMatch(code, /credentials\//, `${file} names a credentials/ path`);
      const mod = await import(path.join(ROOT, file));
      assert.equal(typeof mod.default, "function");
      assert.equal(mod.handler, undefined);
    }
    for (const file of ["src/marketing/clock.mjs", "src/marketing/worker.mjs"]) {
      const code = readFileSync(path.join(ROOT, file), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      assert.doesNotMatch(code, /credentials\//, `${file} names a credentials/ path`);
    }
  });
});

describe("pieces", () => {
  test("hasWork", () => {
    assert.equal(hasWork(NO_WORK), false);
    assert.equal(hasWork({ ...NO_WORK, buzzes_due: 1 }), true);
    assert.equal(hasWork(null), false);
  });

  test("batchPart never plans anything", () => {
    assert.equal(batchPart({ org_id: ORG_A, enabled: false }).planned, 0);
    assert.equal(batchPart({ org_id: ORG_A, enabled: true }).planned, 0);
  });

  test("beat refuses a name the table does not accept, and writes one statement for many companies", async () => {
    assert.deepEqual([...HEARTBEAT_NAMES], ["clock", "worker", "page_seen", "outbox_drain"]);
    const db = { query: async () => ({ rows: [], rowCount: 2 }) };
    await assert.rejects(() => beat(db, "nap", [{ orgId: ORG_A }]), /heartbeat name/);
    const seen = [];
    const db2 = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [], rowCount: 2 }; } };
    assert.equal(await beat(db2, "clock", []), 0, "no companies → no statement");
    assert.equal(seen.length, 0);
    assert.equal(await beat(db2, "clock", [{ orgId: ORG_A, detail: { a: 1 } }, { orgId: ORG_B }]), 2);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].params, ["clock", [ORG_A, ORG_B], ['{"a":1}', "{}"], false]);
  });
});
