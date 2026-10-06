// /api/marketing/flywheel/spend-read — "Read the spend", flywheel step 6.
//
// Route key "marketing/flywheel/spend-read". Design docs/specs/command-center-
// design-2026-10-05.md §2 J6 ("Free. Reads saved numbers. A few seconds."),
// §3.2 row 6 and "POST marketing/flywheel/spend-read {campaign} -> 200 {ok,
// rows[], unmatched[], conclusion{text, points_to_stage}}". Unit X3.
//
//   POST {request_id, campaign}
//     → 200 {ok, campaign, window{from, to}, rows[{ad_number, spend_cents,
//            link_clicks, impressions, plays, p25, leads, booked, sales_ours,
//            sales_meta, cpl_cents, maturing}], unmatched{spend_cents, ads,
//            ad_days, leads}, totals{...}, conclusion{text, points_to_stage},
//            repo_path, outbox_id}
//       The read, the conclusion and the 06-spend.md save run in ONE staff
//       transaction (ads and ad_metrics_daily force row-level security);
//       the worker is woken after the commit to carry the file to git.
//     400 invalid field campaign · 404 no such campaign · 503 not_ready
//   Money is integer cents; NULL means Meta sent nothing and prints "unknown".
//
// Free: no model, no vendor. Owner and admin only.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany, NotFoundError
} from "../../../src/marketing/http.mjs";
import { parseCampaign, spendReadInTx } from "../../../src/marketing/flywheel/http.mjs";
import { readFlywheel } from "../../../src/marketing/flywheel/reader.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/flywheel/spend-read";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to read the spend." });
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
    const campaign = parseCampaign(body.campaign);

    const read = await (deps.readFlywheel || readFlywheel)({ db: database, orgId, campaign, env, deps: deps.reader || {} });
    if (!read.campaigns.includes(campaign)) throw new NotFoundError(`There is no flywheel called ${campaign}. Start one first.`);

    let ran = false;
    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, (tx) => {
      ran = true;
      return spendReadInTx(tx, { orgId, campaign, files: read.files, opId: `flywheel-spend:${requestId}`, now: deps.now ? deps.now() : new Date() });
    });
    if (ran) await (deps.wake ?? wakeWorker)(env);
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Read the spend")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
