// Scratch PostgreSQL proof for the account-facing Plaid consent grant.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import plaidConsentRoute from "../../api/auth/plaid-mfa.mjs";
import { createAccountSession } from "./account-session.mjs";
import { advanceAccountPlaidLink, CONSENT_VERSION, CONSENT_TEXT, PRIVACY_URL } from "./account-plaid-mfa.mjs";
import { passkeyAction, bankPasskeyAssurance } from "./passkey-stepup.mjs";
import { syntheticPasskey } from "./passkey-test-support.mjs";
import { hashToken } from "./session.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const scratch = isLocalScratchDatabaseUrl(databaseUrl);

describe("account Plaid consent stored SQL and app-role proof", {
  skip: scratch ? false : "requires a loopback ci/test/scratch PostgreSQL database"
}, () => {
  let pool;
  before(() => { pool = new pg.Pool({ connectionString: databaseUrl, max: 2 }); });
  after(async () => { await pool?.end(); });

  async function fixture(run) {
    const db = await pool.connect();
    const stamp = "account-plaid-consent-" + crypto.randomUUID();
    const orgIds = [];
    try {
      await db.query("BEGIN");
      const env = {};
      async function org(suffix) {
        const id = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,$1) RETURNING id",
          [stamp + suffix])).rows[0].id;
        orgIds.push(id); return id;
      }
      async function subject(orgId, suffix) {
        const email = stamp + suffix + "@example.test";
        const clientId = (await db.query(
          "INSERT INTO clients (org_id,first_name,last_name,email) VALUES ($1,'Scratch','Consent',$2) RETURNING id",
          [orgId, email])).rows[0].id;
        const accountId = (await db.query(
          "INSERT INTO accounts (org_id,kind,email,status,password_hash,client_id) VALUES ($1,'client',$2,'active','scratch-not-a-login-password',$3) RETURNING id",
          [orgId, email, clientId])).rows[0].id;
        const session = await createAccountSession(db, { accountId, orgId, env });
        return { accountId, orgId, clientId, ...session };
      }
      const orgA = await org("-a"), orgB = await org("-b");
      const a = await subject(orgA, "-a"), b = await subject(orgA, "-b"), c = await subject(orgB, "-c");
      const second = await createAccountSession(db, { accountId: a.accountId, orgId: orgA, env });
      const a2 = { ...a, ...second };
      await db.query("SET LOCAL ROLE fundhub_app");
      const role = (await db.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
      assert.deepEqual(role, { name: "fundhub_app", rolsuper: false, rolbypassrls: false });
      async function invoke(who, body) {
        let status = 200, payload;
        const req = { method: "POST", url: "/api/auth/plaid-mfa", body,
          headers: who ? { authorization: "Bearer " + who.token } : {} };
        const res = { setHeader() {}, status(value) { status = value; return this; },
          json(value) { payload = value; return this; } };
        await plaidConsentRoute(req, res, { db, env });
        return { status, body: payload };
      }
      const identity = who => ({ accountId: who.accountId, orgId: who.orgId,
        sessionId: who.sessionId, targetKind: "client_bank", targetId: who.clientId });
      async function enrollAndVerify(who = a) {
        const scope = identity(who);
        if (await bankPasskeyAssurance(db, scope)) return;
        const key = syntheticPasskey();
        const setup = await passkeyAction(db, scope, { action: "register_options" });
        assert.equal(setup.ok, true);
        assert.equal((await passkeyAction(db, scope, { action: "register_verify", challenge_token: setup.challenge_token,
          response: key.registration(setup.options) })).ok, true);
        const auth = await passkeyAction(db, scope, { action: "authenticate_options" });
        assert.equal((await passkeyAction(db, scope, { action: "authenticate_verify", challenge_token: auth.challenge_token,
          response: key.assertion(auth.options) })).ok, true);
      }
      async function mint(who = a) {
        await enrollAndVerify(who);
        const result = await invoke(who, { action: "authorize", target_kind: "client_bank", consent: true });
        assert.equal(result.status, 200);
        return result.body;
      }
      const receipt = async grant => (await db.query("SELECT * FROM account_plaid_link_grants WHERE id=$1",
        [grant.grant_id])).rows[0];
      return await run({ db, a, a2, b, c, invoke, identity, mint, receipt, enrollAndVerify });
    } finally {
      try {
        await db.query("ROLLBACK");
        if (orgIds.length) {
          const left = (await db.query("SELECT count(*)::int AS n FROM orgs WHERE id=ANY($1::uuid[])",
            [orgIds])).rows[0].n;
          assert.equal(left, 0, "rollback leaves no synthetic orgs");
        }
      } finally { db.release(); }
    }
  }

  test("signed-in client needs a verified passkey assertion before consent can authorize Plaid", async () => {
    await fixture(async ({ db, a, b, c, invoke, receipt, enrollAndVerify }) => {
      assert.equal((await invoke(null, { action: "consent_details", target_kind: "client_bank" })).status, 401);
      const details = await invoke(a, { action: "consent_details", target_kind: "client_bank" });
      assert.equal(details.body.consent_text, CONSENT_TEXT.client_bank);
      assert.equal((await invoke(a, { action: "authorize", target_kind: "client_bank", consent: false })).body.error,
        "consent_required");
      assert.equal((await db.query("SELECT count(*)::int AS n FROM account_plaid_link_grants WHERE account_id=$1",
        [a.accountId])).rows[0].n, 0);
      assert.equal((await invoke(a, { action: "authorize", target_kind: "client_bank", consent: true })).body.error,
        "passkey_required");
      await enrollAndVerify(a);
      const authorized = await invoke(a, { action: "authorize", target_kind: "client_bank",
        consent: true, account_id: b.accountId, org_id: c.orgId, target_id: b.clientId });
      assert.equal(authorized.status, 200);
      const row = await receipt(authorized.body);
      assert.equal(row.account_id, a.accountId);
      assert.equal(row.org_id, a.orgId);
      assert.equal(row.account_session_id, a.sessionId);
      assert.equal(row.target_id, a.clientId);
      assert.equal(row.token_hash, hashToken(authorized.body.grant_token));
      assert.equal(row.consent_version, CONSENT_VERSION);
      assert.equal(row.consent_text, CONSENT_TEXT.client_bank);
      assert.equal(row.privacy_url, PRIVACY_URL);
      assert.deepEqual(row.consent_scope, ["accounts", "balances", "transactions"]);
      assert.ok(row.consent_granted_at && row.expires_at);
      assert.ok(row.mfa_verified_at, "verified passkey assertion supplies the timestamp, never consent alone");
      assert.equal((await db.query("SELECT count(*)::int AS n FROM account_plaid_mfa_credentials WHERE account_id=$1",
        [a.accountId])).rows[0].n, 0);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM account_plaid_mfa_email_challenges WHERE account_id=$1",
        [a.accountId])).rows[0].n, 0);
    });
  });

  test("grant is bound to account, session, org and target, then used only once", async () => {
    await fixture(async ({ db, a, a2, b, c, identity, mint, receipt }) => {
      const grant = await mint(), scope = identity(a), before = await receipt(grant);
      const wrong = [{ accountId: b.accountId }, { sessionId: a2.sessionId },
        { orgId: c.orgId }, { targetKind: "affiliate_payout" }, { targetId: b.clientId }];
      for (const overrides of wrong) assert.equal(await advanceAccountPlaidLink(
        db, { ...scope, ...overrides, token: grant.grant_token, stage: "open" }), null);
      assert.equal((await receipt(grant)).link_opened_at, null);
      assert.equal(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "exchange" }), null);
      assert.ok(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "open" }));
      assert.equal(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "open" }), null);
      assert.ok(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "exchange" }));
      assert.equal(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "exchange" }), null);
      const after = await receipt(grant);
      assert.equal(after.consent_text, before.consent_text);
      assert.equal(after.consent_granted_at.toISOString(), before.consent_granted_at.toISOString());
    });
  });
});
