import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import {
  registerStaffNativeDevice, revokeStaffNativeDevice, countStaffNativeDevices,
  listStaffNativeDevices
} from "./staff-native-store.mjs";
import { sendNativeToStaff } from "./native-send.mjs";

const env = { PUSH_SUB_ENC_KEY: crypto.randomBytes(32).toString("base64") };
const orgId = crypto.randomUUID();
const staffId = crypto.randomUUID();
const otherStaff = crypto.randomUUID();
const clientId = crypto.randomUUID();
const sessionId = crypto.randomUUID();
const installationId = crypto.randomUUID();
const token = "cd".repeat(32);

function memoryDB() {
  const devices = [];
  const alerts = [];
  const revokedSessions = new Set();
  return {
    devices, alerts,
    revokeSession(id) { revokedSessions.add(id); },
    async query(sql, params = []) {
      if (sql.includes("SELECT id, org_id, staff_id, token_hash")) {
        return { rows: devices.filter((d) => !d.revoked_at && !d.expired_at &&
          ((d.token_hash === params[0] && d.apns_environment === params[1]) || d.installation_id === params[2])) };
      }
      if (sql.includes("UPDATE staff_apns_devices SET encrypted_token")) {
        Object.assign(devices.find((d) => d.id === params[0]), {
          encrypted_token: params[1], session_id: params[2]
        });
        return { rows: [] };
      }
      if (sql.includes("UPDATE staff_apns_devices SET revoked_at") && sql.includes("WHERE id = $1")) {
        devices.find((d) => d.id === params[0]).revoked_at = new Date();
        return { rows: [] };
      }
      if (sql.includes("UPDATE client_apns_devices SET revoked_at")) return { rows: [] };
      if (sql.includes("INSERT INTO staff_apns_devices")) {
        devices.push({ id: params[0], org_id: params[1], staff_id: params[2],
          session_id: params[3], installation_id: params[4], token_hash: params[5],
          encrypted_token: params[6], apns_environment: params[7],
          revoked_at: null, expired_at: null });
        return { rows: [] };
      }
      if (sql.includes("UPDATE staff_apns_devices SET revoked_at") && sql.includes("WHERE org_id")) {
        const found = devices.filter((d) => d.org_id === params[0] && d.staff_id === params[1]
          && d.installation_id === params[2] && !d.revoked_at && !d.expired_at);
        found.forEach((d) => { d.revoked_at = new Date(); });
        return { rows: found.map((d) => ({ id: d.id })) };
      }
      if (sql.includes("SELECT count(*)::int AS count FROM staff_apns_devices")) {
        assert.match(sql, /JOIN sessions s ON s\.id = d\.session_id/);
        return { rows: [{ count: devices.filter((d) => d.org_id === params[0]
          && d.staff_id === params[1] && d.installation_id === params[2]
          && d.session_id === params[3] && !d.revoked_at && !d.expired_at
          && !revokedSessions.has(d.session_id)).length }] };
      }
      if (sql.includes("SELECT d.id, d.encrypted_token, d.apns_environment FROM staff_apns_devices")) {
        assert.match(sql, /s\.revoked_at IS NULL AND s\.expires_at > now\(\)/);
        return { rows: devices.filter((d) => d.org_id === params[0] && d.staff_id === params[1]
          && !d.revoked_at && !d.expired_at && !revokedSessions.has(d.session_id)) };
      }
      if (sql.includes("INSERT INTO staff_apns_alerts")) {
        if (alerts.some((a) => a.org_id === params[0] && a.staff_id === params[1]
          && a.client_id === params[2] && a.kind === params[3] && a.alert_key === params[4])) {
          return { rows: [] };
        }
        const row = { id: crypto.randomUUID(), org_id: params[0], staff_id: params[1],
          client_id: params[2], kind: params[3], alert_key: params[4], status: "attempted" };
        alerts.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (sql.includes("UPDATE staff_apns_alerts SET status")) {
        Object.assign(alerts.find((a) => a.id === params[0]), {
          status: params[1], attempted: params[2], sent: params[3]
        });
        return { rows: [] };
      }
      if (sql.includes("UPDATE staff_apns_devices SET last_success_at")) {
        devices.find((d) => d.id === params[0]).last_success_at = new Date();
        return { rows: [] };
      }
      if (sql.includes("UPDATE staff_apns_devices SET expired_at")) {
        devices.find((d) => d.id === params[0]).expired_at = new Date();
        return { rows: [] };
      }
      if (sql.includes("UPDATE staff_apns_devices SET failure_count")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
    }
  };
}

test("staff iPhone registration is encrypted, session-bound, and follows the signed-in staff member", async () => {
  const db = memoryDB();
  const first = { orgId, staffId, sessionId, installationId, token, environment: "development", env };
  assert.equal((await registerStaffNativeDevice(db, first)).created, true);
  assert.equal(db.devices[0].encrypted_token.includes(token), false);
  assert.equal((await listStaffNativeDevices(db, { orgId, staffId, env }))[0].token, token);
  assert.equal((await registerStaffNativeDevice(db, first)).created, false);
  assert.equal(db.devices.length, 1);
  assert.equal(await countStaffNativeDevices(db, { orgId, staffId, sessionId, installationId }), 1);
  await registerStaffNativeDevice(db, { ...first, staffId: otherStaff, sessionId: crypto.randomUUID() });
  assert.ok(db.devices[0].revoked_at);
  assert.equal((await listStaffNativeDevices(db, { orgId, staffId, env })).length, 0);
  assert.equal((await revokeStaffNativeDevice(db, { orgId, staffId: otherStaff, installationId })).revoked, true);
});

test("staff send needs a stable key, targets a live session, and never replays an alert", async () => {
  const db = memoryDB();
  const args = { orgId, staffId, clientId, kind: "lead", key: `entry:${clientId}`, env };
  assert.equal((await sendNativeToStaff(db, { ...args, send: async () => { throw new Error("no device"); } })).reason,
    "no_native_device_on_file");
  assert.equal(db.alerts.length, 0);
  await registerStaffNativeDevice(db, { orgId, staffId, sessionId, installationId,
    token, environment: "production", env });
  const sent = [];
  const send = async (request) => { sent.push(request); return { status: "sent", gone: false }; };
  assert.equal((await sendNativeToStaff(db, { ...args, send })).sent, 1);
  assert.equal(sent[0].notification.audience, "staff");
  assert.equal(sent[0].notification.clientId, clientId);
  assert.equal(db.alerts[0].status, "sent");
  assert.equal((await sendNativeToStaff(db, { ...args, send })).reason, "already_claimed");
  assert.equal(sent.length, 1);
  assert.equal((await sendNativeToStaff(db, { ...args, kind: "set", send })).sent, 1);
  assert.equal(sent.length, 2);
  await assert.rejects(sendNativeToStaff(db, { ...args, kind: "unknown", send }), /unknown staff push kind/);
  await assert.rejects(sendNativeToStaff(db, { ...args, key: "", send }), /stable key/);
  db.revokeSession(sessionId);
  assert.equal((await sendNativeToStaff(db, { ...args, kind: "upcoming", send })).reason,
    "no_native_device_on_file");
  assert.equal(sent.length, 2);
});
