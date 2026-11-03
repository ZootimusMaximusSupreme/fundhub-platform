// The Business Duplication Map is IN the funding pack (2026-10-02).
//
// The $297 Funding Roadmap's pack is built by buildLetterPackForClient(pack:
// "funding") — the same call the SLO delivery (src/slo/deliver.mjs), the C-06
// router, the closer deck and the Blueprint monthly pull make — and saved by
// persistFundingLetterFiles, whose rows are what the client portal lists
// (api/read/portal-summary.mjs, every `deliverable` document on file). So this
// file proves the two halves: the pack carries the map, and the saver stores it
// as its own deliverable row.
//
// The credit file is the simulator's clean file run through the REAL tier
// engine, dated today so the engine's 30-day freshness gate never dates this
// test. The database is a read-only stub of the queries the pack makes; the
// saver writes to the in-memory document store the other saver tests use.
//
// THE EXPERIAN BUSINESS REPORT IS TEST DATA, carrying exactly the fields the
// vendor reader takes (vendor/underwriteiq-full/api/lite/crs/derive-business-signals.js).
// No real Experian Business report is in this repository.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildLetterPack,
  buildLetterPackForClient,
  scoreCompanyReports,
  companiesFromRows,
  readBusinessOnFile
} from "./letter-pack.mjs";
import { persistFundingLetterFiles } from "./funding-letter-pdf.mjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { buildPayload } from "../../scripts/sim/push-credit.mjs";
import { memoryProvider, createStore } from "../documents/store.mjs";
import { makeFakeDb } from "../documents/fake-db.mjs";
import { usd } from "../deliverables/format.mjs";

// Never call live Claude from a unit test. Same guard as ./letter-pack.test.mjs.
delete process.env.ANTHROPIC_API_KEY;

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

const IDENTITY = Object.freeze({
  first: "Test", middle: null, last: "Sample", dob: "1980-01-01",
  current: { line1: "100 Test Ave", city: "Denton", state: "TX", postal_code: "76205" },
  priors: [], employer: null
});

const CLIENT_ROW = Object.freeze({
  org_id: ORG, first_name: "Test", last_name: "Sample", custom_fields: {}, outcome_tier: null
});
const HOME = [{ addressLine1: "100 Test Ave", city: "Denton", state: "TX", postalCode: "76205" }];

function experianBusinessReport({ name, incorporated, score, balance, highCredit }) {
  return {
    data: {
      businessHeader: { businessName: name },
      corporateRegistration: { incorporatedDate: incorporated, statusFlag: { code: "A" } },
      businessFacts: { businessType: "LLC", stateOfIncorporation: "AZ" },
      scoreInformation: { commercialScore: { score }, fsrScore: { score: null } },
      expandedCreditSummary: {
        currentDbt: 0, bankruptcyIndicator: false, judgmentIndicator: false, taxLienIndicator: false,
        currentTotalAccountBalance: { amount: balance }, highestCreditAmount: { amount: highCredit }
      },
      commercialFraudShieldSummary: { ofacMatchWarning: { code: 1 }, nameAddressVerificationIndicator: true },
      uccFilingsDetail: []
    }
  };
}

/** A stored pull dated today, with one Experian Business report on it when asked. */
function storedPull({ withReport = false } = {}) {
  const stored = buildPayload("fundable", {
    email: null, name: "Test Sample", pulledAt: new Date().toISOString(), identity: IDENTITY
  });
  if (withReport) {
    stored.businessReports = [{
      name: "Rivera Supply LLC", state: "AZ", ageMonths: 14, bin: "T1",
      report: experianBusinessReport({ name: "RIVERA SUPPLY LLC", incorporated: "2025-08-01", score: 76, balance: 3200, highCredit: 5000 })
    }];
  }
  return stored;
}

const RIVERA_ROW = Object.freeze({
  name: "Rivera Supply LLC",
  age_months: 14,
  entity_data: { source: "slo", state: "AZ", incorporated_date: "2025-08", naics: "541611" }
});

function fakePackDb({ crs, businesses = [] } = {}) {
  return {
    async query(sql) {
      const s = String(sql);
      if (/FROM clients/.test(s)) return { rows: [CLIENT_ROW] };
      if (/FROM pii_identity/.test(s)) return { rows: [{ addresses: HOME }] };
      if (/FROM crs_results/.test(s)) return { rows: crs ? [{ result: crs }] : [] };
      if (/FROM businesses/.test(s)) return { rows: businesses };
      return { rows: [] };
    }
  };
}

