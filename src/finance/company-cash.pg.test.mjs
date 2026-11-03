// Real SQL proof in an isolated loopback test database. Synthetic rows roll back.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { createCompanyObligation, matchCompanyPayment, readCompanyCash } from "./company-cash.mjs";
import { companyBankRead, companyCompleteLink, companyPaymentMatches,
  companyRefreshBalance, companySync } from "./company-plaid.mjs";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const scratch = isLocalScratchDatabaseUrl(url);
const asOf = new Date("2026-11-12T17:00:00Z");
const migration = readFileSync(new URL("../../db/migrations/548_company_cash_workspace.sql", import.meta.url), "utf8");

describe("company cash SQL with real fundhub_app role", {
  skip: scratch ? false : "requires a loopback ci/test/scratch PostgreSQL database"
}, () => {
  let pool;
  before(() => { pool = new pg.Pool({ connectionString: url, max: 1 }); });
  after(async () => { await pool?.end(); });

  test("selected account, matching debit, unknown invoice and cross-org refusal", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      if (!(await db.query("SELECT to_regclass('public.company_plaid_items') AS found")).rows[0].found) {
        await db.query(migration);
      }
      const slug = "cash-pg-" + crypto.randomUUID();
      const orgA = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,$1) RETURNING id",
        [slug + "-a"])).rows[0].id;
      const orgB = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,$1) RETURNING id",
        [slug + "-b"])).rows[0].id;
      const staff = (await db.query(`INSERT INTO staff (org_id,email,name,role,status)
        VALUES ($1,$2,'Cash Tester','owner','active') RETURNING id`,
        [orgA, slug + "@example.test"])).rows[0].id;
      await db.query("SET LOCAL ROLE fundhub_app");
      const role = (await db.query(`SELECT current_user AS name,rolsuper,rolbypassrls
        FROM pg_roles WHERE rolname=current_user`)).rows[0];
      assert.deepEqual(role, { name: "fundhub_app", rolsuper: false, rolbypassrls: false });
      const item = (await db.query(`INSERT INTO company_plaid_items
        (org_id,plaid_item_id,encrypted_access_token,consent_text,consent_granted_at,linked_by_staff_id)
        VALUES ($1,$2,'synthetic encrypted token','read only',now(),$3) RETURNING id`,
        [orgA, slug, staff])).rows[0].id;
      const bank = (await db.query(`INSERT INTO company_bank_accounts
        (org_id,company_plaid_item_id,plaid_account_id,name,account_type,currency_code,
         available_balance_cents,current_balance_cents,balance_as_of,selected_for_cash,business_confirmed_by_staff_id,business_confirmed_at)
        VALUES ($1,$2,'acct-business','Business','depository','USD',100000,100000,$3,true,$4,$3)
        RETURNING id`, [orgA, item, asOf.toISOString(), staff])).rows[0].id;
      await db.query("SAVEPOINT duplicate_bank");
      await assert.rejects(() => db.query(`INSERT INTO company_bank_accounts
        (org_id,company_plaid_item_id,plaid_account_id,account_type,selected_for_cash,
         business_confirmed_by_staff_id,business_confirmed_at)
        VALUES ($1,$2,'other','depository',true,$3,now())`, [orgA, item, staff]),
      error => error.code === "23505");
      await db.query("ROLLBACK TO SAVEPOINT duplicate_bank");
      await db.query("RELEASE SAVEPOINT duplicate_bank");
      const debit = (await db.query(`INSERT INTO company_bank_transactions
        (org_id,company_bank_account_id,plaid_transaction_id,amount_cents,posted_on)
        VALUES ($1,$2,'crs-debit',-1185,'2026-10-12') RETURNING id`,
        [orgA, bank])).rows[0].id;
      const olderDebit = (await db.query(`INSERT INTO company_bank_transactions
        (org_id,company_bank_account_id,plaid_transaction_id,amount_cents,posted_on)
        VALUES ($1,$2,'older-crs-debit',-1185,'2026-10-01') RETURNING id`,
        [orgA, bank])).rows[0].id;
      await db.query(`INSERT INTO company_bank_transactions
        (org_id,company_bank_account_id,plaid_transaction_id,amount_cents,posted_on)
        SELECT $1,$2,'distractor-'||n,-100,'2026-11-11'
        FROM generate_series(1,110) AS n`, [orgA, bank]);
      const invoice = (await db.query(`INSERT INTO company_cash_obligations
        (org_id,kind,label,billing_month,source_ref,invoice_verified_at,invoice_covers_through_on,amount_cents,status,created_by_staff_id)
        VALUES ($1,'crs','CRS November','2026-11-01','invoice-1',$3,'2026-11-12',1185,'approved',$2) RETURNING id`,
        [orgA, staff, asOf.toISOString()])).rows[0].id;
      await db.query(`INSERT INTO company_cash_obligations
        (org_id,kind,label,billing_month,amount_cents,status,created_by_staff_id)
        VALUES ($1,'ad','No approved ads','2026-11-01',0,'approved',$2),
               ($1,'tech','No tech bills','2026-11-01',0,'approved',$2)`, [orgA, staff]);
      const before = await readCompanyCash(db, { orgId: orgA, asOf, metaSpend: async () => null });
      assert.equal(before.summary.available_cents, 98815);
      assert.equal(before.account.id, bank);
      const latest = await companyBankRead(db, { orgId: orgA });
      assert.equal(latest.transactions.some(row => row.id === debit), false,
        "newest 100 all-account transactions hide the valid older debit");
      const firstMatches = await companyPaymentMatches(db, { orgId: orgA,
        obligationId: invoice, limit: 1 });
      assert.deepEqual(firstMatches.transactions.map(row => row.id), [debit]);
      assert.equal(firstMatches.has_more, true);
      const secondMatches = await companyPaymentMatches(db, { orgId: orgA,
        obligationId: invoice, beforePostedOn: firstMatches.next_before_posted_on,
        beforeId: firstMatches.next_before_id, limit: 1 });
      assert.deepEqual(secondMatches.transactions.map(row => row.id), [olderDebit]);
      assert.equal(secondMatches.has_more, false);
      assert.deepEqual((await companyPaymentMatches(db, { orgId: orgB,
        obligationId: invoice })).transactions, []);
      const foreign = await matchCompanyPayment(db, { orgId: orgB, obligationId: invoice, transactionId: debit });
      assert.equal(foreign.ok, false);
      assert.equal((await db.query("SELECT status FROM company_cash_obligations WHERE id=$1", [invoice])).rows[0].status, "approved");
      const paid = await matchCompanyPayment(db, { orgId: orgA, obligationId: invoice, transactionId: debit });
      assert.equal(paid.ok, true);
      assert.deepEqual((await companyPaymentMatches(db, { orgId: orgA,
        obligationId: invoice })).transactions, [], "paid obligations have no available matches");
      const afterPaid = await readCompanyCash(db, { orgId: orgA, asOf, metaSpend: async () => null });
      assert.equal(afterPaid.summary.crs_reserve_cents, 0);
      assert.equal(afterPaid.summary.available_cents, 100000);
      const otherOrg = await readCompanyCash(db, { orgId: orgB, asOf, metaSpend: async () => null });
      assert.equal(otherOrg.account, null);
      assert.equal(otherOrg.summary.available_cents, null);
      await db.query("UPDATE company_cash_obligations SET invoice_verified_at=NULL,status='approved',paid_bank_transaction_id=NULL WHERE id=$1", [invoice]);
      const unknown = await readCompanyCash(db, { orgId: orgA, asOf, metaSpend: async () => null });
      assert.equal(unknown.summary.available_cents, null);
      assert.ok(unknown.summary.missing.includes("crs_invoice"));
      await db.query("UPDATE company_cash_obligations SET status='cancelled' WHERE id=$1", [invoice]);
      const olderInvoice = await createCompanyObligation(db, { orgId: orgA, staffId: staff,
        now: asOf, input: { kind: "crs", label: "October invoice covering November",
          billing_month: "2026-10-01", source_ref: "invoice-oct",
          amount_cents: 1185, invoice_verified: true,
          invoice_covers_through_on: "2026-11-11", status: "approved" } });
      assert.equal(olderInvoice.ok, true);
      assert.equal(olderInvoice.obligation.invoice_covers_through_on.toISOString().slice(0, 10),
        "2026-11-11");
      for (const invalidCutoff of ["2026-09-30", "2026-11-13"]) {
        await db.query("SAVEPOINT invalid_invoice_cutoff");
        await assert.rejects(() => db.query(`UPDATE company_cash_obligations
          SET invoice_covers_through_on=$2 WHERE id=$1`,
          [olderInvoice.obligation.id, invalidCutoff]), error => error.code === "23514");
        await db.query("ROLLBACK TO SAVEPOINT invalid_invoice_cutoff");
        await db.query("RELEASE SAVEPOINT invalid_invoice_cutoff");
      }
      assert.equal((await readCompanyCash(db, { orgId: orgA, asOf,
        metaSpend: async () => null })).summary.available_cents, 98815);
      const paidOlder = await matchCompanyPayment(db, { orgId: orgA,
        obligationId: olderInvoice.obligation.id, transactionId: olderDebit });
      assert.equal(paidOlder.ok, true);
      assert.equal((await readCompanyCash(db, { orgId: orgA, asOf,
        metaSpend: async () => null })).summary.available_cents, 100000);
      const client = (await db.query(`INSERT INTO clients (org_id,first_name,last_name)
        VALUES ($1,'Synthetic','Cash') RETURNING id`, [orgA])).rows[0].id;
      const resultId = (await db.query(`INSERT INTO crs_results
        (org_id,client_id,provider,provider_result_id,result)
        VALUES ($1,$2,'crs_softview',$3,$4::jsonb) RETURNING id`,
        [orgA, client, slug + "-covered",
          JSON.stringify({ environment: "production", simulated: false })])).rows[0].id;
      await db.query(`INSERT INTO soft_pull_requests
        (org_id,client_id,requested_by_kind,requested_by_staff_id,reason,cost_cents,
         crs_result_id,status,provider,requested_at,resolved_at)
        VALUES ($1,$2,'staff',$3,'synthetic covered pull',NULL,$4,'fulfilled','crs_softview',
          '2026-11-05T16:00:00Z','2026-11-05T17:00:00Z')`,
      [orgA, client, staff, resultId]);
      const covered = await readCompanyCash(db, { orgId: orgA, asOf,
        metaSpend: async () => null });
      assert.equal(covered.summary.crs_unpriced_pull_count, 1);
      assert.equal(covered.summary.crs_reserve_cents, 0,
        "paid October invoice covers earlier November unpriced pull");
      assert.equal(covered.summary.available_cents, 100000);
      const laterResult = (await db.query(`INSERT INTO crs_results
        (org_id,client_id,provider,provider_result_id,result)
        VALUES ($1,$2,'crs_softview',$3,$4::jsonb) RETURNING id`,
        [orgA, client, slug + "-later",
          JSON.stringify({ environment: "production", simulated: false })])).rows[0].id;
      await db.query(`INSERT INTO soft_pull_requests
        (org_id,client_id,requested_by_kind,requested_by_staff_id,reason,cost_cents,
         crs_result_id,status,provider,requested_at,resolved_at)
        VALUES ($1,$2,'staff',$3,'synthetic later pull',NULL,$4,'fulfilled','crs_softview',
          '2026-11-12T16:00:00Z','2026-11-12T17:00:00Z')`,
      [orgA, client, staff, laterResult]);
      const uncovered = await readCompanyCash(db, { orgId: orgA, asOf,
        metaSpend: async () => null });
      assert.equal(uncovered.summary.available_cents, null);
      assert.ok(uncovered.summary.missing.includes("crs_uncovered_pull_cost"));
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  test("pool-backed company read runs on a real repeatable-read snapshot", async () => {
    const client = await pool.connect();
    const boundPool = { totalCount: 1, async connect() {
      return { query: (sql, params) => client.query(sql, params), release() {} };
    } };
    try {
      // These are visible only to this one scratch connection and are dropped
      // by name from pg_temp below; no public schema objects are touched.
      await client.query(`CREATE TEMP TABLE company_plaid_items
        (id uuid,org_id uuid,institution_name text)`);
      await client.query(`CREATE TEMP TABLE company_bank_accounts
        (id uuid,org_id uuid,company_plaid_item_id uuid,selected_for_cash boolean,
         business_confirmed_at timestamptz,account_type text,holder_category text,
         currency_code text,current_balance_cents bigint,available_balance_cents bigint,
         balance_as_of timestamptz,name text,mask text)`);
      await client.query(`CREATE TEMP TABLE company_bank_transactions
        (id uuid,org_id uuid,company_bank_account_id uuid,posted_on date,is_pending boolean,
         removed_at timestamptz,amount_cents bigint)`);
      await client.query(`CREATE TEMP TABLE company_cash_obligations
        (id uuid,org_id uuid,paid_bank_transaction_id uuid,due_on date,created_at timestamptz,
         status text,kind text,billing_month date,invoice_verified_at timestamptz,
         invoice_covers_through_on date,amount_cents bigint)`);
      const out = await readCompanyCash(boundPool, { orgId: crypto.randomUUID(), asOf,
        metaSpend: async () => null });
      assert.equal(out.account, null);
      assert.equal(out.summary.available_cents, null);
      const state = await client.query("SELECT current_setting('transaction_isolation') AS level");
      assert.equal(state.rows[0].level, "read committed", "snapshot transaction ended before reuse");
    } finally {
      await client.query(`DROP TABLE IF EXISTS pg_temp.company_cash_obligations,
        pg_temp.company_bank_transactions,pg_temp.company_bank_accounts,pg_temp.company_plaid_items`);
      client.release();
    }
  });

  test("fake Plaid link, sync and explicit balance refresh persist safely under fundhub_app", async () => {
    const db = await pool.connect();
    const slug = "company-flow-" + crypto.randomUUID();
    const env = { OWNER_PLAID_CLIENT_ID: "test-client", OWNER_PLAID_SECRET: "test-secret",
      OWNER_PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 3).toString("base64"),
      OWNER_PLAID_ENV: "production" };
    const calls = { balances: 0, sync: 0 };
    const cached = { plaidAccountId: "business-1", name: "Business Checking", mask: "1234",
      type: "depository", holderCategory: "business", isoCurrencyCode: "USD",
      currentBalance: 50, availableBalance: 40 };
    const provider = {
      async exchangePublicToken() { return { ok: true, itemId: slug, accessToken: "synthetic-access" }; },
      async fetchAccounts() { return { ok: true, accounts: [cached] }; },
      async fetchBalances() { calls.balances++; return { ok: true, accounts: [{ ...cached,
        currentBalance: 1000, availableBalance: 900 }] }; },
      async syncTransactions() {
        calls.sync++;
        const tx = (id, amount) => ({ account_id: "business-1", transaction_id: id,
          amount, date: "2026-11-12", name: id, pending: false });
        return calls.sync === 1 ? { ok: true, nextCursor: "cursor-1",
          added: [tx("keep", 10), tx("remove", 5)], modified: [], removed: [] } :
          { ok: true, nextCursor: "cursor-2", added: [], modified: [tx("keep", 12)],
            removed: [{ account_id: "business-1", transaction_id: "remove" }] };
      }
    };
    let orgA;
    try {
      await db.query("BEGIN");
      if (!(await db.query("SELECT to_regclass('public.company_plaid_items') AS found")).rows[0].found) {
        await db.query(migration);
      }
      orgA = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,$1) RETURNING id",
        [slug + "-a"])).rows[0].id;
      const orgB = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,$1) RETURNING id",
        [slug + "-b"])).rows[0].id;
      const staff = (await db.query(`INSERT INTO staff (org_id,email,name,role,status)
        VALUES ($1,$2,'Company Flow Tester','owner','active') RETURNING id`,
        [orgA, slug + "@example.test"])).rows[0].id;
      await db.query("SET LOCAL ROLE fundhub_app");
      // The production helper owns BEGIN/COMMIT. Savepoints preserve the outer
      // test rollback while every INSERT/UPDATE remains real fundhub_app SQL.
      const scoped = { query(sql, params) {
        if (sql === "BEGIN") return db.query("SAVEPOINT company_flow");
        if (sql === "COMMIT") return db.query("RELEASE SAVEPOINT company_flow");
        if (sql === "ROLLBACK") return db.query("ROLLBACK TO SAVEPOINT company_flow");
        return db.query(sql, params);
      } };
      const linked = await companyCompleteLink(scoped, { orgId: orgA, staffId: staff,
        publicToken: "synthetic-public", accountId: "business-1", businessConfirmed: true,
        consentText: "read-only company balance and transaction access", env, provider, now: asOf });
      assert.equal(linked.ok, true);
      const tokenRow = (await db.query(`SELECT encrypted_access_token FROM company_plaid_items
        WHERE id=$1 AND org_id=$2`, [linked.itemId, orgA])).rows[0];
      assert.ok(tokenRow.encrypted_access_token);
      assert.notEqual(tokenRow.encrypted_access_token, "synthetic-access");
      const accountBefore = (await db.query(`SELECT id,balance_as_of,current_balance_cents
        FROM company_bank_accounts WHERE id=$1 AND org_id=$2`,
        [linked.selectedAccount.id, orgA])).rows[0];
      assert.equal(accountBefore.balance_as_of, null, "cached Link balance is unverified");
      assert.equal(accountBefore.current_balance_cents, null);
      const first = await companySync(scoped, { orgId: orgA, itemId: linked.itemId,
        env, provider, now: asOf });
      assert.equal(first.transactionCount, 2);
      const disabled = await companyRefreshBalance(scoped, { orgId: orgA,
        itemId: linked.itemId, env, provider, now: asOf });
      assert.equal(disabled.reason, "realtime_balance_not_enabled");
      assert.equal(calls.balances, 0);
      const refreshed = await companyRefreshBalance(scoped, { orgId: orgA,
        itemId: linked.itemId, env: { ...env, OWNER_PLAID_REALTIME_BALANCE_ENABLED: "1" },
        provider, now: asOf });
      assert.equal(refreshed.ok, true);
      assert.equal(calls.balances, 1);
      const second = await companySync(scoped, { orgId: orgA, itemId: linked.itemId,
        env, provider, now: asOf });
      assert.equal(second.removedCount, 1);
      const accountAfter = (await db.query(`SELECT current_balance_cents,available_balance_cents,balance_as_of
        FROM company_bank_accounts WHERE id=$1 AND org_id=$2`,
        [linked.selectedAccount.id, orgA])).rows[0];
      assert.equal(accountAfter.current_balance_cents, "100000");
      assert.equal(accountAfter.available_balance_cents, "90000");
      assert.equal(accountAfter.balance_as_of.toISOString(), asOf.toISOString(),
        "cached sync preserves the last real-time freshness timestamp");
      const txRows = (await db.query(`SELECT plaid_transaction_id,amount_cents,removed_at
        FROM company_bank_transactions WHERE org_id=$1 ORDER BY plaid_transaction_id`, [orgA])).rows;
      assert.deepEqual(txRows.map(row => [row.plaid_transaction_id, row.amount_cents,
        row.removed_at !== null]), [["keep", "-1200", false], ["remove", "-500", true]]);
      const own = await readCompanyCash(scoped, { orgId: orgA, asOf, metaSpend: async () => null });
      assert.equal(own.account.id, linked.selectedAccount.id);
      assert.equal(own.summary.bank_posted_cents, 100000);
      assert.equal(own.summary.available_cents, null, "unreviewed obligations stay unknown");
      const foreign = await readCompanyCash(scoped, { orgId: orgB, asOf, metaSpend: async () => null });
      assert.equal(foreign.account, null);
      assert.equal((await companySync(scoped, { orgId: orgB, itemId: linked.itemId,
        env, provider })).reason, "not_found");
      const syncedBeforeFailure = (await db.query(`SELECT transactions_cursor,last_synced_at
        FROM company_plaid_items WHERE id=$1`, [linked.itemId])).rows[0];
      provider.syncTransactions = async () => ({ ok: false,
        errorCode: "UNSAFE\nsynthetic-access" });
      const failedAt = new Date(asOf.getTime() + 60_000);
      const failed = await companySync(scoped, { orgId: orgA, itemId: linked.itemId,
        env, provider, now: failedAt });
      assert.deepEqual(failed, { ok: false, reason: "plaid_error", errorCode: "PLAID_ERROR" });
      const failedRow = (await db.query(`SELECT transactions_cursor,last_synced_at,
        last_sync_attempt_at,last_error_code FROM company_plaid_items WHERE id=$1`,
        [linked.itemId])).rows[0];
      assert.equal(failedRow.transactions_cursor, syncedBeforeFailure.transactions_cursor);
      assert.equal(failedRow.last_synced_at.toISOString(), syncedBeforeFailure.last_synced_at.toISOString());
      assert.equal(failedRow.last_sync_attempt_at.toISOString(), failedAt.toISOString());
      assert.equal(failedRow.last_error_code, "PLAID_ERROR");
      provider.syncTransactions = async () => {
        await db.query(`UPDATE company_plaid_items SET transactions_cursor='external'
          WHERE id=$1 AND org_id=$2`, [linked.itemId, orgA]);
        return { ok: true, nextCursor: "ours", added: [{ account_id: "business-1",
          transaction_id: "raced", amount: 3, date: "2026-11-12", name: "raced",
          pending: false }], modified: [], removed: [] };
      };
      const conflicted = await companySync(scoped, { orgId: orgA,
        itemId: linked.itemId, env, provider, now: new Date(asOf.getTime() + 120_000) });
      assert.deepEqual(conflicted, { ok: false, reason: "sync_conflict", retryable: true });
      const afterConflict = (await db.query(`SELECT transactions_cursor,last_synced_at,
        last_error_code FROM company_plaid_items WHERE id=$1`, [linked.itemId])).rows[0];
      assert.equal(afterConflict.transactions_cursor, "external");
      assert.equal(afterConflict.last_synced_at.toISOString(), syncedBeforeFailure.last_synced_at.toISOString());
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM company_bank_transactions
        WHERE org_id=$1 AND plaid_transaction_id='raced'`, [orgA])).rows[0].n, 0,
      "CAS conflict rolls back attempted transaction rows");
      assert.equal((await db.query(`SELECT current_balance_cents FROM company_bank_accounts
        WHERE id=$1`, [linked.selectedAccount.id])).rows[0].current_balance_cents, "100000");
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
    const leftovers = await pool.query("SELECT count(*)::int AS n FROM orgs WHERE slug=$1", [slug + "-a"]);
    assert.equal(leftovers.rows[0].n, 0);
  });
});
