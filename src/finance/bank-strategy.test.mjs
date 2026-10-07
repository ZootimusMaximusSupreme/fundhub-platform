// src/finance/bank-strategy.mjs — the rules, and where each one comes from.
// Lender rows below copy the real bank book's words (the `lenders` table,
// Legacy Strong datapoints, read 2026-10-06) for Chase, Bank of America, US Bank,
// Wells Fargo, American Express and Capital One. No Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  seasoningRule, noAccountNeeded, spacingRule, relationshipSignals, relationshipSteps,
  recommendedBanks, cardStacking, relationshipView, buildNextRound, fundingEstimate,
  bankPins, roundPins, notSetList, dollarsToCents, monthsBetween, planBank, openAccount,
  recordDeposit, setRelationshipState, BankStrategyInputError, pickBookRow
} from "./bank-strategy.mjs";

const CHASE = {
  id: "l-chase", name: "Chase", lender_table: "InBranchBizCC", priority_tier: 1, eligible_states: "AZ, CA, TX",
  lane: "business", footprint: "states", covers_states: ["AZ"], bureaus: ["EX", "EQ", "TU"], bureaus_pulled: "EX/EQ/TU",
  requires_account_opening: "yes", relationship_required: "yes", minimum_deposit: "10000.00",
  product_name: "Business Ink Cash / Ink Unlimited / Ink Preferred", intro_offers: "0% intro APR — 12 months",
  stated_requirements: "Business checking account is required. 30+ days of liquidity seasoning strongly improves odds.",
  insider_tips: "Apply for one card → wait for decision → then submit second card to increase odds",
  external_row_id: "LEGACY-INBRANCHBIZCC-CHASE"
};
const BOFA = {
  id: "l-bofa", name: "Bank of America", lender_table: "OnlineBizCC", priority_tier: 1, eligible_states: "AZ, FL",
  lane: "business", footprint: "states", covers_states: ["AZ"], bureaus: ["EX", "EQ", "TU"],
  requires_account_opening: "yes", relationship_required: "yes", minimum_deposit: "5000.00",
  stated_requirements: "Checking account + 30-day seasoning required.", insider_tips: null,
  external_row_id: "LEGACY-ONLINEBIZCC-BANK-OF-AMERICA"
};
const WELLS = {
  id: "l-wells", name: "Wells Fargo", lender_table: "OnlineBizCC", priority_tier: 2, eligible_states: "AZ",
  lane: "business", footprint: "states", covers_states: ["AZ"], bureaus: ["EX", "EQ", "TU"],
  requires_account_opening: "yes", relationship_required: "yes", minimum_deposit: null,
  stated_requirements: "Double bureau pulls are common. Apply with a seasoned file.",
  external_row_id: "LEGACY-ONLINEBIZCC-WELLS-FARGO"
};
const AMEX = {
  id: "l-amex", name: "American Express", lender_table: "OnlineBizCC", priority_tier: 1, eligible_states: "All States",
  lane: "national", footprint: "national", covers_states: ["AZ"], bureaus: ["EX"],
  requires_account_opening: "yes", relationship_required: "yes", minimum_deposit: "0.00",
  stated_requirements: "Checking account not required.; Strongest limits go to those with prior Amex spend/payment history.",
  insider_tips: "Ideal approach: Start with Biz Gold or Biz Platinum → 1–3 months of use → then apply for Biz Blue Cash and Biz Blue Plus",
  external_row_id: "LEGACY-ONLINEBIZCC-AMERICAN-EXPRESS"
};
const CAPONE = {
  id: "l-capone", name: "Capital One", lender_table: "OnlineBizCC", priority_tier: 2, eligible_states: "All States",
  lane: "national", footprint: "national", covers_states: ["AZ"], bureaus: ["EX", "EQ", "TU"],
  requires_account_opening: "no", relationship_required: null, minimum_deposit: "0.00",
  stated_requirements: "Easier approval if you’ve had a strong personal card history with them.",
  external_row_id: "LEGACY-ONLINEBIZCC-CAPITAL-ONE"
};
const SAPPHIRE = {
  id: "l-sapphire", name: "Chase", lender_table: "PersonalCC", priority_tier: null, eligible_states: "All States",
  lane: "national", footprint: "national", covers_states: ["AZ"], bureaus: ["EX"], product_name: "Chase Sapphire Reserve",
  intro_offers: "0% intro APR — 12 months", external_row_id: "PERSONAL-PERSONALCC-CHASE-SAPPHIRE-RESERVE"
};
const FREEDOM = { ...SAPPHIRE, id: "l-freedom", product_name: "Chase Freedom", external_row_id: "PERSONAL-PERSONALCC-CHASE-FREEDOM" };

