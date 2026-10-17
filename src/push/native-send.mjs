import { sendAPNS } from "./apns.mjs";
import { listNativeDevices, markNativeDevice } from "./native-store.mjs";

// Transport only. No workflow imports this today; a named customer event must
// be approved before an automatic notification is added.
export async function sendNativeToClient(db, {
  orgId, clientId, notification, env = process.env, send = sendAPNS
} = {}) {
  const devices = await listNativeDevices(db, { orgId, clientId, env });
  const result = { attempted: devices.length, sent: 0, expired: 0, failed: 0 };
  if (!devices.length) return { ...result, reason: "no_native_device_on_file" };
  for (const device of devices) {
    const delivery = await send({
      token: device.token,
      environment: device.environment,
      notification
    }, { env });
    const state = delivery.gone ? "expired" : delivery.status === "sent" ? "sent" : "failed";
    await markNativeDevice(db, device.id, state);
    result[state] += 1;
  }
  return result;
}

export default { sendNativeToClient };
