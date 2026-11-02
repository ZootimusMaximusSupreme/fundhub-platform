// trip:funding: the SQL itself, on a real Postgres. Read only.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-trip-funding.pg.test.mjs
//
// The unit test hands the lane canned rows. That proves the words and the walk, and not the SQL,
// and the SQL decides who is on the trip, which round counts and what a closeout is. These
// scenarios run the real SELECT and the real verdict on made-up people. Every statement runs in
// BEGIN READ ONLY and is rolled back; every table is shadowed by the made-up rows of the scenario,
// with its columns pinned to the real table (trip-test-kit.mjs). Nothing real is read or written.

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { TRIP_SQL, judgeFunding, tripParams } from "./gap-trip-funding.mjs";
import { CARD_STACKING } from "./gap-money-funding.mjs";
import { HAS_DB, ORG, OTHER_ORG, closeShadowDb, emptyWorld, runWorld, uid } from "./trip-test-kit.mjs";

const NOW = new Date();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

const TABLES = [
  "clients", "payment_links", "events", "sales", "sale_payments", "products", "cards", "pipelines", "pipeline_stages",
  "bookings", "call_outcomes", "funding_rounds", "funding_closeout", "invoices", "funding_round_sales",
  "sale_attributions", "commission_ledger", "applications"
];

after(async () => {
  if (HAS_DB) await closeShadowDb();
});

function world() {
  const w = emptyWorld(TABLES);
  const ids = {
    salesBoard: uid("b1"), fundingBoard: uid("b2"),
    stages: {}, fundingProduct: uid("p1"), consultingProduct: uid("p2")
  };
  w.pipelines.rows.push(
    { id: ids.salesBoard, org_id: ORG, key: "sales" },
    { id: ids.fundingBoard, org_id: ORG, key: "funding_card_stacking" }
  );
  for (const k of ["new_lead", "diagnostic_paid", "closed_won", "lost"]) {
    ids.stages[`sales:${k}`] = uid("s1");
    w.pipeline_stages.rows.push({ id: ids.stages[`sales:${k}`], pipeline_id: ids.salesBoard, key: k });
  }
  for (const k of ["apply_now", "round_submitted", "approved", "funded", "closed"]) {
    ids.stages[`funding:${k}`] = uid("s2");
    w.pipeline_stages.rows.push({ id: ids.stages[`funding:${k}`], pipeline_id: ids.fundingBoard, key: k });
  }
  w.products.rows.push(
    { id: ids.fundingProduct, org_id: ORG, code: "card-stacking-dfy", category: "funding" },
    { id: ids.consultingProduct, org_id: ORG, code: "consulting-package", category: "consulting" }
  );
  return { w, ids };
}

function addClient(w, over = {}) {
  const id = uid("c1");
  w.clients.rows.push({
    id, org_id: ORG, client_code: `FH-${String(w.clients.rows.length + 1).padStart(6, "0")}`,
    email: `buyer${w.clients.rows.length}@gmail.com`, is_demo: false, custom_fields: {},
    created_at: ago(90 * DAY), updated_at: ago(DAY), ...over
  });
  return id;
}

function paidDiagnostic(w, clientId, at, over = {}) {
  w.payment_links.rows.push({
    org_id: ORG, client_id: clientId, purpose: "diagnostic", status: "paid", link_ref: "slo_x",
    paid_at: at, updated_at: at, identity_stored_at: null, is_demo: false, ...over
  });
}

function card(w, ids, clientId, board, stageKey, enteredAt) {
  w.cards.rows.push({
    org_id: ORG, client_id: clientId,
    pipeline_id: board === "sales" ? ids.salesBoard : ids.fundingBoard,
    stage_id: ids.stages[`${board === "sales" ? "sales" : "funding"}:${stageKey}`],
    entered_at: enteredAt, updated_at: enteredAt, is_demo: false, partner_id: null
  });
}

function fundingSale(w, ids, clientId, at, { paidDeposit = true } = {}) {
  const id = uid("sa");
  w.sales.rows.push({
    id, org_id: ORG, client_id: clientId, product_id: ids.fundingProduct, status: "active",
    sold_at: at, is_demo: false, agreed_success_fee_percent: 10
  });
  // A signed sale is not cash. Most scenarios intentionally model the deposit
  // as collected, so the source-level funding trip may begin. Preserve a
  // separate unpaid-sale case below that must NOT create a funding-card alert.
  if (paidDeposit) w.sale_payments.rows.push({
    id: uid("pay"), org_id: ORG, sale_id: id, kind: "deposit", amount: 300,
    paid_at: at, created_at: at, is_demo: false, product_id: ids.fundingProduct
  });
  return id;
}

function round(w, clientId, over = {}) {
  const id = uid("r1");
  w.funding_rounds.rows.push({
    id, org_id: ORG, client_id: clientId, round_number: 1, status: "started", product: CARD_STACKING,
    funded_amount: null, created_at: ago(DAY), updated_at: ago(DAY), is_demo: false, ...over
  });
  return id;
}

