// Postgres-backed tests for migration 466 (money_transfers, the append-only
// money_transfer_events ledger, the sync cursor) and the engine's pg store,
// starting from W5's real proposeTransfer (464). FinanceOS wave 5, unit W7.
//
// WHAT ONLY A REAL DATABASE CAN SAY:
//   1. A move cannot be opened unless its 464 proposal was approved in the same
//      transaction, by the same login, for the same amount and accounts.
//   2. The state machine has no shortcuts and an approval never changes.
//   3. The ledger row is written BY THE TRIGGER for every state change, a Plaid
//      event lands once, and no role — owner included — can change or delete a
//      ledger row or a move.
//   4. Both accounts must be the client's own (the composite foreign keys).
//   5. fundhub_app holds SELECT/INSERT on the ledger and nothing else.
//
// EVERYTHING RUNS IN ONE TRANSACTION THAT IS ROLLED BACK. Expected failures run
// inside SAVEPOINTs. Skipped without DATABASE_URL (CLAUDE.md §12: a skip is not
// a pass — CI runs this against its throwaway database).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool, close } from "../db.mjs";
import { proposeTransfer } from "./money-transfer-seam.mjs";
import { approveTransfer, executeTransfer, syncTransferEvents } from "./money-transfers.mjs";
import { pgStore } from "./money-transfers-store.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-07T15:00:00Z");
const TODAY = "2026-10-07";
const ENV = {
  PLAID_ENV: "sandbox", PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  FINANCE_OS_TRANSFER_MAX_CENTS: "250000", FINANCE_OS_TRANSFER_DAILY_MAX_CENTS: "500000"
};

