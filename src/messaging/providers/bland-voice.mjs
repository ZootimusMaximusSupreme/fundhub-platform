// Bland AI voice — the outbound half of the phone robot.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS
//
// Bland voice for Fundhub. Two call shapes:
//   1. placeCall — Agent Editor scripts (`agents.prompt`) to a person's phone
//   2. placeConfiguredCall — bureau IVR configs built in-repo from
//      vendor/inquiry-remover prompts (used by api/inquiry.mjs)
//
// Both transmit only through this provider (CLAUDE.md §12).
//
//
// WHY IT LIVES IN src/messaging/providers/
//
// CLAUDE.md §12: new outbound transmission may only be added here. A phone call
// reaches a person, so it goes behind the MESSAGING fence, which is what
// postJson() from ./http.mjs binds. src/lib/no-unfenced-transmit.test.mjs fails
// the build if any module reaches the network another way.
//
//
// IT IS NOT REGISTERED IN ./index.mjs, ON PURPOSE.
//
// That registry maps a `provider` string from message_channel_routing onto code
// that sends a `messages` row. This sends no message and writes no row — it
// places a call. Registering it would make a voice runtime selectable as a
// channel's SMS or email sender, which is exactly the "typo in a routing row
// silently sends through the wrong provider" failure index.mjs was written to
// prevent. It is reached only through api/agent-call.mjs.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// FOUR THINGS MUST BE TRUE BEFORE A PHONE RINGS. All four fail closed.
//
//   1. BLAND_API_KEY is set.
//   2. The agent is `live`. Promotion is the human review step, and
//      api/agents.mjs refuses to promote without a written prompt and
//      guardrails, so "live" already means "somebody wrote and approved words".
//   3. The agent has a non-empty prompt. Checked again here rather than trusted:
//      db/migrations/037 seeded two live agents with NULL prompts, which is the
//      whole reason this thread exists. Belt and braces on the exact bug that
//      already happened once.
//   4. MESSAGING_DRY_RUN is explicitly off (src/lib/dry-run.mjs). Unset, empty
//      and unparseable all hold the call. Turning it off is the owner's switch,
//      not this module's.
//
// A refusal is never a fake success. Every path returns a named reason.

import { postJson, classify, redact, success, failure, rejection } from "./http.mjs";
import { phoneIsAgentProveLine } from "../gate.mjs";

export const PROVIDER = "bland_voice";
export const CHANNELS = new Set(["voice"]);
export const ADDRESS_FIELD = "phone";

/* Not routable as a messaging provider — see the header. Declared so the shape
   is readable next to its siblings and so the fence test can see it transmits. */
export const ENABLED = false;
export const TRANSMITS = true;

export const BLAND_API_BASE = "https://api.bland.ai/v1";

/* Bland POSTs here when the call ends. src/adapters/bland.mjs verifies the
   signature and emits call.completed. Matches the default already used by
   vendor/inquiry-remover/src/lib/bland-client.js:12, so a call placed by either
   half returns to the same door. */
export const DEFAULT_WEBHOOK_URL = "https://fundhub.ai/api/webhooks/bland";

/* THE NOTICE THAT HAS TO RIDE WITH THE TAPE.
   `record: true` in placeCall's body asks Bland to tape the call. Nothing else
   in this system tells the person that: searched 2026-08-27, there is no
   disclosure in any agents.prompt, in any seeded message template, or anywhere
   else in the repo. Recording someone without telling them is not allowed in
   the two-party-consent states (California, Florida, Pennsylvania, Washington,
   Illinois, Massachusetts and others), and this dials consumers.

   It lives HERE — not in a caller, not in the prompt — for two reasons:

     1. placeCall is the only body in this file that sets `record`, and BOTH of
        its callers reach consumers: api/agent-call.mjs (Agent Editor, placed by
        hand) and src/workflows/ai-set-01-josh-setter.mjs (placed automatically
        on booking.created). Fixing one caller leaves the other silent.
        placeConfiguredCall — the bureau path — sets no `record` and so needs
        none of this; if it ever starts taping, it needs this too.

     2. agents.prompt is owner-editable in the Agent Editor. A notice living
        there can be removed by a save that meant nothing by it, and the tape
        would keep rolling with no words in front of it.

   Binding the words to the same object that carries `record` is what makes
   "taped but not told" unrepresentable rather than merely discouraged. */
