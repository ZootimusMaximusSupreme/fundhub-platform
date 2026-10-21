import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-client-portal.mjs";
import * as payLinks from "./beat-pay-links.mjs";
import * as authLinks from "./beat-auth-links.mjs";
import * as clientProgress from "./beat-client-progress.mjs";
import * as truth from "./lib/portal-truth.mjs";
import * as lane from "../coverage/gap-portal.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { DEFAULT_ORG_SQL, SELF_TEST_ORG, laneSelfTest } from "./lib/money-hourly.mjs";
import { OWNER_HOLD_CLIENTS } from "../owner-hold.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const OTHER_BEATS = { "pay-links": payLinks, "auth-links": authLinks };
const compact = (text) => String(text).trim().replaceAll(/\s+/g, " ");

/** A fake read over the pass rows, with some SQL answered differently (rows, or an Error to throw). */
function readWith(overrides = []) {
  const base = beat.LANE.selfTest.passRows.map(([sql, rows]) => [compact(sql), rows]);
  const extra = overrides.map(([sql, value]) => [compact(sql), value]);
  return async (sql) => {
    const q = compact(sql);
    if (q === compact(DEFAULT_ORG_SQL)) return { rows: [{ id: SELF_TEST_ORG }], rowCount: 1 };
    const hit = extra.find(([k]) => k === q) || base.find(([k]) => k === q);
    const value = hit ? hit[1] : [];
    if (value instanceof Error) throw value;
    return { rows: value, rowCount: value.length };
  };
}

function ctxWith({ rows = [], http = beat.selfTestHttp } = {}) {
  const spec = laneSelfTest(beat.LANE);
  return makeFakeCtx(beat, { ...spec, read: readWith(rows), http });
}

const waiting = (code, extra = {}) => ({
  client_id: `id-${code}`, client_code: code, days_held: 14.2, is_test: false,
  paid_through_door: true, signed_in: false, asked_since_access: false, ...extra
});

test("client-portal is valid, green when the portal is healthy, red at the sign-in step for a waiting client", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-client-portal.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "5 portal checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "portal-paid-client-never-signed-in");
  assert.match(failed.detail, /1 paying client has held portal access for over 72 hours and has never signed in/);
});

test("client-portal: each of its five checks can go red at its own step", async () => {
  const brokenFile = (method, url) => (new URL(url).pathname === "/app/self-test.js" ? { status: 404, body: "" } : beat.selfTestHttp(method, url));
  const cases = [
    ["portal-page-scripts-load", { http: brokenFile }, /\/app\/self-test\.js answered 404/],
    ["portal-paid-entitlement", { rows: [[truth.PAID_ENTITLEMENT_SQL, [{ client_id: "c1", is_test: false, has_entitlement: false }]]] }, /1 paid client has no entitlement/],
    ["portal-next-step", { rows: [[truth.NEXT_STEP_SQL, [{ client_id: "c2", reason: "paid_checklist" }]]] }, /1 client should have a next step/],
    ["portal-summary", { rows: [[truth.SUMMARY_READS[1].sql, new Error('column "outcome_tier" does not exist')]] }, /read "credit results" failed/],
    ["portal-paid-client-never-signed-in", { rows: [[truth.NEVER_SIGNED_IN_SQL, [waiting("FH-000999")]]] }, /never signed in/]
  ];
  for (const [step, setup, detail] of cases) {
    const result = await runBeat(beat, ctxWith(setup));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
    assert.match(result.detail, detail, step);
  }
});

test("client-portal: the documents read is part of the summary step", async () => {
  const result = await runBeat(beat, ctxWith({ rows: [[truth.LIBRARY_SQL, new Error('relation "document_versions" does not exist')]] }));
  assert.equal(result.ok, false);
  assert.equal(result.step, "portal-summary");
  assert.match(result.detail, /read "documents" failed/);
});

