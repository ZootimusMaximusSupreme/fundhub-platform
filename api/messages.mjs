// POST /api/messages — a staff member writes to a client.
//
//   POST { conversation_id, body }                     reply in an open thread
//   POST { client_id, channel, body, subject? }        start one
//   POST { ..., idempotency_key }                      safe to retry
//
//   → 200 { ok, message, conversation_id, outcome, detail, deduped }
//
// The work is in src/messaging/compose.mjs. This file is the door: it decides
// who may knock, reads the body, and turns the service's answer into a status
// code. Everything about how a message is queued, gated, threaded and sent is
// over there, where it can be tested without an HTTP layer.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// STAFF ONLY, AND ON THE CLOCK.
//
// requirePrincipal(["staff"]) — named explicitly, not inherited. A client or
// affiliate session that could POST here would be able to send messages to
// other people's clients as the company. There is no reading of this endpoint
// under which a non-staff principal belongs.
//
// requireActiveShift — because the owner named this endpoint before it existed.
// The rule, verbatim: "Gate writes that affect attribution or pay: claiming a
// lead, logging a call outcome, moving a pipeline stage, SENDING CLIENT
// MESSAGES. Do not gate read-only screens."
//
// src/http/middleware/ACTIVE-SHIFT-ROLLOUT.md records that two of the owner's
// four categories had no endpoint in this repository at all, and names client
// messaging as one of them: "pipeline-stage moves and client messaging both
// happen inside Inngest workflows and webhook handlers, which have no staff
// principal." This is that endpoint arriving. It has a staff principal, it
// writes sender_staff_id, and it files a `text_sent` row against the shift —
// so it is the case the rule was written for, and it is gated on the rule that
// already exists rather than on a new judgement.
//
// The gate is FIRST in the POST branch, before the body is read: whether you
// may write at all is not a question about the payload. It writes its own
// refusal — including the 503 for "I could not check", which must never
// collapse into "you are not clocked in" — so `if (!shift) return;` is the
// whole contract.
//
// THE READS ARE NOT GATED. This file has no GET. The thread and the inbox are
// api/read/messages.mjs and api/read/inbox.mjs, and the same rule ends "do not
// gate read-only screens" — an employee coming back from lunch can see what
// came in before they clock in, and cannot answer it until they do.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THE OUTCOME MEANS TO THE CALLER, AND WHY IT IS NOT A BOOLEAN.
//
// 200 does not mean "delivered". It means the message was accepted, recorded,
// and put through the dispatcher — and `outcome` says what the dispatcher did
// with it. A held message is not an error: the request was valid, the row
// exists, and an operator can see it. Returning 4xx for "held until 11am" would
// tell the screen the send failed, and the staff member would type it again.
//
//   sent        gone to the provider
//   deferred    SMS inside quiet hours; queued for 08:00 Arizona
//   blocked     the gate refused it — opted out, or restricted wording
//   no_route    no provider is routed for this channel in this company
//   no_address  the client record has no phone/email to send to
//   retry       the provider failed in a way worth retrying; still queued
//
// The screen prints these in plain words. See public/app/messaging.html.

import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { requireActiveShift } from "../src/http/middleware/requireActiveShift.mjs";
import { SUPER_ROLES } from "../src/http/middleware/requireRole.mjs";
import { composeAndSend } from "../src/messaging/compose.mjs";
import { safeError } from "../src/http/health.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    /* Allow is set because a 405 without one is an incomplete answer (RFC 9110
       requires it), and because scripts/journeys/extract.mjs reads it: the
       generated journey pages list the methods a route answers, and its scrape
       recognises `req.method === "X"` and this header. Written as `!==` here —
       the reject-then-proceed shape the rest of this file needs — the header is
       what keeps `/api/messages` from appearing in every journey page with no
       methods at all. Accurate documentation, not a workaround for the tool. */
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;

  /* OWNERS DO NOT CLOCK IN — owner decision, 2026-08-02, verbatim: "Owners
     definitely don't clock in." So an owner is exempt and everybody else is
     not. The exemption returns a shift-shaped object whose id is null, so the
     telemetry below records an owner's message as sent by that owner on no
     shift — which is what actually happened. See EXEMPT_SHIFT. */
  const shift = await requireActiveShift(req, res, { db, principal, exempt: SUPER_ROLES });
  if (!shift) return;

  const body = req.body || {};

  try {
    const result = await composeAndSend(db, {
      /* THE ORG IS THE SESSION'S. It is not read from the body and there is no
         body field that could supply it — an org a caller can name is an org a
         caller can lie about, which is audit C1 on the write side. */
      orgId: principal.orgId,
      staffId: principal.staffId,
      conversationId: body.conversation_id || null,
      clientId: body.client_id || null,
      channel: body.channel || null,
      body: body.body,
      subject: body.subject || null,
      /* The shift the gate above already resolved, threaded down so the
         `staff_events` row this send writes says which clock the work was on.
         Free here — the gate returned the row.

         NULL FOR AN OWNER, and that is correct rather than missing: owners do
         not clock in, so there is no shift this work belongs to.
         `staff_events.shift_id` is nullable for exactly that case. */
      shiftId: shift.id,
      idempotencyKey: body.idempotency_key || null,
      /* WHERE THIS ONE MESSAGE GOES, if the sender typed somewhere. Optional:
         absent, the client record answers as it always has.

         It is recorded on the message row and never written back to the client.
         That is the whole point of having it — staff needed to send one message
         to a different address without editing somebody's file, and doing that
         by editing the file is how a one-off send permanently redirects a real
         client's mail. Validated in compose.mjs against the same shape the
         provider enforces. */
      toAddress: body.to || null
    });

    return res.status(200).json({
      ok: true,
      message: result.message,
      conversation_id: result.conversationId,
      outcome: result.outcome,
      detail: result.detail,
      deduped: result.deduped
    });
  } catch (err) {
    /* The caller's error, not ours. composeAndSend throws BAD_REQUEST for a
       missing body, an unknown conversation, a channel nobody can type on, and
       a client that is not this company's. Reporting those as 500 would tell
       the screen the backend fell over when the request was simply wrong —
       the same classification readHandler makes for reads. */
    if (err && err.code === "BAD_REQUEST") {
      return res.status(400).json({ ok: false, error: "bad_request", message: String(err.message).slice(0, 200) });
    }
    if (err && err.code === "IDEMPOTENCY_CONFLICT") {
      return res.status(409).json({ ok: false, error: "idempotency_key_reused" });
    }
    // safeError scrubs the DSN, which err.message quotes on a connection
    // failure — the same treatment health.mjs and the Netlify adapter give it.
    return res.status(500).json({ ok: false, error: "send_failed", message: "Something went wrong sending that message. Try again in a moment.", detail: safeError(err) });
  }
}
