// Actual app-role aggregate SQL. All public fixtures roll back; corrupt-schema
// cases use TEMP copies only, never remove public constraints or call a provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../../verification/scratch-guard.mjs";
import { encryptPlaidToken } from "../../banking/plaid.mjs";
import { gapChecks, STAFF_PAYOUT_INTEGRITY_SQL } from "./gap-staff-payout-account.mjs";
const dsn = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const options = { skip: !isLocalScratchDatabaseUrl(dsn) && "local scratch app-role database required" };
async function fixture(run) {
  const sql = new pg.Client({ connectionString: dsn }); await sql.connect();
  try {
    await sql.query("BEGIN");
    const role = (await sql.query("SELECT current_user name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.name, "fundhub_app"); assert.equal(role.rolsuper || role.rolbypassrls, false);
    await run(sql);
  } finally { await sql.query("ROLLBACK"); await sql.end(); }
}
function reader(sql, orgId) {
  return () => gapChecks({ orgId, db: { query(text, params) {
    assert.equal(text, STAFF_PAYOUT_INTEGRITY_SQL, "the probe issues the single read-only aggregate, never writes");
    assert.deepEqual(params, [orgId]); return sql.query(text, params);
  } } });
}

test("real app-role staff destination truth reads migrated fields and catches a wrong self-linker", options, () => fixture(async sql => {
  const org = (await sql.query("INSERT INTO orgs(slug,name) VALUES($1,'Staff integrity proof') RETURNING id", ["staff-integrity-"+randomUUID()])).rows[0].id;
  const staff = [];
  for (let i=0;i<2;i++) staff.push((await sql.query("INSERT INTO staff(org_id,name,email,role,status) VALUES($1,'Staff integrity proof',$2,'closer','active') RETURNING id",[org,randomUUID()+"@example.test"])).rows[0].id);
  const item = "item-"+randomUUID(), account = "account-"+randomUUID();
  const ciphertext = encryptPlaidToken("synthetic-not-a-provider-token", { itemId: item, env: { PLAID_TOKEN_ENC_KEY: randomBytes(32).toString("base64") } });
  const saved = (await sql.query(`INSERT INTO staff_payout_accounts(org_id,staff_id,environment,plaid_item_id,plaid_account_id,encrypted_access_token,consent_granted_at,linked_by_staff_id)
    VALUES($1,$2,'production',$3,$4,$5,now(),$2) RETURNING id`,[org,staff[0],item,account,ciphertext])).rows[0].id;
  const check = reader(sql,org);
  assert.equal((await check())[0].status,"PASS");
  await sql.query("UPDATE staff_payout_accounts SET linked_by_staff_id=$2 WHERE id=$1",[saved,staff[1]]);
  const bad = (await check())[0]; assert.equal(bad.status,"FAIL"); assert.match(bad.detail,/owner 1/);
  assert.equal(JSON.stringify(bad).includes(item),false);assert.equal(JSON.stringify(bad).includes(ciphertext),false);
  await sql.query("UPDATE staff_payout_accounts SET linked_by_staff_id=$2 WHERE id=$1",[saved,staff[0]]);
  assert.equal((await check())[0].status,"PASS");
}));

test("real app-role SQL catches missing constraints' bad states without touching public schema", options, () => fixture(async sql => {
  await sql.query("CREATE TEMP TABLE staff ON COMMIT DROP AS SELECT * FROM public.staff WITH NO DATA");
  await sql.query("CREATE TEMP TABLE staff_payout_accounts ON COMMIT DROP AS SELECT * FROM public.staff_payout_accounts WITH NO DATA");
  await sql.query("SET LOCAL search_path=pg_temp,public");
  const org=randomUUID(),foreign=randomUUID(),staff=randomUUID(),other=randomUUID(),foreignStaff=randomUUID();
  await sql.query("INSERT INTO staff(id,org_id) VALUES($1,$2),($3,$2),($4,$5)",[staff,org,other,foreignStaff,foreign]);
  const base={org_id:org,staff_id:staff,linked_by_staff_id:staff,environment:"production",plaid_item_id:"fixture-item",plaid_account_id:"fixture-account",encrypted_access_token:"fixture-encrypted-value",consent_granted_at:new Date(),status:"active"};
  const insert=async over=>{const row={...base,...over};await sql.query(`INSERT INTO staff_payout_accounts(org_id,staff_id,linked_by_staff_id,environment,plaid_item_id,plaid_account_id,encrypted_access_token,consent_granted_at,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,Object.values(row));};
  const check=reader(sql,org);
  await insert({});assert.equal((await check())[0].status,"PASS");
  for(const [name,over] of [
    ["missing target",{staff_id:randomUUID()}],["foreign target",{staff_id:foreignStaff}],
    ["foreign linker",{linked_by_staff_id:foreignStaff}],["not self",{linked_by_staff_id:other}],
    ["sandbox",{environment:"sandbox"}],["development",{environment:"development"}],
    ["blank item",{plaid_item_id:" "}],["blank account",{plaid_account_id:""}],
    ["missing ciphertext",{encrypted_access_token:null}],["blank ciphertext",{encrypted_access_token:" "}],
    ["missing consent",{consent_granted_at:null}]
  ]){
    await sql.query("DELETE FROM pg_temp.staff_payout_accounts");await insert(over);
    assert.equal((await check())[0].status,"FAIL",name);
  }
  await sql.query("DELETE FROM pg_temp.staff_payout_accounts");await insert({});await insert({plaid_account_id:"other-account"});
  assert.match((await check())[0].detail,/duplicate staff 1/);
  await sql.query("DELETE FROM pg_temp.staff_payout_accounts");await insert({});await insert({staff_id:other,linked_by_staff_id:other});
  assert.match((await check())[0].detail,/duplicate bank 1/);
  await sql.query("DELETE FROM pg_temp.staff_payout_accounts");await insert({});
  await insert({org_id:foreign,staff_id:foreignStaff,linked_by_staff_id:foreignStaff,environment:"sandbox",plaid_item_id:"",plaid_account_id:"",encrypted_access_token:null});
  assert.equal((await check())[0].status,"PASS","another company's corrupt row cannot pollute this company-scoped result");
  await sql.query("DELETE FROM pg_temp.staff_payout_accounts");await insert({status:"replaced",encrypted_access_token:null});
  assert.equal((await check())[0].status,"PASS","replaced history is not an active payout destination");
}));