test("client-portal: a waiting client on the owner's hold (Braum) is nothing to judge, never red", async () => {
  assert.deepEqual(OWNER_HOLD_CLIENTS.map((c) => c.clientCode), ["FH-000507"]);
  const held = await runBeat(beat, ctxWith({ rows: [[truth.NEVER_SIGNED_IN_SQL, [waiting("FH-000507")]]] }));
  assert.equal(held.ok, true, held.detail);
  assert.match(held.detail, /^4 portal checks passed; 1 had nothing safe to judge$/);
  const step = held.steps.find((s) => s.name === "portal-paid-client-never-signed-in");
  assert.ok(step.skipped);
  assert.match(step.why, /FH-000507, on the owner's no-contact hold/);

  // Braum plus anyone else is red, as on the morning pulse.
  const both = await runBeat(beat, ctxWith({ rows: [[truth.NEVER_SIGNED_IN_SQL, [waiting("FH-000507"), waiting("FH-000998")]]] }));
  assert.equal(both.ok, false);
  assert.equal(both.step, "portal-paid-client-never-signed-in");
  assert.match(both.detail, /2 paying clients have held portal access/);
});

test("client-portal: a page over the probe's 64 KB is read to the end in byte ranges and judged whole", async () => {
  const CHUNK = truth.PROBE_CHUNK_BYTES;
  const big = (() => {
    const head = '<!doctype html><html><head><title>Portal</title></head><body><div data-tile="next"></div>';
    const tail = '<script src="/app/late.js"></script></body></html>';
    return head + "x".repeat(CHUNK * 2 + 1000 - head.length - tail.length) + tail;
  })();
  const ranges = [];
  const http = (method, url, opts) => {
    const { pathname } = new URL(url);
    if (pathname === "/app/client-portal.html") {
      const range = opts && opts.headers && opts.headers.range;
      if (!range) return { status: 200, body: big.slice(0, CHUNK), truncated: true, bytes: CHUNK, headers: { "content-type": "text/html" } };
      ranges.push(range);
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range).map(Number);
      const end = Math.min(b, big.length - 1);
      return { status: 206, body: big.slice(a, end + 1), headers: { "content-range": `bytes ${a}-${end}/${big.length}` } };
    }
    if (pathname === "/app/late.js") return { status: 200, body: "late();", headers: { "content-type": "application/javascript" } };
    return beat.selfTestHttp(method, url);
  };
  const whole = await runBeat(beat, ctxWith({ http }));
  assert.equal(whole.ok, true, whole.detail);
  assert.deepEqual(ranges, [`bytes=${CHUNK}-${2 * CHUNK - 1}`, `bytes=${2 * CHUNK}-${3 * CHUNK - 1}`]);

  // The script named only past the first 64 KB is really read: break it and the step is red.
  const lateBroken = (method, url, opts) => (new URL(url).pathname === "/app/late.js" ? { status: 404, body: "" } : http(method, url, opts));
  const red = await runBeat(beat, ctxWith({ http: lateBroken }));
  assert.equal(red.ok, false);
  assert.equal(red.step, "portal-page-scripts-load");
  assert.match(red.detail, /\/app\/late\.js answered 404/);

  // The site stops honoring ranges: the page is not read, so it is not judged (a skip, never a red).
  const noRanges = (method, url, opts) => {
    if (new URL(url).pathname === "/app/client-portal.html" && opts && opts.headers && opts.headers.range) {
      return { status: 200, body: big.slice(0, CHUNK), truncated: true, bytes: CHUNK, headers: { "content-type": "text/html" } };
    }
    return http(method, url, opts);
  };
  const cut = await runBeat(beat, ctxWith({ http: noRanges }));
  assert.equal(cut.ok, true, cut.detail);
  const step = cut.steps.find((s) => s.name === "portal-page-scripts-load");
  assert.ok(step.skipped);
  assert.match(step.why, /1 page could not be read to the end in byte ranges/);
});

