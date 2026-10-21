// Instant pulse — text Chris when a critical door breaks between morning checks.
// Audit only on the read side; the text is the alert. Never auto-fixes product code.
// The alert goes out through textMorningBrief (./notify.mjs), so it carries the email copy
// (PULSE_EMAIL_TO) the same way every other pulse alert does. Twilio dead must not mean silence.

import { checkHealth, checkLogin, checkApplyDoor, defaultOrgId } from "./daily-pulse.mjs";
import { checkFunnelRoadmapSales, DEFAULT_FUNNEL_BASE_URL } from "./funnel-doors.mjs";
import { readPipelineMotionCounts } from "./pipeline-motion.mjs";
import { chrisPulseSmsTo, textMorningBrief } from "./notify.mjs";
import { send as sendSms } from "../messaging/providers/twilio.mjs";
import { send as sendEmail } from "../messaging/providers/resend.mjs";
import { inTextWindow, HELD } from "./quiet-hours.mjs";
import { SHIFT_JOBS } from "./beats/shifts.mjs";

export const INSTANT_AGENT_CODE = "pulse-instant";
export const INSTANT_COOLDOWN_MS = 60 * 60 * 1000;
export const PULSE_RUNNER_JOB = "pulse-hourly";
export const PULSE_RUNNER_STALE_MS = 3 * 60 * 60 * 1000;
export const CRITICAL_CHECK_IDS = Object.freeze([
  "health",
  "login",
  "apply",
  "funnel:roadmap-sales",
  "pipeline:outbound",
  "pulse:runner-stale"
]);

/* The hourly pulse runs in shifts (src/pulse/beats/shifts.mjs): pulse-hourly, pulse-hourly-b, pulse-hourly-c and
   pulse-hourly-d, each with its own share of the beats. Any one going quiet leaves its beats unrun, so the circuit closes only when
   every shift that has ever run left a fresh receipt. */
export const PULSE_RUNNER_JOBS = SHIFT_JOBS;

/** "a", "a and b", "a, b and c". */
const andList = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export async function checkPulseRunnerReceipt(db, { now = new Date() } = {}) {
  if (!db || typeof db.query !== "function") return null;
  const stale = [];
  let judged = 0;
  for (const job of PULSE_RUNNER_JOBS) {
    const { rows } = await db.query(
      `SELECT max(finished_at) AS last_at
         FROM job_heartbeats
        WHERE job = $1`,
      [job]
    );
    const raw = rows?.[0]?.last_at;
    if (!raw) continue; // Before a shift has ever run (its first deploy), there is no circuit to judge for it.
    const lastAt = raw instanceof Date ? raw : new Date(raw);
    if (!Number.isFinite(lastAt.getTime())) throw new Error(`${job} has an invalid finished_at receipt`);
    judged++;
    const ageMs = Math.max(0, now.getTime() - lastAt.getTime());
    if (ageMs > PULSE_RUNNER_STALE_MS) stale.push({ job, hours: Math.max(1, Math.floor(ageMs / (60 * 60 * 1000))) });
  }
  if (!judged) return null; // Before the first hourly pulse has ever shipped, there is no circuit to judge.
  if (stale.length) {
    const first = stale[0];
    const which = first.job === PULSE_RUNNER_JOB ? "The hourly pulse" : `The hourly pulse (${first.job})`;
    const more = stale.length > 1 ? ` ${stale.slice(1).map((s) => `${s.job} has not run for ${s.hours} h either.`).join(" ")}` : "";
    return {
      id: "pulse:runner-stale",
      status: "FAIL",
      detail: `${which} has not run for ${first.hours} h.${more} The backup pulse circuit did not close.`,
      suggestedFix: `Check the ${andList(stale.map((s) => s.job))} function log on Netlify.`
    };
  }
  return {
    id: "pulse:runner-stale",
    status: "PASS",
    detail: `${judged === 1 ? "The hourly pulse" : judged === 2 ? "Both hourly pulse shifts" : `All ${judged} hourly pulse shifts`} left a fresh receipt, so the backup pulse circuit closed.`,
    suggestedFix: null
  };
}

export function formatInstantSms(failures = []) {
  const lines = failures.map((f) => `${f.id}: ${String(f.detail || "").slice(0, 120)}`);
  return (
    "Fundhub alert (instant pulse): " +
    lines.join(" | ") +
    " Suggested fixes are on today's pulse board. Nothing was auto-fixed."
  );
}

export async function recentInstantAlert(db, { orgId, fingerprint, sinceMs }) {
  if (!db || !orgId) return false;
  const since = new Date(sinceMs);
  const { rows } = await db.query(
    `SELECT 1 FROM agent_runs
      WHERE org_id = $1::uuid
        AND agent_code = $2
        AND created_at >= $3::timestamptz
        AND detail LIKE $4
      LIMIT 1`,
    [orgId, INSTANT_AGENT_CODE, since, `%${fingerprint}%`]
  );
  return Boolean(rows[0]);
}

export async function recordInstantAlert(db, { orgId, fingerprint, detail, sent }) {
  if (!db || !orgId) return { recorded: false };
  await db.query(
    `INSERT INTO agent_runs (org_id, agent_code, trigger_event, channel, mode, outcome, detail)
     VALUES ($1, $2, 'cron.pulse-instant-watch', 'sms', 'live', $3, $4)`,
    [orgId, INSTANT_AGENT_CODE, sent ? "pass" : "fail", `${fingerprint} | ${String(detail || "").slice(0, 1800)}`]
  );
  return { recorded: true };
}

