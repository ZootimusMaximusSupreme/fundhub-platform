// The shared walker for the whole-trip checks (coverage batch W8, 2026-10-10, level L4).
//
// THIS IS NOT A LANE. It has no gapChecks, and its name does not start with gap- or slice-, so
// modules.test.mjs does not ask for it on the list. The five trip lanes import it by a plain
// static import, which is how the live bundle packs it.
//
// WHAT A TRIP CHECK IS. One customer starts a trip (pays the diagnostic, buys repair, gets an
// inquiry case, applies as a partner, buys the roadmap). The trip is a short ladder of steps.
// Each lane reads, in one SELECT, what is true for each customer who started in the last 60
// days, and this file walks the ladder and names the FIRST step that is missing.
//
// RED OR NOT, in plain words. A missing step is red only when the company owes it:
//
//   system   a handler or a job owes this step. Red when its clock has run out. The clock starts
//            at the time of the step it follows (`from`) and lasts `graceMs`. Every number comes
//            from a wait a lane already uses; each step names where its number comes from.
//   person   a staff member owes it. Never red from waiting alone, because nobody has written a
//            clock for it. It is red only when the lane hands in a `stall` (a clock the code
//            itself already defines, for example the repair stage clocks in src/repair/sla.mjs).
//   client   the customer owes it (book the call, upload the ID, fill the form). Same rule.
//
// A step can also be `required`: the code makes it impossible for a later step to exist without
// it (a letter cannot be written without a verified ID). A later step with this one missing is red
// at once. And a step can be CLAIMED (the board shows it) with no fact behind it: that is red too.
//
// WHAT IS NEVER RED: a customer waiting on a person or on themselves. Those are counted by step in
// the green line, so a person reading the morning report can see who is waiting and where. When
// Chris writes a clock for a person step (a named setting in the lane), that step can go red.
//
// READ ONLY. Nothing here writes, sends or calls out.

import {
  DAY_MS, HOUR_MS, MIN_MS, ageOf, clip, naRow, plural, row, toDate
} from "./money-reads.mjs";

export { DAY_MS, HOUR_MS, MIN_MS };

export const BY = Object.freeze({ SYSTEM: "system", PERSON: "person", CLIENT: "client" });

/** How many customers a detail line spells out before it says "and N more". */
export const SHOWN = 4;

/** What goes on every suggested fix. The pulse reports; a person fixes. */
export const NO_FIX =
  "The trip check only reads. Do not fix from the pulse. Open the file the step names, find why it did not happen, and fix it there.";

/** "30 minutes", "2 hours", "3 days". */
export function span(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n >= HOUR_MS && n % HOUR_MS === 0 && n < 2 * DAY_MS) return plural(n / HOUR_MS, "hour");
  if (n < 2 * HOUR_MS) return plural(Math.max(1, Math.round(n / MIN_MS)), "minute");
  if (n < 2 * DAY_MS) return plural(Math.round(n / HOUR_MS), "hour");
  return plural(Math.round(n / DAY_MS), "day");
}

/** A time, from a Date or an ISO text. A fact that is just `true` has no time. */
function timeOf(v) {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string" && v.trim() !== "") return toDate(v);
  return null;
}

function has(facts, key) {
  const v = facts ? facts[key] : undefined;
  return v !== undefined && v !== null && v !== false;
}

/**
 * Walk one customer's ladder. Pure.
 *
 *   steps    [{ key, label, by, graceMs?, from?, fromLabel?, required?, source? }] in trip order (a row-picking function is allowed in judgeTrip)
 *            `from` may name a fact that is not a step (an internal anchor); then `fromLabel` is its words.
 *   facts    { [key]: Date | ISO text | true | null, [`${key}:claim`]: truthy }
 *   notOwed  step keys that do not apply to this customer (a repair-only buyer owes no funding card)
 *   ended    { why } when the trip is over for a reason that is not a break (lost, cancelled)
 *   stall    { key?, why } when a clock the code defines says the customer's current step is overdue
 *   detail   { [stepKey]: text } extra words added to the reason when that step is the broken one
 *   defects  [{ key, why }] steps a record shows were done wrongly; broken even when the step is reached
 *
 * Returns { state, step, why, since, doneCount, owedCount, waitingOn }
 *   state "finished" | "ended" | "waiting" | "broken"
 *   step  the step the answer is about: where it is stuck (broken), or what it waits on (waiting)
 */
