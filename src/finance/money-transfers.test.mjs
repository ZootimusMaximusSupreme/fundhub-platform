// FinanceOS money moves — the engine (src/finance/money-transfers.mjs) on the
// in-memory store that mirrors 464 + 466, with a stand-in provider. No Plaid,
// no Postgres. FinanceOS wave 5, unit W7.
//
// The real triggers are proven in CI by money-transfers.pg.test.mjs. This file
// also reads the migration and checks the JS mirror says the same thing, so the
// two cannot drift apart quietly.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  transferMode, approveTransfer, approveTransferAsSandboxRolePlay, executeTransfer, executeDue, syncTransferEvents,
  cancelTransfer, expireOverdue, runTransfersPass, moneyTransfersView, overallStatus, legAfterEvent,
  scheduledDateFor, approvalWords, etToday, proposedByKind, clientMessageFor, ENGINE
} from "./money-transfers.mjs";
import {
  memoryStore, checkTransferInsert, checkTransferUpdate, TRANSITIONS, TransferRuleError
} from "./money-transfers-store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.resolve(HERE, "../../db/migrations/466_money_transfers.sql"), "utf8");

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIENT = "33333333-3333-4333-8333-333333333333";
const LOGIN = "44444444-4444-4444-8444-444444444444";
const PC = "aaaaaaaa-0000-4000-8000-000000001101"; // Personal Checking ••1101
const BC = "aaaaaaaa-0000-4000-8000-000000002202"; // Business Checking ••2202
const AMEX = "aaaaaaaa-0000-4000-8000-000000004404"; // Business Amex ••4404 (credit)
const CLOSED = "aaaaaaaa-0000-4000-8000-000000009999";
const THEIRS = "aaaaaaaa-0000-4000-8000-000000007777";

const NOW = new Date("2026-10-07T15:00:00Z"); // 11:00 in New York
const TODAY = "2026-10-07";

const ENV = Object.freeze({
  PLAID_ENV: "sandbox", PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  FINANCE_OS_TRANSFER_MAX_CENTS: "250000", FINANCE_OS_TRANSFER_DAILY_MAX_CENTS: "500000"
});

function acct(id, over = {}) {
  return {
    id, org_id: ORG, client_id: CLIENT, name: "Account", official_name: null, mask: "0000",
    account_type: "depository", account_subtype: "checking", entity_kind: "personal", entity_name: null,
    closed_at: null, is_demo: false, plaid_account_id: `plaid-${id.slice(-4)}`, available_balance_cents: 100000,
    current_balance_cents: 100000, institution_name: "First Platypus Bank (Plaid sandbox — test data)",
    item: { id: "item-row", plaid_item_id: "item-1", encrypted_access_token: "v1:x:y:z", link_state: "active", consent_granted_at: "2026-10-01T00:00:00Z" },
    ...over
  };
}

function setup({ tasks = [] } = {}) {
  const store = memoryStore({
    now: () => NOW,
    clients: [{ id: CLIENT, org_id: ORG, first_name: "Test", last_name: "Test" }, { id: OTHER_CLIENT, org_id: ORG, first_name: "Other", last_name: "Person" }],
    accounts: [
      acct(PC, { name: "Personal Checking", mask: "1101", available_balance_cents: 421055 }),
      acct(BC, { name: "Business Checking", mask: "2202", entity_kind: "business", entity_name: "Fundhub LLC", available_balance_cents: 1875000 }),
      acct(AMEX, { name: "Business Amex", mask: "4404", account_type: "credit", account_subtype: "credit card" }),
      acct(CLOSED, { name: "Old Savings", mask: "9999", account_subtype: "savings", closed_at: "2026-09-01T00:00:00Z" }),
      acct(THEIRS, { client_id: OTHER_CLIENT, name: "Their Checking", mask: "7777" })
    ]
  });
  const made = tasks.map((t) => store.insertTask(t));
  return { store, tasks: made };
}

/** A 464 proposal the way proposeTransfer writes it. */
function proposal(over = {}) {
  return {
    org_id: ORG, client_id: CLIENT, task_key: `move:${crypto.randomUUID()}`, kind: "deposit",
    title: "Deposit to build banking history", source: "staff", amount_cents: 2000,
    to_kind: "bank_account", to_account_id: BC, due_on: TODAY, requested_by_kind: "staff",
    created_at: NOW.toISOString(), ...over
  };
}

function fakeProvider(script = {}) {
  const calls = [];
  const events = [];
  let seq = 0;
  return {
    calls, events, name: "plaid_transfer", environment: "sandbox", enabled: true,
    async authorizeLeg(a) {
      calls.push(["authorize", a.type, a.idempotencyKey, a.amountCents, a.legalName]);
      return script.authorize ? script.authorize(a) : { ok: true, authorizationId: `auth-${a.idempotencyKey}`, decision: "approved", rationaleCode: null };
    },
    async createLeg(a) {
      calls.push(["create", a.authorizationId, a.description]);
      return script.create ? script.create(a) : { ok: true, transferId: `tr-${a.authorizationId}`, status: "pending" };
    },
    async getLeg(id) { calls.push(["get", id]); return script.get ? script.get(id) : { ok: true, transfer: { id, cancellable: true } }; },
    async cancelLeg(id) { calls.push(["cancel", id]); return { ok: true }; },
    async eventsPage(after) {
      calls.push(["events", after]);
      const page = events.filter((e) => e.eventId > after);
      return { ok: true, events: page, hasMore: false, lastId: page.reduce((m, e) => Math.max(m, e.eventId), after) };
    },
    push(transferId, eventType, extra = {}) { seq += 1; events.push({ eventId: seq, eventType, transferId, timestamp: NOW.toISOString(), failureReason: null, ...extra }); }
  };
}

const approveArgs = (taskId, over = {}) => ({
  orgId: ORG, clientId: CLIENT, proposalId: taskId, amountCents: 2000, fromAccountId: PC,
  toAccountId: BC, scheduledFor: TODAY, approvedByAccountId: LOGIN, ...over
});

