import { randomUUID } from "node:crypto";
import { withTransaction } from "../db/with-transaction.mjs";
import { evaluateDocGate } from "../inquiry-ops/doc-gate.mjs";
import { launchBureauCallForCase } from "../inquiry-ops/bureau-call.mjs";
import { addBusinessDays } from "../inquiry-ops/business-days.mjs";
import { verifiedIdentity } from "../identity/verified.mjs";
import { captureInquiryBaseline, genuineInquiryReport, verifyClientInquiryRemovals, reviewInquiryEvidence } from "../inquiry-ops/verify-removal.mjs";
import { bureauDialPlan } from "../inquiry-ops/bureau-dial-plan.mjs";
import { inquiryCall } from "./fulfillment-cycle.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INQUIRY_PORTALS = Object.freeze({
  EX: "https://www.experian.com/help/dispute-credit/",
  EQ: "https://www.equifax.com/personal/credit-report-services/credit-dispute/",
  TU: "https://www.transunion.com/credit-disputes/dispute-your-credit"
});
export const INQUIRY_DOCUMENT_UPLOAD_PORTALS = Object.freeze({
  EX: "https://www.experian.com/consumer/upload/"
});

const UPLOAD_LABELS = Object.freeze({ id_document: "Government photo ID", proof_of_address: "Proof of address", ssn_card: "SSN card" });

export class ClientInquiryError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function fail(code, message, status = 400) { throw new ClientInquiryError(code, message, status); }
function requireId(value, label) {
  if (!UUID.test(String(value || ""))) fail("invalid_id", `Choose a saved ${label}.`);
  return String(value);
}
function requireScope(scope) {
  requireId(scope?.orgId, "company"); requireId(scope?.clientId, "client");
  requireId(scope?.accountId, "account");
}
function writable(scope) {
  requireScope(scope);
  if (scope.engagement?.status !== "active") {
    fail("client_work_inactive", "This engagement has ended.", 409);
  }
}
async function activeServices(db, scope, deps) {
  const read = deps.readActiveServices || (await import("./client-services.mjs")).readActiveBlueprintServices;
  return read(db, { orgId: scope.orgId, clientId: scope.clientId, engagementId: scope.engagement.id });
}
function teamOwnsCase(services, caseId) {
  const rows = Array.isArray(services) ? services : services?.services || [];
  return rows.some(row => (row.serviceKind || row.service_kind) === "inquiry_removal"
    && (row.scopeType || row.scope_type) === "inquiry_case"
    && String(row.targetId || row.target_id) === String(caseId)
    && ["paid", "in_progress"].includes(row.status));
}
async function ownedCase(db, scope, caseId, lock = false) {
  requireId(caseId, "inquiry case");
  const row = (await db.query(
    `SELECT * FROM inquiry_removal_cases WHERE id = $1::uuid
      AND org_id = $2::uuid AND client_id = $3::uuid${lock ? " FOR UPDATE" : ""}`,
    [caseId, scope.orgId, scope.clientId]
  )).rows[0];
  if (!row) fail("case_not_found", "That inquiry case is unavailable.", 404);
  if (!INQUIRY_PORTALS[row.selected_bureaus_raw]) fail("case_bureau_unknown", "The Fundhub team needs to confirm this case's bureau.", 409);
  return row;
}
async function caseInquiries(db, scope, caseId) {
  return (await db.query(
    `SELECT id, inquiry, inquiry_name, bureau, is_open, status, removal_verified_at,
            removal_verified_report_id, removal_verified_document_id
       FROM inquiry_log WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND (case_id = $3::uuid OR inquiry_removal_case_id = $3::uuid)
       ORDER BY created_at, id`, [scope.orgId, scope.clientId, caseId]
  )).rows;
}
async function evidenceRow(db, scope, caseId) {
  return (await db.query(
    `SELECT * FROM blueprint_inquiry_evidence WHERE org_id = $1::uuid
      AND client_id = $2::uuid AND case_id = $3::uuid`, [scope.orgId, scope.clientId, caseId]
  )).rows[0] || null;
}
async function ensureEvidence(tx, scope, row) {
  const existing = await evidenceRow(tx, scope, row.id);
  if (existing) return existing;
  const report = (await tx.query(
    `SELECT id, provider, is_demo, result, created_at FROM crs_results
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND is_demo IS NOT TRUE
      ORDER BY created_at DESC LIMIT 1`, [scope.orgId, scope.clientId]
  )).rows[0];
  if (!genuineInquiryReport(report, row.selected_bureaus_raw)) {
    fail("complete_bureau_report_needed", "A current, complete report for this bureau is needed before this step.", 409);
  }
  const inquiries = await caseInquiries(tx, scope, row.id);
  const baseline = captureInquiryBaseline(inquiries, report, row.selected_bureaus_raw);
  if (!baseline.length) fail("case_items_missing", "The Fundhub team needs to confirm the items in this case.", 409);
  const inserted = await tx.query(
    `INSERT INTO blueprint_inquiry_evidence
      (org_id, client_id, case_id, requested_account_id, baseline_report_id, baseline_items)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::jsonb)
      ON CONFLICT (case_id) DO NOTHING RETURNING *`,
    [scope.orgId, scope.clientId, row.id, scope.accountId, report.id, JSON.stringify(baseline)]
  );
  return inserted.rows[0] || evidenceRow(tx, scope, row.id);
}
async function ownReceipt(db, scope, documentId) {
  requireId(documentId, "submission receipt");
  const row = (await db.query(
    `SELECT d.id FROM documents d WHERE d.id = $1::uuid AND d.org_id = $2::uuid
      AND d.client_id = $3::uuid AND d.kind IN ('inquiry_doc','client_upload')
      AND d.subtype = 'inquiry_submission_receipt' AND d.current_version_id IS NOT NULL
      AND (d.expires_at IS NULL OR d.expires_at > now())
      AND EXISTS (SELECT 1 FROM document_versions v WHERE v.id = d.current_version_id
        AND v.document_id = d.id AND v.org_id = d.org_id)`,
    [documentId, scope.orgId, scope.clientId]
  )).rows[0];
  if (!row) fail("receipt_not_available", "Upload your actual submission receipt for this client file.", 409);
  return row;
}