export const RECORDING_NOTICE =
  "FIRST, before anything else you say, speak this sentence exactly, and say " +
  'nothing before it: "Just so you know, this call is recorded." ' +
  "Then continue with the instructions that follow.";

/** The spoken script with the notice in front of it. Exported so the test can
    assert against the real words instead of retyping them. */
export function taskWithRecordingNotice(prompt) {
  return `${RECORDING_NOTICE}\n\n${String(prompt)}`;
}

/** E.164-ish. Bland wants a dialable string; this rejects the obviously wrong
    rather than trying to be a phone-number library. */
export function normalizePhone(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits.length >= 8 ? digits : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** First words Bland speaks. Empty first_sentence + wait_for_greeting hung up our prove line in ~0.13s. */
export function firstSentenceFromPrompt(prompt) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) return "Hey — can you hear me?";
  const cut = text.match(/^(.{1,160}?[.!?])(?:\s|$)/);
  return (cut ? cut[1] : text).slice(0, 160).trim();
}

/**
 * readiness(agent, env) → { ok } | { ok:false, reason, message }
 *
 * Exported so api/agent-call.mjs and the Agent Editor can ask "could this agent
 * call anyone?" WITHOUT dialling. A screen that shows a green LIVE badge should
 * be able to say why the badge is or is not backed by a working phone line.
 */
export function agentReadiness(agent) {
  if (!agent) {
    return {
      ok: false, reason: "no_agent",
      message: "No agent was chosen, so there is nobody to make the call."
    };
  }
  if (agent.runtime !== "bland") {
    return {
      ok: false, reason: "not_a_voice_runtime",
      message: "This agent does not run on the phone system, so it cannot place a call."
    };
  }
  if (agent.status !== "live") {
    return {
      ok: false, reason: "not_live",
      message: "This agent is not live. Write its prompt and guardrails, then promote it."
    };
  }
  if (!agent.prompt || !String(agent.prompt).trim()) {
    return {
      ok: false, reason: "no_prompt",
      message: "This agent has no script saved, so there is nothing for it to say."
    };
  }
  return { ok: true };
}

/**
 * readiness(agent, env) — agentReadiness plus "is the phone system plugged in".
 *
 * THE TWO ARE SEPARATE BECAUSE THE ORDER MATTERS. Checking the API key first
 * made every answer "not configured" — including for a person who has asked
 * never to be phoned. Whether somebody may be called is true or false no matter
 * what this deployment has configured, so api/agent-call.mjs asks the questions
 * about the agent and the person FIRST and only then asks whether we could
 * actually dial. A do-not-call flag must never be reported as a setup problem.
 */
export function readiness(agent, env = process.env) {
  const shape = agentReadiness(agent);
  if (!shape.ok) return shape;
  if (!String(env.BLAND_API_KEY || "").trim()) {
    return {
      ok: false, reason: "not_configured",
      message: "The phone system is not connected on this deployment, so no call can be placed."
    };
  }
  return { ok: true };
}

/**
 * placeCall({ agent, phone, clientId, metadata, env, fetchImpl, webhookUrl })
 *   → { status, providerMessageId, callId, error, retryable, blocked?, reason? }
 *
 * `providerMessageId` / `callId` both carry Bland's call_id — the same id
 * src/adapters/bland.mjs reads back off the completed-call webhook, and the key
 * recordDispatch() stores so the return leg is not anonymous.
 *
 * NEVER THROWS. postJson() classifies transport failures; this classifies
 * everything upstream of them.
 */
