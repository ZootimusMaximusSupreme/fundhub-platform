// The card-due planner moved into the beat library (lib/card-due-plan.mjs) with copies of the small
// helpers it needs (lib/card-due-helpers.mjs). This test holds each copy equal to its original by
// running both on many inputs, including month ends, leap years, bad input, null and undefined, and
// comparing the answer or the error. It also holds src/banking/card-due-reminders.mjs to a pure
// re-export, so the daily job and the hourly beat run the same planner.
import test from "node:test";
import assert from "node:assert/strict";

import * as copy from "./card-due-helpers.mjs";
import * as plan from "./card-due-plan.mjs";
import * as money from "../../../commissions/money.mjs";
import * as cycles from "../../../banking/statement-cycles.mjs";
import * as banking from "../../../banking/card-due-reminders.mjs";

/** The answer, or the error's type and message, so a throw is compared like a value. */
function outcome(fn, args) {
  try {
    return { value: fn(...args) };
  } catch (err) {
    return { error: `${err && err.name}: ${err && err.message}` };
  }
}

function same(name, original, copied, argSets) {
  assert.ok(argSets.length > 0, `${name}: no inputs`);
  for (const args of argSets) {
    assert.deepEqual(outcome(copied, args), outcome(original, args), `${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
  }
}

const YEARS = [0, 1, 1900, 1999, 2000, 2023, 2024, 2025, 2026, 2027, 2028, 2100, 2400, 9999];
const MONTHS = [-1, 0, 1, 2, 3, 4, 6, 9, 11, 12, 13];
const BAD = [null, undefined, NaN, Infinity, -Infinity, "", "2", "abc", 1.5, {}, [], true];

/** Every date from 2023-12-25 to 2025-03-05 (crosses two year ends and a leap February), plus fixed edges. */
function isoDays() {
  const out = [];
  for (let t = Date.UTC(2023, 11, 25); t <= Date.UTC(2025, 2, 5); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out.concat([
    "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-10-20", "2026-12-31", "2027-02-28", "2028-02-29",
    "2100-02-28", "2000-02-29", "0001-01-01", "9999-12-31"
  ]);
}
const DAYS = isoDays();
const BAD_ISO = [
  "2025-02-29", "2100-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-32", "2026-1-2",
  "26-10-20", "2026/10/20", "2026-10-20T00:00:00Z", " 2026-10-20 ", "\t2024-02-29\n", "", "  ", null, undefined,
  20261020, new Date("2026-10-20T00:00:00Z"), {}, []
];

test("card-due helpers: fromCents is the same as src/commissions/money.mjs", () => {
  const ints = [0, -0, 1, -1, 5, 9, 10, 99, 100, 101, -99, -100, -101, 105000, 135000, -135000, 999999, 123456789,
    100_000_000_000, -100_000_000_000, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
  for (let i = -2000; i <= 2000; i += 7) ints.push(i);
  same("fromCents", money.fromCents, copy.fromCents, [...ints, ...BAD, 0.1, -2.5, "100", 1e21].map((v) => [v]));
});

test("card-due helpers: daysInMonth and clampDayToMonth are the same as statement-cycles.mjs", () => {
  const ym = [];
  for (const y of [...YEARS, ...BAD]) for (const m of [...MONTHS, ...BAD]) ym.push([y, m]);
  same("daysInMonth", cycles.daysInMonth, copy.daysInMonth, [...ym, [], [2026]]);
  const ymd = [];
  for (const y of [2023, 2024, 2025, 2100, 2000, null]) {
    for (const m of [1, 2, 4, 12, 0, 13, undefined]) {
      for (const d of [-1, 0, 1, 15, 28, 29, 30, 31, 32, null, undefined, "31", 1.5]) ymd.push([y, m, d]);
    }
  }
  same("clampDayToMonth", cycles.clampDayToMonth, copy.clampDayToMonth, ymd);
});

test("card-due helpers: parseIsoDate and formatIsoDate are the same as statement-cycles.mjs", () => {
  same("parseIsoDate", cycles.parseIsoDate, copy.parseIsoDate, [...DAYS, ...BAD_ISO, ...BAD].map((v) => [v]));
  const parts = [
    ...DAYS.map((iso) => cycles.parseIsoDate(iso)),
    { year: 5, month: 1, day: 1 }, { year: 12345, month: 1, day: 1 }, { year: 2026, month: 12, day: 31 },
    { year: -1, month: 1, day: 1 }, { year: null, month: undefined, day: "x" }, {}
  ];
  same("formatIsoDate", cycles.formatIsoDate, copy.formatIsoDate, [...parts.map((p) => [p]), [null], [undefined], []]);
});

test("card-due helpers: nextOccurrence and daysBetween are the same as statement-cycles.mjs", () => {
  const dueDays = [-1, 0, 1, 2, 15, 27, 28, 29, 30, 31, 32, null, undefined, "15", 1.5, NaN];
  const occ = [];
  for (const d of dueDays) for (const from of [...DAYS.filter((_, i) => i % 3 === 0), ...BAD_ISO]) occ.push([d, from]);
  same("nextOccurrence", cycles.nextOccurrence, copy.nextOccurrence, occ);

  const ends = ["2024-01-31", "2024-02-28", "2024-02-29", "2024-03-01", "2024-12-31", "2025-01-01", "2025-02-28", "2025-03-01",
    "2026-10-20", "2100-02-28", "2100-03-01", "0001-01-01", "9999-12-31", ...BAD_ISO.slice(0, 8), null, undefined];
  const pairs = [];
  for (const a of ends) for (const b of ends) pairs.push([a, b]);
  for (let i = 0; i < DAYS.length - 3; i += 5) pairs.push([DAYS[i], DAYS[i + 3]], [DAYS[i + 3], DAYS[i]]);
  same("daysBetween", cycles.daysBetween, copy.daysBetween, pairs);
});

test("card-due helpers: nextDueDate and UNKNOWN_REASONS are the same as statement-cycles.mjs", () => {
  assert.deepEqual(copy.UNKNOWN_REASONS, cycles.UNKNOWN_REASONS);
  const cyclesIn = [
    ...[1, 15, 28, 29, 30, 31, 0, 32, -3, "15", "31", "abc", "", 1.5, null, undefined].map((d) => ({ payment_due_day: d })),
    {}, null, undefined
  ];
  const todays = ["2024-01-31", "2024-02-28", "2024-02-29", "2025-02-28", "2025-12-31", "2026-10-20", "2026-04-30", ...BAD_ISO.slice(0, 6), null, undefined];
  const args = [];
  for (const c of cyclesIn) {
    for (const t of todays) args.push([c, { today: t }]);
    args.push([c], [c, undefined], [c, {}], [c, null]);
  }
  same("nextDueDate", cycles.nextDueDate, copy.nextDueDate, args);
});

test("card-due planner: src/banking/card-due-reminders.mjs re-exports the library planner, nothing else", () => {
  const names = ["planCardDue", "planLoanDue", "loanDueOn", "cardLabel", "loanLabel", "shortDate", "dollars", "TEMPLATE_KEY", "REMIND_DAYS_BEFORE"];
  for (const name of names) {
    assert.ok(name in plan, `${name} is missing from lib/card-due-plan.mjs`);
    assert.equal(banking[name], plan[name], `${name} must be the library's own export, not a second copy`);
  }
  assert.deepEqual(Object.keys(banking).sort(), [...names, "default"].sort());
  assert.equal(banking.default, plan.default);
  assert.equal(plan.TEMPLATE_KEY, "SMS-FINANCE-OS-CARD-DUE");
  assert.equal(plan.REMIND_DAYS_BEFORE, 3);
});

test("card-due planner: the dollars wording on the copied fromCents matches the original's on many amounts", () => {
  // dollars() is the only planner path that runs fromCents. Same text for the same cents, both ways.
  for (const cents of [0, 1, 99, 100, 105000, 135000, 123456789, -5, -135000]) {
    const viaOriginal = money.fromCents(cents);
    const neg = viaOriginal.startsWith("-");
    const [whole, frac] = (neg ? viaOriginal.slice(1) : viaOriginal).split(".");
    assert.equal(plan.dollars(cents), `${neg ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`);
  }
  assert.throws(() => plan.dollars(1.5), /fromCents: not an integer/);
});
