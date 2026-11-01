import { test } from "node:test";
import assert from "node:assert";
import {
  inviteStaff, acceptInvite, resetPassword, requestPasswordReset,
  setPasswordWithToken, suspendStaff, removeStaff, setStaffRole, updateStaffProfile, roleIsKnown, INVITER_ROLES
} from "./invite.mjs";
import { hashToken } from "./session.mjs";
import { verifyPassword } from "./hash.mjs";
import { _resetOrgCache } from "./org.mjs";

const OWNER = { id: "owner-1", org_id: "org-1", role: "owner" };
const PASSWORD = "a perfectly fine passphrase";

function fakeDb({ existingStaff = null, existingAccount = null, catalogShape = true, roleKnown = true, consumed = undefined, openTasks = 0 } = {}) {
  const calls = [];
  return {
    calls,
    stmts: () => calls.map((c) => c.sql),
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/SELECT count\(\*\)::int AS n FROM tasks/.test(sql)) return { rows: [{ n: openTasks }] };
      if (/information_schema\.columns/.test(sql)) return { rows: [{ ok: catalogShape }] };
      if (/FROM staff_roles/.test(sql)) return { rows: roleKnown ? [{ "?column?": 1 }] : [] };
      if (/SELECT id, role, email, name FROM staff/.test(sql) || /SELECT id, role(?:, email)? FROM staff/.test(sql)) {
        return { rows: existingStaff ? [{
          id: existingStaff.id,
          role: existingStaff.role || "closer",
          email: existingStaff.email || "a@b.c",
          name: existingStaff.name || "Current Owner"
        }] : [] };
      }
      if (/SELECT id, status, name, role FROM staff/.test(sql)) return { rows: existingStaff ? [existingStaff] : [] };
      if (/SELECT id, status FROM staff/.test(sql)) return { rows: existingStaff ? [existingStaff] : [] };
      if (/SELECT id, status, kind FROM accounts/.test(sql)) {
        return { rows: existingAccount ? [existingAccount] : [] };
      }
      if (/UPDATE accounts\s+SET password_hash/.test(sql)) {
        return { rows: existingAccount ? [{
          id: existingAccount.id,
          org_id: "org-1",
          email: existingAccount.email || "e2e+aff-x@fundhub.ai",
          name: "A",
          kind: existingAccount.kind || "affiliate",
          status: "active"
        }] : [] };
      }
      if (/UPDATE account_sessions SET revoked_at/.test(sql)) {
        return { rows: [{ id: "sess-1" }] };
      }
      if (/UPDATE staff SET role =/.test(sql)) {
        if (!existingStaff) return { rows: [] };
        return { rows: [{ id: existingStaff.id, email: "a@b.c", name: "A", role: params[1], status: "invited" }] };
      }
      if (/UPDATE staff\s+SET name =/.test(sql)) {
        if (!existingStaff) return { rows: [] };
        return { rows: [{
          id: existingStaff.id,
          email: params[2],
          name: params[1],
          role: existingStaff.role || "closer",
          status: "active",
          phone: params[3],
          start_date: params[4],
          employee_code: "EMP-000099",
          notify_booked_call_sms: params[6] === true
        }] };
      }
      if (/SELECT id FROM staff WHERE org_id = \$1 AND lower\(email\)/.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO staff /.test(sql)) {
        return { rows: [{ id: "staff-new", email: params[3], name: params[1], role: params[2], status: "invited" }] };
      }
      if (/UPDATE staff\s+SET name/.test(sql)) {
        return { rows: [{ id: existingStaff?.id, email: "x@y.z", name: params[1], role: params[2], status: "invited" }] };
      }
      if (/UPDATE password_resets\s+SET used_at = now\(\)\s+WHERE token_hash/.test(sql)) {
        return { rows: consumed === undefined ? [{ staff_id: "staff-1", org_id: "org-1", kind: params[1] || "invite" }] : (consumed ? [consumed] : []) };
      }
      if (/UPDATE staff\s+SET password_hash/.test(sql)) {
        return { rows: [{ id: "staff-1", org_id: "org-1", email: "a@b.c", name: "A", role: "closer", status: "active" }] };
      }
      if (/UPDATE staff SET status = 'suspended'/.test(sql)) {
        if (sql.includes("removed_at") && existingStaff?.role === "owner") return { rows: [] };
        return { rows: existingStaff === null ? [] : [{ id: params[0], email: "a@b.c", status: "suspended" }] };
      }
      return { rows: [] };
    }
  };
}

