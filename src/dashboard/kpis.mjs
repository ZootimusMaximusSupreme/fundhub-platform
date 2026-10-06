// Company KPIs for Command Center + Ops & Admin — money chain, events, spend.
//
// Pure SQL aggregations over real tables. NULL / zero means "nothing happened
// in the window", not a invented sample. Cost-per-funded needs ad spend rows
// (migration 038); when spend is unknown the field is null with a reason.

import { AD_TODAY_SQL } from "../lib/ad-account-day.mjs";

/**
 * daysForPeriod(period) → number of days to look back (inclusive of today).
 * @param {"today"|"7d"|"30d"|"qtd"|string} period
 */
export function daysForPeriod(period) {
  switch (String(period || "7d")) {
    case "today": return 1;
    case "30d": return 30;
    case "qtd": {
      const now = new Date();
      const qStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
      const diff = Math.floor((Date.now() - qStart.getTime()) / 86400000) + 1;
      return Math.max(1, Math.min(diff, 120));
    }
    case "7d":
    default:
      return 7;
  }
}

/**
 * periodWords(period) → the same window as daysForPeriod, in plain words, so a
 * count can say which window it covers ("in the last 7 days" vs "this month").
 * An unknown period is the 7-day window there, so it is here too.
 */
export function periodWords(period) {
  switch (String(period || "7d")) {
    case "today": return "today";
    case "30d": return "in the last 30 days";
    case "qtd": return "this quarter so far";
    case "7d":
    default:
      return "in the last 7 days";
  }
}

/**
 * computeKpis(db, { orgId, period }) → plain object of KPI values.
 * Money fields are integer cents. Rates are 0–1 floats or null.
 */
export async function computeKpis(db, { orgId, period = "7d" } = {}) {
  if (!orgId) throw new TypeError("computeKpis: orgId required");
  const days = daysForPeriod(period);

  const [cash, funded, booked, showed, closed, clients, spend] = await Promise.all([
    db.query(
      /* transactions.amount_paid is DOLLARS (numeric 14,2). Sum stays numeric
         and keeps the cents; the caller converts. A ::bigint cast here would
         truncate the cents AND label dollars as cents — a 100x understatement. */
      `SELECT COALESCE(SUM(amount_paid), 0) AS dollars
         FROM transactions
        WHERE org_id = $1
          AND status IN ('paid','succeeded','complete','completed')
          AND created_at >= now() - ($2::int || ' days')::interval`,
      [orgId, days]
    ),
    db.query(
      /* Count real funded rounds (money-chain source of truth), not clients.funded
         which can lag or stay false when rounds already landed. */
      `SELECT count(DISTINCT client_id)::int AS n,
              COALESCE(SUM(funded_amount), 0) AS dollars
         FROM funding_rounds
        WHERE org_id = $1
          AND status = 'funded'
          AND updated_at >= now() - ($2::int || ' days')::interval`,
      [orgId, days]
    ),
    db.query(
      `SELECT count(DISTINCT client_id)::int AS n
         FROM events
        WHERE org_id = $1
          AND name = 'booking.created'
          AND created_at >= now() - ($2::int || ' days')::interval
          AND client_id IS NOT NULL`,
      [orgId, days]
    ),
    db.query(
      `SELECT count(DISTINCT client_id)::int AS n
         FROM events
        WHERE org_id = $1
          AND name = 'call.completed'
          AND created_at >= now() - ($2::int || ' days')::interval
          AND client_id IS NOT NULL`,
      [orgId, days]
    ),
    db.query(
      `SELECT count(DISTINCT client_id)::int AS n
         FROM events
        WHERE org_id = $1
          AND name = 'decision.rendered'
          AND created_at >= now() - ($2::int || ' days')::interval
          AND client_id IS NOT NULL`,
      [orgId, days]
    ),
    db.query(
      `SELECT count(*)::int AS n
         FROM clients
        WHERE org_id = $1
          AND created_at >= now() - ($2::int || ' days')::interval`,
      [orgId, days]
    ),
    db.query(
      `SELECT COALESCE(SUM(spend_cents), 0)::bigint AS cents
         FROM ad_metrics_daily
        WHERE org_id = $1
          AND date >= (${AD_TODAY_SQL} - ($2::int - 1))`,
      [orgId, days]
    ).catch(() => ({ rows: [{ cents: null }] }))
  ]);

  // transactions.amount_paid is dollars (numeric 14,2), not cents.
  const cashCents = Math.round(Number(cash.rows[0]?.dollars || 0) * 100);
  const fundedN = Number(funded.rows[0]?.n || 0);
  // funding_rounds.funded_amount is dollars (numeric 14,2), not cents.
  const fundedCents = Math.round(Number(funded.rows[0]?.dollars || 0) * 100);
  const bookedN = Number(booked.rows[0]?.n || 0);
  const showedN = Number(showed.rows[0]?.n || 0);
  const closedN = Number(closed.rows[0]?.n || 0);
  const clientsN = Number(clients.rows[0]?.n || 0);
  const spendRaw = spend.rows[0]?.cents;
  const spendCents = spendRaw == null ? null : Number(spendRaw);

  const showRate = bookedN > 0 ? showedN / bookedN : null;
  const closeRate = bookedN > 0 ? closedN / bookedN : null;
  let costPerFunded = null;
  let costPerFundedReason = null;
  if (spendCents == null) {
    costPerFundedReason = "ad_spend_unavailable";
  } else if (fundedN === 0) {
    costPerFundedReason = "no_funded_clients_in_window";
  } else {
    costPerFunded = Math.round(spendCents / fundedN);
  }

  // Pipeline movement = cards that entered their current stage inside the window.
  //
  // This asked the right question against a column that could not answer it.
  // cards.entered_at was stamped once at insert and never updated, so until
  // migration 271 this counted cards CREATED in the window, not cards MOVED —
  // a board where nothing moved all week still reported movement, and a week of
  // heavy stage changes on old cards reported none. 271 adds a trigger that
  // stamps entered_at whenever stage_id actually changes, so the column now
  // means what this query always assumed. The SQL is unchanged and correct.
  //
  // A newly created card counts, and should: it entered its first stage in the
  // window. Cards that existed before 271 shipped carry their creation time
  // until their next real move; there was no stage-change history to backfill
  // from.
  const moved = await db.query(
    `SELECT count(*)::int AS n
       FROM cards cd
       JOIN pipelines p ON p.id = cd.pipeline_id
      WHERE cd.org_id = $1
        AND p.key = 'sales'
        AND cd.entered_at >= now() - ($2::int || ' days')::interval`,
    [orgId, days]
  );

  return {
    period,
    days,
    cash_collected_cents: cashCents,
    funded_count: fundedN,
    funded_amount_cents: fundedCents,
    close_rate: closeRate,
    show_rate: showRate,
    cost_per_funded_cents: costPerFunded,
    cost_per_funded_reason: costPerFundedReason,
    new_clients: clientsN,
    pipeline_movement: Number(moved.rows[0]?.n || 0),
    booked_count: bookedN,
    showed_count: showedN,
    decision_count: closedN
  };
}

export function formatCents(cents) {
  if (cents == null) return "—";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  const dollars = n / 100;
  if (Math.abs(dollars) >= 1_000_000) return "$" + (dollars / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (Math.abs(dollars) >= 10_000) return "$" + Math.round(dollars / 1000) + "k";
  return "$" + dollars.toLocaleString("en-US", { maximumFractionDigits: dollars % 1 ? 2 : 0 });
}

export function formatRate(rate) {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return Math.round(rate * 100) + "%";
}
