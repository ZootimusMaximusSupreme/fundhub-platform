import crypto from "node:crypto";
import { decryptField, encryptField, isPushStorageConfigured } from "./store.mjs";
import { apnsProviderToken } from "./apns.mjs";

export class NativePushError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "NativePushError";
    this.status = status;
  }
}

export function normalizeAPNSToken(value) {
  const token = String(value || "").trim().toLowerCase();
  // Apple does not promise a fixed token length. It is binary data rendered as hex.
  if (!/^(?:[0-9a-f]{2}){16,256}$/.test(token)) {
    throw new NativePushError("The iPhone did not provide a usable notification token.");
  }
  return token;
}

export function normalizeAPNSEnvironment(value) {
  if (value === "development" || value === "production") return value;
  throw new NativePushError("The iPhone did not provide a usable notification environment.");
}

export function normalizeInstallationId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new NativePushError("The iPhone did not provide a usable installation ID.");
  }
  return id;
}

export function nativePushConfigured(env = process.env) {
  if (!isPushStorageConfigured(env)) return false;
  try { apnsProviderToken(env); return true; }
  catch { return false; }
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function registerNativeDevice(db, {
  orgId, clientId, accountId, sessionId, installationId: inputInstallationId,
  token: input, environment: inputEnvironment, env = process.env
} = {}) {
  if (!orgId || !clientId || !accountId || !sessionId) throw new NativePushError("A client session is required.", 403);
  if (!isPushStorageConfigured(env)) throw new NativePushError("Notifications are not set up yet.", 503);
  const token = normalizeAPNSToken(input);
  const environment = normalizeAPNSEnvironment(inputEnvironment);
  const installationId = normalizeInstallationId(inputInstallationId);
  const hash = tokenHash(token);
  const existing = await db.query(
    `SELECT id, org_id, client_id, token_hash, apns_environment, installation_id
       FROM client_apns_devices
      WHERE ((token_hash = $1 AND apns_environment = $2) OR installation_id = $3)
        AND expired_at IS NULL AND revoked_at IS NULL`,
    [hash, environment, installationId]
  );
  const row = existing.rows.length === 1 ? existing.rows[0] : null;
  if (row && String(row.org_id) === String(orgId) && String(row.client_id) === String(clientId)
      && row.token_hash === hash && row.apns_environment === environment
      && String(row.installation_id) === installationId) {
    await db.query(
      `UPDATE client_apns_devices SET encrypted_token = $2, account_id = $3, session_id = $4,
        failure_count = 0, updated_at = now() WHERE id = $1`,
      [row.id, encryptField(token, { rowId: row.id, env }), accountId, sessionId]
    );
    return { id: row.id, created: false };
  }
  for (const prior of existing.rows) {
    // The device changed hands or Apple rotated its token. Stop old alerts first.
    await db.query(`UPDATE client_apns_devices SET revoked_at = now(), updated_at = now() WHERE id = $1`, [prior.id]);
  }
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO client_apns_devices
       (id, org_id, client_id, account_id, session_id, installation_id, token_hash, encrypted_token, apns_environment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, orgId, clientId, accountId, sessionId, installationId, hash, encryptField(token, { rowId: id, env }), environment]
  );
  return { id, created: true };
}

export async function revokeNativeDevice(db, {
  orgId, clientId, installationId: inputInstallationId
} = {}) {
  if (!orgId || !clientId) throw new NativePushError("A client session is required.", 403);
  const installationId = normalizeInstallationId(inputInstallationId);
  const result = await db.query(
    `UPDATE client_apns_devices SET revoked_at = now(), updated_at = now()
      WHERE org_id = $1 AND client_id = $2 AND installation_id = $3
        AND expired_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [orgId, clientId, installationId]
  );
  return { revoked: result.rows.length > 0 };
}

export async function countNativeDevices(db, { orgId, clientId, sessionId, installationId: inputInstallationId } = {}) {
  if (!orgId || !clientId || !sessionId) throw new NativePushError("A client session is required.", 403);
  const installationId = normalizeInstallationId(inputInstallationId);
  const result = await db.query(
    `SELECT count(*)::int AS count FROM client_apns_devices d
      JOIN accounts a ON a.id = d.account_id AND a.org_id = d.org_id AND a.status = 'active'
      JOIN account_sessions s ON s.id = d.session_id AND s.account_id = d.account_id
        AND s.org_id = d.org_id AND s.revoked_at IS NULL AND s.expires_at > now()
      WHERE d.org_id = $1 AND d.client_id = $2 AND d.installation_id = $3 AND d.session_id = $4
        AND d.expired_at IS NULL AND d.revoked_at IS NULL
        AND ((a.kind = 'client' AND a.client_id = d.client_id)
          OR (a.kind = 'authorized_rep' AND s.active_client_id = d.client_id))`,
    [orgId, clientId, installationId, sessionId]
  );
  return Number(result.rows[0]?.count || 0);
}

export async function listNativeDevices(db, { orgId, clientId, env = process.env } = {}) {
  if (!orgId || !clientId) throw new NativePushError("A client session is required.", 403);
  const result = await db.query(
    `SELECT d.id, d.encrypted_token, d.apns_environment FROM client_apns_devices d
      JOIN accounts a ON a.id = d.account_id AND a.org_id = d.org_id
        AND a.status = 'active'
      JOIN account_sessions s ON s.id = d.session_id AND s.account_id = d.account_id
        AND s.org_id = d.org_id AND s.revoked_at IS NULL AND s.expires_at > now()
      WHERE d.org_id = $1 AND d.client_id = $2
        AND d.expired_at IS NULL AND d.revoked_at IS NULL
        AND ((a.kind = 'client' AND a.client_id = d.client_id)
          OR (a.kind = 'authorized_rep' AND s.active_client_id = d.client_id))
      ORDER BY d.created_at`,
    [orgId, clientId]
  );
  return result.rows.flatMap((row) => {
    try {
      return [{ id: row.id, token: decryptField(row.encrypted_token, { rowId: row.id, env }),
        environment: row.apns_environment }];
    } catch (err) {
      console.warn(`[push/native-store] device ${row.id} could not be decrypted:`, err?.code || err?.name);
      return [];
    }
  });
}

export async function markNativeDevice(db, id, state) {
  const change = {
    sent: "last_success_at = now(), failure_count = 0",
    expired: "expired_at = now()",
    failed: "failure_count = failure_count + 1"
  }[state];
  if (!change) throw new NativePushError("Unknown notification result.");
  await db.query(`UPDATE client_apns_devices SET ${change}, updated_at = now() WHERE id = $1`, [id]);
}

export default { registerNativeDevice, revokeNativeDevice, countNativeDevices, listNativeDevices, markNativeDevice };
