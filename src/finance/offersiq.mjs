// Staff-triggered OffersIQ evaluation. The saved setter-confirmed home address
// is the only identity source; a browser body cannot select another person.
// A durable claim is committed before the CRS call. An uncertain call is never
// repeated automatically, because CRS may already have processed it.

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { allowsRole, isUuid, ROLE_SETS } from "../http/read-api.mjs";
import { adaptersBlocked } from "../lib/dry-run.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { CRS_PRODUCTION_HOST, CRS_SANDBOX_HOST, normalizeHost } from "./crs-identities.mjs";
import { createCrsClient } from "./crs-client.mjs";
import { assertOffersIqWireBody, buildOffersIqRequest, parseOffersIqResponse } from "./offersiq-contract.mjs";
import { classifyOffersIqReceipt } from "./offersiq-lead-sort.mjs";

// Bounded well above the current draft. A truncated list fails scorer matching.
const MAX_OFFER_CONDITIONS = 1000;

const FINISHED = new Set(["matched", "not_matched", "needs_review", "error"]);
const SAFE_REASONS = new Set(["identity_changed", "request_id_missing", "invalid_response",
  "ruleset_mismatch", "decision_missing_or_conflicting", "INSUFFICIENT_DATA",
  "provider_uncertain", "transmission_blocked"]);
// Exact attribute names in the supplied OffersIQ Credit Attributes Guide.
// The API may return only the attributes selected for the account's rule set.
const OFFERSIQ_ATTRIBUTES = new Set(`
creditScore totalAccountCount openAccountCount openInstallmentAccountCount
openRevolvingAccountCount openOtherAccountCount inquiryCount availableCredit
totalOpenBalance unsecuredCreditCardBalance unsecuredDebtBalance
totalAdverseItemCount nonMedicalThirdPartyCollectionBalance
creditCardPersonalLoanCollectionsBalance
unsecuredDebtBalance3mPlusNonMedicalCollectionBalance12m
unsecuredDebtBalanceExcludingGovernment3m
unsecuredDebtBalanceExcludingGovernmentPlusNonMedicalCollections
unsecuredDebtExGovtPlusCreditCardPersonalLoanCollectionsBalance
unsecuredDebtBalanceExcludingGovernment revolvingDebtAmount revolvingDebtUtilization
unsecuredUtilization medicalTypeBalance studentLoanBalance educationLoanBalance
govSecuredLoanBalance chargeAccountBalance noteLoanBalance visaCardBalance
mastercardCardBalance discoverCardBalance amexCardBalance delinquentAccountCount
derogatoryAccountCount delinquencyPast12MonthCount onTimePaymentPercentage
openMortgageDelinquency openAutoDelinquency totalCollectionCount
totalCollectionAmount nonMedicalThirdPartyCollectionCount repossessionCount
foreclosureCount publicRecordCount publicRecordBankruptcyCount taxLienCount
openBankruptcyPast84Months closedBankruptcyPast84Months
monthsSinceMostRecentPublicRecord totalScheduledMonthlyPayment autoHighCredit
autoUtilization openToBuyExcludingInstallmentsAndMortgages
monthsSinceMostRecentInquiry activeOpenAccountCount activeOpenRevolvingAccountCount
activeOpenInstallmentAccountCount activeOpenOtherAccountCount activeTotalOpenBalance
activeAvailableCredit activeRevolvingDebtAmount activeRevolvingDebtUtilization
activeUnsecuredCreditCardBalance activeUnsecuredDebtBalance activeUnsecuredUtilization
activeVisaCardBalance activeMastercardCardBalance activeDiscoverCardBalance
activeAmexCardBalance RI_Auto_60plus_18mo_similar_amount
RI_Auto_60plus_18mo_any_amount RI_Auto_120plus_18mo_similar_amount
RI_Auto_120plus_18mo_any_amount RI_CC_60plus_18mo_similar_amount
RI_CC_60plus_18mo_any_amount RI_CC_120plus_18mo_similar_amount
RI_CC_120plus_18mo_any_amount RI_PL_60plus_18mo_similar_amount
RI_PL_60plus_18mo_any_amount RI_PL_120plus_18mo_similar_amount
RI_PL_120plus_18mo_any_amount`.trim().split(/\s+/));

