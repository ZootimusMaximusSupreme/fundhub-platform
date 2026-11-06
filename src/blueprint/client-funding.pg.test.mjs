import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { grantFromTransaction } from "../entitlements/entitlements.mjs";
import { getBlueprintFulfillmentAccess, requireBlueprintFulfillmentScope } from "./fulfillment-access.mjs";
import { readBlueprintFunding, openBlueprintLender, reportBlueprintApplication, finishBlueprintSubmissions } from "./client-funding.mjs";
import fundingApi from "../../api/blueprint/funding.mjs";
import { onMailResponse } from "../handlers/comms.mjs";
import { isBlueprintCoachClient } from "./coach.mjs";

const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const ownerUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const available = isLocalScratchDatabaseUrl(url) && isLocalScratchDatabaseUrl(ownerUrl);
test("verified purchase → owner-scoped lender handoff → report → exact purchased round closure", {skip:!available}, async t => {
  const pool = new pg.Pool({connectionString:url, max:6});
  const owner = new pg.Pool({connectionString:ownerUrl,max:1});
  const location = value => { const u = new URL(value); return [u.hostname,u.port,u.pathname]; };
  assert.deepEqual(location(url),location(ownerUrl));
  const orgId = randomUUID();
  const person = randomUUID();
  const other = randomUUID();
  const accountId = randomUUID();
  const banks = [randomUUID(),randomUUID()];
  const paid = randomUUID();
  // The scratch DB keeps append-only financial/entitlement evidence. Test rows
  // live only in this unique synthetic organization. Never bypass those guards.
  t.after(() => Promise.all([pool.end(),owner.end()]));
  assert.equal((await pool.query("select current_user")).rows[0].current_user,"fundhub_app");
  await owner.query("INSERT INTO orgs(id,slug,name) VALUES($1,$2,'Synthetic Blueprint business')",[orgId,"core-"+orgId]);
  await owner.query("INSERT INTO clients(id,org_id,first_name,custom_fields) VALUES($1,$2,'Synthetic', $3),($4,$2,'Other','{}')",
    [person,orgId,{home_state:"AZ",crs_negative_items_count:0},other]);
  await owner.query("INSERT INTO accounts(id,org_id,client_id,kind,status,email,password_hash) VALUES($1,$2,$3,'client','active',$4,'synthetic-fixture')",
    [accountId,orgId,person,"blueprint+"+person+"@example.test"]);
  await owner.query(`INSERT INTO products(org_id,code,name) VALUES ($1,'blueprint-self-funding','Synthetic full'),($1,'consulting-package','Synthetic prep')`,[orgId]);
  await owner.query(`INSERT INTO entitlement_catalog(org_id,code,name,kind) VALUES
    ($1,'blueprint-client-fulfillment','Full','service'),($1,'credit-optimization-roadmap','Plan','service')`,[orgId]);
  await owner.query(`INSERT INTO product_entitlements(org_id,product_code,entitlement_code) VALUES
    ($1,'blueprint-self-funding','blueprint-client-fulfillment'),($1,'blueprint-self-funding','credit-optimization-roadmap'),
    ($1,'consulting-package','credit-optimization-roadmap')`,[orgId]);
  const scope = {orgId,clientId:person,accountId,now:new Date()};
  assert.equal(await getBlueprintFulfillmentAccess(pool,scope),null);
  await owner.query(`INSERT INTO transactions(id,org_id,client_id,product_name,amount_paid,status) VALUES
    ($1,$2,$3,'Synthetic full',30000,'succeeded')`,[paid,orgId,person]);
  const purchase = {orgId,clientId:person,transactionId:paid,productCode:"blueprint-self-funding"};
  await Promise.all([grantFromTransaction(pool,purchase),grantFromTransaction(pool,purchase)]);
  scope.now = new Date();
  scope.engagement = await getBlueprintFulfillmentAccess(pool,scope);
  assert.equal(scope.engagement.executionOwner,"client");
  assert.equal(scope.engagement.roundId,null);
  assert.equal(await isBlueprintCoachClient(pool,scope),true);
  assert.equal(await getBlueprintFulfillmentAccess(pool,{orgId,clientId:other}),null);
  assert.equal((await readBlueprintFunding(pool,scope)).state,"needs_file");
  await owner.query(`INSERT INTO lenders(id,org_id,lender_table,name,application_url,eligible_states,bureaus_pulled,priority_tier,active,is_demo)
      VALUES($1,$3,'PersonalCC','Alpha','https://alpha.example.test/apply','AZ','EX',1,true,false),
            ($2,$3,'PersonalCC','Beta','https://beta.example.test/apply','AZ','TU',2,true,false)`,[...banks,orgId]);
  await owner.query("INSERT INTO crs_results(org_id,client_id,result,is_demo) VALUES($1,$2,$3,false)",[orgId,person,{scores:{ex:715,eq:710,tu:720}}]);
  const decision = await readBlueprintFunding(pool,scope);
  assert.equal(decision.state,"ready",JSON.stringify(decision));
  assert.equal(decision.lenders[0].id,banks[0]);
  assert.equal(decision.lenders[1].available,false);
  assert.ok(!JSON.stringify(decision).includes("https://alpha."));
  await assert.rejects(openBlueprintLender(pool,scope,{lenderId:banks[1]}),/lender_not_available/);
  await assert.rejects(openBlueprintLender(pool,scope,{lenderId:banks[0],businessId:randomUUID()}),/lender_not_available/);
  await owner.query("UPDATE blueprint_fulfillment_engagements SET opens_at=now()+interval '1 day' WHERE id=$1",[scope.engagement.id]);
  await assert.rejects(openBlueprintLender(pool,scope,{lenderId:banks[0]}),/scheduled/);
  await owner.query("UPDATE blueprint_fulfillment_engagements SET opens_at=now()-interval '1 second' WHERE id=$1",[scope.engagement.id]);
  const [first,replay] = await Promise.all([openBlueprintLender(pool,scope,{lenderId:banks[0],idempotencyKey:"open:A"}),openBlueprintLender(pool,scope,{lenderId:banks[0],idempotencyKey:"open:A"})]);
  await assert.rejects(openBlueprintLender(pool,scope,{lenderId:banks[1],idempotencyKey:"open:A"}),/idempotency_key_conflict/);
  assert.deepEqual(first,replay);
  assert.equal(first.url,"https://alpha.example.test/apply");
  scope.engagement = await getBlueprintFulfillmentAccess(pool,scope);
  assert.ok(scope.engagement.roundId);
  await assert.rejects(openBlueprintLender(pool,scope,{lenderId:banks[1]}),/lender_not_available/);
  await assert.rejects(reportBlueprintApplication(pool,scope,{applicationId:first.applicationId,status:"approved",evidenceDocumentId:randomUUID()}),/evidence_not_found/);
  const report = {applicationId:first.applicationId,status:"approved",reference:"SYN-fixture-123",approvedAmount:5100};
  await Promise.all([reportBlueprintApplication(pool,scope,report),reportBlueprintApplication(pool,scope,report)]);
  const recorded = (await readBlueprintFunding(pool,scope)).applications[0];
  assert.equal(recorded.reportedStatus,"approved");
  assert.equal(recorded.status,"Applied");
  assert.equal(recorded.approvedAmount,null);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM blueprint_application_reports WHERE handoff_id=$1",[first.handoffId])).rows[0].n,1);
  await owner.query("UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{crs_negative_items_count}','1') WHERE id=$1",[person]);
  assert.equal((await readBlueprintFunding(pool,scope)).state,"optimize");
  await assert.rejects(openBlueprintLender(pool,scope,{lenderId:banks[1]}),/lender_not_available/);
  await owner.query("UPDATE clients SET custom_fields=jsonb_set(custom_fields,'{crs_negative_items_count}','0'),tags=ARRAY['fraud:alert-present'] WHERE id=$1",[person]);
  await assert.rejects(openBlueprintLender(pool,scope,{lenderId:banks[1]}),/funding_hold/);
  await owner.query("UPDATE clients SET tags='{}' WHERE id=$1",[person]);
  const prep = randomUUID();
  await owner.query("INSERT INTO transactions(id,org_id,client_id,product_name,amount_paid,status) VALUES($1,$2,$3,'Synthetic prep',5000,'succeeded')",[prep,orgId,person]);
  await grantFromTransaction(pool,{...purchase,transactionId:prep,productCode:"consulting-package"});
  await finishBlueprintSubmissions(pool,scope,{idempotencyKey:"batch-finished"});
  scope.engagement=await getBlueprintFulfillmentAccess(pool,scope);
  assert.ok(scope.engagement.submissionsClosed);
  await assert.rejects(openBlueprintLender(pool,scope,{lenderId:banks[1]}),/batch_submitted/);
  const reply = async (subject,bodyPreview,authenticatedBankDomain="alpha.example.test") =>
    onMailResponse({orgId,clientId:person,id:randomUUID(),payload:{source:"mailgun",classification:"APPROVED",
      subject,bodyPreview,authenticatedBankDomain}},pool);
  await reply("Alpha application SYN-fixture-123","Approved for $5,100.","another.example.test");
  assert.equal((await readBlueprintFunding(pool,scope)).applications[0].status,"Applied");
  await reply("Alpha application SYN-fixture-123","Your application has been approved for $5,100.");
  let verified=(await readBlueprintFunding(pool,scope)).applications[0];
  assert.equal(verified.status,"Approved"); assert.equal(Number(verified.approvedAmount),5100);
  assert.equal(verified.fundedAmount,null);
  assert.equal((await getBlueprintFulfillmentAccess(pool,scope)).status,"active");
  await assert.rejects(owner.query("UPDATE funding_rounds SET status='funded',funded_amount=99999 WHERE id=$1",
    [scope.engagement.roundId]),/requires its submitted batch and verified bank outcomes/);
  await reply("Alpha card SYN-fixture-123","Your card is active. Available credit is $4,800.");
  assert.equal(Number((await pool.query("SELECT funded_amount FROM funding_rounds WHERE id=$1",[scope.engagement.roundId])).rows[0].funded_amount),4800);
  scope.now = new Date();
  scope.engagement = await getBlueprintFulfillmentAccess(pool,scope);
  assert.equal(scope.engagement.status,"completed");
  assert.equal((await readBlueprintFunding(pool,scope)).state,"completed");
  await assert.rejects(openBlueprintLender(pool,scope,{lenderId:banks[1]}),/engagement_not_client_operated/);
  await grantFromTransaction(pool,purchase);
  const grants = (await pool.query("SELECT source_transaction_id,revoked_at FROM entitlements WHERE org_id=$1 AND client_id=$2",[orgId,person])).rows;
  assert.ok(grants.filter(x=>x.source_transaction_id===paid).every(x=>x.revoked_at));
  assert.ok(grants.some(x=>x.source_transaction_id===prep && !x.revoked_at));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM funding_rounds WHERE client_id=$1",[person])).rows[0].n,1);
  const deps = {db:pool,requirePrincipal:async()=>({kind:"client",orgId,clientId:person,accountId})};
  const response = {setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  assert.equal((await requireBlueprintFulfillmentScope({method:"GET"},response,deps)).engagement.status,"completed");
  assert.equal(await requireBlueprintFulfillmentScope({method:"POST"},response,deps),null);
  assert.equal(response.code,409);
  // A second paid owner lacks authenticated bank mail. An actual CSM, scoped
  // to the case, can resolve a versioned bank letter the owner supplied.
  const otherAccount=randomUUID(), otherReceipt=randomUUID();
  await owner.query("UPDATE clients SET custom_fields=$1 WHERE id=$2",[{home_state:"AZ",crs_negative_items_count:0},other]);
  await owner.query("INSERT INTO accounts(id,org_id,client_id,kind,email) VALUES($1,$2,$3,'client',$4)",
    [otherAccount,orgId,other,"blueprint+"+other+"@example.test"]);
  await owner.query("INSERT INTO transactions(id,org_id,client_id,product_name,amount_paid,status) VALUES($1,$2,$3,'Synthetic full',20000,'succeeded')",[otherReceipt,orgId,other]);
  await grantFromTransaction(pool,{...purchase,clientId:other,transactionId:otherReceipt});
  await owner.query("INSERT INTO crs_results(org_id,client_id,result,is_demo) VALUES($1,$2,$3,false)",[orgId,other,{scores:{ex:723,eq:710,tu:720}}]);
  const second={orgId,clientId:other,accountId:otherAccount,now:new Date()};
  second.engagement=await getBlueprintFulfillmentAccess(pool,second);
  const opened=await openBlueprintLender(pool,second,{lenderId:banks[0]});
  second.engagement=await getBlueprintFulfillmentAccess(pool,second);
  const documentId=randomUUID(), versionId=randomUUID();
  await owner.query(`INSERT INTO documents(id,org_id,client_id,document_key,kind,title,storage_key,mime_type,byte_size)
    VALUES($1,$2,$3,$4,'client_upload','Synthetic bank decision','synthetic/decision.pdf','application/pdf',512)`,[documentId,orgId,other,documentId]);
  await owner.query(`INSERT INTO document_versions(id,org_id,document_id,version,storage_key,mime_type,byte_size)
    VALUES($1,$2,$3,1,'synthetic/decision.pdf','application/pdf',512)`,[versionId,orgId,documentId]);
  await owner.query("UPDATE documents SET current_version_id=$1 WHERE id=$2",[versionId,documentId]);
  await reportBlueprintApplication(pool,second,{applicationId:opened.applicationId,status:"declined",evidenceDocumentId:documentId});
  await finishBlueprintSubmissions(pool,second,{idempotencyKey:"finish-exception"});
  assert.equal((await getBlueprintFulfillmentAccess(pool,second)).status,"active");
  const staff=(await owner.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic CSM','csm','active') RETURNING *",[orgId])).rows[0];
  const staffDeps={db:pool,requirePrincipal:async()=>({kind:"staff",staff,orgId})};
  const body={action:"review_bank_evidence",clientId:other,applicationId:opened.applicationId,evidenceDocumentId:documentId,
    decision:"declined",note:"Read the dated denial and matched its account reference."};
  await fundingApi({method:"POST",query:{},body:{...body,evidenceDocumentId:randomUUID()}},response,staffDeps);
  assert.equal(response.code,409);
  await fundingApi({method:"POST",query:{},body},response,staffDeps);
  assert.equal(response.code,200,JSON.stringify(response.body));
  assert.equal((await getBlueprintFulfillmentAccess(pool,second)).status,"completed");
  assert.equal((await pool.query("SELECT status,funded_amount FROM funding_rounds WHERE id=$1",[second.engagement.roundId])).rows[0].funded_amount,null);

});
