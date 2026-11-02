import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createMfaChallenge, beginMfaSetup, verifyMfaChallenge,
  mfaConfigured, totpAt } from "./mfa.mjs";
import { hashToken } from "./session.mjs";

const ENV = { MFA_REQUIRED: "1", MFA_SECRET_ENC_KEY: crypto.randomBytes(32).toString("base64") };
const STAFF = { id: "staff-1", org_id: "org-1", email: "person@fundhub.test",
  name: "Person", role: "closer" };

function fakeDb() {
  const state = { challenges: new Map(), credential: null, recovery: new Map(),
    sessions: 0, calls: [] };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      if (sql.includes("COALESCE(sum(attempts)")) {
        const challenges = [...state.challenges.values()];
        return { rows: [{ failures: challenges.reduce((n, c) => n + c.attempts, 0),
          active: challenges.filter((c) => !c.used_at).length }] };
      }
      if (sql.includes("INSERT INTO staff_mfa_challenges")) {
        state.challenges.set(params[0], { token_hash: params[0], org_id: params[1],
          staff_id: params[2], email: STAFF.email, attempts: 0, used_at: null });
        return { rows: [] };
      }
      if (sql.includes("SELECT confirmed_at FROM staff_mfa_credentials")) {
        return { rows: state.credential ? [{ confirmed_at: state.credential.confirmed_at }] : [] };
      }
      if (sql.includes("SELECT c.token_hash")) {
        const c = state.challenges.get(params[0]);
        return { rows: c && !c.used_at ? [c] : [] };
      }
      if (sql.includes("SELECT secret_ciphertext,confirmed_at,last_counter")) {
        return { rows: state.credential ? [state.credential] : [] };
      }
      if (sql.includes("INSERT INTO staff_mfa_credentials")) {
        if (!state.credential) state.credential = {
          secret_ciphertext: params[2], confirmed_at: null, last_counter: null };
        return { rows: [] };
      }
      if (sql.includes("SELECT secret_ciphertext FROM staff_mfa_credentials")) {
        return { rows: state.credential && !state.credential.confirmed_at
          ? [state.credential] : [] };
      }
      if (sql.includes("INSERT INTO staff_mfa_recovery_codes")) {
        state.recovery.set(params[2], false);
        return { rows: [] };
      }
      if (sql.includes("UPDATE staff_mfa_recovery_codes")) {
        const available = state.recovery.get(params[1]) === false;
        if (available) state.recovery.set(params[1], true);
        return { rows: available ? [{ id: "recovery-1" }] : [] };
      }
      if (sql.includes("UPDATE staff_mfa_credentials")) {
        state.credential.confirmed_at ||= new Date();
        state.credential.last_counter = params[1];
        return { rows: [] };
      }
      if (sql.includes("UPDATE staff_mfa_challenges SET attempts")) {
        state.challenges.get(params[0]).attempts++;
        return { rows: [] };
      }
      if (sql.includes("UPDATE staff_mfa_challenges SET used_at")) {
        state.challenges.get(params[0]).used_at = new Date();
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO sessions")) {
        state.sessions++;
        return { rows: [{ id: `session-${state.sessions}`, expires_at: new Date(Date.now() + 60000) }] };
      }
      if (sql.includes("SELECT id,org_id,role,email,name FROM staff")) return { rows: [STAFF] };
      if (sql.includes("UPDATE staff SET last_login_at")) return { rows: [] };
      throw new Error(`Unhandled SQL: ${sql.slice(0, 70)}`);
    }
  };
}

test("TOTP matches RFC 6238 SHA1 six-digit value and needs a real encryption key", () => {
  assert.equal(totpAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1), "287082");
  assert.equal(mfaConfigured({}), false);
  assert.equal(mfaConfigured({ MFA_SECRET_ENC_KEY: "short" }), false);
  assert.equal(mfaConfigured(ENV), true);
});

