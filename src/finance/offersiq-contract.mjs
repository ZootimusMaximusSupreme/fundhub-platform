// OffersIQ's no-SSN wire contract. Keep this separate from the full-report
// identity gate: that product requires SSN and has different sandbox fixtures.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONSUMER_KEYS = new Set([
  "fname", "lname", "mname", "suffix", "houseNumber", "streetName",
  "streetType", "city", "state", "zip", "phone"
]);
const CONSENT_KEYS = new Set([
  "accepted", "termsUrl", "ipAddress", "userAgent", "consentVersion", "consentTimestamp"
]);

// These names and addresses are from the vendor's published examples and guide.
// Only these exact synthetic consumers may reach the sandbox from this client.
export const OFFERSIQ_SANDBOX_IDENTITIES = Object.freeze([
  Object.freeze({ fname: "YXHVVO", lname: "IMAEIF", streetName: "SYMFO", city: "HUNTSVILLE", state: "AL", zip: "35692" }),
  Object.freeze({ fname: "PAMQLOH", mname: "G", lname: "ADJNXZ", houseNumber: "791", streetName: "GIGUZQTTQSA", streetType: "PNES", city: "BIRMINGHAM", state: "AL", zip: "35107" }),
  Object.freeze({ fname: "SLRRZJ", mname: "G", lname: "RXSXYEX", houseNumber: "2388", streetName: "MPGXKHWWXTG", streetType: "VL", city: "MOBILE", state: "AL", zip: "36677" }),
  // OffersIQ API Guide v1.1, section 9, profile 2 (AAJKITH/PDNSX).
  // This exact no-SSN/no-DOB variant is allowed; a provider match is not assumed.
  Object.freeze({ fname: "AAJKITH", mname: "Z", lname: "PDNSX", suffix: "6", houseNumber: "856", streetName: "BPOJVAB", streetType: "XRD", city: "HUNTSVILLE", state: "AL", zip: "35659" })
]);

export class OffersIqContractError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "OffersIqContractError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, message) {
  throw new OffersIqContractError(code, message);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function field(value, name, max, required = true) {
  if (value == null || value === "") {
    if (required) fail("identity_incomplete", `${name} is required`);
    return undefined;
  }
  if (typeof value !== "string") fail("identity_invalid", `${name} must be text`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\r\n<>]/.test(trimmed)) {
    fail("identity_invalid", `${name} is invalid or exceeds the OffersIQ field limit`);
  }
  return trimmed;
}

function normalizedPhone(value) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") fail("identity_invalid", "phone must be text");
  const digits = value.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^\d{10}$/.test(ten)) fail("identity_invalid", "phone must be a US 10-digit number");
  return ten;
}

function consumerFromIdentity(identity) {
  if (!plain(identity)) fail("identity_incomplete", "consumer identity is required");
  const address = plain(identity.address) ? identity.address : identity;
  const line2 = address.line2 ?? address.addressLine2;
  if (line2 != null && String(line2).trim()) {
    fail("address_needs_review", "unit address cannot be preserved in OffersIQ fields");
  }
  const line1 = address.line1 ?? address.addressLine1;
  let houseNumber = address.houseNumber;
  let streetName = address.streetName;
  if (line1 != null && houseNumber != null && streetName != null) {
    const original = field(line1, "street address", 120);
    const assembled = `${String(houseNumber).trim()} ${String(streetName).trim()}`.trim();
    if (original !== assembled) {
      fail("address_needs_review", "street address conflicts with structured OffersIQ fields");
    }
  }
  if (line1 != null && (houseNumber == null || streetName == null)) {
    const whole = field(line1, "street address", 120);
    if (/(?:^|\s)(?:APT|APARTMENT|UNIT|STE|SUITE|#)\s*\w/i.test(whole)) {
      fail("address_needs_review", "unit address needs a confirmed OffersIQ mapping");
    }
    const parts = /^([0-9][0-9A-Za-z-]{0,9})\s+(.+)$/.exec(whole);
    if (parts) {
      houseNumber = parts[1];
      streetName = parts[2];
    } else {
      streetName = whole;
    }
  }
  const consumer = {
    fname: field(identity.fname ?? identity.firstName ?? identity.first_name, "first name", 15),
    lname: field(identity.lname ?? identity.lastName ?? identity.last_name, "last name", 25),
    streetName: field(streetName, "street name", 26),
    city: field(address.city, "city", 20),
    state: field(address.state, "state", 2).toUpperCase(),
    zip: field(address.zip ?? address.postalCode ?? address.postal_code, "ZIP", 10)
  };
  const optional = {
    mname: field(identity.mname ?? identity.middleName, "middle name", 15, false),
    suffix: field(identity.suffix, "suffix", 2, false),
    houseNumber: field(houseNumber, "house number", 10, false),
    streetType: field(address.streetType, "street type", 4, false),
    phone: normalizedPhone(identity.phone)
  };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) consumer[key] = value;
  if (!/^[A-Z]{2}$/.test(consumer.state) || !/^\d{5}(?:-\d{4})?$/.test(consumer.zip)) {
    fail("identity_invalid", "state or ZIP is invalid");
  }
  return consumer;
}

