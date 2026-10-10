// FinanceOS money moves — the engine (wave 5, unit W7).
//
// Owner, 2026-10-06: "Enables automated money movement and financial task
// execution… Really build the code, really build the ability to do it… so we
// can role-play and see it work simulated." Example: "Oct 20: open an account
// and deposit $20,000 to build banking history."
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ THE HARD RULE. Nothing moves without the CLIENT approving that exact      │
// │ transfer — from account, to account, amount, date — here, in FinanceOS.   │
// │ The AI money agent, the rules helper and staff can only PROPOSE.          │
// └───────────────────────────────────────────────────────────────────────────┘
//
// WHERE A MOVE LIVES, START TO END
//
//   1. PROPOSED — a money_agent_tasks row at 'needs_approval' (migration 464),
//      written by proposeTransfer in ./money-transfer-seam.mjs (unit W5): from
//      "Do task", a plan pin, the money agent, or staff. Nothing here writes a
//      second proposal. Contract: docs/finance/money-agent-tasks.md.
//   2. APPROVED — approveTransfer, the client's own press on THAT row, in one
//      transaction: the 464 row goes to 'approved' (approved_at,
//      from_account_id, approved_by_account_id), the transfer intent opens in
//      money_transfers (466) at 'approved' with the exact terms, and the 464 row
//      is claimed by this engine so the money agent never sends it twice. 466's
//      guard refuses an intent that does not match the approved row.
//   3. SENT — executeTransfer, on or after the approved date (the API runs it
//      straight away for a move dated today; the cron runs the rest): the debit
//      leg is authorized (Plaid's risk check) then created.
//   4. TRACKED — syncTransferEvents reads Plaid's event stream and moves each
//      leg (pending → posted → settled → funds_available, or failed / returned
//      / cancelled). For a move between two of the client's accounts, when the
//      debit's money is available in Fundhub's Plaid Ledger the credit leg is
//      authorized and created out to the second account.
//   5. ENDED — settled, failed, declined or cancelled. The 464 row is closed to
//      match (done / failed / cancelled) with plain words for the page, and one
//      money_agent_log line is written with 464's words.
//
// Every state change lands in money_transfer_events, written by 466's trigger.
//
// HOW PLAID MOVES MONEY, AND WHY TWO LEGS. Plaid Transfer moves money between
// one linked account and Fundhub's own Plaid Ledger balance: a debit pulls into
// the Ledger, a credit pays out of it (https://plaid.com/docs/transfer/flow-of-funds/).
// So A → B is: debit A; wait until Plaid says those funds are available (an ACH
// debit is held a few days after it settles); credit B. Paying out before the
// debit's money is available would be paying with Fundhub's money, so the
// engine never does it. A move to Fundhub (to_kind 'fundhub') is the debit alone.
//
// LIMITS AND SWITCHES (fail closed):
//   FINANCE_OS_TRANSFER_MAX_CENTS        most one move may be, in cents
//   FINANCE_OS_TRANSFER_DAILY_MAX_CENTS  most one client may move in one day
//                                        (America/New_York calendar day — the
//                                        ACH banking day)
//   Either unset (or not a whole number above 0) → nothing can be approved or
//   sent. PLAID_ENV=sandbox → Plaid's sandbox host only (fake banks). The
//   production host needs BOTH PLAID_ENV=production AND
//   FINANCE_OS_TRANSFERS_LIVE=1; any other mix is off. plaid-http.mjs refuses
//   the production host again on its own.
//
// PLAID'S OWN LIMIT ON THIS USE: "Plaid Transfer does not support peer to peer
// transfers or transfers between two accounts held by the same person"
// (https://plaid.com/docs/transfer/creating-transfers/#peer-to-peer-transfers).
// Sandbox runs it for the role-play; production needs Plaid's say-so or another
// rail behind the same provider interface (src/banking/plaid-transfer.mjs).

import crypto from "node:crypto";
import { plaidConfigFromEnv } from "../banking/plaid.mjs";
import { plaidTransferProvider, DESCRIPTIONS, NOT_ENABLED } from "../banking/plaid-transfer.mjs";
import { storeFor, SENDABLE_SUBTYPES } from "./money-transfers-store.mjs";

export const TRANSFER_ENV = Object.freeze({
  MAX: "FINANCE_OS_TRANSFER_MAX_CENTS",
  DAILY: "FINANCE_OS_TRANSFER_DAILY_MAX_CENTS",
  LIVE: "FINANCE_OS_TRANSFERS_LIVE"
});

/** An approved move still goes up to 3 days after its date (a weekend, a
 *  missed run); after that it is cancelled and nothing moves. A proposal not
 *  approved within 3 days of its date expires the same way. */
