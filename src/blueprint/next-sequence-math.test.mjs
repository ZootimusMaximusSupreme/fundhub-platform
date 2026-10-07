// The next funding sequence planner's math, with no database. Every window is
// asserted against the number written in its source; every unknown input stays
// unknown; the staff date wins; and no word in the answer says "round two".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WINDOWS, SOURCES, isoDay, addDays, dayAfterMonths, windowCounts, bureauPlan, applicationInquiries,
  inquiriesFactor, newCreditFactor, engineSeasonedOn, overallCardUse, utilizationFactor,
  blockersFor, planNextSequence, planSummaryText
} from "./next-sequence-math.mjs";

const ASOF = "2026-10-06";

/* One finished sequence, read from a fresh pull: Experian is over the 6-month
   limit (3 in the last 6 months), Equifax and TransUnion are under. */
function afterSequence(over = {}) {
  return {
    asOf: ASOF,
    pull: {
      on: "2026-10-05",
      bureausPulled: ["EX", "EQ", "TU"],
      list: [
        { bureau: "EX", date: "2026-03-02" },
        { bureau: "EX", date: "2026-09-14" }, { bureau: "EX", date: "2026-09-21" }, { bureau: "EX", date: "2026-09-28" },
        { bureau: "EQ", date: "2026-09-15" }, { bureau: "EQ", date: "2026-09-22" },
        { bureau: "TU", date: "2026-09-16" }, { bureau: "TU", date: "2026-09-28" }
      ]
    },
    counts: { EX: 4, EQ: 2, TU: 2 },
    accounts: [
      { lender: "CHASE", kind: "revolving", opened_on: "2019-05-28", closed: false },
      { lender: "AMEX BLUE", kind: "revolving", opened_on: "2026-09-20", closed: false },
      { lender: "CITI", kind: "revolving", opened_on: "2026-10-02", closed: false }
    ],
    applications: [],
    rounds: [{ round_number: 1, status: "funded", funded: true, funded_on: "2026-10-02" }],
    file: { ran: true, score: 731, negatives: 0, util_pct: 12, on: "2026-10-05" },
    linked: { num: 2600000, den: 5000000, as_of: "2026-10-05" },
    plan: { saved_on: "2026-10-04", crossing30: { on: "2027-01-06", already: false, earliest: false } },
    ...over
  };
}

describe("the windows are the numbers written in their sources", () => {
  test("inquiries: under 3 in 6 months and under 6 in 12 (Hard inquiries - Bureau stacking)", () => {
    assert.deepEqual({ ...WINDOWS.inquiryRecent }, { months: 6, under: 3 });
    assert.deepEqual({ ...WINDOWS.inquiryYear }, { months: 12, under: 6 });
    assert.match(SOURCES.inquiryRule.ref, /Hard inquiries - Bureau stacking/);
    assert.match(SOURCES.inquiryRule.ref, /hard-inquiries-bureau-stacking--f3a39877/);
  });

  test("inquiry ages: stop mattering at 12, drop off at 24 (Live Bootcamp, Factors Of Credit Score, Inquiry Training)", () => {
    assert.equal(WINDOWS.inquiryStopsMattering.months, 12);
    assert.equal(WINDOWS.inquiryDropsOff.months, 24);
    for (const page of ["Live Bootcamp (FUNDING) - July 2026", "Factors Of Credit Score", "Inquiry Training"]) {
      assert.ok(SOURCES.inquiryAges.ref.includes(page), page);
    }
  });

  test("new credit: about every 6 months (Factors Of Credit Score)", () => {
    assert.equal(WINDOWS.newCreditSpacing.months, 6);
    assert.match(SOURCES.newCredit.ref, /Factors Of Credit Score/);
  });

  test("engine: a card counts at 24 months, card use 30%, fundable 700 (underwriter.cjs)", () => {
    assert.equal(WINDOWS.engineSeasoned.months, 24);
    assert.equal(WINDOWS.utilizationTarget.pct, 30);
    assert.equal(WINDOWS.fundableMinScore, 700);
    for (const k of ["engineSeasoning", "engineUtilization", "engineFundable"]) {
      assert.match(SOURCES[k].ref, /underwriter\.cjs/, k);
    }
  });

  test("the engine's own file still says what this file says", () => {
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../underwrite/vendor/underwriter.cjs"), "utf8");
    assert.match(src, /ageMonths >= 24/, "seasoned at 24 months");
    assert.match(src, /util <= 30/, "fundable at 30% or less");
    assert.match(src, /score >= 700/, "fundable at 700");
    assert.match(src, /target_util_pct: needsUtilReduction \? 30 : null/, "target 30");
  });
});

