// Test bank v3 config. Pure; no network.
//
// The invariant every test below leans on is the one v2 broke: an account's
// balance today is its opening balance plus its own activity, so the history
// rebuilt backward from today (scripts/finance-os-backfill-trends.mjs) lands on
// the opening and never dips below zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMixedSandboxUser, planMixedSandboxUser, minimumPaymentCents, V3 } from "./plaid-sandbox-user.mjs";
import { detectRecurringBills } from "./recurring.mjs";

const TODAY = new Date("2026-10-06T15:00:00Z");
const { config: user, facts } = planMixedSandboxUser({ today: TODAY });
const all = user.override_accounts.flatMap((a) => a.transactions ?? []);
const account = (name) => user.override_accounts.find((a) => a.meta.name === name);
const fact = (name) => facts.accounts.find((a) => a.name === name);
const cents = (dollars) => Math.round(dollars * 100);

/* Repo sign (positive = the balance goes up): depository money in, card owed up. */
function repoCents(a, t) {
  return a.type === "credit" ? cents(t.amount) : -cents(t.amount);
}

/* Walk one account forward from (today's balance − its activity), by posted
   date — exactly what the backfill does backward. */
function walk(a) {
  const net = new Map();
  for (const t of a.transactions) net.set(t.date_posted, (net.get(t.date_posted) ?? 0) + repoCents(a, t));
  const total = [...net.values()].reduce((s, n) => s + n, 0);
  const opening = cents(a.starting_balance) - total;
  let bal = opening;
  let min = bal;
  const eod = new Map();
  for (const day of [...net.keys()].sort()) {
    bal += net.get(day);
    eod.set(day, bal);
    min = Math.min(min, bal);
  }
  return { opening, total, current: bal, min, eod };
}

/* The balance at the end of a day, by posted date. */
function balanceOn(a, day) {
  const w = walk(a);
  let bal = w.opening;
  for (const [d, b] of [...w.eod.entries()].sort()) if (d <= day) bal = b;
  return bal;
}

test("inside Plaid's custom-user limits (~250 transactions, ~55 KB)", () => {
  assert.ok(all.length > 40 && all.length < 250, `got ${all.length}`);
  assert.ok(JSON.stringify(user).length < 55_000);
});

test("buildMixedSandboxUser is the plan's config", () => {
  assert.deepEqual(buildMixedSandboxUser({ today: TODAY }), user);
});

test("nothing posts in the future, and every charge posts the next day", () => {
  for (const t of all) {
    assert.ok(t.date_posted <= "2026-10-05", `${t.description} posts ${t.date_posted}`);
    const gap = (Date.parse(t.date_posted) - Date.parse(t.date_transacted)) / 86_400_000;
    assert.equal(gap, 1, `${t.description} ${t.date_transacted}`);
  }
});

test("Plaid's sign: rent is positive (money out), payroll and Stripe are negative (money in)", () => {
  assert.ok(all.filter((t) => /Rent/.test(t.description)).every((t) => t.amount > 0));
  assert.ok(all.filter((t) => /Payroll|Stripe/.test(t.description)).every((t) => t.amount < 0));
  // A card payment brings the card down: negative on the card.
  for (const name of ["Personal Visa", "Business Amex"]) {
    const pays = account(name).transactions.filter((t) => t.description === "Payment Thank You");
    assert.ok(pays.length >= 3 && pays.every((t) => t.amount < 0), name);
  }
});

test("three months: three rents, six paychecks, weekly Stripe payouts", () => {
  assert.equal(all.filter((t) => t.description === "Oakwood Apartments Rent").length, 3);
  assert.ok(all.filter((t) => /Payroll/.test(t.description)).length >= 5);
  assert.ok(all.filter((t) => t.description === "Stripe payout").length >= 12);
});

test("both cards carry liability data and a statement/payment day", () => {
  const cards = user.override_accounts.filter((a) => a.type === "credit");
  assert.equal(cards.length, 2);
  for (const c of cards) {
    assert.equal(c.liability.type, "credit");
    assert.ok(c.liability.purchase_apr > 0);
    assert.ok(c.liability.minimum_payment_amount > 0);
    assert.ok(c.inflow_model.payment_day_of_month >= 1 && c.inflow_model.payment_day_of_month <= 28);
    assert.ok(c.inflow_model.statement_day_of_month >= 1);
  }
});

