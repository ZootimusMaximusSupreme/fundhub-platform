// Real-Postgres: Card Stacking stage moves emit round.* and drive money-chain.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { register as registerMoneyChain } from "../handlers/money-chain.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { STAGE_TO_EVENT, PRODUCT } from "./card-stacking-rounds.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = `cs_round_${Date.now().toString(36)}`;

describe("card-stacking round emitter (pg)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgId;
  let clientId;
  let advisorId;
  let fundingProductId;

  async function wipe() {
    const clients = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`]
    )).rows.map((r) => r.id);
    if (clients.length) {
      await db.query(`DELETE FROM funding_closeout_items WHERE funding_closeout_id IN (
        SELECT id FROM funding_closeout WHERE funding_round_id IN (
          SELECT id FROM funding_rounds WHERE client_id = ANY($1)))`, [clients]).catch(() => {});
      await db.query(`DELETE FROM funding_closeout WHERE funding_round_id IN (
        SELECT id FROM funding_rounds WHERE client_id = ANY($1))`, [clients]).catch(() => {});
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
      await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [clients]);
      /* tasks blocks the client delete. tasks_client_id_fkey is one of the 16
         client foreign keys that deliberately do NOT cascade (invoices,
         contracts, transactions, the audit logs and this one) — a client
         going away must not silently take financial or audit rows with it.
         The money-chain workflows this test drives write a task, so the wipe
         has to clear it explicitly before the client row can go. */
      await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${MARK}%`]);
  }

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    registerMoneyChain();
    orgId = await resolveDefaultOrg(db);
    await wipe();

    advisorId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1, $2, 'CS Advisor', 'funding_advisor', 'active') RETURNING id`,
      [orgId, `${MARK}.advisor@example.com`]
    )).rows[0].id;

    clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, outcome_tier)
       VALUES ($1, $2, 'Card', 'Stack', 'FULL_FUNDING') RETURNING id`,
      [orgId, `${MARK}.client@example.com`]
    )).rows[0].id;

    fundingProductId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy' LIMIT 1`,
      [orgId]
    )).rows[0]?.id;
    assert.ok(fundingProductId, "card-stacking-dfy product must exist");

    const saleId = (await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, agreed_success_fee_percent, status, sold_at)
       VALUES ($1, $2, $3, 3000, 10, 'active', now()) RETURNING id`,
      [orgId, clientId, fundingProductId]
    )).rows[0].id;

    await db.query(
      `INSERT INTO sale_attributions (org_id, sale_id, staff_id, role, basis, split_percent)
       VALUES ($1, $2, $3, 'funding_advisor', 'back_end', 100)`,
      [orgId, saleId, advisorId]
    );

    // Pipeline must exist for default org (seeded).
    const pipe = (await db.query(
      `SELECT id FROM pipelines WHERE org_id = $1 AND key = 'funding_card_stacking'`,
      [orgId]
    )).rows[0];
    assert.ok(pipe, "funding_card_stacking pipeline seeded for default org");
  });

  after(async () => {
    await wipe();
    await close();
    clearHandlers();
  });

  test("stage map", () => {
    assert.equal(STAGE_TO_EVENT.apply_now, "round.started");
    assert.equal(STAGE_TO_EVENT.round_submitted, "round.submitted");
    assert.equal(STAGE_TO_EVENT.approved, "round.approved");
    assert.equal(STAGE_TO_EVENT.funded, "round.funded");
    assert.equal(STAGE_TO_EVENT.action_required, null);
    assert.equal(STAGE_TO_EVENT.closed, "round.closeout");
  });

  test("four-stage walk + funded guard + closeout fee", async () => {
    const move = (stageKey, extra = {}) =>
      moveCardToStage(db, {
        orgId, clientId, pipelineKey: "funding_card_stacking", stageKey, ...extra
      });

    const start = await move("apply_now");
    assert.equal(start.moved, true);
    assert.equal(start.roundEvent.eventName, "round.started");
    assert.equal(start.roundEvent.deduped, false);

    let rounds = (await db.query(
      `SELECT * FROM funding_rounds WHERE client_id = $1`, [clientId]
    )).rows;
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].product, PRODUCT);
    assert.equal(rounds[0].status, "started");

    assert.equal((await move("apply_now")).roundEvent.deduped, true);

    assert.equal((await move("round_submitted")).roundEvent.eventName, "round.submitted");
    assert.equal((await move("approved")).roundEvent.eventName, "round.approved");

    await db.query(
      `INSERT INTO applications (org_id, funding_round_id, client_id, bank, status, approved_amount)
       VALUES ($1, $2, $3, 'Bank A', 'Approved', 20000),
              ($1, $2, $3, 'Bank B', 'Approved', 15000)`,
      [orgId, rounds[0].id, clientId]
    );

    const zero = await move("funded", { fundedAmount: 0 });
    assert.equal(zero.moved, false);
    assert.equal(zero.reason, "funded_amount_required");
    assert.match(zero.message, /funded amount/i);

    const stage = (await db.query(
      `SELECT s.key FROM cards c JOIN pipeline_stages s ON s.id = c.stage_id
        WHERE c.client_id = $1`, [clientId]
    )).rows[0];
    assert.equal(stage.key, "approved", "card must not reach funded without amount");

    // A bank said yes to 35000, but the client has not independently funded.
    // An omitted amount and a mere approvedAmount must NOT publish round.funded,
    // move the card, or make closeout/fee records.
    for (const attempt of [{}, { approvedAmount: 35000 }]) {
      const refused = await move("funded", attempt);
      assert.equal(refused.moved, false);
      assert.equal(refused.reason, "funded_amount_required");
      assert.equal(refused.suggestedFundedAmount, 35000);
    }
    const stillApproved = (await db.query(
      `SELECT s.key FROM cards c JOIN pipeline_stages s ON s.id = c.stage_id WHERE c.client_id = $1`,
      [clientId]
    )).rows[0];
    assert.equal(stillApproved.key, "approved");
    assert.equal((await db.query(
      `SELECT count(*)::int AS n FROM events WHERE client_id = $1 AND name = 'round.funded'`, [clientId]
    )).rows[0].n, 0);
    assert.equal((await db.query(
      `SELECT count(*)::int AS n FROM funding_closeout WHERE funding_round_id = $1`, [rounds[0].id]
    )).rows[0].n, 0);

    // Separate staff-recorded amount, deliberately DIFFERENT from approval total.
    // Provider cash receipt is still a distinct real-world acceptance gate.
    const funded = await move("funded", { fundedAmount: 30000 });
    assert.equal(funded.moved, true, funded.message);
    assert.equal(funded.fundedAmount, 30000);
    assert.equal(funded.roundEvent.eventName, "round.funded");
    const replay = await move("funded");
    assert.equal(replay.moved, true);
    assert.equal(replay.roundEvent.deduped, true, "same funded round must not publish a second event");

    rounds = (await db.query(
      `SELECT * FROM funding_rounds WHERE client_id = $1`, [clientId]
    )).rows;
    assert.equal(rounds[0].status, "funded");
    assert.equal(Number(rounds[0].funded_amount), 30000, "recorded funded amount is separate from approved total");
    assert.equal(rounds[0].product, PRODUCT);

    const closeout = (await db.query(
      `SELECT * FROM funding_closeout WHERE funding_round_id = $1`,
      [rounds[0].id]
    )).rows[0];
    assert.ok(closeout, "closeout row");
    assert.equal(Number(closeout.total_fee), 3500, "10% of 35000");
    // Fee basis remains CONFIRMED APPROVALS (owner-set 2026-08-30), 35000.
    // Explicit funded amount is 30000; approval is NOT automatically funding.
    // This tests the separation, not a provider receipt or settled cash.
    assert.equal(Number(closeout.total_approved_amount), 35000, "fee basis = confirmed approvals");

    /* NO back-end ledger row, and that is the correct outcome.

       This used to assert `ledger.length >= 1`. It was written before the owner
       set the real commission schedule in 246_owner_commission_rates_20260820,
       248_owner_motion_commission_rates_20260820 and
       256_owner_closer_deposit_one_sixth_20260823. Those migrations leave
       exactly two back_end rules, both scoped to role closer / sales_manager AND
       to one specific product_id. This fixture attributes its sale to a
       `funding_advisor` on a different product, so no rule matches.

       src/commissions/calculate.mjs deliberately earns NOTHING when no rule
       matches — never a guessed zero (the same principle as "THE AF-04 GAP: a
       conversion with no rule configured earns NULL, not zero"). So the absence
       of a row here is the money engine behaving correctly, and the old
       assertion was asserting a commission the owner's schedule does not pay.

       Kept as a real assertion rather than deleted: this fails if the engine
       ever starts inventing a commission with no matching rule, and the second
       assertion fails if somebody adds a funding_advisor back_end rule without
       revisiting this test. Back-end accrual itself is covered against real
       rules in src/commissions/calculate.test.mjs. */
    const ledger = (await db.query(
      `SELECT * FROM commission_ledger
        WHERE funding_round_id = $1 AND basis = 'back_end'`,
      [rounds[0].id]
    )).rows;
    assert.equal(ledger.length, 0,
      "no back_end rule matches a funding_advisor on this product — the engine must not invent one");

    const advisorRule = (await db.query(
      `SELECT 1 FROM commission_rules
        WHERE basis = 'back_end' AND role = 'funding_advisor' AND active`
    )).rows;
    assert.equal(advisorRule.length, 0,
      "the premise above: the owner's schedule pays no back_end commission to a funding_advisor");

    const evCounts = (await db.query(
      `SELECT name, count(*)::int n FROM events
        WHERE client_id = $1 AND name LIKE 'round.%'
        GROUP BY name ORDER BY name`,
      [clientId]
    )).rows;
    const byName = Object.fromEntries(evCounts.map((r) => [r.name, r.n]));
    assert.equal(byName["round.started"], 1);
    assert.equal(byName["round.submitted"], 1);
    assert.equal(byName["round.approved"], 1);
    assert.equal(byName["round.funded"], 1);
  });
});