const answer = (http, status, extra = {}) => ({
  status: http,
  body: { ok: http < 400, status, ...extra }
});

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

export function offersIqConfigFromEnv(env = process.env) {
  const host = normalizeHost(env?.CRS_OFFERSIQ_API_HOST);
  const username = clean(env?.CRS_OFFERSIQ_API_USERNAME);
  const password = clean(env?.CRS_OFFERSIQ_API_PASSWORD);
  const ruleText = clean(env?.CRS_OFFERSIQ_RULESET_ID);
  const ruleSetId = /^\d+$/.test(ruleText) && Number.isSafeInteger(Number(ruleText)) && Number(ruleText) > 0
    ? Number(ruleText) : null;
  const environment = host === CRS_SANDBOX_HOST ? "sandbox"
    : host === CRS_PRODUCTION_HOST ? "production" : null;
  const liveAllowed = /^(?:1|true|yes|on)$/i.test(clean(env?.CRS_OFFERSIQ_ALLOW_LIVE));
  const missing = [];
  if (!environment) missing.push("CRS_OFFERSIQ_API_HOST");
  if (!username) missing.push("CRS_OFFERSIQ_API_USERNAME");
  if (!password) missing.push("CRS_OFFERSIQ_API_PASSWORD");
  if (!ruleSetId) missing.push("CRS_OFFERSIQ_RULESET_ID");
  if (environment === "production" && !liveAllowed) missing.push("CRS_OFFERSIQ_ALLOW_LIVE");
  if (adaptersBlocked(env)) missing.push("ADAPTERS_DRY_RUN");
  return {
    configured: missing.length === 0, missing, environment, host, ruleSetId,
    // Only these dedicated values can reach the shared CRS transport.
    clientEnv: {
      ...env,
      CRS_API_HOST: host,
      CRS_API_USERNAME: username,
      CRS_API_PASSWORD: password,
      CRS_ALLOW_LIVE: environment === "production" && liveAllowed ? "on" : "off"
    }
  };
}

function confirmedAddress(fields) {
  const address = object(object(fields).setter_residential_address);
  if (address.source !== "setter_confirmed" || !validDate(address.confirmed_at)) return null;
  const line1 = clean(address.line1);
  const city = clean(address.city);
  const state = clean(address.state).toUpperCase();
  const zip = clean(address.zip);
  if (!line1 || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip)) return null;
  return { line1, line2: clean(address.line2), city, state, zip, confirmedAt: address.confirmed_at };
}

function identityFromClient(client) {
  const address = confirmedAddress(client?.custom_fields);
  if (!address) return null;
  const firstName = clean(client.first_name);
  const lastName = clean(client.last_name);
  if (!firstName || !lastName) return null;
  const digits = clean(client.phone).replace(/\D/g, "");
  const phone = digits.length === 11 && digits.startsWith("1") ? digits.slice(1)
    : digits.length === 10 ? digits : "";
  return {
    firstName, lastName, ...(phone ? { phone } : {}),
    address: { line1: address.line1, line2: address.line2,
      city: address.city, state: address.state, zip: address.zip }
  };
}

