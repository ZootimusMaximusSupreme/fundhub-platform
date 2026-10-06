// GET /api/marketing/flywheel?campaign=<folder> — the six flywheel steps of one campaign,
// in plain words, with the avatar run on step 1.
//
// Route key "marketing/flywheel" (netlify/functions/api.mjs ROUTES). Design
// docs/specs/command-center-design-2026-10-05.md §3.2 Endpoints and the §3.0 word
// table. Unit X1 (slice 5a: step 1 runs on the server).
//
//   GET → 200 {ok, campaign, campaign_words,
//              campaigns:[{key, words, source}],
//              stages:[{n, key, label_words, state, state_word, sentence, approved,
//                       source, file, files:[{path, github_url}], run}],
//              advice, service_description_default, owner_notes_stage_1, as_of}
//     state: 'not_started' | 'running' | 'stopped' | 'failed' | 'done' | 'approved' |
//            'out_of_date' | 'waiting' | 'needs_redo' | 'saving'
//     source: where the file was read: 'outbox-pending' (a dashboard save is waiting
//             to reach the repo), 'bundle-fallback' (the copy shipped with the site),
//             or null (no file)
//     run (step 1 only): the newest avatar run (GET marketing/flywheel/job's job
//             shape), or null
//   400 invalid — a campaign that is not a folder-name slug
//
// THE FILE STATES are the flywheel status script's own rules
// (scripts/flywheel/status.mjs evaluate(), via src/marketing/flywheel-status.mjs), read
// from the copy bundled with the site, with any save still waiting in repo_outbox laid
// on top for step 1. GAP (recorded in the X1 report): the design reads these files from
// GitHub at a pinned commit; that reader exists (src/marketing/flywheel/repo-read.mjs)
// and the avatar run uses it, but this GET does not call GitHub on every poll yet.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING), then a
// company on the session. Reads only.

import path from "node:path";
import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { staffRead, sendNotReady, hasCompany, sendInvalid } from "../../src/marketing/http.mjs";
import { findFlywheelDir, campaignStatus, candidateRoots } from "../../src/marketing/flywheel-status.mjs";
import { repoConfig } from "../../src/repo/github.mjs";
import { readRepoFile } from "../../src/marketing/flywheel/repo-read.mjs";
import { isCampaign, campaignWords, defaultServiceDescription } from "../../src/marketing/avatar/campaigns.mjs";
import { latestAvatarJob, jobLedger, avatarJobView } from "../../src/marketing/avatar/store.mjs";
import { stageOneNotes } from "../../src/marketing/avatar/run.mjs";
import { avatarPaths } from "../../src/marketing/avatar/document.mjs";
import { STAGES } from "../../scripts/flywheel/status.mjs";
import fs from "node:fs";

export const ROUTE = "marketing/flywheel";
export const DEFAULT_CAMPAIGN = "partner";

/** The six steps in Chris's words (§3.2: "1. Who we sell to", "2. What the market sells", …). */
export const STAGE_WORDS = Object.freeze({
  1: "Who we sell to",
  2: "What the market sells",
  3: "The offer",
  4: "Ad copy",
  5: "Which ad strategy",
  6: "Read the spend"
});

/** Every campaign folder: the bundled ones plus any a dashboard save is creating. */
export async function listCampaigns(tx, { orgId, roots }) {
  const out = new Map();
  const base = findFlywheelDir(roots);
  if (base) {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (e.isDirectory() && isCampaign(e.name)) out.set(e.name, "bundle-fallback");
    }
  }
  const r = await tx.query(
    `SELECT DISTINCT split_part(path, '/', 3) AS c FROM repo_outbox
      WHERE org_id = $1 AND committed_sha IS NULL AND path LIKE 'marketing/flywheel/%/%'`,
    [orgId]
  );
  for (const row of r.rows) if (isCampaign(row.c) && !out.has(row.c)) out.set(row.c, "outbox-pending");
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, source]) => ({ key, words: campaignWords(key), source }));
}

