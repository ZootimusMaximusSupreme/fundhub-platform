/* Real Postgres: a Card Stacking round goes funded and the client gets a BILL.
   Not a task. A bill.

   WHY THIS FILE EXISTS. F-07 refused to invoice unless the round.funded event
   carried a fee percent, and nothing ever put one there — so every funded round
   in this system's life produced the task "Fix fee lock/percent before
   invoicing" and no invoice at all. Both existing test files were green
   throughout: the emitter's test never ran F-07, and F-07's own test handed
   itself a feePercent no real event carried.

   So this drives the real chain end to end against a real database:
       moveCardToStage → round.funded → money-chain closeout → F-07 invoice
   and asserts the money, the refusals, and that the closeout record and the
   invoice agree on the same basis.

   Basis: CONFIRMED APPROVALS (owner-set 2026-08-30, docs/finance/CLOSEOUT-FEE-BASIS.md). */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { register as registerMoneyChain } from "../handlers/money-chain.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { handle as f07, EMAIL_TEMPLATE_KEY as F07_EMAIL, SMS_TEMPLATE_KEY as F07_SMS }
  from "../workflows/f-07-funding-locked.mjs";
import { fakeStep } from "../workflows/test-support.mjs";
import { NO_CONFIRMED_APPROVALS, NO_AGREED_FEE_PERCENT } from "./success-fee.mjs";
import { setApprovalExclusion } from "../applications/status.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = `fee_basis_${Date.now().toString(36)}`;

