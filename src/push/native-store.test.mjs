import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, test } from "node:test";
import {
  countNativeDevices, listNativeDevices, normalizeAPNSEnvironment, normalizeAPNSToken,
  registerNativeDevice, revokeNativeDevice
} from "./native-store.mjs";
import { sendNativeToClient } from "./native-send.mjs";

const env = { PUSH_SUB_ENC_KEY: crypto.randomBytes(32).toString("base64") };
const orgId = crypto.randomUUID();
const firstClient = crypto.randomUUID();
const secondClient = crypto.randomUUID();
const firstAccount = crypto.randomUUID();
const secondAccount = crypto.randomUUID();
const firstSession = crypto.randomUUID();
const secondSession = crypto.randomUUID();
const installationId = crypto.randomUUID();
const token = "ab".repeat(32);

function memoryDB() {
  const rows = [];
  const revokedSessions = new Set();
  return {
    rows,
    revokeSession: (id) => revokedSessions.add(id),
    async query(sql, params) {
      if (sql.includes("SELECT id, org_id, client_id, token_hash")) {
        return { rows: rows.filter((row) => !row.revoked_at && !row.expired_at
          && ((row.token_hash === params[0] && row.apns_environment === params[1])
            || row.installation_id === params[2])) };
      }
      if (sql.includes("UPDATE client_apns_devices SET encrypted_token")) {
        Object.assign(rows.find((row) => row.id === params[0]), {
          encrypted_token: params[1], account_id: params[2], session_id: params[3]
        });
        return { rows: [] };
      }
      if (sql.includes("UPDATE client_apns_devices SET revoked_at") && sql.includes("WHERE id = $1")) {
        rows.find((row) => row.id === params[0]).revoked_at = new Date();
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO client_apns_devices")) {
        rows.push({ id: params[0], org_id: params[1], client_id: params[2], account_id: params[3],
          session_id: params[4], installation_id: params[5], token_hash: params[6], encrypted_token: params[7],
          apns_environment: params[8], revoked_at: null, expired_at: null });
        return { rows: [] };
      }
      if (sql.includes("UPDATE client_apns_devices SET revoked_at") && sql.includes("WHERE org_id")) {
        const found = rows.filter((row) => row.org_id === params[0] && row.client_id === params[1]
          && row.installation_id === params[2] && !row.revoked_at && !row.expired_at);
        for (const row of found) row.revoked_at = new Date();
        return { rows: found.map((row) => ({ id: row.id })) };
      }
      if (sql.includes("SELECT count(*)::int AS count")) {
        return { rows: [{ count: rows.filter((row) => row.org_id === params[0]
          && row.client_id === params[1] && row.installation_id === params[2]
          && row.session_id === params[3]
          && !row.revoked_at && !row.expired_at).length }] };
      }
      if (sql.includes("SELECT d.id, d.encrypted_token, d.apns_environment")) {
        assert.match(sql, /JOIN account_sessions s ON s\.id = d\.session_id/);
        assert.match(sql, /s\.revoked_at IS NULL AND s\.expires_at > now\(\)/);
        return { rows: rows.filter((row) => row.org_id === params[0] && row.client_id === params[1]
          && !row.revoked_at && !row.expired_at && !revokedSessions.has(row.session_id)) };
      }
      if (sql.includes("UPDATE client_apns_devices SET last_success_at")) {
        rows.find((row) => row.id === params[0]).last_success_at = new Date();
        return { rows: [] };
      }
      if (sql.includes("UPDATE client_apns_devices SET expired_at")) {
        rows.find((row) => row.id === params[0]).expired_at = new Date();
        return { rows: [] };
      }
      if (sql.includes("UPDATE client_apns_devices SET failure_count")) {
        const row = rows.find((item) => item.id === params[0]);
        row.failure_count = (row.failure_count || 0) + 1;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
    }
  };
}

describe("native iPhone device lifecycle", () => {
  test("accepts variable-length hex tokens but no invented environment", () => {
    assert.equal(normalizeAPNSToken("AB".repeat(32)), token);
    assert.throws(() => normalizeAPNSToken("abc"));
    assert.equal(normalizeAPNSEnvironment("production"), "production");
    assert.throws(() => normalizeAPNSEnvironment("sandbox"));
  });

  test("encrypts at rest, deduplicates, and revokes the prior client when a phone changes hands", async () => {
    const db = memoryDB();
    const input = { orgId, clientId: firstClient, accountId: firstAccount, sessionId: firstSession,
      installationId, token, environment: "development", env };
    const added = await registerNativeDevice(db, input);
    assert.equal(added.created, true);
    assert.equal(db.rows[0].encrypted_token.includes(token), false);
    assert.equal((await listNativeDevices(db, { orgId, clientId: firstClient, env }))[0].token, token);
    assert.equal((await registerNativeDevice(db, input)).created, false);
    assert.equal(db.rows.length, 1);
    await registerNativeDevice(db, { ...input, clientId: secondClient, accountId: secondAccount,
      sessionId: secondSession });
    assert.ok(db.rows[0].revoked_at);
    assert.equal(await countNativeDevices(db, { orgId, clientId: firstClient, sessionId: firstSession, installationId }), 0);
    assert.equal(await countNativeDevices(db, { orgId, clientId: secondClient, sessionId: secondSession, installationId }), 1);
    assert.equal((await revokeNativeDevice(db, { orgId, clientId: firstClient, installationId })).revoked, false);
    assert.equal((await revokeNativeDevice(db, { orgId, clientId: secondClient, installationId })).revoked, true);
  });

  test("sender counts Apple acceptance, temporary failure, and permanent expiry", async () => {
    const db = memoryDB();
    await registerNativeDevice(db, { orgId, clientId: firstClient, accountId: firstAccount,
      sessionId: firstSession, installationId,
      token, environment: "production", env });
    const sent = await sendNativeToClient(db, { orgId, clientId: firstClient,
      notification: { kind: "test" }, env, send: async () => ({ status: "sent", gone: false }) });
    assert.equal(sent.sent, 1);
    assert.ok(db.rows[0].last_success_at);
    const gone = await sendNativeToClient(db, { orgId, clientId: firstClient,
      notification: { kind: "test" }, env, send: async () => ({ status: "failed", gone: true }) });
    assert.equal(gone.expired, 1);
    assert.ok(db.rows[0].expired_at);
    assert.equal((await sendNativeToClient(db, { orgId, clientId: firstClient,
      notification: { kind: "test" }, env })).reason, "no_native_device_on_file");
  });

  test("a revoked account session leaves no device eligible for delivery", async () => {
    const db = memoryDB();
    await registerNativeDevice(db, { orgId, clientId: firstClient, accountId: firstAccount,
      sessionId: firstSession, installationId, token, environment: "development", env });
    db.revokeSession(firstSession);
    const result = await sendNativeToClient(db, { orgId, clientId: firstClient,
      notification: { kind: "test" }, env,
      send: async () => { throw new Error("revoked session must never send"); } });
    assert.equal(result.reason, "no_native_device_on_file");
  });
});