// ---------------------------------------------------------------- invites

test("only owner/admin may invite", async () => {
  _resetOrgCache();
  assert.deepEqual(INVITER_ROLES, ["owner", "admin"]);
  for (const role of ["closer", "funding_advisor", "setter", "", null, undefined]) {
    const out = await inviteStaff(fakeDb(), { actor: { id: "s", org_id: "org-1", role }, email: "new@fundhub.test" });
    assert.equal(out.status, 403, `role ${String(role)} must not invite`);
  }
  const noActor = await inviteStaff(fakeDb(), { email: "new@fundhub.test" });
  assert.equal(noActor.status, 403);
  for (const role of ["owner", "admin", "OWNER", " Admin "]) {
    const out = await inviteStaff(fakeDb(), { actor: { id: "s", org_id: "org-1", role: role.trim() }, email: "new@fundhub.test" });
    assert.equal(out.ok, true, `role ${role} should invite`);
  }
});

test("an owner cannot invite into another org", async () => {
  _resetOrgCache();
  const out = await inviteStaff(fakeDb(), {
    actor: { id: "o", org_id: "org-OTHER", role: "owner" }, email: "new@fundhub.test"
  });
  assert.equal(out.status, 403);
});

test("invite creates an invited staff row with NO password and returns one token", async () => {
  _resetOrgCache();
  const db = fakeDb();
  const out = await inviteStaff(db, { actor: OWNER, email: " New.Hire@FundHub.TEST ", name: "New Hire", role: "closer" });

  assert.equal(out.ok, true);
  assert.match(out.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(out.staff.status, "invited");

  const insertStaff = db.calls.find((c) => /INSERT INTO staff /.test(c.sql));
  assert.equal(insertStaff.params[3], "new.hire@fundhub.test", "email normalised");
  assert.match(insertStaff.sql, /VALUES \(\$1,\$2,\$3,\$4,'invited'\)/);
  assert.ok(!/password_hash/.test(insertStaff.sql), "an invite never sets a password");

  const insertToken = db.calls.find((c) => /INSERT INTO password_resets/.test(c.sql));
  assert.equal(insertToken.params[2], hashToken(out.token), "stores the hash");
  assert.equal(insertToken.params[0], "org-1");
  assert.ok(!JSON.stringify(insertToken.params).includes(out.token), "cleartext token never bound");
});

test("invite rejects a bad email and an unknown role", async () => {
  _resetOrgCache();
  for (const email of ["", "   ", "no-at-sign", null]) {
    const out = await inviteStaff(fakeDb(), { actor: OWNER, email });
    assert.equal(out.status, 400, `email ${String(email)}`);
  }
  const unknown = await inviteStaff(fakeDb({ roleKnown: false }), { actor: OWNER, email: "a@b.co", role: "wizard" });
  assert.equal(unknown.error, "unknown_role");
});

test("role validation is skipped when the catalog is absent or foreign-shaped", async () => {
  _resetOrgCache();
  const out = await inviteStaff(fakeDb({ catalogShape: false, roleKnown: false }), {
    actor: OWNER, email: "a@b.co", role: "anything"
  });
  assert.equal(out.ok, true, "a differently-shaped staff_roles must not block onboarding");
  assert.equal(await roleIsKnown(fakeDb({ catalogShape: false }), "org-1", "closer"), null);
  assert.equal(await roleIsKnown(fakeDb({ roleKnown: true }), "org-1", "closer"), true);
  assert.equal(await roleIsKnown(fakeDb({ roleKnown: false }), "org-1", "nope"), false);
  assert.equal(await roleIsKnown(fakeDb(), "org-1", null), null);
});

test("re-inviting an ACTIVE account is refused — that would be a covert reset", async () => {
  _resetOrgCache();
  const out = await inviteStaff(fakeDb({ existingStaff: { id: "staff-9", status: "active" } }), {
    actor: OWNER, email: "dana@fundhub.test"
  });
  assert.equal(out.status, 409);
  assert.equal(out.error, "already_active");
});

test("re-inviting an invited account reuses the row and kills the older token", async () => {
  _resetOrgCache();
  const db = fakeDb({ existingStaff: { id: "staff-9", status: "invited", name: "Old", role: "closer" } });
  const out = await inviteStaff(db, { actor: OWNER, email: "dana@fundhub.test", name: "New" });
  assert.equal(out.ok, true);
  assert.ok(!db.stmts().some((s) => /INSERT INTO staff /.test(s)), "no duplicate staff row");
  const invalidate = db.calls.find((c) => /UPDATE password_resets SET used_at/.test(c.sql) && /kind = 'invite'/.test(c.sql));
  assert.ok(invalidate, "previous unused invites are burned");
});

// ------------------------------------------------------- accept / reset

test("acceptInvite sets a hashed password and only accepts invite tokens", async () => {
  const db = fakeDb({ consumed: { staff_id: "staff-1", org_id: "org-1", kind: "invite" } });
  const out = await acceptInvite(db, { token: "t".repeat(43), password: PASSWORD });
  assert.equal(out.ok, true);

  const consume = db.calls.find((c) => /UPDATE password_resets/.test(c.sql) && /token_hash = \$1/.test(c.sql));
  assert.equal(consume.params[1], "invite", "an invite endpoint will not redeem a reset token");
  assert.match(consume.sql, /used_at IS NULL/, "single use");
  assert.match(consume.sql, /expires_at > now\(\)/, "expiring");

  const update = db.calls.find((c) => /UPDATE staff\s+SET password_hash/.test(c.sql));
  const stored = update.params[1];
  assert.match(stored, /^\$scrypt\$/);
  assert.notEqual(stored, PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, stored), true, "the stored verifier really is this password");
});

