// The four hourly shifts: which scheduled function runs which beat.
//
// WHY SHIFTS (ops/workflows/hourly-beats-capacity-2026-10-14.md, fixes 3 and 4). One run gives the beats three read
// boxes for 13 s (39 s of box time) inside a 22 s run, and Netlify cuts the function at about 30 s. 26 beats already
// used 23 to 30 s of that box time, and with 120 ms of network delay per round trip 8 of them were cut. So on
// 2026-10-20 the beats were split in two. On 2026-10-21 there were 43 beats: about 67 s of box time in a normal run
// and about 114 s with 120 ms added per round trip. Three shifts (117 s) cannot hold the delayed run, so there are
// four, a quarter hour apart (156 s):
//
//   pulse-hourly     minute 7    netlify/functions/pulse-hourly.mjs
//   pulse-hourly-d   minute 22   netlify/functions/pulse-hourly-d.mjs
//   pulse-hourly-b   minute 37   netlify/functions/pulse-hourly-b.mjs
//   pulse-hourly-c   minute 52   netlify/functions/pulse-hourly-c.mjs
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
// cause in one shift (see below). A beat whose file has not landed yet waits on PENDING_SHIFT_BEATS with the shift
// it will join; when its file lands, move its id from there into that shift (the test says so if you forget).
//
// WHY THE TEXTS STAY ONE PER BREAK. Incidents, damping and the 50-minute claim are per beat (src/pulse/alerts.mjs),
// and decide() looks only at the results of the run in front of it. A beat lives in one shift, so exactly one run
// an hour reads and writes its incident, as before; the other shifts never close, claim or re-text it. Beats that
// fail from one shared cause, or guard the same door, sit in the same shift, so one cause is still one text:
//   - text-path, email-path, vendor-keys, message-health: the message templates, the send keys and the queue;
//   - apply-links, bank-links, bank-outreach: the bank links (apply-links is the one that needs the saved list);
//   - lead-pipe, lead-handoff, call-bookings: the lead pipe and what follows it;
//   - money-checkout, checkout-doors, pay-links, pay-webhook: the checkout doors and the pay links;
//   - money-funding, funding-trip, partner-trip, partner-pages: the funding and partner money and pages (they share
//     pipeline-cards, read/affiliates and partners/approve);
//   - soft-pull, roadmap-delivery, roadmap-pages: the roadmap buyer's pull, pack and pages;
//   - auth-links, client-portal: signing in and the portal behind it;
//   - pipeline-boards, pipeline-facts: the pipeline cards and the facts they follow;
//   - repair-trip, inquiry-trip: the repair and inquiry trips.
// No deep check runs in two beats today, so no single check can go red in two shifts.
//
// The one case that can text from more than one shift: the whole database down. With no database there is no saved
// state for the runs to share, so each shift says so in its own run (the runner already texts every hour then).
//
// THE BALANCE (2026-10-21, balanced by time, not by count). Box time = the sum of each beat's own time; each shift
// has 3 boxes x 13 s = 39 s. The Mac's load average was 100 to 280 from other sessions, so Mac timings are noisy.
// "Normal" uses, for a beat that is live, its live p90 (pulse_beats, last 24 hours); for a beat not live yet, the
// time its builder measured on an unloaded Mac (or the Mac's own plain median when that was higher). "Delay" is this
// Mac with --read-delay=120. "Window" is when the shift's last beat would end with 3 workers taking the beats in list
// order (pipeline-boards left out of the delayed window: see below).
//                    normal             delay              window normal / delay
//   pulse-hourly     18.3 s (47%), 9    27.2 s (70%)       6.7 s / 9.1 s
//   pulse-hourly-b   18.3 s (47%), 12   29.5 s (76%)       6.6 s / 10.3 s
//   pulse-hourly-c   12.3 s (31%), 11   28.0 s (72%)       4.4 s / 10.2 s
//   pulse-hourly-d   17.6 s (45%), 11   29.2 s (75%)       6.6 s / 6.2 s
// Every shift is under 50% normal, and has about 20 s free for the next beats. pipeline-boards makes about 25 reads,
// so 120 ms per round trip adds about 9 s on its own: it reaches its own 10 s deadline in the delayed proof in any
// shift. That is the beat's read count, not the shift.
//
// NO IMPORTS. The 5-minute instant watch reads SHIFT_JOBS to check every shift left a fresh receipt.