test("every account: today's balance = opening + its own activity, to the cent", () => {
  for (const a of user.override_accounts) {
    const w = walk(a);
    const f = fact(a.meta.name);
    assert.equal(w.opening, f.openingCents, `${a.meta.name} opening`);
    assert.equal(w.total, f.activityCents, `${a.meta.name} activity`);
    assert.equal(cents(a.starting_balance), f.openingCents + f.activityCents, `${a.meta.name} starting_balance`);
    assert.equal(w.current, f.currentCents, `${a.meta.name} today`);
  }
  // The openings are the people's picks (the Visa's moved by under $4 — see below).
  assert.equal(fact("Personal Checking").openingCents, V3.personalChecking.openingCents);
  assert.equal(fact("Business Checking").openingCents, V3.businessChecking.openingCents);
  assert.equal(fact("Business Amex").openingCents, V3.businessAmex.openingCents);
  assert.ok(Math.abs(fact("Personal Visa").openingCents - V3.personalVisa.openingCents) <= 400);
});

test("the rebuilt history never goes below zero, on any account, on any day", () => {
  for (const a of user.override_accounts) {
    const w = walk(a);
    assert.ok(w.opening > 0, `${a.meta.name} opening ${w.opening}`);
    assert.ok(w.min > 0, `${a.meta.name} dips to ${w.min}`);
    assert.equal(w.min, Math.min(fact(a.meta.name).minEodCents, w.opening));
  }
});

test("each card's statement, interest, minimum and last payment follow from its history", () => {
  for (const name of ["Personal Visa", "Business Amex"]) {
    const a = account(name);
    const f = fact(name);
    const spec = name === "Personal Visa" ? V3.personalVisa : V3.businessAmex;
    assert.equal(f.statements.length, 3, `${name} statements`);
    for (const s of f.statements) {
      // Plaid works a statement back from today: today − everything posted after it.
      assert.equal(s.balanceCents, balanceOn(a, s.date), `${name} statement ${s.date}`);
      assert.equal(Number(s.date.slice(8, 10)), spec.statementDay);
      // Interest posts ON the statement day: the purchase APR on the cycle's
      // average daily balance (days before the window carry the opening).
      const charge = a.transactions.find((t) => t.description === "Interest Charge on Purchases" && t.date_posted === s.date);
      assert.ok(charge, `${name} interest on ${s.date}`);
      assert.equal(cents(charge.amount), s.interestCents);
      const w = walk(a);
      const prev = new Date(Date.UTC(Number(s.date.slice(0, 4)), Number(s.date.slice(5, 7)) - 2, spec.statementDay));
      let sum = 0;
      for (let d = new Date(prev.getTime() + 86_400_000); d.toISOString().slice(0, 10) <= s.date; d = new Date(d.getTime() + 86_400_000)) {
        const day = d.toISOString().slice(0, 10);
        let bal = day < facts.windowStart ? w.opening : balanceOn(a, day);
        if (day === s.date) bal -= s.interestCents; // the balance before that day's interest
        sum += bal;
      }
      const want = Math.round((sum * spec.purchaseApr) / 100 / 365);
      assert.equal(s.interestCents, want, `${name} interest on ${s.date}`);
    }
    const last = f.statements.at(-1);
    assert.equal(f.lastStatement.date, last.date);
    assert.equal(cents(a.liability.minimum_payment_amount), minimumPaymentCents(last.balanceCents, last.interestCents));
    assert.equal(cents(a.liability.minimum_payment_amount), f.minimumPaymentCents);
    // The last payment Plaid reports is the last payment listed, on the payment day.
    const pays = a.transactions.filter((t) => t.description === "Payment Thank You");
    const lastPay = pays.at(-1);
    assert.equal(-cents(lastPay.amount), cents(a.liability.last_payment_amount));
    assert.equal(lastPay.date_transacted, f.lastPayment.date);
    assert.ok(pays.every((t) => Number(t.date_transacted.slice(8, 10)) === spec.paymentDay));
    // Paid every month, more than the minimum, less than the statement.
    for (const p of pays) {
      assert.ok(-cents(p.amount) > f.minimumPaymentCents && -cents(p.amount) < last.balanceCents);
    }
    // Inside the limit on every day.
    assert.ok(f.maxEodCents < f.limitCents);
  }
});

