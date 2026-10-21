// Unit tests for the affiliate payout rail — no database, no Plaid.
// The database rules are proved in payout-rail.pg.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dueOnFor, attemptKey, railOutcome, pickPayoutAccount, sendPayoutViaPlaid, markPayoutPaid,
  shapePayoutRow, startAffiliateBankLink, MANUAL_METHODS, LINK_PRODUCTS
} from "./payout-rail.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const PAY = "00000000-0000-4000-8000-0000000000aa";
const AFF = "00000000-0000-4000-8000-0000000000bb";

test("due day: the 15th of the month after the month earned", () => {
  assert.equal(dueOnFor(new Date("2026-10-01T00:00:00Z")), "2026-10-15");
  assert.equal(dueOnFor("2027-01-01T00:00:00Z"), "2027-01-15");
  assert.equal(dueOnFor("not a date"), null);
});

test("each send attempt has its own Plaid idempotency key, at most 50 characters", () => {
  const k = attemptKey(PAY, 12);
  assert.equal(k, `ap:${PAY}:12`);
  assert.ok(k.length <= 50);
  assert.notEqual(attemptKey(PAY, 1), attemptKey(PAY, 2));
});

test("Plaid status → what it means for the run", () => {
  assert.equal(railOutcome("settled"), "paid");
  assert.equal(railOutcome("funds_available"), "paid");
  for (const s of ["failed", "cancelled", "returned"]) assert.equal(railOutcome(s), "failed");
  for (const s of ["pending", "posted", null, ""]) assert.equal(railOutcome(s), "in_flight");
});

test("only a checking or savings account can take a payout", () => {
  const card = { plaidAccountId: "c", type: "credit", subtype: "credit card" };
  const chk = { plaidAccountId: "k", type: "depository", subtype: "checking" };
  const sav = { plaidAccountId: "s", type: "depository", subtype: "savings" };
  assert.equal(pickPayoutAccount([card, chk]).account, chk);
  assert.equal(pickPayoutAccount([card]).error, "no_checking_or_savings");
  assert.equal(pickPayoutAccount([chk, sav]).error, "pick_one_account");
  assert.equal(pickPayoutAccount([chk, sav], "s").account, sav);
  assert.equal(pickPayoutAccount([chk, card], "c").error, "account_cannot_take_payouts");
  assert.equal(pickPayoutAccount([chk], "zzz").error, "account_not_in_link");
});

test("bank link asks Plaid for the transfer product and refuses when Plaid is not set up", async () => {
  assert.deepEqual([...LINK_PRODUCTS], ["transfer"]);
  const off = await startAffiliateBankLink({ affiliateId: AFF, env: {} });
  assert.equal(off.ok, false);
  assert.equal(off.status, 503);
});

/* A tiny stand-in for the database: answers the payout read, records writes. */
function stubDb(row, acct = null) {
  const writes = [];
  return {
    writes,
    async query(sql) {
      const s = String(sql);
      if (/FROM affiliate_payouts p\s+JOIN affiliates a/.test(s)) return { rows: row ? [row] : [] };
      if (/FROM affiliate_payout_accounts/.test(s)) return { rows: acct ? [acct] : [] };
      writes.push(s);
      return { rows: [], rowCount: 0 };
    }
  };
}
const base = {
  id: PAY, org_id: ORG, affiliate_id: AFF, status: "pending", amount: "125.00", is_demo: false,
  affiliate_name: "Real Person", partner_license_signed_at: new Date(), tax_form_received_at: new Date()
};
const neverRail = { authorizeLeg: () => { throw new Error("Plaid must not be called"); }, createLeg: () => { throw new Error("no"); } };

test("send: test money is refused for a real affiliate before anything is written", async () => {
  const db = stubDb(base);
  const r = await sendPayoutViaPlaid(db, { orgId: ORG, payoutId: PAY, provider: neverRail, env: { PLAID_ENV: "sandbox" } });
  assert.equal(r.error, "sandbox_test_affiliates_only");
  assert.equal(db.writes.length, 0);
});

test("send: paperwork gates and status are checked first", async () => {
  assert.equal((await sendPayoutViaPlaid(stubDb({ ...base, partner_license_signed_at: null }), { orgId: ORG, payoutId: PAY, provider: neverRail })).error, "partner_license_unsigned");
  assert.equal((await sendPayoutViaPlaid(stubDb({ ...base, tax_form_received_at: null }), { orgId: ORG, payoutId: PAY, provider: neverRail })).error, "tax_form_missing");
  assert.equal((await sendPayoutViaPlaid(stubDb({ ...base, status: "held" }), { orgId: ORG, payoutId: PAY, provider: neverRail })).error, "payout_not_pending");
  assert.equal((await sendPayoutViaPlaid(stubDb(null), { orgId: ORG, payoutId: PAY, provider: neverRail })).error, "payout_not_found");
  assert.equal((await sendPayoutViaPlaid(stubDb({ ...base, amount: "0" , is_demo: true }), { orgId: ORG, payoutId: PAY, provider: neverRail })).error, "nothing_to_pay");
});

test("send: switched off with no provider says so and points at Mark paid", async () => {
  const r = await sendPayoutViaPlaid(stubDb({ ...base, is_demo: true }), { orgId: ORG, payoutId: PAY, env: {} });
  assert.equal(r.ok, false);
  assert.match(r.message, /Mark paid/);
});

test("mark paid: method and reference are required, and a future date is refused", async () => {
  const db = stubDb(base);
  assert.equal((await markPayoutPaid(db, { orgId: ORG, payoutId: PAY, method: "venmo", externalRef: "x" })).error, "method_required");
  assert.equal((await markPayoutPaid(db, { orgId: ORG, payoutId: PAY, method: "ach", externalRef: "  " })).error, "reference_required");
  assert.equal((await markPayoutPaid(db, { orgId: ORG, payoutId: PAY, method: "ach", externalRef: "T1", paidAt: "2999-01-01" })).error, "paid_at_in_future");
  assert.equal(db.writes.length, 0);
  assert.deepEqual([...MANUAL_METHODS], ["ach", "wire", "check", "manual"]);
});

test("staff row: overdue only while open and past the due day", () => {
  const r = { ...base, due_on: "2026-10-15", license_ok: true, tax_ok: true, currency: "USD" };
  assert.equal(shapePayoutRow(r, "2026-10-16").overdue, true);
  assert.equal(shapePayoutRow(r, "2026-10-15").overdue, false);
  assert.equal(shapePayoutRow({ ...r, status: "paid" }, "2026-11-01").overdue, false);
});
