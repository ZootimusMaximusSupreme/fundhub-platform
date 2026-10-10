// @ts-check
// src/marketing/schedule.mjs — when the weekly batch and the machine's chores happen.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §2 item 1 (scripts every 7 days, at the
// day and time Chris sets, default Monday 7:00 am Arizona), §7.7 (planning 3 hours before
// release_at, a failed plan retried each tick until 24 hours after it, Write now buzzes
// only when Chris is not on the page), §7.2 (a weekly voice export), §7.9 (the nightly
// repo check), §7.4 (week_key = the ISO week of release_at in the settings time zone).
// Plan unit U35.
//
// PURE. No clock (the caller passes `now`), no database, no network. The clock
// (src/marketing/clock.mjs) turns these answers into rows; the batch jobs
// (src/marketing/batch-run.mjs) use the buzz words and the poll time.
//
// nextReleaseAt and weekKey were written by the planner unit (U23) in
// src/marketing/planner.mjs, whose header says U35 may take them over. They are re-
// exported here unchanged, so there is one copy of the time math: Monday 07:00
// America/Phoenix is 14:00 UTC every week (Arizona keeps no daylight time).
//
// READINGS WRITTEN DOWN (the owner was asleep; each is the safe default):
//   * THE VOICE EXPORT runs 5 hours before the release (2 hours before planning), so the
//     pairs Chris made this week are in VOICE.md before the batch pins its rules commit.
//     The spec says only "weekly".
//   * THE NIGHTLY CHORES (the repo check and draft expiry) run once per night, at the
//     first clock tick after 02:00 in the settings time zone (Arizona by default), when
//     nobody is saving. The spec says "nightly" and "runs in the worker".

import { nextReleaseAt, weekKey } from "./planner.mjs";

export { nextReleaseAt, weekKey };

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Planning starts this long before release_at (spec §7.7). */
export const PLAN_LEAD_MS = 3 * HOUR;

/** A failed plan is retried on every tick until this long after release_at (spec §7.7). */
export const PLAN_RETRY_MS = 24 * HOUR;

/** The weekly voice export runs this long before release_at (see the header). */
export const VOICE_EXPORT_LEAD_MS = 5 * HOUR;

/** The nightly chores run from this wall-clock time, in the settings time zone. */
export const NIGHTLY_AT = "02:00";

/** Chris counts as "on the page" when the page_seen heartbeat is newer than this (spec §7.7). */
export const PAGE_SEEN_FRESH_MS = 2 * MINUTE;

/** finish_batch looks again this often while a batch's scripts are still being written. */
export const FINISH_POLL_MS = 30 * 1000;

/** The zone the spec defaults to. */
export const DEFAULT_TZ = "America/Phoenix";

/** A released batch's late drafts are followed up for this long (see clock.mjs followLateDrafts). */
export const LATE_FOLLOW_DAYS = 30;

/**
 * The batch lifecycle's job kinds (src/marketing/job-kinds.mjs registers them; the
 * handlers are in batch-run.mjs, voice-export.mjs and nightly-script-check.mjs).
 * 'start_batch' is also what Write now queues (src/marketing/ideas-store.mjs).
 */
export const BATCH_KINDS = Object.freeze({
  start: "start_batch",
  finish: "finish_batch",
  release: "release_batch",
  expire: "expire_drafts",
  voice: "voice_export",
  nightly: "nightly_script_check",
  write: "write_slot"
});

/** @param {Date|string|number} v @returns {Date} */
function asDate(v) {
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(/** @type {any} */ (v));
  if (Number.isNaN(d.getTime())) throw new TypeError("not a time");
  return d;
}

/** A usable IANA zone, else Arizona. @param {unknown} tz */
export function zoneOf(tz) {
  if (typeof tz === "string" && tz.trim()) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { /* fall through */ }
  }
  return DEFAULT_TZ;
}

/**
 * planWindowStart(releaseAt) → the moment planning may start: 3 hours before release.
 * @param {Date|string|number} releaseAt
 */
export function planWindowStart(releaseAt) {
  return new Date(asDate(releaseAt).getTime() - PLAN_LEAD_MS);
}

