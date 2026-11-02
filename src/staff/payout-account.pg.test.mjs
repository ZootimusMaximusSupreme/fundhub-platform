// Real Postgres proof of the staff payout destination. Runs only against a
// scratch database supplied by the caller; every fixture rolls back.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { completeStaffPayoutLink, currentStaffPayoutAccount } from "./payout-account.mjs";

const env = {
  STAFF_PLAID_TRANSFER_ENABLED: "1",
  STAFF_PLAID_ENV: "production",
  STAFF_PLAID_CLIENT_ID: "test-staff-id",
  STAFF_PLAID_SECRET: "test-staff-secret",
  STAFF_PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 4).toString("base64")
};

const DATABASE_URL = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const HAS_DB = isLocalScratchDatabaseUrl(DATABASE_URL);

describe("staff payout bank in Postgres", {
  skip: !HAS_DB ? "local scratch app-role database required" : false
}, () => {
  let client;
  let db;
  let orgId;
  let staffId;

  before(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    db = { query: (sql, params) => client.query(sql, params) };
    await client.query("BEGIN");
    const role = (await db.query("SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.name, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    orgId = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1, $2) RETURNING id", ["payout-proof-" + randomUUID(), "Payout proof"])).rows[0].id;
    staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Payout Bank Tester','closer','active') RETURNING id`,
      [orgId, `e2e+payout-bank-${randomUUID()}@example.test`]
    )).rows[0].id;
  });

  after(async () => {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* leave no fixture */ }
      assert.equal(Number((await client.query("SELECT count(*)::int AS n FROM orgs WHERE id=$1", [orgId])).rows[0].n), 0);
      await client.end();
    }
  });

  test("one active masked destination replaces the old bank without sending money", async () => {
    const fakePlaid = (item, account, mask) => ({
      linkAccount: async () => ({ ok: true, item: {
        plaidItemId: item, encryptedAccessToken: `encrypted-${item}`, environment: "production"
      } }),
      getAccounts: async () => ({ ok: true, accounts: [{
        plaidAccountId: account, type: "depository", subtype: "checking",
        name: "Checking", mask
      }] })
    });
    const first = await completeStaffPayoutLink(db, {
      orgId, staffId, publicToken: "fake-public-1", env,
      plaid: fakePlaid("item-first", "account-first", "1111")
    });
    assert.equal(first.ok, true);
    assert.equal(first.account.mask, "1111");
    const second = await completeStaffPayoutLink(db, {
      orgId, staffId, publicToken: "fake-public-2", env,
      plaid: fakePlaid("item-second", "account-second", "2222")
    });
    assert.equal(second.ok, true);
    const current = await currentStaffPayoutAccount(db, { orgId, staffId });
    assert.equal(current.mask, "2222");
    assert.equal(JSON.stringify(current).includes("encrypted-"), false);
    const rows = (await db.query(
      `SELECT status, account_mask FROM staff_payout_accounts
       WHERE org_id=$1 AND staff_id=$2 ORDER BY created_at`,
      [orgId, staffId]
    )).rows;
    assert.deepEqual(rows.map((row) => row.status).sort(), ["active", "replaced"]);
    assert.equal(rows.find((row) => row.status === "active")?.account_mask, "2222");
  });

  test("foreign, inactive and cross-org staff cannot replace a payout destination", async () => {
    const before = await currentStaffPayoutAccount(db, { orgId, staffId });
    const foreignOrg = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,'Foreign payout proof') RETURNING id", ["payout-foreign-" + randomUUID()])).rows[0].id;
    const foreignStaff = (await db.query("INSERT INTO staff (org_id,name,role,status) VALUES ($1,'Foreign','closer','active') RETURNING id", [foreignOrg])).rows[0].id;
    const refuseProvider = { linkAccount() { throw new Error("Provider must not be reached"); } };
    assert.equal((await completeStaffPayoutLink(db, { orgId, staffId: foreignStaff, publicToken: "fake", env, plaid: refuseProvider })).error, "not_eligible");
    assert.equal(await currentStaffPayoutAccount(db, { orgId: foreignOrg, staffId }), null);
    await db.query("SAVEPOINT inactive_staff");
    await db.query("UPDATE staff SET status='suspended' WHERE id=$1", [staffId]);
    assert.equal((await completeStaffPayoutLink(db, { orgId, staffId, publicToken: "fake", env, plaid: refuseProvider })).error, "not_eligible");
    await db.query("ROLLBACK TO SAVEPOINT inactive_staff");
    assert.deepEqual(await currentStaffPayoutAccount(db, { orgId, staffId }), before);
    await db.query("SAVEPOINT wrong_scope");
    await assert.rejects(db.query("INSERT INTO staff_payout_accounts (org_id,staff_id,environment,plaid_item_id,plaid_account_id,encrypted_access_token,consent_granted_at,linked_by_staff_id) VALUES ($1,$2,'production','wrong-item','wrong-account','synthetic',now(),$2)", [orgId,foreignStaff]), error => error.code === "23514");
    await db.query("ROLLBACK TO SAVEPOINT wrong_scope");
  });

  test("staff iPhone alert table accepts the payout kind after migration", async () => {
    const row = (await db.query(
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
        WHERE c.conrelid='staff_apns_alerts'::regclass
          AND c.conname='staff_apns_alerts_kind_check'`
    )).rows[0];
    assert.match(row?.definition || "", /payout/);
  });
});
