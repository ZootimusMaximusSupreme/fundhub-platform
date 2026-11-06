import { withTransaction } from "../db/with-transaction.mjs";
import { hasDisputeAuthorization, hasRepairAgreement } from "../repair/dispute-auth.mjs";
import { evaluateDocGate } from "../inquiry-ops/doc-gate.mjs";
import { analyzeAndGenerate, loadVerifiedIdentity } from "../repair/analyze.mjs";
import { enrollRepairProgram } from "../repair/enroll.mjs";
import { persistGeneratedLetters } from "../repair/persist-generated-letters.mjs";
import { readRepairStage } from "../repair/pipeline.mjs";
import { onRepairEvent } from "../repair/handlers.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { INQUIRY_PORTALS } from "./client-inquiries.mjs";
import { violationsByBureauFromMergedCrs } from "../metro2/diy/from-crs.mjs";
import { derogatoryClaimsByBureau, mergeDerogatoryClaims } from "../metro2/diy/derogatory.mjs";
import { nextRound } from "../metro2/rounds/state.mjs";
import { genuineInquiryReport } from "../inquiry-ops/verify-removal.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUNDS = ["R1", "R2", "R3", "R4", "R5", "R6"];
export class ClientRepairError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function fail(code, message, status = 400) { throw new ClientRepairError(code, message, status); }
function requireScope(scope, write = false) {
  if (![scope?.orgId, scope?.clientId, scope?.accountId].every(value => UUID.test(String(value || "")))) {
    fail("repair_scope_required", "Sign in to your client file.", 403);
  }
  if (write && scope.engagement?.status !== "active") {
    fail("client_repair_inactive", "This engagement has ended.", 409);
  }
}
async function programFor(db, scope) {
  return (await db.query("SELECT * FROM repair_programs WHERE org_id=$1::uuid AND client_id=$2::uuid", [scope.orgId, scope.clientId])).rows[0] || null;
}
async function servicesFor(db, scope, deps) {
  const read = deps.readActiveServices || (await import("./client-services.mjs")).readActiveBlueprintServices;
  return read(db, { orgId: scope.orgId, clientId: scope.clientId, engagementId: scope.engagement.id });
}
function teamOwnsRepair(services, round) {
  return (Array.isArray(services) ? services : services?.services || []).some(service => {
    if (!["paid", "in_progress"].includes(service.status)) return false;
    const kind = service.serviceKind || service.service_kind;
    return kind === "repair_full" || (kind === "repair_round" && round
      && (service.roundKey || service.round_key) === round);
  });
}
async function authority(db, scope, deps) {
  const signed = await (deps.hasDisputeAuthorization || hasDisputeAuthorization)(db, scope)
    || await (deps.hasRepairAgreement || hasRepairAgreement)(db, scope);
  const packet = await (deps.evaluateDocGate || evaluateDocGate)(db, scope);
  const identity = await (deps.loadVerifiedIdentity || loadVerifiedIdentity)(db, scope);
  return { signed: Boolean(signed), packetComplete: packet.complete === true,
    identityReviewed: Boolean(identity?.legalName && identity?.address), missing: packet.missing || [],
    uploads: (packet.missing || []).filter(key => key !== "authorization").map(subtype => ({
      label: ({ id_document: "Government photo ID", proof_of_address: "Proof of address", ssn_card: "SSN card" })[subtype] || subtype,
      kind: "client_upload", subtype
    })) };
}
export function currentClientRepairRound(items, cases = []) {
  const open = items.filter(item => ["open", "escalated", "unaddressed"].includes(item.status) && ROUNDS.includes(item.round));
  if (!items.length) {
    const unfinished = cases.find(row => row.status === "open" && ROUNDS.includes(row.round));
    if (unfinished) return unfinished.round;
  }
  if (!open.length) return cases.length ? null : "R1";
  return open.map(item => item.round).sort((a, b) => ROUNDS.indexOf(a) - ROUNDS.indexOf(b))[0];
}
async function casesAndLetters(db, scope) {
  const cases = (await db.query("SELECT id,bureau,round,status,response_due_at FROM dispute_cases WHERE org_id=$1::uuid AND client_id=$2::uuid AND status<>'cancelled' ORDER BY created_at,id", [scope.orgId, scope.clientId])).rows;
  const items = (await db.query(`SELECT i.id,i.case_id,i.round,i.status,i.outcome,i.creditor,i.account_last4,i.rule_id,c.bureau
    FROM dispute_items i JOIN dispute_cases c ON c.id=i.case_id AND c.org_id=i.org_id AND c.client_id=i.client_id
    WHERE i.org_id=$1::uuid AND i.client_id=$2::uuid ORDER BY i.created_at,i.id`, [scope.orgId, scope.clientId])).rows;
  const letters = (await db.query(
    `SELECT l.id,l.case_id,l.bureau,l.round,l.target,l.status,l.created_at,d.id AS document_id,
            s.submission_reference,s.receipt_document_id,s.submitted_at,s.channel
       FROM dispute_letters l LEFT JOIN LATERAL (
         SELECT id FROM documents WHERE org_id=l.org_id AND client_id=l.client_id
          AND kind='deliverable' AND subtype='metro2_dispute_letter_pack'
          AND metadata->>'letterId'=l.id::text AND current_version_id IS NOT NULL
         ORDER BY generated_at DESC LIMIT 1) d ON true
       LEFT JOIN blueprint_repair_submissions s ON s.letter_id=l.id AND s.org_id=l.org_id AND s.client_id=l.client_id
      WHERE l.org_id=$1::uuid AND l.client_id=$2::uuid ORDER BY l.created_at,l.id`, [scope.orgId, scope.clientId]
  )).rows;
  return { cases, items, letters };
}