export async function readClientInquiries(db, scope, deps = {}) {
  requireScope(scope);
  const cases = (await db.query(
    `SELECT * FROM inquiry_removal_cases WHERE org_id = $1::uuid AND client_id = $2::uuid
      AND case_status <> 'Canceled' ORDER BY requested_at, id`, [scope.orgId, scope.clientId]
  )).rows;
  const services = await activeServices(db, scope, deps);
  const packet = await (deps.evaluateDocGate || evaluateDocGate)(db, { orgId: scope.orgId, clientId: scope.clientId });
  const identity = await (deps.verifiedIdentity || verifiedIdentity)(db, scope);
  const identityReviewed = Boolean(identity?.legalName && identity?.address && identity?.verifiedAt);
  const documents = (await db.query(
    `SELECT id, title, kind, subtype, generated_at FROM documents
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND current_version_id IS NOT NULL
        AND (expires_at IS NULL OR expires_at > now())
        AND (kind IN ('inquiry_doc','bureau_response')
          OR subtype IN ('funding_inquiry_removal','funding_personal_info','inquiry_submission_receipt'))
      ORDER BY generated_at DESC LIMIT 100`, [scope.orgId, scope.clientId]
  )).rows;
  let dial = [];
  try { dial = (deps.bureauDialPlan || bureauDialPlan)(); } catch { dial = []; }
  const result = [];
  for (const row of cases) {
    const evidence = await evidenceRow(db, scope, row.id);
    const inquiries = await caseInquiries(db, scope, row.id);
    const completed = row.case_status === "Completed";
    const isActive = scope.engagement.status === "active";
    const executionOwner = teamOwnsCase(services, row.id) ? "fundhub" : "client";
    const clientCanAct = isActive && executionOwner === "client" && !completed;
    const callState = evidence?.call_state || "idle";
    const canLaunch = clientCanAct && packet.complete === true && identityReviewed && ["idle", "failed"].includes(callState);
    const items = inquiries.map(item => ({ id: item.id, name: item.inquiry_name || item.inquiry,
      state: item.removal_verified_at && (item.removal_verified_report_id || item.removal_verified_document_id)
        ? "removed_verified" : evidence?.submitted_at ? "pending_verification" : "open",
      verifiedAt: item.removal_verified_at || null, sourceReportId: item.removal_verified_report_id || null }));
    result.push({ id: row.id, bureau: row.selected_bureaus_raw, status: row.case_status, executionOwner,
      packet: { complete: packet.complete === true, identityReviewed, missing: packet.missing || [],
        uploads: (packet.missing || []).filter(kind => kind !== "authorization").map(subtype => ({
          label: UPLOAD_LABELS[subtype] || subtype,
          kind: "client_upload", subtype
        })) },
      portalUrl: INQUIRY_PORTALS[row.selected_bureaus_raw] || null,
      documentUploadUrl: INQUIRY_DOCUMENT_UPLOAD_PORTALS[row.selected_bureaus_raw] || null,
      submittedAt: evidence?.submitted_at || null, submissionReference: evidence?.submission_reference || null,
      receiptDocumentId: evidence?.receipt_document_id || null, nextCheckAt: evidence?.next_check_at || null,
      call: { status: callState, callId: evidence?.call_id || null, canLaunch },
      inquiries: items,
      /* The fulfillment cycle: "Call <bureau>" yourself, with a short script and the
         number the Fundhub caller dials. Only while the client runs this case. */
      selfCall: clientCanAct ? inquiryCall({ bureau: row.selected_bureaus_raw, inquiries: items,
        missing: (packet.missing || []).filter(kind => kind !== "authorization")
          .map(subtype => UPLOAD_LABELS[subtype] || subtype),
        name: identity?.legalName || null, dial }) : null,
      documents,
      actions: { canRecordSubmission: clientCanAct && !evidence?.submitted_at,
        canLaunchCall: canLaunch, canCheckSavedEvidence: isActive && Boolean(evidence) } });
  }
  return { ok: true, orgId: scope.orgId, clientId: scope.clientId, cases: result };
}

