// The Netlify cron clock — which jobs are due, and starting them. Report and start only.
//
// WHY THIS EXISTS. Owner, 2026-10-20: "ingest is maxed out i cant afford 99 a month, stop burning
// ingests". Every cron used to run on Inngest, where a run costs 1 execution plus 1 per step and
// the free plan stops at 50,000 a month. The crons cost about 296,000. Board:
// ops/workflows/inngest-diet-2026-10-20.md.
//
// HOW IT RUNS. netlify/functions/cron-clock.mjs ticks every 5 minutes. Each tick is one 5-minute
// slot. A job is due when its cron names any minute inside the slot, so "17 * * * *" runs on the
// :15 tick and "30 7 * * *" on the 07:30 tick. A scheduled function is killed at 30 seconds, so
// the clock does no job work: it POSTs each due job to
// netlify/functions/cron-worker-background.mjs (15 minutes) and returns. Netlify answers 202 the
// moment the worker is accepted.
//
// THE WORKER IS AN OPEN URL, so every start carries a signature: HMAC-SHA256 of "job|slot" with
// CRON_WORKER_SECRET. The worker refuses a bad signature and a slot older than STALE_SLOT_MS.
//
// A job the clock could not start gets an error receipt in job_heartbeats right here, with the
// reason, so the morning pulse shows that job red with a real cause instead of just "late".

import { createHmac, timingSafeEqual } from "node:crypto";
import { CLOCK_JOBS, recordHeartbeat } from "../pulse/heartbeats.mjs";

export const SLOT_MS = 5 * 60 * 1000;
export const WORKER_PATH = "/.netlify/functions/cron-worker-background";
export const AUTH_HEADER = "x-fundhub-cron";
/** A start older than this is refused (three slots). */
export const STALE_SLOT_MS = 3 * SLOT_MS;
/** How long the clock waits for the worker to accept one start. */
export const START_TIMEOUT_MS = 8000;

/* Time zones a cron here may name. America/Phoenix has no daylight saving, so it is a fixed
   UTC-7. Anything else is refused at parse time (the tests run every CLOCK_JOBS cron through it). */
const ZONE_OFFSET_MIN = Object.freeze({ UTC: 0, "America/Phoenix": -7 * 60 });

const FIELD_RANGES = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7]   // day of week, 0 and 7 are Sunday
];

function parseField(text, [lo, hi]) {
  const allowed = new Set();
  for (const part of text.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron field "${text}" is a shape this clock does not read`);
    const step = m[4] ? Number(m[4]) : 1;
    let from = lo;
    let to = hi;
    if (m[1] !== "*") {
      from = Number(m[2]);
      to = m[3] != null ? Number(m[3]) : (m[4] ? hi : from);
    }
    if (!(step >= 1) || from < lo || to > hi || from > to) {
      throw new Error(`cron field "${text}" is out of range ${lo}-${hi}`);
    }
    for (let v = from; v <= to; v += step) allowed.add(v);
  }
  return allowed;
}

/* parseCron — "M H DoM Mon DoW", optionally led by "TZ=<zone>". Throws on anything else. */
export function parseCron(cron) {
  let raw = String(cron || "").trim();
  let offsetMin = 0;
  if (raw.startsWith("TZ=")) {
    const [tz, ...rest] = raw.split(/\s+/);
    const zone = tz.slice(3);
    if (!(zone in ZONE_OFFSET_MIN)) throw new Error(`cron time zone "${zone}" is not one this clock reads`);
    offsetMin = ZONE_OFFSET_MIN[zone];
    raw = rest.join(" ");
  }
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron "${cron}" does not have five fields`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELD_RANGES[i]));
  if (dow.has(7)) dow.add(0);
  return { minute, hour, dom, month, dow, domAny: parts[2] === "*", dowAny: parts[4] === "*", offsetMin };
}

/* cronMatchesMinute — does the cron fire at this exact minute? Standard cron rule: when both day
   fields are set, either one matching is enough. */
