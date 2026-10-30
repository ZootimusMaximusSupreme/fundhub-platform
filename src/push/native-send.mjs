import { sendAPNS } from "./apns.mjs";
import { listNativeDevices, markNativeDevice } from "./native-store.mjs";
import { listStaffNativeDevices, markStaffNativeDevice } from "./staff-native-store.mjs";
import { buildStaffPushPayload } from "./payload.mjs";

// Transport only. The guarded email/SMS dispatcher calls this after a
// successful send; the message policy selects the approved alert kind.
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

// A stable key is required: the database claims the alert before calling Apple.
// Replays cannot buzz a staff member twice, even if Apple's reply was uncertain.
export async function sendNativeToStaff(db, {
  orgId, staffId, clientId, kind, key, env = process.env, send = sendAPNS
} = {}) {
  if (!orgId || !staffId) throw new Error("staff push needs an organization and staff member");
  const notification = { audience: "staff", kind, clientId, key };
  buildStaffPushPayload(notification);
  const devices = await listStaffNativeDevices(db, { orgId, staffId, env });
  const result = { attempted: devices.length, sent: 0, expired: 0, failed: 0 };
  if (!devices.length) return { ...result, reason: "no_native_device_on_file" };
  const claim = await db.query(
    `INSERT INTO staff_apns_alerts (org_id, staff_id, client_id, kind, alert_key)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_id, staff_id, client_id, kind, alert_key) DO NOTHING
     RETURNING id`,
    [orgId, staffId, clientId, kind, key]
  );
  const claimId = claim.rows[0]?.id;
  if (!claimId) return { attempted: 0, sent: 0, expired: 0, failed: 0, reason: "already_claimed" };
  for (const device of devices) {
    let delivery;
    try {
      delivery = await send({ token: device.token, environment: device.environment,
        notification }, { env });
    } catch (error) {
      delivery = { status: "failed", gone: false, reason: error?.message || "APNs unavailable" };
    }
    const state = delivery.gone ? "expired" : delivery.status === "sent" ? "sent" : "failed";
    await markStaffNativeDevice(db, device.id, state);
    result[state] += 1;
  }
  await db.query(
    `UPDATE staff_apns_alerts SET status = $2, attempted = $3, sent = $4, updated_at = now() WHERE id = $1`,
    [claimId, result.sent > 0 ? "sent" : "failed", result.attempted, result.sent]
  );
  return result;
}

export default { sendNativeToClient, sendNativeToStaff };