describe("days", () => {
  test("a thing counts through the day it turns N months old; the next day is clear", () => {
    assert.equal(dayAfterMonths("2026-09-14", 6), "2027-03-15");
    assert.equal(dayAfterMonths("2026-08-31", 6), "2027-03-01", "Feb 28 is the last day it counts");
    assert.equal(dayAfterMonths("2026-09-14", 12), "2027-09-15");
  });

  test("isoDay reads dates and timestamps, and nothing else", () => {
    assert.equal(isoDay("2026-10-07T04:18:21.226Z"), "2026-10-07");
    assert.equal(isoDay(new Date("2026-10-07T04:18:21.226Z")), "2026-10-07");
    assert.equal(isoDay("2026-02-30"), null);
    assert.equal(isoDay(""), null);
    assert.equal(isoDay(null), null);
    assert.equal(isoDay("soon"), null);
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });
});

describe("one bureau against the two limits", () => {
  test("two inquiries in 6 months: open now, room for one more", () => {
    const p = bureauPlan({ dates: ["2026-09-14", "2026-09-21"], asOf: ASOF });
    assert.equal(p.open_now, true);
    assert.equal(p.status, "ready");
    assert.equal(p.ready_on, null);
    assert.equal(p.in_6_months, 2);
    assert.equal(p.room, 1);
  });

  test("three in the last 6 months: waits for the oldest to leave the 6-month window", () => {
    const p = bureauPlan({ dates: ["2026-09-14", "2026-09-21", "2026-09-28"], asOf: ASOF });
    assert.equal(p.open_now, false);
    assert.equal(p.status, "waiting");
    assert.equal(p.ready_on, "2027-03-15", "counts through 2027-03-14, clear on the 15th");
    assert.equal(p.room, 0);
  });

  test("six in 12 months with only two in the last 6: the 12-month limit is the one that waits", () => {
    const dates = ["2026-01-10", "2026-01-12", "2026-02-02", "2026-02-20", "2026-09-20", "2026-09-25"];
    const p = bureauPlan({ dates, asOf: ASOF });
    assert.equal(p.in_6_months, 2);
    assert.equal(p.in_12_months, 6);
    assert.equal(p.open_now, false);
    /* The oldest, 2026-01-10, leaves the 12-month window after 2027-01-10. */
    assert.equal(p.ready_on, "2027-01-11");
  });

  test("four in 6 months: the first day with fewer than 3 is when the SECOND oldest has left", () => {
    const dates = ["2026-04-10", "2026-04-12", "2026-04-14", "2026-09-30"];
    const p = bureauPlan({ dates, asOf: ASOF });
    assert.equal(p.in_6_months, 4);
    assert.equal(p.open_now, false);
    /* 04-10 counts through 10-10, 04-12 through 10-12, 04-14 through 10-14.
       On 10-11 three are left (04-12, 04-14, 09-30): still not under 3.
       On 10-13 two are left (04-14, 09-30): under 3. */
    assert.equal(p.ready_on, "2026-10-13");
  });

  test("the ages are reported but do not gate: 12 months stops mattering, 24 months drops off", () => {
    const p = bureauPlan({ dates: ["2026-09-14", "2026-09-21", "2026-09-28"], asOf: ASOF });
    assert.equal(p.newest_on, "2026-09-28");
    assert.equal(p.stops_mattering_on, "2027-09-29");
    assert.equal(p.drops_off_on, "2028-09-29");
  });

  test("inquiries dated in the future do not count today", () => {
    const { n6, n12 } = windowCounts(["2026-10-20"], ASOF);
    assert.deepEqual({ n6, n12 }, { n6: 0, n12: 0 });
  });

  test("undated inquiries count in both windows and never age out", () => {
    const blocked = bureauPlan({ dates: ["2026-09-14"], undated: 2, asOf: ASOF });
    assert.equal(blocked.open_now, false);
    assert.equal(blocked.status, "waiting", "the dated one still leaves; 2 undated + 0 dated is under 3");
    assert.equal(blocked.ready_on, "2027-03-15");
    const never = bureauPlan({ dates: [], undated: 3, asOf: ASOF });
    assert.equal(never.status, "unknown");
    assert.equal(never.ready_on, null);
  });
});

