// Postgres-backed tests for migration 581 (card_payment_claims) and the real
// reads and writes in src/finance/card-pay-now.mjs (FinanceOS unit I6).
//
// WHAT ONLY A REAL DATABASE CAN SAY:
//   1. A claim can only name the client's OWN card (the composite foreign key).
//   2. One live "I paid" per card per due date: saying it again updates the row;
//      after Undo a new one can be made, and the old row is kept.
//   3. Unknown amounts stay NULL; a $0 or negative amount is refused.
//   4. The read finds the claim and confirms it from a posted card payment.
//
// EVERYTHING RUNS IN ONE TRANSACTION THAT IS ROLLED BACK. Expected failures run
// inside SAVEPOINTs. Skipped without DATABASE_URL (a skip is not a pass).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool, close } from "../db.mjs";
import { cardPayNow, recordCardPaid, withdrawCardPaid } from "./card-pay-now.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TODAY = "2026-11-07";
const NOW = new Date(`${TODAY}T15:00:00Z`);

describe("card_payment_claims (migration 581)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let c, tdb, orgId, clientId, otherClientId, card, theirCard;

  before(async () => {
    c = await pool().connect();
    await c.query("BEGIN");
    tdb = { query: (...args) => c.query(...args) };
    orgId = (await c.query(`INSERT INTO orgs (slug, name) VALUES ($1, 'Pay Now PgTest Org') RETURNING id`,
      [`pay-now-pg-${process.pid}-${Date.now()}`])).rows[0].id;
    clientId = (await c.query(`INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Pay', 'PgTest') RETURNING id`, [orgId])).rows[0].id;
    otherClientId = (await c.query(`INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Other', 'PgTest') RETURNING id`, [orgId])).rows[0].id;
    const item = async (cid) => (await c.query(
      `INSERT INTO plaid_items (org_id, client_id, plaid_item_id, institution_name, encrypted_access_token, link_state, consent_granted_at, consent_scope)
       VALUES ($1, $2, $3, 'First Platypus Bank (Plaid sandbox — test data)', 'v1:aaaa:bbbb:cccc', 'active', now(), '["accounts"]'::jsonb) RETURNING id`,
      [orgId, cid, `item-${crypto.randomUUID()}`])).rows[0].id;
    const cardRow = async (cid, itemId, mask) => (await c.query(
      `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, plaid_account_id, provider, name, mask, account_type, account_subtype, current_balance_cents, credit_limit_cents)
       VALUES ($1, $2, $3, $4, 'plaid', 'Sample Card', $5, 'credit', 'credit card', 40000, 800000) RETURNING id`,
      [orgId, cid, itemId, `p-${mask}-${crypto.randomUUID()}`, mask])).rows[0].id;
    card = await cardRow(clientId, await item(clientId), "1111");
    theirCard = await cardRow(otherClientId, await item(otherClientId), "2222");
    await c.query(
      `INSERT INTO account_statement_cycles (org_id, client_id, bank_account_id, payment_due_day, minimum_payment_cents, source, raw)
       VALUES ($1, $2, $3, 21, 3500, 'provider', $4::jsonb)`,
      [orgId, clientId, card, JSON.stringify({ source: "plaid", next_payment_due_date: "2026-11-21" })]);
  });

  after(async () => {
    if (c) {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    await close();
  });

  async function fails(fn) {
    await c.query("SAVEPOINT sp");
    try { await fn(); } catch (e) { await c.query("ROLLBACK TO SAVEPOINT sp"); return e; }
    await c.query("RELEASE SAVEPOINT sp");
    return null;
  }

  test("a claim cannot name another client's card; a $0 amount is refused", async () => {
    const e1 = await fails(() => c.query(
      `INSERT INTO card_payment_claims (org_id, client_id, bank_account_id, due_on, paid_on, created_by_kind)
       VALUES ($1, $2, $3, '2026-11-21', '2026-11-06', 'client')`, [orgId, clientId, theirCard]));
    assert.equal(e1 && e1.code, "23503");
    const e2 = await fails(() => c.query(
      `INSERT INTO card_payment_claims (org_id, client_id, bank_account_id, due_on, paid_on, amount_cents, created_by_kind)
       VALUES ($1, $2, $3, '2026-11-21', '2026-11-06', 0, 'client')`, [orgId, clientId, card]));
    assert.equal(e2 && e2.code, "23514");
  });

  test("I paid twice for one due date is one row; Undo keeps it; a new I paid starts a new row", async () => {
    const a = await recordCardPaid(tdb, { orgId, clientId, input: { account_id: card, due_on: "2026-11-21", paid_on: "2026-11-05" }, byKind: "client", today: TODAY });
    const b = await recordCardPaid(tdb, { orgId, clientId, input: { account_id: card, due_on: "2026-11-21", paid_on: "2026-11-06", amount_cents: 3500 }, byKind: "client", today: TODAY });
    assert.equal(a.claim.id, b.claim.id);
    assert.equal(b.claim.paid_on, "2026-11-06");
    assert.equal(b.claim.amount_cents, 3500);
    assert.equal((await recordCardPaid(tdb, { orgId, clientId, input: { account_id: theirCard, due_on: "2026-11-21" }, byKind: "client", today: TODAY })).error, "card_not_found");

    assert.deepEqual(await withdrawCardPaid(tdb, { orgId, clientId, claimId: a.claim.id }), { ok: true });
    const n = await recordCardPaid(tdb, { orgId, clientId, input: { account_id: card, due_on: "2026-11-21" }, byKind: "client", today: TODAY });
    assert.notEqual(n.claim.id, a.claim.id);
    assert.equal(n.claim.amount_cents, null, "no amount typed → NULL, never 0");
    const kept = await c.query(`SELECT count(*)::int AS n FROM card_payment_claims WHERE bank_account_id = $1`, [card]);
    assert.equal(kept.rows[0].n, 2, "Undo deletes nothing");
  });

  test("the read: the card, its due date, and the claim confirmed by a posted payment on the card", async () => {
    await c.query(
      `INSERT INTO bank_transactions (org_id, client_id, bank_account_id, amount_cents, posted_on, merchant_name, category, is_pending, provider_transaction_id)
       VALUES ($1, $2, $3, 3500, '2026-11-07', 'PAYMENT - THANK YOU', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', false, $4)`,
      [orgId, clientId, card, `tx-${crypto.randomUUID()}`]);
    const out = await cardPayNow(tdb, { orgId, clientId, asOf: NOW });
    const mine = out.cards.find((x) => x.account_id === card);
    assert.equal(mine.due_on, "2026-11-21");
    assert.equal(mine.min_due_cents, 3500);
    assert.equal(mine.can_check, true);
    assert.equal(mine.claim.status, "confirmed");
    assert.equal(mine.claim.seen_on, "2026-11-07");
    assert.equal(out.cards.some((x) => x.account_id === theirCard), false, "another client's card never shows");
  });
});
