import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import inquiriesApi from "../../api/blueprint/inquiries.mjs";
import repairApi from "../../api/blueprint/repair.mjs";
import { grant } from "../entitlements/entitlements.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import { captureConsent } from "../consent/index.mjs";
import { createStore, memoryProvider } from "../documents/store.mjs";
import { storeAndRegister } from "../documents/register.mjs";
import { getBlueprintFulfillmentAccess, requireBlueprintFulfillmentScope } from "./fulfillment-access.mjs";
import { readClientInquiries } from "./client-inquiries.mjs";
import { readClientRepair } from "./client-repair.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("paid funding ownership leaves independent client inquiry and repair work available, with exact delegated work protected", {
  skip: !url ? "No isolated local SQL proof" : false
}, async () => {
  assert.equal(isLocalScratchDatabaseUrl(url), true, "Only a loopback scratch/test database may be used");
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  const db = await pool.connect();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No external provider is permitted in ownership proof"); };
  try {
    await db.query("BEGIN");
    assert.equal((await db.query("SELECT current_user")).rows[0].current_user, "fundhub_app");
    const orgId = (await db.query("SELECT id FROM orgs WHERE is_default LIMIT 1")).rows[0].id;
    const clientId = (await db.query("INSERT INTO clients(org_id,first_name,last_name,email) VALUES($1,'Scope','Buyer',$2) RETURNING id", [orgId, `${randomUUID()}@example.test`])).rows[0].id;
    const accountId = (await db.query("INSERT INTO accounts(org_id,client_id,kind,email,status,password_hash) VALUES($1,$2,'client',$3,'active','fixture-not-a-login') RETURNING id", [orgId, clientId, `${randomUUID()}@example.test`])).rows[0].id;
    const session = await createAccountSession(db, { orgId, accountId });
    const purchase = (await db.query("INSERT INTO transactions(org_id,client_id,product_name,amount_paid,status) SELECT $1,$2,name,30000,'succeeded' FROM products WHERE org_id=$1 AND code='blueprint-self-funding' RETURNING id", [orgId, clientId])).rows[0].id;
    await grant(db, { orgId, clientId, code: "blueprint-client-fulfillment", sourceTransactionId: purchase });
    let engagement = await getBlueprintFulfillmentAccess(db, { orgId, clientId });
    assert.equal(engagement.status, "active");
    async function paidService(serviceKind, scopeType, targetId, roundKey = null) {
      const id = randomUUID();
      await db.query(`INSERT INTO paid_service_requests(id,org_id,client_id,service_kind,requested_by_kind,requested_by_account_id,status,
        price_components,price_total_cents,idempotency_key,payment_ref,amount_paid_cents,paid_at)
        VALUES($1,$2,$3,'blueprint_help','client',$4,'paid',$5::jsonb,10000,$6,$7,10000,now())`,
      [id, orgId, clientId, accountId, JSON.stringify([{ code: "fixture", label: "Scoped help", quantity: 1, unit_cents: 10000, amount_cents: 10000 }]), `scope-${id}`, `fixture-${id}`]);
      await db.query(`INSERT INTO blueprint_client_services(id,org_id,client_id,engagement_id,service_kind,scope_type,target_id,round_key,state,payment_ref)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'in_progress',$9)`, [id, orgId, clientId, engagement.id, serviceKind, scopeType, targetId, roundKey, `fixture-${id}`]);
      return id;
    }
    await paidService("funding_round", "engagement", engagement.id);
    await db.query("UPDATE blueprint_fulfillment_engagements SET execution_owner='fundhub' WHERE id=$1", [engagement.id]);
    engagement = await getBlueprintFulfillmentAccess(db, { orgId, clientId });
    assert.equal(engagement.executionOwner, "fundhub");
    const scope = { orgId, clientId, accountId, now: new Date(), engagement };
    const request = body => ({ method: "POST", headers: { authorization: `Bearer ${session.token}` }, body });
    const store = createStore({ provider: memoryProvider() });
    async function receipt(kind, subtype) {
      return (await storeAndRegister(db, store, { orgId, clientId, kind, subtype, discriminator: randomUUID(), body: Buffer.from("%PDF-1.4\nfixture receipt\n%%EOF"), mimeType: "application/pdf", generatedBy: `client:${accountId}` })).document.id;
    }
    const cases = [];
    for (const bureau of ["EX", "TU"]) {
      const caseId = randomUUID(); cases.push(caseId);
      await db.query("INSERT INTO inquiry_removal_cases(id,org_id,client_id,case_id,selected_bureaus_raw,case_status) VALUES($1,$2,$3,$4,$5,'Queued')", [caseId, orgId, clientId, `scope-${caseId}`, bureau]);
      await db.query("INSERT INTO inquiry_log(org_id,client_id,bureau,inquiry,inquiry_name,case_id,inquiry_removal_case_id,status,is_open) VALUES($1,$2,$3,'Fixture Bank','Fixture Bank',$4,$4,'New',true)", [orgId, clientId, bureau, caseId]);
    }
    const result = { source: "crs", environment: "production", bureauStatus: { EX: "file_returned", TU: "file_returned" },
      bureaus: { EX: { inquiries: [{ creditorName: "Fixture Bank", date: "2026-10-12" }] }, TU: { inquiries: [{ creditorName: "Fixture Bank", date: "2026-10-12" }] } } };
    await db.query("INSERT INTO crs_results(org_id,client_id,provider,provider_result_id,result) VALUES($1,$2,'crs_softview',$3,$4::jsonb)", [orgId, clientId, `fixture-${randomUUID()}`, JSON.stringify(result)]);
    await paidService("inquiry_removal", "inquiry_case", cases[1]);
    await captureConsent(db, { orgId, clientId, kind: "dispute_authorization", consentText: "I authorize Fundhub to prepare my dispute letters.", captureMethod: "typed", grantedName: "Scope Buyer", grantedBy: { kind: "client", accountId } });
    await db.query("INSERT INTO repair_programs(org_id,client_id,program,rounds_cap,price_total,amount_paid,status) VALUES($1,$2,'full',6,0,0,'active')", [orgId, clientId]);
    const repairs = [];
    for (const [bureau, round] of [["EX", "R1"], ["TU", "R2"]]) {
      const caseId = (await db.query("INSERT INTO dispute_cases(org_id,client_id,bureau,round) VALUES($1,$2,$3,$4) RETURNING id", [orgId, clientId, bureau, round])).rows[0].id;
      await db.query("INSERT INTO dispute_items(case_id,org_id,client_id,rule_id,severity,creditor,account_last4,round,violation) VALUES($1,$2,$3,'fixture_rule','high','Fixture Creditor','1234',$4,'{}')", [caseId, orgId, clientId, round]);
      const letterId = (await db.query("INSERT INTO dispute_letters(case_id,org_id,client_id,bureau,round,body_text,target) VALUES($1,$2,$3,$4,$5,'Dear bureau. Please review the fixture reporting error.','bureau') RETURNING id", [caseId, orgId, clientId, bureau, round])).rows[0].id;
      repairs.push({ caseId, letterId });
    }
    await paidService("repair_round", "dispute_case", repairs[1].caseId, "R2");
    let calls = 0;
    const deps = { db, documentStore: store, evaluateDocGate: async () => ({ complete: true, missing: [] }),
      verifiedIdentity: async () => ({ legalName: "Scope Buyer", address: "1 Fixture St", verifiedAt: new Date() }),
      loadVerifiedIdentity: async () => ({ legalName: "Scope Buyer", address: "1 Fixture St" }), readRepairStage: async () => "ready_to_send",
      onRepairEvent: async () => {}, launchBureauCallForCase: async (_db, args) => {
        calls++; assert.equal(args.caseId, cases[0]); assert.equal(args.expectedClientId, clientId); return { callId: "scoped-synthetic-call" };
      } };
    async function call(api, body, status = 200) {
      const res = response(); await api(request(body), res, deps);
      assert.equal(res.statusCode, status, JSON.stringify(res.body)); return res.body;
    }
    const fundingGate = response();
    assert.equal(await requireBlueprintFulfillmentScope(request({}), fundingGate, { db }), null);
    assert.equal(fundingGate.statusCode, 409, "the default funding gate remains closed for client bank actions");
    const inquiryView = await readClientInquiries(db, scope, deps);
    assert.equal(inquiryView.cases.find(row => row.id === cases[0]).executionOwner, "client");
    assert.equal(inquiryView.cases.find(row => row.id === cases[0]).actions.canRecordSubmission, true);
    assert.equal(inquiryView.cases.find(row => row.id === cases[1]).executionOwner, "fundhub");
    assert.equal(inquiryView.cases.find(row => row.id === cases[1]).actions.canLaunchCall, false);
    const inquiryReceipt = await receipt("inquiry_doc", "inquiry_submission_receipt");
    await call(inquiriesApi, { action: "record_submission", caseId: cases[0], reference: "actual-fixture-ref", receiptDocumentId: inquiryReceipt });
    await call(inquiriesApi, { action: "launch_call", caseId: cases[0], authorization: true });
    assert.equal(calls, 1);
    assert.equal((await call(inquiriesApi, { action: "check_evidence", caseId: cases[0] })).removed, 0);
    assert.equal((await readClientInquiries(db, scope, deps)).cases.find(row => row.id === cases[0]).actions.canCheckSavedEvidence, true);
    assert.equal((await call(inquiriesApi, { action: "record_submission", caseId: cases[1], reference: "other", receiptDocumentId: inquiryReceipt }, 409)).error, "team_handles_case");
    assert.equal((await call(inquiriesApi, { action: "launch_call", caseId: cases[1], authorization: true }, 409)).error, "team_handles_case");
    assert.equal(calls, 1);
    const repairView = await readClientRepair(db, scope, deps);
    assert.equal(repairView.executionOwner, "client"); assert.equal(repairView.actions.canGenerate, true);
    assert.equal(repairView.cases.find(row => row.round === "R1").letters[0].canRecordSubmission, true);
    assert.equal(repairView.cases.find(row => row.round === "R2").executionOwner, "fundhub");
    assert.equal((await call(repairApi, { action: "generate" })).status, "already_prepared");
    const repairReceipt = await receipt("client_upload", "repair_submission_receipt");
    const submission = { action: "record_submission", letterId: repairs[0].letterId, receiptDocumentId: repairReceipt, reference: "fixture-postal", channel: "mail" };
    await call(repairApi, submission);
    assert.equal((await call(repairApi, { ...submission, letterId: repairs[1].letterId }, 409)).error, "team_handles_repair");
    assert.equal((await call(repairApi, { action: "generate" }, 409)).error, "team_handles_repair");
    await paidService("repair_full", "client", clientId);
    assert.equal((await call(repairApi, submission, 409)).error, "team_handles_repair");
    assert.equal((await readClientRepair(db, scope, deps)).cases.every(row => row.executionOwner === "fundhub"), true);
    assert.equal((await db.query("SELECT is_open FROM inquiry_log WHERE case_id=$1", [cases[0]])).rows[0].is_open, true, "submission and call receipts never self-clear the inquiry");
    await db.query("UPDATE blueprint_fulfillment_engagements SET status='completed',completed_at=now() WHERE id=$1", [engagement.id]);
    await db.query("UPDATE entitlements SET revoked_at=now(),revoke_reason='purchased_round_completed' WHERE id=$1", [engagement.entitlementId]);
    await call(inquiriesApi, { action: "check_evidence", caseId: cases[0] }, 409);
    await call(repairApi, { action: "generate" }, 409);
    await db.query("UPDATE entitlements SET revoke_reason='fixture_revoked_purchase' WHERE id=$1", [engagement.entitlementId]);
    await call(inquiriesApi, { action: "check_evidence", caseId: cases[0] }, 403);
    await call(repairApi, { action: "generate" }, 403);
  } finally {
    globalThis.fetch = originalFetch;
    await db.query("ROLLBACK"); db.release(); await pool.end();
  }
});
