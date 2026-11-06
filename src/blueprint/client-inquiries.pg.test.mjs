import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readClientInquiries, recordClientInquirySubmission, launchClientInquiryCall } from "./client-inquiries.mjs";
import { verifyClientInquiryRemovals } from "../inquiry-ops/verify-removal.mjs";
import { sensitiveBureaus } from "../lenders/match.mjs";

const url = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL || "";
function safe(value) {
  try { const u = new URL(value); return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname)
    && /^[a-z0-9_-]+$/i.test(u.pathname.slice(1)) && /(?:^|[_-])(test|scratch|ci)(?:$|[_-])/i.test(u.pathname.slice(1))
    && !u.search && !u.hash; } catch { return false; }
}
test("inquiry PG guard refuses production and connection overrides", () => {
  assert.equal(safe("postgres://localhost/fundhub_inquiry_test"), true);
  for (const target of ["postgres://localhost/production", "postgres://remote/fundhub_test", "postgres://localhost/fundhub_test?host=remote"]) assert.equal(safe(target), false);
});

test("client inquiry receipts, call claims and verified per-bureau release persist without self-clear", {
  skip: !url ? "No isolated local PostgreSQL URL; SQL proof not run" : false
}, async () => {
  assert.equal(safe(url), true, "Only an explicitly named loopback test/scratch/CI database is permitted");
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const orgId = randomUUID(), clientId = randomUUID(), foreignClient = randomUUID(), accountId = randomUUID();
    const caseId = randomUUID(), inquiryId = randomUUID(), receiptId = randomUUID(), versionId = randomUUID();
    await db.query("INSERT INTO orgs(id,slug,name) VALUES($1,$2,'Inquiry fixture')", [orgId, `inquiry-fixture-${orgId}`]);
    await db.query("INSERT INTO clients(id,org_id,first_name,last_name,email) VALUES($1,$2,'Fixture','Buyer',$3),($4,$2,'Other','Buyer',$5)",
      [clientId, orgId, `${clientId}@example.invalid`, foreignClient, `${foreignClient}@example.invalid`]);
    await db.query("INSERT INTO accounts(id,org_id,kind,email,status,password_hash,client_id) VALUES($1,$2,'client',$3,'active','fixture-not-a-login',$4)",
      [accountId, orgId, `${accountId}@example.invalid`, clientId]);
    await db.query("INSERT INTO inquiry_removal_cases(id,org_id,client_id,case_id,selected_bureaus_raw,case_status) VALUES($1,$2,$3,$4,'EX','Queued')",
      [caseId, orgId, clientId, `fixture-${caseId}`]);
    await db.query("INSERT INTO inquiry_log(id,org_id,client_id,bureau,inquiry,inquiry_name,case_id,inquiry_removal_case_id,status,is_open) VALUES($1,$2,$3,'EX','Bank One','Bank One',$4,$4,'New',true)",
      [inquiryId, orgId, clientId, caseId]);
    const checksum = `sha256:${"a".repeat(64)}`;
    await db.query("INSERT INTO documents(id,org_id,client_id,document_key,kind,subtype,title,storage_key,mime_type,checksum) VALUES($1,$2,$3,$4,'inquiry_doc','inquiry_submission_receipt','Submission receipt','fixture-receipt','application/pdf',$5)",
      [receiptId, orgId, clientId, `fixture-${receiptId}`, checksum]);
    await db.query("INSERT INTO document_versions(id,org_id,document_id,version,storage_key,mime_type,checksum) VALUES($1,$2,$3,1,'fixture-receipt','application/pdf',$4)",
      [versionId, orgId, receiptId, checksum]);
    await db.query("UPDATE documents SET current_version_id=$2 WHERE id=$1", [receiptId, versionId]);
    async function addReport(items, at, override = {}) {
      const id = randomUUID();
      const result = { source: "crs", environment: "production", bureauStatus: { EX: "file_returned" },
        bureaus: { EX: { inquiries: items } }, inquiries: items.map(item => ({ ...item, source: "EX" })), ...override };
      await db.query("INSERT INTO crs_results(id,org_id,client_id,provider,provider_result_id,result,created_at) VALUES($1,$2,$3,'crs_softview',$6,$4::jsonb,$5)",
        [id, orgId, clientId, JSON.stringify(result), at, `fixture-${id}`]);
      return id;
    }
    await addReport([{ creditorName: "Bank One", date: "2026-10-12" }], "2026-11-01T12:00:00Z");
    const scope = { orgId, clientId, accountId, now: new Date("2026-11-05T12:00:00Z"),
      engagement: { id: randomUUID(), status: "active", executionOwner: "client" } };
    const deps = { readActiveServices: async () => [], evaluateDocGate: async () => ({ complete: true, missing: [] }) };
    await db.query("SET LOCAL ROLE fundhub_app");
    const submitted = await recordClientInquirySubmission(db, scope,
      { caseId, reference: "EX-fixture-reference", receiptDocumentId: receiptId }, deps);
    assert.equal(submitted.status, "submitted_pending_verification");
    await recordClientInquirySubmission(db, scope, { caseId, reference: "EX-fixture-reference", receiptDocumentId: receiptId }, deps);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM blueprint_inquiry_evidence WHERE case_id=$1", [caseId])).rows[0].n, 1);
    assert.equal((await db.query("SELECT is_open FROM inquiry_log WHERE id=$1", [inquiryId])).rows[0].is_open, true);
    await assert.rejects(recordClientInquirySubmission(db, { ...scope, clientId: foreignClient },
      { caseId, reference: "EX-foreign", receiptDocumentId: receiptId }, deps), { code: "receipt_not_available" });
    let placed = 0;
    const callDeps = { ...deps, launchBureauCallForCase: async (_db, args) => {
      placed++; assert.equal(args.expectedClientId, clientId); assert.equal(args.accountId, accountId);
      assert.deepEqual(args.inquiryIds, [inquiryId]); return { callId: "fixture-call-receipt" };
    } };
    await Promise.all([1, 2].map(() => launchClientInquiryCall(db, scope, { caseId, authorization: true }, callDeps)));
    assert.equal(placed, 1, "the atomic case claim permits only one provider dispatch");
    assert.equal((await readClientInquiries(db, scope, deps)).cases[0].call.callId, "fixture-call-receipt");
    const noNewProof = await verifyClientInquiryRemovals(db, scope, { caseId });
    assert.equal(noNewProof.removed, 0, "elapsed time, submission and completed dispatch do not prove removal");
    await db.query("RESET ROLE");
    await addReport([], "2026-11-06T12:00:00Z", { bureauStatus: { EX: "frozen" } });
    await db.query("SET LOCAL ROLE fundhub_app");
    assert.equal((await verifyClientInquiryRemovals(db, scope, { caseId })).removed, 0);
    await db.query("RESET ROLE");
    const verifiedReport = await addReport([], "2026-11-07T12:00:00Z");
    await db.query("SET LOCAL ROLE fundhub_app");
    let emits = 0;
    const proof = await verifyClientInquiryRemovals(db, scope, { caseId, emitFn: async () => { emits++; } });
    assert.equal(proof.removed, 1); assert.equal(emits, 1);
    const stored = (await db.query("SELECT * FROM inquiry_log WHERE id=$1", [inquiryId])).rows[0];
    assert.equal(stored.is_open, false); assert.equal(stored.removal_verified_report_id, verifiedReport);
    assert.equal(sensitiveBureaus([stored]).has("EX"), false);
    assert.equal((await readClientInquiries(db, scope, deps)).cases[0].inquiries[0].state, "removed_verified");
    assert.equal((await verifyClientInquiryRemovals(db, { ...scope, clientId: foreignClient }, { caseId })).checked, 0);
    await db.query("RESET ROLE");
    await addReport([{ creditorName: "Bank One", date: "2026-10-12" }], "2026-11-08T12:00:00Z");
    await db.query("SET LOCAL ROLE fundhub_app");
    await verifyClientInquiryRemovals(db, scope, { caseId });
    const returned = (await db.query("SELECT * FROM inquiry_log WHERE id=$1", [inquiryId])).rows[0];
    assert.equal(returned.is_open, true); assert.equal(returned.removal_verified_at, null);
    assert.equal(sensitiveBureaus([returned]).has("EX"), true);
    assert.equal((await db.query("SELECT case_status FROM inquiry_removal_cases WHERE id=$1", [caseId])).rows[0].case_status, "Queued");
  } finally {
    await db.query("ROLLBACK"); db.release(); await pool.end();
  }
});
