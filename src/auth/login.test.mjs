import { test } from "node:test";
import assert from "node:assert";
import { login, checkRateLimit, recordAttempt, normalizeEmail, LIMITS } from "./login.mjs";
import { hashPassword } from "./hash.mjs";
import { hashToken } from "./session.mjs";
import { _resetOrgCache } from "./org.mjs";

const PASSWORD = "correct horse battery staple";
let HASH; // hashed once — scrypt is deliberately slow

function fakeDb({ staff = null, emailFails = 0, ipFails = 0 } = {}) {
  const calls = [];
  return {
    calls,
    stmts: () => calls.map((c) => c.sql),
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/email_fails/.test(sql)) return { rows: [{ email_fails: emailFails, ip_fails: ipFails }] };
      if (/FROM staff s/.test(sql)) return { rows: staff ? [staff] : [] };
      if (/WITH live AS/.test(sql)) return { rows: staff ? [{
        ...staff, staff_id: staff.id, session_id: "sess-1",
        assigned_roles: staff.assigned_roles || [], expires_at: new Date(Date.now() + 1000)
      }] : [] };
      return { rows: [{ id: "sess-1", expires_at: new Date(Date.now() + 1000) }] };
    }
  };
}

const staffRow = (over = {}) => ({
  id: "staff-1", org_id: "org-1", role: "closer", email: "dana@fundhub.test",
  name: "Dana", status: "active", password_hash: HASH, active_flag: null, ...over
});

test("setup: hash the fixture password once", async () => {
  HASH = await hashPassword(PASSWORD);
  assert.ok(HASH.startsWith("$scrypt$"));
});

test("normalizeEmail lowercases and trims, and survives junk", () => {
  assert.equal(normalizeEmail("  Dana@FundHub.TEST "), "dana@fundhub.test");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(42), "");
});

test("login succeeds and returns a token plus the staff identity", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow() });
  const out = await login(db, { email: "Dana@FundHub.test", password: PASSWORD, ip: "203.0.113.9", userAgent: "UA" });

  assert.equal(out.ok, true);
  assert.match(out.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(out.staff, {
    id: "staff-1", org_id: "org-1", role: "closer", roles: ["closer"],
    email: "dana@fundhub.test", name: "Dana"
  });
  assert.ok(db.stmts().some((s) => /UPDATE staff SET last_login_at/.test(s)), "stamps last_login_at");
  assert.ok(db.stmts().some((s) => /INSERT INTO sessions/.test(s)), "mints a session");
});

test("staff password signs in directly even when the old MFA switch is set", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow() });
  const out = await login(db, { email: "dana@fundhub.test", password: PASSWORD,
    mfaForPayout: true,
    env: { MFA_REQUIRED: "1", MFA_SECRET_ENC_KEY: Buffer.alloc(32, 7).toString("base64") } });
  assert.equal(out.ok, true);
  assert.match(out.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(out.mfa_required, undefined);
  assert.ok(db.stmts().some((s) => /INSERT INTO sessions/.test(s)));
  assert.ok(!db.stmts().some((s) => /INSERT INTO staff_mfa_challenges/.test(s)));
});

test("staff password still signs in without an MFA key", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow() });
  const out = await login(db, { email: "dana@fundhub.test", password: PASSWORD,
    mfaForPayout: true,
    env: { MFA_REQUIRED: "1" } });
  assert.equal(out.ok, true);
  assert.match(out.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(db.stmts().some((s) => /INSERT INTO sessions/.test(s)));
});

test("native staff login remains usable without MFA", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow() });
  const out = await login(db, { email: "dana@fundhub.test", password: PASSWORD,
    env: { MFA_REQUIRED: "1" } });
  assert.equal(out.ok, true);
  assert.equal(out.mfa_required, undefined);
  assert.match(out.token, /^[A-Za-z0-9_-]{43}$/);
  const insert = db.calls.find((c) => /INSERT INTO sessions/.test(c.sql));
  assert.equal(insert.params.at(-1), false);
});

