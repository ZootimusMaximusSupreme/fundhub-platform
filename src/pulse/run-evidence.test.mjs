// Run evidence — tests (zero "not checked", Ship 2, 2026-10-09).
//
// The part that matters most is the serve-handler matrix near the bottom: the REAL Inngest edge
// serve handler is driven with crafted step requests (the same protocol the Inngest engine uses),
// for a 3-step function with one parallel group. The function's whole HTTP transcript and its step
// count must be identical with the add-on off and on, whatever the database does: works, throws,
// throws before it returns, never answers, answers in 5 seconds, or is read-only. That is how
// "the add-on never changes a workflow" is proved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Inngest, InngestMiddleware } from "inngest";
import { serve } from "inngest/edge";
import {
  BREAKER_LIMIT,
  BREAKER_PAUSE_MS,
  ERROR_MAX,
  FINISH_CEIL_MS,
  FINISH_FLOOR_MS,
  FINISH_SQL,
  NOTE_MAX,
  RUN_EVIDENCE_NAME,
  START_CAP_MS,
  START_SQL,
  createRunEvidence,
  finishFields,
  isNonRetriable,
  redactText,
  runEvidenceHooks
} from "./run-evidence.mjs";

/* ---- helpers ---- */

const T0 = Date.parse("2026-10-09T17:00:00Z");

function clock() {
  let t = T0;
  return { nowFn: () => new Date(t), advance: (ms) => { t += ms; }, ms: () => t };
}

function fakeFn(id = "wf-x") {
  return { opts: { id, triggers: [{ event: "round.started" }] } };
}

function fakeCtx(over = {}) {
  return {
    event: { name: "round.started", data: { id: "11111111-2222-3333-4444-555555555555" } },
    runId: "RUN-1",
    attempt: 0,
    maxAttempts: 4,
    ...over
  };
}

/** A database that records every call and answers with `behave(config)`. */
function recorderDb(behave = async () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    query(config) {
      calls.push(config);
      return behave(config);
    }
  };
}

const permissionError = () => Object.assign(new Error("permission denied for table workflow_runs"), { code: "42501" });

/* ---- finishFields (pure) ---- */

test("finishFields: a return is ok and final", () => {
  assert.deepEqual(finishFields({ data: { done: true } }, { attempt: 0, maxAttempts: 4 }), {
    outcome: "ok", final: true, skipped: false, note: null, error: null
  });
  assert.deepEqual(finishFields({}, {}), { outcome: "ok", final: true, skipped: false, note: null, error: null });
});

test("finishFields: { skipped: true } is ok, skipped, with the reason as a note", () => {
  const f = finishFields({ data: { skipped: true, reason: "switched_off" } });
  assert.equal(f.outcome, "ok");
  assert.equal(f.skipped, true);
  assert.equal(f.note, "switched_off");
  assert.equal(finishFields({ data: { skipped: true } }).note, null);
  assert.equal(finishFields({ data: { skipped: false, reason: "x" } }).skipped, false);
  assert.equal(finishFields({ data: { skipped: "yes" } }).skipped, false, "only the real boolean counts");
});

test("finishFields: { ok: false } is an error and final; the reason or error says why", () => {
  assert.deepEqual(finishFields({ data: { ok: false, reason: "no_pay_link" } }), {
    outcome: "error", final: true, skipped: false, note: null, error: "no_pay_link"
  });
  assert.equal(finishFields({ data: { ok: false, error: "card declined" } }).error, "card declined");
  assert.equal(finishFields({ data: { ok: false } }).error, "returned ok: false");
  assert.equal(finishFields({ data: { ok: 0 } }).outcome, "ok", "only a literal false is an error");
});

test("finishFields: a throw is final only on the last attempt, a NonRetriableError, or a StepError", () => {
  const boom = new Error("boom");
  assert.deepEqual(finishFields({ error: boom }, { attempt: 0, maxAttempts: 4 }), {
    outcome: "error", final: false, skipped: false, note: null, error: "boom"
  });
  assert.equal(finishFields({ error: boom }, { attempt: 2, maxAttempts: 4 }).final, false);
  assert.equal(finishFields({ error: boom }, { attempt: 3, maxAttempts: 4 }).final, true, "attempt 3 of 4 is the last");
  assert.equal(finishFields({ error: boom }, { attempt: 0, maxAttempts: 1 }).final, true);
  assert.equal(finishFields({ error: boom }, { attempt: 0, maxAttempts: null }).final, false, "unknown max: not final");
  const nonRetriable = Object.assign(new Error("nope"), { name: "NonRetriableError" });
  assert.equal(finishFields({ error: nonRetriable }, { attempt: 0, maxAttempts: 4 }).final, true);
  const stepError = Object.assign(new Error("db down"), { stepId: "send-email" });
  assert.equal(finishFields({ error: stepError }, { attempt: 0, maxAttempts: 4 }).final, true, "a step already used up its retries");
  assert.equal(isNonRetriable(boom), false);
  assert.equal(isNonRetriable(null), false);
  assert.equal(finishFields({ error: "plain text" }, { attempt: 3, maxAttempts: 4 }).error, "plain text");
});

