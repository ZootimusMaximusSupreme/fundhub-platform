// A companion alert is allowed only after the ordinary email/SMS dispatcher
// records a real provider send. Never place message copy on the lock screen.
import { inDripWindow } from "../messaging/send-window.mjs";
import { FINANCE_TEXT_KEYS, companionForFinanceText } from "./finance-alerts.mjs";

export const PROMOTIONAL_KEY = /^(?:BS-|(?:SMS|EMAIL)-(?:BS|NOBOOK|S05A|SLO|OFFER|N[0-9]{2}|AISET03|S02))/;
const BS_PRECALL_SMS = "SMS-BS01-02-PRECALL";
const BOOKING_CONFIRM_SMS = "SMS-S04-01-CONFIRM";
const DECK_KEYS = ["EMAIL-BS-DECK-LESSON", "SMS-BS-DECK"];
const DECK_PUSH_SLUGS = ["the-call", "who-we-are", "the-money-talk"];

async function lessonPath(db, message) {
  if (!DECK_KEYS.includes(message.template_key)) return null;
  if (message.channel !== (message.template_key.startsWith("EMAIL-") ? "email" : "sms")) return null;
  const prefix = `workflow:${message.template_key}:bs-deck:${message.client_id}:`;
  const ref = String(message.provider_ref || "");
  let slug;
  if (ref.startsWith(prefix)) slug=ref.slice(prefix.length);
  else {
    const match=/:precall-plan:([0-9a-f-]{36})$/i.exec(ref);
    if (!match) return null;
    const row=(await db.query(`SELECT deck_slug FROM precall_send_plans
      WHERE id=$1 AND org_id=$2 AND client_id=$3 AND status='queued' LIMIT 1`,
      [match[1],message.org_id,message.client_id])).rows[0];
    slug=row?.deck_slug;
    if (!slug || !String(message.rendered_body || '').includes(`https://fundhub.ai/slideshows/${slug}.html`)) return null;
  }
  return DECK_PUSH_SLUGS.includes(slug) ? `/slideshows/${slug}.html` : null;
}

