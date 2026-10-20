import { test } from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-invoice-notice-recovery.mjs";
import { runBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { RECOVERY_STUCK_SQL } from "../../workflows/invoice-sent-recovery-query.mjs";
import { RECOVERY_STUCK_SQL as BEAT_SQL } from "./lib/invoice-sent-recovery-truth.mjs";

test("hourly invoice notice beat shares the recovery SQL and goes red on a stuck bill", async () => {
  assert.equal(BEAT_SQL, RECOVERY_STUCK_SQL);
  const pass = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(pass.ok, true, pass.detail);
  const fail = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(fail.ok, false);
  assert.equal(fail.step, "first-notice");
});

test("missing invoice notice evidence stays red", async () => {
  const missing = await runBeat(beat, makeFakeCtx(beat, {
    read: [{ match: /FROM invoices i/, rows: [] }]
  }));
  assert.equal(missing.ok, false);
  assert.equal(missing.step, "first-notice");
});
