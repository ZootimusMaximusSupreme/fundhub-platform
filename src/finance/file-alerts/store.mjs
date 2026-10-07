// File-protection alerts — the database half. Every query is filtered on org_id
// AND client_id (CLAUDE.md §12), and every write touches only the columns it names.
//
// Tables: db/migrations/471_file_protection_alerts.sql.
//
// WHAT THIS FILE NEVER DOES: send a text, open a task, or call a provider. It
// reads and writes rows. The job (./run.mjs) decides, and sends only through
// sendTemplated.
//
// THE PROMO AND CLOSE-DAY WRITES DO NOT GO THROUGH saveStatementCycle. That writer
// replaces the WHOLE cycle row (every column it knows, NULL for the ones not given),
// so using it to set one field would wipe the card's due day and minimum. These
// write one column group each, with their own ON CONFLICT list, so a promo date
// typed in cannot disturb what Plaid wrote and Plaid's daily read cannot disturb a
// promo date. A new row made for a card with no cycle yet is source 'manual'; the
// first Plaid read flips it to 'provider' and leaves the promo columns alone.

import { KINDS } from "./common.mjs";

export class FileAlertInputError extends Error {
  constructor(field, message, status = 400) {
    super(message);
    this.field = field;
    this.status = status;
    this.code = "invalid_input";
  }
}

/* The columns, as a closed map. A kind from outside is looked up here and never
   put into SQL as text. */
const SETTING_COLUMN = Object.freeze({
  payment_timing: "payment_timing",
  promo_end: "promo_end",
  cash_reserve: "cash_reserve",
  new_credit: "new_credit"
});

/* ------------------------------------------------------------------ *
 * Settings — which kinds are on
 * ------------------------------------------------------------------ */

/** readSettings → { payment_timing, promo_end, cash_reserve, new_credit, saved, updated_by_kind }.
 *  A client with no row has every kind ON — alerts are on by default. */
export async function readSettings(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT payment_timing, promo_end, cash_reserve, new_credit, updated_by_kind, updated_at
       FROM file_protection_settings
      WHERE org_id = $1 AND client_id = $2`,
    [orgId, clientId]
  );
  const row = r.rows[0] || null;
  const on = (col) => (row ? row[col] !== false : true);
  return {
    payment_timing: on("payment_timing"),
    promo_end: on("promo_end"),
    cash_reserve: on("cash_reserve"),
    new_credit: on("new_credit"),
    saved: !!row,
    updated_by_kind: row ? row.updated_by_kind : null,
    updated_at: row ? row.updated_at : null
  };
}

/** setAlertEnabled — switch one kind on or off. Touches that one column. */
export async function setAlertEnabled(conn, { orgId, clientId, kind, enabled, by }) {
  /* hasOwn, not a bare lookup: "constructor" and "__proto__" are keys of every
     object, and a bare SETTING_COLUMN[kind] would hand SQL a function's source. */
  const col = Object.prototype.hasOwnProperty.call(SETTING_COLUMN, kind) ? SETTING_COLUMN[kind] : null;
  if (!col) throw new FileAlertInputError("kind", `kind must be one of ${KINDS.join(", ")}`);
  if (typeof enabled !== "boolean") throw new FileAlertInputError("enabled", "enabled must be true or false");
  const updatedBy = by === "staff" ? "staff" : "client";
  await conn.query(
    `INSERT INTO file_protection_settings (org_id, client_id, ${col}, updated_by_kind)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id) DO UPDATE
        SET ${col} = EXCLUDED.${col}, updated_by_kind = EXCLUDED.updated_by_kind, updated_at = now()
      WHERE file_protection_settings.org_id = EXCLUDED.org_id`,
    [orgId, clientId, enabled, updatedBy]
  );
  return readSettings(conn, { orgId, clientId });
}

/* ------------------------------------------------------------------ *
 * Alerts that went out
 * ------------------------------------------------------------------ */

/** The dedupe keys this client already has — what makes each alert fire once. */
export async function recentKeys(conn, { orgId, clientId, since }) {
  const r = await conn.query(
    `SELECT dedupe_key FROM file_protection_alerts
      WHERE org_id = $1 AND client_id = $2 AND created_at >= $3::timestamptz`,
    [orgId, clientId, since]
  );
  return new Set(r.rows.map((x) => x.dedupe_key));
}

/** The last four digits an earlier new-credit alert already named, so the same card
 *  is not announced twice (once from Plaid, once from the credit pull). */
export async function newCreditLast4(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT DISTINCT item->>'last4' AS last4
       FROM file_protection_alerts a,
            jsonb_array_elements(COALESCE(a.detail->'items', '[]'::jsonb)) AS item
      WHERE a.org_id = $1 AND a.client_id = $2 AND a.kind = 'new_credit'
        AND item->>'last4' IS NOT NULL`,
    [orgId, clientId]
  );
  return new Set(r.rows.map((x) => x.last4));
}

