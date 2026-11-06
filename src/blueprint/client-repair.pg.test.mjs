import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { createStore, memoryProvider } from "../documents/store.mjs";
import { captureConsent } from "../consent/index.mjs";
import { readClientRepair, generateClientRepairLetters, recordClientRepairSubmission } from "./client-repair.mjs";
import { hasFullBlueprintDisputeAuthorization, FULL_BLUEPRINT_DISPUTE_CLAUSE } from "../repair/dispute-auth.mjs";

const url = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL || "";
function safe(value) { try { const u = new URL(value); return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname)
  && /^[a-z0-9_-]+$/i.test(u.pathname.slice(1)) && /(?:^|[_-])(test|scratch|ci)(?:$|[_-])/i.test(u.pathname.slice(1)) && !u.search && !u.hash; } catch { return false; } }

test("self-run repair reuses actual saved letters and records submission without a removal claim", { skip: !url ? "No local isolated SQL proof" : false }, async () => {
  assert.equal(safe(url), true);
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const orgId = randomUUID(), clientId = randomUUID(), otherId = randomUUID(), accountId = randomUUID();
    const caseId = randomUUID(), letterId = randomUUID(), receiptId = randomUUID(), versionId = randomUUID();
    await db.query("INSERT INTO orgs(id,slug,name) VALUES($1,$2,'Repair fixture')", [orgId, `repair-fixture-${orgId}`]);
    await db.query("INSERT INTO clients(id,org_id,first_name,last_name,email) VALUES($1,$2,'Repair','Buyer',$3),($4,$2,'Other','Buyer',$5)", [clientId, orgId, `${clientId}@example.invalid`, otherId, `${otherId}@example.invalid`]);
    await db.query("INSERT INTO accounts(id,org_id,kind,email,status,password_hash,client_id) VALUES($1,$2,'client',$3,'active','fixture-not-a-login',$4)", [accountId, orgId, `${accountId}@example.invalid`, clientId]);
    await db.query("INSERT INTO repair_programs(org_id,client_id,program,rounds_cap,price_total,amount_paid,status) VALUES($1,$2,'full',6,0,0,'active')", [orgId, clientId]);
    await db.query("INSERT INTO dispute_cases(id,org_id,client_id,bureau,round) VALUES($1,$2,$3,'EX','R1')", [caseId, orgId, clientId]);
    await db.query("INSERT INTO dispute_items(case_id,org_id,client_id,rule_id,severity,creditor,account_last4,round,violation) VALUES($1,$2,$3,'fixture_rule','high','Fixture Creditor','1234','R1','{}')", [caseId, orgId, clientId]);
    await db.query("INSERT INTO dispute_letters(id,case_id,org_id,client_id,bureau,round,body_text,target) VALUES($1,$2,$3,$4,'EX','R1','Dear Experian. Please review the fixture reporting error.','bureau')", [letterId, caseId, orgId, clientId]);
    await captureConsent(db, { orgId, clientId, kind: "dispute_authorization", consentText: "I authorize Fundhub to prepare my dispute letters.", captureMethod: "typed", grantedName: "Repair Buyer", grantedBy: { kind: "client", accountId } });
    const sum = `sha256:${"b".repeat(64)}`;
    await db.query("INSERT INTO documents(id,org_id,client_id,document_key,kind,subtype,title,storage_key,mime_type,checksum) VALUES($1,$2,$3,$4,'client_upload','repair_submission_receipt','Repair mailing receipt','fixture-receipt','application/pdf',$5)", [receiptId, orgId, clientId, `fixture-${receiptId}`, sum]);
    await db.query("INSERT INTO document_versions(id,org_id,document_id,version,storage_key,mime_type,checksum) VALUES($1,$2,$3,1,'fixture-receipt','application/pdf',$4)", [versionId, orgId, receiptId, sum]);
    await db.query("UPDATE documents SET current_version_id=$2 WHERE id=$1", [receiptId, versionId]);
    const scope = { orgId, clientId, accountId, now: new Date(), engagement: { id: randomUUID(), status: "active", executionOwner: "client" } };
    const events = [];
    const deps = { readActiveServices: async () => [], evaluateDocGate: async () => ({ complete: true, missing: [] }),
      loadVerifiedIdentity: async () => ({ legalName: "Repair Buyer", address: "1 Fixture St" }),
      documentStore: createStore({ provider: memoryProvider() }), readRepairStage: async () => "ready_to_send",
      onRepairEvent: async (_db, event) => { events.push(event); } };
    await db.query("SET LOCAL ROLE fundhub_app");
    const prepared = await generateClientRepairLetters(db, scope, {}, deps);
    assert.equal(prepared.status, "already_prepared");
    assert.equal(prepared.documents.length, 1, "the same stored dispute letter became a client download");
    const read = await readClientRepair(db, scope, deps);
    assert.equal(read.program.kind, "full"); assert.equal(read.cases[0].letters[0].documentId, prepared.documents[0].documentId);
    const input = { letterId, receiptDocumentId: receiptId, reference: "fixture-postal-reference", channel: "mail" };
    await recordClientRepairSubmission(db, scope, input, deps);
    const replay = await recordClientRepairSubmission(db, scope, input, deps);
    assert.equal(replay.replayed, true); assert.equal(events.length, 1);
    const result = await readClientRepair(db, scope, deps);
    assert.equal(result.cases[0].letters[0].submission.reference, input.reference);
    assert.equal(result.cases[0].items[0].status, "sent"); assert.equal(result.cases[0].items[0].outcome, null);
    assert.equal(result.actions.canGenerate, false, "submitted items wait for actual bureau outcomes");
    const raw = (await db.query("SELECT status,mailed_at,postgrid_letter_id FROM dispute_letters WHERE id=$1", [letterId])).rows[0];
    assert.equal(raw.status, "sent"); assert.equal(raw.mailed_at, null); assert.equal(raw.postgrid_letter_id, null);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sales WHERE org_id=$1 AND client_id=$2", [orgId, clientId])).rows[0].n, 0, "self-run repair created no separate paid DFY sale");
    await assert.rejects(recordClientRepairSubmission(db, { ...scope, clientId: otherId }, input,
      { ...deps, hasDisputeAuthorization: async () => true }), { code: "repair_letter_unavailable" });
    await db.query("UPDATE dispute_items SET status='deleted',outcome='deleted' WHERE case_id=$1", [caseId]);
    await db.query("UPDATE dispute_cases SET status='round_complete' WHERE id=$1", [caseId]);
    await db.query("UPDATE dispute_letters SET created_at='2026-11-01' WHERE id=$1", [letterId]);
    const reportId = randomUUID();
    const complete = { environment: "production", bureauStatus: { EX: "file_returned" },
      bureaus: { EX: { creditFiles: [{ creditFileDetail: { sourceType: "Experian", creditFileResultStatusType: "FileReturned", creditFileInfileDate: "2026-11-06" } }], inquiries: [], tradelines: [] } } };
    await db.query("INSERT INTO crs_results(id,org_id,client_id,result,created_at) VALUES($1,$2,$3,$4::jsonb,now())", [reportId, orgId, clientId, JSON.stringify(complete)]);
    assert.equal((await readClientRepair(db, scope, deps)).currentRound, null, "a fresh file alone does not invent repair work");
    complete.bureaus.EX.tradelines.push({ creditorName: "NEW COLLECTION AGENCY", accountIdentifier: "NEW-5678",
      accountOpenedDate: "2026-01-01", accountReportedDate: "2026-11-06", sourceType: "Experian",
      accountStatusType: "Collection", accountType: "Collection", businessType: "CollectionAgency",
      currentRatingType: "Collection", currentBalanceAmount: "500", pastDueAmount: "500" });
    await db.query("UPDATE crs_results SET result=$2::jsonb WHERE id=$1", [reportId, JSON.stringify(complete)]);
    assert.equal((await readClientRepair(db, scope, deps)).currentRound, "R2", "a genuinely new supported finding can reopen the next allowed repair round");
  } finally { await db.query("ROLLBACK"); db.release(); await pool.end(); }
});

