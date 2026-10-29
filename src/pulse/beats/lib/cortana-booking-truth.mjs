// One read-only verdict shared by the morning gap lane and the hourly call beat.
export const CORTANA_UNDELIVERED_SQL = `
  SELECT count(*)::int AS undelivered
    FROM bookings b
    LEFT JOIN clients c ON c.id = b.client_id AND c.org_id = b.org_id
    LEFT JOIN cortana_booking_sends s ON s.booking_id = b.id
   WHERE b.source = 'clickfunnels'
     AND b.status IN ('booked', 'rescheduled')
     AND b.created_at >= '2026-10-29T19:30:00Z'::timestamptz
     AND b.created_at < $1::timestamptz - interval '20 minutes'
     AND NULLIF(btrim(b.attendee_email), '') IS NOT NULL
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(b.attendee_name, '') !~* '^simulated buyer([[:space:]]|$)'
     AND b.attendee_email !~* '@fundhub\\.ai$'
     AND (s.status IS NULL OR s.status NOT IN ('sent', 'skipped'))`;

export const CORTANA_CHECK_ID = "cortana:booked-call-undelivered";

export function judgeCortanaBooking(row) {
  const count = Number(row?.undelivered || 0);
  return {
    id: CORTANA_CHECK_ID,
    status: count ? "FAIL" : "PASS",
    detail: count ? `${count} confirmed ClickFunnels call${count === 1 ? " has" : "s have"} no Cortana delivery receipt after 20 minutes.` :
      "Every aged confirmed ClickFunnels call has a Cortana delivery receipt.",
    suggestedFix: count ? "Check cortana-booking-feed run and failed delivery ledger; retry the missing bookings." : null
  };
}
