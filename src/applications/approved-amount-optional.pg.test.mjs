// Real-Postgres: AN APPROVAL AND ITS DOLLAR AMOUNT ARE TWO SEPARATE MOMENTS.
//
// OWNER-SET 2026-08-29. When a bank comes back, the fulfillment team (the
// funding advisor who submits the applications — not a closer, closers close
// clients) very often does not know the limit yet. They have to ask the client,
// or wait for the bank's approval email to arrive through the mail routing that
// watches for keywords and surfaces matches in that client's inbox. So
// "approved, amount unknown" is a REAL AND VALID STATE, not an error.
//
// WHAT EACH TEST HERE PINS DOWN, and why it must not be relaxed:
//
//   1. A "Bank yes" with NO amount SAVES, and approved_amount stays NULL.
//      NULL means UNKNOWN. A 0 would be a claim that the bank approved
//      nothing, and that claim flows into a client's success-fee invoice
//      looking perfectly legitimate (docs/finance/CLOSEOUT-FEE-BASIS.md). This is the
//      assertion that must never be softened to `>= 0` or `!= undefined`.
//
//   2. The amount can be filled in LATER, onto the SAME application row. No
//      second application, no duplicate approval, no lost play name.
//
//   3. FUNDED IS STILL STRICTLY GATED. An approval carrying no amount cannot
//      be turned into a funded round. Two moments, two rules: the approval is
//      allowed to be incomplete, the number a client is billed from is not.
//
//   4. A NULL approved amount does not break the closeout that bills the
//      client, and it does not get billed. An approval with no recorded amount
//      is not a CONFIRMED approval, so it is left out of the lender breakdown
//      AND out of the fee basis — never counted as a zero.
//
//      UPDATED owner-set 2026-08-30: the fee basis is now the confirmed
//      approvals total, not funding_rounds.funded_amount. That makes the
//      distinction this whole file is about — "approved" versus "approved for
//      a known amount" — the thing the client is billed from, so it matters
//      more here than it ever did. docs/finance/CLOSEOUT-FEE-BASIS.md.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { logBankDecision, setApprovalExclusion } from "./status.mjs";
import { guardFundedAmount } from "../funding/card-stacking-rounds.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { createFundingCloseout } from "../funding/closeout.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = `approved_optional_${Date.now().toString(36)}`;

