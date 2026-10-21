// sales-manager:totals — can the Sales floor's team numbers be read, and are they numbers? Read only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). The team totals the Sales floor shows (team cash, booked, held,
// deposits, show rate, close rate, deposit to funded) are built HERE, and the verdict on them is HERE:
//   src/sales/metrics.mjs salesFloor()      imports floorTotals() and builds the page from it
//   src/pulse/coverage/gap-sales-manager.mjs judges salesFloor()'s whole answer with judgeTotals() each morning
//   src/pulse/beats/beat-sales-totals.mjs    judges floorTotals() with judgeTotals() every hour
// Before this move the SQL and the funnel math lived in src/sales/metrics.mjs, which a beat may not import (it
// also reads Drive and attaches loose recordings to calls, which writes). Only the totals moved. Drive, the
// recordings, the closer list and the beliefs stay in metrics.mjs; they are not part of the totals.
//
// What the hourly clock does NOT judge: the rest of salesFloor() (closer list, beliefs, recordings, cold deals,
// late shifts, offer stack). A break there is the morning lane's sales-manager:read-api row, not this one.
//
// Pure: no I/O of its own. Each reader takes a `db` with a query(sql, params) method and runs plain SELECTs
// through it. The month is the Sales floor's own UTC month (monthWindow, the one copy in
// ./pipeline-facts-truth.mjs, which the board-vs-floor check already reads the floor's month from).

import { monthWindow } from "./pipeline-facts-truth.mjs";

export { monthWindow };

export const CHECK_IDS = Object.freeze(["sales-manager:totals"]);
export const TOTALS_ID = "sales-manager:totals";

export const SALES_RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not add another watcher. Do not open the closer desk.";

/* ── the numbers (moved unchanged from src/sales/metrics.mjs) ─────────────────────────────── */

export function rate(n, d) {
  if (!d) return null;
  return n / d;
}

export function formatUsdFromCents(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  const n = Number(cents) / 100;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** Team cash this month: every call outcome's cash, demo rows included (the page has always counted them). */
export const FLOOR_CASH_SQL = `SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cents
         FROM call_outcomes
        WHERE org_id = $1 AND logged_at >= $2 AND logged_at < $3`;

/** Booked: distinct clients with a booking.created event in the window. */
export const FLOOR_BOOKED_SQL = `SELECT count(DISTINCT client_id)::int AS n
         FROM events
        WHERE org_id = $1 AND name = 'booking.created'
          AND created_at >= $2 AND created_at < $3
          AND client_id IS NOT NULL`;

/** Held, deposits and downsells from the logged call outcomes in the window. */
export const FLOOR_OUTCOMES_SQL = `SELECT count(*) FILTER (WHERE outcome <> 'no_show')::int AS held,
              count(*) FILTER (WHERE outcome = 'deposit')::int AS deposits,
              count(*) FILTER (WHERE outcome = 'downsell')::int AS downsells,
              COALESCE(SUM(cash_collected_cents) FILTER (WHERE outcome = 'downsell'), 0)::bigint AS downsell_cents
         FROM call_outcomes
        WHERE org_id = $1 AND logged_at >= $2 AND logged_at < $3`;

/** Deposits in the window and how many of those clients funded. staffClause is "" or "AND o.staff_id = $4". */
export function depositToFundedSql(staffClause = "") {
  return `SELECT count(*)::int AS deposits,
            count(*) FILTER (
              WHERE c.funded IS TRUE
                 OR EXISTS (
                      SELECT 1
                        FROM funding_rounds fr
                        JOIN funding_closeout fc ON fc.funding_round_id = fr.id
                       WHERE fr.client_id = o.client_id AND fr.org_id = o.org_id
                    )
            )::int AS funded
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
      WHERE o.org_id = $1
        AND o.outcome = 'deposit'
        AND o.logged_at >= $2 AND o.logged_at < $3
        ${staffClause}`;
}

/** The team-wide form (no closer filter): what the floor and the hourly beat read. */
export const DEPOSIT_TO_FUNDED_SQL = depositToFundedSql("");

export async function depositToFunded(db, { orgId, staffId = null, start, end }) {
  // Deposits this period whose client has funded=true OR a funding_closeout
  // via funding_rounds.
  const params = [orgId, start.toISOString(), end.toISOString()];
  let staffClause = "";
  if (staffId) {
    params.push(staffId);
    staffClause = `AND o.staff_id = $${params.length}`;
  }
  const r = await db.query(depositToFundedSql(staffClause), params);
  const deposits = Number(r.rows[0]?.deposits || 0);
  const funded = Number(r.rows[0]?.funded || 0);
  return { deposits, funded, rate: rate(funded, deposits) };
}

export async function floorFunnel(db, { orgId, start, end }) {
  const [booked, outcomes] = await Promise.all([
    db.query(FLOOR_BOOKED_SQL, [orgId, start.toISOString(), end.toISOString()]),
    db.query(FLOOR_OUTCOMES_SQL, [orgId, start.toISOString(), end.toISOString()])
  ]);
  const bookedN = Number(booked.rows[0]?.n || 0);
  const held = Number(outcomes.rows[0]?.held || 0);
  const bookedOut = Math.max(bookedN, held);
  const deposits = Number(outcomes.rows[0]?.deposits || 0);
  const d2f = await depositToFunded(db, { orgId, start, end });
  return {
    booked: bookedOut,
    held,
    show_rate: rate(held, bookedOut),
    deposits,
    close_rate: rate(deposits, held),
    funded: d2f.funded,
    funded_of_deposits: d2f.rate,
    downsells: Number(outcomes.rows[0]?.downsells || 0),
    downsell_cash_cents: Number(outcomes.rows[0]?.downsell_cents || 0),
    downsell_cash_display: formatUsdFromCents(outcomes.rows[0]?.downsell_cents)
  };
}

/**
 * The floor's team totals for one window: team cash, the funnel, and deposit to funded. salesFloor() runs
 * exactly this (inside its own Promise.all) and the hourly beat runs exactly this.
 */
export async function floorTotals(db, { orgId, start, end }) {
  const [cash, funnel, d2f] = await Promise.all([
    db.query(FLOOR_CASH_SQL, [orgId, start.toISOString(), end.toISOString()]),
    floorFunnel(db, { orgId, start, end }),
    depositToFunded(db, { orgId, start, end })
  ]);
  return { cashCents: Number(cash.rows[0]?.cents || 0), funnel, d2f };
}

/** The part of the floor answer judgeTotals() reads, built from floorTotals() the way salesFloor() builds it. */
export function totalsView(totals) {
  return {
    hero: { cash_cents: totals.cashCents, deposit_to_funded: totals.d2f.rate },
    funnel: totals.funnel
  };
}

/* ── the verdict (moved unchanged from src/pulse/coverage/gap-sales-manager.mjs) ──────────── */

export function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").trim().slice(0, 180);
}