export async function placeCall({
  agent,
  phone,
  clientId = null,
  metadata = null,
  env = process.env,
  fetchImpl,
  webhookUrl
} = {}) {
  const ready = readiness(agent, env);
  if (!ready.ok) {
    return { ...rejection(ready.message), callId: null, reason: ready.reason };
  }

  const to = normalizePhone(phone);
  if (!to) {
    return {
      ...rejection("No usable phone number for this person."),
      callId: null, reason: "no_phone"
    };
  }

  const proveLine = phoneIsAgentProveLine(to);
  const body = {
    phone_number: to,
    // THE POINT OF THE WHOLE FILE: the words come from the database row the
    // Agent Editor saves, never from a file in vendor/.
    // Wrapped, not replaced: the recording notice is prepended because `record`
    // is true below. See RECORDING_NOTICE.
    task: taskWithRecordingNotice(agent.prompt),
    /* NO first_sentence ON A REAL CALL, and this is the AI setter's whole bug.
       Bland speaks first_sentence VERBATIM before anything else. Deriving it from
       the prompt (firstSentenceFromPrompt) meant the setter opened every call by reading
       its own instruction sheet out loud — "You are a Fundhub voice agent." — which
       is what "the setter does not work AT ALL" looked like on the 2026-09-03 walk.
       Introduced 2026-08-26.

       It broke the tape notice too: `task` is wrapped by taskWithRecordingNotice
       because `record` is true below, but first_sentence was built from the RAW
       prompt, so the recording notice was never the first thing said on a call that
       was being recorded.

       With the key absent Bland opens the call itself, using the task. The prove
       line is the one exception: that number auto-answers silent, so it needs
       something spoken to prove audio, and it is our own handset, not a consumer.
       Any first_sentence ever added back for a consumer call MUST itself begin
       "Just so you know, this call is recorded." */
    ...(proveLine ? { first_sentence: "Hey — can you hear me?" } : {}),
    // The agent SMS line auto-answers silent. Waiting for a greeting ends the call in ~0.13s.
    wait_for_greeting: !proveLine,
    /* PICKUP — INERT UNTIL THE ACCOUNT OWNS A NUMBER. Asks Bland to dial from the
       destination's own area code. Measured 2026-08-27: it changed nothing, because
       `GET /v1/inbound` returns `{"inbound_numbers":[]}` — this account owns no
       phone number, so there is no local number to dial from and Bland falls back
       to the same shared pool line (+1 659 946 5643). That shared line is why five
       consecutive AG-04 calls to the same 661 handset came back `no-answer` with
       `started_at: null`: the carrier never completed the call, so the robot never
       got to speak. Buying a Bland number is the fix; this line is what makes it
       take effect the moment one exists. Do not read it as today's cure. */
    local_dialing: true,
    /* THE TAPE. Bland defaults `record` to false, so recording_url came back null on
       every call ever placed here — including the ones that did connect and talk.
       "Empty tape" was not a symptom of the hang-up; it was guaranteed separately. */
    /* Paired with taskWithRecordingNotice() on `task` above. Do not set this
       true anywhere that does not also carry the notice. */
    record: true,
    webhook: webhookUrl || String(env.BLAND_WEBHOOK_URL || "").trim() || DEFAULT_WEBHOOK_URL,
    metadata: {
      ...(metadata || {}),
      agent_code: agent.code || null,
      client_id: clientId,
      source: "fundhub-agent-editor"
    }
  };

  /* Bland takes the key raw in Authorization, with no "Bearer" — see
     vendor/inquiry-remover/src/lib/bland-client.js:26. Sending Bearer here 401s. */
  /* STRINGIFY HERE. postJsonTo (src/lib/outbound-fetch.mjs:210-217) sets the
     JSON content-type but passes `body` through to fetch untouched, so handing
     it an object sends the literal text "[object Object]". Every other JSON
     provider in this directory serialises for the same reason. */
  const res = await postJson(`${BLAND_API_BASE}/calls`, {
    headers: { Authorization: String(env.BLAND_API_KEY).trim() },
    body: JSON.stringify(body),
    env,
    fetchImpl,
    what: `bland call ${agent.code || "?"}`
  });

  if (res.blocked) {
    return {
      status: "blocked", providerMessageId: null, callId: null,
      error: "Outbound sending is switched off on this deployment, so no call was placed.",
      retryable: true, blocked: true, reason: "dry_run"
    };
  }
  /* status 0 means no HTTP response happened at all — timeout, DNS, socket.
     Anything with a status is a real answer from Bland and must go to classify()
     so a 400 stays a rejection instead of being retried forever. transmit() sets
     `error` on every non-2xx, so keying on `error` alone hid the status. */
  if (res.status === 0) {
    return { ...failure(res.error || "The phone system could not be reached."), callId: null, reason: "transport" };
  }

  const verdict = classify(res.status);
  if (verdict.status !== "sent") {
    return {
      status: verdict.status,
      providerMessageId: null,
      callId: null,
      error: redact(typeof res.body === "string" ? res.body : JSON.stringify(res.body || {})),
      retryable: verdict.retryable,
      reason: "bland_rejected"
    };
  }

  const payload = typeof res.body === "string" ? safeJson(res.body) : (res.body || {});
  const callId = payload.call_id || payload.callId || payload.id || null;
  if (!callId) {
    /* Bland accepted it but told us nothing we can join on. The call may well be
       ringing, so this is not "rejected" — but the return webhook will land
       anonymous and we say so rather than reporting a clean send. */
    return {
      status: "failed", providerMessageId: null, callId: null,
      error: "The phone system accepted the call but did not return a call id, so the result cannot be matched back to this person.",
      retryable: false, reason: "no_call_id"
    };
  }

  return { ...success(callId), callId, reason: "placed" };
}

