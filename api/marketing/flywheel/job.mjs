// GET /api/marketing/flywheel/job?id=<job id> — one flywheel run, step by step.
//
// Route key "marketing/flywheel/job" (netlify/functions/api.mjs ROUTES). Design
// docs/specs/command-center-design-2026-10-05.md §3.2 Endpoints ("poll every 5 to 10 s
// while the tab is visible"). Unit X1: avatar runs (kind 'avatar').
//
//   GET ?id= → 200 {ok, job: {id, status, campaign, step, step_n, steps_total, step_word,
//                     round, counts_so_far, searches_so_far, fetches_so_far,
//                     cost_so_far_usd, run_cap_usd, shrunk[], stopped_at_cap, resumable,
//                     attempts, started_at, finished_at, error, sentence, result,
//                     steps:[{n, key, word, status, attempts, started_at, finished_at}]}}
//            → 400 invalid (no id) · 404 not_found (not an avatar run of this company)
//   cost_so_far_usd and searches_so_far come from the cost ledger (marketing_model_usage).
//   `sentence` is the row's words ("Running: step 3 of 10, searching the web for buyer
//   quotes, round 2. … $1.90 spent so far, 23 searches.").
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING), then a
// company on the session. Reads only.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import { staffRead, sendNotReady, hasCompany, sendInvalid, sendNotFound } from "../../../src/marketing/http.mjs";
import { getAvatarJob, jobLedger, avatarJobView, avatarStepsView } from "../../../src/marketing/avatar/store.mjs";

export const ROUTE = "marketing/flywheel/job";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read a run." });
  }

  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  const id = String((req.query && req.query.id) || "").trim();
  if (!id) return sendInvalid(res, "id", "Say which run: ?id=<job id>.");

  try {
    const out = await staffRead(database, async (tx) => {
      const row = await getAvatarJob(tx, { orgId, id });
      if (!row) return null;
      const ledger = await jobLedger(tx, row.id);
      return { ...avatarJobView(row, ledger), steps: avatarStepsView(row) };
    });
    if (!out) return sendNotFound(res, "That run was not found for this company.");
    return res.status(200).json({ ok: true, job: out });
  } catch (err) {
    if (sendNotReady(res, err, "The flywheel run reader")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