/**
 * planRetryUntil(releaseAt) → the last moment a failed plan is retried: 24 hours after release.
 * @param {Date|string|number} releaseAt
 */
export function planRetryUntil(releaseAt) {
  return new Date(asDate(releaseAt).getTime() + PLAN_RETRY_MS);
}

/**
 * voiceExportFrom(releaseAt) → when the week's voice export may be queued.
 * @param {Date|string|number} releaseAt
 */
export function voiceExportFrom(releaseAt) {
  return new Date(asDate(releaseAt).getTime() - VOICE_EXPORT_LEAD_MS);
}

/**
 * The calendar day of `date` in `tz`, "YYYY-MM-DD".
 * @param {Date} date @param {string} tz
 */
export function dayIn(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zoneOf(tz), year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  /** @type {Record<string, string>} */
  const p = {};
  for (const x of parts) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * nightlyDay(settings, now) → the night the chores belong to, "YYYY-MM-DD": the day in
 * the settings zone of (now - 2 hours). From 02:00 on day D it is D; before 02:00 it is
 * still the night before. One run per value, so each night runs once, at the first tick
 * after 02:00.
 * @param {{ timezone?: string|null }|null|undefined} settings
 * @param {Date|string|number} now
 */
export function nightlyDay(settings, now) {
  const [h, m] = NIGHTLY_AT.split(":").map(Number);
  const shifted = new Date(asDate(now).getTime() - (h * HOUR + m * MINUTE));
  return dayIn(shifted, zoneOf(settings && settings.timezone));
}

/**
 * weeklyWindow(settings, now) → everything the clock needs to decide about the weekly
 * batch at this tick:
 *   release_at     the next weekly drop strictly after now
 *   week_key       its ISO week in the settings zone (marketing_batches.week_key)
 *   plan_from      release_at - 3 h
 *   in_plan_window plan_from <= now < release_at: make the batch row and plan it
 *   voice_from     release_at - 5 h
 *   voice_due      voice_from <= now: the week's voice export may be queued
 *   nightly_day    the night the chores belong to
 * @param {any} settings @param {Date|string|number} now
 */
export function weeklyWindow(settings, now) {
  const at = asDate(now);
  const tz = zoneOf(settings && settings.timezone);
  const releaseAt = nextReleaseAt({ ...(settings || {}), timezone: tz }, at);
  const planFrom = planWindowStart(releaseAt);
  const voiceFrom = voiceExportFrom(releaseAt);
  return {
    tz,
    release_at: releaseAt,
    week_key: weekKey(releaseAt, tz),
    plan_from: planFrom,
    in_plan_window: at.getTime() >= planFrom.getTime() && at.getTime() < releaseAt.getTime(),
    voice_from: voiceFrom,
    voice_due: at.getTime() >= voiceFrom.getTime(),
    nightly_day: nightlyDay({ timezone: tz }, at)
  };
}

/**
 * chrisOnPage(lastSeenAt, now) → true when the page_seen heartbeat is 2 minutes old or
 * newer. Unknown (no beat) is "not on the page", so the buzz goes out.
 * @param {Date|string|number|null|undefined} lastSeenAt @param {Date|string|number} now
 */
export function chrisOnPage(lastSeenAt, now) {
  if (lastSeenAt == null || lastSeenAt === "") return false;
  const seen = new Date(/** @type {any} */ (lastSeenAt)).getTime();
  if (!Number.isFinite(seen)) return false;
  return asDate(now).getTime() - seen <= PAGE_SEEN_FRESH_MS;
}

/**
 * The words of the "scripts are ready" buzz, with the real counts (spec §7.7:
 * "18 of 21 ready, 3 failed"). Unknown counts are never shown as 0.
 * @param {{ ready?: unknown, total?: unknown, failed?: unknown }} counts
 */
export function scriptsReadyText({ ready, total, failed }) {
  const n = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.floor(Number(v))));
  const r = n(ready);
  const t = n(total);
  const f = n(failed);
  const head = r != null && t != null ? `Scripts: ${r} of ${t} ready` : r != null ? `Scripts: ${r} ready` : "Scripts are ready";
  return f != null ? `${head}, ${f} failed.` : `${head}.`;
}