describe("inquiries: all three bureaus must be under both limits", () => {
  const pull = afterSequence().pull;

  test("the date is the latest bureau's date; each bureau's own numbers ride along", () => {
    const f = inquiriesFactor({ asOf: ASOF, pull, counts: {} });
    assert.equal(f.factor, "inquiries");
    assert.equal(f.status, "waiting");
    assert.equal(f.ready_on, "2027-03-15");
    const byCode = Object.fromEntries(f.detail.bureaus.map((b) => [b.bureau, b]));
    assert.equal(byCode.EX.in_6_months, 3);
    assert.equal(byCode.EX.in_12_months, 4);
    assert.equal(byCode.EQ.open_now, true);
    assert.equal(byCode.TU.open_now, true);
    assert.equal(f.source, SOURCES.inquiryRule);
    assert.equal(f.also, SOURCES.inquiryAges);
    assert.match(f.text, /Experian has 3 in the last 6 months \(it needs fewer than 3\)\. It opens on 2027-03-15\./);
  });

  test("everyone under the limits: ready, nothing to wait for", () => {
    const ok = { on: "2026-10-05", bureausPulled: ["EX", "EQ", "TU"], list: [{ bureau: "EX", date: "2026-02-01" }] };
    const f = inquiriesFactor({ asOf: ASOF, pull: ok, counts: {} });
    assert.equal(f.status, "ready");
    assert.equal(f.ready_on, null);
    assert.match(f.text, /under both limits/);
  });

  test("a bureau that was not pulled is unknown, and unknown carries no date", () => {
    const two = { on: "2026-10-05", bureausPulled: ["EX", "EQ"], list: [{ bureau: "EX", date: "2026-09-14" }, { bureau: "EX", date: "2026-09-21" }, { bureau: "EX", date: "2026-09-28" }] };
    const f = inquiriesFactor({ asOf: ASOF, pull: two, counts: {} });
    assert.equal(f.status, "unknown");
    assert.equal(f.ready_on, null);
    assert.equal(f.not_before, "2027-03-15", "what the bureaus we can read already say");
    assert.match(f.text, /TransUnion/);
  });

  test("no pull at all: unknown, never zero", () => {
    const f = inquiriesFactor({ asOf: ASOF, pull: null, counts: {} });
    assert.equal(f.status, "unknown");
    assert.ok(f.detail.bureaus.every((b) => b.reason === "no_credit_pull"));
  });

  test("counts with no dates: under 3 is enough to say ready; 3 or more is unknown", () => {
    const under = inquiriesFactor({ asOf: ASOF, pull: null, counts: { EX: 2, EQ: 0, TU: 1 } });
    assert.equal(under.status, "ready");
    assert.ok(under.detail.bureaus.every((b) => b.basis === "count_only"));
    const over = inquiriesFactor({ asOf: ASOF, pull: null, counts: { EX: 3, EQ: 0, TU: 1 } });
    assert.equal(over.status, "unknown");
    assert.equal(over.detail.bureaus.find((b) => b.bureau === "EX").total, 3);
    const missing = inquiriesFactor({ asOf: ASOF, pull: null, counts: { EX: 0, EQ: null, TU: 0 } });
    assert.equal(missing.status, "unknown", "one blank count blanks the answer, like the engine");
  });

  test("a pull whose payload carries no inquiry list falls back to the counts", () => {
    const noList = { on: "2026-10-05", bureausPulled: ["EX", "EQ", "TU"], list: null };
    const f = inquiriesFactor({ asOf: ASOF, pull: noList, counts: { EX: 1, EQ: 1, TU: 1 } });
    assert.equal(f.status, "ready");
  });
});

describe("applications sent after the pull add inquiries a pull cannot show yet", () => {
  const apps = [
    { id: "a1", status: "Approved", lender_name: "Chase", applied_on: "2026-10-01", bureaus: ["EX"] },
    { id: "a2", status: "Approved", lender_name: "Chase", applied_on: "2026-10-01", bureaus: ["EX"] },
    { id: "a3", status: "Applied", lender_name: "Citi", applied_on: "2026-10-02", bureaus: ["EX", "EQ"] },
    { id: "a4", status: "Apply", lender_name: "Wells", applied_on: "2026-10-03", bureaus: ["TU"] },
    { id: "a5", status: "Denied", lender_name: "Old Bank", applied_on: "2026-09-20", bureaus: ["TU"] }
  ];

  test("one pull per bank per day; Apply is still a to-do; an application on or before the pull day is on the pull", () => {
    const out = applicationInquiries(apps, "2026-09-30");
    assert.deepEqual(out.list.map((i) => [i.bureau, i.date, i.lender]).sort(), [
      ["EQ", "2026-10-02", "Citi"], ["EX", "2026-10-01", "Chase"], ["EX", "2026-10-02", "Citi"]
    ]);
    assert.equal(out.unknown_bureau, 0);
    const onPullDay = applicationInquiries(apps, "2026-10-01");
    assert.deepEqual(onPullDay.list.map((i) => i.lender), ["Citi", "Citi"]);
  });

  test("with no pull at all every sent application counts", () => {
    assert.equal(applicationInquiries(apps, null).list.length, 4);
  });

  test("an application whose bank's bureau is not known makes the factor unknown", () => {
    const f = inquiriesFactor({
      asOf: ASOF,
      pull: { on: "2026-09-30", bureausPulled: ["EX", "EQ", "TU"], list: [] },
      applications: [{ id: "x", status: "Applied", lender_name: "Local CU", applied_on: "2026-10-02", bureaus: null }]
    });
    assert.equal(f.status, "unknown");
    assert.equal(f.detail.application_bureau_unknown, 1);
    assert.match(f.text, /did not say which bureau/);
  });

  test("applications after the pull move the date: they land on the bureau their bank pulls", () => {
    const sent = [1, 2, 3].map((n) => ({
      id: `s${n}`, status: "Applied", lender_name: `Bank ${n}`, applied_on: `2026-10-0${n}`, bureaus: ["TU"]
    }));
    const f = inquiriesFactor({
      asOf: ASOF,
      pull: { on: "2026-09-30", bureausPulled: ["EX", "EQ", "TU"], list: [] },
      applications: sent
    });
    assert.equal(f.status, "waiting");
    assert.equal(f.ready_on, "2027-04-02", "TransUnion has 3 in 6 months; the oldest, 2026-10-01, leaves after 2027-04-01");
    assert.equal(f.detail.from_applications, 3);
  });
});

