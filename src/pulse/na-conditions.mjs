// N/A conditions — the only ways a live check may say "nothing to judge today".
//
// Owner law (2026-10-09): "if something's not checked ever, you have to check it."
// After this build a live thing on the morning report is green, red, or "na".
// "na" is not a quiet state. It names a CODE from this closed list, plus the
// arguments that make the code true. Every morning the audit calls verifyNa()
// and re-checks that the code is still true. If it is not, the row stops being
// "na" and lands as "not checked", which is red (the one audit:not-checked row).
//
// Board: ops/workflows/zero-unchecked-2026-10-09/build-contract.md, piece A.
//
// A producer's row:
//   { id, kind, group, status: "na", detail: "<one 4th-grade sentence>", na: { code, args } }
// `args` is a plain JSON object (numbers, strings, ISO times). Nothing else.
//
// The producer is not trusted. verifyNa() checks three things, in this order:
//   1. the proof is complete (the code is on the list and its args are usable);
//   2. the proof is about THIS row (a wf: row names its own workflow's events, a
//      job: row names its own job's schedule), so a true claim about one thing
//      cannot be copied onto another row;
//   3. the claim is still true, by reading the database (or the bundled
//      workflow list) again.
//
// Core codes carry their own look(): it is a read (or a pure test on the bundled
// function list). The four lane codes carry the literal string verify: "lane".
// The lane file that made the row answers for it (see ctx.laneNaVerify below), so
// this file never imports a lane file and never copies a lane's query or minimum.
//
// READ ONLY. Nothing here writes, sends, or calls out. No repo file is read at run
// time: the bundled function list arrives as ctx.functions.

import { JOBS, lastMonthlyFire } from "./heartbeats.mjs";
import { hasWork, readWaitingWork, workerKinds } from "../marketing/clock.mjs";
import { netlifyRegistry } from "../marketing/ai-runner.mjs";
import { JOB_KINDS } from "../marketing/job-kinds.mjs";

const PHOENIX = "America/Phoenix";
const DAY_MS = 24 * 60 * 60 * 1000;

/* A no-demand claim looks back over a window. A window shorter than this is too
   short to judge, so the claim fails. This is the verifier's own floor: it does
   not trust the producer's `since`. (The producer today uses three days.) */
export const NO_DEMAND_MIN_WINDOW_MS = DAY_MS;

