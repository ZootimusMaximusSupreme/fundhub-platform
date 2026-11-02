// Web push — the only place a notification leaves the building.
//
// CLAUDE.md §12: "Outbound transmission is permitted in src/messaging/providers/*
// and nowhere else." That is why the POST lives here and not in src/push/, and
// why src/push/send.mjs calls this rather than reaching for fetch itself.
//
// SHIPS UNROUTED, DELIBERATELY. `ENABLED = false` and this module is NOT in
// providers/index.mjs. `push` is not a channel in message_channel_routing and
// the dispatcher has never heard of it, so nothing in the message queue can
// reach this code by accident. The one caller today is src/push/send.mjs, which
// the manual test script calls. Wiring it to the nudge dispatcher is a separate,
// deliberate change — the instructions are in docs/journeys/push-flow.md.
//
// WHY IT STILL WEARS THE PROVIDER CONTRACT (PROVIDER / CHANNELS / ADDRESS_FIELD /
// ENABLED / TRANSMITS / send) even though the registry does not hold it: so that
// registering it later is one line in index.mjs and a routing row, with no
// rewrite. index.mjs's import-time checks are exactly the shape asserted below.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE THREE THINGS THIS FILE IS CAREFUL ABOUT
//
// 1. THE PAYLOAD IS BUILT HERE, NOT ACCEPTED HERE. send() takes a notification
//    OBJECT and runs it through buildPushPayload(), which is the lock-screen
//    gate. It deliberately does NOT accept a pre-serialised body: a caller who
//    could hand over finished JSON could hand over "$4,200 due on your Amex"
//    and the gate would never see it.
//
// 2. A DEAD SUBSCRIPTION REPORTS ITSELF. 404 and 410 from a push service mean
//    the endpoint is gone for good. The result carries `gone: true` so the
//    caller retires the row instead of retrying a dead endpoint until the end of
//    time — which is the normal outcome of not handling this, because the push
//    service keeps answering 410 forever.
//
// 3. NOTHING IS LOGGED. No endpoint, no key, no payload, not at any level. The
//    errors below name a status code and a subscription row id and stop.
//
// CONFIGURATION, read at call time:
//   VAPID_PUBLIC_KEY   base64url, 65 bytes — also served to the browser
//   VAPID_PRIVATE_KEY  base64url, 32 bytes. Secret.
//   VAPID_SUBJECT      mailto: or https:// contact for the push services

import { postJson, classify, success, failure, rejection } from "./http.mjs";
import { encryptPayload, vapidHeaders, unb64u } from "../../push/crypto.mjs";
import { buildPushPayload, PushPayloadRefused } from "../../push/payload.mjs";

/** Must equal the `provider` value in message_channel_routing, if it is ever
    routed there. Not routed today — see the header. */
export const PROVIDER = "web_push";

/** The channel this provider would carry. `push` is not in the routing table's
    channel set today; adding it is part of the wiring change, not of this file. */
export const CHANNELS = new Set(["push"]);

/** Not a column on `clients`. A push address is a whole subscription row in
    client_push_subscriptions, resolved by src/push/send.mjs. Declared so the
    registry's contract check passes unchanged, and named so nobody wires the
    dispatcher to read a `push_subscription` column that does not exist. */
export const ADDRESS_FIELD = "push_subscription";

/** False: not registered, not routed, nothing in the queue can reach it. */
export const ENABLED = false;

/** True: this provider makes a real outbound HTTP request. */
export const TRANSMITS = true;

/* How long the push service should hold the message for a phone that is off.
   Four hours. A nudge that lands a day late is worse than one that never lands:
   the client acts on it, finds the moment has passed, and trusts the next one
   less. Overridable per message; never unlimited. */
export const DEFAULT_TTL_SECONDS = 4 * 60 * 60;

export function vapidConfig(env = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  const missing = [
    !publicKey && "VAPID_PUBLIC_KEY",
    !privateKey && "VAPID_PRIVATE_KEY",
    !subject && "VAPID_SUBJECT"
  ].filter(Boolean);
  if (missing.length) return { ok: false, missing };

  // Present is not the same as usable. A key of the wrong length would pass a
  // presence check and fail at the moment of a real send with a 401 nobody can
  // read — the identical failure plaidConfigFromEnv() guards against.
  const problems = [];
  try {
    if (unb64u(publicKey).length !== 65) problems.push("VAPID_PUBLIC_KEY must be a 65-byte base64url P-256 point");
  } catch { problems.push("VAPID_PUBLIC_KEY is not base64url"); }
  try {
    if (unb64u(privateKey).length !== 32) problems.push("VAPID_PRIVATE_KEY must be a 32-byte base64url scalar");
  } catch { problems.push("VAPID_PRIVATE_KEY is not base64url"); }
  if (!/^(mailto:|https:\/\/)/.test(String(subject))) {
    problems.push("VAPID_SUBJECT must be a mailto: or https:// URL");
  }

  if (problems.length) return { ok: false, missing: [], problems };
  return { ok: true, publicKey, privateKey, subject, missing: [], problems: [] };
}

