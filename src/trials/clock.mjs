// The seven-day clock.
//
// THE CLOCK STARTS AT THE FIRST AD IMPRESSION, NOT AT CHECKOUT. That is the one
// rule this file exists to hold. A buyer who pays on Friday and whose ads clear
// platform review on Monday gets seven days from Monday. Starting the clock at
// checkout would sell seven days and deliver three, and the part that got eaten
// is the part FundHub does not control.
//
// A HELD-START TRIAL HAS NO CLOCK AT ALL. Meta will not run a money-related ad
// from a business that is not verified, and verification is not FundHub's
// system. So when verification is pending the $297 still buys the branded
// funnel and the built ad set — real value, delivered on day 0 — and the seven
// days simply have not begun. startedAt is NULL, and NULL means unknown and
// must survive: it is never defaulted to "now" to make a screen easier to draw.
//
// PURE FUNCTIONS, NO DATABASE, NO CLOCK OF THEIR OWN. Every function takes
// `now` so the day boundaries are testable without waiting a week.

import { TRIAL_DAYS, FREEZE_DAYS, TRIAL_STATUS } from "./constants.mjs";

const DAY_MS = 86400000;

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** startClock(firstImpressionAt) → { startsAt, endsAt } | null.

    Returns null when there has been no impression yet. The caller writes NULL,
    it does not invent a start. */
export function startClock(firstImpressionAt, { days = TRIAL_DAYS } = {}) {
  const start = toDate(firstImpressionAt);
  if (!start) return null;
  return { startsAt: start, endsAt: new Date(start.getTime() + days * DAY_MS) };
}

/** trialDayIndex(now, startsAt) → 1-based live day, or null when unstarted.

    Day 1 is the first 24 hours after the first impression. Day 8 is the
    conversion call and is reachable — the index is not clamped at TRIAL_DAYS,
    because "day 9 and nobody has called them" is a fact the screen needs. */
export function trialDayIndex(now, startsAt) {
  const start = toDate(startsAt);
  const at = toDate(now);
  if (!start || !at) return null;
  const elapsed = at.getTime() - start.getTime();
  if (elapsed < 0) return null;
  return Math.floor(elapsed / DAY_MS) + 1;
}

/** daysRemaining(now, startsAt) → whole days left in the seven, floored at 0. */
export function daysRemaining(now, startsAt, { days = TRIAL_DAYS } = {}) {
  const index = trialDayIndex(now, startsAt);
  if (index == null) return null;
  return Math.max(0, days - index + 1);
}

/** hasEnded — true once the seventh live day is complete. */
export function hasEnded(now, startsAt, { days = TRIAL_DAYS } = {}) {
  const clock = startClock(startsAt, { days });
  const at = toDate(now);
  if (!clock || !at) return false;
  return at.getTime() >= clock.endsAt.getTime();
}

/** frozenUntil(endsAt) → the moment the read-only dashboard stops being
    readable. Thirty days after the trial ends, per §6.5. */
export function frozenUntil(endsAt, { days = FREEZE_DAYS } = {}) {
  const end = toDate(endsAt);
  if (!end) return null;
  return new Date(end.getTime() + days * DAY_MS);
}

/** conversionWindow(endsAt) → when the day-8 call is due, and how long the
    $297 stays creditable. Both are derived, never stored twice. */
export function conversionWindow(endsAt, { creditDays = 30 } = {}) {
  const end = toDate(endsAt);
  if (!end) return null;
  return {
    dueAt: end,
    creditExpiresAt: new Date(end.getTime() + creditDays * DAY_MS)
  };
}

/* THE DAY PLAN, from W4 §4.1. It is data rather than prose because the
   dashboard renders it and the day-3 and day-4 human steps have to be visible
   to the person who owes them. `human` marks a step a FundHub person performs;
   nothing here is automated on the buyer's behalf that a human is meant to do. */
export const DAY_PLAN = Object.freeze([
  { day: 1, title: "First spend, first clicks, first leads", human: false,
    detail: "Booking capture is live. Every lead is tagged to you from the first click." },
  { day: 2, title: "First optimisation pass", human: false,
    detail: "Budget shifts toward whichever ad set is working." },
  { day: 3, title: "Mid-trial check", human: true,
    detail: "A Fundhub person checks that spend is flowing, nothing is blocked, and the funnel looks right." },
  { day: 4, title: "Creative refresh if the first set is tiring", human: true,
    detail: "New assets are generated automatically and approved by a named human before they run." },
  { day: 5, title: "Fundhub starts fulfilling", human: true,
    detail: "Any lead that booked is worked by the real team. This is the day it stops being a demo." },
  { day: 6, title: "Nothing new", human: false,
    detail: "The numbers are the pitch now." },
  { day: 7, title: "Trial ends at the end of the seventh live day", human: false,
    detail: "The dashboard freezes and stays readable for 30 days." },
  { day: 8, title: "The conversion call", human: true,
    detail: "Join, or keep every lead and get paid as an affiliate on the ones Fundhub closes." }
]);

/** phaseFor(status, now, startsAt) → a plain-language phase for the screen.

    Deliberately not a re-derivation of `status`: status is what the database
    records, phase is what the buyer is living through. A trial can be `running`
    in the database and in its "final day" phase on the screen. */
export function phaseFor(status, now, startsAt) {
  const s = String(status || "");
  if (s === TRIAL_STATUS.HELD_START) return "held_start";
  if (s === TRIAL_STATUS.CONVERTED) return "converted";
  if (s === TRIAL_STATUS.DECLINED) return "declined";
  if (s === TRIAL_STATUS.REFUNDED) return "refunded";
  if (s === TRIAL_STATUS.PROVISIONED || !startsAt) return "waiting_for_first_impression";
  const index = trialDayIndex(now, startsAt);
  if (index == null) return "waiting_for_first_impression";
  if (index > TRIAL_DAYS) return "conversion_call";
  if (index === TRIAL_DAYS) return "final_day";
  return "running";
}

export default {
  startClock,
  trialDayIndex,
  daysRemaining,
  hasEnded,
  frozenUntil,
  conversionWindow,
  phaseFor,
  DAY_PLAN
};
