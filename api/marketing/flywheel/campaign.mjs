// /api/marketing/flywheel/campaign — "Start a flywheel" for any offer.
//
// Route key "marketing/flywheel/campaign". Design docs/specs/command-center-
// design-2026-10-05.md §3.2 row 6 ("Start a flywheel makes a folder and
// owner-notes file for any offer key in src/config/offers.mjs (for example the
// Capital Blueprint) through the outbox, free") and its endpoint line
// "POST marketing/flywheel/campaign {key} -> 201 {ok, campaign}". Unit X3.
//
//   POST {request_id, key}  key = an offer key (UWIQ_DELIVERABLES = the Capital
//        Blueprint, PARTNER_ENTRY = the partner program, ...)
//     → 201 {ok, campaign, campaign_words, created:true, offer_key, repo_path, outbox_id}
//       queues marketing/flywheel/<campaign>/00-OWNER-NOTES.md (with the
//       "Offer key:" line the stage writers read) for the repo; the worker is
//       woken after the commit so the save reaches git within a minute.
//     → 200 {..., created:false} when that offer's flywheel already exists.
//     400 invalid field key (not an offer) · 503 not_ready
//   A repeated request_id answers the first answer again and changes nothing.
//   words: the same as campaign_words (unit X1 built this route too and named it so;
//   the wave 2b merge keeps X3's route, its folder names and X1's key).
//
// Free. Writes one file through the outbox. Owner and admin only.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany, InvalidError
} from "../../../src/marketing/http.mjs";
import { campaignForOffer, campaignWords, ownerNotesTemplate, NOTES_FILE } from "../../../src/marketing/flywheel/campaigns.mjs";
import { readFlywheel } from "../../../src/marketing/flywheel/reader.mjs";
import { todayArizona } from "../../../src/marketing/flywheel/save.mjs";
import { enqueueRepoWrite } from "../../../src/repo/outbox.mjs";
import { getOffer, OFFER_KEYS } from "../../../src/config/offers.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/flywheel/campaign";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

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
    const key = String(body.key ?? "").trim().toUpperCase();
    const offer = getOffer(key);
    if (!offer) {
      throw new InvalidError("key", `Pick an offer: ${OFFER_KEYS.join(", ")}.`);
    }
    const campaign = campaignForOffer(offer.key);
    if (!campaign) throw new InvalidError("key", "That offer's name does not make a folder name. Tell an agent.");

    // Outside the transaction: may read GitHub.
    const seen = await (deps.readFlywheel || readFlywheel)({ db: database, orgId, campaign: null, env, deps: deps.reader || {} });
    const exists = seen.campaigns.includes(campaign);
    const path = `marketing/flywheel/${campaign}/${NOTES_FILE}`;
    let ran = false;

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      ran = true;
      if (exists) {
        const words = campaignWords(campaign);
        return { ok: true, campaign, campaign_words: words, words, created: false, offer_key: offer.key, repo_path: path, outbox_id: null };
      }
      const row = await enqueueRepoWrite(tx, {
        orgId,
        opId: `flywheel-campaign:${campaign}`,
        path,
        mode: "replace",
        content: ownerNotesTemplate({ campaign, offerKey: offer.key, today: todayArizona() })
      });
      const words = campaignWords(campaign, `Offer key: ${offer.key}`);
      return { ok: true, campaign, campaign_words: words, words, created: true, offer_key: offer.key, repo_path: path, outbox_id: row.id };
    });

    if (ran && answer.created) await (deps.wake ?? wakeWorker)(env);
    return res.status(answer.created ? 201 : 200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Start a flywheel")) return;
    if (dbDown(res, err)) return;
    if (err && err.code === "op_id_reused") {
      // The same campaign was started before with different words (another day): it exists.
      return res.status(200).json({ ok: true, created: false, message: "That flywheel was already started." });
    }
    throw err;
  }
}