test("client-portal: webFromProbe answers like a fetch and stops on the per-file timer", async () => {
  const http = { get: async () => ({ status: 200, body: "ok", headers: { "content-type": "text/plain" } }) };
  const res = await truth.webFromProbe(http)("https://fundhub.ai/x", {});
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
  assert.equal(res.headers.get("Content-Type"), "text/plain");
  assert.equal(res.partial, false);

  // A probe that never answers: the lane's per-file timer stops the read. (A plain controller and a
  // held timer here, because AbortSignal.timeout does not keep the test process alive.)
  let hold;
  const never = { get: () => new Promise((resolve) => { hold = setTimeout(resolve, 5000); }) };
  const timer = new AbortController();
  setTimeout(() => timer.abort(), 20);
  await assert.rejects(() => truth.webFromProbe(never)("https://fundhub.ai/x", { signal: timer.signal }), /no answer in time/);
  clearTimeout(hold);
  const dead = { get: async () => ({ status: 0, error: "timed out after 8000ms" }) };
  await assert.rejects(() => truth.webFromProbe(dead)("https://fundhub.ai/x", {}), /timed out/);
  assert.deepEqual(truth.contentRange("bytes 65536-131071/238408"), { start: 65536, end: 131071, total: 238408 });
  assert.equal(truth.contentRange("bytes */238408"), null);
});

test("client-portal: the morning lane and the hourly beat share one SQL, one judge and one page reader", () => {
  for (const name of [
    "PAID_ENTITLEMENT_SQL", "UNRESOLVED_PAID_SQL", "NEXT_STEP_SQL", "SUMMARY_CLIENT_SQL", "SUMMARY_READS", "LIBRARY_SQL",
    "NEVER_SIGNED_IN_SQL", "CUSTOMER_PAGES", "checkPaidEntitlement", "checkNextStep", "checkPortalSummary",
    "checkPaidNeverSignedIn", "pageAssets", "checklistProductCodes", "TEST_CLIENT_EMAIL_RE", "INTERNAL_CLIENT_EMAIL_RE"
  ]) {
    assert.equal(lane[name], truth[name], name);
  }
  // The lane keeps its fetch-shaped door; it hands the same function the run's fetch.
  assert.notEqual(lane.checkPageScripts, truth.checkPageScripts);
  assert.ok(lane.READ_ONLY_SQL_TIER_1.includes(truth.NEVER_SIGNED_IN_SQL));
  // The hourly list is the lane's own ids, less the two only the morning can run.
  assert.deepEqual(beat.HOURLY_CHECK_IDS, [
    "portal:page-scripts-load", "portal:paid-entitlement", "portal:next-step", "portal:summary", "portal:paid-client-never-signed-in"
  ]);
});

test("client-portal: every surface it covers has every named deep check run hourly", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) {
      if (beat.HOURLY_CHECK_IDS.includes(checkId)) continue;
      const elsewhere = beat.RUNS_ELSEWHERE[checkId];
      assert.ok(elsewhere, `${surface} needs ${checkId} hourly`);
      const [otherId, step] = elsewhere;
      assert.equal(OTHER_BEATS[otherId].id, otherId);
      assert.ok(OTHER_BEATS[otherId].steps.includes(step), `${otherId} has no step ${step}`);
    }
  }
  // The two progress surfaces need the real progress read: the beat client-progress runs it hourly
  // (lib/progress-check.mjs), so they are that beat's surfaces, not this one's.
  for (const surface of ["page:progress.html", "route:read/client-progress"]) {
    assert.ok(!beat.covers.includes(surface), surface);
    assert.ok(TRIPWIRES[surface].checks.includes("portal:progress-read-real-client"));
    assert.ok(clientProgress.covers.includes(surface), surface);
  }
  assert.deepEqual(clientProgress.HOURLY_CHECK_IDS, ["portal:progress-read-real-client"]);
});
