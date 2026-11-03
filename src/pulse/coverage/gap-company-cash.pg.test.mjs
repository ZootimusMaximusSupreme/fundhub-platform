// Actual app-role SQL on loopback scratch only. Every fixture and migration roll back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../../verification/scratch-guard.mjs";
import { gapChecks, COMPANY_CASH_INTEGRITY_SQL } from "./gap-company-cash.mjs";

const dsn = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const options = { skip: !isLocalScratchDatabaseUrl(dsn) && "local scratch PostgreSQL database required" };
const migration = readFileSync(new URL("../../../db/migrations/548_company_cash_workspace.sql", import.meta.url), "utf8");

async function fixture(run) {
  const sql = new pg.Client({ connectionString: dsn });
  await sql.connect();
  try {
    await sql.query("BEGIN");
    if (!(await sql.query("SELECT to_regclass('public.company_plaid_items') AS found")).rows[0].found) {
      await sql.query(migration);
    }
    await sql.query("SET LOCAL ROLE fundhub_app");
    const role = (await sql.query(`SELECT current_user AS name, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.deepEqual(role, { name: "fundhub_app", rolsuper: false, rolbypassrls: false });
    await run(sql);
  } finally {
    await sql.query("ROLLBACK");
    await sql.end();
  }
}

function check(sql, orgId) {
  return gapChecks({ orgId, db: { query(text, params) {
    assert.equal(text, COMPANY_CASH_INTEGRITY_SQL);
    assert.deepEqual(params, [orgId]);
    return sql.query(text, params);
  } } });
}

test("real fundhub_app company bank proof catches selected account, owner and exact posted debit drift", options, () => fixture(async sql => {
  const slug = "pulse-cash-" + randomUUID();
  const orgId = (await sql.query("INSERT INTO orgs(slug,name) VALUES($1,'Company cash pulse proof') RETURNING id", [slug])).rows[0].id;
  const otherOrg = (await sql.query("INSERT INTO orgs(slug,name) VALUES($1,'Other company cash proof') RETURNING id", [slug + "-other"])).rows[0].id;
  const owner = (await sql.query(`INSERT INTO staff(org_id,name,email,role,status)
    VALUES($1,'Cash Owner',$2,'owner','active') RETURNING id`, [orgId, randomUUID() + "@example.test"])).rows[0].id;
  const item = (await sql.query(`INSERT INTO company_plaid_items
    (org_id,plaid_item_id,encrypted_access_token,consent_text,consent_granted_at,linked_by_staff_id)
    VALUES($1,$2,'synthetic ciphertext','Read company transactions',now(),$3) RETURNING id`,
    [orgId, "item-" + randomUUID(), owner])).rows[0].id;
  const bank = (await sql.query(`INSERT INTO company_bank_accounts
    (org_id,company_plaid_item_id,plaid_account_id,account_type,holder_category,currency_code,
     selected_for_cash,business_confirmed_by_staff_id,business_confirmed_at)
    VALUES($1,$2,'business-account','depository','business','USD',true,$3,now()) RETURNING id`,
    [orgId, item, owner])).rows[0].id;
  const debit = (await sql.query(`INSERT INTO company_bank_transactions
    (org_id,company_bank_account_id,plaid_transaction_id,amount_cents,posted_on)
    VALUES($1,$2,'posted-debit',-1185,CURRENT_DATE) RETURNING id`, [orgId, bank])).rows[0].id;
  const obligation = (await sql.query(`INSERT INTO company_cash_obligations
    (org_id,kind,label,billing_month,amount_cents,status,paid_bank_transaction_id,created_by_staff_id)
    VALUES($1,'crs','CRS invoice',date_trunc('month',CURRENT_DATE)::date,1185,'paid',$2,$3) RETURNING id`,
    [orgId, debit, owner])).rows[0].id;
  assert.equal((await check(sql, orgId))[0].status, "PASS");
  assert.match((await check(sql, otherOrg))[0].detail, /No company bank is linked/);
  await sql.query("UPDATE company_bank_transactions SET amount_cents=-1186 WHERE id=$1", [debit]);
  assert.match((await check(sql, orgId))[0].detail, /paid match 1/);
  await sql.query("UPDATE company_bank_transactions SET amount_cents=-1185, is_pending=true WHERE id=$1", [debit]);
  assert.equal((await check(sql, orgId))[0].status, "FAIL");
  await sql.query("UPDATE company_bank_transactions SET is_pending=false WHERE id=$1", [debit]);
  await sql.query("UPDATE company_bank_accounts SET currency_code='EUR' WHERE id=$1", [bank]);
  assert.match((await check(sql, orgId))[0].detail, /business account 1/);
  await sql.query("UPDATE company_bank_accounts SET currency_code='USD' WHERE id=$1", [bank]);
  await sql.query("UPDATE company_plaid_items SET consent_text=' ' WHERE id=$1", [item]);
  assert.match((await check(sql, orgId))[0].detail, /item 1/);
  await sql.query("UPDATE company_plaid_items SET consent_text='Read company transactions' WHERE id=$1", [item]);
  const foreignOwner = (await sql.query(`INSERT INTO staff(org_id,name,email,role,status)
    VALUES($1,'Foreign Owner',$2,'owner','active') RETURNING id`,
    [otherOrg, randomUUID() + "@example.test"])).rows[0].id;
  await sql.query("UPDATE company_cash_obligations SET created_by_staff_id=$1 WHERE id=$2", [foreignOwner, obligation]);
  assert.match((await check(sql, orgId))[0].detail, /obligation owner 1/);
}));

test("real fundhub_app aggregate catches corrupt cross-org, duplicate month and payment bindings in temp copies", options, () => fixture(async sql => {
  for (const table of ["staff", "company_plaid_items", "company_bank_accounts",
    "company_bank_transactions", "company_cash_obligations"]) {
    await sql.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`);
  }
  await sql.query("SET LOCAL search_path=pg_temp,public");
  const orgId = randomUUID(), otherOrg = randomUUID(), owner = randomUUID();
  const item = randomUUID(), bank = randomUUID(), debit = randomUUID(), obligation = randomUUID();
  await sql.query("INSERT INTO staff(id,org_id,role) VALUES($1,$2,'owner')", [owner, orgId]);
  await sql.query(`INSERT INTO company_plaid_items
    (id,org_id,plaid_item_id,encrypted_access_token,consent_text,consent_granted_at,linked_by_staff_id)
    VALUES($1,$2,'synthetic-item','synthetic ciphertext','Read company transactions',now(),$3)`,
    [item, orgId, owner]);
  await sql.query(`INSERT INTO company_bank_accounts
    (id,org_id,company_plaid_item_id,account_type,currency_code,selected_for_cash,
     business_confirmed_by_staff_id,business_confirmed_at)
    VALUES($1,$2,$3,'depository','USD',true,$4,now())`, [bank, orgId, item, owner]);
  await sql.query(`INSERT INTO company_bank_transactions
    (id,org_id,company_bank_account_id,amount_cents,posted_on,is_pending)
    VALUES($1,$2,$3,-100,CURRENT_DATE,false)`, [debit, orgId, bank]);
  await sql.query(`INSERT INTO company_cash_obligations
    (id,org_id,kind,billing_month,amount_cents,status,paid_bank_transaction_id,created_by_staff_id)
    VALUES($1,$2,'crs',date_trunc('month',CURRENT_DATE)::date,100,'paid',$3,$4)`,
    [obligation, orgId, debit, owner]);
  assert.equal((await check(sql, orgId))[0].status, "PASS");
  await sql.query("UPDATE company_plaid_items SET org_id=$1 WHERE id=$2", [otherOrg, item]);
  assert.match((await check(sql, orgId))[0].detail, /scope 1/);
  await sql.query("UPDATE company_plaid_items SET org_id=$1 WHERE id=$2", [orgId, item]);
  await sql.query("UPDATE company_bank_transactions SET org_id=$1 WHERE id=$2", [otherOrg, debit]);
  assert.match((await check(sql, orgId))[0].detail, /paid match 1/);
  await sql.query("UPDATE company_bank_transactions SET org_id=$1 WHERE id=$2", [orgId, debit]);
  await sql.query(`INSERT INTO company_cash_obligations
    (id,org_id,kind,billing_month,amount_cents,status,paid_bank_transaction_id,created_by_staff_id)
    VALUES($1,$2,'crs',date_trunc('month',CURRENT_DATE)::date,100,'paid',$3,$4)`,
    [randomUUID(), orgId, debit, owner]);
  const duplicated = (await check(sql, orgId))[0];
  assert.equal(duplicated.status, "FAIL");
  assert.match(duplicated.detail, /duplicate CRS month 1/);
  assert.match(duplicated.detail, /duplicate payment 1/);
  assert.equal(JSON.stringify(duplicated).includes(orgId), false);
}));
