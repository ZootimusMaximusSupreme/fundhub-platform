import test from "node:test";
import assert from "node:assert/strict";
import { buildPropertyRequest, parsePropertyResponse, propertyRequestFingerprint } from "./crs-property-contract.mjs";
const identity = { firstName: "Synthetic", lastName: "Property", ssn: "666123456", birthDate: "1990-01-02" };
const requestId = "11111111-1111-4111-8111-111111111111";
function body() { return { ForeclosureInvestigationReport: {
  Input: { Name: { FirstName: identity.firstName, LastName: identity.lastName }, SSN: Number(identity.ssn) },
  Results: { Summary: { BorrowerRelatedAddressCount: 1, BorrowerOwnedPropertiesIdentified: 1, BorrowerRelatedForeclosureActivityEvents: 0 },
    AssociatedAddresses: { AssociatedAddress: [{ BorrowerOwnedAsset: true, CurrentOwners: { Name: { UnparsedName: "Synthetic Property" } },
      Address: { AddressLine1: "100 Synthetic Test Way", City: "Test City", State: "AZ", PostalCode: 85001 },
      TransactionHistory: { Transaction: [{ LoanAmount: 100000, SalePrice: 0, Lender: "Synthetic Lender", SSN: identity.ssn }] } }] } }
} }; }
test("property wire is the exact documented one-person shape and US birthday", () => {
  assert.deepEqual(buildPropertyRequest({ ...identity, org_id: "never sent", property: "never sent" }),
    { terms: { term: [{ person: { firstName: "Synthetic", lastName: "Property", ssn: "666123456", dob: "01/02/1990" } }] } });
  for (const patch of [{ ssn: "" }, { ssn: "123" }, { birthDate: "1990-02-31" }, { firstName: "" }]) {
    assert.throws(() => buildPropertyRequest({ ...identity, ...patch }), /identity_required/);
  }
  const wire = buildPropertyRequest(identity);
  assert.match(propertyRequestFingerprint(wire), /^[0-9a-f]{64}$/);
  assert.throws(() => propertyRequestFingerprint({ ...wire, extra: true }), /invalid_property_request/);
});
test("property report retains zero/history, strips Input and never invents current equity", () => {
  const result = parsePropertyResponse({ body: body(), requestId, identity });
  assert.equal(result.summary.foreclosureEventCount, 0);
  assert.equal(result.properties[0].transactions[0].salePrice, 0);
  assert.equal(result.properties[0].transactions[0].originalLoanAmount, 100000);
  assert.equal(result.properties[0].transactions[0].recordedAt, null);
  assert.equal(result.currentMortgageBalance, null);
  assert.equal(result.currentEquity, null);
  assert.equal(result.currentValuation, null);
  assert.doesNotMatch(JSON.stringify(result), /666123456|1990-01-02|"SSN"|"Input"/);
});
test("property response requires correct name+SSN, receipt and complete numeric summary", () => {
  for (const patch of [v => { v.ForeclosureInvestigationReport.Input.SSN += 1; },
    v => { v.ForeclosureInvestigationReport.Input.Name.FirstName = "Other"; },
    v => { delete v.ForeclosureInvestigationReport.Results.Summary.BorrowerOwnedPropertiesIdentified; },
    v => { v.ForeclosureInvestigationReport.Results.Summary.BorrowerOwnedPropertiesIdentified = "1"; },
    v => { v.ForeclosureInvestigationReport.Results.AssociatedAddresses.AssociatedAddress[0].BorrowerOwnedAsset = "true"; },
    v => { v.codes = ["E004"]; }]) {
    const value = body(); patch(value);
    assert.throws(() => parsePropertyResponse({ body: value, requestId, identity }));
  }
  assert.throws(() => parsePropertyResponse({ body: body(), identity }), /provider_request_id_missing/);
});
test("all malformed and nonempty top-level provider errors override a report-looking body", () => {
  for (const key of ["codes", "messages", "details", "error", "errors", "code", "message"]) {
    for (const value of ["E004", "", {}, { code: "E004" }, true, null, ["E004"]]) {
      assert.throws(() => parsePropertyResponse({ body: { ...body(), [key]: value }, requestId, identity }), /invalid_provider_response/);
    }
  }
});
