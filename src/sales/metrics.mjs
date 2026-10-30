// Sales metrics for my-numbers (closer) and sales-floor (manager).
// Every number comes from call_outcomes, transactions, funding_closeout,
// shifts, or staff_targets. Missing sources become null + a reason — never fake.

import { BELIEFS, BELIEF_LABELS } from "./beliefs.mjs";
import { countUnlogged, listUnloggedCalls } from "./call-outcomes.mjs";
import { countUnrecorded, listUnrecordedCalls } from "./unrecorded.mjs";
import { isDemoEmail } from "../auth/demo-logins.mjs";
import { demoClause, orgDemoModeEnabled } from "../demo/exclude-demo.mjs";
import { listRecentRecordings } from "./recordings.mjs";
import { setterNumbers } from "../setter/dashboard.mjs";
import { closerOfferStack, floorOfferStack, zeroStackFrom } from "./offer-stack.mjs";
/* The floor's team totals (team cash, the funnel, deposit to funded) and the month they cover live in the beat
   library, so the hourly pulse beat sales-totals runs the same SQL and math this page runs (a beat may import
   only from src/pulse/beats/lib). One copy; this file imports it back. */
import {
  depositToFunded, floorTotals, formatUsdFromCents, monthWindow, rate
} from "../pulse/beats/lib/sales-totals-truth.mjs";

/** Civil date in America/Phoenix as YYYY-MM-DD.

    Arizona is where the floor works, so "today" on sales-floor is Arizona's
    today. It was Eastern before, which put every call logged after 9pm local
    on the next day's board. Arizona never shifts for daylight saving, so this
    boundary does not move twice a year either. */
export function localDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function priorWindow({ start, end }) {
  const ms = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - ms),
    end: start
  };
}

async function staffCashCents(db, { orgId, staffId, start, end }) {
  const r = await db.query(
    `SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cents,
            count(*) FILTER (WHERE outcome = 'deposit' AND transaction_id IS NOT NULL AND cash_collected_cents > 0)::int AS deposits,
            count(*) FILTER (WHERE outcome = 'downsell' AND transaction_id IS NOT NULL AND cash_collected_cents > 0)::int AS downsells,
            count(*) FILTER (WHERE outcome = 'no_show')::int AS no_shows,
            count(*) FILTER (WHERE outcome <> 'no_show')::int AS held,
            count(*)::int AS logged
       FROM call_outcomes
      WHERE org_id = $1 AND staff_id = $2
        AND logged_at >= $3 AND logged_at < $4
        AND COALESCE(is_demo, false) = false`,
    [orgId, staffId, start.toISOString(), end.toISOString()]
  );
  return r.rows[0];
}

async function commissionBuckets(db, { orgId, staffId }) {
  // commission_ledger.amount is numeric dollars — convert to cents at the boundary.
  const r = await db.query(
    `SELECT
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS paid_dollars,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('earned','approved')), 0) AS pending_dollars
       FROM commission_ledger
      WHERE org_id = $1 AND staff_id = $2
        AND COALESCE(is_demo, false) = false`,
    [orgId, staffId]
  ).catch(() => ({ rows: [{ paid_dollars: null, pending_dollars: null }] }));
  const row = r.rows[0] || {};
  if (row.paid_dollars == null && row.pending_dollars == null) {
    return {
      paid_cents: null,
      pending_cents: null,
      paid_reason: "commission_ledger not readable"
    };
  }
  return {
    paid_cents: Math.round(Number(row.paid_dollars || 0) * 100),
    pending_cents: Math.round(Number(row.pending_dollars || 0) * 100),
    paid_reason: null
  };
}

