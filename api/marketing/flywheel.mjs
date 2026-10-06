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

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { hasCompany, sendKnownError, sendNotReady, NotFoundError } from "../../src/marketing/http.mjs";
import { parseCampaign, readCampaign, fileText } from "../../src/marketing/flywheel/http.mjs";
import { campaignWords, startableOffers } from "../../src/marketing/flywheel/campaigns.mjs";
import { readFlywheel } from "../../src/marketing/flywheel/reader.mjs";

export const ROUTE = "marketing/flywheel";

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
    return res.status(200).json({
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
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The flywheel card")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
