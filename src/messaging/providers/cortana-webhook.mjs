// Cortana webhook — the one server sender for paid steps Cortana weighs.
//
// CLAUDE.md §12: outbound transmission lives in src/messaging/providers/* and
// nowhere else, and it goes through the chokepoint (src/lib/outbound-fetch.mjs).
//
// THE FENCE IS `ADAPTERS`. A post writes a conversion on Fundhub's own Cortana
// workspace (app.directroas.com). It reaches no person. With ADAPTERS_DRY_RUN
// on, every call comes back `blocked` and nothing leaves.
//
// TWO SWITCHES, BOTH REQUIRED: CORTANA_FEED_ENABLED must be exactly "1", and
// the ADAPTERS fence must be down.
//
// ONE URL PER BUCKET. Each Cortana conversion has its own Webhook source; the
// source URL is its whole credential (Cortana shows no signing secret):
//   soft_pull       CORTANA_WEBHOOK_SOFT_PULL_URL       -> "Soft Pull"
//   first_purchase  CORTANA_WEBHOOK_FIRST_PURCHASE_URL  -> "New Deals Closed"
//   all_payments    CORTANA_WEBHOOK_ALL_PAYMENTS_URL    -> "All Payments (LTV)"
// The field map was set in Cortana's own "Map Webhook Fields" screen on
// 2026-10-20: name, email, phone, value -> Revenue, utm_source, utm_campaign,
// utm_medium, utm_content -> UTM Ad, utm_ad_id, fbclid, gclid, and
// conversion_date. Every other key is carried for the reader, not mapped.
//
// NEVER THROWS. Returns { ok, status?, error?, skipped?, blocked? }.
//
// Never sent: card numbers, Social Security number, date of birth, survey
// answers, credit or soft-pull values. Only the keys built in buildPayload.

import { postJsonTo, ADAPTERS, redact } from "../../lib/outbound-fetch.mjs";

export const PROVIDER = "cortana-webhook";
/* Declared so src/lib/no-unfenced-transmit.test.mjs checks that this file goes
   through the fenced HTTP helper. */
export const TRANSMITS = true;

export const SCHEMA = "fh-cortana-pay-v1";
export const TIMEOUT_MS = 5000;
const MAX_ERROR = 300;

export const BUCKET_URL_ENV = Object.freeze({
  soft_pull: "CORTANA_WEBHOOK_SOFT_PULL_URL",
  first_purchase: "CORTANA_WEBHOOK_FIRST_PURCHASE_URL",
  all_payments: "CORTANA_WEBHOOK_ALL_PAYMENTS_URL"
});

export const BUCKETS = Object.freeze(Object.keys(BUCKET_URL_ENV));

/* Cortana's webhook door: https://app.directroas.com/api/webhook/<business>/<source>. */
const CORTANA_WEBHOOK_URL = /^https:\/\/app\.directroas\.com\/api\/webhook\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/** The kill switch: sends only when CORTANA_FEED_ENABLED is exactly "1". */
export function cortanaFeedEnabled(env = process.env) {
  return env?.CORTANA_FEED_ENABLED === "1";
}

/** The bucket's webhook URL, or null when it is unset or not a Cortana door. */
export function cortanaWebhookUrl(bucket, env = process.env) {
  const key = BUCKET_URL_ENV[bucket];
  if (!key) return null;
  const url = String(env?.[key] ?? "").trim();
  return CORTANA_WEBHOOK_URL.test(url) ? url : null;
}

function text(v, max = 200) {
  const s = v == null ? "" : String(v).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * The exact body Cortana receives. Every mapped key is always present (null
 * when unknown) so the mapping never meets a missing field.
 */
export function buildPayload(ev) {
  const e = ev || {};
  const cents = Number(e.amountCents);
  return {
    schema: SCHEMA,
    event_name: text(e.bucket, 40),
    event_id: text(e.eventId, 160),
    name: text(e.name, 160),
    email: text(e.email, 200),
    phone: text(e.phone, 40),
    value: Number.isSafeInteger(cents) && cents > 0 ? cents / 100 : null,
    currency: "USD",
    conversion_date: e.paidAt ? new Date(e.paidAt).toISOString() : null,
    utm_source: text(e.utmSource),
    utm_medium: text(e.utmMedium),
    utm_campaign: text(e.utmCampaign),
    utm_content: text(e.utmContent),
    utm_ad_id: text(e.utmAdId, 40),
    fbclid: text(e.fbclid, 500),
    gclid: text(e.gclid, 500),
    external_id: text(e.clientId, 64),
    offer: text(e.offer, 60),
    provider: text(e.provider, 20),
    payment_id: text(e.paymentId, 160),
    test: false
  };
}

/**
 * Post one paid step to its Cortana bucket.
 *
 * @param {object} ev  { bucket, eventId, amountCents, paidAt, name, email, phone,
 *                      utm*, fbclid, gclid, clientId, offer, provider, paymentId }
 * @param {object} [opts] env (defaults to process.env), fetchImpl (tests).
 */
export async function sendCortanaPayment(ev, { env = process.env, fetchImpl } = {}) {
  try {
    if (!cortanaFeedEnabled(env)) return { ok: false, skipped: "disabled" };
    if (!BUCKETS.includes(ev?.bucket)) return { ok: false, skipped: "unknown_bucket" };
    const url = cortanaWebhookUrl(ev.bucket, env);
    if (!url) return { ok: false, skipped: "no_url", error: `${BUCKET_URL_ENV[ev.bucket]} is not set to a Cortana webhook URL` };
    const body = buildPayload(ev);
    if (body.value == null) return { ok: false, skipped: "no_amount" };
    if (!body.email && !body.phone) return { ok: false, skipped: "no_contact" };
    const res = await postJsonTo(url, {
      body: JSON.stringify(body),
      fence: ADAPTERS,
      env,
      fetchImpl,
      timeoutMs: TIMEOUT_MS,
      what: "cortana webhook"
    });
    if (!res.ok) {
      const out = { ok: false, status: res.status ?? 0, error: redact(String(res.error || `HTTP ${res.status ?? 0}`)).slice(0, MAX_ERROR) };
      if (res.blocked) out.blocked = true;
      return out;
    }
    return { ok: true, status: res.status ?? 200 };
  } catch (err) {
    return { ok: false, error: redact(String(err?.message || err)).slice(0, MAX_ERROR) };
  }
}

export default { PROVIDER, TRANSMITS, BUCKETS, sendCortanaPayment, cortanaFeedEnabled, cortanaWebhookUrl, buildPayload };
