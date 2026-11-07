// Finance OS phone alerts — queue, deliver, and read. Unit D of the Finance OS CFO
// build (owner-set 2026-11-06: "MOST IMPORTANT").
//
// EIGHT ALERTS: a card payment due soon, pay before a card's statement closes, an
// important bill charging soon, and (D2, owner-set 2026-11-07: "business credit
// cards, lines of credit, any loan payment") a loan payment, a credit line payment
// and a payment-plan installment owed to Fundhub (Clarity Payments), and (AL2,
// 2026-11-07) an alert or a repeat bill the client added by hand. Which one is
// owed, and its key, is decided by src/finance/file-alerts/phone-alerts.mjs (pure).
// This file writes and sends. A Whop plan's next charge (unit W, owner ask 2026-11-07)
// rides the payment-plan push: kind plan_due, key whop:<whop_memberships id>:<day>.
//
// QUEUE, THEN THE DISPATCHER DELIVERS — the same shape as every text.
//   1. The daily file-alerts pass (src/finance/file-alerts/run.mjs) calls
//      queuePhoneAlert: ONE messages row, channel 'push', status 'queued',
//      provider_ref finance-push:<key>. The unique (org_id, provider_ref) index is
//      what makes it one push per card or bill per cycle. The row carries no send
//      time: the dispatcher is the one writer of messages.scheduled_at (the
//      held-message heartbeat, MESSAGE_HELD_SQL in
//      src/pulse/catalog/proofs/fin-b04-sql-messages.mjs, rests on that). Outside
//      9 a.m. to 5 p.m. Arizona the dispatcher puts the row back for the next
//      9 a.m. (sendAfter), so it waits (owner-set 2026-10-31: drip and follow-up
//      sends 9 to 5 Arizona time).
//   2. The dispatcher (src/messaging/dispatch.mjs) claims it like any queued row
//      and hands it to deliverPhoneAlert, which re-checks the window, the dry-run
//      fence, the opt-outs and the switches, and only then calls the two phone
//      pipes the dispatcher passes in (iPhone app and web push). This file imports
//      no transport: the dispatcher hands both in, so the only code that reaches
//      Apple or a push service is still src/push/native-send.mjs and send.mjs.
//
// THE LOCK SCREEN. The body is one of three fixed sentences in src/push/payload.mjs,
// chosen by kind: no amount, no bank name, no account digits, no card name. The
// tap opens /app/financeos.html#alerts. payload.mjs refuses anything else.
//
// NEVER TWICE. A row whose push outcome is unknown stays 'sending' and is never
// sent again by anything (the same rule as the marketing check-in push). Only a
// 'failed' row is re-armed by a later pass inside the same window (no phone yet,
// or every phone refused it). A 'blocked' row is an audit record and is never
// re-armed (db/migrations/110_messages_outbound.sql).
//
// OPT-OUTS. A client gets no finance push when: they switched phone alerts off on
// the Alerts screen (file_protection_settings.phone_alerts), they hold an active
// STOP on texts or an opt-out on push (opt_outs, channel 'sms' or 'push'), or —
// for a statement-close push — they switched the pay-before-close alert off. Each
// is read when the row is queued AND again when it is sent.
//
// NOTHING HERE LOGS A TOKEN OR AN ENDPOINT. Row ids and status words only.

import { buildPushPayload, FINANCE_ALERTS_URL, FINANCE_PAYMENTS_URL } from "./payload.mjs";
import { inDripWindow, nextDripWindowOpen } from "../messaging/send-window.mjs";
import { fenceVerdict, MESSAGING_DRY_RUN } from "../lib/dry-run.mjs";
import { isSynthetic } from "../messaging/live-fence.mjs";
import { daysBetween } from "../banking/statement-cycles.mjs";
import { TEMPLATE_KEY as CARD_DUE_SMS } from "../banking/card-due-reminders.mjs";
import { TEMPLATES as FILE_ALERT_SMS } from "../finance/file-alerts/common.mjs";
import {
  PUSH_TEMPLATES, PUSH_KINDS, PUSH_REF_PREFIX, PUSH_TEMPLATE_PREFIX, PHONE_LABELS,
  pushRef, kindOfTemplate, eventDateOfKey, subjectIdOfKey
} from "../finance/file-alerts/phone-alerts.mjs";
import { isCustomOccurrence } from "../pulse/beats/lib/custom-alert-plan.mjs";
import { isWhopKey, whopIdOfKey } from "../pulse/beats/lib/whop-plan-push.mjs";