export function cronMatchesMinute(parsed, at) {
  const local = new Date(at.getTime() + parsed.offsetMin * 60000);
  if (!parsed.minute.has(local.getUTCMinutes())) return false;
  if (!parsed.hour.has(local.getUTCHours())) return false;
  if (!parsed.month.has(local.getUTCMonth() + 1)) return false;
  const domHit = parsed.dom.has(local.getUTCDate());
  const dowHit = parsed.dow.has(local.getUTCDay());
  if (parsed.domAny && parsed.dowAny) return true;
  if (parsed.domAny) return dowHit;
  if (parsed.dowAny) return domHit;
  return domHit || dowHit;
}

/** slotOf — the start of the 5-minute slot holding `now`. */
export function slotOf(now = new Date()) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  return new Date(Math.floor(t / SLOT_MS) * SLOT_MS);
}

/** dueInSlot — does the cron name any minute inside the slot that starts at `slotStart`? */
export function dueInSlot(cron, slotStart) {
  const parsed = typeof cron === "string" ? parseCron(cron) : cron;
  for (let i = 0; i < SLOT_MS / 60000; i += 1) {
    if (cronMatchesMinute(parsed, new Date(slotStart.getTime() + i * 60000))) return true;
  }
  return false;
}

/** dueJobs — the CLOCK_JOBS rows due in this slot. */
export function dueJobs(slotStart, jobs = CLOCK_JOBS) {
  return jobs.filter(([, cron]) => dueInSlot(cron, slotStart)).map(([job, cron]) => ({ job, cron }));
}

/** sign — the start signature for one job in one slot. */
export function sign(secret, job, slot) {
  return createHmac("sha256", String(secret)).update(`${job}|${slot}`).digest("hex");
}

/* verifyStart — is this a start the clock sent, for a fresh slot? Returns { ok } or { ok:false, why }. */
export function verifyStart({ secret, signature, job, slot, now = new Date() }) {
  if (!secret) return { ok: false, why: "CRON_WORKER_SECRET is not set" };
  if (!job || !slot || !signature) return { ok: false, why: "missing job, slot or signature" };
  const expected = Buffer.from(sign(secret, job, slot), "utf8");
  const got = Buffer.from(String(signature), "utf8");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, why: "bad signature" };
  const slotMs = Date.parse(slot);
  if (!Number.isFinite(slotMs)) return { ok: false, why: "slot is not a time" };
  const age = now.getTime() - slotMs;
  if (age > STALE_SLOT_MS || age < -SLOT_MS) return { ok: false, why: "slot is not fresh" };
  return { ok: true };
}

/* tick — one clock pass: start every job due in this slot. NEVER THROWS (the next tick is the
   retry). Returns { ok, slot, due, started, failed, count }. */
export async function tick({ db, env = process.env, fetchImpl = globalThis.fetch, now = new Date(), jobs = CLOCK_JOBS } = {}) {
  const slotStart = slotOf(now);
  const slot = slotStart.toISOString();
  let due;
  try {
    due = dueJobs(slotStart, jobs);
  } catch (err) {
    return { ok: false, slot, due: 0, started: 0, failed: [], count: 0, error: String((err && err.message) || err).slice(0, 300) };
  }
  const base = env.URL || env.DEPLOY_URL || "";
  const secret = env.CRON_WORKER_SECRET || "";
  const why = !base ? "no site URL in the environment" : !secret ? "CRON_WORKER_SECRET is not set" : null;

  const outcomes = await Promise.all(due.map(async ({ job }) => {
    if (why) return { job, started: false, error: why };
    try {
      const res = await fetchImpl(`${base}${WORKER_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", [AUTH_HEADER]: sign(secret, job, slot) },
        body: JSON.stringify({ job, slot }),
        signal: AbortSignal.timeout(START_TIMEOUT_MS)
      });
      return res.status === 202 || res.ok
        ? { job, started: true }
        : { job, started: false, error: `the worker answered ${res.status}` };
    } catch (err) {
      return { job, started: false, error: String((err && err.message) || err).slice(0, 200) };
    }
  }));

  const failed = outcomes.filter((o) => !o.started);
  for (const f of failed) {
    await recordHeartbeat(db, {
      job: f.job,
      runner: "netlify",
      outcome: "error",
      error: `the clock could not start it: ${f.error}`
    });
  }
  const started = outcomes.length - failed.length;
  return {
    ok: failed.length === 0,
    slot,
    due: due.length,
    started,
    failed: failed.map((f) => ({ job: f.job, error: f.error })),
    count: started,
    ...(why && due.length ? { error: why } : {})
  };
}
