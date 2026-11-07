// Unit tests for the partner accrual writer — no Postgres.
//
// The arithmetic in here is somebody's money, and it is the half of a deal the
// owner cannot check by reading code. So these tests assert exact cent figures
// out of docs/specs/W1-money-model.md §4, not "roughly half".
//
// The database behaviour is proved against real Postgres in revenue.pg.test.mjs.
// What is proved here is everything that does not need one: the split, the
// frozen rate, the allow-list, and the refusals.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  PARTNER_SHARE_PRODUCT_CODES, ENTRY_FEE_CENTS, RECRUIT_BONUS_PCT,
  sharesWithPartner, computeAccrual, computeRecruitBonus,
  accrueForPayment, accrueForPaymentSafe, accrueRecruitBonus, voidForRefund
} from "./revenue.mjs";
import { applySplit, toCents } from "../commissions/money.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-000000000002";
const CLIENT = "00000000-0000-4000-8000-000000000003";
const SALE = "00000000-0000-4000-8000-000000000004";
const PAYMENT = "00000000-0000-4000-8000-000000000005";
const TX = "00000000-0000-4000-8000-000000000006";
const EVENT = "00000000-0000-4000-8000-000000000007";

/** A sale_payments row as the context query hands it back. numeric columns
 *  arrive from pg as STRINGS, which is what the writer has to cope with. */
function paymentRow(over = {}) {
  return {
    payment_id: PAYMENT,
    sale_id: SALE,
    kind: "deposit",
    amount: "3000.00",
    paid_at: new Date("2026-08-31T12:00:00Z"),
    transaction_id: TX,
    source_event_id: EVENT,
    client_id: CLIENT,
    currency: "USD",
    partner_id: PARTNER,
    product_code: "card-stacking-dfy",
    revenue_share_pct: "50.00000",
    ...over
  };
}

/* A fake database that models the two things the writer leans on: the partial
   unique indexes on partner_revenue, and the foreign keys behind the two
   idempotency columns. Anything else it is asked throws, so a query nobody
   thought about cannot pass silently. */