describe("new credit: about 6 months after the newest new credit", () => {
  test("the newest account or application starts the clock", () => {
    const f = newCreditFactor({
      asOf: ASOF,
      accounts: [{ lender: "A", kind: "revolving", opened_on: "2026-09-20" }, { lender: "B", kind: "revolving", opened_on: "2026-10-02" }],
      applications: [{ status: "Applied", lender_name: "C", applied_on: "2026-09-28" }]
    });
    assert.equal(f.status, "waiting");
    assert.equal(f.detail.newest_on, "2026-10-02");
    assert.equal(f.ready_on, "2027-04-03");
    assert.match(f.text, /newest new credit was on 2026-10-02/);
    assert.equal(f.source, SOURCES.newCredit);
  });

  test("a denied application is still new credit: it pulled the file", () => {
    const f = newCreditFactor({ asOf: ASOF, accounts: [{ lender: "A", kind: "revolving", opened_on: "2020-01-01" }],
      applications: [{ status: "Denied", lender_name: "C", applied_on: "2026-10-03" }] });
    assert.equal(f.ready_on, "2027-04-04");
  });

  test("an application still to do (Apply) is not new credit", () => {
    const f = newCreditFactor({ asOf: ASOF, accounts: [{ lender: "A", kind: "revolving", opened_on: "2020-01-01" }],
      applications: [{ status: "Apply", lender_name: "C", applied_on: "2026-10-03" }] });
    assert.equal(f.detail.newest_on, "2020-01-01");
    assert.equal(f.status, "ready");
  });

  test("an approval date counts as the day the account opened", () => {
    const f = newCreditFactor({ asOf: ASOF, accounts: [],
      applications: [{ status: "Approved", lender_name: "C", applied_on: "2026-09-20", decided_on: "2026-09-29" }] });
    assert.equal(f.detail.newest_on, "2026-09-29");
    assert.equal(f.detail.newest[0].kind, "account_opened");
  });

  test("more than 6 months ago: ready, and the date is the day it opened (it can be in the past)", () => {
    const f = newCreditFactor({ asOf: ASOF, accounts: [{ lender: "A", kind: "revolving", opened_on: "2026-03-01" }] });
    assert.equal(f.status, "ready");
    assert.equal(f.ready_on, "2026-09-02");
  });

  test("an open account with no open date could be newer: unknown, with the dated answer as a floor", () => {
    const f = newCreditFactor({ asOf: ASOF, accounts: [
      { lender: "A", kind: "revolving", opened_on: "2026-03-01" },
      { lender: "B", kind: "revolving", opened_on: null, closed: false },
      { lender: "C", kind: "revolving", opened_on: null, closed: true }
    ] });
    assert.equal(f.status, "unknown");
    assert.equal(f.ready_on, null);
    assert.equal(f.not_before, "2026-09-02");
    assert.equal(f.detail.open_accounts_without_date, 1, "a closed line with no date cannot be new credit");
  });

  test("nothing dated at all: unknown", () => {
    const f = newCreditFactor({ asOf: ASOF, accounts: [], applications: [] });
    assert.equal(f.status, "unknown");
    assert.equal(f.ready_on, null);
  });

  test("the engine counts a card at 24 months, from the first of the month; it rides along and does not gate", () => {
    assert.equal(engineSeasonedOn("2026-10-02"), "2028-10-01");
    assert.equal(engineSeasonedOn("2026-12-31"), "2028-12-01");
    assert.equal(engineSeasonedOn(null), null);
    const f = newCreditFactor({ asOf: ASOF, accounts: [
      { lender: "NEW", kind: "revolving", opened_on: "2026-09-20" },
      { lender: "OLD", kind: "revolving", opened_on: "2019-05-28" },
      { lender: "LOAN", kind: "installment", opened_on: "2026-09-21" },
      { lender: "SHUT", kind: "revolving", opened_on: "2026-09-22", closed: true }
    ] });
    assert.deepEqual(f.detail.estimate_counts_new_cards, [{ lender: "NEW", opened_on: "2026-09-20", counts_on: "2028-09-01" }]);
    assert.equal(f.also, SOURCES.engineSeasoning);
  });
});

