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
// Core codes carry their own verify(): it is a read (or a pure test on the bundled
// function list). The four lane codes carry the literal string verify: "lane".
// The lane file that made the row answers for it (see ctx.laneNaVerify below), so
// this file never imports a lane file and never copies a lane's query or minimum.
//
// READ ONLY. Nothing here writes, sends, or calls out. No repo file is read at run
// time: the bundled function list arrives as ctx.functions.

import { lastMonthlyFire } from "./heartbeats.mjs";

const PHOENIX = "America/Phoenix";

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

function findFn(functions, id) {
  if (!Array.isArray(functions)) return null;
  return functions.find((fn) => fnIdOf(fn) === id) || null;
}

/* One read, through ctx.db, or through ctx.scope (the staff runner) when the
   plain db is not there. Throws when neither is, and verifyNa turns that into
   ok:false. */
async function readRows(ctx, text, params) {
  if (ctx && ctx.db && typeof ctx.db.query === "function") {
    return (await ctx.db.query(text, params)).rows;
  }
  if (ctx && typeof ctx.scope === "function") {
    return ctx.scope(async (client) => (await client.query(text, params)).rows);
  }
  throw new Error("no database in this run");
}

/* `say` must never throw: a bad args object is caught by problem(), and the
   scorecard falls back to a plain sentence. Each say() still guards its inputs. */
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

export const NA_CONDITIONS = Object.freeze({
  /* An event workflow that nobody has handed work to. True when the `events`
     table holds no row for any of its trigger names since `since`. It reads
     `events`, never a run-recorder table, so a recorder that is switched off
     cannot make every workflow look quiet. */
  "no-demand": Object.freeze({
    say(args = {}) {
      const names = Array.isArray(args.names) ? args.names.filter(isText) : [];
      const what = names.length ? names.join(" or ") : "trigger";
      return `No ${what} event came since ${monthDay(args.since)}. Judged the day one comes.`;
    },
    claim(args = {}) {
      const names = Array.isArray(args.names) ? args.names.filter(isText) : [];
      return `no ${names.length ? names.join(" or ") : "trigger"} event since ${monthDay(args.since)}`;
    },
    problem(args) {
      if (!Array.isArray(args.names) || !args.names.length || !args.names.every(isText)) return "names is not a list of event names";
      if (!isTime(args.since)) return "since is not a time";
      return null;
    },
    async verify(args, ctx) {
      const rows = await readRows(
        ctx,
        `SELECT count(*)::int AS n
           FROM events
          WHERE name = ANY($1::text[])
            AND created_at > $2::timestamptz`,
        [args.names, new Date(args.since).toISOString()]
      );
      return Number(rows[0]?.n) === 0;
    }
  }),

  /* A bundled workflow that is turned off in code. True when the function in
     ctx.functions has no triggers, or enabled is false. */
  "no-trigger": Object.freeze({
    say() {
      return "Turned off in code (no trigger). Judged the day a trigger is put back.";
    },
    claim(args = {}) {
      return `the workflow ${args.id || "named"} having no trigger`;
    },
    problem(args) {
      return isText(args.id) ? null : "id is not a workflow id";
    },
    async verify(args, ctx) {
      const fn = findFn(ctx && ctx.functions, args.id);
      if (!fn) return false;
      const triggers = fn.opts && fn.opts.triggers;
      const none = !Array.isArray(triggers) || triggers.length === 0;
      const off = !!(fn.opts && fn.opts.enabled === false);
      return none || off;
    }
  }),

  /* Built, but not switched on. True when the id is not in the bundled list. If
     the list itself is missing, the answer is false: no list, no claim. */
  "not-registered": Object.freeze({
    say(args = {}) {
      return `${args.id || "This workflow"} is built but not switched on (it is not in the workflow list). Judged the day it is switched on.`;
    },
    claim(args = {}) {
      return `the workflow ${args.id || "named"} being left out of the bundle`;
    },
    problem(args) {
      return isText(args.id) ? null : "id is not a workflow id";
    },
    async verify(args, ctx) {
      if (!ctx || !Array.isArray(ctx.functions)) return false;
      return findFn(ctx.functions, args.id) === null;
    }
  }),

  /* A monthly job whose last due time came before the receipts began. True when
     the oldest job receipt is later than the last time the cron was due. */
  "monthly-not-due": Object.freeze({
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
      return "the job receipts having begun after its last due time";
    },
    problem(args) {
      if (!isText(args.cron)) return "cron is not a schedule";
      return lastMonthlyFire(args.cron) ? null : "cron is not a monthly schedule";
    },
    async verify(args, ctx) {
      const now = ctx && ctx.now instanceof Date ? ctx.now : new Date();
      const last = lastMonthlyFire(args.cron, now);
      if (!last) return false;
      const rows = await readRows(ctx, `SELECT min(finished_at) AS first_at FROM job_heartbeats`, []);
      const first = rows[0]?.first_at ? new Date(rows[0].first_at) : null;
      if (!first || Number.isNaN(first.getTime())) return false;
      return first.getTime() > last.getTime();
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
      return "no ad running";
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
      return "the traffic being too low to judge";
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
      return "no real lead in the window";
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
      return `${isText(args.what) ? args.what : "YouTube"} being unconnected`;
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
   Returns { ok, reason }. `reason` is the CONDITION in a few words, so the audit can
   write "Said nothing to judge, but <reason> is not true."
   Never throws. A thrown error, an unknown code, or missing args is ok:false.
   ctx = { db, scope, now, functions, laneNaVerify } */
export async function verifyNa(row, ctx = {}) {
  try {
    const na = row && row.na;
    if (!isPlainObject(na)) return fail("the row giving a reason the computer can check");
    if (!isNaCode(na.code)) return fail(`the reason code ${JSON.stringify(String(na.code))} being one the computer knows`);
    if (!isPlainObject(na.args)) return fail(`the proof for "${na.code}" being a plain list of facts`);
    const cond = NA_CONDITIONS[na.code];
    const problem = cond.problem(na.args);
    if (problem) return fail(`the proof for "${na.code}" being complete (${problem})`);
    const claim = cond.claim(na.args);

    if (cond.verify === "lane") {
      const sliceId = (row && row.sliceId) ||
        (typeof row?.id === "string" && row.id.includes(":") ? row.id.split(":")[0] : null);
      if (!sliceId) return fail("the row saying which lane made it");
      if (!ctx || typeof ctx.laneNaVerify !== "function") return fail("the lane being able to re-check it");
      const held = await ctx.laneNaVerify(sliceId, na.code, na.args);
      if (held === undefined) return fail("the lane being able to re-check it");
      return held === true ? { ok: true, reason: claim } : fail(claim);
    }

    const held = await cond.verify(na.args, ctx || {});
    return held === true ? { ok: true, reason: claim } : fail(claim);
  } catch (err) {
    const why = String((err && err.message) || err).slice(0, 80);
    return fail(`the condition being readable (the read failed: ${why})`);
  }
}
