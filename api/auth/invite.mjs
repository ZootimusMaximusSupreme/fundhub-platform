// POST /api/auth/invite — owner/admin creates a staff login.
//
// { name, role, notify_email? } → { ok, email, token, expiresAt, invitePath, mailed, staff }
//
// The app makes name@fundhub.ai. That is a login, not a mailbox.
// The token comes back so the owner can copy the set-password link.
// If notify_email looks like a real inbox, Resend sends the same link there.

import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { inviteStaff } from "../../src/auth/invite.mjs";
import { suggestCompanyEmail, staffRoleKey } from "../../src/auth/company-email.mjs";
import {
  credentialLink, inviteMailCopy, looksLikeEmail, sendStaffCredentialEmail
} from "../../src/auth/staff-mail.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireRole("owner", "admin")(req, res);
  if (!staff) return;

  const body = req.body || {};
  const name = String(body.name || "").trim();
  const role = staffRoleKey(body.role);
  if (!name) return res.status(400).json({ ok: false, error: "name_required" });
  if (!role) return res.status(400).json({ ok: false, error: "unknown_role" });
  if (role === "owner") return res.status(400).json({ ok: false, error: "cannot_invite_owner" });

  const taken = (await db.query(
    `SELECT lower(email) AS email FROM staff WHERE org_id = $1`,
    [staff.org_id]
  )).rows.map((r) => r.email);

  const email = suggestCompanyEmail(name, taken);
  const result = await inviteStaff(db, {
    actor: staff,
    email,
    name,
    role,
    orgId: staff.org_id
  });
  if (!result.ok) {
    return res.status(result.status || 400).json({ ok: false, error: result.error });
  }

  const invitePath = "/reset-password.html?token=" + encodeURIComponent(result.token);
  const notify = String(body.notify_email || body.email || "").trim().toLowerCase();
  let mailed = false;
  if (looksLikeEmail(notify)) {
    const copy = inviteMailCopy({ loginEmail: email, link: credentialLink(invitePath), expiresAt: result.expiresAt });
    const sent = await sendStaffCredentialEmail({ to: notify, ...copy });
    mailed = sent.mailed;
  }

  return res.status(200).json({
    ok: true,
    email,
    token: result.token,
    expiresAt: result.expiresAt,
    invitePath,
    mailed,
    staff: result.staff
  });
}
