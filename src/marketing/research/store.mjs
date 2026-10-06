// @ts-check
// The research buttons' rows: start a run, read it back in plain words, approve it, tweak
// it. Used by api/marketing/research*.mjs and api/marketing/flywheel/run.mjs.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 item 5 (the Your research rows
// and their words), item 6 row 2, "Endpoints" (the deep research shapes), §5 rules 13, 16
// and 18, and §6 "Slice 10". Unit X2. Table: marketing_jobs (409) with migration 429's
// approved_by / approved_at and the two in-flight indexes.

import { InvalidError, NotFoundError, isNotReady } from "../http.mjs";
import { enqueueRepoWrite } from "../../repo/outbox.mjs";
import { DEPTHS, searchCeiling, renderReportFile, KIND as DEEP_KIND } from "./deep-research.mjs";
import { searchCeiling as marketSearchCeiling, KIND as STAGE_KIND, STEPS_TOTAL as MARKET_STEPS, campaignWords } from "../flywheel/ad-research.mjs";
import { SEARCH_USD } from "./usage.mjs";
import { dollars } from "./cost-guard.mjs";
import { isCampaign } from "../offer-inputs.mjs";

export { DEEP_KIND, STAGE_KIND };

/** A stop amount below this cannot pay for the write-up and one round, so it is refused. */
export const MIN_RESEARCH_CAP_USD = 1;
export const MAX_RESEARCH_CAP_USD = 1000;

const NO_MODEL = "No Anthropic key is set on the site. An agent must set it.";

/** True when the site holds a usable Anthropic key (set, and not the masked form). */
export function hasModelKey(env = process.env) {
  const k = env && env.ANTHROPIC_API_KEY;
  return typeof k === "string" && k.trim() !== "" && !k.includes("*");
}
export const NO_MODEL_SENTENCE = NO_MODEL;

/** The research routes' "not live yet": a missing table, or a column or index migration 429 adds. */
export function researchNotReady(err) {
  if (isNotReady(err)) return true;
  if (!err) return false;
  const msg = String(err.message || "");
  if (err.code === "42703" && /approved_by|approved_at|max_research_cost_usd|research_shares_month_cap|web_search_requests|web_fetch_requests|"step"/.test(msg)) return true;
  if (err.code === "42P10") return true; // ON CONFLICT with no matching index: 429 not applied
  return false;
}

/**
 * A refusal decided inside a write's transaction (a cap reached, no such campaign). Thrown,
 * never returned, so withRequest rolls back and never saves it as the request's answer:
 * the same request_id can be sent again once the reason is fixed (API doc §2: "Only success
 * answers are saved").
 */
export class Refusal extends Error {
  /** @param {number} status @param {Record<string, any>} body */
  constructor(status, body) {
    super(String(body && body.message || "refused"));
    this.name = "Refusal";
    this.status = status;
    this.body = body;
  }
}

