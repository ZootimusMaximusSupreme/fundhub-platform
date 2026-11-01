// engine.visual — the numbers the closer's new slide visuals draw.
// Board: ops/workflows/weekend-2026-10-24.md sections 10.2 and 10.8.
//
// WHAT IS PINNED. Every dollar in engine.visual is the vendored CRS engine's own.
// These tests do not retype the engine's rules; they run the engine (and the
// repo's own sums) a second way and require the same answer, or they check a
// property the engine guarantees:
//
//   * the paydown lever equals the engine's own projectedPreapproval when the tier
//     is held, so the lever signals are the engine's;
//   * the clean lever is where the tier is re-checked, which the engine's own
//     projection does not do (10.2 item 2);
//   * todayTotal is the headline the deck already quotes, and newCompany never
//     enters it, a lever or optimizedTotal (the F15 rule);
//   * a pull older than 30 days is read as it was priced, not sent to review.
//
// FIXTURES are the repo's own: the FinanceOS sample file, the vendor sandbox
// bureau reports, and the simulator profiles (scripts/sim/push-credit.mjs), all run
// through the real mergeBureauReports so the stored shape is the live one.

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  buildDeckVisualData,
  emptyDeckVisual,
  projectEngineRun,
  DECK_VISUAL_LEVERS
} from "./deck-visual-data.mjs";
import { mergeBureauReports } from "../finance/crs-map.mjs";
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
import { scoreBuyerTotal } from "../finance/crs-pull.mjs";
import { buildSampleCreditFile, withEngineResult } from "../finance/sample-credit-file.mjs";
import { businessFundingDollars } from "../underwrite/business-funding.mjs";
import { scoreCompanyReports } from "../underwrite/letter-pack.mjs";
import { buildPayload } from "../../scripts/sim/push-credit.mjs";
import { buildBusinessScenario } from "../../scripts/sim/crs-scenarios.mjs";