describe("money_transfers + money_transfer_events (migration 466)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let c, orgId, clientId, otherClientId, accountId, pc, bc, theirs, taskId, transferId;

  before(async () => {
    c = await pool().connect();
    await c.query("BEGIN");
    orgId = (await c.query(`INSERT INTO orgs (slug, name) VALUES ($1, 'Transfers PgTest Org') RETURNING id`,
      [`money-transfers-pg-${process.pid}-${Date.now()}`])).rows[0].id;
    clientId = (await c.query(`INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Transfers', 'PgTest') RETURNING id`, [orgId])).rows[0].id;
    otherClientId = (await c.query(`INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Other', 'PgTest') RETURNING id`, [orgId])).rows[0].id;
    accountId = (await c.query(
      `INSERT INTO accounts (org_id, kind, email, name, status, client_id) VALUES ($1, 'client', $2, 'Transfers PgTest', 'invited', $3) RETURNING id`,
      [orgId, `transfers-pg-${Date.now()}@example.com`, clientId])).rows[0].id;
    const item = async (cid) => (await c.query(
      `INSERT INTO plaid_items (org_id, client_id, plaid_item_id, institution_name, encrypted_access_token, link_state, consent_granted_at, consent_scope)
       VALUES ($1, $2, $3, 'First Platypus Bank (Plaid sandbox — test data)', 'v1:aaaa:bbbb:cccc', 'active', now(), '["accounts"]'::jsonb) RETURNING id`,
      [orgId, cid, `item-${crypto.randomUUID()}`])).rows[0].id;
    const mine = await item(clientId);
    const theirsItem = await item(otherClientId);
    const account = async (cid, itemId, name, mask, plaidId) => (await c.query(
      `INSERT INTO bank_accounts (org_id, client_id, plaid_item_id, plaid_account_id, provider, name, mask, account_type, account_subtype, available_balance_cents)
       VALUES ($1, $2, $3, $4, 'plaid', $5, $6, 'depository', 'checking', 500000) RETURNING id`,
      [orgId, cid, itemId, plaidId, name, mask])).rows[0].id;
    pc = await account(clientId, mine, "Personal Checking", "1101", "p-1101");
    bc = await account(clientId, mine, "Business Checking", "2202", "p-2202");
    theirs = await account(otherClientId, theirsItem, "Their Checking", "7777", "p-7777");
  });

  after(async () => {
    if (c) {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    await close();
  });

  async function expectRefused(sql, params, code) {
    await c.query("SAVEPOINT refused");
    try {
      await c.query(sql, params);
      assert.fail(`expected ${code}`);
    } catch (e) {
      assert.equal(e.code, code, e.message);
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT refused");
    }
  }

  const INSERT_MOVE = `INSERT INTO money_transfers
    (org_id, client_id, agent_task_id, to_kind, from_bank_account_id, to_bank_account_id, from_account_label, to_account_label,
     amount_cents, scheduled_for, environment, status, proposed_by_kind, approved_by_kind, approved_by_account_id,
     approved_by_client_id, approved_at, approval_terms, idempotency_key)
    VALUES ($1,$2,$3,'bank_account',$4,$5,'PC','BC',$6,$7::date,$8,'approved','staff',$9,$10,$11,now(),'{}'::jsonb,$12)`;

  test("a proposal comes from W5's seam, and a move cannot open while it waits", async () => {
    const p = await proposeTransfer(c, {
      orgId, clientId, taskKey: `move:${crypto.randomUUID()}`, kind: "deposit", title: "Deposit to build banking history",
      why: null, dueOn: TODAY, source: "staff", amountCents: 2000, toKind: "bank_account", toAccountId: bc,
      requestedByKind: "staff", requestedByStaffId: null
    });
    assert.equal(p.ok, true);
    assert.equal(p.status, "needs_approval");
    taskId = p.proposalId;
    await expectRefused(INSERT_MOVE, [orgId, clientId, taskId, pc, bc, 2000, TODAY, "sandbox", "client", accountId, clientId, "mt-pg-early"], "23514");
  });

  test("the client's yes: the 464 row is approved and claimed, the move opens, the trigger writes the ledger row", async () => {
    const r = await approveTransfer(c, {
      orgId, clientId, proposalId: taskId, amountCents: 2000, fromAccountId: pc, toAccountId: bc,
      scheduledFor: TODAY, approvedByAccountId: accountId
    }, { env: ENV, now: NOW });
    assert.equal(r.ok, true, JSON.stringify(r));
    transferId = r.transfer.id;
    const task = (await c.query(`SELECT status, claimed_by, from_account_id, approved_by_account_id FROM money_agent_tasks WHERE id = $1`, [taskId])).rows[0];
    assert.deepEqual([task.status, task.claimed_by, task.from_account_id, task.approved_by_account_id], ["claimed", "transfer-engine", pc, accountId]);
    const ev = (await c.query(`SELECT event_type, from_status, to_status, actor_kind, actor_id FROM money_transfer_events WHERE transfer_id = $1 ORDER BY id`, [transferId])).rows;
    assert.deepEqual(ev, [{ event_type: "approved", from_status: null, to_status: "approved", actor_kind: "client", actor_id: accountId }]);
  });

  test("one move per proposal, and it must match the proposal", async () => {
    await expectRefused(INSERT_MOVE, [orgId, clientId, taskId, pc, bc, 2000, TODAY, "sandbox", "client", accountId, clientId, "mt-pg-dup"], "23514");
  });

  test("no shortcuts in the state machine, and the approval and amount never change", async () => {
    await expectRefused(`UPDATE money_transfers SET status = 'settled', settled_at = now() WHERE id = $1`, [transferId], "23514");
    await expectRefused(`UPDATE money_transfers SET status = 'submitted' WHERE id = $1`, [transferId], "23514");
    await expectRefused(`UPDATE money_transfers SET amount_cents = 1 WHERE id = $1`, [transferId], "23514");
    await expectRefused(`UPDATE money_transfers SET approved_by_account_id = NULL WHERE id = $1`, [transferId], "23514");
    await expectRefused(`UPDATE money_transfers SET to_bank_account_id = $2 WHERE id = $1`, [transferId, pc], "23514");
  });

  test("an approval is never swapped — not even for role-play — and role-play can never approve a production row", async () => {
    await expectRefused(`UPDATE money_transfers SET approved_by_kind = 'sandbox_role_play', approved_by_account_id = NULL, approved_by_client_id = NULL WHERE id = $1`, [transferId], "23514");
    const p = await proposeTransfer(c, {
      orgId, clientId, taskKey: `move:${crypto.randomUUID()}`, kind: "deposit", title: "Role-play", why: null, dueOn: TODAY,
      source: "staff", amountCents: 1200, toKind: "bank_account", toAccountId: bc, requestedByKind: "staff", requestedByStaffId: null
    });
    await c.query(`UPDATE money_agent_tasks SET status = 'approved', approved_at = now(), from_account_id = $2 WHERE id = $1`, [p.proposalId, pc]);
    await expectRefused(
      `INSERT INTO money_transfers
         (org_id, client_id, agent_task_id, to_kind, from_bank_account_id, to_bank_account_id, from_account_label, to_account_label,
          amount_cents, scheduled_for, environment, status, proposed_by_kind, approved_by_kind, approved_at, approval_terms, idempotency_key)
       VALUES ($1,$2,$3,'bank_account',$4,$5,'PC','BC',1200,$6::date,'production','approved','staff','sandbox_role_play',now(),'{}'::jsonb,'mt-pg-roleplay')`,
      [orgId, clientId, p.proposalId, pc, bc, TODAY], "23514");
  });

  test("a move and its ledger rows are never deleted or rewritten — not even by the owner", async () => {
    await expectRefused(`DELETE FROM money_transfers WHERE id = $1`, [transferId], "42501");
    await expectRefused(`UPDATE money_transfer_events SET event_type = 'rewritten' WHERE transfer_id = $1`, [transferId], "42501");
    await expectRefused(`DELETE FROM money_transfer_events WHERE transfer_id = $1`, [transferId], "42501");
    await expectRefused(`TRUNCATE money_transfer_events`, [], "42501");
  });

  test("legs through the store: each status change is one ledger row, and a Plaid event lands once", async () => {
    const provider = {
      async authorizeLeg(a) { return { ok: true, authorizationId: `auth-${a.idempotencyKey}`, decision: "approved" }; },
      async createLeg(a) { return { ok: true, transferId: `tr-${a.authorizationId}`, status: "pending" }; },
      async eventsPage() { return { ok: true, events: [{ eventId: 7001, eventType: "posted", transferId: `tr-auth-mt-${taskId}-d` }], hasMore: false, lastId: 7001 }; }
    };
    const sent = await executeTransfer(c, { transferId }, { env: ENV, now: NOW, provider });
    assert.equal(sent.step, "submitted");
    await syncTransferEvents(c, { env: ENV, now: NOW, provider, force: true });
    await syncTransferEvents(c, { env: ENV, now: NOW, provider, force: true });
    const ev = (await c.query(`SELECT event_type, to_status, debit_status, provider_event_id FROM money_transfer_events WHERE transfer_id = $1 ORDER BY id`, [transferId])).rows;
    assert.deepEqual(ev.map((e) => e.event_type), ["approved", "started", "authorized", "submitted", "plaid_posted"]);
    assert.equal(ev.filter((e) => Number(e.provider_event_id) === 7001).length, 1, "read twice, written once");
    const cur = await pgStore(c).cursor("sandbox");
    assert.ok(cur >= 7001);
  });

  test("both accounts must be the client's own", async () => {
    const p = await proposeTransfer(c, {
      orgId, clientId, taskKey: `move:${crypto.randomUUID()}`, kind: "deposit", title: "Second", why: null, dueOn: TODAY,
      source: "staff", amountCents: 1500, toKind: "bank_account", toAccountId: bc, requestedByKind: "staff", requestedByStaffId: null
    });
    // 464 only checks from_account_id exists; 466's composite key checks whose it is.
    await c.query(`UPDATE money_agent_tasks SET status = 'approved', approved_at = now(), from_account_id = $2, approved_by_account_id = $3 WHERE id = $1`,
      [p.proposalId, theirs, accountId]);
    await expectRefused(INSERT_MOVE, [orgId, clientId, p.proposalId, theirs, bc, 1500, TODAY, "sandbox", "client", accountId, clientId, "mt-pg-theirs"], "23503");
  });

  test("the app role reads and adds ledger rows and can do nothing else to them", async (t) => {
    const role = (await c.query(`SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app'`)).rows.length;
    if (!role) { t.skip("no fundhub_app role in this database"); return; }
    const priv = async (table, p) => (await c.query(`SELECT has_table_privilege('fundhub_app', $1, $2) AS ok`, [table, p])).rows[0].ok;
    assert.equal(await priv("public.money_transfer_events", "SELECT"), true);
    assert.equal(await priv("public.money_transfer_events", "INSERT"), true);
    assert.equal(await priv("public.money_transfer_events", "UPDATE"), false);
    assert.equal(await priv("public.money_transfer_events", "DELETE"), false);
    assert.equal(await priv("public.money_transfers", "DELETE"), false);
    assert.equal(await priv("public.money_transfers", "UPDATE"), true);
  });
});
