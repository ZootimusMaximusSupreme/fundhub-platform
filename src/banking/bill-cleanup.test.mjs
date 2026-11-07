// src/banking/bill-cleanup.mjs — a price that went up, and the same charge twice,
// on repeat bills only. PURE tests: `now` is pinned, no database, no network.
// Each flag has a twin that must stay quiet, so a rule that breaks in either
// direction fails here.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  findBillProblems, loadBillCleanup, FLAG_WINDOW_DAYS, PRICE_JUMP_MIN_CENTS, DOUBLE_CHARGE_DAYS
} from "./bill-cleanup.mjs";

const NOW = "2026-11-07";
const ACCOUNTS = [
  { id: "chk-p", account_type: "depository", entity_kind: "personal", name: "Personal Checking", mask: "1101" },
  { id: "card-b", account_type: "credit", entity_kind: "business", name: "Business Card", mask: "7788" }
];

let seq = 0;
const charge = (acct, day, cents, name) => ({
  bank_account_id: acct, provider_transaction_id: `p${++seq}`, amount_cents: -cents,
  posted_on: day, merchant_name: name, is_pending: false
});
const refund = (acct, day, cents, name) => ({ ...charge(acct, day, cents, name), amount_cents: cents });
/** One charge on `day` of each month in `months` ("2026-05"...). */
const monthly = (acct, months, day, cents, name) => months.map((m) => charge(acct, `${m}-${day}`, cents, name));
const M = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

const run = (rows) => findBillProblems(rows, { now: NOW, accounts: ACCOUNTS });

describe("price went up", () => {
  test("a steady price that rose by $5.00 is flagged with the old and new price", () => {
    const rows = [
      ...monthly("chk-p", M.slice(0, 4), "12", 5499, "ADOBE *CREATIVE CLD 4471"),
      ...monthly("chk-p", M.slice(4), "12", 5999, "ADOBE *CREATIVE CLD 8813")
    ];
    const r = run(rows);
    assert.equal(r.ok, true);
    assert.equal(r.flags.length, 1);
    const f = r.flags[0];
    assert.deepEqual([f.kind, f.name, f.from_cents, f.to_cents, f.change_cents, f.on], ["price_jump", "ADOBE CREATIVE CLD", 5499, 5999, 500, "2026-09-12"]);
    assert.deepEqual([f.account_name, f.account_mask, f.money_kind], ["Personal Checking", "1101", "personal"]);
    assert.deepEqual(f.charges.map((c) => c.amount_cents), [5499, 5499, 5999, 5999]);
  });

  test("a bill whose amount moves every month (a utility) is never flagged", () => {
    const amounts = [8120, 9433, 11250, 10480, 8810, 12990];
    const rows = M.map((m, i) => charge("chk-p", `${m}-20`, amounts[i], "CITY POWER AND LIGHT"));
    assert.deepEqual(run(rows).flags, []);
  });

  test("a price that went DOWN, or rose by less than $1.00, is not a cleanup item", () => {
    const down = [...monthly("chk-p", M.slice(0, 4), "05", 2000, "STREAMCO"), ...monthly("chk-p", M.slice(4), "05", 1500, "STREAMCO")];
    assert.deepEqual(run(down).flags, []);
    const cents = [...monthly("chk-p", M.slice(0, 4), "05", 2000, "STREAMCO"), ...monthly("chk-p", M.slice(4), "05", 2000 + PRICE_JUMP_MIN_CENTS - 1, "STREAMCO")];
    assert.deepEqual(run(cents).flags, []);
  });

  test("the old price must have held at least twice; a jump older than 90 days is history", () => {
    const shaky = [charge("chk-p", "2026-08-05", 1999, "GYMCO"), charge("chk-p", "2026-09-05", 2499, "GYMCO"),
      charge("chk-p", "2026-10-05", 2999, "GYMCO")];
    assert.deepEqual(run(shaky).flags, [], "no steady old price, so no 'went up from'");
    const old = [...monthly("chk-p", ["2026-02", "2026-03", "2026-04"], "05", 1000, "GYMCO"),
      ...monthly("chk-p", ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], "05", 1500, "GYMCO")];
    assert.ok(run(old).flags.every((f) => f.kind !== "price_jump"), `the May jump is older than ${FLAG_WINDOW_DAYS} days`);
  });
});

