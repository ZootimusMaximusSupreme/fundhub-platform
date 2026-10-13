import assert from "node:assert/strict";
import test from "node:test";

import { checkPipelineMotion } from "./pipeline-motion.mjs";
import { buildScorecard } from "./scorecard.mjs";

const scorecardFor = /** @type {any} */ (buildScorecard);

const NAMED_BREAKS = Object.freeze([
  "meta-sync",
  "clickfunnels-night-job",
  "ads-number-unmapped",
  "calls:booked-no-outcome",
  "calls:booked-no-join-link",
  "finance-os-setup:price-set",
  "bureau-config:complete",
]);

test("the seven named real breaks stay Broken and visible by name", () => {
  const card = scorecardFor({
    now: new Date("2026-10-13T13:00:00.000Z"),
    checks: NAMED_BREAKS.map((id) => ({
      id,
      status: "FAIL",
      detail: `${id} is still measured broken`,
      not_proved: true,
    })),
  });

  assert.deepEqual(card.counts, { broken: NAMED_BREAKS.length, not_proved: 0 });
  assert.deepEqual(card.checks.map((row) => row.id), NAMED_BREAKS);
  assert.ok(card.checks.every((row) => row.status === "red"));
  assert.ok(card.checks.every((row) => row.not_proved !== true));
});

test("the owner-closed repair file stays red and the pulse does not act on it", async () => {
  let read = 0;
  const db = {
    async query(sql) {
      assert.match(sql, /^\s*SELECT\b/i);
      read += 1;
      if (read === 1) return { rows: [{ n: 1 }] };
      if (read === 2) return { rows: [{ n: 0 }] };
      return {
        rows: [{
          tags: ["repair_client"],
          custom_fields: { last_progress_timestamp: "2026-10-01T00:00:00.000Z" },
        }],
      };
    },
  };

  const context = {
    db,
    orgId: "00000000-0000-0000-0000-000000000001",
    now: new Date("2026-10-13T13:00:00.000Z"),
  };
  const rows = await checkPipelineMotion(context);
  const repairRows = rows.filter((row) => row.id === "pipeline:repair" || row.id === "pipeline:clients");
  const card = scorecardFor({ checks: repairRows, now: new Date("2026-10-13T13:00:00.000Z") });

  assert.equal(read, 3);
  assert.deepEqual(repairRows.map((row) => [row.id, row.status]), [
    ["pipeline:repair", "FAIL"],
    ["pipeline:clients", "FAIL"],
  ]);
  assert.ok(repairRows.every((row) => /Do not auto-fix/i.test(String(row.suggestedFix))));
  assert.deepEqual(card.counts, { broken: 2, not_proved: 0 });
  assert.deepEqual(card.checks.map((row) => [row.id, row.status]), [
    ["pipeline:repair", "red"],
    ["pipeline:clients", "red"],
  ]);
});
