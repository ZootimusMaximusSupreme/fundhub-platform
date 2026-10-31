// Customer send hours (owner-set 2026-10-31, .ai/rules/owner-calls-settled.md).
//
// Chris: "9 to 5 my time." Three kinds of customer message:
//
//   instant  — tied to something the person just did (they typed their info,
//              they booked). Goes out right away at any hour, even midnight.
//   drip     — a follow-up sequence. Goes out only from 9 a.m. to 5 p.m.
//              Arizona time, text and email both. One that comes due outside
//              that window waits for 9 a.m.
//   standard — everything else keeps the rules it had before this call: texts
//              8 a.m. to 8 p.m. Arizona, email any hour. The 24-hour and 2-hour
//              call reminders live here on purpose: holding a reminder for a
//              9 a.m. call until 9 a.m. would put it after the call.
//
// One clock for everybody. No per-person time zones (owner-set, same call).
//
// The lists name template keys, not workflows, because the dispatcher only ever
// sees a queued row and its key. A key that is on neither list is standard.

export const SEND_WINDOW_TZ = "America/Phoenix";
export const DRIP_START_HOUR = 9;
export const DRIP_END_HOUR = 17;
/* Workflows plan a drip no later than 4:50 p.m. (16:50, so 4:50:59 at the latest).
   The sender sweeps every 5 minutes and its last pass inside the window is 4:55. A
   drip written after that pass is swept at 5:00, held to 9 a.m., and goes out
   without the workflow's own "did they book or reply?" check, which runs only at
   the planned moment. The workflow writes the row a little after it wakes (its
   checks run first), so a drip planned at 4:55, or at 4:55:59, missed the 4:55
   pass. Planned by 4:50 it is written before 4:55 and that pass sends it. */
export const DRIP_LAST_PLAN_MINUTE = 16 * 60 + 50;

/** Sent the moment the person acts, at any hour. */
export const INSTANT_TEMPLATE_KEYS = new Set([
  // S-00: they just typed their name, email and phone.
  "SMS-S00-WELCOME",
  "EMAIL-S00-WELCOME",
  // S-04B: they just booked, or just moved their call.
  "SMS-S04-01-CONFIRM",
  "EMAIL-S04-01-CONFIRM"
]);

/** Follow-up sequences: 9 a.m. to 5 p.m. Arizona only. */
export const DRIP_TEMPLATE_KEYS = new Set([
  // S-02: started the survey and stopped.
  "SMS-S02-RESUME-1", "EMAIL-S02-RESUME-1",
  "SMS-S02-RESUME-2", "EMAIL-S02-RESUME-2",
  "SMS-S02-RESUME-3", "EMAIL-S02-RESUME-3",
  "EMAIL-S02-FINISH-APPLICATION",
  // S-NOBOOK: finished the survey, no call booked.
  "SMS-NOBOOK-01", "SMS-NOBOOK-02", "SMS-NOBOOK-03",
  "EMAIL-NOBOOK-01", "EMAIL-NOBOOK-02", "EMAIL-NOBOOK-03",
  // AI-SET-03: the setter called and nobody answered.
  "SMS-AISET03-MSG1", "SMS-AISET03-MSG2", "SMS-AISET03-MSG3",
  "SMS-AISET03-OPTIN-1", "SMS-AISET03-OPTIN-2", "SMS-AISET03-OPTIN-3",
  // S-05A: missed the call.
  "EMAIL-S05A-NOSHOW-RECOVERY", "SMS-S05A-NOSHOW-RECOVERY",
  "EMAIL-S05A-NOSHOW-02", "SMS-S05A-NOSHOW-02",
  "EMAIL-S05A-NOSHOW-03", "SMS-S05A-NOSHOW-03",
  "EMAIL-S05A-NOSHOW-04", "SMS-S05A-NOSHOW-04",
  // BS-01: the one real pre-call text in the booked-call sequence.
  "SMS-BS01-02-PRECALL"
]);

/** "instant" | "drip" | "standard" for a template key. */
export function sendTiming(templateKey) {
  const key = String(templateKey || "");
  if (INSTANT_TEMPLATE_KEYS.has(key)) return "instant";
  if (DRIP_TEMPLATE_KEYS.has(key)) return "drip";
  return "standard";
}

/* tzOffsetMs — how far the named zone is from UTC at this instant.
   Read out of Intl rather than hardcoded, so daylight saving is the operating
   system's timezone database's problem and not this file's. */
export function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - date.getTime();
}

/* nextHourStrike — the next instant at which `hour`:00 strikes in `timeZone`:
   today if the wall clock there has not reached that hour yet, else tomorrow.

   Built by reading the wall clock in that zone, choosing today or tomorrow, and
   converting back. The offset is applied twice because the offset at the target
   instant is not always the offset now — on the two daylight-saving nights a
   year they differ by an hour, and a single pass would land an hour off.
   (Moved here from src/messaging/dispatch.mjs, where nextQuietHoursEnd still
   wraps it, so the quiet-hours wake and the drip wake are one function.) */
export function nextHourStrike(from, timeZone, hour) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit"
  }).formatToParts(from);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const now = +p.hour % 24;

  // Date.UTC normalises a day past the month's end.
  const dayShift = now < hour ? 0 : 1;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day + dayShift, hour, 0, 0);

  let ts = wall;
  for (let i = 0; i < 2; i += 1) ts = wall - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

function hourIn(date, timeZone) {
  const raw = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false })
    .formatToParts(date).find((p) => p.type === "hour")?.value;
  const hour = Number(raw);
  // Unreadable clock: throw, so a gate that calls this blocks rather than sends.
  if (!Number.isInteger(hour)) throw new Error(`send-window: could not read the hour in ${timeZone}`);
  return hour % 24;
}

/** True from 09:00:00 up to (not including) 17:00:00 Arizona time. */
export function inDripWindow(date, timeZone = SEND_WINDOW_TZ) {
  const hour = hourIn(date, timeZone);
  return hour >= DRIP_START_HOUR && hour < DRIP_END_HOUR;
}

/** The next 9:00 a.m. Arizona after `date` (today's if it is still before 9). */
export function nextDripWindowOpen(date, timeZone = SEND_WINDOW_TZ) {
  return nextHourStrike(date, timeZone, DRIP_START_HOUR);
}

function minuteIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hour12: false })
    .formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error(`send-window: could not read the time in ${timeZone}`);
  return hour * 60 + minute;
}

/** When a drip due at `date` really goes out: `date` itself from 9:00 to 4:50:59 p.m.
    Arizona, else the next 9:00 a.m. Arizona. Workflows use this to space their
    touches by the day a message really lands, not the day it was due, and sleep
    until it before they check and send. */
export function dripSendTime(date, timeZone = SEND_WINDOW_TZ) {
  const at = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(at.getTime())) throw new Error("send-window: dripSendTime needs a real date");
  const minute = minuteIn(at, timeZone);
  return minute >= DRIP_START_HOUR * 60 && minute <= DRIP_LAST_PLAN_MINUTE ? at : nextDripWindowOpen(at, timeZone);
}
