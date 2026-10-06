// @ts-check
// Job kind 'funnel': write the words for a book-a-call funnel and draw its three
// pages (build unit X4). Registered in src/marketing/job-kinds.mjs; run by
// netlify/functions/marketing-funnel-background.mjs (the offer writer's pattern:
// U22's worker is not on main yet) and, once U22 lands, by its worker too.
//
// SAVED STEPS. A retry re-enters and skips what is done, so a step is paid for
// once (design §5 rule 18):
//   1. guard   the funnel exists, was built here, and nothing of it is live
//   2. done?   every page already holds HTML from THIS job → answer, no call
//   3. cap     this month's model spend is under max_month_cost_usd
//   4. write   one Anthropic call (structured output, COPY_SCHEMA), logged to
//              marketing_model_usage; the words go through checkCopy; one fix
//              round with the failures listed; still failing → the job fails
//              with the reasons, nothing saved
//   5. draw    the three pages (src/marketing/funnel-pages.mjs), each checked
//              for the tag and the tracking scripts, then saved (the database
//              refuses a page without them, migration 425)
//
// WHERE THE WORDS COME FROM: the offer's facts (src/config/offers.mjs) and, when
// the funnel names a flywheel campaign, that campaign's stage files
// (marketing/flywheel/<campaign>/01-avatar.md, 03-offer.md, 04-copy.md, and the
// owner notes) read from the files bundled with the function. Each file's
// approval stamp is reported on the job's result; a draft file is used and
// said to be a draft (it is the best source there is, and nothing goes live
// until Chris taps Push live).

import fs from "node:fs";
import path from "node:path";
import { callModel } from "../agents/model.mjs";
import { flywheelDir, ownerNotesSection } from "./offer-inputs.mjs";
import { splitFrontMatter, parseFrontMatter } from "../../scripts/flywheel/status.mjs";
import { anthropicKeyOf } from "./offer-transport.mjs";
import { logUsage, costStatus } from "./model-usage.mjs";
import { FUNNEL_OFFERS, pagePaths } from "./funnel-paths.mjs";
import { COPY_SCHEMA, FUNNEL_MODEL, buildPrompt, checkCopy, offerFactsBlock } from "./funnel-copy.mjs";
import { renderPage } from "./funnel-pages.mjs";
import { trackingGaps } from "./funnel-tracking.mjs";
import { loadFunnel, savePageBuild } from "./funnel-store.mjs";
import { offerFacts } from "./offer-facts.mjs";

/** An error that will not fix itself on a retry: the job fails now, with this reason. */
export class FunnelJobError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "FunnelJobError";
    this.final = true;
  }
}

export const MAX_WRITE_ROUNDS = 2;
export const WRITE_MAX_TOKENS = 8000;
export const WRITE_TIMEOUT_MS = 300_000;

const STAGE_FILES = Object.freeze({ avatar: "01-avatar.md", offer: "03-offer.md", copy: "04-copy.md" });

/**
 * The campaign's stage files, read from the bundle. { avatar, offer, copy,
 * ownerNotes, files: {name: {path, status}|null} }. A missing campaign or file
 * is an empty string, never a guess.
 * @param {string|null} campaign
 */
export function readCampaignSources(campaign) {
  const out = { avatar: "", offer: "", copy: "", ownerNotes: "", files: {} };
  if (!campaign) return out;
  const dir = flywheelDir(campaign);
  if (!dir) return out;
  for (const [name, file] of Object.entries(STAGE_FILES)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) { out.files[name] = null; continue; }
    const text = fs.readFileSync(p, "utf8");
    const { frontMatter, body } = splitFrontMatter(text);
    out[name] = body.trim();
    const status = parseFrontMatter(frontMatter).status || null;
    out.files[name] = { path: `marketing/flywheel/${campaign}/${file}`, status };
  }
  const notes = path.join(dir, "00-OWNER-NOTES.md");
  if (fs.existsSync(notes)) {
    out.ownerNotes = ownerNotesSection(fs.readFileSync(notes, "utf8"));
    out.files.ownerNotes = out.ownerNotes ? { path: `marketing/flywheel/${campaign}/00-OWNER-NOTES.md`, status: null } : null;
  }
  return out;
}

async function monthCap(db, orgId) {
  const r = await db.query(`SELECT max_month_cost_usd FROM marketing_settings WHERE org_id = $1`, [orgId]);
  return r.rows[0] ? Number(r.rows[0].max_month_cost_usd) : undefined;
}

/**
 * run(job, ctx) — the handler contract of src/marketing/job-kinds.mjs.
 * ctx: { db, env, deps: { callModel?, readSources?, now? } }
 */