const htmlOf = (file) => (Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content)).toString("utf8");
const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the funding pack carries the Business Duplication Map", () => {
  const crs = storedPull({ withReport: true });
  let out;

  test("buildLetterPackForClient puts the map right after the four analysis pages", async () => {
    out = await buildLetterPackForClient(fakePackDb({ crs, businesses: [RIVERA_ROW] }),
      { clientId: CLIENT_ID, pack: "funding" });
    assert.equal(out.engineSkip, null, `engine must run clean, got ${out.engineSkip}`);
    assert.equal(out.duplicationMapSkip, null);
    assert.equal(out.deliverableCount, 5);
    const html = out.files.filter((f) => f.contentType === "text/html").map((f) => f.type);
    assert.deepEqual(html, ["credit_analysis", "funding_snapshot", "lender_match", "roadmap",
      "business_duplication_map"]);
    const map = out.files.find((f) => f.type === "business_duplication_map");
    assert.equal(map.filename, "business_duplication_map.html");
    assert.equal(map.engine, "html");
  });

  test("the map in the pack is this client's: their company, checked, and the engine's own number for it", () => {
    const t = textOf(htmlOf(out.files.find((f) => f.type === "business_duplication_map")));
    const [scored] = scoreCompanyReports(crs, { submittedName: "Test Sample", submittedAddress: "100 Test Ave\nDenton, TX 76205" });
    assert.ok(scored.business.final > 0, "the test company is funded by the engine");
    assert.ok(t.includes(`UnderwriteIQ gives Rivera Supply LLC ${usd(scored.business.final)} in business funding today.`), t.slice(0, 400));
    assert.match(t, /Business credit score 76 GOOD/);
    assert.match(t, /NAICS code 541611 OK/);
    assert.match(t, /Business balances 64% USED/);
    const engine = runTierEngineFromCrsResult(crs, { submittedName: "Test Sample", submittedAddress: "100 Test Ave\nDenton, TX 76205" });
    assert.ok(t.includes(`Personal funding today ${usd(engine.preapprovals.totalPersonal)}`));
    assert.ok(t.includes("prepared for test sample"), "the running footer names this client");
  });

  test("the saver stores it as its own deliverable row, titled Business Duplication Map", async () => {
    const db = makeFakeDb();
    const res = await persistFundingLetterFiles(db, createStore(memoryProvider()), {
      orgId: ORG, clientId: CLIENT_ID, files: out.files, generatedBy: "dup-map-test"
    });
    assert.deepEqual(res.unrecognised, [], `the saver did not recognise ${JSON.stringify(res.unrecognised)}`);
    assert.deepEqual(res.faults, []);
    const row = db._documents.find((d) => d.subtype === "business_duplication_map");
    assert.ok(row, "no business_duplication_map row was written");
    assert.equal(row.kind, "deliverable");
    assert.equal(row.title, "Business Duplication Map");
    assert.equal(row.mime_type, "text/html");
    assert.equal(db._documents.filter((d) => d.subtype === "business_duplication_map").length, 1);
    for (const sub of ["credit_analysis_report", "funding_snapshot", "bank_lender_match_list", "credit_optimization_roadmap"]) {
      assert.ok(db._documents.some((d) => d.subtype === sub), `${sub} is still stored next to the map`);
    }
  });

  test("a client with no company still gets the map, and it says so", async () => {
    const plain = await buildLetterPackForClient(fakePackDb({ crs: storedPull() }),
      { clientId: CLIENT_ID, pack: "funding" });
    assert.equal(plain.duplicationMapSkip, null);
    const t = textOf(htmlOf(plain.files.find((f) => f.type === "business_duplication_map")));
    assert.match(t, /No company is on your file yet, so there is no Experian Business check to run\./);
    assert.match(t, /Review your starting situation and separate business plans below\./);
    assert.match(t, /Plan three or four separate single-member LLCs/);
  });

  test("a saved company the pull brought no report for is checked as far as the file goes", async () => {
    const noReport = await buildLetterPackForClient(fakePackDb({ crs: storedPull(), businesses: [RIVERA_ROW] }),
      { clientId: CLIENT_ID, pack: "funding" });
    const t = textOf(htmlOf(noReport.files.find((f) => f.type === "business_duplication_map")));
    assert.match(t, /Business credit score NOT ON FILE No Experian Business report for this company is on the file\./);
    assert.match(t, /NAICS code 541611 OK/);
    assert.match(t, /did not bring back an Experian Business report for Rivera Supply LLC/);
  });
});

