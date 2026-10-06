// MARKETING_AI_RUNNER=local (src/marketing/ai-runner.mjs): Netlify leaves every AI job
// queued for the Mac, and keeps running everything else. Fake deps throughout: no
// database, no network, no model.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import {
  AI_JOB_KINDS, NOT_AI_JOB_KINDS, AI_ASSET_KINDS, MAC_WAIT_LINE,
  runnerIsLocal, isAiKind, netlifyRegistry, macRegistry, readMacQueue, macQueueLine
} from "./ai-runner.mjs";
import { JOB_KINDS } from "./job-kinds.mjs";
import { runPass } from "./worker.mjs";
import { tick } from "./clock.mjs";
import { reclaimStale } from "./jobs.mjs";
import { runFunnelJob } from "./funnel-worker.mjs";
import { wakeOrFail } from "./funnel-routes.mjs";
import { claim } from "../creative/generate.mjs";
import creativeRun from "../../api/creative/run.mjs";

const LOCAL = { MARKETING_AI_RUNNER: "local" };
const T0 = Date.parse("2026-10-12T15:00:00.000Z");

describe("which kinds are AI work", () => {
  test("every job kind in the registry is sorted into exactly one list", () => {
    const all = Object.keys(JOB_KINDS).sort();
    const sorted = [...AI_JOB_KINDS, ...NOT_AI_JOB_KINDS].sort();
    assert.deepEqual(sorted, all, "a new job kind must be named in AI_JOB_KINDS or NOT_AI_JOB_KINDS");
    assert.equal(new Set(sorted).size, sorted.length, "no kind in both lists");
  });

  test("the AI kinds are the ones whose handlers call the model", () => {
    assert.deepEqual([...AI_JOB_KINDS].sort(), ["avatar", "deep_research", "fix_script", "flywheel_stage", "funnel", "write_slot"]);
    assert.equal(isAiKind("offer"), true, "the Write offer job is AI work too");
    assert.equal(isAiKind("funnel_push"), false);
    assert.equal(isAiKind("meta_load"), false);
    assert.deepEqual([...AI_ASSET_KINDS], ["copy"]);
  });

  test("runnerIsLocal: only the word local turns it on", () => {
    assert.equal(runnerIsLocal(LOCAL), true);
    assert.equal(runnerIsLocal({ MARKETING_AI_RUNNER: " LOCAL " }), true);
    for (const v of [undefined, "", "netlify", "mac", "1"]) assert.equal(runnerIsLocal({ MARKETING_AI_RUNNER: v }), false, String(v));
    assert.equal(runnerIsLocal(undefined), false);
  });

  test("netlifyRegistry drops the AI kinds only when local; macRegistry is the AI kinds", () => {
    assert.equal(netlifyRegistry({}, JOB_KINDS), JOB_KINDS, "unset: the same registry, untouched");
    const local = Object.keys(netlifyRegistry(LOCAL, JOB_KINDS)).sort();
    assert.deepEqual(local, [...NOT_AI_JOB_KINDS].sort());
    assert.deepEqual(Object.keys(macRegistry(JOB_KINDS)).sort(), [...AI_JOB_KINDS].sort());
  });

  test("the Mac queue line", () => {
    assert.equal(macQueueLine(0, 0), "");
    assert.equal(macQueueLine(1, 0), "1 AI job is waiting for your Mac to run it.");
    assert.equal(macQueueLine(3, 1), "3 AI jobs are waiting for your Mac to run them. Your Mac is running 1 now.");
    assert.equal(MAC_WAIT_LINE, "Waiting for your Mac to run it.");
  });

  test("readMacQueue: null when Netlify runs the AI; counts this company's AI jobs when local", async () => {
    const seen = [];
    const db = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [{ waiting: 2, running: 0 }] }; } };
    assert.equal(await readMacQueue(db, { orgId: "o1", env: {} }), null);
    assert.equal(seen.length, 0);
    const q = await readMacQueue(db, { orgId: "o1", env: LOCAL });
    assert.deepEqual(q, { waiting: 2, running: 0, line: "2 AI jobs are waiting for your Mac to run them." });
    assert.equal(seen[0].params[0], "o1");
    assert.deepEqual([...seen[0].params[1]].sort(), ["offer", ...AI_JOB_KINDS].sort());
  });
});