/** Monthly closer bar: metric `deposits` is a COUNT of deposits, not dollars. */
export async function closerDepositTarget(db, { orgId, staffId }) {
  const r = await db.query(
    `SELECT target_value FROM staff_targets
      WHERE org_id = $1 AND period = 'monthly' AND metric = 'deposits'
        AND (staff_id = $2 OR (staff_id IS NULL AND role = 'closer'))
      ORDER BY staff_id NULLS LAST
      LIMIT 1`,
    [orgId, staffId]
  );
  const v = r.rows[0]?.target_value;
  if (v == null) {
    return { count: null, display: null, reason: "No monthly deposit target has been set for this closer yet." };
  }
  const count = Math.round(Number(v));
  if (!Number.isFinite(count)) {
    return { count: null, display: null, reason: "No monthly deposit target has been set for this closer yet." };
  }
  return { count, display: count + " deposits", reason: null };
}

async function openShift(db, { orgId, staffId }) {
  const r = await db.query(
    `SELECT id, started_at FROM shifts
      WHERE org_id = $1 AND staff_id = $2 AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [orgId, staffId]
  );
  return r.rows[0] || null;
}

function parseDueAt(dueAt) {
  if (dueAt == null || dueAt === "") return null;
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

function owedUrgency(dueAt, now) {
  const d = parseDueAt(dueAt);
  if (!d) return "—";
  const ms = d.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const overdue = ms < 0;
  if (overdue) {
    if (abs < 60 * 60 * 1000) return Math.max(1, Math.floor(abs / 60000)) + "m overdue";
    if (abs < 24 * 60 * 60 * 1000) return Math.max(1, Math.floor(abs / 3600000)) + "h overdue";
    return Math.max(1, Math.floor(abs / 86400000)) + "d overdue";
  }
  if (abs < 60 * 60 * 1000) return "in " + Math.max(1, Math.floor(abs / 60000)) + "m";
  if (abs < 24 * 60 * 60 * 1000) return "in " + Math.max(1, Math.floor(abs / 3600000)) + "h";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function owedHeldDetail(dueAt) {
  const d = parseDueAt(dueAt);
  if (!d) return "No outcome recorded";
  const age = Date.now() - d.getTime();
  const when = (age >= 0 && age < 86400000)
    ? (age < 3600000 ? "just now" : Math.floor(age / 3600000) + "h ago")
    : d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC"
    });
  return `Held window ended ${when}; no outcome recorded`;
}

/**
 * Closer personal metrics for my-numbers.html.
 * Always scoped to staffId — never org-wide for a closer session.
 */
export async function closerMyNumbers(db, { orgId, staffId, now = new Date() } = {}) {
  if (!orgId || !staffId) throw new TypeError("closerMyNumbers: orgId and staffId required");
  const window = monthWindow(now);
  const prior = priorWindow(window);

  const [cur, prev, d2f, commissions, target, shift, unlogged, unloggedList, unrecordedList, unrecordedCount, team, offerStack, quietDeals] = await Promise.all([
    staffCashCents(db, { orgId, staffId, ...window }),
    staffCashCents(db, { orgId, staffId, ...prior }),
    depositToFunded(db, { orgId, staffId, ...window }),
    commissionBuckets(db, { orgId, staffId }),
    closerDepositTarget(db, { orgId, staffId }),
    openShift(db, { orgId, staffId }),
    countUnlogged(db, { orgId, staffId }),
    listUnloggedCalls(db, { orgId, staffId, limit: 10 }),
    listUnrecordedCalls(db, { orgId, staffId, now, limit: 10 }),
    countUnrecorded(db, { orgId, staffId, now }),
    teamLeaderboard(db, { orgId, ...window }),
    closerOfferStack(db, { orgId, staffId, ...window }),
    coldDeals(db, { orgId, staffId })
  ]);

  const cashCents = Number(cur.cents || 0);
  const held = Number(cur.held || 0);
  const deposits = Number(cur.deposits || 0);
  const closeRate = rate(deposits, held);
  const showDenom = held + Number(cur.no_shows || 0);
  const showRate = rate(held, showDenom);

  const meRank = team.findIndex((t) => t.staff_id === staffId);

  return {
    period: { start: window.start.toISOString(), end: window.end.toISOString(), label: "this month" },
    staff_id: staffId,
    offer_stack: offerStack,
    offer_stack_scope: {
      basis: "commission_ledger",
      note: "A sale only counts for a closer once it has a commission row."
    },
    shift: shift
      ? {
          on_shift: true,
          started_at: shift.started_at,
          elapsed_ms: Math.max(0, now.getTime() - new Date(shift.started_at).getTime())
        }
      : { on_shift: false, reason: "No open shift row" },
    pace: {
      cash_cents: cashCents,
      cash_display: formatUsdFromCents(cashCents),
      deposits,
      target_deposits: target.count,
      target_cents: null,
      target_display: target.display,
      target_reason: target.reason,
      rank: meRank >= 0 ? meRank + 1 : null,
      team_size: team.length
    },
    month: {
      deposits_closed: deposits,
      close_rate: closeRate,
      show_rate: showRate,
      downsells: Number(cur.downsells || 0),
      downsell_cash_cents: null, // would need separate sum; leave honest
      deposit_to_funded: d2f.rate,
      deposit_to_funded_n: d2f,
      avg_funded_cents: null,
      avg_funded_reason: "Average funded amount needs funding_rounds.funded_amount wired per closer — not scoped here yet",
      calls_held: held,
      no_shows: Number(cur.no_shows || 0),
      unlogged,
      unrecorded: unrecordedCount,
      prior: {
        deposits: Number(prev.deposits || 0),
        close_rate: rate(Number(prev.deposits || 0), Number(prev.held || 0))
      }
    },
    money: {
      paid_cents: commissions.paid_cents,
      pending_cents: commissions.pending_cents,
      at_risk_cents: null,
      at_risk_reason: "At-risk commission needs aging rules on open deposits — not built yet",
      paid_display: formatUsdFromCents(commissions.paid_cents),
      pending_display: formatUsdFromCents(commissions.pending_cents)
    },
    call_quality: {
      available: false,
      reason: "Call recording and transcription do not exist yet — talk ratio, monologue, and question counts cannot be measured"
    },
    compliance: {
      available: false,
      reason: "Compliance phrase detection needs call recordings — schema is ready (call_compliance_flags), pipeline is not"
    },
    team,
    owed: [
      ...unloggedList.map((u) => ({
        urgency: owedUrgency(u.due_at, now),
        title: `Log the call with ${u.client_name}`,
        detail: owedHeldDetail(u.due_at),
        task_id: u.task_id,
        client_id: u.client_id
      })),
      ...unrecordedList.map((u) => ({
        urgency: "UNRECORDED",
        title: `No tape for ${u.client_name}`,
        detail: u.detail,
        client_id: u.client_id,
        call_outcome_id: u.id
      })),
      ...quietDeals.map((deal) => ({
        urgency: `${deal.quiet_days}d quiet`,
        title: `Follow up with ${deal.name}`,
        detail: "Deposit paid, not funded",
        client_id: deal.client_id
      }))
    ],
    streak: {
      available: false,
      reason: "Daily close streak needs a calendar of working days — not stored yet"
    }
  };
}

async function teamLeaderboard(db, { orgId, start, end }) {
  const r = await db.query(
    `SELECT o.staff_id,
            s.name,
            COALESCE(SUM(o.cash_collected_cents), 0)::bigint AS cash_cents,
            count(*) FILTER (WHERE o.outcome = 'deposit' AND o.transaction_id IS NOT NULL AND o.cash_collected_cents > 0)::int AS deposits,
            count(*) FILTER (WHERE o.outcome <> 'no_show')::int AS held
       FROM call_outcomes o
       JOIN staff s ON s.id = o.staff_id AND s.org_id = o.org_id
      WHERE o.org_id = $1
        AND o.logged_at >= $2 AND o.logged_at < $3
        /* Owner-set: same roster as the Sales Floor board (closerRoster below).
           When these two drift, My Numbers and the wall board disagree about
           who is on the team and what rank somebody holds. */
        AND (
          lower(btrim(s.role)) = 'closer'
          OR lower(btrim(s.email)) = $4
          OR lower(btrim(s.name)) = $5
        )
      GROUP BY o.staff_id, s.name
      ORDER BY cash_cents DESC, deposits DESC`,
    [orgId, start.toISOString(), end.toISOString(),
     OWNER_SET_CLOSER.email.toLowerCase(), OWNER_SET_CLOSER.name.toLowerCase()]
  );
  return r.rows.map((row, i) => {
    const held = Number(row.held || 0);
    const deposits = Number(row.deposits || 0);
    return {
      rank: i + 1,
      staff_id: row.staff_id,
      name: row.name,
      cash_cents: Number(row.cash_cents || 0),
      cash_display: formatUsdFromCents(row.cash_cents),
      deposits,
      close_rate: rate(deposits, held)
    };
  });
}

/**
 * Belief analytics: this period vs last period, cuttable by lead source + setter.
 */
export async function beliefAnalytics(db, { orgId, start, end } = {}) {
  const prior = priorWindow({ start, end });
  const r = await db.query(
    `SELECT o.belief_failed AS belief,
            COALESCE(cf.utm_campaign, cf.utm_source, c.channel_source, 'unknown') AS lead_source,
            COALESCE(NULLIF(c.custom_fields->'setter_handoff'->>'setter_staff_id', ''),
                     cf.cf_setter_user_id, 'unknown') AS setter_id,
            MAX(NULLIF(c.custom_fields->'setter_handoff'->>'setter_name', '')) AS setter_name,
            count(*) FILTER (
              WHERE o.logged_at >= $2 AND o.logged_at < $3
            )::int AS this_count,
            count(*) FILTER (
              WHERE o.logged_at >= $4 AND o.logged_at < $5
            )::int AS last_count
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
       LEFT JOIN client_custom_fields cf ON cf.client_id = c.id AND cf.org_id = c.org_id
      WHERE o.org_id = $1
        AND o.belief_failed IS NOT NULL
        AND o.logged_at >= $4 AND o.logged_at < $3
      GROUP BY 1, 2, 3`,
    [orgId, start.toISOString(), end.toISOString(), prior.start.toISOString(), prior.end.toISOString()]
  );

  const byBelief = new Map(BELIEFS.map((b) => [b, { belief: b, label: BELIEF_LABELS[b], this_count: 0, last_count: 0 }]));
  const bySource = new Map();

  for (const row of r.rows) {
    const b = byBelief.get(row.belief);
    if (b) {
      b.this_count += Number(row.this_count || 0);
      b.last_count += Number(row.last_count || 0);
    }
    const key = `${row.lead_source}||${row.setter_id}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        lead_source: row.lead_source,
        setter_id: row.setter_id,
        setter_key: row.setter_name || row.setter_id,
        held: 0,
        deposits: 0,
        desire: 0,
        beliefs: {}
      });
    }
    const s = bySource.get(key);
    s.beliefs[row.belief] = {
      this_count: Number(row.this_count || 0),
      last_count: Number(row.last_count || 0)
    };
    if (row.belief === "desire") s.desire += Number(row.this_count || 0);
  }

  // Held/close by source for the current period.
  const src = await db.query(
    `SELECT COALESCE(cf.utm_campaign, cf.utm_source, c.channel_source, 'unknown') AS lead_source,
            COALESCE(NULLIF(c.custom_fields->'setter_handoff'->>'setter_staff_id', ''),
                     cf.cf_setter_user_id, 'unknown') AS setter_id,
            MAX(NULLIF(c.custom_fields->'setter_handoff'->>'setter_name', '')) AS setter_name,
            count(*) FILTER (WHERE o.outcome <> 'no_show')::int AS held,
            count(*) FILTER (WHERE o.outcome = 'deposit' AND o.transaction_id IS NOT NULL AND o.cash_collected_cents > 0)::int AS deposits
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
       LEFT JOIN client_custom_fields cf ON cf.client_id = c.id AND cf.org_id = c.org_id
      WHERE o.org_id = $1
        AND o.logged_at >= $2 AND o.logged_at < $3
      GROUP BY 1, 2`,
    [orgId, start.toISOString(), end.toISOString()]
  );
  for (const row of src.rows) {
    const key = `${row.lead_source}||${row.setter_id}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        lead_source: row.lead_source,
        setter_id: row.setter_id,
        setter_key: row.setter_name || row.setter_id,
        held: 0,
        deposits: 0,
        desire: 0,
        beliefs: {}
      });
    }
    const s = bySource.get(key);
    s.held = Number(row.held || 0);
    s.deposits = Number(row.deposits || 0);
    s.close_rate = rate(s.deposits, s.held);
  }

  const beliefs = [...byBelief.values()].sort((a, b) => b.this_count - a.this_count);
  const max = Math.max(1, ...beliefs.map((b) => b.this_count));
  for (const b of beliefs) b.bar = b.this_count / max;

  return {
    beliefs,
    sources: [...bySource.values()].sort((a, b) => (b.desire - a.desire) || (b.held - a.held)),
    period: { start: start.toISOString(), end: end.toISOString() },
    prior: { start: prior.start.toISOString(), end: prior.end.toISOString() }
  };
}

/**
 * Manager floor view.
 */
export async function salesFloor(db, { orgId, now = new Date(), env = process.env } = {}) {
  if (!orgId) throw new TypeError("salesFloor: orgId required");
  const window = monthWindow(now);

  const todayYmd = localDateString(now);
  const [totals, todayFunnel, closers, setters, beliefs, unlogged, unrecordedList, unrecordedCount, cold, shiftsLate, recordings, offer] = await Promise.all([
    // Team cash, the funnel and deposit to funded (src/pulse/beats/lib/sales-totals-truth.mjs).
    floorTotals(db, { orgId, ...window }),
    floorFunnelDay(db, { orgId, day: todayYmd }),
    closerRoster(db, { orgId, ...window, now }),
    setterRoster(db, { orgId, now }),
    beliefAnalytics(db, { orgId, ...window }),
    countUnlogged(db, { orgId }),
    listUnrecordedCalls(db, { orgId, now, limit: 20 }),
    countUnrecorded(db, { orgId, now }),
    coldDeals(db, { orgId }),
    lateShifts(db, { orgId, now }),
    listRecentRecordings(db, { orgId, now, env }),
    floorOfferStack(db, { orgId, ...window })
  ]);

  // Each closer carries their own stack so the floor's closer picker needs no
  // second request. A closer with no sale gets a full zero stack, not a blank.
  const closersWithStack = closers.map((c) => ({
    ...c,
    offer_stack: offer.byCloser?.get(c.staff_id)
      ?? zeroStackFrom(offer.products, { start: window.start, end: window.end })
  }));

  const { cashCents, funnel, d2f } = totals;
  const [target, dailyTarget] = await Promise.all([
    db.query(
      `SELECT target_value FROM staff_targets
        WHERE org_id = $1 AND period = 'monthly' AND metric = 'deposits'
          AND staff_id IS NULL AND role = 'sales_manager'
        LIMIT 1`,
      [orgId]
    ),
    db.query(
      `SELECT target_value FROM staff_targets
        WHERE org_id = $1 AND period = 'daily' AND metric = 'deposits'
          AND staff_id IS NULL AND role = 'sales_manager'
        LIMIT 1`,
      [orgId]
    )
  ]);
  const targetCents = target.rows[0]
    ? Math.round(Number(target.rows[0].target_value) * 100)
    : null;
  const dailyTargetValue = dailyTarget.rows[0]?.target_value;
  const dailyTargetDeposits = dailyTargetValue == null
    ? null
    : Math.round(Number(dailyTargetValue));
  const validDailyTarget = Number.isFinite(dailyTargetDeposits) && dailyTargetDeposits > 0
    ? dailyTargetDeposits
    : null;

  return {
    period: { start: window.start.toISOString(), end: window.end.toISOString() },
    hero: {
      cash_cents: cashCents,
      cash_display: formatUsdFromCents(cashCents),
      target_cents: targetCents,
      target_display: formatUsdFromCents(targetCents),
      target_reason: targetCents == null
        ? "No monthly deposit target has been set for the sales team yet."
        : null,
      deposit_to_funded: d2f.rate,
      deposit_to_funded_n: d2f
    },
    funnel,
    today: {
      date: todayYmd,
      booked: todayFunnel.booked,
      held: todayFunnel.held,
      deposits: todayFunnel.deposits,
      target_deposits: validDailyTarget,
      target_reason: validDailyTarget == null
        ? "No daily deposit target has been set for the sales team yet."
        : null
    },
    offer_stack: offer.stack,
    offer_stack_unattributed: offer.unattributed,
    closers: closersWithStack,
    setters,
    beliefs,
    recordings,
    unrecorded: {
      count: unrecordedCount,
      items: unrecordedList
    },
    compliance: {
      available: false,
      reason: recordings.items.some((it) => it.has_words)
        ? "Call words are on file. Phrase flags are not scored yet."
        : recordings.items.length
          ? "Recordings are in Drive. Words fill in after Sync, or in the background for leftover files."
          : (recordings.reason
            || "No Meet recordings yet. Click Record in Google Meet; the file lands in Drive."),
      items: []
    },
    cold_deals: cold,
    discipline: {
      unlogged_calls: unlogged,
      unrecorded_calls: unrecordedCount,
      shifts_started_late: shiftsLate.count,
      shifts_detail: shiftsLate.detail,
      followups_overdue: null,
      followups_reason: "Follow-up overdue count needs a dedicated follow-up task type — not distinguished yet",
      avg_log_lag_days: null,
      avg_log_lag_reason: "Average time-to-log needs booking end timestamps joined to logged_at — booking end not on call_outcomes yet"
    }
  };
}

/** Same funnel counts, one America/Phoenix civil day. */
async function floorFunnelDay(db, { orgId, day }) {
  const [booked, outcomes] = await Promise.all([
    db.query(
      `SELECT count(DISTINCT e.client_id)::int AS n
         FROM events e
         JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
        WHERE e.org_id = $1 AND e.name = 'booking.created'
          AND e.created_at >= ($2::date AT TIME ZONE 'America/Phoenix')
          AND e.created_at < (($2::date + 1) AT TIME ZONE 'America/Phoenix')
          AND COALESCE(c.is_demo, false) = false
          AND COALESCE(e.payload->>'simulated', 'false') <> 'true'
          AND COALESCE(e.payload->>'environment', '') <> 'simulated'`,
      [orgId, day]
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE o.outcome <> 'no_show')::int AS held,
              count(*) FILTER (WHERE o.outcome = 'deposit' AND o.transaction_id IS NOT NULL AND o.cash_collected_cents > 0)::int AS deposits
         FROM call_outcomes o
         JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
        WHERE o.org_id = $1
          AND o.logged_at >= ($2::date AT TIME ZONE 'America/Phoenix')
          AND o.logged_at < (($2::date + 1) AT TIME ZONE 'America/Phoenix')
          AND COALESCE(o.is_demo, false) = false
          AND COALESCE(c.is_demo, false) = false`,
      [orgId, day]
    )
  ]);
  const bookedN = Number(booked.rows[0]?.n || 0);
  const held = Number(outcomes.rows[0]?.held || 0);
  return {
    booked: Math.max(bookedN, held),
    held,
    deposits: Number(outcomes.rows[0]?.deposits || 0)
  };
}

