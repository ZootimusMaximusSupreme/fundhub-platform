// The plan read: the window rules, the day grid, and what a client viewer may
// see. Pure helpers plus a stub db and stub sources; no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planWindow, planDays, moneyPlan, MAX_DAYS } from "./money-plan.mjs";

const TODAY = "2026-10-07";

describe("planWindow", () => {
  test("no query: the month today falls in", () => {
    assert.deepEqual(planWindow({}, TODAY), { ok: true, month: "2026-10", from: "2026-10-01", to: "2026-10-31" });
  });

  test("?month: that calendar month, short months and leap years included", () => {
    assert.deepEqual(planWindow({ month: "2026-11" }, TODAY), { ok: true, month: "2026-11", from: "2026-11-01", to: "2026-11-30" });
    assert.equal(planWindow({ month: "2027-02" }, TODAY).to, "2027-02-28");
    assert.equal(planWindow({ month: "2028-02" }, TODAY).to, "2028-02-29");
    assert.equal(planWindow({ month: ["2026-12", "2027-01"] }, TODAY).month, "2026-12", "a repeated key takes the first");
  });

  test("a month that is not a month is refused", () => {
    for (const month of ["2026-13", "2026-00", "26-10", "2026-1", "October", "1999-12", "2101-01"]) {
      const w = planWindow({ month }, TODAY);
      assert.equal(w.ok, false, month);
      assert.equal(w.error, "invalid_month", month);
    }
  });

  test("?from&to: both real dates, in order, a year at most", () => {
    assert.deepEqual(planWindow({ from: "2026-10-20", to: "2026-11-05" }, TODAY),
      { ok: true, month: "2026-10", from: "2026-10-20", to: "2026-11-05" });
    assert.equal(planWindow({ from: "2026-10-01" }, TODAY).error, "invalid_window", "both or neither");
    assert.equal(planWindow({ from: "2026-11-01", to: "2026-10-01" }, TODAY).error, "invalid_window");
    assert.equal(planWindow({ from: "2026-02-30", to: "2026-03-01" }, TODAY).error, "invalid_window");
    assert.equal(planWindow({ from: "2026-01-01", to: "2026-12-31" }, TODAY).ok, true);
    assert.equal(planWindow({ from: "2028-01-01", to: "2028-12-31" }, TODAY).ok, true, "366 days in a leap year");
    assert.equal(planWindow({ from: "2026-01-01", to: "2027-01-02" }, TODAY).error, "window_too_long");
    assert.equal(MAX_DAYS, 366);
  });
});

describe("planDays", () => {
  test("October 2026: 31 days, Thursday the 1st, Monday = 1 and Sunday = 7", () => {
    const days = planDays("2026-10-01", "2026-10-31", TODAY, [{ date: "2026-10-15" }, { date: "2026-10-15" }, { date: "2026-10-01" }]);
    assert.equal(days.length, 31);
    assert.deepEqual(days[0], { date: "2026-10-01", weekday: 4, is_today: false, pin_count: 1 });
    assert.equal(days[3].weekday, 7, "Oct 4 is a Sunday");
    assert.equal(days[4].weekday, 1, "Oct 5 is a Monday");
    assert.deepEqual(days.filter((d) => d.is_today).map((d) => d.date), ["2026-10-07"]);
    assert.equal(days.find((d) => d.date === "2026-10-15").pin_count, 2);
  });

  test("a window across a month end, and a backwards window", () => {
    assert.deepEqual(planDays("2026-12-30", "2027-01-02", TODAY).map((d) => d.date),
      ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    assert.deepEqual(planDays("2026-10-05", "2026-10-01", TODAY), []);
  });
});

describe("moneyPlan", () => {
  const CLIENT = { id: "c1", first_name: "Test", last_name: "Test" };
  const db = (client = CLIENT) => ({
    query: async (sql) => {
      if (/FROM clients/.test(sql)) return { rows: client ? [client] : [] };
      if (/FROM entities/.test(sql)) return { rows: [{ id: "biz", kind: "business", name: "Fundhub LLC" }] };
      return { rows: [] };
    }
  });
  const source = {
    name: "steps",
    pins: async () => [{ id: "w1", date: "2026-10-14", kind: "checkpoint", title: "File your LLC", status: "planned", can_mark: ["done"] }],
    mark: async () => ({ ok: true })
  };
  const failing = { name: "broken", pins: async () => { throw new Error("nope"); } };
  const window = { ok: true, month: "2026-10", from: "2026-10-01", to: "2026-10-31" };
  const args = (over = {}) => ({ orgId: "o1", clientId: "c1", window, today: TODAY, sources: [source, failing], ...over });

  test("a client not in the org is null (the endpoint answers 404)", async () => {
    assert.equal(await moneyPlan(db(null), args()), null);
  });

  test("the payload: client, window, days, pins, sources and containers", async () => {
    const out = await moneyPlan(db(), { ...args(), viewer: "staff" });
    assert.equal(out.ok, true);
    assert.deepEqual(out.client, { id: "c1", name: "Test Test" });
    assert.equal(out.viewer, "staff");
    assert.deepEqual([out.today, out.month, out.from, out.to], [TODAY, "2026-10", "2026-10-01", "2026-10-31"]);
    assert.equal(out.days.length, 31);
    assert.equal(out.days.find((d) => d.date === "2026-10-14").pin_count, 1);
    assert.deepEqual(out.pins.map((p) => p.id), ["w1"]);
    assert.deepEqual(out.pins[0].can_mark, ["done"], "staff keep the marks a source allows");
    assert.deepEqual(out.sources, [{ name: "steps", ok: true, count: 1 }, { name: "broken", ok: false, error: "load_failed" }]);
    assert.deepEqual(out.containers, [{ id: "biz", name: "Fundhub LLC", kind: "business" }]);
  });

  test("a client viewer never gets a mark control", async () => {
    const out = await moneyPlan(db(), { ...args(), viewer: "client" });
    assert.equal(out.viewer, "client");
    assert.deepEqual(out.pins[0].can_mark, []);
  });
});
