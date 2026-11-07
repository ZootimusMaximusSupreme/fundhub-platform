import { createHash, createHmac } from "node:crypto";
import { withTransaction } from "../db/with-transaction.mjs";
import { revealSsn } from "../pii/index.mjs";
import { isUuid } from "../http/read-api.mjs";
import { isoBirthDate } from "./crs-identities.mjs";
import { createCrsPropertyClient, propertyConfigFromEnv } from "./crs-property-client.mjs";
import { buildPropertyRequest, propertyRequestId, PropertyReportError, PROPERTY_CONSENT_TEXT, PROPERTY_CONSENT_VERSION } from "./crs-property-contract.mjs";

const ROLES = new Set(["owner", "admin", "funding_advisor"]);
const answer = (status, body) => ({ status, body: { ok: status < 400, ...body } });
const deny = (code, status = 400) => { throw new PropertyReportError(code, status); };
const date = v => v instanceof Date ? v.toISOString() : v;
export function propertyStaffAllowed(principal) {
  return principal?.kind === "staff" && isUuid(principal.orgId) && isUuid(principal.staffId)
    && ROLES.has(String(principal.role || "").toLowerCase());
}
function authorize(principal, clientId) {
  if (!propertyStaffAllowed(principal)) deny("forbidden", 403);
  if (!isUuid(clientId)) deny("invalid_client_id");
}
function identityKey(env) {
  const key = Buffer.from(String(env.PII_ENC_KEY || ""), "base64");
  if (key.length !== 32) deny("property_not_configured", 503);
  return key;
}
function stableIdentityFingerprint(identity, principal, clientId, env) {
  const person = buildPropertyRequest(identity).terms.term[0].person;
  const normalize = v => v.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
  return createHmac("sha256", identityKey(env)).update("crs-property-identity-v1\0")
    .update(JSON.stringify([principal.orgId.toLowerCase(),clientId.toLowerCase(),normalize(person.firstName),normalize(person.lastName),person.ssn,person.dob]))
    .digest("hex");
}

async function loadSavedIdentity(db, principal, clientId, lock = false) {
  const client = (await db.query(
    `SELECT id,first_name,last_name,is_demo FROM clients WHERE id=$1 AND org_id=$2
      AND custom_fields->>'crm_archived_at' IS NULL${lock ? " FOR UPDATE" : ""}`,
    [clientId, principal.orgId]
  )).rows[0];
  if (!client) deny("client_not_found", 404);
  const identity = (await db.query(
    `SELECT id,dob,ssn_enc FROM pii_identity WHERE client_id=$1 AND org_id=$2${lock ? " FOR UPDATE" : ""}`,
    [clientId, principal.orgId]
  )).rows[0];
  const birthDate = isoBirthDate(identity?.dob);
  const ready = !!(identity?.ssn_enc?.length && birthDate && client.first_name?.trim() && client.last_name?.trim());
  // Bind reads to the exact saved encrypted identity without decrypting on GET.
  const fingerprint = ready ? createHash("sha256").update(JSON.stringify([
    client.first_name.trim(), client.last_name.trim(), birthDate,
    Buffer.from(identity.ssn_enc).toString("hex")
  ])).digest("hex") : null;
  return { client, birthDate, fingerprint, ready };
}

function receipt(row, currentFingerprint) {
  if (!row) return { status: "empty", report: null };
  const stale = row.identity_version_fingerprint !== currentFingerprint;
  return { id: row.id, status: stale ? "needs_review" : row.status,
    environment: row.environment, providerRequestId: row.provider_request_id || null,
    checkedAt: date(row.finished_at || row.created_at),
    reason: stale ? "identity_changed" : row.status === "in_flight" ? "provider_in_progress" : row.error_code || null,
    report: !stale && row.status === "completed" ? row.normalized_response : null };
}

