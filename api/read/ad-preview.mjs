// A lazy, read-only Meta preview for the ad that brought one client.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { decryptToken } from "../../src/adplatforms/tokens.mjs";
import { callPlatform } from "../../src/adplatforms/_api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { asStaff } from "../../src/partners/rls.mjs";

const API_VERSION = () => process.env.META_API_VERSION || "v26.0";

export function previewFrameUrl(body) {
  const src = /<iframe\b[^>]*\bsrc=["']([^"']+)["']/i.exec(String(body || ""))?.[1];
  if (!src) return null;
  try {
    const url = new URL(src.replace(/&amp;/g, "&"));
    return url.protocol === "https:" && ["www.facebook.com", "business.facebook.com"].includes(url.hostname) &&
      url.pathname === "/ads/api/preview_iframe.php" ? url.href : null;
  } catch { return null; }
}

export async function findMatchingAd(database, { orgId, clientId }) {
  const result = await database.query(
    `SELECT a.external_id, a.partner_id, conn.encrypted_access_token
       FROM clients cl
       LEFT JOIN client_ad_attribution attr ON attr.client_id = cl.id AND attr.org_id = cl.org_id
       JOIN ads a ON a.org_id = cl.org_id
       JOIN ad_sets s ON s.id = a.ad_set_id AND s.org_id = cl.org_id
       JOIN ad_platform_connections conn ON conn.id = a.connection_id AND conn.org_id = cl.org_id
      WHERE cl.id = $1 AND cl.org_id = $2
        AND a.name = COALESCE(attr.utm_content, cl.custom_fields->>'utm_content')
        AND a.external_id IS NOT NULL
        AND conn.platform = 'meta'
        AND (COALESCE(attr.utm_term, cl.custom_fields->>'utm_term') IS NULL
             OR s.external_id = COALESCE(attr.utm_term, cl.custom_fields->>'utm_term'))
      ORDER BY a.updated_at DESC LIMIT 2`,
    [clientId, orgId]
  );
  return result.rows.length === 1 ? result.rows[0] : null;
}

export default async function handler(req, res, deps = {}) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const database = deps.db ?? db;
  const staff = await (deps.requireAuth ?? requireAuth)(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
  const clientId = String(req.query?.client_id ?? "").trim();
  if (!isUuid(staff.org_id) || !isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "invalid_client" });
  }
  try {
    // Ads and connections enforce RLS; a bare pool query silently sees zero rows.
    const ad = await (deps.asStaff ?? asStaff)(
      (tx) => findMatchingAd(tx, { orgId: staff.org_id, clientId }), { db: database }
    );
    if (!ad || !ad.encrypted_access_token) {
      return res.status(200).json({ ok: true, preview_url: null, message: "No playable ad preview is linked to this lead yet." });
    }
    const token = decryptToken(ad.encrypted_access_token, { partnerId: ad.partner_id });
    const data = await (deps.callPlatform ?? callPlatform)({
      url: `https://graph.facebook.com/${API_VERSION()}/${encodeURIComponent(ad.external_id)}/previews?ad_format=MOBILE_FEED_STANDARD`,
      token, method: "GET"
    });
    const previewUrl = previewFrameUrl(data?.data?.[0]?.body);
    return res.status(200).json({ ok: true, preview_url: previewUrl,
      message: previewUrl ? null : "Meta has no playable preview for this ad." });
  } catch (error) {
    if (dbDown(res, error)) return;
    return res.status(502).json({ ok: false, error: "preview_unavailable", message: "The ad preview could not load. Try again." });
  }
}
