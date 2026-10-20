import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKIN_CRON, handle } from "./bank-outreach-checkins.mjs";
test("check-ins use a recorded shared workflow and touch no sending provider", async () => {
  const queries = [];
  const steps = [];
  const result = await handle({
    now: new Date("2026-10-19T14:00:00Z"),
    database: { async query(sql, params) { queries.push({ sql, params }); return { rows: [], rowCount: 0 }; } },
    step: { async run(name, fn) { steps.push(name); return fn(); } }
  });
  assert.equal(CHECKIN_CRON, "TZ=America/Phoenix 0 7 * * *");
  assert.deepEqual(steps, ["schedule-partner-checkins"]);
  assert.equal(result.ok, true);
  assert.equal(queries.some(({ sql }) => /messages|sendTemplated/i.test(sql)), false);
});