test("each card payment leaves the matching checking account the same day, same amount", () => {
  const pairs = [["Personal Visa", "Personal Checking", V3.personalVisa.paymentName],
    ["Business Amex", "Business Checking", V3.businessAmex.paymentName]];
  for (const [card, checking, debitName] of pairs) {
    const inCard = account(card).transactions.filter((t) => t.description === "Payment Thank You")
      .map((t) => `${t.date_transacted}|${t.date_posted}|${-cents(t.amount)}`).sort();
    const outChecking = account(checking).transactions.filter((t) => t.description === debitName)
      .map((t) => `${t.date_transacted}|${t.date_posted}|${cents(t.amount)}`).sort();
    assert.deepEqual(outChecking, inCard, `${card} ↔ ${checking}`);
  }
});

test("the payments change month to month (so they are never read as a fixed bill)", () => {
  for (const spec of [V3.personalVisa, V3.businessAmex]) {
    for (let i = 1; i < spec.payments.length; i += 1) assert.notEqual(spec.payments[i], spec.payments[i - 1]);
  }
});

test("the Personal Visa owes a whole dollar today (a credit report carries the same balance)", () => {
  assert.equal(fact("Personal Visa").currentCents % 100, 0);
  assert.equal(cents(account("Personal Visa").starting_balance) % 100, 0);
});

test("the real bill detector finds the bills and leaves card payments and interest out", () => {
  const rows = [];
  user.override_accounts.forEach((a, ai) => a.transactions.forEach((t, ti) => rows.push({
    provider_transaction_id: `${ai}-${ti}`,
    bank_account_id: a.meta.name,
    amount_cents: -cents(t.amount), // the ingest's flip (plaid-transactions.mjs)
    posted_on: t.date_posted,
    merchant_name: t.description,
    is_pending: false
  })));
  const result = detectRecurringBills(rows, { now: TODAY });
  const shown = result.bills.map((b) => `${b.bankAccountId}: ${b.merchantDisplay}`).sort();
  // Three charges inside this window each. (Regus on the 5th has only two here:
  // the window ends on the 5th, so whether it shows depends on the day.)
  for (const want of [
    "Personal Checking: Oakwood Apartments Rent",
    "Personal Checking: GEICO Auto Insurance",
    "Business Checking: HubSpot Software Subscription",
    "Personal Visa: Netflix",
    "Business Amex: Amazon Web Services",
    "Business Amex: Staples Office Supplies"
  ]) assert.ok(shown.includes(want), `missing bill ${want} in ${shown.join("; ")}`);
  // The payments are read, just never as a bill: they stay low-confidence candidates.
  const cands = result.candidates.map((b) => `${b.bankAccountId}: ${b.merchantDisplay}`);
  assert.ok(cands.includes(`Personal Checking: ${V3.personalVisa.paymentName}`), cands.join("; "));
  assert.ok(cands.includes(`Business Checking: ${V3.businessAmex.paymentName}`), cands.join("; "));
  for (const b of shown) {
    assert.ok(!/Payment|Interest/.test(b), `a card payment or interest was shown as a bill: ${b}`);
  }
});

test("the invariants hold on other days too", () => {
  for (const day of ["2026-10-07T03:00:00Z", "2026-11-15T12:00:00Z", "2027-02-28T23:00:00Z", "2027-06-10T08:00:00Z"]) {
    const plan = planMixedSandboxUser({ today: new Date(day) });
    const yesterday = new Date(Date.parse(day.slice(0, 10)) - 86_400_000).toISOString().slice(0, 10);
    for (const a of plan.config.override_accounts) {
      const w = walk(a);
      const f = plan.facts.accounts.find((x) => x.name === a.meta.name);
      assert.equal(w.opening, f.openingCents, `${day} ${a.meta.name}`);
      assert.ok(w.min > 0, `${day} ${a.meta.name} dips to ${w.min}`);
      assert.ok(a.transactions.every((t) => t.date_posted <= yesterday), `${day} ${a.meta.name} posts in the future`);
    }
    assert.equal(plan.facts.accounts.find((x) => x.name === "Personal Visa").currentCents % 100, 0, day);
  }
});
