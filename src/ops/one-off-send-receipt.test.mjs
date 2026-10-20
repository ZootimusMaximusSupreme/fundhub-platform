import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ONE_OFF_SEND_EVENT,
  ONE_OFF_SENDER_IDS,
  liveSendRequested,
  runOneOffSend,
} from "./one-off-send-receipt.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "9af65808-a619-4e65-ae91-239766a006b7";

function fakeDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/INSERT INTO events/.test(sql)) {
        return { rows: [{ id: "receipt-1", created_at: "2026-10-18T12:00:00Z" }] };
      }
      return { rows: [] };
    },
  };
}

test("a provider success leaves one script-tagged durable receipt with no message copy or address", async () => {
  const db = fakeDb();
  const done = await runOneOffSend({
    db,
    orgId: ORG,
    clientId: CLIENT,
    scriptId: "prove-soft-pull-live",
    channel: "email",
    runId: "payment-link-1",
    send: async () => ({ status: "sent", providerMessageId: "resend-1" }),
    summarize: (out) => ({
      attempted: 1,
      sent: out.status === "sent" ? 1 : 0,
      failed: out.status === "sent" ? 0 : 1,
      providerRef: out.providerMessageId,
      error: out.error,
    }),
  });

  assert.equal(done.receipt.status, "sent");
  assert.equal(done.receipt.deduped, false);
  assert.equal(db.calls.length, 1);
  const [org, name, key, client, payload] = db.calls[0].params;
  assert.equal(org, ORG);
  assert.equal(name, ONE_OFF_SEND_EVENT);
  assert.equal(key, "one-off-send:prove-soft-pull-live:payment-link-1");
  assert.equal(client, CLIENT);
  assert.deepEqual(payload, {
    script_id: "prove-soft-pull-live",
    channel: "email",
    status: "sent",
    attempted: 1,
    sent: 1,
    failed: 0,
    blocked: 0,
    provider_ref: "resend-1",
    error: null,
  });
  assert.equal(JSON.stringify(payload).includes("@"), false, "no destination address in the receipt");
  assert.equal(Object.hasOwn(payload, "body"), false, "no message copy in the receipt");
});

test("a refused result and a thrown provider both leave failed receipts", async () => {
  const refusedDb = fakeDb();
  const refused = await runOneOffSend({
    db: refusedDb,
    orgId: ORG,
    scriptId: "send-test-push",
    channel: "push",
    runId: "push-1",
    send: async () => ({ attempted: 2, sent: 0, failed: 1, expired: 1, reason: "provider refused" }),
    summarize: (out) => ({
      attempted: out.attempted,
      sent: out.sent,
      failed: out.failed,
      blocked: out.expired,
      error: out.reason,
    }),
  });
  assert.equal(refused.receipt.status, "failed");
  assert.equal(refusedDb.calls[0].params[4].error, "provider refused");

  const thrownDb = fakeDb();
  await assert.rejects(
    runOneOffSend({
      db: thrownDb,
      orgId: ORG,
      scriptId: "resend-employee-contracts-2026-08-25",
      channel: "email",
      runId: "contract-1",
      send: async () => { throw new Error("provider exploded"); },
      summarize: () => ({ attempted: 1, sent: 1, failed: 0 }),
    }),
    (error) => error.message === "provider exploded" && error.receipt?.status === "failed",
  );
  assert.equal(thrownDb.calls[0].params[4].status, "failed");
});

test("live transmission always needs the explicit --send flag", () => {
  assert.equal(liveSendRequested([]), false);
  assert.equal(liveSendRequested(["--list"]), false);
  assert.equal(liveSendRequested(["--send"]), true);
});

test("every mapped one-off sender uses the shared fence and durable receipt wrapper", () => {
  const files = new Map([
    ["prove-soft-pull-live", "scripts/prove-soft-pull-live.mjs"],
    ["resend-employee-contracts-2026-08-25", "scripts/resend-employee-contracts-2026-08-25.mjs"],
    ["send-test-push", "scripts/push/send-test-push.mjs"],
  ]);
  assert.deepEqual([...files.keys()], [...ONE_OFF_SENDER_IDS]);
  for (const [scriptId, file] of files) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(source, /liveSendRequested/iu, `${scriptId} lost the explicit live-send fence`);
    assert.match(source, /runOneOffSend/iu, `${scriptId} lost its durable final receipt`);
    assert.match(source, new RegExp(`scriptId:\\s*["']${scriptId}["']`, "u"));
  }
});
