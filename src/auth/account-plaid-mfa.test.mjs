import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { totpAt } from "./mfa.mjs";
import { hashToken } from "./session.mjs";
import { accountMfaSetup, verifyAccountMfaEmail, authorizeAccountPlaidLink,
  advanceAccountPlaidLink } from "./account-plaid-mfa.mjs";
import plaidMfaRoute from "../../api/auth/plaid-mfa.mjs";

const env = { MFA_SECRET_ENC_KEY: crypto.randomBytes(32).toString("base64") };
const id = { accountId: "account-1", orgId: "org-1", sessionId: "session-1",
  targetKind: "client_bank", targetId: "client-1" };
const at = Date.parse("2026-11-02T20:00:00Z");

function fakeDb() {
  const state = { credential: null, challenge: null, grant: null };
  const db = { state, async query(sql, params = []) {
    if (sql.includes("SELECT account_session_id,code_hash,expires_at,attempts,verified_at,sent_at") ||
        sql.includes("SELECT account_session_id,code_hash,expires_at,attempts,verified_at")) {
      return { rows: state.challenge ? [state.challenge] : [] };
    }
    if (sql.includes("SELECT verified_at,expires_at FROM account_plaid_mfa_email_challenges")) {
      return { rows: state.challenge && state.challenge.account_session_id === params[2]
        ? [state.challenge] : [] };
    }
    if (sql.includes("INSERT INTO account_plaid_mfa_email_challenges")) {
      state.challenge = { account_session_id: params[2], code_hash: params[3],
        expires_at: params[4], attempts: 0, verified_at: null, sent_at: params[5] };
      return { rows: [] };
    }
    if (sql.includes("UPDATE account_plaid_mfa_email_challenges")) {
      if (sql.includes("attempts=attempts+1")) state.challenge.attempts++;
      if (sql.includes("verified_at=now()")) state.challenge.verified_at = new Date(at).toISOString();
      return { rows: [] };
    }
    if (sql.includes("DELETE FROM account_plaid_mfa_email_challenges")) {
      state.challenge = null;
      return { rows: [] };
    }
    if (sql.includes("SELECT secret_ciphertext, confirmed_at FROM account_plaid_mfa_credentials")) {
      return { rows: state.credential ? [state.credential] : [] };
    }
    if (sql.includes("INSERT INTO account_plaid_mfa_credentials")) {
      state.credential ||= { secret_ciphertext: params[2], confirmed_at: null,
        last_counter: null, failed_attempts: 0, failed_window_at: null };
      return { rows: [] };
    }
    if (sql.includes("SELECT secret_ciphertext,confirmed_at FROM account_plaid_mfa_credentials")) {
      return { rows: state.credential ? [state.credential] : [] };
    }
    if (sql.includes("SELECT secret_ciphertext,confirmed_at,last_counter,failed_attempts,failed_window_at")) {
      return { rows: state.credential ? [{ ...state.credential }] : [] };
    }
    if (sql.includes("UPDATE account_plaid_mfa_credentials")) {
      if (sql.includes("SET confirmed_at")) {
        state.credential.confirmed_at ||= new Date(at).toISOString();
        state.credential.last_counter = params[1];
        state.credential.failed_attempts = 0;
      } else {
        state.credential.failed_attempts = params[1];
        state.credential.failed_window_at = new Date(at).toISOString();
      }
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO account_plaid_link_grants")) {
      state.grant = { id: "grant-1", token_hash: params[0], org_id: params[1],
        account_id: params[2], account_session_id: params[3], target_kind: params[4],
        target_id: params[5], consent_scope: JSON.parse(params[6]),
        consent_text: params[8], privacy_url: params[9],
        consent_granted_at: new Date(at).toISOString(),
        expires_at: new Date(at + 600000).toISOString(), link_opened_at: null, consumed_at: null };
      return { rows: [state.grant] };
    }
    if (sql.includes("UPDATE account_plaid_link_grants")) {
      const g = state.grant;
      if (!g || g.token_hash !== params[0] || g.org_id !== params[1] ||
          g.account_id !== params[2] || g.account_session_id !== params[3] ||
          g.target_kind !== params[4] || g.target_id !== params[5]) return { rows: [] };
      if (sql.includes("SET link_opened_at")) {
        if (g.link_opened_at || g.consumed_at) return { rows: [] };
        g.link_opened_at = new Date(at).toISOString();
      } else {
        if (!g.link_opened_at || g.consumed_at) return { rows: [] };
        g.consumed_at = new Date(at).toISOString();
      }
      return { rows: [g] };
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  } };
  return db;
}

test("one authenticator code and explicit consent authorize only one scoped Link flow", async () => {
  const db = fakeDb();
  let emailCode;
  const challenge = await accountMfaSetup(db, { ...id,
    email: "person@example.test", env, at,
    sendEmail: async ({ body }) => { emailCode = body.match(/:\s(\d{6})/)[1]; return { mailed: true }; } });
  assert.equal(challenge.email_verification_required, true);
  assert.equal(challenge.secret, undefined);
  assert.equal(db.state.credential, null);
  const repeat = await accountMfaSetup(db, { ...id, email: "person@example.test", env, at,
    sendEmail: async () => { throw new Error("same challenge must not resend"); } });
  assert.equal(repeat.email_verification_required, true);
  assert.equal(repeat.email_sent, false);
  assert.equal((await verifyAccountMfaEmail(db, { ...id, sessionId: "wrong", code: emailCode, env, at })).ok, false);
  assert.equal((await verifyAccountMfaEmail(db, { ...id, code: "000000", env, at })).error, "invalid_email_code");
  assert.equal((await verifyAccountMfaEmail(db, { ...id, code: emailCode, env, at })).ok, true);
  const setup = await accountMfaSetup(db, { ...id,
    email: "person@example.test", env, at });
  assert.equal(setup.ok, true);
  assert.match(setup.otpauth_uri, /^otpauth:\/\/totp\//);
  const code = totpAt(setup.secret, Math.floor(at / 30000));
  const noEmailProof = await authorizeAccountPlaidLink(db, { ...id, sessionId: "wrong",
    code, consent: true, env, at });
  assert.equal(noEmailProof.error, "email_verification_required");
  const noConsent = await authorizeAccountPlaidLink(db, { ...id, code,
    consent: false, env, at });
  assert.equal(noConsent.error, "consent_required");
  assert.equal(db.state.grant, null);
  const wrong = await authorizeAccountPlaidLink(db, { ...id,
    code: code === "000000" ? "111111" : "000000",
    consent: true, env, at });
  assert.equal(wrong.error, "invalid_mfa_code");
  assert.equal(db.state.grant, null);
  const approved = await authorizeAccountPlaidLink(db, { ...id, code,
    consent: true, env, at });
  assert.equal(approved.ok, true);
  assert.equal(db.state.challenge, null);
  assert.equal(db.state.grant.token_hash, hashToken(approved.grant_token));
  assert.deepEqual(db.state.grant.consent_scope, ["accounts", "balances", "transactions"]);
  assert.match(db.state.grant.consent_text, /collect, process, use, and store/);
  assert.equal(db.state.grant.privacy_url, "https://fundhub.ai/privacy/");
  const replayCode = await authorizeAccountPlaidLink(db, { ...id, code,
    consent: true, env, at });
  assert.equal(replayCode.error, "invalid_mfa_code");
  const wrongSession = await advanceAccountPlaidLink(db, { ...id,
    sessionId: "other-session", token: approved.grant_token, stage: "open" });
  assert.equal(wrongSession, null);
  assert.equal(await advanceAccountPlaidLink(db, { ...id,
    targetId: "other-client", token: approved.grant_token, stage: "open" }), null);
  const opened = await advanceAccountPlaidLink(db, { ...id,
    token: approved.grant_token, stage: "open" });
  assert.equal(opened.id, "grant-1");
  assert.equal(await advanceAccountPlaidLink(db, { ...id,
    token: approved.grant_token, stage: "open" }), null);
  const exchanged = await advanceAccountPlaidLink(db, { ...id,
    token: approved.grant_token, stage: "exchange" });
  assert.equal(exchanged.id, "grant-1");
  assert.equal(await advanceAccountPlaidLink(db, { ...id,
    token: approved.grant_token, stage: "exchange" }), null);
});

test("email challenge expires and stops after five wrong codes", async () => {
  const db = fakeDb();
  let emailCode;
  await accountMfaSetup(db, { ...id, email: "person@example.test", env, at,
    sendEmail: async ({ body }) => { emailCode = body.match(/:\s(\d{6})/)[1]; return { mailed: true }; } });
  const bad = emailCode === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) {
    assert.equal((await verifyAccountMfaEmail(db, { ...id, code: bad, env, at })).error,
      "invalid_email_code");
  }
  assert.equal((await verifyAccountMfaEmail(db, { ...id, code: emailCode, env, at })).error,
    "email_code_expired");
  assert.equal((await accountMfaSetup(db, { ...id, email: "person@example.test", env,
    at: at + 600_001, sendEmail: async () => ({ mailed: true }) })).email_verification_required, true);
});

test("MFA route pins target to authenticated principal, not body", async () => {
  let seen;
  const res = { statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; },
    json(v) { this.body = v; return this; } };
  await plaidMfaRoute({ method: "POST", body: { action: "authorize",
    target_kind: "client_bank", target_id: "other-client", code: "123456", consent: true } }, res, {
    db: fakeDb(), env,
    requirePrincipal: async () => ({ kind: "client", accountId: id.accountId,
      sessionId: id.sessionId, orgId: id.orgId, clientId: id.targetId }),
    authorize: async (_db, args) => { seen = args; return { ok: true, grant_token: "grant" }; }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(seen.targetId, id.targetId);
  assert.equal(seen.sessionId, id.sessionId);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("email verification route binds the code to the authenticated account session", async () => {
  let seen;
  const res = { statusCode: 200, body: null,
    setHeader() {}, status(n) { this.statusCode = n; return this; },
    json(v) { this.body = v; return this; } };
  await plaidMfaRoute({ method: "POST", body: { action: "verify_email",
    target_kind: "client_bank", account_id: "other-account",
    session_id: "other-session", email_code: "123456" } }, res, {
    db: fakeDb(), env,
    requirePrincipal: async () => ({ kind: "client", accountId: id.accountId,
      sessionId: id.sessionId, orgId: id.orgId, clientId: id.targetId }),
    verifyEmail: async (_db, args) => { seen = args; return { ok: true }; }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(seen.accountId, id.accountId);
  assert.equal(seen.sessionId, id.sessionId);
  assert.equal(seen.code, "123456");
});
