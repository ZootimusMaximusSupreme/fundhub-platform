// POST /api/campaigns/write — push a pause / resume / budget change to Meta.
// Reuses src/adplatforms guardedWrite + meta adapter. No fabricated tokens.
//
// TWO KINDS OF ACTION LIVE HERE.
//   pause, resume, update_budget — a whole CAMPAIGN, named by campaign_id, for a
//     partner login or any staff login that names a partner_id. Unchanged.
//   resume_ad — ONE AD, named by OUR ads.id (spec §10.5 "Turn on", §2 item 6,
//     §4 trap 11). Only Chris may call it. See resumeAd() below.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope, asStaff } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { guardedWrite, adapterFor } from "../../src/adplatforms/index.mjs";
import { safeError } from "../../src/http/health.mjs";
import { ROLE_SETS, allowsRole, isUuid } from "../../src/http/read-api.mjs";

const ACTIONS = new Set(["pause", "resume", "update_budget"]);
export const AD_ACTIONS = new Set(["resume_ad"]);

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const body = req.body || {};

  // The per-ad switch has its own gate and needs no partner_id: the ad row
  // says whose it is. Everything below this line is the campaign path, exactly
  // as it was before resume_ad existed.
  if (String(body.action || "").toLowerCase() === "resume_ad") {
    return resumeAd(req, res, { principal, body, deps });
  }

  const partnerId = resolvePartnerId(principal, {
    partner_id: body.partner_id || (req.query || {}).partner_id
  });
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  const action = String(body.action || "").toLowerCase();
  if (!ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: "unknown_action", allowed: [...ACTIONS, ...AD_ACTIONS] });
  }
  const campaignId = body.campaign_id;
  if (!campaignId) return res.status(400).json({ ok: false, error: "campaign_id_required" });

  try {
    const result = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const camp = (await tx.query(
        `SELECT c.*, conn.encrypted_access_token, conn.external_ad_account_id,
                conn.partner_id AS conn_partner_id, conn.id AS connection_id
           FROM campaigns c
           JOIN ad_platform_connections conn ON conn.id = c.connection_id
          WHERE c.id = $1 AND c.partner_id = $2`,
        [campaignId, partnerId]
      )).rows[0];
      if (!camp) {
        const e = new Error("campaign not found");
        e.code = "NOT_FOUND";
        throw e;
      }
      if (camp.platform !== "meta") {
        const e = new Error("only Meta writes are supported on this route today");
        e.code = "PLATFORM";
        throw e;
      }
      if (!camp.external_id) {
        const e = new Error("campaign has no external_id — sync from Meta first");
        e.code = "NO_EXTERNAL";
        throw e;
      }

      const connection = {
        id: camp.connection_id,
        partner_id: camp.conn_partner_id,
        encrypted_access_token: camp.encrypted_access_token,
        external_ad_account_id: camp.external_ad_account_id
      };
      const adapter = adapterFor("meta");
      const budgetCents = body.budget_cents != null ? Number(body.budget_cents) : null;

      return guardedWrite(tx, {
        orgId: camp.org_id,
        partnerId,
        platform: "meta",
        targetType: "campaign",
        targetId: camp.id,
        reason: body.reason || `campaigns write: ${action}`,
        actor: "human",
        userId: principal.staffId || null,
        before: { status: camp.status, budget_cents: camp.budget_cents, approval_state: camp.approval_state },
        after: {
          status: action === "pause" ? "PAUSED" : action === "resume" ? "ACTIVE" : camp.status,
          budget_cents: action === "update_budget" ? budgetCents : camp.budget_cents,
          approval_state: action === "pause" ? "paused" : action === "resume" ? "live" : camp.approval_state
        },
        budget: action === "update_budget" ? {
          campaignId: camp.id,
          currentCents: camp.budget_cents,
          proposedCents: budgetCents
        } : null,
        execute: async () => {
          if (action === "pause") return adapter.pause(connection, { externalId: camp.external_id });
          if (action === "resume") return adapter.resume(connection, { externalId: camp.external_id });
          return adapter.updateBudget(connection, {
            externalId: camp.external_id,
            budgetCents
          });
        }
      }).then(async (out) => {
        // Mirror Meta's outcome into our row so the Campaigns screen and spend
        // ceilings see the same state without waiting for the next sync.
        if (out && out.ok) {
          if (action === "pause") {
            await tx.query(
              `UPDATE campaigns SET status = 'PAUSED', approval_state = 'paused',
                 last_error = NULL, synced_at = now(), updated_at = now() WHERE id = $1`,
              [camp.id]
            );
          } else if (action === "resume") {
            await tx.query(
              `UPDATE campaigns SET status = 'ACTIVE', approval_state = 'live',
                 last_error = NULL, synced_at = now(), updated_at = now() WHERE id = $1`,
              [camp.id]
            );
          } else if (action === "update_budget" && Number.isFinite(budgetCents)) {
            await tx.query(
              `UPDATE campaigns SET budget_cents = $2, last_error = NULL,
                 synced_at = now(), updated_at = now() WHERE id = $1`,
              [camp.id, budgetCents]
            );
          }
        }
        return out;
      });
    });

    if (result.blocked || result.ok === false) {
      return res.status(400).json({
        ok: false,
        error: result.blocked ? "blocked" : "platform_error",
        state: result.state || null,
        reasons: result.reasons || [],
        message: result.error || null
      });
    }
    return res.status(200).json({ ok: true, action, result: result.result, action_log_id: result.actionLogId });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: err.message });
    if (err.code === "PLATFORM" || err.code === "NO_EXTERNAL") {
      return res.status(400).json({ ok: false, error: err.message });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

/* ───────────────────────── resume_ad — the ON switch ─────────────────────────

   Turns ONE ad on at Meta (spec §10.5 "Turn on", §2 item 6 "Only Chris turns
   ads on", §4 trap 11 "Turn on works per ad").

   WHO. Three locks. Every refusal is the same 403 sentence, so the Launch tab
   can print it as it is:
     1. A STAFF session. requirePrincipal (above) already ran authenticate(),
        the same check requireAuth makes. A partner, client or affiliate login
        stops here.
     2. A role in ROLE_SETS.MARKETING (owner, admin). allowsRole is the check
        requireRole makes; it is called directly so the 403 carries the one
        sentence instead of "this endpoint is limited to owner, admin".
     3. That staff id is in MARKETING_AD_SWITCH_STAFF_IDS, a comma list of staff
        ids. Unset or empty means NOBODY, not everybody.

   WHICH AD. Only OUR ads.id (a uuid). The Meta id is read off that row and
   never taken from the request, because meta.resume() sets ACTIVE on whatever
   id it is handed (src/adplatforms/meta.mjs resume): a campaign or ad set id
   passed through would switch on a whole campaign. Anything that is not one of
   our ad rows in the caller's company is a 404, and Meta is not called.

   WHAT IT WRITES. guardedWrite logs one action_log row (actor human, target
   'ad') before Meta is called. ads.status becomes 'ACTIVE' only after Meta
   answers success:true. A refusal leaves the status alone and keeps Meta's own
   words on ads.last_error and action_log.execute_error. It never writes a
   campaign row or an ad set row, and never calls Meta about either.

   THE STAFF ID IS RECORDED IN action_log.after.staff_id, NOT user_id.
   action_log.user_id REFERENCES accounts(id) (046_ad_platforms.sql:480), the
   partner/client logins table. A staff id is not an accounts row, so putting
   it there fails the foreign key.

   A REPEAT re-sends ACTIVE, which Meta treats as nothing new. request_id is
   kept on the action_log row; there is no saved-answer table to replay from.

   THE TRANSACTION follows the campaign path above: guardedWrite runs inside one
   asStaff transaction that stays open across the Meta call. Spec §4 trap 3 says
   not to do that; changing guardedWrite is outside this action. */

export const AD_SWITCH_ENV = "MARKETING_AD_SWITCH_STAFF_IDS";
export const ONLY_CHRIS = "Only Chris can turn ads on.";
export const NOT_OUR_AD = "We have no ad with that id. Turn on takes our ad id, never a Meta id.";
const MAX_REQUEST_ID = 200;

/* adSwitchStaffIds(env) → Set of lowercased staff ids. Anything in the list
   that is not a uuid is ignored, so a typo or a masked value lets nobody in. */
export function adSwitchStaffIds(env = process.env) {
  const raw = env && typeof env[AD_SWITCH_ENV] === "string" ? env[AD_SWITCH_ENV] : "";
  return new Set(
    raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => isUuid(s))
  );
}