async function approved({ task = {}, env = ENV } = {}) {
  const s = setup({ tasks: [proposal(task)] });
  const r = await approveTransfer(s.store, approveArgs(s.tasks[0].id, task.amount_cents ? { amountCents: task.amount_cents } : {}), { env, now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { ...s, transfer: r.transfer };
}

/* ── the gate ───────────────────────────────────────────────────────────── */

describe("transferMode — fail closed", () => {
  test("sandbox with both caps and Plaid configured is on", () => {
    const m = transferMode(ENV);
    assert.deepEqual([m.enabled, m.environment, m.live, m.reason], [true, "sandbox", false, null]);
    assert.equal(m.perTransferCents, 250000);
    assert.equal(m.dailyCents, 500000);
  });
  test("either cap unset, zero, negative, fractional or junk turns it off", () => {
    for (const [k, v] of [["FINANCE_OS_TRANSFER_MAX_CENTS", undefined], ["FINANCE_OS_TRANSFER_DAILY_MAX_CENTS", undefined],
      ["FINANCE_OS_TRANSFER_MAX_CENTS", "0"], ["FINANCE_OS_TRANSFER_MAX_CENTS", "-5"], ["FINANCE_OS_TRANSFER_DAILY_MAX_CENTS", "12.5"],
      ["FINANCE_OS_TRANSFER_MAX_CENTS", "lots"], ["FINANCE_OS_TRANSFER_MAX_CENTS", ""]]) {
      const env = { ...ENV, [k]: v };
      if (v === undefined) delete env[k];
      const m = transferMode(env);
      assert.equal(m.enabled, false, `${k}=${v}`);
      assert.equal(m.reason, "limits_not_set");
    }
  });
  test("production without FINANCE_OS_TRANSFERS_LIVE=1 is off; with it, live", () => {
    assert.equal(transferMode({ ...ENV, PLAID_ENV: "production" }).reason, "production_needs_live_flag");
    assert.equal(transferMode({ ...ENV, PLAID_ENV: "production", FINANCE_OS_TRANSFERS_LIVE: "true" }).reason, "production_needs_live_flag");
    const live = transferMode({ ...ENV, PLAID_ENV: "production", FINANCE_OS_TRANSFERS_LIVE: "1" });
    assert.deepEqual([live.enabled, live.environment, live.live], [true, "production", true]);
  });
  test("the live switch alone does nothing on sandbox, and development is off", () => {
    assert.equal(transferMode({ ...ENV, FINANCE_OS_TRANSFERS_LIVE: "1" }).environment, "sandbox");
    assert.equal(transferMode({ ...ENV, PLAID_ENV: "development" }).reason, "plaid_env_not_supported");
  });
  test("Plaid credentials missing is off", () => {
    const env = { ...ENV };
    delete env.PLAID_SECRET;
    assert.equal(transferMode(env).reason, "plaid_not_configured");
  });
});

describe("off means off — nothing is approved, sent or read, and the provider is never called", () => {
  const OFF = { ...ENV };
  delete OFF.FINANCE_OS_TRANSFER_DAILY_MAX_CENTS;

  test("approve refuses and the proposal stays waiting", async () => {
    const s = setup({ tasks: [proposal()] });
    const r = await approveTransfer(s.store, approveArgs(s.tasks[0].id), { env: OFF, now: NOW });
    assert.deepEqual([r.ok, r.reason, r.why], [false, "transfers_disabled", "limits_not_set"]);
    assert.equal(s.store.snapshot().tasks[0].status, "needs_approval");
    assert.equal(s.store.snapshot().transfers.length, 0);
  });

  test("send, sync, expire and the scheduled pass all stop before the provider", async () => {
    const { store, transfer } = await approved();
    const p = fakeProvider();
    assert.equal((await executeTransfer(store, { transferId: transfer.id }, { env: OFF, now: NOW, provider: p })).reason, "transfers_disabled");
    assert.equal((await syncTransferEvents(store, { env: OFF, now: NOW, provider: p })).reason, "transfers_disabled");
    assert.equal((await expireOverdue(store, { env: OFF, now: NOW })).reason, "transfers_disabled");
    assert.equal((await runTransfersPass(store, { env: OFF, now: NOW, provider: p })).skipped, "transfers_disabled");
    assert.equal(p.calls.length, 0);
  });

  test("production without the live switch: an approved move is never sent", async () => {
    const { store, transfer } = await approved();
    const p = fakeProvider();
    const r = await executeTransfer(store, { transferId: transfer.id }, { env: { ...ENV, PLAID_ENV: "production" }, now: NOW, provider: p });
    assert.equal(r.reason, "transfers_disabled");
    assert.equal(p.calls.length, 0);
  });

  test("a sandbox move never runs when the environment flips to production", async () => {
    const { store, transfer } = await approved();
    const p = fakeProvider();
    const r = await executeTransfer(store, { transferId: transfer.id },
      { env: { ...ENV, PLAID_ENV: "production", FINANCE_OS_TRANSFERS_LIVE: "1" }, now: NOW, provider: p });
    assert.equal(r.reason, "wrong_environment");
    assert.equal(p.calls.length, 0);
  });
});

/* ── approval: the client, that exact move ──────────────────────────────── */

describe("approval — only the client, only that exact move", () => {
  test("the client's yes approves the 464 row, opens the move, and the engine claims the row", async () => {
    const s = setup({ tasks: [proposal()] });
    const r = await approveTransfer(s.store, approveArgs(s.tasks[0].id), { env: ENV, now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.words, "Move $20.00 from Personal Checking ••1101 to Business Checking ••2202 on Oct 7, 2026");
    const snap = s.store.snapshot();
    const task = snap.tasks[0];
    assert.equal(task.status, "claimed");
    assert.equal(task.claimed_by, ENGINE);
    assert.equal(task.from_account_id, PC);
    assert.equal(task.approved_by_account_id, LOGIN);
    assert.ok(task.approved_at);
    const t = snap.transfers[0];
    assert.equal(t.status, "approved");
    assert.equal(t.approved_by_kind, "client");
    assert.equal(t.approved_by_client_id, CLIENT);
    assert.equal(t.approved_by_account_id, LOGIN);
    assert.equal(t.environment, "sandbox");
    assert.deepEqual(t.approval_terms, {
      from_bank_account_id: PC, from_label: "Personal Checking ••1101", to_kind: "bank_account", to_bank_account_id: BC,
      to_label: "Business Checking ••2202", amount_cents: 2000, scheduled_for: TODAY, title: "Deposit to build banking history",
      words: "Move $20.00 from Personal Checking ••1101 to Business Checking ••2202 on Oct 7, 2026"
    });
  });

  test("an authorized representative's login cannot approve", async () => {
    const s = setup({ tasks: [proposal()] });
    const r = await approveTransfer(s.store, { ...approveArgs(s.tasks[0].id), authorizedRep: true }, { env: ENV, now: NOW });
    assert.equal(r.reason, "owner_only");
    assert.equal(s.store.snapshot().transfers.length, 0);
  });

  test("no login id, no approval", async () => {
    const s = setup({ tasks: [proposal()] });
    assert.equal((await approveTransfer(s.store, approveArgs(s.tasks[0].id, { approvedByAccountId: null }), { env: ENV, now: NOW })).reason, "missing_ids");
  });

  test("anything different from the row is refused, never 'fixed'", async () => {
    const s = setup({ tasks: [proposal()] });
    const id = s.tasks[0].id;
    const cases = [
      [{ amountCents: 2001 }, "amount_changed"],
      [{ toAccountId: PC }, "destination_changed"],
      [{ toAccountId: null }, "destination_changed"],
      [{ scheduledFor: "2026-10-08" }, "date_changed"],
      [{ fromAccountId: BC }, "same_account"],
      [{ fromAccountId: AMEX }, "from_not_sendable"],
      [{ fromAccountId: CLOSED }, "from_not_sendable"],
      [{ fromAccountId: THEIRS }, "from_not_sendable"]
    ];
    for (const [over, reason] of cases) {
      const r = await approveTransfer(s.store, approveArgs(id, over), { env: ENV, now: NOW });
      assert.equal(r.reason, reason, JSON.stringify(over));
    }
    assert.equal(s.store.snapshot().tasks[0].status, "needs_approval", "a refused yes changes nothing");
    assert.equal(s.store.snapshot().transfers.length, 0);
  });

  test("a card or loan payment proposal cannot be approved here", async () => {
    const s = setup({ tasks: [proposal({ to_kind: "card", to_account_id: AMEX, task_key: `due:${AMEX}:2026-10-10`, source: "dues", kind: "due", amount_cents: 13500, requested_by_kind: "client" })] });
    const r = await approveTransfer(s.store, approveArgs(s.tasks[0].id, { amountCents: 13500, toAccountId: AMEX }), { env: ENV, now: NOW });
    assert.equal(r.reason, "destination_not_supported");
  });

  test("a second yes on the same proposal is refused; there is one move per proposal", async () => {
    const s = setup({ tasks: [proposal()] });
    assert.equal((await approveTransfer(s.store, approveArgs(s.tasks[0].id), { env: ENV, now: NOW })).ok, true);
    assert.equal((await approveTransfer(s.store, approveArgs(s.tasks[0].id), { env: ENV, now: NOW })).reason, "not_waiting");
    assert.equal(s.store.snapshot().transfers.length, 1);
  });

  test("the date approved is the proposal's due date, or today when it has passed", () => {
    assert.equal(scheduledDateFor({ due_on: "2026-10-20" }, TODAY), "2026-10-20");
    assert.equal(scheduledDateFor({ due_on: "2026-09-25" }, TODAY), TODAY);
    assert.equal(scheduledDateFor({ due_on: null }, TODAY), TODAY);
    assert.equal(approvalWords({ amountCents: 2000000, fromLabel: "A ••1", toLabel: "B ••2", date: "2026-10-20" }), "Move $20,000.00 from A ••1 to B ••2 on Oct 20, 2026");
  });

  test("New York's calendar day decides 'today' (the ACH banking day)", () => {
    assert.equal(etToday(new Date("2026-10-07T03:30:00Z")), "2026-10-06");
    assert.equal(etToday(new Date("2026-10-07T04:30:00Z")), "2026-10-07");
  });

  test("who proposed it is read from the 464 row", () => {
    assert.equal(proposedByKind({ requested_by_kind: "staff" }), "staff");
    assert.equal(proposedByKind({ requested_by_kind: "client" }), "rules");
    assert.equal(proposedByKind({ requested_by_kind: "client", detail: { proposed_by: "agent" } }), "agent");
  });

  test("sandbox role-play approval is labelled, never 'client', and only runs on sandbox", async () => {
    const s = setup({ tasks: [proposal()] });
    const r = await approveTransferAsSandboxRolePlay(s.store, { ...approveArgs(s.tasks[0].id), approvedByAccountId: undefined, actorId: "test" }, { env: ENV, now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.transfer.approved_by_kind, "sandbox_role_play");
    assert.equal(r.transfer.approved_by_account_id, null);
    assert.equal(r.transfer.approved_by_client_id, null);
    const s2 = setup({ tasks: [proposal()] });
    const live = { ...ENV, PLAID_ENV: "production", FINANCE_OS_TRANSFERS_LIVE: "1" };
    assert.equal((await approveTransferAsSandboxRolePlay(s2.store, approveArgs(s2.tasks[0].id), { env: live, now: NOW })).reason, "sandbox_only");
    assert.equal((await approveTransferAsSandboxRolePlay(s2.store, approveArgs(s2.tasks[0].id), { env: { ...ENV, FINANCE_OS_TRANSFERS_LIVE: "1" }, now: NOW })).reason, "sandbox_only");
  });
});

/* ── cannot execute without approval ────────────────────────────────────── */

describe("nothing moves without the client's approval", () => {
  test("a waiting proposal is never sent by the scheduled pass", async () => {
    const s = setup({ tasks: [proposal()] });
    const p = fakeProvider();
    const r = await runTransfersPass(s.store, { env: ENV, now: NOW, provider: p });
    assert.equal(r.sent.checked, 0);
    assert.equal(p.calls.filter((c) => c[0] === "authorize" || c[0] === "create").length, 0);
  });

  test("the store refuses a move whose proposal is not approved, or does not match it", async () => {
    const s = setup({ tasks: [proposal()] });
    const base = {
      org_id: ORG, client_id: CLIENT, agent_task_id: s.tasks[0].id, to_kind: "bank_account", from_bank_account_id: PC,
      to_bank_account_id: BC, from_account_label: "PC", to_account_label: "BC", amount_cents: 2000, scheduled_for: TODAY,
      environment: "sandbox", status: "approved", proposed_by_kind: "staff", approved_by_kind: "client",
      approved_by_account_id: LOGIN, approved_by_client_id: CLIENT, approved_at: NOW.toISOString(),
      approval_terms: { words: "x" }, idempotency_key: "mt-test-1"
    };
    await assert.rejects(s.store.insertTransfer(base), TransferRuleError, "proposal still needs_approval");
    await s.store.approveTask(s.tasks[0].id, { fromAccountId: PC, approvedByAccountId: LOGIN, at: NOW.toISOString() });
    await assert.rejects(s.store.insertTransfer({ ...base, amount_cents: 2500 }), TransferRuleError, "amount differs from the proposal");
    await assert.rejects(s.store.insertTransfer({ ...base, approved_by_account_id: crypto.randomUUID() }), TransferRuleError, "a different login");
    await assert.rejects(s.store.insertTransfer({ ...base, status: "submitted" }), TransferRuleError, "born past approved");
  });

  test("the approval rule: only the client's own login, or role-play on a sandbox row", () => {
    const row = {
      org_id: ORG, client_id: CLIENT, environment: "sandbox", approved_at: "x", approval_terms: {},
      approved_by_kind: "client", approved_by_account_id: LOGIN, approved_by_client_id: CLIENT
    };
    const task = { org_id: ORG, client_id: CLIENT, moves_money: true, status: "approved", approved_at: "x", amount_cents: 1, to_kind: "fundhub", to_account_id: null, from_account_id: PC, approved_by_account_id: LOGIN };
    const full = { ...row, status: "approved", to_kind: "fundhub", from_bank_account_id: PC, to_bank_account_id: null, amount_cents: 1 };
    assert.doesNotThrow(() => checkTransferInsert(full, task));
    assert.throws(() => checkTransferInsert({ ...full, approved_by_kind: "staff" }, task), TransferRuleError);
    assert.throws(() => checkTransferInsert({ ...full, approved_by_client_id: OTHER_CLIENT }, task), TransferRuleError);
    assert.throws(() => checkTransferInsert({ ...full, approved_at: null }, task), TransferRuleError);
    assert.throws(() => checkTransferInsert({ ...full, approved_by_kind: "sandbox_role_play", approved_by_account_id: null, approved_by_client_id: null, environment: "production" }, { ...task, approved_by_account_id: null }), TransferRuleError);
  });

  test("an approval is never changed, and the state machine has no shortcuts", async () => {
    const { store, transfer } = await approved();
    const meta = { actorKind: "system", eventType: "x" };
    await assert.rejects(store.updateTransfer(transfer.id, "approved", { status: "settled", settled_at: NOW.toISOString() }, meta), TransferRuleError);
    await assert.rejects(store.updateTransfer(transfer.id, "approved", { status: "submitted" }, meta), TransferRuleError);
    const cur = (await store.transfer(transfer.id));
    assert.throws(() => checkTransferUpdate(cur, { ...cur, amount_cents: 1 }), TransferRuleError);
    assert.throws(() => checkTransferUpdate(cur, { ...cur, approved_at: null }), TransferRuleError);
    assert.throws(() => checkTransferUpdate(cur, { ...cur, from_bank_account_id: BC }), TransferRuleError);
    assert.doesNotThrow(() => checkTransferUpdate(cur, { ...cur, from_bank_account_id: null }), "an account may go away");
  });
});

/* ── sending, caps, idempotency ─────────────────────────────────────────── */

describe("sending the debit leg", () => {
  test("approved and due → authorized → submitted, with an idempotency key built from the move", async () => {
    const { store, transfer, tasks } = await approved();
    const p = fakeProvider();
    const r = await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p });
    assert.equal(r.step, "submitted");
    assert.equal(r.transfer.status, "submitted");
    assert.equal(r.transfer.debit_status, "pending");
    assert.deepEqual(p.calls[0], ["authorize", "debit", `mt-${tasks[0].id}-d`, 2000, "Test Test"]);
    assert.deepEqual(p.calls[1], ["create", `auth-mt-${tasks[0].id}-d`, "TRANSFER"]);
  });

  test("calling it again sends nothing twice", async () => {
    const { store, transfer } = await approved();
    const p = fakeProvider();
    await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p });
    const again = await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p });
    assert.equal(again.step, "nothing_to_do");
    assert.equal(p.calls.filter((c) => c[0] === "authorize").length, 1);
    assert.equal(p.calls.filter((c) => c[0] === "create").length, 1);
  });

  test("a create that did not answer is retried on the same authorization — no second authorization", async () => {
    const { store, transfer } = await approved();
    let fail = true;
    const p = fakeProvider({ create: (a) => (fail ? { ok: false, reason: "provider_error", retryable: true } : { ok: true, transferId: `tr-${a.authorizationId}`, status: "pending" }) });
    const first = await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p });
    assert.equal(first.retryable, true);
    assert.equal((await store.transfer(transfer.id)).status, "authorized");
    fail = false;
    const second = await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p });
    assert.equal(second.step, "submitted");
    assert.equal(p.calls.filter((c) => c[0] === "authorize").length, 1);
    const creates = p.calls.filter((c) => c[0] === "create");
    assert.equal(creates.length, 2);
    assert.equal(creates[0][1], creates[1][1], "same authorization id both times");
  });

  test("a later date waits; past the grace days it is cancelled and nothing moves", async () => {
    const { store, transfer } = await approved({ task: { due_on: "2026-10-20" } }).catch(() => ({}));
    assert.equal(transfer, undefined, "approving needs the shown date; this proposal's date is Oct 20");
    const s = setup({ tasks: [proposal({ due_on: "2026-10-20" })] });
    const r = await approveTransfer(s.store, approveArgs(s.tasks[0].id, { scheduledFor: "2026-10-20" }), { env: ENV, now: NOW });
    assert.equal(r.ok, true);
    const p = fakeProvider();
    assert.equal((await executeTransfer(s.store, { transferId: r.transfer.id }, { env: ENV, now: NOW, provider: p })).step, "not_due");
    const late = new Date("2026-10-24T15:00:00Z");
    const gone = await executeTransfer(s.store, { transferId: r.transfer.id }, { env: ENV, now: late, provider: p });
    assert.equal(gone.reason, "date_passed");
    assert.equal(gone.transfer.status, "cancelled");
    assert.equal(p.calls.length, 0);
    assert.equal(s.store.snapshot().tasks[0].status, "cancelled");
  });

  test("Plaid's NSF decline ends the move and says so in plain words", async () => {
    const { store, transfer } = await approved();
    const p = fakeProvider({ authorize: () => ({ ok: true, authorizationId: "auth-x", decision: "declined", rationaleCode: "NSF", rationaleDescription: "Insufficient funds" }) });
    const r = await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p });
    assert.equal(r.reason, "declined");
    const snap = store.snapshot();
    assert.equal(snap.transfers[0].status, "declined");
    assert.equal(snap.tasks[0].status, "failed");
    assert.equal(snap.tasks[0].result.client_message, "The bank check said no: not enough money in Personal Checking ••1101. Nothing moved.");
    assert.equal(p.calls.filter((c) => c[0] === "create").length, 0);
  });

  test("'user action required' keeps the move approved and asks for the bank login", async () => {
    const { store, transfer } = await approved();
    const p = fakeProvider({ authorize: () => ({ ok: true, authorizationId: "auth-u", decision: "user_action_required" }) });
    const r = await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p });
    assert.equal(r.reason, "needs_bank_login");
    const t = await store.transfer(transfer.id);
    assert.equal(t.status, "approved");
    assert.equal(t.debit_authorization_id, null, "Plaid does not hold this decision to its idempotency key");
    assert.ok(store.snapshot().events.some((e) => e.event_type === "needs_bank_login"));
  });
});

