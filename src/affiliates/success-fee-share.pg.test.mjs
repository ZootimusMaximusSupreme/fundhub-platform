// The affiliate's share of the 10% success fee, end to end. SKIPS without DATABASE_URL.
//
// WHAT THIS FILE EXISTS TO PROVE. Three things, none of which were true before
// 2026-08-31:
//
//   1. convert() is REACHED FROM A REAL PAYMENT EVENT. It has been exported and
//      correct since 033 and no production file ever called it, so an affiliate
//      could be attributed to a client for months and earn nothing
//      (docs/specs/W1-money-model.md finding F1). Nothing in this file calls
//      convert() by hand — everything goes through emit() on the bus, exactly the
//      way a Commas webhook arrives.
//
//   2. THE MONEY SPLITS THE WAY THE OWNER SET IT (docs/specs/W0-decisions.md).
//      On a $120,000 funded deal the 10% fee is $12,000, of which $3,000 was the
//      deposit and $9,000 is the invoiced balance:
//
//          fundhub half             $6,000   ← never moves
//          partner half             $6,000
//            tier 1 affiliate 20%  -$1,200
//            tier 2 affiliate  5%    -$300
//          partner net              $4,500
//
//      The affiliates are paid out of the PARTNER'S half, so fundhub's $6,000 is
//      identical whether the partner has no affiliates or five.
//
//   3. A RE-DELIVERED PAYMENT PAYS ONCE. Commas re-sends. The conversion is
//      guarded on status = 'attributed', so the second and third delivery report
//      "already_converted" and the commission does not move.
//
// COMPLIANCE REVIEW REQUIRED: fee/commission timing and the basis money is split on.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { emit, replay, _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { register as registerLifecycle } from "../handlers/client-lifecycle.mjs";
import { register as registerMoneyChain } from "../handlers/money-chain.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createInvoice, markSent } from "../invoices/index.mjs";
import { attribute, maybeUnlockTier2, basisFor } from "./economics.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = "affsuccessfee_pg";
const EMAIL = `${MARK}+receipt@example.invalid`;

/* The deal, in dollars, as numeric(14,2) hands them back. */
const FUNDED = 120000;   // what the lender funded
const DEPOSIT = 3000;    // paid up front, and credited against the 10%
const BALANCE = 9000;    // invoiced after funding: 10% of 120,000, less the deposit
const FEE_TOTAL = 12000; // DEPOSIT + BALANCE

