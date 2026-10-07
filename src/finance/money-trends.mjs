// Money trends — FinanceOS tracking over time (unit H6, wave 4, 2026-10-06).
//
// Owner (2026-10-06): "the whole Finance OS with line graphs … Finance OS
// tracking." Today's numbers come from src/finance/money-overview.mjs. This file
// keeps a DAILY HISTORY of those numbers and reads it back as lines.
//
// THREE JOBS, ONE FILE:
//
//   1. SNAPSHOT  — snapshotClient(): today's balances per account and today's
//      rollups per client, written to finance_account_daily / finance_client_daily
//      (migration 458). The rollups are buildMoneyOverview()'s own numbers, so the
//      history line and the tile above it can never disagree.
//   2. BACKFILL  — backfillClient(): past daily balances for checking and savings,
//      rebuilt from bank_transactions working BACKWARD from today's balance.
//      Marked source='backfill', estimated=true. A real snapshot always wins.
//   3. READ      — moneyTrends(): GET /api/money/trends — the series the page draws.
//
// THE RULES (docs/finance/client-finance-os-build-spec-2026-09-19.md §4–§4c):
//
//   * Money is integer cents. Unknown is null, never 0.
//   * Cash is NEVER added across personal / business / not-sure-yet. Each kind
//     is its own series. There is no "total cash" field anywhere in this file.
//   * Debt MAY add across kinds (the owner asked for a global number).
//   * A day with no row is a GAP (null) in every series. Never 0.
//   * Backfill reads posted rows only: pending rows and rows Plaid removed
//     (raw ? 'fundhub_removed_at') are skipped, the same filter the overview's
//     month chart uses.
//
// SIGN CONVENTION (db/migrations/085_bank_transactions.sql §1, restated in
// src/banking/recurring.mjs): NEGATIVE amount_cents = money LEFT the account,
// POSITIVE = money came IN. The balance moves by exactly amount_cents. So the
// balance at the END of day D is
//
//     balance(D) = balance(anchor) − SUM(amount_cents posted after D, up to anchor)
//
// where anchor is the day the stored balance was true (balance_as_of). A day
// before the account's earliest stored transaction is not rebuilt — we cannot
// know what moved before our records start.
//
// Pure builders (buildSnapshot, rebuildBalances, backfillRollups, buildTrends)
// do no I/O and read no clock, so every rule is tested without Postgres.

import { buildMoneyOverview } from "./money-overview.mjs";
import { readEntityKind, ENTITY_KINDS } from "./banking-surface.mjs";
import { sumKnown } from "./os-grid.mjs";
import { scorePoints } from "./credit-overview.mjs";
import { merchantSummary, listConnections } from "../merchant/store.mjs";

/* The ranges the page offers. `days` is the daily window (today included);
   `months` is the month window for the in/out and sales lines. */
export const RANGES = Object.freeze({
  "30d": { days: 30, months: 2 },
  "90d": { days: 90, months: 3 },
  "12m": { days: 365, months: 12 }
});
export const DEFAULT_RANGE = "90d";

/* How far back a backfill rebuilds. Matches the longest range. */
export const BACKFILL_DAYS = 365;

/* ------------------------------------------------------------------ *
 * Small readers. Absent → null, never 0.
 * ------------------------------------------------------------------ */

function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const text = (v) => (v === null || v === undefined || v === "" ? null : String(v));