async function permittedRepairRound(db, scope, data) {
  const ongoing = currentClientRepairRound(data.items, data.cases);
  if (ongoing || data.items.some(item => !["deleted", "updated", "closed"].includes(item.status))) return ongoing;
  const highest = data.cases.map(row => row.round).filter(round => ROUNDS.includes(round))
    .sort((a, b) => ROUNDS.indexOf(b) - ROUNDS.indexOf(a))[0];
  const next = highest ? nextRound(highest) : null;
  if (!next) return null;
  const report = (await db.query(`SELECT id,provider,is_demo,result,created_at FROM crs_results
    WHERE org_id=$1::uuid AND client_id=$2::uuid AND is_demo IS NOT TRUE
    ORDER BY created_at DESC LIMIT 1`, [scope.orgId, scope.clientId])).rows[0];
  const lastLetterAt = Math.max(...data.letters.map(row => new Date(row.created_at).getTime()));
  if (!report || !(new Date(report.created_at).getTime() > lastLetterAt)) return null;
  const findings = mergeDerogatoryClaims(violationsByBureauFromMergedCrs(report.result), derogatoryClaimsByBureau(report.result));
  const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const hasNewItem = Object.entries(findings).some(([bureau, claims]) => genuineInquiryReport(report, bureau)
    && claims.some(claim => !data.items.some(item => item.bureau === bureau
      && item.rule_id === claim.ruleId && normalize(item.creditor) === normalize(claim.creditor)
      && String(item.account_last4 || "") === String(claim.account_last4 || ""))));
  return hasNewItem ? next : null;
}