/** Owner-set: Chris is the closer even when staff.role is owner. */
export const OWNER_SET_CLOSER = Object.freeze({
  name: "Chris Stanbridge",
  email: "chris@fundhub.ai"
});

const BLOCKED_CLOSER_NAMES = new Set([
  "jordan blake",
  "nina castellano",
  "marcus webb",
  "elena voss",
  "devon marsh",
  "crs sandbox smoke"
]);

export function isOwnerSetCloser({ name, email } = {}) {
  const n = String(name || "").trim().toLowerCase();
  const e = String(email || "").trim().toLowerCase();
  return n === OWNER_SET_CLOSER.name.toLowerCase()
    || e === OWNER_SET_CLOSER.email;
}

export function isBlockedCloserIdentity({ name, email, is_demo } = {}, { demoMode = false } = {}) {
  const n = String(name || "").trim();
  const e = String(email || "").trim().toLowerCase();
  if (BLOCKED_CLOSER_NAMES.has(n.toLowerCase())) return true;
  if (/sandbox/i.test(n) || /sandbox/i.test(e)) return true;
  if (/^test\b/i.test(n)) return true;
  if (demoMode) return false;
  if (is_demo === true || is_demo === "true" || is_demo === "t") return true;
  if (isDemoEmail(e)) return true;
  if (/\bdemo\b/i.test(n)) return true;
  return false;
}

