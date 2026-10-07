// Test bank v3 — the Plaid SANDBOX custom user that scripts/plaid-sandbox-link.mjs
// links with `--preset mixed`, and that scripts/finance-os-sample-v3.mjs links
// to the FinanceOS test client. Pure: today in, config out. No network, no db.
//
// WHAT v3 FIXES (FinanceOS wave 5 final pass; the sample-data law,
// .claude/rules/sample-clients-consistent.md). v2 listed three months of
// charges and deposits but typed each account's balance in by hand, so the
// history rebuilt from those charges (scripts/finance-os-backfill-trends.mjs)
// sank to about -$17,929 personal and -$10,920 business. v3 picks an OPENING
// balance for the day the 90-day window starts and works today's balance out
// of it, for every account:
//
//     today's balance = opening balance + that account's own activity
//
// MEASURED, NOT ASSUMED (2026-10-07, a real sandbox Item made by a scratch
// probe — no database touched):
//   * `starting_balance` IS the balance /accounts/get returns on the day the
//     Item is made. The listed transactions are history only; they do not move
//     it. So starting_balance below = opening + activity, computed here.
//   * Plaid adds no transactions of its own to a custom user's history — the
//     inflow_model generated no payments. Every card payment is listed below.
//   * /liabilities/get works the last statement balance BACK from the current
//     balance: current minus everything POSTED after the statement day (a
//     charge made on the statement day that posts the next day is after it).
//     last_payment_date is the inflow_model's payment day and
//     next_payment_due_date is the next statement day. last_payment_amount and
//     minimum_payment_amount are the liability overrides, so both are worked
//     out below from the same history Plaid walks back.
//
// THE STORY (the same person as v2, now with the money moving between the
// accounts the way it does for a real person):
//   Personal Checking  payroll from Brightline Consulting on the 1st and 15th,
//                      Oakwood Apartments rent, GEICO, and the Personal Visa
//                      payment.
//   Business Checking  weekly Stripe payouts, HubSpot, Regus office rent, and
//                      the Business Amex payment.
//   Personal Visa      groceries, gas, Netflix; one payment a month from
//                      Personal Checking; interest on the statement day at the
//                      card's APR. Today's balance lands on a whole dollar so a
//                      credit report (bureaus report whole dollars) can carry
//                      the same balance exactly.
//   Business Amex      AWS, Staples, Uber, one flight; one payment a month from
//                      Business Checking; interest on the statement day.
//   Each card payment is listed twice — money out of the checking account and
//   money into the card, same day, same amount.
//
// THE PAYMENTS VARY ON PURPOSE. The person pays a different amount each month,
// more than the minimum and less than the statement. A fixed payment every
// month would be read by the repeating-bill detector (src/banking/recurring.mjs)
// as a monthly bill on the checking account — and the card's own due date
// already shows on the Overview, so it would count twice. The test pins that
// the detector leaves these payments out of the bills.
//
// PLAID'S SIGN: a POSITIVE amount is money OUT of the account (for a card: the
// balance owed goes UP); negative is money IN (a card payment brings it down).
// The ingest (src/banking/plaid-transactions.mjs) flips it to this repo's sign.
// Inside this file every amount is integer cents with "positive = the balance
// goes up" and is only turned into Plaid dollars at the end.
//
// Dates are the 90 days ending YESTERDAY. Every charge posts the next day and
// nothing posts in the future (Plaid treats a future date_posted as pending).
// One edge: a card payment due on yesterday itself posts the same day.
// Plaid caps a custom user near 250 transactions / 55 KB; this one is far under.
//
// Account names say personal/business so a person can tell them apart on the
// screen. entity_kind still stays 'unknown' until a human sets it (082).

const DAY_MS = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const utcDay = (y, m, dom) => new Date(Date.UTC(y, m, dom));