function fakeDb({ payment = paymentRow(), events = [EVENT], transactions = [TX], partners = [PARTNER] } = {}) {
  const rows = [];
  const eventIds = new Set(events);
  const txIds = new Set(transactions);
  const partnerIds = new Set(partners);
  return {
    rows,
    query: async (sql, params) => {
      const text = String(sql);
      if (/FROM sale_payments sp/i.test(text)) {
        const ok = payment && payment.payment_id === params[0];
        return { rows: ok ? [payment] : [] };
      }
      if (/FROM events WHERE id/i.test(text)) {
        return { rows: eventIds.has(params[0]) ? [{ one: 1 }] : [] };
      }
      if (/FROM transactions WHERE id/i.test(text)) {
        return { rows: txIds.has(params[0]) ? [{ one: 1 }] : [] };
      }
      if (/FROM partners WHERE id/i.test(text)) {
        return { rows: partnerIds.has(params[0]) ? [{ id: params[0] }] : [] };
      }
      if (/INSERT INTO partner_revenue/i.test(text)) {
        const [org_id, partner_id, client_id, transaction_id, source_event_id,
          gross_amount, share_pct_applied, share_amount, currency, occurred_at] = params;
        // partner_revenue_tx_uniq and partner_revenue_event_uniq, both partial.
        const clash = rows.some((r) =>
          r.status !== "gone" && r.org_id === org_id && r.partner_id === partner_id && (
            (transaction_id && r.transaction_id === transaction_id) ||
            (source_event_id && r.source_event_id === source_event_id)
          ));
        if (clash) return { rows: [] };
        const row = {
          id: `rev-${rows.length + 1}`, org_id, partner_id, client_id,
          transaction_id, source_event_id, gross_amount, share_pct_applied,
          share_amount, currency, status: "accrued", void_reason: null, occurred_at
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (/UPDATE partner_revenue/i.test(text)) {
        const [org_id, txId, evId, why] = params;
        const hit = rows.filter((r) =>
          r.org_id === org_id && r.status !== "void" &&
          ((txId && r.transaction_id === txId) || (evId && r.source_event_id === evId)));
        for (const r of hit) { r.status = "void"; r.void_reason = why; }
        return { rows: hit.map((r) => ({ ...r })) };
      }
      throw new Error(`unhandled SQL: ${text.slice(0, 90)}`);
    }
  };
}

describe("the allow-list decides what shares, and e-products are not on it", () => {
  test("exactly the three service codes share revenue", () => {
    assert.deepEqual([...PARTNER_SHARE_PRODUCT_CODES].sort(),
      ["card-stacking-dfy", "repair-bundle", "repair-trial"]);
  });

  test("a course shares nothing — and so does any code nobody has opted in", () => {
    // The whole point of an allow-list: a product invented next year defaults to
    // excluded. If this ever inverts, every future course pays out 50%.
    for (const code of ["funding-mastery", "winners-board", "decline-autopsy",
      "live-trial", "some-course-invented-in-2027", "diagnostic", "consulting-package"]) {
      assert.equal(sharesWithPartner(code), false, `${code} must not share`);
    }
  });

  test("the partner's own paid add-ons are fundhub revenue and share nothing", () => {
    // The partner buys these FROM fundhub; they are not something a partner's
    // client bought, so there is no half to pay. They are excluded because they
    // are not on the list, which is the allow-list doing its job with no edit.
    for (const code of ["creative-intelligence", "dfy-marketing", "lead-flow"]) {
      assert.equal(sharesWithPartner(code), false, `${code} must not share`);
    }
  });

  test("an unknown or missing product code shares nothing", () => {
    assert.equal(sharesWithPartner(null), false);
    assert.equal(sharesWithPartner(undefined), false);
    assert.equal(sharesWithPartner(""), false);
  });

  test("codes match case-insensitively and ignore stray whitespace", () => {
    assert.equal(sharesWithPartner(" Card-Stacking-DFY "), true);
    assert.equal(sharesWithPartner("repair-bundle"), true);
    assert.equal(sharesWithPartner("repair-trial"), true);
  });
});

describe("computeAccrual — the split, to the cent", () => {
  test("a $3,000 deposit gives the partner exactly $1,500", () => {
    // W1 §4(a). 300,000 cents in, 150,000 out, and fundhub keeps the other half
    // no matter how many affiliates sit under the partner.
    const d = computeAccrual({
      partnerId: PARTNER, kind: "deposit",
      productCode: "card-stacking-dfy", amount: "3000.00", sharePct: 50
    });
    assert.equal(d.accrue, true);
    assert.equal(d.grossCents, 300000);
    assert.equal(d.shareCents, 150000);
    assert.equal(d.sharePct, 50);
  });

  test("the $9,000 success-fee balance gives the partner $4,500 — the deposit is not counted twice", () => {
    // W1 §3. The $3,000 deposit COUNTS TOWARD the 10%, so a $120,000 funded deal
    // invoices $9,000 more, not $12,000 more. Accruing on each payment row as it
    // lands makes the double count impossible: 150,000 + 450,000 = 600,000, which
    // is exactly half of the 1,200,000 total fee.
    const deposit = computeAccrual({
      partnerId: PARTNER, kind: "deposit",
      productCode: "card-stacking-dfy", amount: "3000.00", sharePct: 50
    });
    const balance = computeAccrual({
      partnerId: PARTNER, kind: "success_fee",
      productCode: "card-stacking-dfy", amount: "9000.00", sharePct: 50
    });
    assert.equal(balance.shareCents, 450000);
    assert.equal(deposit.shareCents + balance.shareCents, 600000);
    assert.equal(deposit.shareCents + balance.shareCents, applySplit(1200000, 50));
  });

  test("the fee arriving in three pieces totals the same as one payment", () => {
    const parts = ["3000.00", "3000.00", "3000.00"].map((amount) => computeAccrual({
      partnerId: PARTNER, kind: "installment",
      productCode: "card-stacking-dfy", amount, sharePct: 50
    }));
    assert.deepEqual(parts.map((p) => p.shareCents), [150000, 150000, 150000]);
    assert.equal(parts.reduce((s, p) => s + p.shareCents, 0), 450000);
  });

  test("an odd amount rounds half away from zero and never loses a cent to floats", () => {
    const d = computeAccrual({
      partnerId: PARTNER, kind: "deposit",
      productCode: "repair-bundle", amount: "333.33", sharePct: 50
    });
    assert.equal(d.grossCents, 33333);
    assert.equal(d.shareCents, 16667); // 16666.5 rounds up, not to 16666
  });

  test("the percent is read as percent units — 50 is half, not one-half of one percent", () => {
    const half = computeAccrual({
      partnerId: PARTNER, kind: "deposit",
      productCode: "repair-bundle", amount: "1000.00", sharePct: 50
    });
    assert.equal(half.shareCents, 50000);
    assert.notEqual(half.shareCents, 500);
  });

  test("a downgraded partner on 20 earns a fifth, and the rule is read not written", () => {
    const d = computeAccrual({
      partnerId: PARTNER, kind: "deposit",
      productCode: "card-stacking-dfy", amount: "3000.00", sharePct: "20.00000"
    });
    assert.equal(d.shareCents, 60000);
    assert.equal(d.sharePct, 20);
  });
});

describe("the base is cash that arrived, never the sticker price", () => {
  // W1 §1, the whole reason this rule exists. A $5,000 credit repair sale
  // financed at the weakest band remits 30% — $1,500. Half of sticker would owe
  // the partner $2,500 out of $1,500 collected, and fundhub goes $1,000 negative
  // on a sale that looked profitable.
  const STICKER_CENTS = toCents("5000.00");

  for (const [band, remitPct, cashDollars, expectedShare] of [
    ["Prime 680+ (85%)", 85, "4250.00", 212500],
    ["Near prime (75%)", 75, "3750.00", 187500],
    ["Lender B (62%)", 62, "3100.00", 155000],
    ["Sub Prime A (42%)", 42, "2100.00", 105000],
    ["Lender B (30%)", 30, "1500.00", 75000]
  ]) {
    test(`a financed repair sale at ${band} accrues on the cash, not the $5,000`, () => {
      const d = computeAccrual({
        partnerId: PARTNER, kind: "deposit",
        productCode: "repair-bundle", amount: cashDollars, sharePct: 50
      });
      assert.equal(d.grossCents, toCents(cashDollars),
        "the gross must be the cash that arrived");
      assert.equal(d.shareCents, expectedShare);
      assert.notEqual(d.shareCents, applySplit(STICKER_CENTS, 50),
        `${band}: half of sticker would have been paid — that is the bug this rule exists to stop`);
      // fundhub's remaining half can never be negative on a cash basis.
      assert.ok(d.grossCents - d.shareCents >= 0);
      assert.equal(d.grossCents, applySplit(STICKER_CENTS, remitPct));
    });
  }
});

describe("computeAccrual refuses, and says which refusal it is", () => {
  const base = {
    partnerId: PARTNER, kind: "deposit",
    productCode: "card-stacking-dfy", amount: "3000.00", sharePct: 50
  };

  test("a direct fundhub client has no partner and accrues nothing", () => {
    const d = computeAccrual({ ...base, partnerId: null });
    assert.equal(d.accrue, false);
    assert.equal(d.reason, "no_partner");
  });

  test("a refund never accrues — it is voided instead", () => {
    const d = computeAccrual({ ...base, kind: "refund" });
    assert.equal(d.accrue, false);
    assert.equal(d.reason, "refund_not_accrued");
  });

  test("a course accrues nothing, and says it was excluded rather than unknown", () => {
    const d = computeAccrual({ ...base, productCode: "funding-mastery" });
    assert.equal(d.accrue, false);
    assert.equal(d.reason, "product_excluded");
  });

  test("a product we could not resolve is a DIFFERENT reason from one we excluded", () => {
    // Excluded is the rule working. Unknown is a routing bug, and conflating the
    // two hides the bug behind a correct-looking refusal.
    assert.equal(computeAccrual({ ...base, productCode: null }).reason, "unknown_product");
    assert.equal(computeAccrual({ ...base, productCode: "  " }).reason, "unknown_product");
  });

  test("a NULL amount stays unknown and is never treated as zero", () => {
    // toCents(null) returns 0. Letting that through would write a $0 accrual and
    // make a broken payment look like a settled one.
    for (const amount of [null, undefined, ""]) {
      const d = computeAccrual({ ...base, amount });
      assert.equal(d.accrue, false);
      assert.equal(d.reason, "unknown_amount", `amount ${JSON.stringify(amount)}`);
      assert.equal(d.grossCents, null, "an unknown amount must not become a number");
      assert.equal(d.shareCents, null);
    }
  });

  test("a zero payment is no base and therefore no commission", () => {
    const d = computeAccrual({ ...base, amount: "0.00" });
    assert.equal(d.accrue, false);
    assert.equal(d.reason, "zero_amount");
  });

  test("a partner on 0% earns nothing without throwing", () => {
    const d = computeAccrual({ ...base, sharePct: 0 });
    assert.equal(d.accrue, false);
    assert.equal(d.reason, "zero_share_pct");
  });

  test("a missing or impossible rate refuses rather than guessing 50", () => {
    assert.equal(computeAccrual({ ...base, sharePct: null }).reason, "unknown_share_pct");
    assert.equal(computeAccrual({ ...base, sharePct: "not a number" }).reason, "unknown_share_pct");
    assert.equal(computeAccrual({ ...base, sharePct: 150 }).reason, "share_pct_out_of_range");
  });
});

describe("computeRecruitBonus — $6,000, once, against the sticker", () => {
  test("the bonus is 20% of the $30,000 entry fee (owner-set 2026-11-07)", () => {
    assert.equal(ENTRY_FEE_CENTS, 3000000);
    assert.equal(RECRUIT_BONUS_PCT, 20);
    const b = computeRecruitBonus();
    assert.equal(b.grossCents, 3000000);
    assert.equal(b.shareCents, 600000);
    assert.equal(b.sharePct, 20);
  });

  test("the promise does not move when the lender remits less", () => {
    // W1 §5: the bonus is set against the sticker, not the remittance. A prime
    // entry remits $25,500 and a sub-prime one $9,000; the recruiter gets $6,000
    // either way, and computing it from the entry fee is what guarantees that.
    assert.equal(computeRecruitBonus().shareCents, 600000);
  });
});

describe("accrueForPayment — the writer, against a fake database", () => {
  test("one settled payment writes one row, with the rate frozen on it", async () => {
    const db = fakeDb();
    const out = await accrueForPayment(db, {
      orgId: ORG, saleId: SALE, salePaymentId: PAYMENT
    });
    assert.equal(out.accrued, true);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].gross_amount, "3000.00");
    assert.equal(db.rows[0].share_amount, "1500.00");
    assert.equal(db.rows[0].share_pct_applied, 50);
    assert.equal(db.rows[0].partner_id, PARTNER);
    assert.equal(db.rows[0].client_id, CLIENT);
    assert.equal(db.rows[0].status, "accrued");
  });

  test("both idempotency columns are set whenever both are known", async () => {
    // 042 has two partial unique indexes. Setting only one leaves the other path
    // — event replay or backfill re-run — unprotected.
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    assert.equal(db.rows[0].transaction_id, TX);
    assert.equal(db.rows[0].source_event_id, EVENT);
  });

  test("the same event replayed writes nothing the second time", async () => {
    const db = fakeDb();
    const first = await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    const second = await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    const third = await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    assert.equal(first.accrued, true);
    assert.equal(second.accrued, false);
    assert.equal(second.reason, "already_accrued", "a replay is a successful no-op, not an error");
    assert.equal(third.accrued, false);
    assert.equal(db.rows.length, 1, "three deliveries of one payment must leave one row");
  });

  test("a changed rate does not restate the row already written", async () => {
    // The partner is moved 50 -> 20 between two payments. The first accrual keeps
    // the 50 it froze; only the second computes on 20.
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    const before = { ...db.rows[0] };

    const later = fakeDb({
      payment: paymentRow({ revenue_share_pct: "20.00000" })
    });
    later.rows.push(before);
    await accrueForPayment(later, { orgId: ORG, salePaymentId: PAYMENT, transactionId: null, sourceEventId: null });

    assert.equal(before.share_pct_applied, 50);
    assert.equal(before.share_amount, "1500.00", "history moved when the rate changed");
  });

  test("a client with no partner writes nothing at all", async () => {
    const db = fakeDb({ payment: paymentRow({ partner_id: null, revenue_share_pct: null }) });
    const out = await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "no_partner");
    assert.equal(db.rows.length, 0);
  });

  test("a client naming a partner this org cannot see is refused, not treated as 0%", async () => {
    // The partners join is org-scoped, so a cross-org partner_id comes back with
    // a NULL rate. Number(null) is 0, and letting that through would look like a
    // correct "this partner earns nothing" answer.
    const db = fakeDb({ payment: paymentRow({ revenue_share_pct: null }) });
    const out = await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "partner_not_found");
    assert.equal(db.rows.length, 0);
  });

  test("an e-product bought by a partner's own client writes nothing", async () => {
    const db = fakeDb({ payment: paymentRow({ product_code: "funding-mastery" }) });
    const out = await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "product_excluded");
    assert.equal(db.rows.length, 0);
  });

  test("a financed repair sale accrues on the cash that arrived", async () => {
    const db = fakeDb({
      payment: paymentRow({ product_code: "repair-bundle", amount: "2100.00" })
    });
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    assert.equal(db.rows[0].gross_amount, "2100.00");
    assert.equal(db.rows[0].share_amount, "1050.00");
  });

  test("naming the wrong sale refuses instead of accruing on someone else's book", async () => {
    const db = fakeDb();
    const out = await accrueForPayment(db, {
      orgId: ORG, saleId: "00000000-0000-4000-8000-0000000000ff", salePaymentId: PAYMENT
    });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "sale_context_conflict");
    assert.equal(db.rows.length, 0);
  });

  test("an event id with no events row falls back to the transaction key", async () => {
    // sale_payments.source_event_id has no foreign key; partner_revenue's does.
    // Writing an id with nothing behind it would fail the whole accrual.
    const db = fakeDb({ events: [] });
    const out = await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    assert.equal(out.accrued, true);
    assert.equal(db.rows[0].source_event_id, null);
    assert.equal(db.rows[0].transaction_id, TX);
  });

  test("with neither key available nothing is written — a replay would double it", async () => {
    const db = fakeDb({ events: [], transactions: [] });
    const out = await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "no_idempotency_key");
    assert.equal(db.rows.length, 0);
  });

  test("a payment that is not ours writes nothing", async () => {
    const db = fakeDb();
    const out = await accrueForPayment(db, {
      orgId: ORG, salePaymentId: "00000000-0000-4000-8000-0000000000aa"
    });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "no_payment");
  });

  test("no org or no payment id is a refusal, not a crash", async () => {
    const db = fakeDb();
    assert.equal((await accrueForPayment(db, { orgId: null, salePaymentId: PAYMENT })).reason, "missing_context");
    assert.equal((await accrueForPayment(db, { orgId: ORG })).reason, "missing_context");
  });

  test("accrueForPaymentSafe swallows a database failure so money still records", async () => {
    const exploding = { query: async () => { throw new Error("connection reset"); } };
    const out = await accrueForPaymentSafe(exploding, { orgId: ORG, salePaymentId: PAYMENT });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "accrual_error");
    assert.match(out.error, /connection reset/);
  });
});

