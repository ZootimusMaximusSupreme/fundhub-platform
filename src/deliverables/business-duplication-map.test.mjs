// The Business Duplication Map (2026-10-02): what the page must be true of.
//
// Three files, run through the REAL tier engine, never a hand-typed number:
//   clean      — the simulator's clean file, no company saved
//   business   — the same clean file, two saved companies, each with an
//                Experian Business report scored by the engine: one with high
//                balances, one with a judgment, late payments, a UCC filing, a
//                flagged name and a flagged NAICS code
//   repair     — the simulator's damaged file (REPAIR_ONLY) with one company
// Every dollar the page prints is checked against what the engine returned for
// that same file. The plan and the age lines are checked against a fixed clock.
//
// THE EXPERIAN BUSINESS REPORTS BELOW ARE TEST DATA. No real Experian Business
// report is in this repository (searched src/, scripts/, db/, docs/, vendor/,
// 2026-10-02). experianBusinessReport() carries exactly the fields the vendor
// reader takes (vendor/underwriteiq-full/api/lite/crs/derive-business-signals.js),
// in the shape the credit pull stores (src/finance/crs-pull.mjs businessReports).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildPayload } from "../../scripts/sim/push-credit.mjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { buildBlackReportClient, emptyBlackReportClient } from "../underwrite/black-report-client.mjs";
import { scoreCompanyReports } from "../underwrite/letter-pack.mjs";
import { businessAgeMultiplier } from "../underwrite/business-funding.mjs";
import { FUNDING_SEQUENCE_STEPS } from "../underwrite/funding-sequence.mjs";
import { SHELL_LLC_SUGGESTION_TEXT } from "../underwrite/company-audit.mjs";
import { CLOSING_CTA_URL } from "./chrome.mjs";
import { usd } from "./format.mjs";
import {
  BUSINESS_DUPLICATION_MAP_DOC,
  AGE_BANDS,
  PLAN_QUARTERS,
  duplicationMapFacts,
  buildBusinessDuplicationMap,
  renderBusinessDuplicationMapHtml,
  companyFacts,
  quarterlyPlan,
  parseStartMonth,
  nameKey,
  blemishesOf,
  zeroReasons
} from "./business-duplication-map.mjs";

/* A test identity, so the simulator never reads the owner's gitignored file. */
const IDENTITY = Object.freeze({
  first: "Test", middle: null, last: "Sample", dob: "1980-01-01",
  current: { line1: "100 Test Ave", city: "Denton", state: "TX", postal_code: "76205" },
  priors: [], employer: null
});
const PERSONAL = Object.freeze({ name: "Test Sample", address: "100 Test Ave\nDenton, TX 76205", state: "TX" });
const NOW = new Date("2026-10-02T12:00:00Z");

/** A pull dated today, so the engine's 30-day freshness gate never turns this into a dated test. */
function storedPull(profile) {
  return buildPayload(profile, { email: null, name: PERSONAL.name, pulledAt: new Date().toISOString(), identity: IDENTITY });
}

function runEngine(stored) {
  return runTierEngineFromCrsResult(stored, { submittedName: PERSONAL.name, submittedAddress: PERSONAL.address });
}

function experianBusinessReport({
  name, incorporated, score = null, dbt = 0, balance = null, highCredit = null,
  judgment = false, taxLien = false, bankruptcy = false, ucc = 0, nameVerified = true
}) {
  return {
    data: {
      businessHeader: { businessName: name },
      corporateRegistration: { incorporatedDate: incorporated, statusFlag: { code: "A" } },
      businessFacts: { businessType: "LLC", stateOfIncorporation: "AZ" },
      scoreInformation: {
        commercialScore: { score, riskClass: { definition: "TEST" } },
        fsrScore: { score: null }
      },
      expandedCreditSummary: {
        currentDbt: dbt,
        monthlyAverageDbt: dbt,
        bankruptcyIndicator: bankruptcy,
        judgmentIndicator: judgment,
        taxLienIndicator: taxLien,
        currentTotalAccountBalance: { amount: balance },
        highestCreditAmount: { amount: highCredit }
      },
      commercialFraudShieldSummary: {
        ofacMatchWarning: { code: 1 },
        activeBusinessIndicator: true,
        businessRiskTriggersIndicator: false,
        nameAddressVerificationIndicator: nameVerified
      },
      uccFilingsDetail: Array.from({ length: ucc }, (_, i) => ({ filingNumber: `T${i}` }))
    }
  };
}