test("resetPassword narrows to reset tokens", async () => {
  const db = fakeDb({ consumed: { staff_id: "staff-1", org_id: "org-1", kind: "reset" } });
  await resetPassword(db, { token: "t".repeat(43), password: PASSWORD });
  const consume = db.calls.find((c) => /UPDATE password_resets/.test(c.sql) && /token_hash = \$1/.test(c.sql));
  assert.equal(consume.params[1], "reset");
});

test("setting a password revokes every existing session", async () => {
  const db = fakeDb({ consumed: { staff_id: "staff-1", org_id: "org-1", kind: "reset" } });
  await resetPassword(db, { token: "t".repeat(43), password: PASSWORD });
  assert.ok(db.stmts().some((s) => /UPDATE sessions SET revoked_at/.test(s)));
});

test("a used, expired or wrong-kind token is refused", async () => {
  const db = fakeDb({ consumed: null });
  const out = await setPasswordWithToken(db, { token: "t".repeat(43), password: PASSWORD });
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(out.error, "invalid_or_expired_token");
  assert.ok(!db.stmts().some((s) => /UPDATE staff\s+SET password_hash/.test(s)), "no password written");
});

test("a weak password is refused before the token is consumed", async () => {
  const db = fakeDb();
  const out = await setPasswordWithToken(db, { token: "t".repeat(43), password: "short" });
  assert.equal(out.error, "weak_password");
  assert.match(out.detail, /at least 12/);
  assert.equal(db.calls.length, 0, "a rejected password must not burn the token");
});

test("a missing token is a 400", async () => {
  for (const token of [null, "", undefined, 42]) {
    const out = await setPasswordWithToken(fakeDb(), { token, password: PASSWORD });
    assert.equal(out.error, "token_required");
  }
});

test("redeeming a token cannot reactivate a suspended account", async () => {
  const db = fakeDb({ consumed: { staff_id: "staff-1", org_id: "org-1", kind: "reset" } });
  await resetPassword(db, { token: "t".repeat(43), password: PASSWORD });
  const update = db.calls.find((c) => /UPDATE staff\s+SET password_hash/.test(c.sql));
  assert.match(update.sql, /CASE WHEN status = 'suspended' THEN status ELSE 'active' END/);
});

// ------------------------------------------------------------- resets

test("requestPasswordReset never reveals whether the address exists", async () => {
  _resetOrgCache();
  const missing = await requestPasswordReset(fakeDb({ existingStaff: null }), { email: "ghost@fundhub.test" });
  assert.deepEqual(missing, { ok: true, token: null });

  _resetOrgCache();
  const suspended = await requestPasswordReset(fakeDb({ existingStaff: { id: "s", status: "suspended" } }), { email: "x@y.z" });
  assert.deepEqual(suspended, { ok: true, token: null }, "suspended staff cannot reset their way back in");

  _resetOrgCache();
  const real = await requestPasswordReset(fakeDb({ existingStaff: { id: "s", status: "active" } }), { email: "x@y.z" });
  assert.equal(real.ok, true);
  assert.match(real.token, /^[A-Za-z0-9_-]{43}$/);
});