describe("accrueRecruitBonus", () => {
  test("writes one $6,000 row against the $30,000 entry fee", async () => {
    const db = fakeDb();
    const out = await accrueRecruitBonus(db, {
      orgId: ORG, recruiterPartnerId: PARTNER, transactionId: TX
    });
    assert.equal(out.accrued, true);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].gross_amount, "30000.00");
    assert.equal(db.rows[0].share_amount, "6000.00");
    assert.equal(db.rows[0].share_pct_applied, 20);
    assert.equal(db.rows[0].client_id, null, "a recruited partner is not a client");
  });

  test("the same entry fee replayed pays the bonus once", async () => {
    const db = fakeDb();
    await accrueRecruitBonus(db, { orgId: ORG, recruiterPartnerId: PARTNER, transactionId: TX });
    const again = await accrueRecruitBonus(db, { orgId: ORG, recruiterPartnerId: PARTNER, transactionId: TX });
    assert.equal(again.accrued, false);
    assert.equal(again.reason, "already_accrued");
    assert.equal(db.rows.length, 1);
  });

  test("an unknown recruiter is refused", async () => {
    const db = fakeDb({ partners: [] });
    const out = await accrueRecruitBonus(db, {
      orgId: ORG, recruiterPartnerId: PARTNER, transactionId: TX
    });
    assert.equal(out.accrued, false);
    assert.equal(out.reason, "no_partner");
  });

  test("with no replay key the bonus is refused rather than risk paying twice", async () => {
    const db = fakeDb({ transactions: [], events: [] });
    const out = await accrueRecruitBonus(db, { orgId: ORG, recruiterPartnerId: PARTNER, transactionId: TX });
    assert.equal(out.reason, "no_idempotency_key");
    assert.equal(db.rows.length, 0);
  });
});