/** A 400 with error 'bad_question' (design: "400 bad_question (empty question or missing cap)"). */
export class BadQuestionError extends Error {
  /** @param {string} field @param {string} message */
  constructor(field, message) {
    super(message);
    this.name = "BadQuestionError";
    this.field = field;
  }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * checkResearchStart(body, settingsRow) → { question, depth, sources, belief, max_cost_usd }
 * Throws BadQuestionError (400 bad_question) on an empty question, no place to look, or no
 * stop amount; InvalidError (400 invalid) on a malformed field.
 */
export function checkResearchStart(body, settingsRow) {
  const b = isObj(body) ? body : {};
  const question = text(b.question);
  if (question.length < 3) throw new BadQuestionError("question", "Type the question first.");
  if (question.length > 1000) throw new InvalidError("question", "The question is too long. Keep it under 1,000 letters.");
  const depth = b.depth == null ? "quick" : b.depth;
  if (depth !== "quick" && depth !== "deep") throw new InvalidError("depth", "How deep must be quick (Quick look) or deep (Leave nothing unturned).");
  const s = b.sources == null ? {} : b.sources;
  if (!isObj(s)) throw new InvalidError("sources", "sources must be {web, vault, own_files}, each true or false.");
  for (const k of Object.keys(s)) {
    if (!["web", "vault", "own_files"].includes(k)) throw new InvalidError(`sources.${k}`, `"${k}" is not a place to look. Use web, vault or own_files.`);
    if (typeof s[k] !== "boolean") throw new InvalidError(`sources.${k}`, `sources.${k} must be true or false.`);
  }
  const sources = { web: s.web !== false, vault: s.vault !== false, own_files: s.own_files === true };
  if (!sources.web && !sources.vault) {
    throw new BadQuestionError("sources", "Pick at least one place to look: live web pages or the Hormozi vault.");
  }
  let belief = null;
  if (b.belief != null && b.belief !== "") {
    if (typeof b.belief !== "string") throw new InvalidError("belief", "The belief line must be words.");
    belief = text(b.belief).slice(0, 500) || null;
  }
  let cap = b.max_cost_usd;
  if (cap == null || cap === "") {
    const fromSettings = settingsRow && settingsRow.max_research_cost_usd != null ? Number(settingsRow.max_research_cost_usd) : null;
    if (fromSettings == null) throw new BadQuestionError("max_cost_usd", "Type a stop amount first.");
    cap = fromSettings;
  }
  if (typeof cap !== "number" || !Number.isFinite(cap)) throw new InvalidError("max_cost_usd", "The stop amount must be a number of dollars, like 5.");
  if (cap < MIN_RESEARCH_CAP_USD) {
    throw new BadQuestionError("max_cost_usd", `The stop amount is too small. The write-up alone can cost up to about 50 cents, so type at least ${dollars(MIN_RESEARCH_CAP_USD)}.`);
  }
  if (cap > MAX_RESEARCH_CAP_USD) throw new InvalidError("max_cost_usd", `The stop amount can be at most ${dollars(MAX_RESEARCH_CAP_USD)}.`);
  return { question, depth, sources, belief, max_cost_usd: Math.round(cap * 100) / 100 };
}

/** Today in Arizona, YYYY-MM-DD (the folder date for a report). */
export function arizonaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The month spend and caps the sheet prints, and whether a run may start.
 * @returns {{ month_used_usd: number, month_cap_usd: number|null, shares: boolean, capped: boolean }}
 */
export function monthState(settingsRow, monthUsedUsd) {
  const shares = !settingsRow || settingsRow.research_shares_month_cap == null ? true : settingsRow.research_shares_month_cap === true;
  const cap = settingsRow && settingsRow.max_month_cost_usd != null ? Number(settingsRow.max_month_cost_usd) : 300;
  return { month_used_usd: Number(monthUsedUsd) || 0, month_cap_usd: shares ? cap : null, shares, capped: shares && Number(monthUsedUsd) >= cap };
}

export function monthCapSentence(capUsd) {
  return `Stopped at the ${dollars(capUsd)} month cap. Raise it in Settings or wait for next month.`;
}

// ── starting a run ────────────────────────────────────────────────────────────

/**
 * startDeepResearch(tx, { orgId, staffId, input, today, extra }) → { job, already_running }
 * One in flight per company (migration 429's partial unique index): a second tap gets the
 * running row back.
 */
export async function startDeepResearch(tx, { orgId, staffId = null, input, today = null, extra = {} }) {
  const payload = { ...input, today: today || arizonaToday(), ...extra };
  const ins = await tx.query(
    `INSERT INTO marketing_jobs (org_id, kind, payload, requested_by)
     VALUES ($1, '${DEEP_KIND}', $2::jsonb, $3)
     ON CONFLICT (org_id) WHERE kind = '${DEEP_KIND}' AND status IN ('queued', 'running')
     DO NOTHING
     RETURNING *`,
    [orgId, JSON.stringify(payload), staffId]
  );
  if (ins.rows[0]) return { job: ins.rows[0], already_running: false };
  const cur = await tx.query(
    `SELECT * FROM marketing_jobs
      WHERE org_id = $1 AND kind = '${DEEP_KIND}' AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1`,
    [orgId]
  );
  return { job: cur.rows[0], already_running: true };
}

/**
 * startMarketResearch(tx, { orgId, staffId, campaign, market, competitors, note, today })
 *   → { job, already_running }
 * One run of step 2 per company and campaign in flight (migration 429).
 */
export async function startMarketResearch(tx, { orgId, staffId = null, campaign, market = null, competitors = [], note = null, today = null }) {
  const payload = { campaign, stage: 2, market, competitors, note, today: today || arizonaToday() };
  const ins = await tx.query(
    `INSERT INTO marketing_jobs (org_id, kind, payload, requested_by)
     VALUES ($1, '${STAGE_KIND}', $2::jsonb, $3)
     ON CONFLICT (org_id, (payload ->> 'campaign'), (payload ->> 'stage'))
       WHERE kind = '${STAGE_KIND}' AND status IN ('queued', 'running')
     DO NOTHING
     RETURNING *`,
    [orgId, JSON.stringify(payload), staffId]
  );
  if (ins.rows[0]) return { job: ins.rows[0], already_running: false };
  const cur = await tx.query(
    `SELECT * FROM marketing_jobs
      WHERE org_id = $1 AND kind = '${STAGE_KIND}' AND status IN ('queued', 'running')
        AND payload ->> 'campaign' = $2 AND payload ->> 'stage' = '2'
      ORDER BY created_at DESC LIMIT 1`,
    [orgId, campaign]
  );
  return { job: cur.rows[0], already_running: true };
}

/**
 * checkMarketStart(body) → { campaign, market, competitors, retry_job_id }
 * InvalidError on a bad field; the stage check is the route's.
 */
export function checkMarketStart(body) {
  const b = isObj(body) ? body : {};
  const campaign = text(b.campaign).toLowerCase() || "partner";
  if (!isCampaign(campaign)) throw new InvalidError("campaign", "The campaign name can only use lower-case letters, numbers and dashes, like \"partner\".");
  let market = null;
  if (b.market != null && b.market !== "") {
    if (typeof b.market !== "string") throw new InvalidError("market", "The market line must be words.");
    market = text(b.market).slice(0, 600) || null;
  }
  let competitors = [];
  if (b.competitors != null) {
    if (!Array.isArray(b.competitors) || b.competitors.some((c) => typeof c !== "string")) {
      throw new InvalidError("competitors", "competitors must be a list of names.");
    }
    competitors = b.competitors.map((c) => text(c).slice(0, 120)).filter(Boolean).slice(0, 20);
  }
  const retry = b.retry_job_id == null || b.retry_job_id === "" ? null : String(b.retry_job_id);
  return { campaign, market, competitors, retry_job_id: retry };
}

// ── reading a run back in words ───────────────────────────────────────────────

const money = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

/**
 * The words on a Your research row (design §3.2 item 5):
 *   "Running: sweeping round 2 of up to 6 · 37 findings · $1.12 so far"
 *   "Done, 11 of 14 key claims held up" / "Done, stopped at the cap: $X after round N"
 *   "Done, write-up failed, findings below" / "Could not finish: <reason>"
 */
export function researchStateWord(row) {
  const r = row && row.result && typeof row.result === "object" ? row.result : null;
  const p = (r && r.progress) || {};
  if (row.status === "queued" || row.status === "running") {
    if (!r || !r.step) return "Waiting to start. It runs in the background.";
    const so = p.cost_usd_so_far != null ? ` · ${dollars(p.cost_usd_so_far)} so far` : "";
    const retry = row.status === "queued" && r.error_last ? ` · trying again: ${String(r.error_last).slice(0, 120)}` : "";
    return `Running: ${r.step_word || "working"} · ${Number(p.findings) || 0} findings${so}${retry}`;
  }
  if (row.status === "failed") return `Could not finish: ${String(row.error || "no reason recorded").slice(0, 300)}`;
  const rep = r && r.report ? r.report : null;
  if (!rep) return "Done.";
  if (rep.stopped_at_cap) return `Done, stopped at the cap: ${dollars(rep.cost_usd)} after round ${rep.rounds}`;
  if (rep.fallback_report) return "Done, write-up failed, findings below";
  const checked = (Number(rep.key_verified) || 0) + (Number(rep.key_killed) || 0);
  if (!checked) return "Done, no key claims to check";
  return `Done, ${rep.key_verified} of ${checked} key claims held up`;
}

/** The `job` object of GET marketing/research?id= and of every row in the list. */
export function researchJobView(row) {
  const r = row && row.result && typeof row.result === "object" ? row.result : null;
  const p = (r && r.progress) || {};
  const payload = row.payload || {};
  return {
    id: row.id,
    status: row.status,
    question: payload.question || null,
    depth: payload.depth === "deep" ? "deep" : "quick",
    sources: payload.sources || null,
    max_cost_usd: payload.max_cost_usd == null ? null : Number(payload.max_cost_usd),
    focus: payload.focus || null,
    parent_id: payload.parent_id || null,
    step_word: researchStateWord(row),
    step: r ? r.step : null,
    step_n: r ? r.step_n : null,
    steps_total: r ? r.steps_total : 8,
    progress: {
      round: Number(p.round) || 0,
      findings: Number(p.findings) || 0,
      searches_used: Number(p.searches_used) || 0,
      cost_usd_so_far: money(p.cost_usd_so_far) ?? 0,
      shrunk: Array.isArray(p.shrunk) ? p.shrunk : [],
      started_at: p.started_at || null,
      updated_at: p.updated_at || null
    },
    error: row.error || null,
    resumable: row.status === "failed" && !!(r && r.steps && r.state),
    approved: !!row.approved_at,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at || null,
    finished_at: row.finished_at instanceof Date ? row.finished_at.toISOString() : row.finished_at || null
  };
}

/** The `report` object, or null until the run is done. */
export function researchReportView(row, { repo = null } = {}) {
  const rep = row && row.status === "done" && row.result && row.result.report ? row.result.report : null;
  if (!rep) return null;
  return {
    markdown: rep.markdown,
    fallback_report: !!rep.fallback_report,
    key_verified: Number(rep.key_verified) || 0,
    key_killed: Number(rep.key_killed) || 0,
    unreachable: Array.isArray(rep.unreachable) ? rep.unreachable : [],
    dropped: Number(rep.dropped) || 0,
    quotes_unchecked: Number(rep.quotes_unchecked) || 0,
    rounds: Number(rep.rounds) || 0,
    cost_usd: money(rep.cost_usd),
    searches: rep.searches == null ? null : Number(rep.searches),
    minutes: rep.minutes == null ? null : Number(rep.minutes),
    stopped_at_cap: rep.stopped_at_cap || null,
    repo_path: rep.repo_path || null,
    repo_state: repo,
    approved_by: row.approved_by || null,
    approved_at: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at || null
  };
}

/**
 * Where a report's save stands: "Saved. Reaching the repo…" until the outbox commit lands,
 * then "In the repo" (design §3.2 "Repo write pending").
 */
export async function repoStateOf(db, orgId, repoPath) {
  if (!repoPath) return null;
  const r = await db.query(
    `SELECT committed_sha, error FROM repo_outbox WHERE org_id = $1 AND path = $2 ORDER BY id DESC LIMIT 1`,
    [orgId, repoPath]
  );
  const row = r.rows[0];
  if (!row) return { state: "not_saved", words: "Not in the repo yet.", committed_sha: null };
  if (row.committed_sha) return { state: "in_repo", words: "In the repo", committed_sha: row.committed_sha };
  return { state: "pending", words: "Saved. Reaching the repo…", committed_sha: null };
}

/** The last measured run of each depth, for the cost sheet. Null until one finished. */
export async function lastMeasured(db, orgId) {
  const r = await db.query(
    `SELECT payload ->> 'depth' AS depth, result -> 'report' AS report
       FROM marketing_jobs
      WHERE org_id = $1 AND kind = '${DEEP_KIND}' AND status = 'done'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 20`,
    [orgId]
  );
  const out = { quick: null, deep: null };
  for (const row of r.rows) {
    const d = row.depth === "deep" ? "deep" : "quick";
    if (out[d] || !row.report) continue;
    out[d] = { cost_usd: money(row.report.cost_usd), minutes: row.report.minutes == null ? null : Number(row.report.minutes), searches: row.report.searches == null ? null : Number(row.report.searches) };
  }
  return out;
}

/** The searches line of the cost sheet, computed from the server's own limits. */
export function researchLimits() {
  const line = (n) => ({ searches: n, search_usd: Math.round(n * SEARCH_USD * 100) / 100 });
  return {
    quick: { ...line(searchCeiling("quick")), rounds: DEPTHS.quick.rounds, sub_questions: DEPTHS.quick.subs, key_claims: DEPTHS.quick.verifyClaims },
    deep: { ...line(searchCeiling("deep")), rounds: DEPTHS.deep.rounds, sub_questions: DEPTHS.deep.subs, key_claims: DEPTHS.deep.verifyClaims }
  };
}

/** The market research limits for its sheet: at most 106 searches, 138 with retries. */
export function marketLimits() {
  return {
    searches: marketSearchCeiling(),
    searches_with_retries: marketSearchCeiling({ withRetries: true }),
    search_usd: Math.round(marketSearchCeiling() * SEARCH_USD * 100) / 100,
    search_usd_with_retries: Math.round(marketSearchCeiling({ withRetries: true }) * SEARCH_USD * 100) / 100,
    steps_total: MARKET_STEPS
  };
}

/**
 * The run view for a stage-2 row, in the shape design §3.2 "Endpoints" gives the stage row's
 * `run` (GET marketing/flywheel builds the row; this is its run part).
 */
export function marketRunView(row) {
  const r = row && row.result && typeof row.result === "object" ? row.result : null;
  const p = (r && r.progress) || {};
  const s = (r && r.state) || {};
  const running = row.status === "queued" || row.status === "running";
  let stepWord = null;
  if (running && r) {
    stepWord = `Running: step ${r.step_n} of ${r.steps_total}, ${r.step_word}. ${Number(p.findings) || 0} findings so far. ${dollars(p.cost_usd_so_far || 0)} so far.`;
  } else if (running) {
    stepWord = "Waiting to start. It runs in the background.";
  } else if (row.status === "failed") {
    stepWord = r && r.stopped ? r.stopped.sentence : `Could not finish: ${String(row.error || "").slice(0, 300)}`;
  } else if (r && r.board) {
    stepWord = r.board.thin || r.board.sentence;
  }
  return {
    job_id: row.id,
    status: row.status,
    campaign: (row.payload && row.payload.campaign) || null,
    campaign_words: campaignWords((row.payload && row.payload.campaign) || ""),
    step: r ? r.step : null,
    step_n: r ? r.step_n : null,
    steps_total: MARKET_STEPS,
    step_word: stepWord,
    round: Number(s.round) || 0,
    counts_so_far: { findings: Number(p.findings) || 0, checked: Number(p.checked) || 0, competitors: Number(p.competitors) || 0 },
    searches_so_far: Number(p.searches_used) || 0,
    fetches_so_far: Number(p.fetches_used) || 0,
    cost_so_far_usd: money(p.cost_usd_so_far) ?? 0,
    shrunk: Array.isArray(p.shrunk) ? p.shrunk : [],
    resumable: row.status === "failed" && !!(r && r.steps && r.state),
    stopped: r && r.stopped ? r.stopped : null,
    board: r && r.board ? r.board : null,
    started_at: p.started_at || null,
    finished_at: row.finished_at instanceof Date ? row.finished_at.toISOString() : row.finished_at || null,
    error: row.error || null
  };
}

// ── approve and tweak ─────────────────────────────────────────────────────────

/**
 * approveResearch(tx, { orgId, id, staffId }) → the row. A person's tap only. The report
 * file is saved again with status approved (one outbox replace; the machine owns the file).
 * Already approved: the same row back, nothing written twice.
 */
export async function approveResearch(tx, { orgId, id, staffId }) {
  const cur = (await tx.query(
    `SELECT * FROM marketing_jobs WHERE id = $1 AND org_id = $2 AND kind = '${DEEP_KIND}' FOR UPDATE`,
    [id, orgId]
  )).rows[0];
  if (!cur) throw new NotFoundError("No research run with that id.");
  if (cur.status !== "done") throw new InvalidError("id", "Only a finished report can be approved.");
  if (cur.approved_at) return cur;
  const row = (await tx.query(
    `UPDATE marketing_jobs SET approved_by = $3, approved_at = now()
      WHERE id = $1 AND org_id = $2 RETURNING *`,
    [id, orgId, staffId]
  )).rows[0];
  const rep = row.result && row.result.report;
  const state = row.result && row.result.state;
  if (rep && rep.repo_path && state) {
    const content = renderReportFile({ ...state, report: rep }, {
      jobId: row.id, status: "approved", costUsd: rep.cost_usd, approvedAt: new Date(row.approved_at).toISOString()
    });
    await enqueueRepoWrite(tx, { orgId, opId: `research-${row.id}-approved`, path: rep.repo_path, mode: "replace", content });
  }
  return row;
}

/**
 * tweakResearch(tx, { orgId, id, note, staffId }) → { job, already_running }
 * A short re-run (Quick look) of the same question that goes deeper on the note, with the
 * same places to look and the same stop amount. The first run is kept as it is.
 */
export async function tweakResearch(tx, { orgId, id, note, staffId }) {
  const n = text(note).slice(0, 300);
  if (!n) throw new InvalidError("note", "Type one line: what should it look at more closely?");
  const cur = (await tx.query(
    `SELECT * FROM marketing_jobs WHERE id = $1 AND org_id = $2 AND kind = '${DEEP_KIND}'`,
    [id, orgId]
  )).rows[0];
  if (!cur) throw new NotFoundError("No research run with that id.");
  if (cur.status !== "done" && cur.status !== "failed") throw new InvalidError("id", "That run is still going. Tweak it when it is done.");
  const p = cur.payload || {};
  const input = { question: p.question, depth: "quick", sources: p.sources || { web: true, vault: true, own_files: false }, belief: p.belief || null, max_cost_usd: Number(p.max_cost_usd) };
  return startDeepResearch(tx, { orgId, staffId, input, extra: { focus: n, parent_id: cur.id } });
}

export { NO_MODEL };