test("finishFields: error and note are redacted and cut to 120 characters", () => {
  const long = "word ".repeat(80);
  assert.equal(finishFields({ error: new Error(long) }).error.length, ERROR_MAX);
  assert.equal(finishFields({ data: { skipped: true, reason: long } }).note.length, NOTE_MAX);
  const secret = finishFields({ error: new Error("401 from vendor. Authorization: Bearer abc.def-123 and token=sk_live_abcdefghijklmnop") }).error;
  assert.doesNotMatch(secret, /abc\.def-123/);
  assert.doesNotMatch(secret, /sk_live_abcdefghijklmnop/);
  const mail = finishFields({ error: new Error("could not send to chris.person@example.com today") }).error;
  assert.doesNotMatch(mail, /@/);
  assert.match(mail, /\[email\]/);
});

test("redactText: tokens, emails, long strings out; empty is null; a custom max is kept", () => {
  assert.equal(redactText(""), null);
  assert.equal(redactText(null), null);
  assert.equal(redactText("   \n "), null);
  assert.doesNotMatch(redactText("key " + "a".repeat(45)), /a{40}/);
  assert.equal(redactText("short and plain"), "short and plain");
  assert.equal(redactText("abcdefghij", 5), "abcd…");
  // A uuid (36 characters) is an id, not a secret: it stays readable.
  assert.match(redactText("event 11111111-2222-3333-4444-555555555555 failed"), /11111111-2222-3333-4444-555555555555/);
});

/* ---- the hooks, with a recording database ---- */

test("the add-on returns only `finished`, and registers only onFunctionRun: it cannot change input or output", async () => {
  const { hooks } = createRunEvidence({ getDb: () => recorderDb() });
  assert.deepEqual(Object.keys(hooks), ["onFunctionRun"]);
  const out = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [] });
  assert.deepEqual(Object.keys(out), ["finished"]);
  assert.equal(await out.finished({ result: { data: 1 } }), undefined, "`finished` returns nothing");
});

test("the start mark: first request only (no steps, attempt 0), one insert, with every field", async () => {
  const clk = clock();
  const db = recorderDb();
  const { hooks } = createRunEvidence({ getDb: () => db, nowFn: clk.nowFn });
  await hooks.onFunctionRun({ fn: fakeFn("s-02-incomplete-survey-nudge"), ctx: fakeCtx(), steps: [] });
  assert.equal(db.calls.length, 1);
  const c = db.calls[0];
  assert.equal(c.text, START_SQL);
  assert.equal(c.query_timeout, START_CAP_MS);
  assert.equal(START_CAP_MS, 800);
  assert.deepEqual(c.values.slice(0, 6), ["RUN-1", 0, "s-02-incomplete-survey-nudge", "round.started", "11111111-2222-3333-4444-555555555555", 4]);
  assert.equal(c.values[6].toISOString(), "2026-10-09T17:00:00.000Z");
  assert.match(START_SQL, /ON CONFLICT \(run_id, attempt\) DO NOTHING/);
});

test("no start mark when steps are remembered, on a retry, for a cron, or when the run has no id", async () => {
  const db = recorderDb();
  const { hooks } = createRunEvidence({ getDb: () => db });
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [{ id: "a" }] });
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ attempt: 1 }), steps: [] });
  assert.equal(db.calls.length, 0, "later requests and retries write no start mark");
  const cron = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ event: { name: "inngest/scheduled.timer", data: {} } }), steps: [] });
  assert.deepEqual(cron, {}, "a cron run is left to the job heartbeat");
  assert.deepEqual(await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: undefined }), steps: [] }), {});
  assert.deepEqual(await hooks.onFunctionRun({ fn: { opts: {} }, ctx: fakeCtx(), steps: [] }), {});
  assert.deepEqual(await hooks.onFunctionRun({ fn: fakeFn(), ctx: null, steps: [] }), {});
  assert.deepEqual(await hooks.onFunctionRun(), {});
  assert.equal(db.calls.length, 0);
});