export function belongsOnCloserBoard(staff = {}, opts = {}) {
  // Owner-set: Chris takes calls, so he belongs on the board even though
  // staff.role says owner. Every other owner row stays off it.
  if (isOwnerSetCloser(staff)) return true;
  if (String(staff.role || "").trim().toLowerCase() === "owner") return false;
  if (isBlockedCloserIdentity(staff, opts)) return false;
  return String(staff.role || "").trim().toLowerCase() === "closer";
}

export function filterCloserRoster(rows, opts) {
  return (rows || []).filter((row) => belongsOnCloserBoard(row, opts));
}

export function belongsOnSetterBoard(staff = {}, opts = {}) {
  if (isBlockedCloserIdentity(staff, opts)) return false;
  if (isOwnerSetCloser(staff)) return true;
  return String(staff.role || "").trim().toLowerCase() === "setter";
}

export function filterSetterRoster(rows, opts) {
  return (rows || []).filter((row) => belongsOnSetterBoard(row, opts));
}

export async function setterRoster(db, { orgId, now = new Date() }) {
  const demoMode = await orgDemoModeEnabled(db, orgId);
  const result = await db.query(
    `SELECT s.id AS staff_id, s.name, s.email, s.role, s.is_demo
       FROM staff s
      WHERE s.org_id = $1 AND s.status = 'active'
        AND (lower(btrim(s.role)) = 'setter'
          OR lower(btrim(s.email)) = $2
          OR lower(btrim(s.name)) = $3)
      ORDER BY s.name`,
    [orgId, OWNER_SET_CLOSER.email.toLowerCase(), OWNER_SET_CLOSER.name.toLowerCase()]
  );
  return Promise.all(filterSetterRoster(result.rows, { demoMode }).map(async row => ({
    staff_id: row.staff_id,
    name: row.name,
    ...(await setterNumbers(db, { org_id: orgId, id: row.staff_id }, { now, includeDemo: demoMode }))
  })));
}