function consentFromInput(consent) {
  if (!plain(consent) || consent.accepted !== true) {
    fail("consent_required", "explicit accepted credit consent is required");
  }
  let url;
  try { url = new URL(consent.termsUrl); } catch { fail("consent_invalid", "consent termsUrl must be an HTTPS URL"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    fail("consent_invalid", "consent termsUrl must be an HTTPS URL");
  }
  const result = { accepted: true, termsUrl: url.toString() };
  for (const key of ["ipAddress", "userAgent", "consentVersion", "consentTimestamp"]) {
    if (consent[key] == null || consent[key] === "") continue;
    if (typeof consent[key] !== "string" || consent[key].length > 1024) {
      fail("consent_invalid", `${key} is invalid`);
    }
    result[key] = consent[key];
  }
  if (result.consentTimestamp && !Number.isFinite(Date.parse(result.consentTimestamp))) {
    fail("consent_invalid", "consentTimestamp must be an ISO-8601 timestamp");
  }
  return result;
}

export function buildOffersIqRequest({ ruleSetId, identity, consent } = {}) {
  if (!Number.isSafeInteger(ruleSetId) || ruleSetId < 1) {
    fail("ruleset_invalid", "ruleSetId must be a positive integer");
  }
  const body = {
    ruleSetId,
    consumerData: consumerFromIdentity(identity),
    userConsent: consentFromInput(consent)
  };
  assertOffersIqWireBody(body);
  return body;
}

export function isOffersIqSandboxIdentity(consumer) {
  return OFFERSIQ_SANDBOX_IDENTITIES.some(fixture =>
    Object.entries(fixture).every(([key, value]) => consumer?.[key] === value)
    && Object.keys(consumer || {}).every(key => Object.hasOwn(fixture, key))
  );
}

// Production must refuse the published synthetic person even when optional
// fields are added to the request. Sandbox still requires the exact fixture.
export function isOffersIqProductionFixtureIdentity(consumer) {
  if (!plain(consumer)) return false;
  const normalized = value => String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  const street = value => normalized([value.houseNumber, value.streetName, value.streetType].filter(Boolean).join(" "));
  const core = ["fname", "lname", "city", "state", "zip"];
  return OFFERSIQ_SANDBOX_IDENTITIES.some(fixture =>
    core.every(key => normalized(consumer[key]) === normalized(fixture[key]))
    && street(consumer) === street(fixture)
  );
}

// Last-point guard for direct transport callers as well as the CRS client.
export function assertOffersIqWireBody(body, { sandbox = false } = {}) {
  if (!plain(body) || !Number.isSafeInteger(body.ruleSetId) || body.ruleSetId < 1 ||
      !plain(body.consumerData) || !plain(body.userConsent)) {
    fail("request_invalid", "OffersIQ request must have ruleSetId, consumerData and userConsent");
  }
  if (Object.keys(body).some(key => !["ruleSetId", "consumerData", "userConsent"].includes(key)) ||
      Object.keys(body.consumerData).some(key => !CONSUMER_KEYS.has(key)) ||
      Object.keys(body.userConsent).some(key => !CONSENT_KEYS.has(key))) {
    fail("request_invalid", "OffersIQ request contains unsupported fields");
  }
  // Rebuild by named fields. This rechecks limits and consent without permitting
  // ssn/dob or any arbitrary credit attribute through a direct transport call.
  const rebuilt = buildWireFields(body);
  if (sandbox && !isOffersIqSandboxIdentity(rebuilt.consumerData)) {
    fail("identity_not_allowed_on_sandbox", "only published OffersIQ test consumers are allowed on sandbox");
  }
  return rebuilt;
}

function buildWireFields(body) {
  const c = body.consumerData;
  const consumerData = {
    fname: field(c.fname, "first name", 15),
    lname: field(c.lname, "last name", 25),
    streetName: field(c.streetName, "street name", 26),
    city: field(c.city, "city", 20),
    state: field(c.state, "state", 2),
    zip: field(c.zip, "ZIP", 10)
  };
  if (!/^[A-Z]{2}$/.test(consumerData.state) || !/^\d{5}(?:-\d{4})?$/.test(consumerData.zip)) {
    fail("identity_invalid", "state or ZIP is invalid");
  }
  for (const key of ["mname", "suffix", "houseNumber", "streetType"]) {
    const max = { mname: 15, suffix: 2, houseNumber: 10, streetType: 4 }[key];
    const value = field(c[key], key, max, false);
    if (value !== undefined) consumerData[key] = value;
  }
  const phone = normalizedPhone(c.phone);
  if (phone !== undefined) consumerData.phone = phone;
  return { ruleSetId: body.ruleSetId, consumerData, userConsent: consentFromInput(body.userConsent) };
}

export function parseOffersIqResponse({ body, requestId, expectedRuleSetId } = {}) {
  const id = typeof requestId === "string" && UUID.test(requestId) ? requestId : null;
  const result = {
    outcome: "error", decisionStatus: null, requestId: id,
    ruleSetId: null, overallDecision: null, processedAt: null,
    message: null, ruleEvaluation: null, offersIQSummary: null, reason: null
  };
  if (!plain(body)) return { ...result, reason: "invalid_response" };
  const ruleSetId = Number(body.ruleSetId);
  const expected = Number(expectedRuleSetId);
  if (!Number.isSafeInteger(ruleSetId) || ruleSetId < 1 ||
      (Number.isSafeInteger(expected) && expected > 0 && ruleSetId !== expected)) {
    return { ...result, reason: "ruleset_mismatch" };
  }
  const decisionStatus = typeof body.decisionStatus === "string" ? body.decisionStatus : null;
  const overallDecision = typeof body.overallDecision === "boolean" ? body.overallDecision : null;
  let outcome;
  if (decisionStatus === "INSUFFICIENT_DATA") outcome = "needs_review";
  else if (decisionStatus === "ERROR") outcome = "error";
  else if (decisionStatus === "APPROVED" && overallDecision !== false) outcome = "matched";
  else if (decisionStatus === "DECLINED" && overallDecision !== true) outcome = "not_matched";
  else if (!decisionStatus && overallDecision === true) outcome = "matched";
  else if (!decisionStatus && overallDecision === false) outcome = "not_matched";
  else outcome = "needs_review";
  if (!id && outcome !== "error") outcome = "needs_review";
  return {
    ...result, outcome, decisionStatus, ruleSetId, overallDecision,
    processedAt: typeof body.processedAt === "string" ? body.processedAt : null,
    message: typeof body.message === "string" ? body.message : null,
    ruleEvaluation: plain(body.ruleEvaluation) ? body.ruleEvaluation : null,
    offersIQSummary: plain(body.offersIQSummary) ? body.offersIQSummary : null,
    reason: !id ? "request_id_missing" : outcome === "needs_review" ? (decisionStatus || "decision_missing_or_conflicting") :
      outcome === "error" ? "provider_error" : null
  };
}
