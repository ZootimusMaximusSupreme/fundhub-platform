// The Meta ad-numbers sweeper — the clock behind the campaign pull.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS. NUMBERS WERE BEING LOST FOR GOOD — 2026-09-09.
//
// api/campaigns/sync.mjs pulls a partner's Meta campaigns, ad sets, ads and
// their day-by-day numbers. Until today NOTHING ANYWHERE CALLED IT ON A CLOCK.
// Grepped before this file was written: `campaigns/sync` appears in
// netlify/functions/api.mjs's route map, in src/pulse/registry.mjs, and in its
// own tests. No workflow, no cron, no scheduled job. The only way a sync ever
// ran was a person opening the campaigns screen and pressing Sync.
//
// Paired with a window that only reached back seven days, that is permanent
// data loss, not a delay:
//
//   * Nobody presses the button for eight days → day eight can never be asked
//     for again. Meta still has it. This platform would never ask.
//   * ad_metrics_daily then has no row for that day, and every screen that
//     reads it renders a missing row as zero. "Nobody looked" and "we spent
//     nothing" look exactly the same on a chart.
//
// Two changes close it, and both are needed — either alone still loses days.
// The window is now 28 days (INSIGHT_WINDOW_DAYS, and its comment carries the
// reasoning), and this file is what runs the pull without anyone asking.
//
//
// WHAT ONE PASS DOES. Find every partner that has a Meta connection worth
// trying, and run the ordinary sync for each of them, one partner at a time.
// It is the SAME code path the button uses — syncPartnerConnections() — so
// there is no second, drifting copy of the pull to keep in step.
//
//
// ONE BROKEN PARTNER NEVER TAKES THE PASS DOWN. Every partner is wrapped in its
// own try/catch. A revoked token, a Meta outage, an ad account somebody deleted
// — each is recorded against that partner and the loop moves on. Same reasoning
// as finance-os-pull-sweeper.mjs's per-client catch. A pass that stopped at the
// first bad connection would be the old problem wearing a schedule.
//
//
// WHAT IT RECORDS, AND WHERE. Three places, none of them new:
//   * The tally this function returns — partners seen, partners synced, rows
//     written, who was skipped and who failed. Inngest keeps the return value
//     of every run, so that is the run log.
//   * ad_platform_connections.last_synced_at, set by the sync itself the moment
//     Meta answers.
//   * ad_platform_connections.last_error, set by the sync with Meta's own
//     sentence when a connection fails. That is what the screen already shows.
//
//
// WHY 'pending' CONNECTIONS ARE INCLUDED. It attempts exactly the rows the
// button attempts — syncBlockReason() in api/campaigns/sync.mjs is the single
// definition of "worth trying", used by both. A 'pending' row is a connection
// waiting on the partner admin to click Approve in Meta's Business Settings,
// and a successful read is the only thing in this codebase that promotes one to
// 'active'. If this pass skipped them, a partner who approved on Tuesday would
// stay pending until somebody happened to press the button. Rows that cannot
// work — no stored token, or a `pending:biz:<id>` placeholder ad account — are
// left out by the same function, because asking Meta about them only produces a
// confusing 400.
//
//
// HOURLY FOR 3 DAYS, PLUS THE NIGHTLY 28 DAYS (2026-10-05). This replaces the
// old "daily, not hourly" reason. That reason was: an hourly pull of 28 days
// re-reads the same days twenty-four times for numbers that move once. It is
// still true of 28 days, which is why the hourly pass reads only 3. What
// changed is who reads the numbers: Chris now runs his marketing from the
// Command Center (docs/specs/marketing-machine-2026-10-04.md, M0 step 5: "Run
// hourly for the last 3 days, plus a nightly 28-day pass"), so today's spend
// and results must be at most an hour old, not up to a day old.
//
//   * HOURLY, at minute 30 (HOURLY_CRON). Today in the ad account's zone
//     (America/Phoenix) and the 2 days before it, the days still moving. It
//     never takes the whole-history path, whatever is or is not stored
//     (SYNC_PASSES in api/campaigns/sync.mjs). It asks Meta for strictly fewer
//     rows than the nightly pass, which already fits the 26-second
//     /api/inngest limit (the 28-day pass completed at 07:01 UTC on
//     2026-10-05), so it stays in Inngest. Minute 30 keeps it from starting in
//     the same minute as the nightly pass and writing the same campaign rows
//     at once. The dying-ad scan still runs at the end of every pass and still
//     buzzes at most once per ad per day (ad_watch_curve_alerts).
//   * NIGHTLY, at 07:00 UTC (SWEEP_CRON), unchanged. Meta reports by whole day
//     in the ad account's own timezone, and 07:00 UTC is midnight in Arizona,
//     just after the day closes. It re-reads 28 days because Meta keeps
//     restating recent days, and so a pass that is missed, paused or broken
//     costs nothing permanent — the next one that succeeds repairs it. The
//     first pull of a new ad account (its whole history) happens here or on
//     the Sync button, never on the hourly pass.
//
//
// REGISTERING IT SENDS NOTHING AND SPENDS NOTHING. The sync is a READ from Meta
// plus writes into our own campaigns / ad_sets / ads / ad_metrics_daily tables.
// It does not create a campaign, change a budget, pause or start anything, or
// message anybody. Campaigns go live from api/campaigns/write.mjs, which is a
// person pressing a button and is untouched by this.
//
// INNGEST_EVENT_KEY is not this file's business and is not touched by it.