describe("reading the bank book's own words", () => {
  test("seasoning days come from the bank's sentence, with the sentence kept", () => {
    assert.deepEqual(seasoningRule(BOFA), { days: 30, quote: "Checking account + 30-day seasoning required", field: "stated_requirements" });
    assert.equal(seasoningRule(CHASE).days, 30);
    assert.match(seasoningRule(CHASE).quote, /30\+ days of liquidity seasoning/);
    assert.equal(seasoningRule({ stated_requirements: "Open checking account 30 days prior when possible" }).days, 30);
    assert.equal(seasoningRule({ insider_tips: "Liquidity seasoning 30+ days helps" }).days, 30);
    // "a seasoned file" is about the credit file, and names no days: no rule.
    assert.equal(seasoningRule(WELLS), null);
    assert.equal(seasoningRule({}), null);
  });

  test("a bank whose own notes say no account is needed is caught", () => {
    assert.equal(noAccountNeeded(AMEX).quote, "Checking account not required");
    assert.match(noAccountNeeded({ stated_requirements: "No business checking required." }).quote, /No business checking required/);
    assert.match(noAccountNeeded({ insider_tips: "No biz checking needed" }).quote, /No biz checking needed/);
    assert.equal(noAccountNeeded(CHASE), null);
    assert.equal(noAccountNeeded(BOFA), null);
  });

  test("spacing is the bank's own sentence, or nothing", () => {
    assert.match(spacingRule(CHASE).quote, /wait for decision/);
    assert.match(spacingRule(AMEX).quote, /1–3 months of use/);
    assert.match(spacingRule({ stated_requirements: "The 1 in 8 Rule & 2 in 65 Rule set by Citi" }).quote, /1 in 8/);
    assert.equal(spacingRule(BOFA), null);
  });
});

