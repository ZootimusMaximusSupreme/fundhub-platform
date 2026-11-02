/* Real-Postgres: a round cannot be marked Funded while a bank yes on it still
   has no dollar amount — and the recorded way out when the amount is never
   coming.

   WHY. The success fee is a percent of CONFIRMED APPROVALS: Approved rows that
   carry a real recorded amount (docs/finance/CLOSEOUT-FEE-BASIS.md). An approval nobody
   typed a number into is worth nothing on the bill, and once the round closes
   nobody goes back for it. So the blank one blocks the close.

   The escape has to stay honest, so these tests also pin the two things that
   would quietly corrupt reporting if they ever regressed: excluding an approval
   never changes what the BANK said, and the exclusion never lands in the bank
   yes/no history as an outcome. */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { guardFundedAmount } from "./card-stacking-rounds.mjs";
import {
  sumConfirmedApprovals,
  listUnpricedApprovals,
  unpricedApprovalNames,
  NO_CONFIRMED_APPROVALS
} from "./success-fee.mjs";
import {
  setApprovalExclusion,
  logBankDecision,
  ApplicationStatusError
} from "../applications/status.mjs";
import { listOutcomesForLaterPlays } from "../plays/outcomes.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = `appguard_${Date.now().toString(36)}`;

describe("funded move blocks on an approval with no amount (pg)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgId;
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
      await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${MARK}%`]);
  }

  /* One client, walked as far as the Approved column, with a sale that agreed a
     10% success fee. Each test gets its own so the rounds cannot collide. */
  let seq = 0;
  async function makeClient() {
    seq += 1;
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, outcome_tier)
       VALUES ($1, $2, 'Guard', 'Case', 'FULL_FUNDING') RETURNING id`,
      [orgId, `${MARK}.c${seq}@example.com`]
    )).rows[0].id;

    const productId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy' LIMIT 1`,
      [orgId]
    )).rows[0]?.id;
    await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, agreed_success_fee_percent, status, sold_at)
       VALUES ($1, $2, $3, 3000, 10, 'active', now())`,
      [orgId, clientId, productId]
    );

    const move = (stageKey, extra = {}) =>
      moveCardToStage(db, {
        orgId, clientId, pipelineKey: "funding_card_stacking", stageKey, ...extra
      });
    await move("apply_now");
    await move("round_submitted");
    await move("approved");

    const roundId = (await db.query(
      `SELECT id FROM funding_rounds WHERE client_id = $1 ORDER BY round_number DESC LIMIT 1`,
      [clientId]
    )).rows[0].id;
    return { clientId, roundId, move };
  }

  /* A bank yes. `amount` null leaves approved_amount NULL — the blank approval
     this whole guard exists for. */
  async function addApproval(roundId, clientId, bank, amount) {
    return (await db.query(
      `INSERT INTO applications (org_id, funding_round_id, client_id, bank, lender_name, status, approved_amount)
       VALUES ($1, $2, $3, $4, $4, 'Approved', $5) RETURNING id`,
      [orgId, roundId, clientId, bank, amount]
    )).rows[0].id;
  }

  async function stageOf(clientId) {
    return (await db.query(
      `SELECT s.key FROM cards c
         JOIN pipeline_stages s ON s.id = c.stage_id
         JOIN pipelines p ON p.id = c.pipeline_id
        WHERE c.client_id = $1 AND p.key = 'funding_card_stacking'`,
      [clientId]
    )).rows[0]?.key;
  }

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    orgId = await resolveDefaultOrg(db);
    await wipe();
    const staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1, $2, 'Dana Advisor', 'funding_advisor', 'active') RETURNING id`,
      [orgId, `${MARK}.advisor@example.com`]
    )).rows[0].id;
    staff = { id: staffId, name: "Dana Advisor", email: `${MARK}.advisor@example.com` };
  });

  after(async () => {
    await wipe();
    await close();
    clearHandlers();
  });

  test("every approval priced — the round funds normally", async () => {
    const { clientId, roundId, move } = await makeClient();
    await addApproval(roundId, clientId, "Bank A", 20000);
    await addApproval(roundId, clientId, "Bank B", 15000);

    assert.deepEqual(await listUnpricedApprovals(db, { orgId, fundingRoundId: roundId }), []);

    const approvalOnly = await move("funded");
    assert.equal(approvalOnly.moved, false, "fully priced approvals alone are not funded cash");
    assert.equal(approvalOnly.reason, "funded_amount_required");
    const funded = await move("funded", { fundedAmount: 30000 });
    assert.equal(funded.moved, true, funded.message);
    assert.equal(funded.fundedAmount, 30000);
    assert.equal(await stageOf(clientId), "funded");
    assert.equal(await sumConfirmedApprovals(db, { orgId, fundingRoundId: roundId }), 35000);
  });

  /* THE EMPTY CASE, and the one the live walk actually hit on 2026-09-16.
     The rule above only fires when there IS an approval sitting on the round
     with no dollar amount against it. A round with no applications at all fell
     straight through it, and round 1 on Sim Eight-Funding was marked funded for
     $25,000 with nothing on the file. Nothing was billed for it, correctly, so
     the round closed for free. */
  test("no bank yes at all — refused, with somewhere to go and type one", async () => {
    const { clientId, roundId, move } = await makeClient();

    assert.deepEqual(await listUnpricedApprovals(db, { orgId, fundingRoundId: roundId }), [],
      "nothing is blank, because there is nothing at all");

    const refused = await move("funded", { fundedAmount: 25000 });
    assert.equal(refused.moved, false, "a round with no bank yes must not close");
    assert.equal(refused.reason, "no_confirmed_approvals");
    assert.match(refused.message, /Bank yes/, "the refusal says which button to press");
    assert.equal(await stageOf(clientId), "approved", "the card must not reach funded");

    const round = (await db.query(
      `SELECT status, funded_amount FROM funding_rounds WHERE id = $1`, [roundId]
    )).rows[0];
    assert.notEqual(round.status, "funded");
    assert.equal(round.funded_amount, null, "and no funded amount was half-written");

    // Record the bank yes and the same move goes through.
    await addApproval(roundId, clientId, "Bank A", 25000);
    const funded = await move("funded", { fundedAmount: 25000 });
    assert.equal(funded.moved, true, funded.message);
    assert.equal(await stageOf(clientId), "funded");
  });

  test("one blank approval — refused, and the refusal names that bank", async () => {
    const { clientId, roundId, move } = await makeClient();
    await addApproval(roundId, clientId, "Bank A", 20000);
    await addApproval(roundId, clientId, "Chase Ink", null);

    const refused = await move("funded");
    assert.equal(refused.moved, false);
    assert.equal(refused.reason, "approval_amounts_missing");
    assert.match(refused.message, /Chase Ink/, "the refusal must name the bank to go and fill in");
    assert.ok(!/Bank A/.test(refused.message), "the priced bank is not the problem, so it is not named");
    assert.deepEqual(refused.missingApprovalBanks, ["Chase Ink"]);
    assert.equal(await stageOf(clientId), "approved", "the card must not reach funded");

    // Not overridable by sending money with the move — the blank approval is the
    // problem, and a funded amount does not answer it.
    const withAmount = await move("funded", { fundedAmount: 50000 });
    assert.equal(withAmount.moved, false);
    assert.equal(withAmount.reason, "approval_amounts_missing");
    assert.equal(await stageOf(clientId), "approved");

    // And the round is still open, so nothing was half-written.
    const round = (await db.query(`SELECT status, funded_amount FROM funding_rounds WHERE id = $1`, [roundId])).rows[0];
    assert.notEqual(round.status, "funded");
    assert.equal(round.funded_amount, null);
  });

  test("marking it 'doesn't count' lets the round fund, and leaves it out of the fee", async () => {
    const { clientId, roundId, move } = await makeClient();
    await addApproval(roundId, clientId, "Bank A", 20000);
    const deadId = await addApproval(roundId, clientId, "Chase Ink", null);

    assert.equal((await move("funded")).moved, false);

    await setApprovalExclusion(db, {
      orgId,
      applicationId: deadId,
      excluded: true,
      reason: "Client never used it",
      staff
    });

    assert.deepEqual(await listUnpricedApprovals(db, { orgId, fundingRoundId: roundId }), []);

    const funded = await move("funded", { fundedAmount: 18000 });
    assert.equal(funded.moved, true, funded.message);
    assert.equal(funded.fundedAmount, 18000);
    assert.equal(await stageOf(clientId), "funded");

    // The fee basis is Bank A alone. The excluded approval adds nothing, and
    // crucially is not counted as a zero either.
    assert.equal(await sumConfirmedApprovals(db, { orgId, fundingRoundId: roundId }), 20000);
    assert.equal(funded.roundEvent.payload.approvedAmount, 20000);
  });

  test("the exclusion is recorded — who, when, and why", async () => {
    const { clientId, roundId } = await makeClient();
    const appId = await addApproval(roundId, clientId, "Amex Blue", null);

    const before = new Date();
    await setApprovalExclusion(db, {
      orgId, applicationId: appId, excluded: true,
      reason: "Approval withdrawn by the bank", staff
    });

    const row = (await db.query(
      `SELECT status, approved_amount, approval_excluded_at, approval_excluded_by, approval_exclusion_reason
         FROM applications WHERE id = $1`, [appId]
    )).rows[0];
    assert.ok(row.approval_excluded_at, "when");
    assert.ok(new Date(row.approval_excluded_at) >= new Date(before.getTime() - 60000));
    assert.equal(row.approval_excluded_by, "Dana Advisor", "who");
    assert.equal(row.approval_exclusion_reason, "Approval withdrawn by the bank", "why");

    // NULL survives: excluding never invents a zero amount.
    assert.equal(row.approved_amount, null);

    // And the bank's answer is untouched.
    assert.equal(row.status, "Approved");

    const audit = (await db.query(
      `SELECT event_type, status, created_by, notes, decided_at
         FROM application_decisions WHERE application_id = $1 AND event_type = 'approval_excluded'`,
      [appId]
    )).rows;
    assert.equal(audit.length, 1, "one audit row, same trail as every other decision");
    assert.equal(audit[0].created_by, "Dana Advisor");
    assert.equal(audit[0].notes, "Approval withdrawn by the bank");
    assert.ok(audit[0].decided_at);
    assert.equal(audit[0].status, null, "an exclusion is not a bank outcome");
  });

  test("an exclusion is not a denial — approval-rate reporting is untouched", async () => {
    const { clientId, roundId } = await makeClient();
    const appId = await addApproval(roundId, clientId, "Citi Premier", null);
    await setApprovalExclusion(db, {
      orgId, applicationId: appId, excluded: true, reason: "Never used", staff
    });

    const outcomes = await listOutcomesForLaterPlays(db, { orgId, clientId });
    const nos = outcomes.filter((o) => o.outcome === "no");
    assert.equal(nos.length, 0, "excluding must never register as a bank no");

    // The row still reads as an approval everywhere status is what is asked.
    const status = (await db.query(`SELECT status FROM applications WHERE id = $1`, [appId])).rows[0].status;
    assert.equal(status, "Approved");
  });

  test("putting it back makes it count again, and is recorded too", async () => {
    const { clientId, roundId, move } = await makeClient();
    await addApproval(roundId, clientId, "Bank A", 20000);
    const appId = await addApproval(roundId, clientId, "Barclays", null);

    await setApprovalExclusion(db, { orgId, applicationId: appId, excluded: true, reason: "Withdrawn", staff });
    await setApprovalExclusion(db, { orgId, applicationId: appId, excluded: false, reason: "Client used it after all", staff });

    const row = (await db.query(
      `SELECT approval_excluded_at, approval_excluded_by, approval_exclusion_reason
         FROM applications WHERE id = $1`, [appId]
    )).rows[0];
    assert.equal(row.approval_excluded_at, null);
    assert.equal(row.approval_excluded_by, null);
    assert.equal(row.approval_exclusion_reason, null);

    const back = (await db.query(
      `SELECT created_by FROM application_decisions
        WHERE application_id = $1 AND event_type = 'approval_reinstated'`, [appId]
    )).rows;
    assert.equal(back.length, 1);
    assert.equal(back[0].created_by, "Dana Advisor");

    // Blocking again is the proof it really counts once more.
    const refused = await move("funded");
    assert.equal(refused.moved, false);
    assert.equal(refused.reason, "approval_amounts_missing");
    assert.match(refused.message, /Barclays/);
  });

  test("an excluded approval that DOES have an amount is still left out of the fee", async () => {
    const { clientId, roundId, move } = await makeClient();
    await addApproval(roundId, clientId, "Bank A", 20000);
    const pulled = await addApproval(roundId, clientId, "Wells Fargo", 9000);

    await setApprovalExclusion(db, {
      orgId, applicationId: pulled, excluded: true,
      reason: "Approval pulled after we recorded it", staff
    });

    assert.equal(
      await sumConfirmedApprovals(db, { orgId, fundingRoundId: roundId }),
      20000,
      "an approval we are not billing for is not billed at any size"
    );
    const funded = await move("funded", { fundedAmount: 19000 });
    assert.equal(funded.moved, true, funded.message);
    assert.equal(funded.fundedAmount, 19000);
    assert.equal(funded.roundEvent.payload.approvedAmount, 20000);
  });

  test("an explicit zero is still refused as a denial, not accepted as an approval", async () => {
    const { clientId, roundId } = await makeClient();
    const appId = await addApproval(roundId, clientId, "Bank Z", null);

    await assert.rejects(
      () => logBankDecision(db, {
        orgId, applicationId: appId, status: "Approved", approvedAmount: "0", staff
      }),
      (err) => {
        assert.ok(err instanceof ApplicationStatusError);
        assert.equal(err.code, "invalid_approved_amount");
        assert.match(err.message, /denial, not an approval/);
        return true;
      }
    );

    // A refused zero leaves the amount unknown — it never becomes 0, and the
    // approval therefore still blocks the round rather than billing for nothing.
    const row = (await db.query(`SELECT approved_amount FROM applications WHERE id = $1`, [appId])).rows[0];
    assert.equal(row.approved_amount, null);
    assert.deepEqual(
      unpricedApprovalNames(await listUnpricedApprovals(db, { orgId, fundingRoundId: roundId })),
      ["Bank Z"]
    );
  });

  /* CHANGED 2026-09-17. This test used to assert that a round with no bank yes
     on it at all still funded on an explicit amount ("behaves exactly as it did
     before"). That is the exact hole the 2026-09-16 live walk caught: round 1 on
     Sim Eight-Funding was marked funded for $25,000 with zero application rows,
     and because the fee is a percent of confirmed approvals, that round could
     never be invoiced. The owner's instruction is that a funded move requires at
     least one approved bank application on the round. So the refusal below is
     the intended behaviour and the old assertion encoded the defect. */
  test("a round with no bank yes on it cannot be funded, with or without an amount", async () => {
    const { clientId, roundId, move } = await makeClient();
    assert.deepEqual(await listUnpricedApprovals(db, { orgId, fundingRoundId: roundId }), []);

    // Nothing on the round at all → the no-bank-yes refusal, not the amount one.
    // There is no blank approval to name, so the message points at the box to fill.
    const bare = await move("funded");
    assert.equal(bare.moved, false);
    assert.equal(bare.reason, NO_CONFIRMED_APPROVALS);
    assert.match(bare.message, /no bank on this round has said yes/i);

    const zero = await move("funded", { fundedAmount: 0 });
    assert.equal(zero.moved, false);
    assert.equal(zero.reason, NO_CONFIRMED_APPROVALS);

    // An explicit funded amount does NOT buy past it — that is the whole point.
    const explicit = await move("funded", { fundedAmount: 12000 });
    assert.equal(explicit.moved, false, "an explicit amount must not override a missing bank yes");
    assert.equal(explicit.reason, NO_CONFIRMED_APPROVALS);
    assert.notEqual(await stageOf(clientId), "funded");

    // Record the bank yes with its amount and the same move now goes through.
    await addApproval(roundId, clientId, "Bank Y", 12000);
    const funded = await move("funded", { fundedAmount: 12000 });
    assert.equal(funded.moved, true, funded.message);
    assert.equal(funded.fundedAmount, 12000);
    assert.equal(await stageOf(clientId), "funded");
  });

  test("an already-funded round is never re-blocked by a blank approval", async () => {
    const { clientId, roundId, move } = await makeClient();
    await addApproval(roundId, clientId, "Bank A", 20000);
    assert.equal((await move("funded", { fundedAmount: 17000 })).moved, true);

    // A blank approval recorded AFTER funding must not deadlock a re-move —
    // the card is already there and the board re-sends moves routinely.
    await addApproval(roundId, clientId, "Late Bank", null);
    const again = await guardFundedAmount(db, { orgId, clientId });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyFunded, true);
  });

  test("excluding is refused when there is nobody to record it against", async () => {
    const { clientId, roundId } = await makeClient();
    const appId = await addApproval(roundId, clientId, "Bank A", null);

    await assert.rejects(
      () => setApprovalExclusion(db, { orgId, applicationId: appId, excluded: true, reason: "x", staff: null }),
      (err) => {
        assert.equal(err.code, "staff_required");
        return true;
      }
    );
    const row = (await db.query(`SELECT approval_excluded_at FROM applications WHERE id = $1`, [appId])).rows[0];
    assert.equal(row.approval_excluded_at, null, "a refused exclusion changes nothing");
  });

  test("only a bank yes can be excluded", async () => {
    const { clientId, roundId } = await makeClient();
    const denied = (await db.query(
      `INSERT INTO applications (org_id, funding_round_id, client_id, bank, lender_name, status)
       VALUES ($1, $2, $3, 'Bank N', 'Bank N', 'Denied') RETURNING id`,
      [orgId, roundId, clientId]
    )).rows[0].id;

    await assert.rejects(
      () => setApprovalExclusion(db, { orgId, applicationId: denied, excluded: true, reason: "x", staff }),
      (err) => {
        assert.equal(err.code, "not_approved");
        return true;
      }
    );
  });

  test("a bank with no name still gets named in the refusal", () => {
    assert.deepEqual(unpricedApprovalNames([{ bank: "  " }, { bank: null }, { bank: "Chase" }]),
      ["Unnamed bank", "Chase"]);
  });
});
