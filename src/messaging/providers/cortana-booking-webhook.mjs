// Send a confirmed ClickFunnels booking to the Funding Call webhook source.
// The destination is a vendor record, so every POST stays behind ADAPTERS.
import { postJsonTo, ADAPTERS } from "../../lib/outbound-fetch.mjs";

export function bookingFeedEnabled(env = process.env) {
  return String(env.CORTANA_FEED_ENABLED || "").trim() === "1" &&
    Boolean(String(env.CORTANA_WEBHOOK_BOOKING_URL || "").trim());
}

export async function sendCortanaBooking(booking, { env = process.env, fetchImpl } = {}) {
  if (!bookingFeedEnabled(env)) return { ok: false, blocked: true, transmitted: false, error: "Cortana booking feed is not configured" };
  let url;
  try { url = new URL(env.CORTANA_WEBHOOK_BOOKING_URL); } catch { return { ok: false, blocked: true, transmitted: false, error: "Invalid Cortana booking URL" }; }
  if (url.protocol !== "https:" || url.hostname !== "app.directroas.com" || !url.pathname.startsWith("/api/webhook/")) {
    return { ok: false, blocked: true, transmitted: false, error: "Cortana booking URL has an unexpected destination" };
  }
  const body = {
    schema: "fh-cortana-book-v1",
    event_name: "funding_call_booked",
    event_id: `fundhub_booking_${booking.id}`,
    booking_id: booking.provider_uid,
    qualification_bucket: ["funding_qualified", "funding_unqualified"].includes(booking.qualification_bucket)
      ? booking.qualification_bucket : null,
    name: booking.attendee_name || null,
    email: booking.attendee_email,
    phone: booking.phone || null,
    conversion_date: new Date(booking.created_at).toISOString(),
    value: 0,
    currency: "USD",
    utm_source: booking.utm_source || null,
    utm_medium: booking.utm_medium || null,
    utm_campaign: booking.utm_campaign || null,
    utm_content: booking.utm_content || null,
    // Fundhub's ad_id is an internal number, not a Meta ad ID.
    utm_ad_id: null,
    fbclid: booking.fbclid || null,
    gclid: booking.gclid || null
  };
  return postJsonTo(url.href, {
    fence: ADAPTERS,
    env,
    fetchImpl,
    what: "Cortana confirmed booking",
    body: JSON.stringify(body)
  });
}