/** Outcome words the dispatcher already uses (OUTCOME in src/messaging/dispatch.mjs).
 *  Spelled here, not imported, so this file and the dispatcher do not import each
 *  other; finance-alerts.test.mjs holds them equal. */
export const PUSH_OUTCOME = Object.freeze({
  SENT: "sent",
  DEFERRED: "deferred",
  DRY_RUN: "dry_run",
  BLOCKED: "blocked",
  SYNTHETIC: "synthetic",
  NO_ADDRESS: "no_address",
  REJECTED: "rejected"
});

export const UNKNOWN_OUTCOME_NOTE = "Push outcome unknown; review before resending.";
export const NO_PHONE_NOTE = "no_push_device";

/** Where a tap opens: a payment-plan alert at Payments (the plan and its schedule),
 *  every other at Alerts. */
export function tapFor(kind) {
  return kind === "plan_due" ? FINANCE_PAYMENTS_URL : FINANCE_ALERTS_URL;
}

/** The fixed lock-screen payload for one phone alert kind. Throws if it is not approved. */
export function lockScreenFor(kind) {
  const pushKind = PUSH_KINDS[kind];
  if (!pushKind) throw new Error(`unknown phone alert kind ${String(kind).slice(0, 40)}`);
  return JSON.parse(buildPushPayload({ kind: pushKind, url: tapFor(kind) }));
}

/** Can this server reach a phone at all? Same keys the dispatcher checks for its companion alert. */
export function nativePushReady(env = process.env) {
  return Boolean(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY_BASE64 && env.PUSH_SUB_ENC_KEY);
}
export function webPushReady(env = process.env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.PUSH_SUB_ENC_KEY);
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/* A phone that can take an alert: a live iPhone app device on an active client
   session (the exact join src/push/native-store.mjs listNativeDevices uses), or a
   live web push subscription. And whether the client said stop. ($1 org, $2 client.) */
export const PHONE_STATE_SQL = `
SELECT EXISTS (
         SELECT 1 FROM client_apns_devices d
           JOIN accounts a ON a.id = d.account_id AND a.org_id = d.org_id AND a.status = 'active'
           JOIN account_sessions s ON s.id = d.session_id AND s.account_id = d.account_id
            AND s.org_id = d.org_id AND s.revoked_at IS NULL AND s.expires_at > now()
          WHERE d.org_id = $1 AND d.client_id = $2
            AND d.expired_at IS NULL AND d.revoked_at IS NULL
            AND ((a.kind = 'client' AND a.client_id = d.client_id)
              OR (a.kind = 'authorized_rep' AND s.active_client_id = d.client_id))
       )
    OR EXISTS (
         SELECT 1 FROM client_push_subscriptions p
          WHERE p.org_id = $1 AND p.client_id = $2
            AND p.expired_at IS NULL AND p.revoked_at IS NULL
       ) AS has_phone,
       EXISTS (
         SELECT 1 FROM opt_outs o
          WHERE o.client_id = $2 AND o.org_id = $1
            AND o.channel IN ('sms', 'push') AND o.opted_in_at IS NULL
       ) AS opted_out`.trim();

/** phoneState → { hasPhone, optedOut }. */
export async function phoneState(conn, { orgId, clientId }) {
  const r = await conn.query(PHONE_STATE_SQL, [orgId, clientId]);
  const row = r.rows[0] || {};
  return { hasPhone: row.has_phone === true, optedOut: row.opted_out === true };
}

/** The screen's list of phone alerts, newest first. ($1 org, $2 client, $3 limit.) */
export const PHONE_ALERTS_SQL = `
SELECT id, template_key, provider_ref, status, blocked_reason, last_error,
       scheduled_at, created_at, updated_at
  FROM messages
 WHERE org_id = $1 AND client_id = $2
   AND channel = 'push' AND template_key LIKE '${PUSH_TEMPLATE_PREFIX}%'
 ORDER BY created_at DESC
 LIMIT $3`.trim();

/** What a row's status means, in one word the screen can show. */
export function phoneAlertState(row = {}) {
  const status = String(row.status || "");
  if (status === "sent") return "sent";
  if (status === "queued") return "waiting";
  if (status === "sending") return row.last_error === UNKNOWN_OUTCOME_NOTE ? "unknown" : "sending";
  if (status === "blocked") return "stopped";
  if (status === "failed") return row.last_error === NO_PHONE_NOTE ? "no_phone" : "not_sent";
  return "unknown";
}