describe("success fee on confirmed approvals (pg)",
  { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgId;
  let productId;
  let staff;

  async function wipe() {
    const clients = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`]
    )).rows.map((r) => r.id);
    if (!clients.length) return;
    await db.query(`ALTER TABLE invoices DISABLE TRIGGER trg_invoices_no_delete`).catch(() => {});
    try {
      await db.query(`DELETE FROM invoices WHERE client_id = ANY($1)`, [clients]);
    } finally {
      await db.query(`ALTER TABLE invoices ENABLE TRIGGER trg_invoices_no_delete`).catch(() => {});
    }
    await db.query(`DELETE FROM funding_closeout_items WHERE funding_closeout_id IN (
      SELECT id FROM funding_closeout WHERE funding_round_id IN (
        SELECT id FROM funding_rounds WHERE client_id = ANY($1)))`, [clients]).catch(() => {});
    await db.query(`DELETE FROM funding_closeout WHERE funding_round_id IN (
      SELECT id FROM funding_rounds WHERE client_id = ANY($1))`, [clients]).catch(() => {});
    await db.query(`DELETE FROM application_decisions WHERE application_id IN (
      SELECT id FROM applications WHERE client_id = ANY($1))`, [clients]).catch(() => {});
    await db.query(`DELETE FROM applications WHERE client_id = ANY($1)`, [clients]).catch(() => {});
    await db.query(`ALTER TABLE commission_ledger DISABLE TRIGGER trg_commission_ledger_no_delete`).catch(() => {});
    try {
      await db.query(`DELETE FROM commission_ledger WHERE client_id = ANY($1)`, [clients]);
    } finally {
      await db.query(`ALTER TABLE commission_ledger ENABLE TRIGGER trg_commission_ledger_no_delete`).catch(() => {});
    }
    await db.query(`DELETE FROM funding_round_sales WHERE funding_round_id IN (
      SELECT id FROM funding_rounds WHERE client_id = ANY($1))`, [clients]).catch(() => {});
    await db.query(`DELETE FROM funding_rounds WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM sale_attributions WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
    await db.query(`DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
    await db.query(`DELETE FROM sales WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM cards WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM messages WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
  }

  /** A client with a funding sale, at the agreed rate given (null = never agreed). */
  async function makeClient(tag, agreedPercent) {
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, outcome_tier, custom_fields)
       VALUES ($1, $2, 'Fee', 'Basis', 'FULL_FUNDING', '{}'::jsonb) RETURNING id`,
      [orgId, `${MARK}.${tag}@example.com`]
    )).rows[0].id;
    await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, agreed_success_fee_percent, status, sold_at)
       VALUES ($1, $2, $3, 3000, $4, 'active', now())`,
      [orgId, clientId, productId, agreedPercent]
    );
    return clientId;
  }

  const move = (clientId, stageKey, extra = {}) =>
    moveCardToStage(db, { orgId, clientId, pipelineKey: "funding_card_stacking", stageKey, ...extra });

  /** Walk a client to the approved column, returning their round. */
  async function walkToApproved(clientId) {
    await move(clientId, "apply_now");
    await move(clientId, "round_submitted");
    await move(clientId, "approved");
    return (await db.query(
      `SELECT * FROM funding_rounds WHERE client_id = $1 ORDER BY round_number DESC LIMIT 1`,
      [clientId]
    )).rows[0];
  }

  // Returns the new application's id, so a test can act on that exact approval.
  const addApproval = (clientId, roundId, bank, amount) => db.query(
    `INSERT INTO applications (org_id, funding_round_id, client_id, bank, status, approved_amount)
     VALUES ($1, $2, $3, $4, 'Approved', $5) RETURNING id`,
    [orgId, roundId, clientId, bank, amount]
  ).then((r) => r.rows[0].id);

  const invoicesFor = (clientId) => db.query(
    `SELECT * FROM invoices WHERE client_id = $1`, [clientId]
  ).then((r) => r.rows);

  const closeoutFor = (roundId) => db.query(
    `SELECT * FROM funding_closeout WHERE funding_round_id = $1`, [roundId]
  ).then((r) => r.rows[0] || null);

  /** Hand F-07 the event the emitter actually produced. */
  const runF07 = (clientId, roundEvent, eventId) => f07({
    event: {
      id: eventId,
      orgId,
      clientId,
      name: "round.funded",
      payload: roundEvent.payload
    },
    db,
    step: fakeStep()
  });

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    registerMoneyChain();
    orgId = await resolveDefaultOrg(db);
    await wipe();
    productId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy' LIMIT 1`, [orgId]
    )).rows[0]?.id;
    assert.ok(productId, "card-stacking-dfy product must exist");
    // "Doesn't count" is saved against a real staff member (migration 492).
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${MARK}%`]).catch(() => {});
    const staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1, $2, 'Funding Advisor', 'funding_advisor', 'active') RETURNING id`,
      [orgId, `${MARK}.advisor@example.com`]
    )).rows[0].id;
    staff = { id: staffId, name: "Funding Advisor" };
    for (const [key, channel, body] of [
      [F07_EMAIL, "email", "Locked email"], [F07_SMS, "sms", "Locked sms"]
    ]) {
      await db.query(
        `INSERT INTO message_templates (org_id, template_key, channel, body, compliance_passed)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (org_id, template_key) DO UPDATE SET compliance_passed = true`,
        [orgId, key, channel, body]);
    }
  });

  after(async () => {
    await wipe();
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${MARK}%`]).catch(() => {});
    await close();
    clearHandlers();
  });

  test("a funded round with confirmed approvals is billed 10% of the confirmed total", async () => {
    const clientId = await makeClient("happy", 10);
    const round = await walkToApproved(clientId);
    await addApproval(clientId, round.id, "Bank A", 20000);
    await addApproval(clientId, round.id, "Bank B", 15000);

    // Staff type a funded amount far above what was confirmed. The old basis
    // would have billed 10% of this. The new basis must ignore it entirely.
    const funded = await move(clientId, "funded", { fundedAmount: 90000 });
    assert.equal(funded.moved, true, funded.message);
    assert.equal(funded.roundEvent.eventName, "round.funded");

    const p = funded.roundEvent.payload;
    assert.equal(p.approvedAmount, 35000, "the event carries the CONFIRMED total");
    assert.equal(p.feePercent, 10, "the event now carries the rate agreed on the sale");
    assert.equal(p.fundingRoundId, round.id);
    assert.ok(p.saleId, "the event carries the sale, which is half the idempotency key");

    const res = await runF07(clientId, funded.roundEvent, "00000000-0000-4000-8000-00000000fe01");
    assert.equal(res.feeReady, true, `F-07 refused: ${res.reason}`);
    assert.equal(res.feeAmount, "3500.00", "10% of 35000 confirmed, not of 90000 funded");

    const inv = await invoicesFor(clientId);
    assert.equal(inv.length, 1, "no invoice was raised");
    assert.equal(Number(inv[0].amount_due), 3500);
    assert.equal(inv[0].source, "funding_success_fee");
    assert.equal(inv[0].status, "sent");
  });

  test("the closeout record and the invoice agree on the same basis", async () => {
    const clientId = await makeClient("agree", 10);
    const round = await walkToApproved(clientId);
    await addApproval(clientId, round.id, "Bank A", 12500);
    await addApproval(clientId, round.id, "Bank B", 7500);

    const funded = await move(clientId, "funded", { fundedAmount: 55000 });
    await runF07(clientId, funded.roundEvent, "00000000-0000-4000-8000-00000000fe02");

    const closeout = await closeoutFor(round.id);
    assert.ok(closeout, "no closeout row");
    assert.equal(Number(closeout.total_approved_amount), 20000,
      "total_approved_amount finally means what its name says");
    assert.equal(Number(closeout.total_fee), 2000);
    assert.equal(Number(closeout.balance_due), 2000);

    const inv = await invoicesFor(clientId);
    assert.equal(inv.length, 1);
    assert.equal(Number(inv[0].amount_due), Number(closeout.total_fee),
      "the bill and the closing record must be the same number");

    const items = (await db.query(
      `SELECT * FROM funding_closeout_items WHERE funding_closeout_id = $1`, [closeout.id]
    )).rows;
    assert.equal(items.length, 2, "one line per confirmed approval");
    assert.equal(
      items.reduce((s, i) => s + Number(i.fee_amount), 0),
      Number(closeout.total_fee),
      "the lender lines must add up to the fee exactly"
    );
  });

  test("the same round twice raises one invoice, not two", async () => {
    const clientId = await makeClient("replay", 10);
    const round = await walkToApproved(clientId);
    await addApproval(clientId, round.id, "Bank A", 30000);

    const funded = await move(clientId, "funded", { fundedAmount: 30000 });
    const eventId = "00000000-0000-4000-8000-00000000fe03";
    await runF07(clientId, funded.roundEvent, eventId);
    const afterFirst = (await invoicesFor(clientId)).length;
    assert.equal(afterFirst, 1);

    // Same event again, and again under a brand new event id — both dimensions.
    await runF07(clientId, funded.roundEvent, eventId);
    await runF07(clientId, funded.roundEvent, "00000000-0000-4000-8000-00000000fe04");
    const inv = await invoicesFor(clientId);
    assert.equal(inv.length, 1, "the client was billed the success fee more than once");
    assert.equal(Number(inv[0].amount_due), 3000);
  });

  test("approvals with no recorded amount raise NO invoice and give a named reason", async () => {
    const clientId = await makeClient("unconfirmed", 10);
    const round = await walkToApproved(clientId);
    // Two banks said yes. Nobody has been told the limits yet, which is a real
    // state (owner-set 2026-08-29). Nothing here is confirmed.
    const a = await addApproval(clientId, round.id, "Bank A", null);
    const b = await addApproval(clientId, round.id, "Bank B", null);

    /* SINCE 2026-08-30 a blank approval holds the round open, so this state is
       reached the only way it now can be: somebody records that neither
       approval counts. That makes this the test for the ESCAPE'S WORST EDGE —
       exclude everything and there is nothing left to bill. The answer must
       still be no invoice and a named reason, never a $0 invoice. */
    assert.equal((await move(clientId, "funded", { fundedAmount: 40000 })).moved, false,
      "two blank approvals must hold the round open");
    for (const appId of [a, b]) {
      await setApprovalExclusion(db, {
        orgId, applicationId: appId, excluded: true,
        reason: "Never used", staff
      });
    }

    const funded = await move(clientId, "funded", { fundedAmount: 40000 });
    assert.equal(funded.moved, true, funded.message);
    assert.equal(funded.roundEvent.payload.approvedAmount, null,
      "nothing confirmed must be null on the event, never the funded amount");

    const res = await runF07(clientId, funded.roundEvent, "00000000-0000-4000-8000-00000000fe05");
    assert.equal(res.feeReady, false);
    assert.equal(res.reason, NO_CONFIRMED_APPROVALS);

    const inv = await invoicesFor(clientId);
    assert.equal(inv.length, 0, "a $0 invoice is worse than no invoice — there must be neither");

    assert.equal(await closeoutFor(round.id), null,
      "and no $0 closeout row either");

    const tasks = (await db.query(
      `SELECT * FROM tasks WHERE client_id = $1 AND source_workflow = $2`,
      [clientId, "f-07-funding-locked-fee-not-ready"])).rows;
    assert.equal(tasks.length, 1, "a person must be told, in words");
    assert.match(tasks[0].title, /confirmed approvals/i);
  });

  test("a round whose sale agreed no rate refuses with its own named reason", async () => {
    const clientId = await makeClient("norate", null);
    const round = await walkToApproved(clientId);
    await addApproval(clientId, round.id, "Bank A", 25000);

    const funded = await move(clientId, "funded", { fundedAmount: 25000 });
    assert.equal(funded.roundEvent.payload.approvedAmount, 25000);
    assert.equal(funded.roundEvent.payload.feePercent, null, "no rate must not become 10");

    const res = await runF07(clientId, funded.roundEvent, "00000000-0000-4000-8000-00000000fe06");
    assert.equal(res.feeReady, false);
    assert.equal(res.reason, NO_AGREED_FEE_PERCENT);
    assert.equal((await invoicesFor(clientId)).length, 0);
    assert.equal(await closeoutFor(round.id), null);
  });

  test("a rate that is not 10% is honoured, not rounded to the house default", async () => {
    const clientId = await makeClient("twelve", 12.5);
    const round = await walkToApproved(clientId);
    await addApproval(clientId, round.id, "Bank A", 40000);

    const funded = await move(clientId, "funded", { fundedAmount: 40000 });
    assert.equal(Number(funded.roundEvent.payload.feePercent), 12.5);

    const res = await runF07(clientId, funded.roundEvent, "00000000-0000-4000-8000-00000000fe07");
    assert.equal(res.feeAmount, "5000.00", "40000 at 12.5%");

    const closeout = await closeoutFor(round.id);
    assert.equal(Number(closeout.total_fee), 5000);
    assert.equal(Number(closeout.fee_percent), 0.125,
      "the column keeps the rate as a fraction; the code passes percent units");
  });
});