test("a new reset token burns any earlier unused one", async () => {
  _resetOrgCache();
  const db = fakeDb({ existingStaff: { id: "s", status: "active" } });
  await requestPasswordReset(db, { email: "x@y.z" });
  assert.ok(db.calls.some((c) => /UPDATE password_resets SET used_at/.test(c.sql) && /kind = 'reset'/.test(c.sql)));
});

// A tiny stand-in for the password_resets table, for the "a new link ends the earlier one" UPDATE.
// It reads the WHERE the code wrote, the way Postgres would: if the code stops saying
// `expires_at > now()`, an expired link is stamped "used" too and these tests fail.
function withLinks(inner, links) {
  return {
    calls: inner.calls,
    stmts: inner.stmts,
    async query(sql, params = []) {
      const m = /UPDATE password_resets SET used_at = now\(\)\s+WHERE (staff_id|account_id) = \$1 AND kind = '(\w+)' AND used_at IS NULL/.exec(sql);
      if (!m) return inner.query(sql, params);
      inner.calls.push({ sql, params });
      const onlyAlive = /AND expires_at > now\(\)/.test(sql);
      let n = 0;
      for (const l of links) {
        if (l[m[1]] !== params[0] || l.kind !== m[2] || l.used_at !== null) continue;
        if (onlyAlive && !(l.expires_at > Date.now())) continue;
        l.used_at = Date.now();
        n += 1;
      }
      return { rows: [], rowCount: n };
    }
  };
}

const HOUR = 60 * 60 * 1000;
function link(owner, kind, hoursFromNow) {
  return { ...owner, kind, used_at: null, expires_at: Date.now() + hoursFromNow * HOUR };
}

test("a new invite ends the earlier LIVE invite and leaves an expired one alone", async () => {
  _resetOrgCache();
  const live = link({ staff_id: "staff-9" }, "invite", 24);
  const expired = link({ staff_id: "staff-9" }, "invite", -24);
  const otherPerson = link({ staff_id: "staff-other" }, "invite", 24);
  const otherKind = link({ staff_id: "staff-9" }, "reset", 1);
  const db = withLinks(
    fakeDb({ existingStaff: { id: "staff-9", status: "invited", name: "Old", role: "closer" } }),
    [live, expired, otherPerson, otherKind]
  );
  const out = await inviteStaff(db, { actor: OWNER, email: "dana@fundhub.test" });
  assert.equal(out.ok, true);
  assert.notEqual(live.used_at, null, "the earlier live invite is ended");
  assert.equal(expired.used_at, null, "an expired invite is not stamped as used");
  assert.equal(otherPerson.used_at, null, "another person's invite is untouched");
  assert.equal(otherKind.used_at, null, "a reset link is untouched by an invite");
});

test("a new staff reset ends the earlier LIVE reset and leaves an expired one alone", async () => {
  _resetOrgCache();
  const live = link({ staff_id: "s" }, "reset", 0.5);
  const expired = link({ staff_id: "s" }, "reset", -2);
  const otherPerson = link({ staff_id: "s-other" }, "reset", 0.5);
  const db = withLinks(fakeDb({ existingStaff: { id: "s", status: "active" } }), [live, expired, otherPerson]);
  const out = await requestPasswordReset(db, { email: "x@y.z" });
  assert.equal(out.ok, true);
  assert.notEqual(live.used_at, null, "the earlier live reset link is ended");
  assert.equal(expired.used_at, null, "an expired reset link is not stamped as used");
  assert.equal(otherPerson.used_at, null);
});

test("a new affiliate reset ends the earlier LIVE reset and leaves an expired one alone", async () => {
  _resetOrgCache();
  const live = link({ account_id: "acct-a" }, "reset", 0.5);
  const expired = link({ account_id: "acct-a" }, "reset", -2);
  const otherAccount = link({ account_id: "acct-b" }, "reset", 0.5);
  const db = withLinks(
    fakeDb({ existingAccount: { id: "acct-a", status: "active", kind: "affiliate" } }),
    [live, expired, otherAccount]
  );
  const out = await requestPasswordReset(db, { email: "e2e+aff-click26@fundhub.ai" });
  assert.equal(out.accountId, "acct-a");
  assert.notEqual(live.used_at, null, "the earlier live reset link is ended");
  assert.equal(expired.used_at, null, "an expired reset link is not stamped as used");
  assert.equal(otherAccount.used_at, null);
});

