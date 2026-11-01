// Refunds and chargebacks reaching the partner ledger — no Postgres.
//
// WHAT THESE PROVE. src/partners/revenue.mjs has had voidForRefund() since the
// accrual writer shipped and nothing called it, so a refund left the partner's
// half sitting there payable. These tests hold the wire closed: the reversal
// events find the original payment, the accrual goes void with a reason that
// names the refund, a partial refund puts the survivor back at the rate the
// original froze, and a reversal that cannot be matched writes nothing rather
// than guessing at somebody else's deal.
//
// The database behaviour behind the void — the no-delete trigger, the partial
// unique indexes, the CHECKs — is proved against real Postgres in
// src/partners/revenue.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert";
import {
  onPaymentRefundedMoney, onPaymentDisputedMoney,
  findOriginalPaymentKeys, reversalProviderRef, reversedCents,
  REVERSAL_PREFIX, register
} from "./money-chain.mjs";
import { clearHandlers, getHandlers } from "../events/registry.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-000000000002";
const CLIENT = "00000000-0000-4000-8000-000000000003";
const SALE = "00000000-0000-4000-8000-000000000004";
const PAYMENT = "00000000-0000-4000-8000-000000000005";
const TX = "00000000-0000-4000-8000-000000000006";
const PAID_EVENT = "00000000-0000-4000-8000-000000000007";
const REF = "pay_abc123";

/** One accrued partner_revenue row, as the accrual writer left it. */
function accrual(over = {}) {
  return {
    id: "rev-1",
    org_id: ORG,
    partner_id: PARTNER,
    client_id: CLIENT,
    transaction_id: TX,
    source_event_id: PAID_EVENT,
    gross_amount: "3000.00",
    share_pct_applied: "50.00000",
    share_amount: "1500.00",
    currency: "USD",
    status: "accrued",
    void_reason: null
  };
}

/* A fake database covering exactly the four statements a reversal touches:
   the provider-ref lookup, the sale_payments read that recovers the original
   event id, the void UPDATE, and the re-accrual INSERT. Anything else throws,
   so a query nobody thought about cannot slip past.

   It deliberately has no connect() and is not the shared singleton, so
   withTransaction() runs the void/re-accrue pair inline — the branch a unit
   test's stub gets. The all-or-nothing behaviour that branch cannot provide is
   the one named exposure in voidForRefund's header. */
function fakeDb({
  rows = [accrual()],
  transactions = { [REF]: TX },
  payments = [{ id: PAYMENT, sale_id: SALE, amount: "3000.00", source_event_id: PAID_EVENT }],
  blueprint = null,
  provider = "commas"
} = {}) {
  const state = { grantRevoked: false, includedSubscriptionEnded: false };
  return {
    rows,
    state,
    query: async (sql, params) => {
      const text = String(sql);

      if (/FROM transactions\s+WHERE org_id/i.test(text)) {
        const id = params[2] === provider ? transactions[String(params[1])] : null;
        return { rows: id ? [{ id }] : [] };
      }
      if (/FROM sale_payments\s+WHERE org_id/i.test(text)) {
        // Params are (org_id, transaction_id): the row hangs off the transaction
        // the provider reference just resolved to.
        const hit = params[0] === ORG && params[1] === TX ? payments : [];
        return { rows: hit.length ? [hit[0]] : [] };
      }
      if (/FROM transactions t\b/i.test(text) && /JOIN products p/i.test(text)) {
        return { rows: blueprint ? [{ id: TX, client_id: CLIENT, amount_paid: blueprint.amount,
          paid_at: new Date("2026-10-29T00:00:00Z") }] : [] };
      }
      if (/FROM events\b/i.test(text)) return { rows: [{ cents: "0" }] };
      if (/UPDATE entitlements/i.test(text)) {
        state.grantRevoked = true;
        return { rows: [{ id: "grant" }] };
      }
      if (/UPDATE subscriptions/i.test(text)) {
        state.includedSubscriptionEnded = true;
        return { rows: [{ id: "included" }] };
      }
      if (/UPDATE partner_revenue/i.test(text)) {
        const [org_id, txId, evId, why] = params;
        const hit = rows.filter((r) =>
          r.org_id === org_id && r.status !== "void" &&
          ((txId && r.transaction_id === txId) || (evId && r.source_event_id === evId)));
        for (const r of hit) { r.status = "void"; r.void_reason = why; }
        return { rows: hit.map((r) => ({ ...r })) };
      }
      if (/INSERT INTO partner_revenue/i.test(text)) {
        const [org_id, partner_id, client_id, transaction_id, source_event_id,
          gross_amount, share_pct_applied, share_amount, currency] = params;
        const clash = rows.some((r) =>
          r.org_id === org_id && r.partner_id === partner_id && (
            (transaction_id && r.transaction_id === transaction_id) ||
            (source_event_id && r.source_event_id === source_event_id)));
        if (clash) return { rows: [] };
        const row = {
          id: `rev-${rows.length + 1}`, org_id, partner_id, client_id,
          transaction_id, source_event_id, gross_amount, share_pct_applied,
          share_amount, currency, status: "accrued", void_reason: null
        };
        rows.push(row);
        return { rows: [row] };
      }
      throw new Error(`unhandled SQL: ${text.slice(0, 90)}`);
    }
  };
}

