// Event workflow rows — zero "not checked", Ship 1 (2026-10-09).
//
// One row per bundled Inngest function that is not a pure cron: `wf:<id>`.
// Crons are the `job:` rows in heartbeats.mjs. This file judges the other 65
// (62 that start on an event, 3 that have no trigger) from the `events` table
// ONLY. There is no run recorder yet (Ship 2), so nothing here can prove a
// workflow ran. The rules say that out loud instead of hiding it:
//
//   a. no trigger, or switched off       -> na   no-trigger  (re-checked by bundled code)
//   b. the read failed                   -> skip (lands "not checked", red)
//   c. an event came in the last 3 days  -> skip (we handed it work, nothing proves it ran)
//   d. no event in the last 3 days       -> na   no-demand   (re-checked against `events`)
//
// It never returns PASS. A green here would be a guess.
//
// Reads: one grouped SELECT on `events`, through `scope` (staff) when the pulse
// has one, else the plain pool. Nothing is written. No repo file is read at run
// time: the caller hands in the bundled `functions` list.

export const WORKFLOW_SINCE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const READ_TIMEOUT_MS = 5000;

/* Workflows that are dark on purpose. Each needs a reason of 40+ characters.
   workflow-coverage.test.mjs fails when a function has no trigger and is not
   here, and when an entry here is not really dark any more. */
export const NOT_LIVE_WORKFLOWS = Object.freeze({
  "n-01-cold-nurture":
    "Retired 2026-08-22. Its entry.captured trigger was removed because cold copy was landing on leads eleven seconds old.",
  "n-02-warm-nurture":
    "Retired 2026-08-22. Its survey.submitted trigger was removed because warm copy was landing on brand-new leads.",
  "n-03-hot-nurture":
    "Retired 2026-08-22. Both triggers were removed and the workflow is switched off. Owner call: every lead is hot."
});

/** The start of the look-back window: three days before `now`. */
export function workflowSince(now = new Date()) {
  return new Date(now.getTime() - WORKFLOW_SINCE_DAYS * DAY_MS);
}

/* workflowTriggers — what one bundled function listens for.
   Inngest 3.x exposes it as fn.opts: { id, enabled?, triggers: [{ event } | { cron }] }. */
export function workflowTriggers(fn) {
  const opts = (fn && fn.opts) || {};
  let id = typeof opts.id === "string" && opts.id ? opts.id : null;
  if (!id && fn && typeof fn.id === "function") {
    try { id = fn.id(); } catch { id = null; }
  }
  const triggers = Array.isArray(opts.triggers) ? opts.triggers : [];
  const events = [];
  const crons = [];
  for (const t of triggers) {
    if (t && typeof t.event === "string" && t.event) events.push(t.event);
    else if (t && typeof t.cron === "string" && t.cron) crons.push(t.cron);
  }
  return { id, events, crons, enabled: opts.enabled !== false, hasTrigger: events.length + crons.length > 0 };
}

const SQL_EVENTS = `SELECT name,
       count(*)::int AS n,
       min(created_at) AS first_at,
       max(created_at) AS last_at
  FROM events
 WHERE name = ANY($1::text[])
   AND created_at > $2::timestamptz
 GROUP BY name`;

function dayOf(date) {
  return date.toISOString().slice(0, 10);
}

function minuteOf(date) {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function nameList(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function clip(text, max) {
  const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function readEventCounts({ db, scope, names, since, timeoutMs }) {
  const canScope = typeof scope === "function";
  if (!canScope && (!db || typeof db.query !== "function")) {
    throw new Error("no database in this run, so events were not read");
  }
  let timer;
  // Wrapped so a synchronous throw (no DATABASE_URL) becomes a rejection.
  const run = (async () => (canScope
    ? scope((tx) => tx.query(SQL_EVENTS, [names, since.toISOString()]))
    : db.query(SQL_EVENTS, [names, since.toISOString()])))();
  try {
    const res = await Promise.race([
      run,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("the read took too long")), timeoutMs);
      })
    ]);
    return res && Array.isArray(res.rows) ? res.rows : [];
  } finally {
    clearTimeout(timer);
  }
}

