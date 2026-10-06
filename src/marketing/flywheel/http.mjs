// @ts-check
// What the six api/marketing/flywheel* routes share: reading a campaign the way
// the page sees it, checking the campaign and stage fields, the job's shape on
// the wire, the spend read as one write, and handing step 3 to the existing
// Write offer path. Unit X3 (design docs/specs/command-center-design-2026-10-05.md
// §3.2). The gate is NOT here: each route writes requireAuth, requireRole and
// hasCompany in its own file (scripts/journeys/extract.mjs reads them there).

import { InvalidError } from "../http.mjs";
import { readFlywheel } from "./reader.mjs";
import { latestStageJobs, FLYWHEEL_STAGE_KIND } from "./store.mjs";
import { stagesView, adviceWords, STAGE_RUNNERS, NOT_BUILT } from "./stages.mjs";
import { isCampaign, campaignWords, ownerNotesSection, noteLine } from "./campaigns.mjs";
import { readSpend, concludeSpend, spendDocument } from "./spend-read.mjs";
import { stampStage, nextVersion, hashOf, bodyOf } from "./stamp.mjs";
import { enqueueRepoWrite } from "../../repo/outbox.mjs";
import { repoConfig } from "../../repo/github.mjs";

export { STAGE_RUNNERS, NOT_BUILT, FLYWHEEL_STAGE_KIND };

/** The campaign field: a folder name. 400 field campaign otherwise. */
export function parseCampaign(v, { required = true } = {}) {
  if (v == null || v === "") {
    if (!required) return null;
    throw new InvalidError("campaign", "Which flywheel? Send campaign, the folder name (for example partner).");
  }
  const c = String(v).trim().toLowerCase();
  if (!isCampaign(c)) {
    throw new InvalidError("campaign", "The campaign name can only use lower-case letters, numbers and dashes, like partner.");
  }
  return c;
}

/** The stage field: a whole number 1 to 6. */
export function parseStage(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 6) throw new InvalidError("stage", "Which step? Send stage, a number from 1 to 6.");
  return n;
}

/** The tweak line: one line of plain words. */
export function parseNote(v) {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!t) throw new InvalidError("note", "Type what to change, in one line.");
  if (t.length > 500) throw new InvalidError("note", "Keep the change to one line (500 letters or fewer).");
  return t;
}

/** A flywheel job on the wire. */
export function jobView(row) {
  if (!row) return null;
  const p = row.payload || {};
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    campaign: p.campaign ?? null,
    stage: row.kind === "offer" ? 3 : (p.stage ?? null),
    created_at: row.created_at,
    error: row.error ?? null
  };
}

/**
 * readCampaign({ db, orgId, campaign, env, deps }) → the reader's answer plus the
 * six rows. Never inside a transaction (it may call GitHub).
 * @param {{db: any, orgId: string, campaign: string, env: any, deps?: any}} args
 */
export async function readCampaign({ db, orgId, campaign, env, deps = {} }) {
  const read = await (deps.readFlywheel || readFlywheel)({ db, orgId, campaign, env, deps: deps.reader || {} });
  const files = read.files || {};
  const jobs = await (deps.latestStageJobs || latestStageJobs)(db, { orgId, campaign });
  const stages = stagesView({ campaign, files, jobs, repo: repoConfig(env).repo, commitSha: read.commit_sha });
  return { read, files, jobs, stages, advice: adviceWords(stages) };
}

/** A file's text from the reader's map, or null. */
export const fileText = (files, name) => (files && files[name] && files[name].text != null ? files[name].text : null);

/**
 * The spend read as one write, inside the caller's staff transaction
 * (withRequest's): read the saved numbers, word the conclusion, stamp
 * 06-spend.md and queue it for the repo. Returns the answer body.
 * @param {any} tx
 * @param {{orgId: string, campaign: string, files: any, opId: string, now?: Date}} args
 */
export async function spendReadInTx(tx, { orgId, campaign, files, opId, now = new Date() }) {
  const read = await readSpend(tx, { orgId, now });
  const conclusion = concludeSpend(read.totals);
  const name = campaignWords(campaign, fileText(files, "00-OWNER-NOTES.md"));
  const body = spendDocument({ campaignName: name, read, conclusion });
  const text = stampStage({
    stage: 6,
    version: nextVersion(fileText(files, "06-spend.md")),
    inputs: { "04-copy.md": hashOf(fileText(files, "04-copy.md")), "05-ad-strategy.md": hashOf(fileText(files, "05-ad-strategy.md")) },
    counts: { adsRead: read.rows.length },
    body
  });
  const path = `marketing/flywheel/${campaign}/06-spend.md`;
  const row = await enqueueRepoWrite(tx, { orgId, opId, path, mode: "replace", content: text });
  return {
    ok: true,
    campaign,
    window: { from: read.from, to: read.to },
    rows: read.rows,
    unmatched: read.unmatched,
    totals: read.totals,
    conclusion: { text: conclusion.text, points_to_stage: conclusion.points_to_stage },
    repo_path: path,
    outbox_id: row.id
  };
}

/**
 * Hand step 3 to the existing Write offer path (api/marketing/offer/generate.mjs,
 * job kind 'offer'), with this campaign's files as the dashboard sees them (so a
 * campaign started from the page writes its offer without waiting for a ship)
 * and, for a tweak, the new owner-notes line. Returns { status, body } exactly
 * as that route answered.
 * @param {any} req   the caller's request (the offer worker's wake carries its session)
 * @param {{campaign: string, files: any, extraNote?: string|null, offerHandler: Function, deps?: any}} args
 */
export async function startOffer(req, { campaign, files, extraNote = null, offerHandler, deps = {} }) {
  const notes = [ownerNotesSection(fileText(files, "00-OWNER-NOTES.md") || ""), extraNote || ""].filter(Boolean).join("\n");
  const body = { campaign };
  const avatar = bodyOf(fileText(files, "01-avatar.md"));
  const research = bodyOf(fileText(files, "02-ad-research.md"));
  if (avatar) body.avatar_summary = avatar;
  if (research) body.ad_research_summary = research;
  if (notes) body.owner_notes = notes;
  const captured = { status: 200, body: null, headers: {} };
  const res = {
    status(c) { captured.status = c; return res; },
    json(b) { captured.body = b; return res; },
    setHeader(k, v) { captured.headers[k] = v; return res; }
  };
  await offerHandler({ method: "POST", headers: req.headers || {}, query: {}, body }, res, deps);
  return captured;
}

/** The tweak line for owner notes, in the file's format. */
export { noteLine };

/** Why a stage's Run is off right now, or null when it may run. */
export function blockedReason(stages, stage) {
  const row = stages.find((s) => s.n === stage);
  return row && !row.can_run.ok ? row.can_run.reason : null;
}
