import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";

// Only an authenticated client may report the native app running.
// Never accept a caller-provided org_id, client_id, or account_id.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (String(req.method || "").toUpperCase() !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const principal = await requirePrincipal(req, res, ["client"], { db });
  if (!principal) return;
  const { orgId, clientId, accountId, sessionId } = principal;
  if (!orgId || !clientId || !accountId || !sessionId) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (body.event_type !== "native_authenticated_open" ||
      body.platform !== "ios" || !UUID.test(String(body.installation_id || ""))) {
    return res.status(400).json({ ok: false, error: "invalid_native_activity" });
  }
  try {
    // Retries preserve the first server-received time for this installation.
    const proof = await db.query(
      `INSERT INTO native_client_app_opens
         (org_id, client_id, account_id, platform, installation_id)
       VALUES ($1, $2, $3, 'ios', $4)
       ON CONFLICT ON CONSTRAINT uq_native_client_app_opens_client_device
       DO UPDATE SET last_authenticated_at = now(), account_id = EXCLUDED.account_id
       RETURNING first_authenticated_at`,
      [orgId, clientId, accountId, body.installation_id.toLowerCase()]
    );
    return res.status(200).json({ ok: true, native_authenticated: true,
      first_authenticated_at: proof.rows[0].first_authenticated_at });
  } catch {
    return res.status(503).json({ ok: false, error: "native_activity_unavailable",
      message: "Could not record this iPhone app visit." });
  }
}