async function closerRoster(db, { orgId, start, end, now }) {
  const demoMode = await orgDemoModeEnabled(db, orgId);
  const r = await db.query(
    `SELECT s.id AS staff_id, s.name, s.email, s.role, s.is_demo,
            sh.started_at AS shift_started,
            COALESCE(agg.cash_cents, 0)::bigint AS cash_cents,
            COALESCE(agg.held, 0)::int AS held,
            COALESCE(agg.deposits, 0)::int AS deposits
       FROM staff s
       LEFT JOIN LATERAL (
         SELECT started_at FROM shifts
          WHERE org_id = s.org_id AND staff_id = s.id AND ended_at IS NULL
          ORDER BY started_at DESC LIMIT 1
       ) sh ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(cash_collected_cents), 0)::bigint AS cash_cents,
                count(*) FILTER (WHERE outcome <> 'no_show')::int AS held,
                count(*) FILTER (WHERE outcome = 'deposit' AND transaction_id IS NOT NULL AND cash_collected_cents > 0)::int AS deposits
           FROM call_outcomes
          WHERE org_id = s.org_id AND staff_id = s.id
            AND logged_at >= $2 AND logged_at < $3
            ${demoClause()}
       ) agg ON true
      WHERE s.org_id = $1
        AND s.status = 'active'
        AND (
          lower(btrim(s.role)) = 'closer'
          OR lower(btrim(s.email)) = $4
          OR lower(btrim(s.name)) = $5
        )
      ORDER BY cash_cents DESC, s.name`,
    [orgId, start.toISOString(), end.toISOString(),
     OWNER_SET_CLOSER.email.toLowerCase(), OWNER_SET_CLOSER.name.toLowerCase()]
  );

  const out = [];
  for (const row of filterCloserRoster(r.rows, { demoMode })) {
    const d2f = await depositToFunded(db, {
      orgId, staffId: row.staff_id, start, end
    });
    const held = Number(row.held || 0);
    const deposits = Number(row.deposits || 0);
    const cashCents = Number(row.cash_cents || 0);
    const hasLive = held > 0 || deposits > 0 || cashCents > 0;
    const closeRate = rate(deposits, held);
    let action = null;
    if (d2f.rate != null && d2f.rate < 0.7 && deposits >= 3) {
      action = "Chase docs. Sells more than funds.";
    } else if (closeRate != null && closeRate < 0.25 && held >= 10) {
      action = "Sit on the next call. Close rate is soft.";
    } else if (d2f.rate != null && d2f.rate >= 0.75) {
      action = "Leave them alone. Funded rate is strong.";
    }
    out.push({
      staff_id: row.staff_id,
      name: row.name,
      on_shift: !!row.shift_started,
      shift_started: row.shift_started,
      shift_elapsed_ms: row.shift_started
        ? Math.max(0, now.getTime() - new Date(row.shift_started).getTime())
        : null,
      calls: held,
      deposits,
      close_rate: closeRate,
      funded_rate: d2f.rate,
      cash_cents: hasLive ? cashCents : null,
      cash_display: hasLive ? formatUsdFromCents(cashCents) : null,
      action
    });
  }
  return out;
}