export async function recordClientInquirySubmission(db, scope, input, deps = {}) {
  writable(scope);
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  if (!reference || reference.length > 250) fail("submission_reference_required", "Enter the reference from your actual bureau submission.");
  const services = await activeServices(db, scope, deps);
  if (teamOwnsCase(services, input.caseId)) fail("team_handles_case", "The Fundhub team is handling this case.", 409);
  await ownReceipt(db, scope, input.receiptDocumentId);
  const row = await withTransaction(db, async tx => {
    const current = await ownedCase(tx, scope, input.caseId, true);
    if (current.case_status === "Completed") fail("case_completed", "This case is already complete.", 409);
    const packet = await (deps.evaluateDocGate || evaluateDocGate)(tx, scope);
    if (!packet.complete) fail("packet_incomplete", "Finish the identity packet before recording this submission.", 409);
    const evidence = await ensureEvidence(tx, scope, current);
    if (evidence.submitted_at) {
      if (evidence.submission_reference !== reference || String(evidence.receipt_document_id) !== String(input.receiptDocumentId)) {
        fail("submission_already_saved", "This case already has its submission receipt. Ask the Fundhub team about a correction.", 409);
      }
      return evidence;
    }
    const at = scope.now || new Date();
    return (await tx.query(
      `UPDATE blueprint_inquiry_evidence SET submission_reference = $4,
          receipt_document_id = $5::uuid, submitted_at = $6::timestamptz,
          next_check_at = $7::timestamptz, updated_at = now()
        WHERE org_id = $1::uuid AND client_id = $2::uuid AND case_id = $3::uuid
          AND submitted_at IS NULL RETURNING *`,
      [scope.orgId, scope.clientId, current.id, reference, input.receiptDocumentId, at, addBusinessDays(new Date(at), 3)]
    )).rows[0];
  });
  return { ok: true, status: "submitted_pending_verification", caseId: row.case_id,
    submittedAt: row.submitted_at, nextCheckAt: row.next_check_at };
}