describe("banks near you", () => {
  test("only banks the book says want an account, in the match's order, one per name", () => {
    const { banks, left_out: leftOut } = recommendedBanks([AMEX, BOFA, CHASE, CAPONE, WELLS, { ...CHASE, id: "l-chase-2", lender_table: "OnlineBizCC" }], { states: ["AZ"] });
    assert.deepEqual(banks.map((b) => b.name), ["Bank of America", "Chase", "Wells Fargo"]);
    // Capital One: the book names no account, deposit, seasoning or relationship. Not listed, not "left out".
    assert.ok(!banks.some((b) => b.name === "Capital One"));
    assert.ok(!leftOut.some((b) => b.name === "Capital One"));
    // American Express: flagged, but its own notes say no account is needed.
    assert.deepEqual(leftOut.map((b) => [b.name, b.reason]), [["American Express", "book_says_no_account_needed"]]);
    assert.equal(leftOut[0].source.ref, "lenders.stated_requirements · LEGACY-ONLINEBIZCC-AMERICAN-EXPRESS");
    // The second Chase row joins the first entry's products.
    const chase = banks.find((b) => b.name === "Chase");
    assert.equal(chase.products.length, 2);
  });

  test("a bank listed through one row is not also named as left out by another", () => {
    const contradictedChase = { ...CHASE, id: "l-chase-x", lender_table: "OnlineBizCC", stated_requirements: "No business checking required." };
    const { banks, left_out: leftOut } = recommendedBanks([contradictedChase, CHASE], { states: ["AZ"] });
    assert.deepEqual(banks.map((b) => b.name), ["Chase"]);
    assert.deepEqual(leftOut, []);
  });

  test("Chase: open, deposit $10,000, season 30+ days — each step cites its book column and row", () => {
    const steps = relationshipSteps(CHASE);
    assert.deepEqual(steps.map((s) => s.step), ["open_account", "deposit", "season"]);
    assert.equal(steps[0].text, "Open a business checking account at Chase.");
    assert.equal(steps[0].source.ref, "lenders.requires_account_opening · LEGACY-INBRANCHBIZCC-CHASE");
    // How to open it: the Fundhub checklist's own words (waypoint business_checking, 362).
    assert.equal(steps[0].how.text, "Open it in the LLC name, using the EIN. Take your filing paperwork and your EIN letter with you.");
    assert.match(steps[0].how.source.ref, /waypoint_definitions\.business_checking/);
    assert.equal(steps[1].text, "Deposit $10,000.");
    assert.equal(steps[1].amount_cents, 1000000);
    assert.equal(steps[1].source.ref, "lenders.minimum_deposit · LEGACY-INBRANCHBIZCC-CHASE");
    assert.equal(steps[2].days, 30);
    assert.equal(steps[2].source.ref, "lenders.stated_requirements · LEGACY-INBRANCHBIZCC-CHASE");
  });

  test("no minimum in the book: the deposit is 'not set', never $0", () => {
    const steps = relationshipSteps(WELLS);
    const dep = steps.find((s) => s.step === "deposit");
    assert.equal(dep.amount_cents, null);
    assert.equal(dep.not_set, true);
    assert.match(dep.text, /not set/);
    assert.equal(relationshipSignals(WELLS).deposit_cents, null);
    assert.equal(relationshipSignals(AMEX).deposit_cents, null, "a $0.00 minimum is not a deposit step");
  });

  test("every recommendation and every step says where its rule came from", () => {
    const { banks } = recommendedBanks([BOFA, CHASE, WELLS], { states: ["AZ"] });
    for (const b of banks) {
      assert.ok(b.source && b.source.label && b.source.ref, b.name);
      for (const w of b.why) assert.ok(w.source && w.source.label && w.source.ref, `${b.name}: ${w.text}`);
      for (const s of b.relationship_steps) assert.ok(s.source && s.source.label && s.source.ref, `${b.name}: ${s.text}`);
    }
  });
});

