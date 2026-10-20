import test from "node:test";
import assert from "node:assert/strict";
import { channel } from "node:diagnostics_channel";
import { diagnosticTarget, errorFacts, lastPhase, MATCHED_CONCURRENCIES, observeFetch, PATHS, runFixedPathStage } from "./diagnose-site-http.mjs";

test("matched high/low stages cover the same twelve paths and low stages never exceed three active requests", async () => {
  assert.deepEqual(MATCHED_CONCURRENCIES, [12, 3, 12, 3]);
  for (const concurrency of MATCHED_CONCURRENCIES) {
    const seen = [];
    let active = 0;
    let peak = 0;
    const stage = await runFixedPathStage(concurrency, async (path) => {
      seen.push(path);
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
    });
    assert.deepEqual(seen, PATHS);
    assert.equal(peak, concurrency);
    assert.equal(stage.peakActive, concurrency);
    assert.equal(stage.completed, 12);
    assert.equal(stage.complete, true);
    assert.equal(stage.skipped, 0);
  }
});

test("a deadline-shortened stage reports unstarted paths instead of a complete comparison", async () => {
  let stop = false;
  const stage = await runFixedPathStage(3, async () => { stop = true; }, () => stop);
  assert.equal(stage.complete, false);
  assert.equal(stage.started, 1);
  assert.equal(stage.completed, 1);
  assert.equal(stage.skipped, 11);
});

test("health uses the actual strict door and arbitrary network targets are refused", () => {
  const health = diagnosticTarget("/api/health");
  assert.equal(health.origin, "https://fundhub.ai");
  assert.equal(health.searchParams.get("strict"), "1");
  assert.equal(diagnosticTarget("/portal-login.html").search, "");
  assert.throws(() => diagnosticTarget("https://unrelated.example"));
  assert.throws(() => diagnosticTarget("/api/health?key=secret-value"));
});

test("a sent native GET with no response is separated from a socket or body stall", () => {
  const emitted = [];
  const trace = observeFetch((row) => emitted.push(row));
  try {
    const request = {};
    const row = { started: performance.now(), times: {} };
    trace.run(row, () => channel("undici:request:create").publish({ request }));
    assert.equal(lastPhase(row.times), "request-created-not-yet-written");
    channel("undici:client:sendHeaders").publish({ request, socket: {}, headers: "Authorization: never-print-this" });
    channel("undici:request:bodySent").publish({ request });
    assert.equal(lastPhase(row.times), "request-sent-awaiting-headers");
    channel("undici:request:headers").publish({ request, response: { headers: ["customer-data"], body: "private-body" } });
    assert.equal(lastPhase(row.times), "reading-response-body");
    assert.doesNotMatch(JSON.stringify({ row, emitted }), /never-print-this|customer-data|private-body/);
  } finally { trace.close(); }
});

test("shared connections never become fabricated per-request connection proof", () => {
  const emitted = [];
  const trace = observeFetch((row) => emitted.push(row));
  const row = { started: performance.now(), times: {} };
  try {
    trace.run(row, () => channel("undici:client:beforeConnect").publish({
      connectParams: { hostname: "fundhub.ai", headers: "private-header" }
    }));
    assert.equal(lastPhase(row.times), "request-started");
    assert.deepEqual(Object.keys(row.times), []);
    assert.equal(emitted[0].event, "before-connect");
    assert.doesNotMatch(JSON.stringify(emitted), /private-header/);
    channel("undici:request:create").publish({ request: { path: "/?key=private-query" } });
    channel("undici:client:connected").publish({ connectParams: { hostname: "unrelated.example" }, socket: {} });
    assert.equal(emitted.length, 1);
  } finally { trace.close(); }
});

test("a stalled redirected request cannot borrow the first hop's successful response headers", () => {
  const trace = observeFetch(() => {});
  const row = { started: performance.now(), times: {} };
  const first = {};
  const redirected = {};
  try {
    trace.run(row, () => channel("undici:request:create").publish({ request: first }));
    channel("undici:request:headers").publish({ request: first });
    trace.run(row, () => channel("undici:request:create").publish({ request: redirected }));
    assert.equal(lastPhase(row.times), "request-created-not-yet-written");
    channel("undici:request:headers").publish({ request: first });
    assert.equal(lastPhase(row.times), "request-created-not-yet-written");
    assert.equal(row.priorHops.length, 1);
    assert.notEqual(row.priorHops[0].times.responseHeaders, undefined);
  } finally { trace.close(); }
});

test("network errors retain nested transport codes without messages or secret values", () => {
  const error = new AggregateError([Object.assign(new Error("https://fundhub.ai/?key=secret-value"), { code: "ENETUNREACH" })], "private body");
  error.cause = Object.assign(new Error("Authorization: secret"), { code: "ETIMEDOUT" });
  const facts = errorFacts(error);
  assert.equal(facts.error, "AggregateError");
  assert.deepEqual(facts.codes.sort(), ["ENETUNREACH", "ETIMEDOUT"]);
  assert.doesNotMatch(JSON.stringify(facts), /private|secret|Authorization|https/);
});
