#!/usr/bin/env node
// Prove a notification actually lands on a real phone.
//
// This is the one step no test can take: a real browser, a real push service and
// a real device. Everything else about this feature is proven in the suite; this
// script exists so a human can watch a banner appear.
//
// ─────────────────────────────────────────────────────────────────────────────
// USE
//
//   1. Make the keys, once, and put them in the environment.
//
//        node scripts/push/send-test-push.mjs --generate-keys
//
//      It prints a VAPID pair and a storage key and sets nothing. Put them on
//      Netlify (all three contexts, --secret on the two secret ones):
//        VAPID_PUBLIC_KEY  VAPID_PRIVATE_KEY  VAPID_SUBJECT  PUSH_SUB_ENC_KEY
//
//   2. On the phone: open the portal, sign in, and press "Turn on notifications".
//      On an iPhone, add it to the home screen first — the card says so.
//
//   3. Find the client and fire one.
//
//        DATABASE_URL=... node scripts/push/send-test-push.mjs --list
//        DATABASE_URL=... node scripts/push/send-test-push.mjs --client <uuid>
//
// ─────────────────────────────────────────────────────────────────────────────
// IT REALLY SENDS, AND IT SAYS SO FIRST.
//
// The messaging fence (src/lib/outbound-fetch.mjs) blocks every outbound request
// unless MESSAGING_DRY_RUN is explicitly off. This script does NOT quietly set
// that for you — it tells you the fence is up and stops, so nobody transmits by
// running a script they were only reading. Pass --send to mean it.
//
// THE BODY IS THE APPROVED ONE. It goes through the same lock-screen gate every
// other notification does, with the detail flag off, and that gate only lets
// through sentences already written into src/push/payload.mjs — so this script
// cannot be used to put anything of a client's on somebody's phone.
//
// NOTHING IS PRINTED THAT COULD BE USED TO SEND. No endpoint, no key. Row ids,
// device labels and statuses only.

import crypto from "node:crypto";
import { db, close } from "../../src/db.mjs";
import { generateVapidKeys } from "../../src/push/crypto.mjs";
import { sendToClient } from "../../src/push/send.mjs";
import { vapidConfig } from "../../src/messaging/providers/web-push.mjs";
import { isPushStorageConfigured } from "../../src/push/store.mjs";
import { liveSendRequested, runOneOffSend } from "../../src/ops/one-off-send-receipt.mjs";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

function generateKeys() {
  const vapid = generateVapidKeys();
  console.log("");
  console.log("VAPID_PUBLIC_KEY  =", vapid.publicKey);
  console.log("VAPID_PRIVATE_KEY =", vapid.privateKey, "   <- secret");
  console.log("VAPID_SUBJECT     = mailto:support@fundhub.ai");
  console.log("PUSH_SUB_ENC_KEY  =", crypto.randomBytes(32).toString("base64"), "   <- secret");
  console.log("");
  console.log("Set them with:");
  console.log('  netlify env:set VAPID_PUBLIC_KEY "..." --context production --context deploy-preview --context branch-deploy');
  console.log('  netlify env:set VAPID_PRIVATE_KEY "..." --context production --context deploy-preview --context branch-deploy --secret');
  console.log('  netlify env:set VAPID_SUBJECT "mailto:support@fundhub.ai" --context production --context deploy-preview --context branch-deploy');
  console.log('  netlify env:set PUSH_SUB_ENC_KEY "..." --context production --context deploy-preview --context branch-deploy --secret');
  console.log("");
  console.log("Then ONE deploy: netlify deploy --build --prod");
}

async function list() {
  const r = await db.query(
    `SELECT s.client_id,
            c.first_name, c.last_name,
            count(*)::int AS devices,
            max(s.last_success_at) AS last_success
       FROM client_push_subscriptions s
       JOIN clients c ON c.id = s.client_id
      WHERE s.expired_at IS NULL AND s.revoked_at IS NULL
      GROUP BY s.client_id, c.first_name, c.last_name
      ORDER BY max(s.created_at) DESC
      LIMIT 50`
  );
  if (!r.rows.length) {
    console.log("No client has a device registered yet.");
    console.log("Open the portal on a phone, sign in, and press \"Turn on notifications\".");
    return;
  }
  console.log("client_id                             devices  last success         name");
  for (const row of r.rows) {
    console.log(
      String(row.client_id).padEnd(38),
      String(row.devices).padEnd(8),
      String(row.last_success ? new Date(row.last_success).toISOString().slice(0, 19) : "never").padEnd(20),
      `${row.first_name || ""} ${row.last_name || ""}`.trim()
    );
  }
}

async function sendOne(clientId, { live }) {
  const orgRow = await db.query(`SELECT org_id FROM clients WHERE id = $1`, [clientId]);
  if (!orgRow.rows[0]) {
    console.error(`No client with id ${clientId}.`);
    process.exitCode = 1;
    return;
  }
  const orgId = orgRow.rows[0].org_id;

  const cfg = vapidConfig(process.env);
  if (!cfg.ok) {
    console.error("Not configured:", [...(cfg.missing || []), ...(cfg.problems || [])].join(", "));
    process.exitCode = 1;
    return;
  }
  if (!isPushStorageConfigured(process.env)) {
    console.error("PUSH_SUB_ENC_KEY is not set — the stored subscriptions cannot be read.");
    process.exitCode = 1;
    return;
  }

  const env = live ? { ...process.env, MESSAGING_DRY_RUN: "0" } : process.env;

  const send = () => sendToClient(db, {
    orgId,
    clientId,
    // The generic test body from src/push/payload.mjs. Same gate as everything
    // else, detail flag off.
    notification: { kind: "test", url: "/app/client-portal.html", tag: "test" },
    env
  });
  const wrapped = live
    ? await runOneOffSend({
      db,
      orgId,
      clientId,
      scriptId: "send-test-push",
      channel: "push",
      send,
      summarize: (out) => ({
        attempted: out.attempted,
        sent: out.sent,
        failed: out.failed,
        blocked: out.expired,
        error: out.reason,
      }),
    })
    : { outcome: await send(), receipt: null };
  const out = wrapped.outcome;

  console.log("");
  console.log("devices tried :", out.attempted);
  console.log("delivered     :", out.sent);
  console.log("retired (dead):", out.expired);
  console.log("failed        :", out.failed);
  if (out.reason) console.log("reason        :", out.reason);
  for (const r of out.results) {
    console.log(`  ${r.subscriptionId}  ${r.deviceLabel || "unknown"}  ${r.status}  ${r.error || ""}`);
  }
  console.log("");
  if (!live) {
    console.log("NOTHING WAS SENT — the messaging fence is up. Add --send to really send.");
  } else if (out.sent > 0) {
    console.log("The push service accepted it. Look at the phone.");
    console.log("receipt       :", wrapped.receipt.id);
    console.log("A push service accepting is not the same as a phone showing it —");
    console.log("only your eyes can confirm the last step.");
  }
}

async function main() {
  if (has("--generate-keys")) { generateKeys(); return; }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  try {
    if (has("--list")) { await list(); return; }
    const clientId = valueOf("--client");
    if (!clientId) {
      console.log("Usage:");
      console.log("  node scripts/push/send-test-push.mjs --generate-keys");
      console.log("  DATABASE_URL=... node scripts/push/send-test-push.mjs --list");
      console.log("  DATABASE_URL=... node scripts/push/send-test-push.mjs --client <uuid> --send");
      return;
    }
    await sendOne(clientId, { live: liveSendRequested(args) });
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error("failed:", err && err.message);
  process.exitCode = 1;
});
