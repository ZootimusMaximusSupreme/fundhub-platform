// /api/marketing/flywheel — the Ideas tab's "Offer and market" card: every
// flywheel campaign and the six steps of one, in Chris's words.
//
// Route key "marketing/flywheel" (netlify/functions/api.mjs ROUTES). Design
// docs/specs/command-center-design-2026-10-05.md §3.2 row 6 and "Endpoints, in
// brief"; unit X3 (ops/workflows/marketing-machine-2026-10-extras.json).
//
//   GET ?campaign=<folder>  → 200 {
//     ok, campaign, campaign_words,
//     campaigns: [{name, words}],          every folder under marketing/flywheel/
//                                          (GitHub) plus ones only in pending saves
//     offers: [{key, name, campaign}],     what "Start a flywheel" can start
//     source, fallback_reason, commit_sha, where the files were read
//     stages: [{n, key, label_words, step_words, file, state, state_word,
//               sentence, approved, source, gate{clears, sentence},
//               can_run{ok, reason}, can_approve, run{job_id, kind, status, step,
//               step_n, steps_total, step_word, counts_so_far, cost_so_far_usd,
//               stopped_at_cap, resumable, started_at, finished_at, error} | null,
//               version, review_card_md, document_md, files[{path, github_url}]}],
//     advice, as_of }
//     No campaign: "partner" when it exists, else the first folder.
//   400 invalid field campaign (not a folder name) · 404 no such campaign
//   503 not_ready (a marketing_* table is not live yet)
//
// Free: reads files and saved rows only. Owner and admin only.
//
// WAVE 2B MERGE GLUE. Unit X1 built this route too, for Today's step-1 row
// (public/app/marketing-avatar-row.js). The merge keeps X3's answer and adds X1's
// step-1 parts (stepOneOverlay below):
//   stages[0].run        the newest avatar run (X1's GET marketing/flywheel/job
//                        shape, plus job_id and kind 'avatar' in X3's run shape)
//   stages[0].state_word / sentence  X1's words while that run is going, stopped
//                        or failed, and "Saved. Reaching the repo…" while the
//                        avatar's save waits in the outbox
//   campaigns[].key / .source       X1's picker keys ('outbox-pending' for a folder
//                        only a waiting save has, else 'bundle-fallback')
//   service_description_default, owner_notes_stage_1   X1's "What we sell" pre-fill
//                        and the owner-notes lines step 1 reads
// stages[].state stays X3's (the status script's MISSING / READY / ...).

import fs from "node:fs";
import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { hasCompany, sendKnownError, sendNotReady, staffRead, NotFoundError } from "../../src/marketing/http.mjs";
import { parseCampaign, readCampaign, fileText } from "../../src/marketing/flywheel/http.mjs";
import { campaignWords, startableOffers } from "../../src/marketing/flywheel/campaigns.mjs";
import { readFlywheel } from "../../src/marketing/flywheel/reader.mjs";
import { findFlywheelDir, candidateRoots } from "../../src/marketing/flywheel-status.mjs";
import { defaultServiceDescription } from "../../src/marketing/avatar/campaigns.mjs";
import { latestAvatarJob, jobLedger, avatarJobView } from "../../src/marketing/avatar/store.mjs";
import { stageOneNotes } from "../../src/marketing/avatar/run.mjs";

export const ROUTE = "marketing/flywheel";

/**
 * Unit X1's step-1 parts, laid on X3's answer (wave 2b merge glue). Changes `answer`
 * in place: one staff read for the newest avatar run and the folders only a waiting
 * save has.
 * @param {any} tx
 * @param {{orgId: string, campaign: string, answer: any, notes: string|null, roots: string[]}} args
 */
export async function stepOneOverlay(tx, { orgId, campaign, answer, notes, roots }) {
  const bundled = new Set();
  const base = findFlywheelDir(roots);
  if (base) {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) if (e.isDirectory()) bundled.add(e.name);
  }
  answer.campaigns = answer.campaigns.map((c) => ({
    ...c, key: c.name, source: bundled.has(c.name) ? "bundle-fallback" : "outbox-pending"
  }));
  answer.service_description_default = defaultServiceDescription(campaign);
  answer.owner_notes_stage_1 = stageOneNotes(notes || "");

  const s1 = answer.stages.find((s) => s.n === 1);
  if (!s1) return answer;
  if (s1.source === "outbox-pending") {
    s1.state_word = "Saving";
    s1.sentence = "Saved. Reaching the repo…";
  }
  const job = await latestAvatarJob(tx, { orgId, campaign });
  if (job) {
    const view = avatarJobView(job, await jobLedger(tx, job.id));
    s1.run = { ...view, job_id: view.id, kind: "avatar" };
    if (job.status === "queued" || job.status === "running") {
      s1.state_word = "Running";
      s1.sentence = view.sentence;
      // Unit GL: row 1 runs from this card now, so a run in flight turns Run off.
      s1.can_run = { ok: false, reason: "Who we sell to is already being made. This is that run." };
    } else if (job.status === "failed") {
      s1.state_word = view.stopped_at_cap ? "Stopped at the cap" : "Could not finish";
      s1.sentence = view.sentence;
    } else if (job.status === "done" && s1.source === "outbox-pending") {
      s1.sentence = `${view.sentence} Saved. Reaching the repo…`;
    }
  }
  return answer;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read the flywheel." });
  }

  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const asked = parseCampaign((req.query || {}).campaign, { required: false });
    // No campaign named: read the list first to pick one ("partner", else the first).
    const list = asked
      ? null
      : await (deps.readFlywheel || readFlywheel)({ db: database, orgId, campaign: null, env, deps: deps.reader || {} });
    const campaign = asked || (list && (list.campaigns.includes("partner") ? "partner" : list.campaigns[0])) || null;
    if (!campaign && list) {
      return res.status(200).json({
        ok: true, campaign: null, campaign_words: null, campaigns: [], offers: startableOffers(),
        source: list.source, fallback_reason: list.fallback_reason, commit_sha: list.commit_sha,
        stages: [], advice: "No flywheel yet. Start one for an offer.", as_of: new Date().toISOString()
      });
    }
    const view = await readCampaign({ db: database, orgId, campaign, env, deps });
    if (!view.read.campaigns.includes(campaign)) throw new NotFoundError(`There is no flywheel called ${campaign}. Start one first.`);
    const notes = fileText(view.files, "00-OWNER-NOTES.md");
    const answer = {
      ok: true,
      campaign,
      campaign_words: campaignWords(campaign, notes),
      campaigns: view.read.campaigns.map((name) => ({ name, words: campaignWords(name, name === campaign ? notes : null) })),
      offers: startableOffers(),
      source: view.read.source,
      fallback_reason: view.read.fallback_reason,
      commit_sha: view.read.commit_sha,
      stages: view.stages,
      advice: view.advice,
      as_of: new Date().toISOString()
    };
    const roots = deps.roots ?? candidateRoots(env);
    await staffRead(database, (tx) => stepOneOverlay(tx, { orgId, campaign, answer, notes, roots }));
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The flywheel card")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