test("login includes assigned roles immediately from the verified session", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow({ assigned_roles: ["setter", "closer"] }) });
  const out = await login(db, { email: "dana@fundhub.test", password: PASSWORD });
  assert.equal(out.ok, true);
  assert.deepEqual(out.staff.roles, ["closer", "setter"]);
  assert.ok(db.stmts().some((sql) => /FROM staff_role_assignments/.test(sql)));
});

test("the password never reaches the database in any statement", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow() });
  const out = await login(db, { email: "dana@fundhub.test", password: PASSWORD, ip: "203.0.113.9" });
  for (const call of db.calls) {
    const blob = JSON.stringify(call.params);
    assert.ok(!blob.includes(PASSWORD), `password leaked into: ${call.sql.slice(0, 60)}`);
    assert.ok(!blob.includes(HASH), `password hash leaked into: ${call.sql.slice(0, 60)}`);
    assert.ok(!blob.includes(out.token), `session token leaked into: ${call.sql.slice(0, 60)}`);
  }
  // The session row must carry the hash of the token, never the token.
  const insert = db.calls.find((c) => /INSERT INTO sessions/.test(c.sql));
  assert.ok(insert.params.includes(hashToken(out.token)));
});

test("auth_attempts records identity only — never the password", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow() });
  await login(db, { email: "dana@fundhub.test", password: PASSWORD, ip: "203.0.113.9" });
  const attempt = db.calls.find((c) => /INSERT INTO auth_attempts/.test(c.sql));
  assert.deepEqual(attempt.params, ["org-1", "dana@fundhub.test", "203.0.113.9", true]);
});

test("wrong password is rejected and recorded as a failure", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow() });
  const out = await login(db, { email: "dana@fundhub.test", password: "wrong password here", ip: "203.0.113.9" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
  assert.equal(out.error, "invalid_credentials");
  const attempt = db.calls.find((c) => /INSERT INTO auth_attempts/.test(c.sql));
  assert.equal(attempt.params[3], false);
  assert.ok(!db.stmts().some((s) => /INSERT INTO sessions/.test(s)), "no session minted");
});

test("unknown email is indistinguishable from a wrong password", async () => {
  _resetOrgCache();
  const unknown = await login(fakeDb({ staff: null }), { email: "nobody@fundhub.test", password: PASSWORD });
  const wrong = await login(fakeDb({ staff: staffRow() }), { email: "dana@fundhub.test", password: "not the password" });
  assert.equal(unknown.error, wrong.error);
  assert.equal(unknown.status, wrong.status);
});

test("unknown email still pays the scrypt cost (no timing oracle)", async () => {
  _resetOrgCache();
  const t0 = process.hrtime.bigint();
  await login(fakeDb({ staff: null }), { email: "nobody@fundhub.test", password: PASSWORD });
  const unknownMs = Number(process.hrtime.bigint() - t0) / 1e6;
  // A short-circuit return would be sub-millisecond; a real scrypt is tens of ms.
  assert.ok(unknownMs > 10, `expected real work for an unknown email, took ${unknownMs.toFixed(1)}ms`);
});

test("a staff row with no password_hash cannot log in", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow({ password_hash: null, status: "invited" }) });
  const out = await login(db, { email: "dana@fundhub.test", password: PASSWORD });
  assert.equal(out.ok, false);
  assert.equal(out.error, "invalid_credentials");
});

test("suspended and invited accounts are refused even with the right password", async () => {
  _resetOrgCache();
  for (const status of ["suspended", "invited"]) {
    const db = fakeDb({ staff: staffRow({ status }) });
    const out = await login(db, { email: "dana@fundhub.test", password: PASSWORD });
    assert.equal(out.ok, false);
    assert.equal(out.status, 403);
    assert.equal(out.error, `account_${status}`);
    assert.ok(!db.stmts().some((s) => /INSERT INTO sessions/.test(s)));
  }
});

test("staff.active = false (from 012) blocks login even when status is active", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow({ active_flag: "false" }) });
  const out = await login(db, { email: "dana@fundhub.test", password: PASSWORD });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
});

