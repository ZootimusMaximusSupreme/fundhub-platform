// The date math and the push planner for the alerts and repeat bills a client adds
// by hand (unit AL2). Pure: no database, no clock. Each rule has a case that passes
// and a case that would fail if the rule broke.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  nextCustomOn, isCustomOccurrence, planCustomPush, customLabel, customPhoneKind, customDay,
  CUSTOM_PUSH_DAYS_BEFORE, ALERT_CADENCES, BILL_CADENCES
} from "./custom-alert-plan.mjs";
import { REMIND_DAYS_BEFORE } from "./card-due-plan.mjs";

const ID = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e1";
const row = (over = {}) => ({ id: ID, kind: "alert", name: "Pay rent", cadence: "monthly", day_of_month: 14, start_on: null,
  phone_alert: true, archived_at: null, ...over });

describe("nextCustomOn — the next date on or after today", () => {
  test("monthly: this month's day, else next month's; a day past the month's end is its last day", () => {
    assert.equal(nextCustomOn(row({ day_of_month: 14 }), "2026-10-12"), "2026-10-14");
    assert.equal(nextCustomOn(row({ day_of_month: 14 }), "2026-10-14"), "2026-10-14", "the day itself counts");
    assert.equal(nextCustomOn(row({ day_of_month: 14 }), "2026-10-15"), "2026-11-14");
    assert.equal(nextCustomOn(row({ day_of_month: 31 }), "2026-11-02"), "2026-11-30");
    assert.equal(nextCustomOn(row({ day_of_month: 31 }), "2026-02-01"), "2026-02-28");
    assert.equal(nextCustomOn(row({ day_of_month: 29 }), "2028-02-01"), "2028-02-29", "a leap year keeps the 29th");
    assert.equal(nextCustomOn(row({ day_of_month: 31 }), "2026-12-31"), "2026-12-31");
    assert.equal(nextCustomOn(row({ day_of_month: 5 }), "2026-12-20"), "2027-01-05", "into the next year");
  });

  test("once: the date while it has not passed, then nothing", () => {
    const once = row({ cadence: "once", day_of_month: null, start_on: "2026-10-20" });
    assert.equal(nextCustomOn(once, "2026-10-12"), "2026-10-20");
    assert.equal(nextCustomOn(once, "2026-10-20"), "2026-10-20");
    assert.equal(nextCustomOn(once, "2026-10-21"), null);
  });

  test("weekly and every two weeks count from the first date; a first date ahead is next", () => {
    const weekly = row({ kind: "bill", cadence: "weekly", day_of_month: null, start_on: "2026-09-15" });
    assert.equal(nextCustomOn(weekly, "2026-10-12"), "2026-10-13");
    assert.equal(nextCustomOn(weekly, "2026-10-13"), "2026-10-13");
    assert.equal(nextCustomOn(weekly, "2026-10-14"), "2026-10-20");
    assert.equal(nextCustomOn(weekly, "2026-09-01"), "2026-09-15", "not before it started");
    const two = { ...weekly, cadence: "biweekly" };
    assert.equal(nextCustomOn(two, "2026-10-12"), "2026-10-13");
    assert.equal(nextCustomOn(two, "2026-10-14"), "2026-10-27");
  });

  test("yearly: the same month and day; Feb 29 is Feb 28 in other years; a start years ahead waits for it", () => {
    const annual = row({ kind: "bill", cadence: "annual", day_of_month: null, start_on: "2026-03-01" });
    assert.equal(nextCustomOn(annual, "2026-10-12"), "2027-03-01");
    assert.equal(nextCustomOn(annual, "2027-03-01"), "2027-03-01");
    assert.equal(nextCustomOn(annual, "2026-02-01"), "2026-03-01");
    const leap = { ...annual, start_on: "2028-02-29" };
    assert.equal(nextCustomOn(leap, "2029-01-10"), "2029-02-28");
    assert.equal(nextCustomOn(leap, "2026-10-12"), "2028-02-29", "a start more than a year ahead is next");
  });

  test("nothing readable, nothing guessed", () => {
    assert.equal(nextCustomOn(row({ day_of_month: null }), "2026-10-12"), null);
    assert.equal(nextCustomOn(row({ day_of_month: 40 }), "2026-10-12"), null);
    assert.equal(nextCustomOn(row({ cadence: "weekly", day_of_month: null, start_on: "2026-02-31" }), "2026-10-12"), null);
    assert.equal(nextCustomOn(row({ cadence: "daily" }), "2026-10-12"), null);
    assert.equal(nextCustomOn(row(), "not a day"), null);
    assert.equal(nextCustomOn(null, "2026-10-12"), null);
  });
});