export async function launchClientInquiryCall(db, scope, input, deps = {}) {
  writable(scope);
  if (input.authorization !== true) fail("call_authorization_required", "Confirm that you want the AI assistant to call this bureau for your case.");
  const services = await activeServices(db, scope, deps);
  if (teamOwnsCase(services, input.caseId)) fail("team_handles_case", "The Fundhub team is handling this case.", 409);
  const identity = await (deps.verifiedIdentity || verifiedIdentity)(db, scope);
  if (!identity?.legalName || !identity?.address || !identity?.verifiedAt) {
    fail("identity_review_needed", "The Fundhub team needs to finish reviewing your identity papers before this call.", 409);
  }
  const prepared = await withTransaction(db, async tx => {
    const row = await ownedCase(tx, scope, input.caseId, true);
    if (["Completed", "Canceled"].includes(row.case_status)) fail("case_closed", "This case is closed.", 409);
    const packet = await (deps.evaluateDocGate || evaluateDocGate)(tx, scope);
    if (!packet.complete) fail("packet_incomplete", "Finish the identity packet before starting the call.", 409);
    const evidence = await ensureEvidence(tx, scope, row);
    if (["claimed", "sent", "unknown"].includes(evidence.call_state)) return { evidence, replay: true };
    const claim = randomUUID();
    const claimed = (await tx.query(
      `UPDATE blueprint_inquiry_evidence SET call_state = 'claimed', call_claim = $4::uuid,
          call_requested_at = $5::timestamptz, call_error = NULL, updated_at = now()
        WHERE org_id = $1::uuid AND client_id = $2::uuid AND case_id = $3::uuid
          AND call_state IN ('idle','failed') RETURNING *`,
      [scope.orgId, scope.clientId, row.id, claim, scope.now || new Date()]
    )).rows[0];
    return claimed ? { evidence: claimed, replay: false } : { evidence: await evidenceRow(tx, scope, row.id), replay: true };
  });
  if (prepared.replay) return { ok: true, caseId: input.caseId, status: prepared.evidence.call_state, callId: prepared.evidence.call_id || null, replayed: true };
  const launch = deps.launchBureauCallForCase || launchBureauCallForCase;
  try {
    const call = await launch(db, { orgId: scope.orgId, caseId: input.caseId,
      expectedClientId: scope.clientId, accountId: scope.accountId, clientRequested: true,
      inquiryIds: prepared.evidence.baseline_items.map(item => item.inquiryId), env: deps.env || process.env,
      fetchImpl: deps.fetchImpl });
    await db.query(
      `UPDATE blueprint_inquiry_evidence SET call_state = 'sent', call_id = $4, updated_at = now()
        WHERE org_id = $1::uuid AND client_id = $2::uuid AND case_id = $3::uuid
          AND call_claim = $5::uuid`, [scope.orgId, scope.clientId, input.caseId, call.callId, prepared.evidence.call_claim]
    );
    return { ok: true, caseId: input.caseId, status: "sent", callId: call.callId };
  } catch (error) {
    const safeFailure = ["rep_number_required", "client_not_found", "ssn_required", "packet_invalid", "not_configured", "no_phone", "no_task", "dry_run", "bad_bureau", "case_closed"].includes(error.code);
    const state = safeFailure ? "failed" : "unknown";
    await db.query(
      `UPDATE blueprint_inquiry_evidence SET call_state = $4, call_error = $5, updated_at = now()
        WHERE org_id = $1::uuid AND client_id = $2::uuid AND case_id = $3::uuid
          AND call_claim = $6::uuid`,
      [scope.orgId, scope.clientId, input.caseId, state, String(error.code || "call_outcome_uncertain"), prepared.evidence.call_claim]
    );
    await reviewInquiryEvidence(db, scope, input.caseId, state === "unknown" ? "call_outcome_uncertain" : "call_needs_setup", deps.createTask);
    return { ok: true, caseId: input.caseId, status: state, callId: null,
      message: "The Fundhub team will check this call before another attempt." };
  }
}

export async function checkClientInquiryEvidence(db, scope, input, deps = {}) {
  requireScope(scope);
  await ownedCase(db, scope, input.caseId);
  const result = await (deps.verifyClientInquiryRemovals || verifyClientInquiryRemovals)(db, scope,
    { caseId: input.caseId, createTaskImpl: deps.createTask, emitFn: deps.emitFn });
  return { ...result, caseId: input.caseId };
}
