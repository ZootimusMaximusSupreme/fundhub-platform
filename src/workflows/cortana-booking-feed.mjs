// Reconcile confirmed ClickFunnels bookings into Cortana's Funding Call event.
// The two missed October 29 calls were sent manually before this cutover.
import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { classifyVisitor } from "../slo/visitor.mjs";
import { bookingFeedEnabled, sendCortanaBooking } from "../messaging/providers/cortana-booking-webhook.mjs";

export const SOURCE_WORKFLOW = "cortana-booking-feed";
export const FEED_CRON = "*/5 * * * *";
export const FEED_START = "2026-10-29T19:30:00Z";
export const MAX_BOOKINGS_PER_SWEEP = 25;
export const STALE_CLAIM_MINUTES = 10;

const CANDIDATES_SQL = `
  SELECT b.id, b.org_id, b.provider_uid, b.created_at, b.attendee_name,
         b.attendee_email, COALESCE(NULLIF(b.raw->>'phone', ''), c.phone) AS phone,
         c.is_demo, c.custom_fields,
         a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content
    FROM bookings b
    LEFT JOIN clients c ON c.id = b.client_id AND c.org_id = b.org_id
    LEFT JOIN client_ad_attribution a ON a.client_id = b.client_id AND a.org_id = b.org_id
   WHERE b.source = 'clickfunnels'
     AND b.status IN ('booked', 'rescheduled')
     AND b.created_at >= $1::timestamptz
     AND NULLIF(btrim(b.attendee_email), '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM cortana_booking_sends s
        WHERE s.booking_id = b.id AND s.status IN ('sent', 'skipped')
     )
   ORDER BY b.created_at ASC, b.id ASC
   LIMIT $2`;

const CLAIM_SQL = `
  INSERT INTO cortana_booking_sends (booking_id, org_id, status, attempts, claimed_at)
  VALUES ($1, $2, 'sending', 1, now())
  ON CONFLICT (booking_id) DO UPDATE
     SET status = 'sending', attempts = cortana_booking_sends.attempts + 1,
         claimed_at = now(), updated_at = now()
   WHERE cortana_booking_sends.status = 'failed'
      OR (cortana_booking_sends.status = 'sending'
          AND cortana_booking_sends.claimed_at < now() - make_interval(mins => $3))
  RETURNING booking_id`;

async function finish(conn, id, status, error = null) {
  await conn.query(
    `UPDATE cortana_booking_sends
        SET status = $2, last_error = $3, updated_at = now(),
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
      WHERE booking_id = $1 AND status = 'sending'`,
    [id, status, error ? String(error).slice(0, 300) : null]
  );
}

export async function sweepCortanaBookingFeed(conn = db, {
  env = process.env, send = sendCortanaBooking, fetchImpl,
  limit = MAX_BOOKINGS_PER_SWEEP
} = {}) {
  if (!bookingFeedEnabled(env)) throw new Error("Cortana booking feed is not configured");
  const capped = Math.max(0, Math.min(MAX_BOOKINGS_PER_SWEEP, Math.trunc(Number(limit) || 0)));
  const out = { scanned: 0, sent: 0, skipped: 0, failed: 0 };
  if (!capped) return out;
  const rows = (await conn.query(CANDIDATES_SQL, [FEED_START, capped])).rows;
  out.scanned = rows.length;
  for (const row of rows) {
    const claim = (await conn.query(CLAIM_SQL, [row.id, row.org_id, STALE_CLAIM_MINUTES])).rows[0];
    if (!claim) continue;
    const testContact = row.is_demo ||
      /^simulated buyer\b/i.test(String(row.attendee_name || "")) ||
      classifyVisitor({ email: row.attendee_email }).actor === "agent";
    if (testContact) {
      await finish(conn, row.id, "skipped", "test or company contact");
      out.skipped += 1;
      continue;
    }
    const cf = row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {};
    const fbc = String(cf.fbc || cf._fbc || "");
    const fbclid = String(cf.fbclid || "") ||
      (fbc.startsWith("fb.1.") ? fbc.split(".").slice(3).join(".") : "");
    let result;
    try {
      result = await send({
        ...row, fbclid: fbclid || null, gclid: cf.gclid || null
      }, { env, fetchImpl });
    } catch (err) {
      result = { ok: false, error: String(err?.message || err) };
    }
    if (result.ok) {
      await finish(conn, row.id, "sent");
      out.sent += 1;
    } else {
      await finish(conn, row.id, "failed", result.error || `HTTP ${result.status || 0}`);
      out.failed += 1;
    }
  }
  return out;
}

export async function handle({ db: handleDb } = {}) {
  return sweepCortanaBookingFeed(handleDb || db);
}

export const cortanaBookingFeed = inngest.createFunction(
  { id: SOURCE_WORKFLOW, name: "Cortana confirmed booking feed" },
  { cron: FEED_CRON },
  async ({ step }) => {
    const result = await step.run("send-confirmed-bookings", () => sweepCortanaBookingFeed(db));
    if (result.failed) throw new Error(`${result.failed} Cortana booking sends failed`);
    return result;
  }
);