export async function readClientRepair(db, scope, deps = {}) {
  requireScope(scope);
  const [program, authorization, data, stage, services] = await Promise.all([
    programFor(db, scope), authority(db, scope, deps), casesAndLetters(db, scope),
    (deps.readRepairStage || readRepairStage)(db, scope), servicesFor(db, scope, deps)
  ]);
  const currentRound = await permittedRepairRound(db, scope, data);
  const currentLetters = data.letters.filter(letter => letter.round === currentRound);
  const canGenerate = scope.engagement.status === "active"
    && !teamOwnsRepair(services, currentRound) && authorization.signed && authorization.packetComplete
    && authorization.identityReviewed && Boolean(currentRound)
    && (!currentLetters.length || currentLetters.some(letter => !letter.document_id));
  return { ok: true, program: program ? { id: program.id, kind: program.program, status: program.status, roundsCap: program.rounds_cap } : null,
    authorization, stage, currentRound, executionOwner: teamOwnsRepair(services, currentRound) ? "fundhub" : "client",
    cases: data.cases.map(row => ({ id: row.id, bureau: row.bureau, round: row.round, status: row.status,
      responseDueAt: row.response_due_at || null, portalUrl: INQUIRY_PORTALS[row.bureau] || null,
      executionOwner: teamOwnsRepair(services, row.round) ? "fundhub" : "client",
      items: data.items.filter(item => item.case_id === row.id).map(item => ({ id: item.id, creditor: item.creditor,
        accountLast4: item.account_last4, round: item.round, status: item.status, outcome: item.outcome })),
      letters: data.letters.filter(letter => letter.case_id === row.id).map(letter => ({
        id: letter.id, documentId: letter.document_id || null, bureau: letter.bureau, round: letter.round,
        target: letter.target, status: letter.status,
        canRecordSubmission: scope.engagement.status === "active"
          && !teamOwnsRepair(services, letter.round) && authorization.signed && authorization.packetComplete
          && authorization.identityReviewed && !letter.submitted_at && ["generated", "ready"].includes(letter.status),
        submission: letter.submitted_at ? { reference: letter.submission_reference, receiptDocumentId: letter.receipt_document_id,
          submittedAt: letter.submitted_at, channel: letter.channel } : null
      })) })), actions: { canGenerate } };
}

export async function generateClientRepairLetters(db, scope, _input = {}, deps = {}) {
  requireScope(scope, true);
  const signed = await authority(db, scope, deps);
  if (!signed.signed) fail("repair_authorization_required", "Sign your dispute authorization before preparing letters.", 409);
  if (!signed.packetComplete || !signed.identityReviewed) fail("repair_identity_needed", "Your identity papers need to be complete and reviewed first.", 409);
  const services = await servicesFor(db, scope, deps);
  const store = deps.documentStore || storeFromEnv(deps.env);
  return withTransaction(db, async tx => {
    await tx.query("SELECT id FROM clients WHERE org_id=$1::uuid AND id=$2::uuid FOR UPDATE", [scope.orgId, scope.clientId]);
    const currentProgram = await programFor(tx, scope);
    const data = await casesAndLetters(tx, scope);
    const round = await permittedRepairRound(tx, scope, data);
    if (!round) return { ok: true, status: "no_open_repair_items", letters: [] };
    if (teamOwnsRepair(services, round)) fail("team_handles_repair", "The Fundhub team is handling this repair work.", 409);
    if (!currentProgram || currentProgram.program !== "full" || currentProgram.status !== "active") {
      await (deps.enrollRepairProgram || enrollRepairProgram)(tx, { orgId: scope.orgId, clientId: scope.clientId,
        program: "full", priceTotal: Number(currentProgram?.price_total || 0), amountPaid: Number(currentProgram?.amount_paid || 0) });
    }
    const result = await (deps.analyzeAndGenerate || analyzeAndGenerate)(tx,
      { orgId: scope.orgId, clientId: scope.clientId, round, documentStore: store });
    if (!result.ok) return result;
    if (result.already_generated && result.letters?.length) {
      result.documents = await (deps.persistGeneratedLetters || persistGeneratedLetters)(tx, store,
        { orgId: scope.orgId, clientId: scope.clientId, round, letters: result.letters });
    }
    if (result.letters?.length && (!result.documents?.stored?.length || result.documents?.skipped)) {
      fail("repair_documents_not_saved", "Your letters were prepared but the download files need a team check.", 409);
    }
    return { ok: true, round, status: result.already_generated ? "already_prepared" : "prepared",
      documents: result.documents?.stored || [], letters: result.letters?.map(letter => ({ id: letter.letterId, bureau: letter.bureau })) || [] };
  });
}

