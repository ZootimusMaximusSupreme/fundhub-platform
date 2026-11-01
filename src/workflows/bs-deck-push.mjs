import { fenceVerdict, MESSAGING_DRY_RUN } from "../lib/dry-run.mjs";
import { sendNativeToClient } from "../push/native-send.mjs";
import { sendToClient } from "../push/send.mjs";
import { APPROVED_URLS } from "../push/payload.mjs";

// A lesson push is claimed in the existing message ledger before transmission.
// This keeps an Inngest retry or a replayed booking from buzzing the same phone.
export async function sendDeckPush(database, {
  orgId, clientId, eventId, slug, bookingUid = null, startTime,
  now = new Date(), env = process.env,
  sendNative = sendNativeToClient, sendWeb = sendToClient
}) {
  if (!fenceVerdict(MESSAGING_DRY_RUN, env).allowed) return { sent: false, reason: "dry_run" };
  if (!APPROVED_URLS.includes(`/slideshows/${slug}.html`)) {
    return { sent: false, reason: "invalid_slug" };
  }
  const settings = await database.query(
    "SELECT outbound_enabled FROM messaging_settings WHERE org_id = $1 LIMIT 1", [orgId]
  );
  if (settings.rows[0]?.outbound_enabled === false) return { sent: false, reason: "outbound_paused" };
  const permission = await database.query(
    `SELECT custom_fields ->> 'marketing_push_enabled' AS enabled
       FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`, [clientId, orgId]
  );
  if (permission.rows[0]?.enabled !== "true") return { sent: false, reason: "push_not_enabled" };
  const optOut = await database.query(
    `SELECT 1 FROM opt_outs WHERE org_id = $1 AND client_id = $2
       AND channel IN ('sms','email') AND opted_in_at IS NULL LIMIT 1`, [orgId, clientId]
  );
  if (optOut.rows.length) return { sent: false, reason: "opted_out" };
  const expected = new Date(startTime).getTime();
  if (!Number.isFinite(expected) || expected <= now.getTime()) {
    return { sent: false, reason: "no_future_booking" };
  }
  const booking = await database.query(
    `SELECT status, starts_at, provider_uid FROM bookings WHERE org_id = $1 AND client_id = $2
       ORDER BY created_at DESC LIMIT 1`, [orgId, clientId]
  );
  const current = booking.rows[0];
  if (!["booked", "rescheduled"].includes(current?.status)
    || (bookingUid && current.provider_uid !== bookingUid)
    || new Date(current.starts_at).getTime() !== expected) {
    return { sent: false, reason: "booking_changed" };
  }
  const cap = await database.query(
    `SELECT count(*)::int AS n FROM messages
       WHERE org_id = $1 AND client_id = $2 AND status = 'sent'
         AND (channel = 'push' OR template_key = 'SMS-BS01-02-PRECALL')
         AND updated_at > $3::timestamptz - interval '24 hours'`,
    [orgId, clientId, now.toISOString()]
  );
  if (Number(cap.rows[0]?.n) >= 1) return { sent: false, reason: "daily_push_cap" };
  const claim = await database.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key,
      rendered_body, provider_ref, status, compliance_check_passed)
      VALUES ($1,$2,'outbound','push','BS-DECK-PUSH',$3,$4,'sending',true)
      ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, clientId, slug, `bs-deck-push:${clientId}:${slug}`]
  );
  const id = claim.rows[0]?.id;
  if (!id) return { sent: false, reason: "already_claimed" };
  const notification = { kind: "check_in", url: `/slideshows/${slug}.html` };
  const target = { orgId, clientId, notification, env };
  const results = await Promise.allSettled([sendNative(database, target), sendWeb(database, target)]);
  const sent = results.reduce((n, result) => n + (result.status === "fulfilled" ? Number(result.value?.sent || 0) : 0), 0);
  await database.query(
    `UPDATE messages SET status = $2, provider = 'apns_web_push', updated_at = now()
      WHERE id = $1`, [id, sent > 0 ? "sent" : "failed"]
  );
  return { sent: sent > 0, devices: sent, reason: sent > 0 ? null : "no_device_delivered" };
}
