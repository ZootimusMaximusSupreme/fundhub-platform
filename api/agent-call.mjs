// POST /api/agent-call — start a phone call for a registry agent, or ask
// whether one could be started.
//
//   { action: "check", agent_code, client_id? }  → never dials. Says yes or why not.
//   { action: "call",  agent_code, client_id }   → places the call.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
//
// Nothing on this site could start a phone call from the Agent Editor until
// this route. Bureau inquiry dials live on /api/inquiry (in-repo). This route
// is for client-facing agents only (AG-04 style).
//
// This is the in-house replacement seam. It is deliberately small: it decides
// WHETHER a call may happen and records that it did. The transmission itself is
// src/messaging/providers/bland-voice.mjs, which is the only directory
// CLAUDE.md §12 permits new outbound traffic in.
//
//
// THE SCRIPT COMES FROM THE DATABASE. THAT IS THE POINT.
//
// Bland speaks `agents.prompt` — the column the Agent Editor's Save button
// writes. Before this, the words on a real call lived in a hardcoded template
// literal in vendor/inquiry-remover/src/agents/setter-prompt.js, so editing an
// agent in the CRM changed nothing a caller would hear and editing the file
// changed nothing the screen showed. One store now.
//
//
// FIVE GATES, ALL FAIL-CLOSED. A refusal is never reported as a success.
//   1. Staff session, and a role that is allowed to contact a client.
//   2. The agent is live, runs on Bland, and has a prompt (bland-voice.readiness).
//   3. The client belongs to the caller's org and has a usable phone number.
//   4. Consent: not opted out of voice, and not flagged do-not-call by voice.
//   5. The messaging gate, run over the words the robot will actually say.
// Then MESSAGING_DRY_RUN, inside the provider, holds everything unless it is
// explicitly switched off. Unset means nothing leaves.
//
//
// WHAT IS DELIBERATELY NOT HERE
//   - No screen calls this. Adding a "start call" button is a send control on a
//     screen no intended journey describes; that is the owner's call, and it is
//     written up on ops/workflows/fix-2026-08-18/BOARD.md rather than built.
//   - No bureau call. vendor/inquiry-remover/UPDATE-REQUIRED.md is an owner-set
//     hold: Experian now needs documents uploaded to its portal first, then a
//     wait, then the call, and the bureau prompts still describe a call-first
//     sequence. Wiring a bureau dial before those are rewritten would put a
//     robot on the phone telling a bureau an upload happened when it has not.
//     Only client-facing agents are accepted below.
//
// requireAuth then requireRole — never a roles key on requireAuth (CLAUDE.md §12).

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { isOptedOut } from "../src/lib/opt-out.mjs";
import { gate } from "../src/messaging/gate.mjs";
import { recordDispatch } from "../src/lib/outbound-calls.mjs";
import { voiceCallTask } from "../src/agents/voice-context.mjs";
import { placeCall, readiness, agentReadiness, normalizePhone } from "../src/messaging/providers/bland-voice.mjs";

/* Narrower than ROLE_SETS.STAFF. Placing a call is contacting a client, so the
   desks that own client contact are admitted and the back-office ones are not.
   `owner` and `admin` pass every gate through SUPER_ROLES in read-api.mjs. */
export const CALL_ROLES = new Set([
  "owner", "admin", "sales_manager", "closer", "setter", "inquiry_specialist"
]);

const ACTIONS = new Set(["check", "call"]);

