// POST /api/marketing/flywheel/approve — Approve a flywheel step from the dashboard.
//
// Route key "marketing/flywheel/approve" (netlify/functions/api.mjs ROUTES). Design
// docs/specs/command-center-design-2026-10-05.md §3.2 Actions ("Approve (free, one tap;
// flips the stamp's status to approved through one outbox edit that touches the front
// matter only, so the body hash and nothing downstream changes)") and §5 rule 12 (repo
// saves land in git through the outbox). Unit X1.
//
//   POST {campaign, stage, request_id} → 200 {ok, stage, outbox_id, duplicate, message}
//     → 400 invalid  bad campaign or stage (1 to 6)
//     → 404 not_found  that step has no file to approve yet
//   A repeated request_id answers the first answer again and queues nothing.
//
// The edit is set_front_matter_key {key:'status', value:'approved'} on
// marketing/flywheel/<campaign>/0N-<name>.md (src/repo/edit-ops.mjs): applied by the
// outbox drain to the newest copy at the branch head, so it never overwrites anything.
// The worker is woken after the commit so the save reaches the repo within a minute.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING), then a
// company on the session. One staff transaction (withRequest). No model call.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany,
  InvalidError, NotFoundError
} from "../../../src/marketing/http.mjs";
import { enqueueRepoWrite } from "../../../src/repo/outbox.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";
import { readRepoFile } from "../../../src/marketing/flywheel/repo-read.mjs";
import { isCampaign } from "../../../src/marketing/avatar/campaigns.mjs";
import { STAGES } from "../../../scripts/flywheel/status.mjs";

export const ROUTE = "marketing/flywheel/approve";

/** The stage file for 1..6, or null. */
export function stageFile(stage) {
  const s = STAGES.find((x) => x.n === Number(stage));
  return s ? s.file : null;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  const wake = deps.wake ?? wakeWorker;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to approve a step." });
  }

  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    if (!isCampaign(body.campaign)) throw new InvalidError("campaign", "Pick a campaign: a folder name like partner.");
    const file = stageFile(body.stage);
    if (!file) throw new InvalidError("stage", "Say which step: 1 to 6.");
    const repoPath = `marketing/flywheel/${body.campaign}/${file}`;

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const now = await readRepoFile(tx, { orgId, path: repoPath, env: {}, deps: deps.repoDeps || {} });
      if (now.content == null) throw new NotFoundError(`Step ${Number(body.stage)} has no file to approve yet. Run it first.`);
      const row = await enqueueRepoWrite(tx, {
        orgId, opId: `approve:${requestId}`, path: repoPath, mode: "edit",
        edit: { op: "set_front_matter_key", key: "status", value: "approved" }
      });
      return {
        ok: true, stage: Number(body.stage), outbox_id: row.id, duplicate: row.duplicate,
        message: "Approved. Saved. Reaching the repo…"
      };
    });
    try { await wake(env); } catch { /* the clock drains the outbox within 15 minutes */ }
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err && (err.name === "RepoPathError" || err.name === "EditOpError" || err.name === "OutboxError")) {
      return res.status(400).json({ error: "invalid", field: "stage", message: `The repo refused the save: ${err.message}` });
    }
    if (sendNotReady(res, err, "Approve")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