export async function notificationForSentMessage(db, message, { now = new Date() } = {}) {
  if (!message?.client_id || !["email", "sms"].includes(message.channel)) return null;

  const key = String(message.template_key || "");
  if (key === BOOKING_CONFIRM_SMS) return { kind: "call_confirmation" };
  // A card-due or pay-before-close text: its finance phone alert, when the daily
  // pass queued one, is the buzz for this event (src/push/finance-alerts.mjs).
  if (FINANCE_TEXT_KEYS.has(key)) return companionForFinanceText(db, message);
  if (!PROMOTIONAL_KEY.test(key)) return { kind: "update" };

  // The three planned lesson alerts follow successful source messages. The
  // email/SMS remains delivered even when push is unavailable or capped.
  const path = await lessonPath(db,message);
  if (key !== BS_PRECALL_SMS && !path) return null;
  if (path && !inDripWindow(now)) return null;

  const { rows: clients } = await db.query(
    `SELECT custom_fields FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [message.client_id, message.org_id]
  );
  if (clients[0]?.custom_fields?.marketing_push_enabled !== true) return null;

  // Marketing permission does not override a STOP/unsubscribe on either
  // ordinary channel. The source SMS gate already checks SMS, but this extra
  // check also keeps a later email opt-out from becoming a push workaround.
  const { rows: optOuts } = await db.query(
    `SELECT 1 FROM opt_outs
      WHERE client_id = $1 AND org_id = $2
        AND channel IN ('sms', 'email') AND opted_in_at IS NULL
      LIMIT 1`,
    [message.client_id, message.org_id]
  );
  if (optOuts.length > 0) return null;

  // Both the call card and the pre-call lessons need a current future call.
  const { rows: bookings } = await db.query(
    `SELECT 1 FROM (
       SELECT * FROM bookings WHERE org_id = $1 AND client_id = $2
       ORDER BY created_at DESC, updated_at DESC LIMIT 1
     ) b
     LEFT JOIN events booked ON booked.id::text = b.raw->>'__event_id'
       AND booked.client_id = b.client_id
     WHERE b.status IN ('booked', 'rescheduled') AND b.starts_at > $3::timestamptz
       AND ($4::boolean OR b.starts_at <= $3::timestamptz + interval '72 hours')
       AND NOT EXISTS (SELECT 1 FROM events held
         WHERE held.client_id = b.client_id AND held.name = 'call.completed'
           AND COALESCE(held.payload->>'outcome', '') <> 'no_show'
           AND held.created_at >= COALESCE(booked.created_at, b.created_at))`,
    [message.org_id, message.client_id, now.toISOString(), Boolean(path)]
  );
  if (!bookings.length) return null;

  // Only actual push sends and in-flight claims use the allowance. A failed
  // source email or a device-free attempt cannot spend a push slot.
  const { rows: counts } = await db.query(
    `SELECT
       count(*) FILTER (WHERE updated_at > $3::timestamptz - interval '24 hours')::int AS last_day,
       count(*)::int AS last_week
       FROM messages
      WHERE org_id = $1 AND client_id = $2
        AND channel = 'push' AND status IN ('sending', 'sent')
        AND updated_at > $3::timestamptz - interval '7 days'`,
    [message.org_id, message.client_id, now.toISOString()]
  );
  if (counts[0]?.last_day == null || counts[0]?.last_week == null) return null;
  const lastDay = Number(counts[0]?.last_day);
  const lastWeek = Number(counts[0]?.last_week);
  if (!Number.isFinite(lastDay) || !Number.isFinite(lastWeek) || lastDay >= 1 || lastWeek >= 3) {
    return null;
  }
  return path ? { kind: "check_in", url: path } : { kind: "check_in" };
}

export async function claimMarketingPush(db, message, notification, { now = new Date() } = {}) {
  if (!message?.id || !message.client_id || !message.org_id || notification?.kind !== "check_in") return null;
  if (!inDripWindow(now)) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const ref = `marketing-push:${message.client_id}:${date.year}-${date.month}-${date.day}`;
  // The existing unique org/provider_ref index is the race guard: concurrent
  // source messages share one Arizona-day claim. Rolling limits also stop a
  // next-day send less than 24 hours after a successful prior alert. Claims
  // are restricted to 9–5 Arizona, so two different day keys cannot race at
  // midnight. An unknown provider outcome remains in-flight; it must not be
  // retried automatically and risk buzzing the phone twice.
  const result = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key,
       rendered_body, provider_ref, status, compliance_check_passed)
     SELECT $1, $2, 'outbound', 'push', 'BS-COMPANION-PUSH', $3, $4, 'sending', true
     WHERE NOT EXISTS (SELECT 1 FROM messages
       WHERE org_id = $1 AND client_id = $2 AND channel = 'push'
         AND status IN ('sending', 'sent')
         AND updated_at > $5::timestamptz - interval '24 hours')
       AND (SELECT count(*) FROM messages
         WHERE org_id = $1 AND client_id = $2 AND channel = 'push'
           AND status IN ('sending', 'sent')
           AND updated_at > $5::timestamptz - interval '7 days') < 3
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL
     DO UPDATE SET status = 'sending', rendered_body = EXCLUDED.rendered_body,
       last_error = NULL, updated_at = now()
       WHERE messages.status = 'failed'
     RETURNING id`,
    [message.org_id, message.client_id, JSON.stringify({ source_message_id: message.id,
      url: notification.url || "/app/client-portal.html" }), ref, now.toISOString()]
  );
  return result.rows[0]?.id || null;
}

export async function recordMarketingPush(db, id, results) {
  const delivered = results.reduce((total, result) => total +
    (result.status === "fulfilled" ? Number(result.value?.sent || 0) : 0), 0);
  const unknown = results.some(result => result.status !== "fulfilled"
    || !result.value || !Number.isFinite(result.value.sent) || result.value.sent < 0
    || Number(result.value.unknown || 0) > 0);
  const state = delivered > 0 ? "sent" : unknown ? "sending" : "failed";
  await db.query(`UPDATE messages SET status = $2, provider = 'apns_web_push',
    last_error = $3, updated_at = now() WHERE id = $1`,
  [id, state, delivered > 0 ? null : unknown
    ? "Push outcome unknown; review before resending."
    : "No push device accepted this alert."]);
}

export default { notificationForSentMessage };
