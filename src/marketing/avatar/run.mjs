// @ts-check
// The avatar run's job handler: kind 'avatar' on marketing_jobs, one saved step per claim.
//
// Design docs/specs/command-center-design-2026-10-05.md §6 slice 5a and §5 rules 13, 14,
// 17, 18. Unit X1. Registered in src/marketing/job-kinds.mjs; the marketing worker
// (src/marketing/worker.mjs) claims the row and calls run(job, ctx).
//
// ONE STEP PER CLAIM. run() reads payload.step, does that one step (one quote round, or
// one half of the check), saves what it found into payload.progress, moves payload.step
// on and hands the row back to the queue (requeueJob: no attempt counted). The worker
// claims it again, in the same pass when there is time, else in the next one. The tenth
// step returns the run's summary, and the worker marks the job done.
//
// A STEP IS PAID FOR ONCE (§5 rule 18). progress.steps[key].status = 'done' is written
// before payload.step moves, and a step that finds itself done is skipped without a call.
// Inside a parallel step (the quote rounds, the new-information calls, the two sort calls,
// the two checkers) each finished call is saved on its own, so a stop or a crash
// re-runs only the calls that had not answered.
//
// WHY payload, NOT result. The worker's generic Retry (jobs.mjs retryJob) clears
// `result` ("starts clean"). The run's checkpoints live in payload.progress, which no
// queue function touches, so any retry resumes from the saved steps.
//
// COST CAPS (§5 rule 13). Before every step and every parallel batch: this run's spend
// so far (marketing_model_usage rows for this job, unpriced rows at the highest known
// rate) plus the batch's worst case, against the run cap frozen on the row at the tap
// (marketing_settings.run_caps.avatar, default $20) and the month cap. A batch that does
// not fit shrinks first (fewer source families this round, said on the row); when not
// even one call fits the run stops: the job fails at once (final) with the plain
// sentence and progress.stopped_at_cap, and Retry continues from the saved steps.
//
// SOURCES (§5 rule 14): src/marketing/avatar/sources.mjs. Every quote and finding is
// checked against the links in its own call's results before it is kept.
//
// No transaction is ever held across a model call (spec §4 trap 3): each save is one
// short statement; the repo save is one short transaction with no call inside.

import { callModel as realCallModel, MODEL_STILL_PAUSED } from "../../agents/model.mjs";
import { logUsage, costStatus, worstCaseUsd, WEB_SEARCH_USD, DEFAULT_MAX_MONTH_USD } from "../model-usage.mjs";
import { requeueJob } from "../jobs.mjs";
import { queueBuzz } from "../notify.mjs";
import { enqueueRepoWrite } from "../../repo/outbox.mjs";
import { withTransaction } from "../../db/with-transaction.mjs";
import { offerFactsText, ownerNotesSection } from "../offer-inputs.mjs";
import { readStageFile } from "../flywheel/stage-inputs.mjs";
import {
  DESIRE_SOURCES, INFO_SOURCES, VERDICT,
  foundationPrompt, overviewPrompt, desirePrompt, desireAssemblePrompt, mechanismPrompt,
  infoPrompt, infoAssemblePrompt, avatarPrompt, verifyPrompts, repairPrompt
} from "./prompts.mjs";
import {
  AVATAR_KIND, STEPS, STEPS_TOTAL, DONE_STEP, stepOf, nextStep, WRITE_MODEL, researchModel,
  DESIRE_ROUNDS_MAX, DRY_ROUNDS_TO_STOP, FETCHES_PER_INFO_CALL, FAMILY_TRIES, INFO_SEARCH_RESERVE,
  CALL_SHAPES, DEFAULT_RUN_CAP_USD, searchesPerCall, worstCallUsd, fitCalls, capStopSentence, dollars
} from "./plan.mjs";
import { callProvenance, researchJsonOf, checkQuotes, checkFindings, recheckDocument, normWords } from "./sources.mjs";
import { mergeBank, parseBank } from "./word-bank.mjs";
import { avatarFiles, avatarPaths, stampVersion, runCounts, doneSentence, withClientVoice } from "./document.mjs";
import { campaignWords, isCampaign } from "./campaigns.mjs";

export { AVATAR_KIND };

