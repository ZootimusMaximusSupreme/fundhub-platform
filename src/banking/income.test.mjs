// src/banking/income.mjs — repeat money coming in. PURE tests: no database, no
// clock, no network. Every test pins `now` and asserts an exact answer.
//
// The tests that matter most assert what must NOT count: a one-off deposit,
// money moved between the client's own accounts, a paycheck seen only twice, a
// paycheck that stopped, a card payment, and a merchant payout counted twice.
// Each has a twin that WOULD count, so a broken rule fails in either direction.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  detectIncome, loadIncome, incomeInflows, incomeOccurrences, monthlyBillCents, sureMonthlyCents,
  merchantMonths, fitSemimonthly, nextPayday, accountMap,
  INCOME_EXCLUSIONS, NOT_COUNTED, SURE_PER_MONTH
} from "./income.mjs";
import { parseDay } from "./recurring.mjs";

const NOW = "2026-11-07";
const ACCOUNTS = [
  { id: "chk-p", account_type: "depository", entity_kind: "personal", name: "Personal Checking", mask: "001101" },
  { id: "sav-p", account_type: "depository", entity_kind: "personal", name: "Personal Savings", mask: "1102" },
  { id: "chk-b", account_type: "depository", entity_kind: "unknown", container_kind: "business", name: "Business Checking", mask: "2202" },
  { id: "visa", account_type: "credit", entity_kind: "personal", name: "Personal Visa", mask: "3303" },
  { id: "old", account_type: "depository", entity_kind: "personal", name: "Old Checking", closed_at: "2026-06-01T00:00:00Z" }
];

let seq = 0;
const tx = (acct, day, cents, name, extra = {}) => ({
  id: `t${++seq}`, bank_account_id: acct, provider_transaction_id: `p${seq}`, amount_cents: cents,
  posted_on: day, merchant_name: name, is_pending: false, ...extra
});

/** Every `step` days from `from` through `to`, inclusive. */
function everyDays(from, to, step) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += step * 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
/** The given days of every month from May through `last`. */
function monthly(days, last = NOW, months = ["05", "06", "07", "08", "09", "10", "11"]) {
  const out = [];
  for (const m of months) for (const d of days) {
    const day = `2026-${m}-${String(d).padStart(2, "0")}`;
    if (day <= last) out.push(day);
  }
  return out;
}

const detect = (rows, over = {}) => detectIncome(rows, { now: NOW, accounts: ACCOUNTS, ...over });

