// Alerts bundle — the database half. Every query is filtered on org_id AND
// client_id (CLAUDE.md §12). It reads, and it writes exactly one thing: the three
// on/off switches migration 578 adds to file_protection_settings. Sent alerts are
// written by the daily pass and the weekly job through ./store.mjs recordAlert,
// the same row and the same once-only key every other alert uses.
//
// WHAT THIS FILE NEVER DOES: send a text, open a task, call a provider, or move
// money. A demo row is never read as the client's own.

import { FileAlertInputError } from "./store.mjs";
import { BUNDLE_KINDS, BUSINESS_PULLS_READ, OWN_TRANSFER_MATCH_DAYS } from "./bundle-common.mjs";
import { addDaysIso } from "./common.mjs";

/* The switches, as a closed map. A kind from outside is looked up here and never
   put into SQL as text. */
const SWITCH_COLUMN = Object.freeze({
  card_over_10: "card_over_10",
  business_credit: "business_credit",
  weekly_money: "weekly_money"
});

/** readBundleSettings → { card_over_10, business_credit, weekly_money, saved }.
 *  No row means every switch is ON, like the four older ones. */
export async function readBundleSettings(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT card_over_10, business_credit, weekly_money
       FROM file_protection_settings
      WHERE org_id = $1 AND client_id = $2`,
    [orgId, clientId]
  );
  const row = r.rows[0] || null;
  const on = (col) => (row ? row[col] !== false : true);
  return { card_over_10: on("card_over_10"), business_credit: on("business_credit"), weekly_money: on("weekly_money"), saved: !!row };
}

/** setBundleAlertEnabled — switch one bundle kind on or off. Touches that one column. */
export async function setBundleAlertEnabled(conn, { orgId, clientId, kind, enabled, by }) {
  const col = Object.prototype.hasOwnProperty.call(SWITCH_COLUMN, kind) ? SWITCH_COLUMN[kind] : null;
  if (!col) throw new FileAlertInputError("kind", `kind must be one of ${BUNDLE_KINDS.join(", ")}`);
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
  return readBundleSettings(conn, { orgId, clientId });
}

/** fundedState → { funded, approvals }. A confirmed approval is the basis
 *  migration 382 holds funding_rounds.approved_amount to: status Approved, not
 *  excluded, an amount over zero. Demo rounds and demo applications never count. */
export async function fundedState(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT count(*)::int AS approvals
       FROM applications a
       JOIN funding_rounds f ON f.id = a.funding_round_id AND f.org_id = a.org_id
      WHERE f.org_id = $1 AND f.client_id = $2
        AND a.status = 'Approved'
        AND a.approval_excluded_at IS NULL
        AND a.approved_amount IS NOT NULL AND a.approved_amount > 0
        AND f.is_demo IS NOT TRUE AND a.is_demo IS NOT TRUE`,
    [orgId, clientId]
  );
  const approvals = Number(r.rows[0]?.approvals) || 0;
  return { funded: approvals > 0, approvals };
}

/** The client's saved companies, oldest first. */
export async function listBusinesses(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT id, name, entity_data, created_at
       FROM businesses
      WHERE org_id = $1 AND client_id = $2
      ORDER BY created_at ASC, id`,
    [orgId, clientId]
  );
  return r.rows;
}

/* Only the parts of a pull the business reader needs: the business reports and
   the two flags that say sandbox or sample. A tri-merge payload is large; this
   keeps the daily pass from reading six of them per client. */
export const BUSINESS_PULLS_SQL = `
  SELECT id, created_at,
         jsonb_build_object(
           'environment', result->'environment',
           'simulated', result->'simulated',
           'pulledAt', result->'pulledAt',
           'businessReports', result->'businessReports'
         ) AS result
    FROM crs_results
   WHERE client_id = $1 AND org_id = $2
     AND is_demo IS NOT TRUE
     AND jsonb_typeof(result->'businessReports') = 'array'
   ORDER BY created_at DESC
   LIMIT $3`;

/** The newest pulls that hold business reports. */
export async function businessPulls(conn, { orgId, clientId, limit = BUSINESS_PULLS_READ }) {
  const r = await conn.query(BUSINESS_PULLS_SQL, [clientId, orgId, limit]);
  return r.rows;
}

/** Bank accounts opened on the plan (the relationships tracker, migration 461). */
export async function openedBankAccounts(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT id, bank_key, bank_name, state, opened_on::text AS opened_on
       FROM blueprint_bank_relationship_todos
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND opened_on IS NOT NULL AND state <> 'skipped'
      ORDER BY opened_on DESC, id`,
    [orgId, clientId]
  );
  return r.rows;
}

/** How many of the client's own plan steps are still open (client_waypoints, 330). */
export async function openStepCount(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT count(*)::int AS open
       FROM client_waypoints
      WHERE org_id = $1 AND client_id = $2
        AND owner_kind = 'client'
        AND state NOT IN ('done', 'skipped')`,
    [orgId, clientId]
  );
  return Number(r.rows[0]?.open) || 0;
}

/** Posted bank rows for the week, a few days either side so a move between two
 *  of the client's own accounts is seen whole. Dates come back as text. */
export async function weekTransactions(conn, { orgId, clientId, from, to }) {
  const r = await conn.query(
    `SELECT bank_account_id::text AS bank_account_id, amount_cents, posted_on::text AS posted_on, category
       FROM bank_transactions
      WHERE client_id = $1 AND org_id = $2
        AND is_pending = false
        AND NOT (raw ? 'fundhub_removed_at')
        AND posted_on IS NOT NULL
        AND posted_on >= $3::date AND posted_on <= $4::date`,
    [clientId, orgId, addDaysIso(from, -OWN_TRANSFER_MATCH_DAYS), addDaysIso(to, OWN_TRANSFER_MATCH_DAYS)]
  );
  return r.rows;
}

/** This bundle's sent alerts, newest first, for the screen's "texted" marks. */
export async function bundleAlerts(conn, { orgId, clientId, limit = 100 }) {
  const r = await conn.query(
    `SELECT id, kind, dedupe_key, bank_account_id, due_on::text AS due_on, body, sent_at
       FROM file_protection_alerts
      WHERE org_id = $1 AND client_id = $2 AND kind = ANY($3::text[])
      ORDER BY sent_at DESC, id
      LIMIT $4`,
    [orgId, clientId, [...BUNDLE_KINDS], Math.max(1, Math.min(200, Number(limit) || 100))]
  );
  return r.rows;
}
