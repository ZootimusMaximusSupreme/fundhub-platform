import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { gapChecks } from "./gap-native-push.mjs";

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const readyEnv = {
  PUSH_SUB_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  APNS_KEY_ID: "ABCDEFGHIJ",
  APNS_TEAM_ID: "1234567890",
  APNS_PRIVATE_KEY_BASE64: Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" })).toString("base64")
};

test("native push tripwire passes only when owner rows and signing are sound", async () => {
  const db = { query: async () => ({ rows: [{ active: 2, wrong_owner: 0, recent_failed: 0 }] }) };
  const rows = await gapChecks({ db, env: readyEnv });
  assert.deepEqual(rows.map((row) => row.status), ["PASS", "PASS", "PASS"]);
});

test("a mismatched device and missing Apple key stay red", async () => {
  const db = { query: async () => ({ rows: [{ active: 2, wrong_owner: 1, recent_failed: 1 }] }) };
  const rows = await gapChecks({ db, env: { PUSH_SUB_ENC_KEY: readyEnv.PUSH_SUB_ENC_KEY } });
  assert.deepEqual(rows.map((row) => row.status), ["FAIL", "FAIL", "FAIL"]);
});

test("a failed database read is a skip, never a pass", async () => {
  const db = { query: async () => { throw new Error("read failed"); } };
  const rows = await gapChecks({ db, env: readyEnv });
  assert.deepEqual(rows.map((row) => row.status), ["skip", "skip", "PASS"]);
});

test("a missing APNs receipt count stays not checked", async () => {
  const db = { query: async () => ({ rows: [{ active: 0, wrong_owner: 0 }] }) };
  const rows = await gapChecks({ db, env: readyEnv });
  assert.deepEqual(rows.map((row) => row.status), ["PASS", "skip", "PASS"]);
});
