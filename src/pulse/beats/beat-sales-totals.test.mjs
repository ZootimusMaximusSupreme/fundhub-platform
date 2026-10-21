import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-sales-totals.mjs";
import * as pipelineFacts from "./beat-pipeline-facts.mjs";
import * as truth from "./lib/sales-totals-truth.mjs";
import * as lane from "../coverage/gap-sales-manager.mjs";
import * as metrics from "../../sales/metrics.mjs";
import { checkBeatSelfTest, pinBeatSource, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { DEFAULT_ORG_SQL, SELF_TEST_NOW, SELF_TEST_ORG, laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OTHER_BEATS = { "pipeline-facts": pipelineFacts };
const compact = (text) => String(text).trim().replaceAll(/\s+/g, " ");

/** A fake read over the pass rows, with some SQL answered differently (rows, or an Error to throw). */
function readWith(overrides = []) {
  const base = beat.PASS_ROWS.map(([sql, rows]) => [compact(sql), rows]);
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

const ctxWith = (overrides) => makeFakeCtx(beat, { ...laneSelfTest(beat.LANE), read: readWith(overrides) });

test("sales-totals is valid, green on a plain month and red at the totals step when team cash is below zero", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-sales-totals.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "1 sales floor total checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "sales-manager-totals");
  assert.match(failed.detail, /team cash is not a number/);
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps);
});

test("sales-totals: each number the floor shows can turn it red", async () => {
  const cases = [
    [[truth.FLOOR_OUTCOMES_SQL, [{ held: -1, deposits: 0, downsells: 0, downsell_cents: "0" }]], /held calls is not a number/],
    [[truth.FLOOR_OUTCOMES_SQL, [{ held: "x", deposits: 0, downsells: 0, downsell_cents: "0" }]], /held calls is not a number/],
    [[truth.DEPOSIT_TO_FUNDED_SQL, [{ deposits: 1, funded: 3 }]], /deposit to funded rate is not between 0 and 1/],
    [[truth.FLOOR_CASH_SQL, [{ cents: "lots" }]], /team cash is not a number/]
  ];
  for (const [override, pattern] of cases) {
    const result = await runBeat(beat, ctxWith([override]));
    assert.equal(result.ok, false, String(pattern));
    assert.equal(result.step, "sales-manager-totals");
    assert.match(result.detail, pattern);
  }
});

test("sales-totals: a failed totals read is red, as on the morning pulse (the page would answer 500)", async () => {
  const result = await runBeat(beat, ctxWith([[truth.FLOOR_BOOKED_SQL, new Error("column \"client_id\" does not exist")]]));
  assert.equal(result.ok, false);
  assert.equal(result.step, "sales-manager-totals");
  assert.match(result.detail, /manager totals cannot be read: column "client_id" does not exist/);
});

test("sales-totals: the page, the morning lane and the hourly beat share one SQL, one set of numbers and one judge", async () => {
  // The lane's verdict is the library's.
  assert.equal(lane.totalsProblems, truth.totalsProblems);
  // metrics.mjs re-exports the library's helpers rather than holding its own.
  assert.equal(metrics.monthWindow, truth.monthWindow);
  assert.equal(metrics.formatUsdFromCents, truth.formatUsdFromCents);
  // salesFloor() runs exactly floorTotals(): over the same fake rows the page's numbers are the beat's numbers.
  const read = readWith();
  const db = { query: (sql, params) => read(typeof sql === "string" ? sql : sql.text, params) };
  const floor = await metrics.salesFloor(db, { orgId: SELF_TEST_ORG, now: SELF_TEST_NOW, env: {} });
  const view = truth.totalsView(await truth.floorTotals(db, { orgId: SELF_TEST_ORG, ...truth.monthWindow(SELF_TEST_NOW) }));
  assert.deepEqual(floor.funnel, view.funnel);
  assert.equal(floor.hero.cash_cents, view.hero.cash_cents);
  assert.equal(floor.hero.deposit_to_funded, view.hero.deposit_to_funded);
  assert.deepEqual(floor.funnel, {
    booked: 5, held: 4, show_rate: 0.8, deposits: 2, close_rate: 0.5, funded: 1, funded_of_deposits: 0.5,
    downsells: 0, downsell_cash_cents: 0, downsell_cash_display: "$0"
  });
  // The lane over the same rows: its totals row is the beat's verdict.
  const rows = await lane.gapChecks({ db, orgId: SELF_TEST_ORG, now: SELF_TEST_NOW });
  const laneRow = rows.find((r) => r.id === "sales-manager:totals");
  const [beatRow] = await truth.readTotalsTruth({ db, orgId: SELF_TEST_ORG, now: SELF_TEST_NOW });
  assert.deepEqual(laneRow, beatRow);
  assert.equal(beatRow.status, "PASS");
  // The library is a beat library file: no I/O, imports inside beats/lib only.
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "lib/sales-totals-truth.mjs"), "utf8"), { role: "lib" }), []);
});

test("sales-totals: no database or no company is a skip, never green", async () => {
  assert.equal((await truth.readTotalsTruth({ db: null, orgId: SELF_TEST_ORG, now: SELF_TEST_NOW }))[0].status, "skip");
  assert.equal((await truth.readTotalsTruth({ db: { query: async () => ({ rows: [] }) }, orgId: null, now: SELF_TEST_NOW }))[0].status, "skip");
});

test("sales-totals: every surface it covers has every named deep check run hourly", () => {
  assert.deepEqual(beat.covers, ["desk:sales-floor.html"]);
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
      assert.ok(OTHER_BEATS[otherId].HOURLY_CHECK_IDS.includes(checkId), `${otherId} does not run ${checkId}`);
    }
  }
});