test("a run that asks again with nothing remembered (parallel steps at the start) is marked once per container", async () => {
  const db = recorderDb();
  const { hooks } = createRunEvidence({ getDb: () => db });
  for (let i = 0; i < 3; i += 1) await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [] });
  assert.equal(db.calls.length, 1);
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: "RUN-2" }), steps: [] });
  assert.equal(db.calls.length, 2, "a different run is marked");
});

test("a start mark that failed is tried again on the next request", async () => {
  let n = 0;
  const db = recorderDb(async () => { n += 1; if (n === 1) throw permissionError(); return { rows: [] }; });
  const { hooks } = createRunEvidence({ getDb: () => db, log: () => {} });
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [] });
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [] });
  assert.equal(db.calls.length, 2);
});

test("the bus event id is the string in event.data.id, and nothing else", async () => {
  const db = recorderDb();
  const { hooks } = createRunEvidence({ getDb: () => db });
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: "A", event: { name: "round.started", data: {} } }), steps: [] });
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: "B", event: { name: "round.started", data: { id: 12345 } } }), steps: [] });
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: "C", event: { name: "round.started" } }), steps: [] });
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: "D", event: { name: "round.started", data: { id: "x".repeat(101) } } }), steps: [] });
  assert.deepEqual(db.calls.map((c) => c.values[4]), [null, null, null, null]);
});

test("the finish mark: one upsert on (run_id, attempt) with the outcome, final, skipped, note and error", async () => {
  const clk = clock();
  const db = recorderDb();
  const { hooks } = createRunEvidence({ getDb: () => db, nowFn: clk.nowFn });
  const hook = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ attempt: 1 }), steps: [{ id: "a" }] });
  clk.advance(2500);
  await hook.finished({ result: { data: { skipped: true, reason: "switched_off" } } });
  assert.equal(db.calls.length, 1);
  const c = db.calls[0];
  assert.equal(c.text, FINISH_SQL);
  assert.match(FINISH_SQL, /ON CONFLICT \(run_id, attempt\) DO UPDATE/);
  assert.deepEqual(c.values.slice(0, 6), ["RUN-1", 1, "wf-x", "round.started", "11111111-2222-3333-4444-555555555555", 4]);
  assert.equal(c.values[6].toISOString(), "2026-10-09T17:00:00.000Z", "started_at is when this request began");
  assert.equal(c.values[7].toISOString(), "2026-10-09T17:00:02.500Z", "finished_at is when it ended");
  assert.deepEqual(c.values.slice(8), ["ok", true, true, "switched_off", null]);
});

test("the finish mark for a failed attempt says error and whether a retry is coming", async () => {
  const db = recorderDb();
  const { hooks } = createRunEvidence({ getDb: () => db });
  const early = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ attempt: 0, maxAttempts: 3 }), steps: [{ id: "a" }] });
  await early.finished({ result: { error: new Error("boom after step one") } });
  const last = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ attempt: 2, maxAttempts: 3 }), steps: [{ id: "a" }] });
  await last.finished({ result: { error: new Error("boom after step one") } });
  assert.deepEqual(db.calls[0].values.slice(8), ["error", false, false, null, "boom after step one"]);
  assert.deepEqual(db.calls[1].values.slice(8), ["error", true, false, null, "boom after step one"]);
});

test("the finish timer: 5 s early in a request, squeezed as the request ages, never under 500 ms", async () => {
  assert.equal(FINISH_CEIL_MS, 5000);
  assert.equal(FINISH_FLOOR_MS, 500);
  const caps = [];
  for (const used of [0, 10_000, 15_000, 17_000, 19_700, 19_900, 25_000]) {
    const clk = clock();
    const db = recorderDb();
    const { hooks } = createRunEvidence({ getDb: () => db, nowFn: clk.nowFn });
    const hook = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [{ id: "a" }] });
    clk.advance(used);
    await hook.finished({ result: { data: 1 } });
    caps.push(db.calls[0].query_timeout);
  }
  assert.deepEqual(caps, [5000, 5000, 5000, 3000, 500, 500, 500]);
});

/* ---- it never throws into a workflow, and never holds one ---- */