describe("each cadence, with the paydays every month is sure to have", () => {
  test("every two weeks: two paychecks a month for sure, never 26/12", () => {
    const rows = everyDays("2026-05-15", "2026-10-30", 14).map((d, i) => tx("chk-p", d, 210000, `ACME CORP PAYROLL PPD ID: 44${i}`));
    const r = detect(rows);
    assert.equal(r.items.length, 1);
    const it = r.items[0];
    assert.equal(it.cadence, "biweekly");
    assert.equal(it.source, "paycheck", "the bank's own word PAYROLL");
    assert.equal(it.typical_cents, 210000);
    assert.equal(it.monthly_cents, 420000, "2 × $2,100, not 26/12 × $2,100 = $4,550");
    assert.equal(it.next_expected_on, "2026-11-13");
    assert.equal(it.kind, "personal");
    assert.equal(it.account_mask, "1101", "last four only");
    assert.equal(r.by_kind.personal.monthly_cents, 420000);
  });

  test("every week: four a month for sure", () => {
    const rows = everyDays("2026-08-07", "2026-11-06", 7).map((d) => tx("chk-p", d, 50000, "DOORDASH DASHER"));
    const it = detect(rows).items[0];
    assert.equal(it.cadence, "weekly");
    assert.equal(it.source, "deposit");
    assert.equal(it.monthly_cents, 200000);
    assert.equal(it.next_expected_on, "2026-11-13");
  });

  test("twice a month (1st and 15th) is told apart from every two weeks by the calendar", () => {
    const rows = monthly([1, 15]).map((d) => tx("chk-p", d, 300000, "GLOBEX DIR DEP"));
    const it = detect(rows).items[0];
    assert.equal(it.cadence, "semimonthly");
    assert.deepEqual(it.anchor_days, [1, 15]);
    assert.equal(it.monthly_cents, 600000);
    assert.equal(it.next_expected_on, "2026-11-15");
  });

  test("twice a month on the 15th and the last day keeps the last day in short months", () => {
    const days = ["2026-05-15", "2026-05-31", "2026-06-15", "2026-06-30", "2026-07-15", "2026-07-31", "2026-08-14", "2026-08-31",
      "2026-09-15", "2026-09-30", "2026-10-15", "2026-10-30"];
    const it = detect(days.map((d) => tx("chk-p", d, 250000, "INITECH PAYROLL"))).items[0];
    assert.equal(it.cadence, "semimonthly");
    assert.equal(it.next_expected_on, "2026-11-15");
    assert.deepEqual(incomeOccurrences(it, { from: "2026-11-08", to: "2027-03-01" }),
      ["2026-11-15", "2026-11-30", "2026-12-15", "2026-12-31", "2027-01-15", "2027-01-31", "2027-02-15", "2027-02-28"]);
  });

  test("every month: one a month, anchored on its day", () => {
    const rows = monthly([3], "2026-11-03").map((d) => tx("chk-b", d, 500000, "ACME CLIENT LLC ACH"));
    const it = detect(rows).items[0];
    assert.equal(it.cadence, "monthly");
    assert.equal(it.monthly_cents, 500000);
    assert.equal(it.next_expected_on, "2026-12-03");
    assert.equal(it.kind, "business", "the container's kind wins over the account's 'unknown'");
  });

  test("every two weeks is NOT read as twice a month (the drift fails the calendar fit)", () => {
    const days = everyDays("2026-05-01", "2026-10-30", 14);
    assert.equal(fitSemimonthly(days.map(parseDay))?.fitRatio >= 0.6, false);
  });

  test("two deposits on one payday are one paycheck (added), and one bonus day does not move the typical amount", () => {
    const rows = [];
    for (const d of everyDays("2026-07-03", "2026-10-30", 14)) {
      rows.push(tx("chk-p", d, 150000, "ACME PAYROLL"), tx("chk-p", d, 50000, "ACME PAYROLL"));
    }
    rows.push(tx("chk-p", "2026-10-16", 400000, "ACME PAYROLL")); // a bonus, same payday
    const it = detect(rows).items[0];
    assert.equal(it.typical_cents, 200000);
    assert.equal(it.monthly_cents, 400000);
  });
});