async function judge(w) {
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  return { rows: out.rows, verdict: judgeFunding({ rows: out.rows, now: NOW }) };
}

const skip = HAS_DB ? false : "DATABASE_URL is not set";

test("SQL: nobody started the trip is a nothing-to-judge", { skip }, async () => {
  const { w } = world();
  addClient(w);
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 0);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /^Nobody started the/);
});

test("SQL RED: paid the diagnostic 3 hours ago and the Sales card never moved", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  paidDiagnostic(w, c, ago(3 * HOUR));
  card(w, ids, c, "sales", "new_lead", ago(3 * DAY));
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 1);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "Sales card at Diagnostic Paid or later"/);
});

test("SQL GREEN: paid the diagnostic 3 hours ago and the Sales card moved to Diagnostic Paid", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  paidDiagnostic(w, c, ago(3 * HOUR));
  card(w, ids, c, "sales", "diagnostic_paid", ago(3 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 waiting \(1 at "booked a call"\)/);
});

test("SQL: an active but unpaid funding sale cannot start the Funding-card timer", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  fundingSale(w, ids, c, ago(3 * HOUR), { paidDeposit: false });
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 0, "a signed agreement without receipt starts no journey");
  assert.equal(verdict.status, "PASS");
});

test("SQL: a fully refunded deposit cannot start the Funding-card timer", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  const saleId = fundingSale(w, ids, c, ago(3 * HOUR));
  w.sale_payments.rows.push({
    id: uid("refund"), org_id: ORG, sale_id: saleId, kind: "refund", amount: 300,
    paid_at: ago(2 * HOUR), created_at: ago(2 * HOUR),
    is_demo: false, product_id: ids.fundingProduct
  });
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 0, "refunded cash does not create an owed handoff");
  assert.equal(verdict.status, "PASS");
});

test("SQL RED: the funding deposit was paid 3 hours ago and no Funding card was placed", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  fundingSale(w, ids, c, ago(3 * HOUR));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "Funding card at Apply Now"/);
});

test("SQL GREEN: a deposit in a product that is not funding does not start the funding trip", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  w.sales.rows.push({
    id: uid("sa"), org_id: ORG, client_id: c, product_id: ids.consultingProduct, status: "active",
    sold_at: ago(3 * HOUR), is_demo: false, agreed_success_fee_percent: null
  });
  const { rows } = await judge(w);
  assert.equal(rows.length, 0);
});

test("SQL RED: a card at Apply Now for an hour with no round", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  fundingSale(w, ids, c, ago(2 * DAY));
  card(w, ids, c, "funding", "apply_now", ago(HOUR + 5 * MIN));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "funding round opened"/);
});

test("SQL RED: funded two hours ago with no closeout, no bill and no commission", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  const saleId = fundingSale(w, ids, c, ago(10 * DAY));
  card(w, ids, c, "funding", "funded", ago(2 * HOUR));
  const r = round(w, c, { status: "funded", funded_amount: 25000, updated_at: ago(2 * HOUR), created_at: ago(9 * DAY) });
  w.funding_round_sales.rows.push({ org_id: ORG, funding_round_id: r, sale_id: saleId });
  w.sale_attributions.rows.push({ org_id: ORG, sale_id: saleId, basis: "back_end" });
  w.applications.rows.push({
    org_id: ORG, funding_round_id: r, status: "Approved", approved_amount: 25000,
    approval_excluded_at: null, status_updated_date: ago(DAY), updated_at: ago(DAY)
  });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "closeout record"/);
});

test("SQL GREEN: funded with the closeout, the bill and the commission rows", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  const saleId = fundingSale(w, ids, c, ago(10 * DAY));
  card(w, ids, c, "funding", "funded", ago(2 * HOUR));
  const r = round(w, c, { status: "funded", funded_amount: 25000, updated_at: ago(2 * HOUR), created_at: ago(9 * DAY) });
  w.funding_round_sales.rows.push({ org_id: ORG, funding_round_id: r, sale_id: saleId });
  w.sale_attributions.rows.push({ org_id: ORG, sale_id: saleId, basis: "back_end" });
  w.applications.rows.push({
    org_id: ORG, funding_round_id: r, status: "Approved", approved_amount: 25000,
    approval_excluded_at: null, status_updated_date: ago(DAY), updated_at: ago(DAY)
  });
  w.funding_closeout.rows.push({ funding_round_id: r, org_id: ORG });
  w.invoices.rows.push({ org_id: ORG, funding_round_id: r, source: "funding_success_fee", invoice_type: "success_fee", status: "sent" });
  w.commission_ledger.rows.push({ org_id: ORG, funding_round_id: r, basis: "back_end", reverses_ledger_id: null, status: "earned" });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 finished/);
});

