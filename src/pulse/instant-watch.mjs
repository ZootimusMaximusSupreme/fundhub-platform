// Instant pulse — text Chris when a critical door breaks between morning checks.
// Audit only on the read side; the text is the alert. Never auto-fixes product code.

import { checkHealth, checkLogin, checkApplyDoor, defaultOrgId } from "./daily-pulse.mjs";
import { checkFunnelRoadmapSales, DEFAULT_FUNNEL_BASE_URL } from "./funnel-doors.mjs";
import { readPipelineMotionCounts } from "./pipeline-motion.mjs";
import { normalizeUsNumber } from "./notify.mjs";
import { send as sendSms } from "../messaging/providers/twilio.mjs";

export const INSTANT_AGENT_CODE = "pulse-instant";
export const INSTANT_COOLDOWN_MS = 60 * 60 * 1000;
export const CRITICAL_CHECK_IDS = Object.freeze([
  "health",
  "login",
  "apply",
  "funnel:roadmap-sales",
  "pipeline:outbound"
]);

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
 * runInstantWatch — critical uptime + outbound stuck. Returns failures and SMS result.
 */
export async function runInstantWatch({
  db,
  env = process.env,
  fetchImpl = globalThis.fetch,
  baseUrl,
  now = new Date(),
  sendImpl = sendSms,
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
        const motion = await readPipelineMotionCounts(db, { orgId, now });
        if (motion.outbound_stuck > 0) {
          checks.push({
            id: "pipeline:outbound",
            status: "FAIL",
            detail: `${motion.outbound_stuck} outbound message(s) queued over 30 minutes`,
            suggestedFix: "Check message dispatch."
          });
        }
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
  const to = normalizeUsNumber(String(env.PULSE_SMS_TO || env.CHRIS_PULSE_SMS || "").trim());
  const body = formatInstantSms(failures);
  let sms = { sent: false, reason: "no_dest", body, to: null };
  if (to) {
    try {
      const res = await sendImpl({ id: `pulse-instant-${now.getTime()}`, to, body, channel: "sms" }, { env, fetchImpl });
      sms = { sent: res?.ok === true || res?.status === "sent", reason: res?.error || res?.status || "sent", body, to: to.slice(-4) };
    } catch (err) {
      sms = { sent: false, reason: String((err && err.message) || err).slice(0, 160), body, to: to.slice(-4) };
    }
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
