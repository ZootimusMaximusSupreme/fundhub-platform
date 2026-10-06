// @ts-check
// The six flywheel rows the Ideas tab shows, in Chris's words.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.0 (the word table:
// "Offer, step 3 of 6", never "Flywheel step 3"; state words Done / Done,
// approved / Needs a redo / Waiting on step 3 / Out of date / Running / Stopped
// at the cap / Thin / Not run yet / Not on this page yet) and §3.2 row 6 (the six
// rows, Read it, the run buttons and why each is off). Unit X3.
//
// THE RULES ARE NOT RE-DECIDED HERE. scripts/flywheel/status.mjs evaluateFiles()
// decides MISSING / STALE / BLOCKED / FAILED / READY exactly as
// `npm run flywheel:status` does; this file only words the answer and adds what
// the machine is doing now (the newest job per stage).
//
// WHO RUNS EACH STAGE (STAGE_RUNNERS):
//   1  the avatar        unit X1 (design slice 5a, job kind 'avatar') — not here
//   2  ad research       unit X2 (design slice 10, kind 'flywheel_stage' stage 2)
//   3  the offer         the existing Write offer path (POST marketing/offer/generate,
//                        job kind 'offer'); POST marketing/flywheel/run hands it on
//   4  the copy          this unit, kind 'flywheel_stage' (copy-stage.mjs)
//   5  the ad strategy   this unit, kind 'flywheel_stage' (strategy-stage.mjs)
//   6  the spend read    this unit, no model, no job (spend-read.mjs)
// A stage whose runner is not built says so in one sentence and offers no dead
// button (design safety rule 9). X1 and X2 fill their rows in when they land.

import { STAGES, evaluateFiles, splitFrontMatter } from "../../../scripts/flywheel/status.mjs";
import { campaignWords } from "./campaigns.mjs";

export const STAGE_COUNT = 6;

/** How each stage runs. `null` = not built in this unit (the row says which slice brings it). */
export const STAGE_RUNNERS = {
  1: null,
  2: null,
  3: { via: "offer" },
  4: { via: "job", needsApproved: [3] },
  5: { via: "job", needsApproved: [3, 4] },
  6: { via: "spend-read" }
};

/** The sentence a row shows while its runner is not on this page yet. */
export const NOT_BUILT = Object.freeze({
  1: "Not on this page yet: it ships in slice 5a. Cost not measured.",
  2: "Not on this page yet: it ships in slice 10. Cost not measured."
});

/** @param {string} campaignName */
export function labelWords(n, campaignName) {
  switch (n) {
    case 1: return "Who we sell to";
    case 2: return "What the market sells";
    case 3: return "The offer";
    case 4: return `Ad copy for the ${campaignName}`;
    case 5: return "Which ad strategy";
    case 6: return "Read the spend";
    default: return `Step ${n}`;
  }
}

const STEP_NAME = { 1: "who we sell to", 2: "the market research", 3: "the offer", 4: "the copy", 5: "the ad strategy", 6: "the spend read" };

/* The gate counts in words, for "Needs a redo: it did not count its …". */
const COUNT_WORDS = {
  quotes: "customer quotes",
  languageEntries: "phrases in the word bank",
  rowsVerified: "checked findings",
  competitorsFound: "competitors",
  priceSet: "price",
  bonuses: "bonuses",
  valueEquationScores: "value scores",
  guarantees: "guarantees",
  hooks: "hooks",
  humanizerPassRun: "clean-up pass",
  distinctReasons: "reasons to buy",
  strategyNamed: "strategy name",
  dailyBudgetStated: "daily budget"
};

/** One evaluate() reason in plain words. */
export function reasonWords(reason) {
  const r = String(reason || "");
  let m = /^did not report (\w+)$/.exec(r);
  if (m) return `it did not count its ${COUNT_WORDS[m[1]] || m[1]}`;
  m = /^(\w+) is (\d+), needs at least (\d+)$/.exec(r);
  if (m) return `only ${m[2]} ${COUNT_WORDS[m[1]] || m[1]}, needs ${m[3]}`;
  m = /^(\d+) distinct reasons, below .* of (\d+)$/.exec(r);
  if (m) return `only ${m[1]} reasons to buy, needs ${m[2]}`;
  m = /^only (\d+) guarantees? — an offer needs a stack of at least (\d+)$/.exec(r);
  if (m) return `only ${m[1]} guarantee${m[1] === "1" ? "" : "s"}, needs ${m[2]}`;
  if (r === "has no review card") return "it has no review card";
  m = /^still contains (.+)$/.exec(r);
  if (m) return `it still has unfinished text (${m[1]})`;
  m = /^built on the old (.+)$/.exec(r);
  if (m) return `${m[1]} changed since it was built`;
  return r;
}