describe("card use: back to 30% or less", () => {
  test("overall card use needs every balance; a card with no limit is left out", () => {
    assert.deepEqual(overallCardUse([
      { limit_cents: 1000000, balance_cents: 250000 }, { limit_cents: 500000, balance_cents: 0 },
      { limit_cents: null, balance_cents: 99999 }, { limit_cents: 0, balance_cents: 5 }, { closed: true, limit_cents: 100, balance_cents: 100 }
    ]), { num: 250000, den: 1500000 });
    assert.equal(overallCardUse([{ limit_cents: 1000000, balance_cents: null }]), null, "one unread balance: unknown");
    assert.equal(overallCardUse([]), null);
  });

  test("at or under 30%: ready, nothing to wait for", () => {
    const f = utilizationFactor({ asOf: ASOF, linked: { num: 30, den: 100, as_of: "2026-10-05" } });
    assert.equal(f.status, "ready");
    assert.equal(f.ready_on, null);
    assert.equal(f.detail.use_pct, 30);
    assert.equal(f.detail.basis, "linked_cards");
  });

  test("just over 30% with a saved plan: waits for the plan's date", () => {
    const f = utilizationFactor({
      asOf: ASOF, linked: { num: 3001, den: 10000, as_of: "2026-10-05" },
      plan: { saved_on: "2026-10-04", crossing30: { on: "2027-01-06", already: false, earliest: false } }
    });
    assert.equal(f.status, "waiting");
    assert.equal(f.ready_on, "2027-01-06");
    assert.equal(f.source, SOURCES.engineUtilization);
    assert.equal(f.also, SOURCES.paymentPlan);
    assert.match(f.text, /Card use is 30%/, "30.01 shows as 30%, and the integer test still says over");
  });

  test("the plan's date is an earliest date when a rate is missing, and it says so", () => {
    const f = utilizationFactor({
      asOf: ASOF, linked: { num: 5000, den: 10000, as_of: "2026-10-05" },
      plan: { saved_on: "2026-10-04", crossing30: { on: "2027-01-06", earliest: true } }
    });
    assert.equal(f.detail.plan_earliest, true);
    assert.match(f.text, /earliest/);
  });

  test("over 30% with no saved plan: unknown, not guessed", () => {
    const f = utilizationFactor({ asOf: ASOF, linked: { num: 5000, den: 10000, as_of: "2026-10-05" }, plan: null });
    assert.equal(f.status, "unknown");
    assert.equal(f.ready_on, null);
    assert.equal(f.detail.reason, "no_saved_plan");
  });

  test("a plan saved before the sequence cannot see the new cards", () => {
    const f = utilizationFactor({
      asOf: ASOF, linked: { num: 5000, den: 10000, as_of: "2026-10-05" }, lastActivityOn: "2026-10-02",
      plan: { saved_on: "2026-09-01", crossing30: { on: "2027-01-06" } }
    });
    assert.equal(f.status, "unknown");
    assert.equal(f.detail.reason, "plan_predates_sequence");
  });

  test("a plan that already missed its own date, one with no date, and one that never gets there are unknown", () => {
    const base = { asOf: ASOF, linked: { num: 5000, den: 10000, as_of: "2026-10-05" } };
    assert.equal(utilizationFactor({ ...base, plan: { saved_on: "2026-08-01", crossing30: { on: "2026-09-30" } } }).detail.reason, "plan_behind");
    assert.equal(utilizationFactor({ ...base, plan: { saved_on: "2026-08-01", crossing30: null } }).detail.reason, "plan_has_no_date");
    assert.equal(utilizationFactor({ ...base, plan: { saved_on: "2026-08-01", crossing30: { on: null } } }).detail.reason, "plan_never_reaches_target");
  });

  test("no linked cards: the credit file's own number, only while that file is not older than the sequence", () => {
    const fresh = utilizationFactor({ asOf: ASOF, file: { util_pct: 12, on: "2026-10-05" }, fileStale: false });
    assert.equal(fresh.status, "ready");
    assert.equal(fresh.detail.basis, "credit_file");
    const stale = utilizationFactor({ asOf: ASOF, file: { util_pct: 12, on: "2026-09-10" }, fileStale: true, lastActivityOn: "2026-10-02" });
    assert.equal(stale.status, "unknown");
    assert.equal(stale.detail.reason, "balances_older_than_sequence");
    assert.match(stale.text, /2026-09-10/);
  });

  test("linked balances from before the sequence do not count; an unknown balance day cannot show it is after", () => {
    const before = utilizationFactor({ asOf: ASOF, linked: { num: 1, den: 10, as_of: "2026-09-30" }, lastActivityOn: "2026-10-02" });
    assert.equal(before.status, "unknown");
    const unknownDay = utilizationFactor({ asOf: ASOF, linked: { num: 1, den: 10, as_of: null }, lastActivityOn: "2026-10-02" });
    assert.equal(unknownDay.status, "unknown");
    const noSequence = utilizationFactor({ asOf: ASOF, linked: { num: 1, den: 10, as_of: null }, lastActivityOn: null });
    assert.equal(noSequence.status, "ready", "with no sequence there is nothing to be older than");
  });

  test("nothing to read: unknown", () => {
    assert.equal(utilizationFactor({ asOf: ASOF }).status, "unknown");
    assert.equal(utilizationFactor({ asOf: ASOF }).detail.reason, "no_balances");
  });
});

