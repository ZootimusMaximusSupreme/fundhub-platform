// Storage for FinanceOS money moves (wave 5, unit W7) — two implementations of
// one small interface, so the engine (./money-transfers.mjs) never writes SQL
// and can be run end to end without a database.
//
//   pgStore(db)       the real one: money_agent_tasks (464, the proposals),
//                     money_transfers / money_transfer_events /
//                     money_transfer_sync_cursors (466), bank_accounts,
//                     plaid_items, money_agent_log.
//   memoryStore(seed) the same rules in memory, for unit tests and for the
//                     sandbox proof run before 466 is on the database. It
//                     MIRRORS THE DATABASE: the 464 CHECKs, 466's guard trigger
//                     (insert must match an approved proposal, the state
//                     machine, nothing changes after the yes) and 466's ledger
//                     trigger (one event per state change, events never change).
//                     src/finance/money-transfers.pg.test.mjs proves the real
//                     triggers in CI; src/finance/money-transfers.test.mjs pins
//                     that the two say the same thing.
//
// A STORED ACCESS TOKEN PASSES THROUGH HERE, ENCRYPTED. account() returns the
// account's plaid_items ciphertext under `item` because the provider
// (src/banking/plaid-transfer.mjs) must decrypt it for one call. Nothing in the
// engine puts `item` in a response: moneyTransfersView builds its own shapes.

import crypto from "node:crypto";
import { withTransaction } from "../db/with-transaction.mjs";
import { logMoneyAction } from "./clarity-payments.mjs";

/** Plaid Transfer reaches "debitable checking, savings, or cash management
 *  accounts" (https://plaid.com/docs/transfer/creating-transfers/#account-linking). */
export const SENDABLE_SUBTYPES = Object.freeze(["checking", "savings", "cash management"]);

export const TRANSFER_STATUSES = Object.freeze(["approved", "authorized", "submitted", "settled", "failed", "cancelled", "declined"]);
export const LEG_STATUSES = Object.freeze(["pending", "posted", "settled", "funds_available", "cancelled", "failed", "returned"]);
export const FINAL_LEG = Object.freeze(["failed", "cancelled", "returned"]);

/** 466's state machine, word for word. src/finance/money-transfers.test.mjs
 *  checks the migration says the same. */
export const TRANSITIONS = Object.freeze({
  approved: ["authorized", "declined", "failed", "cancelled"],
  authorized: ["submitted", "failed", "cancelled"],
  submitted: ["settled", "failed", "cancelled"],
  settled: ["failed"],
  failed: [],
  cancelled: [],
  declined: []
});

/** Columns the engine may set on a money_transfers row after it exists. */
const PATCHABLE = Object.freeze([
  "status", "status_reason", "started_at",
  "debit_authorization_id", "debit_authorization_decision", "debit_transfer_id", "debit_status",
  "credit_authorization_id", "credit_authorization_decision", "credit_transfer_id", "credit_status",
  "cancelled_by_kind", "cancelled_by_id", "cancelled_at", "settled_at"
]);

const INSERT_COLUMNS = Object.freeze([
  "org_id", "client_id", "agent_task_id", "to_kind", "from_bank_account_id", "to_bank_account_id",
  "from_account_label", "to_account_label", "amount_cents", "scheduled_for", "environment", "network",
  "status", "proposed_by_kind", "approved_by_kind", "approved_by_account_id", "approved_by_client_id",
  "approved_at", "approval_terms", "idempotency_key",
  "last_actor_kind", "last_actor_id", "last_event_type", "last_event_detail"
]);

const JSON_COLUMNS = new Set(["approval_terms", "last_event_detail"]);

export class TransferRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransferRuleError";
    this.code = "23514"; // check_violation, as Postgres would answer
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   The rules both stores enforce — the JS mirror of 466's triggers.
   ═══════════════════════════════════════════════════════════════════════════ */

const same = (a, b) => (a ?? null) === (b ?? null);
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 466 money_transfers_guard + CHECKs, for an INSERT. `task` is the 464 row. */
export function checkTransferInsert(row, task) {
  const r = row;
  if (r.status !== "approved") throw new TransferRuleError("a move opens at approved, on the client's yes");
  for (const k of ["started_at", "debit_authorization_id", "debit_transfer_id", "debit_status",
    "credit_authorization_id", "credit_transfer_id", "credit_status", "cancelled_at", "settled_at"]) {
    if (r[k] !== undefined && r[k] !== null) throw new TransferRuleError("a new move carries no Plaid legs yet");
  }
  if (!["bank_account", "fundhub"].includes(r.to_kind)) throw new TransferRuleError("to_kind is bank_account or fundhub");
  if (r.to_kind === "bank_account" && !r.to_bank_account_id) throw new TransferRuleError("a move to a bank account names that account");
  if (r.to_kind === "fundhub" && r.to_bank_account_id) throw new TransferRuleError("a move to Fundhub has no to account");
  if (!r.from_bank_account_id) throw new TransferRuleError("a move names the account the money comes from");
  if (r.from_bank_account_id === r.to_bank_account_id) throw new TransferRuleError("from and to are the same account");
  if (!Number.isSafeInteger(r.amount_cents) || r.amount_cents <= 0) throw new TransferRuleError("amount must be above zero");
  checkApproval(r);
  if (!task || task.org_id !== r.org_id || task.client_id !== r.client_id || !task.moves_money
      || task.status !== "approved" || !task.approved_at
      || Number(task.amount_cents) !== r.amount_cents || task.to_kind !== r.to_kind
      || !same(task.to_account_id, r.to_bank_account_id) || !same(task.from_account_id, r.from_bank_account_id)
      || (r.approved_by_kind === "client" && !same(task.approved_by_account_id, r.approved_by_account_id))) {
    throw new TransferRuleError("the move must match the proposal the client approved");
  }
}

