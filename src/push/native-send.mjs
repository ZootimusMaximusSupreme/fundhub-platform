import { sendAPNS } from "./apns.mjs";
import { listNativeDevices, markNativeDevice } from "./native-store.mjs";

// Transport only. The guarded email/SMS dispatcher calls this after a
// successful send; the message policy selects the approved alert kind.
export async function sendNativeToClient(db, {
  orgId, clientId, notification, env = process.env, send = sendAPNS, now = Date.now
} = {}) {
  const expiresAt = notification?.expiresAt;
  if (expiresAt != null) {
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= now()) {
      return { attempted: 0, sent: 0, expired: 0, failed: 0, reason: "invite_expired" };
    }
  }
  const devices = await listNativeDevices(db, { orgId, clientId, env });
  const result = { attempted: 0, sent: 0, expired: 0, failed: 0 };
  if (!devices.length) return { ...result, reason: "no_native_device_on_file" };
  for (const device of devices) {
    if (expiresAt != null && Date.parse(expiresAt) <= now()) {
      return { ...result, reason: "invite_expired" };
    }
    const delivery = await send({
      token: device.token,
      environment: device.environment,
      notification,
      expiresAt
    }, { env });
    // Time can run out between the fan-out check and Apple's request. That is
    // not a bad device and must not raise its failure count.
    if (delivery.reason === "invite_expired") return { ...result, reason: "invite_expired" };
    result.attempted += 1;
    const state = delivery.gone ? "expired" : delivery.status === "sent" ? "sent" : "failed";
    await markNativeDevice(db, device.id, state);
    result[state] += 1;
  }
  return result;
}

export default { sendNativeToClient };