describe("limits", () => {
  test("over the per-move cap: refused at approval", async () => {
    const s = setup({ tasks: [proposal({ amount_cents: 250001 })] });
    assert.equal((await approveTransfer(s.store, approveArgs(s.tasks[0].id, { amountCents: 250001 }), { env: ENV, now: NOW })).reason, "over_transfer_limit");
  });

  test("over the per-day cap: the second yes for the same day is refused", async () => {
    const s = setup({ tasks: [proposal({ amount_cents: 250000 }), proposal({ amount_cents: 250000 }), proposal({ amount_cents: 1 })] });
    assert.equal((await approveTransfer(s.store, approveArgs(s.tasks[0].id, { amountCents: 250000 }), { env: ENV, now: NOW })).ok, true);
    assert.equal((await approveTransfer(s.store, approveArgs(s.tasks[1].id, { amountCents: 250000 }), { env: ENV, now: NOW })).ok, true);
    const third = await approveTransfer(s.store, approveArgs(s.tasks[2].id, { amountCents: 1 }), { env: ENV, now: NOW });
    assert.equal(third.reason, "over_daily_limit");
    assert.equal(third.planned_cents, 500000);
  });

  test("caps lowered after a yes: the move waits and the provider is not called", async () => {
    const { store, transfer } = await approved();
    const p = fakeProvider();
    const tight = { ...ENV, FINANCE_OS_TRANSFER_MAX_CENTS: "1000" };
    assert.equal((await executeTransfer(store, { transferId: transfer.id }, { env: tight, now: NOW, provider: p })).reason, "over_transfer_limit");
    const day = { ...ENV, FINANCE_OS_TRANSFER_DAILY_MAX_CENTS: "1000" };
    assert.equal((await executeTransfer(store, { transferId: transfer.id }, { env: day, now: NOW, provider: p })).reason, "over_daily_limit");
    assert.equal(p.calls.length, 0);
    assert.equal((await store.transfer(transfer.id)).status, "approved");
  });

  test("a move that started today counts against today's room", async () => {
    const s = setup({ tasks: [proposal({ amount_cents: 300000 }), proposal({ amount_cents: 200001, due_on: "2026-10-07" })] });
    const env = { ...ENV, FINANCE_OS_TRANSFER_MAX_CENTS: "500000" };
    const a = await approveTransfer(s.store, approveArgs(s.tasks[0].id, { amountCents: 300000 }), { env, now: NOW });
    await executeTransfer(s.store, { transferId: a.transfer.id }, { env, now: NOW, provider: fakeProvider() });
    const b = await approveTransfer(s.store, approveArgs(s.tasks[1].id, { amountCents: 200001 }), { env, now: NOW });
    assert.equal(b.reason, "over_daily_limit");
  });
});