export function walkTrip({
  steps, facts = {}, now = new Date(), notOwed = [], ended = null, stall = null, detail = {}, defects = []
}) {
  const n = steps.length;
  const skip = steps.map((s) => notOwed.includes(s.key));
  const reached = steps.map((s) => has(facts, s.key));
  const claimed = steps.map((s) => has(facts, `${s.key}:claim`));
  const owedCount = skip.filter((x) => !x).length;
  const doneCount = steps.filter((s, i) => !skip[i] && reached[i]).length;
  const base = { doneCount, owedCount, since: null, waitingOn: null };

  if (ended) {
    return { ...base, state: "ended", step: null, why: String((ended && ended.why) || "the trip ended") };
  }

  const at = (key) => timeOf(facts[key]);
  let furthest = -1;
  for (let i = 0; i < n; i += 1) if (reached[i] || claimed[i]) furthest = i;

  const more = (i) => (detail && detail[steps[i].key] ? `. ${detail[steps[i].key]}` : "");
  const broken = (i, why, since = null) => ({ ...base, state: "broken", step: steps[i], why: `${why}${more(i)}`, since });

  // 1. The board shows a step and nothing backs it.
  for (let i = 0; i < n; i += 1) {
    if (claimed[i] && !reached[i] && !skip[i]) {
      return broken(i, `the board shows "${steps[i].label}" but no record backs it up`);
    }
  }
  // 1b. A record says the step happened WRONGLY (a click credited to nobody, a payment with no
  //     accrual). The step may be reached, and it is still broken.
  for (const d of Array.isArray(defects) ? defects : []) {
    const i = steps.findIndex((s) => s.key === d.key);
    if (i >= 0 && !skip[i]) return broken(i, String(d.why || "the record for this step is wrong"));
  }
  // 2. A step the code cannot skip was skipped.
  for (let i = 0; i < furthest; i += 1) {
    if (!reached[i] && !skip[i] && steps[i].required) {
      return broken(i, `"${steps[furthest].label}" is there, but "${steps[i].label}" never happened`);
    }
  }
  // 3. A step the company owes has run out of time. Every missing system step is judged, not
  //    only the first missing one, because a late hand-off can sit behind a client step.
  for (let i = 0; i < n; i += 1) {
    const s = steps[i];
    if (skip[i] || reached[i] || s.by !== BY.SYSTEM) continue;
    let anchor = s.from;
    if (!anchor) {
      for (let j = i - 1; j >= 0; j -= 1) {
        if (reached[j] && !skip[j]) { anchor = steps[j].key; break; }
      }
    }
    if (!anchor || !has(facts, anchor)) continue;
    const anchorAt = at(anchor);
    if (!anchorAt || s.graceMs == null) continue;
    const label = s.fromLabel || (steps.find((x) => x.key === anchor) || { label: anchor }).label;
    if (now.getTime() - anchorAt.getTime() > s.graceMs) {
      return broken(
        i,
        `"${label}" was ${ageOf(anchorAt, now)} ago and "${s.label}" is owed within ${span(s.graceMs)} of it`,
        anchorAt
      );
    }
  }
  // 4. A clock the code defines on the customer's current step. `stall.key` names the step; with
  //    no key it is the first step missing after the furthest one reached (where the file sits).
  if (stall) {
    let lastDone = -1;
    for (let i = 0; i < n; i += 1) if (reached[i] && !skip[i]) lastDone = i;
    let i = -1;
    if (stall.key) i = steps.findIndex((s) => s.key === stall.key);
    else for (let j = lastDone + 1; j < n; j += 1) { if (!skip[j] && !reached[j]) { i = j; break; } }
    if (i >= 0 && !skip[i] && !reached[i]) return broken(i, String(stall.why || "the step is past its clock"));
  }

  // Nothing is broken. What is the next step after the furthest one reached, and who owes it? A
  // step before the furthest one that is not required was skipped on the way and is not waited on.
  let lastReached = -1;
  for (let i = 0; i < n; i += 1) if (reached[i] && !skip[i]) lastReached = i;
  for (let i = lastReached + 1; i < n; i += 1) {
    if (skip[i] || reached[i]) continue;
    const who = steps[i].by === BY.SYSTEM ? "the system" : steps[i].by === BY.CLIENT ? "the customer" : "a person";
    return { ...base, state: "waiting", step: steps[i], why: `waiting on ${who} for "${steps[i].label}"`, waitingOn: steps[i] };
  }
  return { ...base, state: "finished", step: null, why: "every step the company and the customer owe is done" };
}

/** The words for a customer in a list: client code, or the first 8 of an id. */
export function whoIs(r) {
  const code = r && r.client_code ? String(r.client_code).trim() : "";
  if (code) return code;
  const id = r && (r.client_id || r.id) ? String(r.client_id || r.id) : "";
  return id ? id.slice(0, 8) : "an unknown customer";
}

function listed(items, shown = SHOWN) {
  const head = items.slice(0, shown).join("; ");
  const more = items.length > shown ? `; and ${items.length - shown} more` : "";
  return head + more;
}

