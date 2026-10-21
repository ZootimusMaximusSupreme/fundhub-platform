import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-client-progress.mjs";
import * as check from "./lib/progress-check.mjs";
import * as read from "./lib/progress-read.mjs";
import * as appRead from "../../progress/read.mjs";
import * as appPipeline from "../../repair/pipeline.mjs";
import * as lane from "../coverage/gap-portal.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { ctxLog, makeFakeCtx } from "./ctx.mjs";
import { assertReadOnlySql } from "./readbox.mjs";
import { DEFAULT_ORG_SQL, SELF_TEST_ORG, laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const compact = (text) => String(text).trim().replaceAll(/\s+/g, " ");
const CLIENT = "33333333-3333-4333-8333-333333333333";

/** A fake read: the pass rows, plus answers picked by a test (rows, or an Error to throw) for SQL matching a regex. */
function readWith(swaps = []) {
  const base = beat.LANE.selfTest.passRows.map(([sql, rows]) => [compact(sql), rows]);
  const seen = [];
  const fn = async (sql, params) => {
    const q = compact(sql);
    seen.push(q);
    if (q === compact(DEFAULT_ORG_SQL)) return { rows: [{ id: SELF_TEST_ORG }], rowCount: 1 };
    const swap = swaps.find(([re]) => re.test(q));
    const value = swap ? swap[1] : (base.find(([k]) => k === q) || [null, []])[1];
    if (value instanceof Error) throw value;
    return { rows: value, rowCount: value.length };
  };
  fn.seen = seen;
  return fn;
}

function ctxWith(swaps = []) {
  const spec = laneSelfTest(beat.LANE);
  const r = readWith(swaps);
  return { ctx: makeFakeCtx(beat, { ...spec, read: r }), seen: r.seen };
}

test("client-progress is valid, green on a clean read, red at the progress step when the page and the rows disagree", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-client-progress.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passCtx = makeFakeCtx(beat, beat.selfTest.pass());
  const passed = await runBeat(beat, passCtx);
  assert.equal(passed.ok, true, passed.detail);
  assert.deepEqual(ctxLog(passCtx).refused, []);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "portal-progress-read-real-client");
  assert.match(failed.detail, /the client has 4 checklist steps on file and the page gets 0/);
});

test("client-progress runs the real progress read, every statement a plain read, and reads only through ctx.read", async () => {
  const { ctx, seen } = ctxWith();
  const r = await runBeat(beat, ctx);
  assert.equal(r.ok, true, r.detail);
  // The page's own reads ran, not a stand-in: the checklist, the score pulls, the documents, the entitlements.
  for (const table of [/FROM client_waypoints/, /FROM crs_results/, /FROM documents/, /FROM entitlement_catalog/, /FROM paid_service_requests/]) {
    assert.ok(seen.some((q) => table.test(q)), `the progress read did not read ${table}`);
  }
  for (const q of seen) {
    assert.equal(check.isPlainRead(q), true, q.slice(0, 80));
    assertReadOnlySql(q);
  }
  assert.deepEqual(ctxLog(ctx).http, []);
});

test("client-progress is red when one read behind the page fails, even though the page code swallows it", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { ctx } = ctxWith([[/FROM businesses/, new Error('column "age_months" does not exist')]]);
  const r = await runBeat(beat, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.step, "portal-progress-read-real-client");
  assert.match(r.detail, /1 read behind the page failed and the page would show an empty section: column "age_months" does not exist/);
});

test("client-progress is red when the repair card's stage is not the stage the page shows", async () => {
  const { ctx } = ctxWith([
    [/gap:portal-progress-rows/, [{ waypoints: 0, deliverables: 0, repair_stages: ["awaiting_response"] }]]
  ]);
  const r = await runBeat(beat, ctx);
  assert.equal(r.ok, false);
  assert.match(r.detail, /repair card is at "awaiting_response" and the page shows "no stage"/);
});

test("client-progress has nothing to judge when no real client has paid, and never calls that green", async () => {
  const { ctx } = ctxWith([[/gap:portal-progress-client/, []]]);
  const r = await runBeat(beat, ctx);
  assert.equal(r.ok, true);
  assert.match(r.detail, /0 progress checks passed; 1 had nothing safe to judge/);
});

test("client-progress: one copy of the read and the check, shared with the page and the morning lane", async () => {
  // The page's read is the library's read; src/progress/read.mjs only adds the server's env.
  for (const name of ["ownedNotReady", "nextStepOf", "waitingOn", "publicServiceKey", "paidRoundOffer", "roundNumber", "scoresOfResult"]) {
    assert.equal(appRead[name], read[name], name);
  }
  assert.equal(appRead.DOCUMENT_ENTITLEMENTS, read.DOCUMENT_ENTITLEMENTS);
  assert.equal(appPipeline.readRepairStage, (await import("./lib/repair-stage.mjs")).readRepairStage);
  // The lane re-exports the library's SQL and guard, and its check runs the library's check.
  assert.equal(lane.PROGRESS_CLIENT_SQL, check.PROGRESS_CLIENT_SQL);
  assert.equal(lane.PROGRESS_ROWS_SQL, check.PROGRESS_ROWS_SQL);
  assert.equal(lane.isPlainRead, check.isPlainRead);
  const db = {
    query: async (sql) => {
      if (/gap:portal-progress-client/.test(sql)) return { rows: [{ id: CLIENT }] };
      if (/gap:portal-progress-rows/.test(sql)) return { rows: [{ waypoints: 0, deliverables: 0, repair_stages: [] }] };
      return { rows: [] };
    }
  };
  const viaLane = await lane.checkProgressRead({ run: (fn) => fn(db), orgId: SELF_TEST_ORG });
  const viaLib = await check.checkProgressRead({ run: (fn) => fn(db), orgId: SELF_TEST_ORG });
  assert.deepEqual(viaLane, viaLib);
  assert.equal(viaLane.status, "PASS");
});

test("client-progress: the page's read and the library's read give the same answer for the same rows", async () => {
  const db = {
    query: async (sql) => {
      if (/FROM client_waypoints/.test(sql)) {
        return { rows: [{ id: "w1", position: 1, title: "Form your LLC", owner_kind: "client", state: "not_started", due_at: null, verify_kind: null }] };
      }
      if (/FROM documents/.test(sql)) return { rows: [{ id: "d1", subtype: "credit_analysis_report", title: "Report", generated_at: "2026-10-01T00:00:00.000Z" }] };
      return { rows: [] };
    }
  };
  const now = new Date("2026-10-20T12:00:00.000Z");
  const env = { URL: "https://fundhub.ai" };
  const fromPage = await read.readClientProgress(db, { orgId: SELF_TEST_ORG, clientId: CLIENT, now, env });
  const fromApp = await appRead.readClientProgress(db, { orgId: SELF_TEST_ORG, clientId: CLIENT, now });
  assert.deepEqual(fromApp, fromPage);
  assert.equal(fromPage.waypoints.length, 1);
  assert.equal(fromPage.nextStep.owner, "client");
  assert.equal(fromPage.deliverables.length, 1);
});

test("client-progress: both surfaces it covers have their one deep check run here", () => {
  assert.deepEqual([...beat.covers].sort(), ["page:progress.html", "route:read/client-progress"]);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId), `${surface} needs ${checkId}`);
  }
});