export async function listPhoneAlerts(conn, { orgId, clientId, limit = 20 }) {
  const r = await conn.query(PHONE_ALERTS_SQL, [orgId, clientId, Math.max(1, Math.min(100, Number(limit) || 20))]);
  return r.rows.map((row) => {
    const kind = kindOfTemplate(row.template_key);
    const key = String(row.provider_ref || "").startsWith(PUSH_REF_PREFIX)
      ? String(row.provider_ref).slice(PUSH_REF_PREFIX.length) : null;
    return {
      id: row.id,
      kind,
      kind_label: kind ? PHONE_LABELS[kind] : null,
      subject_id: subjectIdOfKey(key),
      about_on: eventDateOfKey(key),
      state: phoneAlertState(row),
      reason: row.status === "blocked" ? row.blocked_reason ?? null : null,
      send_at: row.scheduled_at ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null
    };
  });
}

/* ------------------------------------------------------------------ *
 * Queue — called by the daily pass
 * ------------------------------------------------------------------ */

/** When a phone alert claimed now may go: now inside the 9-to-5 window, else the
 *  next 9 a.m. Arizona. The dispatcher holds the row to this time. */
export function sendAfter(now = new Date()) {
  const at = new Date(now);
  return inDripWindow(at) ? null : nextDripWindowOpen(at).toISOString();
}

/* ON CONFLICT re-arms only a 'failed' push row of the same client. A queued,
   sending, sent or blocked row is left exactly as it is — the cycle's one push. */
const QUEUE_SQL = `
INSERT INTO messages (org_id, client_id, direction, channel, template_key,
                      rendered_body, provider_ref, status, compliance_check_passed)
VALUES ($1, $2, 'outbound', 'push', $3, $4, $5, 'queued', true)
ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL
DO UPDATE SET status = 'queued', attempts = 0,
              last_error = NULL, updated_at = now()
 WHERE messages.status = 'failed' AND messages.channel = 'push'
   AND messages.client_id = EXCLUDED.client_id
RETURNING id, (xmax = 0) AS inserted`.trim();

/**
 * queuePhoneAlert(conn, { orgId, clientId, plan }) → { queued, messageId, rearmed, reason }
 *
 * `plan` is one owed plan from planPhoneAlerts (kind, key). Writes one row and
 * sends nothing. The row has no send time; the dispatcher holds it to 9 a.m.
 */
export async function queuePhoneAlert(conn, { orgId, clientId, plan }) {
  if (!orgId || !clientId) throw new Error("a phone alert needs an organization and a client");
  const template = plan && PUSH_TEMPLATES[plan.kind];
  if (!template || !plan.key) throw new Error("a phone alert needs a known kind and a key");
  const body = lockScreenFor(plan.kind).body;
  const r = await conn.query(QUEUE_SQL, [orgId, clientId, template, body, pushRef(plan.key)]);
  const row = r.rows[0];
  if (!row) return { queued: false, messageId: null, rearmed: false, reason: "already_queued" };
  return { queued: true, messageId: row.id, rearmed: row.inserted === false, reason: null };
}

/* ------------------------------------------------------------------ *
 * Deliver — called by the dispatcher for a claimed channel 'push' row
 * ------------------------------------------------------------------ */

/* What the client has switched off, read fresh at send time.
   ($1 org, $2 client, $3 bill id or null, $4 plan installment id or null,
   $5 the client's own alert or bill id or null, $6 Whop plan id or null: the day
   that plan still charges, unit W.) */