/** One shape for every refusal, so a caller can never mistake one for a send. */
function refuse(res, status, reason, message, extra = {}) {
  return res.status(status).json({ ok: false, placed: false, reason, message, ...extra });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false, error: "method_not_allowed",
      message: "This route only accepts a request to start or check a call."
    });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, CALL_ROLES)) return;

  const orgId = (staff && staff.org_id) || null;
  if (!orgId) {
    return refuse(res, 400, "org_required",
      "Your sign-in is not attached to a company, so there is nobody to call on behalf of.");
  }

  const body = req.body || {};
  const action = String(body.action || "check").trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return refuse(res, 400, "unknown_action", "Unknown action. Use check or call.");
  }

  const code = String(body.agent_code || "").trim().toUpperCase();
  if (!code) {
    return refuse(res, 400, "code_required", "Which agent should make the call? Send its code, for example AG-04.");
  }

  try {
    const { rows: agentRows } = await db.query(
      `SELECT code, name, status, channel, agent_class, runtime, runtime_ref, prompt
         FROM agents WHERE org_id = $1::uuid AND code = $2 LIMIT 1`,
      [orgId, code]
    );
    const agent = agentRows[0] || null;
    if (!agent) {
      return refuse(res, 404, "not_found", "No agent with that code in your company.");
    }

    /* Ops agents run the business, not the phone. Kept separate from readiness()
       because it is a policy of this route, not a property of the runtime. */
    if (agent.agent_class !== "client_facing") {
      return refuse(res, 409, "not_client_facing",
        "This is an internal agent. It is not allowed to contact a client.");
    }

    /* AGENT SHAPE ONLY — not "is the phone system plugged in". That question is
       asked further down, after the person and their consent, because a missing
       API key must never be the answer given to "may we call this person". */
    const ready = agentReadiness(agent);
    if (!ready.ok) {
      return refuse(res, 409, ready.reason, ready.message, {
        agent: { code: agent.code, name: agent.name, status: agent.status, runtime: agent.runtime }
      });
    }

    /* ── the person ────────────────────────────────────────────────────── */
    const clientId = String(body.client_id || "").trim() || null;
    if (!clientId) {
      if (action === "check") {
        return res.status(200).json({
          ok: true, placed: false, ready: true, reason: "agent_ready",
          message: "This agent is ready to call. Choose who it should call.",
          agent: { code: agent.code, name: agent.name, status: agent.status, runtime: agent.runtime }
        });
      }
      return refuse(res, 400, "client_required", "Who should it call? Send the client's id.");
    }

    /* Org-scoped so one company's staff can never dial another's client. */
    const { rows: clientRows } = await db.query(
      `SELECT id, first_name, last_name, phone, dnd_voice
         FROM clients WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [clientId, orgId]
    );
    const client = clientRows[0] || null;
    if (!client) {
      return refuse(res, 404, "client_not_found", "No such person in your company.");
    }

    const phone = normalizePhone(client.phone);
    if (!phone) {
      return refuse(res, 409, "no_phone",
        "There is no usable phone number on this person's record, so nobody can be called.");
    }

    /* ── consent, both halves ──────────────────────────────────────────── */
    /* TWO SEPARATE FLAGS, AND BOTH HAVE TO BE CHECKED. isOptedOut reads the
       opt_outs table, which is what a STOP reply writes. clients.dnd_voice is a
       different switch, set on the client record, and src/lib/opt-out.mjs has
       never read it — so a person marked do-not-call by voice would pass an
       opt-out check on its own. */
    if (client.dnd_voice === true) {
      return refuse(res, 409, "dnd_voice",
        "This person is marked do not call. No call was placed.");
    }
    if (await isOptedOut(db, clientId, "voice")) {
      return refuse(res, 409, "opted_out",
        "This person has asked not to be contacted by phone. No call was placed.");
    }

    /* ── the words themselves ──────────────────────────────────────────── */
    /* The gate is run over the agent's prompt rather than an empty string. The
       prompt IS what the robot says, so the compliance rules should see it — an
       empty body would pass every content rule and tell us nothing. */
    const callTask = await voiceCallTask(db, { orgId, clientId, agent });
    const verdict = await gate(db, { orgId, clientId, channel: "voice", body: callTask });
    if (verdict.state !== "allowed") {
      return refuse(res, 409, "gate_" + verdict.state,
        (verdict.reasons && verdict.reasons[0] && verdict.reasons[0].message) ||
          "The compliance check stopped this call.",
        { reasons: verdict.reasons || [] });
    }

    const who = [client.first_name, client.last_name].filter(Boolean).join(" ") || "this person";

    /* LAST, DELIBERATELY. Everything above is about whether this call SHOULD
       happen; this is whether it CAN. Asking it earlier meant a person flagged
       do-not-call was refused with "the phone system is not connected", which is
       both wrong and the sort of answer that gets a setting changed and the call
       retried. */
    const configured = readiness(agent, process.env);
    if (!configured.ok) {
      return refuse(res, 503, configured.reason, configured.message);
    }

    if (action === "check") {
      return res.status(200).json({
        ok: true, placed: false, ready: true, reason: "ready",
        message: `${agent.name} is ready to call ${who}. Nothing has been dialled.`,
        agent: { code: agent.code, name: agent.name, status: agent.status, runtime: agent.runtime }
      });
    }

    /* ── the call ──────────────────────────────────────────────────────── */
    const result = await placeCall({
      agent: { ...agent, prompt: callTask }, phone, clientId,
      metadata: { org_id: orgId, placed_by: staff.id || null },
      env: process.env
    });

    if (result.status !== "sent" || !result.callId) {
      return refuse(res, result.blocked ? 503 : 502, result.reason || result.status,
        result.error || "The call could not be placed.", { retryable: !!result.retryable });
    }

    /* RECORD THE DISPATCH BEFORE ANSWERING. Bland's completed-call webhook
       carries a call id and no client, so src/adapters/bland.mjs:151 looks the
       client up in outbound_calls. Until now nothing in production had ever
       written that row, which is why the one call.completed event on live
       (2026-08-15) has no client attached to it. Skip this and the result of the
       call is anonymous and cannot be filed against anybody. */
    try {
      await recordDispatch({
        callId: result.callId, clientId, orgId, kind: "agent_editor", db
      });
    } catch (err) {
      /* The phone is already ringing — we cannot un-ring it, so this is not an
         error to the caller. It IS a real problem for the return leg, so it is
         reported rather than swallowed. */
      console.error(`[agent-call] dispatch record failed for ${result.callId}: ${err && err.message}`);
      return res.status(200).json({
        ok: true, placed: true, call_id: result.callId, attributed: false,
        message: `${agent.name} is calling ${who}. The result of this call could not be linked back to their file — tell an engineer.`
      });
    }

    return res.status(200).json({
      ok: true, placed: true, call_id: result.callId, attributed: true,
      agent: { code: agent.code, name: agent.name },
      message: `${agent.name} is calling ${who}.`
    });
  } catch (err) {
    if (err?.code === "client_context_unavailable") {
      return refuse(res, 503, err.code, err.message);
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
