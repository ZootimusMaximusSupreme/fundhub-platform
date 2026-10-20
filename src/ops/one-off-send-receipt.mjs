// Durable receipt for hand-run scripts that can reach a person.
//
// These scripts do not have a recurring job whose saved result the heartbeat
// can inspect. Every live run therefore writes one append-only event after the
// provider answers. The event names the script, channel, attempted/sent/failed
// counts and provider reference without storing message copy or an address.

import { randomUUID } from "node:crypto";

export const ONE_OFF_SEND_EVENT = "script.one_off_send";
export const ONE_OFF_SENDER_IDS = Object.freeze([
  "prove-soft-pull-live",
  "resend-employee-contracts-2026-08-25",
  "send-test-push",
]);

const ALLOWED = new Set(ONE_OFF_SENDER_IDS);
const CHANNELS = new Set(["email", "push", "sms"]);

export function liveSendRequested(args = process.argv.slice(2)) {
  return Array.isArray(args) && args.includes("--send");
}

function count(value, name) {
  const number = Number(value || 0);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return number;
}

function words(value, max = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function normalizedSummary(summary = {}) {
  const attempted = count(summary.attempted, "attempted");
  const sent = count(summary.sent, "sent");
  const failed = count(summary.failed, "failed");
  const blocked = count(summary.blocked, "blocked");
  if (sent + failed + blocked > attempted) {
    throw new TypeError("sent + failed + blocked cannot exceed attempted");
  }
  return {
    attempted,
    sent,
    failed,
    blocked,
    status: sent > 0 && failed === 0 && blocked === 0 ? "sent" : "failed",
    providerRef: words(summary.providerRef, 180),
    error: words(summary.error),
  };
}

export async function recordOneOffSendReceipt(db, {
  orgId,
  clientId = null,
  scriptId,
  channel,
  runId = randomUUID(),
  summary,
} = {}) {
  if (!db || typeof db.query !== "function") throw new TypeError("db.query is required");
  if (!ALLOWED.has(scriptId)) throw new TypeError(`unknown one-off sender: ${String(scriptId || "")}`);
  if (!CHANNELS.has(channel)) throw new TypeError(`unsupported one-off channel: ${String(channel || "")}`);
  const org = words(orgId, 80);
  const run = words(runId, 120);
  if (!org) throw new TypeError("orgId is required");
  if (!run) throw new TypeError("runId is required");

  const result = normalizedSummary(summary);
  const idempotencyKey = `one-off-send:${scriptId}:${run}`;
  const payload = {
    script_id: scriptId,
    channel,
    status: result.status,
    attempted: result.attempted,
    sent: result.sent,
    failed: result.failed,
    blocked: result.blocked,
    provider_ref: result.providerRef,
    error: result.error,
  };

  const inserted = await db.query(
    `INSERT INTO events (org_id, name, version, idempotency_key, client_id, payload)
     VALUES ($1::uuid,$2,1,$3,$4::uuid,$5::jsonb)
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING id, created_at`,
    [org, ONE_OFF_SEND_EVENT, idempotencyKey, clientId || null, payload],
  );
  if (inserted.rows?.[0]) {
    return { ...inserted.rows[0], deduped: false, idempotencyKey, ...result };
  }
  const existing = await db.query(
    `SELECT id, created_at FROM events
      WHERE org_id = $1::uuid AND idempotency_key = $2
      LIMIT 1`,
    [org, idempotencyKey],
  );
  return { ...(existing.rows?.[0] || { id: null, created_at: null }), deduped: true, idempotencyKey, ...result };
}

export async function runOneOffSend({
  db,
  orgId,
  clientId = null,
  scriptId,
  channel,
  runId = randomUUID(),
  send,
  summarize,
} = {}) {
  if (typeof send !== "function") throw new TypeError("send is required");
  if (typeof summarize !== "function") throw new TypeError("summarize is required");

  let outcome;
  try {
    outcome = await send();
  } catch (error) {
    const receipt = await recordOneOffSendReceipt(db, {
      orgId,
      clientId,
      scriptId,
      channel,
      runId,
      summary: { attempted: 1, sent: 0, failed: 1, error: error?.message || error },
    });
    error.receipt = receipt;
    throw error;
  }

  const receipt = await recordOneOffSendReceipt(db, {
    orgId,
    clientId,
    scriptId,
    channel,
    runId,
    summary: summarize(outcome),
  });
  return { outcome, receipt };
}
