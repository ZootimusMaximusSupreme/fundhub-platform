// POST /api/marketing/flywheel/campaign — "Start a flywheel" for any offer.
//
// Route key "marketing/flywheel/campaign" (netlify/functions/api.mjs ROUTES). Design
// docs/specs/command-center-design-2026-10-05.md §3.2 ("Start a flywheel makes a folder
// and owner-notes file for any offer key in src/config/offers.mjs (for example the
// Capital Blueprint) through the outbox, free"). Unit X1.
//
//   POST {key, request_id} → 201 {ok, campaign, words, created:true, outbox_id}
//                          → 200 {ok, campaign, words, created:false}  it already exists
//     → 400 invalid  key is not an offer key in src/config/offers.mjs
//
// The folder is the offer key in folder form (CAPITAL_BLUEPRINT -> capital-blueprint;
// PARTNER_ENTRY is the existing "partner"), src/marketing/avatar/campaigns.mjs. The one
// file written is marketing/flywheel/<campaign>/00-OWNER-NOTES.md with the same layout as
// the partner file, an empty "## Notes" section and the offer it sells. Nothing else.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING), then a
// company on the session. One staff transaction (withRequest). Free: no model call.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany, InvalidError
} from "../../../src/marketing/http.mjs";
import { enqueueRepoWrite } from "../../../src/repo/outbox.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";
import { OFFERS, OFFER_KEYS } from "../../../src/config/offers.mjs";
import { bundleDirExists } from "../../../src/marketing/flywheel/repo-read.mjs";
import { campaignForOfferKey, campaignWords } from "../../../src/marketing/avatar/campaigns.mjs";

export const ROUTE = "marketing/flywheel/campaign";

/** The owner-notes file a new flywheel starts with (the partner file's layout). */
export function ownerNotesTemplate(campaign, key) {
  return [
    `# Owner notes — ${campaignWords(campaign)} flywheel`,
    "",
    "Hand-authored. Agents **append one line, never rewrite**. Same rule as the",
    "intended journey files.",
    "",
    `This flywheel sells ${OFFERS[key].name} (offer key ${key} in src/config/offers.mjs).`,
    "Every correction Chris makes to a stage goes here as one line, and it is fed",
    "back into that stage on every future re-run.",
    "",
    "Format:",
    "",
    "```",
    "YYYY-MM-DD | stage N | the correction, in one line",
    "```",
    "",
    "## Notes",
    ""
  ].join("\n");
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  const wake = deps.wake ?? wakeWorker;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to start a flywheel." });
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
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!OFFER_KEYS.includes(key)) {
      throw new InvalidError("key", `Pick one of our offers: ${OFFER_KEYS.join(", ")}.`);
    }
    const campaign = campaignForOfferKey(key);
    const roots = deps.roots;

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      // Already there: shipped with the site, or saved from the dashboard (waiting or
      // committed — a dashboard commit carries [skip ci], so the bundle can lag behind it).
      const saved = await tx.query(
        `SELECT 1 FROM repo_outbox WHERE org_id = $1 AND path LIKE $2 LIMIT 1`,
        [orgId, `marketing/flywheel/${campaign}/%`]
      );
      const exists = bundleDirExists(`marketing/flywheel/${campaign}`, roots ? { roots } : undefined) || saved.rows.length > 0;
      if (exists) return { ok: true, campaign, words: campaignWords(campaign), created: false };
      const row = await enqueueRepoWrite(tx, {
        orgId, opId: `campaign:${campaign}`, path: `marketing/flywheel/${campaign}/00-OWNER-NOTES.md`,
        mode: "replace", content: ownerNotesTemplate(campaign, key)
      });
      return { ok: true, campaign, words: campaignWords(campaign), created: true, outbox_id: row.id };
    });
    if (answer.created) {
      try { await wake(env); } catch { /* the clock drains the outbox within 15 minutes */ }
    }
    return res.status(answer.created ? 201 : 200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Start a flywheel")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