function row(id, status, detail, extra = {}) {
  return {
    id: `wf:${id}`,
    kind: "coverage",
    group: "jobs",
    status,
    detail,
    suggestedFix: extra.suggestedFix || null,
    customerSees: null,
    schedule: extra.schedule || null,
    ...(extra.na ? { na: extra.na } : {})
  };
}

/**
 * checkWorkflowRuns — one row per bundled function that is not a pure cron.
 *
 *   functions   the list exported by src/workflows/index.mjs (required)
 *   db / scope  the plain pool, and the staff-scope runner when the pulse has one
 *   now         the clock
 *
 * Never throws. Rows keep the order of `functions`.
 */
export async function checkWorkflowRuns({
  db = null,
  scope = null,
  now = new Date(),
  functions,
  readTimeoutMs = READ_TIMEOUT_MS
} = {}) {
  if (!Array.isArray(functions)) {
    return [row("all", "skip", "The list of workflows was not handed to this check, so no workflow was judged.")];
  }
  const since = workflowSince(now);
  const specs = [];
  for (const fn of functions) {
    const t = workflowTriggers(fn);
    if (!t.id) continue;
    // A function that only runs on a clock is a `job:` row, not a `wf:` row.
    if (t.crons.length > 0 && t.events.length === 0) continue;
    specs.push(t);
  }

  // Which functions can be judged from events at all?
  const live = specs.filter((s) => s.enabled && s.events.length > 0);
  const names = [...new Set(live.flatMap((s) => s.events))];

  let counts = null;
  let readError = null;
  if (names.length > 0) {
    try {
      const rows = await readEventCounts({ db, scope, names, since, timeoutMs: readTimeoutMs });
      counts = new Map();
      for (const r of rows) {
        const first = toDate(r.first_at);
        counts.set(String(r.name), { n: Number(r.n) || 0, first });
      }
    } catch (err) {
      readError = clip((err && err.message) || err, 160) || "unknown error";
    }
  }

  return specs.map((s) => {
    // a. nothing wakes this workflow.
    if (!s.enabled || s.events.length === 0) {
      return row(
        s.id,
        "na",
        "Turned off in code (no trigger). Judged the day a trigger is put back.",
        { na: { code: "no-trigger", args: { id: s.id } } }
      );
    }
    const schedule = s.events.join(" + ");
    const fix = `Open ${s.id} in Inngest and read its runs. Do not re-run it from this pulse.`;
    // b. the read failed.
    if (readError) {
      return row(
        s.id,
        "skip",
        `Events could not be read: ${readError}. This workflow was not judged.`,
        { suggestedFix: fix, schedule }
      );
    }
    // c. work came in. Nothing records that it ran.
    const hits = s.events
      .map((name) => ({ name, ...(counts.get(name) || { n: 0, first: null }) }))
      .filter((h) => h.n > 0);
    if (hits.length > 0) {
      const total = hits.reduce((sum, h) => sum + h.n, 0);
      const firsts = hits.map((h) => h.first).filter(Boolean).sort((a, b) => a - b);
      const said = hits.map((h) => `${h.n} ${h.name}`).join(" and ");
      const when = firsts.length ? ` (first ${minuteOf(firsts[0])})` : "";
      return row(
        s.id,
        "skip",
        `${said} event${total === 1 ? "" : "s"} came since ${dayOf(since)}${when}. ` +
          "Nothing records that this workflow ran. Run receipts are not switched on yet.",
        { suggestedFix: fix, schedule }
      );
    }
    // d. no work came in. Nothing to judge until one does.
    return row(
      s.id,
      "na",
      `No ${nameList(s.events)} event came since ${dayOf(since)}. Judged the day one comes.`,
      { schedule, na: { code: "no-demand", args: { names: [...s.events], since: since.toISOString() } } }
    );
  });
}