describe("card stacking", () => {
  const plan = cardStacking([AMEX, BOFA, CHASE, CAPONE, SAPPHIRE, FREEDOM], {
    inquiries: { total: 2, by_bureau: { experian: 1, equifax: 1, transunion: 0 } }
  });

  test("personal cards first, then business — one line per bank, numbered in order", () => {
    assert.deepEqual(plan.items.map((i) => [i.order, i.kind, i.issuer]), [
      [1, "personal", "Chase"], [2, "business", "American Express"], [3, "business", "Bank of America"],
      [4, "business", "Chase"], [5, "business", "Capital One"]
    ]);
    assert.equal(plan.items[0].card, "Chase Sapphire Reserve");
    assert.deepEqual(plan.items[0].other_cards, ["Chase Freedom"]);
    assert.deepEqual(plan.order_rule.sources.map((s) => s.ref.split(" ")[0]), [
      "src/underwrite/black-report-node.mjs", "src/underwrite/funding-sequence.mjs", "src/lenders/match.mjs"
    ]);
  });

  test("spacing: Fundhub's one-at-a-time rule for every card, plus the bank's own words; days between banks not set", () => {
    assert.equal(plan.spacing.text, "One at a time: wait for the decision before you send the next one. Never shotgun applications.");
    assert.match(plan.spacing.source.ref, /src\/underwrite\/black-report-node\.mjs · Application Order Warning/);
    assert.equal(plan.spacing.days_between, null, "no repo rule names a number of days");
    const chase = plan.items.find((i) => i.issuer === "Chase" && i.kind === "business");
    assert.match(chase.spacing_rule.text, /wait for decision/);
    assert.equal(chase.spacing_rule.source.ref, "lenders.insider_tips · LEGACY-INBRANCHBIZCC-CHASE");
    assert.equal(plan.items.find((i) => i.issuer === "Capital One").spacing_rule, null);
  });

  test("a relationship bank waits for its seasoning; inquiry impact names the bureaus and today's counts", () => {
    const chase = plan.items.find((i) => i.issuer === "Chase" && i.kind === "business");
    assert.match(chase.relationship_gate.text, /Open your Chase account first and wait 30\+ days/);
    assert.equal(chase.inquiry_impact.text, "One hard pull on Experian, Equifax and TransUnion per card. Experian has 1 now, Equifax has 1 now and TransUnion has 0 now.");
    assert.equal(chase.inquiry_impact.source.ref, "lenders.bureaus_pulled · LEGACY-INBRANCHBIZCC-CHASE");
    assert.equal(plan.items.find((i) => i.issuer === "American Express").relationship_gate, null);
  });

  test("an opened account moves the gate to a real date", () => {
    const p = cardStacking([CHASE], { relationships: [{ bank_key: "chase", opened_on: "2026-10-01" }] });
    assert.match(p.items[0].relationship_gate.text, /\(2026-10-31\)/);
  });
});

describe("the tracker", () => {
  const today = "2026-10-06";
  test("planned with no date: says so; the deposit plan is the book's minimum, cited", () => {
    const v = relationshipView({ id: "r1", bank_key: "chase", account_kind: "business", state: "open" }, { today, book: CHASE });
    assert.equal(v.status, "planned");
    assert.equal(v.status_text, "Planned · date not set");
    assert.equal(v.bank, "Chase");
    assert.equal(v.deposit_plan_cents, 1000000);
    assert.equal(v.deposit_plan_source.ref, "lenders.minimum_deposit · LEGACY-INBRANCHBIZCC-CHASE");
    assert.equal(v.deposits_total_cents, null, "no deposits recorded is not $0");
    assert.equal(v.months_of_history, null);
  });

  test("staff's own deposit plan wins; bigint strings from Postgres become numbers", () => {
    const v = relationshipView({ id: "r1", bank_key: "chase", account_kind: "business", state: "open", planned_deposit_cents: "2000000" }, { today, book: CHASE });
    assert.equal(v.deposit_plan_cents, 2000000);
    assert.equal(v.deposit_plan_source.label, "Set by staff");
  });

  test("opened: seasoning counts days against the bank's own rule; history in whole months", () => {
    const seasoning = relationshipView({ id: "r1", bank_key: "chase", account_kind: "business", state: "done", opened_on: "2026-09-26" },
      { today, book: CHASE, deposits: [{ id: "d1", amount_cents: "1000000", deposited_on: "2026-09-27" }] });
    assert.equal(seasoning.status, "seasoning");
    assert.equal(seasoning.status_text, "Open · 10 of 30 days seasoned");
    assert.equal(seasoning.seasoned_on, "2026-10-26");
    assert.equal(seasoning.deposits_total_cents, 1000000);
    const seasoned = relationshipView({ id: "r1", bank_key: "chase", account_kind: "business", state: "done", opened_on: "2026-08-15" }, { today, book: CHASE });
    assert.equal(seasoned.status, "seasoned");
    assert.equal(seasoned.months_of_history, 1);
    const plain = relationshipView({ id: "r2", bank_key: "wells fargo", account_kind: "business", state: "done", opened_on: "2026-08-15" }, { today, book: WELLS });
    assert.equal(plain.status, "open");
    assert.equal(plain.seasoning, null);
  });

  test("marked done by the Blueprint tracker with no open day: open, nothing counted, nothing pinned", () => {
    const v = relationshipView({ id: "r9", bank_key: "chase", account_kind: "business", state: "done" }, { today, book: CHASE });
    assert.equal(v.status, "open");
    assert.equal(v.status_text, "Open · day not recorded");
    assert.equal(v.months_of_history, null);
    assert.equal(v.seasoned_on, null);
    assert.deepEqual(bankPins([v], { today, nextDate: "2026-12-01" }), []);
    const nr = buildNextRound({ today, hasCreditFile: true, underwrite: { fundable: true }, matchStates: { states: ["AZ"] }, relationships: [v] });
    assert.deepEqual(nr.readiness_gaps, [], "a done account is not 'open your account'");
    assert.deepEqual(notSetList({ nextRound: { date: "2026-12-01", estimated_amount_cents: 1 }, relationships: [v], stacking: null }), []);
  });

  test("months between dates are calendar months", () => {
    assert.equal(monthsBetween("2026-08-15", "2026-10-06"), 1);
    assert.equal(monthsBetween("2026-08-06", "2026-10-06"), 2);
    assert.equal(monthsBetween("2026-10-06", "2026-10-06"), 0);
  });

  test("the book row behind a line: its own lender first, else a same-name row with the rules", () => {
    const byId = new Map([["l-bofa", BOFA]]);
    const byName = new Map([["chase", [SAPPHIRE, CHASE]]]);
    assert.equal(pickBookRow({ lender_id: "l-bofa", bank_key: "bank of america" }, byId, byName), BOFA);
    assert.equal(pickBookRow({ bank_key: "chase" }, byId, byName), CHASE);
    assert.equal(pickBookRow({ bank_key: "nobody" }, byId, byName), null);
  });
});

