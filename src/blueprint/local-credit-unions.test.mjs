import test from "node:test";
import assert from "node:assert/strict";
import { rankLocalCreditUnions, greatCircleMiles, LOCAL_CREDIT_UNION_SOURCES } from "./local-credit-unions.mjs";

function fixture() {
  return {
    source: { name: "NCUA fixture", asOf: "2026-06-30", url: "https://ncua.gov/source" },
    coordinateSource: { name: "Census fixture", asOf: "2026-09-08", url: "https://census.gov/source" },
    postalCentroids: { "85001": [33.45, -112.07], "85002": [33.46, -112.07], "85003": [33.47, -112.07], "99999": [60, -150] },
    institutions: { "1": "Alpha CU", "2": "Beta CU", "3": "Gamma CU", "4": "Far CU", "5": "City CU" },
    branches: [
      ["1", "a", "1 First St", "PHOENIX", "AZ", "85001"],
      ["1", "a2", "2 Second St", "PHOENIX", "AZ", "85003"],
      ["2", "b", "3 Third St", "PHOENIX", "AZ", "85002"],
      ["3", "c", "4 Fourth St", "PHOENIX", "AZ", "85003"],
      ["4", "far", "5 Far St", "FAR", "AZ", "99999"],
      ["5", "city", "6 City St", "PHOENIX", "AZ", "85009"]
    ]
  };
}

test("rank by real source geography and keep one nearest branch per institution", () => {
  const out = rankLocalCreditUnions({ postalCode: "85001", homeState: "AZ" }, fixture());
  assert.equal(out.status, "candidates_for_review");
  assert.deepEqual(out.candidates.map(c => c.charterNumber), ["1", "2", "3"]);
  assert.equal(out.candidates[0].branch.siteId, "a");
  assert.equal(out.candidates[0].distanceLabel, "Same ZIP area");
  assert.equal(out.candidates[0].membershipStatus, "not_reviewed");
  assert.ok(!out.candidates.some(c => c.charterNumber === "4"));
});

test("a state-only input cannot be called a local shortlist", () => {
  const out = rankLocalCreditUnions({ homeState: "AZ" }, fixture());
  assert.equal(out.status, "location_required");
  assert.deepEqual(out.candidates, []);
});

test("full state names are normalized for a source-supported city match", () => {
  const out = rankLocalCreditUnions({ city: "Phoenix", homeState: "Arizona" }, fixture());
  assert.equal(out.location.state, "AZ");
  assert.ok(out.candidates.length > 0);
  assert.ok(out.candidates.every(c => c.branch.state === "AZ"));
});

test("ZIP+4 normalizes; missing coordinates permit exact ZIP/city without fake miles", () => {
  const f = fixture();
  delete f.postalCentroids["85001"];
  const out = rankLocalCreditUnions({ postalCode: "85001-1234", city: "Phoenix", homeState: "AZ" }, f);
  assert.equal(out.candidates[0].locationMatch, "same_zip_area");
  assert.equal(out.candidates[0].distanceMiles, null);
  assert.ok(out.candidates.some(c => c.locationMatch === "same_city"));
  assert.ok(!out.candidates.some(c => c.charterNumber === "4"));
});

test("current sourced eligibility can exclude an ineligible institution and show cash fit", () => {
  const reviewedFits = {
    "1": { membershipEligible: false, sourceUrl: "https://alpha.example/membership", reviewedAt: "2026-10-30" },
    "2": { membershipEligible: true, businessAccountAvailable: true, minimumDepositCents: 50000, sourceUrl: "https://beta.example/accounts", reviewedAt: "2026-10-30" }
  };
  const out = rankLocalCreditUnions({ postalCode: "85001", asOf: "2026-11-02", availableCashCents: 10000, reviewedFits }, fixture());
  assert.ok(!out.candidates.some(c => c.charterNumber === "1"));
  const beta = out.candidates.find(c => c.charterNumber === "2");
  assert.equal(beta.membershipStatus, "reviewed_eligible");
  assert.equal(beta.cashFit, "above_stated_cash");
});

test("stale, future, unsourced or unknown product/cash facts remain unreviewed", () => {
  for (const input of [
    { membershipEligible: true },
    { membershipEligible: true, sourceUrl: "https://alpha.example/", reviewedAt: "2026-01-01" },
    { membershipEligible: true, sourceUrl: "https://alpha.example/", reviewedAt: "2027-01-01" }
  ]) {
    const out = rankLocalCreditUnions({ postalCode: "85001", asOf: "2026-11-02", reviewedFits: { "1": input } }, fixture());
    assert.equal(out.candidates.find(c => c.charterNumber === "1").membershipStatus, "not_reviewed");
  }
});

test("a shortlist never pads beyond actual matches or five distinct institutions", () => {
  const f = fixture();
  for (let i = 10; i < 20; i++) { f.institutions[String(i)] = `CU ${i}`; f.branches.push([String(i), String(i), "Address", "PHOENIX", "AZ", "85001"]); }
  const out = rankLocalCreditUnions({ postalCode: "85001", limit: 20 }, f);
  assert.equal(out.candidates.length, 5);
  assert.equal(new Set(out.candidates.map(c => c.charterNumber)).size, 5);
});

test("geographic math rejects invalid points and handles equal centers", () => {
  assert.equal(greatCircleMiles([33.4, -112], [33.4, -112]), 0);
  assert.equal(greatCircleMiles([91, 0], [0, 0]), null);
  assert.equal(greatCircleMiles([NaN, 0], [0, 0]), null);
  assert.ok(greatCircleMiles([33.45, -112.07], [33.46, -112.07]) > 0);
});

test("bundled official nationwide source returns actual Phoenix branches without a provider call", () => {
  const out = rankLocalCreditUnions({ postalCode: "85004", homeState: "AZ" });
  assert.equal(out.candidates.length, 5);
  assert.equal(LOCAL_CREDIT_UNION_SOURCES.branches.asOf, "2026-06-30");
  assert.equal(LOCAL_CREDIT_UNION_SOURCES.coordinates.asOf, "2026-09-08");
  for (const c of out.candidates) {
    assert.ok(c.name && c.branch.address && c.branch.postalCode);
    assert.ok(c.distanceMiles <= 50);
    assert.equal(c.membershipStatus, "not_reviewed");
    assert.equal(c.productStatus, "not_reviewed");
    assert.equal(c.cashFit, "not_reviewed");
  }
});

test("an unmapped PO-box ZIP does not get a guessed centroid or statewide matches", () => {
  const out = rankLocalCreditUnions({ postalCode: "85001", homeState: "AZ" });
  assert.equal(out.candidates.length, 0);
  assert.equal(out.source.locationMethod, "exact_zip_or_city_only");
});