/* ── statuses from events ───────────────────────────────────────────────── */

describe("statuses from Plaid's events", () => {
  test("a leg only moves forward; failed, cancelled and returned are final", () => {
    assert.equal(legAfterEvent(null, "pending"), "pending");
    assert.equal(legAfterEvent("pending", "posted"), "posted");
    assert.equal(legAfterEvent("posted", "pending"), null);
    assert.equal(legAfterEvent("settled", "funds_available"), "funds_available");
    assert.equal(legAfterEvent("funds_available", "returned"), "returned");
    assert.equal(legAfterEvent("returned", "settled"), null);
    assert.equal(legAfterEvent("failed", "posted"), null);
    assert.equal(legAfterEvent("posted", "posted"), null);
    for (const e of ["swept", "swept_settled", "guaranteed", "sweep.posted", "refund.pending", "adjustment"]) assert.equal(legAfterEvent("posted", e), null, e);
  });

  test("the move as a whole, from its legs", () => {
    const base = { status: "submitted", to_kind: "bank_account", credit_transfer_id: null };
    assert.equal(overallStatus({ ...base, debit_status: "posted" }).status, "submitted");
    assert.equal(overallStatus({ ...base, debit_status: "funds_available", credit_status: "pending" }).status, "submitted");
    assert.equal(overallStatus({ ...base, debit_status: "funds_available", credit_status: "settled" }).status, "settled");
    assert.deepEqual(overallStatus({ ...base, debit_status: "failed" }), { status: "failed", reason: "debit_failed" });
    assert.deepEqual(overallStatus({ ...base, debit_status: "returned" }), { status: "failed", reason: "debit_returned" });
    assert.deepEqual(overallStatus({ ...base, debit_status: "returned", credit_transfer_id: "c" }), { status: "failed", reason: "debit_returned_after_credit" });
    assert.deepEqual(overallStatus({ ...base, debit_status: "funds_available", credit_status: "returned" }), { status: "failed", reason: "credit_returned" });
    assert.deepEqual(overallStatus({ ...base, debit_status: "cancelled" }), { status: "cancelled", reason: "debit_cancelled" });
    assert.equal(overallStatus({ ...base, to_kind: "fundhub", debit_status: "settled" }).status, "settled");
    assert.equal(overallStatus({ ...base, status: "settled", debit_status: "funds_available", credit_status: "settled" }).status, "settled");
  });

  test("end to end: debit events, the credit leg starts on its own, credit events, settled — and the 464 row is done", async () => {
    const { store, transfer, tasks } = await approved();
    const p = fakeProvider();
    let t = (await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p })).transfer;
    for (const e of ["pending", "posted", "settled"]) p.push(t.debit_transfer_id, e);
    await syncTransferEvents(store, { env: ENV, now: NOW, provider: p });
    t = await store.transfer(transfer.id);
    assert.deepEqual([t.status, t.debit_status, t.credit_status], ["submitted", "settled", null], "no credit before the money is available");
    p.push(t.debit_transfer_id, "funds_available");
    await syncTransferEvents(store, { env: ENV, now: NOW, provider: p });
    t = await store.transfer(transfer.id);
    assert.deepEqual([t.status, t.debit_status, t.credit_status], ["submitted", "funds_available", "pending"]);
    assert.ok(p.calls.some((c) => c[0] === "authorize" && c[1] === "credit" && c[2] === `mt-${tasks[0].id}-c` && c[4] === "Fundhub LLC"),
      "the credit leg names the business account's holder");
    for (const e of ["pending", "posted", "settled"]) p.push(t.credit_transfer_id, e);
    p.push("someone-elses-transfer", "posted");
    p.push(t.credit_transfer_id, "swept");
    const sync = await syncTransferEvents(store, { env: ENV, now: NOW, provider: p });
    assert.equal(sync.ok, true);
    t = await store.transfer(transfer.id);
    assert.deepEqual([t.status, t.debit_status, t.credit_status], ["settled", "funds_available", "settled"]);
    assert.ok(t.settled_at);
    const snap = store.snapshot();
    assert.equal(snap.tasks[0].status, "done");
    assert.ok(snap.tasks[0].done_at);
    assert.equal(snap.log.length, 1);
    assert.equal(snap.log[0].action, "task_done");
    assert.equal(snap.log[0].idempotencyKey, `money-task:${tasks[0].id}:task_done`);
    assert.equal(await store.cursor("sandbox"), p.events.length, "the cursor saves where sync left off");

    // Read the stream again from the start: nothing is applied or written twice.
    const before = store.snapshot().events.length;
    await syncTransferEvents(store, { env: ENV, now: NOW, provider: { ...p, eventsPage: async () => ({ ok: true, events: p.events, hasMore: false, lastId: p.events.length }) }, force: true });
    assert.equal(store.snapshot().events.length, before, "a Plaid event is recorded once");
  });

  test("a returned debit fails the move and closes the proposal with words", async () => {
    const { store, transfer } = await approved();
    const p = fakeProvider();
    const t = (await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p })).transfer;
    p.push(t.debit_transfer_id, "posted");
    p.push(t.debit_transfer_id, "returned", { failureReason: { achReturnCode: "R01", description: "Insufficient funds" } });
    await syncTransferEvents(store, { env: ENV, now: NOW, provider: p });
    const snap = store.snapshot();
    assert.equal(snap.transfers[0].status, "failed");
    assert.equal(snap.transfers[0].status_reason, "debit_returned");
    assert.equal(snap.tasks[0].status, "failed");
    assert.equal(snap.tasks[0].result.client_message, "Your bank sent the money back to Personal Checking ••1101.");
  });

  test("a return after 'settled' still turns the move to failed", async () => {
    const { store, transfer } = await approved({ task: { to_kind: "fundhub", to_account_id: null } }).catch(() => ({}));
    assert.equal(transfer, undefined, "fundhub proposals approve with toAccountId null");
    const s = setup({ tasks: [proposal({ to_kind: "fundhub", to_account_id: null, kind: "due", source: "clarity", task_key: "clarity:abc" })] });
    const r = await approveTransfer(s.store, approveArgs(s.tasks[0].id, { toAccountId: null }), { env: ENV, now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.words, "Move $20.00 from Personal Checking ••1101 to Fundhub on Oct 7, 2026");
    const p = fakeProvider();
    const t = (await executeTransfer(s.store, { transferId: r.transfer.id }, { env: ENV, now: NOW, provider: p })).transfer;
    assert.equal(p.calls.find((c) => c[0] === "create")[2], "PAYMENT");
    for (const e of ["posted", "settled"]) p.push(t.debit_transfer_id, e);
    await syncTransferEvents(s.store, { env: ENV, now: NOW, provider: p });
    assert.equal((await s.store.transfer(t.id)).status, "settled");
    assert.equal(s.store.snapshot().tasks[0].status, "done");
    p.push(t.debit_transfer_id, "returned", { failureReason: { achReturnCode: "R10" } });
    await syncTransferEvents(s.store, { env: ENV, now: NOW, provider: p });
    assert.equal((await s.store.transfer(t.id)).status, "failed");
    assert.equal(s.store.snapshot().tasks[0].status, "failed");
  });

  test("sync skips the Plaid call when nothing could hear from it", async () => {
    const s = setup();
    const p = fakeProvider();
    assert.equal((await syncTransferEvents(s.store, { env: ENV, now: NOW, provider: p })).skipped, "nothing_open");
    assert.equal(p.calls.length, 0);
  });
});

