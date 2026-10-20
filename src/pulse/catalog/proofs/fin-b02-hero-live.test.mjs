// Finish-853 batch 02, generation 2: the sales floor hero's live check, run as the exact SQL text
// the lane runs.
//
// Row (desks-f.json, sales-floor.html): "Hero: 'Today' deposits, booked and held, 'Funded, not
// just sold' rate and target bar". This live check is attached beside the browser target-bar test.
//
// The hero counts call_outcomes rows with outcome 'deposit' twice: today's deposits and the month's
// funded rate (src/sales/metrics.mjs floorFunnelDay and depositToFunded). The check judges those
// rows. There is no Postgres on this Mac, so the text runs on an in-memory database whose tables
// carry the REAL column names (fin-b02-sql-kit.mjs reads db/schema and db/migrations).
//
// Each leg of the check has one test that isolates it: a result that is wrong in exactly that one
// way must be red. A leg taken out of the SQL turns its own test red.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeStandIn } from "./fin-b02-sql-kit.mjs";
import { FIN_B02_HERO_READY_CONTRACT } from "./fin-b02-display-contracts.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONTROL = FIN_B02_HERO_READY_CONTRACT.control;
const TABLES = ["call_outcomes", "clients", "transactions", "funding_rounds", "funding_closeout"];