export async function run(job, ctx = /** @type {any} */ ({})) {
  const db = ctx.db;
  const env = ctx.env ?? process.env;
  const deps = ctx.deps ?? {};
  const orgId = job.org_id;
  const funnelId = job.payload && job.payload.funnel_id;

  // 1. guard
  const found = await loadFunnel(db, orgId, funnelId);
  if (!found || !found.funnel.kind) throw new FunnelJobError("That funnel was not found, or it was not built here.");
  const { funnel, pages } = found;
  if (funnel.status === "live" || pages.some((p) => p.cf_page_id)) {
    throw new FunnelJobError(`${funnel.path} is already on ClickFunnels. A live page is never rewritten. Build a new funnel instead.`);
  }
  const offer = FUNNEL_OFFERS[funnel.offer_key];
  if (!offer) throw new FunnelJobError(`The offer ${funnel.offer_key} cannot get a book-a-call funnel.`);
  const paths = pagePaths(funnel.path);

  // 2. done already (a retry after the pages were saved)
  if (pages.length === 3 && pages.every((p) => p.html && String(p.build_job_id) === String(job.id))) {
    return summary(funnel, pages, { reused: true });
  }

  // 3. the month cap
  const cost = await costStatus(db, { orgId, maxMonthUsd: await monthCap(db, orgId), now: deps.now ? deps.now() : new Date() });
  if (cost.month_capped) {
    throw new FunnelJobError(`This month's model spend has reached its cap ($${cost.month_usd} used). Nothing was written.`);
  }

  // 4. write
  const key = anthropicKeyOf(env);
  if (!key) throw new FunnelJobError("ANTHROPIC_API_KEY is not set (or is masked) on the server, so the pages cannot be written.");
  const facts = offerFacts(funnel.offer_key);
  const offerInput = { label: facts ? facts.label : offer.product.name, product: offer.product, lane: funnel.lane };
  const sources = (deps.readSources ?? readCampaignSources)(funnel.campaign);
  const sourceText = [offerFactsBlock(offerInput), sources.avatar, sources.offer, sources.copy, sources.ownerNotes]
    .filter((s) => typeof s === "string" && s.trim()).join("\n");
  const ask = deps.callModel ?? callModel;

  let copy = null;
  let fix = [];
  let rounds = 0;
  let costUsd = 0;
  let priced = true;
  let servedModel = null;
  while (rounds < MAX_WRITE_ROUNDS) {
    rounds += 1;
    const { system, user } = buildPrompt({ offer: offerInput, sources, paths, fix });
    const out = await ask({
      provider: "anthropic",
      model: FUNNEL_MODEL,
      system,
      user,
      env: { ANTHROPIC_API_KEY: key },
      maxTokens: WRITE_MAX_TOKENS,
      timeoutMs: WRITE_TIMEOUT_MS,
      effort: "medium",
      outputSchema: COPY_SCHEMA
    });
    servedModel = out.servedModel || FUNNEL_MODEL;
    if (out.mode === "live" && out.usage) {
      const row = await logUsage(db, { orgId, jobId: job.id, model: servedModel, usage: out.usage });
      if (row && row.cost_usd != null) costUsd += Number(row.cost_usd);
      else priced = false;
    }
    if (out.error) throw new Error(`The page writer did not answer: ${out.error}`);
    if (!out.json || typeof out.json !== "object") throw new Error("The page writer answered without the words.");
    const check = checkCopy(out.json, { sourceText, priceCents: offer.product.priceCents });
    if (check.ok) { copy = out.json; break; }
    fix = check.failures;
  }
  if (!copy) {
    throw new FunnelJobError(
      `The words failed the copy check ${MAX_WRITE_ROUNDS} times, so nothing was saved. ` +
      `First problems: ${fix.slice(0, 6).join(" | ")}`
    );
  }

  // 5. draw and save
  const saved = [];
  for (const page of pages) {
    const html = renderPage({ funnel, page, copy, paths, env });
    const gaps = trackingGaps(html, funnel.tag);
    if (gaps.length) throw new FunnelJobError(`The ${page.role} page came out without its tracking: ${gaps.join("; ")}.`);
    const row = await savePageBuild(db, { pageId: page.id, copy: copy[page.role], html, jobId: job.id });
    if (!row) throw new FunnelJobError(`The ${page.role} page went live while it was being written, so it was not changed.`);
    saved.push(row);
  }
  return summary(funnel, saved, { rounds, model: servedModel, costUsd: priced ? costUsd : null, sources: sources.files });
}

function summary(funnel, pages, extra = {}) {
  return {
    funnel_id: funnel.id,
    path: funnel.path,
    tag: funnel.tag,
    pages: pages.map((p) => ({ role: p.role, path: p.path, bytes: p.html ? Buffer.byteLength(p.html, "utf8") : 0 })),
    checks: "passed",
    rounds: extra.rounds ?? null,
    model: extra.model ?? null,
    cost_usd: extra.costUsd == null ? null : Math.round(extra.costUsd * 1e6) / 1e6,
    sources: extra.sources ?? null,
    reused: extra.reused === true
  };
}