import { inngest } from "./client.mjs";
import { asStaff } from "../partners/rls.mjs";
import {
  syncPartnerConnections,
  syncPass
} from "../../api/campaigns/sync.mjs";

/* 07:00 UTC daily — midnight in Arizona, just after the ad account's day
   closes: the nightly 28-day pass. See the header for why this hour. */
export const SWEEP_CRON = "0 7 * * *";
export const SOURCE_WORKFLOW = "meta-campaign-sync-sweeper";

/* Minute 30 of every hour: the hourly 3-day pass. See the header for why it
   is hourly, why 3 days, and why minute 30. */
export const HOURLY_CRON = "30 * * * *";
export const HOURLY_WORKFLOW = "meta-campaign-sync-hourly";

/* The partners worth a pull, read ACROSS the partner boundary.
   asStaff() is the staff scope in src/partners/rls.mjs — the same boundary
   crossing every cross-partner sweeper uses. The per-partner work underneath is
   still opened inside that partner's own scope by syncPartnerConnections(), so
   nothing here widens what a partner-scoped query can see.

   The three conditions mirror syncBlockReason() exactly: a state worth trying,
   a stored key, and a real ad account number rather than a placeholder. They
   are repeated in SQL only to avoid loading every Meta connection in the
   platform into memory to throw most of them away; syncBlockReason() remains
   the authority and runs again inside the sync. */
export const DUE_PARTNERS_SQL = `
  SELECT DISTINCT partner_id
    FROM ad_platform_connections
   WHERE platform = 'meta'
     AND connection_state IN ('active', 'pending')
     AND encrypted_access_token IS NOT NULL
     AND external_ad_account_id IS NOT NULL
     AND external_ad_account_id NOT ILIKE 'pending:%'
   ORDER BY partner_id`;

export async function duePartners({ scope = asStaff } = {}) {
  const rows = await scope((tx) => tx.query(DUE_PARTNERS_SQL).then((r) => r.rows));
  return rows.map((r) => r.partner_id).filter(Boolean);
}

/* sweep — one pass. Every collaborator is an argument, so the tests drive it
   without Inngest, without Meta and without a database.

   NEVER THROWS. A pass that fails must not take the scheduled function down
   with it: the next pass is the recovery, and the nightly 28-day window means
   it can still fetch everything a missed pass did not. The failure is returned
   so it is visible in the run log.

   `pass` is "nightly" (the default, the 07:00 UTC clock) or "hourly" (the
   3-day clock); it is handed to every partner's sync. */