describe("voidForRefund — reverse by voiding, never by deleting", () => {
  test("a full refund voids the accrual and records why", async () => {
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    const out = await voidForRefund(db, {
      orgId: ORG, transactionId: TX, reason: `refund:${TX}`
    });
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 0);
    assert.equal(db.rows.length, 1, "the row must still exist — voided, not deleted");
    assert.equal(db.rows[0].status, "void");
    assert.equal(db.rows[0].void_reason, `refund:${TX}`);
  });

  test("a partial refund voids the original and re-accrues the net at the FROZEN rate", async () => {
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    db.rows[0].share_pct_applied = 50;
    const out = await voidForRefund(db, {
      orgId: ORG, transactionId: TX, reason: `refund:${TX}`, netRemainingCents: 100000
    });
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 1);
    assert.equal(out.sharePct, 50);
    assert.equal(db.rows.length, 2);
    assert.equal(db.rows[1].gross_amount, "1000.00");
    assert.equal(db.rows[1].share_amount, "500.00");
    assert.equal(db.rows[1].share_pct_applied, 50, "the re-accrual must use the rate the original froze");
    assert.equal(db.rows[1].transaction_id, null,
      "the voided row still holds the transaction key, so the replacement cannot reuse it");
  });

  test("the re-accrual keeps the original's rate even after the partner is downgraded", async () => {
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    // Partner is moved to 20 after the sale. The refund must not restate the
    // survivor at today's rate.
    const out = await voidForRefund(db, {
      orgId: ORG, transactionId: TX, reason: "chargeback:x", netRemainingCents: 200000
    });
    assert.equal(out.sharePct, 50);
    assert.equal(db.rows[1].share_amount, "1000.00");
  });

  test("voiding twice is a no-op — the second call finds nothing to void", async () => {
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    await voidForRefund(db, { orgId: ORG, transactionId: TX, reason: "refund:x", netRemainingCents: 100000 });
    const second = await voidForRefund(db, {
      orgId: ORG, transactionId: TX, reason: "refund:x", netRemainingCents: 100000
    });
    assert.equal(second.voided, 0);
    assert.equal(second.reaccrued, 0);
    assert.equal(second.reason, "nothing_to_void");
    assert.equal(db.rows.length, 2, "a second refund delivery must not mint a third row");
  });

  test("a void with no reason is refused before it reaches the database", async () => {
    const db = fakeDb();
    await assert.rejects(
      () => voidForRefund(db, { orgId: ORG, transactionId: TX, reason: "" }),
      /reason is required/
    );
  });

  test("a negative or fractional net is refused", async () => {
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    await assert.rejects(
      () => voidForRefund(db, { orgId: ORG, transactionId: TX, reason: "refund:x", netRemainingCents: -5 }),
      /whole cents/
    );
  });

  test("a bad amount is refused BEFORE the row is voided, not after", async () => {
    // The refusal used to land after the UPDATE, which left the accrual reversed
    // on the strength of an argument the function had already rejected.
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    await assert.rejects(
      () => voidForRefund(db, { orgId: ORG, transactionId: TX, reason: "refund:x", refundedCents: 1.5 }),
      /whole cents/
    );
    assert.equal(db.rows[0].status, "accrued", "nothing may be voided on a bad argument");
  });
});