describe("blockers are not dates", () => {
  const ok = { file: { ran: true, score: 731, negatives: 0 }, fundedRounds: 1 };

  test("a clean funded file has none", () => {
    assert.deepEqual(blockersFor(ok), []);
  });

  test("no credit pull, a low score, a negative item: each says so, from the engine's own bar", () => {
    assert.deepEqual(blockersFor({ ...ok, file: { ran: false } }).map((b) => b.id), ["no_credit_file"]);
    const b = blockersFor({ ...ok, file: { ran: true, score: 688, negatives: 2 } });
    assert.equal(b[0].id, "not_fundable");
    assert.match(b[0].text, /The score is 688, and UnderwriteIQ wants 700 or more\. There are 2 negative items on the file\./);
    assert.match(blockersFor({ ...ok, file: { ran: true, score: 731, negatives: 1 } })[0].text, /There is 1 negative item on the file\./);
    assert.equal(b[0].source, SOURCES.engineFundable);
  });

  test("an unknown score or negative count is not a reason; unknown stays unknown", () => {
    assert.deepEqual(blockersFor({ ...ok, file: { ran: true, score: null, negatives: null } }), []);
  });

  test("no funded round yet", () => {
    assert.deepEqual(blockersFor({ ...ok, fundedRounds: 0 }).map((b) => b.id), ["no_funding_yet"]);
  });

  test("an application with no final answer: wait for the decision before the next one", () => {
    const b = blockersFor({ ...ok, applications: [{ status: "Applied" }, { status: "Missing Docs" }, { status: "Approved" }, { status: "Denied" }, { status: "Apply" }] });
    assert.equal(b[0].id, "decisions_pending");
    assert.equal(b[0].count, 2);
    assert.equal(b[0].source, SOURCES.applicationOrder);
  });

  test("a credit file older than the sequence is a blocker with both dates", () => {
    const b = blockersFor({ ...ok, fileStale: true, fileOn: "2026-09-10", lastActivityOn: "2026-10-02" });
    assert.equal(b[0].id, "credit_file_stale");
    assert.match(b[0].text, /2026-09-10.*2026-10-02/);
  });

  test("open decline reconsiderations block once a tracker reports them; none tracked blocks nothing", () => {
    assert.deepEqual(blockersFor({ ...ok, reconsiderations: null }), []);
    assert.deepEqual(blockersFor({ ...ok, reconsiderations: { open: 0 } }), []);
    const b = blockersFor({ ...ok, reconsiderations: { open: 2, source: { label: "x", ref: "y" } } });
    assert.equal(b[0].id, "open_reconsiderations");
    assert.equal(b[0].count, 2);
    assert.deepEqual(b[0].source, { label: "x", ref: "y" });
  });
});

