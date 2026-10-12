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

export const CHECK_IDS = Object.freeze(["door-batch:jobs-live-proof"]);

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function jobResultTests(row) {
  return unique(String(row?.evidence || "").match(FILE_RE) || []).filter((file) => {
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
  return {
    depth: sensitive ? "deep" : "e2e",
    evidence: unique([JOB_RESULT_EVIDENCE, ...tests]).join(" "),
    asserts: row.control,
  };
}

export async function gapChecks() {
  return [{
    id: CHECK_IDS[0],
    status: "FAIL",
    detail: "The shared job batch proves code and trigger rules, but it does not replace each job's live run receipt.",
    suggestedFix: "Keep each job's own heartbeat or workflow receipt green. Do not treat this code proof as a live run.",
  }];
}