async function coldDeals(db, { orgId, staffId = null }) {
  // Clients with a deposit outcome, not funded, no message in 7+ days.
  const params = [orgId];
  let staffClause = "";
  if (staffId) {
    params.push(staffId);
    staffClause = `AND o.staff_id = $${params.length}`;
  }
  const r = await db.query(
    `SELECT c.id AS client_id,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), c.email, 'Client') AS name,
            o.staff_id,
            s.name AS closer_name,
            o.logged_at AS deposit_at,
            EXTRACT(DAY FROM (now() - COALESCE(m.last_at, o.logged_at)))::int AS quiet_days
       FROM call_outcomes o
       JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
       JOIN staff s ON s.id = o.staff_id
       LEFT JOIN LATERAL (
         SELECT max(created_at) AS last_at FROM messages
          WHERE client_id = c.id AND org_id = c.org_id
       ) m ON true
      WHERE o.org_id = $1
        ${staffClause}
        AND o.outcome = 'deposit' AND o.transaction_id IS NOT NULL AND o.cash_collected_cents > 0
        AND c.funded IS NOT TRUE
        AND o.logged_at < now() - interval '7 days'
        AND COALESCE(m.last_at, o.logged_at) < now() - interval '7 days'
      ORDER BY quiet_days DESC
      LIMIT 20`,
    params
  ).catch(() => ({ rows: [] }));
  return r.rows.map((row) => ({
    client_id: row.client_id,
    name: row.name,
    closer_name: row.closer_name,
    quiet_days: Number(row.quiet_days || 0),
    detail: `${row.closer_name} · deposit paid, not funded`
  }));
}

async function lateShifts(db, { orgId, now }) {
  // Honest empty-ish: we can count shifts started after a local 9:30 if we assume UTC morning —
  // without a timezone on staff, report count of shifts started > 30m after scheduled? We don't have schedules.
  // Return honest empty.
  void orgId; void now;
  return {
    count: null,
    detail: [],
    reason: "Shift start lateness needs scheduled shift times — shifts table only has started_at/ended_at"
  };
}

export { formatUsdFromCents, monthWindow, closerRoster };