/** Fake worker deps that record what was asked. Nothing is ever queued. */
function passDeps(calls) {
  let t = T0;
  return {
    beat: async () => null,
    lastDrain: async () => ({ at: null, detail: null }),
    outboxWaiting: async () => 0,
    reclaimStale: async (opts) => { calls.reclaim.push(opts); return []; },
    drainOutbox: async () => ({ skipped: "empty" }),
    recordDrain: async () => null,
    sendDueBuzzes: async () => ({ sent: 0 }),
    claim: async ({ kinds }) => { calls.claimed.push(...kinds); return []; },
    finishJob: async () => null,
    failJob: async () => null,
    nextRunAfter: async ({ kinds }) => { calls.next.push(...kinds); return null; },
    wake: async () => ({ ok: true }),
    now: () => new Date(t),
    sleep: async (ms) => { t += ms; },
    log: () => {}
  };
}

describe("the Netlify side, local", () => {
  test("the worker claims no AI kind and takes back none; the other kinds still run", async () => {
    const calls = { reclaim: [], claimed: [], next: [] };
    await runPass({ env: LOCAL, deps: passDeps(calls) });
    for (const k of AI_JOB_KINDS) assert.equal(calls.claimed.includes(k), false, `${k} must wait for the Mac`);
    for (const k of NOT_AI_JOB_KINDS) assert.equal(calls.claimed.includes(k), true, `${k} still runs on Netlify`);
    assert.deepEqual(calls.reclaim, [{ olderThanMin: 16, excludeKinds: [...AI_JOB_KINDS] }]);
  });

  test("unset: the worker is exactly as before (every kind, reclaim with no scope)", async () => {
    const calls = { reclaim: [], claimed: [], next: [] };
    await runPass({ env: {}, deps: passDeps(calls) });
    for (const k of Object.keys(JOB_KINDS)) assert.equal(calls.claimed.includes(k), true, k);
    assert.deepEqual(calls.reclaim, [{ olderThanMin: 16 }]);
  });

  test("the clock does not wake the worker for AI jobs only the Mac will run", async () => {
    let kinds = null;
    await tick({
      env: LOCAL,
      deps: {
        readSettings: async () => [],
        weeklyTick: async () => ({ queued: [] }),
        followLateDrafts: async () => [],
        readWaitingWork: async (o) => { kinds = o.kinds; return { outbox_waiting: 0, buzzes_due: 0, jobs_due: 0, stale_claims: 0 }; },
        machineOrgIds: async () => [],
        beat: async () => 0,
        wake: async () => ({ ok: true }),
        log: () => {},
        now: () => new Date(T0)
      }
    });
    assert.deepEqual([...kinds].sort(), [...NOT_AI_JOB_KINDS].sort());
  });

  test("reclaimStale scopes by kind only when asked; no scope is the old statement", async () => {
    const seen = [];
    const db = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; } };
    await reclaimStale(db, { olderThanMin: 16 });
    await reclaimStale(db, { olderThanMin: 16, excludeKinds: ["write_slot"] });
    await reclaimStale(db, { olderThanMin: 16, kinds: ["avatar"] });
    assert.deepEqual(seen[0].params, [16]);
    assert.doesNotMatch(seen[0].sql, /ANY\(\$2/);
    assert.deepEqual(seen[1].params, [16, ["write_slot"]]);
    assert.match(seen[1].sql, /AND NOT \(kind = ANY\(\$2::text\[\]\)\)/);
    assert.deepEqual(seen[2].params, [16, ["avatar"]]);
    assert.match(seen[2].sql, /AND kind = ANY\(\$2::text\[\]\)/);
    assert.deepEqual(await reclaimStale(db, { olderThanMin: 16, kinds: [] }), []);
  });

  test("the funnel background function never claims the page writer, but still pushes", async () => {
    const asked = [];
    const db = { query: async (_sql, params) => { asked.push(params[2]); return { rows: [] }; } };
    await runFunnelJob(db, { jobId: "j", orgId: "o", env: LOCAL });
    await runFunnelJob(db, { jobId: "j", orgId: "o", env: {} });
    assert.deepEqual(asked[0], ["funnel_push"]);
    assert.deepEqual([...asked[1]].sort(), ["funnel", "funnel_push"]);
  });

  test("a page-writer press wakes nothing and says it waits for the Mac; a push still wakes", async () => {
    let wakes = 0;
    const wake = async () => { wakes += 1; return { ok: true }; };
    const db = { query: async () => ({ rows: [] }) };
    const w = await wakeOrFail(db, { job: { id: "1", kind: "funnel", status: "queued" }, token: "t", env: LOCAL, wake });
    assert.deepEqual(w, { started: false, reason: null, waiting_for: "mac", message: MAC_WAIT_LINE });
    assert.equal(wakes, 0);
    const p = await wakeOrFail(db, { job: { id: "2", kind: "funnel_push", status: "queued" }, token: "t", env: LOCAL, wake });
    assert.equal(p.started, true);
    assert.equal(wakes, 1);
  });

  test("Write ad copy: the creative claim can leave copy jobs out, or take only them", async () => {
    const seen = [];
    const tx = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: /count/.test(sql) ? [{ n: 0 }] : /max_concurrent_jobs/.test(sql) ? [] : [] }; } };
    await claim(tx, { partnerId: "p" });
    await claim(tx, { partnerId: "p", excludeAssetKinds: ["copy"] });
    await claim(tx, { partnerId: "p", assetKinds: ["copy"] });
    const updates = seen.filter((s) => /UPDATE generation_jobs/.test(s.sql));
    assert.deepEqual(updates[0].params, ["p"], "no filter: the old statement");
    assert.deepEqual(updates[1].params, ["p", ["copy"]]);
    assert.match(updates[1].sql, /NOT \(coalesce\(spec->>'assetKind', ''\) = ANY\(\$2::text\[\]\)\)/);
    assert.deepEqual(updates[2].params, ["p", ["copy"]]);
    assert.match(updates[2].sql, /spec->>'assetKind' = ANY\(\$2::text\[\]\)/);
  });

  test("the Write ad copy press, local: claims no copy job and says it waits for the Mac", async () => {
    const claims = [];
    const r = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() { return this; } };
    await creativeRun({ method: "POST", headers: {}, query: {}, body: { partner_id: "p", max_jobs: 1 } }, r, {
      db: {},
      env: LOCAL,
      requirePrincipal: async () => ({ kind: "partner", partnerId: "p" }),
      withPartnerScope: async (_scope, fn) => fn({ query: async () => ({ rows: [{ n: 1 }] }) }),
      claim: async (_tx, opts) => { claims.push(opts); return null; },
      run: async () => { throw new Error("nothing should run"); },
      runDue: async () => { throw new Error("not for one partner"); }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(claims, [{ partnerId: "p", excludeAssetKinds: ["copy"] }]);
    assert.equal(r.body.waiting_for_mac, 1);
    assert.equal(r.body.note, MAC_WAIT_LINE);
  });
});