test("staff MFA enrollment creates no session until a real code, then issues one-use recovery codes", async () => {
  const db = fakeDb();
  const challenge = await createMfaChallenge(db, {
    staffId: STAFF.id, orgId: STAFF.org_id, ip: "203.0.113.10", userAgent: "test" });
  assert.equal(challenge.setupRequired, true);
  assert.equal(db.state.sessions, 0);
  const setup = await beginMfaSetup(db, { mfaToken: challenge.token, env: ENV });
  assert.equal(setup.ok, true);
  assert.match(setup.otpauth_uri, /^otpauth:\/\/totp\/Fundhub%3A/);
  assert.ok(!db.state.credential.secret_ciphertext.includes(setup.secret), "seed encrypted at rest");
  const bad = await verifyMfaChallenge(db, { mfaToken: challenge.token,
    code: "000000", env: ENV });
  assert.equal(bad.error, "invalid_mfa_code");
  assert.equal(db.state.sessions, 0);
  const now = Date.now();
  const code = totpAt(setup.secret, Math.floor(now / 30000));
  const good = await verifyMfaChallenge(db, { mfaToken: challenge.token,
    code, at: now, env: ENV });
  assert.equal(good.ok, true);
  assert.equal(db.state.sessions, 1);
  assert.equal(good.recovery_codes.length, 8);
  assert.ok(db.state.calls.some((c) => c.sql.includes("INSERT INTO sessions") &&
    c.params.at(-1) === true), "issued session is MFA verified");
  const replay = await verifyMfaChallenge(db, { mfaToken: challenge.token,
    code, at: now, env: ENV });
  assert.equal(replay.error, "mfa_challenge_expired", "challenge is one use");

  const second = await createMfaChallenge(db, {
    staffId: STAFF.id, orgId: STAFF.org_id, ip: "203.0.113.10", userAgent: "test" });
  assert.equal(second.setupRequired, false);
  const recovery = await verifyMfaChallenge(db, { mfaToken: second.token,
    code: good.recovery_codes[0], env: ENV });
  assert.equal(recovery.ok, true);
  assert.equal(db.state.sessions, 2);
  assert.equal(recovery.recovery_codes, undefined, "codes never shown again");
  const third = await createMfaChallenge(db, {
    staffId: STAFF.id, orgId: STAFF.org_id, ip: "203.0.113.10", userAgent: "test" });
  const spent = await verifyMfaChallenge(db, { mfaToken: third.token,
    code: good.recovery_codes[0], env: ENV });
  assert.equal(spent.error, "invalid_mfa_code", "recovery code is one use");
});

test("bad authenticator codes lock a challenge after five tries", async () => {
  const db = fakeDb();
  const challenge = await createMfaChallenge(db, { staffId: STAFF.id, orgId: STAFF.org_id });
  await beginMfaSetup(db, { mfaToken: challenge.token, env: ENV });
  for (let i = 0; i < 4; i++) {
    const result = await verifyMfaChallenge(db, { mfaToken: challenge.token,
      code: "bad", env: ENV });
    assert.equal(result.error, "invalid_mfa_code");
  }
  const locked = await verifyMfaChallenge(db, { mfaToken: challenge.token,
    code: "bad", env: ENV });
  assert.equal(locked.status, 429);
  assert.equal(locked.error, "mfa_challenge_locked");
  assert.equal(db.state.sessions, 0);
  assert.equal(db.state.challenges.get(hashToken(challenge.token)).attempts, 5);
});

test("preissued challenges share a global guess ceiling and active-token cap", async () => {
  const db = fakeDb();
  const tokens = [];
  for (let i = 0; i < 3; i++) {
    tokens.push((await createMfaChallenge(db, { staffId: STAFF.id,
      orgId: STAFF.org_id })).token);
  }
  const fourth = await createMfaChallenge(db, { staffId: STAFF.id,
    orgId: STAFF.org_id });
  assert.equal(fourth.limited, true);
  await beginMfaSetup(db, { mfaToken: tokens[0], env: ENV });
  for (const token of tokens.slice(0, 2)) {
    for (let i = 0; i < 5; i++) {
      await verifyMfaChallenge(db, { mfaToken: token, code: "bad", env: ENV });
    }
  }
  const blocked = await verifyMfaChallenge(db, { mfaToken: tokens[2],
    code: "bad", env: ENV });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.error, "too_many_mfa_attempts");
  assert.equal(db.state.sessions, 0);
});
