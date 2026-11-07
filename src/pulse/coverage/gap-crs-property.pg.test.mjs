// Corruption probes in connection-local copies only, under the actual app role.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../../verification/scratch-guard.mjs";
import { gapChecks } from "./gap-crs-property.mjs";

const dsn = process.env.DATABASE_URL;
const options = { skip: !isLocalScratchDatabaseUrl(dsn) && "guarded loopback scratch PostgreSQL required" };

async function fixture(run) {
  const db = new pg.Client({ connectionString: dsn }); await db.connect();
  try {
    await db.query("BEGIN"); await db.query("SET LOCAL ROLE fundhub_app");
    assert.deepEqual((await db.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0],
      { name: "fundhub_app", rolsuper: false, rolbypassrls: false });
    for (const table of ["clients", "staff", "crs_property_requests"]) {
      await db.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`);
    }
    await db.query("SET LOCAL search_path=pg_temp,public");
    const orgId=randomUUID(), otherOrg=randomUUID(), clientId=randomUUID(), staffId=randomUUID(), requestId=randomUUID();
    await db.query("INSERT INTO clients(id,org_id) VALUES($1,$2)", [clientId,orgId]);
    await db.query("INSERT INTO staff(id,org_id) VALUES($1,$2)", [staffId,orgId]);
    const report={product:"PitchPoint Property Ownership (Foreclosure)",providerRequestId:requestId,
      summary:{relatedAddressCount:0,ownedPropertyCount:0,foreclosureEventCount:0},
      associatedAddressCount:0,properties:[],currentMortgageBalance:null,currentEquity:null,currentValuation:null};
    const id=randomUUID();
    await db.query(`INSERT INTO crs_property_requests(id,org_id,client_id,requester_staff_id,operation_id,
      environment,identity_fingerprint,identity_version_fingerprint,consent_text,consent_version,consent_accepted_at,
      status,provider_request_id,normalized_response,created_at,finished_at,updated_at)
      VALUES($1,$2,$3,$4,$5,'production',$6,$7,$8,'property-report-2026-11-06',now(),
      'completed',$9,$10,now(),now(),now())`, [id,orgId,clientId,staffId,randomUUID(),"a".repeat(64),"b".repeat(64),
      "Synthetic property-report permission recorded for the exact client.",requestId,report]);
    const check=async (scope=orgId) => (await gapChecks({orgId:scope,db}))[0];
    await run({db,orgId,otherOrg,clientId,id,requestId,report,check});
  } finally { await db.query("ROLLBACK"); await db.end(); }
}

test("actual property ledger SQL catches scope, consent, receipt, shape and invented-equity drift without identifiers", options,
  () => fixture(async ({db,orgId,otherOrg,clientId,id,report,check}) => {
    assert.equal((await check()).status,"PASS");
    const empty=await check(otherOrg); assert.equal(empty.status,"PASS"); assert.match(empty.detail,/No property reports are saved/);
    await db.query("UPDATE clients SET org_id=$1 WHERE id=$2",[otherOrg,clientId]);
    assert.match((await check()).detail,/scope_n=1/);
    await db.query("UPDATE clients SET org_id=$1 WHERE id=$2",[orgId,clientId]);
    await db.query("UPDATE crs_property_requests SET consent_text='' WHERE id=$1",[id]);
    assert.match((await check()).detail,/consent_n=1/);
    await db.query("UPDATE crs_property_requests SET consent_text=$2 WHERE id=$1",[id,"Synthetic property-report permission recorded for the exact client."]);
    await db.query("UPDATE crs_property_requests SET identity_version_fingerprint='bad' WHERE id=$1",[id]);
    assert.match((await check()).detail,/identity_n=1/);
    await db.query("UPDATE crs_property_requests SET identity_version_fingerprint=$2 WHERE id=$1",[id,"b".repeat(64)]);
    const brokenReports=[
      {...report,providerRequestId:randomUUID()},
      {...report,summary:{...report.summary,ownedPropertyCount:null}},
      {...report,summary:{...report.summary,ownedPropertyCount:"0"}},
      {...report,associatedAddressCount:1},
      {...report,currentEquity:450000},
      {...report,currentMortgageBalance:0},
      {...report,associatedAddressCount:1,properties:[null]},
      {...report,associatedAddressCount:1,properties:[{borrowerOwnedAsset:false,address:{},transactions:"invalid"}]},
      {...report,associatedAddressCount:1,properties:[{borrowerOwnedAsset:false,address:{},providerCurrentOwners:"invalid",
        transactionCount:0,transactionsTruncated:false,transactions:[]}]},
      {...report,associatedAddressCount:1,properties:[{borrowerOwnedAsset:false,address:{},providerCurrentOwners:[],
        transactionCount:1,transactionsTruncated:false,transactions:[null]}]},
      {...report,associatedAddressCount:1,properties:[{borrowerOwnedAsset:false,address:{},providerCurrentOwners:[],
        recordedRecentSalePrice:-1,transactionCount:0,transactionsTruncated:false,transactions:[]}]},
      {...report,associatedAddressCount:1,properties:[{borrowerOwnedAsset:false,address:{},providerCurrentOwners:[],
        recordedRecentSalePrice:null,transactionCount:1,transactionsTruncated:false,
        transactions:[{originalLoanAmount:-1,salePrice:null}]}]},
      {...report,associatedAddressCount:1,properties:[{borrowerOwnedAsset:false,address:{},providerCurrentOwners:[],
        recordedRecentSalePrice:null,transactionCount:1,transactionsTruncated:false,
        transactions:[{originalLoanAmount:null,salePrice:-1}]}]},
      {...report,Input:{SSN:"synthetic-private-marker"}}
    ];
    for(const broken of brokenReports){
      await db.query("UPDATE crs_property_requests SET normalized_response=$2 WHERE id=$1",[id,broken]);
      const result=await check();assert.equal(result.status,"FAIL");assert.doesNotMatch(result.detail,/synthetic-private-marker|450000/);
    }
    await db.query("UPDATE crs_property_requests SET normalized_response=$2 WHERE id=$1",[id,report]);
    assert.equal((await check()).status,"PASS");
  }));

test("actual property ledger SQL keeps uncertain, failed, stalled and duplicate provider receipts red", options,
  () => fixture(async ({db,id,check}) => {
    for(const status of ["needs_review","error"]){
      await db.query("UPDATE crs_property_requests SET status=$2 WHERE id=$1",[id,status]);
      assert.match((await check()).detail,/unresolved_n=1/);
    }
    await db.query("UPDATE crs_property_requests SET status='in_flight',created_at=now()-interval '16 minutes',finished_at=NULL WHERE id=$1",[id]);
    assert.match((await check()).detail,/stalled_n=1/);
    await db.query("UPDATE crs_property_requests SET status='completed',created_at=now(),finished_at=now() WHERE id=$1",[id]);
    await db.query(`INSERT INTO crs_property_requests SELECT * FROM crs_property_requests WHERE id=$1`,[id]);
    assert.match((await check()).detail,/duplicate_receipt_n=2/);
  }));

test("actual property ledger SQL keeps an order that claims the client's saved permission without that consent row red", options,
  () => fixture(async ({db,id,check}) => {
    assert.equal((await check()).status,"PASS");
    // The connection-local copy carries no CHECK, so the ledger read itself must catch each shape.
    await db.query("UPDATE crs_property_requests SET consent_source='client',client_consent_id=NULL WHERE id=$1",[id]);
    assert.match((await check()).detail,/client_consent_n=1/);
    await db.query("UPDATE crs_property_requests SET consent_source='client',client_consent_id=$2 WHERE id=$1",[id,randomUUID()]);
    assert.match((await check()).detail,/client_consent_n=1/);
    await db.query("UPDATE crs_property_requests SET consent_source='staff',client_consent_id=$2 WHERE id=$1",[id,randomUUID()]);
    assert.match((await check()).detail,/client_consent_n=1/);
    await db.query("UPDATE crs_property_requests SET consent_source='staff',client_consent_id=NULL WHERE id=$1",[id]);
    assert.equal((await check()).status,"PASS");
  }));