describe("affiliate share of the success fee", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId, clientId, fundingProductId, tier1Id, tier2Id, successFeeInvoiceId;

  const one = async (sql, params) => (await db.query(sql, params)).rows[0];

  async function wipe() {
    const clients = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`]
    )).rows.map((r) => r.id);

    // Three tables in this path refuse DELETE on purpose — an attribution, an
    // accrual and an entitlement are all evidence. Lifting the guard for a
    // fixture reset is what the dead-letter, partner and affiliate suites
    // already do; it is put straight back in a finally.
    const withoutTrigger = async (table, trigger, fn) => {
      await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      try { await fn(); } finally {
        await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
    };

    if (clients.length) {
      // This disposable-PG fixture clears synthetic invoice/receipt rows
      // before parent sales; production no-delete guards remain unchanged.
      await withoutTrigger("invoice_payments", "trg_invoice_payments_no_delete", () =>
        db.query(`DELETE FROM invoice_payments
                    WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = ANY($1))`, [clients]));
      await withoutTrigger("invoices", "trg_invoices_no_delete", () =>
        db.query(`DELETE FROM invoices WHERE client_id = ANY($1)`, [clients]));
      await withoutTrigger("affiliate_referrals", "trg_affiliate_referrals_no_delete", () =>
        db.query(`DELETE FROM affiliate_referrals WHERE client_id = ANY($1)`, [clients]));
      await withoutTrigger("partner_revenue", "trg_partner_revenue_no_delete", () =>
        db.query(`DELETE FROM partner_revenue WHERE client_id = ANY($1)`, [clients]));
      await withoutTrigger("entitlements", "trg_entitlements_no_delete", () =>
        db.query(`DELETE FROM entitlements WHERE client_id = ANY($1)`, [clients]));
      await withoutTrigger("commission_ledger", "trg_commission_ledger_no_delete", () =>
        db.query(`DELETE FROM commission_ledger WHERE client_id = ANY($1)`, [clients]));
      await db.query(`DELETE FROM sale_payments WHERE sale_id IN
                       (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM sale_attributions WHERE sale_id IN
                       (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM funding_round_sales WHERE sale_id IN
                       (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM funding_rounds WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM sales WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM transactions WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM events WHERE client_id = ANY($1)
                        OR payload->>'email' LIKE $2`, [clients, `${MARK}%`]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
    }
    await db.query(`DELETE FROM events WHERE payload->>'email' LIKE $1`, [`${MARK}%`]);
    await db.query(`DELETE FROM affiliates WHERE name LIKE $1`, [`${MARK}-%`]);
    await db.query(`DELETE FROM partners WHERE slug = $1`, [MARK.replace(/_/g, "-")]);
  }

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    registerLifecycle();
    registerMoneyChain();

    org = await resolveDefaultOrg(db);
    await wipe();

    fundingProductId = (await one(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy'`, [org])).id;

    // A white-label partner on the standard half, signed and active.
    partnerId = (await one(
      `INSERT INTO partners (org_id, name, slug, status, revenue_share_pct, agreement_signed_at)
       VALUES ($1,$2,$3,'active',50,now()) RETURNING id`,
      [org, "Success Fee Partner", MARK.replace(/_/g, "-")])).id;

    // The client is created here rather than by the bus so it can carry
    // partner_id — that column is the whole tenancy model, and resolveClient()
    // matches on email, so the money chain finds this row instead of minting one.
    clientId = (await one(
      `INSERT INTO clients (org_id, email, first_name, last_name, partner_id)
       VALUES ($1,$2,'Success','Fee',$3) RETURNING id`,
      [org, EMAIL, partnerId])).id;

    // tier2Id recruited tier1Id, which is what unlocks the downline override.
    tier2Id = (await one(
      `INSERT INTO affiliates (org_id, name, status) VALUES ($1,$2,'active') RETURNING id`,
      [org, `${MARK}-recruiter`])).id;
    tier1Id = (await one(
      `INSERT INTO affiliates (org_id, name, status, recruited_by)
       VALUES ($1,$2,'active',$3) RETURNING id`,
      [org, `${MARK}-direct`, tier2Id])).id;
    const unlock = await maybeUnlockTier2(db, { orgId: org, affiliateId: tier2Id });
    assert.equal(unlock.unlocked, true, "the recruiter must hold tier 2 or no override pays");

    // Attribution is the one half of this that production already did, from
    // src/workflows/af-02-referral-ownership-capture.mjs.
    assert.equal((await attribute(db, {
      orgId: org, affiliateId: tier1Id, clientId, tier: "direct" })).attributed, true);
    assert.equal((await attribute(db, {
      orgId: org, affiliateId: tier2Id, clientId, tier: "downline" })).attributed, true);
  });

  after(async () => {
    await wipe();
    await close();
  });

  const referral = (tier) => one(
    `SELECT status, commission_due, basis_amount, rule_snapshot
       FROM affiliate_referrals WHERE client_id = $1 AND tier = $2`, [clientId, tier]);

  test("the deposit alone converts nothing — a deal that never funds is not an outcome", async () => {
    await emit(db, "deposit.paid", {
      email: EMAIL, name: "Success Fee", product: "deposit",
      productName: "Funding Deposit", amount: DEPOSIT,
      providerRef: `${MARK}_deposit`, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:deposit` });

    const sale = await one(
      `SELECT id FROM sales WHERE client_id = $1 AND product_id = $2`,
      [clientId, fundingProductId]);
    assert.ok(sale, "deposit.paid must have written the funding sale");

    const paid = await one(
      `SELECT kind, amount FROM sale_payments WHERE sale_id = $1`, [sale.id]);
    assert.equal(Number(paid.amount), DEPOSIT);

    // The partner's half of the deposit is already banked...
    const accrued = await one(
      `SELECT sum(gross_amount)::numeric AS gross, sum(share_amount)::numeric AS share
         FROM partner_revenue WHERE client_id = $1 AND status = 'accrued'`, [clientId]);
    assert.equal(Number(accrued.gross), DEPOSIT);
    assert.equal(Number(accrued.share), DEPOSIT / 2);

    // ...but the affiliate has earned nothing, because nothing has funded.
    const direct = await referral("direct");
    assert.equal(direct.status, "attributed", "a signed deal that never funded converted");
    assert.equal(direct.commission_due, null);
  });

  test("the success fee converts: tier 1 $1,200 and tier 2 $300 out of the partner's half", async () => {
    // The round funds. round.funded refuses to invent a round, and what it does
    // is not what is under test here, so the funded round is written directly —
    // the same shortcut src/affiliates/economics.pg.test.mjs takes.
    const sale = await one(
      `SELECT id FROM sales WHERE client_id = $1 AND product_id = $2`,
      [clientId, fundingProductId]);
    const round = await one(
      `INSERT INTO funding_rounds (org_id, client_id, round_number, funded_amount, status)
       VALUES ($1,$2,1,$3,'funded') RETURNING id`, [org, clientId, FUNDED]);
    await db.query(
      `INSERT INTO funding_round_sales (org_id, funding_round_id, sale_id, link_method)
       VALUES ($1,$2,$3,'explicit') ON CONFLICT (funding_round_id) DO NOTHING`,
      [org, round.id, sale.id]);

    // Issue a same-buyer success-fee invoice linked to the funded round
    // and original sale. A text-only "success_fee" label is not identity.
    const invoice = await createInvoice(db, {
      orgId: org, clientId, invoiceType: "success_fee",
      source: "funding_success_fee", amount: BALANCE,
      saleId: sale.id, fundingRoundId: round.id,
      idempotencyKey: `${MARK}:successfee-invoice`
    });
    assert.ok(invoice?.id, "a linked fee invoice must be persisted");
    const sent = await markSent(db, { invoiceId: invoice.id });
    assert.equal(sent?.status, "sent");
    successFeeInvoiceId = invoice.id;

    // The 10% balance arrives as cash. THIS is the event that converts, and
    // nothing in this file calls convert() — the bus does.
    await emit(db, "payment.received", {
      email: EMAIL, name: "Success Fee", product: "success_fee",
      productName: "Funding Success Fee", amount: BALANCE,
      providerRef: `${MARK}_successfee`, invoiceId: successFeeInvoiceId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:successfee` });

    const payments = (await db.query(
      `SELECT kind, amount FROM sale_payments WHERE sale_id = $1 ORDER BY kind`,
      [sale.id])).rows;
    assert.deepEqual(payments.map((p) => p.kind), ["deposit", "success_fee"]);
    assert.equal(
      payments.reduce((n, p) => n + Number(p.amount), 0), FEE_TOTAL,
      "the deposit counts toward the 10% — the fee collected is 12,000, not 15,000");

    // ── fundhub's half never moves ───────────────────────────────────────────
    const partner = await one(
      `SELECT sum(gross_amount)::numeric AS gross, sum(share_amount)::numeric AS share
         FROM partner_revenue WHERE client_id = $1 AND status = 'accrued'`, [clientId]);
    assert.equal(Number(partner.gross), FEE_TOTAL);
    assert.equal(Number(partner.share), 6000, "the partner's half");
    assert.equal(Number(partner.gross) - Number(partner.share), 6000,
      "FUNDHUB'S HALF MOVED — it must be exactly 6,000 whatever sits under the partner");

    // ── the affiliates come out of the partner's half ────────────────────────
    const direct = await referral("direct");
    assert.equal(direct.status, "converted");
    assert.equal(Number(direct.basis_amount), 6000,
      "the rate applies to the partner's half, not to the whole fee");
    assert.equal(Number(direct.commission_due), 1200);
    assert.equal(Number(direct.rule_snapshot.percent), 20);
    assert.equal(direct.rule_snapshot.amount_basis, "partner_share_of_cash");

    const downline = await referral("downline");
    assert.equal(downline.status, "converted");
    assert.equal(Number(downline.commission_due), 300);
    assert.equal(Number(downline.rule_snapshot.percent), 5);

    // ── and the whole waterfall reconciles ───────────────────────────────────
    const partnerNet = Number(partner.share)
      - Number(direct.commission_due) - Number(downline.commission_due);
    assert.equal(partnerNet, 4500);
    assert.equal(
      (Number(partner.gross) - Number(partner.share))   // fundhub
      + Number(direct.commission_due)
      + Number(downline.commission_due)
      + partnerNet,
      FEE_TOTAL,
      "the four shares must add back up to the fee the client actually paid");
  });

  test("a re-delivered payment pays once", async () => {
    const before = await referral("direct");

    // Commas re-sends, and the bus is replayed after an outage. Both.
    await emit(db, "payment.received", {
      email: EMAIL, name: "Success Fee", product: "success_fee",
      productName: "Funding Success Fee", amount: BALANCE,
      providerRef: `${MARK}_successfee`, invoiceId: successFeeInvoiceId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:successfee` });
    await replay(db, {});

    const after_ = await referral("direct");
    assert.equal(Number(after_.commission_due), Number(before.commission_due),
      "a replay doubled the affiliate's commission");
    assert.equal(Number(after_.commission_due), 1200);

    const rows = await one(
      `SELECT count(*)::int AS n FROM affiliate_referrals WHERE client_id = $1`, [clientId]);
    assert.equal(rows.n, 2, "one direct and one downline referral, still");

    const payRows = await one(
      `SELECT count(*)::int AS n FROM sale_payments sp
         JOIN sales s ON s.id = sp.sale_id WHERE s.client_id = $1`, [clientId]);
    assert.equal(payRows.n, 2, "the payment itself was written twice");

    const partner = await one(
      `SELECT sum(share_amount)::numeric AS share
         FROM partner_revenue WHERE client_id = $1 AND status = 'accrued'`, [clientId]);
    assert.equal(Number(partner.share), 6000, "the partner's half was accrued twice");
  });

  test("moving the partner to 20% does not restate what is already converted", async () => {
    const before = await referral("direct");
    await db.query(
      `UPDATE partners SET revenue_share_pct = 20 WHERE id = $1`, [partnerId]);
    try {
      const after_ = await referral("direct");
      assert.equal(Number(after_.commission_due), Number(before.commission_due),
        "a rate change reached back into a settled commission");
      assert.equal(Number(after_.basis_amount), 6000);

      // The basis itself does move — for anything converted from now on.
      const sale = await one(
        `SELECT id FROM sales WHERE client_id = $1 AND product_id = $2`,
        [clientId, fundingProductId]);
      assert.equal(
        await basisFor(db, { amountBasis: "partner_share_of_cash", saleId: sale.id }),
        2400, "20% of 12,000");
    } finally {
      await db.query(`UPDATE partners SET revenue_share_pct = 50 WHERE id = $1`, [partnerId]);
    }
  });

  test("a client naming a partner this org cannot see is UNKNOWN, not zero", async () => {
    const sale = await one(
      `SELECT id FROM sales WHERE client_id = $1 AND product_id = $2`,
      [clientId, fundingProductId]);
    // partners.org_id is what the basis joins on. Point the partner at another
    // org and the join drops it — which is exactly the shape of a partner that
    // was deleted, or that belongs to somebody else's tenancy.
    const otherOrg = await one(
      `INSERT INTO orgs (name, slug) VALUES ($1,$2) RETURNING id`,
      [`${MARK} other`, `${MARK.replace(/_/g, "-")}-other`]);
    await db.query(`UPDATE partners SET org_id = $2 WHERE id = $1`, [partnerId, otherOrg.id]);
    try {
      assert.equal(
        await basisFor(db, { amountBasis: "partner_share_of_cash", saleId: sale.id }),
        null,
        "an unreachable partner became a number — a zero commission would look settled");
    } finally {
      await db.query(`UPDATE partners SET org_id = $2 WHERE id = $1`, [partnerId, org]);
      await db.query(`DELETE FROM orgs WHERE id = $1`, [otherOrg.id]);
    }
  });
});