describe("what must NOT count", () => {
  test("a one-off deposit is listed as a one-off and adds nothing", () => {
    const r = detect([tx("chk-p", "2026-10-21", 184000, "IRS TREAS 310 TAX REF")]);
    assert.equal(r.items.length, 0);
    assert.equal(r.not_counted[0].reason, NOT_COUNTED.ONE_OFF);
    assert.equal(r.not_counted[0].monthly_cents, null);
    assert.equal(r.by_kind.personal.monthly_cents, null, "nothing found is unknown, never $0");
    assert.equal(r.by_kind.personal.reason, "nothing_found");
  });

  test("money moved from the client's own savings is a transfer, not income", () => {
    const rows = [];
    for (const d of monthly([10], "2026-10-10")) {
      rows.push(tx("chk-p", d, 100000, "ONLINE TRANSFER FROM SAV 1102"));
      const t = Date.parse(`${d}T00:00:00Z`) - 86_400_000;
      rows.push(tx("sav-p", new Date(t).toISOString().slice(0, 10), -100000, "ONLINE TRANSFER TO CHK 1101"));
    }
    const r = detect(rows);
    assert.equal(r.items.length, 0, "a steady monthly transfer would otherwise look like a paycheck");
    assert.equal(r.excluded.filter((e) => e.reason === INCOME_EXCLUSIONS.OWN_TRANSFER).length, 6);
  });

  test("…but the same deposits with no matching withdrawal within 3 days DO count", () => {
    const rows = [];
    for (const d of monthly([10], "2026-10-10")) {
      rows.push(tx("chk-p", d, 100000, "ZELLE FROM JORDAN"));
      const t = Date.parse(`${d}T00:00:00Z`) - 4 * 86_400_000;
      rows.push(tx("sav-p", new Date(t).toISOString().slice(0, 10), -100000, "ONLINE TRANSFER"));
      rows.push(tx("sav-p", d, -99999, "ONLINE TRANSFER")); // one cent off is not the same money
      rows.push(tx("chk-p", d, -100000, "SAME ACCOUNT WITHDRAWAL")); // the same account is not a transfer
    }
    const r = detect(rows);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].monthly_cents, 100000);
    assert.equal(r.excluded.filter((e) => e.reason === INCOME_EXCLUSIONS.OWN_TRANSFER).length, 0);
  });

  test("one withdrawal pairs with one deposit only", () => {
    const r = detect([
      tx("chk-p", "2026-10-10", 50000, "TRANSFER IN"),
      tx("chk-b", "2026-10-10", 50000, "TRANSFER IN"),
      tx("sav-p", "2026-10-10", -50000, "TRANSFER OUT")
    ]);
    assert.equal(r.excluded.filter((e) => e.reason === INCOME_EXCLUSIONS.OWN_TRANSFER).length, 1);
  });

  test("the bank's own label for an account transfer or loan money is refused; a payroll label is kept", () => {
    const rows = [
      ...monthly([12], "2026-10-12").map((d) => tx("chk-p", d, 70000, "SAVINGS SWEEP", { category: "TRANSFER_IN_ACCOUNT_TRANSFER" })),
      tx("chk-p", "2026-10-20", 1500000, "SBA LOAN PROCEEDS", { category: "TRANSFER_IN_CASH_ADVANCES_AND_LOANS" }),
      ...monthly([1, 15]).map((d) => tx("chk-p", d, 280000, "HOOLI", { category: "Transfer > Payroll" }))
    ];
    const r = detect(rows);
    assert.deepEqual(r.items.map((i) => [i.name, i.source]), [["HOOLI", "paycheck"]]);
    assert.equal(r.excluded.filter((e) => e.reason === INCOME_EXCLUSIONS.PROVIDER_TRANSFER).length, 7);
  });

  test("a paycheck seen only twice is listed, never counted, and gets no date", () => {
    const r = detect([tx("chk-p", "2026-10-16", 210000, "NEWCO PAYROLL"), tx("chk-p", "2026-10-30", 210000, "NEWCO PAYROLL")]);
    assert.equal(r.items.length, 0);
    assert.equal(r.not_counted[0].reason, NOT_COUNTED.SEEN_TWICE);
    assert.equal(r.not_counted[0].next_expected_on, null);
    assert.equal(r.not_counted[0].monthly_cents, null);
  });

  test("a paycheck that stopped (two paydays passed with nothing) does not count", () => {
    const rows = monthly([3], "2026-09-03").map((d) => tx("chk-p", d, 400000, "OLD JOB PAYROLL"));
    const r = detect(rows);
    assert.equal(r.items.length, 0);
    assert.equal(r.not_counted[0].reason, NOT_COUNTED.STOPPED);
    /* One missed payday is a late sync or a holiday and still counts. */
    const late = detect(monthly([3], "2026-10-03").map((d) => tx("chk-p", d, 400000, "OLD JOB PAYROLL")));
    assert.equal(late.items.length, 1);
    assert.equal(late.items[0].next_expected_on, "2026-12-03");
  });

  test("a withdrawal is never income, a card payment is not cash, a closed account is history, pending is not posted", () => {
    const r = detect([
      ...monthly([5], "2026-11-05").map((d) => tx("visa", d, 50000, "PAYMENT THANK YOU")),
      ...monthly([5], "2026-11-05").map((d) => tx("old", d, 50000, "OLD EMPLOYER")),
      ...monthly([5], "2026-11-05").map((d) => tx("chk-p", d, 50000, "PAYROLL", { is_pending: true })),
      tx("chk-p", "2026-10-05", 1999.5, "HALF CENT"),
      tx("ghost", "2026-10-05", 5000, "NOT THIS CLIENT")
    ]);
    assert.equal(r.items.length, 0);
    const reasons = new Set(r.excluded.map((e) => e.reason));
    for (const why of [INCOME_EXCLUSIONS.NOT_CASH, INCOME_EXCLUSIONS.ACCOUNT_CLOSED, INCOME_EXCLUSIONS.PENDING,
      INCOME_EXCLUSIONS.NOT_INTEGER_CENTS, INCOME_EXCLUSIONS.ACCOUNT_NOT_ON_FILE]) {
      assert.ok(reasons.has(why), why);
    }
  });

  test("a negative row is never turned into income by its size", () => {
    const rows = everyDays("2026-05-15", "2026-10-30", 14).map((d) => tx("chk-p", d, -210000, "ACME PAYROLL"));
    const r = detect(rows);
    assert.equal(r.items.length, 0);
    assert.equal(r.not_counted.length, 0);
  });

  test("the same provider row twice is one deposit", () => {
    const rows = monthly([3], "2026-11-03").map((d) => tx("chk-p", d, 90000, "RENT FROM TENANT"));
    const r = detect([...rows, { ...rows[0] }]);
    assert.equal(r.items[0].occurrence_count, rows.length);
    assert.ok(r.excluded.some((e) => e.reason === INCOME_EXCLUSIONS.DUPLICATE));
  });
});