describe("planNextSequence: the date is the latest any known factor names", () => {
  test("after a finished sequence: computed, the latest of the three dates, each with its source", () => {
    const plan = planNextSequence(afterSequence());
    assert.equal(plan.confidence, "computed");
    assert.deepEqual(plan.reasons.map((r) => [r.factor, r.status, r.ready_on]), [
      ["inquiries", "waiting", "2027-03-15"],
      ["new_credit", "waiting", "2027-04-03"],
      ["utilization", "waiting", "2027-01-06"]
    ]);
    assert.equal(plan.suggested_date, "2027-04-03");
    assert.equal(plan.not_before, "2027-04-03");
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.ready, false, "the date is in the future");
    for (const r of plan.reasons) {
      assert.ok(r.source && r.source.label && r.source.ref, `${r.factor} cites its source`);
    }
    assert.equal(plan.after_funding.alert_key, "r1");
    assert.equal(plan.after_funding.last_activity_on, "2026-10-02");
    assert.equal(plan.after_funding.credit_file_stale, false);
  });

  test("on the day after the last window closes it is ready", () => {
    const plan = planNextSequence(afterSequence({
      asOf: "2027-04-04",
      /* a month on: card use came down and a fresh pull shows it */
      pull: { ...afterSequence().pull, on: "2027-04-03" },
      linked: { num: 1000000, den: 5000000, as_of: "2027-04-03" },
      file: { ran: true, score: 745, negatives: 0, util_pct: 20, on: "2027-04-03" }
    }));
    assert.equal(plan.confidence, "computed");
    assert.equal(plan.suggested_date, "2027-04-03");
    assert.equal(plan.ready, true);
  });

  test("an unknown factor does not move the date, makes it partial, and keeps its floor", () => {
    const plan = planNextSequence(afterSequence({ plan: null }));
    assert.equal(plan.confidence, "partial");
    assert.equal(plan.reasons.find((r) => r.factor === "utilization").status, "unknown");
    assert.equal(plan.suggested_date, "2027-04-03", "the two known factors still name a date");
    assert.equal(plan.ready, false);
    assert.match(planSummaryText(plan), /not before 2027-04-03\. Some facts are missing\./);
  });

  test("nothing known at all: no date", () => {
    const plan = planNextSequence({ asOf: ASOF });
    assert.equal(plan.suggested_date, null);
    assert.equal(plan.not_before, null);
    assert.equal(plan.confidence, "partial");
    assert.deepEqual(plan.blockers.map((b) => b.id), ["no_credit_file", "no_funding_yet"]);
    assert.equal(planSummaryText(plan), "Fundhub cannot suggest a date yet. Some facts are missing.");
  });

  test("an open application is a blocker, and being new credit it also moves the date", () => {
    const plan = planNextSequence(afterSequence({
      asOf: "2027-04-04",
      pull: { ...afterSequence().pull, on: "2027-04-03" },
      linked: { num: 1000000, den: 5000000, as_of: "2027-04-03" },
      applications: [{ id: "p", status: "Applied", lender_name: "Chase", applied_on: "2027-04-02", bureaus: ["EQ"] }],
      file: { ran: true, score: 745, negatives: 0, util_pct: 20, on: "2027-04-03" }
    }));
    assert.deepEqual(plan.blockers.map((b) => b.id), ["decisions_pending"]);
    assert.equal(plan.ready, false);
    assert.equal(plan.reasons.find((r) => r.factor === "new_credit").detail.newest_on, "2027-04-02");
    assert.equal(plan.suggested_date, "2027-10-03", "6 months after the application");
  });

  test("a blocker stops ready even when every date has passed, and the summary says what is in the way", () => {
    const plan = planNextSequence(afterSequence({
      asOf: "2027-04-04",
      pull: { ...afterSequence().pull, on: "2027-04-03" },
      linked: { num: 1000000, den: 5000000, as_of: "2027-04-03" },
      file: { ran: true, score: 688, negatives: 0, util_pct: 20, on: "2027-04-03" }
    }));
    assert.equal(plan.confidence, "computed");
    assert.equal(plan.suggested_date, "2027-04-03");
    assert.deepEqual(plan.blockers.map((b) => b.id), ["not_fundable"]);
    assert.equal(plan.ready, false);
    assert.equal(planSummaryText(plan),
      "The dates are clear now, but the file is not ready. UnderwriteIQ does not call the file fundable yet. The score is 688, and UnderwriteIQ wants 700 or more.");
  });

  test("the summary counts the rest, and says 'on <date>' when the dates are still ahead", () => {
    const plan = planNextSequence(afterSequence({
      file: { ran: true, score: 688, negatives: 2, util_pct: 12, on: "2026-10-05" },
      applications: [{ id: "q", status: "Applied", lender_name: "Chase", applied_on: "2026-09-18", bureaus: ["EQ"] }]
    }));
    assert.deepEqual(plan.blockers.map((b) => b.id), ["not_fundable", "decisions_pending"]);
    const line = planSummaryText(plan);
    assert.match(line, /^The dates are clear on 2027-04-03, but the file is not ready\. UnderwriteIQ does not call the file fundable yet/);
    assert.match(line, /1 more thing to fix\.$/);
  });

  test("a clean computed plan: ready now, or ready on the date", () => {
    const soon = planNextSequence(afterSequence());
    assert.equal(planSummaryText(soon), "The file math says the file is ready for the next funding sequence on 2027-04-03.");
    const now = planNextSequence(afterSequence({
      asOf: "2027-04-04",
      pull: { ...afterSequence().pull, on: "2027-04-03" },
      linked: { num: 1000000, den: 5000000, as_of: "2027-04-03" },
      file: { ran: true, score: 745, negatives: 0, util_pct: 20, on: "2027-04-03" }
    }));
    assert.equal(planSummaryText(now), "The file math says the file is ready for the next funding sequence now.");
    assert.equal(planSummaryText(null), null);
  });

  test("a credit file older than the sequence is a blocker and its own balances are not trusted", () => {
    const plan = planNextSequence(afterSequence({
      pull: { ...afterSequence().pull, on: "2026-09-10" },
      file: { ran: true, score: 731, negatives: 0, util_pct: 12, on: "2026-09-10" },
      linked: null
    }));
    assert.equal(plan.after_funding.credit_file_stale, true);
    assert.ok(plan.blockers.some((b) => b.id === "credit_file_stale"));
    assert.equal(plan.reasons.find((r) => r.factor === "utilization").status, "unknown");
  });

  test("the staff date wins; the suggestion rides next to it; an early staff date is flagged, not changed", () => {
    const plan = planNextSequence(afterSequence({ staffDate: "2026-12-01" }));
    assert.equal(plan.staff_date, "2026-12-01");
    assert.equal(plan.effective_date, "2026-12-01");
    assert.equal(plan.effective_source, "staff");
    assert.equal(plan.suggested_date, "2027-04-03");
    assert.deepEqual(plan.flags.map((f) => f.id), ["staff_date_before_suggestion"]);
    assert.equal(planSummaryText(plan), "Staff set the next funding sequence for 2026-12-01.");
    const later = planNextSequence(afterSequence({ staffDate: "2027-06-01" }));
    assert.equal(later.effective_date, "2027-06-01");
    assert.deepEqual(later.flags, []);
  });

  test("no staff date: the suggestion is the effective date", () => {
    const plan = planNextSequence(afterSequence());
    assert.equal(plan.effective_date, "2027-04-03");
    assert.equal(plan.effective_source, "suggested");
  });

  test("a bad asOf is refused, not guessed", () => {
    assert.throws(() => planNextSequence({ asOf: "yesterday" }), /asOf/);
  });
});

