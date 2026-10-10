// The beat ctx: everything a beat can touch, and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeBeatCtx, makeFakeCtx, ctxLog, isMasked, fakeProbeResult } from "./ctx.mjs";
import { BeatFail, BeatDone, HARNESS, runBeat } from "./contract.mjs";
import { PulseRefused } from "./readbox.mjs";
import { makeFixtureBeat } from "../fake-sinks.mjs";

const reads = [{ host: "SITE", methods: ["GET"] }, { host: "api.example.com", methods: ["GET", "HEAD"] }];
const beatWith = (over = {}) => makeFixtureBeat({ reads, ...over });

function build(over = {}) {
  const probeCalls = [];
  const probe = {
    get: async (url, opts) => { probeCalls.push(["GET", url, opts]); return { ok: true, status: 200, ms: 1, finalHost: "x", bodySnippet: "", body: "", headers: {}, error: null, class: "ok" }; },
    head: async (url, opts) => { probeCalls.push(["HEAD", url, opts]); return { ok: true, status: 200, ms: 1, finalHost: "x", bodySnippet: "", body: "", headers: {}, error: null, class: "ok" }; }
  };
  const readCalls = [];
  const ctx = makeBeatCtx({
    beat: over.beat ?? beatWith(),
    runId: "run-1",
    env: over.env ?? { A: "1" },
    siteUrl: over.siteUrl ?? "https://fundhub.ai/",
    read: "read" in over ? over.read : (async (text, params) => { readCalls.push([text, params]); return { rows: [{ n: 1 }], rowCount: 1 }; }),
    probe: "probe" in over ? over.probe : probe,
    dbSettings: over.dbSettings
  });
  return { ctx, probeCalls, readCalls };
}

/* ---------------- the plain fields ---------------- */

test("ctx: env is a frozen copy, the ctx is frozen, and there is no way to a database handle or a sender", () => {
  const env = { A: "1" };
  const { ctx } = build({ env });
  env.A = "changed";
  env.B = "new";
  assert.equal(ctx.env.A, "1");
  assert.equal(ctx.env.B, undefined);
  assert.throws(() => { ctx.env.A = "x"; }, TypeError);
  assert.throws(() => { ctx.read = () => {}; }, TypeError);
  assert.throws(() => { ctx.extra = 1; }, TypeError);
  for (const gone of ["db", "door", "fetch", "pool", "identity", "boxReport", "resetScope", "send"]) assert.equal(gone in ctx, false, gone);
  assert.deepEqual(Object.keys(ctx).sort(), [
    "beatId", "dbSettings", "done", "env", "fail", "http", "live", "now", "read", "runId", "signal", "siteUrl", "skipStep", "state", "step"
  ]);
  assert.ok(ctx.signal instanceof AbortSignal);
  assert.equal(ctx.runId, "run-1");
  assert.equal(ctx.beatId, "fixture");
  assert.equal(ctx.siteUrl, "https://fundhub.ai", "no trailing slash");
});

test("ctx.live: true when AWS_LAMBDA_FUNCTION_NAME or NETLIFY is set in the env passed in, false otherwise", () => {
  assert.equal(build({ env: { AWS_LAMBDA_FUNCTION_NAME: "pulse-hourly" } }).ctx.live, true);
  assert.equal(build({ env: { NETLIFY: "true" } }).ctx.live, true);
  assert.equal(build({ env: {} }).ctx.live, false);
  assert.equal(build({ env: { NETLIFY: "", AWS_LAMBDA_FUNCTION_NAME: "" } }).ctx.live, false);
  process.env.NETLIFY = "true";
  try { assert.equal(build({ env: {} }).ctx.live, false, "the process env is not consulted, only the env passed in"); }
  finally { delete process.env.NETLIFY; }
});

test("isMasked: unset, empty, a leading star, or 4+ stars is a mask, not a break", () => {
  for (const v of [undefined, null, "", "   ", "****************", "****abcd", "*", "abc****def", "sk_live_****"]) assert.equal(isMasked(v), true, JSON.stringify(v));
  for (const v of ["sk_live_abc", "AC123", "a*b", "token-123"]) assert.equal(isMasked(v), false, v);
});

/* ---------------- steps ---------------- */