describe("approval now, amount later (pg)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgId;
  let clientId;
  let lenderA;
  let lenderB;
  let staff;

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
      await db.query(`DELETE FROM application_decisions WHERE application_id IN (
        SELECT id FROM applications WHERE client_id = ANY($1))`, [clients]).catch(() => {});
      await db.query(`DELETE FROM applications WHERE client_id = ANY($1)`, [clients]).catch(() => {});
      await db.query(`DELETE FROM funding_round_sales WHERE funding_round_id IN (
        SELECT id FROM funding_rounds WHERE client_id = ANY($1))`, [clients]).catch(() => {});
      await db.query(`DELETE FROM funding_rounds WHERE client_id = ANY($1)`, [clients]).catch(() => {});
      await db.query(`DELETE FROM sales WHERE client_id = ANY($1)`, [clients]).catch(() => {});
      await db.query(`DELETE FROM cards WHERE client_id = ANY($1)`, [clients]).catch(() => {});
      await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [clients]).catch(() => {});
      await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [clients]).catch(() => {});
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
    }
    await db.query(`DELETE FROM lenders WHERE external_row_id LIKE $1`, [`${MARK}%`]).catch(() => {});
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${MARK}%`]).catch(() => {});
  }

  before(async () => {
    _resetOrgCache();
    // No handlers: this file is about the guard and the column, not the money
    // chain. round.* events fire into an empty bus and write their event rows.
    clearHandlers();
    orgId = await resolveDefaultOrg(db);
    await wipe();

    // Every bank answer is saved against a real staff member (migration 494).
    const staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1, $2, 'Funding Advisor', 'funding_advisor', 'active') RETURNING id`,
      [orgId, `${MARK}.advisor@example.com`]
    )).rows[0].id;
    staff = { id: staffId, name: "Funding Advisor" };

    clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, outcome_tier)
       VALUES ($1, $2, 'Amount', 'Later', 'FULL_FUNDING') RETURNING id`,
      [orgId, `${MARK}.client@example.com`]
    )).rows[0].id;

    /* A funding sale at 10%. There is no fee without one: the rate the client
       is billed at is the rate agreed on their sale, and no agreed rate is a
       refusal rather than a house default (owner-set 2026-08-30). */
    const fundingProductId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy' LIMIT 1`,
      [orgId]
    )).rows[0]?.id;
    assert.ok(fundingProductId, "card-stacking-dfy product must exist");
    await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price,
                          agreed_success_fee_percent, status, sold_at)
       VALUES ($1, $2, $3, 3000, 10, 'active', now())`,
      [orgId, clientId, fundingProductId]
    );

    lenderA = (await db.query(
      `INSERT INTO lenders (org_id, lender_table, name, active, priority_tier,
                            bureaus_pulled, eligible_states, external_row_id, is_demo)
       VALUES ($1, 'OnlineBizCC', 'Mesa Community Bank', true, 1, 'EQ', 'All States', $2, false)
       RETURNING id`,
      [orgId, `${MARK}-A`]
    )).rows[0].id;

    lenderB = (await db.query(
      `INSERT INTO lenders (org_id, lender_table, name, active, priority_tier,
                            bureaus_pulled, eligible_states, external_row_id, is_demo)
       VALUES ($1, 'OnlineBizCC', 'Second State Bank', true, 1, 'EQ', 'All States', $2, false)
       RETURNING id`,
      [orgId, `${MARK}-B`]
    )).rows[0].id;
  });

  after(async () => {
    await wipe();
    await close();
    clearHandlers();
  });

  test("1. Bank yes with NO amount saves, and the amount stays NULL — never 0", async () => {
    const app = await logBankDecision(db, {
      orgId,
      clientId,
      lenderId: lenderA,
      status: "Approved",
      playName: "Card stacking first pull",
      staff
    });

    assert.equal(app.status, "Approved", "the approval itself is recorded");

    /* Read the column back raw, and ask POSTGRES whether it is null rather
       than asking JavaScript — `Number(null)` is 0, so a coercion check here
       would prove nothing at all. `is_null` and the text cast both come from
       the database's own answer. This is the assertion the whole design rests
       on: it must never be softened to `>= 0` or `!= undefined`. */
    const raw = (await db.query(
      `SELECT approved_amount,
              approved_amount IS NULL     AS is_null,
              approved_amount = 0         AS is_zero,
              approved_amount::text       AS as_text
         FROM applications WHERE id = $1`,
      [app.id]
    )).rows[0];
    assert.equal(raw.is_null, true, "unknown must stay NULL in the column");
    assert.equal(raw.is_zero, null,
      "a comparison against 0 must be UNKNOWN, which is only true of a real NULL");
    assert.equal(raw.as_text, null, "and nothing wrote a '0' string either");
    assert.equal(raw.approved_amount, null, "and it reaches the app as null, not 0");

    // The decision audit row exists too, so the approval is a real, dated fact
    // even with no money against it.
    const decisions = (await db.query(
      `SELECT status, play_name FROM application_decisions WHERE application_id = $1`,
      [app.id]
    )).rows;
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].status, "Approved");
  });

  test("2. an approval with no amount still cannot be marked funded", async () => {
    /* THE REASON CODE CHANGED ON 2026-08-30, and it got more specific.
       It used to be `funded_amount_required` — the round was refused because
       nothing could suggest a funded amount. Now the blank approval is refused
       in its own right, BEFORE the funded amount is even considered, because we
       bill a percent of the approvals that carry an amount and a blank one is
       never invoiced. Same answer to the same question — the card does not
       reach Funded — but the refusal now names the bank to go and fill in. */
    const guard = await guardFundedAmount(db, { orgId, clientId });
    assert.equal(guard.ok, false, "the funded guard must still refuse");
    assert.equal(guard.reason, "approval_amounts_missing");
    assert.equal(guard.suggestedFundedAmount, null,
      "an approval with no amount suggests nothing — it must not suggest 0");

    // And the real path a person takes: dragging the card onto Funded.
    const move = await moveCardToStage(db, {
      orgId,
      clientId,
      pipelineKey: "funding_card_stacking",
      stageKey: "funded"
    });
    assert.equal(move.moved, false, "the card must not reach Funded");
    assert.equal(move.reason, "approval_amounts_missing");

    const round = (await db.query(
      `SELECT status, funded_amount FROM funding_rounds WHERE client_id = $1`,
      [clientId]
    )).rows[0];
    assert.notEqual(round.status, "funded");
    assert.equal(round.funded_amount, null, "and nothing wrote a zero funded amount either");
  });

  test("3. the amount can be filled in later, onto the SAME application row", async () => {
    const before = (await db.query(
      `SELECT id FROM applications WHERE client_id = $1 AND lender_id = $2`,
      [clientId, lenderA]
    )).rows;
    assert.equal(before.length, 1, "one application exists before the amount arrives");

    const filled = await logBankDecision(db, {
      orgId,
      clientId,
      lenderId: lenderA,
      status: "Approved",
      approvedAmount: "$45,000",
      staff
    });

    assert.equal(filled.id, before[0].id, "the same approval, not a second one");
    assert.equal(Number(filled.approved_amount), 45000);

    const after = (await db.query(
      `SELECT id, approved_amount FROM applications WHERE client_id = $1 AND lender_id = $2`,
      [clientId, lenderA]
    )).rows;
    assert.equal(after.length, 1, "still exactly one application for this lender");
    assert.equal(Number(after[0].approved_amount), 45000);
  });

  test("4. with the amount in, the round funds — and the closeout ignores an unpriced approval", async () => {
    // A SECOND bank that said yes and whose limit nobody has learned yet. It
    // must not drag the fee down, and it must not crash the closeout.
    const unpriced = await logBankDecision(db, {
      orgId,
      clientId,
      lenderId: lenderB,
      status: "Approved",
      staff
    });

    /* SINCE 2026-08-30 THAT SECOND APPROVAL BLOCKS THE ROUND. It would never be
       invoiced — we bill a percent of the approvals that carry an amount — so
       closing the round on top of it is money we silently never charge for.
       The refusal names the bank. */
    const blocked = await moveCardToStage(db, {
      orgId, clientId, pipelineKey: "funding_card_stacking", stageKey: "funded"
    });
    assert.equal(blocked.moved, false, "an unpriced approval must hold the round open");
    assert.equal(blocked.reason, "approval_amounts_missing");

    /* The way out, and the only way out: somebody says on the record that this
       approval does not count. The bank's yes is NOT changed — this is not a
       denial — so everything below still reads it as an approval. */
    await setApprovalExclusion(db, {
      orgId,
      applicationId: unpriced.id,
      excluded: true,
      reason: "Bank never told us the limit and the client did not use it",
      staff
    });

    // Approved limit $45,000 is not proof of available funding. After the
    // unpriced application is excluded, approval-only still cannot fund.
    const approvalOnly = await moveCardToStage(db, {
      orgId, clientId, pipelineKey: "funding_card_stacking", stageKey: "funded"
    });
    assert.equal(approvalOnly.moved, false);
    assert.equal(approvalOnly.reason, "funded_amount_required");

    // Synthetic operator-verified funding is separately recorded at $40,000,
    // distinct from the $45,000 confirmed-approval fee basis.
    const move = await moveCardToStage(db, {
      orgId,
      clientId,
      pipelineKey: "funding_card_stacking",
      stageKey: "funded",
      fundedAmount: 40000
    });
    assert.equal(move.moved, true, move.message);
    assert.equal(move.fundedAmount, 40000);

    const round = (await db.query(
      `SELECT id, status, funded_amount FROM funding_rounds WHERE client_id = $1`,
      [clientId]
    )).rows[0];
    assert.equal(round.status, "funded");
    assert.equal(Number(round.funded_amount), 40000, "funded cash differs from approved limit");

    /* money-chain links the round to the client's sale at round.started; this
       file deliberately runs with an empty bus, so the link is made here. The
       closeout reads the agreed rate through it. */
    await db.query(
      `INSERT INTO funding_round_sales (org_id, funding_round_id, sale_id, link_method)
       SELECT $1, $2, id, 'explicit' FROM sales WHERE client_id = $3 LIMIT 1
       ON CONFLICT (funding_round_id) DO NOTHING`,
      [orgId, round.id, clientId]
    );

    const { closeout, items, feeBasis } = await createFundingCloseout(db, {
      orgId,
      fundingRoundId: round.id
    });
    assert.ok(closeout, "the success-fee closeout is created");
    assert.equal(feeBasis, 45000,
      "the basis is the ONE confirmed approval — the unpriced one adds nothing, not a zero");
    assert.equal(Number(closeout.total_approved_amount), 45000);
    assert.equal(Number(closeout.total_fee), 4500, "10% of the 45000 confirmed");
    assert.equal(items.length, 1,
      "only the approval with a real amount is a line item — the unpriced one is left out, not billed as 0");
  });
});