describe("isCustomOccurrence — the dispatcher's check before it sends", () => {
  test("each cadence's own dates are occurrences; a moved day is not", () => {
    assert.equal(isCustomOccurrence(row({ day_of_month: 14 }), "2026-11-14"), true);
    assert.equal(isCustomOccurrence(row({ day_of_month: 14 }), "2026-11-15"), false);
    assert.equal(isCustomOccurrence(row({ day_of_month: 31 }), "2026-11-30"), true, "the month-end rule");
    const weekly = row({ cadence: "weekly", day_of_month: null, start_on: "2026-09-15" });
    assert.equal(isCustomOccurrence(weekly, "2026-10-13"), true);
    assert.equal(isCustomOccurrence(weekly, "2026-10-14"), false);
    assert.equal(isCustomOccurrence(weekly, "2026-09-08"), false, "never before it started");
    assert.equal(isCustomOccurrence({ ...weekly, cadence: "biweekly" }, "2026-10-13"), true);
    assert.equal(isCustomOccurrence({ ...weekly, cadence: "biweekly" }, "2026-10-06"), false);
    const once = row({ cadence: "once", day_of_month: null, start_on: "2026-10-20" });
    assert.equal(isCustomOccurrence(once, "2026-10-20"), true);
    assert.equal(isCustomOccurrence(once, "2026-11-20"), false);
    const annual = row({ cadence: "annual", day_of_month: null, start_on: "2028-02-29" });
    assert.equal(isCustomOccurrence(annual, "2029-02-28"), true);
    assert.equal(isCustomOccurrence(annual, "2029-03-01"), false);
    assert.equal(isCustomOccurrence(row(), "bad"), false);
  });

  test("every date nextCustomOn names is an occurrence", () => {
    const rows = [
      row({ day_of_month: 31 }), row({ cadence: "once", day_of_month: null, start_on: "2027-01-02" }),
      row({ cadence: "weekly", day_of_month: null, start_on: "2026-01-07" }),
      row({ cadence: "biweekly", day_of_month: null, start_on: "2025-12-30" }),
      row({ cadence: "annual", day_of_month: null, start_on: "2024-02-29" })
    ];
    for (let d = 0; d < 400; d += 7) {
      const today = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      for (const r of rows) {
        const on = nextCustomOn(r, today);
        if (on) assert.equal(isCustomOccurrence(r, on), true, `${r.cadence} ${today} -> ${on}`);
      }
    }
  });
});

describe("planCustomPush — owed today, or a reason", () => {
  test("0 to 3 days out is owed, with the kind of the row and one key per date", () => {
    assert.equal(CUSTOM_PUSH_DAYS_BEFORE, REMIND_DAYS_BEFORE, "the same window as every payment alert");
    const p = planCustomPush(row(), { today: "2026-10-12" });
    assert.deepEqual(p, { push: true, kind: "custom_alert", reason: null, key: `custom:${ID}:2026-10-14`, subjectId: ID,
      label: "Pay rent", dueOn: "2026-10-14", daysAway: 2 });
    assert.equal(planCustomPush(row(), { today: "2026-10-11" }).push, true, "3 days out");
    assert.equal(planCustomPush(row({ kind: "bill" }), { today: "2026-10-12" }).kind, "custom_bill");
  });

  test("4 days out, switched off, removed, a passed one-time date or an unknown row: not owed, with why", () => {
    assert.equal(planCustomPush(row(), { today: "2026-10-10" }).reason, "not_yet");
    assert.equal(planCustomPush(row({ phone_alert: false }), { today: "2026-10-12" }).reason, "phone_alert_off");
    assert.equal(planCustomPush(row({ archived_at: "2026-10-01T00:00:00Z" }), { today: "2026-10-12" }).reason, "removed");
    assert.equal(planCustomPush(row({ cadence: "once", day_of_month: null, start_on: "2026-10-01" }), { today: "2026-10-12" }).reason, "date_passed");
    assert.equal(planCustomPush(row({ day_of_month: null }), { today: "2026-10-12" }).reason, "no_next_date");
    assert.equal(planCustomPush(row({ kind: "note" }), { today: "2026-10-12" }).reason, "no_item");
    assert.equal(planCustomPush(row(), { today: "x" }).reason, "bad_today");
  });

  test("the words: the row's own name, a plain fallback; the kinds; a date column read as its stored day", () => {
    assert.equal(customLabel({ name: "  Office rent " }), "Office rent");
    assert.equal(customLabel({ kind: "bill", name: " " }), "Your bill");
    assert.equal(customLabel({ kind: "alert" }), "Your alert");
    assert.equal(customPhoneKind({ kind: "alert" }), "custom_alert");
    assert.equal(customPhoneKind({ kind: "x" }), null);
    assert.equal(customDay(new Date(2026, 9, 14)), "2026-10-14");
    assert.equal(customDay("2026-10-14T00:00:00Z"), "2026-10-14");
    assert.equal(customDay("Oct 14"), null);
    assert.deepEqual([...ALERT_CADENCES], ["once", "monthly"]);
    assert.deepEqual([...BILL_CADENCES], ["weekly", "biweekly", "monthly", "annual"]);
  });
});
