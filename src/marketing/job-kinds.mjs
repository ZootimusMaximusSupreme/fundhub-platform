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
// STARTED EMPTY. Units U24 (writer), U28 (Meta loader) and U35 (batch lifecycle) add
// their lines here when their handlers land; X1 added 'avatar', X2 and X3 'flywheel_stage'.
// A kind that is not here is never claimed, and
// "Retry" refuses it (retryJob only re-queues kinds the caller passes, and the route passes
// these keys).
//
// NEVER ADD 'offer'. The Write offer button's jobs run on their own path
// (src/marketing/offer-store.mjs); this queue never claims them.
//
// The registry is a plain object, not frozen: a test may register a stub kind for the
// length of that test (for example to show a screen that appears once a kind exists).
// src/marketing/job-kinds.test.mjs fails if any entry lacks a group, a load, or a run().

// 'research' (units X1 and X2, both added it): the long, many-call web research runs
// Chris taps (Build the avatar, Research the market, Research it): saved steps with live
// web reading. Not named in the worker's GROUP_CAPS, so one research step runs at a time
// (it never takes the slot a system chore or a script writer needs); each step is one
// claim, so two research runs take turns step by step.
export const JOB_GROUPS = Object.freeze(["writer", "loader", "system", "research"]);

/** @type {Record<string, { group: 'writer' | 'loader' | 'system' | 'research', load: () => Promise<any> }>} */
export const JOB_KINDS = {
  // U24 — the script writer (src/marketing/writer.mjs, spec §7.6). One module, two handlers.
  write_slot: { group: "writer", load: () => import("./writer.mjs").then((m) => ({ run: m.runWriteSlot })) },
  fix_script: { group: "writer", load: () => import("./writer.mjs").then((m) => ({ run: m.runFixScript })) },
  // X4 funnel builder: write a book-a-call funnel's three pages (one model call,
  // checked words), then put them on ClickFunnels as NEW pages on Chris's Push live.
  funnel: { group: "writer", load: () => import("./funnel-build.mjs") },
  funnel_push: { group: "system", load: () => import("./funnel-push.mjs") },
  // Build the avatar (flywheel step 1), 10 saved steps: src/marketing/avatar/run.mjs. Unit X1.
  avatar: { group: "research", load: () => import("./avatar/run.mjs") },
  // Flywheel stage runs (design §3.2 "Endpoints"), started by POST marketing/flywheel/run:
  // stage 2, market research (unit X2); 4 copy and 5 strategy (unit X3). One kind;
  // payload.stage picks the stage (src/marketing/flywheel/stage-job.mjs). Wave 2b merge:
  // X3 filed it under 'writer', X2 under 'research'; 'research' runs one step at a time,
  // so a long research step never takes a script writer's slot.
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
JOB_KINDS.meta_load = { group: "loader", load: () => import("./meta-load.mjs") }; // U28: one approved video → one PAUSED Meta ad
JOB_KINDS.start_batch = { group: "system", load: () => import("./batch-run.mjs").then((m) => ({ run: m.runStartBatch })) }; // U35: plan a batch, queue its write_slot jobs
JOB_KINDS.finish_batch = { group: "system", load: () => import("./batch-run.mjs").then((m) => ({ run: m.runFinishBatch })) }; // U35: count a written batch, mark it ready
JOB_KINDS.release_batch = { group: "system", load: () => import("./batch-run.mjs").then((m) => ({ run: m.runReleaseBatch })) }; // U35: release at release_at: files + one buzz
JOB_KINDS.expire_drafts = { group: "system", load: () => import("./batch-run.mjs").then((m) => ({ run: m.runExpireDrafts })) }; // U35: old machine drafts → expired
JOB_KINDS.voice_export = { group: "system", load: () => import("./voice-export.mjs") }; // U35: the week's voice pairs → VOICE.md
JOB_KINDS.nightly_script_check = { group: "system", load: () => import("./nightly-script-check.mjs") }; // U35: repo files vs the database
