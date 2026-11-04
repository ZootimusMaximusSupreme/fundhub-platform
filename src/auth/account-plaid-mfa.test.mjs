import { test } from "node:test";
import assert from "node:assert/strict";
import { hashToken } from "./session.mjs";
import { authorizeAccountPlaidLink, advanceAccountPlaidLink,
  CONSENT_TEXT, CONSENT_VERSION, PRIVACY_URL } from "./account-plaid-mfa.mjs";
import plaidConsentRoute from "../../api/auth/plaid-mfa.mjs";

const identity = { accountId: "account-1", orgId: "org-1", sessionId: "session-1",
  targetKind: "client_bank", targetId: "client-1" };

function fakeDb() {
  const grants = [];
  return { grants, async query(sql, params = []) {
    if (sql.includes("INSERT INTO account_plaid_link_grants")) {
      const grant = { id: `grant-${grants.length + 1}`, token_hash: params[0],
        org_id: params[1], account_id: params[2], account_session_id: params[3],
        target_kind: params[4], target_id: params[5], consent_scope: JSON.parse(params[6]),
        consent_version: params[7], consent_text: params[8], privacy_url: params[9],
        consent_granted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600000).toISOString(),
        link_opened_at: null, consumed_at: null };
      grants.push(grant);
      return { rows: [grant] };
    }
    if (sql.includes("UPDATE account_plaid_link_grants")) {
      const grant = grants.find(g => g.token_hash === params[0] && g.org_id === params[1] &&
        g.account_id === params[2] && g.account_session_id === params[3] &&
        g.target_kind === params[4] && g.target_id === params[5]);
      if (!grant) return { rows: [] };
      if (sql.includes("SET link_opened_at")) {
        if (grant.link_opened_at || grant.consumed_at) return { rows: [] };
        grant.link_opened_at = new Date().toISOString();
      } else {
        if (!grant.link_opened_at || grant.consumed_at) return { rows: [] };
        grant.consumed_at = new Date().toISOString();
      }
      return { rows: [grant] };
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  } };
}

function response() {
  return { statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; },
    json(v) { this.body = v; return this; } };
}

test("explicit consent creates a scoped, single-use grant without a second factor", async () => {
  const db = fakeDb();
  assert.equal((await authorizeAccountPlaidLink(db, { ...identity, consent: false })).error, "consent_required");
  assert.equal(db.grants.length, 0);
  const approved = await authorizeAccountPlaidLink(db, { ...identity, consent: true });
  assert.equal(approved.ok, true);
  assert.equal(db.grants[0].token_hash, hashToken(approved.grant_token));
  assert.equal(db.grants[0].consent_version, CONSENT_VERSION);
  assert.equal(db.grants[0].consent_text, CONSENT_TEXT.client_bank);
  assert.equal(db.grants[0].privacy_url, PRIVACY_URL);
  assert.deepEqual(db.grants[0].consent_scope, ["accounts", "balances", "transactions"]);
  assert.equal(await advanceAccountPlaidLink(db, { ...identity, sessionId: "other-session",
    token: approved.grant_token, stage: "open" }), null);
  assert.equal(await advanceAccountPlaidLink(db, { ...identity, targetId: "other-client",
    token: approved.grant_token, stage: "open" }), null);
  assert.equal(await advanceAccountPlaidLink(db, { ...identity,
    token: approved.grant_token, stage: "exchange" }), null);
  assert.ok(await advanceAccountPlaidLink(db, { ...identity,
    token: approved.grant_token, stage: "open" }));
  assert.equal(await advanceAccountPlaidLink(db, { ...identity,
    token: approved.grant_token, stage: "open" }), null);
  assert.ok(await advanceAccountPlaidLink(db, { ...identity,
    token: approved.grant_token, stage: "exchange" }));
  assert.equal(await advanceAccountPlaidLink(db, { ...identity,
    token: approved.grant_token, stage: "exchange" }), null);
});

test("affiliate payout consent has its own scope and text", async () => {
  const db = fakeDb();
  const approved = await authorizeAccountPlaidLink(db, { ...identity,
    targetKind: "affiliate_payout", targetId: "affiliate-1", consent: true });
  assert.equal(approved.ok, true);
  assert.deepEqual(db.grants[0].consent_scope, ["payout_account"]);
  assert.equal(db.grants[0].consent_text, CONSENT_TEXT.affiliate_payout);
});

test("consent route pins target to the signed-in principal and exposes current wording", async () => {
  const principal = { kind: "client", accountId: identity.accountId,
    sessionId: identity.sessionId, orgId: identity.orgId, clientId: identity.targetId };
  const deps = { db: fakeDb(), requirePrincipal: async () => principal };
  const details = response();
  await plaidConsentRoute({ method: "POST", body: { action: "consent_details",
    target_kind: "client_bank" } }, details, deps);
  assert.equal(details.body.consent_text, CONSENT_TEXT.client_bank);
  assert.equal(details.body.privacy_url, PRIVACY_URL);
  let seen;
  const authorized = response();
  await plaidConsentRoute({ method: "POST", body: { action: "authorize",
    target_kind: "client_bank", target_id: "other-client", consent: true,
    code: "000000", account_id: "other-account" } }, authorized, {
    ...deps, authorize: async (_db, args) => { seen = args; return { ok: true, grant_token: "grant" }; }
  });
  assert.equal(authorized.statusCode, 200);
  assert.equal(seen.targetId, identity.targetId);
  assert.equal(seen.accountId, identity.accountId);
  assert.equal(seen.sessionId, identity.sessionId);
  assert.equal(seen.code, undefined);
  assert.equal(authorized.headers["Cache-Control"], "no-store");
  const oldSetup = response();
  await plaidConsentRoute({ method: "POST", body: { action: "setup",
    target_kind: "client_bank" } }, oldSetup, deps);
  assert.equal(oldSetup.statusCode, 400);
});
