// Five-minute clock for durable pre-call lessons. The planner owns the due
// rows; this function only starts a bounded pass and records its heartbeat.
import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { sweepPrecall } from "../../src/workflows/precall-plan.mjs";

export const SWEEP_CRON = "*/5 * * * *";

export default async function precallPlanSweeper() {
  let result;
  try {
    result = await sweepPrecall(db);
  } catch (error) {
    result = { ok: false, error: String(error?.message || error) };
    console.error("[precall-plan-sweeper]", result.error);
  }
  await noteScheduledRun(db, "precall-plan-sweeper", result);
  return new Response(JSON.stringify(result), {
    status: 200, headers: { "content-type": "application/json" }
  });
}
