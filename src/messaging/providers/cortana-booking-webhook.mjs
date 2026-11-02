// Send a confirmed ClickFunnels booking to the Funding Call webhook source.
// The destination is a vendor record, so every POST stays behind ADAPTERS.
import { postJsonTo, ADAPTERS } from "../../lib/outbound-fetch.mjs";
import { questionById, surveyFicoBand } from "../../survey/cf-question-map.mjs";
import { savedSurveyAnswers } from "../../survey/resume-state.mjs";

const REVIEW_SCORE_BANDS = new Set(["620-699", "700-759", "760-850", "650-699", "700-749", "750+"]);
const BELOW_SCORE_BANDS = new Set(["500-619", "500-579"]);
const CAPITAL_BANDS = new Set([
  ...questionById("available_capital").options,
  "Less than $1k", "$1k - $5k", "$5k - $25k", "$25k - $100k", "$100k+"
]);

export function bookingFeedEnabled(env = process.env) {
  return String(env.CORTANA_FEED_ENABLED || "").trim() === "1" &&
    Boolean(String(env.CORTANA_WEBHOOK_BOOKING_URL || "").trim());
}

function fields(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// Match creditTierFor's correction/label/legacy-reader order, without changing
// its separate 700+ business-funding rule. This screen is never an approval.
function offerFinancingScreen(customFields) {
  const cf = fields(customFields);
  const edits = fields(cf.setter_survey_edits);
  const legacy = cf.svy_self_reported_fico == null ? null
    : String(cf.svy_self_reported_fico).trim().replace(/[‒-―]/g, "-");
  const band = surveyFicoBand({ cf_svy_self_reported_fico_label: edits.cf_svy_self_reported_fico })
    || surveyFicoBand(cf)
    || surveyFicoBand({ cf_svy_self_reported_fico: legacy });
  if (REVIEW_SCORE_BANDS.has(band)) return "review_620_plus";
  if (BELOW_SCORE_BANDS.has(band)) return "below_620";
  // In particular, the old 580-649 band straddles 620 and says neither.
  return "score_unconfirmed";
}

function availableCapitalBand(customFields) {
  const cf = fields(customFields);
  const corrected = fields(cf.setter_survey_edits).cf_svy_available_capital;
  if (typeof corrected === "string" && CAPITAL_BANDS.has(corrected.trim())) return corrected.trim();
  const saved = savedSurveyAnswers(cf).cf_svy_available_capital;
  return CAPITAL_BANDS.has(saved) ? saved : null;
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
    offer_financing_screen: offerFinancingScreen(booking.custom_fields),
    available_capital_band: availableCapitalBand(booking.custom_fields),
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