test("full agreement authorization requires the signed exact clause, frozen hash and no later revocation", { skip: !url ? "No local isolated SQL proof" : false }, async () => {
  assert.equal(safe(url), true);
  const pool = new pg.Pool({ connectionString: url, max: 1 }); const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("CREATE TEMP TABLE contracts(org_id uuid,client_id uuid,template_key text,status text,signed_at timestamptz,rendered_body text,body_sha text)");
    await db.query("CREATE TEMP TABLE client_consents(org_id uuid,client_id uuid,kind text,revoked_at timestamptz)");
    const orgId = randomUUID(), clientId = randomUUID(); const body = FULL_BLUEPRINT_DISPUTE_CLAUSE;
    const sha = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    await db.query("INSERT INTO contracts VALUES($1,$2,'BLUEPRINT-SELF-FUNDING-AGREEMENT','signed','2026-11-01',$3,$4)", [orgId, clientId, body, sha]);
    assert.equal(await hasFullBlueprintDisputeAuthorization(db, { orgId, clientId }), true);
    assert.equal(await hasFullBlueprintDisputeAuthorization(db, { orgId, clientId: randomUUID() }), false);
    await db.query("UPDATE contracts SET body_sha=$1", [`sha256:${'0'.repeat(64)}`]);
    assert.equal(await hasFullBlueprintDisputeAuthorization(db, { orgId, clientId }), false);
    await db.query("UPDATE contracts SET body_sha=$1", [sha]);
    await db.query("INSERT INTO client_consents VALUES($1,$2,'dispute_authorization','2026-11-02')", [orgId, clientId]);
    assert.equal(await hasFullBlueprintDisputeAuthorization(db, { orgId, clientId }), false);
  } finally { await db.query("ROLLBACK"); db.release(); await pool.end(); }
});