export async function recordClientRepairSubmission(db, scope, input, deps = {}) {
  requireScope(scope, true);
  if (!UUID.test(String(input.letterId || "")) || !UUID.test(String(input.receiptDocumentId || ""))) fail("saved_repair_files_required", "Choose a saved letter and upload its actual submission receipt.");
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  if (!reference || reference.length > 250 || !["mail", "portal"].includes(input.channel)) fail("submission_details_required", "Choose mail or portal and enter the actual tracking or submission reference.");
  const services = await servicesFor(db, scope, deps);
  const signed = await authority(db, scope, deps);
  if (!signed.signed || !signed.packetComplete || !signed.identityReviewed) fail("repair_authorization_required", "Your current authorization and reviewed identity papers are needed.", 409);
  return withTransaction(db, async tx => {
    const letter = (await tx.query("SELECT * FROM dispute_letters WHERE id=$1::uuid AND org_id=$2::uuid AND client_id=$3::uuid FOR UPDATE", [input.letterId, scope.orgId, scope.clientId])).rows[0];
    if (!letter) fail("repair_letter_unavailable", "That repair letter is unavailable.", 404);
    if (teamOwnsRepair(services, letter.round)) fail("team_handles_repair", "The Fundhub team is handling this repair work.", 409);
    const prior = (await tx.query("SELECT * FROM blueprint_repair_submissions WHERE letter_id=$1::uuid AND org_id=$2::uuid AND client_id=$3::uuid", [letter.id, scope.orgId, scope.clientId])).rows[0];
    if (prior) {
      if (prior.submission_reference !== reference || prior.receipt_document_id !== input.receiptDocumentId || prior.channel !== input.channel) fail("submission_already_saved", "This letter already has its submission receipt.", 409);
      return { ok: true, status: "submitted_awaiting_response", letterId: letter.id, submittedAt: prior.submitted_at, replayed: true };
    }
    if (!["generated", "ready"].includes(letter.status) || letter.send_claimed_at || letter.mailed_at) fail("repair_letter_already_handled", "This letter is already being handled. Ask the Fundhub team before sending it again.", 409);
    const receipt = (await tx.query(
      `SELECT d.id FROM documents d WHERE d.id=$1::uuid AND d.org_id=$2::uuid AND d.client_id=$3::uuid
        AND d.kind='client_upload' AND d.subtype='repair_submission_receipt'
        AND d.current_version_id IS NOT NULL AND (d.expires_at IS NULL OR d.expires_at>now())
        AND EXISTS (SELECT 1 FROM document_versions v WHERE v.id=d.current_version_id AND v.document_id=d.id AND v.org_id=d.org_id)`,
      [input.receiptDocumentId, scope.orgId, scope.clientId]
    )).rows[0];
    if (!receipt) fail("repair_receipt_unavailable", "Upload the actual receipt for this client file.", 409);
    const at = scope.now || new Date();
    await tx.query("INSERT INTO blueprint_repair_submissions(org_id,client_id,letter_id,requested_account_id,receipt_document_id,submission_reference,channel,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [scope.orgId, scope.clientId, letter.id, scope.accountId, receipt.id, reference, input.channel, at]);
    await tx.query("UPDATE dispute_letters SET status='sent' WHERE id=$1::uuid AND org_id=$2::uuid AND client_id=$3::uuid", [letter.id, scope.orgId, scope.clientId]);
    await tx.query("UPDATE dispute_items SET status='sent' WHERE case_id=$1::uuid AND org_id=$2::uuid AND client_id=$3::uuid AND round=$4 AND status IN ('open','escalated','unaddressed')", [letter.case_id, scope.orgId, scope.clientId, letter.round]);
    await tx.query("UPDATE dispute_cases SET status='awaiting_response', updated_at=now() WHERE id=$1::uuid AND org_id=$2::uuid AND client_id=$3::uuid AND status NOT IN ('closed','cancelled')", [letter.case_id, scope.orgId, scope.clientId]);
    await (deps.onRepairEvent || onRepairEvent)(tx, { name: "repair.letters.sent", orgId: scope.orgId, clientId: scope.clientId,
      payload: { source: "client_submission_receipt", letterId: letter.id, receiptDocumentId: receipt.id,
        accountId: scope.accountId, idempotencyKey: `repair.self-submitted:${letter.id}` } });
    return { ok: true, status: "submitted_awaiting_response", letterId: letter.id, submittedAt: at };
  });
}