describe("the Today page shows the Mac's queue", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SRC = fs.readFileSync(path.resolve(HERE, "../../public/app/marketing-cc-today.js"), "utf8");
  const load = () => { const ctx = createContext({ console }); runInContext(SRC, ctx); return ctx.FHMarketingCC; };

  test("mac_queue becomes the first Waiting row; no key, no row", () => {
    const cc = load();
    const view = cc.normalizeToday({ ok: true, mac_queue: { waiting: 2, running: 0, line: "2 AI jobs are waiting for your Mac to run them." } });
    const rows = cc.waitingList(view, null, T0);
    assert.equal(rows[0].kind, "mac");
    assert.equal(rows[0].what, "Waiting for your Mac to run it");
    assert.equal(rows[0].why, "2 AI jobs are waiting for your Mac to run them.");
    const none = cc.waitingList(cc.normalizeToday({ ok: true }), null, T0);
    assert.equal(none.some((x) => x.kind === "mac"), false);
    const empty = cc.waitingList(cc.normalizeToday({ ok: true, mac_queue: { waiting: 0, running: 0, line: "" } }), null, T0);
    assert.equal(empty.some((x) => x.kind === "mac"), false);
  });

  test("Write ad copy, local: the answer says it waits for the Mac", () => {
    const cc = load();
    const out = cc.summarizeRun({ status: 200, body: { ok: true, ran: 0, jobs: [], note: MAC_WAIT_LINE, waiting_for_mac: 1 } }, "job-1");
    assert.equal(out.tone, "wait");
    assert.match(out.message, /Waiting for your Mac to run it/);
  });
});