describe("the next funding round", () => {
  const today = "2026-10-06";
  test("no credit pull: says so; the NAICS gap names the company; unknown amounts stay null", () => {
    const nr = buildNextRound({
      today, customFields: {}, crsRows: [], hasCreditFile: false,
      businesses: [{ name: "Fundhub LLC", entity_data: { state: "AZ" } }],
      matchStates: { home: null, business: "AZ", states: ["AZ"] }
    });
    assert.equal(nr.date, null);
    assert.equal(nr.date_source, null);
    assert.equal(nr.estimated_amount_cents, null);
    assert.deepEqual(nr.readiness_gaps.map((g) => g.id), ["no_credit_file", "company_naics_missing"]);
    assert.equal(nr.readiness_gaps[1].text, "Fundhub LLC has no NAICS code (industry code) on file.");
    assert.equal(nr.readiness_gaps[1].source.ref, "src/underwrite/funding-sequence.mjs");
    assert.equal(nr.step.id, "prime_personal");
    assert.equal(nr.ready, false);
  });

  test("a staff date and an estimate on file, with their sources; relationship gaps by that date", () => {
    const rels = [
      { id: "r1", bank: "Chase", status: "planned", opened_on: null },
      { id: "r2", bank: "Bank of America", status: "seasoning", opened_on: "2026-10-01", seasoned_on: "2026-10-31",
        seasoning: { days: 30, source: { label: "Bank book · Bank of America", ref: "x" } } },
      { id: "r3", bank: "Wells Fargo", status: "skipped", opened_on: null }
    ];
    const nr = buildNextRound({
      today, customFields: { blueprint_next_sequence_ready_date: "2026-10-21", total_funding_estimate: "125000" },
      crsRows: [], hasCreditFile: true, underwrite: { fundable: true }, businesses: [],
      matchStates: { home: "AZ", business: null, states: ["AZ"] }, relationships: rels, canSetDate: true
    });
    assert.equal(nr.date, "2026-10-21");
    assert.equal(nr.date_source.ref.startsWith("clients.custom_fields.blueprint_next_sequence_ready_date"), true);
    assert.equal(nr.estimated_amount_cents, 12500000);
    assert.equal(nr.amount_source.ref, "clients.custom_fields.total_funding_estimate");
    assert.equal(nr.can_set_date, true);
    assert.deepEqual(nr.readiness_gaps.map((g) => g.text), [
      "Open your account at Chase.",
      "Bank of America will have 20 of 30 days of seasoning on that day."
    ]);
  });

  test("not fundable is a gap with the funding order as its source", () => {
    const nr = buildNextRound({ today, hasCreditFile: true, underwrite: { fundable: false }, matchStates: { states: ["AZ"] } });
    assert.equal(nr.readiness_gaps[0].id, "personal_not_prime");
  });

  test("the estimate: the file's number, then the newest pull's; junk is null and 0 is a real 0", () => {
    assert.deepEqual(fundingEstimate({ total_funding_estimate: "" }, []).cents, null);
    assert.equal(fundingEstimate({ total_funding_estimate: "abc" }, []).cents, null);
    assert.equal(fundingEstimate({ total_funding_estimate: 0 }, []).cents, 0);
    const pulls = [
      { created_at: "2026-09-01T00:00:00Z", result: { fundingEstimate: 10000 } },
      { created_at: "2026-10-01T00:00:00Z", result: JSON.stringify({ fundingEstimate: 45000 }) }
    ];
    const est = fundingEstimate({}, pulls);
    assert.equal(est.cents, 4500000);
    assert.equal(est.source.ref, "crs_results.result.fundingEstimate");
    assert.equal(dollarsToCents(null), null);
    assert.equal(dollarsToCents("5000.00"), 500000);
  });
});