/* mayTurnOnAds(principal, env) → true only for a staff login whose role is in
   ROLE_SETS.MARKETING and whose staff id is on the switch list. */
export function mayTurnOnAds(principal, env = process.env) {
  if (!principal || principal.kind !== "staff") return false;
  if (!allowsRole(ROLE_SETS.MARKETING, principal.role)) return false;
  const id = String(principal.staffId || "").trim().toLowerCase();
  return id !== "" && adSwitchStaffIds(env).has(id);
}

async function resumeAd(req, res, { principal, body, deps }) {
  const env = deps.env || process.env;
  if (!mayTurnOnAds(principal, env)) {
    return res.status(403).json({ ok: false, error: "forbidden", message: ONLY_CHRIS });
  }

  const rawId = body.ad_id;
  if (rawId === undefined || rawId === null || String(rawId).trim() === "") {
    return res.status(400).json({
      ok: false, error: "invalid", field: "ad_id", message: "Say which ad to turn on."
    });
  }
  const adId = String(rawId).trim();
  // A Meta id, a number, or anything else that is not one of our uuids.
  if (!isUuid(adId)) {
    return res.status(404).json({ ok: false, error: "not_found", message: NOT_OUR_AD });
  }

  let requestId = null;
  if (body.request_id !== undefined && body.request_id !== null) {
    const r = body.request_id;
    if (typeof r !== "string" || !r.trim() || r.length > MAX_REQUEST_ID) {
      return res.status(400).json({
        ok: false, error: "invalid", field: "request_id",
        message: "request_id must be a short piece of text."
      });
    }
    requestId = r.trim();
  }

  // Test seam only: a fake Meta. Production passes nothing and the adapter
  // uses its own transport.
  const platformCtx = deps.fetch ? { fetch: deps.fetch } : {};

  try {
    const out = await asStaff(async (tx) => {
      const ad = (await tx.query(
        `SELECT a.id, a.org_id, a.partner_id, a.external_id, a.status, a.name,
                a.fundhub_ad_number,
                conn.id AS connection_id, conn.platform,
                conn.partner_id AS conn_partner_id,
                conn.encrypted_access_token, conn.external_ad_account_id
           FROM ads a
           JOIN ad_platform_connections conn ON conn.id = a.connection_id
          WHERE a.id = $1 AND a.org_id = $2`,
        [adId, principal.orgId]
      )).rows[0];
      if (!ad) return { notFound: true };
      if (ad.platform !== "meta") return { ad, refused: "Only Meta ads can be turned on here." };
      if (!ad.external_id) return { ad, refused: "This ad is not in Meta yet. Load it first." };

      const connection = {
        id: ad.connection_id,
        partner_id: ad.conn_partner_id,
        encrypted_access_token: ad.encrypted_access_token,
        external_ad_account_id: ad.external_ad_account_id
      };
      const adapter = adapterFor("meta");
      const label = ad.fundhub_ad_number ? `Ad ${ad.fundhub_ad_number}` : `ad "${ad.name}"`;

      const write = await guardedWrite(tx, {
        orgId: ad.org_id,
        partnerId: ad.partner_id,
        platform: "meta",
        targetType: "ad",
        targetId: ad.id,
        reason: `Turn on ${label} (resume_ad, one ad)`,
        actor: "human",
        userId: null,
        before: { status: ad.status },
        after: { status: "ACTIVE", staff_id: principal.staffId, request_id: requestId },
        execute: async () => {
          const answer = await adapter.resume(connection, { externalId: ad.external_id }, platformCtx);
          // Meta answers an update with {success: true}. Anything else is not
          // a yes, so the ad is not marked on.
          if (!answer || answer.success !== true) {
            const e = new Error("Meta did not say the ad is on.");
            e.platformMessage = "Meta did not say the ad is on.";
            throw e;
          }
          return answer;
        }
      });

      if (write.ok) {
        await tx.query(
          `UPDATE ads SET status = 'ACTIVE', last_error = NULL, updated_at = now() WHERE id = $1`,
          [ad.id]
        );
      } else if (write.error) {
        await tx.query(`UPDATE ads SET last_error = $2 WHERE id = $1`, [ad.id, write.error]);
      }
      return { ad, write };
    });

    if (out.notFound) {
      return res.status(404).json({ ok: false, error: "not_found", message: NOT_OUR_AD });
    }
    if (out.refused) {
      return res.status(400).json({ ok: false, error: "invalid", field: "ad_id", message: out.refused });
    }
    const { ad, write } = out;
    if (write.ok) {
      return res.status(200).json({
        ok: true,
        ad: { id: ad.id, status: "ACTIVE" },
        action_log_id: write.actionLogId
      });
    }
    if (write.blocked) {
      return res.status(400).json({
        ok: false, error: "blocked", state: write.state || null, reasons: write.reasons || [],
        message: "The ad was not turned on."
      });
    }
    const still = String(ad.status || "").toUpperCase() === "PAUSED"
      ? "The ad is still paused."
      : "The ad did not change.";
    return res.status(502).json({
      ok: false,
      error: "platform_error",
      message: `Meta said no: ${String(write.error || "no reason given").replace(/[.\s]+$/, "")}. ${still}`,
      action_log_id: write.actionLogId || null
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