function checkApproval(r) {
  if (!r.approved_at || !r.approval_terms) throw new TransferRuleError("a move carries its approval");
  const client = r.approved_by_kind === "client" && !!r.approved_by_account_id && r.approved_by_client_id === r.client_id;
  const rolePlay = r.approved_by_kind === "sandbox_role_play" && r.environment === "sandbox"
    && !r.approved_by_account_id && !r.approved_by_client_id;
  if (!client && !rolePlay) throw new TransferRuleError("only the client approves (or sandbox role-play on a sandbox row)");
}

/** 466 money_transfers_guard + CHECKs, for an UPDATE. Returns the row to store. */
export function checkTransferUpdate(oldRow, newRow) {
  const o = oldRow, n = newRow;
  for (const k of ["id", "org_id", "client_id", "agent_task_id", "environment", "provider", "network", "idempotency_key",
    "created_at", "proposed_by_kind", "amount_cents", "scheduled_for", "to_kind", "from_account_label", "to_account_label"]) {
    if (!same(o[k], n[k]) && !(o[k] instanceof Date)) throw new TransferRuleError("who, how much, when and where never change");
  }
  for (const k of ["approved_at", "approved_by_kind", "approved_by_account_id", "approved_by_client_id"]) {
    if (!same(String(o[k] ?? ""), String(n[k] ?? ""))) throw new TransferRuleError("an approval is never changed or removed");
  }
  if (!sameJson(o.approval_terms, n.approval_terms)) throw new TransferRuleError("an approval is never changed or removed");
  for (const k of ["from_bank_account_id", "to_bank_account_id"]) {
    if (!same(o[k], n[k]) && n[k] !== null && n[k] !== undefined) throw new TransferRuleError("the accounts never change");
  }
  for (const k of ["debit_authorization_id", "debit_transfer_id", "credit_authorization_id", "credit_transfer_id", "started_at"]) {
    if (o[k] !== null && o[k] !== undefined && !same(String(o[k]), String(n[k] ?? ""))) {
      throw new TransferRuleError("a Plaid id or a start time never changes once recorded");
    }
  }
  for (const k of ["debit_status", "credit_status"]) {
    if (FINAL_LEG.includes(o[k]) && !same(o[k], n[k])) throw new TransferRuleError("a failed, cancelled or returned leg is final");
    if (n[k] !== null && n[k] !== undefined && !LEG_STATUSES.includes(n[k])) throw new TransferRuleError(`unknown leg status ${n[k]}`);
  }
  if (n.status !== o.status && !(TRANSITIONS[o.status] || []).includes(n.status)) {
    throw new TransferRuleError(`${o.status} cannot become ${n.status}`);
  }
  if (n.status === "authorized" && !n.debit_authorization_id) throw new TransferRuleError("authorized needs the debit authorization");
  if (n.status === "submitted" && !n.debit_transfer_id) throw new TransferRuleError("submitted needs the debit transfer");
  if (n.status === "settled" && (!n.settled_at || !n.debit_transfer_id || (n.to_kind !== "fundhub" && !n.credit_transfer_id))) {
    throw new TransferRuleError("settled needs both legs and a time");
  }
  if (n.status === "cancelled" && !n.cancelled_at) throw new TransferRuleError("cancelled needs a time");
  checkApproval(n);
  const out = { ...n };
  if (same(o.last_provider_event_id, n.last_provider_event_id)) out.last_provider_event_id = null;
  return out;
}

