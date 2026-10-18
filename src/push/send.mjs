// sendToClient — one notification, every device that client has on file.
//
// THE ONLY CALLER OF THE WEB PUSH PROVIDER TODAY. The dispatcher calls this
// after a real email or text leaves. It sits between the store
// (which holds encrypted credentials) and the provider (which is the only place
// allowed to transmit), and it owns the two jobs neither of them can do alone:
//
//   1. FAN OUT. A person has a phone, a laptop and a tablet. A notification
//      that lands on whichever one they are not holding is a notification they
//      did not get, so it goes to all of them.
//
//   2. RETIRE THE DEAD. A push service answers 404 or 410 for an endpoint that
//      is gone for good, and it will answer that way forever. Not acting on it
//      means retrying a dead phone on every nudge until somebody notices the
//      failure count. So a `gone` result stamps expired_at immediately, in the
//      same pass, without a sweeper and without a human.
//
// NO PARTIAL SUCCESS LIE. The result names how many devices were reached, how
// many were retired and how many failed. "sent" with three dead endpoints is the
// answer that gets a nudge engine believed when it should not be.
//
// NOTHING HERE LOGS AN ENDPOINT OR A KEY. Row ids and status words only.

import { listLiveSubscriptions, markExpired, markSuccess, markFailure } from "./store.mjs";
import { send as webPushSend } from "../messaging/providers/web-push.mjs";

/**
 * sendToClient(db, { orgId, clientId, notification, allowDetail })
 *   → { attempted, sent, expired, failed, results[] }
 *
 * `notification` is the OBJECT, never finished JSON — the lock-screen gate in
 * src/push/payload.mjs runs inside the provider and must be the only way a body
 * is built. See that file's header.
 *
 * `allowDetail` defaults to false and nothing in this repository passes true.
 * It is here so that turning detail on later is one argument at one call site.
 */
export async function sendToClient(db, {
  orgId,
  clientId,
  notification,
  allowDetail = false,
  ttlSeconds,
  env = process.env,
  fetchImpl,
  timeoutMs
} = {}) {
  const subs = await listLiveSubscriptions(db, { orgId, clientId, env });

  const out = { attempted: subs.length, sent: 0, expired: 0, failed: 0, results: [] };
  if (!subs.length) {
    // NOT AN ERROR. "This client has no phone registered" is the ordinary state
    // for most clients and the caller's correct response is to use another
    // channel, not to retry.
    out.reason = "no_subscription_on_file";
    return out;
  }

  for (const sub of subs) {
    const result = await webPushSend({
      id: sub.id,
      to: sub.endpoint,
      pushKeys: sub.keys,
      notification,
      allowDetail,
      ttlSeconds
    }, { env, fetchImpl, timeoutMs });

    if (result.gone) {
      await markExpired(db, sub.id, { reason: result.error });
      out.expired += 1;
    } else if (result.status === "sent") {
      await markSuccess(db, sub.id);
      out.sent += 1;
    } else {
      await markFailure(db, sub.id);
      out.failed += 1;
    }

    out.results.push({
      subscriptionId: sub.id,
      deviceLabel: sub.deviceLabel,
      status: result.gone ? "expired" : result.status,
      // The provider's error text, which never contains an endpoint or a key.
      error: result.error || null
    });
  }

  return out;
}

export default { sendToClient };
