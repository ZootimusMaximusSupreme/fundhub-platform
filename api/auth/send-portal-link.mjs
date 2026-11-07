// POST /api/auth/send-portal-link — an owner or admin mails a client the link
// that gets them into their portal.
//
// { client_id } → { ok, sent, url, expiresAt }
//
// WHY THIS EXISTS. The self-serve reset screen tells a client "Nothing was sent.
// Ask an owner or admin for a reset link" — and there was no control anywhere in
// the CRM that could send one. Walk finding F31, 2026-09-03: every client who
// bought was given an active portal account with a password hash nobody holds,
// and no way to be handed a credential for it.
//
// SEPARATE FILE, WHOLE-ROUTE GATE — the same reasoning as api/auth/admin-reset.mjs
// next door. requireRole is called unconditionally at the top so the gate is one
// statically traceable fact about this file; scripts/journeys/extract.mjs reads
// that literally, and a gate hidden inside a branch is the shape it cannot trace
// (CLAUDE.md §4).
//
// THE LINK COMES BACK IN THE RESPONSE, and that matches admin-reset exactly: the
// caller is an authenticated owner or admin, the email is queued but the
// dispatcher is a separate scheduled act (CLAUDE.md §12), and the whole point of
// this control is that a person on the phone can read the link out now. It is a
// bearer credential. It works once, and it stays good for 12 months like every
// other portal sign-in link (owner-set 2026-11-07: 12 months, one use).
//
// NOTHING HERE TRANSMITS. issuePortalLinkForClient() calls sendTemplated(), which
// writes a `messages` row with status='queued' and stops.

import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { issuePortalLinkForClient } from "../../src/auth/magic-link.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireRole("owner", "admin")(req, res);
  if (!staff) return; // requireRole already wrote the 401/403

  const clientId = String((req.body || {}).client_id || "").trim();
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
  }
  // Another company's client answers 404, not 403 — see src/http/client-scope.mjs.
  if (!(await requireClientInOrg(res, db, staff, clientId))) return;

  const out = await issuePortalLinkForClient(db, {
    orgId: staff.org_id,
    clientId,
    ip: null,
    userAgent: null
  });

  if (!out.ok) {
    // The one refusal worth naming: a client with no email address on file
    // cannot be mailed anything, and the fix is to add the address.
    return res.status(409).json({
      ok: false,
      error: out.reason === "no_email_on_file"
        ? "This client has no email address on file, so there is nowhere to send a link."
        : "No sign-in link could be made for this client.",
      code: out.reason || "not_issued"
    });
  }

  if (out.limited) {
    return res.status(429).json({
      ok: false,
      error: "A link was already sent to this client a moment ago. Wait a few minutes and try again.",
      code: "rate_limited",
      retryAfterMinutes: out.retryAfterMinutes
    });
  }

  if (!out.url) {
    return res.status(409).json({
      ok: false,
      error: "This client's portal account cannot be signed into with a link.",
      code: out.outcome || "not_issued"
    });
  }

  return res.status(200).json({
    ok: true,
    sent: out.sent === true,
    url: out.url,
    expiresAt: out.expiresAt
  });
}