export const STILL_WANTED_SQL = `
SELECT c.custom_fields,
       (SELECT s.phone_alerts FROM file_protection_settings s
         WHERE s.client_id = c.id AND s.org_id = c.org_id) AS phone_alerts,
       (SELECT s.payment_timing FROM file_protection_settings s
         WHERE s.client_id = c.id AND s.org_id = c.org_id) AS payment_timing,
       EXISTS (SELECT 1 FROM opt_outs o
                WHERE o.client_id = c.id AND o.org_id = c.org_id
                  AND o.channel IN ('sms', 'push') AND o.opted_in_at IS NULL) AS opted_out,
       (SELECT b.important FROM recurring_bills b
         WHERE b.id = $3::uuid AND b.org_id = c.org_id AND b.client_id = c.id) AS bill_important,
       (SELECT (i.amount_cents - i.paid_cents) FROM clarity_payment_installments i
          JOIN clarity_payments p ON p.id = i.clarity_payment_id
         WHERE i.id = $4::uuid AND p.org_id = c.org_id AND p.client_id = c.id
           AND p.status = 'open') AS plan_left_cents,
       (SELECT json_build_object('kind', f.kind, 'phone_alert', f.phone_alert, 'archived', f.archived_at IS NOT NULL,
                                 'cadence', f.cadence, 'day_of_month', f.day_of_month, 'start_on', f.start_on::text)
          FROM finance_custom_alerts f
         WHERE f.id = $5::uuid AND f.org_id = c.org_id AND f.client_id = c.id) AS custom_row,
       (SELECT w.period_end_on::text FROM whop_memberships w
         WHERE w.id = $6::uuid AND w.org_id = c.org_id AND w.client_id = c.id
           AND w.unlinked_at IS NULL AND w.status IN ('trialing', 'active')
           AND NOT w.cancel_at_period_end AND COALESCE(w.renewal_cents, 0) > 0
           AND (w.split_pay_required IS NULL OR COALESCE(w.split_pay_paid, 0) < w.split_pay_required)) AS whop_charge_on
  FROM clients c
 WHERE c.id = $2 AND c.org_id = $1`.trim();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The bill id inside an important-bill key (bill:<id>:<date>), or null. */