describe("naming", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const ROOT = path.resolve(HERE, "../..");
  /* Every file this unit wrote or renamed words in. */
  const FILES = [
    "src/blueprint/next-sequence-math.mjs",
    "src/blueprint/next-sequence-facts.mjs",
    "src/blueprint/next-sequence-plan.mjs",
    "src/blueprint/next-funding-sequence.mjs",
    "src/workflows/blueprint-next-funding-sequence-sweeper.mjs",
    "src/finance/bank-strategy.mjs",
    "src/finance/plan-sources/funding-rounds.mjs",
    "src/finance/plan-sources/bank-strategy.mjs",
    "api/blueprint/staff-actions.mjs",
    "api/money/banks.mjs"
  ];
  const BANNED = /round[\s_-]*(two|2)\b|second[\s_-]+round|2nd[\s_-]+round|\bround\s+deux\b/i;

  test("no word in any file this unit touched says round two", () => {
    const hits = [];
    for (const f of FILES) {
      const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
      lines.forEach((line, i) => { if (BANNED.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`); });
    }
    assert.deepEqual(hits, []);
  });

  test("the sentences the planner writes never say 'round' at all: a sequence holds rounds, the next push is a sequence", () => {
    const partial = planNextSequence(afterSequence({ plan: null, applications: [{ id: "p", status: "Applied", lender_name: "X", applied_on: "2026-10-04", bureaus: null }] }));
    const computed = planNextSequence(afterSequence({ staffDate: "2026-12-01" }));
    const ready = planNextSequence(afterSequence({
      asOf: "2027-04-04",
      pull: { ...afterSequence().pull, on: "2027-04-03" },
      linked: { num: 1000000, den: 5000000, as_of: "2027-04-03" },
      file: { ran: true, score: 745, negatives: 0, util_pct: 20, on: "2027-04-03" }
    }));
    const words = [partial, computed, ready].flatMap((plan) => [
      planSummaryText(plan),
      ...plan.reasons.flatMap((r) => [r.title, r.text, r.source.label, r.also && r.also.label]),
      ...plan.blockers.map((b) => b.text),
      ...plan.flags.map((f) => f.text)
    ]).filter(Boolean);
    assert.ok(words.length > 20);
    for (const w of words) assert.doesNotMatch(w, /round/i, w);
    assert.ok(words.some((w) => /next funding sequence/i.test(w)), "the push after a sequence is called that");
  });

  test("the closer task and the plan pin use the same words", async () => {
    const { nextSequenceTitle } = await import("./next-funding-sequence.mjs");
    assert.match(nextSequenceTitle("staff"), /^Next funding sequence/);
    assert.match(nextSequenceTitle("suggested"), /^Next funding sequence/);
    assert.doesNotMatch(nextSequenceTitle("staff") + nextSequenceTitle("suggested"), /round/i);
  });
});
