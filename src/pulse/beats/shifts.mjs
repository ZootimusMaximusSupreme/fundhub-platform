// The two hourly shifts: which scheduled function runs which beat.
//
// WHY TWO (ops/workflows/hourly-beats-capacity-2026-10-14.md, fix 3). One run gives the beats three read boxes for
// 13 s (39 s of box time) inside a 22 s run, and Netlify cuts the function at about 30 s. 26 beats already used
// 23 to 30 s of that box time, and with 120 ms of network delay per round trip 8 of them were cut. About 12 more
// beat groups are on the way. So the beats are split between two scheduled functions, 30 minutes apart:
//
//   pulse-hourly     minute 7    netlify/functions/pulse-hourly.mjs
//   pulse-hourly-b   minute 37   netlify/functions/pulse-hourly-b.mjs
//
// Each one runs the SAME runner (src/pulse/runner.mjs) with `only` set to its own list below: the same three
// READ ONLY boxes, the same GET and HEAD probe, the same texting hours, the same incident record. Every beat still
// runs once an hour, and gets the whole 13 s beat window and 22 s run budget of its own shift.
//
// THE RULE. Every beat on BEAT_FILES (./index.mjs) is in exactly one shift. shifts.test.mjs fails when a beat is in
// no shift (it would never run), in two (it would run, and could text, twice an hour), or when a shift names a beat
// that is not on the list (that shift would run nothing: runPulse refuses an unknown id). `npm run pulse:prove --
// --beats` checks the same thing from the built bundle, then runs each shift inside its own budget.
//
// ADDING A BEAT. Append it to BEAT_FILES as before, then add its id to the shift with more room. The prove prints
// each shift's box time ("box time used"); put the beat where the most is left. Keep beats that break from one
// cause in one shift (see below).
//
// WHY THE TEXTS STAY ONE PER BREAK. Incidents, damping and the 50-minute claim are per beat (src/pulse/alerts.mjs),
// and decide() looks only at the results of the run in front of it. A beat lives in one shift, so exactly one run
// an hour reads and writes its incident, as before; the other shift never closes, claims or re-texts it. Beats that
// fail from one shared cause, or guard the same door, sit in the same shift, so one cause is still one text:
//   - text-path, email-path, vendor-keys: the message templates and the send keys;
//   - apply-links, bank-links, bank-outreach: the bank links (apply-links is the one that needs the saved list);
//   - lead-pipe, lead-handoff: the lead pipe and what follows it;
//   - money-checkout, checkout-doors, pay-links, pay-webhook: the checkout doors and the pay links;
//   - money-funding, funding-trip, partner-trip: the funding and partner money (they share pipeline-cards and
//     read/affiliates; money-funding and apply-links share the client control panel).
// No deep check runs in two beats today, so no single check can go red in both shifts.
//
// The one case that can text from both: the whole database down. With no database there is no saved state for the
// two runs to share, so each shift says so in its own run (the runner already texts every hour then, with no state).
//
// THE BALANCE (measured 2026-10-20, balanced by time, not by count). Box time = the sum of each beat's own time;
// each shift has 3 boxes x 13 s = 39 s.
//   live estimate   from the live hourly runs' own times (pulse_beats, last 24 hours, p90), plus the Mac's time for
//                   the five beats not live yet: pulse-hourly about 18 s (47%), pulse-hourly-b about 16 s (41%).
//   Mac prove       `npm run pulse:prove -- --beats`, 3 runs: pulse-hourly 13 to 17 s (33 to 45%), run 6 to 8 s of
//                   22 s; pulse-hourly-b 10 to 14 s (26 to 35%), run 4 to 6 s.
//   Mac, 120 ms     `--read-delay=120`, 2 runs: pulse-hourly 23 to 25 s (60 to 64%), pulse-hourly-b 27 to 28 s
//                   (69 to 72%), no beat cut. One run holding all 26 cut 8 beats at the same delay.
// Each shift has about 20 s free: room for the ~12 beat groups on the way (about 15 to 25 s more in all).
//
// NO IMPORTS. The 5-minute instant watch reads SHIFT_JOBS to check both shifts left a fresh receipt.

export const SHIFTS = Object.freeze({
  "pulse-hourly": Object.freeze({
    cron: "7 * * * *",
    beats: Object.freeze([
      "apply-links",
      "bank-links",
      "bank-outreach",
      "db-health",
      "engine-alive",
      "funding-trip",
      "money-funding",
      "money-operations",
      "native-push",
      "partner-trip"
    ])
  }),
  "pulse-hourly-b": Object.freeze({
    cron: "37 * * * *",
    beats: Object.freeze([
      "auth-links",
      "blueprint-delivery",
      "brief-link",
      "checkout-doors",
      "doors-live",
      "email-path",
      "invoice-checkout-retirement",
      "invoice-notice-recovery",
      "lead-handoff",
      "lead-pipe",
      "money-checkout",
      "pay-links",
      "pay-webhook",
      "text-path",
      "vendor-keys",
      "whop-billing"
    ])
  })
});

/** The scheduled functions that run a shift, in schedule order. Each is a job in src/pulse/heartbeats.mjs. */
export const SHIFT_JOBS = Object.freeze(Object.keys(SHIFTS));

/** The beat ids one scheduled function runs. Throws on a job that has no shift, so a typo cannot run nothing quietly. */
export function shiftBeats(job) {
  const shift = Object.prototype.hasOwnProperty.call(SHIFTS, job) ? SHIFTS[job] : null;
  if (!shift) throw new Error(`no hourly shift is named "${String(job).slice(0, 40)}"`);
  return shift.beats;
}

/**
 * What is wrong with the shift lists for this beat list. [] means every beat is in exactly one shift, no shift is
 * empty, and no shift names a beat that is not on the list.
 *
 * @param {string[]} beatIds  the ids of every beat on BEAT_FILES
 * @param {object}   [shifts] default SHIFTS
 */
export function shiftProblems(beatIds, shifts = SHIFTS) {
  const problems = [];
  const known = new Set(beatIds);
  const owners = new Map();
  for (const [job, shift] of Object.entries(shifts)) {
    const beats = Array.isArray(shift?.beats) ? shift.beats : [];
    if (!beats.length) problems.push(`shift ${job} runs no beat`);
    const inThisShift = new Set();
    for (const id of beats) {
      if (inThisShift.has(id)) problems.push(`beat "${id}" is listed twice in shift ${job}`);
      inThisShift.add(id);
      if (!known.has(id)) problems.push(`shift ${job} names beat "${id}", which is not on BEAT_FILES (that shift would run nothing)`);
      if (!owners.has(id)) owners.set(id, []);
      if (!owners.get(id).includes(job)) owners.get(id).push(job);
    }
  }
  for (const id of beatIds) {
    const jobs = owners.get(id) || [];
    if (jobs.length === 0) problems.push(`beat "${id}" is in no shift, so it would never run: add it to one shift in src/pulse/beats/shifts.mjs`);
    if (jobs.length > 1) problems.push(`beat "${id}" is in ${jobs.length} shifts (${jobs.join(", ")}), so it would run twice an hour`);
  }
  return problems;
}