function identityFingerprint(identity, ruleSetId, environment) {
  const address = identity.address;
  const canonical = [ruleSetId, environment, identity.firstName, identity.lastName,
    identity.phone || "", address.line1, address.line2, address.city, address.state, address.zip]
    .map(value => String(value).trim().replace(/\s+/g, " ").toUpperCase());
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function offersIqIdentityKeyForClient(client) {
  const identity = identityFromClient(client);
  return identity ? identityFingerprint(identity, 0, "identity") : null;
}

/** A queue/closer may read the latest summary only when it still names this identity. */
export function offersIqSummaryForClient(client) {
  const summary = sanitizeStoredSummary(object(client?.custom_fields).offersiq);
  if (!summary) return null;
  const identity = identityFromClient(client);
  const current = identity && identityFingerprint(identity, summary.rule_set_id, summary.environment);
  if (current === summary.identity_fingerprint && !summary.stale) return summary;
  return staleSummary(summary);
}

function staleSummary(summary) {
  return {
    outcome: "needs_review", stale: true, reason: "identity_changed",
    rule_set_id: summary.rule_set_id, environment: summary.environment,
    checked_at: summary.checked_at
  };
}

function allowedStaff(staff) {
  if (!isUuid(staff?.id) || !isUuid(staff?.org_id)) return false;
  const primary = clean(staff.role).toLowerCase();
  const canStackRoles = primary && !["partner", "client", "affiliate", "outbound_rep"].includes(primary);
  return allowsRole(ROLE_SETS.SETTER, primary) || (canStackRoles && Array.isArray(staff.roles)
    && staff.roles.some(role => clean(role).toLowerCase() !== "owner"
      && allowsRole(ROLE_SETS.SETTER, role)));
}

function needsSetterAssignment(staff) {
  return !["owner", "admin"].includes(clean(staff?.role).toLowerCase());
}

async function loadAuthorizedClient(db, staff, clientId, { lock = false } = {}) {
  if (!allowedStaff(staff)) return answer(403, "error", { error: "forbidden" });
  if (!isUuid(clientId)) return answer(400, "error", { error: "invalid_client_id" });
  const client = (await db.query(
    `SELECT id, first_name, last_name, phone, custom_fields
       FROM clients WHERE id = $1 AND org_id = $2
         AND custom_fields->>'crm_archived_at' IS NULL${lock ? " FOR UPDATE" : ""}`,
    [clientId, staff.org_id]
  )).rows[0];
  if (!client) return answer(404, "error", { error: "client_not_found" });
  if (needsSetterAssignment(staff)) {
    const handoff = object(object(client.custom_fields).setter_handoff);
    if (handoff.setter_staff_id && handoff.setter_staff_id !== staff.id) {
      return answer(403, "error", { error: "assigned_to_other_setter" });
    }
    const task = (await db.query(
      `SELECT assignee_staff_id FROM tasks
        WHERE org_id = $1 AND client_id = $2 AND assignee_role = 'setter'
        ORDER BY created_at DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [staff.org_id, clientId]
    )).rows[0];
    if (!task || (task.assignee_staff_id && task.assignee_staff_id !== staff.id)) {
      return answer(403, "error", { error: "assigned_to_other_setter" });
    }
  }
  return { client };
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeOffersIqAttributes(input) {
  const source = object(input);
  const fields = {};
  for (const key of OFFERSIQ_ATTRIBUTES) {
    const value = source[key];
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      fields[key] = value;
    }
  }
  return fields;
}

function safeCondition(input) {
  const value = object(input);
  const condition = {};
  for (const key of ["attributeCode", "attributeName", "status", "operator"]) {
    if (typeof value[key] === "string") condition[key] = value[key].slice(0, 160);
  }
  for (const key of ["passed", "negated"]) {
    if (typeof value[key] === "boolean") condition[key] = value[key];
  }
  if (safeCount(value.position) !== undefined) condition.position = value.position;
  if (typeof value.expectedValue === "number" && Number.isFinite(value.expectedValue)) {
    condition.expectedValue = value.expectedValue;
  } else if (Array.isArray(value.expectedValue) && value.expectedValue.length === 2
      && value.expectedValue.every(edge => typeof edge === "number" && Number.isFinite(edge))) {
    condition.expectedValue = [...value.expectedValue];
  }
  return condition;
}

function safeGroup(input, depth = 0) {
  if (!input || typeof input !== "object" || depth > 8) return null;
  const value = object(input);
  const group = {};
  for (const key of ["operator", "status"]) {
    if (typeof value[key] === "string") group[key] = value[key].slice(0, 40);
  }
  for (const key of ["passed", "negated"]) {
    if (typeof value[key] === "boolean") group[key] = value[key];
  }
  for (const key of ["totalConditions", "passedConditions", "failedConditions", "unverifiableConditions", "position"]) {
    if (safeCount(value[key]) !== undefined) group[key] = value[key];
  }
  if (Array.isArray(value.conditions)) group.conditions = value.conditions.slice(0, MAX_OFFER_CONDITIONS).map(safeCondition);
  if (Array.isArray(value.groups)) group.groups = value.groups.slice(0, 30).map(child => safeGroup(child, depth + 1)).filter(Boolean);
  return group;
}

function sanitizeStoredSummary(input) {
  const value = object(input);
  if (!FINISHED.has(value.outcome) || !Number.isSafeInteger(value.rule_set_id)
      || value.rule_set_id <= 0 || !["sandbox", "production"].includes(value.environment)
      || !/^[0-9a-f]{64}$/.test(clean(value.identity_fingerprint))) return null;
  const summary = {
    outcome: value.outcome, rule_set_id: value.rule_set_id,
    environment: value.environment, identity_fingerprint: value.identity_fingerprint,
    request_id: isUuid(value.request_id) ? value.request_id : null,
    checked_at: validDate(value.checked_at)
  };
  if (value.stale === true) summary.stale = true;
  if (typeof value.decision_status === "string") summary.decision_status = value.decision_status.slice(0, 40);
  if (typeof value.overall_decision === "boolean") summary.overall_decision = value.overall_decision;
  if (typeof value.rule_set_name === "string") summary.rule_set_name = value.rule_set_name.slice(0, 160);
  if (typeof value.decision_mode === "string") summary.decision_mode = value.decision_mode.slice(0, 40);
  if (SAFE_REASONS.has(value.reason) || /^provider_http_\d{1,3}$/.test(clean(value.reason))) {
    summary.reason = value.reason;
  }
  if (value.stale || !["matched", "not_matched"].includes(value.outcome)) return summary;
  // Older rows can predate contract checks. Recheck any retained decision
  // fields before showing financial values from a previously saved receipt.
  const body = { ruleSetId: value.rule_set_id };
  if (Object.hasOwn(value, "decision_status")) body.decisionStatus = value.decision_status;
  if (Object.hasOwn(value, "overall_decision")) body.overallDecision = value.overall_decision;
  if (Object.hasOwn(value, "root_group")) body.ruleEvaluation = { rootGroup: value.root_group };
  if (!Object.hasOwn(body, "overallDecision") && !Object.hasOwn(body, "decisionStatus")) {
    body.overallDecision = value.outcome === "matched";
  }
  if (parseOffersIqResponse({ body, requestId: summary.request_id }).outcome !== value.outcome) {
    return { ...summary, outcome: "needs_review", reason: "decision_missing_or_conflicting" };
  }
  const counts = {};
  for (const key of ["totalConditions", "passedConditions", "failedConditions", "unverifiableConditions"]) {
    if (safeCount(object(value.condition_counts)[key]) !== undefined) counts[key] = value.condition_counts[key];
  }
  if (Object.keys(counts).length) summary.condition_counts = counts;
  if (Array.isArray(value.individual_results)) {
    summary.individual_results = value.individual_results.slice(0, MAX_OFFER_CONDITIONS).map(safeCondition);
  }
  const rootGroup = safeGroup(value.root_group);
  if (rootGroup) summary.root_group = rootGroup;
  const attributes = safeOffersIqAttributes(value.offers_iq_summary);
  if (Object.keys(attributes).length) summary.offers_iq_summary = attributes;
  if (typeof attributes.creditScore === "number") summary.credit_score = attributes.creditScore;
  return summary;
}

export function safeOffersIqSummary(decision, { ruleSetId, environment, fingerprint, checkedAt }) {
  const value = object(decision);
  const evaluation = object(value.ruleEvaluation);
  const summary = {
    outcome: FINISHED.has(value.outcome) ? value.outcome : "needs_review",
    rule_set_id: ruleSetId,
    environment,
    identity_fingerprint: fingerprint,
    request_id: clean(value.requestId) || null,
    checked_at: checkedAt
  };
  if (typeof value.decisionStatus === "string") summary.decision_status = value.decisionStatus.slice(0, 40);
  if (SAFE_REASONS.has(value.reason)) summary.reason = value.reason;
  if (typeof value.overallDecision === "boolean") summary.overall_decision = value.overallDecision;
  if (typeof evaluation.ruleSetName === "string") summary.rule_set_name = evaluation.ruleSetName.slice(0, 160);
  const counts = {};
  for (const key of ["totalConditions", "passedConditions", "failedConditions", "unverifiableConditions"]) {
    if (safeCount(evaluation[key]) !== undefined) counts[key] = evaluation[key];
  }
  if (Object.keys(counts).length) summary.condition_counts = counts;
  if (typeof evaluation.decisionMode === "string") summary.decision_mode = evaluation.decisionMode.slice(0, 40);
  if (Array.isArray(evaluation.individualResults)) {
    summary.individual_results = evaluation.individualResults.slice(0, MAX_OFFER_CONDITIONS).map(safeCondition);
  }
  const rootGroup = safeGroup(evaluation.rootGroup);
  if (rootGroup) summary.root_group = rootGroup;
  const attributes = safeOffersIqAttributes(value.offersIQSummary);
  if (Object.keys(attributes).length) summary.offers_iq_summary = attributes;
  if (typeof attributes.creditScore === "number") summary.credit_score = attributes.creditScore;
  // No raw provider body, identity, DOB, SSN, or free-form provider message is saved.
  return summary;
}

function summaryFromRow(row) {
  const summary = sanitizeStoredSummary(row.normalized_response);
  if (summary) return summary;
  return {
    outcome: row.status === "in_flight" ? "needs_review" : row.status,
    reason: row.status === "in_flight" ? "in_progress" : row.error_code || "provider_error",
    rule_set_id: Number(row.rule_set_id), environment: row.environment,
    identity_fingerprint: row.identity_fingerprint,
    request_id: row.provider_request_id || null,
    checked_at: row.finished_at || row.created_at
  };
}

function responseFromRow(row) {
  const summary = summaryFromRow(row);
  return answer(row.status === "in_flight" ? 202 : 200, summary.outcome,
    { result: summary, replayed: true });
}

async function publishSummary(db, orgId, clientId, summary) {
  const published = await db.query(
    `UPDATE clients SET custom_fields = jsonb_set(
       COALESCE(custom_fields, '{}'::jsonb), '{offersiq}', $3::jsonb, true), updated_at = now()
     WHERE id = $1 AND org_id = $2 RETURNING id`,
    [clientId, orgId, JSON.stringify(summary)]
  );
  if (!published.rows.length) throw new Error("offersiq_client_publish_failed");
}

// The caller holds the client row lock and has verified the receipt's identity.
async function replayCurrentReceipt(db, staff, client, row) {
  const response = responseFromRow(row);
  if (FINISHED.has(row.status) && !isDeepStrictEqual(offersIqSummaryForClient(client), response.body.result)) {
    await publishSummary(db, staff.org_id, client.id, response.body.result);
  }
  return response;
}

function consentForRequest(input) {
  const consent = object(input);
  if (consent.accepted !== true || !/^https:\/\//i.test(clean(consent.termsUrl))
      || clean(consent.termsUrl).length > 500 || !clean(consent.consentVersion)
      || clean(consent.consentVersion).length > 100 || !validDate(consent.consentTimestamp)) return null;
  return {
    accepted: true, termsUrl: clean(consent.termsUrl),
    consentVersion: clean(consent.consentVersion),
    consentTimestamp: validDate(consent.consentTimestamp)
  };
}

async function currentReceipt(db, staff, clientId, config, fingerprint) {
  return (await db.query(
    `SELECT * FROM offersiq_requests
      WHERE org_id = $1 AND client_id = $2 AND rule_set_id = $3
        AND environment = $4 AND identity_fingerprint = $5
      LIMIT 1`,
    [staff.org_id, clientId, config.ruleSetId, config.environment, fingerprint]
  )).rows[0] || null;
}

async function pendingReceipt(db, staff, clientId) {
  return (await db.query(
    `SELECT id FROM offersiq_requests
      WHERE org_id = $1 AND client_id = $2 AND status = 'in_flight'
      LIMIT 1`,
    [staff.org_id, clientId]
  )).rows[0] || null;
}

// Saving a previously screened address restores its receipt for all staff views.
export async function restoreOffersIqForAddress(db, staff, client, env) {
  const config = offersIqConfigFromEnv(env);
  const identity = identityFromClient(client);
  if (!config.configured || !identity) return;
  const fingerprint = identityFingerprint(identity, config.ruleSetId, config.environment);
  const row = await currentReceipt(db, staff, client.id, config, fingerprint);
  if (row) await replayCurrentReceipt(db, staff, client, row);
}

export async function getOffersIqStatus(db, staff, { clientId } = {}, deps = {}) {
  const loaded = await loadAuthorizedClient(db, staff, clientId);
  if (!loaded.client) return loaded;
  const identity = identityFromClient(loaded.client);
  if (!identity) return answer(200, "needs_address");
  const config = offersIqConfigFromEnv(deps.env ?? process.env);
  if (!config.configured) return answer(200, "not_configured", { missing: config.missing });
  const fingerprint = identityFingerprint(identity, config.ruleSetId, config.environment);
  const existing = await currentReceipt(db, staff, clientId, config, fingerprint);
  if (existing) return responseFromRow(existing);
  if (await pendingReceipt(db, staff, clientId)) {
    return answer(202, "needs_review", { error: "offer_check_in_progress" });
  }
  return answer(200, "needs_consent");
}

export async function evaluateLeadOffersIq(db, staff,
  { clientId, operationId, consent } = {}, deps = {}) {
  if (!isUuid(operationId)) return answer(400, "error", { error: "invalid_operation_id" });
  const env = deps.env ?? process.env;
  const config = offersIqConfigFromEnv(env);
  const claim = await withTransaction(db, async writer => {
    const loaded = await loadAuthorizedClient(writer, staff, clientId, { lock: true });
    if (!loaded.client) return loaded;
    const client = loaded.client;
    const identity = identityFromClient(client);
    if (!identity) return answer(200, "needs_address");
    if (!config.configured) return answer(200, "not_configured", { missing: config.missing });
    const fingerprint = identityFingerprint(identity, config.ruleSetId, config.environment);
    const byOperation = (await writer.query(
      `SELECT * FROM offersiq_requests WHERE org_id = $1 AND operation_id = $2 LIMIT 1`,
      [staff.org_id, operationId]
    )).rows[0];
    if (byOperation) {
      if (byOperation.client_id !== clientId || Number(byOperation.rule_set_id) !== config.ruleSetId
          || byOperation.environment !== config.environment || byOperation.identity_fingerprint !== fingerprint) {
        return answer(409, "error", { error: "operation_identity_mismatch" });
      }
      return replayCurrentReceipt(writer, staff, client, byOperation);
    }
    const existing = await currentReceipt(writer, staff, clientId, config, fingerprint);
    if (existing) return replayCurrentReceipt(writer, staff, client, existing);
    if (await pendingReceipt(writer, staff, clientId)) {
      return answer(202, "needs_review", { error: "offer_check_in_progress" });
    }
    const acceptedConsent = consentForRequest(consent);
    if (!acceptedConsent) return answer(200, "needs_consent");
    try {
      const wire = buildOffersIqRequest({ ruleSetId: config.ruleSetId, identity, consent: acceptedConsent });
      assertOffersIqWireBody(wire, { sandbox: config.environment === "sandbox" });
    } catch (error) {
      return answer(200, "needs_review", { error: clean(error?.code) || "identity_unusable" });
    }
    const address = confirmedAddress(client.custom_fields);
    const inserted = (await writer.query(
      `INSERT INTO offersiq_requests
        (org_id, client_id, requester_staff_id, operation_id, rule_set_id, environment,
         identity_fingerprint, identity_source, address_confirmed_at,
         consent_terms_url, consent_version, consent_accepted_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'setter_confirmed',$8,$9,$10,$11,'in_flight')
       ON CONFLICT DO NOTHING RETURNING *`,
      [staff.org_id, clientId, staff.id, operationId, config.ruleSetId, config.environment,
        fingerprint, address.confirmedAt, acceptedConsent.termsUrl,
        acceptedConsent.consentVersion, acceptedConsent.consentTimestamp]
    )).rows[0];
    if (!inserted) {
      const racedOperation = (await writer.query(
        `SELECT * FROM offersiq_requests WHERE org_id = $1 AND operation_id = $2 LIMIT 1`,
        [staff.org_id, operationId]
      )).rows[0];
      if (racedOperation && (racedOperation.client_id !== clientId
          || racedOperation.identity_fingerprint !== fingerprint
          || Number(racedOperation.rule_set_id) !== config.ruleSetId
          || racedOperation.environment !== config.environment)) {
        return answer(409, "error", { error: "operation_identity_mismatch" });
      }
      const raced = racedOperation || await currentReceipt(writer, staff, clientId, config, fingerprint);
      if (raced) return replayCurrentReceipt(writer, staff, client, raced);
      if (await pendingReceipt(writer, staff, clientId)) {
        return answer(202, "needs_review", { error: "offer_check_in_progress" });
      }
      throw new Error("offersiq_claim_conflict_unresolved");
    }
    return { claimed: inserted, identity, acceptedConsent, fingerprint };
  });
  if (!claim.claimed) return claim;

  let result;
  try {
    const client = deps.client || createCrsClient({ env: config.clientEnv });
    result = await client.evaluateOffersIq({
      ruleSetId: config.ruleSetId, identity: claim.identity, consent: claim.acceptedConsent
    });
  } catch {
    // The request may have crossed the wire. Retain the claim and require review.
    result = { ok: false, status: 0, requestId: null, decision: null, error: "provider_uncertain" };
  }

  const checkedAt = (deps.now || (() => new Date()))().toISOString();
  const outcome = FINISHED.has(result.decision?.outcome)
    ? result.decision.outcome
    : result.blocked || (result.status >= 400 && result.status < 500) ? "error" : "needs_review";
  const evaluated = safeOffersIqSummary(result.decision || { outcome }, {
    ruleSetId: config.ruleSetId, environment: config.environment,
    fingerprint: claim.fingerprint, checkedAt
  });
  if (!result.ok && !evaluated.reason) evaluated.reason = result.blocked ? "transmission_blocked"
    : outcome === "needs_review" ? "provider_uncertain" : `provider_http_${Number(result.status) || 0}`;
  if (!evaluated.request_id && isUuid(result.requestId)) evaluated.request_id = result.requestId;
  const summary = sanitizeStoredSummary(evaluated);
  const leadSort = classifyOffersIqReceipt(evaluated);

  const published = await withTransaction(db, async writer => {
    const currentClient = (await writer.query(
      `SELECT first_name, last_name, phone, custom_fields FROM clients
       WHERE id = $1 AND org_id = $2 FOR UPDATE`, [clientId, staff.org_id]
    )).rows[0];
    const currentIdentity = identityFromClient(currentClient);
    const stillCurrent = currentIdentity && identityFingerprint(
      currentIdentity, config.ruleSetId, config.environment
    ) === claim.fingerprint;
    const saved = (await writer.query(
      `UPDATE offersiq_requests SET status = $4, provider_request_id = $5,
         normalized_response = $6::jsonb, error_code = $7, finished_at = $8, updated_at = now(),
         lead_sort_bucket=$9, lead_sort_points=$10, lead_sort_version=$11,
         lead_sort_reasons=$12::jsonb, lead_sort_result=$13::jsonb,
         lead_sort_receipt=$14::jsonb, lead_sort_updated_at=now()
       WHERE id = $1 AND org_id = $2 AND client_id = $3 AND status = 'in_flight'
       RETURNING id`,
      [claim.claimed.id, staff.org_id, clientId, summary.outcome, summary.request_id,
        JSON.stringify(summary), summary.reason || null, checkedAt,
        leadSort.bucket, leadSort.points, leadSort.version, JSON.stringify(leadSort.reasons),
        JSON.stringify(leadSort), JSON.stringify(evaluated)]
    )).rows[0];
    if (!saved) throw new Error("offersiq_claim_finalization_failed");
    if (stillCurrent) {
      await publishSummary(writer, staff.org_id, clientId, summary);
    }
    return !!stillCurrent;
  });
  const visible = published ? summary : staleSummary(summary);
  return answer(200, visible.outcome, { result: visible, replayed: false });
}
