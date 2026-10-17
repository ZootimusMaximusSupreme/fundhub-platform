// A companion alert is allowed only after the ordinary email/SMS dispatcher
// records a real provider send. Never place message copy on the lock screen.
export const PROMOTIONAL_KEY = /^(?:BS-|(?:SMS|EMAIL)-(?:BS|NOBOOK|S05A|SLO|OFFER|N[0-9]{2}|AISET03|S02))/;
const BS_PRECALL_SMS = "SMS-BS01-02-PRECALL";
const BOOKING_CONFIRM_SMS = "SMS-S04-01-CONFIRM";

export async function notificationForSentMessage(db, message, { now = new Date() } = {}) {
  if (!message?.client_id || !["email", "sms"].includes(message.channel)) return null;

  const key = String(message.template_key || "");
  if (key === BOOKING_CONFIRM_SMS) return { kind: "call_confirmation" };
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