describe("personal and business are never added together", () => {
  test("each kind has its own monthly figure and there is no total across them", () => {
    const rows = [
      ...everyDays("2026-05-15", "2026-10-30", 14).map((d) => tx("chk-p", d, 210000, "ACME PAYROLL")),
      ...monthly([3], "2026-11-03").map((d) => tx("chk-b", d, 500000, "ACME CLIENT LLC"))
    ];
    const r = detect(rows);
    assert.equal(r.by_kind.personal.monthly_cents, 420000);
    assert.equal(r.by_kind.business.monthly_cents, 500000);
    assert.equal(r.by_kind.unknown.monthly_cents, null);
    assert.deepEqual(Object.keys(r.by_kind).sort(), ["business", "personal", "unknown"], "no combined key");
    assert.ok(!("monthly_cents" in r), "no combined total at the top");
  });

  test("an account nobody sorted stays 'not sorted yet', never personal", () => {
    const map = accountMap([{ id: "x", account_type: "depository", entity_kind: null }]);
    assert.equal(map.get("x").kind, "unknown");
  });
});

describe("merchant payouts", () => {
  const conn = (over = {}) => ({ connection_id: "mc1", provider: "commas", status: "active", entity_kind: "business", entity_name: "Fundhub LLC", ...over });
  const payout = (day, cents, id, over) => ({ ...conn(over), provider_event_id: id, amount_cents: -cents, occurred_on: day });
  const THREE = [
    payout("2026-08-04", 100000, "e1"), payout("2026-08-18", 200000, "e2"),
    payout("2026-09-08", 250000, "e3"),
    payout("2026-10-06", 150000, "e4"), payout("2026-10-20", 250000, "e5"),
    payout("2026-11-03", 999900, "e6") // this month is not a full month and is not judged
  ];

  test("counted from the processor: the slowest of the last three full months", () => {
    assert.deepEqual(merchantMonths(parseDay(NOW)), ["2026-08", "2026-09", "2026-10"]);
    const r = detect([], { merchantPayouts: THREE });
    const m = r.items.find((i) => i.source === "merchant_payout");
    assert.deepEqual(m.months.map((x) => x.payouts_cents), [300000, 250000, 400000]);
    assert.equal(m.monthly_cents, 250000);
    assert.equal(m.name, "Commas payouts");
    assert.equal(m.kind, "business");
    assert.equal(m.payouts_per_month, 2);
    assert.equal(r.by_kind.business.monthly_cents, 250000);
    assert.equal(r.by_kind.personal.monthly_cents, null);
  });

  test("a full month with no payout means it is not counted (and an off connection is not counted)", () => {
    const gap = THREE.filter((p) => !p.occurred_on.startsWith("2026-09"));
    const r = detect([], { merchantPayouts: gap });
    assert.equal(r.items.length, 0);
    assert.equal(r.not_counted[0].reason, NOT_COUNTED.NEEDS_MONTHS);
    assert.equal(r.not_counted[0].monthly_cents, null);
    const off = detect([], { merchantPayouts: THREE.map((p) => ({ ...p, status: "disabled" })) });
    assert.equal(off.not_counted[0].reason, NOT_COUNTED.CONNECTION_OFF);
  });

  test("the bank deposits a counted payout lands as are not counted a second time", () => {
    const landings = [
      tx("chk-b", "2026-08-06", 100000, "COMMAS PAYOUT"), tx("chk-b", "2026-08-20", 200000, "COMMAS PAYOUT"),
      tx("chk-b", "2026-09-10", 250000, "COMMAS PAYOUT"), tx("chk-b", "2026-10-08", 150000, "COMMAS PAYOUT"),
      tx("chk-b", "2026-10-22", 250000, "COMMAS PAYOUT")
    ];
    const r = detect(landings, { merchantPayouts: THREE });
    assert.equal(r.excluded.filter((e) => e.reason === INCOME_EXCLUSIONS.PAYOUT_LANDING).length, 5);
    assert.equal(r.by_kind.business.monthly_cents, 250000, "the processor's number, once");
    /* When the processor side is NOT counted, the bank side is left alone. */
    const gap = THREE.filter((p) => !p.occurred_on.startsWith("2026-09"));
    const r2 = detect(landings, { merchantPayouts: gap });
    assert.equal(r2.excluded.filter((e) => e.reason === INCOME_EXCLUSIONS.PAYOUT_LANDING).length, 0);
  });
});

