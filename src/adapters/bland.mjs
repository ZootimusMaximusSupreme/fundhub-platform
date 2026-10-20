// Bland AI voice-call adapter — inquiry-removal bureau calls.
//
// Adapts Bland AI's completed-call webhook into canonical bus events.
// Three responsibilities only:
//   1. verify the webhook signature (fail-closed),
//   2. normalize the raw body into a flat call event,
//   3. emit canonical events — handlers react.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ ⚠️ CONFIRM against a real Bland webhook payload before go-live.            │
// │ Bland's webhook auth docs are thin. The scheme below is HMAC-SHA256 of   │
// │ the raw body keyed by the shared secret, hex-encoded (same as Commas).   │
// │ Header name assumed: "x-bland-signature". Adjust header name + scheme    │
// │ once Bland confirms in https://docs.bland.ai/webhook-auth.                │
// └───────────────────────────────────────────────────────────────────────────┘

import crypto from "node:crypto";
import { emit } from "../events/bus.mjs";
import { resolveDispatchByCallId, enrichCompletedCallTranscript } from "../lib/outbound-calls.mjs";

// --- 1. Signature verification (fail-closed) --------------------------------
// HMAC-SHA256 of raw body keyed by the shared secret. Returns false on any
// mismatch / missing input — caller MUST reject the request when false.
export function verifyBlandSignature(rawBody, header, secret) {
  if (!secret) return false;
  const provided = String(header || "").trim();
  if (!provided) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
  // Accept raw hex or "sha256=<hex>" prefix.
  const providedHex = provided.includes("=") ? provided.split("=").pop().trim() : provided;
  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// --- 2. Normalize the webhook body into a flat event ------------------------
// Reads defensively from several known Bland payload shapes.
//
// Bland payload reference (observed + docs, may vary by plan):
//   { call_id, status, completed, disposition, answered_by,
//     call_length, duration, transferred_to, queue_status }
export function normalizeBlandEvent(body) {
  const b = body || {};

  const callId =
    b.call_id ||
    b.callId ||
    b.id ||
    null;

  // completed flag: boolean `completed`, or status string containing
  // "completed" / "ended" / "finished". in-progress calls have status "in-progress" etc.
  const completedFlag = Boolean(b.completed);
  const statusRaw = String(b.status || "").toLowerCase();
  const isCompleted =
    completedFlag ||
    statusRaw === "completed" ||
    statusRaw === "ended" ||
    statusRaw === "finished";

  // Duration in seconds: prefer integer fields, fall back to call_length (may be float minutes).
  let durationSec = null;
  if (typeof b.duration === "number") {
    durationSec = Math.round(b.duration);
  } else if (typeof b.call_length === "number") {
    // Bland reports call_length in seconds (float) per observed payloads.
    durationSec = Math.round(b.call_length);
  }

  // Disposition / answered_by
  const disposition =
    b.disposition ||
    b.answered_by ||
    null;

  // Whether the call was transferred (transferred_to present and non-empty,
  // or queue_status indicates transfer).
  const transferred =
    Boolean(b.transferred_to) ||
    String(b.queue_status || "").toLowerCase().includes("transfer");

  // Preserve the words of the call for the same CRM context used by SMS.
  // Bland supplies either a joined transcript or speaker-labelled turns.
  const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
  const turns = Array.isArray(b.transcripts) ? b.transcripts : [];
  const transcript = text(b.concatenated_transcript) || text(b.transcript) ||
    text(turns.map((turn) => {
      const words = text(turn?.text);
      return words ? `${text(turn.user) || "Speaker"}: ${words}` : "";
    }).filter(Boolean).join("\n"));

  return {
    callId: callId ? String(callId) : null,
    status: statusRaw || null,
    isCompleted,
    disposition: disposition ? String(disposition) : null,
    durationSec,
    transferred,
    transcript,
    summary: text(b.summary),
    recordingUrl: text(b.recording_url)
  };
}

// Map disposition to a canonical outcome for ds-01 / s-08 workflows.
function dispositionToOutcome(disposition) {
  if (!disposition) return null;
  const d = String(disposition).toLowerCase();
  if (d === "declined") return "declined";
  if (d === "no_answer" || d === "no-answer" || d === "voicemail") return "no_answer";
  if (d === "transferred" || d === "human") return "transferred";
  return d;
}

// --- 3. Map a normalized event to canonical events (pure) -------------------
// Only emit call.completed when the call is actually finished.
// Returns [] for in-progress / unknown state — bus sees nothing.
export function mapToCanonical(evt) {
  if (!evt || !evt.isCompleted) return [];
  return [
    {
      name: "call.completed",
      payload: {
        callId: evt.callId,
        status: evt.status,
        disposition: evt.disposition,
        outcome: dispositionToOutcome(evt.disposition),
        durationSec: evt.durationSec,
        transferred: evt.transferred,
        transcript: evt.transcript || null,
        summary: evt.summary || null,
        recordingUrl: evt.recordingUrl || null,
        source: "bland"
      }
    }
  ];
}

// --- Adapter entrypoint -----------------------------------------------------
// handleBlandWebhook({ db, rawBody, signatureHeader, secret, clientId? })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// clientId is only a caller cross-check. Attribution always comes from the
// stored dispatch and its matching client/company, never webhook payload IDs.
export async function handleBlandWebhook({ db, rawBody, signatureHeader, secret, clientId }) {
  if (!verifyBlandSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
  }

  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, reason: "invalid_json", emitted: [] };
  }

  const evt = normalizeBlandEvent(body);

  if (!evt.isCompleted) {
    return { ok: true, status: 200, reason: "not_completed", emitted: [] };
  }

  const dispatch = await resolveDispatchByCallId(evt.callId, db);
  if (!dispatch) {
    return { ok: false, status: 409, reason: "call_dispatch_not_found", emitted: [] };
  }
  if (clientId != null && String(clientId) !== String(dispatch.clientId)) {
    return { ok: false, status: 409, reason: "call_attribution_mismatch", emitted: [] };
  }

  const canonical = mapToCanonical(evt);

  const emitted = [];
  for (const c of canonical) {
    const idKey = evt.callId ? `bland:${evt.callId}:${c.name}` : undefined;
    const res = await emit(db, c.name, c.payload, {
      idempotencyKey: idKey,
      clientId: dispatch.clientId,
      orgId: dispatch.orgId
    });
    if (res.deduped && evt.transcript) {
      await enrichCompletedCallTranscript(db, {
        orgId: dispatch.orgId, clientId: dispatch.clientId, callId: evt.callId, payload: c.payload
      });
    }
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }

  return { ok: true, status: 200, emitted };
}