/* 'YYYY-MM-DD' from a date string or a Date (UTC day). */
function isoDay(v) {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null;
  const s = text(v);
  if (s === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/* Day arithmetic on 'YYYY-MM-DD', in UTC, so no time zone moves a day. */
export function addDays(day, n) {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function dayRange(fromDay, toDay) {
  const out = [];
  for (let d = fromDay, guard = 0; d <= toDay && guard < 2000; guard++, d = addDays(d, 1)) out.push(d);
  return out;
}

/* The last n months, oldest first, ending with the month of `day`. */
export function lastMonths(day, n) {
  const [y, m] = day.slice(0, 7).split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export function readRange(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "") return DEFAULT_RANGE;
  return Object.prototype.hasOwnProperty.call(RANGES, s) ? s : null;
}

/* ------------------------------------------------------------------ *
 * 1. Snapshot
 * ------------------------------------------------------------------ */

/* Cards used, the same way the Cards used tile reads it: owed over limit, over
   cards where both are known and the limit is above 0. An overpaid card owes 0. */
export function cardsUsed(cards = []) {
  let bal = 0, lim = 0, counted = 0;
  for (const c of Array.isArray(cards) ? cards : []) {
    if (c && Number.isFinite(c.balance_cents) && Number.isFinite(c.limit_cents) && c.limit_cents > 0) {
      bal += Math.max(0, c.balance_cents);
      lim += c.limit_cents;
      counted++;
    }
  }
  if (!counted) return { balance_cents: null, limit_cents: null, pct: null };
  return { balance_cents: bal, limit_cents: lim, pct: Math.round((bal / lim) * 1000) / 10 };
}

/**
 * buildSnapshot({ day, accounts, entities }) → { accounts: [...], rollup: {...} }
 *
 * accounts — bank_accounts rows (with balance_as_of); closed ones are left out,
 * exactly as the overview leaves them out. The rollup is the overview's own
 * cash / debt numbers for those rows.
 */
export function buildSnapshot({ day, accounts = [], entities = [] } = {}) {
  const ov = buildMoneyOverview({ client: {}, asOf: `${day}T12:00:00.000Z`, accounts, entities });
  const rawById = new Map((Array.isArray(accounts) ? accounts : []).filter((a) => a && a.id).map((a) => [String(a.id), a]));
  const rows = ov.accounts.map((a) => ({
    bank_account_id: a.id,
    day,
    account_type: a.type,
    kind: a.kind,
    entity_id: a.container_id,
    current_balance_cents: a.current_cents,
    available_balance_cents: a.available_cents,
    credit_limit_cents: a.limit_cents,
    balance_as_of: rawById.get(a.id)?.balance_as_of ?? null
  }));
  const used = cardsUsed(ov.debt.cards);
  const c = (k) => ov.cash[k] || { cents: null, is_floor: false };
  const rollup = {
    day,
    cash_personal_cents: c("personal").cents,
    cash_personal_floor: c("personal").is_floor === true,
    cash_business_cents: c("business").cents,
    cash_business_floor: c("business").is_floor === true,
    cash_unknown_cents: c("unknown").cents,
    cash_unknown_floor: c("unknown").is_floor === true,
    debt_total_cents: ov.debt.total_cents,
    debt_total_floor: ov.debt.is_floor === true,
    debt_personal_cents: ov.debt.by_kind.personal ?? null,
    debt_business_cents: ov.debt.by_kind.business ?? null,
    debt_unknown_cents: ov.debt.by_kind.unknown ?? null,
    cards_balance_cents: used.balance_cents,
    cards_limit_cents: used.limit_cents,
    cards_used_pct: used.pct
  };
  return { accounts: rows, rollup };
}

/* ------------------------------------------------------------------ *
 * 2. Backfill
 * ------------------------------------------------------------------ */

/**
 * rebuildBalances — end-of-day balances for one depository account.
 *
 * @param {object} p
 * @param {number|null} p.currentCents  the stored balance, true on anchorDay
 * @param {string} p.anchorDay          'YYYY-MM-DD' the balance was true
 * @param {string|null} p.earliestDay   the account's earliest posted transaction
 * @param {string} p.fromDay            oldest day wanted
 * @param {Map|object} p.dailyNet       day → SUM(amount_cents) posted that day
 * @returns {Array<{day, cents}>} oldest first, days strictly before anchorDay
 *          and not before earliestDay. [] when the balance or the history is unknown.
 */
export function rebuildBalances({ currentCents, anchorDay, earliestDay, fromDay, dailyNet }) {
  if (!Number.isFinite(currentCents) || !anchorDay || !earliestDay) return [];
  const net = dailyNet instanceof Map ? dailyNet : new Map(Object.entries(dailyNet || {}));
  const stop = earliestDay > fromDay ? earliestDay : fromDay;
  const out = [];
  let running = currentCents;
  for (let d = addDays(anchorDay, -1), guard = 0; d >= stop && guard < 4000; guard++, d = addDays(d, -1)) {
    // Undo what posted on the day after d: balance(d) = balance(d+1) − net(d+1).
    running -= cents(net.get(addDays(d, 1))) ?? 0;
    out.push({ day: d, cents: running });
  }
  return out.reverse();
}

/**
 * backfillRollups — per-day cash per kind from rebuilt account balances.
 *
 * @param {Array} accounts  [{ id, kind }] — every OPEN depository account
 * @param {Map}   points    account id → Map(day → cents)
 * Debt and cards used are null: only checking and savings are rebuilt.
 * A kind where some account has no point that day is a floor; a kind where no
 * account has one is null. Kinds are never added together.
 */
export function backfillRollups(accounts = [], points = new Map()) {
  const days = new Set();
  for (const m of points.values()) for (const d of m.keys()) days.add(d);
  return [...days].sort().map((day) => {
    const row = { day };
    for (const k of ENTITY_KINDS) {
      const mine = accounts.filter((a) => a.kind === k);
      const s = sumKnown(mine.map((a) => {
        const v = points.get(a.id)?.get(day);
        return Number.isFinite(v) ? v : null;
      }));
      row[`cash_${k}_cents`] = s.total;
      row[`cash_${k}_floor`] = s.total !== null && s.unknown > 0;
    }
    row.debt_total_cents = null;
    row.debt_total_floor = false;
    row.debt_personal_cents = null;
    row.debt_business_cents = null;
    row.debt_unknown_cents = null;
    row.cards_balance_cents = null;
    row.cards_limit_cents = null;
    row.cards_used_pct = null;
    return row;
  });
}

/* ------------------------------------------------------------------ *
 * 3. The read — pure
 * ------------------------------------------------------------------ */

/**
 * buildTrends — stored rows → the GET /api/money/trends shape.
 *
 * @param {object} input
 * @param {object} input.client      { id, first_name, last_name }
 * @param {string} input.asOf        ISO timestamp; "today" is its UTC day
 * @param {string} input.range       '30d' | '90d' | '12m'
 * @param {Array}  input.rollups     finance_client_daily rows in the window
 * @param {Array}  input.txMonths    [{ bank_account_id, month, in_cents, out_cents }]
 * @param {Array}  input.accounts    [{ id, account_type, closed_at, kind }] (kind settled)
 * @param {object|null} input.sales  merchantSummary() or null (no connection)
 * @param {Array}  input.connections merchant connections (for the first month)
 * @param {Array}  input.crsRows     crs_results rows
 */
export function buildTrends({
  client = {}, asOf, range = DEFAULT_RANGE, rollups = [], txMonths = [], accounts = [],
  sales = null, connections = [], crsRows = []
} = {}) {
  const r = RANGES[range] || RANGES[DEFAULT_RANGE];
  const asOfIso = new Date(asOf).toISOString();
  const to = asOfIso.slice(0, 10);
  const from = addDays(to, -(r.days - 1));
  const days = dayRange(from, to);

  /* ---- daily: one slot per day, null where no row ---- */
  const byDay = new Map();
  for (const row of Array.isArray(rollups) ? rollups : []) {
    const d = isoDay(row?.day);
    if (d && d >= from && d <= to) byDay.set(d, row);
  }
  const col = (key, read = cents) => days.map((d) => (byDay.has(d) ? read(byDay.get(d)[key]) : null));
  const flag = (key) => days.map((d) => (byDay.has(d) ? byDay.get(d)[key] === true : null));
  const daily = {
    days,
    estimated: days.map((d) => (byDay.has(d) ? byDay.get(d).estimated === true : null)),
    cash: {},
    debt: {
      total: { cents: col("debt_total_cents"), floor: flag("debt_total_floor") },
      personal: { cents: col("debt_personal_cents") },
      business: { cents: col("debt_business_cents") },
      unknown: { cents: col("debt_unknown_cents") }
    },
    cards_used_pct: col("cards_used_pct", num)
  };
  for (const k of ENTITY_KINDS) {
    daily.cash[k] = { cents: col(`cash_${k}_cents`), floor: flag(`cash_${k}_floor`) };
  }
  const hasHistory = days.some((d, i) =>
    ENTITY_KINDS.some((k) => daily.cash[k].cents[i] !== null) ||
    daily.debt.total.cents[i] !== null || daily.cards_used_pct[i] !== null);

  /* ---- monthly money in vs out, depository only, kinds apart ---- */
  const months = lastMonths(to, r.months);
  const acct = new Map((Array.isArray(accounts) ? accounts : []).map((a) => [String(a.id), a]));
  const buckets = {};
  for (const k of ENTITY_KINDS) buckets[k] = { in_cents: months.map(() => null), out_cents: months.map(() => null) };
  let anyTx = false;
  for (const t of Array.isArray(txMonths) ? txMonths : []) {
    const a = acct.get(String(t?.bank_account_id));
    // Depository and open only — the overview's cashflow rule (a card payment
    // would otherwise count twice: out of checking AND into the card).
    if (!a || a.account_type !== "depository" || a.closed_at) continue;
    const i = months.indexOf(text(t.month));
    if (i < 0) continue;
    const k = readEntityKind(a.kind);
    const inC = cents(t.in_cents);
    const outC = cents(t.out_cents);
    if (inC !== null) { buckets[k].in_cents[i] = (buckets[k].in_cents[i] ?? 0) + inC; anyTx = true; }
    if (outC !== null) { buckets[k].out_cents[i] = (buckets[k].out_cents[i] ?? 0) + Math.abs(outC); anyTx = true; }
  }
  const monthly = { months, has_transactions: anyTx, ...buckets };

  /* ---- merchant net sales per month ---- */
  let salesOut = null;
  if (sales && Array.isArray(sales.months) && Array.isArray(connections) && connections.length) {
    // A month before the first connection existed is a gap, not $0: nothing
    // was listening yet. A month after it with no events is a real $0.
    const firstMonth = connections
      .map((c) => isoDay(c?.created_at))
      .filter(Boolean)
      .sort()[0]?.slice(0, 7) ?? null;
    const totals = new Map((sales.totals || []).map((t) => [t.month, t]));
    const live = (m) => firstMonth !== null && m >= firstMonth;
    salesOut = {
      currency: sales.currency || "usd",
      months: sales.months,
      net_cents: sales.months.map((m) => (live(m) ? cents(totals.get(m)?.net_cents) : null)),
      sales_cents: sales.months.map((m) => (live(m) ? cents(totals.get(m)?.sales_cents) : null)),
      other_currency_events: Number(sales.other_currency_events) || 0
    };
  }

  /* ---- credit score history (only from two pulls up) ---- */
  const points = scorePoints(crsRows);

  const first = text(client?.first_name);
  const last = text(client?.last_name);
  return {
    ok: true,
    client: { id: text(client?.id), name: [first, last].filter(Boolean).join(" ") || null },
    as_of: asOfIso,
    range: RANGES[range] ? range : DEFAULT_RANGE,
    from,
    to,
    has_history: hasHistory,
    daily,
    monthly,
    sales: salesOut,
    credit: { history: points.length > 1 ? points : [] }
  };
}

/* ------------------------------------------------------------------ *
 * Database
 * ------------------------------------------------------------------ */

/* Selected columns only — plaid_items.encrypted_access_token is one join away. */
const ACCOUNTS_SQL = `
  SELECT a.id, a.name, a.official_name, a.mask, a.provider,
         a.account_type, a.account_subtype,
         a.available_balance_cents, a.current_balance_cents, a.credit_limit_cents,
         a.balance_as_of, a.entity_kind, a.entity_id, a.closed_at, p.institution_name
    FROM bank_accounts a
    LEFT JOIN plaid_items p ON p.id = a.plaid_item_id AND p.org_id = a.org_id
   WHERE a.client_id = $1 AND a.org_id = $2`;

const ENTITIES_SQL = `
  SELECT id, kind, name FROM entities
   WHERE client_id = $1 AND org_id = $2 AND archived_at IS NULL`;

/* Every client with at least one open account: the daily job's list. */
export async function clientsToSnapshot(conn) {
  const r = await conn.query(
    `SELECT DISTINCT org_id, client_id FROM bank_accounts
      WHERE closed_at IS NULL AND client_id IS NOT NULL
      ORDER BY org_id, client_id`);
  return r.rows;
}

async function readAccounts(conn, { orgId, clientId }) {
  const [a, e] = await Promise.all([
    conn.query(ACCOUNTS_SQL, [clientId, orgId]),
    conn.query(ENTITIES_SQL, [clientId, orgId])
  ]);
  return { accounts: a.rows, entities: e.rows };
}

const ROLLUP_COLS = [
  "cash_personal_cents", "cash_personal_floor", "cash_business_cents", "cash_business_floor",
  "cash_unknown_cents", "cash_unknown_floor", "debt_total_cents", "debt_total_floor",
  "debt_personal_cents", "debt_business_cents", "debt_unknown_cents",
  "cards_balance_cents", "cards_limit_cents", "cards_used_pct"
];
const ROLLUP_TYPES = [
  "bigint", "boolean", "bigint", "boolean", "bigint", "boolean", "bigint", "boolean",
  "bigint", "bigint", "bigint", "bigint", "bigint", "numeric"
];

/* One statement for many rollup days. `source` decides who may overwrite whom:
   a snapshot overwrites anything; a backfill only another backfill. */
async function upsertRollups(conn, { orgId, clientId, source, rows }) {
  if (!rows.length) return 0;
  const params = [orgId, clientId, rows.map((r) => r.day)];
  for (const c of ROLLUP_COLS) params.push(rows.map((r) => (r[c] === undefined ? null : r[c])));
  const arrays = ROLLUP_COLS.map((c, i) => `$${i + 4}::${ROLLUP_TYPES[i]}[]`).join(", ");
  const est = source === "backfill";
  const res = await conn.query(
    `INSERT INTO finance_client_daily (org_id, client_id, day, ${ROLLUP_COLS.join(", ")}, source, estimated)
     SELECT $1, $2, u.day::date, ${ROLLUP_COLS.map((c) => `u.${c}`).join(", ")}, '${source}', ${est}
       FROM unnest($3::text[], ${arrays}) AS u(day, ${ROLLUP_COLS.join(", ")})
     ON CONFLICT (client_id, day) DO UPDATE SET
       ${ROLLUP_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
       source = EXCLUDED.source, estimated = EXCLUDED.estimated
     ${est ? "WHERE finance_client_daily.source = 'backfill'" : ""}`,
    params
  );
  return res.rowCount ?? 0;
}

/**
 * snapshotClient(conn, { orgId, clientId, day }) — write today's row for every
 * open account and the client's rollup. Idempotent per (account, day) and
 * (client, day): a second run the same day updates, never adds.
 */
export async function snapshotClient(conn, { orgId, clientId, day }) {
  const { accounts, entities } = await readAccounts(conn, { orgId, clientId });
  const snap = buildSnapshot({ day, accounts, entities });
  for (const a of snap.accounts) {
    await conn.query(
      `INSERT INTO finance_account_daily
         (org_id, client_id, bank_account_id, day, account_type, kind, entity_id,
          current_balance_cents, available_balance_cents, credit_limit_cents, balance_as_of,
          source, estimated)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, 'snapshot', false)
       ON CONFLICT (bank_account_id, day) DO UPDATE SET
         account_type = EXCLUDED.account_type, kind = EXCLUDED.kind, entity_id = EXCLUDED.entity_id,
         current_balance_cents = EXCLUDED.current_balance_cents,
         available_balance_cents = EXCLUDED.available_balance_cents,
         credit_limit_cents = EXCLUDED.credit_limit_cents,
         balance_as_of = EXCLUDED.balance_as_of,
         source = 'snapshot', estimated = false`,
      [orgId, clientId, a.bank_account_id, day, a.account_type, a.kind, a.entity_id,
        a.current_balance_cents, a.available_balance_cents, a.credit_limit_cents, a.balance_as_of]
    );
  }
  const accountsCount = snap.accounts.length;
  if (accountsCount) await upsertRollups(conn, { orgId, clientId, source: "snapshot", rows: [snap.rollup] });
  return { accounts: accountsCount, rollup: accountsCount ? snap.rollup : null };
}

/* Posted, not removed, inside the window, summed per account per day. */
const TX_DAILY_SQL = `
  SELECT bank_account_id::text AS bank_account_id, posted_on::text AS day,
         SUM(amount_cents) AS net_cents
    FROM bank_transactions
   WHERE client_id = $1 AND org_id = $2
     AND is_pending = false
     AND NOT (raw ? 'fundhub_removed_at')
     AND posted_on IS NOT NULL
     AND posted_on > $3::date
     AND bank_account_id = ANY($4::uuid[])
   GROUP BY 1, 2`;

/* The earliest posted row per account, over ALL time: the day our records start. */
const TX_EARLIEST_SQL = `
  SELECT bank_account_id::text AS bank_account_id, MIN(posted_on)::text AS earliest
    FROM bank_transactions
   WHERE client_id = $1 AND org_id = $2
     AND is_pending = false
     AND NOT (raw ? 'fundhub_removed_at')
     AND posted_on IS NOT NULL
     AND bank_account_id = ANY($3::uuid[])
   GROUP BY 1`;

/**
 * planBackfill(conn, { orgId, clientId, today, days }) — reads only. Returns the
 * rebuilt points per open depository account and the per-day rollups, without
 * writing anything. backfillClient() writes them; the script's dry run prints them.
 */
export async function planBackfill(conn, { orgId, clientId, today, days = BACKFILL_DAYS }) {
  const fromDay = addDays(today, -(days - 1));
  const { accounts, entities } = await readAccounts(conn, { orgId, clientId });
  const entById = new Map(entities.map((e) => [String(e.id), e]));
  const dep = accounts
    .filter((a) => a && a.id && !a.closed_at && a.account_type === "depository")
    .map((a) => {
      const ent = a.entity_id ? entById.get(String(a.entity_id)) ?? null : null;
      return {
        id: String(a.id),
        name: text(a.name) || text(a.official_name),
        kind: ent ? readEntityKind(ent.kind) : readEntityKind(a.entity_kind),
        entity_id: ent ? String(ent.id) : null,
        current: cents(a.current_balance_cents),
        anchor: isoDay(a.balance_as_of) ?? today
      };
    });
  if (!dep.length) return { fromDay, accounts: [], rollups: [] };

  const ids = dep.map((a) => a.id);
  const [tx, earliest] = await Promise.all([
    conn.query(TX_DAILY_SQL, [clientId, orgId, fromDay, ids]),
    conn.query(TX_EARLIEST_SQL, [clientId, orgId, ids])
  ]);
  const netBy = new Map();
  for (const r of tx.rows) {
    const m = netBy.get(r.bank_account_id) ?? new Map();
    m.set(r.day, cents(r.net_cents));
    netBy.set(r.bank_account_id, m);
  }
  const earliestBy = new Map(earliest.rows.map((r) => [r.bank_account_id, r.earliest]));

  const points = new Map();
  const planned = dep.map((a) => {
    const anchorDay = a.anchor > today ? today : a.anchor;
    const pts = rebuildBalances({
      currentCents: a.current,
      anchorDay,
      earliestDay: earliestBy.get(a.id) ?? null,
      fromDay,
      dailyNet: netBy.get(a.id) ?? new Map()
    });
    /* The day the bank's balance was true, when that is before today: the
       stored balance itself. Today's own point is the snapshot's job. */
    if (pts.length && anchorDay < today && anchorDay >= fromDay && Number.isFinite(a.current)) {
      pts.push({ day: anchorDay, cents: a.current });
    }
    points.set(a.id, new Map(pts.map((p) => [p.day, p.cents])));
    return { ...a, points: pts };
  });
  return { fromDay, accounts: planned, rollups: backfillRollups(dep, points) };
}

/**
 * backfillClient(conn, { orgId, clientId, today, days }) — rebuild and write.
 * Never overwrites a real snapshot (account or rollup).
 */
export async function backfillClient(conn, { orgId, clientId, today, days = BACKFILL_DAYS }) {
  const plan = await planBackfill(conn, { orgId, clientId, today, days });
  let accountRows = 0;
  for (const a of plan.accounts) {
    if (!a.points.length) continue;
    const res = await conn.query(
      `INSERT INTO finance_account_daily
         (org_id, client_id, bank_account_id, day, account_type, kind, entity_id,
          current_balance_cents, source, estimated)
       SELECT $1, $2, $3, u.day::date, 'depository', $4, $5, u.cents, 'backfill', true
         FROM unnest($6::text[], $7::bigint[]) AS u(day, cents)
       ON CONFLICT (bank_account_id, day) DO UPDATE SET
         kind = EXCLUDED.kind, entity_id = EXCLUDED.entity_id,
         current_balance_cents = EXCLUDED.current_balance_cents
       WHERE finance_account_daily.source = 'backfill'`,
      [orgId, clientId, a.id, a.kind, a.entity_id, a.points.map((p) => p.day), a.points.map((p) => p.cents)]
    );
    accountRows += res.rowCount ?? 0;
  }
  const rollupRows = await upsertRollups(conn, { orgId, clientId, source: "backfill", rows: plan.rollups });
  return { accounts: plan.accounts.length, accountRows, rollupRows };
}

/* ---- the read ---- */

const ROLLUP_READ_SQL = `
  SELECT day::text AS day, ${ROLLUP_COLS.join(", ")}, source, estimated
    FROM finance_client_daily
   WHERE client_id = $1 AND org_id = $2 AND day >= $3::date AND day <= $4::date
   ORDER BY day`;

/* The overview's month rule (posted, not removed), grouped per account. */
const TX_MONTHS_SQL = `
  SELECT bank_account_id::text AS bank_account_id,
         to_char(posted_on, 'YYYY-MM') AS month,
         SUM(amount_cents) FILTER (WHERE amount_cents > 0)  AS in_cents,
         SUM(-amount_cents) FILTER (WHERE amount_cents < 0) AS out_cents
    FROM bank_transactions
   WHERE client_id = $1 AND org_id = $2
     AND is_pending = false
     AND NOT (raw ? 'fundhub_removed_at')
     AND posted_on IS NOT NULL
     AND posted_on >= $3::date AND posted_on <= $4::date
   GROUP BY 1, 2`;

const CRS_SQL = `
  SELECT id, result, created_at FROM crs_results
   WHERE client_id = $1 AND org_id = $2 AND is_demo IS NOT TRUE
   ORDER BY created_at`;

/**
 * moneyTrends(db, { orgId, clientId, range, asOf }) → the contract, or null when
 * the client is not in that org. Every query carries org_id AND client_id.
 */
export async function moneyTrends(db, { orgId, clientId, range = DEFAULT_RANGE, asOf = new Date() } = {}) {
  const r = RANGES[range] || RANGES[DEFAULT_RANGE];
  const asOfIso = new Date(asOf).toISOString();
  const to = asOfIso.slice(0, 10);
  const from = addDays(to, -(r.days - 1));
  const firstMonthDay = `${lastMonths(to, r.months)[0]}-01`;

  const clientRes = await db.query(
    `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
  const client = clientRes.rows[0];
  if (!client) return null;

  const [rollups, txMonths, acc, crs, connections] = await Promise.all([
    db.query(ROLLUP_READ_SQL, [clientId, orgId, from, to]),
    db.query(TX_MONTHS_SQL, [clientId, orgId, firstMonthDay, to]),
    readAccounts(db, { orgId, clientId }),
    db.query(CRS_SQL, [clientId, orgId]),
    listConnections(db, { orgId, clientId })
  ]);
  const entById = new Map(acc.entities.map((e) => [String(e.id), e]));
  const accounts = acc.accounts.map((a) => {
    const ent = a.entity_id ? entById.get(String(a.entity_id)) ?? null : null;
    return {
      id: String(a.id), account_type: a.account_type, closed_at: a.closed_at,
      kind: ent ? readEntityKind(ent.kind) : readEntityKind(a.entity_kind)
    };
  });
  const sales = connections.length
    ? await merchantSummary(db, { orgId, clientId, months: r.months, asOf: new Date(asOfIso), connections })
    : null;

  return buildTrends({
    client, asOf: asOfIso, range, rollups: rollups.rows, txMonths: txMonths.rows,
    accounts, sales, connections, crsRows: crs.rows
  });
}

export default moneyTrends;