test("missing email or password is a 400 before any lookup", async () => {
  _resetOrgCache();
  for (const args of [{}, { email: "a@b.com" }, { password: PASSWORD }, { email: "", password: "" }]) {
    const out = await login(fakeDb({ staff: staffRow() }), args);
    assert.equal(out.status, 400);
    assert.equal(out.error, "email_and_password_required");
  }
});

test("rate limit trips on email failures and on ip failures independently", async () => {
  _resetOrgCache();
  const byEmail = fakeDb({ staff: staffRow(), emailFails: LIMITS.maxPerEmail });
  const e = await login(byEmail, { email: "dana@fundhub.test", password: PASSWORD, ip: "203.0.113.9" });
  assert.equal(e.status, 429);
  assert.equal(e.error, "too_many_attempts");
  assert.equal(e.retryAfterMinutes, LIMITS.windowMinutes);

  _resetOrgCache();
  const byIp = fakeDb({ staff: staffRow(), ipFails: LIMITS.maxPerIp });
  const i = await login(byIp, { email: "dana@fundhub.test", password: PASSWORD, ip: "203.0.113.9" });
  assert.equal(i.status, 429);
});

test("a rate-limited request does no password work and adds no new attempt row", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow(), emailFails: LIMITS.maxPerEmail });
  await login(db, { email: "dana@fundhub.test", password: PASSWORD, ip: "203.0.113.9" });
  assert.ok(!db.stmts().some((s) => /INSERT INTO auth_attempts/.test(s)),
    "recording here would let an attacker hold a colleague locked out forever");
  assert.ok(!db.stmts().some((s) => /FROM staff s/.test(s)), "no lookup, no scrypt");
});

test("one failure below the limit still lets a correct password through", async () => {
  _resetOrgCache();
  const db = fakeDb({ staff: staffRow(), emailFails: LIMITS.maxPerEmail - 1, ipFails: LIMITS.maxPerIp - 1 });
  const out = await login(db, { email: "dana@fundhub.test", password: PASSWORD, ip: "203.0.113.9" });
  assert.equal(out.ok, true);
});

test("checkRateLimit counts only failures since the last success, inside the window", async () => {
  const db = fakeDb({ emailFails: 2, ipFails: 3 });
  const out = await checkRateLimit(db, { orgId: "org-1", email: "Dana@Fundhub.test", ip: "203.0.113.9" });
  assert.deepEqual(
    { limited: out.limited, emailFails: out.emailFails, ipFails: out.ipFails },
    { limited: false, emailFails: 2, ipFails: 3 }
  );
  const sql = db.calls[0].sql;
  assert.match(sql, /NOT a\.successful/, "successes are not counted against you");
  assert.match(sql, /max\(created_at\).*successful/s, "counter resets at the last successful login");
  assert.match(sql, /interval '1 minute'/, "bounded to a time window");
  assert.deepEqual(db.calls[0].params, ["org-1", "dana@fundhub.test", "203.0.113.9", LIMITS.windowMinutes]);
});

test("a null ip does not accidentally group every anonymous caller together", async () => {
  const db = fakeDb({ emailFails: 0, ipFails: 0 });
  await checkRateLimit(db, { orgId: "org-1", email: "a@b.com", ip: null });
  assert.equal(db.calls[0].params[2], null);
  assert.match(db.calls[0].sql, /\$3::inet IS NOT NULL/, "ip limiting is skipped when there is no ip");
});

test("recordAttempt normalises and never stores a credential", async () => {
  const db = fakeDb();
  await recordAttempt(db, { orgId: "org-1", email: " Dana@FundHub.TEST ", ip: "203.0.113.9:5555", successful: false });
  assert.deepEqual(db.calls[0].params, ["org-1", "dana@fundhub.test", "203.0.113.9", false]);
  assert.match(db.calls[0].sql, /INSERT INTO auth_attempts \(org_id, email, ip, successful\)/);
});