export function num(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

export function rateOk(value) {
  return value == null || (num(value) && Number(value) >= 0 && Number(value) <= 1);
}

/** Why the team numbers on the floor cannot be trusted, in plain words. Empty means fine. */
export function totalsProblems(floor) {
  const hero = floor && floor.hero;
  const funnel = floor && floor.funnel;
  if (!hero || !funnel) return ["the team numbers block is missing"];
  const out = [];
  if (!num(hero.cash_cents) || Number(hero.cash_cents) < 0) out.push("team cash is not a number");
  for (const [key, label] of [["booked", "booked calls"], ["held", "held calls"], ["deposits", "deposits"]]) {
    if (!num(funnel[key]) || Number(funnel[key]) < 0) out.push(`${label} is not a number`);
  }
  if (!rateOk(funnel.show_rate)) out.push("show rate is not between 0 and 1");
  if (!rateOk(funnel.close_rate)) out.push("close rate is not between 0 and 1");
  if (!rateOk(hero.deposit_to_funded)) out.push("deposit to funded rate is not between 0 and 1");
  return out;
}

/**
 * The sales-manager:totals row. floorRead is null (no database: skip), { ok: false, error } (the read failed:
 * the page would answer 500, so FAIL), or { ok: true, floor } (judge the numbers).
 */
export function judgeTotals({ floorRead }) {
  const id = TOTALS_ID;
  if (!floorRead) {
    return row(id, "skip", "no database in this run — manager totals not read");
  }
  if (!floorRead.ok) {
    return row(
      id,
      "FAIL",
      `manager totals cannot be read: ${floorRead.error}`,
      `${SALES_RECON} Read team cash, show rate, and close rate on the sales floor.`
    );
  }
  const bad = totalsProblems(floorRead.floor);
  if (bad.length > 0) {
    return row(
      id,
      "FAIL",
      `manager totals cannot be read (${bad.join("; ")}).`,
      `${SALES_RECON} Read team cash, show rate, and close rate on the sales floor.`
    );
  }
  const f = floorRead.floor.funnel;
  return row(
    id,
    "PASS",
    `manager totals can be read (team cash, show rate, and close rate): ${Number(f.booked)} booked, ${Number(f.held)} held, ${Number(f.deposits)} deposits this month.`
  );
}

/**
 * The hourly read: floorTotals() for this UTC month, shaped as the page shapes it, then judgeTotals().
 * A read that throws is FAIL, the same as the morning lane (the page would answer 500).
 */
export async function readTotalsTruth({ db, orgId, now }) {
  if (!db || typeof db.query !== "function" || !orgId) return [judgeTotals({ floorRead: null })];
  let floorRead;
  try {
    const floor = totalsView(await floorTotals(db, { orgId, ...monthWindow(now) }));
    // The page gets this as JSON. A value that cannot be printed is a 500 as well.
    JSON.stringify(floor);
    floorRead = { ok: true, floor };
  } catch (err) {
    floorRead = { ok: false, error: clip(err) };
  }
  return [judgeTotals({ floorRead })];
}