/** isWebPushConfigured(env) → boolean. Reports; never throws. */
export function isWebPushConfigured(env = process.env) {
  return vapidConfig(env).ok === true;
}

/**
 * send(message, options) → SendResult (+ `gone` when the endpoint is dead)
 *
 * message: {
 *   id?            a row id for error text only — never a credential
 *   to             the push endpoint URL
 *   pushKeys       { p256dh, auth } from the subscription
 *   notification   { kind, title?, body?, url?, tag? } — GATED, see payload.mjs
 *   allowDetail?   default false. Chris's flag. Nothing sets it today.
 *   ttlSeconds?    default DEFAULT_TTL_SECONDS
 * }
 */
export async function send(message = {}, options = {}) {
  try {
    return await attempt(message, options);
  } catch (err) {
    // The contract says never throw. Backstop for a bug in the code above.
    return failure(`web-push provider error: ${String((err && err.message) || err)}`);
  }
}

async function attempt(message, { fetchImpl, timeoutMs, signal, env = process.env } = {}) {
  const cfg = vapidConfig(env);
  if (!cfg.ok) {
    // Retryable: the notification is fine, the configuration is not, and it
    // should go out once somebody sets the variable.
    return failure(
      `web push is not configured: ${[...(cfg.missing || []), ...(cfg.problems || [])].join(", ")}`
    );
  }

  const endpoint = String(message.to || "").trim();
  if (!endpoint) return rejection("no push endpoint on the message");

  const keys = message.pushKeys || {};
  if (!keys.p256dh || !keys.auth) {
    return rejection("subscription is missing its p256dh or auth key");
  }

  /* THE GATE. Anything that would put a dollar amount, a lender's name or the
     word "dispute" on a locked phone is refused HERE, permanently — a retry
     would refuse it again, so it is a rejection and not a failure. */
  let payload;
  try {
    payload = buildPushPayload(message.notification || {}, {
      allowDetail: message.allowDetail === true
    });
  } catch (err) {
    if (err instanceof PushPayloadRefused) return rejection(err.message);
    throw err;
  }

  let body;
  try {
    body = encryptPayload(payload, { p256dh: keys.p256dh, auth: keys.auth });
  } catch (err) {
    // A key that is not a curve point cannot become one on a retry.
    return rejection(`push payload could not be encrypted: ${String(err && err.message)}`);
  }

  let auth;
  try {
    auth = vapidHeaders({
      endpoint,
      subject: cfg.subject,
      publicKey: cfg.publicKey,
      privateKey: cfg.privateKey
    });
  } catch (err) {
    return rejection(`push endpoint refused: ${String(err && err.message)}`);
  }

  const ttl = Number.isFinite(message.ttlSeconds) ? Math.max(0, Math.floor(message.ttlSeconds)) : DEFAULT_TTL_SECONDS;

  const res = await postJson(endpoint, {
    headers: {
      ...auth,
      // RFC 8188 names the encoding in a header, not in the body. Omit it and
      // the browser drops the message without a word to anybody.
      "Content-Encoding": "aes128gcm",
      TTL: String(ttl),
      // "normal" is the default; naming it stops a push service applying its own
      // idea of low priority to a time-sensitive nudge.
      Urgency: String(message.urgency || "normal")
    },
    body,
    contentType: "application/octet-stream",
    timeoutMs,
    fetchImpl,
    signal,
    env,
    what: "web push"
  });

  // Fence held it, or the transport never reached the push service. Retryable.
  if (res.blocked) return failure(res.error || "web push held by the messaging fence");
  if (res.status === 0) return { ...failure(res.error || "web push request failed"), unknown: true };

  /* GONE FOR GOOD. 404 = the push service never heard of this endpoint;
     410 = it did and the subscription has been removed. Both are terminal, and
     the caller must retire the row — retrying either is a request that will fail
     identically forever. `gone` is the flag src/push/send.mjs acts on. */
  if (res.status === 404 || res.status === 410) {
    return { ...rejection(`push subscription is gone (HTTP ${res.status})`), gone: true };
  }

  // 413 — the encrypted record is over this push service's ceiling. Permanent
  // for this message; payload.mjs's caps make it near-impossible to reach.
  if (res.status === 413) return rejection("push payload is too large for this push service");

  const verdict = classify(res.status);
  if (verdict.status === "rejected") {
    return rejection(res.error || `push service rejected the message (HTTP ${res.status})`);
  }
  if (verdict.status === "failed") {
    return failure(res.error || `push service returned HTTP ${res.status}`, { retryable: true });
  }

  // Push services answer 201 with no body and no id worth keeping. The
  // subscription row id is the only handle anybody has, so it is the one
  // returned — never the endpoint.
  return success(message.id ? String(message.id) : null);
}

export default { PROVIDER, CHANNELS, ADDRESS_FIELD, ENABLED, TRANSMITS, send, vapidConfig, isWebPushConfigured };