describe("helpers", () => {
  test("sure monthly figures and bill months, in whole cents", () => {
    assert.deepEqual(SURE_PER_MONTH, { weekly: 4, biweekly: 2, semimonthly: 2, monthly: 1 });
    assert.equal(sureMonthlyCents(12345, "weekly"), 49380);
    assert.equal(sureMonthlyCents(null, "weekly"), null);
    assert.equal(sureMonthlyCents(100, "annual"), null, "a yearly deposit is not monthly income");
    assert.equal(monthlyBillCents(-10000, "weekly"), 43334, "52/12 of $100, rounded up");
    assert.equal(monthlyBillCents("-5499", "monthly"), 5499);
    assert.equal(monthlyBillCents(-12000, "annual"), 1000);
    assert.equal(monthlyBillCents(-100, "fortnightly"), null);
    assert.equal(monthlyBillCents("12.5", "monthly"), null, "dollars in a cents column are refused");
  });

  test("next payday: calendar months, clamped, never an average month", () => {
    assert.deepEqual(nextPayday({ y: 2026, m: 1, d: 31 }, "monthly", [31]), { y: 2026, m: 2, d: 28 });
    assert.deepEqual(nextPayday({ y: 2026, m: 2, d: 28 }, "monthly", [31]), { y: 2026, m: 3, d: 31 });
    assert.deepEqual(nextPayday({ y: 2026, m: 11, d: 15 }, "semimonthly", [1, 15]), { y: 2026, m: 12, d: 1 });
  });

  test("now is required", () => {
    assert.throws(() => detectIncome([], {}), /`now` is required/);
  });
});