/* refundedCents is what a refund webhook actually carries: how much went BACK,
   not how much survived. The caller should not have to read partner_revenue to
   work out the difference — and if it did, the gross it read could be a
   different row from the one the void actually caught. */
describe("voidForRefund — a refund stated as what went back", () => {
  test("the survivor is the voided row's own gross minus the refund", async () => {
    // $3,000 accrued, $1,000 refunded. $2,000 survives; half of it is $1,000.
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    const out = await voidForRefund(db, {
      orgId: ORG, transactionId: TX, reason: `refund:${TX}`, refundedCents: 100000
    });
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 1);
    assert.equal(out.netCents, 200000);
    assert.equal(db.rows[1].gross_amount, "2000.00");
    assert.equal(db.rows[1].share_amount, "1000.00");
    assert.equal(db.rows[1].share_pct_applied, 50, "the frozen rate, not today's");
  });

  test("a refund for the whole payment re-accrues nothing", async () => {
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    const out = await voidForRefund(db, {
      orgId: ORG, transactionId: TX, reason: "refund:x", refundedCents: 300000
    });
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 0);
    assert.equal(db.rows.length, 1);
  });

  test("a refund bigger than the payment floors the survivor at zero", async () => {
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    const out = await voidForRefund(db, {
      orgId: ORG, transactionId: TX, reason: "refund:x", refundedCents: 900000
    });
    assert.equal(out.reaccrued, 0, "partner_revenue_share_ck forbids a negative row");
    assert.equal(db.rows.length, 1);
  });

  test("an explicit net beats a derived one", async () => {
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    const out = await voidForRefund(db, {
      orgId: ORG, transactionId: TX, reason: "refund:x",
      netRemainingCents: 50000, refundedCents: 100000
    });
    assert.equal(out.netCents, 50000);
    assert.equal(db.rows[1].gross_amount, "500.00");
  });

  test("saying neither is a full reversal, which is the common case", async () => {
    const db = fakeDb();
    await accrueForPayment(db, { orgId: ORG, salePaymentId: PAYMENT });
    const out = await voidForRefund(db, { orgId: ORG, transactionId: TX, reason: "refund:x" });
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 0);
    assert.equal(db.rows.length, 1);
  });
});