/** The two server tools, called directly (no dynamic filtering), so every result block comes back. */
export const WEB_SEARCH_TOOL_TYPE = "web_search_20260318";
export const WEB_FETCH_TOOL_TYPE = "web_fetch_20260318";

/** How long each step needs before the pass ends to be worth starting (ms). */
const STEP_MIN_MS = Object.freeze({
  foundation: 5 * 60_000, overview: 5 * 60_000, quotes: 4 * 60_000, sort: 5 * 60_000, word_bank: 60_000,
  new_info: 4 * 60_000, facts: 5 * 60_000, avatar: 6 * 60_000, check: 5 * 60_000, save: 60_000
});
const CALL_TIMEOUT_MAX_MS = 12 * 60_000;
const CALL_TIMEOUT_MIN_MS = 60_000;
const AZ = "America/Phoenix";

/** An error the worker must not retry by itself (a cap, a missing key). */
export class FinalError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "FinalError";
    this.final = true;
  }
}

/** Today in Arizona, YYYY-MM-DD. */
export function arizonaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The lines of the owner notes that feed step 1: "| stage 1 |" and "| all |". */
export function stageOneNotes(notesFile) {
  return ownerNotesSection(notesFile)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\|\s*(stage\s*1|all)\s*\|/i.test(l))
    .join("\n");
}

