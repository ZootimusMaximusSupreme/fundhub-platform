#!/usr/bin/env node
// One deliberate, approved test alert to the Fundhub native iPhone app.
// No network send occurs without both --client <uuid> and --send.
import { db, close } from "../../src/db.mjs";
import { nativePushConfigured, listNativeDevices } from "../../src/push/native-store.mjs";
import { sendNativeToClient } from "../../src/push/native-send.mjs";

const args = process.argv.slice(2);
const clientIndex = args.indexOf("--client");
const clientId = clientIndex >= 0 ? args[clientIndex + 1] : null;
const send = args.includes("--send");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main() {
  if (!clientId || !UUID.test(clientId)) {
    console.log("Usage: node scripts/push/send-test-native.mjs --client <uuid> [--send]");
    console.log("Without --send, this reads eligible devices and sends nothing.");
    if (send) process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const result = await db.query("SELECT org_id FROM clients WHERE id = $1", [clientId]);
  if (!result.rows[0]) throw new Error("Client not found.");
  const orgId = result.rows[0].org_id;
  if (!nativePushConfigured()) throw new Error("APNs signing or encrypted device storage is not configured.");
  const devices = await listNativeDevices(db, { orgId, clientId });
  console.log(`Eligible native iPhones: ${devices.length}`);
  if (!send) {
    console.log("Nothing sent. Add --send for one approved test alert.");
    return;
  }
  const outcome = await sendNativeToClient(db, { orgId, clientId, notification: { kind: "test" } });
  console.log(`APNs accepted: ${outcome.sent}; failed: ${outcome.failed}; expired: ${outcome.expired}`);
  console.log("Apple acceptance is not proof that the banner appeared. Check the iPhone.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(close);