describe("the map never costs the four", () => {
  test("a map failure leaves the four analysis pages in the pack and says why", async () => {
    const crs = storedPull({ withReport: true });
    const engine = runTierEngineFromCrsResult(crs, { submittedName: "Test Sample", submittedAddress: "" });
    const out = await buildLetterPack({
      crsResult: engine,
      personal: { name: "Test Sample", address: "100 Test Ave\nDenton, TX 76205" },
      pack: "funding",
      storedCrs: crs,
      business: { hasEntity: true, ageMonths: 14, name: "Rivera Supply LLC", companies: companiesFromRows([RIVERA_ROW], [14]) },
      scoreCompanyReportsFn: () => { throw new Error("scoring exploded"); }
    });
    assert.equal(out.duplicationMapSkip, "scoring exploded");
    assert.deepEqual(out.files.filter((f) => f.contentType === "text/html").map((f) => f.type),
      ["credit_analysis", "funding_snapshot", "lender_match", "roadmap"]);
    assert.equal(out.reason, null, "the pack itself is still whole");
  });

  test("a repair pack carries no map", async () => {
    const crs = storedPull({ withReport: true });
    const engine = runTierEngineFromCrsResult(crs, { submittedName: "Test Sample", submittedAddress: "" });
    const out = await buildLetterPack({ crsResult: engine, personal: { name: "Test Sample", address: "" }, pack: "repair", storedCrs: crs });
    assert.equal(out.files.some((f) => f.type === "business_duplication_map"), false);
    assert.equal(out.duplicationMapSkip, "not_funding");
  });
});

describe("the company rows and the per-company engine scoring", () => {
  test("companiesFromRows reads state, start date and NAICS out of entity_data, string or object", () => {
    const rows = [
      RIVERA_ROW,
      { name: " Two LLC ", age_months: null, entity_data: JSON.stringify({ state: "tx", naics_code: 611000 }) },
      { name: "Three LLC", age_months: 5, entity_data: null }
    ];
    assert.deepEqual(companiesFromRows(rows, [14, 9, 5]), [
      { name: "Rivera Supply LLC", state: "AZ", ageMonths: 14, incorporatedDate: "2025-08", naics: "541611" },
      { name: "Two LLC", state: "TX", ageMonths: 9, incorporatedDate: null, naics: "611000" },
      { name: "Three LLC", state: "", ageMonths: 5, incorporatedDate: null, naics: null }
    ]);
  });

  test("readBusinessOnFile hands the pack every company, and keeps its old three fields", async () => {
    const out = await readBusinessOnFile(fakePackDb({ businesses: [RIVERA_ROW] }), { clientId: CLIENT_ID, customFields: {} });
    assert.equal(out.hasEntity, true);
    assert.equal(out.ageMonths, 14);
    assert.equal(out.name, "Rivera Supply LLC");
    assert.equal(out.companies.length, 1);
    assert.equal(out.companies[0].naics, "541611");
    const none = await readBusinessOnFile(fakePackDb({}), { clientId: CLIENT_ID });
    assert.deepEqual(none, { hasEntity: false, ageMonths: null, name: "", companies: [] });
  });

  test("scoreCompanyReports runs the engine once per stored report and keeps a failure as an error", () => {
    const crs = storedPull({ withReport: true });
    crs.businessReports.push({ name: "Bad LLC", state: "AZ", report: { data: {} } });
    let calls = 0;
    const scored = scoreCompanyReports(crs, {
      submittedName: "Test Sample",
      runEngine: (stored, opts) => {
        calls += 1;
        if (opts.businessReport === crs.businessReports[1].report) throw new Error("unreadable");
        return runTierEngineFromCrsResult(stored, opts);
      }
    });
    assert.equal(calls, 2);
    assert.equal(scored[0].name, "Rivera Supply LLC");
    assert.equal(scored[0].error, null);
    assert.equal(scored[0].signals.available, true);
    assert.equal(typeof scored[0].business.final, "number");
    assert.deepEqual({ name: scored[1].name, error: scored[1].error, signals: scored[1].signals },
      { name: "Bad LLC", error: "unreadable", signals: null });
    assert.deepEqual(scoreCompanyReports(storedPull()), [], "no stored report, nothing scored");
    assert.deepEqual(scoreCompanyReports(null), []);
  });
});