export async function sweep({
  listPartners = duePartners,
  sync = syncPartnerConnections,
  deps = {},
  pass = "nightly"
} = {}) {
  let plan;
  try {
    plan = syncPass(pass);
  } catch (err) {
    return {
      ok: false,
      pass: String(pass),
      partners: 0,
      synced: 0,
      error: String((err && err.message) || err).slice(0, 300)
    };
  }

  const tally = {
    ok: true,
    pass: plan.name,
    window_days: plan.windowDays,
    partners: 0,
    synced: 0,
    campaigns: 0,
    ad_sets: 0,
    ads: 0,
    days_of_numbers: 0,
    skipped: [],
    errored: []
  };

  let partnerIds;
  try {
    partnerIds = await listPartners();
  } catch (err) {
    // Could not even find out who to sync. Nothing was attempted, and saying
    // "0 partners, all fine" would be the exact lie this repo keeps catching.
    return { ...tally, ok: false, error: String((err && err.message) || err).slice(0, 300) };
  }

  tally.partners = partnerIds.length;

  for (const partnerId of partnerIds) {
    try {
      const stats = await sync({ partnerId, deps, pass: plan.name });
      tally.synced += 1;
      tally.campaigns += stats.campaigns || 0;
      tally.ad_sets += stats.ad_sets || 0;
      tally.ads += stats.ads || 0;
      tally.days_of_numbers += stats.insights || 0;

      /* A partner can succeed in part — one campaign fails, the rest commit.
         buildSyncResponse() makes that visible to the person at the screen;
         this makes it visible in the run log rather than rounding it up to
         "synced". */
      if (Array.isArray(stats.errors) && stats.errors.length) {
        tally.errored.push({
          partner_id: partnerId,
          partial: true,
          error: String(stats.errors[0].error || stats.errors[0]).slice(0, 300)
        });
      }
    } catch (err) {
      const code = err && err.code;
      if (code === "NO_CONNECTION" || code === "NO_TOKEN") {
        /* Expected and common: a connection that exists but cannot be used
           yet. Not a fault of the pass, so it is a skip rather than an error —
           the reason still travels, and the connection row already carries it
           for the screen. */
        tally.skipped.push({
          partner_id: partnerId,
          reason: String((err && err.message) || code).slice(0, 300)
        });
      } else {
        tally.errored.push({
          partner_id: partnerId,
          error: String((err && err.message) || err).slice(0, 300)
        });
      }
    }
  }

  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects of every
   registered workflow. No event trigger (it is a cron), so it appears in the
   runner's neverFired list by design, same as finance-os-pull-sweeper.mjs. */
export async function handle({ step } = {}) {
  const run = () => sweep();
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

/* The same, for the hourly 3-day pass. */
export async function handleHourly({ step } = {}) {
  const run = () => sweep({ pass: "hourly" });
  return step && typeof step.run === "function" ? step.run("sweep-hourly", run) : run();
}

/* This file serves two functions, so the journey runner is told which handler
   belongs to which id (src/journeys/runner/registry.mjs reads `handles`). */
export const handles = Object.freeze({
  [SOURCE_WORKFLOW]: handle,
  [HOURLY_WORKFLOW]: handleHourly
});

export const metaCampaignSyncSweeper = inngest.createFunction(
  { id: "meta-campaign-sync-sweeper", name: "Meta campaign sync sweeper" },
  { cron: SWEEP_CRON },
  () => sweep()
);

export const metaCampaignSyncHourly = inngest.createFunction(
  { id: "meta-campaign-sync-hourly", name: "Meta campaign sync, hourly 3-day pass" },
  { cron: HOURLY_CRON },
  () => sweep({ pass: "hourly" })
);

export default sweep;
