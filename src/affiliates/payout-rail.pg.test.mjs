// THE AFFILIATE PAYOUT RAIL, against a real database (492).
//
// Scratch database only — CI's postgres jobs build it from zero with
// db/migrate.mjs. Plaid is never called: a fake transfer provider stands in for
// Plaid Transfer, and a fake link stands in for Plaid Link. What is under test
// is OUR side: the database rules, the status moves, and the tripwire.
//
// The cases that matter most are the ones about money that must NOT move or be
// called paid: test money on a real affiliate, paid with no reference, paid
// with no tax form, two sends at once, a Plaid transfer that failed.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  sendPayoutViaPlaid, syncPayoutTransfers, markPayoutPaid, holdPayout, releasePayout, voidPayout,
  recordTaxForm, completeAffiliateBankLink, payoutsView, PLAID_METHOD
} from "./payout-rail.mjs";
import { gapChecks } from "../pulse/coverage/gap-partners.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("affiliate payout rail (492)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  const MARK = "payrail";
  const STAFF = { id: "s1", name: "Finance Tester", email: "finance@example.com" };
  const PERIOD_START = new Date("2026-01-01T00:00:00Z");
  const PERIOD_END = new Date("2026-02-01T00:00:00Z");

  const mkAffiliate = async (n, { license = true, tax = true, demo = false } = {}) => (await db.query(
    `INSERT INTO affiliates (org_id, name, status, partner_license_signed_at, tax_form_received_at, is_demo)
     VALUES ($1,$2,'active',$3,$4,$5) RETURNING id`,
    [org, `${MARK} ${n}`, license ? new Date("2025-12-01T00:00:00Z") : null,
     tax ? new Date("2025-12-01T00:00:00Z") : null, demo])).rows[0].id;

  const mkClient = async (n) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email) VALUES ($1,'Rail',$2,$3) RETURNING id`,
    [org, n, `${MARK}.${n}@example.com`])).rows[0].id;

  const owe = async (affiliateId, n, amount, convertedAt = new Date("2026-01-15T12:00:00Z")) => (await db.query(
    `INSERT INTO affiliate_referrals
       (org_id, affiliate_id, client_id, tier, status, attributed_at, converted_at, commission_due, basis_amount)
     VALUES ($1,$2,$3,'direct','converted',$4,$5,$6,1000) RETURNING id`,
    [org, affiliateId, await mkClient(n), new Date("2026-01-02T00:00:00Z"), convertedAt, amount])).rows[0].id;

  /* A run built the way buildPayoutRun builds one: open, then lined. */
  const mkRun = async (affiliateId, referralIds, { status = "pending", holdReason = null, start = PERIOD_START, end = PERIOD_END } = {}) => {
    const id = (await db.query(
      `INSERT INTO affiliate_payouts (org_id, affiliate_id, period_start, period_end, status, hold_reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [org, affiliateId, start, end, status, holdReason])).rows[0].id;
    for (const r of referralIds) {
      const amt = (await db.query(`SELECT commission_due FROM affiliate_referrals WHERE id = $1`, [r])).rows[0].commission_due;
      await db.query(`INSERT INTO affiliate_payout_lines (org_id, payout_id, referral_id, kind, amount) VALUES ($1,$2,$3,'commission',$4)`,
        [org, id, r, amt]);
    }
    return id;
  };

  const payout = async (id) => (await db.query(`SELECT * FROM affiliate_payouts WHERE id = $1`, [id])).rows[0];

  const fakePlaid = (environment = "sandbox") => ({
    linkAccount: async () => ({ ok: true, item: { plaidItemId: `item-${Math.random().toString(36).slice(2)}`, encryptedAccessToken: "v1:not-a-real-token", environment, linkState: "active" } }),
    getAccounts: async () => ({ ok: true, accounts: [
      { plaidAccountId: "acc-card", name: "Card", mask: "9999", type: "credit", subtype: "credit card" },
      { plaidAccountId: "acc-chk", name: "Checking", mask: "4471", type: "depository", subtype: "checking" }
    ] })
  });

  /* Fake Plaid Transfer. `status` is what /transfer/get answers. */
  const fakeRail = ({ decision = "approved", status = "pending" } = {}) => {
    const calls = { authorize: 0, create: 0, keys: [] };
    return {
      calls,
      state: { status },
      async authorizeLeg(a) { calls.authorize += 1; calls.keys.push(a.idempotencyKey); calls.lastType = a.type; return { ok: true, authorizationId: `auth-${calls.authorize}`, decision }; },
      async createLeg() { calls.create += 1; return { ok: true, transferId: `tr-${Math.random().toString(36).slice(2)}`, status: "pending" }; },
      async getLeg(id) { return { ok: true, transfer: { id, status: this.state.status, failureReason: this.state.status === "returned" ? { achReturnCode: "R03", description: "No account" } : null } }; }
    };
  };

  async function purge() {
    const affs = (await db.query(`SELECT id FROM affiliates WHERE name LIKE $1`, [`${MARK}%`])).rows.map((r) => r.id);
    if (affs.length) {
      await db.query(`ALTER TABLE affiliate_payout_lines DISABLE TRIGGER trg_affiliate_payout_lines_guard`);
      await db.query(`ALTER TABLE affiliate_payouts DISABLE TRIGGER trg_affiliate_payouts_no_delete`);
      await db.query(`ALTER TABLE affiliate_referrals DISABLE TRIGGER trg_affiliate_referrals_no_delete`);
      try {
        await db.query(`DELETE FROM affiliate_payout_lines WHERE payout_id IN (SELECT id FROM affiliate_payouts WHERE affiliate_id = ANY($1))`, [affs]);
        await db.query(`DELETE FROM affiliate_payouts WHERE affiliate_id = ANY($1)`, [affs]);
        await db.query(`DELETE FROM affiliate_payout_accounts WHERE affiliate_id = ANY($1)`, [affs]);
        await db.query(`DELETE FROM affiliate_referrals WHERE affiliate_id = ANY($1)`, [affs]);
      } finally {
        await db.query(`ALTER TABLE affiliate_payout_lines ENABLE TRIGGER trg_affiliate_payout_lines_guard`);
        await db.query(`ALTER TABLE affiliate_payouts ENABLE TRIGGER trg_affiliate_payouts_no_delete`);
        await db.query(`ALTER TABLE affiliate_referrals ENABLE TRIGGER trg_affiliate_referrals_no_delete`);
      }
      await db.query(`DELETE FROM affiliates WHERE id = ANY($1)`, [affs]);
    }
    await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`${MARK}%`]);
  }

  before(async () => { org = await resolveDefaultOrg(db); await purge(); });
  beforeEach(purge);
  after(async () => { await purge(); await close(); });

  // ── the due day ───────────────────────────────────────────────────────────

  test("a new run gets its due day: the 15th of the month after the month earned", async () => {
    const a = await mkAffiliate("due");
    const id = await mkRun(a, [await owe(a, "d1", 100)]);
    const p = await payout(id);
    assert.equal(p.due_on.toISOString().slice(0, 10), "2026-02-15");
  });

  // ── paid by hand ─────────────────────────────────────────────────────────

  test("mark paid needs a method and a reference, then the run and its referrals are paid", async () => {
    const a = await mkAffiliate("manual");
    const r = await owe(a, "m1", 300);
    const id = await mkRun(a, [r]);

    const noRef = await markPayoutPaid(db, { orgId: org, payoutId: id, method: "ach", externalRef: "", staff: STAFF });
    assert.equal(noRef.ok, false);
    assert.equal(noRef.error, "reference_required");

    const done = await markPayoutPaid(db, { orgId: org, payoutId: id, method: "ach", externalRef: "TRACE-778812", staff: STAFF });
    assert.equal(done.ok, true, JSON.stringify(done));
    const p = await payout(id);
    assert.equal(p.status, "paid");
    assert.equal(p.method, "ach");
    assert.equal(p.external_ref, "TRACE-778812");
    assert.equal(p.approved_by, "Finance Tester");
    const ref = (await db.query(`SELECT status FROM affiliate_referrals WHERE id = $1`, [r])).rows[0];
    assert.equal(ref.status, "paid", "the paid run marks its referral paid (492)");
    const aff = (await db.query(`SELECT balance_due, payout_status FROM affiliates WHERE id = $1`, [a])).rows[0];
    assert.equal(Number(aff.balance_due), 0);
    assert.equal(aff.payout_status, "paid");
    const drift = (await db.query(`SELECT count(*)::int AS n FROM v_affiliate_state_drift WHERE id = $1`, [a])).rows[0].n;
    assert.equal(drift, 0, "the derived balance did not drift");
  });

  test("the DATABASE refuses paid with no reference, whatever the code does", async () => {
    const a = await mkAffiliate("rawpaid");
    const id = await mkRun(a, [await owe(a, "rp1", 200)]);
    await db.query(`UPDATE affiliate_payouts SET status = 'processing' WHERE id = $1`, [id]);
    await assert.rejects(
      () => db.query(`UPDATE affiliate_payouts SET status = 'paid' WHERE id = $1`, [id]),
      /paid needs a method and a reference/);
  });

  test("the DATABASE refuses processing with no tax form", async () => {
    const a = await mkAffiliate("notax", { tax: false });
    const id = await mkRun(a, [await owe(a, "nt1", 200)], { status: "held", holdReason: "tax_form_missing" });
    await assert.rejects(
      () => db.query(`UPDATE affiliate_payouts SET status = 'processing' WHERE id = $1`, [id]),
      /no tax form on file/);
  });

  // ── the paperwork gates ──────────────────────────────────────────────────

  test("recording the tax form releases runs held for it", async () => {
    const a = await mkAffiliate("taxrel", { tax: false });
    const id = await mkRun(a, [await owe(a, "tr1", 200)], { status: "held", holdReason: "tax_form_missing" });
    const early = await releasePayout(db, { orgId: org, payoutId: id, staff: STAFF });
    assert.equal(early.error, "tax_form_missing", "release is refused while the gate is shut");

    const r = await recordTaxForm(db, { orgId: org, affiliateId: a, ref: "doc:w9-123", staff: STAFF });
    assert.equal(r.ok, true);
    assert.equal(r.released, 1);
    assert.equal((await payout(id)).status, "pending");
  });

  // ── through Plaid ────────────────────────────────────────────────────────

  test("a Plaid sandbox send is refused for a REAL affiliate — test money never pays a person", async () => {
    const a = await mkAffiliate("realperson");
    const id = await mkRun(a, [await owe(a, "rpp", 150)]);
    await completeAffiliateBankLink(db, { orgId: org, affiliateId: a, publicToken: "public-sandbox-x", plaid: fakePlaid("sandbox") });
    const rail = fakeRail();
    const r = await sendPayoutViaPlaid(db, { orgId: org, payoutId: id, staff: STAFF, provider: rail, env: { PLAID_ENV: "sandbox" } });
    assert.equal(r.ok, false);
    assert.equal(r.error, "sandbox_test_affiliates_only");
    assert.equal(rail.calls.authorize, 0, "Plaid was never asked");
    assert.equal((await payout(id)).status, "pending");
  });

  test("the DATABASE refuses a sandbox Plaid transfer turning a real affiliate's run paid", async () => {
    const a = await mkAffiliate("realdb");
    const id = await mkRun(a, [await owe(a, "rdb", 150)]);
    await db.query(`UPDATE affiliate_payouts SET status = 'processing', method = $2, rail_environment = 'sandbox',
                           plaid_transfer_id = 'tr-x-${Date.now()}', plaid_transfer_status = 'settled' WHERE id = $1`, [id, PLAID_METHOD]);
    await assert.rejects(
      () => db.query(`UPDATE affiliate_payouts SET status = 'paid' WHERE id = $1`, [id]),
      /sandbox transfer is test money/);
  });

  test("a demo affiliate is paid end to end in the sandbox: link → send → settled → paid", async () => {
    const a = await mkAffiliate("demo", { demo: true });
    const r = await owe(a, "dm1", 175.25);
    const id = await mkRun(a, [r]);

    const link = await completeAffiliateBankLink(db, { orgId: org, affiliateId: a, publicToken: "public-sandbox-x", plaid: fakePlaid("sandbox") });
    assert.equal(link.ok, true, JSON.stringify(link));
    assert.equal(link.account.mask, "4471", "the checking account is picked, not the credit card");
    assert.equal(link.account.testData, true);

    const rail = fakeRail();
    const sent = await sendPayoutViaPlaid(db, { orgId: org, payoutId: id, staff: STAFF, provider: rail, env: { PLAID_ENV: "sandbox" } });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.equal(rail.calls.lastType, "credit", "a payout is a credit leg out of the Plaid Ledger");
    assert.equal(rail.calls.keys[0], `ap:${id}:1`);
    let p = await payout(id);
    assert.equal(p.status, "processing");
    assert.equal(p.payout_account_id, link.account.id);

    // A second Send while the first is in flight does nothing.
    const again = await sendPayoutViaPlaid(db, { orgId: org, payoutId: id, staff: STAFF, provider: rail, env: { PLAID_ENV: "sandbox" } });
    assert.equal(again.error, "payout_not_pending");
    assert.equal(rail.calls.create, 1);

    rail.state.status = "posted";
    await syncPayoutTransfers(db, { provider: rail });
    assert.equal((await payout(id)).status, "processing", "posted is not settled yet");

    rail.state.status = "settled";
    const s = await syncPayoutTransfers(db, { provider: rail });
    assert.ok(s.paid >= 1);
    p = await payout(id);
    assert.equal(p.status, "paid");
    assert.equal(p.external_ref, p.plaid_transfer_id, "the Plaid transfer id is the reference");
    assert.equal((await db.query(`SELECT status FROM affiliate_referrals WHERE id = $1`, [r])).rows[0].status, "paid");

    // A late return after settling is written on the frozen row.
    rail.state.status = "returned";
    await syncPayoutTransfers(db, { provider: rail });
    p = await payout(id);
    assert.equal(p.status, "paid");
    assert.equal(p.plaid_transfer_status, "returned");
    assert.match(p.rail_failure, /R03/);
  });

  test("a failed Plaid transfer goes back to pending, and the retry uses a new key", async () => {
    const a = await mkAffiliate("fail", { demo: true });
    const id = await mkRun(a, [await owe(a, "fl1", 90)]);
    await completeAffiliateBankLink(db, { orgId: org, affiliateId: a, publicToken: "p", plaid: fakePlaid("sandbox") });
    const rail = fakeRail();
    assert.equal((await sendPayoutViaPlaid(db, { orgId: org, payoutId: id, staff: STAFF, provider: rail, env: {} })).ok, true);
    rail.state.status = "failed";
    await syncPayoutTransfers(db, { provider: rail });
    const p = await payout(id);
    assert.equal(p.status, "pending");
    assert.match(p.rail_failure, /failed/);
    assert.equal(p.plaid_transfer_id, null);
    rail.state.status = "pending";
    assert.equal((await sendPayoutViaPlaid(db, { orgId: org, payoutId: id, staff: STAFF, provider: rail, env: {} })).ok, true);
    assert.deepEqual(rail.calls.keys, [`ap:${id}:1`, `ap:${id}:2`]);
  });

  test("Plaid declining the authorization leaves the run pending with the reason", async () => {
    const a = await mkAffiliate("declined", { demo: true });
    const id = await mkRun(a, [await owe(a, "dc1", 90)]);
    await completeAffiliateBankLink(db, { orgId: org, affiliateId: a, publicToken: "p", plaid: fakePlaid("sandbox") });
    const r = await sendPayoutViaPlaid(db, { orgId: org, payoutId: id, staff: STAFF, provider: fakeRail({ decision: "declined" }), env: {} });
    assert.equal(r.error, "plaid_declined");
    const p = await payout(id);
    assert.equal(p.status, "pending");
    assert.match(p.rail_failure, /declined/);
  });

  test("no bank linked is refused before Plaid is asked", async () => {
    const a = await mkAffiliate("nobank", { demo: true });
    const id = await mkRun(a, [await owe(a, "nb1", 90)]);
    const rail = fakeRail();
    const r = await sendPayoutViaPlaid(db, { orgId: org, payoutId: id, staff: STAFF, provider: rail, env: {} });
    assert.equal(r.error, "no_bank_linked");
    assert.equal(rail.calls.authorize, 0);
  });

  test("relinking replaces the old bank; there is only ever one active", async () => {
    const a = await mkAffiliate("relink");
    await completeAffiliateBankLink(db, { orgId: org, affiliateId: a, publicToken: "p1", plaid: fakePlaid("sandbox") });
    await completeAffiliateBankLink(db, { orgId: org, affiliateId: a, publicToken: "p2", plaid: fakePlaid("sandbox") });
    const rows = (await db.query(`SELECT status FROM affiliate_payout_accounts WHERE affiliate_id = $1 ORDER BY created_at`, [a])).rows;
    assert.deepEqual(rows.map((x) => x.status), ["replaced", "active"]);
  });

  // ── hold, void ───────────────────────────────────────────────────────────

  test("void detaches the lines so the commission is owed again", async () => {
    const a = await mkAffiliate("void");
    const r = await owe(a, "v1", 120);
    const id = await mkRun(a, [r]);
    assert.equal((await holdPayout(db, { orgId: org, payoutId: id, reason: "checking the amount", staff: STAFF })).ok, true);
    assert.equal((await voidPayout(db, { orgId: org, payoutId: id, reason: "wrong period", staff: STAFF })).ok, true);
    const lines = (await db.query(`SELECT count(*)::int AS n FROM affiliate_payout_lines WHERE referral_id = $1`, [r])).rows[0].n;
    assert.equal(lines, 0);
    assert.equal((await db.query(`SELECT status FROM affiliate_referrals WHERE id = $1`, [r])).rows[0].status, "converted");
  });

  // ── the staff view ───────────────────────────────────────────────────────

  test("the staff view never carries a Plaid token, and flags an overdue run", async () => {
    const a = await mkAffiliate("view");
    await mkRun(a, [await owe(a, "vw1", 80)]);
    await completeAffiliateBankLink(db, { orgId: org, affiliateId: a, publicToken: "p", plaid: fakePlaid("sandbox") });
    const v = await payoutsView(db, { orgId: org, now: new Date("2026-03-01T00:00:00Z"), env: {} });
    const mine = v.payouts.find((p) => p.affiliate.id === a);
    assert.ok(mine);
    assert.equal(mine.overdue, true);
    assert.equal(mine.bank.mask, "4471");
    assert.doesNotMatch(JSON.stringify(v), /not-a-real-token|encrypted_access_token/);
  });

  // ── the tripwire, on real rows ───────────────────────────────────────────

  test("tripwire: an earned commission past its due day and not paid turns the pulse red, and paying it turns it green", async () => {
    const now = new Date("2026-03-01T12:00:00Z");
    const a = await mkAffiliate("trip");
    const id = await mkRun(a, [await owe(a, "tp1", 260)]);

    let row = (await gapChecks({ db, orgId: org, now, routes: { "public/affiliate-click": true, "auth/login": true },
      startHtml: '<script>fetch("/api/public/affiliate-click")</script>', loginHandlesPartners: true }))
      .find((r) => r.id === "partners:payout-overdue");
    assert.equal(row.status, "FAIL", row.detail);
    assert.match(row.detail, /past its due day/);

    assert.equal((await markPayoutPaid(db, { orgId: org, payoutId: id, method: "check", externalRef: "CHK-1042", staff: STAFF })).ok, true);
    row = (await gapChecks({ db, orgId: org, now, routes: { "public/affiliate-click": true, "auth/login": true },
      startHtml: '<script>fetch("/api/public/affiliate-click")</script>', loginHandlesPartners: true }))
      .find((r) => r.id === "partners:payout-overdue");
    assert.doesNotMatch(row.detail, /\$260/, "the paid commission no longer counts as late");
  });

  test("tripwire: owed money with no payout record at all after the due day turns the pulse red", async () => {
    const now = new Date("2026-03-20T12:00:00Z");
    const a = await mkAffiliate("norun");
    await owe(a, "nr1", 333.33, new Date("2026-02-10T00:00:00Z"));
    const row = (await gapChecks({ db, orgId: org, now, routes: { "public/affiliate-click": true, "auth/login": true },
      startHtml: '<script>fetch("/api/public/affiliate-click")</script>', loginHandlesPartners: true }))
      .find((r) => r.id === "partners:payout-overdue");
    assert.equal(row.status, "FAIL", row.detail);
    assert.match(row.detail, /no payout record at all/);
  });
});
