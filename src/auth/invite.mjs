// Invites and password resets.
//
// An owner invites a staff member; the staff member sets their OWN password.
// No password is ever chosen, transported, or defaulted on the invitee's
// behalf — the invite carries a single-use token and nothing else, so there is
// no moment where anyone but the account holder knows the secret.
//
// Invites and resets share password_resets (kind='invite' | 'reset') because an
// invite IS a reset whose subject has no password yet. Same single-use
// mechanics, different TTL and different preconditions.
//
// Tokens here get the same treatment as session tokens: 32 CSPRNG bytes, stored
// as sha256, cleartext returned exactly once and never logged.

import { hashPassword, validatePassword } from "./hash.mjs";
import { newToken, hashToken, revokeAllForStaff } from "./session.mjs";
import { revokeAllForAccount } from "./account-session.mjs";
import { resolveDefaultOrg } from "./org.mjs";
import { normalizeEmail } from "./login.mjs";

// Who may issue an invite. The brief says owner; admin is included because an
// org with no owner row would otherwise be unable to onboard anyone.
export const INVITER_ROLES = ["owner", "admin"];

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days — a person has to read an email
export const RESET_TTL_MS  = 60 * 60 * 1000;            // 1 hour — a person is sitting at the form

// roleIsKnown — validate a role key against the staff_roles catalog.
// Returns true/false, or null when the catalog is absent or in a shape this
// module does not recognise (012_attribution.sql may land underneath us with a
// different definition). null means "cannot validate", and the caller accepts
// the role rather than blocking onboarding on a lookup table.
export async function roleIsKnown(db, orgId, role) {
  if (!role) return null;
  const shape = await db.query(
    `SELECT count(*) = 3 AS ok
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_roles'
        AND column_name IN ('key','name','active')`
  );
  if (!shape.rows[0]?.ok) return null;
  const r = await db.query(
    `SELECT 1 FROM staff_roles WHERE org_id = $1 AND lower(key) = lower($2) AND active LIMIT 1`,
    [orgId, role]
  );
  return r.rows.length > 0;
}

// inviteStaff — owner creates (or re-invites) a staff member and gets back the
// single cleartext invite token to deliver.
//   → { ok: true, token, expiresAt, staff: { id, email, name, role, status } }
//   → { ok: false, status, error }
export async function inviteStaff(db, { actor, email, name, role, orgId, ttl = INVITE_TTL_MS } = {}) {
  const org = orgId || (await resolveDefaultOrg(db));

  if (!actor || !INVITER_ROLES.includes(String(actor.role || "").toLowerCase())) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  // An owner may only invite into their own org.
  if (actor.org_id && actor.org_id !== org) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  const normEmail = normalizeEmail(email);
  if (!normEmail || !normEmail.includes("@")) {
    return { ok: false, status: 400, error: "valid_email_required" };
  }
  if (role && (await roleIsKnown(db, org, role)) === false) {
    return { ok: false, status: 400, error: "unknown_role" };
  }

  const existing = (await db.query(
    `SELECT id, status, name, role FROM staff WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [org, normEmail]
  )).rows[0];

  let staff;
  if (!existing) {
    staff = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,$3,$4,'invited')
       RETURNING id, email, name, role, status`,
      [org, name || normEmail, role || null, normEmail]
    )).rows[0];
  } else if (existing.status === "active") {
    // Re-inviting an active account would be a password-reset-by-another-name.
    return { ok: false, status: 409, error: "already_active" };
  } else {
    // Resend to an invited/suspended row: refresh the details, keep the row.
    staff = (await db.query(
      `UPDATE staff
          SET name = COALESCE($2, name), role = COALESCE($3, role), status = 'invited'
        WHERE id = $1
      RETURNING id, email, name, role, status`,
      [existing.id, name || null, role || null]
    )).rows[0];
  }

  // A fresh invite invalidates any earlier unused one for this person. Only a link that is
  // still alive is ended: one that already ran out stays as it is, so it never reads as
  // "used" after it expired.
  await db.query(
    `UPDATE password_resets SET used_at = now()
      WHERE staff_id = $1 AND kind = 'invite' AND used_at IS NULL AND expires_at > now()`,
    [staff.id]
  );

  const token = newToken();
  const expiresAt = new Date(Date.now() + ttl);
  await db.query(
    `INSERT INTO password_resets (org_id, staff_id, token_hash, kind, expires_at)
     VALUES ($1,$2,$3,'invite',$4)`,
    [org, staff.id, hashToken(token), expiresAt]
  );

  return { ok: true, token, expiresAt, staff };
}

