import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { pollAndMergeHubstaff } from "../../src/shifts/hubstaff-ingest.mjs";

export const SWEEP_CRON = "*/10 * * * *";

export async function sweepHubstaffPoll(dbConn, options = {}) {
  try {
    const out = await pollAndMergeHubstaff(dbConn, options);
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 300) };
  }
}

// Returns a web Response: the default export makes this Netlify's newer
// function style, which rejects a { statusCode, body } object and re-runs the
// pass. See src/http/scheduled-functions-return.test.mjs.
export async function handler() {
  const result = await sweepHubstaffPoll(db);
  if (!result.ok) console.error(`[hubstaff-poll-sweeper] pass failed: ${result.error}`);
  else if (result.skipped && result.reason === "not_configured") { /* quiet */ }
  else if (result.merged > 0 || (result.fetch_errors && result.fetch_errors.length)) {
    console.log(`[hubstaff-poll-sweeper] merged=${result.merged} candidates=${result.candidates ?? 0}`);
  }
  await noteScheduledRun(db, "hubstaff-poll-sweeper", result);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

export default handler;
