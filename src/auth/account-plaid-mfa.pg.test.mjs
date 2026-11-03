// Stored proof for the account-facing Plaid MFA and consent flow.
// The existing CI PostgreSQL job discovers *.pg.test.mjs automatically.
// Fixtures are synthetic, every test rolls back, and all assertions execute
// with the actual fundhub_app role. Only the email transport is replaced.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import plaidMfaRoute from "../../api/auth/plaid-mfa.mjs";
import { createAccountSession } from "./account-session.mjs";
import { authorizeAccountPlaidLink, advanceAccountPlaidLink,
  CONSENT_VERSION, CONSENT_TEXT, PRIVACY_URL } from "./account-plaid-mfa.mjs";
import { hashToken } from "./session.mjs";
import { totpAt } from "./mfa.mjs";
import { eraseClient } from "../privacy/erasure.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const scratch = isLocalScratchDatabaseUrl(databaseUrl);
const consentFields = ["id", "token_hash", "org_id", "target_kind", "target_id",
  "consent_scope", "consent_version", "consent_text", "privacy_url",
  "consent_granted_at", "mfa_verified_at", "expires_at"];
const snapshot = row => Object.fromEntries(consentFields.map(key => [key, row[key]]));

describe("account Plaid MFA stored SQL and app-role proof", {
  skip: scratch ? false : "requires a loopback ci/test/scratch PostgreSQL database"
}, () => {
  let pool;
  before(() => { pool = new pg.Pool({ connectionString: databaseUrl, max: 2 }); });
  after(async () => { await pool?.end(); });

  async function fixture(run) {
    const db = await pool.connect();
    const stamp = "account-plaid-pg-" + crypto.randomUUID();
    const orgIds = [];
    try {
      await db.query("BEGIN");
      const env = { MFA_SECRET_ENC_KEY: crypto.randomBytes(32).toString("base64") };
      async function org(suffix) {
        const id = (await db.query(
          "INSERT INTO orgs (slug,name) VALUES ($1,$1) RETURNING id",
          [stamp + suffix])).rows[0].id;
        orgIds.push(id); return id;
      }
      async function subject(orgId, suffix) {
        const email = stamp + suffix + "@example.test";
        const clientId = (await db.query(
          "INSERT INTO clients (org_id,first_name,last_name,email) VALUES ($1,'Scratch','MFA',$2) RETURNING id",
          [orgId, email])).rows[0].id;
        const accountId = (await db.query(
          "INSERT INTO accounts (org_id,kind,email,status,password_hash,client_id) VALUES ($1,'client',$2,'active','scratch-not-a-login-password',$3) RETURNING id",
          [orgId, email, clientId])).rows[0].id;
        const session = await createAccountSession(db, { accountId, orgId, env });
        return { accountId, orgId, clientId, email, ...session };
      }
      const orgA = await org("-a"), orgB = await org("-b");
      const a = await subject(orgA, "-a"), b = await subject(orgA, "-b");
      const c = await subject(orgB, "-c");
      const second = await createAccountSession(db, { accountId: a.accountId, orgId: orgA, env });
      const a2 = { ...a, ...second };

      await db.query("SET LOCAL ROLE fundhub_app");
      const role = (await db.query(
        "SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"
      )).rows[0];
      assert.equal(role.name, "fundhub_app");
      assert.equal(role.rolsuper, false);
      assert.equal(role.rolbypassrls, false);

      const mail = [];
      async function invoke(who, body) {
        let status = 200, payload;
        const req = { method: "POST", url: "/api/auth/plaid-mfa", body,
          headers: who ? { authorization: "Bearer " + who.token } : {} };
        const res = { setHeader() {}, status(value) { status = value; return this; },
          json(value) { payload = value; return this; } };
        await plaidMfaRoute(req, res, { db, env, sendEmail: async message => {
          const code = message.body.match(/:\s(\d{6})/)[1];
          mail.push({ to: message.to, code }); return { mailed: true };
        } });
        return { status, body: payload };
      }
      const identity = who => ({ accountId: who.accountId, orgId: who.orgId,
        sessionId: who.sessionId, targetKind: "client_bank", targetId: who.clientId });
      async function receipt(grant) {
        return (await db.query("SELECT * FROM account_plaid_link_grants WHERE id=$1",
          [grant.grant_id])).rows[0];
      }
      async function mint(who = a) {
        const setup = await invoke(who, { action: "setup", target_kind: "client_bank" });
        assert.equal(setup.body.email_verification_required, true);
        const delivery = mail.at(-1);
        assert.equal(delivery.to, who.email);
        const verified = await invoke(who, { action: "verify_email", target_kind: "client_bank",
          email_code: delivery.code });
        assert.equal(verified.status, 200);
        const enrolled = await invoke(who, { action: "setup", target_kind: "client_bank" });
        assert.equal(enrolled.status, 200);
        const counter = Math.floor(Date.now() / 30000);
        const code = totpAt(enrolled.body.secret, counter);
        const authorized = await invoke(who, { action: "authorize", target_kind: "client_bank",
          code, consent: true });
        assert.equal(authorized.status, 200);
        return { ...authorized.body, code, counter, secret: enrolled.body.secret };
      }
      async function denied(sql, params, code) {
        await db.query("SAVEPOINT expected_refusal");
        try {
          await assert.rejects(() => db.query(sql, params), error => {
            assert.equal(error.code, code); return true;
          });
        } finally {
          await db.query("ROLLBACK TO SAVEPOINT expected_refusal");
          await db.query("RELEASE SAVEPOINT expected_refusal");
        }
      }
      return await run({ db, env, a, a2, b, c, invoke, identity, mint, receipt, denied, mail });
    } finally {
      try {
        await db.query("ROLLBACK");
        if (orgIds.length) {
          const left = (await db.query("SELECT count(*)::int AS n FROM orgs WHERE id=ANY($1::uuid[])",
            [orgIds])).rows[0].n;
          assert.equal(left, 0, "transaction rollback leaves no synthetic fixture orgs");
        }
      } finally { db.release(); }
    }
  }

  test("real account authentication and verified email are required before first enrollment", async () => {
    await fixture(async ({ db, a, a2, b, c, invoke, mail }) => {
      assert.equal((await invoke(null, { action: "setup", target_kind: "client_bank" })).status, 401);
      const setup = await invoke(a, { action: "setup", target_kind: "client_bank",
        email: b.email, account_id: b.accountId, org_id: c.orgId, client_id: b.clientId });
      assert.equal(setup.status, 200);
      assert.equal(setup.body.email_verification_required, true);
      assert.equal(setup.body.secret, undefined);
      assert.equal(mail.length, 1);
      assert.equal(mail[0].to, a.email, "mail destination comes from the stored authenticated account");
      assert.equal((await db.query("SELECT count(*)::int AS n FROM account_plaid_mfa_credentials WHERE account_id=$1",
        [a.accountId])).rows[0].n, 0);

      const challenge = (await db.query("SELECT * FROM account_plaid_mfa_email_challenges WHERE account_id=$1",
        [a.accountId])).rows[0];
      assert.equal(challenge.org_id, a.orgId);
      assert.equal(challenge.account_session_id, a.sessionId);
      assert.match(challenge.code_hash, /^[a-f0-9]{64}$/);
      assert.notEqual(challenge.code_hash, mail[0].code);
      assert.equal(challenge.verified_at, null);
      const wrongSession = await invoke(a2, { action: "verify_email", target_kind: "client_bank",
        email_code: mail[0].code });
      assert.equal(wrongSession.body.error, "email_code_expired");
      const wrongCode = mail[0].code === "000000" ? "111111" : "000000";
      assert.equal((await invoke(a, { action: "verify_email", target_kind: "client_bank",
        email_code: wrongCode })).body.error, "invalid_email_code");
      assert.equal((await db.query("SELECT attempts FROM account_plaid_mfa_email_challenges WHERE account_id=$1",
        [a.accountId])).rows[0].attempts, 1);

      assert.equal((await invoke(a, { action: "verify_email", target_kind: "client_bank",
        email_code: mail[0].code })).status, 200);
      const enrolled = await invoke(a, { action: "setup", target_kind: "client_bank" });
      assert.ok(enrolled.body.secret);
      const credential = (await db.query("SELECT * FROM account_plaid_mfa_credentials WHERE account_id=$1",
        [a.accountId])).rows[0];
      assert.notEqual(credential.secret_ciphertext, enrolled.body.secret);
      assert.equal(credential.confirmed_at, null);
      const code = totpAt(enrolled.body.secret, Math.floor(Date.now() / 30000));
      assert.equal((await invoke(a2, { action: "authorize", target_kind: "client_bank",
        code, consent: true })).body.error, "email_verification_required");
      assert.equal((await invoke(a, { action: "authorize", target_kind: "client_bank",
        code, consent: false })).body.error, "consent_required");
      assert.equal((await db.query("SELECT count(*)::int AS n FROM account_plaid_link_grants WHERE account_id=$1",
        [a.accountId])).rows[0].n, 0);
      const authorized = await invoke(a, { action: "authorize", target_kind: "client_bank",
        code, consent: true, account_id: b.accountId, org_id: c.orgId, target_id: b.clientId });
      assert.equal(authorized.status, 200);
      const grant = (await db.query("SELECT * FROM account_plaid_link_grants WHERE id=$1",
        [authorized.body.grant_id])).rows[0];
      assert.equal(grant.account_id, a.accountId);
      assert.equal(grant.org_id, a.orgId);
      assert.equal(grant.account_session_id, a.sessionId);
      assert.equal(grant.target_id, a.clientId, "body subject overrides do not retarget a real authenticated grant");
      assert.ok((await db.query("SELECT confirmed_at FROM account_plaid_mfa_credentials WHERE account_id=$1",
        [a.accountId])).rows[0].confirmed_at);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM account_plaid_mfa_email_challenges WHERE account_id=$1",
        [a.accountId])).rows[0].n, 0);
    });
  });

  test("stored consent and grant are account/session/org/target-bound and open/exchange only once", async () => {
    await fixture(async ({ db, env, a, a2, b, c, identity, mint, receipt }) => {
      const grant = await mint();
      const before = await receipt(grant), scope = identity(a);
      assert.equal(before.token_hash, hashToken(grant.grant_token));
      assert.notEqual(before.token_hash, grant.grant_token);
      assert.equal(before.consent_version, CONSENT_VERSION);
      assert.equal(before.consent_text, CONSENT_TEXT.client_bank);
      assert.equal(before.privacy_url, PRIVACY_URL);
      assert.deepEqual(before.consent_scope, ["accounts", "balances", "transactions"]);
      assert.ok(before.consent_granted_at && before.mfa_verified_at && before.expires_at);
      assert.equal(Number((await db.query("SELECT last_counter FROM account_plaid_mfa_credentials WHERE account_id=$1",
        [a.accountId])).rows[0].last_counter), grant.counter);
      assert.equal((await authorizeAccountPlaidLink(db, { ...scope, code: grant.code, consent: true, env })).error,
        "invalid_mfa_code", "the confirmed authenticator counter cannot be replayed");

      const wrong = [{ accountId: b.accountId }, { sessionId: a2.sessionId }, { orgId: c.orgId },
        { targetKind: "affiliate_payout" }, { targetId: b.clientId }];
      for (const overrides of wrong) {
        assert.equal(await advanceAccountPlaidLink(db, { ...scope, ...overrides,
          token: grant.grant_token, stage: "open" }), null);
      }
      assert.equal((await receipt(grant)).link_opened_at, null);
      assert.equal(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "exchange" }), null);
      assert.equal((await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "open" })).id, grant.grant_id);
      assert.equal(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "open" }), null);
      for (const overrides of wrong) {
        assert.equal(await advanceAccountPlaidLink(db, { ...scope, ...overrides,
          token: grant.grant_token, stage: "exchange" }), null);
      }
      assert.equal((await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "exchange" })).id, grant.grant_id);
      assert.equal(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "exchange" }), null);
      const after = await receipt(grant);
      assert.ok(after.link_opened_at && after.consumed_at);
      assert.deepEqual(snapshot(after), snapshot(before), "advancing the flow cannot rewrite its consent receipt");
    });
  });

  test("actual app-role privileges and scope triggers reject receipt tampering and cross-account inserts", async () => {
    await fixture(async ({ db, a, b, c, mint, receipt, denied }) => {
      const grant = await mint(), before = await receipt(grant);
      const privileges = (await db.query(
        "SELECT has_column_privilege(current_user,'account_plaid_link_grants','consent_text','UPDATE') AS rewrite,has_table_privilege(current_user,'account_plaid_link_grants','DELETE') AS erase,has_column_privilege(current_user,'account_plaid_link_grants','consumed_at','UPDATE') AS close"
      )).rows[0];
      assert.deepEqual(privileges, { rewrite: false, erase: false, close: true });
      await denied("UPDATE account_plaid_link_grants SET consent_text='rewritten' WHERE id=$1", [grant.grant_id], "42501");
      await denied("DELETE FROM account_plaid_link_grants WHERE id=$1", [grant.grant_id], "42501");
      const insert = "INSERT INTO account_plaid_link_grants (token_hash,org_id,account_id,account_session_id,target_kind,target_id,consent_scope,consent_version,consent_text,privacy_url) SELECT $1,$2,$3,$4,target_kind,target_id,consent_scope,consent_version,consent_text,privacy_url FROM account_plaid_link_grants WHERE id=$5";
      await denied(insert, [hashToken(crypto.randomBytes(32).toString("base64url")), c.orgId,
        a.accountId, a.sessionId, grant.grant_id], "23514");
      await denied(insert, [hashToken(crypto.randomBytes(32).toString("base64url")), a.orgId,
        a.accountId, b.sessionId, grant.grant_id], "23514");
      assert.deepEqual(snapshot(await receipt(grant)), snapshot(before));
      assert.equal((await db.query("SELECT count(*)::int AS n FROM account_plaid_link_grants WHERE org_id=ANY($1::uuid[])",
        [[a.orgId, c.orgId]])).rows[0].n, 1);
    });
  });

  test("real session/account deletion preserves consent receipts and leaves their grants unusable", async () => {
    await fixture(async ({ db, a, identity, mint, receipt }) => {
      const grant = await mint(), before = await receipt(grant), scope = identity(a);
      assert.ok(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "open" }));
      await db.query("DELETE FROM account_sessions WHERE id=$1", [a.sessionId]);
      assert.equal((await receipt(grant)).account_session_id, null);
      assert.equal(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "exchange" }), null);
      await db.query("DELETE FROM accounts WHERE id=$1", [a.accountId]);
      const after = await receipt(grant);
      assert.equal(after.account_id, null);
      assert.equal(after.account_session_id, null);
      assert.deepEqual(snapshot(after), snapshot(before));
      assert.equal((await db.query("SELECT count(*)::int AS n FROM account_plaid_mfa_credentials WHERE account_id=$1",
        [a.accountId])).rows[0].n, 0);
      assert.equal(await advanceAccountPlaidLink(db, { ...scope, token: grant.grant_token, stage: "open" }), null);
    });
  });

  test("actual erasure closes only the subject's in-flight grants and retains the stored audit receipt", async () => {
    await fixture(async ({ db, a, b, c, identity, mint, receipt }) => {
      const grantA = await mint(a), grantB = await mint(b), before = await receipt(grantA);
      const scope = identity(a);
      assert.ok(await advanceAccountPlaidLink(db, { ...scope, token: grantA.grant_token, stage: "open" }));
      await assert.rejects(() => eraseClient(db, { orgId: c.orgId, clientId: a.clientId,
        requestedBy: { label: "scratch actor" }, reason: "Synthetic cross-org erasure refusal" }),
      error => error.status === 404);
      assert.equal((await receipt(grantA)).consumed_at, null);
      const result = await eraseClient(db, { orgId: a.orgId, clientId: a.clientId,
        requestedBy: { label: "scratch actor" }, reason: "Synthetic client requests erasure in scratch proof" });
      assert.equal(result.erased, true);
      const after = await receipt(grantA);
      assert.ok(after.consumed_at);
      assert.deepEqual(snapshot(after), snapshot(before));
      assert.equal(await advanceAccountPlaidLink(db, { ...scope, token: grantA.grant_token, stage: "exchange" }), null);
      assert.equal((await receipt(grantB)).consumed_at, null, "another client's open consent remains unchanged");
      const audit = (await db.query("SELECT status,subject_client_id,kept FROM erasure_requests WHERE id=$1",
        [result.auditId])).rows[0];
      assert.equal(audit.status, "completed");
      assert.equal(audit.subject_client_id, a.clientId);
      assert.ok(audit.kept.length);
      assert.equal((await db.query("SELECT email FROM clients WHERE id=$1", [a.clientId])).rows[0].email, null);
    });
  });
});
