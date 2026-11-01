// The partner accrual writer, against real Postgres.
//
// The unit tests in revenue.test.mjs prove the arithmetic. These prove the four
// things only a real database can: that the two partial unique indexes actually
// stop a replay, that a frozen rate really does survive a rate change, that a
// void is a void and not a delete, and that the CHECK constraints on
// partner_revenue accept every row this writer produces.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs file.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  accrueForPayment, accrueRecruitBonus, voidForRefund, ENTRY_FEE_CENTS
} from "./revenue.mjs";
import { ensureSalePayment } from "../handlers/money-chain.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "revenue-test-partner";
const SLUG_OTHER = "revenue-test-other";
const REF = "revenue-test";

describe("partner revenue accrual", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId, otherPartnerId, partnerClient, directClient;
  const products = {};

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    for (const code of ["card-stacking-dfy", "repair-bundle", "funding-mastery"]) {
      const row = (await db.query(
        `SELECT id FROM products WHERE org_id = $1 AND code = $2 LIMIT 1`, [org, code]
      )).rows[0];
      assert.ok(row, `fixture needs the seeded product ${code}`);
      products[code] = row.id;
    }
    await cleanup();

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at, revenue_share_pct)
       VALUES ($1,'Revenue Test Partner',$2,'active',now(),50) RETURNING id`,
      [org, SLUG])).rows[0].id;
    otherPartnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, revenue_share_pct)
       VALUES ($1,'Revenue Test Other',$2,'active',50) RETURNING id`,
      [org, SLUG_OTHER])).rows[0].id;

    partnerClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, partner_id)
       VALUES ($1,'Revenue','Partnered',$2) RETURNING id`, [org, partnerId])).rows[0].id;
    directClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name)
       VALUES ($1,'Revenue','Direct') RETURNING id`, [org])).rows[0].id;
  });

  async function cleanup() {
    await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(
      `DELETE FROM partner_revenue WHERE partner_id IN
         (SELECT id FROM partners WHERE slug = ANY($1))`, [[SLUG, SLUG_OTHER]]);
    await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(
      `DELETE FROM sale_payments WHERE org_id = $1 AND notes LIKE $2`, [org, `${REF}%`]);
    await db.query(
      `DELETE FROM sales WHERE org_id = $1 AND external_ref LIKE $2`, [org, `${REF}%`]);
    await db.query(
      `DELETE FROM transactions WHERE org_id = $1 AND provider_ref LIKE $2`, [org, `${REF}%`]);
    await db.query(
      `DELETE FROM events WHERE org_id = $1 AND idempotency_key LIKE $2`, [org, `${REF}%`]);
    await db.query(
      `DELETE FROM clients WHERE org_id = $1 AND first_name = 'Revenue'`, [org]);
    await db.query(`DELETE FROM partners WHERE slug = ANY($1)`, [[SLUG, SLUG_OTHER]]);
  }

  // Each test writes its own sale and payment, so only the accruals need clearing.
  beforeEach(async () => {
    await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(`DELETE FROM partner_revenue WHERE partner_id = ANY($1)`,
      [[partnerId, otherPartnerId]]);
    await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(`UPDATE partners SET revenue_share_pct = 50 WHERE id = ANY($1)`,
      [[partnerId, otherPartnerId]]);
  });

  after(async () => { await cleanup(); await close(); });

  let seq = 0;
  /** One client + product + agreed price + a settled payment, wired the way the
   *  money chain wires them: a transactions row and an events row behind it. */
  async function seedPayment({
    clientId, code = "card-stacking-dfy", agreedPrice = "3000.00",
    amount = "3000.00", kind = "deposit", withEvent = true, withTransaction = true
  } = {}) {
    const tag = `${REF}-${++seq}`;
    const productId = products[code];

    let transactionId = null;
    if (withTransaction) {
      transactionId = (await db.query(
        `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status,
                                   provider, provider_ref, raw_payload)
         VALUES ($1,$2,$3,$4,'paid','test',$5,'{}'::jsonb) RETURNING id`,
        [org, clientId, code, amount, tag])).rows[0].id;
    }
    let eventId = null;
    if (withEvent) {
      eventId = (await db.query(
        `INSERT INTO events (org_id, name, client_id, payload, idempotency_key)
         VALUES ($1,'payment.received',$2,'{}'::jsonb,$3) RETURNING id`,
        [org, clientId, tag])).rows[0].id;
    }

    const saleId = (await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, external_ref)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [org, clientId, productId, agreedPrice, tag])).rows[0].id;

    const paymentId = (await db.query(
      `INSERT INTO sale_payments (org_id, sale_id, transaction_id, product_id, kind,
                                  amount, notes, source_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [org, saleId, transactionId, productId, kind, amount, tag, eventId])).rows[0].id;

    return { saleId, paymentId, transactionId, eventId, tag };
  }

  const accruals = (partner = null) => db.query(
    `SELECT * FROM partner_revenue WHERE partner_id = $1 ORDER BY created_at, id`,
    [partner || partnerId]
  ).then((r) => r.rows);

  // ══════════ the happy path ══════════

  test("one settled payment writes one accrual with the rate frozen on it", async () => {
    const { paymentId, saleId, transactionId, eventId } = await seedPayment({ clientId: partnerClient });
    const out = await accrueForPayment(db, { orgId: org, saleId, salePaymentId: paymentId });

    assert.equal(out.accrued, true);
    const rows = await accruals();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].gross_amount, "3000.00");
    assert.equal(rows[0].share_amount, "1500.00");
    assert.equal(Number(rows[0].share_pct_applied), 50);
    assert.equal(rows[0].status, "accrued");
    assert.equal(rows[0].client_id, partnerClient);
    // Both idempotency columns set, so both partial unique indexes are armed.
    assert.equal(rows[0].transaction_id, transactionId);
    assert.equal(rows[0].source_event_id, eventId);
  });

  test("the balance view picks the accrual up without a new aggregate", async () => {
    const { paymentId } = await seedPayment({ clientId: partnerClient });
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    const bal = (await db.query(
      `SELECT balance_accrued, open_accruals FROM v_partner_balance WHERE partner_id = $1`,
      [partnerId])).rows[0];
    assert.equal(bal.balance_accrued, "1500.00");
    assert.equal(Number(bal.open_accruals), 1);
  });

  // ══════════ replay ══════════

  test("the same payment driven three times leaves one row", async () => {
    const { paymentId } = await seedPayment({ clientId: partnerClient });
    const first = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    const second = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    const third = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });

    assert.equal(first.accrued, true);
    assert.equal(second.reason, "already_accrued");
    assert.equal(third.reason, "already_accrued");
    assert.equal((await accruals()).length, 1);
  });

  test("a backfill that only knows the transaction still lands on the same row", async () => {
    // The event index cannot help here — this proves partner_revenue_tx_uniq is
    // the one doing the work.
    const { paymentId, transactionId } = await seedPayment({ clientId: partnerClient });
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    const again = await accrueForPayment(db, {
      orgId: org, salePaymentId: paymentId, transactionId, sourceEventId: null
    });
    assert.equal(again.reason, "already_accrued");
    assert.equal((await accruals()).length, 1);
  });

  test("a payment with no transaction row is still replay-safe on the event alone", async () => {
    const { paymentId } = await seedPayment({ clientId: partnerClient, withTransaction: false });
    const first = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    const second = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    assert.equal(first.accrued, true);
    assert.equal(second.reason, "already_accrued");
    const rows = await accruals();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].transaction_id, null);
  });

  test("with neither key nothing is written, because a replay could not be caught", async () => {
    const { paymentId } = await seedPayment({
      clientId: partnerClient, withTransaction: false, withEvent: false
    });
    const out = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "no_idempotency_key");
    assert.equal((await accruals()).length, 0);
  });

  // ══════════ what must never accrue ══════════

  test("a direct fundhub client's payment writes nothing", async () => {
    const { paymentId } = await seedPayment({ clientId: directClient });
    const out = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "no_partner");
    assert.equal(
      Number((await db.query(`SELECT count(*)::int AS n FROM partner_revenue`)).rows[0].n),
      0, "a direct client must not produce a partner accrual anywhere"
    );
  });

  test("a course bought by a partner's own client writes nothing", async () => {
    const { paymentId } = await seedPayment({
      clientId: partnerClient, code: "funding-mastery", agreedPrice: "5000.00", amount: "5000.00"
    });
    const out = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "product_excluded");
    assert.equal((await accruals()).length, 0);
  });

  test("a refund payment row accrues nothing", async () => {
    const { paymentId } = await seedPayment({ clientId: partnerClient, kind: "refund" });
    const out = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    assert.equal(out.reason, "refund_not_accrued");
    assert.equal((await accruals()).length, 0);
  });

  // ══════════ cash, not sticker ══════════

  test("a financed repair sale accrues half the cash, not half the $5,000 contract", async () => {
    // Sub Prime A remits 42%: $2,100 of a $5,000 sale. Half of sticker would owe
    // the partner $2,500 out of $2,100 collected.
    const { paymentId } = await seedPayment({
      clientId: partnerClient, code: "repair-bundle",
      agreedPrice: "5000.00", amount: "2100.00"
    });
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    const rows = await accruals();
    assert.equal(rows[0].gross_amount, "2100.00");
    assert.equal(rows[0].share_amount, "1050.00");
    assert.notEqual(rows[0].share_amount, "2500.00");
    // fundhub's remaining half is never negative on a cash basis.
    assert.ok(Number(rows[0].gross_amount) - Number(rows[0].share_amount) >= 0);
  });

  test("the deposit and the success-fee balance together are exactly half the 10%", async () => {
    const deposit = await seedPayment({ clientId: partnerClient, amount: "3000.00", kind: "deposit" });
    await accrueForPayment(db, { orgId: org, salePaymentId: deposit.paymentId });
    const balance = await seedPayment({
      clientId: partnerClient, amount: "9000.00", kind: "success_fee", agreedPrice: "3000.00"
    });
    await accrueForPayment(db, { orgId: org, salePaymentId: balance.paymentId });

    const total = (await db.query(
      `SELECT sum(share_amount) AS s FROM partner_revenue WHERE partner_id = $1 AND status = 'accrued'`,
      [partnerId])).rows[0].s;
    assert.equal(total, "6000.00", "half of the $12,000 fee, with the deposit counted once");
  });

  // ══════════ the frozen rate ══════════

  test("changing the partner's rate leaves every historical row alone", async () => {
    const first = await seedPayment({ clientId: partnerClient });
    await accrueForPayment(db, { orgId: org, salePaymentId: first.paymentId });

    await db.query(`UPDATE partners SET revenue_share_pct = 20 WHERE id = $1`, [partnerId]);

    const second = await seedPayment({ clientId: partnerClient });
    await accrueForPayment(db, { orgId: org, salePaymentId: second.paymentId });

    const rows = await accruals();
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[0].share_pct_applied), 50);
    assert.equal(rows[0].share_amount, "1500.00", "the downgrade restated history");
    assert.equal(Number(rows[1].share_pct_applied), 20);
    assert.equal(rows[1].share_amount, "600.00");
  });

  // ══════════ reversal ══════════

  test("a full refund voids the row with a reason and does not delete it", async () => {
    const { paymentId, transactionId } = await seedPayment({ clientId: partnerClient });
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });

    const out = await voidForRefund(db, {
      orgId: org, transactionId, reason: `refund:${transactionId}`
    });
    assert.equal(out.voided, 1);
    const rows = await accruals();
    assert.equal(rows.length, 1, "the accrual must survive as a voided row");
    assert.equal(rows[0].status, "void");
    assert.equal(rows[0].void_reason, `refund:${transactionId}`);

    const bal = (await db.query(
      `SELECT balance_accrued FROM v_partner_balance WHERE partner_id = $1`, [partnerId])).rows[0];
    assert.equal(Number(bal.balance_accrued), 0, "a voided accrual must leave the balance");
  });

  test("a partial refund re-accrues the surviving net at the rate the original froze", async () => {
    const { paymentId, transactionId } = await seedPayment({ clientId: partnerClient });
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });

    // The partner is downgraded before the refund is processed. The survivor must
    // still be computed at 50, the rate the original accrual froze.
    await db.query(`UPDATE partners SET revenue_share_pct = 20 WHERE id = $1`, [partnerId]);

    const out = await voidForRefund(db, {
      orgId: org, transactionId, reason: `refund:${transactionId}`, netRemainingCents: 200000
    });
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 1);

    const rows = await accruals();
    assert.equal(rows.length, 2);
    const survivor = rows.find((r) => r.status === "accrued");
    assert.ok(survivor);
    assert.equal(survivor.gross_amount, "2000.00");
    assert.equal(survivor.share_amount, "1000.00");
    assert.equal(Number(survivor.share_pct_applied), 50);
    assert.equal(survivor.transaction_id, null,
      "the voided row still owns the transaction key");
  });

  test("a refund delivered twice voids once and re-accrues once", async () => {
    const { paymentId, transactionId } = await seedPayment({ clientId: partnerClient });
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    await voidForRefund(db, { orgId: org, transactionId, reason: "refund:x", netRemainingCents: 200000 });
    const second = await voidForRefund(db, {
      orgId: org, transactionId, reason: "refund:x", netRemainingCents: 200000
    });
    assert.equal(second.voided, 0);
    assert.equal(second.reason, "nothing_to_void");
    assert.equal((await accruals()).length, 2);
  });

  test("the database itself refuses to delete an accrual", async () => {
    const { paymentId } = await seedPayment({ clientId: partnerClient });
    const out = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    await assert.rejects(
      () => db.query(`DELETE FROM partner_revenue WHERE id = $1`, [out.revenueId]),
      /not deletable/
    );
  });

  // ══════════ the recruit bonus ══════════

  test("the recruit bonus writes $2,000 against the $10,000 entry fee, once", async () => {
    const { transactionId } = await seedPayment({ clientId: partnerClient });
    const first = await accrueRecruitBonus(db, {
      orgId: org, recruiterPartnerId: partnerId, transactionId
    });
    const second = await accrueRecruitBonus(db, {
      orgId: org, recruiterPartnerId: partnerId, transactionId
    });

    assert.equal(first.accrued, true);
    assert.equal(second.reason, "already_accrued");
    const rows = (await accruals()).filter((r) => r.client_id === null);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].gross_amount, "10000.00");
    assert.equal(rows[0].share_amount, "2000.00");
    assert.equal(Number(rows[0].share_pct_applied), 20);
    assert.equal(ENTRY_FEE_CENTS, 1000000);
  });

  // ══════════ the wire itself ══════════
  //
  // Everything above calls the writer directly. These two prove the hook in
  // money-chain.mjs actually reaches it, because a correct writer nothing calls
  // is exactly the hole (finding F1) this work exists to close.

  test("recording a payment through the money chain accrues the partner's half", async () => {
    const tag = `${REF}-chain-1`;
    const saleId = (await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, external_ref)
       VALUES ($1,$2,$3,'3000.00',$4) RETURNING id`,
      [org, partnerClient, products["card-stacking-dfy"], tag])).rows[0].id;
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status,
                                 provider, provider_ref, raw_payload)
       VALUES ($1,$2,'card-stacking-dfy','3000.00','succeeded','test',$3,'{}'::jsonb)`,
      [org, partnerClient, tag]);
    const eventId = (await db.query(
      `INSERT INTO events (org_id, name, client_id, payload, idempotency_key)
       VALUES ($1,'deposit.paid',$2,'{}'::jsonb,$3) RETURNING id`,
      [org, partnerClient, tag])).rows[0].id;

    const event = {
      id: eventId, orgId: org, name: "deposit.paid",
      payload: { amount: 3000, providerRef: tag, source: "test", productName: "card-stacking-dfy", notes: tag }
    };
    const first = await ensureSalePayment(db, event, {
      saleId, clientId: partnerClient, productId: products["card-stacking-dfy"], kind: "deposit"
    });
    assert.equal(first.created, true);
    assert.equal(first.partnerRevenue?.accrued, true,
      "the money chain recorded the payment but never accrued the partner's half");

    // The same webhook re-delivered: one payment row, one accrual row.
    const replay = await ensureSalePayment(db, event, {
      saleId, clientId: partnerClient, productId: products["card-stacking-dfy"], kind: "deposit"
    });
    assert.equal(replay.created, false);
    assert.equal(replay.partnerRevenue?.reason, "already_accrued");

    const rows = await accruals();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].share_amount, "1500.00");
  });

  test("the money chain still records a direct client's payment and accrues nothing", async () => {
    const tag = `${REF}-chain-2`;
    const saleId = (await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, external_ref)
       VALUES ($1,$2,$3,'3000.00',$4) RETURNING id`,
      [org, directClient, products["card-stacking-dfy"], tag])).rows[0].id;
    const eventId = (await db.query(
      `INSERT INTO events (org_id, name, client_id, payload, idempotency_key)
       VALUES ($1,'deposit.paid',$2,'{}'::jsonb,$3) RETURNING id`,
      [org, directClient, tag])).rows[0].id;

    const out = await ensureSalePayment(db, {
      id: eventId, orgId: org, name: "deposit.paid",
      payload: { amount: 3000, notes: tag }
    }, { saleId, clientId: directClient, productId: products["card-stacking-dfy"], kind: "deposit" });

    assert.equal(out.created, true, "the payment itself must still be recorded");
    assert.equal(out.partnerRevenue?.accrued, false);
    assert.equal(out.partnerRevenue?.reason, "no_partner");
  });

  // ══════════ tenancy ══════════

  test("an accrual can never be written against the wrong partner", async () => {
    const { paymentId } = await seedPayment({ clientId: partnerClient });
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    assert.equal((await accruals(otherPartnerId)).length, 0,
      "LEAK: another partner picked up revenue from a client that is not theirs");
  });
});