describe("plan pins", () => {
  const today = "2026-10-06";
  const planned = relationshipView({ id: "r1", bank_key: "chase", bank_name: "Chase", account_kind: "business", state: "open",
    planned_open_on: "2026-10-20", entity_id: "c1" }, { today, book: CHASE, containers: new Map([["c1", { name: "Fundhub LLC" }]]) });

  test("a planned day: open + deposit pin with the book's amount, in the board's shape", () => {
    const pins = bankPins([planned], { today });
    assert.equal(pins.length, 1);
    const p = pins[0];
    assert.deepEqual(Object.keys(p).sort(), ["amount_cents", "bank", "container_id", "date", "detail", "id", "kind", "source", "status", "title"]);
    assert.equal(p.id, "bank-strategy:plan:r1");
    assert.equal(p.date, "2026-10-20");
    assert.equal(p.kind, "open_account");
    assert.equal(p.title, "Open business checking at Chase and deposit $10,000");
    assert.equal(p.amount_cents, 1000000);
    assert.equal(p.status, "planned");
    assert.equal(p.container_id, "c1");
    assert.equal(p.source, "bank-strategy");
    assert.deepEqual(bankPins([planned], { today }), pins, "same input, same ids");
  });

  test("a planned day that passed is missed; no plan and no round date means no pin", () => {
    assert.equal(bankPins([planned], { today: "2026-10-21" })[0].status, "missed");
    const noDate = relationshipView({ id: "r2", bank_key: "chase", account_kind: "business", state: "open" }, { today, book: CHASE });
    assert.deepEqual(bankPins([noDate], { today }), []);
  });

  test("no open day but a round date: the last day that still leaves the bank's seasoning", () => {
    const noDate = relationshipView({ id: "r2", bank_key: "chase", account_kind: "business", state: "open" }, { today, book: CHASE });
    const [p] = bankPins([noDate], { today, nextDate: "2026-12-01" });
    assert.equal(p.date, "2026-11-01");
    assert.match(p.detail, /30 days of seasoning by your next round on 2026-12-01/);
  });

  test("opened: done pins for the open day and each deposit, and the seasoning checkpoint", () => {
    const opened = relationshipView({ id: "r3", bank_key: "chase", account_kind: "business", state: "done", opened_on: "2026-09-26" },
      { today, book: CHASE, deposits: [{ id: "d1", amount_cents: 1000000, deposited_on: "2026-09-27" }] });
    const pins = bankPins([opened], { today });
    assert.deepEqual(pins.map((p) => [p.kind, p.date, p.status]), [
      ["open_account", "2026-09-26", "done"], ["deposit", "2026-09-27", "done"], ["checkpoint", "2026-10-26", "planned"]
    ]);
    assert.equal(bankPins([opened], { today, from: "2026-10-01", to: "2026-10-31" }).length, 1, "range filter");
  });

  test("skipped banks never pin", () => {
    const skipped = { ...planned, status: "skipped" };
    assert.deepEqual(bankPins([skipped], { today }), []);
  });

  test("rounds: the next round on the staff date with the estimate; past rounds with what they funded", () => {
    const pins = roundPins({
      nextDate: "2026-12-01", estimateCents: 12500000, today, clientId: "c-1",
      rounds: [{ id: "fr1", round_number: 1, status: "funded", funded_amount: "50000.00", approved_amount: "60000.00", created_at: "2026-07-01T10:00:00Z" }]
    });
    assert.deepEqual(pins.map((p) => [p.id, p.date, p.status, p.amount_cents]), [
      ["funding-rounds:round:fr1", "2026-07-01", "done", 5000000],
      ["funding-rounds:next:c-1:2026-12-01", "2026-12-01", "planned", 12500000]
    ]);
    assert.equal(roundPins({ nextDate: "2026-10-01", today })[0].status, "missed");
    assert.equal(roundPins({ nextDate: "2026-12-01", estimateCents: null, today })[0].amount_cents, null);
  });
});