test("every 'end the earlier link' UPDATE only reaches links that have not expired", async () => {
  _resetOrgCache();
  const staffDb = fakeDb({ existingStaff: { id: "s", status: "active" } });
  await requestPasswordReset(staffDb, { email: "x@y.z" });
  _resetOrgCache();
  const acctDb = fakeDb({ existingAccount: { id: "acct-a", status: "active", kind: "affiliate" } });
  await requestPasswordReset(acctDb, { email: "e2e+aff-click26@fundhub.ai" });
  _resetOrgCache();
  const inviteDb = fakeDb({ existingStaff: { id: "staff-9", status: "invited" } });
  await inviteStaff(inviteDb, { actor: OWNER, email: "dana@fundhub.test" });
  for (const db of [staffDb, acctDb, inviteDb]) {
    const ends = db.calls.filter((c) => /UPDATE password_resets SET used_at = now\(\)\s+WHERE (staff_id|account_id) = \$1/.test(c.sql));
    assert.equal(ends.length, 1);
    assert.match(ends[0].sql, /used_at IS NULL AND expires_at > now\(\)/);
  }
});

test("requestPasswordReset mails affiliate and partner accounts, not clients", async () => {
  _resetOrgCache();
  const aff = await requestPasswordReset(
    fakeDb({ existingAccount: { id: "acct-a", status: "active", kind: "affiliate" } }),
    { email: "e2e+aff-click26@fundhub.ai" }
  );
  assert.equal(aff.ok, true);
  assert.match(aff.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(aff.accountId, "acct-a");

  _resetOrgCache();
  const partner = await requestPasswordReset(
    fakeDb({ existingAccount: { id: "acct-p", status: "active", kind: "partner" } }),
    { email: "e2e+wl-click26@fundhub.ai" }
  );
  assert.equal(partner.accountId, "acct-p");

  _resetOrgCache();
  const client = await requestPasswordReset(fakeDb({ existingAccount: null }), { email: "client@x.io" });
  assert.deepEqual(client, { ok: true, token: null });

  _resetOrgCache();
  const suspended = await requestPasswordReset(
    fakeDb({ existingAccount: { id: "acct-s", status: "suspended", kind: "affiliate" } }),
    { email: "e2e+aff-x@fundhub.ai" }
  );
  assert.deepEqual(suspended, { ok: true, token: null });
});

test("an affiliate reset token writes the account password and kills those sessions", async () => {
  const db = fakeDb({
    existingAccount: { id: "acct-a", status: "active", kind: "affiliate" },
    consumed: { staff_id: null, account_id: "acct-a", org_id: "org-1", kind: "reset" }
  });
  const out = await resetPassword(db, { token: "t".repeat(43), password: PASSWORD });
  assert.equal(out.ok, true);
  assert.equal(out.account.id, "acct-a");
  assert.ok(db.stmts().some((s) => /UPDATE accounts\s+SET password_hash/.test(s)));
  assert.ok(db.stmts().some((s) => /UPDATE account_sessions SET revoked_at/.test(s)));
  assert.ok(!db.stmts().some((s) => /UPDATE staff\s+SET password_hash/.test(s)));
});

// ------------------------------------------------------------ suspend

test("suspendStaff requires owner/admin, refuses self, and kills sessions", async () => {
  const denied = await suspendStaff(fakeDb(), { actor: { role: "closer" }, staffId: "x" });
  assert.equal(denied.status, 403);

  const self = await suspendStaff(fakeDb(), { actor: OWNER, staffId: OWNER.id });
  assert.equal(self.status, 400);
  assert.equal(self.error, "cannot_suspend_self");

  const db = fakeDb({ existingStaff: { id: "staff-9" } });
  const out = await suspendStaff(db, { actor: OWNER, staffId: "staff-9" });
  assert.equal(out.ok, true);
  assert.ok(db.stmts().some((s) => /UPDATE sessions SET revoked_at/.test(s)), "live sessions die with the account");

  const missing = await suspendStaff(fakeDb({ existingStaff: null }), { actor: OWNER, staffId: "nope" });
  assert.equal(missing.status, 404);
});

test("removeStaff is owner-only, protects owner rows, and retains linked history", async () => {
  assert.equal((await removeStaff(fakeDb(), { actor: { role: "admin", org_id: "org-1" }, staffId: "staff-9" })).status, 403);
  assert.equal((await removeStaff(fakeDb(), { actor: OWNER, staffId: OWNER.id })).error, "cannot_remove_self");
  assert.equal((await removeStaff(fakeDb({ existingStaff: { role: "owner" } }), { actor: OWNER, staffId: "another-owner" })).status, 404);
  const busy = fakeDb({ existingStaff: { id: "staff-9", role: "closer" }, openTasks: 2 });
  assert.equal((await removeStaff(busy, { actor: OWNER, staffId: "staff-9" })).error, "staff_has_open_tasks");
  assert.ok(!busy.stmts().some((sql) => /UPDATE staff SET status = 'suspended'/.test(sql)));
  const db = fakeDb({ existingStaff: { id: "staff-9", role: "closer" } });
  const out = await removeStaff(db, { actor: OWNER, staffId: "staff-9" });
  assert.equal(out.ok, true);
  const update = db.calls.find((call) => call.sql.includes("removed_at = now()"));
  assert.deepEqual(update.params, ["staff-9", OWNER.org_id]);
  assert.match(update.sql, /role <> 'owner'/);
  assert.ok(!db.stmts().some((sql) => /DELETE FROM staff/.test(sql)));
  assert.ok(db.stmts().some((sql) => /UPDATE shifts SET ended_at = now\(\)/.test(sql)));
  assert.ok(db.stmts().some((sql) => /UPDATE sessions/.test(sql)));
});

test("setStaffRole requires owner/admin, refuses owner rows, and writes the new job", async () => {
  const denied = await setStaffRole(fakeDb(), { actor: { role: "closer" }, staffId: "x", role: "admin" });
  assert.equal(denied.status, 403);

  const mintOwner = await setStaffRole(fakeDb({ existingStaff: { id: "staff-9", role: "closer" } }), {
    actor: OWNER, staffId: "staff-9", role: "owner"
  });
  assert.equal(mintOwner.status, 400);
  assert.equal(mintOwner.error, "cannot_assign_owner");

  const changeOwner = await setStaffRole(fakeDb({ existingStaff: { id: "own", role: "owner" } }), {
    actor: OWNER, staffId: "own", role: "closer"
  });
  assert.equal(changeOwner.status, 400);
  assert.equal(changeOwner.error, "cannot_change_owner");

  const db = fakeDb({ existingStaff: { id: "staff-9", role: "closer" } });
  const out = await setStaffRole(db, { actor: OWNER, staffId: "staff-9", role: "funding_advisor" });
  assert.equal(out.ok, true);
  assert.equal(out.staff.role, "funding_advisor");
  assert.ok(db.stmts().some((s) => /UPDATE staff SET role =/.test(s)));

  const missing = await setStaffRole(fakeDb({ existingStaff: null }), {
    actor: OWNER, staffId: "nope", role: "closer"
  });
  assert.equal(missing.status, 404);
});

test("updateStaffProfile requires owner/admin, refuses owner rows, and writes profile fields", async () => {
  const denied = await updateStaffProfile(fakeDb(), {
    actor: { role: "closer" }, staffId: "x", name: "A B", email: "a@b.c"
  });
  assert.equal(denied.status, 403);

  const changeOwner = await updateStaffProfile(fakeDb({ existingStaff: { id: "own", role: "owner", email: "o@b.c" } }), {
    actor: OWNER, staffId: "own", name: "Owner Name", email: "o@b.c"
  });
  assert.equal(changeOwner.status, 400);
  assert.equal(changeOwner.error, "cannot_change_owner");

  const ownNotify = await updateStaffProfile(fakeDb({
    existingStaff: { id: "own", role: "owner", email: "o@b.c", name: "Chris Stanbridge" }
  }), {
    actor: OWNER, staffId: "own", name: "Chris Stanbridge", email: "o@b.c",
    phone: "4805550100", notifyBookedCallSms: true
  });
  assert.equal(ownNotify.ok, true);
  assert.equal(ownNotify.staff.notify_booked_call_sms, true);

  const db = fakeDb({ existingStaff: { id: "staff-9", role: "sales_manager", email: "sarah.b@fundhub.ai" } });
  const out = await updateStaffProfile(db, {
    actor: OWNER,
    staffId: "staff-9",
    name: "Sarah Whitfield",
    email: "sarah.b@fundhub.ai",
    phone: "+1 480 555 0114",
    startDate: "2023-09-18"
  });
  assert.equal(out.ok, true);
  assert.equal(out.staff.name, "Sarah Whitfield");
  assert.ok(db.stmts().some((s) => /UPDATE staff\s+SET name =/.test(s)));

  const missing = await updateStaffProfile(fakeDb({ existingStaff: null }), {
    actor: OWNER, staffId: "nope", name: "A B", email: "a@b.c"
  });
  assert.equal(missing.status, 404);
});