/** The summary render() prints, as a sentence part ("133 quotes"). */
function summaryWords(row) {
  const c = (row.meta && row.meta.counts) || {};
  if (row.n === 1 && c.quotes) return `${c.quotes} customer quotes`;
  if (row.n === 2 && c.rowsVerified) return `${c.rowsVerified} checked findings`;
  if (row.n === 3 && c.bonuses) return `price set, ${c.bonuses} bonuses`;
  if (row.n === 4 && c.hooks) return `${c.hooks} hooks${c.distinctReasons ? `, ${c.distinctReasons} reasons to buy` : ""}`;
  if (row.n === 5 && c.strategyNamed) return "strategy chosen";
  if (row.n === 6 && c.adsRead != null) return `${c.adsRead} ads read`;
  return "";
}

/** The "## Review card" block and everything after it, or null. */
export function reviewCard(text) {
  if (!text) return null;
  const at = String(text).indexOf("## Review card");
  return at === -1 ? null : String(text).slice(at).trim();
}

const money = (usd) => (usd == null ? null : `$${Number(usd).toFixed(2)}`);

/**
 * The newest job's words: running, failed, stopped at the cap.
 * @param {any} job  a marketing_jobs row (flywheel_stage or offer), or null
 */
export function runView(job, { spentUsd = null } = {}) {
  if (!job) return null;
  const r = job.result && typeof job.result === "object" ? job.result : {};
  const progress = r.progress || {};
  return {
    job_id: job.id,
    kind: job.kind,
    status: job.status,
    step: progress.step ?? null,
    step_n: progress.step_n ?? null,
    steps_total: progress.steps_total ?? null,
    step_word: progress.step_word ?? null,
    counts_so_far: progress.counts || null,
    cost_so_far_usd: spentUsd == null ? null : Number(spentUsd),
    stopped_at_cap: Boolean(r.stopped_at_cap),
    resumable: job.status === "failed",
    started_at: job.claimed_at || job.created_at || null,
    finished_at: job.finished_at || null,
    error: job.error || null
  };
}

/**
 * stagesView({ campaign, files, jobs, notesText }) → the six rows.
 *
 * files:  name -> {text, source} from reader.mjs (missing files have text null)
 * jobs:   { [stage]: {job, spentUsd} } the newest job per stage (stage 3 = the
 *         newest offer job for this campaign)
 * @param {{campaign: string, files: Record<string, {text: string|null, source: string}>,
 *          jobs?: Record<number, {job: any, spentUsd?: number|null}>, repo?: string, commitSha?: string|null}} args
 */
