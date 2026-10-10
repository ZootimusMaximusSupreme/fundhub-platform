// Claims and runs queued creative generation_jobs on a clock.
// POST /api/creative/generate only enqueues; without this, jobs sit forever.

import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { runDue } from "../../src/creative/runner.mjs";
import { runnerIsLocal, AI_ASSET_KINDS } from "../../src/marketing/ai-runner.mjs";

export const SWEEP_CRON = "*/2 * * * *";

export async function sweepCreativeJobs(dbConn, options = {}) {
  try {
    const out = await runDue(dbConn, options);
    const succeeded = (out.jobs || []).filter((j) => j.status === "succeeded").length;
    const failed = (out.jobs || []).filter((j) => j.status === "failed").length;
    const queued = (out.jobs || []).filter((j) => j.status === "queued").length;
    return {
      ok: true,
      partners: out.partners,
      ran: (out.jobs || []).length,
      succeeded,
      failed,
      requeued: queued
    };
  } catch (err) {
    return {
      ok: false,
      error: String((err && err.message) || err).slice(0, 300)
    };
  }
}

// Returns a web Response: the default export makes this Netlify's newer
// function style, which rejects a { statusCode, body } object and re-runs the
// pass. See src/http/scheduled-functions-return.test.mjs.
export async function handler() {
  // MARKETING_AI_RUNNER=local: copy jobs (the model writes them) wait for the Mac.
  const result = await sweepCreativeJobs(db, runnerIsLocal(process.env) ? { excludeAssetKinds: [...AI_ASSET_KINDS] } : {});
  if (!result.ok) {
    console.error(`[creative-job-runner] pass failed: ${result.error}`);
  } else if (result.ran > 0) {
    console.log(
      `[creative-job-runner] partners=${result.partners} ran=${result.ran} ` +
        `ok=${result.succeeded} fail=${result.failed} requeue=${result.requeued}`
    );
  }
  await noteScheduledRun(db, "creative-job-runner", result);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

export default handler;