/**
 * runInstantWatch — critical uptime + outbound stuck. Returns failures and the alert result.
 * The result key stays `sms` (callers read it). `sms.sent` is true when the text OR the email copy went out.
 */
export async function runInstantWatch({
  db,
  env = process.env,
  fetchImpl = globalThis.fetch,
  baseUrl,
  now = new Date(),
  sendImpl = sendSms,
  emailImpl = sendEmail,
  cooldownMs = INSTANT_COOLDOWN_MS
} = {}) {
  const origin = String(baseUrl || process.env.URL || "https://fundhub.ai").replace(/\/+$/, "");
  const checks = [
    await checkHealth({ fetchImpl, baseUrl: origin }),
    await checkLogin({ fetchImpl, baseUrl: origin }),
    await checkApplyDoor({ fetchImpl, baseUrl: origin }),
    await checkFunnelRoadmapSales({
      fetchImpl,
      baseUrl: String(env.FUNNEL_URL || DEFAULT_FUNNEL_BASE_URL)
    })
  ];
  /* A DEAD DATABASE STILL TEXTS. This alarm matters most when the database is
     down, and it used to crash right there, reading the database before it
     texted (proved 2026-10-09 by gap-outside-inngest). Now an unreadable
     database is one red row. With no database there is no cooldown record, so
     it texts only on the runs in the first 5 minutes of each half hour: at most
     2 texts an hour, the first within 30 minutes. */
  let orgId = null;
  let dbDown = false;
  if (db) {
    try {
      orgId = await defaultOrgId(db);
      if (orgId) {
        const [motion, pulseRunner] = await Promise.all([
          readPipelineMotionCounts(db, { orgId, now }),
          checkPulseRunnerReceipt(db, { now })
        ]);
        if (motion.outbound_stuck > 0) {
          checks.push({
            id: "pipeline:outbound",
            status: "FAIL",
            detail: `${motion.outbound_stuck} outbound message(s) queued over 30 minutes`,
            suggestedFix: "Check message dispatch."
          });
        }
        if (pulseRunner) checks.push(pulseRunner);
      }
    } catch (err) {
      dbDown = true;
      orgId = null;
      checks.push({
        id: "db",
        status: "FAIL",
        detail: `The database could not be read: ${String((err && err.message) || err).slice(0, 120)}`,
        suggestedFix: "Check https://fundhub.ai/api/health and the Supabase project."
      });
    }
  }
  const failures = checks.filter((c) => c.status === "FAIL");
  if (!failures.length) {
    return { ok: true, failures: [], sms: { sent: false, reason: "all_pass" } };
  }
  /* TEXTING HOURS (owner law 2026-10-09, .claude/rules/texting-hours.md). Outside 6 a.m. to 10 p.m.
     Arizona time: no text, and no alert row either. The cooldown reads those rows, so writing one here
     would keep the first run inside the window quiet. With none, a critical door that is still down at
     6:00 a.m. is texted on that first run. */
  if (!inTextWindow(now)) {
    return { ok: true, failures, sms: { sent: false, reason: HELD } };
  }
  const fingerprint = failures.map((f) => f.id).sort().join(",");
  const sinceMs = now.getTime() - cooldownMs;
  if (dbDown && now.getUTCMinutes() % 30 >= 5) {
    return { ok: true, failures, sms: { sent: false, reason: "db_down_wait" } };
  }
  let inCooldown = false;
  if (db && orgId) {
    try {
      inCooldown = await recentInstantAlert(db, { orgId, fingerprint, sinceMs });
    } catch {
      inCooldown = false;
    }
  }
  if (inCooldown) {
    return { ok: true, failures, sms: { sent: false, reason: "cooldown" } };
  }
  const to = chrisPulseSmsTo(env);
  const body = formatInstantSms(failures);
  /* ONE ROAD OUT: textMorningBrief. It sends the text to PULSE_SMS_TO and, in the same breath, the email copy
     to PULSE_EMAIL_TO (the Twilio account is inactive, so the email is the copy that actually arrives). It
     holds outside texting hours, counts the alert as delivered when either one went out, and never throws.
     dryRun is false ON PURPOSE: that function defaults to true. The cooldown above is unchanged. */
  let sms = { sent: false, reason: "no_dest", body, to: null };
  try {
    const brief = await textMorningBrief({
      body,
      env,
      dryRun: false,
      now,
      sendImpl: async (message, options) => {
        try {
          return await sendImpl({ id: `pulse-instant-${now.getTime()}`, ...message }, { ...options, fetchImpl });
        } catch (err) {
          // A throwing text sender must not hide the email copy that is sent beside it.
          return { status: "failed", error: String((err && err.message) || err).slice(0, 160) };
        }
      },
      emailImpl: (message, options) => emailImpl(message, { ...options, fetchImpl })
    });
    const delivered = brief.delivery_status === "sent";
    sms = {
      sent: delivered,
      reason: delivered ? "sent" : brief.delivery_status === "no_number" ? "no_dest" : brief.error || brief.delivery_status,
      body,
      to: to ? to.slice(-4) : null,
      text_status: brief.text_status ?? null,
      email_status: brief.email_status ?? null
    };
  } catch (err) {
    sms = { sent: false, reason: String((err && err.message) || err).slice(0, 160), body, to: to ? to.slice(-4) : null };
  }
  if (db && orgId) {
    try {
      await recordInstantAlert(db, { orgId, fingerprint, detail: body, sent: sms.sent });
    } catch {
      // The text already went. A failed record only means the next run may text again.
    }
  }
  return { ok: true, failures, sms };
}