const RIVERA = Object.freeze({ name: "Rivera Supply LLC", state: "AZ", ageMonths: 14, incorporatedDate: "2025-08", naics: "541611" });
const RISKY = Object.freeze({ name: "Crypto Trucking LLC", state: "TX", ageMonths: 30, incorporatedDate: "2024-02", naics: "484110" });

function build(profile, { companies = [], reports = [] } = {}) {
  const stored = storedPull(profile);
  if (reports.length) stored.businessReports = reports;
  const engine = runEngine(stored);
  const client = buildBlackReportClient({ crsResult: engine, personal: PERSONAL });
  const scoredReports = scoreCompanyReports(stored, { submittedName: PERSONAL.name, submittedAddress: PERSONAL.address });
  const map = duplicationMapFacts({ engine, client, companies, scoredReports, now: NOW });
  const doc = renderBusinessDuplicationMapHtml({ client, map, fontsHref: "/assets/fonts" });
  return { stored, engine, client, scoredReports, map, doc, text: textOf(doc.html) };
}

/** What a reader sees: style out, tags out, entities read back, whitespace collapsed. */
function textOf(html) {
  return html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

const CLEAN = build("fundable");
const BUSINESS = build("fundable", {
  companies: [RIVERA, RISKY],
  reports: [
    { name: RIVERA.name, state: RIVERA.state, ageMonths: 14, bin: "T1",
      report: experianBusinessReport({ name: "RIVERA SUPPLY, LLC", incorporated: "2025-08-01", score: 76, balance: 3200, highCredit: 5000 }) },
    { name: RISKY.name, state: RISKY.state, ageMonths: 30, bin: "T2",
      report: experianBusinessReport({ name: "CT HOLDINGS LLC", incorporated: "2024-02-10", score: 35, dbt: 45,
        balance: 900, highCredit: 10000, judgment: true, ucc: 1 }) }
  ]
});
const REPAIR = build("repair-full", {
  companies: [RIVERA],
  reports: [{ name: RIVERA.name, state: RIVERA.state, ageMonths: 14, bin: "T1",
    report: experianBusinessReport({ name: "RIVERA SUPPLY LLC", incorporated: "2025-08-01", score: 76, balance: 100, highCredit: 5000 }) }]
});

describe("the page", () => {
  for (const [name, f] of Object.entries({ CLEAN, BUSINESS, REPAIR })) {
    test(`${name}: a complete hosted document in the deliverables frame`, () => {
      const { html } = f.doc;
      assert.equal(f.doc.key, "business_duplication_map");
      assert.equal(f.doc.filename, "business_duplication_map.html");
      assert.ok(html.startsWith("<!doctype html>"));
      assert.ok(html.includes("<title>Business Duplication Map</title>"));
      assert.ok(html.includes('<div class="cover">'), "the gold cover");
      assert.ok(html.includes('<div class="cta-page">'), "the closing panel");
      assert.ok(html.includes(`<a class="book-btn" href="${CLOSING_CTA_URL}">`), "the one closing CTA");
      assert.ok(html.includes("<span>business duplication map</span></footer>"), "the running footer");
      assert.ok(html.trimEnd().endsWith("</body></html>"));
    });

    test(`${name}: five numbered sections, in order`, () => {
      const eyebrows = [...f.doc.html.matchAll(/<div class="eyebrow">(\d\d) \/ ([^<]+)<\/div>/g)]
        .map((m) => `${m[1]} ${m[2]}`);
      assert.deepEqual(eyebrows, ["01 BOTH FILES", "02 YOUR BUSINESS TODAY", "03 BY AGE",
        "04 QUARTERLY REVIEWS", "05 SET UP"]);
    });

    test(`${name}: nothing unknown prints as a word for nothing`, () => {
      assert.doesNotMatch(f.text, /\bundefined\b|\bNaN\b|\bnull\b|\[object/);
    });

    test(`${name}: Experian Business only — no DUNS, no net-30, no vendor accounts`, () => {
      assert.doesNotMatch(f.text, /DUNS|D-U-N-S|net[- ]?30|vendor account|Dun & Bradstreet|Equifax Business/i);
    });

    test(`${name}: the brand is spelled Fundhub in every word this page adds`, () => {
      assert.doesNotMatch(f.text, /FundHub|FUNDHUB|Fund Hub/);
    });
  }

  test("the page gives preparation reviews without assumed filings or funding approval", () => {
    const t = BUSINESS.text;
    assert.match(t, /Why you need this: prepare each business with clear records/);
    assert.match(t, /three or four separate single-member LLC plans/);
    assert.match(t, /Rivera Supply LLC reaches its recorded 24-month formation milestone in August 2027/);
    assert.doesNotMatch(t, /one to two a quarter|five to ten companies|That is when its funding doubles/);
  });
});

describe("01 — the personal side comes off the engine", () => {
  for (const [name, f] of Object.entries({ CLEAN, BUSINESS, REPAIR })) {
    test(`${name}: decision, personal funding and card funding are the engine's own`, () => {
      const pre = f.engine.preapprovals;
      assert.equal(f.map.personal.decision, f.engine.decision_label);
      assert.equal(f.map.personal.personalFunding, pre.totalPersonal);
      assert.equal(f.map.personal.cardFunding, pre.personalCard.final);
      assert.match(f.text, new RegExp(`Personal decision ${f.engine.decision_label}`));
      assert.ok(f.text.includes(`Personal funding today ${usd(pre.totalPersonal)}`));
      assert.ok(f.text.includes(`Card funding (what company funding is based on) ${usd(pre.personalCard.final)}`));
    });
  }

  test("the funding order is the five steps of funding-sequence.mjs, companies marked as this map", () => {
    const steps = [...BUSINESS.doc.html.matchAll(/<ol class="fh-ol">([\s\S]*?)<\/ol>/g)][0][1];
    const items = [...steps.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]);
    assert.deepEqual(items, FUNDING_SEQUENCE_STEPS.map((s) => s.title + (s.id === "companies" ? " (this map)" : "")));
  });

  test("REPAIR: a file the engine holds says so and puts the personal file first", () => {
    assert.equal(REPAIR.map.personal.onHold, true);
    assert.match(REPAIR.text, new RegExp(`decision on your personal file is "${REPAIR.engine.decision_label}"`));
    assert.match(REPAIR.text, /shows \$0 for personal and business funding today\. Fix the personal file first for funding readiness\./);
    assert.match(REPAIR.text, /Business documents and preparation can move alongside your credit work/);
    assert.match(REPAIR.text, /so a company adds \$0 until the personal file is fixed/);
  });
});

describe("02 — the Experian Business check", () => {
  const rows = (f, company) => {
    const c = f.map.companies.find((x) => x.name === company);
    assert.ok(c, `${company} is on the map`);
    return Object.fromEntries(c.checks.map((r) => [r.label, r]));
  };

  test("CLEAN: no company on the file is said plainly, and business funding is not on the file", () => {
    assert.equal(CLEAN.map.companies.length, 0);
    assert.match(CLEAN.text, /No company is on your file yet, so there is no Experian Business check to run\./);
    assert.match(CLEAN.text, /Business funding today Not on the file/);
    assert.match(CLEAN.text, /Companies on your file 0/);
  });

  test("BUSINESS: the high-balance company — score OK, no blemishes, balances to pay down, NAICS OK", () => {
    const r = rows(BUSINESS, "Rivera Supply LLC");
    assert.equal(r["Business credit score"].status, "76 GOOD");
    assert.equal(r["Business credit score"].fix, "Keep it reporting.");
    assert.equal(r.Blemishes.status, "NONE");
    assert.equal(r["Business balances"].status, "64% USED");
    assert.match(r["Business balances"].fix, /^Pay it down under 10% before you apply\./);
    assert.equal(r["NAICS code"].status, "541611 OK");
    // "RIVERA SUPPLY, LLC" on Experian is the same name — case, comma and LLC do not count.
    assert.equal(r["Business name"].status, "OK");
  });

  test("BUSINESS: the risky company — every blemish named with its fix, flagged name and NAICS", () => {
    const r = rows(BUSINESS, "Crypto Trucking LLC");
    assert.equal(r["Business credit score"].status, "35 WEAK");
    assert.equal(r.Blemishes.status, "3 FOUND");
    assert.match(r.Blemishes.fix, /Judgment: Pay or settle the judgment and have the release filed/);
    assert.match(r.Blemishes.fix, /Late payments: Bills are paid 45 days past their due date on average\./);
    assert.match(r.Blemishes.fix, /1 UCC filing: A UCC filing is a lender's claim/);
    assert.match(BUSINESS.doc.html, /updates it\.<br>Late payments: Bills are paid 45 days/,
      "each blemish's fix sits on its own line in the table");
    assert.equal(r["Business balances"].status, "9% USED");
    assert.equal(r["NAICS code"].status, "484110 REVIEW");
    assert.match(r["NAICS code"].fix, /Keep it if it accurately describes the business/);
    assert.doesNotMatch(r["NAICS code"].fix, /Pick a code|Use the code.*low-risk list/);
    assert.equal(r["Business name"].status, "FLAGGED");
    assert.match(r["Business name"].fix, /registered legal name consistently/);
    assert.doesNotMatch(r["Business name"].fix, /Take crypto, trucking out/);
    assert.match(r["Business name"].fix, /Experian Business lists the company as "CT HOLDINGS LLC"\. Use one exact name everywhere\./);
  });

  test("BUSINESS: each company's business funding is the engine's own number for that report", () => {
    for (const scored of BUSINESS.scoredReports) {
      const c = BUSINESS.map.companies.find((x) => x.name === scored.name);
      assert.equal(c.report, "scored");
      assert.equal(c.funding.amount, scored.business.final);
      assert.ok(BUSINESS.text.includes(`UnderwriteIQ gives ${scored.name} ${usd(scored.business.final)} in business funding today.`));
    }
    const total = BUSINESS.scoredReports.reduce((s, r) => s + r.business.final, 0);
    assert.equal(BUSINESS.map.businessFundingTotal, total);
    assert.ok(BUSINESS.text.includes(`Business funding today ${usd(total)}`));
    assert.ok(BUSINESS.scoredReports.find((r) => r.name === "Rivera Supply LLC").business.final > 0,
      "the clean-but-high-balance company is funded");
  });

  test("BUSINESS: a $0 company says why, in the engine's own reasons", () => {
    const scored = BUSINESS.scoredReports.find((r) => r.name === "Crypto Trucking LLC");
    assert.equal(scored.business.final, 0);
    assert.deepEqual(scored.signals.hardBlock.reasons, ["BUSINESS_JUDGMENT", "BUSINESS_NEGATIVE_ITEMS", "BUSINESS_UCC_LIEN"]);
    assert.match(BUSINESS.text, /UnderwriteIQ gives Crypto Trucking LLC \$0 in business funding today\. Why: a judgment; late payments; a UCC filing\./);
  });

  test("REPAIR: a clean company on a held personal file gets $0 and is told it waits on the personal file", () => {
    const scored = REPAIR.scoredReports[0];
    assert.equal(scored.business.final, 0);
    assert.match(REPAIR.text, /UnderwriteIQ gives Rivera Supply LLC \$0 in business funding today\. Why: business funding waits until your personal file qualifies\./);
  });

  test("companies are listed oldest first", () => {
    assert.deepEqual(BUSINESS.map.companies.map((c) => c.name), ["Crypto Trucking LLC", "Rivera Supply LLC"]);
  });
});

describe("a fact not on the file is said to be not on the file", () => {
  const asOf = { year: 2026, month: 9 };

  test("a saved company with no Experian Business report", () => {
    const c = companyFacts({ name: "Plain Co LLC", state: "AZ", ageMonths: 3, naics: null }, null, asOf);
    assert.equal(c.report, "missing");
    const by = Object.fromEntries(c.checks.map((r) => [r.label, r]));
    for (const label of ["Business credit score", "Blemishes", "Business balances"]) {
      assert.equal(by[label].status, "NOT ON FILE");
      assert.equal(by[label].fix, "No Experian Business report for this company is on the file.");
    }
    assert.equal(by["NAICS code"].status, "NOT ON FILE");
    assert.match(by["NAICS code"].fix, /no industry code/);
    assert.match(by["NAICS code"].fix, /matches that activity/);
    assert.equal(c.funding.amount, null);
    const t = textOf(buildBusinessDuplicationMap(emptyBlackReportClient(),
      duplicationMapFacts({ companies: [{ name: "Plain Co LLC", state: "AZ", ageMonths: 3 }], now: NOW })));
    assert.match(t, /The last credit pull did not bring back an Experian Business report for Plain Co LLC, so UnderwriteIQ has not scored it\./);
  });

  test("a report the engine could not read is NOT READ, not NOT ON FILE", () => {
    const c = companyFacts({ name: "Broken LLC", state: "AZ", ageMonths: 5 },
      { name: "Broken LLC", state: "AZ", signals: null, business: null, error: "boom" }, asOf);
    assert.equal(c.report, "unreadable");
    assert.equal(c.checks[0].status, "NOT READ");
    assert.equal(c.checks[0].fix, "The Experian Business report on the file could not be read.");
  });

  test("an empty file renders with dashes and plain lines, never a made-up figure", () => {
    const t = textOf(buildBusinessDuplicationMap(emptyBlackReportClient(), duplicationMapFacts({ now: NOW })));
    assert.match(t, /Personal decision - /);
    assert.match(t, /Personal funding today - /);
    assert.match(t, /Business funding today Not on the file/);
    assert.match(t, /Your card funding is not on the file, so the dollar side of this table cannot be worked out yet\./);
    assert.doesNotMatch(t, /\$\d/,
      "no dollar figure on a file that has none");
  });

  test("a company with no age says so and gets no age milestone", () => {
    const c = companyFacts({ name: "No Date LLC", state: "AZ" }, null, asOf);
    assert.equal(c.ageMonths, null);
    assert.equal(c.turns12, null);
    assert.equal(c.turns24, null);
    const t = textOf(buildBusinessDuplicationMap(emptyBlackReportClient(),
      duplicationMapFacts({ companies: [{ name: "No Date LLC", state: "AZ" }], now: NOW })));
    assert.match(t, /No Date LLC AZ, age not on the file/);
    assert.doesNotMatch(t, /No Date LLC passes/);
  });
});

describe("03 — the age bands are the engine's multipliers", () => {
  test("each band reads businessAgeMultiplier, not a second copy of the numbers", () => {
    assert.deepEqual(AGE_BANDS.map((b) => b.multiplier),
      [businessAgeMultiplier(6), businessAgeMultiplier(18), businessAgeMultiplier(30)]);
    assert.deepEqual(AGE_BANDS.map((b) => b.words),
      ["half your card funding", "equal to your card funding", "double your card funding"]);
  });

  test("the card-funding anchor is the engine's", () => {
    assert.ok(CLEAN.text.includes(`UnderwriteIQ puts your card funding at ${usd(CLEAN.engine.preapprovals.personalCard.final)} today.`));
  });

  test("a company already past 24 months is told it is in the top band", () => {
    assert.match(BUSINESS.text, /Crypto Trucking LLC is past 24 months, so it is already in the top band\./);
  });
});

describe("04 — the quarterly plan", () => {
  const asOf = { year: 2026, month: 9 };

  test("no company: review points do not create companies or invent formation dates", () => {
    const plan = quarterlyPlan([], asOf);
    assert.equal(plan.length, PLAN_QUARTERS);
    assert.deepEqual(plan.map((r) => r.quarter),
      ["Q4 2026", "Q1 2027", "Q2 2027", "Q3 2027", "Q4 2027", "Q1 2028", "Q2 2028", "Q3 2028"]);
    assert.match(plan[0].step, /Review existing businesses and plan three or four separate/);
    assert.ok(plan.some((r) => /12-month preparation horizon/.test(r.step)));
    assert.doesNotMatch(JSON.stringify(plan), /Open company|low-risk list|Its funding/);
  });

  test("saved formation milestones trigger review, not automatic funding", () => {
    const c = companyFacts({ name: "Young LLC", state: "AZ", incorporatedDate: "2026-03" }, null, asOf);
    assert.equal(c.ageMonths, 7);
    assert.deepEqual(c.turns12, { year: 2027, month: 2 });
    assert.deepEqual(c.turns24, { year: 2028, month: 2 });
    const plan = quarterlyPlan([c], asOf);
    assert.ok(plan.some((r) => r.quarter === "Q1 2027" && /recorded 12-month formation milestone/.test(r.step)));
    assert.ok(plan.some((r) => r.quarter === "Q1 2028" && /recorded 24-month formation milestone/.test(r.step)));
    assert.ok(plan.filter((r) => /formation milestone/.test(r.step)).every((r) => /age alone does not approve/.test(r.step)));
  });

  test("the rendered plan retains saved businesses without adding a numbered company", () => {
    assert.match(BUSINESS.text, /Q4 2026 Review existing businesses and plan three or four separate/);
    assert.match(BUSINESS.text, /Q3 2027 Rivera Supply LLC reaches its recorded 24-month formation milestone/);
    assert.match(BUSINESS.text, /Starting October 2026\./);
    assert.doesNotMatch(BUSINESS.text, /Open company three|Give it a NAICS code from the low-risk list/);
  });
});

describe("05 — set every company up the same way", () => {
  test("the owner-set company rules are printed as written, and none of the internal notes", () => {
    assert.ok(BUSINESS.text.includes(SHELL_LLC_SUGGESTION_TEXT));
    assert.match(BUSINESS.text, /You need a website\./);
    assert.match(BUSINESS.text, /Put the business on LinkedIn as a business profile\./);
    assert.doesNotMatch(BUSINESS.text, /Owner-set|Alec|canTellShellsApart/);
  });
});

describe("helpers", () => {
  test("parseStartMonth reads the month off the digits, never through a time zone", () => {
    assert.deepEqual(parseStartMonth("2025-08"), { year: 2025, month: 7 });
    assert.deepEqual(parseStartMonth("2025-08-01"), { year: 2025, month: 7 });
    assert.deepEqual(parseStartMonth("2025-08-01T00:00:00Z"), { year: 2025, month: 7 });
    assert.equal(parseStartMonth("August 2025"), null);
    assert.equal(parseStartMonth("2025-13"), null);
    assert.equal(parseStartMonth(null), null);
  });

  test("nameKey treats case, punctuation and the entity word as the same name", () => {
    assert.equal(nameKey("RIVERA SUPPLY, LLC"), nameKey("Rivera Supply LLC"));
    assert.equal(nameKey("Rivera Supply L.L.C."), nameKey("Rivera Supply"));
    assert.notEqual(nameKey("CT Holdings LLC"), nameKey("Crypto Trucking LLC"));
  });

  test("blemishesOf names only what the signals hold", () => {
    assert.deepEqual(blemishesOf({ publicRecords: {}, dbt: { current: 15 }, ucc: { count: 0 } }), []);
    assert.deepEqual(blemishesOf({ publicRecords: { taxLien: true }, dbt: {}, ucc: { count: 2 } }).map((b) => b[0]),
      ["Tax lien", "2 UCC filings"]);
  });

  test("zeroReasons reads the engine's codes and adds no reason of its own", () => {
    assert.deepEqual(zeroReasons({ hardBlock: { reasons: [] } }, { multiplier: 1, modifiers: { outcome: 1 } }), []);
    assert.deepEqual(zeroReasons({ hardBlock: { reasons: ["BUSINESS_INACTIVE"] } }, { multiplier: 0, modifiers: { outcome: 1 } }),
      ["Experian Business does not show the company as active",
        "Experian Business has no start date for the company, so it has no age yet"]);
  });

  test("a company name is escaped on the page", () => {
    const html = buildBusinessDuplicationMap(emptyBlackReportClient(),
      duplicationMapFacts({ companies: [{ name: "<script>x</script> LLC", state: "AZ", ageMonths: 2 }], now: NOW }));
    assert.doesNotMatch(html, /<script>x<\/script>/);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt; LLC/);
  });

  test("renderBusinessDuplicationMapHtml refuses no client, as renderDeliverableHtml does", () => {
    assert.throws(() => renderBusinessDuplicationMapHtml({ client: null }), /client is required/);
    assert.equal(BUSINESS_DUPLICATION_MAP_DOC.footerLabel, "business duplication map");
  });
});
