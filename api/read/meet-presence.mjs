// GET /api/read/meet-presence?client_id=<uuid>. DB scope is checked before Google.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { readGoogleMeetPresence } from "../../src/messaging/providers/google-meet-read.mjs";

const PRIVILEGED = new Set(["owner", "admin", "sales_manager"]);
const MEET_READ_ROLES = new Set(["owner", "admin", "sales_manager", "closer"]);
const cache = new Map();
const TTL = 12_000;

export const MEET_CALL_SCOPE_SQL = `SELECT b.id AS booking_id, b.starts_at,
    COALESCE(NULLIF(b.meeting_url, ''), t.meeting_url) AS meeting_url
  FROM clients c
  JOIN LATERAL (SELECT * FROM bookings
    WHERE org_id = c.org_id AND client_id = c.id
    ORDER BY created_at DESC, updated_at DESC LIMIT 1) b ON true
  JOIN tasks t ON t.org_id = c.org_id AND t.client_id = c.id
    AND t.assignee_role = 'closer' AND t.done IS NOT TRUE
    AND t.due_at = b.starts_at
  WHERE c.id = $1 AND c.org_id = $2
    AND c.custom_fields->>'crm_archived_at' IS NULL
    AND b.status IN ('booked', 'rescheduled')
    AND ($3::boolean OR t.assignee_staff_id = $4)
  ORDER BY t.created_at DESC LIMIT 1`;

export default async function handler(req, res, deps = {}) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const database = deps.db ?? db;
  const staff = deps.staff ?? await requireAuth(req, res, { db: database });
  if (!staff) return;
  const primary = String(staff.role || "").trim().toLowerCase();
  const privileged = PRIVILEGED.has(primary);
  if (!requireRole(res, staff, MEET_READ_ROLES)) return;
  const effectiveCloser = primary === "closer" || (Array.isArray(staff.roles)
    && staff.roles.some(role => String(role || "").trim().toLowerCase() === "closer"));
  if (!privileged && !effectiveCloser) return res.status(403).json({ ok: false, error: "forbidden" });
  if (!isUuid(staff.id) || !isUuid(staff.org_id)) return res.status(403).json({ ok: false, error: "forbidden" });
  const query = req.query || {};
  if (!isUuid(query.client_id) || Object.keys(query).some(key => key !== "client_id")) {
    return res.status(400).json({ ok: false, error: "client_id_required_only" });
  }
  try {
    const result = await database.query(MEET_CALL_SCOPE_SQL, [query.client_id, staff.org_id, privileged, staff.id]);
    const call = result.rows[0];
    if (!call) return res.status(403).json({ ok: false, error: "booked_call_not_accessible" });
    const clock = deps.clock ?? Date.now;
    const at = clock();
    const now = new Date(at);
    const store = deps.cache ?? cache;
    const key = JSON.stringify([staff.org_id, staff.id, query.client_id, call.booking_id, call.starts_at, call.meeting_url, privileged]);
    let saved = store.get(key);
    if (!saved || saved.expires <= at) {
      if (store.size >= 128) store.delete(store.keys().next().value);
      const read = deps.readPresence ?? readGoogleMeetPresence;
      saved = { expires: at + TTL, promise: Promise.resolve().then(() => read({
        meetingUrl: call.meeting_url, callStartsAt: call.starts_at, env: deps.env ?? process.env, now
      })) };
      store.set(key, saved);
    }
    const presence = await saved.promise;
    return res.status(200).json({ ok: true, source: "google_meet", bookingId: call.booking_id, ...presence });
  } catch (error) {
    if (dbDown(res, error)) return;
    return res.status(500).json({ ok: false, error: "meet_presence_read_failed" });
  }
}
