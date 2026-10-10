// File-protection alerts — the reads one client's alerts are decided from.
//
// THE NUMBERS ARE THE MONEY OVERVIEW'S. Cash per kind, each card's balance, limit
// and minimum, each loan's payment: all of it comes out of buildMoneyOverview() —
// the same builder GET /api/money/overview uses — fed the same rows
// (ACCOUNT_SQL, CYCLE_SQL, LIABILITY_SQL are exported from it for exactly this).
// What this skips is the part of moneyOverview() the alerts do not need: the month
// chart, the bills, and the UnderwriteIQ tip (an engine run per client per day for
// a sentence nobody here reads).
//
// READS ONLY. Nothing in this file writes, sends or opens a task.

import {
  ACCOUNT_SQL, CYCLE_SQL, LIABILITY_SQL, buildMoneyOverview
} from "../money-overview.mjs";
import { debtsFromOverview } from "../payment-strategy.mjs";
import { isoDay } from "../clarity-payments.mjs";
import {
  CASH_STALE_AFTER_DAYS, NEW_CREDIT_LOOKBACK_DAYS, DAY_MS, toMs, toCentsOrNull
} from "./common.mjs";

const ENTITIES_SQL = `
  SELECT id, kind, name FROM entities
   WHERE client_id = $1 AND org_id = $2 AND archived_at IS NULL
   ORDER BY kind, name, id`;

/* What the overview does not select: when each balance was true, when the row was
   made, and when the login it hangs off was made. The last two tell a new account
   from the first read of a login. */
const ACCOUNT_META_SQL = `
  SELECT a.id, a.account_type, a.plaid_item_id, a.mask, a.name, a.closed_at,
         a.created_at, a.balance_as_of, p.created_at AS item_created_at
    FROM bank_accounts a
    LEFT JOIN plaid_items p ON p.id = a.plaid_item_id AND p.org_id = a.org_id
   WHERE a.client_id = $1 AND a.org_id = $2`;

/* One row per open Fundhub payment plan: its next unpaid payment. That is "the
   monthly payment" of a plan, whatever its length. (Args: org, client.) */
const CLARITY_SQL = `
  SELECT DISTINCT ON (p.id) p.id AS plan_id, p.kind, p.owed_to, p.label,
         i.seq, i.due_on::text AS due_on, (i.amount_cents - i.paid_cents) AS left_cents
    FROM clarity_payments p
    JOIN clarity_payment_installments i ON i.clarity_payment_id = p.id
   WHERE p.org_id = $1 AND p.client_id = $2 AND p.status = 'open'
     AND i.paid_cents < i.amount_cents
   ORDER BY p.id, i.seq`;

/** What the client owes Fundhub this month: the sum of each open plan's next unpaid
 *  payment. Null when there is no open plan. Pure. */
export function clarityMonthly(plans = []) {
  let total = 0;
  let any = false;
  for (const p of Array.isArray(plans) ? plans : []) {
    const left = toCentsOrNull(p?.left_cents);
    if (left === null || left <= 0) continue;
    total += left;
    any = true;
  }
  return any ? total : null;
}

/** Which cash kinds hold an account whose balance is older than CASH_STALE_AFTER_DAYS. Pure. */
export function staleCashKinds(overview, meta = [], nowMs) {
  const metaById = new Map((Array.isArray(meta) ? meta : []).map((m) => [String(m.id), m]));
  const out = { personal: false, business: false };
  for (const a of overview?.accounts || []) {
    if (a.type !== "depository" || !(a.kind in out)) continue;
    const asOfMs = toMs(metaById.get(String(a.id))?.balance_as_of);
    // No stated date is allowed (a hand-entered account); an old one is not.
    if (asOfMs !== null && nowMs - asOfMs > CASH_STALE_AFTER_DAYS * DAY_MS) out[a.kind] = true;
  }
  return out;
}

/**
 * loadSnapshot(conn, { orgId, clientId, asOf }) → the facts, or null when the
 * client is not in that org.
 */
export async function loadSnapshot(conn, { orgId, clientId, asOf = new Date() } = {}) {
  const asOfIso = new Date(asOf).toISOString();
  const nowMs = Date.parse(asOfIso);

  const clientRes = await conn.query(
    `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;

  const [accounts, entities, cycles, liabilities, meta, clarity] = await Promise.all([
    conn.query(ACCOUNT_SQL, [clientId, orgId]),
    conn.query(ENTITIES_SQL, [clientId, orgId]),
    conn.query(CYCLE_SQL, [clientId, orgId]),
    conn.query(LIABILITY_SQL, [clientId, orgId]),
    conn.query(ACCOUNT_META_SQL, [clientId, orgId]),
    conn.query(CLARITY_SQL, [orgId, clientId])
  ]);

  const cycleRows = cycles.rows.map((r) => r.row ?? r);
  const overview = buildMoneyOverview({
    client,
    asOf: asOfIso,
    accounts: accounts.rows,
    entities: entities.rows,
    txMonths: [],
    bills: [],
    cycles: cycleRows,
    liabilities: liabilities.rows.map((r) => r.row ?? r),
    pricePerContainerCents: null,
    tip: null
  });

  const cycleByAccount = new Map();
  for (const c of cycleRows) if (c && c.bank_account_id) cycleByAccount.set(String(c.bank_account_id), c);

  return {
    client: { id: String(client.id), first_name: client.first_name ?? null, last_name: client.last_name ?? null },
    asOf: asOfIso,
    today: asOfIso.slice(0, 10),
    overview,
    debts: debtsFromOverview(overview),
    cycleByAccount,
    meta: meta.rows,
    clarityPlans: clarity.rows,
    clarityMonthlyCents: clarityMonthly(clarity.rows),
    staleByKind: staleCashKinds(overview, meta.rows, nowMs)
  };
}

/**
 * loadLatestPulls(conn, { orgId, clientId, now }) → { latest, prev } or null.
 *
 * The newest two real (not demo) credit pulls. Null when there are fewer than two,
 * or when the newest is older than the lookback — a pull this old is not "the day
 * it shows up". The (large) result payloads are read only after the cheap checks.
 */
export async function loadLatestPulls(conn, { orgId, clientId, now = new Date() } = {}) {
  const head = await conn.query(
    `SELECT id, created_at FROM crs_results
      WHERE client_id = $1 AND org_id = $2 AND is_demo IS NOT TRUE
      ORDER BY created_at DESC
      LIMIT 2`,
    [clientId, orgId]
  );
  if (head.rows.length < 2) return null;
  const [newest, older] = head.rows;
  const newestMs = toMs(newest.created_at);
  if (newestMs === null || toMs(now) - newestMs > NEW_CREDIT_LOOKBACK_DAYS * DAY_MS) return null;

  const full = await conn.query(
    `SELECT id, result FROM crs_results WHERE org_id = $1 AND id = ANY($2::uuid[])`,
    [orgId, [newest.id, older.id]]
  );
  const byId = new Map(full.rows.map((r) => [String(r.id), r.result]));
  if (!byId.has(String(newest.id)) || !byId.has(String(older.id))) return null;
  const day = (v) => isoDay(v instanceof Date ? v : String(v ?? ""));
  return {
    latest: { id: String(newest.id), on: day(newest.created_at), result: byId.get(String(newest.id)) },
    prev: { id: String(older.id), on: day(older.created_at), result: byId.get(String(older.id)) }
  };
}