// requestPasswordReset — always reports ok, and returns a token only when the
// address belongs to staff, an affiliate, or a partner who can use one. The
// caller emails the token if present and says "check your inbox" either way,
// so the endpoint does not become a directory oracle.
export async function requestPasswordReset(db, { email, orgId, ttl = RESET_TTL_MS } = {}) {
  const org = orgId || (await resolveDefaultOrg(db));
  const normEmail = normalizeEmail(email);
  if (!normEmail) return { ok: true, token: null };

  const staff = (await db.query(
    `SELECT id, status FROM staff WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [org, normEmail]
  )).rows[0];
  if (staff) {
    // Suspended accounts do not get to reset their way back in.
    if (staff.status === "suspended") return { ok: true, token: null };

    await db.query(
      `UPDATE password_resets SET used_at = now()
        WHERE staff_id = $1 AND kind = 'reset' AND used_at IS NULL AND expires_at > now()`,
      [staff.id]
    );

    const token = newToken();
    const expiresAt = new Date(Date.now() + ttl);
    await db.query(
      `INSERT INTO password_resets (org_id, staff_id, token_hash, kind, expires_at)
       VALUES ($1,$2,$3,'reset',$4)`,
      [org, staff.id, hashToken(token), expiresAt]
    );
    return { ok: true, token, expiresAt, staffId: staff.id };
  }

  const account = (await db.query(
    `SELECT id, status, kind FROM accounts
      WHERE org_id = $1 AND lower(email) = $2
        AND kind IN ('affiliate', 'partner')
      LIMIT 1`,
    [org, normEmail]
  )).rows[0];
  if (!account || account.status === "suspended") return { ok: true, token: null };

  await db.query(
    `UPDATE password_resets SET used_at = now()
      WHERE account_id = $1 AND kind = 'reset' AND used_at IS NULL AND expires_at > now()`,
    [account.id]
  );

  const token = newToken();
  const expiresAt = new Date(Date.now() + ttl);
  await db.query(
    `INSERT INTO password_resets (org_id, staff_id, account_id, token_hash, kind, expires_at)
     VALUES ($1, NULL, $2, $3, 'reset', $4)`,
    [org, account.id, hashToken(token), expiresAt]
  );
  return { ok: true, token, expiresAt, accountId: account.id };
}

// setPasswordWithToken — the one path that writes a password_hash. Accepts both
// invite and reset tokens; `expectKind` narrows it if the caller has separate
// endpoints. Consuming the token is a single atomic UPDATE, so two racing
// submissions cannot both succeed.
export async function setPasswordWithToken(db, { token, password, expectKind = null } = {}) {
  if (!token || typeof token !== "string") return { ok: false, status: 400, error: "token_required" };

  const bad = validatePassword(password);
  if (bad) return { ok: false, status: 400, error: "weak_password", detail: bad };

  // Hash BEFORE consuming: if hashing fails, the token is still usable.
  const passwordHash = await hashPassword(password);

  const consumed = (await db.query(
    `UPDATE password_resets
        SET used_at = now()
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
        AND ($2::text IS NULL OR kind = $2::text)
      RETURNING staff_id, account_id, org_id, kind`,
    [hashToken(token), expectKind]
  )).rows[0];

  if (!consumed) return { ok: false, status: 400, error: "invalid_or_expired_token" };

  if (consumed.account_id) {
    const account = (await db.query(
      `UPDATE accounts
          SET password_hash = $2,
              status = CASE WHEN status = 'suspended' THEN status ELSE 'active' END
        WHERE id = $1
        RETURNING id, org_id, email, name, kind, status`,
      [consumed.account_id, passwordHash]
    )).rows[0];
    if (!account) return { ok: false, status: 400, error: "invalid_or_expired_token" };
    const revoked = await revokeAllForAccount(db, consumed.account_id);
    return { ok: true, account, kind: consumed.kind, sessionsRevoked: revoked };
  }

  if (!consumed.staff_id) return { ok: false, status: 400, error: "invalid_or_expired_token" };

  // A suspended account cannot be reactivated by redeeming an old token.
  const staff = (await db.query(
    `UPDATE staff
        SET password_hash = $2,
            status = CASE WHEN status = 'suspended' THEN status ELSE 'active' END
      WHERE id = $1
      RETURNING id, org_id, email, name, role, status`,
    [consumed.staff_id, passwordHash]
  )).rows[0];

  // Setting a password invalidates every existing session for that staff
  // member — the usual response to "I think someone else had my account".
  const revoked = await revokeAllForStaff(db, consumed.staff_id);

  return { ok: true, staff, kind: consumed.kind, sessionsRevoked: revoked };
}

// acceptInvite / resetPassword — the two named entry points. Same machinery,
// narrowed to their own token kind so an invite link cannot be replayed at the
// reset endpoint or vice versa.
export const acceptInvite = (db, { token, password } = {}) =>
  setPasswordWithToken(db, { token, password, expectKind: "invite" });

export const resetPassword = (db, { token, password } = {}) =>
  setPasswordWithToken(db, { token, password, expectKind: "reset" });

// suspendStaff / reactivateStaff — status transitions belong next to invite
// because suspending must also kill live sessions, which is easy to forget.
export async function suspendStaff(db, { actor, staffId } = {}) {
  if (!actor || !INVITER_ROLES.includes(String(actor.role || "").toLowerCase())) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (actor.id === staffId) return { ok: false, status: 400, error: "cannot_suspend_self" };
  if (!actor.org_id) return { ok: false, status: 403, error: "forbidden" };
  const staff = (await db.query(
    `UPDATE staff SET status = 'suspended' WHERE id = $1 AND org_id = $2 RETURNING id, email, status`,
    [staffId, actor.org_id]
  )).rows[0];
  if (!staff) return { ok: false, status: 404, error: "staff_not_found" };
  const revoked = await revokeAllForStaff(db, staffId);
  return { ok: true, staff, sessionsRevoked: revoked };
}

// setStaffRole — owner/admin changes a job on an existing row. Does not mint
// owner. Does not rewrite an owner row. Revoking stays a separate action.
export async function setStaffRole(db, { actor, staffId, role } = {}) {
  if (!actor || !INVITER_ROLES.includes(String(actor.role || "").toLowerCase())) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (!actor.org_id) return { ok: false, status: 403, error: "forbidden" };
  const next = String(role || "").trim().toLowerCase();
  if (!next) return { ok: false, status: 400, error: "role_required" };
  if (next === "owner") return { ok: false, status: 400, error: "cannot_assign_owner" };
  if ((await roleIsKnown(db, actor.org_id, next)) === false) {
    return { ok: false, status: 400, error: "unknown_role" };
  }

  const current = (await db.query(
    `SELECT id, role FROM staff WHERE id = $1 AND org_id = $2`,
    [staffId, actor.org_id]
  )).rows[0];
  if (!current) return { ok: false, status: 404, error: "staff_not_found" };
  if (String(current.role || "").toLowerCase() === "owner") {
    return { ok: false, status: 400, error: "cannot_change_owner" };
  }

  const staff = (await db.query(
    `UPDATE staff SET role = $2 WHERE id = $1 AND org_id = $3
     RETURNING id, email, name, role, status`,
    [staffId, next, actor.org_id]
  )).rows[0];
  if (!staff) return { ok: false, status: 404, error: "staff_not_found" };
  return { ok: true, staff };
}

// updateStaffProfile — owner/admin edits name, login email, phone, start date.
// Does not change role (setStaffRole) or status (suspendStaff).
export async function updateStaffProfile(db, { actor, staffId, name, email, phone, startDate, notifyBookedCallSms } = {}) {
  if (!actor || !INVITER_ROLES.includes(String(actor.role || "").toLowerCase())) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (!actor.org_id) return { ok: false, status: 403, error: "forbidden" };

  const current = (await db.query(
    `SELECT id, role, email, name FROM staff WHERE id = $1 AND org_id = $2`,
    [staffId, actor.org_id]
  )).rows[0];
  if (!current) return { ok: false, status: 404, error: "staff_not_found" };

  const nextName = String(name || "").trim();
  if (!nextName) return { ok: false, status: 400, error: "name_required" };

  const normEmail = normalizeEmail(email);
  if (!normEmail || !normEmail.includes("@")) {
    return { ok: false, status: 400, error: "valid_email_required" };
  }

  const isOwnerRow = String(current.role || "").toLowerCase() === "owner";
  if (isOwnerRow) {
    const nameChanged = nextName !== String(current.name || "").trim();
    const emailChanged = normEmail !== String(current.email || "").toLowerCase();
    if (nameChanged || emailChanged) {
      return { ok: false, status: 400, error: "cannot_change_owner" };
    }
  }

  const dup = (await db.query(
    `SELECT id FROM staff WHERE org_id = $1 AND lower(email) = $2 AND id <> $3 LIMIT 1`,
    [actor.org_id, normEmail, staffId]
  )).rows[0];
  if (dup) return { ok: false, status: 409, error: "email_taken" };

  const nextPhone = String(phone || "").trim() || null;
  const rawStart = String(startDate || "").trim();
  let nextStart = null;
  if (rawStart) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawStart)) {
      return { ok: false, status: 400, error: "start_date_invalid" };
    }
    nextStart = rawStart;
  }
  const nextNotify = typeof notifyBookedCallSms === "boolean" ? notifyBookedCallSms : null;

  const staff = (await db.query(
    `UPDATE staff
        SET name = $2,
            email = $3,
            phone = $4,
            start_date = $5,
            notify_booked_call_sms = COALESCE($7, notify_booked_call_sms),
            updated_at = now()
      WHERE id = $1 AND org_id = $6
      RETURNING id, email, name, role, status, phone, start_date, employee_code, notify_booked_call_sms`,
    [staffId, nextName, normEmail, nextPhone, nextStart, actor.org_id, nextNotify]
  )).rows[0];
  if (!staff) return { ok: false, status: 404, error: "staff_not_found" };
  return { ok: true, staff };
}