test("a database that throws before it returns (no DATABASE_URL) is swallowed", async () => {
  const lines = [];
  const db = { query() { throw new Error("DATABASE_URL not set"); } };
  const { hooks } = createRunEvidence({ getDb: () => db, log: (l) => lines.push(l) });
  const hook = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [] });
  assert.equal(await hook.finished({ result: { data: 1 } }), undefined);
  assert.ok(lines.length >= 1);
  assert.match(lines[0], /^\[run-evidence\]/);
});

test("a hook that hits something it did not expect (a getter that throws) still hands the workflow `{}`, never a rejection", async () => {
  const { hooks } = createRunEvidence({ getDb: () => recorderDb(), log: () => {} });
  const badCtx = { event: { name: "round.started", data: {} }, get runId() { throw new Error("getter exploded"); }, attempt: 0 };
  assert.deepEqual(await hooks.onFunctionRun({ fn: fakeFn(), ctx: badCtx, steps: [] }), {});
  const badFn = { get opts() { throw new Error("opts exploded"); } };
  assert.deepEqual(await hooks.onFunctionRun({ fn: badFn, ctx: fakeCtx(), steps: [] }), {});
  // steps that are not a list: no start mark is written, and the workflow still gets its `finished`.
  const odd = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: { get length() { throw new Error("steps exploded"); } } });
  assert.deepEqual(Object.keys(odd), ["finished"]);
  // and `finished` with a clock that throws
  const db = recorderDb();
  const { hooks: h2 } = createRunEvidence({ getDb: () => db, nowFn: (() => { let n = 0; return () => { n += 1; if (n > 2) throw new Error("clock exploded"); return new Date(T0); }; })() });
  const hook = await h2.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [{ id: "a" }] });
  assert.equal(await hook.finished({ result: { data: 1 } }), undefined);
});

test("a database whose query answers at once, with no promise, counts as a good write (it does not feed the breaker)", async () => {
  const db = { calls: [], query(config) { this.calls.push(config); return { rows: [] }; } };
  const { hooks, breaker } = createRunEvidence({ getDb: () => db, log: () => {} });
  for (let i = 0; i < 6; i += 1) await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: `S${i}` }), steps: [] });
  assert.equal(db.calls.length, 6);
  assert.equal(breaker.state().open, false);
});

test("getDb that throws, or returns nothing, is swallowed", async () => {
  for (const getDb of [() => { throw new Error("pool exploded"); }, () => null, () => ({}), undefined]) {
    const { hooks } = createRunEvidence({ getDb, log: () => {} });
    const hook = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [] });
    assert.deepEqual(Object.keys(hook), ["finished"]);
    assert.equal(await hook.finished({ result: { error: new Error("x") } }), undefined);
  }
});

test("a log that throws, or a result that is nonsense, still never reaches the workflow", async () => {
  const db = recorderDb(async () => { throw permissionError(); });
  const { hooks } = createRunEvidence({ getDb: () => db, log: () => { throw new Error("log is broken"); } });
  const hook = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [] });
  assert.equal(await hook.finished({ result: undefined }), undefined);
  assert.equal(await hook.finished(), undefined);
  assert.equal(await hook.finished({ result: { error: { get message() { throw new Error("getter"); } } } }), undefined);
});

test("a database that never answers is cut at the timer (start 800 ms)", async () => {
  const db = recorderDb(() => new Promise(() => {}));
  const { hooks } = createRunEvidence({ getDb: () => db, log: () => {} });
  const t0 = Date.now();
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [] });
  const took = Date.now() - t0;
  assert.ok(took >= 700, `waited for the timer (${took} ms)`);
  assert.ok(took < 2500, `and no longer (${took} ms)`);
});

test("a late rejection after the timer won does not become an unhandled rejection", async () => {
  let rejectLater;
  const db = recorderDb(() => new Promise((_, reject) => { rejectLater = reject; }));
  const { hooks } = createRunEvidence({ getDb: () => db, startCapMs: 20, log: () => {} });
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on("unhandledRejection", onUnhandled);
  try {
    await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx(), steps: [] });
    rejectLater(new Error("connection reset"));
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.equal(unhandled, 0);
});

/* ---- the breaker ---- */

