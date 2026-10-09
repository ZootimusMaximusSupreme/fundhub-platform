// Texting hours: every text and buzz to Chris's own phone goes out only from 6:00 a.m. to 10:00 p.m. Arizona time.
//
// Owner law 2026-10-09 (.claude/rules/texting-hours.md): "Any texting for me is from 6 a.m. to 10 p.m. Mountain
// Standard Time, 100%." Mountain Standard Time is Arizona time, the clock the rest of the app calls America/Phoenix.
// Arizona is UTC-7 all year (no daylight time), so the window is fixed in UTC too: 13:00:00 up to 05:00:00 the next
// day. The math below uses that fixed offset and never the machine's own time zone, so a laptop set to New York
// or a server set to UTC gets the same answer.
//
// ONE RULE, ONE FUNCTION. inTextWindow(now) is the only test of the window. Every function that hands a text or a
// buzz for Chris's number to a provider calls it right before the hand-off, so a new caller cannot forget it.
// src/pulse/quiet-hours.test.mjs fails the build when a file that texts Chris's number does not call it.
//
// Outside the window nothing is sent. The sender answers HELD ("held_quiet_hours") so the caller can keep the
// news for the first text of the next window. It is never dropped on purpose.
//
// This file sends nothing and reads nothing.

/** The clock the window is on. Same zone the morning brief and the daily pulse use. */
export const TEXT_TZ = "America/Phoenix";
/** Arizona is seven hours behind UTC all year. */
export const PHOENIX_OFFSET_MS = -7 * 60 * 60 * 1000;
/** 6:00:00 a.m. is in. */
export const WINDOW_START_HOUR = 6;
/** 10:00:00 p.m. is out. */
export const WINDOW_END_HOUR = 22;

/** What a sender answers (as delivery_status, status or reason) when it held a text for the window. */
export const HELD = "held_quiet_hours";
/** The plain words that go with HELD in a log or a saved row. */
export const HELD_REASON = "held: texts to Chris go out only from 6 a.m. to 10 p.m. Arizona time";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A Date, a number of ms, or an ISO string, as ms. Anything unreadable is the real clock right now. */
function toMs(now) {
  if (now === undefined || now === null) return Date.now();
  const ms = now instanceof Date ? now.getTime() : typeof now === "number" ? now : new Date(now).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

/** The Arizona wall clock for a moment: { year, month, day, hour, minute, second }. */
export function phoenixClock(now = new Date()) {
  const d = new Date(toMs(now) + PHOENIX_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds()
  };
}

/** True from 6:00:00 a.m. up to (not including) 10:00:00 p.m. Arizona time. */
export function inTextWindow(now = new Date()) {
  const { hour } = phoenixClock(now);
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/**
 * The first moment a text may go out, as a Date. Inside the window that is `now` itself. Before 6 a.m. it is
 * 6:00:00 a.m. the same Arizona day. From 10 p.m. on it is 6:00:00 a.m. the next Arizona day.
 */
export function nextWindowStart(now = new Date()) {
  const ms = toMs(now);
  if (inTextWindow(ms)) return new Date(ms);
  const local = ms + PHOENIX_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS; // Arizona midnight, on the shifted scale
  const { hour } = phoenixClock(ms);
  const sixLocal = dayStart + WINDOW_START_HOUR * HOUR_MS + (hour >= WINDOW_END_HOUR ? DAY_MS : 0);
  return new Date(sixLocal - PHOENIX_OFFSET_MS);
}

/** "2:07 a.m.", "12:00 p.m.", "10:30 p.m." on the Arizona clock. Plain ASCII. "" for an unreadable time. */
export function phoenixTimeWords(at) {
  if (at === undefined || at === null || at === "") return "";
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime();
  if (!Number.isFinite(ms)) return "";
  const { hour, minute } = phoenixClock(ms);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "a.m." : "p.m."}`;
}
