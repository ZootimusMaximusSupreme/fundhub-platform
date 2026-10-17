// /api/bookings — the calendar's read of what is actually booked.
//
//   GET /api/bookings                                   → { ok, bookings }
//   GET /api/bookings?from=…&to=…                       → bounded by start time
//   GET /api/bookings?client_id=…                       → one client's bookings
//   GET /api/bookings?status=booked                     → one status
//   GET /api/bookings?limit=50                          → page size (max 500)
//
// Bookings are created by providers, never by a browser. A client POST can
// confirm only their own next upcoming booking; it cannot create or move one.
//
// *** WHICH COMPANY'S BOOKINGS COME BACK IS NOT A REQUEST PARAMETER. ***
// org_id is read off the session principal. There is no ?org_id=, and one
// passed anyway is ignored, because a booking row carries an attendee's name
// and email — a caller-chosen org here is a lead list handed to a competitor.
// The same goes for who is asking: this file never reads a staff id from the
// query.
//
// AUTH IS requirePrincipal, NOT requireAuth, and that is not a style choice.
// requireAuth FORWARDS ITS OPTIONS TO authenticate(), WHICH READS ONLY `db` AND
// `env` — a `roles` key passed to it is silently ignored, so `requireAuth(req,
// res, { roles: ["staff"] })` reads as a role gate and is not one.
// src/http/auth-gate.test.mjs fails on that shape. requirePrincipal takes the
// accepted kinds as a positional argument it cannot ignore, which is what
// api/shifts.mjs uses and what this copies.
//
// NO SQL IN THIS FILE. Every query lives in src/bookings/store.mjs, matching
// api/shifts.mjs → src/shifts/store.mjs. This is the HTTP shell: auth, method,
// parameter shape, status codes.
import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { CLIENT_DATA_ERRORS, isUuid } from "../src/http/read-api.mjs";
import { listBookings, BookingError } from "../src/bookings/store.mjs";

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  if (req.method === "POST" && principal.kind === "client") {
    const orgId = principal.orgId;
    const clientId = principal.clientId;
    const bookingId = req.body?.booking_id;
    if (!orgId || !clientId) return res.status(403).json({ ok: false, error: "forbidden" });
    if (!isUuid(bookingId)) return res.status(400).json({ ok: false, error: "invalid_booking_id" });
    const confirmed = await db.query(
      `UPDATE clients c
          SET custom_fields = COALESCE(c.custom_fields, '{}'::jsonb)
            || jsonb_build_object('call_confirmed', true, 'last_progress_timestamp', now())
        WHERE c.id = $2 AND c.org_id = $1
          AND $3::uuid = (
            SELECT b.id FROM bookings b
             WHERE b.org_id = $1 AND b.client_id = $2
               AND b.starts_at > now() AND b.status IN ('booked', 'rescheduled')
             ORDER BY b.starts_at ASC LIMIT 1
          )
        RETURNING c.id`,
      [orgId, clientId, bookingId]
    );
    if (!confirmed.rows[0]) return res.status(409).json({ ok: false, error: "call_changed", message: "Your call changed. Reload this page to check it." });
    return res.status(200).json({ ok: true, confirmed: true });
  }

  if (req.method === "GET" && principal.kind === "client") {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  if (req.method !== "GET") {
    res.setHeader("allow", principal.kind === "client" ? "POST" : "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const orgId = principal.orgId;
  // A staff session with no company cannot be scoped, so it is refused rather
  // than served an unscoped query. Fail closed.
  if (!orgId) return res.status(403).json({ ok: false, error: "no_org" });

  const q = req.query || {};

  try {
    const bookings = await listBookings(db, {
      orgId,
      from: q.from || null,
      to: q.to || null,
      clientId: q.client_id || null,
      status: q.status || null,
      limit: q.limit
    });
    return res.status(200).json({ ok: true, bookings });
  } catch (e) {
    // An unreadable ?from= is the caller's mistake, not a server fault.
    if (e instanceof BookingError) return res.status(e.status).json({ ok: false, error: e.message });
    if (CLIENT_DATA_ERRORS.has(e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    throw e;
  }
}