/** Half away from zero, the way src/commissions/money.mjs rounds. */
function roundHalfUp(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/* ------------------------------------------------------------------ *
 * The people's numbers. Openings are the balance at the start of the
 * window (90 days back). Everything else follows from the activity.
 * ------------------------------------------------------------------ */

export const V3 = Object.freeze({
  personalChecking: { name: "Personal Checking", mask: "1101", openingCents: 235_000 },
  businessChecking: { name: "Business Checking", mask: "2202", openingCents: 980_000 },
  personalVisa: {
    name: "Personal Visa", mask: "3303", limitCents: 800_000,
    /* About $2,840 owed 90 days ago; nudged by under $3 so today's balance is
       a whole dollar (see wholeDollarToday). */
    openingCents: 284_000, wholeDollarToday: true,
    purchaseApr: 24.99, cashApr: 29.99, balanceTransferApr: 19.99,
    statementDay: 25, paymentDay: 21,
    /* What the person pays each month, in order. Never the same twice running. */
    payments: [40_000, 47_500, 45_000],
    paymentName: "Personal Visa Payment"
  },
  businessAmex: {
    name: "Business Amex", mask: "4404", limitCents: 2_500_000,
    openingCents: 565_000, wholeDollarToday: false,
    purchaseApr: 18.24, cashApr: 27.24, balanceTransferApr: 18.24,
    statementDay: 15, paymentDay: 10,
    payments: [100_000, 125_000, 115_000],
    paymentName: "Business Amex Payment"
  }
});

/** The card minimum: the larger of $35 or 1% of the statement plus that
 *  statement's interest, rounded UP to a whole dollar. A common card formula;
 *  what matters here is that the minimum follows from the statement. */
export function minimumPaymentCents(statementCents, interestCents) {
  const raw = roundHalfUp(statementCents / 100) + interestCents;
  return Math.max(3_500, Math.ceil(raw / 100) * 100);
}

/* One listed transaction, in this file's sign (positive = balance goes up). */
const event = (transacted, posted, cents, description) => ({ transacted, posted, cents, description });

/* Posts the next day — except a payment on the window's last day, which posts
   that same day so nothing is in the future. */
const nextDay = (d, end) => (d.getTime() >= end.getTime() ? end : addDays(d, 1));

/**
 * End-of-day balances by POSTED date, from the day before `firstDay` (the
 * opening) through `end`. Returns { eod: Map(day -> cents), min, max }.
 */
function ledger(openingCents, events, firstDay, end) {
  const net = new Map();
  for (const e of events) net.set(iso(e.posted), (net.get(iso(e.posted)) ?? 0) + e.cents);
  const eod = new Map();
  let bal = openingCents;
  let min = bal;
  let max = bal;
  for (let d = firstDay; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    bal += net.get(iso(d)) ?? 0;
    eod.set(iso(d), bal);
    if (bal < min) min = bal;
    if (bal > max) max = bal;
  }
  return { eod, min, max, current: bal };
}

/**
 * One card, given its opening balance: interest on each statement day at the
 * purchase APR on the cycle's average daily balance (balances before the window
 * are the opening), then every statement balance.
 */
function simulateCard(spec, openingCents, fixedEvents, { start, end, statementDays }) {
  const net = new Map();
  for (const e of fixedEvents) net.set(iso(e.posted), (net.get(iso(e.posted)) ?? 0) + e.cents);
  const interest = [];
  const statements = [];
  if (statementDays.length === 0) {
    const l = ledger(openingCents, fixedEvents, start, end);
    return { events: [...fixedEvents], interest, statements, ...l };
  }
  const first = statementDays[0];
  const cycleStart = addDays(utcDay(first.getUTCFullYear(), first.getUTCMonth() - 1, spec.statementDay), 1);
  const isStatement = new Set(statementDays.map(iso));
  let bal = openingCents;
  let cycleSum = 0;
  for (let d = cycleStart; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    if (d.getTime() >= start.getTime()) bal += net.get(iso(d)) ?? 0;
    cycleSum += bal;
    if (isStatement.has(iso(d))) {
      const cents = roundHalfUp((cycleSum * spec.purchaseApr) / 100 / 365);
      interest.push(event(addDays(d, -1), d, cents, "Interest Charge on Purchases"));
      bal += cents;
      statements.push({ date: iso(d), balanceCents: bal, interestCents: cents });
      cycleSum = 0;
    }
  }
  const events = [...fixedEvents, ...interest];
  const l = ledger(openingCents, events, start, end);
  return { events, interest, statements, ...l };
}

/**
 * planMixedSandboxUser({ today }) → { config, facts }
 *
 * config — the user_custom JSON Plaid takes (override_accounts).
 * facts  — what this file worked out, per account, for tests and for the
 *          script's dry run: opening, activity, today's balance, the lowest and
 *          highest end-of-day balance, and for cards the statements, minimum
 *          and last payment. Never sent to Plaid.
 */
export function planMixedSandboxUser({ today = new Date() } = {}) {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - DAY_MS);
  const start = new Date(end.getTime() - 90 * DAY_MS);

  /* Charges happen up to the day before yesterday and post the next day, so
     every charge posts exactly one day later and none posts in the future.
     (Clamping the last post date instead made one rent post a day early and
     knocked a clean monthly bill down to an irregular one.) */
  const days = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) days.push(new Date(t));
  const withEnd = [...days, end];
  /** Every day in the window on this day of the month. */
  const monthly = (dom) => days.filter((d) => d.getUTCDate() === dom);
  /** Every day in the window on this weekday (0 = Sunday). */
  const weekly = (wd) => days.filter((d) => d.getUTCDay() === wd);
  /** A small repeatable wobble, in cents, so weekly amounts are not identical. */
  const wobble = (i, spreadCents) => Math.round(((((i * 37) % 11) - 5) / 5) * spreadCents);
  /** Posts the next day. */
  const charge = (d, cents, description) => event(d, addDays(d, 1), cents, description);

  /* ---- card payments: one per payment day, amounts in the person's order ---- */
  const paymentPlan = (spec) => withEnd
    .filter((d) => d.getUTCDate() === spec.paymentDay)
    .map((d, i) => ({ day: d, posted: nextDay(d, end), cents: spec.payments[i % spec.payments.length] }));
  const visaPays = paymentPlan(V3.personalVisa);
  const amexPays = paymentPlan(V3.businessAmex);
  const statementDaysOf = (spec) => withEnd.filter((d) => d.getUTCDate() === spec.statementDay && d.getTime() > start.getTime());

  /* ---- the four accounts' activity, this file's sign ---- */
  const personalChecking = [
    ...monthly(1).map((d) => charge(d, 340_000, "Payroll Direct Deposit Brightline Consulting")),
    ...monthly(15).map((d) => charge(d, 340_000, "Payroll Direct Deposit Brightline Consulting")),
    ...monthly(1).map((d) => charge(d, -250_000, "Oakwood Apartments Rent")),
    ...monthly(12).map((d) => charge(d, -18_000, "GEICO Auto Insurance")),
    ...visaPays.map((p) => event(p.day, p.posted, -p.cents, V3.personalVisa.paymentName))
  ];
  const businessChecking = [
    ...weekly(5).map((d, i) => charge(d, 165_000 + wobble(i, 12_000), "Stripe payout")),
    ...monthly(3).map((d) => charge(d, -30_000, "HubSpot Software Subscription")),
    ...monthly(5).map((d) => charge(d, -180_000, "Regus Office Rent")),
    ...amexPays.map((p) => event(p.day, p.posted, -p.cents, V3.businessAmex.paymentName))
  ];
  const visaFixed = [
    ...weekly(6).map((d, i) => charge(d, 8_500 + wobble(i, 2_000), "Whole Foods Market")),
    ...weekly(2).filter((_, i) => i % 2 === 0).map((d, i) => charge(d, 4_500 + wobble(i, 800), "Shell Gas Station")),
    ...monthly(9).map((d) => charge(d, 1_549, "Netflix")),
    ...visaPays.map((p) => event(p.day, p.posted, -p.cents, "Payment Thank You"))
  ];
  const amexFixed = [
    ...monthly(2).map((d) => charge(d, 42_000, "Amazon Web Services")),
    ...monthly(20).map((d) => charge(d, 12_000, "Staples Office Supplies")),
    ...weekly(3).filter((_, i) => i % 2 === 1).map((d, i) => charge(d, 3_500 + wobble(i, 1_000), "Uber Trip")),
    charge(addDays(end, -40), 64_000, "Delta Air Lines"),
    ...amexPays.map((p) => event(p.day, p.posted, -p.cents, "Payment Thank You"))
  ];

  /* ---- cards: interest, statements, and the whole-dollar landing ---- */
  const cardPlan = (spec, fixed, pays) => {
    const ctx = { start, end, statementDays: statementDaysOf(spec) };
    let sim = simulateCard(spec, spec.openingCents, fixed, ctx);
    let opening = spec.openingCents;
    if (spec.wholeDollarToday && sim.current % 100 !== 0) {
      let found = null;
      for (let k = 1; k <= 400 && !found; k += 1) {
        for (const delta of [k, -k]) {
          const s = simulateCard(spec, spec.openingCents + delta, fixed, ctx);
          if (s.current % 100 === 0) { found = { s, opening: spec.openingCents + delta }; break; }
        }
      }
      if (!found) throw new Error(`${spec.name}: no opening within $4 lands today's balance on a whole dollar`);
      sim = found.s;
      opening = found.opening;
    }
    const last = sim.statements[sim.statements.length - 1] ?? null;
    const lastPay = pays.length ? pays[pays.length - 1] : null;
    return {
      spec, opening, sim, last, lastPay,
      minimumCents: last ? minimumPaymentCents(last.balanceCents, last.interestCents) : null
    };
  };
  const visa = cardPlan(V3.personalVisa, visaFixed, visaPays);
  const amex = cardPlan(V3.businessAmex, amexFixed, amexPays);

  const pc = ledger(V3.personalChecking.openingCents, personalChecking, start, end);
  const bc = ledger(V3.businessChecking.openingCents, businessChecking, start, end);

  /* ---- Plaid's shape ---- */
  const byDate = (a, b) => (a.transacted < b.transacted ? -1 : a.transacted > b.transacted ? 1 : 0);
  const toPlaid = (events, depository) => [...events].sort(byDate).map((e) => ({
    date_transacted: iso(e.transacted),
    date_posted: iso(e.posted),
    /* Depository: money in is negative to Plaid. Card: owed going up is positive. */
    amount: (depository ? -e.cents : e.cents) / 100,
    description: e.description,
    currency: "USD"
  }));
  const cardAccount = (c) => ({
    type: "credit", subtype: "credit card", starting_balance: c.sim.current / 100,
    meta: { name: c.spec.name, mask: c.spec.mask, limit: c.spec.limitCents / 100 },
    transactions: toPlaid(c.sim.events, false),
    inflow_model: {
      type: "monthly-balance-payment",
      payment_day_of_month: c.spec.paymentDay,
      statement_day_of_month: c.spec.statementDay,
      transaction_name: c.spec.paymentName
    },
    liability: {
      type: "credit",
      purchase_apr: c.spec.purchaseApr,
      cash_apr: c.spec.cashApr,
      balance_transfer_apr: c.spec.balanceTransferApr,
      special_apr: 0,
      last_payment_amount: c.lastPay ? c.lastPay.cents / 100 : 0,
      minimum_payment_amount: c.minimumCents === null ? 0 : c.minimumCents / 100
    }
  });

  const config = {
    override_accounts: [
      { type: "depository", subtype: "checking", starting_balance: pc.current / 100,
        meta: { name: V3.personalChecking.name, mask: V3.personalChecking.mask },
        transactions: toPlaid(personalChecking, true) },
      { type: "depository", subtype: "checking", starting_balance: bc.current / 100,
        meta: { name: V3.businessChecking.name, mask: V3.businessChecking.mask },
        transactions: toPlaid(businessChecking, true) },
      cardAccount(visa),
      cardAccount(amex)
    ]
  };

  const activity = (events) => events.reduce((s, e) => s + e.cents, 0);
  const posted = (events) => events.map((e) => iso(e.posted)).sort();
  const depositoryFacts = (spec, events, l) => ({
    name: spec.name, mask: spec.mask, type: "depository",
    openingCents: spec.openingCents, activityCents: activity(events), currentCents: l.current,
    minEodCents: l.min, maxEodCents: l.max,
    firstPostedOn: posted(events)[0] ?? null, lastPostedOn: posted(events).at(-1) ?? null
  });
  const cardFacts = (c) => ({
    name: c.spec.name, mask: c.spec.mask, type: "credit",
    limitCents: c.spec.limitCents, purchaseApr: c.spec.purchaseApr,
    openingCents: c.opening, activityCents: activity(c.sim.events), currentCents: c.sim.current,
    minEodCents: c.sim.min, maxEodCents: c.sim.max,
    firstPostedOn: posted(c.sim.events)[0] ?? null, lastPostedOn: posted(c.sim.events).at(-1) ?? null,
    statementDay: c.spec.statementDay, paymentDay: c.spec.paymentDay,
    statements: c.sim.statements,
    lastStatement: c.last,
    minimumPaymentCents: c.minimumCents,
    lastPayment: c.lastPay ? { date: iso(c.lastPay.day), amountCents: c.lastPay.cents } : null,
    payments: (c.spec === V3.personalVisa ? visaPays : amexPays).map((p) => ({ date: iso(p.day), amountCents: p.cents }))
  });

  return {
    config,
    facts: {
      windowStart: iso(start),
      windowEnd: iso(end),
      accounts: [
        depositoryFacts(V3.personalChecking, personalChecking, pc),
        depositoryFacts(V3.businessChecking, businessChecking, bc),
        cardFacts(visa),
        cardFacts(amex)
      ]
    }
  };
}

/** The config only — what the link scripts send Plaid. */
export function buildMixedSandboxUser({ today = new Date() } = {}) {
  return planMixedSandboxUser({ today }).config;
}

export default { buildMixedSandboxUser, planMixedSandboxUser, minimumPaymentCents, V3 };
