// POST /api/merchant/events — the open API. Any merchant processor (or the
// client's own system) sends sales, refunds, fees and payouts into the
// client's Finance OS.
//
//   Authorization: Bearer fhm_…   (the key shown once on /app/money-connections.html)
//   Body: { "events": [ { id, kind, amount_cents, currency, occurred_at, description } ] }
//
// Contract: docs/finance/merchant-open-api.md.
//
// THE KEY IS THE WHOLE CREDENTIAL. It names one connection, and the connection
// names the client and the business container. Nothing in the body can point
// the money at a different client. Only sha256(key) is stored.
//
// Idempotent on (connection, id): sending the same event twice stores it once
// and says "duplicate". Bad events are listed by index and never stored; good
// events in the same call still go in.
import { db } from "../../src/db.mjs";
import { findActiveByApiKey, recordEvents } from "../../src/merchant/store.mjs";
import { normalizeOpenApiEvents } from "../../src/merchant/normalize.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

function bearer(req) {
  const h = req.headers || {};
  const v = h.authorization || h.Authorization || "";
  const m = /^Bearer\s+(\S+)$/i.exec(String(v).trim());
  return m ? m[1] : "";
}

function parseBody(raw) {
  if (raw && typeof raw === "object") return raw;
  if (raw === null || raw === undefined || raw === "") return null;
  try { return JSON.parse(String(raw)); } catch { return undefined; }
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const key = bearer(req);
  if (!key) {
    res.setHeader("www-authenticate", "Bearer");
    return res.status(401).json({ ok: false, error: "missing_api_key", message: "Send your Fundhub merchant key as: Authorization: Bearer fhm_…" });
  }

  try {
    const connection = await findActiveByApiKey(database, key);
    if (!connection) {
      res.setHeader("www-authenticate", "Bearer");
      return res.status(401).json({ ok: false, error: "invalid_api_key", message: "That key is not valid or its connection is turned off." });
    }

    const body = parseBody(req.body);
    if (body === undefined) return res.status(400).json({ ok: false, error: "invalid_json" });
    const parsed = normalizeOpenApiEvents(body);
    if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

    const saved = parsed.events.length ? await recordEvents(database, connection, parsed.events) : { inserted: 0, duplicates: 0 };
    const status = parsed.events.length === 0 ? 400 : 200;
    return res.status(status).json({
      ok: status === 200,
      inserted: saved.inserted,
      duplicates: saved.duplicates,
      rejected: parsed.errors.length,
      errors: parsed.errors
    });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