test("the breaker: 3 failed writes stop writing for 10 minutes, with ONE line; then one try; one more failure closes it again", async () => {
  const clk = clock();
  const lines = [];
  let fail = true;
  const db = recorderDb(async () => { if (fail) throw permissionError(); return { rows: [] }; });
  const { hooks, breaker } = createRunEvidence({ getDb: () => db, nowFn: clk.nowFn, log: (l) => lines.push(l) });
  assert.equal(BREAKER_LIMIT, 3);
  assert.equal(BREAKER_PAUSE_MS, 10 * 60 * 1000);

  for (let i = 0; i < BREAKER_LIMIT; i += 1) {
    await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: `R${i}` }), steps: [] });
  }
  assert.equal(db.calls.length, 3);
  assert.equal(breaker.state().open, true);
  const opened = lines.filter((l) => /paused/.test(l));
  assert.equal(opened.length, 1, "one line when it opens");
  assert.ok(lines.every((l) => l.startsWith("[run-evidence]")));
  assert.doesNotMatch(lines.join("\n"), /values|RUN-|\$1/, "no values in the log");

  // Paused: more runs, no database calls, no more lines.
  for (let i = 0; i < 10; i += 1) {
    const h = await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: `P${i}` }), steps: [] });
    await h.finished({ result: { data: 1 } });
  }
  assert.equal(db.calls.length, 3);
  const linesWhilePaused = lines.length;

  // 10 minutes later: exactly one try. It fails: paused again at once.
  clk.advance(BREAKER_PAUSE_MS + 1);
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: "T1" }), steps: [] });
  assert.equal(db.calls.length, 4);
  assert.equal(breaker.state().open, true);
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: "T2" }), steps: [] });
  assert.equal(db.calls.length, 4);
  assert.ok(lines.length > linesWhilePaused);

  // Next pause over, the database is back: the try works, the breaker closes for good.
  clk.advance(BREAKER_PAUSE_MS + 1);
  fail = false;
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: "T3" }), steps: [] });
  assert.equal(breaker.state().open, false);
  await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: "T4" }), steps: [] });
  assert.equal(db.calls.length, 6);
});

test("one failure in the middle does not open the breaker: a success resets the count", async () => {
  let n = 0;
  const db = recorderDb(async () => { n += 1; if (n % 3 !== 0) throw permissionError(); return { rows: [] }; });
  const { hooks, breaker } = createRunEvidence({ getDb: () => db, log: () => {} });
  for (let i = 0; i < 9; i += 1) await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: `R${i}` }), steps: [] });
  assert.equal(db.calls.length, 9, "two failures then one success, again and again: never three in a row");
  assert.equal(breaker.state().open, false);
});

test("timeouts count as failures for the breaker", async () => {
  const db = recorderDb(() => new Promise(() => {}));
  const { hooks, breaker } = createRunEvidence({ getDb: () => db, startCapMs: 10, log: () => {} });
  for (let i = 0; i < 3; i += 1) await hooks.onFunctionRun({ fn: fakeFn(), ctx: fakeCtx({ runId: `R${i}` }), steps: [] });
  assert.equal(breaker.state().open, true);
});

/* ---- the real serve handler ---- */

/* The Inngest engine's side of the protocol, enough for a function with plain and parallel steps:
   ask for the next step, run any "planned" parallel steps one by one with their own request, remember
   every answer, and ask again until the function returns (HTTP 200) or fails. */
function strip(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === "timing" ? undefined : v)));
}

async function drive({ handler, appId, fnId, eventName, eventData = { id: "bus-evt-1" }, runId = "RUN-X", attempt = 0, maxAttempts = 4, memo = {} }) {
  const transcript = [];
  let timeMax = 0;
  async function call(steps, stepId = "step") {
    const body = {
      ctx: { run_id: runId, attempt, max_attempts: maxAttempts, disable_immediate_execution: false, use_api: false, stack: { stack: [], current: 0 } },
      event: { name: eventName, data: eventData, id: "evt1", ts: Date.now() },
      events: [{ name: eventName, data: eventData, id: "evt1", ts: Date.now() }],
      steps,
      use_api: false,
      version: 1
    };
    const t0 = Date.now();
    const res = await handler(new Request(`http://localhost/api/inngest?fnId=${appId}-${fnId}&stepId=${stepId}`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost" },
      body: JSON.stringify(body)
    }));
    const text = await res.text();
    timeMax = Math.max(timeMax, Date.now() - t0);
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    transcript.push({ status: res.status, body: strip(parsed) });
    return { status: res.status, body: parsed };
  }
  let last = null;
  for (let i = 0; i < 30; i += 1) {
    last = await call(memo);
    if (last.status !== 206) break;
    for (const op of Array.isArray(last.body) ? last.body : []) {
      if (op.op === "StepRun") memo[op.id] = { data: op.data };
      else if (op.op === "StepPlanned") {
        const ran = await call(memo, op.id);
        for (const o2 of Array.isArray(ran.body) ? ran.body : []) if (o2.op === "StepRun") memo[o2.id] = { data: o2.data };
      }
    }
  }
  return { transcript, final: last, slowestRequestMs: timeMax };
}