export const EXECUTION_GRACE_DAYS = 3;
/** How long after a move ends sync keeps listening for a late ACH return. */
export const RETURN_WATCH_DAYS = 70;
/** money_agent_tasks.claimed_by, and the money_agent_log brain, for this engine. */
export const ENGINE = "transfer-engine";
export const FUNDHUB_LABEL = "Fundhub";
export const ENDED = Object.freeze(["settled", "failed", "cancelled", "declined"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/* ═══════════════════════════════════════════════════════════════════════════
   1. The gate
   ═══════════════════════════════════════════════════════════════════════════ */

function positiveCents(raw) {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * transferMode(env) → { enabled, environment, live, reason, perTransferCents, dailyCents }
 *
 * reason (when off): plaid_env_not_supported | production_needs_live_flag |
 * limits_not_set | plaid_not_configured. Names env vars only, never a value.
 */
export function transferMode(env = process.env) {
  const perTransferCents = positiveCents(env[TRANSFER_ENV.MAX]);
  const dailyCents = positiveCents(env[TRANSFER_ENV.DAILY]);
  const plaidEnv = env.PLAID_ENV ? String(env.PLAID_ENV).trim() : "sandbox";
  const live = String(env[TRANSFER_ENV.LIVE] ?? "").trim() === "1";

  let environment = null;
  let reason = null;
  if (plaidEnv === "sandbox") environment = "sandbox";
  else if (plaidEnv === "production" && live) environment = "production";
  else if (plaidEnv === "production") reason = "production_needs_live_flag";
  else reason = "plaid_env_not_supported";

  if (!reason && (perTransferCents === null || dailyCents === null)) reason = "limits_not_set";
  if (!reason && !plaidConfigFromEnv(env).ready) reason = "plaid_not_configured";

  return {
    enabled: !reason,
    environment,
    live: !reason && environment === "production",
    reason,
    perTransferCents,
    dailyCents
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Small pure pieces
   ═══════════════════════════════════════════════════════════════════════════ */

/** The calendar day in New York — the ACH banking day. */
export function etToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

export function addDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "2026-10-20" → "Oct 20, 2026". */
export function dayWords(iso) {
  if (!ISO_DAY.test(String(iso || ""))) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Integer cents → "$20,000.00". */
export function dollars(cents) {
  if (!Number.isSafeInteger(cents)) return "";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** The date a proposal moves on: its due date, or today when that has passed
 *  or there is none. This is the date the client approves. */
export function scheduledDateFor(task, today) {
  const due = task && ISO_DAY.test(String(task.due_on || "")) ? task.due_on : null;
  return due && due > today ? due : today;
}

export function accountLabel(a) {
  if (!a) return "an account";
  const name = String(a.name || a.official_name || "Account").trim().slice(0, 120);
  return a.mask ? `${name} ••${String(a.mask).slice(-4)}` : name;
}

/** The exact sentence on the approve button, and kept in approval_terms. */
export function approvalWords({ amountCents, fromLabel, toLabel, date }) {
  return `Move ${dollars(amountCents)} from ${fromLabel} to ${toLabel} on ${dayWords(date)}`;
}

/** Who asked: the money agent sets detail.proposed_by = 'agent'; staff
 *  proposals are requested_by_kind 'staff'; everything else was built by the
 *  rules ("Do task", a plan pin) on the client's own list. */
export function proposedByKind(task) {
  const d = task && task.detail && typeof task.detail === "object" ? task.detail : {};
  if (["agent", "rules", "staff", "client"].includes(d.proposed_by)) return d.proposed_by;
  return task && task.requested_by_kind === "staff" ? "staff" : "rules";
}

/** Plaid wants the account holder's legal name; a business account uses the
 *  business (https://plaid.com/docs/api/products/transfer/initiating-transfers/,
 *  user.legal_name). */
export function legalNameFor(account, client) {
  if (account && account.entity_kind === "business" && account.entity_name) return String(account.entity_name).slice(0, 120);
  const name = [client && client.first_name, client && client.last_name].filter(Boolean).join(" ").trim();
  return (name || "Fundhub client").slice(0, 120);
}

export function isSendable(a) {
  return !!(a && a.account_type === "depository" && SENDABLE_SUBTYPES.includes(String(a.account_subtype || "").toLowerCase())
    && !a.closed_at && !a.is_demo && a.plaid_account_id && a.item && a.item.link_state === "active"
    && a.item.consent_granted_at && a.item.encrypted_access_token);
}

const LEG_RANK = Object.freeze({ pending: 0, posted: 1, settled: 2, funds_available: 3 });
const LEG_FINAL = Object.freeze(["failed", "cancelled", "returned"]);

/**
 * legAfterEvent(current, eventType) → the leg's next status, or null when the
 * event changes nothing. Only Plaid's TransferStatus words move a leg; sweep,
 * refund, guarantee and adjustment events are recorded but move nothing
 * (https://plaid.com/docs/api/products/transfer/reading-transfers/#transfereventsync).
 * A leg only goes forward, and a failed / cancelled / returned leg is final.
 */
export function legAfterEvent(current, eventType) {
  if (!(eventType in LEG_RANK) && !LEG_FINAL.includes(eventType)) return null;
  if (LEG_FINAL.includes(current)) return null;
  if (eventType === current) return null;
  if (LEG_FINAL.includes(eventType)) return eventType;
  if (current === null || current === undefined) return eventType;
  return LEG_RANK[eventType] > LEG_RANK[current] ? eventType : null;
}

/**
 * overallStatus(row) → { status, reason } — the move as a whole, from its legs.
 * Pure, so the mapping is tested on its own (statuses from events).
 */
export function overallStatus(row) {
  const s = row.status;
  if (s === "cancelled" || s === "declined") return { status: s, reason: row.status_reason ?? null };
  const d = row.debit_status;
  const c = row.credit_status;
  if (d === "failed") return { status: "failed", reason: "debit_failed" };
  if (d === "returned") return { status: "failed", reason: row.credit_transfer_id ? "debit_returned_after_credit" : "debit_returned" };
  if (d === "cancelled") return s === "submitted" ? { status: "cancelled", reason: "debit_cancelled" } : { status: s, reason: row.status_reason ?? null };
  if (s === "failed") return { status: "failed", reason: row.status_reason ?? null };
  if (row.to_kind === "fundhub") {
    return d === "settled" || d === "funds_available" ? { status: "settled", reason: null } : { status: s, reason: null };
  }
  if (c === "failed" || c === "returned" || c === "cancelled") return { status: "failed", reason: `credit_${c}` };
  if (c === "settled" || c === "funds_available") return { status: "settled", reason: null };
  return { status: s, reason: row.status_reason ?? null };
}

/** Plain words for the 464 row's result.client_message (≤ 200 characters). */
export function clientMessageFor(t) {
  const from = t.from_account_label || "your account";
  const to = t.to_account_label || "the other account";
  const r = String(t.status_reason || "");
  if (t.status === "declined") {
    return r.startsWith("NSF") ? `The bank check said no: not enough money in ${from}. Nothing moved.`
      : "The bank check said no to this move. Nothing moved.";
  }
  if (t.status === "cancelled") {
    if (r === "date_passed") return "The date passed before it could be sent. Nothing moved.";
    if (t.cancelled_by_kind === "client") return "You stopped this. Nothing moved.";
    if (t.cancelled_by_kind === "staff") return "Fundhub stopped this. Nothing moved.";
    return "This was stopped. Nothing moved.";
  }
  if (t.status === "failed") {
    if (r === "debit_returned_after_credit") return "Your bank sent the money back after it was paid out. Fundhub staff will contact you.";
    if (r.startsWith("credit_")) return `The money left ${from} but did not reach ${to}. Fundhub staff will sort it out with you.`;
    if (r === "debit_returned") return `Your bank sent the money back to ${from}.`;
    if (r === "from_account_unavailable") return `${from} is not connected any more, so nothing moved.`;
    if (r === "to_account_unavailable") return `${to} is not connected any more, so nothing moved.`;
    return "The bank did not take this move. Nothing moved.";
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Approval — the client's press on one proposal
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * approveTransfer(db, { orgId, clientId, proposalId, amountCents, fromAccountId,
 *                       toAccountId, scheduledFor, approvedByAccountId,
 *                       authorizedRep }, { env, now })
 *
 * The client's yes on THAT exact move. proposalId is the 464 row
 * (money_agent_tasks.id). The caller echoes what the screen showed — the
 * amount, the destination, the date — and the account the client picked; any
 * difference from the row is refused rather than "fixed". An authorized
 * representative's login cannot approve a money move: only the account owner.
 *
 * → { ok: true, transfer, words } | { ok: false, reason }
 *   reasons: transfers_disabled | missing_ids | owner_only | bad_amount |
 *            not_found | not_waiting | destination_not_supported |
 *            amount_changed | destination_changed | date_changed |
 *            over_transfer_limit | over_daily_limit | from_not_sendable |
 *            destination_not_sendable | same_account
 */
export async function approveTransfer(db, input = {}, opts = {}) {
  if (input.authorizedRep) return refuse("owner_only");
  if (!isUuid(input.approvedByAccountId)) return refuse("missing_ids");
  return approveCore(db, input, {
    ...opts,
    approver: { kind: "client", accountId: input.approvedByAccountId, clientId: input.clientId, actorKind: "client", actorId: input.approvedByAccountId }
  });
}

/**
 * approveTransferAsSandboxRolePlay — SANDBOX ROLE-PLAY ONLY. Not reachable over
 * HTTP; scripts/finance-os-sandbox-transfer.mjs uses it to play the client in a
 * simulation. The row says 'sandbox_role_play', never 'client', and 466 refuses
 * that approver on anything but a sandbox row — so it can never move real money.
 */
export async function approveTransferAsSandboxRolePlay(db, input = {}, opts = {}) {
  const env = opts.env || process.env;
  const mode = transferMode(env);
  if (!mode.enabled || mode.environment !== "sandbox" || String(env.PLAID_ENV || "sandbox").trim() !== "sandbox"
      || String(env[TRANSFER_ENV.LIVE] ?? "").trim() === "1") {
    return refuse("sandbox_only");
  }
  return approveCore(db, input, {
    ...opts,
    approver: { kind: "sandbox_role_play", accountId: null, clientId: null, actorKind: "sandbox_role_play", actorId: String(input.actorId || "sandbox-role-play").slice(0, 120) }
  });
}

async function approveCore(db, input, { env = process.env, now = new Date(), approver }) {
  const mode = transferMode(env);
  if (!mode.enabled) return refuse("transfers_disabled", { why: mode.reason });
  const { orgId, clientId, proposalId } = input;
  if (!isUuid(orgId) || !isUuid(clientId) || !isUuid(proposalId) || !isUuid(input.fromAccountId)) return refuse("missing_ids");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return refuse("bad_amount");
  const store = storeFor(db);
  const today = etToday(now);
  const at = now.toISOString();

  return store.tx(async (s) => {
    const task = await s.task(orgId, clientId, proposalId, { forUpdate: true });
    if (!task || !task.moves_money || task.assignee !== "agent") return refuse("not_found");
    if (task.status !== "needs_approval") return refuse("not_waiting", { status: task.status });
    if (task.to_kind !== "bank_account" && task.to_kind !== "fundhub") return refuse("destination_not_supported");
    if (Number(task.amount_cents) !== input.amountCents) return refuse("amount_changed");
    const toId = task.to_kind === "fundhub" ? null : task.to_account_id;
    if ((input.toAccountId ?? null) !== (toId ?? null)) return refuse("destination_changed");
    const date = scheduledDateFor(task, today);
    if (input.scheduledFor !== date) return refuse("date_changed", { date });
    if (input.amountCents > mode.perTransferCents) return refuse("over_transfer_limit");

    const from = await s.account(orgId, clientId, input.fromAccountId);
    if (!isSendable(from)) return refuse("from_not_sendable");
    if (toId && toId === from.id) return refuse("same_account");
    let to = null;
    if (toId) {
      to = await s.account(orgId, clientId, toId);
      if (!isSendable(to)) return refuse("destination_not_sendable");
    }

    await s.lockClient(orgId, clientId);
    const planned = await s.plannedOnDay(orgId, clientId, date, null);
    if (planned + input.amountCents > mode.dailyCents) return refuse("over_daily_limit", { planned_cents: planned });

    const fromLabel = accountLabel(from);
    const toLabel = to ? accountLabel(to) : FUNDHUB_LABEL;
    const words = approvalWords({ amountCents: input.amountCents, fromLabel, toLabel, date });
    const terms = {
      from_bank_account_id: from.id, from_label: fromLabel,
      to_kind: task.to_kind, to_bank_account_id: toId, to_label: toLabel,
      amount_cents: input.amountCents, scheduled_for: date, title: task.title, words
    };

    if (!(await s.approveTask(task.id, { fromAccountId: from.id, approvedByAccountId: approver.accountId, at }))) {
      return refuse("not_waiting");
    }
    const transfer = await s.insertTransfer({
      org_id: orgId, client_id: clientId, agent_task_id: task.id,
      to_kind: task.to_kind, from_bank_account_id: from.id, to_bank_account_id: toId,
      from_account_label: fromLabel, to_account_label: toLabel,
      amount_cents: input.amountCents, scheduled_for: date,
      environment: mode.environment, network: "ach", status: "approved",
      proposed_by_kind: proposedByKind(task),
      approved_by_kind: approver.kind, approved_by_account_id: approver.accountId, approved_by_client_id: approver.clientId,
      approved_at: at, approval_terms: terms,
      idempotency_key: `mt-${task.id}`,
      last_actor_kind: approver.actorKind, last_actor_id: approver.actorId,
      last_event_type: "approved", last_event_detail: { words }
    });
    await s.claimTask(task.id, { claimedBy: ENGINE, at });
    return { ok: true, transfer, words };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Sending — the debit leg, then (A → B) the credit leg
   ═══════════════════════════════════════════════════════════════════════════ */

const meta = (actorKind, actorId, eventType, detail = {}, providerEventId = null) =>
  ({ actorKind, actorId, eventType, detail, providerEventId });

function termsMatch(t) {
  const a = t.approval_terms || {};
  return a.amount_cents === t.amount_cents && a.scheduled_for === t.scheduled_for && a.to_kind === t.to_kind
    && (a.to_bank_account_id ?? null) === (t.to_bank_account_id ?? null)
    && (t.from_bank_account_id === null || a.from_bank_account_id === t.from_bank_account_id);
}

/** Close the 464 proposal to match an ended move, and log it with 464's words. */
async function closeProposal(s, t, now) {
  const map = { settled: ["done", "task_done"], failed: ["failed", "task_failed"], declined: ["failed", "task_failed"], cancelled: ["cancelled", "task_cancelled"] };
  const m = map[t.status];
  if (!m) return;
  const message = clientMessageFor(t);
  const at = now.toISOString();
  const closed = await s.finishTask(t.agent_task_id, {
    status: m[0], at, clientMessage: m[0] === "done" ? null : message,
    extra: { transfer_id: t.id, transfer_status: t.status }
  });
  if (!closed) return;
  await s.logTaskFinish({
    orgId: t.org_id, clientId: t.client_id, itemKind: "money_task", itemId: t.agent_task_id,
    itemLabel: String((t.approval_terms && t.approval_terms.title) || "Money move").slice(0, 200),
    decidedOn: etToday(now), action: m[1], actor: "agent", brain: ENGINE,
    reason: m[0] === "done" ? `sent ${dollars(t.amount_cents)} to ${t.to_account_label}` : message,
    amountCents: t.amount_cents, idempotencyKey: `money-task:${t.agent_task_id}:${m[1]}`,
    detail: { transfer_id: t.id, transfer_status: t.status, status_reason: t.status_reason ?? null, environment: t.environment }
  });
}

async function writeEnd(s, t, expect, patch, m, now) {
  const row = await s.updateTransfer(t.id, expect, patch, m);
  if (row && ENDED.includes(row.status) && row.status !== expect) await closeProposal(s, row, now);
  return row;
}

function providerFor(mode, env, provider) {
  return provider || plaidTransferProvider({ env, environment: mode.environment });
}

/**
 * executeTransfer(db, { transferId }, { env, now, provider })
 *
 * Sends the debit leg of one approved move, if its day has come. Safe to call
 * twice, from two places at once: the day reservation is one row update under a
 * per-client lock, Plaid's authorization carries an idempotency key built from
 * the move, and /transfer/create is idempotent on the authorization id — a
 * second call gets the same authorization and the same transfer back.
 *
 * → { ok, step, transfer, reason? }   step: submitted | not_due | nothing_to_do
 */
export async function executeTransfer(db, { transferId } = {}, { env = process.env, now = new Date(), provider = null } = {}) {
  const mode = transferMode(env);
  if (!mode.enabled) return refuse("transfers_disabled", { why: mode.reason });
  const store = storeFor(db);
  let t = await store.transfer(transferId);
  if (!t) return refuse("not_found");
  if (t.environment !== mode.environment) return refuse("wrong_environment");
  if (!["approved", "authorized"].includes(t.status) || t.debit_transfer_id) return { ok: true, step: "nothing_to_do", transfer: t };
  if (!t.approved_at || !termsMatch(t)) return refuse("approval_mismatch");

  const today = etToday(now);
  if (t.scheduled_for > today) return { ok: true, step: "not_due", transfer: t };
  if (t.status === "approved" && addDays(t.scheduled_for, EXECUTION_GRACE_DAYS) < today) {
    const row = await store.tx((s) => writeEnd(s, t, "approved",
      { status: "cancelled", status_reason: "date_passed", cancelled_at: now.toISOString(), cancelled_by_kind: "system", cancelled_by_id: ENGINE },
      meta("system", ENGINE, "date_passed", { scheduled_for: t.scheduled_for }), now));
    return refuse("date_passed", { transfer: row });
  }
  if (t.amount_cents > mode.perTransferCents) return refuse("over_transfer_limit", { transfer: t });

  const client = await store.client(t.org_id, t.client_id);
  const from = await store.account(t.org_id, t.client_id, t.from_bank_account_id);
  if (!isSendable(from)) {
    const row = await store.tx((s) => writeEnd(s, t, t.status, { status: "failed", status_reason: "from_account_unavailable" },
      meta("system", ENGINE, "failed", { why: "from_account_unavailable" }), now));
    return refuse("from_account_unavailable", { transfer: row });
  }
  if (t.to_kind === "bank_account") {
    const to = await store.account(t.org_id, t.client_id, t.to_bank_account_id);
    if (!isSendable(to)) {
      const row = await store.tx((s) => writeEnd(s, t, t.status, { status: "failed", status_reason: "to_account_unavailable" },
        meta("system", ENGINE, "failed", { why: "to_account_unavailable" }), now));
      return refuse("to_account_unavailable", { transfer: row });
    }
  }

  // Reserve today's room under the per-day cap — once per move.
  if (t.status === "approved" && !t.started_at) {
    const r = await store.tx(async (s) => {
      await s.lockClient(t.org_id, t.client_id);
      const used = await s.usedOnDay(t.org_id, t.client_id, today, t.id);
      if (used + t.amount_cents > mode.dailyCents) return { over: true, used };
      const row = await s.updateTransfer(t.id, "approved", { started_at: now.toISOString() },
        meta("system", ENGINE, "started", { day: today }));
      if (row) {
        await s.appendEvent({ transfer_id: row.id, org_id: row.org_id, client_id: row.client_id, event_type: "started",
          from_status: "approved", to_status: "approved", actor_kind: "system", actor_id: ENGINE,
          detail: { day: today, used_today_cents: used } });
      }
      return { row };
    });
    if (r.over) return refuse("over_daily_limit", { used_cents: r.used, transfer: t });
    if (!r.row) return { ok: true, step: "nothing_to_do", transfer: await store.transfer(t.id) };
    t = r.row;
  }

  const p = providerFor(mode, env, provider);

  if (t.status === "approved") {
    const a = await p.authorizeLeg({
      type: "debit", account: from, amountCents: t.amount_cents, network: t.network,
      legalName: legalNameFor(from, client), idempotencyKey: `${t.idempotency_key}-d`
    });
    if (!a.ok) {
      if (a.retryable || a.reason === "held" || a.reason === NOT_ENABLED) {
        await store.appendEvent({ transfer_id: t.id, org_id: t.org_id, client_id: t.client_id,
          event_type: a.reason === NOT_ENABLED ? "provider_not_enabled" : "provider_wait", from_status: t.status, to_status: t.status,
          leg: "debit", actor_kind: "provider", actor_id: "plaid",
          detail: { leg: "debit", reason: a.reason, error_code: a.errorCode ?? null, error: a.error ?? null } });
        return refuse(a.reason, { retryable: true, transfer: t });
      }
      const row = await store.tx((s) => writeEnd(s, t, "approved",
        { status: "failed", status_reason: String(`plaid:${a.errorCode || a.reason}`).slice(0, 300) },
        meta("provider", "plaid", "failed", { leg: "debit", reason: a.reason, error_code: a.errorCode ?? null, error: a.error ?? null }), now));
      return refuse("provider_error", { error_code: a.errorCode ?? null, error: a.error ?? null, transfer: row });
    }
    if (a.decision === "user_action_required") {
      // No id is kept: Plaid does not apply idempotency to this decision, and
      // the next try after the client fixes the bank login gets a new one.
      await store.appendEvent({ transfer_id: t.id, org_id: t.org_id, client_id: t.client_id, event_type: "needs_bank_login",
        from_status: t.status, to_status: t.status, leg: "debit", actor_kind: "provider", actor_id: "plaid",
        detail: { leg: "debit", decision: a.decision } });
      return refuse("needs_bank_login", { transfer: t });
    }
    if (a.decision === "declined") {
      const row = await store.tx((s) => writeEnd(s, t, "approved", {
        status: "declined", status_reason: String(`${a.rationaleCode || "DECLINED"}: ${a.rationaleDescription || ""}`).trim().slice(0, 300),
        debit_authorization_id: a.authorizationId, debit_authorization_decision: "declined"
      }, meta("provider", "plaid", "declined", { leg: "debit", rationale_code: a.rationaleCode, rationale: a.rationaleDescription }), now));
      return refuse("declined", { rationale_code: a.rationaleCode, transfer: row });
    }
    const row = await store.updateTransfer(t.id, "approved", {
      status: "authorized", debit_authorization_id: a.authorizationId, debit_authorization_decision: "approved"
    }, meta("provider", "plaid", "authorized", { leg: "debit", rationale_code: a.rationaleCode ?? null }));
    t = row || (await store.transfer(t.id));
    if (!t || t.status !== "authorized") return { ok: true, step: "nothing_to_do", transfer: t };
  }

  const c = await p.createLeg({
    account: from, authorizationId: t.debit_authorization_id, amountCents: t.amount_cents,
    description: DESCRIPTIONS[t.to_kind], metadata: { fundhub_transfer_id: t.id, leg: "debit" }
  });
  if (!c.ok) {
    if (c.retryable || c.reason === "held") {
      await store.appendEvent({ transfer_id: t.id, org_id: t.org_id, client_id: t.client_id, event_type: "provider_wait",
        from_status: t.status, to_status: t.status, leg: "debit", actor_kind: "provider", actor_id: "plaid",
        detail: { leg: "debit", step: "create", reason: c.reason, error_code: c.errorCode ?? null, error: c.error ?? null } });
      return refuse(c.reason, { retryable: true, transfer: t });
    }
    const row = await store.tx((s) => writeEnd(s, t, "authorized",
      { status: "failed", status_reason: String(`plaid:${c.errorCode || c.reason}`).slice(0, 300) },
      meta("provider", "plaid", "failed", { leg: "debit", step: "create", error_code: c.errorCode ?? null, error: c.error ?? null }), now));
    return refuse("provider_error", { error_code: c.errorCode ?? null, transfer: row });
  }
  const sent = await store.updateTransfer(t.id, "authorized", {
    status: "submitted", debit_transfer_id: c.transferId, debit_status: legAfterEvent(null, c.status) || "pending"
  }, meta("provider", "plaid", "submitted", { leg: "debit", plaid_transfer_id: c.transferId }));
  return { ok: true, step: "submitted", transfer: sent || (await store.transfer(t.id)) };
}

/**
 * startCreditLeg — for a move between two of the client's accounts, once the
 * debit's money is available in the Ledger: authorize and create the credit to
 * the second account. Same idempotency rules as the debit.
 */
async function startCreditLeg(store, t, { mode, env, now, provider }) {
  const to = await store.account(t.org_id, t.client_id, t.to_bank_account_id);
  if (!isSendable(to)) {
    await store.tx((s) => writeEnd(s, t, "submitted", { status: "failed", status_reason: "credit_failed: to_account_unavailable" },
      meta("system", ENGINE, "failed", { leg: "credit", why: "to_account_unavailable" }), now));
    return { ok: false, reason: "to_account_unavailable" };
  }
  const client = await store.client(t.org_id, t.client_id);
  const p = providerFor(mode, env, provider);
  let authId = t.credit_authorization_id;
  if (!authId) {
    const a = await p.authorizeLeg({
      type: "credit", account: to, amountCents: t.amount_cents, network: t.network,
      legalName: legalNameFor(to, client), idempotencyKey: `${t.idempotency_key}-c`
    });
    if (!a.ok || a.decision === "user_action_required") {
      if (!a.ok && !a.retryable && a.reason !== "held" && a.reason !== NOT_ENABLED) {
        await store.tx((s) => writeEnd(s, t, "submitted", { status: "failed", status_reason: String(`credit_failed: plaid:${a.errorCode || a.reason}`).slice(0, 300) },
          meta("provider", "plaid", "failed", { leg: "credit", error_code: a.errorCode ?? null, error: a.error ?? null }), now));
        return { ok: false, reason: "provider_error" };
      }
      await store.appendEvent({ transfer_id: t.id, org_id: t.org_id, client_id: t.client_id,
        event_type: a.ok ? "needs_bank_login" : "provider_wait", from_status: t.status, to_status: t.status, leg: "credit",
        actor_kind: "provider", actor_id: "plaid", detail: { leg: "credit", reason: a.ok ? a.decision : a.reason, error_code: a.errorCode ?? null } });
      return { ok: false, reason: a.ok ? "needs_bank_login" : a.reason, retryable: true };
    }
    if (a.decision === "declined") {
      await store.tx((s) => writeEnd(s, t, "submitted", {
        status: "failed", status_reason: String(`credit_declined: ${a.rationaleCode || ""} ${a.rationaleDescription || ""}`).trim().slice(0, 300),
        credit_authorization_id: a.authorizationId, credit_authorization_decision: "declined"
      }, meta("provider", "plaid", "failed", { leg: "credit", rationale_code: a.rationaleCode, rationale: a.rationaleDescription }), now));
      return { ok: false, reason: "declined" };
    }
    const row = await store.updateTransfer(t.id, "submitted",
      { credit_authorization_id: a.authorizationId, credit_authorization_decision: "approved" },
      meta("provider", "plaid", "credit_authorized", { leg: "credit" }));
    if (!row) return { ok: false, reason: "moved" };
    // No status changed, so the trigger writes nothing — the ledger still gets a line.
    await store.appendEvent({ transfer_id: t.id, org_id: t.org_id, client_id: t.client_id, event_type: "credit_authorized",
      from_status: "submitted", to_status: "submitted", debit_status: row.debit_status, credit_status: row.credit_status,
      leg: "credit", actor_kind: "provider", actor_id: "plaid", detail: { leg: "credit", rationale_code: a.rationaleCode ?? null } });
    t = row;
    authId = a.authorizationId;
  }
  const c = await p.createLeg({
    account: to, authorizationId: authId, amountCents: t.amount_cents,
    description: DESCRIPTIONS.bank_account, metadata: { fundhub_transfer_id: t.id, leg: "credit" }
  });
  if (!c.ok) {
    if (c.retryable || c.reason === "held") {
      await store.appendEvent({ transfer_id: t.id, org_id: t.org_id, client_id: t.client_id, event_type: "provider_wait",
        from_status: t.status, to_status: t.status, leg: "credit", actor_kind: "provider", actor_id: "plaid",
        detail: { leg: "credit", step: "create", reason: c.reason, error_code: c.errorCode ?? null } });
      return { ok: false, reason: c.reason, retryable: true };
    }
    await store.tx((s) => writeEnd(s, t, "submitted", { status: "failed", status_reason: String(`credit_failed: plaid:${c.errorCode || c.reason}`).slice(0, 300) },
      meta("provider", "plaid", "failed", { leg: "credit", step: "create", error_code: c.errorCode ?? null }), now));
    return { ok: false, reason: "provider_error" };
  }
  const row = await store.updateTransfer(t.id, "submitted",
    { credit_transfer_id: c.transferId, credit_status: legAfterEvent(null, c.status) || "pending" },
    meta("provider", "plaid", "credit_submitted", { leg: "credit", plaid_transfer_id: c.transferId }));
  return { ok: !!row, transfer: row };
}

/** Start every credit leg whose debit money is available. */
export async function advanceTransfers(db, { env = process.env, now = new Date(), provider = null } = {}) {
  const mode = transferMode(env);
  if (!mode.enabled) return refuse("transfers_disabled", { why: mode.reason });
  const store = storeFor(db);
  const ready = await store.readyForCredit(mode.environment);
  const out = { checked: ready.length, started: 0, waiting: 0, failed: 0 };
  for (const t of ready) {
    const r = await startCreditLeg(store, t, { mode, env, now, provider });
    if (r.ok) out.started += 1;
    else if (r.retryable) out.waiting += 1;
    else out.failed += 1;
  }
  return { ok: true, ...out };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Tracking — Plaid's event stream into leg statuses
   ═══════════════════════════════════════════════════════════════════════════ */

async function applyLegEvent(store, hit, ev, now) {
  return store.tx(async (s) => {
    const cur = await s.transfer(hit.transfer.id, { forUpdate: true });
    if (!cur) return { applied: false };
    const legKey = `${hit.leg}_status`;
    const next = legAfterEvent(cur[legKey], ev.eventType);
    const detail = {
      leg: hit.leg, plaid_event_type: ev.eventType, plaid_transfer_id: ev.transferId,
      failure: ev.failureReason || null, at: ev.timestamp || null
    };
    if (!next) {
      // Recorded once, changes nothing (a sweep, a refund, a repeat).
      await s.appendEvent({ transfer_id: cur.id, org_id: cur.org_id, client_id: cur.client_id,
        event_type: `plaid_${String(ev.eventType).replace(/[^a-z_.]/gi, "")}`.slice(0, 60),
        from_status: cur.status, to_status: cur.status, debit_status: cur.debit_status, credit_status: cur.credit_status,
        leg: hit.leg, provider_event_id: ev.eventId, actor_kind: "provider", actor_id: "plaid", detail });
      return { applied: false };
    }
    const draft = { ...cur, [legKey]: next };
    const { status, reason } = overallStatus(draft);
    const patch = { [legKey]: next };
    if (status !== cur.status) {
      patch.status = status;
      if (reason) patch.status_reason = reason;
      if (status === "settled") patch.settled_at = now.toISOString();
      if (status === "cancelled") { patch.cancelled_at = now.toISOString(); patch.cancelled_by_kind = "system"; patch.cancelled_by_id = "plaid"; }
    }
    if (ev.failureReason && !patch.status_reason && (next === "failed" || next === "returned")) {
      patch.status_reason = String(`${hit.leg}_${next}: ${ev.failureReason.achReturnCode || ev.failureReason.failureCode || ""} ${ev.failureReason.description || ""}`).trim().slice(0, 300);
    }
    const row = await writeEnd(s, cur, cur.status, patch,
      meta("provider", "plaid", `plaid_${ev.eventType}`, detail, ev.eventId), now);
    return { applied: !!row };
  });
}

/**
 * syncTransferEvents(db, { env, now, provider, maxPages })
 *
 * Reads Plaid's /transfer/event/sync from the saved cursor, applies each event
 * that belongs to one of our legs, saves the cursor after each page, then starts
 * any credit leg whose debit money is now available. Skips the Plaid call when
 * nothing open or recently ended could hear from it.
 */
export async function syncTransferEvents(db, { env = process.env, now = new Date(), provider = null, maxPages = 10, force = false } = {}) {
  const mode = transferMode(env);
  if (!mode.enabled) return refuse("transfers_disabled", { why: mode.reason });
  const store = storeFor(db);
  const since = new Date(now.getTime() - RETURN_WATCH_DAYS * 86_400_000).toISOString();
  if (!force && !(await store.needsSync(mode.environment, since))) return { ok: true, skipped: "nothing_open" };

  const p = providerFor(mode, env, provider);
  let after = await store.cursor(mode.environment);
  const tally = { pages: 0, seen: 0, matched: 0, applied: 0 };
  while (tally.pages < maxPages) {
    const page = await p.eventsPage(after);
    if (!page.ok) return refuse(page.reason, { error_code: page.errorCode ?? null, retryable: !!page.retryable, ...tally });
    tally.pages += 1;
    const events = [...page.events].sort((a, b) => a.eventId - b.eventId);
    for (const ev of events) {
      tally.seen += 1;
      if (!ev.transferId) continue;
      const hit = await store.transferByLeg(mode.environment, ev.transferId);
      if (!hit) continue;
      tally.matched += 1;
      const r = await applyLegEvent(store, hit, ev, now);
      if (r.applied) tally.applied += 1;
    }
    if (page.lastId > after) {
      await store.setCursor(mode.environment, page.lastId);
      after = page.lastId;
    }
    if (!page.hasMore) break;
  }
  const advanced = await advanceTransfers(store, { env, now, provider: p });
  return { ok: true, ...tally, cursor: after, advanced };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Stopping — a proposal, or a move not yet sent to the bank
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * cancelTransfer(db, { orgId, clientId, proposalId, by: { kind, id } }, { env, now, provider })
 *
 * kind: 'client' | 'staff'. Works on the 464 proposal id:
 *   needs_approval            → the proposal is closed as cancelled ("Not now")
 *   approved / authorized     → nothing reached the bank yet; the move is cancelled
 *   submitted, debit pending  → asks Plaid; cancelled only if Plaid says it can be
 *   anything later            → refused: it already went to the bank
 */
export async function cancelTransfer(db, { orgId, clientId, proposalId, by = {} } = {}, { env = process.env, now = new Date(), provider = null } = {}) {
  if (!isUuid(orgId) || !isUuid(clientId) || !isUuid(proposalId)) return refuse("missing_ids");
  if (by.kind !== "client" && by.kind !== "staff") return refuse("bad_actor");
  const store = storeFor(db);
  const at = now.toISOString();
  const byId = by.id ? String(by.id).slice(0, 120) : null;
  const task = await store.task(orgId, clientId, proposalId);
  if (!task || !task.moves_money) return refuse("not_found");

  if (task.status === "needs_approval") {
    const words = by.kind === "client" ? "You said not now. Nothing moved." : "Fundhub took this off your list. Nothing moved.";
    const done = await store.tx(async (s) => {
      const ok = await s.finishTask(task.id, { status: "cancelled", at, clientMessage: words, extra: { cancelled_by: by.kind } });
      if (ok) {
        await s.logTaskFinish({
          orgId, clientId, itemKind: "money_task", itemId: task.id, itemLabel: String(task.title).slice(0, 200),
          decidedOn: etToday(now), action: "task_cancelled", actor: by.kind, brain: null, reason: words,
          amountCents: Number(task.amount_cents) || null, idempotencyKey: `money-task:${task.id}:task_cancelled`,
          detail: { stage: "proposal" }
        });
      }
      return ok;
    });
    return done ? { ok: true, stage: "proposal" } : refuse("not_waiting");
  }

  const t = await store.transferByTask(task.id);
  if (!t) return refuse("finished", { status: task.status });
  const patch = { status: "cancelled", cancelled_at: at, cancelled_by_kind: by.kind, cancelled_by_id: byId, status_reason: `cancelled_by_${by.kind}` };

  if (t.status === "approved" || (t.status === "authorized" && !t.debit_transfer_id)) {
    const row = await store.tx((s) => writeEnd(s, t, t.status, patch, meta(by.kind, byId, "cancelled", { stage: t.status }), now));
    return row ? { ok: true, stage: "before_bank", transfer: row } : refuse("moved");
  }

  if (t.status === "submitted" && !t.credit_transfer_id && !t.credit_authorization_id && t.debit_status === "pending") {
    const mode = transferMode(env);
    if (!mode.enabled || mode.environment !== t.environment) return refuse("transfers_disabled", { why: mode.reason });
    const p = providerFor(mode, env, provider);
    const g = await p.getLeg(t.debit_transfer_id);
    if (!g.ok) return refuse("provider_error", { error_code: g.errorCode ?? null, retryable: !!g.retryable });
    if (g.transfer.cancellable !== true) return refuse("already_at_bank");
    const c = await p.cancelLeg(t.debit_transfer_id);
    if (!c.ok) return refuse(c.retryable ? "provider_error" : "already_at_bank", { error_code: c.errorCode ?? null });
    const row = await store.tx((s) => writeEnd(s, t, "submitted", { ...patch, debit_status: "cancelled" },
      meta(by.kind, byId, "cancelled", { stage: "submitted", leg: "debit" }), now));
    return row ? { ok: true, stage: "at_plaid", transfer: row } : refuse("moved");
  }
  return refuse(ENDED.includes(t.status) ? "finished" : "already_at_bank", { status: t.status });
}

/**
 * expireOverdue(db, { env, now }) — a proposal not approved, or an approved move
 * not started, within EXECUTION_GRACE_DAYS of its date is closed. Nothing moves.
 */
export async function expireOverdue(db, { env = process.env, now = new Date() } = {}) {
  const mode = transferMode(env);
  if (!mode.enabled) return refuse("transfers_disabled", { why: mode.reason });
  const store = storeFor(db);
  const today = etToday(now);
  const cutoff = addDays(today, -EXECUTION_GRACE_DAYS);
  const at = now.toISOString();
  const out = { proposals: 0, moves: 0 };
  const words = "This was not approved in time, so it was not sent. Nothing moved.";
  for (const p of await store.overdueProposals(cutoff)) {
    const ok = await store.tx(async (s) => {
      const done = await s.finishTask(p.id, { status: "cancelled", at, clientMessage: words, extra: { expired: true } });
      if (done) {
        await s.logTaskFinish({
          orgId: p.org_id, clientId: p.client_id, itemKind: "money_task", itemId: p.id, itemLabel: "Money move",
          decidedOn: today, action: "task_cancelled", actor: "agent", brain: ENGINE, reason: words,
          idempotencyKey: `money-task:${p.id}:task_cancelled`, detail: { expired: true }
        });
      }
      return done;
    });
    if (ok) out.proposals += 1;
  }
  for (const t of await store.overdueTransfers(mode.environment, cutoff)) {
    const row = await store.tx((s) => writeEnd(s, t, "approved",
      { status: "cancelled", status_reason: "date_passed", cancelled_at: at, cancelled_by_kind: "system", cancelled_by_id: ENGINE },
      meta("system", ENGINE, "date_passed", { scheduled_for: t.scheduled_for }), now));
    if (row) out.moves += 1;
  }
  return { ok: true, ...out };
}

/** Send every approved move whose day has come. */
export async function executeDue(db, { env = process.env, now = new Date(), provider = null, limit = 50 } = {}) {
  const mode = transferMode(env);
  if (!mode.enabled) return refuse("transfers_disabled", { why: mode.reason });
  const store = storeFor(db);
  const due = await store.dueTransfers(mode.environment, etToday(now), limit);
  const out = { checked: due.length, submitted: 0, waiting: 0, stopped: 0 };
  for (const t of due) {
    const r = await executeTransfer(store, { transferId: t.id }, { env, now, provider });
    if (r.ok && r.step === "submitted") out.submitted += 1;
    else if (!r.ok && (r.retryable || ["over_daily_limit", "needs_bank_login", "over_transfer_limit"].includes(r.reason))) out.waiting += 1;
    else if (!r.ok) out.stopped += 1;
  }
  return { ok: true, ...out };
}

/**
 * runTransfersPass — the scheduled pass (src/workflows/finance-os-money-transfers.mjs):
 * expire, send what is due, read Plaid's events, start credit legs. Does nothing
 * at all when transfers are off.
 */
export async function runTransfersPass(db, { env = process.env, now = new Date(), provider = null, step = null } = {}) {
  const mode = transferMode(env);
  if (!mode.enabled) return { ok: true, skipped: "transfers_disabled", why: mode.reason };
  const run = (name, fn) => (step && typeof step.run === "function" ? step.run(name, fn) : fn());
  const expired = await run("expire", () => expireOverdue(db, { env, now }));
  const sent = await run("send-due", () => executeDue(db, { env, now, provider }));
  const synced = await run("sync-events", () => syncTransferEvents(db, { env, now, provider }));
  return { ok: true, environment: mode.environment, expired, sent, synced };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. The read for the screen — GET /api/money/transfers
   ═══════════════════════════════════════════════════════════════════════════ */

function eventView(e) {
  return {
    type: e.event_type, at: e.created_at instanceof Date ? e.created_at.toISOString() : e.created_at,
    leg: e.leg ?? null, actor: e.actor_kind, from_status: e.from_status ?? null, to_status: e.to_status ?? null
  };
}

/**
 * moneyTransfersView(db, { orgId, clientId, env, now }) → the page payload, or
 * null when the client is not in the org. Builds its own shapes: no stored
 * token, ciphertext or Plaid id beyond the leg statuses leaves this function.
 */
export async function moneyTransfersView(db, { orgId, clientId, env = process.env, now = new Date() } = {}) {
  const store = storeFor(db);
  const client = await store.client(orgId, clientId);
  if (!client) return null;
  const mode = transferMode(env);
  const today = etToday(now);

  const sendable = await store.sendableAccounts(orgId, clientId);
  const accounts = sendable.map((a) => ({
    id: a.id, label: accountLabel(a), kind: a.entity_kind || "unknown",
    available_balance_cents: Number.isSafeInteger(a.available_balance_cents) ? a.available_balance_cents : null
  }));
  const sendableIds = new Set(accounts.map((a) => a.id));

  const tasks = await store.moneyTasks(orgId, clientId, 60);
  const transfers = await store.transfersForTasks(orgId, clientId, tasks.map((t) => t.id));
  const byTask = new Map(transfers.map((t) => [t.agent_task_id, t]));
  const events = await store.events(transfers.map((t) => t.id));
  const eventsBy = new Map();
  for (const e of events) {
    if (!eventsBy.has(e.transfer_id)) eventsBy.set(e.transfer_id, []);
    eventsBy.get(e.transfer_id).push(eventView(e));
  }
  const used = await store.usedOnDay(orgId, clientId, today, null);

  const waiting = [];
  const history = [];
  for (const task of tasks) {
    const t = byTask.get(task.id) || null;
    const amount = Number(task.amount_cents);
    if (task.status === "needs_approval") {
      let toLabel = FUNDHUB_LABEL;
      if (task.to_account_id) toLabel = accountLabel(await store.account(orgId, clientId, task.to_account_id));
      let blocked = null;
      if (task.to_kind === "card" || task.to_kind === "loan") blocked = task.to_kind === "card" ? "card_payment" : "loan_payment";
      else if (!mode.enabled) blocked = "transfers_off";
      else if (amount > mode.perTransferCents) blocked = "over_transfer_limit";
      else if (task.to_kind === "bank_account" && !sendableIds.has(task.to_account_id)) blocked = "destination_not_connected";
      else if (!accounts.some((a) => a.id !== task.to_account_id)) blocked = "no_from_account";
      const suggested = task.detail && isUuid(task.detail.suggested_from_account_id) && sendableIds.has(task.detail.suggested_from_account_id)
        ? task.detail.suggested_from_account_id : null;
      waiting.push({
        id: task.id, title: task.title, why: task.why ?? null, kind: task.kind, source: task.source,
        proposed_by: proposedByKind(task), to_kind: task.to_kind,
        to: { id: task.to_account_id ?? null, label: toLabel }, amount_cents: amount,
        date: scheduledDateFor(task, today), due_on: task.due_on ?? null,
        suggested_from_account_id: suggested, can_approve: blocked === null, blocked,
        created_at: task.created_at instanceof Date ? task.created_at.toISOString() : task.created_at
      });
      continue;
    }
    const result = task.result && typeof task.result === "object" ? task.result : {};
    history.push({
      id: task.id, title: task.title, amount_cents: amount, to_kind: task.to_kind,
      proposed_by: proposedByKind(task), proposal_status: task.status,
      message: typeof result.client_message === "string" ? result.client_message.slice(0, 200) : null,
      created_at: task.created_at instanceof Date ? task.created_at.toISOString() : task.created_at,
      transfer: t ? {
        id: t.id, status: t.status, status_reason: t.status_reason ?? null, environment: t.environment,
        from_label: t.from_account_label, to_label: t.to_account_label, date: t.scheduled_for,
        debit_status: t.debit_status ?? null, credit_status: t.credit_status ?? null,
        approved_by: t.approved_by_kind, approved_at: t.approved_at instanceof Date ? t.approved_at.toISOString() : t.approved_at,
        words: (t.approval_terms && t.approval_terms.words) || null,
        settled_at: t.settled_at instanceof Date ? t.settled_at.toISOString() : t.settled_at ?? null,
        cancelled_by: t.cancelled_by_kind ?? null,
        can_cancel: t.status === "approved" || (t.status === "authorized" && !t.debit_transfer_id)
          || (t.status === "submitted" && t.debit_status === "pending" && !t.credit_transfer_id && !t.credit_authorization_id),
        events: (eventsBy.get(t.id) || []).slice(-24)
      } : null
    });
  }

  return {
    ok: true,
    client: { id: client.id, name: [client.first_name, client.last_name].filter(Boolean).join(" ") || null },
    today,
    mode: { enabled: mode.enabled, environment: mode.environment, live: mode.live, reason: mode.reason },
    limits: {
      per_transfer_cents: mode.perTransferCents, daily_cents: mode.dailyCents, used_today_cents: used,
      left_today_cents: mode.dailyCents === null ? null : Math.max(0, mode.dailyCents - used)
    },
    accounts,
    waiting,
    history
  };
}

/** A task key for a move staff set up by hand (464's task_key shape). */
export function staffMoveKey() {
  return `move:${crypto.randomUUID()}`;
}

export default {
  transferMode, approveTransfer, approveTransferAsSandboxRolePlay, executeTransfer, executeDue, syncTransferEvents,
  advanceTransfers, cancelTransfer, expireOverdue, runTransfersPass, moneyTransfersView, overallStatus, legAfterEvent
};
