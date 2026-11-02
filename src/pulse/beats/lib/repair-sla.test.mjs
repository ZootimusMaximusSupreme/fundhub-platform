// The repair stage clocks: one copy (this lib file), handed out unchanged by src/repair/sla.mjs.
import test from "node:test";
import assert from "node:assert/strict";

import * as app from "../../../repair/sla.mjs";
import * as copy from "./repair-sla.mjs";

test("repair-sla: src/repair/sla.mjs hands out this file's own clocks, not a second copy", () => {
  assert.equal(app.STAGE_SLA, copy.STAGE_SLA);
  assert.equal(app.isBreached, copy.isBreached);
  assert.equal(app.STALLED_STAGE, copy.STALLED_STAGE);
});

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


test("repair-sla: intake's three business-day deadline matches repair's task calendar", async () => {
  const { addBusinessDays } = await import("../../../repair/croa.mjs");
  const cases = [
    // Friday intake must not be called overdue on Monday; Wednesday is due.
    ["2026-10-30T16:00:00.000Z", "2026-11-04T16:00:00.000Z"],
    // Thursday counts Friday, Monday and Tuesday.
    ["2026-10-29T12:15:00.000Z", "2026-11-03T12:15:00.000Z"],
    // A weekend intake starts counting on Monday.
    ["2026-10-31T09:00:00.000Z", "2026-11-04T09:00:00.000Z"]
  ];
  for (const [enteredAt, expectedDue] of cases) {
    assert.equal(addBusinessDays(enteredAt.slice(0, 10), 3), expectedDue.slice(0, 10));
    const before = new Date(Date.parse(expectedDue) - 1).toISOString();
    const after = new Date(Date.parse(expectedDue) + 1).toISOString();
    for (const asOf of [enteredAt, before, expectedDue]) {
      assert.equal(copy.isBreached({ stageKey: "intake", enteredAt, asOf }).breached, false, `${enteredAt} asOf ${asOf}`);
    }
    assert.deepEqual(
      { breached: copy.isBreached({ stageKey: "intake", enteredAt, asOf: after }).breached,
        task: copy.isBreached({ stageKey: "intake", enteredAt, asOf: after }).task },
      { breached: true, task: "chase_contract" }
    );
  }
  // No business-day flag here: 14 calendar days must remain 14 calendar days.
  const enteredAt = cases[0][0];
  const calendarDue = "2026-11-13T16:00:00.000Z";
  assert.equal(copy.isBreached({ stageKey: "awaiting_documents", enteredAt, asOf: calendarDue }).breached, false);
  assert.equal(copy.isBreached({ stageKey: "awaiting_documents", enteredAt, asOf: "2026-11-13T16:00:00.001Z" }).breached, true);
  // Hourly clocks remain real elapsed hours, including the weekend.
  assert.equal(copy.isBreached({ stageKey: "analysis", enteredAt, asOf: "2026-10-30T17:00:00.000Z" }).breached, false);
  assert.equal(copy.isBreached({ stageKey: "analysis", enteredAt, asOf: "2026-10-30T17:00:00.001Z" }).breached, true);
});