/* The SDK prints every error a workflow throws. These tests throw on purpose. */
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };

/* The workflow under test: three steps, the middle one a parallel group of two. */
function makeThreeStep(client, id, counter) {
  return client.createFunction({ id }, { event: "probe.three" }, async ({ step }) => {
    const a = await step.run("one", () => { counter.n += 1; return 1; });
    const [b, c] = await Promise.all([
      step.run("par-b", () => { counter.n += 1; return a + 1; }),
      step.run("par-c", () => { counter.n += 1; return a + 2; })
    ]);
    const d = await step.run("three", () => { counter.n += 1; return b + c; });
    return { a, b, c, d };
  });
}

function makeClient(appId, dbFor, over = {}) {
  const middleware = dbFor
    ? [new InngestMiddleware({
      name: RUN_EVIDENCE_NAME,
      init: () => runEvidenceHooks({ getDb: () => dbFor, log: () => {}, ...over })
    })]
    : [];
  return new Inngest({ id: appId, isDev: true, middleware, logger: QUIET });
}

async function runThreeStep(dbFor, over) {
  const counter = { n: 0 };
  const client = makeClient("probe-app", dbFor, over);
  const fn = makeThreeStep(client, "wf-three", counter);
  const handler = serve({ client, functions: [fn] });
  const out = await drive({ handler, appId: "probe-app", fnId: "wf-three", eventName: "probe.three" });
  return { ...out, stepBodies: counter.n };
}

const FAST = { startCapMs: 120, finishCeilMs: 250, finishFloorMs: 100 };

test("serve handler: the add-on is off — the baseline (3 steps, 1 parallel group, 4 step bodies, answer 200)", async () => {
  const base = await runThreeStep(null);
  assert.equal(base.final.status, 200);
  assert.deepEqual(base.final.body, { a: 1, b: 2, c: 3, d: 5 });
  assert.equal(base.stepBodies, 4);
  assert.equal(base.transcript.length, 6, "one; the plan; par-b; par-c; three; the return");
});

test("serve handler: with a working database the transcript and step count are identical, and the receipts are written", async () => {
  const base = await runThreeStep(null);
  const db = recorderDb();
  const on = await runThreeStep(db);
  assert.deepEqual(on.transcript, base.transcript);
  assert.equal(on.stepBodies, base.stepBodies);
  assert.equal(on.final.status, 200);
  // Exactly two writes: one start mark (first request), one finish mark (last request).
  assert.equal(db.calls.length, 2);
  assert.equal(db.calls[0].text, START_SQL);
  assert.equal(db.calls[1].text, FINISH_SQL);
  assert.deepEqual(db.calls[0].values.slice(0, 6), ["RUN-X", 0, "wf-three", "probe.three", "bus-evt-1", 4]);
  assert.deepEqual(db.calls[1].values.slice(8), ["ok", true, false, null, null]);
});

test("serve handler: a database that rejects every write changes nothing", async () => {
  const base = await runThreeStep(null);
  const db = recorderDb(async () => { throw permissionError(); });
  const on = await runThreeStep(db);
  assert.deepEqual(on.transcript, base.transcript);
  assert.equal(on.stepBodies, base.stepBodies);
  assert.equal(db.calls.length, 2, "it tried the start mark and the finish mark, once each");
});

test("serve handler: a database that throws before it returns changes nothing", async () => {
  const base = await runThreeStep(null);
  const db = { calls: [], query(config) { this.calls.push(config); throw new Error("DATABASE_URL not set"); } };
  const on = await runThreeStep(db);
  assert.deepEqual(on.transcript, base.transcript);
  assert.equal(on.stepBodies, base.stepBodies);
});

test("serve handler: a database that never answers changes nothing, and each request is held only for its timer", async () => {
  const base = await runThreeStep(null);
  const db = recorderDb(() => new Promise(() => {}));
  const t0 = Date.now();
  const on = await runThreeStep(db, FAST);
  const took = Date.now() - t0;
  assert.deepEqual(on.transcript, base.transcript);
  assert.equal(on.stepBodies, base.stepBodies);
  assert.equal(db.calls.length, 2);
  assert.ok(on.slowestRequestMs < FAST.finishCeilMs + 400, `the slowest request took ${on.slowestRequestMs} ms`);
  assert.ok(took < FAST.startCapMs + FAST.finishCeilMs + 1500, `the whole run took ${took} ms`);
});