function reversalEvent(name, over = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000ff",
    name,
    orgId: ORG,
    clientId: CLIENT,
    payload: {
      providerRef: REF,
      paymentId: REF,
      amount: 3000,
      productName: "Consulting Services Deposit",
      source: "commas",
      ...over
    }
  };
}

describe("the reversal reads the reference it needs off the event", () => {
  test("providerRef is the reference, and an explicit original wins over it", () => {
    assert.equal(reversalProviderRef(reversalEvent("payment.refunded")), REF);
    assert.equal(
      reversalProviderRef(reversalEvent("payment.refunded", { originalProviderRef: "pay_original" })),
      "pay_original",
      "an adapter that learns the refund carries its own id can name the original"
    );
    assert.equal(reversalProviderRef({ payload: {} }), null);
    assert.equal(reversalProviderRef(null), null);
  });

  test("a reversal amount is a magnitude — a processor may send it negative", () => {
    assert.equal(reversedCents(reversalEvent("payment.refunded", { amount: 3000 })), 300000);
    assert.equal(reversedCents(reversalEvent("payment.refunded", { amount: -3000 })), 300000);
    assert.equal(reversedCents(reversalEvent("payment.refunded", { amount: "1000.50" })), 100050);
  });

  test("an amount that is missing or unreadable is null, never zero", () => {
    // Zero would read as "nothing was refunded" and leave the accrual standing.
    for (const amount of [null, undefined, "", "not-a-number", 0]) {
      assert.equal(reversedCents(reversalEvent("payment.refunded", { amount })), null,
        `amount ${JSON.stringify(amount)} must not become a number`);
    }
  });
});

describe("finding the original payment behind a reversal", () => {
  test("a refund cannot use another provider's receipt or revoke its Blueprint grant", async () => {
    const db = fakeDb({ provider: "whop", blueprint: { amount: 3000 } });
    const refused = await onPaymentRefundedMoney(reversalEvent("payment.refunded"), db);
    assert.equal(refused.reason, "no_original_payment");
    assert.equal(db.rows[0].status, "accrued");
    assert.equal(db.state.grantRevoked, false);
    const matched = await onPaymentRefundedMoney(reversalEvent("payment.refunded", { source: "whop" }), db);
    assert.equal(matched.blueprintIncludedEnded, true);
    assert.equal(db.state.grantRevoked, true);
  });
  test("the provider reference reaches the transaction and the paid event id", async () => {
    const keys = await findOriginalPaymentKeys(fakeDb(), ORG, REF);
    assert.equal(keys.transactionId, TX);
    assert.equal(keys.sourceEventId, PAID_EVENT);
    assert.equal(keys.payment.id, PAYMENT);
  });

  test("an unknown reference finds nothing and invents nothing", async () => {
    const keys = await findOriginalPaymentKeys(fakeDb(), ORG, "pay_never_seen");
    assert.deepEqual(keys, { transactionId: null, sourceEventId: null, payment: null });
  });

  test("no org and no reference are both simply empty", async () => {
    assert.equal((await findOriginalPaymentKeys(fakeDb(), null, REF)).transactionId, null);
    assert.equal((await findOriginalPaymentKeys(fakeDb(), ORG, null)).transactionId, null);
  });
});