describe("staff-set values stay blank until set", () => {
  test("the not-set list names them", () => {
    const list = notSetList({
      nextRound: { date: null, estimated_amount_cents: null },
      relationships: [{ id: "r1", bank: "Wells Fargo", status: "planned", planned_open_on: null, deposit_plan_cents: null }],
      stacking: { spacing: { days_between: null } }
    });
    assert.deepEqual(list.map((x) => x.key), ["next_round_date", "funding_estimate", "open_date:r1", "deposit:r1", "stacking_days_between"]);
  });
});

describe("staff writes refuse what cannot be true", () => {
  const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
  const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
  const REL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  function fakeDb(handlers) {
    const seen = [];
    return {
      seen,
      query: async (sql, params) => {
        seen.push({ sql, params });
        for (const [re, fn] of handlers) if (re.test(sql)) return fn(params);
        return { rows: [] };
      }
    };
  }
  const opened = (on) => [/FROM blueprint_bank_relationship_todos\s+WHERE id/, () => ({ rows: [{ id: REL, state: "done", opened_on: on, bank_key: "chase" }] })];

  test("a deposit needs an opened account, a day not before it opened, not in the future, and more than $0", async () => {
    const notOpened = fakeDb([opened(null)]);
    await assert.rejects(recordDeposit(notOpened, { orgId: ORG, clientId: CLIENT, today: "2026-10-06",
      input: { relationship_id: REL, amount_cents: 100, deposited_on: "2026-10-01" } }), (e) => e instanceof BankStrategyInputError && e.code === "not_opened");
    const db = fakeDb([opened("2026-10-01")]);
    const base = { relationship_id: REL, amount_cents: 500000, deposited_on: "2026-10-02" };
    await assert.rejects(recordDeposit(db, { orgId: ORG, clientId: CLIENT, today: "2026-10-06", input: { ...base, deposited_on: "2026-09-30" } }), /before the account was opened/);
    await assert.rejects(recordDeposit(db, { orgId: ORG, clientId: CLIENT, today: "2026-10-06", input: { ...base, deposited_on: "2026-10-07" } }), /cannot be in the future/);
    await assert.rejects(recordDeposit(db, { orgId: ORG, clientId: CLIENT, today: "2026-10-06", input: { ...base, amount_cents: 0 } }), /more than \$0/);
    await assert.rejects(recordDeposit(db, { orgId: ORG, clientId: CLIENT, today: "2026-10-06", input: { ...base, amount_cents: 12.5 } }), /more than \$0/);
  });

  test("a deposit on a line that is not this client's is not found, and nothing is written", async () => {
    const db = fakeDb([]);
    const out = await recordDeposit(db, { orgId: ORG, clientId: CLIENT, today: "2026-10-06",
      input: { relationship_id: REL, amount_cents: 500000, deposited_on: "2026-10-02" } });
    assert.deepEqual(out, { ok: false, error: "not_found" });
    assert.ok(!db.seen.some((q) => /INSERT/.test(q.sql)));
    assert.ok(db.seen.every((q) => q.params.includes(ORG) && q.params.includes(CLIENT)), "every read is pinned to org and client");
  });

  test("a good deposit is written in cents, pinned to the client and the line", async () => {
    const db = fakeDb([opened("2026-10-01"), [/INSERT INTO bank_relationship_deposits/, () => ({ rows: [{ id: "dep-1" }] })]]);
    const out = await recordDeposit(db, { orgId: ORG, clientId: CLIENT, today: "2026-10-06", staffId: "5aff0000-0000-4000-8000-000000000001",
      input: { relationship_id: REL, amount_cents: 500000, deposited_on: "2026-10-02", note: "wire" } });
    assert.deepEqual(out, { ok: true, id: "dep-1" });
    const ins = db.seen.find((q) => /INSERT INTO bank_relationship_deposits/.test(q.sql));
    assert.deepEqual(ins.params, [ORG, CLIENT, REL, 500000, "2026-10-02", "wire", "5aff0000-0000-4000-8000-000000000001"]);
  });

  test("open: the day is required and not in the future", async () => {
    await assert.rejects(openAccount(fakeDb([]), { orgId: ORG, clientId: CLIENT, today: "2026-10-06", input: { relationship_id: REL } }), /required/);
    await assert.rejects(openAccount(fakeDb([]), { orgId: ORG, clientId: CLIENT, today: "2026-10-06", input: { relationship_id: REL, opened_on: "2026-11-01" } }), /future/);
  });

  test("plan: a bank name is required; a container from another client is refused; a plain plan upserts on the 403 key", async () => {
    await assert.rejects(planBank(fakeDb([]), { orgId: ORG, clientId: CLIENT, input: { bank: "  " } }), /bank's name/);
    await assert.rejects(planBank(fakeDb([]), { orgId: ORG, clientId: CLIENT, input: { bank: "Chase", container_id: REL } }), /not on this client's file/);
    const db = fakeDb([[/INSERT INTO blueprint_bank_relationship_todos/, () => ({ rows: [{ id: REL, state: "open" }] })]]);
    const out = await planBank(db, { orgId: ORG, clientId: CLIENT, input: { bank: "US Bank", planned_open_on: "2026-10-20" } });
    assert.deepEqual(out, { ok: true, id: REL, state: "open" });
    const ins = db.seen.find((q) => /INSERT INTO blueprint_bank_relationship_todos/.test(q.sql));
    assert.match(ins.sql, /ON CONFLICT \(client_id, bank_key, account_kind\)/);
    assert.equal(ins.params[2], "us bank");
    assert.equal(ins.params[4], "US Bank");
    assert.equal(ins.params[7], "2026-10-20");
    assert.equal(ins.params[8], null, "no deposit sent: stays null, never 0");
    assert.equal(ins.params[10], true, "planned_open_on was sent");
    assert.equal(ins.params[11], false, "planned_deposit_cents was not sent, so the stored one is kept");
  });

  test("state: only skip or open; an opened account cannot be put back to planned", async () => {
    await assert.rejects(setRelationshipState(fakeDb([]), { orgId: ORG, clientId: CLIENT, input: { relationship_id: REL, state: "done" } }), /skipped or open/);
    await assert.rejects(setRelationshipState(fakeDb([opened("2026-10-01")]), { orgId: ORG, clientId: CLIENT, input: { relationship_id: REL, state: "open" } }), /already open/);
  });
});