test("SQL RED: a void bill does not count as a bill", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  const saleId = fundingSale(w, ids, c, ago(10 * DAY));
  card(w, ids, c, "funding", "funded", ago(2 * HOUR));
  const r = round(w, c, { status: "funded", funded_amount: 25000, updated_at: ago(2 * HOUR), created_at: ago(9 * DAY) });
  w.funding_round_sales.rows.push({ org_id: ORG, funding_round_id: r, sale_id: saleId });
  w.applications.rows.push({
    org_id: ORG, funding_round_id: r, status: "Approved", approved_amount: 25000,
    approval_excluded_at: null, status_updated_date: ago(DAY), updated_at: ago(DAY)
  });
  w.funding_closeout.rows.push({ funding_round_id: r, org_id: ORG });
  w.invoices.rows.push({ org_id: ORG, funding_round_id: r, source: "funding_success_fee", invoice_type: "success_fee", status: "void" });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /stopped at "success-fee bill"/);
});

test("SQL RED: the card says Funded and no round is funded", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  fundingSale(w, ids, c, ago(10 * DAY));
  card(w, ids, c, "funding", "funded", ago(3 * HOUR));
  round(w, c, { status: "started", created_at: ago(9 * DAY) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /the board shows "round funded"/);
});

test("SQL RED: funded with no bank yes that carries an amount", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  fundingSale(w, ids, c, ago(10 * DAY));
  card(w, ids, c, "funding", "funded", ago(3 * HOUR));
  round(w, c, { status: "funded", funded_amount: 25000, updated_at: ago(3 * HOUR), created_at: ago(9 * DAY) });
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "FAIL");
  assert.match(verdict.detail, /never happened/);
});

test("SQL: the newest round is the round the trip follows", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  fundingSale(w, ids, c, ago(20 * DAY));
  card(w, ids, c, "funding", "apply_now", ago(DAY));
  // round 1 funded with nothing behind it would be red, but round 2 is the open one
  round(w, c, { round_number: 1, status: "funded", funded_amount: 100, updated_at: ago(15 * DAY), created_at: ago(18 * DAY) });
  round(w, c, { round_number: 2, status: "started", created_at: ago(DAY), updated_at: ago(DAY) });
  const { rows, verdict } = await judge(w);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].round_number, 2);
  assert.equal(verdict.status, "PASS");
});

test("SQL: demo clients, test addresses, archived clients and other companies are left out", { skip }, async () => {
  const { w, ids } = world();
  const bad = [
    addClient(w, { is_demo: true }),
    addClient(w, { email: "walk@example.com" }),
    addClient(w, { email: "test+one@fundhub.ai" }),
    addClient(w, { custom_fields: { synthetic: "true" } }),
    addClient(w, { custom_fields: { crm_archived_at: ago(DAY) } })
  ];
  for (const c of bad) paidDiagnostic(w, c, ago(5 * HOUR));
  const other = uid("c9");
  w.clients.rows.push({
    id: other, org_id: OTHER_ORG, client_code: "OTHER", email: "x@gmail.com", is_demo: false,
    custom_fields: {}, created_at: ago(90 * DAY), updated_at: ago(DAY)
  });
  w.payment_links.rows.push({
    org_id: OTHER_ORG, client_id: other, purpose: "diagnostic", status: "paid", link_ref: "slo_x",
    paid_at: ago(5 * HOUR), updated_at: ago(5 * HOUR), identity_stored_at: null, is_demo: false
  });
  const { rows } = await judge(w);
  assert.equal(rows.length, 0);
});

test("SQL: a trip that started before the window is not followed", { skip }, async () => {
  const { w } = world();
  const c = addClient(w);
  paidDiagnostic(w, c, ago(61 * DAY));
  const { rows } = await judge(w);
  assert.equal(rows.length, 0);
});

test("SQL: a lost customer is an ended trip, not red", { skip }, async () => {
  const { w, ids } = world();
  const c = addClient(w);
  paidDiagnostic(w, c, ago(10 * DAY));
  card(w, ids, c, "sales", "lost", ago(5 * DAY));
  const { verdict } = await judge(w);
  assert.equal(verdict.status, "PASS");
  assert.match(verdict.detail, /1 ended/);
});

test("SQL: a held call is the call outcome, and a no show is not a held call", { skip }, async () => {
  const { w, ids } = world();
  const a = addClient(w);
  const b = addClient(w);
  for (const c of [a, b]) {
    paidDiagnostic(w, c, ago(5 * DAY));
    card(w, ids, c, "sales", "diagnostic_paid", ago(5 * DAY));
  }
  w.call_outcomes.rows.push({ org_id: ORG, client_id: a, outcome: "callback", logged_at: ago(2 * DAY), is_demo: false });
  w.call_outcomes.rows.push({ org_id: ORG, client_id: b, outcome: "no_show", logged_at: ago(2 * DAY), is_demo: false });
  const out = await runWorld(TRIP_SQL, w, tripParams(ORG, NOW));
  const byId = Object.fromEntries(out.rows.map((r) => [r.client_id, r]));
  assert.ok(byId[a].call_held_at, "a callback is a held call");
  assert.equal(byId[b].call_held_at, null, "a no show is not");
});
