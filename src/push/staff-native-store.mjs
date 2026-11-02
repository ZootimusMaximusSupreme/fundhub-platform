import crypto from "node:crypto";
import { decryptField, encryptField, isPushStorageConfigured } from "./store.mjs";
import { NativePushError, normalizeAPNSToken, normalizeAPNSEnvironment, normalizeInstallationId } from "./native-store.mjs";

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function registerStaffNativeDevice(db, {
  orgId, staffId, sessionId, installationId: inputInstallationId,
  token: input, environment: inputEnvironment, env = process.env
} = {}) {
  if (!orgId || !staffId || !sessionId) throw new NativePushError("A staff session is required.", 403);
  if (!isPushStorageConfigured(env)) throw new NativePushError("Notifications are not set up yet.", 503);
  const token = normalizeAPNSToken(input);
  const environment = normalizeAPNSEnvironment(inputEnvironment);
  const installationId = normalizeInstallationId(inputInstallationId);
  const hash = tokenHash(token);
  const existing = await db.query(
    `SELECT id, org_id, staff_id, token_hash, apns_environment, installation_id
       FROM staff_apns_devices
      WHERE ((token_hash = $1 AND apns_environment = $2) OR installation_id = $3)
        AND expired_at IS NULL AND revoked_at IS NULL`,
    [hash, environment, installationId]
  );
  const row = existing.rows.length === 1 ? existing.rows[0] : null;
  if (row && String(row.org_id) === String(orgId) && String(row.staff_id) === String(staffId)
      && row.token_hash === hash && row.apns_environment === environment
      && String(row.installation_id) === installationId) {
    await db.query(
      `UPDATE staff_apns_devices SET encrypted_token = $2, session_id = $3,
        failure_count = 0, updated_at = now() WHERE id = $1`,
      [row.id, encryptField(token, { rowId: row.id, env }), sessionId]
    );
    return { id: row.id, created: false };
  }
  for (const prior of existing.rows) {
    await db.query(`UPDATE staff_apns_devices SET revoked_at = now(), updated_at = now() WHERE id = $1`, [prior.id]);
  }
  // The app may have previously been signed in as a client on this iPhone.
  await db.query(
    `UPDATE client_apns_devices SET revoked_at = now(), updated_at = now()
      WHERE ((token_hash = $1 AND apns_environment = $2) OR installation_id = $3)
        AND expired_at IS NULL AND revoked_at IS NULL`,
    [hash, environment, installationId]
  );
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO staff_apns_devices
       (id, org_id, staff_id, session_id, installation_id, token_hash, encrypted_token, apns_environment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, orgId, staffId, sessionId, installationId, hash, encryptField(token, { rowId: id, env }), environment]
  );
  return { id, created: true };
}

export async function revokeStaffNativeDevice(db, { orgId, staffId, installationId: inputInstallationId } = {}) {
  if (!orgId || !staffId) throw new NativePushError("A staff session is required.", 403);
  const installationId = normalizeInstallationId(inputInstallationId);
  const result = await db.query(
    `UPDATE staff_apns_devices SET revoked_at = now(), updated_at = now()
      WHERE org_id = $1 AND staff_id = $2 AND installation_id = $3
        AND expired_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [orgId, staffId, installationId]
  );
  return { revoked: result.rows.length > 0 };
}

export async function countStaffNativeDevices(db, { orgId, staffId, sessionId, installationId: inputInstallationId } = {}) {
  if (!orgId || !staffId || !sessionId) throw new NativePushError("A staff session is required.", 403);
  const installationId = normalizeInstallationId(inputInstallationId);
  const result = await db.query(
    `SELECT count(*)::int AS count FROM staff_apns_devices d
      JOIN staff st ON st.id = d.staff_id AND st.org_id = d.org_id AND st.status = 'active'
      JOIN sessions s ON s.id = d.session_id AND s.staff_id = d.staff_id
        AND s.org_id = d.org_id AND s.revoked_at IS NULL AND s.expires_at > now()
      WHERE d.org_id = $1 AND d.staff_id = $2 AND d.installation_id = $3 AND d.session_id = $4
        AND d.expired_at IS NULL AND d.revoked_at IS NULL`,
    [orgId, staffId, installationId, sessionId]
  );
  return Number(result.rows[0]?.count || 0);
}

export async function listStaffNativeDevices(db, { orgId, staffId, env = process.env } = {}) {
  if (!orgId || !staffId) throw new NativePushError("A staff session is required.", 403);
  const result = await db.query(
    `SELECT d.id, d.encrypted_token, d.apns_environment FROM staff_apns_devices d
      JOIN staff st ON st.id = d.staff_id AND st.org_id = d.org_id AND st.status = 'active'
        AND COALESCE(to_jsonb(st)->>'active', 'true') <> 'false'
      JOIN sessions s ON s.id = d.session_id AND s.staff_id = d.staff_id
        AND s.org_id = d.org_id AND s.revoked_at IS NULL AND s.expires_at > now()
      WHERE d.org_id = $1 AND d.staff_id = $2
        AND d.expired_at IS NULL AND d.revoked_at IS NULL
      ORDER BY d.created_at`,
    [orgId, staffId]
  );
  return result.rows.flatMap((row) => {
    try {
      return [{ id: row.id, token: decryptField(row.encrypted_token, { rowId: row.id, env }),
        environment: row.apns_environment }];
    } catch (err) {
      console.warn(`[push/staff-native-store] device ${row.id} could not be decrypted:`, err?.code || err?.name);
      return [];
    }
  });
}

export async function markStaffNativeDevice(db, id, state) {
  const change = {
    sent: "last_success_at = now(), failure_count = 0",
    expired: "expired_at = now()",
    failed: "failure_count = failure_count + 1"
  }[state];
  if (!change) throw new NativePushError("Unknown notification result.");
  await db.query(`UPDATE staff_apns_devices SET ${change}, updated_at = now() WHERE id = $1`, [id]);
}