/**
 * placeConfiguredCall — full Bland payload (bureau IVR, request_data, etc.).
 * Used by inquiry bureau dials. Same fence as placeCall.
 */
export async function placeConfiguredCall({
  phoneNumber,
  task,
  requestData = null,
  voice = null,
  waitForGreeting = true,
  maxDuration = null,
  transferNumber = null,
  metadata = null,
  webhookUrl = null,
  env = process.env,
  fetchImpl
} = {}) {
  if (!String(env.BLAND_API_KEY || "").trim()) {
    return {
      ...rejection("The phone system is not connected on this deployment, so no call can be placed."),
      callId: null, reason: "not_configured"
    };
  }
  const to = normalizePhone(phoneNumber);
  if (!to) {
    return {
      ...rejection("No usable phone number for this call."),
      callId: null, reason: "no_phone"
    };
  }
  if (!task || !String(task).trim()) {
    return {
      ...rejection("No script for this call."),
      callId: null, reason: "no_task"
    };
  }

  const body = {
    phone_number: to,
    task: String(task),
    wait_for_greeting: waitForGreeting !== false,
    webhook: webhookUrl || String(env.BLAND_WEBHOOK_URL || "").trim() || DEFAULT_WEBHOOK_URL,
    metadata: { ...(metadata || {}), source: "fundhub-inquiry-bureau" }
  };
  if (requestData && typeof requestData === "object") body.request_data = requestData;
  if (voice) body.voice = String(voice);
  if (transferNumber) body.transfer_phone_number = String(transferNumber);
  if (maxDuration != null && Number.isFinite(Number(maxDuration))) {
    body.max_duration = Number(maxDuration);
  }

  const res = await postJson(`${BLAND_API_BASE}/calls`, {
    headers: { Authorization: String(env.BLAND_API_KEY).trim() },
    body: JSON.stringify(body),
    env,
    fetchImpl,
    what: "bland bureau call"
  });

  if (res.blocked) {
    return {
      status: "blocked", providerMessageId: null, callId: null,
      error: "Outbound sending is switched off on this deployment, so no call was placed.",
      retryable: true, blocked: true, reason: "dry_run"
    };
  }
  if (res.status === 0) {
    return { ...failure(res.error || "The phone system could not be reached."), callId: null, reason: "transport" };
  }
  const verdict = classify(res.status);
  if (verdict.status !== "sent") {
    return {
      status: verdict.status,
      providerMessageId: null,
      callId: null,
      error: redact(typeof res.body === "string" ? res.body : JSON.stringify(res.body || {})),
      retryable: verdict.retryable,
      reason: "bland_rejected"
    };
  }
  const payload = typeof res.body === "string" ? safeJson(res.body) : (res.body || {});
  const callId = payload.call_id || payload.callId || payload.id || null;
  if (!callId) {
    return {
      status: "failed", providerMessageId: null, callId: null,
      error: "The phone system accepted the call but did not return a call id.",
      retryable: false, reason: "no_call_id"
    };
  }
  return { ...success(callId), callId, reason: "placed" };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return {}; }
}

export default {
  PROVIDER, placeCall, placeConfiguredCall, readiness, agentReadiness, normalizePhone
};