/**
 * recordAlert — write the row for an alert that was delivered. ON CONFLICT DO
 * NOTHING: a second write of the same key (a retry, a second scheduler) is the
 * system working, and says `created: false`.
 */
export async function recordAlert(conn, a) {
  const r = await conn.query(
    `INSERT INTO file_protection_alerts
       (org_id, client_id, kind, bank_account_id, subject_label, threshold, due_on, cash_kind,
        body, delivery, message_id, task_id, sent_at, dedupe_key, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13::timestamptz, $14, $15::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      a.orgId, a.clientId, a.kind, a.bankAccountId ?? null, a.label ?? null, a.threshold ?? null,
      a.dueOn ?? null, a.cashKind ?? null, a.body, a.delivery, a.messageId ?? null, a.taskId ?? null,
      a.sentAt, a.key, JSON.stringify(a.detail ?? {})
    ]
  );
  return { created: r.rows.length > 0, id: r.rows[0]?.id ?? null };
}

/** The screen's list: newest first. due_on comes back as text, never a local midnight. */
export async function listAlerts(conn, { orgId, clientId, limit = 50 }) {
  const r = await conn.query(
    `SELECT id, kind, bank_account_id, subject_label, threshold, due_on::text AS due_on, cash_kind,
            body, delivery, message_id, task_id, sent_at, cleared_at, detail
       FROM file_protection_alerts
      WHERE org_id = $1 AND client_id = $2
      ORDER BY sent_at DESC, id
      LIMIT $3`,
    [orgId, clientId, Math.max(1, Math.min(200, Number(limit) || 50))]
  );
  return r.rows;
}

/* ------------------------------------------------------------------ *
 * The cash cushion's memory: one open alert per cash kind, until it recovers
 * ------------------------------------------------------------------ */

/** { open: Map<cashKind, {id}>, episodes: Map<cashKind, count> } */
export async function reserveState(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT cash_kind,
            count(*)::int AS episodes,
            (array_agg(id::text) FILTER (WHERE cleared_at IS NULL))[1] AS open_id
       FROM file_protection_alerts
      WHERE org_id = $1 AND client_id = $2 AND kind = 'cash_reserve'
      GROUP BY cash_kind`,
    [orgId, clientId]
  );
  const open = new Map();
  const episodes = new Map();
  for (const row of r.rows) {
    episodes.set(row.cash_kind, Number(row.episodes) || 0);
    if (row.open_id) open.set(row.cash_kind, { id: row.open_id });
  }
  return { open, episodes };
}

/** clearReserve — the cash recovered; the alert is armed again. */
export async function clearReserve(conn, { orgId, id, at }) {
  const r = await conn.query(
    `UPDATE file_protection_alerts SET cleared_at = $3::timestamptz
      WHERE org_id = $1 AND id = $2 AND kind = 'cash_reserve' AND cleared_at IS NULL
      RETURNING id`,
    [orgId, id, at]
  );
  return r.rows.length > 0;
}

/* ------------------------------------------------------------------ *
 * Writes the screen can ask for
 * ------------------------------------------------------------------ */

async function ownCard(conn, { orgId, clientId, accountId }) {
  const r = await conn.query(
    `SELECT id, account_type, closed_at, name, mask
       FROM bank_accounts WHERE id = $1 AND org_id = $2 AND client_id = $3`,
    [accountId, orgId, clientId]
  );
  const row = r.rows[0];
  // 404-shaped for a card that is not this client's: no hint that the id is real.
  if (!row) throw new FileAlertInputError("account_id", "no such card", 404);
  if (row.account_type !== "credit") throw new FileAlertInputError("account_id", "this only applies to a credit card");
  if (row.closed_at) throw new FileAlertInputError("account_id", "that card is closed");
  return row;
}