describe("charged twice", () => {
  test("the same amount twice on one day on a repeat bill is flagged", () => {
    const rows = [...monthly("card-b", M, "03", 1440, "GOOGLE *WORKSPACE"), charge("card-b", "2026-10-03", 1440, "GOOGLE *WORKSPACE")];
    const r = run(rows);
    assert.equal(r.flags.length, 1);
    const f = r.flags[0];
    assert.deepEqual([f.kind, f.name, f.amount_cents, f.on, f.kind], ["double_charge", "GOOGLE WORKSPACE", 1440, "2026-10-03", "double_charge"]);
    assert.deepEqual(f.charges, [{ on: "2026-10-03", amount_cents: 1440 }, { on: "2026-10-03", amount_cents: 1440 }]);
    assert.equal(f.account_name, "Business Card", "a bill on a card is still a bill");
    assert.equal(f.money_kind, "business", "whose money it is never overwrites what the flag is");
  });

  test(`two charges up to ${DOUBLE_CHARGE_DAYS} days apart count; a refund of the same amount clears it`, () => {
    const twice = [...monthly("chk-p", M, "15", 9900, "INSURECO"), charge("chk-p", "2026-10-17", 9900, "INSURECO")];
    assert.equal(run(twice).flags.filter((f) => f.kind === "double_charge").length, 1);
    const refunded = [...twice, refund("chk-p", "2026-10-21", 9900, "INSURECO")];
    assert.deepEqual(run(refunded).flags, [], "the merchant gave it back");
  });

  test("two DIFFERENT amounts, or two charges far apart, are not a double charge", () => {
    const addOn = [...monthly("chk-p", M, "15", 9900, "INSURECO"), charge("chk-p", "2026-10-15", 1200, "INSURECO")];
    assert.ok(run(addOn).flags.every((f) => f.kind !== "double_charge"));
    const far = [...monthly("chk-p", M, "15", 9900, "INSURECO"), charge("chk-p", "2026-10-22", 9900, "INSURECO")];
    assert.ok(run(far).flags.every((f) => f.kind !== "double_charge"));
  });

  test("two purchases at a shop that is not a repeat bill are never flagged", () => {
    const rows = [charge("chk-p", "2026-10-20", 650, "BLUE BOTTLE COFFEE"), charge("chk-p", "2026-10-20", 650, "BLUE BOTTLE COFFEE")];
    const r = run(rows);
    assert.deepEqual(r.flags, []);
    assert.equal(r.checked_bills, 0);
  });

  test("the same provider row sent twice is one charge, not a double charge; pending holds are ignored", () => {
    const rows = monthly("chk-p", M, "15", 9900, "INSURECO");
    const again = { ...rows[rows.length - 1] };
    const pending = { ...charge("chk-p", "2026-10-15", 9900, "INSURECO"), is_pending: true };
    assert.deepEqual(run([...rows, again, pending]).flags, []);
  });
});

describe("the rules every money read keeps", () => {
  test("a deposit is never read as a bill", () => {
    const rows = M.map((m) => refund("chk-p", `${m}-01`, 210000, "ACME PAYROLL"));
    const r = run(rows);
    assert.equal(r.checked_bills, 0);
    assert.deepEqual(r.flags, []);
  });

  test("now is required", () => {
    assert.throws(() => findBillProblems([], {}), /`now` is required/);
  });

  test("the read names the org and the client, writes nothing, and a failed read says so", async () => {
    const calls = [];
    const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
    const r = await loadBillCleanup(db, { orgId: "o1", clientId: "c1", asOf: new Date("2026-11-07T15:00:00Z") });
    assert.deepEqual([r.ok, r.flags.length, r.capped], [true, 0, false]);
    for (const c of calls) {
      assert.match(c.sql, /org_id = \$\d/);
      assert.match(c.sql, /client_id = \$\d/);
      assert.doesNotMatch(c.sql, /^\s*(INSERT|UPDATE|DELETE|WITH)\b/i);
    }
    assert.match(calls[1].sql, /NOT \(t\.raw \? 'fundhub_removed_at'\)/);
    const broken = await loadBillCleanup({ query: async () => { throw new Error("down"); } }, { orgId: "o1", clientId: "c1", asOf: NOW });
    assert.deepEqual([broken.ok, broken.reason], [false, "read_failed"]);
  });
});