describe("payment.refunded voids the partner's accrual", () => {
  test("a full refund voids the row and names the refund in void_reason", async () => {
    const db = fakeDb();
    const out = await onPaymentRefundedMoney(reversalEvent("payment.refunded"), db);

    assert.equal(out.reversed, true);
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 0, "nothing survived a full refund");
    assert.equal(db.rows.length, 1, "the row must still exist — voided, not deleted");
    assert.equal(db.rows[0].status, "void");
    assert.equal(db.rows[0].void_reason, `refund:${REF}`);
  });

  test("a partial refund re-accrues the survivor at the rate the original froze", async () => {
    // $3,000 paid, $1,000 back. $2,000 survives; the partner's half of that is
    // $1,000 — at 50%, the rate frozen on the original row, not today's rate.
    const db = fakeDb();
    const out = await onPaymentRefundedMoney(
      reversalEvent("payment.refunded", { amount: 1000 }), db);

    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 1);
    assert.equal(out.netCents, 200000);
    assert.equal(db.rows.length, 2);
    assert.equal(db.rows[0].status, "void");
    assert.equal(db.rows[1].gross_amount, "2000.00");
    assert.equal(db.rows[1].share_amount, "1000.00");
    assert.equal(db.rows[1].share_pct_applied, 50);
    assert.equal(db.rows[1].transaction_id, null,
      "the voided row still holds the keys, so the replacement cannot reuse them");
  });

  test("a refund larger than the payment leaves nothing behind", async () => {
    const db = fakeDb();
    const out = await onPaymentRefundedMoney(
      reversalEvent("payment.refunded", { amount: 5000 }), db);
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 0, "a survivor cannot be negative");
    assert.equal(db.rows.length, 1);
  });

  test("an unreadable amount voids in full rather than guessing a partial", async () => {
    const db = fakeDb();
    const out = await onPaymentRefundedMoney(
      reversalEvent("payment.refunded", { amount: null }), db);
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 0);
    assert.equal(db.rows[0].status, "void");
  });

  test("delivering the same refund twice voids once and re-accrues once", async () => {
    const db = fakeDb();
    await onPaymentRefundedMoney(reversalEvent("payment.refunded", { amount: 1000 }), db);
    const second = await onPaymentRefundedMoney(
      reversalEvent("payment.refunded", { amount: 1000 }), db);

    assert.equal(second.reversed, false);
    assert.equal(second.reason, "nothing_to_void");
    assert.equal(db.rows.length, 2, "a re-delivery must not mint a third row");
  });

  test("a refund with no matching payment writes nothing at all", async () => {
    const db = fakeDb();
    const out = await onPaymentRefundedMoney(
      reversalEvent("payment.refunded", { providerRef: "pay_never_seen", paymentId: null }), db);

    assert.equal(out.reversed, false);
    assert.equal(out.reason, "no_original_payment");
    assert.equal(db.rows[0].status, "accrued",
      "matching a reversal by amount would eventually reverse the wrong deal");
  });

  test("a direct fundhub client has no accrual, and that is not an error", async () => {
    const db = fakeDb({ rows: [] });
    const out = await onPaymentRefundedMoney(reversalEvent("payment.refunded"), db);
    assert.equal(out.reversed, false);
    assert.equal(out.reason, "nothing_to_void");
  });

  test("an event with no org does nothing", async () => {
    const db = fakeDb();
    const ev = reversalEvent("payment.refunded");
    ev.orgId = null;
    const out = await onPaymentRefundedMoney(ev, db);
    assert.equal(out.reason, "no_org");
    assert.equal(db.rows[0].status, "accrued");
  });
});

test("full Blueprint refund ends included service even when no partner accrual exists", async () => {
  const db = fakeDb({ rows: [], blueprint: { amount: "7500.00" } });
  const out = await onPaymentRefundedMoney(reversalEvent("payment.refunded", { amount: 7500 }), db);
  assert.equal(out.reversed, false, "a direct customer has no partner accrual");
  assert.equal(db.state.grantRevoked, true);
  assert.equal(db.state.includedSubscriptionEnded, true);
});

test("partial Blueprint refund leaves included service active", async () => {
  const db = fakeDb({ rows: [], blueprint: { amount: "7500.00" } });
  await onPaymentRefundedMoney(reversalEvent("payment.refunded", { amount: 1000 }), db);
  assert.equal(db.state.grantRevoked, false);
  assert.equal(db.state.includedSubscriptionEnded, false);
});

describe("payment.disputed voids too, and says it was a chargeback", () => {
  test("the void reason carries the chargeback word so a won dispute is findable", async () => {
    // There is no dispute.won event on the bus. Winning one does not un-void
    // anything, so the prefix is how those rows get found and corrected by hand.
    const db = fakeDb();
    const out = await onPaymentDisputedMoney(reversalEvent("payment.disputed"), db);

    assert.equal(out.voided, 1);
    assert.equal(db.rows[0].status, "void");
    assert.equal(db.rows[0].void_reason, `chargeback:${REF}`);
    assert.equal(REVERSAL_PREFIX["payment.disputed"], "chargeback");
    assert.equal(REVERSAL_PREFIX["payment.refunded"], "refund");
  });

  test("a partial chargeback leaves the rest of the partner's half standing", async () => {
    const db = fakeDb();
    const out = await onPaymentDisputedMoney(
      reversalEvent("payment.disputed", { amount: 500 }), db);
    assert.equal(out.reaccrued, 1);
    assert.equal(db.rows[1].gross_amount, "2500.00");
    assert.equal(db.rows[1].share_amount, "1250.00");
  });
});

describe("both reversal events are actually bound to the bus", () => {
  test("register() binds payment.refunded and payment.disputed", () => {
    // The whole point of this unit: the reversal was built and never called.
    clearHandlers();
    try {
      register();
      assert.ok(getHandlers("payment.refunded").includes(onPaymentRefundedMoney));
      assert.ok(getHandlers("payment.disputed").includes(onPaymentDisputedMoney));
    } finally {
      clearHandlers();
    }
  });
});