/**
 * setPromo — put a promo end date (and rate) on a card, or clear it.
 *   endsOn null clears it. Returns { cleared } or { promo }.
 */
export async function setPromo(conn, { orgId, clientId, accountId, endsOn, aprFraction, by }) {
  await ownCard(conn, { orgId, clientId, accountId });
  if (endsOn === null || endsOn === undefined) {
    await conn.query(
      `UPDATE account_statement_cycles
          SET promo_ends_on = NULL, promo_apr = NULL, promo_source = NULL, promo_set_at = NULL,
              updated_at = now()
        WHERE bank_account_id = $1 AND org_id = $2 AND client_id = $3`,
      [accountId, orgId, clientId]
    );
    return { cleared: true, promo: null };
  }
  const source = by === "staff" ? "staff" : "client";
  const r = await conn.query(
    `INSERT INTO account_statement_cycles
       (org_id, client_id, bank_account_id, promo_ends_on, promo_apr, promo_source, promo_set_at)
     VALUES ($1, $2, $3, $4::date, $5, $6, now())
     ON CONFLICT (bank_account_id) DO UPDATE
        SET promo_ends_on = EXCLUDED.promo_ends_on, promo_apr = EXCLUDED.promo_apr,
            promo_source = EXCLUDED.promo_source, promo_set_at = EXCLUDED.promo_set_at,
            updated_at = now()
      WHERE account_statement_cycles.org_id = EXCLUDED.org_id
        AND account_statement_cycles.client_id = EXCLUDED.client_id
     RETURNING promo_ends_on::text AS ends_on, promo_apr, promo_source, promo_set_at`,
    [orgId, clientId, accountId, endsOn, aprFraction ?? null, source]
  );
  const row = r.rows[0];
  return {
    cleared: false,
    promo: row
      ? { ends_on: row.ends_on, apr: row.promo_apr === null ? null : Number(row.promo_apr), source: row.promo_source, set_at: row.promo_set_at }
      : null
  };
}

/** readCloseDay — a day of the month 1-31, or null to clear. */
export function readCloseDay(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    throw new FileAlertInputError("day", "day must be a whole number from 1 to 31 — the day of the month the statement closes");
  }
  return n;
}

/**
 * setStatementCloseDay — tell us which day of the month a card's statement closes.
 * A hand-entered card has a due day and a minimum but no close day, and the
 * pay-before-close text cannot go without one. Plaid sets this itself for a linked
 * card, and its daily read overrides a day typed in here.
 */
export async function setStatementCloseDay(conn, { orgId, clientId, accountId, day }) {
  await ownCard(conn, { orgId, clientId, accountId });
  if (day === null || day === undefined) {
    await conn.query(
      `UPDATE account_statement_cycles SET statement_close_day = NULL, updated_at = now()
        WHERE bank_account_id = $1 AND org_id = $2 AND client_id = $3`,
      [accountId, orgId, clientId]
    );
    return { statement_close_day: null };
  }
  const r = await conn.query(
    `INSERT INTO account_statement_cycles (org_id, client_id, bank_account_id, statement_close_day)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (bank_account_id) DO UPDATE
        SET statement_close_day = EXCLUDED.statement_close_day, updated_at = now()
      WHERE account_statement_cycles.org_id = EXCLUDED.org_id
        AND account_statement_cycles.client_id = EXCLUDED.client_id
     RETURNING statement_close_day`,
    [orgId, clientId, accountId, day]
  );
  return { statement_close_day: r.rows[0] ? Number(r.rows[0].statement_close_day) : day };
}

/** The CSM assigned to this client, for a new-credit task. Null when none. */
export async function assignedCsm(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT assigned_csm_staff_id FROM clients WHERE id = $1::uuid AND org_id = $2::uuid`,
    [clientId, orgId]
  );
  return r.rows[0]?.assigned_csm_staff_id || null;
}