test("step: the name must be declared; each step records name, ms, ok; a failing step records ok false", async () => {
  const { ctx } = build();
  await assert.rejects(() => ctx.step("nope", async () => 1), /not in this beat's steps/);
  assert.equal(await ctx.step("one", async () => 41 + 1), 42);
  await assert.rejects(() => ctx.step("two", async () => { throw new Error("bad"); }), /bad/);
  const steps = ctxLog(ctx).steps;
  assert.deepEqual(steps.map((s) => [s.name, s.ok]), [["one", true], ["two", false]]);
  assert.ok(steps.every((s) => typeof s.ms === "number"));
});

test("skipStep: records the step as ok and skipped, never red", async () => {
  const beat = beatWith({ async run(ctx) { ctx.skipStep("one", "mask on the laptop"); ctx.skipStep("two", "not live"); ctx.skipStep("three", "n/a"); return ctx.done("all skipped"); } });
  const r = await runBeat(beat, build({ beat }).ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.skipped, ["one", "two", "three"]);
  assert.ok(r.steps.every((s) => s.ok && s.skipped));
  assert.deepEqual(r.notRun, []);
  assert.throws(() => build().ctx.skipStep("nope", "x"), /not in this beat's steps/);
});

test("fail and done build the right objects; fail can be returned or thrown", async () => {
  const { ctx } = build();
  const f = ctx.fail("two", "it broke", { code: 7 });
  assert.ok(f instanceof BeatFail && f instanceof Error);
  assert.deepEqual([f.step, f.detail, f.evidence], ["two", "it broke", { code: 7 }]);
  const d = ctx.done("all good", { n: 1 });
  assert.ok(d instanceof BeatDone);
  assert.deepEqual([d.detail, d.evidence], ["all good", { n: 1 }]);
  assert.equal(ctx.done().detail, "ok");
});

/* ---------------- read ---------------- */

test("read: goes through the allow-list, turns {text,values} into string + params, returns rows and rowCount", async () => {
  const { ctx, readCalls } = build();
  const a = await ctx.read("SELECT $1::int AS n", [1]);
  const b = await ctx.read({ text: "SELECT 2 AS n", values: [] });
  assert.deepEqual(a, { rows: [{ n: 1 }], rowCount: 1 });
  assert.deepEqual(readCalls, [["SELECT $1::int AS n", [1]], ["SELECT 2 AS n", []]]);
  assert.equal(b.rowCount, 1);
});

test("read: a write never reaches the read function, throws PulseRefused, and is on the harness's refusal list", async () => {
  const { ctx, readCalls } = build();
  for (const sql of ["INSERT INTO clients (a) VALUES (1)", "SELECT 1; DELETE FROM clients", "SELECT pg_sleep(5)", { text: "COMMIT" }]) {
    await assert.rejects(() => ctx.read(sql), (e) => e instanceof PulseRefused && e.kind === "sql");
  }
  assert.deepEqual(readCalls, []);
  const refused = ctxLog(ctx).refused;
  assert.equal(refused.length, 4);
  assert.ok(refused.every((r) => r.kind === "sql" && r.what));
});

test("read: a refusal that the box itself reports (box closed) is also recorded", async () => {
  const { ctx } = build({ read: async () => { throw new PulseRefused("closed", "read_box_is_closed", "SELECT 1"); } });
  await assert.rejects(() => ctx.read("SELECT 1"), PulseRefused);
  assert.deepEqual(ctxLog(ctx).refused.map((r) => r.kind), ["closed"]);
});

test("read: an ordinary database error passes through and is NOT a refusal", async () => {
  const { ctx } = build({ read: async () => { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); } });
  await assert.rejects(() => ctx.read("SELECT 1 FROM nope"), /does not exist/);
  assert.deepEqual(ctxLog(ctx).refused, []);
});

test("read: with no database it says so, and after the beat's signal aborts nothing more is read", async () => {
  const { ctx } = build({ read: null });
  await assert.rejects(() => ctx.read("SELECT 1"), /not available/);
  const calls = [];
  const live = build({ read: async (t) => { calls.push(t); return { rows: [] }; } });
  live.ctx[HARNESS].abort();
  assert.equal(live.ctx.signal.aborted, true);
  await assert.rejects(() => live.ctx.read("SELECT 1"), /beat is over/);
  assert.deepEqual(calls, []);
});

/* ---------------- http ---------------- */

test("http: a declared host and method goes through; SITE is the site's host", async () => {
  const { ctx, probeCalls } = build();
  await ctx.http.get("https://fundhub.ai/roadmap");
  await ctx.http.get("https://api.example.com/v1");
  await ctx.http.head("https://API.example.com/v1");
  assert.deepEqual(probeCalls.map((c) => c[0]), ["GET", "GET", "HEAD"]);
  assert.equal(ctxLog(ctx).http.length, 3);
});

test("http: a host or method the beat did not declare is refused, thrown, and recorded", async () => {
  const { ctx, probeCalls } = build();
  await assert.rejects(() => ctx.http.get("https://evil.example.org/"), (e) => e instanceof PulseRefused && e.kind === "host");
  await assert.rejects(() => ctx.http.head("https://fundhub.ai/"), (e) => e instanceof PulseRefused, "SITE is GET only in this beat");
  await assert.rejects(() => ctx.http.get("not a url"), (e) => e instanceof PulseRefused);
  await assert.rejects(() => ctx.http.get("https://fundhub.ai.evil.example.org/"), PulseRefused, "a look-alike host is a different host");
  assert.deepEqual(probeCalls, []);
  assert.equal(ctxLog(ctx).refused.length, 4);
  assert.ok(ctxLog(ctx).refused.every((r) => r.kind === "host"));
});

test('http: "*" reaches other hosts but never our own domain', async () => {
  const beat = beatWith({ reads: [{ host: "*", methods: ["GET"] }] });
  const { ctx, probeCalls } = build({ beat });
  const ok = await ctx.http.get("https://creditunion.example.com/apply");
  assert.equal(ok.ok, true);
  for (const own of ["https://fundhub.ai/", "https://apply.fundhub.ai/x", "https://deep.sub.fundhub.ai/"]) {
    const r = await ctx.http.get(own);
    assert.equal(r.ok, false, own);
    assert.equal(r.class, "refused");
  }
  assert.equal(probeCalls.length, 1);
  await assert.rejects(() => ctx.http.head("https://creditunion.example.com/"), PulseRefused, "HEAD was not declared");
});

test("http: a beat can pass headers only; it cannot hand the probe its own fetch, env or http switch", async () => {
  const { ctx, probeCalls } = build();
  await ctx.http.get("https://api.example.com/", {
    headers: { authorization: "Basic x" }, fetchImpl: () => {}, env: { ADAPTERS_DRY_RUN: "0" }, allowHttpSite: true, timeoutMs: 99999, method: "POST"
  });
  assert.deepEqual(Object.keys(probeCalls[0][2]).sort(), ["headers", "siteHost"]);
  assert.deepEqual(probeCalls[0][2].headers, { authorization: "Basic x" });
  assert.equal(probeCalls[0][2].siteHost, "fundhub.ai");
});

test("http: with no probe it says so", async () => {
  const { ctx } = build({ probe: null });
  await assert.rejects(() => ctx.http.get("https://fundhub.ai/"), /not available/);
});

/* ---------------- dbSettings ---------------- */

test("dbSettings: delegates to the injected function; without one it says so", async () => {
  const a = build({ dbSettings: async () => ({ ok: true, transaction_read_only: false }) });
  assert.deepEqual(await a.ctx.dbSettings(), { ok: true, transaction_read_only: false });
  await assert.rejects(() => build().ctx.dbSettings(), /not available/);
});

/* ---------------- the fake ctx ---------------- */

test("fake ctx: a query with no canned answer FAILS LOUDLY; a canned one answers", async () => {
  const beat = beatWith();
  const ctx = makeFakeCtx(beat, { read: [{ match: /FROM a\b/, rows: [{ x: 1 }] }, { match: "FROM b", error: "relation b is gone" }] });
  assert.deepEqual((await ctx.read("SELECT x FROM a")).rows, [{ x: 1 }]);
  await assert.rejects(() => ctx.read("SELECT x FROM b"), /relation b is gone/);
  await assert.rejects(() => ctx.read("SELECT x FROM c"), /no canned answer/);
  const none = makeFakeCtx(beat);
  await assert.rejects(() => none.read("SELECT 1"), /no canned answer/, "no overrides means no answers, not empty answers");
});

test("fake ctx: the same allow-list applies, even to a canned answer", async () => {
  const ctx = makeFakeCtx(beatWith(), { read: [{ match: /./, rows: [] }] });
  await assert.rejects(() => ctx.read("DELETE FROM clients"), PulseRefused);
  assert.equal(ctxLog(ctx).refused.length, 1);
});

test("fake ctx: read as a function; http as a map, rules, or a function; unmatched http is a failed call, not a pass", async () => {
  const beat = beatWith({ reads: [{ host: "SITE", methods: ["GET", "HEAD"] }, { host: "api.example.com", methods: ["GET"] }] });
  const fn = makeFakeCtx(beat, { read: (text, params) => ({ rows: [{ text, params }] }) });
  assert.deepEqual((await fn.read("SELECT $1", [5])).rows, [{ text: "SELECT $1", params: [5] }]);

  const map = makeFakeCtx(beat, { http: { "GET https://fundhub.ai/a": { status: 404 }, "https://fundhub.ai/b": { status: 200, body: "hello" } } });
  const a = await map.http.get("https://fundhub.ai/a");
  assert.deepEqual([a.ok, a.status, a.class, a.error], [false, 404, "http_4xx", null]);
  const b = await map.http.get("https://fundhub.ai/b");
  assert.deepEqual([b.ok, b.body, b.bodySnippet, b.finalHost], [true, "hello", "hello", "fundhub.ai"]);
  const miss = await map.http.get("https://fundhub.ai/zzz");
  assert.deepEqual([miss.ok, miss.class], [false, "fake_unmatched"]);

  const rules = makeFakeCtx(beat, { http: [{ match: /v1/, method: "GET", result: { status: 500 } }] });
  assert.equal((await rules.http.get("https://api.example.com/v1")).class, "http_5xx");

  const f = makeFakeCtx(beat, { http: async (method, url) => (method === "GET" ? { status: 201 } : new Error("net down")) });
  assert.equal((await f.http.get("https://fundhub.ai/")).status, 201);
  assert.deepEqual([(await f.http.head("https://fundhub.ai/")).ok, (await f.http.head("https://fundhub.ai/")).class], [false, "network"]);

  assert.deepEqual(fakeProbeResult({ status: 301 }, "https://x.example.com/").class, "redirect");
});

test("fake ctx: the declared-host check is the real one, so a beat's test catches an undeclared call", async () => {
  const ctx = makeFakeCtx(beatWith(), { http: { "GET https://elsewhere.example.org/": { status: 200 } } });
  await assert.rejects(() => ctx.http.get("https://elsewhere.example.org/"), PulseRefused);
});

test("fake ctx: env, now, siteUrl, state and dbSettings can be set; defaults are sane", async () => {
  const beat = beatWith();
  const d = makeFakeCtx(beat);
  assert.equal(d.live, false);
  assert.equal(d.siteUrl, "https://fundhub.ai");
  assert.deepEqual(await d.dbSettings(), { ok: true, ms: 3, transaction_read_only: false, default_transaction_read_only: false, in_recovery: false });
  const c = makeFakeCtx(beat, { env: { NETLIFY: "true", X: "1" }, now: new Date("2027-01-01T00:00:00Z"), siteUrl: "https://staging.example.com", state: { bankLinks: [] }, dbSettings: { transaction_read_only: true } });
  assert.equal(c.live, true);
  assert.equal(c.now.toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(c.siteUrl, "https://staging.example.com");
  assert.deepEqual(c.state, { bankLinks: [] });
  assert.equal((await c.dbSettings()).transaction_read_only, true);
  const given = new Date("2027-01-01T00:00:00Z");
  const copy = makeFakeCtx(beat, { now: given });
  copy.now.setUTCFullYear(1999);
  assert.equal(given.getUTCFullYear(), 2027, "now is copied, not shared");
});

test("makeBeatCtx needs a beat with steps", () => {
  assert.throws(() => makeBeatCtx({}), TypeError);
  assert.throws(() => makeBeatCtx({ beat: { id: "x" } }), TypeError);
});

/* ---------------- checker findings, 2026-10-09: a call the beat never awaits cannot kill the run ---------------- */

import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

test("ctx: a refused read the beat did not await is NOT an unhandled rejection; the run is red at no-refusals instead", async () => {
  const seen = [];
  const onUnhandled = (err) => seen.push(String((err && err.message) || err));
  process.on("unhandledRejection", onUnhandled);
  try {
    const beat = makeFixtureBeat({
      async run(ctx) {
        ctx.read("SELECT 1; DELETE FROM t"); // no await: refused
        ctx.http.get("https://not-declared.example/x"); // no await: refused
        ctx.dbSettings(); // no await, no dbSettings in this ctx: rejects
        ctx.step("nope", async () => 1); // no await, undeclared step: rejects
        return ctx.done("looks fine");
      }
    });
    const r = await runBeat(beat, makeFakeCtx(beat));
    assert.deepEqual([r.ok, r.step], [false, "no-refusals"]);
    await new Promise((resolve) => setTimeout(resolve, 60)); // let Node raise any unhandled rejection
    assert.deepEqual(seen, [], "no promise from the ctx was left without a handler");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("ctx: the same beat in a child process with NO unhandledRejection listener exits 0 (Node 22 would kill it otherwise)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const url = (f) => pathToFileURL(path.join(here, f)).href;
  const script = `
    import { runBeat } from ${JSON.stringify(url("contract.mjs"))};
    import { makeFakeCtx } from ${JSON.stringify(url("ctx.mjs"))};
    import { makeFixtureBeat } from ${JSON.stringify(url("../fake-sinks.mjs"))};
    const beat = makeFixtureBeat({
      async run(ctx) {
        ctx.read("SELECT 1; DELETE FROM t");
        ctx.http.get("https://not-declared.example/x");
        ctx.http.head("https://not-declared.example/x");
        ctx.step("nope", async () => 1);
        return ctx.done("fine");
      }
    });
    const r = await runBeat(beat, makeFakeCtx(beat));
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(JSON.stringify({ ok: r.ok, step: r.step }));
  `;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(run.status, 0, `child exited ${run.status}: ${run.stderr.slice(0, 300)}`);
  assert.deepEqual(JSON.parse(run.stdout.trim()), { ok: false, step: "no-refusals" });
});