/* "10-09" — the month and day on Chris's clock. */
function monthDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "that day";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PHOENIX, month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("month")}-${get("day")}`;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

/* An ISO time as text. A Date is accepted too (it is saved as its ISO text). */
function isTime(v) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(new Date(v).getTime());
}

function isText(v) {
  return typeof v === "string" && v.trim() !== "";
}

/* The clock the check runs on: ctx.now when it is a real Date, else the real now. */
function clock(ctx) {
  return ctx && ctx.now instanceof Date && !Number.isNaN(ctx.now.getTime()) ? ctx.now : new Date();
}

/* What follows `prefix` in the row id ("wf:s-09" -> "s-09"), or null. */
function idAfter(row, prefix) {
  const id = row && row.id;
  return typeof id === "string" && id.startsWith(prefix) && id.length > prefix.length ? id.slice(prefix.length) : null;
}

/* The id of a bundled Inngest function. Real ones carry opts.id; tests may pass
   { id: "x" } or { opts: { id: "x" } }. */
function fnIdOf(fn) {
  if (!fn) return null;
  if (fn.opts && typeof fn.opts.id === "string") return fn.opts.id;
  if (typeof fn.id === "string") return fn.id;
  if (typeof fn.id === "function") {
    try { return fn.id(); } catch { return null; }
  }
  return null;
}

/* An empty list is no list: a bundle with nothing in it is a broken bundle, and
   "not in an empty list" must never read as "not switched on". */
function hasList(functions) {
  return Array.isArray(functions) && functions.length > 0;
}

function findFn(functions, id) {
  if (!hasList(functions)) return null;
  return functions.find((fn) => fnIdOf(fn) === id) || null;
}

/* The event names that start a bundled function. */
function eventsOf(fn) {
  const triggers = fn && fn.opts && Array.isArray(fn.opts.triggers) ? fn.opts.triggers : [];
  return triggers.filter((t) => t && isText(t.event)).map((t) => t.event);
}

/* One read, through ctx.scope (the staff runner) when it is there, else through
   ctx.db. This is the order gap-handoff uses, and the order the producers use, so
   the verifier sees the same rows the producer saw. Throws when neither is there,
   and verifyNa turns that into ok:false. */
async function readRows(ctx, text, params) {
  if (ctx && typeof ctx.scope === "function") {
    return ctx.scope(async (client) => (await client.query(text, params)).rows);
  }
  if (ctx && ctx.db && typeof ctx.db.query === "function") {
    return (await ctx.db.query(text, params)).rows;
  }
  throw new Error("no database in this run");
}

/* The events table, counted by name since a time. One read answers EVERY
   no-demand row that shares the run (ctx) and the window: about 60 workflow rows
   cost one read, not 60. It asks for every name, so a name nobody listed cannot be
   missed. The answer lives only as long as the ctx object, which the audit makes
   fresh for each run. */
const EVENT_COUNTS = new WeakMap();
const EVENT_COUNTS_SQL = `SELECT name, count(*)::int AS n
   FROM events
  WHERE created_at > $1::timestamptz
  GROUP BY name`;

function eventCountsSince(ctx, sinceIso) {
  let bySince = EVENT_COUNTS.get(ctx);
  if (!bySince) {
    bySince = new Map();
    EVENT_COUNTS.set(ctx, bySince);
  }
  let pending = bySince.get(sinceIso);
  if (!pending) {
    pending = readRows(ctx, EVENT_COUNTS_SQL, [sinceIso]).then((rows) => {
      const counts = new Map();
      for (const r of rows) counts.set(String(r.name), Number(r.n) || 0);
      return counts;
    });
    bySince.set(sinceIso, pending);
  }
  return pending;
}

/* `say` must never throw: a bad args object is caught by problem(), and the
   scorecard falls back to a plain sentence. Each say() still guards its inputs. */
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

const namesIn = (args = {}) => (Array.isArray(args.names) ? args.names.filter(isText) : []);

/* A core condition. look(args, ctx) -> { held, found }:
     held   true when the claim is still true;
     found  one short sentence of what was seen instead, said when it is not.
   verify() is the contract shape (args, ctx) -> boolean, built from look().
   rowProblem(row, args, ctx) -> string|null is the check that the proof is about
   THIS row. */
function core({ say, claim, problem, rowProblem = null, look }) {
  return Object.freeze({
    say,
    claim,
    problem,
    rowProblem,
    look,
    async verify(args, ctx) {
      const seen = await look(args, ctx || {});
      return !!seen && seen.held === true;
    }
  });
}

const LANE_FOUND = "The lane looked again and found something to judge.";

export const NA_CONDITIONS = Object.freeze({
  /* An event workflow that nobody has handed work to. True when the `events`
     table holds no row for any of its trigger names since `since`. It reads
     `events`, never a run-recorder table, so a recorder that is switched off
     cannot make every workflow look quiet.

     The row must be wf:<id>, the names must be exactly the event triggers of that
     function in the bundled list, and the window must be at least a day long. */
  "no-demand": core({
    say(args = {}) {
      const names = namesIn(args);
      const what = names.length ? names.join(" or ") : "trigger";
      return `No ${what} event came since ${monthDay(args.since)}. Judged the day one comes.`;
    },
    claim(args = {}) {
      const names = namesIn(args);
      return `No ${names.length ? names.join(" or ") : "trigger"} event since ${monthDay(args.since)}.`;
    },
    problem(args) {
      if (!Array.isArray(args.names) || !args.names.length || !args.names.every(isText)) return "names is not a list of event names";
      if (!isTime(args.since)) return "since is not a time";
      return null;
    },
    rowProblem(row, args, ctx) {
      const wf = idAfter(row, "wf:");
      if (wf === null) return "A no-demand reason only fits a workflow row.";
      if (!hasList(ctx.functions)) return "There is no workflow list to check the event names against.";
      const fn = findFn(ctx.functions, wf);
      if (!fn) return `${wf} is not in the workflow list.`;
      const real = eventsOf(fn);
      const named = new Set(args.names);
      const wrong = args.names.filter((n) => !real.includes(n));
      if (wrong.length) return `${wrong.join(" and ")} ${wrong.length === 1 ? "does" : "do"} not start ${wf}.`;
      const left = real.filter((n) => !named.has(n));
      if (left.length) return `${wf} also starts on ${left.join(" and ")}. The row did not check ${left.length === 1 ? "it" : "them"}.`;
      return null;
    },
    async look(args, ctx) {
      const since = new Date(args.since);
      if (since.getTime() > clock(ctx).getTime() - NO_DEMAND_MIN_WINDOW_MS) {
        return { held: false, found: "The look-back window is under a day long. That is too short to judge." };
      }
      const counts = await eventCountsSince(ctx, since.toISOString());
      const hits = [...new Set(args.names)]
        .map((name) => [name, counts.get(name) || 0])
        .filter(([, n]) => n > 0);
      if (!hits.length) return { held: true, found: "" };
      const total = hits.reduce((sum, [, n]) => sum + n, 0);
      const said = hits.map(([name, n]) => `${n} ${name}`).join(" and ");
      return { held: false, found: `${said} event${total === 1 ? "" : "s"} came since ${monthDay(since)}.` };
    }
  }),

  /* A bundled workflow that is turned off in code. True when the function in
     ctx.functions has no triggers, or enabled is false. A wf:<id> row must name
     its own id. */
  "no-trigger": core({
    say() {
      return "Turned off in code (no trigger). Judged the day a trigger is put back.";
    },
    claim(args = {}) {
      return `${args.id || "The workflow"} has no trigger.`;
    },
    problem(args) {
      return isText(args.id) ? null : "id is not a workflow id";
    },
    rowProblem(row, args) {
      const wf = idAfter(row, "wf:");
      if (wf !== null && wf !== args.id) return `This row is for ${wf}, not ${args.id}.`;
      return null;
    },
    async look(args, ctx) {
      if (!hasList(ctx.functions)) return { held: false, found: "There is no workflow list to look at." };
      const fn = findFn(ctx.functions, args.id);
      if (!fn) return { held: false, found: `${args.id} is not in the workflow list.` };
      const triggers = fn.opts && fn.opts.triggers;
      const none = !Array.isArray(triggers) || triggers.length === 0;
      const off = !!(fn.opts && fn.opts.enabled === false);
      if (none || off) return { held: true, found: "" };
      return { held: false, found: `${args.id} has ${triggers.length} ${triggers.length === 1 ? "trigger" : "triggers"} and is switched on.` };
    }
  }),

  /* Built, but not switched on. True when the id is not in the bundled list. If
     the list itself is missing or empty, the answer is false: no list, no claim. */
  "not-registered": core({
    say(args = {}) {
      return `${args.id || "This workflow"} is built but not switched on (it is not in the workflow list). Judged the day it is switched on.`;
    },
    claim(args = {}) {
      return `${args.id || "The workflow"} is not in the workflow list.`;
    },
    problem(args) {
      return isText(args.id) ? null : "id is not a workflow id";
    },
    async look(args, ctx) {
      if (!hasList(ctx.functions)) return { held: false, found: "There is no workflow list to check against." };
      if (findFn(ctx.functions, args.id) === null) return { held: true, found: "" };
      return { held: false, found: `${args.id} is in the workflow list.` };
    }
  }),

  /* A monthly job whose last due time came before the receipts began. True when
     the oldest job receipt is later than the last time the cron was due. The row
     must be job:<name>, and the cron must be that job's cron on the job list. */
  "monthly-not-due": core({
    say(args = {}, now = new Date()) {
      const last = lastMonthlyFire(args.cron, now);
      let when = "the next time it is due";
      if (last) {
        const parts = String(args.cron).trim().split(/\s+/).map(Number);
        const next = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, parts[2], parts[1], parts[0]));
        when = monthDay(next);
      }
      return `Runs once a month. Its last due time came before receipts began. First judged ${when}.`;
    },
    claim() {
      return "The first job receipt came after the last due time.";
    },
    problem(args) {
      if (!isText(args.cron)) return "cron is not a schedule";
      return lastMonthlyFire(args.cron) ? null : "cron is not a monthly schedule";
    },
    rowProblem(row, args) {
      const name = idAfter(row, "job:");
      if (name === null) return "A monthly reason only fits a job row.";
      const job = JOBS.find((j) => j.job === name);
      if (!job) return `${name} is not on the job list.`;
      if (String(args.cron).trim() !== job.cron) {
        return `The schedule on this row (${args.cron}) is not the real schedule of ${name} (${job.cron}).`;
      }
      return null;
    },
    async look(args, ctx) {
      const last = lastMonthlyFire(args.cron, clock(ctx));
      if (!last) return { held: false, found: "The schedule is not a monthly one." };
      const rows = await readRows(ctx, `SELECT min(finished_at) AS first_at FROM job_heartbeats`, []);
      const first = rows[0]?.first_at ? new Date(rows[0].first_at) : null;
      if (!first || Number.isNaN(first.getTime())) return { held: false, found: "No job receipt is on file at all." };
      if (first.getTime() > last.getTime()) return { held: true, found: "" };
      return {
        held: false,
        found: `The first job receipt is from ${monthDay(first)}. The job was due ${monthDay(last)}, so a run should be there.`
      };
    }
  }),

  /* The marketing worker has nothing to do. True when the same waiting-work read
     the lane uses (readWaitingWork + hasWork, same job kinds) finds nothing. The
     row must be 03-marketing:<what>, so a true claim about one beat cannot be
     copied onto another. `worker` means no work of any kind; `outbox_drain` means
     no repo save is waiting. */
  "no-work-waiting": core({
    say(args = {}) {
      return args.what === "outbox_drain"
        ? "No repo save is waiting, so the drain has nothing to do. Judged the day one waits."
        : "Nothing is waiting for the marketing worker. Judged the day work waits.";
    },
    claim(args = {}) {
      return args.what === "outbox_drain" ? "No repo save is waiting." : "Nothing is waiting for the marketing worker.";
    },
    problem(args) {
      return args.what === "worker" || args.what === "outbox_drain" ? null : "what is not worker or outbox_drain";
    },
    rowProblem(row, args) {
      const id = idAfter(row, "03-marketing:");
      if (id === null) return "A no-work-waiting reason only fits a 03-marketing row.";
      return id === args.what ? null : `This row is for ${id}, not ${args.what}.`;
    },
    async look(args, ctx) {
      const kinds = workerKinds(netlifyRegistry(process.env, JOB_KINDS));
      let work;
      if (ctx && typeof ctx.scope === "function") {
        work = await ctx.scope((client) => readWaitingWork(client, { kinds }));
      } else if (ctx && ctx.db && typeof ctx.db.query === "function") {
        work = await readWaitingWork(ctx.db, { kinds });
      } else {
        throw new Error("no database in this run");
      }
      if (args.what === "outbox_drain") {
        return work.outbox_waiting <= 0
          ? { held: true, found: "" }
          : { held: false, found: `${work.outbox_waiting} repo save${work.outbox_waiting === 1 ? " is" : "s are"} waiting.` };
      }
      return hasWork(work)
        ? { held: false, found: "Work is waiting for the marketing worker." }
        : { held: true, found: "" };
    }
  }),

  /* The four lane codes. The lane file that made the row exports
     naVerify = { "<code>": async (args, ctx) => boolean } and the audit reaches
     it through ctx.laneNaVerify(sliceId, code, args). Their args are the lane's
     own, so nothing is required of them here beyond a plain object. */
  "no-running-ad": Object.freeze({
    say() {
      return "No ad is running. Judged the day one runs.";
    },
    claim() {
      return "No ad is running.";
    },
    problem() {
      return null;
    },
    verify: "lane"
  }),

  "low-traffic": Object.freeze({
    say(args = {}) {
      const count = num(args.count);
      const min = num(args.min);
      const what = isText(args.what) ? args.what : "visits";
      const days = num(args.days);
      const span = days ? ` in ${days} ${days === 1 ? "day" : "days"}` : "";
      if (count !== null && min !== null) {
        return `Only ${count} ${what}${span}. Needs ${min} to judge.`;
      }
      return `Too few ${what}${span} to judge. Judged the day there are enough.`;
    },
    claim() {
      return "The traffic is too low to judge.";
    },
    problem() {
      return null;
    },
    verify: "lane"
  }),

  "no-real-lead": Object.freeze({
    say(args = {}) {
      const days = num(args.days);
      const span = days ? `${days} ${days === 1 ? "day" : "days"}` : "the window";
      return `No real roadmap lead in ${span}. Judged the day one comes.`;
    },
    claim() {
      return "There is no real lead in the window.";
    },
    problem() {
      return null;
    },
    verify: "lane"
  }),

  "not-connected": Object.freeze({
    say(args = {}) {
      const what = isText(args.what) ? args.what : "YouTube";
      return `${what} is not connected, so there is no sync to be late. Judged the day it is connected.`;
    },
    claim(args = {}) {
      return `${isText(args.what) ? args.what : "YouTube"} is not connected.`;
    },
    problem() {
      return null;
    },
    verify: "lane"
  }),

  /* A board stage that no code moves a card to. True while no card sits on any of the named
     "board/stage" keys. The lane that made the row (gap-pipeline-boards) re-reads the cards with
     the same SQL and the same keys, so this file copies nothing. Goes red the day a card lands. */
  "no-card-on-stage": Object.freeze({
    say(args = {}) {
      const n = Array.isArray(args.stages) ? args.stages.filter(isText).length : 0;
      return `${n ? `${n} stages have` : "These stages have"} no automatic mover and no card. Judged the day a card lands.`;
    },
    claim() {
      return "No card sits on a stage that no code moves a card to.";
    },
    problem(args) {
      return Array.isArray(args.stages) && args.stages.length > 0 && args.stages.every(isText)
        ? null
        : "stages is not a list of board/stage keys";
    },
    verify: "lane"
  }),

  /* A board with no stage time limit written. True while the named setting for each named board is
     still off. The lane that made the row (gap-pipeline-boards) answers; it reads its own setting. */
  "no-limit-set": Object.freeze({
    say(args = {}) {
      const n = Array.isArray(args.boards) ? args.boards.filter(isText).length : 0;
      return `${n ? `${n} boards have` : "These boards have"} no stage time limit written. Judged the day Chris sets one.`;
    },
    claim() {
      return "No stage time limit is set for these boards.";
    },
    problem(args) {
      return Array.isArray(args.boards) && args.boards.length > 0 && args.boards.every(isText)
        ? null
        : "boards is not a list of board keys";
    },
    verify: "lane"
  }),

  /* A message template that nothing sends (W4 messages truth, 2026-10-10). True when the lane that made the row
     reads the messages table again and finds no queued message from any key on its dead list
     (msg:dead-senders, src/pulse/coverage/gap-msg.mjs, naVerify["no-sender"]). The day one is queued the row
     is replaced by "not checked" here, and the lane's own row goes red by name. */
  "no-sender": Object.freeze({
    say(args = {}) {
      const count = num(args.count);
      const days = num(args.days);
      const what = count !== null ? `${count} templates have` : "These templates have";
      const span = days ? ` in the last ${days} ${days === 1 ? "day" : "days"}` : "";
      return `${what} no sender or are retired. None was queued${span}. Judged the day one is.`;
    },
    claim() {
      return "No template with no sender was queued.";
    },
    problem() {
      return null;
    },
    verify: "lane"
  })
});

/** Every code, in the order above. */
export const NA_CODES = Object.freeze(Object.keys(NA_CONDITIONS));

export function isNaCode(code) {
  return typeof code === "string" && Object.hasOwn(NA_CONDITIONS, code);
}

/* Null when `na` is a usable { code, args }; otherwise one plain reason it is not.
   The scorecard uses this to decide whether an "na" row may stay "na". */
export function naProblem(na) {
  if (!isPlainObject(na)) return "the row has no na object";
  if (!isNaCode(na.code)) return `the code ${JSON.stringify(na.code)} is not on the list`;
  if (!isPlainObject(na.args)) return "the args are not a plain object";
  try {
    JSON.stringify(na.args);
  } catch {
    return "the args cannot be saved";
  }
  return NA_CONDITIONS[na.code].problem(na.args);
}

/* The sentence for a code, or a plain fallback. Never throws. */
export function naSay(na, now = new Date()) {
  try {
    if (isNaCode(na && na.code)) return String(NA_CONDITIONS[na.code].say(na.args || {}, now));
  } catch {
    // fall through
  }
  return "Nothing to judge today.";
}

const fail = (reason) => ({ ok: false, reason });

/* verifyNa — the one door the audit uses.
   Returns { ok, reason }. Never throws. A thrown error, an unknown code, missing
   args, a proof that is about a different row, or a claim that is no longer true
   is ok:false.

   `reason` is one short sentence:
     ok:false  what was found instead ("3 round.started events came since 10-05.").
               The audit writes: Said nothing to judge, but "<row detail>" is not
               true. <reason>
     ok:true   the claim that still holds ("No round.started event since 10-05.").

   ctx = { db, scope, now, functions, laneNaVerify } */
export async function verifyNa(row, ctx) {
  try {
    const c = ctx && typeof ctx === "object" ? ctx : {};
    const na = row && row.na;
    if (!isPlainObject(na)) return fail("The row gave no reason the computer can check.");
    if (!isNaCode(na.code)) return fail(`The reason code ${JSON.stringify(String(na.code))} is not one the computer knows.`);
    if (!isPlainObject(na.args)) return fail(`The proof for "${na.code}" is not a plain list of facts.`);
    const cond = NA_CONDITIONS[na.code];
    const problem = cond.problem(na.args);
    if (problem) return fail(`The proof for "${na.code}" is not complete: ${problem}.`);

    if (cond.verify === "lane") {
      const sliceId = (row && row.sliceId) ||
        (typeof row?.id === "string" && row.id.includes(":") ? row.id.split(":")[0] : null);
      if (!sliceId) return fail("The row does not say which lane made it.");
      if (typeof c.laneNaVerify !== "function") return fail("There is no way to ask the lane to check this again.");
      const held = await c.laneNaVerify(sliceId, na.code, na.args);
      if (held === undefined) return fail("The lane has no way to check this again.");
      return held === true ? { ok: true, reason: cond.claim(na.args) } : fail(LANE_FOUND);
    }

    // The proof must be about this row, not just true about something.
    const mismatch = cond.rowProblem ? cond.rowProblem(row, na.args, c) : null;
    if (mismatch) return fail(mismatch);

    const seen = await cond.look(na.args, c);
    if (seen && seen.held === true) return { ok: true, reason: cond.claim(na.args) };
    return fail((seen && seen.found) || "The reason is not true.");
  } catch (err) {
    const why = String((err && err.message) || err).slice(0, 80).replace(/\.+$/, "");
    return fail(`The read failed: ${why}.`);
  }
}
