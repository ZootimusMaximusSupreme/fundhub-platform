const FILE_RE = /\b(?:(?:src|api|netlify|scripts|e2e)\/)?[A-Za-z0-9_./[\]-]+\.test\.mjs\b/g;
const FAILED = new Set([
  "content-tiles.test.mjs",
  "creative-run.test.mjs",
  "marketing-offer-generate.test.mjs",
  "payment-links-endpoints.test.mjs",
]);

export const JOB_RESULT_EVIDENCE =
  "src/pulse/coverage/gap-door-batch-jobs.mjs " +
  "src/pulse/catalog/proofs/door-batch-job-result.test.mjs";

export const FINAL_JOB_RESULT_TEST =
  "src/pulse/catalog/proofs/door-batch-job-final.test.mjs";

const FINAL_JOB_SURFACES = new Set([
  "workflow:contract-chaser",
  "workflow:hiring-outreach-cadence",
  "workflow:merchant-pull-sweeper",
  "workflow:blueprint-next-funding-sequence-sweeper",
  "workflow:paid-checkout-expiry-sweeper",
  "workflow:pulse-instant-watch",
  "workflow:affiliate-payout-run",
  "workflow:meet-transcript-sweeper",
  "workflow:inquiry-call-sweeper",
  "workflow:repair-bureau-response-reader",
  "function:hubstaff-poll-sweeper",
  "function:marketing-offer-background",
  "function:ad-video-worker-background",
]);

export const CHECK_IDS = Object.freeze(["door-batch:ad-video-worker-result"]);

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function jobResultTests(row) {
  const mapped = String(row?.evidence || "").match(FILE_RE) || [];
  if (FINAL_JOB_SURFACES.has(row?.surface)) mapped.push(FINAL_JOB_RESULT_TEST);
  return unique(mapped).filter((file) => {
    const base = file.split("/").at(-1);
    return !file.endsWith(".pg.test.mjs") && !FAILED.has(base);
  });
}

function workflowId(row) {
  return String(row?.surface || "").replace(/^workflow:/, "");
}

function triggerParts(trigger) {
  const text = String(trigger || "").trim();
  if (text === "no trigger") return { kind: "off", values: [] };
  if (text.startsWith("cron ")) return { kind: "cron", values: [text.slice(5)] };
  if (text.startsWith("events ")) {
    return { kind: "events", values: text.slice(7).split(",").map((value) => value.trim()).filter(Boolean) };
  }
  return { kind: "unknown", values: [] };
}

export function evaluateJobReceipt(row, loaded) {
  const problems = [];
  const resultTests = jobResultTests(row);
  if (!String(row?.file || "").trim()) problems.push("job file is missing");
  if (resultTests.length === 0) problems.push("job has no focused result test");

  if (String(row?.surface || "").startsWith("workflow:")) {
    const id = workflowId(row);
    const candidates = [...new Set(Object.values(loaded || {}).filter((value) => value?.opts?.id === id))];
    if (candidates.length !== 1) problems.push(`expected one exported workflow ${id}, found ${candidates.length}`);
    const actual = candidates[0];
    if (actual) {
      const planned = triggerParts(row.trigger);
      const triggers = Array.isArray(actual.opts?.triggers) ? actual.opts.triggers : [];
      const crons = triggers.map((item) => item?.cron).filter(Boolean);
      const events = triggers.map((item) => item?.event).filter(Boolean);
      if (planned.kind === "off" && triggers.length !== 0) problems.push("retired workflow still has a trigger");
      if (planned.kind === "cron" && !planned.values.every((value) => crons.includes(value))) {
        problems.push("cron trigger does not match the map");
      }
      if (planned.kind === "events" && !planned.values.every((value) => events.includes(value))) {
        problems.push("event triggers do not match the map");
      }
      if (planned.kind === "unknown") problems.push("map trigger is not understood");
    }
  } else {
    const handler = loaded?.handler || loaded?.default;
    if (typeof handler !== "function") problems.push("function has no exported handler");
    if (row?.schedule) {
      const exportedSchedules = Object.entries(loaded || {})
        .filter(([name, value]) => /CRON|SCHEDULE/i.test(name) && typeof value === "string")
        .map(([, value]) => value);
      if (!exportedSchedules.includes(row.schedule)) problems.push("function schedule does not match its export");
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    resultTests,
    receipt: String(row?.trigger || "").startsWith("events ") ? "workflow-run" : "job-heartbeat",
  };
}

export function jobResultProof(row) {
  const tests = jobResultTests(row);
  if (!String(row?.file || "").trim() || tests.length === 0) return null;
  const sensitive = ["money", "customerMessage", "customerData"].includes(row?.impact);
  const evidence = FINAL_JOB_SURFACES.has(row?.surface)
    ? [
        ...(row.surface === "function:ad-video-worker-background"
          ? ["src/pulse/coverage/gap-door-batch-jobs.mjs"]
          : []),
        ...tests,
      ]
    : [JOB_RESULT_EVIDENCE, ...tests];
  return {
    depth: sensitive ? "deep" : "e2e",
    evidence: unique(evidence).join(" "),
    asserts: row.control,
  };
}

export const AD_VIDEO_WORKER_SQL = [
  "SELECT count(*) FILTER (",
  "         WHERE submagic_claimed_at IS NOT NULL",
  "           AND submagic_project_id IS NULL",
  "           AND submagic_claimed_at < now() - interval '30 minutes'",
  "       )::int AS stuck_create_n,",
  "       count(*) FILTER (",
  "         WHERE export_claimed_at IS NOT NULL",
  "           AND exported_at IS NULL",
  "           AND export_claimed_at < now() - interval '30 minutes'",
  "       )::int AS stuck_export_n",
  "  FROM ad_videos",
].join("\n");

export function judgeAdVideoWorker(row = {}) {
  const create = Number(row.stuck_create_n || 0);
  const exports = Number(row.stuck_export_n || 0);
  if (create || exports) {
    return {
      id: CHECK_IDS[0],
      status: "FAIL",
      detail: "The ad-video worker has " + create + " stuck upload claim(s) and " + exports + " stuck export claim(s).",
      suggestedFix: "Review the named ad-video rows before clearing or retrying a spend claim.",
    };
  }
  return {
    id: CHECK_IDS[0],
    status: "PASS",
    detail: "No ad-video upload or export claim has been stuck for 30 minutes.",
    suggestedFix: null,
  };
}

export async function gapChecks(ctx = {}) {
  const run = ctx?.scope?.run || ctx?.run;
  if (typeof run !== "function") {
    return [{
      id: CHECK_IDS[0],
      status: "FAIL",
      detail: "The ad-video worker result could not be read because this pulse has no database reader.",
      suggestedFix: "Run the pulse with its normal read-only database scope.",
    }];
  }
  try {
    const result = await run((tx) => tx.query(AD_VIDEO_WORKER_SQL));
    return [judgeAdVideoWorker(result?.rows?.[0] || {})];
  } catch (error) {
    return [{
      id: CHECK_IDS[0],
      status: "FAIL",
      detail: "The ad-video worker result read failed: " + String(error?.message || error).slice(0, 180),
      suggestedFix: "Restore the read-only ad_videos check.",
    }];
  }
}
