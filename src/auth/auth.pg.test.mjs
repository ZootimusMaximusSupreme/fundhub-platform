// Real-Postgres integration test for staff authentication.
// SKIPS unless DATABASE_URL is set. Proves the whole path against 020_auth.sql:
// invite -> set password -> login -> session verify -> slide -> revoke, plus the
// rate limiter, the single-use token guarantee, and the "no secret ever lands in
// a column" property that the unit tests can only assert about parameters.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { login, checkRateLimit, recordAttempt, LIMITS } from "./login.mjs";
import { inviteStaff, acceptInvite, requestPasswordReset, resetPassword, suspendStaff } from "./invite.mjs";
import { verifySession, revokeSession, revokeAllForStaff, expireSessions, hashToken } from "./session.mjs";
import { resolveDefaultOrg, _resetOrgCache } from "./org.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const opts = { skip: HAS_DB ? false : "DATABASE_URL not set" };

const EMAIL = "pg_auth_test@fundhub.test";
const EMAIL2 = "pg_auth_test2@fundhub.test";
const PASSWORD = "a perfectly fine passphrase";
const NEXT_PASSWORD = "an entirely different passphrase";
const IP = "203.0.113.77";

let ORG;
let OWNER;

async function wipe() {
  await db.query(`DELETE FROM auth_attempts WHERE email IN ($1,$2)`, [EMAIL, EMAIL2]);
  await db.query(
    `DELETE FROM staff WHERE lower(email) IN ($1,$2,'pg_auth_owner@fundhub.test')`,
    [EMAIL, EMAIL2]
  );
}