/**
 * The verdict for one trip. Pure.
 *
 *   rows    [{ who, facts, notOwed?, ended?, stall?, detail? }] one per customer who started in the window
 *   cap     the SELECT's row cap, so a full list says "first N"
 */
export function judgeTrip({
  id, tripName, steps, rows = [], now = new Date(), windowDays = 60, cap = null, fix = NO_FIX, what = "customer",
  note = "", orgId = null
}) {
  if (!rows.length) {
    // The company id rides in the proof so the audit's re-check is one cheap read, not two.
    const args = { check: id, count: 0, min: 1, what: `${tripName} trips started`, days: windowDays };
    if (orgId) args.org = String(orgId);
    return naRow(
      id,
      "low-traffic",
      args,
      `Nobody started the ${tripName} trip in the last ${windowDays} days, so there is no trip to follow. Judged the day one starts.`
    );
  }
  const walks = rows.map((r) => ({
    r,
    w: walkTrip({
      steps: typeof steps === "function" ? steps(r) : steps,
      facts: r.facts, now, notOwed: r.notOwed || [], ended: r.ended || null, stall: r.stall || null,
      detail: r.detail || {}, defects: r.defects || []
    })
  }));
  const broken = walks.filter((x) => x.w.state === "broken");
  const finished = walks.filter((x) => x.w.state === "finished").length;
  const ended = walks.filter((x) => x.w.state === "ended").length;
  const waiting = walks.filter((x) => x.w.state === "waiting");
  const total = rows.length;
  const capNote = cap && total >= cap ? ` (the first ${cap}, oldest first)` : "";

  if (broken.length) {
    const lines = broken.map(({ r, w }) => `${r.who || whoIs(r)} stopped at "${w.step.label}": ${w.why}`);
    return row(
      id,
      "FAIL",
      `${broken.length} of ${plural(total, what)} who started the ${tripName} trip in the last ${windowDays} days ${broken.length === 1 ? "is" : "are"} stuck${capNote}. ${listed(lines)}.${note ? ` ${note}` : ""}`,
      fix
    );
  }

  const byStep = new Map();
  for (const { w } of waiting) {
    const k = w.waitingOn ? w.waitingOn.label : "an unknown step";
    byStep.set(k, (byStep.get(k) || 0) + 1);
  }
  const waitText = waiting.length
    ? `${waiting.length} waiting (${[...byStep].map(([k, v]) => `${v} at "${k}"`).join(", ")})`
    : "0 waiting";
  return row(
    id,
    "PASS",
    `${plural(total, what)} started the ${tripName} trip in the last ${windowDays} days${capNote}: ${finished} finished, ${waitText}, ${ended} ended. None is stuck on a step the company owes.${note ? ` ${note}` : ""}`
  );
}

/**
 * The audit calls naVerify["low-traffic"] to prove a "nothing to judge" row again. It is true only
 * while the same read still finds no customer on the trip. A read that cannot run answers false.
 *
 *   countStarted(run, orgId, now) -> number of customers who started the trip in the window. It runs
 *                                    one light SELECT (the facts that decide who started, nothing else):
 *                                    the audit gives all its re-checks 2.5 seconds together.
 */
export function makeNaVerify({ id, countStarted, runnerOf, nowOf, defaultOrg }) {
  return Object.freeze({
    "low-traffic": async (args, ctx = {}) => {
      if (!args || args.check !== id) return false;
      const run = runnerOf(ctx);
      if (!run) return false;
      const orgId = ctx.orgId || (typeof args.org === "string" && args.org) || (await defaultOrg(run));
      if (!orgId) return false;
      try {
        const n = await countStarted(run, orgId, nowOf(ctx));
        return Number.isFinite(n) && n < 1;
      } catch {
        return false;
      }
    }
  });
}

/** One org id when the run has none: the default org, the way gap-checkout reads it. */
export async function defaultOrg(run) {
  try {
    const out = await run((tx) => tx.query("SELECT id FROM orgs WHERE is_default LIMIT 1"));
    return out && out.rows && out.rows[0] ? String(out.rows[0].id) : null;
  } catch {
    return null;
  }
}

/** A short plain reason for a skip row. */
export function skipRow(id, why) {
  return row(id, "skip", clip(why, 300));
}

/** The test-client test, pasted into a SELECT. `alias` is the clients row; `param` holds the regex. */
export function realClientSql(alias, param) {
  return `COALESCE(${alias}.is_demo, false) = false
     AND COALESCE(${alias}.custom_fields ->> 'synthetic', '') <> 'true'
     AND COALESCE(${alias}.email, '') !~* ${param}::text
     AND (${alias}.custom_fields ->> 'crm_archived_at') IS NULL`;
}
