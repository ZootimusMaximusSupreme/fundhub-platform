// @ts-check
// Every job kind the marketing worker may claim from marketing_jobs (src/marketing/jobs.mjs).
// Spec: docs/specs/marketing-machine-2026-10-04.md §6 Step 4.
//
// ONE LINE PER KIND:
//
//   <kind>: { group: 'writer' | 'loader' | 'system', load: () => import("./<handler>.mjs") },
//
//   group   how the worker paces it. 'writer' = a model call writing a script (the worker
//           runs up to 3 at once); 'loader' = a Meta load; 'system' = the machine's own
//           chores (start, plan, release, expiry, exports). The worker caps each group.
//   load    a lazy import, so the worker only loads the code for the jobs it claims.
//           The module must export   run(job, ctx)   where job is the marketing_jobs row
//           and ctx is { db, env, deps }. A handler that returns finishes the job (its
//           return value is the result); one that throws fails it (jobs.mjs failJob).
//
// EMPTY ON PURPOSE. Units U24 (writer), U28 (Meta loader) and U35 (batch lifecycle) add
// their lines here when their handlers land. A kind that is not here is never claimed, and
// "Retry" refuses it (retryJob only re-queues kinds the caller passes, and the route passes
// these keys).
//
// NEVER ADD 'offer'. The Write offer button's jobs run on their own path
// (src/marketing/offer-store.mjs); this queue never claims them.
//
// The registry is a plain object, not frozen: a test may register a stub kind for the
// length of that test (for example to show a screen that appears once a kind exists).
// src/marketing/job-kinds.test.mjs fails if any entry lacks a group, a load, or a run().

//   'research' (unit X2) = a research job Chris tapped (market research, deep research):
//           saved steps with live web reading. Not named in the worker's GROUP_CAPS, so one
//           research step runs at a time; each step is one claim, so two research runs take
//           turns step by step.
export const JOB_GROUPS = Object.freeze(["writer", "loader", "system", "research"]);

/** @type {Record<string, { group: 'writer' | 'loader' | 'system' | 'research', load: () => Promise<any> }>} */
export const JOB_KINDS = {
  // Flywheel stage runs (design §3.2 "Endpoints"): stage 2, market research (unit X2).
  // src/marketing/flywheel/stage-job.mjs sends each row to its stage's code.
  flywheel_stage: { group: "research", load: () => import("./flywheel/stage-job.mjs") },
  // "Research it" — deep research (design §2 row J20, unit X2).
  deep_research: { group: "research", load: () => import("./research/deep-research.mjs") }
};

/**
 * checkJobKinds(registry) → a list of problems, in plain words (empty when every entry is good).
 * Loads each handler module to prove it exports run(). Used by the test and safe for the
 * worker to call before it claims anything.
 */
export async function checkJobKinds(registry = JOB_KINDS) {
  const problems = [];
  if (!registry || typeof registry !== "object") return ["the job registry is not an object"];
  for (const [kind, entry] of Object.entries(registry)) {
    if (!kind.trim()) { problems.push("a job kind has a blank name"); continue; }
    if (kind === "offer") { problems.push("'offer' must not be in JOB_KINDS — it runs on its own path"); continue; }
    if (!entry || typeof entry !== "object") { problems.push(`${kind}: the entry is not an object`); continue; }
    if (!JOB_GROUPS.includes(entry.group)) {
      problems.push(`${kind}: group must be one of ${JOB_GROUPS.join(", ")} (got ${JSON.stringify(entry.group)})`);
    }
    if (typeof entry.load !== "function") { problems.push(`${kind}: load must be a function that imports the handler`); continue; }
    let mod;
    try { mod = await entry.load(); }
    catch (err) {
      problems.push(`${kind}: the handler did not load (${String((err && err.message) || err)})`);
      continue;
    }
    if (!mod || typeof mod.run !== "function") problems.push(`${kind}: the handler does not export run(job, ctx)`);
  }
  return problems;
}