const require = createRequire(import.meta.url);
const vendorEngine = require("../../vendor/underwriteiq-full/api/lite/crs/engine.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.resolve(HERE, "../../vendor/underwriteiq-full/api/lite/crs/sandbox");
const loadSandbox = (name) => JSON.parse(readFileSync(path.join(SANDBOX, name), "utf8"));

const CONTRACT_KEYS = [
  "source", "todayTotal", "levers", "optimizedTotal", "tierNow", "tierAfter",
  "cards", "items", "mismatches", "companies", "newCompany", "fundability"
];

const NAME = "Test Sample";
const IDENTITY = Object.freeze({
  first: "Test", middle: null, last: "Sample", dob: "1980-01-01",
  current: { line1: "100 Test Ave", city: "Denton", state: "TX", postal_code: "76205" },
  priors: [], employer: null
});
/* Months before any day this test runs on. The engine's identity gate calls a
   report older than 30 days stale; every fixture below that uses this date is
   stale to the wall clock and must still be read as it was priced. */
const OLD_PULL = "2026-03-02T18:00:00.000Z";

/* The engine run on the day the pull was priced: what finishStored() did. */
const pinned = (iso) => (args) => vendorEngine.runCRSEngine({ ...args, referenceDate: new Date(iso) });
const runOn = (iso) => (pull, opts) => runTierEngineFromCrsResult(pull, opts, { runEngine: pinned(iso) });

/** The estimate and tier the pull stored on its own day (crs-pull.mjs finishStored). */
function pricedOn(iso, pull, name = NAME) {
  const { tierResult, fundingEstimate } = scoreBuyerTotal(runOn(iso), pull, { submittedName: name });
  return { total: fundingEstimate, outcome: tierResult.outcome };
}

/** A real pull's stored shape: simulator bureau reports through mergeBureauReports. */
function livePull(profile, { pulledAt = OLD_PULL, business = null, bureaus = ["TU", "EX", "EQ"] } = {}) {
  const sim = buildPayload(profile, { email: null, name: NAME, pulledAt, identity: IDENTITY });
  const reports = Object.fromEntries(bureaus.map((code) => [code, sim.bureaus[code]]));
  const merged = mergeBureauReports({
    reports, requestIds: sim.requestIds, environment: "production", pulledAt
  });
  if (business) merged.businessReports = buildBusinessScenario(business, { asOf: pulledAt }).businessReports;
  return merged;
}

function sandboxPull() {
  return mergeBureauReports({
    reports: { TU: loadSandbox("tu.json"), EX: loadSandbox("exp.json"), EQ: loadSandbox("efx.json") },
    requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
    environment: "production"
  });
}
const SANDBOX_DAY = "2026-03-11T16:14:53.173621Z";
const SANDBOX_NAME = "Barbara Doty";

const VISA = Object.freeze({
  mask: "4242", balanceCents: 400000, limitCents: 1000000, aprPct: 24.99,
  minimumPaymentCents: 12000, highBalanceCents: 450000, lastActivityOn: "2026-02-20"
});

function samplePull(pulledAt = OLD_PULL) {
  const { payload } = buildSampleCreditFile({ pulledAt, person: { first: "Test", last: "Sample" }, visa: VISA });
  const out = withEngineResult(payload, { submittedName: NAME }, { runTierEngine: runOn(pulledAt) });
  return { result: out.payload, total: out.fundingEstimate, outcome: out.outcomeTier };
}

/** The deck's engine object as buildCloserDeck leaves it. A portal reader drops $0. */
const deckEngine = ({ total, outcome, sample = false, available = true }) =>
  ({ available, total: total > 0 ? total : null, outcome, sample });

const row = (result, outcome, createdAt = OLD_PULL) => ({ result, outcome_tier: outcome, created_at: createdAt });

function visualFor(pull, { day = OLD_PULL, name = NAME, businesses = [], sample = false } = {}) {
  const priced = pricedOn(day, pull, name);
  const engine = deckEngine({ total: priced.total, outcome: priced.outcome, sample });
  return {
    priced,
    engine,
    visual: buildDeckVisualData({ crs: row(pull, priced.outcome, day), engine, name, businesses })
  };
}

describe("the contract (board 10.8)", () => {
  test("the empty object has exactly the contract's keys, in order, and nothing is guessed", () => {
    const v = emptyDeckVisual();
    assert.deepEqual(Object.keys(v), CONTRACT_KEYS);
    assert.equal(v.source, "none");
    assert.equal(v.todayTotal, null);
    assert.deepEqual(v.levers.map((l) => l.key), ["paydown", "clean", "accounts"]);
    assert.deepEqual(v.levers.map((l) => l.label), ["Pay the cards down", "Clean the file", "Add accounts"]);
    assert.ok(v.levers.every((l) => l.applies === false && l.totalAfter === null));
    assert.equal(v.optimizedTotal, null);
    assert.equal(v.tierNow, null);
    assert.equal(v.tierAfter, null);
    assert.deepEqual([v.cards, v.items, v.mismatches, v.companies], [[], [], [], []]);
    assert.equal(v.newCompany, null);
    assert.equal(v.fundability, null);
    assert.equal(DECK_VISUAL_LEVERS.length, 3);
  });

  test("no pull, or an engine the deck could not read: source none, the stored headline passes through", () => {
    const biz = [{ name: "Cedar LLC", incorporated_date: "2022-09", age_months: 42 }];
    for (const input of [
      {},
      { crs: null, engine: { available: false, total: null } },
      { crs: row({ scores: { ex: 700 } }), engine: deckEngine({ total: 5000, outcome: "FULL_FUNDING" }) }
    ]) {
      const v = buildDeckVisualData({ ...input, businesses: biz });
      assert.deepEqual(Object.keys(v), CONTRACT_KEYS);
      assert.equal(v.source, "none");
      assert.equal(v.optimizedTotal, null);
      assert.ok(v.levers.every((l) => l.totalAfter === null && l.applies === false));
      assert.deepEqual(v.companies, [{ name: "Cedar LLC", incorporatedDate: "2022-09", ageMonths: 42, amount: null }]);
    }
    const stored = buildDeckVisualData({
      crs: row({ scores: { ex: 700 } }),
      engine: deckEngine({ total: 5000, outcome: "FULL_FUNDING" })
    });
    assert.equal(stored.todayTotal, 5000, "todayTotal is the deck's own headline even when there is nothing to project");
  });

  test("it never throws, even on a pull it cannot read", () => {
    const quiet = mock.method(console, "error", () => {});
    try {
      const engine = deckEngine({ total: 1000, outcome: "FULL_FUNDING" });
      for (const result of [
        { bureaus: {} },
        { bureaus: { TU: "not a report" }, bureausPulled: ["TU"] },
        { bureaus: { TU: { tradelines: "no", scores: 3 } }, bureausPulled: ["TU"] },
        "a string", [], 7
      ]) {
        const v = buildDeckVisualData({ crs: { result, created_at: OLD_PULL }, engine, name: NAME });
        assert.deepEqual(Object.keys(v), CONTRACT_KEYS);
        assert.ok(v.source === "none" || v.source === "engine");
        assert.equal(v.todayTotal, 1000, "the deck's own headline is never touched");
        assert.equal(v.optimizedTotal, null, "a file that cannot be read gets no amount");
        assert.equal(v.tierNow, null);
        assert.ok(v.levers.every((l) => l.totalAfter === null && l.applies === false));
      }
    } finally {
      quiet.mock.restore();
    }
  });
});

describe("the sample file (source 'sample')", () => {
  const sample = samplePull();
  const { visual, engine } = visualFor(sample.result, { sample: true });

  test("is labelled a sample and priced by the engine", () => {
    assert.equal(visual.source, "sample");
    assert.deepEqual(Object.keys(visual), CONTRACT_KEYS);
    assert.equal(visual.todayTotal, engine.total, "todayTotal is the deck's own headline");
    assert.equal(visual.todayTotal, sample.total, "and the number the engine priced on the pull day");
    assert.equal(visual.tierNow, "FUNDING_PLUS_REPAIR");
    assert.equal(visual.tierAfter, "FULL_FUNDING");
  });

  test("the levers stack in order, never fall, and end on optimizedTotal", () => {
    assert.deepEqual(visual.levers.map((l) => l.key), ["paydown", "clean", "accounts"]);
    const running = [visual.todayTotal, ...visual.levers.map((l) => l.totalAfter)];
    for (let i = 1; i < running.length; i += 1) assert.ok(running[i] >= running[i - 1], `step ${i} fell`);
    assert.equal(visual.levers[2].totalAfter, visual.optimizedTotal);
    assert.ok(visual.optimizedTotal > visual.todayTotal);
    assert.deepEqual(visual.levers.map((l) => l.applies), [true, true, false],
      "card use and the old late move the amount; the file is not thin, so accounts stays out");
  });

  test("the card, the item and the mismatch list are this file's own", () => {
    assert.deepEqual(visual.cards, [
      { creditor: "FIRST PLATYPUS BANK", limit: 10000, balance: 4000, target: 1000, usePct: 40 }
    ]);
    assert.deepEqual(visual.items, [
      { creditor: "TOYOTA MOTOR CREDIT", kind: "late", bureaus: ["EX", "TU", "EQ"] }
    ]);
    assert.deepEqual(visual.mismatches, []);
    assert.equal(visual.fundability, null);
  });
});

describe("a live-shaped pull (what crs-map.mjs saves)", () => {
  const pull = sandboxPull();
  const { priced, engine, visual } = visualFor(pull, { day: SANDBOX_DAY, name: SANDBOX_NAME });
  const engineRun = runOn(SANDBOX_DAY)(pull, { submittedName: SANDBOX_NAME });

  test("the stored pull carries none of what the visuals need, the engine run does", () => {
    assert.equal(pull.preapprovals, undefined);
    assert.equal(pull.projectedPreapproval, undefined);
    assert.equal(pull.reason_codes, undefined);
    assert.equal(visual.source, "engine");
    assert.equal(visual.todayTotal, priced.total);
    assert.equal(visual.todayTotal, engine.total);
    assert.equal(visual.tierNow, "FUNDING_PLUS_REPAIR");
  });

  test("paydown is the engine's own projection; clean is where the tier is re-checked", () => {
    const [paydown, clean, accounts] = visual.levers;
    assert.equal(paydown.totalAfter, engineRun.projectedPreapproval.totalCombined,
      "card use alone is exactly what engine.js projects");
    assert.ok(clean.totalAfter > engineRun.projectedPreapproval.totalCombined,
      "engine.js keeps today's 0.6 tier on the cleaned file; the re-check does not");
    assert.equal(clean.applies, true);
    assert.equal(accounts.applies, false);
    assert.equal(visual.tierAfter, "FULL_FUNDING");
    assert.equal(visual.optimizedTotal, clean.totalAfter);
  });

  test("cards, items and mismatches come from the pull", () => {
    assert.deepEqual(visual.cards.map((c) => [c.creditor, c.limit, c.balance, c.target, c.usePct]), [
      ["SYNCB/LEVITZ", 1894, 1762, 189, 93],
      ["CITIBANK SD NA", 624, 429, 62, 69]
    ]);
    const kinds = new Set(visual.items.map((i) => i.kind));
    for (const kind of ["charge_off", "late", "public_record"]) assert.ok(kinds.has(kind), `no ${kind} item`);
    assert.ok(visual.items.every((i) => i.creditor && i.bureaus.length > 0), "every item names a creditor and a bureau");
    assert.ok(!visual.items.some((i) => /unknown/i.test(i.creditor)), "an unnamed creditor is not printed as 'unknown'");
    assert.deepEqual(visual.mismatches.map((m) => m.field), ["name", "address"]);
    const name = visual.mismatches[0].values;
    assert.deepEqual(Object.keys(name), ["EX", "TU", "EQ"]);
    assert.equal(name.TU, "BARBARA M DOTY");
    assert.equal(name.EQ, null, "a bureau with no name on file is null, not a guess");
  });

  test("the engine's own tier-held projection is reproduced by the lever signals", () => {
    const held = projectEngineRun(engineRun, pull, 3, { recheckTier: false });
    assert.equal(held.preapprovals.totalCombined, engineRun.projectedPreapproval.totalCombined);
  });

  test("item copies match the engine's own negative counts, bureau by bureau", () => {
    const perBureau = { EX: 0, TU: 0, EQ: 0 };
    for (const item of visual.items.filter((i) => i.kind !== "public_record")) {
      for (const code of item.bureaus) perBureau[code] += 1;
    }
    const negs = engineRun.consumerSignals.bureauNegatives;
    // Two accounts at one creditor with one balance print as one item (the client
    // report merges them the same way), so a bureau can carry fewer rows than copies.
    for (const [code, name] of [["EX", "experian"], ["TU", "transunion"], ["EQ", "equifax"]]) {
      assert.ok(perBureau[code] <= negs[name].count, `${code} lists more items than the engine counts`);
      assert.equal(perBureau[code] > 0, negs[name].count > 0, `${code} clean/dirty disagrees with the engine`);
    }
  });
});

describe("a repair-only file", () => {
  const pull = livePull("repair-full");
  const { priced, engine, visual } = visualFor(pull);
  const engineRun = runOn(OLD_PULL)(pull, { submittedName: NAME });

  test("qualifies for $0 today, and the cleaned file routes up", () => {
    assert.equal(priced.outcome, "REPAIR_ONLY");
    assert.equal(engine.total, null, "the portal reader drops $0, so the deck holds no stored headline");
    assert.equal(visual.todayTotal, 0, "the engine's own answer for today, unchanged by any lever");
    assert.equal(visual.tierNow, "REPAIR_ONLY");
    assert.ok(visual.optimizedTotal > 0, "the cleaned file routes up");
    assert.notEqual(visual.tierAfter, "REPAIR_ONLY");
    assert.equal(engineRun.projectedPreapproval.totalCombined, 0,
      "the engine's own once-fixed amount keeps today's tier and stays $0 (10.2 item 2)");
  });

  test("card use alone moves nothing while the negatives block funding", () => {
    const [paydown, clean] = visual.levers;
    assert.equal(paydown.applies, false);
    assert.equal(paydown.totalAfter, 0);
    assert.equal(clean.applies, true);
    assert.equal(clean.totalAfter, visual.optimizedTotal);
  });

  test("items are the file's own, merged across the bureaus that carry them", () => {
    const byKind = (kind) => visual.items.filter((i) => i.kind === kind).map((i) => i.creditor).sort();
    assert.deepEqual(byKind("collection"), ["MIDLAND CREDIT MGMT", "PORTFOLIO RECOVERY"]);
    assert.deepEqual(byKind("charge_off"), ["SYNCB/CARE CREDIT"]);
    assert.ok(visual.cards.length > 0 && visual.cards.every((c) => c.target === Math.round(c.limit * 0.1)),
      "a card's target is 10% of its limit");
  });
});

describe("a thin file", () => {
  const sample = buildSampleCreditFile({ pulledAt: OLD_PULL, person: { first: "Test", last: "Sample" }, visa: VISA });
  const pull = mergeBureauReports({
    reports: { TU: sample.payload.bureaus.TU }, requestIds: { TU: "t" }, environment: "production", pulledAt: OLD_PULL
  });
  const { visual } = visualFor(pull);

  test("cleaning alone does not lift the thin-file cut; adding accounts does", () => {
    assert.equal(visual.tierNow, "FUNDING_PLUS_REPAIR");
    const [paydown, clean, accounts] = visual.levers;
    assert.equal(paydown.applies, true);
    assert.equal(clean.applies, false, "the router still holds a thin file out of full funding");
    assert.equal(clean.totalAfter, paydown.totalAfter);
    assert.equal(accounts.applies, true);
    assert.ok(accounts.totalAfter > clean.totalAfter);
    assert.equal(visual.tierAfter, "FULL_FUNDING");
  });
});

describe("an incomplete pull is never funded (engine.js Q8)", () => {
  test("a bureau that returned no accounts keeps the cleaned file out of full funding", () => {
    const pull = livePull("repair-full");
    pull.bureaus.TU = { ...pull.bureaus.TU, tradelines: [] };
    const { visual } = visualFor(pull);
    assert.equal(visual.tierNow, "REPAIR_ONLY");
    assert.equal(visual.tierAfter, null, "the engine would send it to review, so no tier is promised");
    assert.equal(visual.optimizedTotal, 0);
    assert.equal(visual.levers[1].applies, false);
  });
});

describe("a company that does not exist yet (F15)", () => {
  const pull = livePull("fundable");
  const first = visualFor(pull, { businesses: [] });
  const personalRun = runOn(OLD_PULL)(pull, { submittedName: NAME });
  const base = personalRun.preapprovals.personalCard.base;

  test("is priced on the engine's card base with the engine's age rule", () => {
    assert.ok(base > 0);
    assert.deepEqual(first.visual.newCompany, {
      year1: Math.floor(businessFundingDollars(base, 0)),
      year2: Math.floor(businessFundingDollars(base, 12)),
      after2: Math.floor(businessFundingDollars(base, 24))
    });
    assert.equal(first.visual.newCompany.year1 * 2, first.visual.newCompany.year2);
    assert.equal(first.visual.newCompany.year2 * 2, first.visual.newCompany.after2);
  });

  test("never changes today's total, a lever or the optimized total", () => {
    const withCompanies = visualFor(pull, {
      businesses: [
        { name: "Not Yet Inc", incorporated_date: null, age_months: null },
        { name: "Also Not Yet LLC", incorporated_date: "2026-01", age_months: 3 }
      ]
    }).visual;
    assert.equal(first.visual.todayTotal, first.engine.total, "todayTotal is the stored headline");
    assert.equal(withCompanies.todayTotal, first.visual.todayTotal);
    assert.deepEqual(withCompanies.levers, first.visual.levers);
    assert.equal(withCompanies.optimizedTotal, first.visual.optimizedTotal);
    assert.deepEqual(withCompanies.newCompany, first.visual.newCompany);
    assert.ok(first.visual.newCompany.year1 > 0);
    assert.equal(first.visual.optimizedTotal, first.visual.todayTotal,
      "a clean top-tier file has nothing left to optimize; the possible company is not added");
    assert.deepEqual(first.visual.levers.map((l) => l.applies), [false, false, false]);
  });

  test("a file with no seasoned card has no company price to show", () => {
    const noAnchor = sandboxPull();
    assert.equal(visualFor(noAnchor, { day: SANDBOX_DAY, name: SANDBOX_NAME }).visual.newCompany, null);
  });
});

describe("companies that have a report", () => {
  const now = new Date().toISOString();
  const pull = livePull("fundable", { pulledAt: now, business: "two_clean" });
  const decks = [
    { id: "b1", name: "Cedar Mesa Consulting LLC", incorporated_date: "2022-09", age_months: 42 },
    { id: "b2", name: "Bright Mesa Marketing LLC", incorporated_date: "2025-07", age_months: 8 },
    { id: "b3", name: "No Report Yet LLC", incorporated_date: null, age_months: null }
  ];
  const { engine, visual } = visualFor(pull, { day: now, businesses: decks });

  test("each amount is the engine's own for that company's report; no report is null", () => {
    const scored = scoreCompanyReports(pull, { submittedName: NAME, runEngine: runOn(now) });
    const finalOf = (name) => scored.find((s) => s.name === name).business.final;
    assert.deepEqual(visual.companies.map((c) => c.name), decks.map((d) => d.name));
    assert.equal(visual.companies[0].amount, finalOf("Cedar Mesa Consulting LLC"));
    assert.equal(visual.companies[1].amount, finalOf("Bright Mesa Marketing LLC"));
    assert.equal(visual.companies[2].amount, null);
    assert.deepEqual(visual.companies.map((c) => [c.incorporatedDate, c.ageMonths]),
      [["2022-09", 42], ["2025-07", 8], [null, null]]);
  });

  test("the personal money plus every company's amount is the headline", () => {
    const personal = runOn(now)(pull, { submittedName: NAME }).preapprovals.totalPersonal;
    const businessMoney = visual.companies.reduce((sum, c) => sum + (c.amount ?? 0), 0);
    assert.ok(businessMoney > 0);
    assert.equal(visual.todayTotal, engine.total);
    assert.equal(personal + businessMoney, visual.todayTotal);
  });
});

describe("the clock", () => {
  test("a pull older than 30 days is read as it was priced, not sent to review", () => {
    const pull = livePull("repair-trial");
    const unpinned = runTierEngineFromCrsResult(pull, { submittedName: NAME });
    assert.equal(unpinned.outcome, "MANUAL_REVIEW",
      "the trap: re-running a stored pull on today's clock calls every report stale ($0)");
    const { priced, visual } = visualFor(pull);
    assert.equal(priced.outcome, "REPAIR_ONLY");
    assert.equal(visual.tierNow, "REPAIR_ONLY");
    assert.ok(visual.optimizedTotal > 0);
  });
});

describe("one number on the screen", () => {
  const pull = livePull("fundable");
  const { priced } = pricedAndRow();
  function pricedAndRow() { return { priced: pricedOn(OLD_PULL, pull) }; }

  test("a stored headline the engine does not reproduce withholds the money, keeps the lists", () => {
    const engine = deckEngine({ total: priced.total + 1, outcome: priced.outcome });
    const v = buildDeckVisualData({ crs: row(pull, priced.outcome), engine, name: NAME });
    assert.equal(v.source, "engine");
    assert.equal(v.todayTotal, priced.total + 1, "the deck's own headline is left exactly as it is");
    assert.ok(v.levers.every((l) => l.totalAfter === null && l.applies === false));
    assert.equal(v.optimizedTotal, null);
    assert.equal(v.tierNow, null);
    assert.equal(v.newCompany, null);
    assert.ok(v.cards.length > 0, "the cards do not depend on the headline");
  });

  test("a stored tier the engine does not reproduce withholds the money too", () => {
    const engine = deckEngine({ total: priced.total, outcome: "FUNDING_PLUS_REPAIR" });
    const v = buildDeckVisualData({ crs: row(pull, "FUNDING_PLUS_REPAIR"), engine, name: NAME });
    assert.equal(v.optimizedTotal, null);
    assert.equal(v.tierNow, null);
  });

  test("a name the bureaus do not know sends the file to review: no amounts, no tier", () => {
    const engine = deckEngine({ total: null, outcome: null });
    const v = buildDeckVisualData({ crs: row(pull, null), engine, name: "Somebody Else" });
    assert.equal(v.optimizedTotal, null);
    assert.equal(v.tierNow, null);
    assert.equal(v.todayTotal, null);
  });
});