/* ── the append-only ledger ─────────────────────────────────────────────── */

describe("the ledger is append-only and has a row for every state change", () => {
  test("every step of a move is one event, in order", async () => {
    const { store, transfer } = await approved();
    const p = fakeProvider();
    const t = (await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p })).transfer;
    p.push(t.debit_transfer_id, "posted");
    await syncTransferEvents(store, { env: ENV, now: NOW, provider: p });
    const types = store.snapshot().events.map((e) => [e.event_type, e.from_status, e.to_status, e.actor_kind]);
    assert.deepEqual(types, [
      ["approved", null, "approved", "client"],
      ["started", "approved", "approved", "system"],
      ["authorized", "approved", "authorized", "provider"],
      ["submitted", "authorized", "submitted", "provider"],
      ["plaid_posted", "submitted", "submitted", "provider"]
    ]);
    assert.equal(store.snapshot().events[4].provider_event_id, 1);
  });

  test("a ledger row cannot be changed: the rows are frozen and there is no update or delete", async () => {
    const { store } = await approved();
    const ev = store.snapshot().events[0];
    assert.ok(Object.isFrozen(ev));
    assert.throws(() => { "use strict"; ev.event_type = "rewritten"; }, TypeError);
    for (const m of Object.keys(store)) assert.ok(!/^(update|delete|remove)Event/i.test(m), m);
  });

  test("the migration enforces it for every role: a trigger, and the REVOKE on fundhub_app", () => {
    assert.match(SQL, /CREATE TRIGGER money_transfer_events_append_only_trg\s+BEFORE UPDATE OR DELETE ON public\.money_transfer_events/);
    assert.match(SQL, /CREATE TRIGGER money_transfer_events_no_truncate_trg\s+BEFORE TRUNCATE ON public\.money_transfer_events/);
    assert.match(SQL, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.money_transfer_events FROM fundhub_app;/);
    assert.match(SQL, /GRANT SELECT, INSERT ON public\.money_transfer_events TO fundhub_app;/);
    assert.match(SQL, /REVOKE DELETE, TRUNCATE ON public\.money_transfers FROM fundhub_app;/);
    assert.match(SQL, /CREATE TRIGGER money_transfers_no_delete_trg\s+BEFORE DELETE ON public\.money_transfers/);
    assert.match(SQL, /CREATE TRIGGER money_transfers_ledger_trg\s+AFTER INSERT OR UPDATE ON public\.money_transfers/);
  });
});