test("serve handler: a database that answers in 5 seconds changes nothing and is not waited for", async () => {
  const base = await runThreeStep(null);
  const db = recorderDb(() => new Promise((resolve) => { setTimeout(() => resolve({ rows: [] }), 5000).unref(); }));
  const t0 = Date.now();
  const on = await runThreeStep(db, FAST);
  const took = Date.now() - t0;
  assert.deepEqual(on.transcript, base.transcript);
  assert.equal(on.stepBodies, base.stepBodies);
  assert.ok(took < 3000, `the run did not wait for the slow database (${took} ms)`);
});

test("serve handler: a read-only database takes no write, runs the workflow the same, and only ever sees our two statements", async () => {
  const base = await runThreeStep(null);
  const committed = [];
  const attempted = [];
  const readOnly = {
    query(config) {
      attempted.push(config.text);
      return Promise.reject(Object.assign(new Error("cannot execute INSERT in a read-only transaction"), { code: "25006" }));
    }
  };
  const on = await runThreeStep(readOnly);
  assert.deepEqual(on.transcript, base.transcript);
  assert.equal(on.stepBodies, base.stepBodies);
  assert.equal(committed.length, 0, "nothing was written");
  assert.deepEqual([...new Set(attempted)].sort(), [FINISH_SQL, START_SQL].sort(), "only the two receipt statements were tried");
  for (const sql of attempted) assert.match(sql, /^INSERT INTO workflow_runs/, "and both are inserts into workflow_runs, nothing else");
});

/* A run that fails: the finish mark says whether a retry is coming. */
test("serve handler: a throw writes an error receipt with the right `final`, and the HTTP answer is the same as without the add-on", async () => {
  async function run(dbFor, { attempt, maxAttempts }) {
    const client = makeClient("probe-app", dbFor);
    const fn = client.createFunction({ id: "wf-bad", retries: 3 }, { event: "probe.bad" }, async ({ step }) => {
      await step.run("one", () => 1);
      throw new Error("boom after step one for chris.person@example.com");
    });
    const handler = serve({ client, functions: [fn] });
    const memo = {};
    const first = await drive({ handler, appId: "probe-app", fnId: "wf-bad", eventName: "probe.bad", attempt, maxAttempts, memo });
    return first;
  }
  for (const [attempt, expectedFinal] of [[0, false], [2, false], [3, true]]) {
    const off = await run(null, { attempt, maxAttempts: 4 });
    const db = recorderDb();
    const on = await run(db, { attempt, maxAttempts: 4 });
    assert.deepEqual(on.transcript, off.transcript);
    const finish = db.calls.filter((c) => c.text === FINISH_SQL);
    assert.equal(finish.length, 1, `attempt ${attempt}`);
    assert.equal(finish[0].values[1], attempt);
    assert.equal(finish[0].values[8], "error");
    assert.equal(finish[0].values[9], expectedFinal, `attempt ${attempt} of 4`);
    assert.doesNotMatch(finish[0].values[12], /@/, "the address was redacted");
    assert.match(finish[0].values[12], /boom after step one/);
  }
});

test("serve handler: a step that used up its retries (StepError) is final even on attempt 0 of 4", async () => {
  const client = makeClient("probe-app", recorderDb());
  const db = recorderDb();
  const real = makeClient("probe-app", db);
  const fn = real.createFunction({ id: "wf-step-fail" }, { event: "probe.stepfail" }, async ({ step }) => {
    await step.run("risky", () => { throw new Error("vendor said no"); });
  });
  const handler = serve({ client: real, functions: [fn] });
  assert.ok(client, "unused client constructs");
  // First request runs the step; it throws; the engine would retry it. On the last try it reports the step
  // as failed, and the next request carries the step's error in the remembered steps.
  const first = await drive({ handler, appId: "probe-app", fnId: "wf-step-fail", eventName: "probe.stepfail", attempt: 3, maxAttempts: 4 });
  assert.ok([206, 400, 500].includes(first.final.status), `status ${first.final.status}`);
  const stepOp = (Array.isArray(first.final.body) ? first.final.body : []).find((o) => o.op === "StepFailed" || o.op === "StepError");
  assert.ok(stepOp, "the step failure is reported to the engine");
  db.calls.length = 0;
  const again = await drive({
    handler, appId: "probe-app", fnId: "wf-step-fail", eventName: "probe.stepfail", attempt: 0, maxAttempts: 4,
    memo: { [stepOp.id]: { error: { name: "Error", message: "vendor said no", stack: "" } } }
  });
  assert.equal(again.final.status >= 400, true, "the function throws the step's error");
  const finish = db.calls.filter((c) => c.text === FINISH_SQL);
  assert.equal(finish.length, 1);
  assert.equal(finish[0].values[1], 0, "attempt 0");
  assert.equal(finish[0].values[8], "error");
  assert.equal(finish[0].values[9], true, "final: the step already used up its retries, so no retry is coming");
  assert.match(finish[0].values[12], /vendor said no/);
});