/** 466 money_transfers_ledger: the event a write produces, or null. */
export function ledgerEventFor(op, oldRow, newRow) {
  const n = newRow;
  let type, kind, actor, detail, providerEventId = null;
  if (op === "INSERT") {
    type = n.last_event_type; kind = n.last_actor_kind; actor = n.last_actor_id ?? null; detail = n.last_event_detail || {};
  } else if (!same(oldRow.status, n.status) || !same(oldRow.debit_status, n.debit_status) || !same(oldRow.credit_status, n.credit_status)) {
    type = n.last_event_type; kind = n.last_actor_kind; actor = n.last_actor_id ?? null; detail = n.last_event_detail || {};
    providerEventId = n.last_provider_event_id ?? null;
  } else if ((oldRow.from_bank_account_id && !n.from_bank_account_id) || (oldRow.to_bank_account_id && !n.to_bank_account_id)) {
    type = "account_removed"; kind = "system"; actor = null;
    detail = { from_removed: !!(oldRow.from_bank_account_id && !n.from_bank_account_id), to_removed: !!(oldRow.to_bank_account_id && !n.to_bank_account_id) };
  } else {
    return null;
  }
  const leg = detail && (detail.leg === "debit" || detail.leg === "credit") ? detail.leg : null;
  return {
    transfer_id: n.id, org_id: n.org_id, client_id: n.client_id, event_type: type,
    from_status: op === "INSERT" ? null : oldRow.status, to_status: n.status,
    debit_status: n.debit_status ?? null, credit_status: n.credit_status ?? null,
    leg, provider_event_id: providerEventId, actor_kind: kind, actor_id: actor, detail: detail || {}
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   pgStore
   ═══════════════════════════════════════════════════════════════════════════ */

const ACCOUNT_SELECT = `
  SELECT ba.id, ba.org_id, ba.client_id, ba.name, ba.official_name, ba.mask, ba.account_type, ba.account_subtype,
         ba.entity_kind, ba.closed_at, COALESCE(ba.is_demo, false) AS is_demo, ba.plaid_account_id,
         ba.available_balance_cents, ba.current_balance_cents, e.name AS entity_name,
         pi.id AS item_row_id, pi.plaid_item_id, pi.encrypted_access_token, pi.link_state,
         pi.consent_granted_at, pi.institution_name
    FROM bank_accounts ba
    LEFT JOIN entities e ON e.id = ba.entity_id
    LEFT JOIN plaid_items pi ON pi.id = ba.plaid_item_id`;

function accountView(row) {
  if (!row) return null;
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    id: row.id, org_id: row.org_id, client_id: row.client_id,
    name: row.name ?? null, official_name: row.official_name ?? null, mask: row.mask ?? null,
    account_type: row.account_type ?? null, account_subtype: row.account_subtype ?? null,
    entity_kind: row.entity_kind ?? "unknown", entity_name: row.entity_name ?? null,
    closed_at: row.closed_at ?? null, is_demo: !!row.is_demo, plaid_account_id: row.plaid_account_id ?? null,
    available_balance_cents: num(row.available_balance_cents), current_balance_cents: num(row.current_balance_cents),
    institution_name: row.institution_name ?? null,
    item: row.item_row_id
      ? {
        id: row.item_row_id, plaid_item_id: row.plaid_item_id ?? null,
        encrypted_access_token: row.encrypted_access_token ?? null,
        link_state: row.link_state ?? null, consent_granted_at: row.consent_granted_at ?? null
      }
      : null
  };
}

function transferRow(r) {
  if (!r) return null;
  const out = { ...r };
  out.amount_cents = Number(r.amount_cents);
  if (r.scheduled_for instanceof Date) out.scheduled_for = r.scheduled_for.toISOString().slice(0, 10);
  if (r.last_provider_event_id !== null && r.last_provider_event_id !== undefined) out.last_provider_event_id = Number(r.last_provider_event_id);
  return out;
}

function taskRow(r) {
  if (!r) return null;
  const out = { ...r };
  if (r.amount_cents !== null && r.amount_cents !== undefined) out.amount_cents = Number(r.amount_cents);
  if (r.due_on instanceof Date) out.due_on = r.due_on.toISOString().slice(0, 10);
  return out;
}

const TASK_SELECT = `
  SELECT id, org_id, client_id, task_key, kind, title, why, due_on::text AS due_on, source, assignee, status,
         moves_money, amount_cents, to_kind, to_account_id, from_account_id, approved_at, approved_by_account_id,
         requested_by_kind, requested_by_staff_id, claimed_by, claimed_at, done_at, result, detail,
         created_at, (created_at AT TIME ZONE 'America/New_York')::date::text AS created_on
    FROM money_agent_tasks`;

/** Did-it-count rule for the per-day cap: a move started that day that has not
 *  been declined, cancelled, or failed before any money left. */
const COUNTS_TODAY = `started_at IS NOT NULL
   AND (started_at AT TIME ZONE 'America/New_York')::date = $3::date
   AND status NOT IN ('declined', 'cancelled')
   AND NOT (status = 'failed' AND debit_transfer_id IS NULL)`;

export function pgStore(db) {
  const q = (sql, params = []) => db.query(sql, params);
  return {
    isTransferStore: true,
    kind: "pg",

    tx(fn) { return withTransaction(db, (client) => fn(pgStore(client))); },

    async client(orgId, clientId) {
      const r = await q(`SELECT id, org_id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
      return r.rows[0] || null;
    },

    async account(orgId, clientId, accountId) {
      if (!accountId) return null;
      const r = await q(`${ACCOUNT_SELECT} WHERE ba.id = $1 AND ba.client_id = $2 AND ba.org_id = $3`, [accountId, clientId, orgId]);
      return accountView(r.rows[0]);
    },

    async sendableAccounts(orgId, clientId) {
      const r = await q(
        `${ACCOUNT_SELECT}
          WHERE ba.client_id = $1 AND ba.org_id = $2
            AND ba.account_type = 'depository' AND lower(COALESCE(ba.account_subtype, '')) = ANY($3::text[])
            AND ba.closed_at IS NULL AND COALESCE(ba.is_demo, false) = false AND ba.plaid_account_id IS NOT NULL
            AND pi.link_state = 'active' AND pi.consent_granted_at IS NOT NULL AND pi.encrypted_access_token IS NOT NULL
          ORDER BY ba.name NULLS LAST, ba.mask NULLS LAST, ba.id`,
        [clientId, orgId, [...SENDABLE_SUBTYPES]]
      );
      return r.rows.map(accountView);
    },

    async task(orgId, clientId, taskId, { forUpdate = false } = {}) {
      const r = await q(`${TASK_SELECT} WHERE id = $1 AND org_id = $2 AND client_id = $3${forUpdate ? " FOR UPDATE" : ""}`,
        [taskId, orgId, clientId]);
      return taskRow(r.rows[0]);
    },

    async moneyTasks(orgId, clientId, limit = 60) {
      const r = await q(`${TASK_SELECT} WHERE org_id = $1 AND client_id = $2 AND moves_money
                          ORDER BY created_at DESC, id LIMIT $3`, [orgId, clientId, limit]);
      return r.rows.map(taskRow);
    },

    async approveTask(taskId, { fromAccountId, approvedByAccountId, at }) {
      const r = await q(
        `UPDATE money_agent_tasks
            SET status = 'approved', approved_at = $2, from_account_id = $3, approved_by_account_id = $4
          WHERE id = $1 AND moves_money AND assignee = 'agent' AND status = 'needs_approval'
          RETURNING id`,
        [taskId, at, fromAccountId, approvedByAccountId]
      );
      return r.rowCount === 1;
    },

    async claimTask(taskId, { claimedBy, at }) {
      const r = await q(
        `UPDATE money_agent_tasks SET status = 'claimed', claimed_by = $2, claimed_at = $3
          WHERE id = $1 AND status = 'approved' RETURNING id`,
        [taskId, claimedBy, at]
      );
      return r.rowCount === 1;
    },

    /** Close a proposal: done / failed / cancelled, with the words the page shows. */
    async finishTask(taskId, { status, at, clientMessage, extra = {} }) {
      const result = { ...extra, ...(clientMessage ? { client_message: String(clientMessage).slice(0, 200) } : {}) };
      const r = await q(
        `UPDATE money_agent_tasks
            SET status = $2,
                done_at = CASE WHEN $2 = 'done' THEN $3::timestamptz ELSE done_at END,
                result = COALESCE(result, '{}'::jsonb) || $4::jsonb
          WHERE id = $1 AND moves_money
            AND status = ANY($5::text[])
          RETURNING id`,
        [taskId, status, at, JSON.stringify(result),
          status === "failed" ? ["needs_approval", "approved", "claimed", "done"] : ["needs_approval", "approved", "claimed"]]
      );
      return r.rowCount === 1;
    },

    async overdueProposals(cutoff, limit = 200) {
      const r = await q(
        `SELECT id, org_id, client_id FROM money_agent_tasks
          WHERE moves_money AND status = 'needs_approval'
            AND GREATEST(COALESCE(due_on, (created_at AT TIME ZONE 'America/New_York')::date),
                         (created_at AT TIME ZONE 'America/New_York')::date) < $1::date
          ORDER BY created_at LIMIT $2`,
        [cutoff, limit]
      );
      return r.rows;
    },

    async insertTransfer(row) {
      const cols = INSERT_COLUMNS.filter((c) => row[c] !== undefined);
      const vals = cols.map((c) => (JSON_COLUMNS.has(c) ? JSON.stringify(row[c]) : row[c]));
      const ph = cols.map((c, i) => `$${i + 1}${JSON_COLUMNS.has(c) ? "::jsonb" : ""}`);
      const r = await q(`INSERT INTO money_transfers (${cols.join(", ")}) VALUES (${ph.join(", ")}) RETURNING *`, vals);
      return transferRow(r.rows[0]);
    },

    async transfer(id, { forUpdate = false } = {}) {
      const r = await q(`SELECT * FROM money_transfers WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
      return transferRow(r.rows[0]);
    },

    async transferByTask(taskId) {
      const r = await q(`SELECT * FROM money_transfers WHERE agent_task_id = $1`, [taskId]);
      return transferRow(r.rows[0]);
    },

    async transfersForTasks(orgId, clientId, taskIds) {
      if (!taskIds.length) return [];
      const r = await q(`SELECT * FROM money_transfers WHERE org_id = $1 AND client_id = $2 AND agent_task_id = ANY($3::uuid[])`,
        [orgId, clientId, taskIds]);
      return r.rows.map(transferRow);
    },

    /** Guarded write: only when the row is still at `expect`. null when it moved. */
    async updateTransfer(id, expect, patch, meta) {
      const sets = [];
      const vals = [id, expect];
      for (const [k, v] of Object.entries(patch || {})) {
        if (!PATCHABLE.includes(k)) throw new Error(`money_transfers: ${k} is not patchable`);
        vals.push(v);
        sets.push(`${k} = $${vals.length}`);
      }
      vals.push(meta.actorKind); sets.push(`last_actor_kind = $${vals.length}`);
      vals.push(meta.actorId ?? null); sets.push(`last_actor_id = $${vals.length}`);
      vals.push(meta.eventType); sets.push(`last_event_type = $${vals.length}`);
      vals.push(JSON.stringify(meta.detail || {})); sets.push(`last_event_detail = $${vals.length}::jsonb`);
      vals.push(meta.providerEventId ?? null); sets.push(`last_provider_event_id = $${vals.length}`);
      const r = await q(`UPDATE money_transfers SET ${sets.join(", ")} WHERE id = $1 AND status = $2 RETURNING *`, vals);
      return transferRow(r.rows[0]);
    },

    /** A ledger row for something that changed no status (a Plaid sweep event, a wait). */
    async appendEvent(ev) {
      const r = await q(
        `INSERT INTO money_transfer_events
           (transfer_id, org_id, client_id, event_type, from_status, to_status, debit_status, credit_status,
            leg, provider_event_id, actor_kind, actor_id, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         ON CONFLICT DO NOTHING RETURNING id`,
        [ev.transfer_id, ev.org_id, ev.client_id, ev.event_type, ev.from_status ?? null, ev.to_status ?? null,
          ev.debit_status ?? null, ev.credit_status ?? null, ev.leg ?? null, ev.provider_event_id ?? null,
          ev.actor_kind, ev.actor_id ?? null, JSON.stringify(ev.detail || {})]
      );
      return { created: r.rows.length > 0 };
    },

    async events(transferIds) {
      if (!transferIds.length) return [];
      const r = await q(
        `SELECT id, transfer_id, event_type, from_status, to_status, debit_status, credit_status, leg,
                provider_event_id, actor_kind, actor_id, detail, created_at
           FROM money_transfer_events WHERE transfer_id = ANY($1::uuid[]) ORDER BY id`,
        [transferIds]
      );
      return r.rows;
    },

    async lockClient(orgId, clientId) {
      await q(`SELECT pg_advisory_xact_lock(hashtext('money_transfers:' || $1::text || ':' || $2::text))`, [orgId, clientId]);
    },

    async usedOnDay(orgId, clientId, day, excludeId = null) {
      const r = await q(
        `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS used FROM money_transfers
          WHERE org_id = $1 AND client_id = $2 AND ${COUNTS_TODAY} AND id IS DISTINCT FROM $4::uuid`,
        [orgId, clientId, day, excludeId]
      );
      return Number(r.rows[0].used);
    },

    /** Started that day, plus approved for that day and not started yet. */
    async plannedOnDay(orgId, clientId, day, excludeId = null) {
      const r = await q(
        `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS planned FROM money_transfers
          WHERE org_id = $1 AND client_id = $2 AND id IS DISTINCT FROM $4::uuid
            AND ((${COUNTS_TODAY}) OR (status = 'approved' AND started_at IS NULL AND scheduled_for = $3::date))`,
        [orgId, clientId, day, excludeId]
      );
      return Number(r.rows[0].planned);
    },

    async dueTransfers(environment, today, limit = 50) {
      const r = await q(
        `SELECT * FROM money_transfers
          WHERE environment = $1 AND status IN ('approved', 'authorized') AND debit_transfer_id IS NULL
            AND scheduled_for <= $2::date
          ORDER BY scheduled_for, created_at LIMIT $3`,
        [environment, today, limit]
      );
      return r.rows.map(transferRow);
    },

    async overdueTransfers(environment, cutoff, limit = 200) {
      const r = await q(
        `SELECT * FROM money_transfers
          WHERE environment = $1 AND status = 'approved' AND debit_authorization_id IS NULL AND scheduled_for < $2::date
          ORDER BY scheduled_for LIMIT $3`,
        [environment, cutoff, limit]
      );
      return r.rows.map(transferRow);
    },

    async readyForCredit(environment, limit = 50) {
      const r = await q(
        `SELECT * FROM money_transfers
          WHERE environment = $1 AND status = 'submitted' AND to_kind = 'bank_account'
            AND debit_status = 'funds_available' AND credit_transfer_id IS NULL
          ORDER BY updated_at LIMIT $2`,
        [environment, limit]
      );
      return r.rows.map(transferRow);
    },

    /** Anything that can still hear from Plaid: open legs, or a move that ended
     *  recently (a return can arrive after "settled"). */
    async needsSync(environment, sinceIso) {
      const r = await q(
        `SELECT EXISTS (SELECT 1 FROM money_transfers
                         WHERE environment = $1
                           AND (status IN ('authorized', 'submitted')
                                OR (status IN ('settled', 'failed') AND updated_at > $2::timestamptz))) AS needed`,
        [environment, sinceIso]
      );
      return r.rows[0].needed === true;
    },

    async transferByLeg(environment, plaidTransferId) {
      const r = await q(
        `SELECT * FROM money_transfers WHERE environment = $1 AND (debit_transfer_id = $2 OR credit_transfer_id = $2) LIMIT 1`,
        [environment, plaidTransferId]
      );
      const row = transferRow(r.rows[0]);
      if (!row) return null;
      return { transfer: row, leg: row.debit_transfer_id === plaidTransferId ? "debit" : "credit" };
    },

    async cursor(environment) {
      const r = await q(`SELECT after_id FROM money_transfer_sync_cursors WHERE environment = $1`, [environment]);
      return r.rows[0] ? Number(r.rows[0].after_id) : 0;
    },

    async setCursor(environment, afterId) {
      await q(
        `INSERT INTO money_transfer_sync_cursors (environment, after_id) VALUES ($1, $2)
         ON CONFLICT (environment) DO UPDATE
           SET after_id = GREATEST(money_transfer_sync_cursors.after_id, EXCLUDED.after_id), updated_at = now()`,
        [environment, afterId]
      );
    },

    async logTaskFinish(row) { return logMoneyAction(db, row); }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   memoryStore — the same interface and the same rules, in memory
   ═══════════════════════════════════════════════════════════════════════════ */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** 464's CHECKs on money_agent_tasks, for the memory store. */
export function checkTaskRow(t) {
  if (t.moves_money && (t.amount_cents === null || t.amount_cents === undefined || !t.to_kind)) {
    throw new TransferRuleError("money_agent_tasks_money_shape_ck");
  }
  if (t.moves_money && t.status === "queued") throw new TransferRuleError("money_agent_tasks_money_never_queued_ck");
  if (t.moves_money && !["needs_approval", "cancelled", "failed"].includes(t.status) && !(t.approved_at && t.from_account_id)) {
    throw new TransferRuleError("money_agent_tasks_money_needs_ok_ck");
  }
  if (t.to_kind && ((t.to_kind === "fundhub") !== !t.to_account_id)) throw new TransferRuleError("money_agent_tasks_destination_ck");
  if (t.status === "done" && !t.done_at) throw new TransferRuleError("money_agent_tasks_done_at_ck");
}

/**
 * memoryStore({ clients, accounts, tasks, now })
 *   clients:  [{ id, org_id, first_name, last_name }]
 *   accounts: account views (see accountView) — `item` holds the encrypted token
 *   tasks:    464 rows
 */
export function memoryStore(seed = {}) {
  let state = {
    clients: clone(seed.clients || []),
    accounts: clone(seed.accounts || []),
    tasks: clone(seed.tasks || []),
    transfers: [],
    events: [],
    cursors: {},
    log: []
  };
  let eventSeq = 0;
  const clock = () => (seed.now ? seed.now() : new Date()).toISOString();
  const etDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));

  function pushEvent(ev) {
    if (ev.provider_event_id !== null && ev.provider_event_id !== undefined
        && state.events.some((e) => e.transfer_id === ev.transfer_id && e.provider_event_id === ev.provider_event_id)) {
      return false;
    }
    eventSeq += 1;
    state.events.push(Object.freeze({ id: eventSeq, ...clone(ev), created_at: clock() }));
    return true;
  }

  const countsToday = (t, day) => t.started_at && etDay(t.started_at) === day
    && !["declined", "cancelled"].includes(t.status) && !(t.status === "failed" && !t.debit_transfer_id);

  const api = {
    isTransferStore: true,
    kind: "memory",

    async tx(fn) {
      const snapshot = clone(state);
      const seq = eventSeq;
      try {
        return await fn(api);
      } catch (e) {
        state = snapshot;
        state.events = state.events.map((x) => Object.freeze(x));
        eventSeq = seq;
        throw e;
      }
    },

    async client(orgId, clientId) {
      return clone(state.clients.find((c) => c.id === clientId && c.org_id === orgId)) || null;
    },
    async account(orgId, clientId, accountId) {
      return clone(state.accounts.find((a) => a.id === accountId && a.client_id === clientId && a.org_id === orgId)) || null;
    },
    async sendableAccounts(orgId, clientId) {
      return clone(state.accounts.filter((a) => a.client_id === clientId && a.org_id === orgId
        && a.account_type === "depository" && SENDABLE_SUBTYPES.includes(String(a.account_subtype || "").toLowerCase())
        && !a.closed_at && !a.is_demo && a.plaid_account_id && a.item && a.item.link_state === "active"
        && a.item.consent_granted_at && a.item.encrypted_access_token));
    },

    /** Test/proof helper: write a 464 row the way proposeTransfer does. */
    insertTask(row) {
      const t = {
        id: row.id || crypto.randomUUID(), assignee: "agent", status: "needs_approval", moves_money: true,
        from_account_id: null, approved_at: null, approved_by_account_id: null, claimed_by: null, claimed_at: null,
        done_at: null, result: null, detail: null, why: null, due_on: null, requested_by_staff_id: null,
        created_at: clock(), ...clone(row)
      };
      t.created_on = t.created_on || etDay(t.created_at);
      checkTaskRow(t);
      if (state.tasks.some((x) => x.org_id === t.org_id && x.client_id === t.client_id && x.task_key === t.task_key
          && ["queued", "needs_approval", "approved", "claimed"].includes(x.status))) {
        throw new TransferRuleError("money_agent_tasks_one_open");
      }
      state.tasks.push(t);
      return clone(t);
    },
    async task(orgId, clientId, taskId) {
      return clone(state.tasks.find((t) => t.id === taskId && t.org_id === orgId && t.client_id === clientId)) || null;
    },
    async moneyTasks(orgId, clientId, limit = 60) {
      return clone(state.tasks.filter((t) => t.org_id === orgId && t.client_id === clientId && t.moves_money)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit));
    },
    async approveTask(taskId, { fromAccountId, approvedByAccountId, at }) {
      const t = state.tasks.find((x) => x.id === taskId);
      if (!t || !t.moves_money || t.assignee !== "agent" || t.status !== "needs_approval") return false;
      const next = { ...t, status: "approved", approved_at: at, from_account_id: fromAccountId, approved_by_account_id: approvedByAccountId };
      checkTaskRow(next);
      Object.assign(t, next);
      return true;
    },
    async claimTask(taskId, { claimedBy, at }) {
      const t = state.tasks.find((x) => x.id === taskId);
      if (!t || t.status !== "approved") return false;
      const next = { ...t, status: "claimed", claimed_by: claimedBy, claimed_at: at };
      checkTaskRow(next);
      Object.assign(t, next);
      return true;
    },
    async finishTask(taskId, { status, at, clientMessage, extra = {} }) {
      const t = state.tasks.find((x) => x.id === taskId);
      const from = status === "failed" ? ["needs_approval", "approved", "claimed", "done"] : ["needs_approval", "approved", "claimed"];
      if (!t || !t.moves_money || !from.includes(t.status)) return false;
      const result = { ...(t.result || {}), ...extra, ...(clientMessage ? { client_message: String(clientMessage).slice(0, 200) } : {}) };
      const next = { ...t, status, done_at: status === "done" ? at : t.done_at, result };
      checkTaskRow(next);
      Object.assign(t, next);
      return true;
    },
    async overdueProposals(cutoff) {
      return clone(state.tasks.filter((t) => t.moves_money && t.status === "needs_approval"
        && [t.due_on, t.created_on].filter(Boolean).sort().pop() < cutoff).map((t) => ({ id: t.id, org_id: t.org_id, client_id: t.client_id })));
    },

    async insertTransfer(row) {
      const now = clock();
      const full = {
        id: crypto.randomUUID(), provider: "plaid_transfer", network: "ach", status_reason: null,
        started_at: null, debit_authorization_id: null, debit_authorization_decision: null, debit_transfer_id: null,
        debit_status: null, credit_authorization_id: null, credit_authorization_decision: null, credit_transfer_id: null,
        credit_status: null, cancelled_by_kind: null, cancelled_by_id: null, cancelled_at: null, settled_at: null,
        last_actor_kind: "system", last_actor_id: null, last_event_type: "approved", last_event_detail: {},
        last_provider_event_id: null, created_at: now, updated_at: now,
        ...clone(row)
      };
      const task = state.tasks.find((t) => t.id === full.agent_task_id);
      checkTransferInsert(full, task);
      const owns = (id) => !id || state.accounts.some((a) => a.id === id && a.client_id === full.client_id);
      if (!owns(full.from_bank_account_id) || !owns(full.to_bank_account_id)) throw new TransferRuleError("money_transfers_from_account_fk / to_account_fk");
      if (state.transfers.some((t) => t.agent_task_id === full.agent_task_id)) throw new TransferRuleError("money_transfers_agent_task_uq");
      if (state.transfers.some((t) => t.idempotency_key === full.idempotency_key)) throw new TransferRuleError("money_transfers_idempotency_key_uq");
      full.last_provider_event_id = null;
      state.transfers.push(full);
      pushEvent(ledgerEventFor("INSERT", null, full));
      return clone(full);
    },
    async transfer(id) { return clone(state.transfers.find((t) => t.id === id)) || null; }, // single-threaded: no lock needed
    async transferByTask(taskId) { return clone(state.transfers.find((t) => t.agent_task_id === taskId)) || null; },
    async transfersForTasks(orgId, clientId, taskIds) {
      return clone(state.transfers.filter((t) => t.org_id === orgId && t.client_id === clientId && taskIds.includes(t.agent_task_id)));
    },
    async updateTransfer(id, expect, patch, meta) {
      const cur = state.transfers.find((t) => t.id === id);
      if (!cur || cur.status !== expect) return null;
      for (const k of Object.keys(patch || {})) if (!PATCHABLE.includes(k)) throw new Error(`money_transfers: ${k} is not patchable`);
      const next = {
        ...cur, ...clone(patch),
        last_actor_kind: meta.actorKind, last_actor_id: meta.actorId ?? null, last_event_type: meta.eventType,
        last_event_detail: clone(meta.detail || {}), last_provider_event_id: meta.providerEventId ?? null,
        updated_at: clock()
      };
      if (!["client", "staff", "agent", "rules", "system", "provider", "sandbox_role_play"].includes(next.last_actor_kind)) {
        throw new TransferRuleError("last_actor_kind");
      }
      const stored = checkTransferUpdate(cur, next);
      const ev = ledgerEventFor("UPDATE", cur, stored);
      if (ev && ev.provider_event_id !== null
          && state.events.some((e) => e.transfer_id === ev.transfer_id && e.provider_event_id === ev.provider_event_id)) {
        throw new TransferRuleError("money_transfer_events_provider_uq");
      }
      Object.assign(cur, stored);
      if (ev) pushEvent(ev);
      return clone(cur);
    },
    async appendEvent(ev) { return { created: pushEvent(ev) }; },
    async events(transferIds) { return state.events.filter((e) => transferIds.includes(e.transfer_id)).map((e) => ({ ...e })); },
    async lockClient() {},
    async usedOnDay(orgId, clientId, day, excludeId = null) {
      return state.transfers.filter((t) => t.org_id === orgId && t.client_id === clientId && t.id !== excludeId && countsToday(t, day))
        .reduce((s, t) => s + t.amount_cents, 0);
    },
    async plannedOnDay(orgId, clientId, day, excludeId = null) {
      return state.transfers.filter((t) => t.org_id === orgId && t.client_id === clientId && t.id !== excludeId
        && (countsToday(t, day) || (t.status === "approved" && !t.started_at && t.scheduled_for === day)))
        .reduce((s, t) => s + t.amount_cents, 0);
    },
    async dueTransfers(environment, today) {
      return clone(state.transfers.filter((t) => t.environment === environment && ["approved", "authorized"].includes(t.status)
        && !t.debit_transfer_id && t.scheduled_for <= today));
    },
    async overdueTransfers(environment, cutoff) {
      return clone(state.transfers.filter((t) => t.environment === environment && t.status === "approved"
        && !t.debit_authorization_id && t.scheduled_for < cutoff));
    },
    async readyForCredit(environment) {
      return clone(state.transfers.filter((t) => t.environment === environment && t.status === "submitted"
        && t.to_kind === "bank_account" && t.debit_status === "funds_available" && !t.credit_transfer_id));
    },
    async needsSync(environment, sinceIso) {
      return state.transfers.some((t) => t.environment === environment
        && (["authorized", "submitted"].includes(t.status) || (["settled", "failed"].includes(t.status) && t.updated_at > sinceIso)));
    },
    async transferByLeg(environment, plaidTransferId) {
      const t = state.transfers.find((x) => x.environment === environment
        && (x.debit_transfer_id === plaidTransferId || x.credit_transfer_id === plaidTransferId));
      return t ? { transfer: clone(t), leg: t.debit_transfer_id === plaidTransferId ? "debit" : "credit" } : null;
    },
    async cursor(environment) { return state.cursors[environment] || 0; },
    async setCursor(environment, afterId) { state.cursors[environment] = Math.max(state.cursors[environment] || 0, afterId); },
    async logTaskFinish(row) {
      if (row.idempotencyKey && state.log.some((l) => l.idempotencyKey === row.idempotencyKey)) return { created: false, id: null };
      state.log.push(clone(row));
      return { created: true, id: String(state.log.length) };
    },

    /* Read-only views for tests and the proof run. There is deliberately no way
       to change or remove an event: the objects are frozen. */
    snapshot() { return { tasks: clone(state.tasks), transfers: clone(state.transfers), events: state.events.slice(), log: clone(state.log) }; }
  };
  return api;
}

export function storeFor(db) {
  if (db && db.isTransferStore) return db;
  return pgStore(db);
}

export default { pgStore, memoryStore, storeFor };
