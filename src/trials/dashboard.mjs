// The live dashboard's numbers. Real rows, or nothing.
//
// THIS IS THE PRODUCT. A person pays $297 to watch their own name book calls
// for a week. Every figure on this screen is a count of rows that exist, scoped
// to their partner id. There is no sample data path, no demo mode, and no
// modelled figure anywhere in this file.
//
// NO EARNINGS CLAIMS, AND THE RULE HAS TEETH HERE. There are zero measured paid
// closes on record, so this module may return THIS buyer's own numbers and
// nothing else — never a typical result, never a range, never another buyer's
// result, never a projection of what the week will produce. If a caller wants a
// benchmark, the honest answer is that none exists.
//
// ZERO IS A REAL ANSWER AND IT IS RENDERED AS ZERO. A trial with no booked calls
// shows zero booked calls. Hiding it behind an empty state, or filling it with
// something from another partner, would be the one lie this screen could tell.
//
// NULL SURVIVES. Spend is NULL — not 0 — when no metrics have synced yet,
// because "we have not heard from the platform" and "the platform says you
// spent nothing" are different facts and the second one has a refund
// conversation attached to it.
//
// SCOPE. Every query carries org_id AND partner_id. bookings has no partner
// column, so booked calls are reached through clients.partner_id, which
// 042_partners.sql calls "the whole tenancy model" and indexes for exactly this.

import { TRIAL_DAYS } from "./constants.mjs";
import { trialDayIndex, daysRemaining, phaseFor, DAY_PLAN } from "./clock.mjs";
import { getTrialByPartner, listTrialEvents } from "./store.mjs";

/** The window a trial's numbers are counted over: first impression to the end
    of the seventh day. Before the clock starts there is no window, and the
    counts are all null rather than "everything ever". */
export function trialWindow(trial) {
  if (!trial || !trial.started_at) return null;
  return { from: trial.started_at, to: trial.ends_at || null };
}

