// Whop plans: what the Payments section shows, the phone line per plan, one client's read,
// and the pure half of the daily read. The sync itself: whop-plans-sync.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  cadenceWords, whopPlanView, whopPhoneView, whopUpcoming, whopPlansBlock, listWhopPlans,
  rowFromMembership, checkoutClientOf
} from "./whop-plans.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const ROW_ID = "55555555-5555-4555-8555-555555555555";
const ACCOUNT = "biz_FundhubTest1";
const TODAY = "2026-11-07";

const row = (over = {}) => ({
  id: ROW_ID, product_title: "Consulting Services Package", status: "active", renewal_cents: 50000,
  renewal_currency: "usd", billing_period_days: 30, split_pay_required: null, split_pay_paid: null,
  collection_method: "charge_automatically", cancel_at_period_end: false, current_period_end: "2026-11-21T07:00:00.000Z",
  period_end_on: "2026-11-21", matched_by: "email", synced_at: "2026-11-07T07:01:00.000Z", unlinked_at: null, ...over
});

test("the read module never loads network code; only the daily sync talks to Whop", () => {
  const read = fs.readFileSync(new URL("./whop-plans.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(read, /messaging\/providers|outbound-fetch|\bfetch\s*\(/);
  const sync = fs.readFileSync(new URL("./whop-plans-sync.mjs", import.meta.url), "utf8");
  assert.match(sync, /from "\.\.\/messaging\/providers\/whop-memberships\.mjs"/);
  assert.doesNotMatch(sync, /\bfetch\s*\(/);
});

test("cadence words: Whop's own periods by name, anything else in days", () => {
  assert.equal(cadenceWords(30), "Monthly");
  assert.equal(cadenceWords(7), "Weekly");
  assert.equal(cadenceWords(14), "Every 2 weeks");
  assert.equal(cadenceWords(365), "Yearly");
  assert.equal(cadenceWords(45), "Every 45 days");
  assert.equal(cadenceWords(null), null);
  assert.equal(cadenceWords(0), null);
});

test("an active monthly plan: next charge, amount and how often, all from the row", () => {
  const v = whopPlanView(row(), TODAY);
  assert.equal(v.state, "upcoming");
  assert.deepEqual(v.next, { due_on: "2026-11-21", amount_cents: 50000, days_away: 14 });
  assert.equal(v.amount_cents, 50000);
  assert.deepEqual(v.cadence, { days: 30, words: "Monthly" });
  assert.equal(v.split, null);
  assert.equal(v.left_cents, null);
  assert.equal(v.provider, "whop");
  assert.equal(v.name, "Consulting Services Package");
  assert.equal(v.invoice, false);
  assert.equal(whopPlanView(row({ period_end_on: "2026-11-09" }), TODAY).state, "due_soon");
  assert.equal(whopPlanView(row({ status: "trialing" }), TODAY).state, "trial");
});

test("split pay: payments left x the next charge, an estimate; paid off shows 0", () => {
  const v = whopPlanView(row({ split_pay_required: 6, split_pay_paid: 2 }), TODAY);
  assert.deepEqual(v.split, { required: 6, paid: 2, left: 4 });
  assert.equal(v.left_cents, 200000);
  const done = whopPlanView(row({ split_pay_required: 6, split_pay_paid: 6, renewal_cents: null }), TODAY);
  assert.equal(done.state, "paid_off");
  assert.equal(done.left_cents, 0);
  assert.equal(done.next, null);
  // No price from Whop: left is unknown, never a made-up number.
  assert.equal(whopPlanView(row({ split_pay_required: 6, split_pay_paid: 2, renewal_cents: null }), TODAY), null);
  assert.equal(whopPlanView(row({ split_pay_required: 6, split_pay_paid: 2, renewal_cents: null, status: "past_due" }), TODAY).left_cents, null);
});

test("late, ending, checking; and nothing at all when there is no payment", () => {
  const late = whopPlanView(row({ status: "past_due" }), TODAY);
  assert.equal(late.state, "late");
  assert.equal(late.next, null);
  assert.equal(late.amount_cents, 50000);
  const ending = whopPlanView(row({ cancel_at_period_end: true }), TODAY);
  assert.equal(ending.state, "ending");
  assert.equal(ending.ends_on, "2026-11-21");
  assert.equal(ending.next, null);
  const stale = whopPlanView(row({ period_end_on: "2026-11-01" }), TODAY);
  assert.equal(stale.state, "checking");
  assert.equal(stale.next, null);
  assert.equal(whopPlanView(row({ status: "canceled" }), TODAY), null);
  assert.equal(whopPlanView(row({ status: "completed" }), TODAY), null);
  assert.equal(whopPlanView(row({ renewal_cents: null }), TODAY), null);
  assert.equal(whopPlanView(row({ unlinked_at: "2026-11-02T00:00:00Z" }), TODAY), null);
  assert.equal(whopPlanView(row({ renewal_cents: null, collection_method: "send_invoice", status: "past_due" }), TODAY).invoice, true);
});

const phone = (over = {}) => ({ enabled: true, opted_out: false, has_phone: true, days_before: 3, sent: [], ...over });

test("phone line: 3 days before, today when inside the window, sent, off, STOP and late", () => {
  const v = whopPlanView(row(), TODAY);
  assert.deepEqual(whopPhoneView(v, phone(), TODAY), { due_on: "2026-11-21", alert_on: "2026-11-18", reason: null, sent: null });
  const soon = whopPlanView(row({ period_end_on: "2026-11-09" }), TODAY);
  assert.equal(whopPhoneView(soon, phone(), TODAY).alert_on, TODAY);
  const sent = phone({ sent: [{ subject_id: ROW_ID, about_on: "2026-11-21", state: "sent" }, { subject_id: "other", about_on: "2026-11-21", state: "sent" }] });
  assert.equal(whopPhoneView(v, sent, TODAY).sent, "sent");
  assert.equal(whopPhoneView(v, phone({ sent: [{ subject_id: ROW_ID, about_on: "2026-10-21", state: "sent" }] }), TODAY).sent, null);
  assert.deepEqual(whopPhoneView(v, phone({ enabled: false }), TODAY), { due_on: "2026-11-21", alert_on: null, reason: "phone_alerts_off", sent: null });
  assert.deepEqual(whopPhoneView(v, phone({ opted_out: true }), TODAY), { due_on: "2026-11-21", alert_on: null, reason: "opted_out", sent: null });
  assert.equal(whopPhoneView(whopPlanView(row({ status: "past_due" }), TODAY), phone(), TODAY).reason, "late");
  assert.equal(whopPhoneView(whopPlanView(row({ cancel_at_period_end: true }), TODAY), phone(), TODAY), null);
  assert.equal(whopPhoneView(v, null, TODAY), null);
});

test("the payments block: plans with their phone line, the soonest charge, coming up, oldest read", () => {
  const rows = [
    row(),
    row({ id: "66666666-6666-4666-8666-666666666666", product_title: "Sample Plan B", period_end_on: "2026-11-10",
      synced_at: "2026-11-06T07:01:00.000Z", renewal_cents: 9900 }),
    row({ id: "77777777-7777-4777-8777-777777777777", status: "past_due" }),
    row({ id: "88888888-8888-4888-8888-888888888888", period_end_on: "2026-12-30" }),
    row({ id: "99999999-9999-4999-8999-999999999999", status: "canceled" })
  ];
  const b = whopPlansBlock(rows, phone(), TODAY);
  assert.equal(b.count, 4);
  assert.equal(b.late_count, 1);
  assert.deepEqual(b.next, { due_on: "2026-11-10", amount_cents: 9900, name: "Sample Plan B" });
  assert.deepEqual(b.upcoming.map((u) => [u.type, u.on, u.amount_cents]), [["whop", "2026-11-21", 50000], ["whop", "2026-11-10", 9900]]);
  assert.equal(b.synced_at, "2026-11-06T07:01:00.000Z");
  assert.equal(b.plans[0].phone.alert_on, "2026-11-18");
  assert.equal(whopPlansBlock(null, phone(), TODAY), null);
  assert.deepEqual(whopPlansBlock([], phone(), TODAY).plans, []);
  assert.deepEqual(whopUpcoming([whopPlanView(row({ period_end_on: "2026-12-07" }), TODAY)]), []);
});

test("one client's read is scoped to the org and the client, and refuses bad ids", async () => {
  const seen = [];
  const conn = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [row()] }; } };
  const rows = await listWhopPlans(conn, { orgId: ORG, clientId: CLIENT });
  assert.equal(rows.length, 1);
  assert.match(seen[0].sql, /WHERE org_id = \$1 AND client_id = \$2/);
  assert.match(seen[0].sql, /unlinked_at IS NULL/);
  assert.doesNotMatch(seen[0].sql, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.deepEqual(seen[0].params, [ORG, CLIENT]);
  assert.deepEqual(await listWhopPlans(conn, { orgId: ORG, clientId: "nope" }), []);
  assert.equal(seen.length, 1);
});

const membership = (over = {}) => ({
  id: "mem_Alpha1", status: "active", member_id: "mber_Alpha1", user_id: "user_Alpha1",
  product_id: "prod_Pkg1", product: { id: "prod_Pkg1", title: "Consulting Services Package", logo_url: null },
  variant_id: "plan_Monthly1", renewal_price: { amount: "500.00", currency: "usd", decimals: 2, display_decimals: 2 },
  initial_price: { amount: "500.00", currency: "usd", decimals: 2, display_decimals: 2 },
  billing_period_days: 30, split_pay_required_payments: null, split_pay_current_payments: null,
  collection_method: "charge_automatically", cancel_at_period_end: false,
  current_period_start: "2026-10-22T07:00:00Z", current_period_end: "2026-11-21T07:00:00Z",
  canceled_at: null, expires_at: null, metadata: {}, account: { id: ACCOUNT, title: "Fundhub" },
  created_at: "2026-09-22T07:00:00Z", updated_at: "2026-10-22T07:00:00Z", phone_number: "+15555550100", ...over
});

test("a Whop membership becomes exactly the stored facts: no email, name or phone", () => {
  const r = rowFromMembership(membership(), { accountId: ACCOUNT });
  assert.deepEqual(r, {
    whop_membership_id: "mem_Alpha1", whop_account_id: ACCOUNT, whop_product_id: "prod_Pkg1",
    whop_variant_id: "plan_Monthly1", product_title: "Consulting Services Package", status: "active",
    renewal_cents: 50000, renewal_currency: "usd", billing_period_days: 30, split_pay_required: null,
    split_pay_paid: null, collection_method: "charge_automatically", cancel_at_period_end: false,
    current_period_end: "2026-11-21T07:00:00.000Z", period_end_on: "2026-11-21", canceled_at: null,
    expires_at: null, whop_created_at: "2026-09-22T07:00:00.000Z", whop_updated_at: "2026-10-22T07:00:00.000Z"
  });
  assert.doesNotMatch(JSON.stringify(r), /5555550100|user_Alpha1|mber_Alpha1/);
  const eur = rowFromMembership(membership({ renewal_price: { amount: "500.00", currency: "eur", decimals: 2 } }), { accountId: ACCOUNT });
  assert.equal(eur.renewal_cents, null);
  assert.equal(eur.renewal_currency, "eur");
  const split = rowFromMembership(membership({ split_pay_required_payments: 3, split_pay_current_payments: 7 }), { accountId: ACCOUNT });
  assert.deepEqual([split.split_pay_required, split.split_pay_paid], [3, 3]);
  assert.equal(rowFromMembership(membership({ id: "sub_1" })), null);
  assert.equal(rowFromMembership(membership({ status: "paused" })), null);
});

test("checkout metadata names a client only with both Fundhub ids", () => {
  assert.deepEqual(checkoutClientOf(membership({ metadata: { fh_org_id: ORG, fh_client_id: CLIENT, fh_schema: "2" } })),
    { orgId: ORG, clientId: CLIENT });
  assert.equal(checkoutClientOf(membership({ metadata: { fh_client_id: CLIENT } })), null);
  assert.equal(checkoutClientOf(membership({ metadata: { fh_org_id: "x", fh_client_id: CLIENT } })), null);
  assert.equal(checkoutClientOf(membership({ metadata: null })), null);
});