export function stagesView({ campaign, files, jobs = {}, repo = "ZootimusMaximusSupreme/fundhub-platform", commitSha = null }) {
  const read = (f) => (files[f] && files[f].text != null ? files[f].text : null);
  const rows = evaluateFiles(read);
  const name = campaignWords(campaign, read("00-OWNER-NOTES.md"));
  const byN = new Map(rows.map((r) => [r.n, r]));
  const done = (n) => {
    const r = byN.get(n);
    return Boolean(r && r.state === "READY");
  };
  const approved = (n) => {
    const r = byN.get(n);
    return Boolean(r && r.state === "READY" && r.meta && r.meta.status === "approved");
  };

  return rows.map((row) => {
    const text = read(row.file);
    const { body } = text != null ? splitFrontMatter(text) : { body: null };
    /** @type {{job?: any, spentUsd?: number|null}} */
    const j = jobs[row.n] || {};
    const run = runView(j.job || null, { spentUsd: j.spentUsd ?? null });
    const isApproved = approved(row.n);
    const runner = /** @type {any} */ (STAGE_RUNNERS)[row.n];

    // ── the state word and its sentence ─────────────────────────────────────
    let stateWord;
    let sentence;
    const summary = summaryWords(row);
    const version = row.meta && row.meta.version != null ? Number(row.meta.version) : null;
    const reasons = row.reasons.map(reasonWords);
    const waitingOn = row.inputs
      .map((f) => STAGES.find((s) => s.file === f))
      .filter((s) => s && !done(s.n))
      .map((s) => /** @type {any} */ (s).n);

    if (run && (run.status === "queued" || run.status === "running")) {
      stateWord = "Running";
      const step = run.step_n && run.steps_total
        ? `step ${run.step_n} of ${run.steps_total}${run.step_word ? `, ${run.step_word}` : ""}`
        : (run.status === "queued" ? "waiting for the machine to pick it up" : "working");
      sentence = `Running: ${step}.${run.cost_so_far_usd != null ? ` ${money(run.cost_so_far_usd)} spent so far.` : ""}`;
    } else if (run && run.status === "failed") {
      // The newest try failed: that is the news, even over an older good file
      // (which still opens with Read it). Retry or Redo is the tap.
      stateWord = run.stopped_at_cap ? "Stopped at the cap" : "Needs a redo";
      sentence = run.stopped_at_cap
        ? `${String(run.error || "Stopped at the cap.").trim()}`
        : `Could not finish: ${String(run.error || "no reason was saved").trim()}`;
    } else if (row.state === "READY") {
      stateWord = isApproved ? "Done, approved" : "Done";
      sentence = `Done.${summary ? ` ${cap(summary)}.` : ""}${version ? ` Version ${version}.` : ""} ${isApproved ? "Approved." : "Not reviewed."}`;
    } else if (row.state === "FAILED") {
      stateWord = "Needs a redo";
      sentence = `Needs a redo: ${reasons.join("; ")}.`;
    } else if (row.state === "STALE") {
      stateWord = "Out of date";
      sentence = `Out of date: ${reasons.join("; ")}, so this needs a redo.`;
    } else if (row.state === "BLOCKED") {
      stateWord = waitingOn.length ? `Waiting on step${waitingOn.length > 1 ? "s" : ""} ${waitingOn.join(" and ")}` : "Waiting";
      sentence = `${stateWord}.`;
    } else if (!runner && NOT_BUILT[/** @type {1|2} */ (row.n)]) {
      stateWord = "Not on this page yet";
      sentence = NOT_BUILT[/** @type {1|2} */ (row.n)];
    } else {
      stateWord = "Not run yet";
      sentence = waitingOn.length && row.inputs.length
        ? `Not started. Waiting on step${waitingOn.length > 1 ? "s" : ""} ${waitingOn.join(" and ")}.`
        : "Not started.";
    }

    // ── can it run now, and if not, why (disabled with the reason) ──────────
    let canRun = { ok: true, reason: null };
    if (!runner) {
      canRun = { ok: false, reason: NOT_BUILT[/** @type {1|2} */ (row.n)] || "This step cannot run from the page yet." };
    } else if (run && (run.status === "queued" || run.status === "running")) {
      canRun = { ok: false, reason: `${cap(STEP_NAME[row.n])} is already being made. This is that run.` };
    } else if (row.n === 3 && read("01-avatar.md") == null) {
      canRun = { ok: false, reason: "Step 1 (who we sell to) has to be done first." };
    } else if (runner.needsApproved) {
      const missing = runner.needsApproved.filter((n) => !approved(n));
      if (missing.length) {
        canRun = {
          ok: false,
          reason: `Approve step${missing.length > 1 ? "s" : ""} ${missing.join(" and ")} first (${missing.map((n) => STEP_NAME[n]).join(" and ")}).`
        };
      }
    }

    const filePath = `marketing/flywheel/${campaign}/${row.file}`;
    return {
      n: row.n,
      key: row.key,
      label_words: labelWords(row.n, name),
      step_words: `${labelWords(row.n, name)}, step ${row.n} of ${STAGE_COUNT}`,
      file: row.file,
      state: row.state,
      state_word: stateWord,
      sentence,
      approved: isApproved,
      source: files[row.file] ? files[row.file].source : "missing",
      gate: {
        clears: row.state === "READY",
        sentence: row.state === "READY" || row.state === "MISSING"
          ? null
          : `Does not clear the bar for the next step: ${reasons.join("; ")}.`
      },
      can_run: canRun,
      can_approve: text != null,
      run,
      version,
      review_card_md: reviewCard(text),
      document_md: body == null ? null : body.trim(),
      files: text == null ? [] : [{
        path: filePath,
        github_url: `https://github.com/${repo}/blob/${commitSha || "main"}/${filePath}`
      }]
    };
  });
}

function cap(s) {
  const t = String(s || "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** The "advice" line render() prints, as one sentence for the card's footer. */
export function adviceWords(rows) {
  const broken = rows.filter((r) => r.state === "STALE" || r.state === "FAILED");
  if (broken.length) return `${broken.length} step${broken.length > 1 ? "s need" : " needs"} a redo. Do them in order: ${broken.map((b) => b.n).join(", then ")}.`;
  if (rows.every((r) => r.state === "READY")) return "Every step is current.";
  const next = rows.find((r) => r.state === "MISSING");
  return next ? `Next to run: step ${next.n}, ${String(next.label_words).toLowerCase()}.` : null;
}