async function countLeads(db, { orgId, partnerId, from, to }) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n
       FROM clients
      WHERE org_id = $1
        AND partner_id = $2
        AND created_at >= $3
        AND ($4::timestamptz IS NULL OR created_at <= $4)`,
    [orgId, partnerId, from, to]
  );
  return rows[0] ? rows[0].n : 0;
}

async function readSpend(db, { orgId, partnerId, from, to }) {
  /* ad_metrics_daily is keyed by day, so the window is compared on `date`.
     COALESCE is NOT used on the sums: no rows means no sync, and that has to
     come back as null. */
  const { rows } = await db.query(
    `SELECT SUM(spend_cents)::bigint AS spend_cents,
            SUM(impressions)::bigint AS impressions,
            SUM(clicks)::bigint      AS clicks,
            count(*)::int            AS days_synced
       FROM ad_metrics_daily
      WHERE org_id = $1
        AND partner_id = $2
        AND date >= $3::date
        AND ($4::timestamptz IS NULL OR date <= $4::date)`,
    [orgId, partnerId, from, to]
  );
  const row = rows[0] || {};
  if (!row.days_synced) {
    return { spendCents: null, impressions: null, clicks: null, daysSynced: 0 };
  }
  return {
    spendCents: row.spend_cents == null ? null : Number(row.spend_cents),
    impressions: row.impressions == null ? null : Number(row.impressions),
    clicks: row.clicks == null ? null : Number(row.clicks),
    daysSynced: row.days_synced
  };
}

async function readBookings(db, { orgId, partnerId, from, to, limit = 100 }) {
  const n = Number(limit);
  const capped = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 200) : 100;
  const { rows } = await db.query(
    `SELECT b.id, b.starts_at, b.ends_at, b.status, b.source, b.event_type_slug,
            b.created_at,
            COALESCE(NULLIF(btrim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
                     b.attendee_name, 'Lead') AS display_name
       FROM bookings b
       -- The join carries org_id as well as partner_id: a booking is only ever
       -- reachable through a client that is this company's AND this partner's.
       JOIN clients c ON c.id = b.client_id AND c.org_id = b.org_id
      WHERE b.org_id = $1
        AND c.partner_id = $2
        AND c.custom_fields->>'crm_archived_at' IS NULL
        AND b.created_at >= $3
        AND ($4::timestamptz IS NULL OR b.created_at <= $4)
      ORDER BY b.starts_at ASC NULLS LAST, b.created_at ASC
      LIMIT $5`,
    [orgId, partnerId, from, to, capped]
  );
  return rows || [];
}

/**
 * trialDashboard(db, { orgId, partnerId, now }) → the whole screen's data.
 *
 * Returns { ok:false, reason:"no_trial" } rather than an empty dashboard when
 * the partner has no trial: an empty dashboard reads as "your trial produced
 * nothing", which is a different and much worse statement.
 */
export async function trialDashboard(db, { orgId, partnerId, now = new Date(), bookingLimit = 100 } = {}) {
  if (!orgId) throw new TypeError("trialDashboard: orgId is required");
  if (!partnerId) throw new TypeError("trialDashboard: partnerId is required");

  const trial = await getTrialByPartner(db, { orgId, partnerId });
  if (!trial) return { ok: false, reason: "no_trial" };

  const window = trialWindow(trial);
  const phase = phaseFor(trial.status, now, trial.started_at);
  const dayIndex = trialDayIndex(now, trial.started_at);
  const remaining = daysRemaining(now, trial.started_at);

  /* NO WINDOW MEANS NO COUNTS. A held-start trial has been paid for and fully
     built, and it has produced nothing because nothing has run. Reporting zeros
     would say "your campaign spent nothing"; reporting null says "it has not
     started", which is the truth. */
  if (!window) {
    return {
      ok: true,
      trial: shapeTrial(trial, { phase, dayIndex, remaining }),
      numbers: {
        spend_cents: null,
        impressions: null,
        clicks: null,
        leads: null,
        booked_calls: null,
        days_synced: 0
      },
      bookings: [],
      plan: DAY_PLAN,
      events: await listTrialEvents(db, { orgId, liveTrialId: trial.id, limit: 25 }),
      notes: heldStartNotes(trial)
    };
  }

  const [leads, spend, bookings] = await Promise.all([
    countLeads(db, { orgId, partnerId, from: window.from, to: window.to }),
    readSpend(db, { orgId, partnerId, from: window.from, to: window.to }),
    readBookings(db, { orgId, partnerId, from: window.from, to: window.to, limit: bookingLimit })
  ]);

  return {
    ok: true,
    trial: shapeTrial(trial, { phase, dayIndex, remaining }),
    numbers: {
      spend_cents: spend.spendCents,
      impressions: spend.impressions,
      clicks: spend.clicks,
      leads,
      booked_calls: bookings.length,
      days_synced: spend.daysSynced
    },
    bookings,
    plan: DAY_PLAN,
    events: await listTrialEvents(db, { orgId, liveTrialId: trial.id, limit: 25 }),
    notes: []
  };
}

function heldStartNotes(trial) {
  if (trial.status !== "held_start") {
    return [{
      key: "not_started",
      text: "Your seven days have not started. They begin the moment your first ad is served, not when you paid."
    }];
  }
  return [{
    key: "held_start",
    text: "Your funnel and your ad set are built and waiting. Your seven days start the day Meta verifies your business. " +
          "We cannot tell you how long that takes — it is their system, not ours."
  }];
}

function shapeTrial(trial, { phase, dayIndex, remaining }) {
  return {
    id: trial.id,
    status: trial.status,
    phase,
    held_start: trial.held_start,
    day: dayIndex,
    of_days: TRIAL_DAYS,
    days_remaining: remaining,
    started_at: trial.started_at,
    ends_at: trial.ends_at,
    frozen_until: trial.frozen_until,
    price_cents: trial.price_cents,
    // Whether the screen should keep polling. A frozen dashboard is readable
    // and static; it is not broken and it must not say "loading" forever.
    live: trial.status === "running",
    readable_until: trial.frozen_until
  };
}

export default { trialDashboard, trialWindow };
