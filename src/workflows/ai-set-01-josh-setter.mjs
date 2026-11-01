// AI-SET-01 — Chris Setter.
// Source: the CRM system map AI SETTER section / vendor setter-prompt.js.
// Trigger: booking.created. The AI setter dials the lead to confirm the Strategy Session.
//
// THE SCRIPT IS NOT REWRITTEN HERE. Prefer the AG-04 row (Agent Editor).
// If that row is missing, Bland's task is SETTER_TASK from
// vendor/inquiry-remover/src/agents/setter-prompt.js — imported, not copied.
// If AG-04 exists but is not ready (retired / draft / no prompt), do NOT fall
// back to the vendor file — that would keep dialing after an intentional stop.
//
// Transmission is only src/messaging/providers/bland-voice.mjs placeCall
// (CLAUDE.md §12). That function honours MESSAGING_DRY_RUN / the outbound
// fence. Unset, empty, or on means no phone rings.

import setterPrompt from "../../vendor/inquiry-remover/src/agents/setter-prompt.js";
import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { placeCall, agentReadiness, normalizePhone } from "../messaging/providers/bland-voice.mjs";
import { inQuietHours, recipientSkipsQuietHours } from "../messaging/gate.mjs";
import { nextQuietHoursEnd } from "../messaging/dispatch.mjs";
import { recordDispatch } from "../lib/outbound-calls.mjs";

export const JOSH_CODE = "AG-04";
export const JOSH_CALL_KIND = "ai-set-01-josh-setter";
export const VENDOR_SETTER_TASK = setterPrompt.SETTER_TASK;

function vendorJoshAgent() {
  return {
    code: JOSH_CODE,
    name: "Setter Chris",
    status: "live",
    runtime: "bland",
    prompt: VENDOR_SETTER_TASK
  };
}

async function resolveJoshAgent(database, orgId) {
  const { rows } = await database.query(
    `SELECT code, name, status, channel, agent_class, runtime, prompt
       FROM agents WHERE org_id = $1 AND code = $2 LIMIT 1`,
    [orgId, JOSH_CODE]
  );
  const row = rows[0] || null;
  // Row present but not ready → return it as-is. handle() refuses placeCall.
  // Never swap in the vendor "live" stand-in after a retire / draft stop.
  if (row) return { agent: row, source: "ag-04" };
  return { agent: vendorJoshAgent(), source: "vendor_prompt" };
}

async function resolvePhone(database, clientId, payload) {
  const { rows } = await database.query(
    `SELECT email, phone FROM clients WHERE id = $1`,
    [clientId]
  );
  return normalizePhone(rows[0]?.phone) || normalizePhone(payload?.phone);
}

export async function handle({ event, db: database, step, placeCallImpl = placeCall, env = process.env, now = () => new Date() }) {
  const clientId = await step.run("resolve-client", () => resolveClient(database, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const phone = await step.run("resolve-phone", () => resolvePhone(database, clientId, event.payload));
  if (!phone) return { done: false, reason: "no_phone" };

  const { agent, source } = await step.run("resolve-josh", () => resolveJoshAgent(database, event.orgId));
  if (!agentReadiness(agent).ok) {
    return { done: false, reason: "agent_not_ready", agentSource: source };
  }

  // Same 8pm–8am Arizona window as SMS. Prove/sim files skip, same as texts.
  // Memoize the wake time so a replay after morning does not schedule a second dial.
  const wakeAt = await step.run("quiet-hours-wake", async () => {
    if (await recipientSkipsQuietHours(database, clientId)) return null;
    const when = now();
    if (!inQuietHours(when)) return null;
    return nextQuietHoursEnd(when).toISOString();
  });
  if (wakeAt) await step.sleepUntil("wait-quiet-hours", new Date(wakeAt));

  const call = await step.run("place-josh-call", async () => {
    const placed = await placeCallImpl({
      agent,
      phone,
      clientId,
      metadata: { org_id: event.orgId, source: JOSH_CALL_KIND },
      env
    });
    if (placed?.status === "sent" && placed.callId) {
      await recordDispatch({
        callId: placed.callId,
        clientId,
        orgId: event.orgId,
        kind: JOSH_CALL_KIND,
        db: database
      });
    }
    return placed;
  });

  return { done: true, call, agentSource: source };
}

export const aiSet01JoshSetter = inngest.createFunction(
  {
    id: "ai-set-01-josh-setter",
    name: "AI-SET-01 — Chris Setter",
    cancelOn: [
      {
        event: "booking.cancelled",
        if: "event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
      },
      {
        event: "booking.cancelled",
        if: "event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      }
    ]
  },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