/** A model error in plain words; final when waiting will not fix it. */
export function plainModelError(step, res) {
  const raw = String((res && res.error) || "no answer");
  if (/ANTHROPIC_API_KEY is (not set|masked)/.test(raw)) {
    return new FinalError("No Anthropic key is set on the site. An agent must set it.");
  }
  if (/web search is not enabled|web_search[^"]{0,40}not enabled|not enabled for (your|this) organi[sz]ation/i.test(raw)) {
    return new FinalError("Web search is turned off for our Anthropic account. One click turns it on: https://platform.claude.com/settings/capabilities");
  }
  if (/^refused:/.test(raw)) return new Error(`Step ${stepOf(step)?.n ?? "?"}: ${raw}`);
  return new Error(`Step ${stepOf(step)?.n ?? "?"} (${stepOf(step)?.word ?? step}) did not finish: ${raw.slice(0, 240)}`);
}

/* ── the database side (one short statement each) ───────────────────────── */

/** What this job has spent so far, unpriced calls at the highest known rate. */
export async function jobSpendUsd(db, jobId) {
  const r = await db.query(
    `SELECT COALESCE(sum(cost_usd), 0) AS priced,
            COALESCE(sum(input_tokens) FILTER (WHERE cost_usd IS NULL), 0) AS ni,
            COALESCE(sum(output_tokens) FILTER (WHERE cost_usd IS NULL), 0) AS no,
            COALESCE(sum(cache_read_tokens) FILTER (WHERE cost_usd IS NULL), 0) AS ncr,
            COALESCE(sum(cache_write_tokens) FILTER (WHERE cost_usd IS NULL), 0) AS ncw,
            COALESCE(sum(web_search_requests) FILTER (WHERE cost_usd IS NULL), 0) AS ns
       FROM marketing_model_usage WHERE job_id = $1`,
    [jobId]
  );
  const x = r.rows[0] || {};
  const n = (v) => Number(v) || 0;
  const unpriced = worstCaseUsd({
    input_tokens: n(x.ni), output_tokens: n(x.no), cache_read_tokens: n(x.ncr), cache_write_tokens: n(x.ncw)
  }) + n(x.ns) * WEB_SEARCH_USD;
  return Math.round((n(x.priced) + unpriced) * 1e6) / 1e6;
}

async function readSettingsRow(db, orgId) {
  try {
    const r = await db.query(
      `SELECT run_caps, max_month_cost_usd, quiet_start, quiet_end, timezone FROM marketing_settings WHERE org_id = $1`,
      [orgId]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

async function savePayload(db, jobId, payload) {
  await db.query(
    `UPDATE marketing_jobs SET payload = $2::jsonb WHERE id = $1 AND kind = '${AVATAR_KIND}' AND status = 'running'`,
    [jobId, JSON.stringify(payload)]
  );
}

/* ── the run ─────────────────────────────────────────────────────────────── */

/**
 * The handler the worker calls. Returns the summary when the run is done; returns
 * after re-queueing itself otherwise (the worker then changes nothing).
 * @param {any} job the marketing_jobs row (status running)
 * @param {{ db: any, env?: Record<string, any>, deps?: Record<string, any>, finishByMs?: number }} ctx
 */
export async function run(job, ctx) {
  const db = ctx.db;
  const env = ctx.env || process.env;
  const d = (ctx.deps && ctx.deps.avatar) || ctx.deps || {};
  const deps = {
    callModel: d.callModel || realCallModel,
    now: d.now || (() => new Date()),
    // Unit GL: the one stage reader (stage files from the database when the repo is behind).
    readRepoFile: d.readRepoFile || ((p) => readStageFile(db, { orgId: job.org_id, path: p, env })),
    queueBuzz: d.queueBuzz || queueBuzz,
    repoDeps: d.repoDeps || {}
  };
  const finishByMs = Number.isFinite(ctx.finishByMs) ? Number(ctx.finishByMs) : Infinity;

  const payload = JSON.parse(JSON.stringify(job.payload || {}));
  const campaign = String(payload.campaign || "");
  // A row that names no real campaign folder can never save anywhere: stop it now,
  // before anything is paid for.
  if (!isCampaign(campaign)) {
    throw new FinalError("This run names no campaign folder, so it cannot be built. Start it again from Build the avatar.");
  }
  const progress = payload.progress && typeof payload.progress === "object" ? payload.progress : {};
  payload.progress = progress;
  progress.steps = progress.steps || {};
  progress.docs = progress.docs || {};
  progress.searches_used = Number(progress.searches_used) || 0;
  progress.fetches_used = Number(progress.fetches_used) || 0;
  progress.shrunk = Array.isArray(progress.shrunk) ? progress.shrunk : [];
  if (!progress.started_at) progress.started_at = (job.created_at ? new Date(job.created_at) : deps.now()).toISOString();

  let stepKey = String(payload.step || STEPS[0].key);
  if (stepKey === DONE_STEP) return summaryOf(job, payload, deps.now());

  // Skip steps already done (a crash between "done" and "move on").
  while (stepKey !== DONE_STEP && progress.steps[stepKey] && progress.steps[stepKey].status === "done") {
    stepKey = nextStep(stepKey);
  }
  payload.step = stepKey;
  if (stepKey === DONE_STEP) {
    await savePayload(db, job.id, payload);
    return summaryOf(job, payload, deps.now());
  }
  const step = /** @type {NonNullable<ReturnType<typeof stepOf>>} */ (stepOf(stepKey));
  if (!step) throw new FinalError(`The avatar run is on a step this server does not know ("${stepKey}").`);

  // Not enough of this pass left to finish the step: the next pass takes it.
  const nowMs = deps.now().getTime();
  if (finishByMs - nowMs < (STEP_MIN_MS[/** @type {keyof typeof STEP_MIN_MS} */ (stepKey)] || 60_000)) {
    await savePayload(db, job.id, payload);
    await requeueJob(db, job.id, { runAfter: new Date(Math.max(nowMs, finishByMs) + 60_000) });
    return { handed_on: true, step: stepKey };
  }

  const rec = progress.steps[stepKey] = progress.steps[stepKey] || { status: "running", attempts: 0 };
  rec.status = "running";
  rec.attempts = (Number(rec.attempts) || 0) + 1;
  if (!rec.started_at) rec.started_at = deps.now().toISOString();
  delete progress.stopped_at_cap;
  progress.last_error = null;
  await savePayload(db, job.id, payload);

  /** Saves are chained so parallel calls never write over each other. */
  let chain = Promise.resolve();
  const persist = () => { chain = chain.then(() => savePayload(db, job.id, payload)); return chain; };

  const settings = await readSettingsRow(db, job.org_id);
  const runCapUsd = Number.isFinite(Number(payload.run_cap_usd)) && Number(payload.run_cap_usd) > 0
    ? Number(payload.run_cap_usd) : DEFAULT_RUN_CAP_USD;
  const monthCapUsd = settings && settings.max_month_cost_usd != null ? Number(settings.max_month_cost_usd) : DEFAULT_MAX_MONTH_USD;

  const lastDoneN = () => STEPS.filter((s) => progress.steps[s.key]?.status === "done").reduce((m, s) => Math.max(m, s.n), 0);

  /** How many of these calls fit under both caps now; stops the run when none do. */
  const guard = async (shapeKeys) => {
    if (!shapeKeys.length) return 0;
    const per = Math.max(...shapeKeys.map((k) => worstCallUsd(k, env)));
    const spent = await jobSpendUsd(db, job.id);
    const month = await costStatus(db, { orgId: job.org_id, maxMonthUsd: monthCapUsd, now: deps.now() });
    progress.cost_so_far_usd = spent;
    const { fit, stop } = fitCalls({
      spentUsd: spent, perCallUsd: per, calls: shapeKeys.length,
      runCapUsd, monthUsedUsd: month.month_usd, monthCapUsd
    });
    if (stop) {
      const sentence = capStopSentence({ cap: stop.cap, capUsd: stop.capUsd, afterStep: lastDoneN() });
      progress.stopped_at_cap = { cap: stop.cap, cap_usd: stop.capUsd, step: stepKey, sentence, spent_usd: spent };
      rec.status = "stopped";
      await persist();
      throw new FinalError(sentence);
    }
    return fit;
  };

  const callTimeout = () => {
    const left = finishByMs - deps.now().getTime() - 30_000;
    return Math.max(CALL_TIMEOUT_MIN_MS, Math.min(CALL_TIMEOUT_MAX_MS, Number.isFinite(left) ? left : CALL_TIMEOUT_MAX_MS));
  };

  /**
   * One model call, logged to the ledger whatever happened.
   * @param {string} shapeKey
   * @param {{ user: string, tools?: any[], outputSchema?: any, label?: string }} opts
   */
  const model = async (shapeKey, { user, tools = undefined, outputSchema = undefined, label = undefined }) => {
    const shape = CALL_SHAPES[/** @type {keyof typeof CALL_SHAPES} */ (shapeKey)];
    const asked = shape.role === "write" ? WRITE_MODEL : researchModel(env);
    const res = await deps.callModel({
      provider: "anthropic", model: asked, user, tools, outputSchema,
      maxTokens: shape.maxTokens, effort: shape.effort, stream: true,
      timeoutMs: callTimeout(), env, maxContinuations: 2
    });
    const u = (res && res.usage) || {};
    if (u.input_tokens || u.output_tokens || u.web_search_requests || u.web_fetch_requests) {
      await logUsage(db, {
        orgId: job.org_id, jobId: job.id, model: (res && res.servedModel) || asked, usage: u, step: label || stepKey
      });
    }
    progress.searches_used += Number(u.web_search_requests) || 0;
    progress.fetches_used += Number(u.web_fetch_requests) || 0;
    return res;
  };

  const notes = String(progress.owner_notes || "");
  const tweak = String(payload.tweak || "");
  const words = campaignWords(campaign);

  /** Text from a writing call, or the step's plain error. */
  const write = async (shapeKey, user, label) => {
    const res = await model(shapeKey, { user, label });
    const text = res && typeof res.text === "string" ? res.text.trim() : "";
    if (res.error || !text) throw plainModelError(stepKey, res.error ? res : { error: "the model sent back no text" });
    return text;
  };

  let more = false; // true: this step needs another claim (another round, the second half)

  switch (stepKey) {
    case "foundation": {
      const notesFile = await deps.readRepoFile(`marketing/flywheel/${campaign}/00-OWNER-NOTES.md`);
      progress.owner_notes = stageOneNotes(notesFile && notesFile.content);
      const prev = await deps.readRepoFile(avatarPaths(campaign).foundation);
      const testimonials = await deps.readRepoFile("marketing/testimonials/testimonials.json");
      const facts = businessFacts({ words, service: payload.service_description, previous: prev && prev.content, testimonials: testimonials && testimonials.content });
      progress.testimonial_quotes = testimonialQuotes(testimonials && testimonials.content);
      progress.inputs = {
        owner_notes: notesFile ? notesFile.source : "missing",
        previous_foundation: prev ? prev.source : "missing",
        testimonials: testimonials ? testimonials.source : "missing"
      };
      await guard(["write"]);
      progress.docs.foundation = await write("write", foundationPrompt({
        service: payload.service_description, facts, notes: progress.owner_notes, tweak
      }), "foundation");
      break;
    }
    case "overview":
      await guard(["write"]);
      progress.docs.overview = await write("write", overviewPrompt({ foundation: progress.docs.foundation, notes, tweak }), "overview");
      break;

    case "quotes":
      more = await quoteRound();
      break;

    case "sort": {
      const todo = [];
      if (!progress.docs.desire_draft) todo.push("desire");
      if (!progress.docs.mechanism) todo.push("mechanism");
      const fit = await guard(todo.map(() => "write"));
      const run = todo.slice(0, fit);
      const kept = (progress.quotes && progress.quotes.kept) || [];
      const notesJson = JSON.stringify({
        findings: (progress.quotes && progress.quotes.findings) || [],
        quotes: kept.map((k) => ({ quote: k.quote, source: k.source, word_for_word: k.verbatim, tag: k.tag }))
      });
      const outcomes = await Promise.allSettled(run.map(async (what) => {
        if (what === "desire") {
          progress.docs.desire_draft = await write("write", desireAssemblePrompt({ notesJson, notes, tweak }), "sort:desire");
        } else {
          progress.docs.mechanism = await write("write", mechanismPrompt({ overview: progress.docs.overview, notes, tweak }), "sort:mechanism");
        }
        await persist();
      }));
      const failed = outcomes.find((o) => o.status === "rejected");
      if (failed) throw /** @type {PromiseRejectedResult} */ (failed).reason;
      if (run.length < todo.length) { more = true; break; }
      progress.docs.desire = withClientVoice(progress.docs.desire_draft, kept);
      break;
    }

    case "word_bank": {
      const bankFile = await deps.readRepoFile(avatarPaths(campaign).bank);
      const merged = mergeBank(bankFile && bankFile.content, (progress.quotes && progress.quotes.kept) || [], {
        date: arizonaDate(deps.now()), jobId: job.id, campaignWords: words
      });
      progress.docs.bank = merged.text;
      progress.bank = { kept: merged.kept, added: merged.added, entries: merged.entries, source: bankFile ? bankFile.source : "missing" };
      break;
    }

    case "new_info":
      more = await infoCalls();
      break;

    case "facts": {
      const families = (progress.info && progress.info.families) || {};
      const findings = Object.values(families).flatMap((f) => (f && Array.isArray(f.kept) ? f.kept : []));
      if (!findings.length) {
        // Nothing checked to assemble: say so, and spend nothing.
        progress.docs.info = "# New_Information.md\n\nThin: no new information could be checked against a source link in this run, so this file holds none. Nothing here was invented to fill it.\n";
        break;
      }
      await guard(["write"]);
      progress.docs.info = await write("write", infoAssemblePrompt({ notesJson: JSON.stringify(findings), notes, tweak }), "facts");
      break;
    }

    case "avatar":
      await guard(["write_long"]);
      progress.docs.avatar = await write("write_long", avatarPrompt({
        foundation: progress.docs.foundation, overview: progress.docs.overview, desireDoc: progress.docs.desire,
        mechanismDoc: progress.docs.mechanism, infoDoc: progress.docs.info, notes, tweak
      }), "avatar");
      break;

    case "check":
      more = await checkAndRepair();
      break;

    case "save":
      await saveToRepo();
      break;

    default:
      throw new FinalError(`The avatar run has no handler for step "${stepKey}".`);
  }

  await chain;
  if (more) {
    rec.status = "running";
    await savePayload(db, job.id, payload);
    await requeueJob(db, job.id, {});
    return { handed_on: true, step: stepKey };
  }

  rec.status = "done";
  rec.finished_at = deps.now().toISOString();
  payload.step = nextStep(stepKey);
  progress.cost_so_far_usd = await jobSpendUsd(db, job.id);
  if (payload.step === DONE_STEP) {
    progress.finished_at = deps.now().toISOString();
    await savePayload(db, job.id, payload);
    return summaryOf(job, payload, deps.now());
  }
  await savePayload(db, job.id, payload);
  await requeueJob(db, job.id, {});
  return { handed_on: true, step: payload.step };

  /* ── step 3: one round of buyer-quote searches ── */
  async function quoteRound() {
    const q = progress.quotes = progress.quotes || { round: 1, dry: 0, kept: [], dropped: 0, findings: [], errors: [], rounds: {} };
    q.rounds = q.rounds || {};
    const r = Number(q.round) || 1;
    const fam = q.rounds[r] = q.rounds[r] || { families: {} };
    const todo = DESIRE_SOURCES.map((_, i) => i).filter((i) => {
      const f = fam.families[i];
      return !f || (f.status === "failed" && (Number(f.tries) || 0) < FAMILY_TRIES);
    });
    if (todo.length) {
      const per = searchesPerCall({ used: progress.searches_used, calls: todo.length, reserve: INFO_SEARCH_RESERVE });
      if (per <= 0) {
        q.ended = "the run's searches are used up";
        return false;
      }
      const fit = await guard(todo.map(() => "search"));
      const batch = todo.slice(0, fit);
      if (fit < todo.length) {
        progress.shrunk.push(`Round ${r} read ${batch.length} of ${todo.length} source families to stay under ${dollars(runCapUsd)}.`);
        for (const i of todo.slice(fit)) fam.families[i] = { status: "skipped", reason: "cap" };
      }
      await Promise.all(batch.map(async (i) => {
        const prior = fam.families[i] || {};
        const res = await model("search", {
          user: desirePrompt({ round: r, source: DESIRE_SOURCES[i], foundation: progress.docs.foundation, notes, tweak }),
          tools: [{ type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: per, allowed_callers: ["direct"] }],
          label: `quotes:r${r}:f${i + 1}`
        });
        const prov = callProvenance(res.content);
        for (const e of prov.errors) q.errors.push(`Round ${r}, ${DESIRE_SOURCES[i].split(":")[0]}: ${e}`);
        const json = researchJsonOf(res.content);
        if ((res.error && !(res.error === MODEL_STILL_PAUSED && json)) || !json) {
          const why = res.error ? plainModelError(stepKey, res).message : "it did not end with the JSON the checker reads";
          fam.families[i] = { status: "failed", tries: (Number(prior.tries) || 0) + 1, error: why };
          if (fam.families[i].tries >= FAMILY_TRIES) {
            fam.families[i].status = "gave_up";
            q.errors.push(`Round ${r}, ${DESIRE_SOURCES[i].split(":")[0]}: gave up after ${FAMILY_TRIES} tries (${why})`);
          }
          await persist();
          return;
        }
        const { kept, dropped } = checkQuotes(json.quotes, prov);
        const before = new Set(q.kept.map((k) => normWords(k.quote)));
        const fresh = kept.filter((k) => !before.has(normWords(k.quote)));
        q.kept.push(...fresh);
        q.dropped = (Number(q.dropped) || 0) + dropped.length;
        if (typeof json.findings === "string" && json.findings.trim()) q.findings.push(json.findings.trim().slice(0, 4000));
        fam.families[i] = { status: "done", kept: kept.length, new: fresh.length, dropped: dropped.length, nothing_new: json.nothingNew === true };
        await persist();
      }));
    }
    const fams = Object.values(fam.families);
    if (fams.some((f) => f.status === "failed")) {
      await chain;
      throw new Error(`Step 3: ${fams.filter((f) => f.status === "failed").length} of the quote searches in round ${r} failed. The ones that worked are saved; only the failed ones run again.`);
    }
    // The round is over. A round where nothing worked is not a dry round.
    const worked = fams.filter((f) => f.status === "done");
    const newThisRound = worked.reduce((n, f) => n + (Number(f.new) || 0), 0);
    if (worked.length && (newThisRound === 0 || worked.every((f) => f.nothing_new))) q.dry = (Number(q.dry) || 0) + 1;
    else if (worked.length) q.dry = 0;
    fam.new = newThisRound;
    if (q.dry >= DRY_ROUNDS_TO_STOP) { q.ended = "two rounds in a row found nothing new"; return false; }
    if (r >= DESIRE_ROUNDS_MAX) { q.ended = `${DESIRE_ROUNDS_MAX} rounds done`; return false; }
    if (searchesPerCall({ used: progress.searches_used, calls: DESIRE_SOURCES.length, reserve: INFO_SEARCH_RESERVE }) <= 0) {
      q.ended = "the run's searches are used up";
      return false;
    }
    q.round = r + 1;
    return true;
  }

  /* ── step 6: new information, one call per source family ── */
  async function infoCalls() {
    const info = progress.info = progress.info || { families: {}, dropped: 0, errors: [] };
    const todo = INFO_SOURCES.map((_, i) => i).filter((i) => {
      const f = info.families[i];
      return !f || (f.status === "failed" && (Number(f.tries) || 0) < FAMILY_TRIES);
    });
    if (!todo.length) return false;
    const per = searchesPerCall({ used: progress.searches_used, calls: todo.length });
    if (per <= 0) { info.ended = "the run's searches are used up"; return false; }
    const fit = await guard(todo.map(() => "info"));
    const batch = todo.slice(0, fit);
    if (fit < todo.length) {
      progress.shrunk.push(`New information read ${batch.length} of ${todo.length} source families to stay under ${dollars(runCapUsd)}.`);
      for (const i of todo.slice(fit)) info.families[i] = { status: "skipped", reason: "cap" };
    }
    await Promise.all(batch.map(async (i) => {
      const prior = info.families[i] || {};
      const res = await model("info", {
        user: infoPrompt({ source: INFO_SOURCES[i], service: payload.service_description, notes, tweak }),
        tools: [
          { type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: per, allowed_callers: ["direct"] },
          { type: WEB_FETCH_TOOL_TYPE, name: "web_fetch", max_uses: FETCHES_PER_INFO_CALL, allowed_callers: ["direct"], max_content_tokens: 20000 }
        ],
        label: `new_info:f${i + 1}`
      });
      const prov = callProvenance(res.content);
      for (const e of prov.errors) info.errors.push(`${INFO_SOURCES[i].split(":")[0]}: ${e}`);
      const json = researchJsonOf(res.content);
      if ((res.error && !(res.error === MODEL_STILL_PAUSED && json)) || !json) {
        const why = res.error ? plainModelError(stepKey, res).message : "it did not end with the JSON the checker reads";
        info.families[i] = { status: "failed", tries: (Number(prior.tries) || 0) + 1, error: why };
        if (info.families[i].tries >= FAMILY_TRIES) {
          info.families[i].status = "gave_up";
          info.errors.push(`${INFO_SOURCES[i].split(":")[0]}: gave up after ${FAMILY_TRIES} tries (${why})`);
        }
        await persist();
        return;
      }
      const { kept, dropped } = checkFindings(json.findings, prov);
      info.dropped = (Number(info.dropped) || 0) + dropped.length;
      info.families[i] = { status: "done", kept, dropped: dropped.length, nothing_new: json.nothingNew === true };
      await persist();
    }));
    if (Object.values(info.families).some((f) => f.status === "failed")) {
      await chain;
      throw new Error("Step 6: some of the new-information searches failed. The ones that worked are saved; only the failed ones run again.");
    }
    return false;
  }

  /* ── step 9: two checkers, then one repair (two claims) ── */
  async function checkAndRepair() {
    const c = progress.check = progress.check || { verdicts: {} };
    c.verdicts = c.verdicts || {};
    const lenses = verifyPrompts({ avatar: progress.docs.avatar, desireDoc: progress.docs.desire, infoDoc: progress.docs.info });
    const todo = lenses.filter((l) => !c.verdicts[l.lens]);
    if (todo.length) {
      const fit = await guard(todo.map(() => "verify"));
      await Promise.all(todo.slice(0, fit).map(async (l) => {
        const res = await model("verify", { user: l.prompt, outputSchema: VERDICT, label: `check:${l.lens}` });
        if (res.error || !res.json) throw plainModelError(stepKey, res.error ? res : { error: "the checker sent back no verdict" });
        c.verdicts[l.lens] = {
          problems: (res.json.problems || []).map(String).slice(0, 40),
          fabricated: (res.json.fabricatedQuotes || []).map(String).slice(0, 40),
          passed: res.json.passed === true
        };
        await persist();
      }));
      return true; // the repair runs on its own claim
    }
    if (!c.repaired) {
      const issues = [
        ...Object.values(c.verdicts).flatMap((v) => v.problems || []),
        ...Object.values(c.verdicts).flatMap((v) => (v.fabricated || []).map((q) => `FABRICATED?: ${q}`))
      ];
      c.issues = issues.slice(0, 60);
      if (issues.length) {
        await guard(["write_long"]);
        progress.docs.final = await write("write_long", repairPrompt({ avatar: progress.docs.avatar, issues: c.issues, notes, tweak }), "check:repair");
      } else {
        progress.docs.final = progress.docs.avatar;
      }
      c.repaired = true;
    }
    // Re-check every quoted line against what is proven: this run's checked quotes,
    // the word bank (its old lines kept their sources) and the testimonials on file.
    const proven = [
      ...((progress.quotes && progress.quotes.kept) || []),
      ...parseBank(progress.docs.bank).map((e) => ({ quote: e.words })),
      ...(progress.testimonial_quotes || []).map((t) => ({ quote: t }))
    ];
    const rechecked = recheckDocument(progress.docs.final, proven);
    progress.docs.final = rechecked.text;
    c.unchecked = rechecked.unchecked;
    return false;
  }

  /* ── step 10: one outbox transaction for every file, then the buzz ── */
  async function saveToRepo() {
    const paths = avatarPaths(campaign);
    const existing = await deps.readRepoFile(paths.main);
    const version = (progress.version = progress.version || stampVersion(existing && existing.content) + 1);
    const files = avatarFiles(progress, {
      campaign, jobId: job.id, date: arizonaDate(deps.now()), version, builtAt: deps.now().toISOString()
    });
    const ids = [];
    await withTransaction(db, async (tx) => {
      for (const [p, content] of Object.entries(files)) {
        const row = await enqueueRepoWrite(tx, {
          orgId: job.org_id, opId: `avatar:${job.id}:${p.split("/").pop()}`, path: p, mode: "replace", content
        });
        ids.push(row.id);
      }
    });
    progress.saved = { paths: Object.keys(files), outbox_ids: ids, version };
    const quiet = settings || {};
    await deps.queueBuzz(db, {
      orgId: job.org_id, kind: "avatar_ready", groupKey: String(job.id),
      body: `The avatar for ${words} is ready to read.`,
      quietStart: quiet.quiet_start, quietEnd: quiet.quiet_end, tz: quiet.timezone, now: deps.now()
    });
  }
}

/**
 * The facts Prompt 1 grounds in, built from the repo only: the price list
 * (src/config/offers.mjs), the real testimonials on file, the last foundation built
 * for this campaign (if any), and "What we sell".
 */
export function businessFacts({ words, service, previous, testimonials }) {
  const parts = [
    `Company: Fundhub (fundhub.ai), a business-funding company. This flywheel: ${words}.`,
    `What we sell (Chris's words for this run): ${service || "not given"}`,
    "",
    offerFactsText()
  ];
  const t = testimonialLines(testimonials);
  parts.push("", "TESTIMONIALS ON FILE (marketing/testimonials/testimonials.json — the only real testimonials; quote them exactly or not at all):");
  parts.push(t.length ? t.join("\n") : "NONE ON FILE.");
  if (previous && String(previous).trim()) {
    parts.push("", "THE LAST Service_Business_Foundation.md FOR THIS FLYWHEEL (built earlier from the repo and Drive; keep what still holds, fix what the facts above contradict):", String(previous).slice(0, 20000));
  }
  return parts.join("\n");
}

function liveTestimonials(json) {
  let list;
  try { list = JSON.parse(String(json || "[]")); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((r) => r && r.status !== "replaced" && typeof r.hook_source_quote === "string" && r.hook_source_quote.trim());
}

/** One line per live testimonial: name, business, the hook line exactly as said. */
export function testimonialLines(json) {
  return liveTestimonials(json)
    .map((r) => `- ${r.client_name || "A client"} (${r.business_type || "client"}): "${r.hook_source_quote.trim()}"`);
}

/** The exact hook lines of the live testimonials (a quoted line from these is proven). */
export function testimonialQuotes(json) {
  return liveTestimonials(json).map((r) => r.hook_source_quote.trim());
}

/** The finished run's result (what finishJob saves, and the row's done sentence). */
export function summaryOf(job, payload, now = new Date()) {
  const progress = payload.progress || {};
  const counts = runCounts(progress);
  const started = progress.started_at ? new Date(progress.started_at) : (job.created_at ? new Date(job.created_at) : now);
  const minutes = Math.max(0, Math.round((now.getTime() - started.getTime()) / 60000));
  const version = progress.saved ? progress.saved.version : progress.version || null;
  return {
    campaign: payload.campaign,
    version,
    counts,
    cost_usd: progress.cost_so_far_usd ?? null,
    minutes,
    files: progress.saved ? progress.saved.paths : [],
    shrunk: progress.shrunk || [],
    sentence: doneSentence(counts, { version }),
    steps_total: STEPS_TOTAL
  };
}

export default { run };