export const SHIFTS = Object.freeze({
  "pulse-hourly": Object.freeze({
    cron: "7 * * * *",
    beats: Object.freeze([
      "apply-links",
      "bank-links",
      "bank-outreach",
      "funding-trip",
      "money-funding",
      "money-operations",
      "money-tasks",
      "partner-pages",
      "partner-trip"
    ])
  }),
  "pulse-hourly-b": Object.freeze({
    cron: "37 * * * *",
    beats: Object.freeze([
      "auth-links",
      "call-bookings",
      "checkout-doors",
      "client-portal",
      "consent-capture",
      "db-health",
      "lead-handoff",
      "lead-pipe",
      "money-alerts",
      "money-checkout",
      "pay-links",
      "pay-webhook"
    ])
  }),
  "pulse-hourly-c": Object.freeze({
    cron: "52 * * * *",
    beats: Object.freeze([
      "blueprint-delivery",
      "built-funnels",
      "contract-signing",
      "email-path",
      "inquiry-trip",
      "message-health",
      "native-push",
      "repair-trip",
      "text-path",
      "vendor-keys",
      "whop-billing"
    ])
  }),
  "pulse-hourly-d": Object.freeze({
    cron: "22 * * * *",
    beats: Object.freeze([
      "brief-link",
      "customer-records",
      "doors-live",
      "engine-alive",
      "invoice-checkout-retirement",
      "invoice-notice-recovery",
      "pipeline-boards",
      "pipeline-facts",
      "roadmap-delivery",
      "roadmap-pages",
      "soft-pull"
    ])
  })
});

/**
 * Beats whose files have not landed yet, and the shift each will join: { "<beat id>": "<shift job>" }. NOT RUN and
 * not counted: a shift may only name a beat that is on BEAT_FILES. When a file lands, move its id from here into that
 * shift. shiftProblems() names the shift to use if a pending beat lands with no shift, and fails if an id is in both.
 * Empty today: the six W7 beats that waited here landed on 2026-10-21 and are in their shifts.
 */
export const PENDING_SHIFT_BEATS = Object.freeze({});

/** The scheduled functions that run a shift: A, B, C, D (D runs at minute 22). Each is a job in src/pulse/heartbeats.mjs. */
export const SHIFT_JOBS = Object.freeze(Object.keys(SHIFTS));

/** The beat ids one scheduled function runs. Throws on a job that has no shift, so a typo cannot run nothing quietly. */
export function shiftBeats(job) {
  const shift = Object.prototype.hasOwnProperty.call(SHIFTS, job) ? SHIFTS[job] : null;
  if (!shift) throw new Error(`no hourly shift is named "${String(job).slice(0, 40)}"`);
  return shift.beats;
}

/**
 * What is wrong with the shift lists for this beat list. [] means every beat is in exactly one shift, no shift is
 * empty, no shift names a beat that is not on the list, and the pending list only names shifts that exist and beats
 * that are not in a shift yet.
 *
 * @param {string[]} beatIds   the ids of every beat on BEAT_FILES
 * @param {object}   [shifts]  default SHIFTS
 * @param {object}   [pending] default PENDING_SHIFT_BEATS
 */
export function shiftProblems(beatIds, shifts = SHIFTS, pending = PENDING_SHIFT_BEATS) {
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
  for (const [id, job] of Object.entries(pending || {})) {
    if (!Object.prototype.hasOwnProperty.call(shifts, job)) problems.push(`pending beat "${id}" waits for shift ${job}, which does not exist`);
    if (owners.has(id)) problems.push(`beat "${id}" is in shift ${owners.get(id).join(", ")} and still on PENDING_SHIFT_BEATS: remove it from the pending list`);
  }
  for (const id of beatIds) {
    const jobs = owners.get(id) || [];
    const planned = pending && Object.prototype.hasOwnProperty.call(pending, id) ? pending[id] : null;
    if (jobs.length === 0) {
      problems.push(planned
        ? `beat "${id}" has landed but is still pending, so it would never run: move it from PENDING_SHIFT_BEATS into shift ${planned} in src/pulse/beats/shifts.mjs`
        : `beat "${id}" is in no shift, so it would never run: add it to one shift in src/pulse/beats/shifts.mjs`);
    }
    if (jobs.length > 1) problems.push(`beat "${id}" is in ${jobs.length} shifts (${jobs.join(", ")}), so it would run twice an hour`);
  }
  return problems;
}