before(async () => {
  if (!HAS_DB) return;
  _resetOrgCache();
  ORG = await resolveDefaultOrg(db);
  await wipe();
  OWNER = (await db.query(
    `INSERT INTO staff (org_id, name, role, email, status)
     VALUES ($1,'PG Owner','owner','pg_auth_owner@fundhub.test','active')
     RETURNING id, org_id, role`,
    [ORG]
  )).rows[0];
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

test("migration shape: every auth column and table landed", opts, async () => {
  const cols = (await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='staff'
        AND column_name IN ('email','password_hash','last_login_at','status')`
  )).rows.map((r) => r.column_name).sort();
  assert.deepEqual(cols, ["email", "last_login_at", "password_hash", "status"]);

  for (const t of ["sessions", "password_resets", "auth_attempts", "staff_roles"]) {
    const r = await db.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${t}`]);
    assert.equal(r.rows[0].present, true, `${t} must exist`);
  }
  // Rule 7 + the 001 convention: org_id, created_at, updated_at everywhere.
  for (const t of ["sessions", "password_resets", "auth_attempts", "staff_roles"]) {
    const cs = (await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1
          AND column_name IN ('org_id','created_at','updated_at')`, [t]
    )).rows.map((r) => r.column_name).sort();
    assert.deepEqual(cs, ["created_at", "org_id", "updated_at"], `${t} follows the 001 convention`);
  }
});

test("staff email is unique per org, case-insensitively", opts, async () => {
  const a = (await db.query(
    `INSERT INTO staff (org_id, name, email, status) VALUES ($1,'Dup A',$2,'invited') RETURNING id`,
    [ORG, EMAIL2]
  )).rows[0];
  await assert.rejects(
    () => db.query(`INSERT INTO staff (org_id, name, email, status) VALUES ($1,'Dup B',$2,'invited')`,
      [ORG, EMAIL2.toUpperCase()]),
    /duplicate key|unique/i,
    "same address in different case must collide"
  );
  await db.query(`DELETE FROM staff WHERE id = $1`, [a.id]);
});

test("staff.status is constrained to the three legal values", opts, async () => {
  await assert.rejects(
    () => db.query(`INSERT INTO staff (org_id, name, email, status) VALUES ($1,'Bad',$2,'wat')`, [ORG, EMAIL2]),
    /staff_status_check|violates check/i
  );
});

test("full journey: invite -> accept -> login -> verify -> revoke", opts, async () => {
  const invite = await inviteStaff(db, { actor: OWNER, email: EMAIL, name: "PG Tester", role: "closer" });
  assert.equal(invite.ok, true);
  assert.equal(invite.staff.status, "invited");

  // An invited account cannot log in yet — there is no password.
  const tooEarly = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  assert.equal(tooEarly.ok, false);

  const accepted = await acceptInvite(db, { token: invite.token, password: PASSWORD });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.staff.status, "active");

  const out = await login(db, { email: EMAIL, password: PASSWORD, ip: IP, userAgent: "pg-test/1.0" });
  assert.equal(out.ok, true, out.error);
  assert.match(out.token, /^[A-Za-z0-9_-]{43}$/);

  const verified = await verifySession(db, out.token);
  assert.equal(verified.staff.email, EMAIL);
  assert.equal(verified.staff.role, "closer");
  assert.equal(verified.staff.org_id, ORG);

  assert.equal(await revokeSession(db, out.token), true);
  assert.equal(await verifySession(db, out.token), null, "a revoked session is dead immediately");
  assert.equal(await revokeSession(db, out.token), false, "revoking twice is a no-op");
});

test("the database stores no plaintext password and no live token", opts, async () => {
  const out = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  assert.equal(out.ok, true);

  const row = (await db.query(`SELECT password_hash, last_login_at FROM staff WHERE lower(email)=$1`, [EMAIL])).rows[0];
  assert.ok(row.password_hash.startsWith("$scrypt$"));
  assert.ok(!row.password_hash.includes(PASSWORD));
  assert.ok(row.last_login_at, "last_login_at stamped");

  const sess = (await db.query(`SELECT token_hash, ip, user_agent FROM sessions WHERE token_hash = $1`,
    [hashToken(out.token)])).rows[0];
  assert.ok(sess, "session is found by the hash");
  const anyRaw = await db.query(`SELECT count(*)::int n FROM sessions WHERE token_hash = $1`, [out.token]);
  assert.equal(anyRaw.rows[0].n, 0, "the cleartext token is nowhere in the table");

  const attempts = (await db.query(
    `SELECT email, ip, successful FROM auth_attempts WHERE email = $1 ORDER BY created_at DESC LIMIT 1`, [EMAIL]
  )).rows[0];
  assert.equal(attempts.successful, true);
  assert.equal(attempts.ip, IP);
  await revokeSession(db, out.token);
});

test("sessions expire, and expiry is enforced by the database not the caller", opts, async () => {
  const out = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  await db.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
    [hashToken(out.token)]);
  assert.equal(await verifySession(db, out.token), null, "an expired session cannot be revived by a verify");
});

test("expiry slides forward on each use", opts, async () => {
  const out = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  await db.query(`UPDATE sessions SET expires_at = now() + interval '1 hour' WHERE token_hash = $1`,
    [hashToken(out.token)]);
  const before = (await db.query(`SELECT expires_at FROM sessions WHERE token_hash=$1`, [hashToken(out.token)])).rows[0];

  const v = await verifySession(db, out.token);
  assert.ok(v, "still live");
  const after = (await db.query(`SELECT expires_at, last_seen_at FROM sessions WHERE token_hash=$1`,
    [hashToken(out.token)])).rows[0];

  assert.ok(after.expires_at > before.expires_at, "verify pushed expiry out");
  const days = (after.expires_at - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days < 7.1, `default TTL is 7 days, got ${days.toFixed(2)}`);
  await revokeSession(db, out.token);
});

test("a suspended staff member's live sessions die on the next request", opts, async () => {
  const out = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  assert.ok(await verifySession(db, out.token));

  const staffId = (await db.query(`SELECT id FROM staff WHERE lower(email)=$1`, [EMAIL])).rows[0].id;
  await db.query(`UPDATE staff SET status='suspended' WHERE id=$1`, [staffId]);

  assert.equal(await verifySession(db, out.token), null);
  const revoked = (await db.query(`SELECT revoked_at FROM sessions WHERE token_hash=$1`,
    [hashToken(out.token)])).rows[0];
  assert.ok(revoked.revoked_at, "the row is revoked, not merely refused");

  const denied = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  assert.equal(denied.status, 403);
  assert.equal(denied.error, "account_suspended");

  await db.query(`UPDATE staff SET status='active' WHERE id=$1`, [staffId]);
});

test("suspendStaff revokes every live session at once", opts, async () => {
  const a = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  const b = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  const staffId = (await db.query(`SELECT id FROM staff WHERE lower(email)=$1`, [EMAIL])).rows[0].id;

  const out = await suspendStaff(db, { actor: OWNER, staffId });
  assert.equal(out.ok, true);
  assert.ok(out.sessionsRevoked >= 2, `expected >=2 revoked, got ${out.sessionsRevoked}`);
  assert.equal(await verifySession(db, a.token), null);
  assert.equal(await verifySession(db, b.token), null);

  await db.query(`UPDATE staff SET status='active' WHERE id=$1`, [staffId]);
});

test("an invite token is single-use", opts, async () => {
  await db.query(`DELETE FROM staff WHERE lower(email)=$1`, [EMAIL2]);
  const invite = await inviteStaff(db, { actor: OWNER, email: EMAIL2, name: "Single Use", role: "setter" });
  const first = await acceptInvite(db, { token: invite.token, password: PASSWORD });
  assert.equal(first.ok, true);
  const second = await acceptInvite(db, { token: invite.token, password: NEXT_PASSWORD });
  assert.equal(second.ok, false);
  assert.equal(second.error, "invalid_or_expired_token");

  // The first password still works — the replay changed nothing.
  const out = await login(db, { email: EMAIL2, password: PASSWORD, ip: IP });
  assert.equal(out.ok, true);
  await revokeSession(db, out.token);
});

test("an expired invite token is refused", opts, async () => {
  await db.query(`DELETE FROM staff WHERE lower(email)=$1`, [EMAIL2]);
  const invite = await inviteStaff(db, { actor: OWNER, email: EMAIL2, name: "Expired", ttl: 1000 });
  await db.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE token_hash=$1`,
    [hashToken(invite.token)]);
  const out = await acceptInvite(db, { token: invite.token, password: PASSWORD });
  assert.equal(out.error, "invalid_or_expired_token");
});

test("a new invite or reset link ends the earlier LIVE one and leaves an expired one as it was", opts, async () => {
  const usedAt = async (token) => (await db.query(
    `SELECT used_at FROM password_resets WHERE token_hash=$1`, [hashToken(token)]
  )).rows[0].used_at;
  const runOut = (token) => db.query(
    `UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE token_hash=$1`, [hashToken(token)]
  );

  // Invites: first one runs out, second is live, third ends the second only.
  await db.query(`DELETE FROM staff WHERE lower(email)=$1`, [EMAIL2]);
  const i1 = await inviteStaff(db, { actor: OWNER, email: EMAIL2, name: "Link Ends", role: "setter" });
  await runOut(i1.token);
  const i2 = await inviteStaff(db, { actor: OWNER, email: EMAIL2, name: "Link Ends" });
  const i3 = await inviteStaff(db, { actor: OWNER, email: EMAIL2, name: "Link Ends" });
  assert.equal(await usedAt(i1.token), null, "an expired invite is not stamped as used");
  assert.notEqual(await usedAt(i2.token), null, "the earlier live invite is ended");
  assert.equal(await usedAt(i3.token), null, "the newest invite stays live");

  // Resets: same order, for an active person.
  const email = "pg_auth_owner@fundhub.test";
  const r1 = await requestPasswordReset(db, { email });
  await runOut(r1.token);
  const r2 = await requestPasswordReset(db, { email });
  const r3 = await requestPasswordReset(db, { email });
  assert.equal(await usedAt(r1.token), null, "an expired reset link is not stamped as used");
  assert.notEqual(await usedAt(r2.token), null, "the earlier live reset link is ended");
  assert.equal(await usedAt(r3.token), null, "the newest reset link stays live");
});

test("password reset issues a working token and kills existing sessions", opts, async () => {
  const before = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  assert.ok(await verifySession(db, before.token));

  const reset = await requestPasswordReset(db, { email: EMAIL });
  assert.ok(reset.token);

  const done = await resetPassword(db, { token: reset.token, password: NEXT_PASSWORD });
  assert.equal(done.ok, true);
  assert.equal(await verifySession(db, before.token), null, "changing a password signs you out everywhere");

  assert.equal((await login(db, { email: EMAIL, password: PASSWORD, ip: IP })).ok, false, "old password dead");
  const now = await login(db, { email: EMAIL, password: NEXT_PASSWORD, ip: IP });
  assert.equal(now.ok, true, "new password works");
  await revokeSession(db, now.token);

  // Put it back for the remaining tests.
  const back = await requestPasswordReset(db, { email: EMAIL });
  await resetPassword(db, { token: back.token, password: PASSWORD });
});

test("an invite token cannot be redeemed at the reset endpoint", opts, async () => {
  await db.query(`DELETE FROM staff WHERE lower(email)=$1`, [EMAIL2]);
  const invite = await inviteStaff(db, { actor: OWNER, email: EMAIL2, name: "Kind Test" });
  const out = await resetPassword(db, { token: invite.token, password: PASSWORD });
  assert.equal(out.error, "invalid_or_expired_token");
});

test("rate limiting trips by email after the configured failures", opts, async () => {
  await db.query(`DELETE FROM auth_attempts WHERE email = $1`, [EMAIL]);
  for (let i = 0; i < LIMITS.maxPerEmail; i++) {
    const bad = await login(db, { email: EMAIL, password: `wrong guess number ${i}`, ip: `198.51.100.${i + 1}` });
    assert.equal(bad.status, 401, `guess ${i} should be a plain rejection`);
  }
  const locked = await login(db, { email: EMAIL, password: PASSWORD, ip: "198.51.100.200" });
  assert.equal(locked.status, 429, "the correct password is refused once the email is locked");
  assert.equal(locked.error, "too_many_attempts");
});

test("a successful login resets that identity's failure counter", opts, async () => {
  await db.query(`DELETE FROM auth_attempts WHERE email = $1`, [EMAIL]);
  for (let i = 0; i < LIMITS.maxPerEmail - 1; i++) {
    await login(db, { email: EMAIL, password: "definitely wrong here", ip: IP });
  }
  let rate = await checkRateLimit(db, { orgId: ORG, email: EMAIL, ip: IP });
  assert.equal(rate.emailFails, LIMITS.maxPerEmail - 1);

  const ok = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  assert.equal(ok.ok, true);
  rate = await checkRateLimit(db, { orgId: ORG, email: EMAIL, ip: IP });
  assert.equal(rate.emailFails, 0, "failures before the success no longer count");
  assert.equal(rate.limited, false);
  await revokeSession(db, ok.token);
});

test("rate limiting trips by ip across different emails", opts, async () => {
  const sprayIp = "198.51.100.250";
  await db.query(`DELETE FROM auth_attempts WHERE ip = $1::inet`, [sprayIp]);
  for (let i = 0; i < LIMITS.maxPerIp; i++) {
    await recordAttempt(db, { orgId: ORG, email: `spray${i}@fundhub.test`, ip: sprayIp, successful: false });
  }
  const rate = await checkRateLimit(db, { orgId: ORG, email: "someone-else@fundhub.test", ip: sprayIp });
  assert.equal(rate.limited, true, "one source cannot spray the whole staff list");
  assert.ok(rate.ipFails >= LIMITS.maxPerIp);
  await db.query(`DELETE FROM auth_attempts WHERE ip = $1::inet`, [sprayIp]);
});

test("attempts outside the window no longer count", opts, async () => {
  await db.query(`DELETE FROM auth_attempts WHERE email = $1`, [EMAIL]);
  for (let i = 0; i < LIMITS.maxPerEmail; i++) {
    await recordAttempt(db, { orgId: ORG, email: EMAIL, ip: IP, successful: false });
  }
  assert.equal((await checkRateLimit(db, { orgId: ORG, email: EMAIL, ip: IP })).limited, true);
  await db.query(
    `UPDATE auth_attempts SET created_at = now() - ($1::int * interval '1 minute') WHERE email = $2`,
    [LIMITS.windowMinutes + 5, EMAIL]
  );
  assert.equal((await checkRateLimit(db, { orgId: ORG, email: EMAIL, ip: IP })).limited, false, "the lockout lifts");
});

test("revokeAllForStaff can spare the current session", opts, async () => {
  await db.query(`DELETE FROM auth_attempts WHERE email = $1`, [EMAIL]);
  const keep = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  const drop = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  const current = (await verifySession(db, keep.token)).session.id;

  const killed = await revokeAllForStaff(db, (await verifySession(db, keep.token)).staff.id,
    { exceptSessionId: current });
  assert.ok(killed >= 1);
  assert.ok(await verifySession(db, keep.token), "the session doing the revoking survives");
  assert.equal(await verifySession(db, drop.token), null, "the others do not");
  await revokeSession(db, keep.token);
});

test("expireSessions clears rows past the grace window and leaves live ones", opts, async () => {
  await db.query(`DELETE FROM auth_attempts WHERE email = $1`, [EMAIL]);
  const live = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  const stale = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  await db.query(`UPDATE sessions SET expires_at = now() - interval '90 days' WHERE token_hash = $1`,
    [hashToken(stale.token)]);

  const removed = await expireSessions(db, { graceDays: 30 });
  assert.ok(removed >= 1);
  const gone = await db.query(`SELECT count(*)::int n FROM sessions WHERE token_hash=$1`, [hashToken(stale.token)]);
  assert.equal(gone.rows[0].n, 0);
  assert.ok(await verifySession(db, live.token), "live sessions are untouched");
  await revokeSession(db, live.token);
});

test("the role catalog is populated and carries the owner role", opts, async () => {
  const rows = (await db.query(`SELECT key FROM staff_roles WHERE org_id=$1 ORDER BY sort_order`, [ORG])).rows;
  const keys = rows.map((r) => r.key);
  assert.ok(keys.includes("owner"), "owner must exist — it is the role that issues invites");
  assert.ok(keys.includes("closer"));
  assert.ok(keys.includes("admin"));
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dupes, [], "no duplicate role keys");
});