function ago(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

// Repair cycle 1: the hero row is NOT attached (its target bar follows no target; see the manifest and
// fin-b02-hero-bar.test.mjs). This is the live SQL for its deposit legs, kept tested and ready: the day the
// bar is built the row takes this contract back with one line, and every leg below is already held.
const contract = FIN_B02_HERO_READY_CONTRACT;
assert.equal(contract.mode, "query");

function withStandIn(fn) {
  const s = makeStandIn(TABLES);
  try { return fn(s); } finally { s.close(); }
}

/**
 * One deposit call, good unless `c` says otherwise. Returns the ids so a test can add more.
 * Keys of `c`: cash, amount, status, txnClient, noTxn, funded, round, closeout, outcome, demo,
 * clientDemo, ageDays, suffix.
 */
function deposit(s, org, c = {}) {
  const n = c.suffix || "a";
  const client = `client-${n}-${org.slice(0, 4)}`;
  const txn = `txn-${n}-${org.slice(0, 4)}`;
  const outcome = `outcome-${n}-${org.slice(0, 4)}`;
  s.insert("clients", { id: client, org_id: org, funded: c.funded ?? false, is_demo: c.clientDemo ?? false });
  if (!c.noTxn) {
    s.insert("transactions", {
      id: txn, org_id: org, client_id: c.txnClient || client, product_name: "Deposit",
      amount_paid: c.amount ?? 1500, status: c.status || "succeeded",
    });
  }
  s.insert("call_outcomes", {
    id: outcome, org_id: org, client_id: client, staff_id: "staff-1", outcome: c.outcome || "deposit",
    cash_collected_cents: c.cash ?? 150000, transaction_id: c.noTxn ? null : txn,
    logged_at: ago(c.ageDays ?? 1), is_demo: c.demo ?? false,
  });
  if (c.round) {
    s.insert("funding_rounds", { id: `round-${n}-${org.slice(0, 4)}`, org_id: org, client_id: client, round_number: 1, status: c.round });
    if (c.closeout) {
      s.insert("funding_closeout", { id: `close-${n}-${org.slice(0, 4)}`, org_id: org, funding_round_id: `round-${n}-${org.slice(0, 4)}`, status: "open" });
    }
  }
  return { client, txn, outcome };
}

const run = (s, org = ORG) => s.run(contract.sql, org);

test("hero live check: read only, names the company, quiet when nobody paid a deposit yet", () => {
  assert.equal(contract.mode, "query");
  assert.equal(contract.emptyAs, "quiet");
  assert.match(contract.sql, /\$1::uuid/);
  assert.doesNotMatch(contract.sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
  withStandIn((s) => assert.deepEqual(run(s), { sample_count: 0, bad_count: 0 }));
  const verdict = judgeDisplayResult({ id: "x", control: CONTROL, surface: "s", contract }, { sample_count: 0, bad_count: 0 });
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /no saved results yet/);
});

test("hero live check: a paid deposit with its cash, and a funded client, passes", () => {
  withStandIn((s) => {
    deposit(s, ORG);
    deposit(s, ORG, { suffix: "b", funded: true, round: "funded" });
    // funded flag false, but a closeout exists: the rate counts it, so it is not wrong
    deposit(s, ORG, { suffix: "c", round: "funded", closeout: true });
    // a round that is not funded does not need a funded flag
    deposit(s, ORG, { suffix: "d", round: "submitted" });
    // a payment other wordings of paid use
    deposit(s, ORG, { suffix: "e", status: "paid" });
    deposit(s, ORG, { suffix: "f", status: "completed" });
    // flagged funded by a closed round, and flagged funded with only a closeout on a round: both are funded
    deposit(s, ORG, { suffix: "g", funded: true, round: "closed" });
    deposit(s, ORG, { suffix: "h", funded: true, round: "submitted", closeout: true });
    assert.deepEqual(run(s), { sample_count: 8, bad_count: 0 });
  });
});

const WRONG = [
  ["a deposit with no cash behind it", { cash: 0, amount: 0 }],
  ["a deposit paid with another client's payment", { txnClient: "someone-else" }],
  ["a deposit with no payment linked at all", { noTxn: true }],
  ["a deposit whose payment was refunded", { status: "refunded" }],
  ["a deposit whose payment failed", { status: "failed" }],
  ["a deposit whose cash is not what the payment was", { amount: 1000 }],
  ["a deposit whose client has a funded round but reads not funded and has no closeout", { round: "funded" }],
  // The other direction: the rate counts a client flagged funded as funded, so a flag with nothing under it
  // makes "Funded, not just sold" read better than it is.
  ["a deposit whose client is flagged funded with no round at all and no closeout", { funded: true }],
  ["a deposit whose client is flagged funded and whose only round never funded", { funded: true, round: "submitted" }],
];

for (const [label, change] of WRONG) {
  test(`hero live check: ${label} goes red`, () => {
    withStandIn((s) => {
      deposit(s, ORG, change);
      assert.deepEqual(run(s), { sample_count: 1, bad_count: 1 }, label);
    });
  });
}

test("hero live check: another client's funded round does not excuse a flag with nothing under it", () => {
  withStandIn((s) => {
    deposit(s, ORG, { suffix: "flag", funded: true });
    deposit(s, ORG, { suffix: "real", funded: true, round: "funded" });
    assert.deepEqual(run(s), { sample_count: 2, bad_count: 1 });
  });
});

test("hero live check: another client's closeout does not excuse this client's missing funded flag", () => {
  withStandIn((s) => {
    deposit(s, ORG, { suffix: "mine", round: "funded" });
    // a different client has a closeout on a round: it says nothing about the first client
    deposit(s, ORG, { suffix: "theirs", round: "submitted", closeout: true });
    assert.deepEqual(run(s), { sample_count: 2, bad_count: 1 });
  });
});

test("hero live check: a payment row of another company is never joined to this company's deposit", () => {
  withStandIn((s) => {
    const mine = deposit(s, ORG);
    s.insert("transactions", {
      id: mine.txn, org_id: OTHER, client_id: mine.client, product_name: "Deposit", amount_paid: 1500, status: "succeeded",
    });
    assert.deepEqual(run(s, ORG), { sample_count: 1, bad_count: 0 });
  });
});

test("hero live check: one payment used by two deposits turns both red", () => {
  withStandIn((s) => {
    const first = deposit(s, ORG);
    // a second deposit call for the same client that reuses the first deposit's payment
    s.insert("call_outcomes", {
      id: "outcome-second", org_id: ORG, client_id: first.client, staff_id: "staff-1", outcome: "deposit",
      cash_collected_cents: 150000, transaction_id: first.txn, logged_at: ago(1), is_demo: false,
    });
    assert.deepEqual(run(s), { sample_count: 2, bad_count: 2 });
  });
});

test("hero live check: the same payment under another company's deposit is not counted against this company", () => {
  withStandIn((s) => {
    const mine = deposit(s, ORG);
    // another company's deposit that points at MY payment id: must not make mine red
    s.insert("call_outcomes", {
      id: "outcome-other", org_id: OTHER, client_id: "client-other", staff_id: "staff-9", outcome: "deposit",
      cash_collected_cents: 150000, transaction_id: mine.txn, logged_at: ago(1), is_demo: false,
    });
    assert.deepEqual(run(s, ORG), { sample_count: 1, bad_count: 0 });
  });
});

test("hero live check: only deposits are judged, not downsells, and not demo or old results", () => {
  withStandIn((s) => {
    deposit(s, ORG, { suffix: "ok" });
    deposit(s, ORG, { suffix: "ds", outcome: "downsell", cash: 0, amount: 0 });
    deposit(s, ORG, { suffix: "demo", demo: true, cash: 0, amount: 0 });
    deposit(s, ORG, { suffix: "cdemo", clientDemo: true, cash: 0, amount: 0 });
    deposit(s, ORG, { suffix: "old", ageDays: 90, cash: 0, amount: 0 });
    assert.deepEqual(run(s), { sample_count: 1, bad_count: 0 });
  });
});

test("hero live check: another company's wrong deposit is not counted", () => {
  withStandIn((s) => {
    deposit(s, ORG);
    deposit(s, OTHER, { cash: 0, amount: 0 });
    assert.deepEqual(run(s, ORG), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(run(s, OTHER), { sample_count: 1, bad_count: 1 });
  });
});

test("hero live check: the lane reads one wrong deposit as red with the numbers said in words", () => {
  const red = judgeDisplayResult({ id: "x", control: CONTROL, surface: "s", contract }, { sample_count: 4, bad_count: 1 });
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /1 of 4 saved results failed/);
  const green = judgeDisplayResult({ id: "x", control: CONTROL, surface: "s", contract }, { sample_count: 4, bad_count: 0 });
  assert.equal(green.status, "PASS");
});