/** One stage row in the design's words, from the status script's row. */
export function stageView(row, { campaign, repo, branch }) {
  const n = row.n;
  const label = STAGE_WORDS[/** @type {keyof typeof STAGE_WORDS} */ (n)] || row.label;
  const file = `marketing/flywheel/${campaign}/${row.file}`;
  let state; let stateWord; let sentence;
  switch (row.state) {
    case "MISSING": state = "not_started"; stateWord = "Not started"; sentence = "Not started."; break;
    case "STALE": state = "out_of_date"; stateWord = "Out of date"; sentence = `Out of date: ${row.why || "it was built on an older step"}.`; break;
    case "BLOCKED": state = "waiting"; stateWord = "Waiting"; sentence = `Waiting: ${row.why || "an earlier step is not ready"}.`; break;
    case "FAILED": state = "needs_redo"; stateWord = "Needs a redo"; sentence = `Needs a redo: ${row.why || "it did not clear its bar"}.`; break;
    default:
      state = row.approved ? "approved" : "done";
      stateWord = row.approved ? "Done, approved" : "Done";
      sentence = `Done${row.why ? `. ${row.why[0].toUpperCase()}${row.why.slice(1)}` : ""}. ${row.approved ? "Approved." : "Not reviewed."}`;
  }
  return {
    n, key: row.key, label_words: label, state, state_word: stateWord, sentence,
    approved: !!row.approved,
    source: row.state === "MISSING" ? null : "bundle-fallback",
    file,
    files: row.state === "MISSING" ? [] : [{ path: file, github_url: `https://github.com/${repo}/blob/${branch}/${file}` }],
    run: null
  };
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

  const asked = String((req.query && req.query.campaign) || DEFAULT_CAMPAIGN).trim();
  if (!isCampaign(asked)) return sendInvalid(res, "campaign", "A campaign is a folder name of small letters, numbers and dashes, like partner.");
  const roots = deps.roots ?? candidateRoots(env);
  const { repo, branch } = repoConfig(env);

  try {
    const out = await staffRead(database, async (tx) => {
      const campaigns = await listCampaigns(tx, { orgId, roots });
      const base = findFlywheelDir(roots);
      const dir = base ? path.join(base, asked) : null;
      let rows;
      let advice = null;
      if (dir && fs.existsSync(dir)) {
        const st = campaignStatus(dir, asked);
        rows = st.stages;
        advice = st.advice;
      } else {
        rows = STAGES.map((s) => ({ n: s.n, key: s.key, label: s.label, file: s.file, state: "MISSING", approved: false, why: null, reasons: [] }));
      }
      const stages = rows.map((r) => stageView(r, { campaign: asked, repo, branch }));

      // Step 1: a waiting dashboard save, and the newest server run.
      const s1 = stages[0];
      const main = await readRepoFile(tx, { orgId, path: avatarPaths(asked).main, env: {}, deps: { roots } });
      if (main.source === "outbox-pending") {
        s1.source = "outbox-pending";
        s1.state = "saving";
        s1.state_word = "Saving";
        s1.sentence = "Saved. Reaching the repo…";
      }
      const job = await latestAvatarJob(tx, { orgId, campaign: asked });
      if (job) {
        const view = avatarJobView(job, await jobLedger(tx, job.id));
        s1.run = view;
        if (job.status === "queued" || job.status === "running") {
          s1.state = "running"; s1.state_word = "Running"; s1.sentence = view.sentence;
        } else if (job.status === "failed") {
          s1.state = view.stopped_at_cap ? "stopped" : "failed";
          s1.state_word = view.stopped_at_cap ? "Stopped at the cap" : "Could not finish";
          s1.sentence = view.sentence;
        } else if (job.status === "done" && s1.state === "saving") {
          s1.sentence = `${view.sentence} Saved. Reaching the repo…`;
        }
      }
      const notes = await readRepoFile(tx, { orgId, path: `marketing/flywheel/${asked}/00-OWNER-NOTES.md`, env: {}, deps: { roots } });
      return {
        ok: true,
        campaign: asked,
        campaign_words: campaignWords(asked),
        campaigns,
        stages,
        advice,
        service_description_default: defaultServiceDescription(asked),
        owner_notes_stage_1: stageOneNotes(notes.content),
        as_of: new Date().toISOString()
      };
    });
    return res.status(200).json(out);
  } catch (err) {
    if (sendNotReady(res, err, "The flywheel reader")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