test("updated_at triggers fire on the new tables", opts, async () => {
  const out = await login(db, { email: EMAIL, password: PASSWORD, ip: IP });
  const h = hashToken(out.token);
  /* Pinned into the past first, so this measures the TRIGGER and not the clock.
     It used to read updated_at, update, and read again — two Postgres now()
     values microseconds apart. That passed alone and failed inside the long
     serialized pg run, which is the signature of a timing race, not a broken
     trigger. Backdating makes the assertion unambiguous. */
  /* Backdate with the trigger OFF. With it on, trg_sessions_updated fires on the
     backdating UPDATE too and stamps updated_at straight back to now() — so
     `before` and `after` were two now() values microseconds apart and the
     comparison was a coin flip. Disabling it for this one statement is what
     makes the gap real. Re-enabled in a finally so a failure here cannot leave
     the trigger off for the rest of the run. */
  await db.query(`ALTER TABLE sessions DISABLE TRIGGER trg_sessions_updated`).catch(() => {});
  try {
    await db.query(
      `UPDATE sessions SET updated_at = now() - interval '1 hour' WHERE token_hash=$1`, [h]);
  } finally {
    await db.query(`ALTER TABLE sessions ENABLE TRIGGER trg_sessions_updated`).catch(() => {});
  }
  const before = (await db.query(`SELECT updated_at FROM sessions WHERE token_hash=$1`, [h])).rows[0].updated_at;

  await db.query(`UPDATE sessions SET user_agent = 'changed' WHERE token_hash=$1`, [h]);
  const after = (await db.query(`SELECT updated_at FROM sessions WHERE token_hash=$1`, [h])).rows[0].updated_at;
  assert.ok(after > before,
    "trg_sessions_updated maintains updated_at (001 convention) — it did not move a backdated row forward");
  await revokeSession(db, out.token);
});
