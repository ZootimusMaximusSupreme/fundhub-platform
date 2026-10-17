import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";

// Marketing updates are separate from device permission and from consent to
// use a client's words or likeness in ads. Missing or non-boolean data is off.
export default async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["client"], { db });
  if (!principal) return;
  const orgId = principal.orgId || null;
  const clientId = principal.clientId || null;
  if (!orgId || !clientId) {
    return res.status(403).json({ ok: false, error: "forbidden",
      message: "Your login is not attached to a client file." });
  }

  if (method === "PUT") {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (typeof body.marketing_push_enabled !== "boolean") {
      return res.status(400).json({ ok: false, error: "invalid_preference",
        message: "Choose on or off for marketing updates." });
    }
    try {
      const { rows } = await db.query(
        `UPDATE clients
            SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb),
              '{marketing_push_enabled}', to_jsonb($3::boolean), true)
          WHERE org_id = $1 AND id = $2
          RETURNING custom_fields -> 'marketing_push_enabled' AS marketing_push_enabled`,
        [orgId, clientId, body.marketing_push_enabled]
      );
      if (!rows.length) return res.status(403).json({ ok: false, error: "forbidden" });
      return res.status(200).json({ ok: true, marketing_push_enabled: rows[0].marketing_push_enabled === true });
    } catch {
      return res.status(500).json({ ok: false, error: "preference_save_failed",
        message: "We could not save your marketing update choice. Please try again." });
    }
  }

  try {
    const { rows } = await db.query(
      `SELECT custom_fields -> 'marketing_push_enabled' AS marketing_push_enabled
         FROM clients WHERE org_id = $1 AND id = $2 LIMIT 1`,
      [orgId, clientId]
    );
    if (!rows.length) return res.status(403).json({ ok: false, error: "forbidden" });
    return res.status(200).json({ ok: true, marketing_push_enabled: rows[0].marketing_push_enabled === true });
  } catch {
    return res.status(500).json({ ok: false, error: "preference_read_failed",
      message: "We could not check your marketing updates. Please try again." });
  }
}