test("serve handler: { ok: false } and { skipped: true } returns are recorded, and the answer is unchanged", async () => {
  for (const [returned, expected] of [
    [{ ok: false, reason: "no_pay_link" }, ["error", true, false, null, "no_pay_link"]],
    [{ skipped: true, reason: "switched_off" }, ["ok", true, true, "switched_off", null]],
    [{ done: true }, ["ok", true, false, null, null]]
  ]) {
    const make = (dbFor) => {
      const client = makeClient("probe-app", dbFor);
      const fn = client.createFunction({ id: "wf-ret" }, { event: "probe.ret" }, async () => returned);
      return serve({ client, functions: [fn] });
    };
    const off = await drive({ handler: make(null), appId: "probe-app", fnId: "wf-ret", eventName: "probe.ret" });
    const db = recorderDb();
    const on = await drive({ handler: make(db), appId: "probe-app", fnId: "wf-ret", eventName: "probe.ret" });
    assert.deepEqual(on.transcript, off.transcript);
    assert.equal(on.final.status, 200);
    assert.deepEqual(db.calls.at(-1).values.slice(8), expected);
    assert.equal(db.calls.length, 2, "a run with no steps: one start mark, one finish mark");
  }
});

test("serve handler: a cron run (inngest/scheduled.timer) writes no receipt here", async () => {
  const db = recorderDb();
  const client = makeClient("probe-app", db);
  const fn = client.createFunction({ id: "wf-cron" }, { cron: "*/5 * * * *" }, async () => ({ ok: true }));
  const handler = serve({ client, functions: [fn] });
  const out = await drive({ handler, appId: "probe-app", fnId: "wf-cron", eventName: "inngest/scheduled.timer" });
  assert.equal(out.final.status, 200);
  assert.equal(db.calls.length, 0);
});

/* ---- the shared client ---- */

test("the shared client lists the Run evidence add-on, and every bundled workflow is built on it", async () => {
  const { inngest } = await import("../workflows/client.mjs");
  const { functions } = await import("../workflows/index.mjs");
  const names = inngest.options.middleware.map((m) => m.name);
  assert.ok(names.includes(RUN_EVIDENCE_NAME), `middleware list: ${names.join(", ")}`);
  assert.ok(names.includes("Job heartbeat"), "the cron heartbeat is still there");
  assert.ok(functions.length >= 100, "the bundle loaded");
  const strays = functions.filter((fn) => fn.client !== inngest).map((fn) => fn.opts.id);
  assert.deepEqual(strays, []);
});

test("the shared client with NO DATABASE_URL (the pool throws at once) still runs a workflow, identical to a plain client", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const { inngest } = await import("../workflows/client.mjs");
    const counter = { n: 0 };
    const fn = makeThreeStep(inngest, "zz-run-evidence-shared-probe", counter);
    const handler = serve({ client: inngest, functions: [fn] });
    const on = await drive({ handler, appId: "fundhub-platform", fnId: "zz-run-evidence-shared-probe", eventName: "probe.three" });

    const plain = new Inngest({ id: "fundhub-platform", isDev: true, logger: QUIET });
    const counter2 = { n: 0 };
    const fn2 = makeThreeStep(plain, "zz-run-evidence-shared-probe", counter2);
    const off = await drive({ handler: serve({ client: plain, functions: [fn2] }), appId: "fundhub-platform", fnId: "zz-run-evidence-shared-probe", eventName: "probe.three" });

    assert.equal(on.final.status, 200);
    assert.deepEqual(on.transcript, off.transcript);
    assert.equal(counter.n, counter2.n);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
  }
});
