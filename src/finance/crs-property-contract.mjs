// PitchPoint's supplied property collection uses one person, SSN and US DOB.
// Raw provider Input/aliases are deliberately never retained in the report.
import { createHash } from "node:crypto";
import { normalizeDateOfBirth } from "../identity/verified.mjs";

export const PROPERTY_CONSENT_VERSION = "property-report-2026-11-06";
export const PROPERTY_CONSENT_TEXT = "I authorize Fundhub LLC to use my saved name, date of birth and Social Security number to obtain my property ownership and foreclosure report from CRS/PitchPoint for my requested service.";
const object = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const text = v => typeof v === "string" ? v.trim() : "";
const list = v => Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
const nameKey = v => text(v).normalize("NFKC").replace(/\s+/g, " ").toUpperCase();
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const amount = v => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const bounded = v => text(v).slice(0, 300) || null;
const reference = v => (typeof v === "string" || Number.isSafeInteger(v)) ? String(v).slice(0, 100) : null;

export class PropertyReportError extends Error {
  constructor(code, status = 400) { super(code); this.name = "PropertyReportError"; this.code = code; this.status = status; }
}
export function propertyRequestId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}

export function buildPropertyRequest(identity) {
  const source = object(identity);
  const firstName = text(source.firstName);
  const lastName = text(source.lastName);
  const ssn = text(source.ssn).replace(/[- ]/g, "");
  const dob = normalizeDateOfBirth(source.birthDate ?? source.dob);
  if (!firstName || firstName.length > 100 || !lastName || lastName.length > 100
      || !/^\d{9}$/.test(ssn) || !dob) throw new PropertyReportError("identity_required", 422);
  const [year, month, day] = dob.split("-");
  return { terms: { term: [{ person: { firstName, lastName, ssn, dob: `${month}/${day}/${year}` } }] } };
}

export function propertyRequestFingerprint(body) {
  const terms = object(body).terms;
  const person = terms?.term?.[0]?.person;
  const expected = buildPropertyRequest(person);
  if (JSON.stringify(body) !== JSON.stringify(expected)) throw new PropertyReportError("invalid_property_request");
  return createHash("sha256").update(JSON.stringify({
    firstName: nameKey(person.firstName), lastName: nameKey(person.lastName),
    ssn: person.ssn, dob: person.dob
  })).digest("hex");
}

function dateParts(value) {
  const v = object(value);
  if (![v.year, v.month, v.day].every(Number.isInteger)) return null;
  return normalizeDateOfBirth(`${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day).padStart(2, "0")}`);
}
function names(value) {
  return list(object(value).Name).map(v => bounded(v?.UnparsedName)).filter(Boolean).slice(0, 30);
}
function transaction(value) {
  const v = object(value);
  return {
    documentType: bounded(v.DocTypeDescription), description: bounded(v.DocumentDescription),
    recordedAt: dateParts(v.RecordingDate), originalRecordedAt: dateParts(v.OriginalRecordingDate),
    documentNumber: reference(v.DocumentNumber), salePrice: amount(v.SalePrice),
    originalLoanAmount: amount(v.LoanAmount), lender: bounded(v.Lender),
    borrowers: names(v.BuyerBorrower), sellers: names(v.Sellers),
    status: bounded(v.StatusSummaries?.StatusSummary)
  };
}

// Require an actual receipt and returned identity match. A valid root alone
// does not prove whose report it is. Zero remains distinct from missing data.
export function parsePropertyResponse({ body, requestId, identity } = {}) {
  if (!propertyRequestId(requestId)) {
    throw new PropertyReportError("provider_request_id_missing", 502);
  }
  const report = object(object(body).ForeclosureInvestigationReport);
  for (const key of ["codes", "messages", "details", "error", "errors", "code", "message"]) {
    if (Object.hasOwn(object(body), key) && (!Array.isArray(body[key]) || body[key].length)) {
      throw new PropertyReportError("invalid_provider_response", 502);
    }
  }
  const expected = buildPropertyRequest(identity).terms.term[0].person;
  const input = object(report.Input);
  const returnedSsn = typeof input.SSN === "number" && Number.isSafeInteger(input.SSN)
    ? String(input.SSN).padStart(9, "0") : text(input.SSN).replace(/[- ]/g, "");
  if (nameKey(input.Name?.FirstName) !== nameKey(expected.firstName)
      || nameKey(input.Name?.LastName) !== nameKey(expected.lastName) || returnedSsn !== expected.ssn) {
    throw new PropertyReportError("provider_identity_mismatch", 502);
  }
  const results = object(report.Results);
  const summary = object(results.Summary);
  const summaryFields = ["BorrowerRelatedAddressCount", "BorrowerOwnedPropertiesIdentified", "BorrowerRelatedForeclosureActivityEvents"];
  if (summaryFields.some(k => count(summary[k]) === null)) throw new PropertyReportError("invalid_provider_response", 502);
  const rawAddresses = results.AssociatedAddresses?.AssociatedAddress;
  if (rawAddresses !== undefined && !Array.isArray(rawAddresses)
      && (!rawAddresses || typeof rawAddresses !== "object")) throw new PropertyReportError("invalid_provider_response", 502);
  const addresses = list(rawAddresses);
  if (addresses.length > 200 || (!addresses.length && summaryFields.some(k => summary[k] > 0))) {
    throw new PropertyReportError("invalid_provider_response", 502);
  }
  const properties = addresses.map(row => {
    const v = object(row), a = object(v.Address);
    if (typeof v.BorrowerOwnedAsset !== "boolean") throw new PropertyReportError("invalid_provider_response", 502);
    const transactions = list(v.TransactionHistory?.Transaction);
    return {
      borrowerOwnedAsset: v.BorrowerOwnedAsset, providerCurrentOwners: names(v.CurrentOwners),
      address: { line1: bounded(a.AddressLine1), city: bounded(a.City), state: bounded(a.State),
        zip: reference(a.PostalCode)?.padStart(5, "0") || null, county: bounded(a.County), parcel: reference(a.APN) },
      firstSeen: dateParts(v.FirstSeen), lastSeen: dateParts(v.LastSeen),
      ownershipStatus: bounded(v.OwnershipStatus?.OwnershipStatusSummaries?.StatusSummary),
      recordedRecentSalePrice: amount(v.RecentSalesPrice),
      transactionCount: transactions.length, transactionsTruncated: transactions.length > 100,
      transactions: transactions.slice(0, 100).map(transaction)
    };
  });
  return {
    product: "PitchPoint Property Ownership (Foreclosure)", providerRequestId: propertyRequestId(requestId),
    summary: { relatedAddressCount: summary.BorrowerRelatedAddressCount,
      ownedPropertyCount: summary.BorrowerOwnedPropertiesIdentified,
      foreclosureEventCount: summary.BorrowerRelatedForeclosureActivityEvents },
    associatedAddressCount: properties.length, properties,
    currentMortgageBalance: null, currentEquity: null, currentValuation: null
  };
}
