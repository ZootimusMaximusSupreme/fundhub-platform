// GET /api/social/oauth?action=start|callback
// Meta (facebook/instagram) + LinkedIn OAuth connect for social_channels.
// Credentials unset by design until apps are provisioned — returns not_configured.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { encryptToken } from "../../src/adplatforms/tokens.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  signState, verifyState, metaAuthUrl, linkedinAuthUrl,
  exchangeMetaCode, exchangeLinkedInCode
} from "../../src/social/oauth.mjs";

const STAFF_OK = new Set(["owner", "admin", "partner"]);

/* Writes to social_channels go through RLS (049). A bare db.query leaves
   fundhub.actor unset, so fundhub_is_staff() is false and the insert dies with
   "new row violates row-level security policy". Stamp the caller first. */
function writeScope(principal) {
  return principal.kind === "partner"
    ? { kind: "partner", partnerId: principal.partnerId }
    : { kind: "staff" };
}

function baseUrl(req, env = process.env) {
  return (env.APP_BASE_URL || env.URL || `${req.headers?.["x-forwarded-proto"] || "https"}://${req.headers?.host || "localhost"}`).replace(/\/+$/, "");
}

function redirectUri(req, channel, env) {
  return `${baseUrl(req, env)}/api/social/oauth?action=callback&channel=${encodeURIComponent(channel)}`;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl;

  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["staff"], { db: database });
  if (!principal) return;
  if (!STAFF_OK.has(principal.role) && principal.role !== "owner") {
    // partners + owners/admins only
    if (!STAFF_OK.has(String(principal.role))) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
  }

  const q = req.query || {};
  const action = String(q.action || "start");
  const channel = String(q.channel || "").toLowerCase();

  if (!["facebook", "instagram", "linkedin"].includes(channel)) {
    return res.status(400).json({ ok: false, error: "invalid_channel" });
  }

  if (action === "start") {
    const partnerId = q.partner_id || principal.partnerId || null;
    if (!partnerId) {
      return res.status(400).json({
        ok: false,
        error: "partner_id_required",
        message: "Pick a partner before connecting a social channel."
      });
    }
    if (channel === "linkedin" && !q.external_account_id && !env.LINKEDIN_ORG_ID) {
      return res.status(400).json({
        ok: false,
        error: "needs_org",
        message: "LinkedIn organization URN required — pass external_account_id or set LINKEDIN_ORG_ID."
      });
    }

    // The partner's OWN org, not the calling staff member's — a staff session
    // can act across partners/orgs, and social_channels.org_id must be the
    // partner's, never guessed from whoever happened to click Connect.
    const partnerRow = (await database.query(
      `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
    )).rows[0];
    if (!partnerRow) {
      return res.status(404).json({ ok: false, error: "partner_not_found" });
    }

    const state = signState({
      partnerId,
      channel,
      orgId: partnerRow.org_id,
      external_account_id: q.external_account_id || env.LINKEDIN_ORG_ID || null,
      exp: Date.now() + 15 * 60 * 1000
    }, env);
    if (!state) {
      return res.status(503).json({
        ok: false,
        error: "not_configured",
        missing: ["AD_TOKEN_ENC_KEY"],
        message: "AD_TOKEN_ENC_KEY unset — see ops/STILL-MISSING.md"
      });
    }

    const redir = redirectUri(req, channel, env);
    let auth;
    if (channel === "linkedin") {
      auth = linkedinAuthUrl({ clientId: env.LINKEDIN_CLIENT_ID, redirectUri: redir, state });
    } else {
      auth = metaAuthUrl({ appId: env.META_APP_ID, redirectUri: redir, state });
    }
    if (!auth.ok) {
      return res.status(503).json({
        ok: false,
        error: "not_configured",
        missing: auth.missing,
        message: `${auth.missing.join(" + ")} unset — see ops/STILL-MISSING.md`
      });
    }
    return res.status(200).json({ ok: true, url: auth.url, state });
  }

  if (action === "callback") {
    const st = verifyState(q.state, env);
    if (!st) return res.status(400).json({ ok: false, error: "invalid_state" });
    const code = q.code;
    if (!code) return res.status(400).json({ ok: false, error: "missing_code" });

    const redir = redirectUri(req, st.channel || channel, env);
    const orgId = st.orgId || principal.orgId;
    const partnerId = st.partnerId;

    try {
      if (st.channel === "linkedin") {
        const tok = await exchangeLinkedInCode({ code, redirectUri: redir, env, fetchImpl });
        if (!tok.ok) {
          return res.status(tok.reason === "not_configured" ? 503 : 400).json(tok);
        }
        const externalId = String(st.external_account_id || "").replace(/^urn:li:organization:/, "");
        if (!externalId) {
          return res.status(400).json({ ok: false, error: "needs_org" });
        }
        const enc = encryptToken(tok.accessToken, { partnerId, env });
        await withPartnerScope(writeScope(principal), (tx) => tx.query(
          `INSERT INTO social_channels
             (org_id, partner_id, channel, external_account_id, encrypted_access_token,
              encrypted_refresh_token, token_expires_at, connection_state, scopes)
           VALUES ($1,$2,'linkedin',$3,$4,$5,
                   CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6 || ' seconds')::interval END,
                   'active', '["openid","profile","email","w_member_social"]'::jsonb)
           ON CONFLICT (partner_id, channel, external_account_id) DO UPDATE SET
             encrypted_access_token = EXCLUDED.encrypted_access_token,
             encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
             token_expires_at = EXCLUDED.token_expires_at,
             connection_state = 'active',
             last_error = NULL,
             updated_at = now()`,
          [orgId, partnerId, externalId, enc, tok.refreshToken ? encryptToken(tok.refreshToken, { partnerId, env }) : null, tok.expiresIn]
        ));
        return res.status(200).json({ ok: true, channel: "linkedin", external_account_id: externalId });
      }

      // Meta facebook / instagram
      const tok = await exchangeMetaCode({ code, redirectUri: redir, env, fetchImpl });
      if (!tok.ok) {
        return res.status(tok.reason === "not_configured" ? 503 : 400).json(tok);
      }
      const pages = tok.pages || [];
      if (!pages.length) {
        return res.status(400).json({
          ok: false,
          error: "no_pages",
          message: "No Facebook Pages returned for this user."
        });
      }

      const saved = [];
      await withPartnerScope(writeScope(principal), async (tx) => {
      for (const page of pages) {
        if (st.channel === "facebook" || channel === "facebook") {
          const enc = encryptToken(page.access_token, { partnerId, env });
          await tx.query(
            `INSERT INTO social_channels
               (org_id, partner_id, channel, external_account_id, handle, encrypted_access_token,
                connection_state, scopes)
             VALUES ($1,$2,'facebook',$3,$4,$5,'active','["pages_manage_posts"]'::jsonb)
             ON CONFLICT (partner_id, channel, external_account_id) DO UPDATE SET
               encrypted_access_token = EXCLUDED.encrypted_access_token,
               handle = EXCLUDED.handle,
               connection_state = 'active',
               last_error = NULL,
               updated_at = now()`,
            [orgId, partnerId, String(page.id), page.name || null, enc]
          );
          saved.push({ channel: "facebook", external_account_id: String(page.id) });
        }
        if ((st.channel === "instagram" || channel === "instagram") && page.instagram_business_account?.id) {
          const igId = String(page.instagram_business_account.id);
          const enc = encryptToken(page.access_token, { partnerId, env });
          await tx.query(
            `INSERT INTO social_channels
               (org_id, partner_id, channel, external_account_id, handle, encrypted_access_token,
                connection_state, scopes)
             VALUES ($1,$2,'instagram',$3,$4,$5,'active','["instagram_content_publish"]'::jsonb)
             ON CONFLICT (partner_id, channel, external_account_id) DO UPDATE SET
               encrypted_access_token = EXCLUDED.encrypted_access_token,
               connection_state = 'active',
               last_error = NULL,
               updated_at = now()`,
            [orgId, partnerId, igId, page.name || null, enc]
          );
          saved.push({ channel: "instagram", external_account_id: igId });
        }
      }
      });
      if (!saved.length) {
        return res.status(400).json({
          ok: false,
          error: "no_matching_accounts",
          message: channel === "instagram"
            ? "No Instagram business account linked to your Pages."
            : "No Pages available to connect."
        });
      }
      return res.status(200).json({ ok: true, channels: saved });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "oauth_failed",
        message: safeError(err)
      });
    }
  }

  return res.status(400).json({ ok: false, error: "invalid_action" });
}