export function billIdOfKey(key) {
  const m = /^bill:([^:]+):\d{4}-\d{2}-\d{2}$/.exec(String(key || ""));
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

/** The installment id inside a payment-plan key (plan:<id>:<date>), or null. */
export function installmentIdOfKey(key) {
  const m = /^plan:([^:]+):\d{4}-\d{2}-\d{2}$/.exec(String(key || ""));
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

/** The id inside a key for an alert or bill the client added (custom:<id>:<date>), or null. */
export function customIdOfKey(key) {
  const m = /^custom:([^:]+):\d{4}-\d{2}-\d{2}$/.exec(String(key || ""));
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

const CUSTOM_KINDS = Object.freeze({ custom_alert: "alert", custom_bill: "bill" });

/** Why this push must not go now, or null. Pure over the STILL_WANTED_SQL row.
 *  `eventOn` is the date the key is about; `key` is the push's own key (a Whop plan
 *  is judged by its key, unit W). */
export function stopReason(kind, row, { eventOn = null, key = null } = {}) {
  if (!row) return "client_not_found";
  if (row.opted_out === true) return "opted_out";
  if (row.phone_alerts === false) return "phone_alerts_off";
  if (kind === "statement_close" && row.payment_timing === false) return "alert_off";
  if (kind === "important_bill" && row.bill_important !== true) return "not_important";
  // A Whop plan (unit W): it must still charge on the very day this push is about. Ended,
  // paid off, or moved since the pass queued it: "due soon" would be wrong.
  if (kind === "plan_due" && isWhopKey(key)) {
    return row.whop_charge_on && row.whop_charge_on === eventDateOfKey(key) ? null : "not_due";
  }
  // Paid, settled or gone since the pass queued it: "due soon" would be wrong.
  if (kind === "plan_due" && !(Number(row.plan_left_cents) > 0)) return "paid";
  if (CUSTOM_KINDS[kind]) {
    const c = row.custom_row;
    // Removed, switched off, or moved to another day since the pass queued it.
    if (!c || c.archived === true || c.kind !== CUSTOM_KINDS[kind]) return "removed";
    if (c.phone_alert === false) return "alert_off";
    if (!eventOn || !isCustomOccurrence(c, eventOn)) return "date_changed";
  }
  return null;
}

async function finish(db, message, status, outcome, detail, { provider = null, blockedReason = null } = {}) {
  if (status === "blocked") {
    await db.query(
      `UPDATE messages SET status = 'blocked', blocked_reason = $2, blocked_at = now(),
              provider = NULL, updated_at = now() WHERE id = $1`,
      [message.id, blockedReason]
    );
  } else {
    await db.query(
      `UPDATE messages SET status = $2, provider = $3, last_error = $4, updated_at = now() WHERE id = $1`,
      [message.id, status, provider, detail ? String(detail).slice(0, 300) : null]
    );
  }
  return { id: message.id, outcome, detail };
}

/**
 * deliverPhoneAlert(db, message, { env, now, sendNative, sendWeb }) → { id, outcome, detail }
 *
 * `message` is a row the dispatcher claimed (status 'sending'). sendNative and
 * sendWeb are the dispatcher's own transports (sendNativeToClient, sendToClient).
 */
export async function deliverPhoneAlert(db, message, { env = process.env, now, sendNative, sendWeb } = {}) {
  const clock = typeof now === "function" ? now : now ? () => new Date(now) : () => new Date();
  const kind = kindOfTemplate(message.template_key);
  const ref = String(message.provider_ref || "");
  if (!kind || !ref.startsWith(PUSH_REF_PREFIX) || !message.client_id || !message.org_id) {
    return finish(db, message, "failed", PUSH_OUTCOME.REJECTED, "This push row has no approved sender.");
  }
  const key = ref.slice(PUSH_REF_PREFIX.length);

  // 1. The window. An unopened window is not a failed delivery: the attempt is
  //    given back. The dispatcher holds a row to 9 a.m. before it gets here; this
  //    re-check only gives the row back (no send time: the dispatcher is the one
  //    writer of messages.scheduled_at), and the next sweep holds it.
  const at = clock();
  if (!inDripWindow(at)) {
    await db.query(
      `UPDATE messages SET status = 'queued', attempts = GREATEST(attempts - 1, 0)
        WHERE id = $1`,
      [message.id]
    );
    return { id: message.id, outcome: PUSH_OUTCOME.DEFERRED, detail: nextDripWindowOpen(at).toISOString() };
  }

  // 2. The dry-run fence holds, it does not fail (same bookkeeping as the dispatcher's hold()).
  const fence = fenceVerdict(MESSAGING_DRY_RUN, env);
  if (!fence.allowed) {
    await db.query(
      `UPDATE messages SET status = 'queued', last_error = $2, attempts = GREATEST(attempts - 1, 0) WHERE id = $1`,
      [message.id, `${fence.reason} (push)`]
    );
    return { id: message.id, outcome: PUSH_OUTCOME.DRY_RUN, detail: fence.reason };
  }

  // 3. Too late is never sent: a "due soon" push after the day it was about would be wrong.
  const eventOn = eventDateOfKey(key);
  const today = at.toISOString().slice(0, 10);
  if (eventOn && daysBetween(today, eventOn) < 0) {
    return finish(db, message, "failed", PUSH_OUTCOME.REJECTED, `too_late: this alert was about ${eventOn}`);
  }

  // 4. Still wanted, read fresh.
  const wanted = await db.query(STILL_WANTED_SQL, [
    message.org_id, message.client_id, billIdOfKey(key), installmentIdOfKey(key), customIdOfKey(key), whopIdOfKey(key)
  ]);
  const row = wanted.rows[0] || null;
  if (row && isSynthetic(row)) {
    return finish(db, message, "failed", PUSH_OUTCOME.SYNTHETIC, "this is a test record and the phone pipes are real — refused");
  }
  const stop = stopReason(kind, row, { eventOn, key });
  if (stop) return finish(db, message, "blocked", PUSH_OUTCOME.BLOCKED, stop, { blockedReason: stop });

  // 5. Send through the pipes this server can use.
  const notification = { kind: PUSH_KINDS[kind], url: tapFor(kind) };
  buildPushPayload(notification); // refused here, before anything leaves, if it is ever not approved
  const target = { orgId: message.org_id, clientId: message.client_id, notification, env };
  const sends = [];
  if (nativePushReady(env) && typeof sendNative === "function") sends.push(Promise.resolve().then(() => sendNative(db, target)));
  if (webPushReady(env) && typeof sendWeb === "function") sends.push(Promise.resolve().then(() => sendWeb(db, target)));
  if (!sends.length) {
    return finish(db, message, "failed", PUSH_OUTCOME.REJECTED, "push keys are not set on this server");
  }
  const results = await Promise.allSettled(sends);
  return record(db, message, results);
}

/** Sent, unknown, no phone, or refused — from the pipes' own answers. */
export async function record(db, message, results) {
  let delivered = 0;
  let attempted = 0;
  let unknown = false;
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value || !Number.isFinite(r.value.sent) || r.value.sent < 0) { unknown = true; continue; }
    delivered += Number(r.value.sent) || 0;
    attempted += Number(r.value.attempted) || 0;
    if (Number(r.value.unknown || 0) > 0) unknown = true;
  }
  if (delivered > 0) return finish(db, message, "sent", PUSH_OUTCOME.SENT, null, { provider: "apns_web_push" });
  if (unknown) {
    // Never retried by anything: a second try could buzz the phone twice.
    return finish(db, message, "sending", PUSH_OUTCOME.REJECTED, UNKNOWN_OUTCOME_NOTE, { provider: "apns_web_push" });
  }
  if (attempted === 0) return finish(db, message, "failed", PUSH_OUTCOME.NO_ADDRESS, NO_PHONE_NOTE);
  return finish(db, message, "failed", PUSH_OUTCOME.REJECTED, "No phone accepted this alert.", { provider: "apns_web_push" });
}

/* ------------------------------------------------------------------ *
 * The text's companion — one phone buzz per event, not two
 * ------------------------------------------------------------------ */

/** The money helper's before-the-date reminder for a payment-plan installment
 *  (TEMPLATES.reminder in src/finance/money-agent.mjs; finance-alerts.test.mjs holds
 *  them equal — that module is not imported here, it pulls in the daily jobs). */
export const MONEY_HELPER_REMINDER_SMS = "SMS-MONEY-AGENT-REMINDER";

/** The finance texts a phone alert now speaks for: the card and loan due text, the
 *  pay-before-close text, and the money helper's plan reminder. */
export const FINANCE_TEXT_KEYS = Object.freeze(new Set([CARD_DUE_SMS, FILE_ALERT_SMS.payment_timing, MONEY_HELPER_REMINDER_SMS]));

/** The push ref (exact, or a prefix ending in ':') that covers one finance text's event. */
export function coveringPushRef(templateKey, eventId) {
  if (!eventId) return { exact: null, prefix: null };
  if (templateKey === MONEY_HELPER_REMINDER_SMS) {
    // money-agent:clarity_installment:<installment id>:0 → finance-push:plan:<installment id>:<date>
    const m = /^money-agent:clarity_installment:([^:]+):0$/.exec(eventId);
    return { exact: null, prefix: m && UUID_RE.test(m[1]) ? pushRef(`plan:${m[1]}:`) : null };
  }
  return { exact: pushRef(eventId), prefix: null };
}

/* ($1 org, $2 client, $3 the finance push ref or null, $4 a ref prefix or null.) */
export const COMPANION_SQL = `
SELECT EXISTS (SELECT 1 FROM messages m
                WHERE m.org_id = $1 AND m.client_id = $2 AND m.channel = 'push'
                  AND (m.provider_ref = $3::text OR m.provider_ref LIKE ($4::text || '%'))
                  AND m.status IN ('queued', 'sending', 'sent')) AS covered,
       (SELECT s.phone_alerts FROM file_protection_settings s
         WHERE s.client_id = $2 AND s.org_id = $1) AS phone_alerts`.trim();

/**
 * companionForFinanceText(db, message) → { kind: "update" } or null
 *
 * After a card-due or pay-before-close text is sent, the dispatcher used to add a
 * generic "There is an update on your file" push. When the daily pass already
 * queued the finance push for the same card and the same date, that push IS the
 * phone alert, so the generic one is dropped. A client who switched phone alerts
 * off gets neither. Everyone else keeps exactly today's companion. The text
 * itself is never touched.
 */
export async function companionForFinanceText(db, message) {
  const prefix = `workflow:${message.template_key}:`;
  const ref = String(message.provider_ref || "");
  const eventId = ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
  const cover = coveringPushRef(message.template_key, eventId);
  const r = await db.query(COMPANION_SQL, [message.org_id, message.client_id, cover.exact, cover.prefix]);
  const row = r.rows[0] || {};
  if (row.covered === true) return null;
  if (row.phone_alerts === false) return null;
  return { kind: "update" };
}

/**
 * phoneSummary(conn, { orgId, clientId }) → { enabled, opted_out, has_phone, sent } —
 * what the Payments section needs to say when each plan's phone alert goes.
 */
export async function phoneSummary(conn, { orgId, clientId }) {
  const [settings, state, sent] = await Promise.all([
    conn.query(`SELECT phone_alerts FROM file_protection_settings WHERE org_id = $1 AND client_id = $2`, [orgId, clientId]),
    phoneState(conn, { orgId, clientId }),
    listPhoneAlerts(conn, { orgId, clientId, limit: 50 })
  ]);
  return {
    enabled: settings.rows[0] ? settings.rows[0].phone_alerts !== false : true,
    opted_out: state.optedOut,
    has_phone: state.hasPhone,
    days_before: 3,
    sent: sent.filter((a) => a.kind === "plan_due")
  };
}

export default { queuePhoneAlert, deliverPhoneAlert, listPhoneAlerts, phoneState, phoneSummary, companionForFinanceText };