describe("the JS mirror says what the migration says", () => {
  test("the state machine", () => {
    const block = SQL.slice(SQL.indexOf("-- The state machine."), SQL.indexOf("-- A provider event id"));
    const sqlMap = {};
    for (const m of block.matchAll(/OLD\.status = '(\w+)'\s+AND NEW\.status (?:IN \(([^)]*)\)|= '(\w+)')/g)) {
      sqlMap[m[1]] = m[2] ? m[2].split(",").map((x) => x.trim().replace(/'/g, "")) : [m[3]];
    }
    const jsMap = Object.fromEntries(Object.entries(TRANSITIONS).filter(([, v]) => v.length));
    assert.deepEqual(Object.fromEntries(Object.entries(sqlMap).map(([k, v]) => [k, [...v].sort()])),
      Object.fromEntries(Object.entries(jsMap).map(([k, v]) => [k, [...v].sort()])));
  });

  test("the approval rule and the ownership keys are in the schema", () => {
    assert.match(SQL, /approved_by_kind = 'client' AND approved_by_account_id IS NOT NULL AND approved_by_client_id = client_id/);
    assert.match(SQL, /approved_by_kind = 'sandbox_role_play' AND environment = 'sandbox'/);
    assert.match(SQL, /CONSTRAINT money_transfers_from_ne_to CHECK \(from_bank_account_id <> to_bank_account_id\)/);
    assert.match(SQL, /FOREIGN KEY \(from_bank_account_id, client_id\)\s+REFERENCES public\.bank_accounts \(id, client_id\) ON DELETE SET NULL \(from_bank_account_id\)/);
    assert.match(SQL, /FOREIGN KEY \(to_bank_account_id, client_id\)\s+REFERENCES public\.bank_accounts \(id, client_id\) ON DELETE SET NULL \(to_bank_account_id\)/);
    assert.match(SQL, /amount_cents\s+bigint NOT NULL CONSTRAINT money_transfers_amount_ck CHECK \(amount_cents > 0\)/);
    assert.match(SQL, /CONSTRAINT money_transfers_agent_task_uq UNIQUE \(agent_task_id\)/);
    assert.match(SQL, /CONSTRAINT money_transfers_idempotency_key_uq UNIQUE \(idempotency_key\)/);
  });

  test("466 does not touch money_agent_log's word lists (464 owns them)", () => {
    assert.doesNotMatch(SQL, /money_agent_log_action_check|money_agent_log_item_kind_check/);
  });
});

/* ── stopping and expiry ────────────────────────────────────────────────── */

describe("cancel", () => {
  test("'Not now' on a waiting proposal closes it; nothing is opened", async () => {
    const s = setup({ tasks: [proposal()] });
    const r = await cancelTransfer(s.store, { orgId: ORG, clientId: CLIENT, proposalId: s.tasks[0].id, by: { kind: "client", id: LOGIN } }, { env: ENV, now: NOW });
    assert.equal(r.stage, "proposal");
    const snap = s.store.snapshot();
    assert.equal(snap.tasks[0].status, "cancelled");
    assert.equal(snap.tasks[0].result.client_message, "You said not now. Nothing moved.");
    assert.equal(snap.transfers.length, 0);
    assert.equal(snap.log[0].action, "task_cancelled");
  });

  test("an approved move not yet at the bank stops without asking Plaid", async () => {
    const { store, transfer, tasks } = await approved();
    const p = fakeProvider();
    const r = await cancelTransfer(store, { orgId: ORG, clientId: CLIENT, proposalId: tasks[0].id, by: { kind: "staff", id: "s1" } }, { env: ENV, now: NOW, provider: p });
    assert.equal(r.stage, "before_bank");
    assert.equal((await store.transfer(transfer.id)).cancelled_by_kind, "staff");
    assert.equal(p.calls.length, 0);
    assert.equal(store.snapshot().tasks[0].result.client_message, "Fundhub stopped this. Nothing moved.");
  });

  test("a sent move stops only if Plaid says it still can", async () => {
    const { store, transfer, tasks } = await approved();
    const p = fakeProvider();
    await executeTransfer(store, { transferId: transfer.id }, { env: ENV, now: NOW, provider: p });
    const r = await cancelTransfer(store, { orgId: ORG, clientId: CLIENT, proposalId: tasks[0].id, by: { kind: "client", id: LOGIN } }, { env: ENV, now: NOW, provider: p });
    assert.equal(r.stage, "at_plaid");
    const t = await store.transfer(transfer.id);
    assert.deepEqual([t.status, t.debit_status], ["cancelled", "cancelled"]);

    const s2 = await approved();
    const p2 = fakeProvider({ get: (id) => ({ ok: true, transfer: { id, cancellable: false } }) });
    await executeTransfer(s2.store, { transferId: s2.transfer.id }, { env: ENV, now: NOW, provider: p2 });
    const no = await cancelTransfer(s2.store, { orgId: ORG, clientId: CLIENT, proposalId: s2.tasks[0].id, by: { kind: "client" } }, { env: ENV, now: NOW, provider: p2 });
    assert.equal(no.reason, "already_at_bank");
    assert.equal(p2.calls.filter((c) => c[0] === "cancel").length, 0);
  });
});

describe("expiry", () => {
  test("a proposal 3 days past its date, and an approved move never started, are closed", async () => {
    const s = setup({ tasks: [
      proposal({ due_on: "2026-10-01", created_at: "2026-09-30T15:00:00Z" }),
      proposal({ due_on: "2026-10-05", created_at: "2026-10-01T15:00:00Z" }),
      proposal({ due_on: "2026-09-25", created_at: "2026-10-06T15:00:00Z" })
    ] });
    const r = await expireOverdue(s.store, { env: ENV, now: NOW });
    assert.equal(r.proposals, 1, "only Oct 1 is more than 3 days old; a late bill proposed yesterday still counts from yesterday");
    assert.deepEqual(s.store.snapshot().tasks.map((t) => t.status), ["cancelled", "needs_approval", "needs_approval"]);
  });
});

/* ── the read for the screen ────────────────────────────────────────────── */

describe("moneyTransfersView", () => {
  test("waiting moves, what blocks a yes, limits, and no stored secret in the payload", async () => {
    const s = setup({ tasks: [
      proposal({ title: "Deposit to build banking history", due_on: "2026-10-20", amount_cents: 200000 }),
      proposal({ to_kind: "card", to_account_id: AMEX, task_key: `due:${AMEX}:2026-10-10`, source: "dues", kind: "due", amount_cents: 13500, title: "Pay $135.00 to Business Amex", requested_by_kind: "client" })
    ] });
    const v = await moneyTransfersView(s.store, { orgId: ORG, clientId: CLIENT, env: ENV, now: NOW });
    assert.equal(v.mode.environment, "sandbox");
    assert.deepEqual(v.accounts.map((a) => a.label), ["Personal Checking ••1101", "Business Checking ••2202"]);
    const [deposit, card] = [v.waiting.find((w) => w.to_kind === "bank_account"), v.waiting.find((w) => w.to_kind === "card")];
    assert.equal(deposit.date, "2026-10-20");
    assert.equal(deposit.can_approve, true);
    assert.equal(deposit.to.label, "Business Checking ••2202");
    assert.equal(card.can_approve, false);
    assert.equal(card.blocked, "card_payment");
    assert.deepEqual(v.limits, { per_transfer_cents: 250000, daily_cents: 500000, used_today_cents: 0, left_today_cents: 500000 });
    const text = JSON.stringify(v);
    assert.ok(!/encrypted|access_token|v1:x:y:z|plaid_account_id/.test(text), "no stored token, ciphertext or Plaid account id leaves the read");
  });

  test("off: every waiting move says why it cannot be approved", async () => {
    const s = setup({ tasks: [proposal()] });
    const off = { ...ENV };
    delete off.FINANCE_OS_TRANSFER_MAX_CENTS;
    const v = await moneyTransfersView(s.store, { orgId: ORG, clientId: CLIENT, env: off, now: NOW });
    assert.equal(v.mode.enabled, false);
    assert.equal(v.mode.reason, "limits_not_set");
    assert.equal(v.waiting[0].blocked, "transfers_off");
  });

  test("another org's client is not found", async () => {
    const s = setup();
    assert.equal(await moneyTransfersView(s.store, { orgId: crypto.randomUUID(), clientId: CLIENT, env: ENV, now: NOW }), null);
  });

  test("words for an ended move", () => {
    assert.equal(clientMessageFor({ status: "failed", status_reason: "credit_failed", from_account_label: "A", to_account_label: "B" }),
      "The money left A but did not reach B. Fundhub staff will sort it out with you.");
    assert.equal(clientMessageFor({ status: "cancelled", status_reason: "date_passed" }), "The date passed before it could be sent. Nothing moved.");
  });
});

describe("the scheduled pass sends what is due", () => {
  test("executeDue sends approved moves dated today and leaves later ones", async () => {
    const s = setup({ tasks: [proposal(), proposal({ due_on: "2026-10-20" })] });
    await approveTransfer(s.store, approveArgs(s.tasks[0].id), { env: ENV, now: NOW });
    await approveTransfer(s.store, approveArgs(s.tasks[1].id, { scheduledFor: "2026-10-20" }), { env: ENV, now: NOW });
    const p = fakeProvider();
    const r = await executeDue(s.store, { env: ENV, now: NOW, provider: p });
    assert.deepEqual([r.checked, r.submitted], [1, 1]);
  });
});