export async function getPropertyReport(db, principal, { clientId }, { env = process.env } = {}) {
  authorize(principal, clientId);
  const saved = await loadSavedIdentity(db, principal, clientId);
  const rows = (await db.query(
    `SELECT * FROM crs_property_requests WHERE org_id=$1 AND client_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [principal.orgId, clientId]
  )).rows;
  const config = propertyConfigFromEnv(env);
  return answer(200, { ...receipt(rows[0], saved.fingerprint), identityReady: saved.ready,
    mayOrder: config.configured && config.environment === "production" && saved.ready && saved.client.is_demo !== true
      && Buffer.from(String(env.PII_ENC_KEY || ""), "base64").length === 32
      && !rows.some(r => r.status === "in_flight" || r.identity_version_fingerprint === saved.fingerprint),
    connectionReady: config.configured && config.environment === "production",
    consent: { version: PROPERTY_CONSENT_VERSION, text: PROPERTY_CONSENT_TEXT } });
}

export async function orderPropertyReport(db, principal, input, {
  env = process.env, client = null, reveal = revealSsn
} = {}) {
  const { clientId, operationId, consentAccepted, consentVersion } = input;
  authorize(principal, clientId);
  if (!isUuid(operationId)) deny("invalid_operation_id");
  if (consentAccepted !== true || consentVersion !== PROPERTY_CONSENT_VERSION) deny("property_consent_required", 422);
  const config = propertyConfigFromEnv(env);
  if (!config.configured || config.environment !== "production") deny("property_not_configured", 503);
  identityKey(env);
  const claim = await withTransaction(db, async tx => {
    const saved = await loadSavedIdentity(tx, principal, clientId, true);
    if (saved.client.is_demo === true) deny("property_test_client_refused", 422);
    if (!saved.ready) deny("identity_required", 422);
    const operation = (await tx.query(
      `SELECT * FROM crs_property_requests WHERE org_id=$1 AND operation_id=$2`, [principal.orgId, operationId]
    )).rows[0];
    if (operation && operation.client_id !== clientId) deny("operation_conflict", 409);
    const existing = (await tx.query(
      `SELECT * FROM crs_property_requests WHERE org_id=$1 AND client_id=$2
        AND (identity_version_fingerprint=$3 OR status='in_flight') ORDER BY created_at DESC LIMIT 1`,
      [principal.orgId, clientId, saved.fingerprint]
    )).rows[0];
    if (existing) {
      if (operation && existing.id !== operation.id) deny("operation_conflict", 409);
      return { replay: receipt(existing, saved.fingerprint), status: existing.status === "in_flight" ? 202 : 200 };
    }
    const { ssn } = await reveal(tx, { orgId: principal.orgId, clientId,
      accessedBy: `staff:${principal.staffId}`, reason: "authorized CRS property ownership report", env });
    const identity = { firstName: saved.client.first_name, lastName: saved.client.last_name,
      birthDate: saved.birthDate, ssn };
    const fingerprint = stableIdentityFingerprint(identity, principal, clientId, env);
    if (operation && operation.identity_fingerprint !== fingerprint) deny("operation_conflict", 409);
    const samePerson = operation || (await tx.query(
      `SELECT * FROM crs_property_requests WHERE org_id=$1 AND client_id=$2 AND identity_fingerprint=$3`,
      [principal.orgId, clientId, fingerprint]
    )).rows[0];
    if (samePerson) {
      const rebound = (await tx.query(
        `UPDATE crs_property_requests SET identity_version_fingerprint=$4,updated_at=now()
          WHERE id=$1 AND org_id=$2 AND client_id=$3 RETURNING *`,
        [samePerson.id, principal.orgId, clientId, saved.fingerprint]
      )).rows[0];
      if (!rebound) deny("property_claim_failed", 500);
      return { replay: receipt(rebound, saved.fingerprint), status: rebound.status === "in_flight" ? 202 : 200 };
    }
    const row = (await tx.query(
      `INSERT INTO crs_property_requests(org_id,client_id,requester_staff_id,operation_id,environment,
        identity_fingerprint,identity_version_fingerprint,consent_text,consent_version,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'in_flight') RETURNING *`,
      [principal.orgId, clientId, principal.staffId, operationId, config.environment,
        fingerprint, saved.fingerprint, PROPERTY_CONSENT_TEXT, PROPERTY_CONSENT_VERSION]
    )).rows[0];
    if (!row) deny("property_claim_failed", 500);
    return { row, identity, version: saved.fingerprint };
  });
  if (claim.replay) return answer(claim.status, { ...claim.replay, replayed: true });
  let response;
  try { response = await (client || createCrsPropertyClient({ env })).order({ identity: claim.identity }); }
  catch { response = { ok: false, uncertain: true, code: "property_provider_uncertain" }; }
  if (response?.ok && !propertyRequestId(response.requestId)) {
    response = { ok: false, uncertain: true, code: "provider_request_id_missing", requestId: null };
  }
  const result = await withTransaction(db, async tx => {
    const saved = await loadSavedIdentity(tx, principal, clientId, true);
    const stale = saved.fingerprint !== claim.version;
    const status = response?.ok && !stale ? "completed" : response?.ok || response?.uncertain ? "needs_review" : "error";
    const code = stale ? "identity_changed" : response?.ok ? null : response?.code || "property_provider_uncertain";
    const row = (await tx.query(
      `UPDATE crs_property_requests SET status=$4,provider_request_id=$5,normalized_response=$6::jsonb,
        error_code=$7,finished_at=now(),updated_at=now() WHERE id=$1 AND org_id=$2 AND client_id=$3
        AND status='in_flight' RETURNING *`,
      [claim.row.id, principal.orgId, clientId, status, propertyRequestId(response?.requestId),
        response?.ok ? JSON.stringify(response.report) : null, code]
    )).rows[0];
    if (!row) deny("property_receipt_not_saved", 500);
    return receipt(row, saved.fingerprint);
  });
  return answer(200, { ...result, replayed: false });
}