describe("into the cash-flow projector", () => {
  const rows = everyDays("2026-05-15", "2026-10-30", 14).map((d) => tx("chk-p", d, 210000, "ACME PAYROLL"));
  const income = detect(rows);

  test("dated paydays inside the window, confirmed only at or above the org's confidence floor", () => {
    const [row] = incomeInflows(income, { from: NOW, to: "2026-12-06", confidenceFloor: 0.75 });
    assert.deepEqual(row.occurrences, [
      { date: "2026-11-13", amountCents: 210000 }, { date: "2026-11-27", amountCents: 210000 }
    ]);
    assert.equal(row.confirmed, true);
    assert.equal(incomeInflows(income, { from: NOW, to: "2026-12-06" })[0].confirmed, false, "no floor set: nobody decided, so not confirmed");
    assert.equal(incomeInflows(income, { from: NOW, to: "2026-12-06", confidenceFloor: 0.99 })[0].confirmed, false);
    assert.deepEqual(incomeInflows(income, { from: NOW, to: "2026-12-06", accountIds: ["chk-b"] }), []);
    assert.deepEqual(incomeInflows({ ok: false }, { from: NOW, to: "2026-12-06" }), []);
  });
});

describe("the read", () => {
  function fakeDb({ inflows = [], outs = [], payouts = [], payoutError = null, accounts = ACCOUNTS } = {}) {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM bank_accounts a\s/.test(sql) && !/bank_transactions/.test(sql)) return { rows: accounts };
        if (/amount_cents > 0/.test(sql)) return { rows: inflows };
        if (/amount_cents < 0/.test(sql)) return { rows: outs };
        if (/FROM merchant_events/.test(sql)) { if (payoutError) throw payoutError; return { rows: payouts }; }
        return { rows: [] };
      }
    };
  }

  test("every statement names the org and the client; the match read only asks for amounts it saw", async () => {
    const inflows = everyDays("2026-05-15", "2026-10-30", 14).map((d) => tx("chk-p", d, "210000", "ACME PAYROLL"));
    const db = fakeDb({ inflows });
    const r = await loadIncome(db, { orgId: "o1", clientId: "c1", asOf: new Date("2026-11-07T15:00:00Z") });
    assert.equal(r.ok, true);
    assert.equal(r.by_kind.personal.monthly_cents, 420000);
    assert.equal(r.window.to, "2026-11-07");
    assert.equal(r.merchant_unavailable, false);
    for (const c of db.calls) {
      assert.match(c.sql, /org_id = \$\d/, c.sql.slice(0, 60));
      assert.match(c.sql, /client_id = \$\d/, c.sql.slice(0, 60));
      assert.doesNotMatch(c.sql, /^\s*(INSERT|UPDATE|DELETE|WITH)\b/i, "a read writes nothing");
    }
    const match = db.calls.find((c) => /amount_cents < 0/.test(c.sql));
    assert.deepEqual(match.params[2], [210000]);
    assert.match(db.calls.find((c) => /amount_cents > 0/.test(c.sql)).sql, /NOT \(t\.raw \? 'fundhub_removed_at'\)/);
  });

  test("a failed merchant read is said, not a failed income read; a failed bank read is ok:false", async () => {
    const r = await loadIncome(fakeDb({ payoutError: Object.assign(new Error("no table"), { code: "42P01" }) }), { orgId: "o1", clientId: "c1", asOf: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.merchant_unavailable, true);
    const broken = { query: async () => { throw new Error("down"); } };
    const b = await loadIncome(broken, { orgId: "o1", clientId: "c1", asOf: NOW });
    assert.deepEqual([b.ok, b.reason], [false, "read_failed"]);
  });
});
