// A companion alert is allowed only after the ordinary email/SMS dispatcher
// records a real provider send. Never place message copy on the lock screen.
import { meetingDestination } from "../bookings/meeting-link.mjs";

export const PROMOTIONAL_KEY = /^(?:BS-|(?:SMS|EMAIL)-(?:BS|NOBOOK|S05A|SLO|OFFER|N[0-9]{2}|AISET03|S02))/;
const BS_PRECALL_SMS = "SMS-BS01-02-PRECALL";
const BOOKING_CONFIRM_SMS = "SMS-S04-01-CONFIRM";
const HANDOFF_SMS = "SMS-AISET04-HANDOFF";
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;

async function callInviteForHandoff(db, message, now) {
  if (message.channel !== "sms") return null;
  // sendTemplated writes this exact, unique provider_ref from the client and
  // call time. A normal text or a replay with no matching key is not an invite.
  const prefix = `workflow:${HANDOFF_SMS}:booking-start:${message.client_id}:`;
  const ref = String(message.provider_ref || "");
  if (!ref.startsWith(prefix)) return null;
  const callTime = ref.slice(prefix.length);
  const startMs = Date.parse(callTime);
  if (!Number.isFinite(startMs) || new Date(startMs).toISOString() !== callTime) return null;
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs) || nowMs < startMs - FIFTEEN_MINUTES || nowMs >= startMs) return null;

  const { rows } = await db.query(
    `SELECT id, starts_at, ends_at, meeting_url FROM bookings
      WHERE org_id = $1 AND client_id = $2
        AND starts_at = $3::timestamptz
        AND status IN ('booked', 'rescheduled')
      ORDER BY created_at DESC LIMIT 2`,
    [message.org_id, message.client_id, callTime]
  );
  // Two same-time rows are ambiguous; choosing either may invite the wrong call.
  if (rows.length !== 1 || new Date(rows[0].starts_at).getTime() !== startMs ||
      !meetingDestination(rows[0].meeting_url)) return null;
  const endMs = rows[0].ends_at == null ? Infinity : new Date(rows[0].ends_at).getTime();
  if (!Number.isFinite(endMs) && endMs !== Infinity) return null;
  const expiryMs = Math.min(endMs, startMs + THIRTY_MINUTES);
  if (expiryMs <= nowMs) return null;
  return { kind: "call_invite", expiresAt: new Date(expiryMs).toISOString() };
}

export async function notificationForSentMessage(db, message, { now = new Date() } = {}) {
  if (!message?.client_id || !["email", "sms"].includes(message.channel)) return null;

  const key = String(message.template_key || "");
  if (key === BOOKING_CONFIRM_SMS) return { kind: "call_confirmation" };
  if (key === HANDOFF_SMS) return callInviteForHandoff(db, message, now);
  if (!PROMOTIONAL_KEY.test(key)) return { kind: "update" };

  // BS can send many emails in three days. Only its actual pre-call SMS is an
  // initial marketing-push trigger; the other campaigns wait for their own
  // action and frequency proof.
  if (key !== BS_PRECALL_SMS) return null;

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

  // The alert opens the portal's call card, so it is only useful while that
  // card can show a current call. A moved or cancelled booking cannot leave
  // an old pre-call text as a reason to buzz the phone.
  const { rows: bookings } = await db.query(
    `SELECT 1 FROM bookings
      WHERE org_id = $1 AND client_id = $2
        AND status IN ('booked', 'rescheduled')
        AND starts_at > $3::timestamptz
        AND starts_at <= $3::timestamptz + interval '72 hours'
      ORDER BY starts_at ASC LIMIT 1`,
    [message.org_id, message.client_id, now.toISOString()]
  );
  if (!bookings.length) return null;

  // A conservative cap based on already-sent source texts: one in 24 hours,
  // three in seven days. No new push table or hot-path query for service mail.
  const { rows: counts } = await db.query(
    `SELECT
       count(*) FILTER (WHERE updated_at > $4::timestamptz - interval '24 hours')::int AS last_day,
       count(*)::int AS last_week
       FROM messages
      WHERE org_id = $1 AND client_id = $2 AND template_key = $3
        AND status = 'sent' AND id <> $5
        AND updated_at > $4::timestamptz - interval '7 days'`,
    [message.org_id, message.client_id, BS_PRECALL_SMS, now.toISOString(), message.id]
  );
  if (counts[0]?.last_day == null || counts[0]?.last_week == null) return null;
  const lastDay = Number(counts[0]?.last_day);
  const lastWeek = Number(counts[0]?.last_week);
  if (!Number.isFinite(lastDay) || !Number.isFinite(lastWeek) || lastDay >= 1 || lastWeek >= 3) {
    return null;
  }
  return { kind: "check_in" };
}

export default { notificationForSentMessage };
