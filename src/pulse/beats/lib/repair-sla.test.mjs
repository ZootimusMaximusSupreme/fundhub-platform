// The pulse's copy of the repair stage clocks must say exactly what the desk's clocks say.
import test from "node:test";
import assert from "node:assert/strict";

import * as app from "../../../repair/sla.mjs";
import * as copy from "./repair-sla.mjs";

test("repair-sla: the copy holds the same clocks and the same stalled stage as src/repair/sla.mjs", () => {
  assert.deepEqual(copy.STAGE_SLA, app.STAGE_SLA);
  assert.deepEqual(Object.keys(copy.STAGE_SLA), Object.keys(app.STAGE_SLA));
  assert.equal(copy.STALLED_STAGE, app.STALLED_STAGE);
  assert.deepEqual(Object.keys(copy).sort(), Object.keys(app).sort(), "the copy exports what the app file exports");
});

test("repair-sla: isBreached gives the same answer on a grid of stages, ages and due dates", () => {
  const asOf = new Date("2026-10-14T18:00:00.000Z");
  const ages = [0, 10, 29, 31, 59, 61, 3 * 60, 4 * 60 + 1, 23 * 60, 25 * 60, 3 * 1440, 4 * 1440, 11 * 1440, 15 * 1440, 40 * 1440];
  const stages = [...Object.keys(app.STAGE_SLA), "stalled", "no_such_stage"];
  const dues = [null, "2026-10-01T00:00:00.000Z", "2026-10-12T00:00:00.000Z", "2026-10-20T00:00:00.000Z"];
  let compared = 0;
  for (const stageKey of stages) {
    for (const minutes of ages) {
      for (const responseDueAt of dues) {
        const enteredAt = new Date(asOf.getTime() - minutes * 60 * 1000).toISOString();
        const args = { stageKey, enteredAt, asOf, responseDueAt };
        assert.deepEqual(copy.isBreached(args), app.isBreached(args), JSON.stringify(args));
        compared += 1;
      }
    }
  }
  for (const odd of [{ stageKey: "analysis" }, { stageKey: "analysis", enteredAt: "not a date", asOf }, {}]) {
    assert.deepEqual(copy.isBreached(odd), app.isBreached(odd));
  }
  assert.ok(compared > 500);
  // The grid is not blind: it holds both answers.
  const both = new Set(stages.flatMap((stageKey) => ages.map((m) => copy.isBreached({
    stageKey, enteredAt: new Date(asOf.getTime() - m * 60000).toISOString(), asOf, responseDueAt: dues[1]
  }).breached)));
  assert.deepEqual([...both].sort(), [false, true]);
});
