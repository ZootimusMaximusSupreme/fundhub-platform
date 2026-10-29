// compose — the staff reply path. A person types words, they go to a client.
//
// THIS IS THE FIRST SEND IN THIS CODEBASE WITH A HUMAN AUTHOR. Every other
// outbound row in `messages` is queued by a workflow reacting to an event, which
// is why src/workflows/messaging.mjs's `staffId` seam has never once been
// supplied. Everything below exists to make a human-authored send obey the same
// rules a workflow's send obeys, and to record the one extra fact a workflow
// send does not have: who wrote it.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IS REUSED, AND WHY NOTHING HERE RE-IMPLEMENTS IT.
//
//   the gate         src/messaging/gate.mjs, reached through dispatchMessage.
//                    NOT called directly from here. See the next section.
//   the dispatcher   src/messaging/dispatch.mjs — routing, provider resolution,
//                    quiet-hours deferral, retries, the atomic claim.
//   the thread       src/conversations/store.mjs — the same upsert the inbound
//                    handler uses, so a staff reply and a client's text land on
//                    ONE conversation row rather than two.
//   telemetry        src/shifts/telemetry.mjs — the `text_sent` seam.
//
// The only new SQL here is the INSERT, and it is deliberately the same shape as
// sendTemplated's insert with three differences: no template_key (there is no
// template), compliance_check_passed = false (nothing has checked it yet — the
// gate runs at dispatch, and claiming a pass before the check is exactly the lie
// that column is for), and sender_staff_id set.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE GATE IS NOT CALLED FROM HERE.
//
// It would be one line and it would be wrong. gate.mjs's own header says opt-out
// state must be read at the instant of sending and never earlier; dispatch.mjs
// is what sends. A gate call here would be a SECOND verdict, taken at a
// different instant from the one that governs the send, and the two would
// disagree the moment a message waits — which is precisely the sleeping-workflow
// bug the gate is built around. One gate, at dispatch, always.
//
// So this function queues a row and then asks the dispatcher to work it now.
// Every rule the dispatcher enforces applies unchanged and unconditionally:
//   * opted out          → blocked, recorded on the row, nothing sent
//   * quiet hours (SMS)  → deferred to 08:00 Arizona, still queued
//   * restricted wording → blocked, and a task is raised for an operator
//   * no routing row     → held, nothing sent
//
// TEMPLATE APPROVAL DOES NOT APPLY, AND THAT IS NOT A BYPASS. Approval
// (116_template_approval.sql) is a check on stored, reusable copy — it asks
// "has a human reviewed this text before we send it ten thousand times". Here a
// human IS the author, reviewing as they type, and there is no template row to
// have a compliance_passed flag on. Note what this does NOT do: it does not skip
// the gate, pass an option to it, or take a different path through it. The
// restricted-wording rules in compliance_rules apply to a staff reply exactly as
// they apply to a template — a phrase an employee may not put in a text is not
// made sayable by typing it by hand.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY IS OPT-IN, AND ABSENT IS HONEST.
//
// `messages` dedupes on (org_id, provider_ref) — migration 004. A workflow
// synthesises provider_ref from the event id, so a replayed event cannot
// double-send. A person clicking Send twice has no event id.
//
// So the caller may pass `idempotencyKey`, and provider_ref becomes
// `staff:<key>`; a second send with the same key returns the FIRST message
// rather than queueing a second. With no key, provider_ref is NULL — the unique
// index is partial (WHERE provider_ref IS NOT NULL) so NULLs never collide, and
// two identical replies typed a minute apart are two real messages, which they
// are. Nothing invents a key from the body text: two "ok, thanks" replies in one
// afternoon are not a double-send, and silently swallowing the second would lose
// a message a client is waiting on.

import { upsertConversation, linkMessage } from "../conversations/store.mjs";
import { dispatchMessage, OUTCOME } from "./dispatch.mjs";
import { destinationAddress } from "../auth/authorized-rep.mjs";
import { logStaffEvent } from "../shifts/telemetry.mjs";

/** Channels a staff member may compose on.
 *
 *  DELIBERATELY NARROWER THAN THE GATE'S. gate.mjs knows sms, email and voice,
 *  because it must be able to reason about a voice message a workflow queued.
 *  A person cannot type a phone call: `voice` rows are written by the Bland
 *  handler after a call happened, and accepting one here would let the inbox
 *  queue a "voice message" that no provider carries and nothing will ever
 *  deliver. An unsupported channel is a 400, not a queued row nobody sends. */
export const COMPOSE_CHANNELS = new Set(["sms", "email"]);

/** The longest reply that may be queued.
 *
 *  Not a carrier limit — an SMS over 160 characters is segmented and delivered,
 *  and truncating at 160 would silently cut a sentence in half. This is a bound
 *  on what one request may write to the database, so a runaway paste cannot put
 *  a megabyte of text in a `messages` row. Rejected, never truncated: sending
 *  half of what somebody wrote is worse than telling them it was too long. */
export const MAX_BODY_LENGTH = 4000;

/* Which client column addresses a channel. The same map as
   src/workflows/messaging.mjs's ADDRESS_BY_CHANNEL and for the same reason: the
   destination is recorded in the terms of the CHANNEL, and a provider that
   addresses by something else (the CRM relay wants a contact id) resolves it
   live at dispatch. */
const ADDRESS_BY_CHANNEL = { email: "email", sms: "phone" };

/* A thrown error with a code the HTTP layer turns into a 400 rather than a 500.
   The caller's request was wrong; that is not a server fault. */
function badRequest(message) {
  return Object.assign(new Error(message), { code: "BAD_REQUEST" });
}

/** Attachments are asset keys from src/messaging/assets.mjs — never raw bytes. */
function normalizeAttachments(list) {
  if (list == null) return null;
  if (!Array.isArray(list)) {
    throw badRequest("attachments must be an array of { asset }");
  }
  if (list.length === 0) return null;
  return list.map((item) => {
    const asset = item && (item.asset || item.key);
    if (!asset || typeof asset !== "string") {
      throw badRequest("each attachment needs an asset key");
    }
    return {
      asset: String(asset),
      filename: item.filename ? String(item.filename) : undefined
    };
  });
}

/* resolveTarget — what conversation is this reply on, and who is it to.

   TWO WAYS IN, AND THE ORG CHECK IS ON BOTH.

     { conversationId }        replying in the inbox. The thread already exists;
                               its client and channel are read from it, never
                               taken from the request. A caller cannot post a
                               reply onto one client's thread and address it to
                               another, because the address is not theirs to
                               name.
     { clientId, channel }     starting a thread. find-or-create, through the
                               SAME upsert the inbound handler uses.

   The conversation lookup is filtered by org, so a conversation id belonging to
   another org resolves to nothing and the request fails as though it did not
   exist — which, for this caller, it does not. */
async function resolveTarget(db, { orgId, conversationId, clientId, channel }) {
  if (conversationId) {
    const r = await db.query(
      `SELECT cv.id, cv.client_id, cv.channel
         FROM conversations cv
         JOIN clients c ON c.id = cv.client_id AND c.org_id = cv.org_id
        WHERE cv.id = $1 AND cv.org_id = $2 LIMIT 1`,
      [conversationId, orgId]
    );
    const convo = r.rows[0];
    if (!convo) throw badRequest("no such conversation");
    if (!COMPOSE_CHANNELS.has(convo.channel)) {
      // A voice thread exists (the Bland handler writes one). It cannot be
      // replied to by typing, and saying so is better than queueing a row that
      // no provider carries.
      throw badRequest(`replies cannot be sent on a ${convo.channel} thread`);
    }
    return { conversationId: convo.id, clientId: convo.client_id, channel: convo.channel };
  }

  if (!clientId) throw badRequest("conversation_id, or client_id and channel, is required");
  if (!COMPOSE_CHANNELS.has(channel)) {
    throw badRequest(`channel must be one of ${[...COMPOSE_CHANNELS].join(", ")}`);
  }

  // The client must be ours. conversations.client_id has a foreign key but no
  // org constraint tying it to conversations.org_id, so without this check a
  // caller could mint a thread in their own org pointing at another org's
  // client — and then read that client's name back off it.
  const c = await db.query(
    `SELECT id FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [clientId, orgId]
  );
  if (!c.rows[0]) throw badRequest("no such client");

  const convo = await upsertConversation(db, { orgId, clientId, channel });
  return { conversationId: convo.id, clientId, channel };
}

/* WHAT A TYPED DESTINATION IS ALLOWED TO LOOK LIKE.

   Deliberately the same shapes the providers themselves enforce, so a value
   accepted here cannot be rejected at the wire. Email is the ordinary
   something@something.something; SMS is E.164, which is what Twilio requires
   and what 30 of the 32 live client records already hold.

   Voice has no entry and so cannot be addressed by hand. There is no staff
   voice compose, and adding one would be a step no journey names. */
const ADDRESS_SHAPE = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  sms: /^\+[1-9]\d{7,14}$/
};

const ADDRESS_HELP = {
  email: "an email address, like name@example.com",
  sms: "a phone number in full international form, like +15551234567"
};

/* validDestination — pure. Returns the trimmed value, or throws badRequest
   naming what was wanted, so the person typing gets told what to fix rather
   than "invalid input". */
export function validDestination(channel, value) {
  const wanted = ADDRESS_SHAPE[channel];
  const v = typeof value === "string" ? value.trim() : "";
  if (!wanted) throw badRequest(`a ${channel} message cannot be addressed by hand`);
  if (!wanted.test(v)) throw badRequest(`that is not ${ADDRESS_HELP[channel]}`);
  return v;
}

/* addressFor — where this goes, as of now.

   Recorded on the row (111_messages_address) rather than resolved at send time,
   so a reply that waits in the queue still goes where it was written to go.

   A TYPED DESTINATION IS RECORDED ON THE MESSAGE AND NOWHERE ELSE. Nothing in
   this file writes to `clients`, and that is a guarantee rather than an
   accident. Staff needed a way to send ONE message to a different address
   without editing the person's record, because those are not the same act:
   correcting somebody's email changes their file, and sending one message
   elsewhere does not. Doing the second by way of the first is how a one-off
   test send ends up permanently redirecting a real client's mail.

   A MISSING ADDRESS IS NOT REFUSED HERE. It is tempting: no phone number means
   no text. But the dispatcher already has that branch (OUTCOME.NO_ADDRESS) and
   it is the branch that records WHY on the message row, where an operator can
   see it. Refusing here would make the same message vanish with an error toast
   and no record that anybody tried to send it. */
async function addressFor(db, clientId, channel) {
  const column = ADDRESS_BY_CHANNEL[channel];
  if (!column) return null;
  const r = await db.query(
    `SELECT ${column} AS address FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  const fallback = r.rows[0]?.address || null;
  return destinationAddress(db, clientId, channel, fallback);
}

/**
 * composeAndSend(db, input, options) → { message, outcome, detail, deduped }
 *
 * input: {
 *   orgId,            required — the SESSION's org, never a request field
 *   staffId,          required — who is writing. The whole point of this file.
 *   conversationId,   one of these two forms is required (see resolveTarget)
 *   clientId, channel,
 *   body,             required — what they typed
 *   subject,          email only; NULL on SMS
 *   shiftId,          the open shift, for telemetry. Optional.
 *   idempotencyKey    optional; see the header
 * }
 *
 * options: { now, fetchImpl, timeoutMs, signal, env } — forwarded verbatim to
 * the dispatcher, which forwards `now` to the gate. Nothing here reads a clock.
 *
 * `outcome` is the dispatcher's own vocabulary (OUTCOME in dispatch.mjs), so a
 * caller rendering this to a person is reading the same word the message row
 * records. It is NOT collapsed to a boolean: "held until 11am" and "this person
 * asked us to stop" are different things to tell an employee, and a `sent: false`
 * would make them the same thing.
 */
export async function composeAndSend(db, input = {}, options = {}) {
  const {
    orgId, staffId, conversationId = null, clientId = null, channel = null,
    body, subject = null, shiftId = null, idempotencyKey = null,
    attachments = null,
    // Where THIS ONE message goes, if the sender typed somewhere. Absent, the
    // client record answers, exactly as it always has.
    toAddress: typedAddress = null
  } = input;

  if (!orgId) throw badRequest("orgId is required");
  if (!staffId) throw badRequest("staffId is required");

  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw badRequest("body is required");
  if (text.length > MAX_BODY_LENGTH) {
    throw badRequest(`body is longer than ${MAX_BODY_LENGTH} characters`);
  }

  /* Refused before a single query, when the channel is already known. The
     channel is only unknown on the conversationId form, where it has to be read
     from the thread — that case is validated below instead. Checking here as
     well costs one regex and means a typo never reaches the database. */
  if (channel && typedAddress != null && String(typedAddress).trim() !== "") {
    validDestination(channel, typedAddress);
  }

  const target = await resolveTarget(db, { orgId, conversationId, clientId, channel });

  // Email only. renderTemplate is not involved — there is no template and no
  // merge tags to expand, so what the staff member typed is exactly what is
  // stored and exactly what is sent.
  const subjectLine = target.channel === "email" && typeof subject === "string" && subject.trim()
    ? subject.trim()
    : null;

  const att = normalizeAttachments(attachments);

  const providerRef = idempotencyKey ? `staff:${idempotencyKey}` : null;

  /* A typed destination wins for this message only; with none, the client
     record answers as it always has. The fallback stays because most sends do
     not type anything, and losing it would break every reply that relies on
     the address already on file. */
  const toAddress = typedAddress != null && String(typedAddress).trim() !== ""
    ? validDestination(target.channel, typedAddress)
    : await addressFor(db, target.clientId, target.channel);

  /* status='queued' and compliance_check_passed=false.

     The gate has not run. It runs inside dispatchMessage below, against this
     row, and records its verdict on this row. Setting the flag true here — as
     sendTemplated does, because a template carries its own reviewed
     compliance_passed — would assert a check that has not happened. */
  const ins = await db.query(
    `INSERT INTO messages (
       org_id, client_id, conversation_id, direction, channel, rendered_body,
       provider_ref, status, compliance_check_passed, to_address, subject,
       sender_staff_id, sender_kind, attachments
     )
     VALUES ($1,$2,$3,'outbound',$4,$5,$6,'queued',false,$7,$8,$9,'staff',$10)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    [orgId, target.clientId, target.conversationId, target.channel, text,
     providerRef, toAddress, subjectLine, staffId, JSON.stringify(att || [])]
  );

  /* A deduped send is not a failure and not a second message. The caller sent
     the same idempotency key twice — a double-click, a retried request — and
     gets the message that already exists, unchanged and un-redispatched.
     Re-dispatching it would be the double-send the key exists to prevent. */
  if (!ins.rows[0]) {
    const existing = await db.query(
      `SELECT id, conversation_id, client_id, channel, rendered_body, status,
              created_at, sender_staff_id, sender_kind, direction
         FROM messages WHERE org_id = $1 AND provider_ref = $2 LIMIT 1`,
      [orgId, providerRef]
    );
    const prior = existing.rows[0];
    /* A key identifies ONE authored message to ONE client. A reused key must
       never return another client's note, claim that an unsent note was
       saved, or reveal a message from another staff member's thread. Keep
       the original provider_ref format so retries from older live widgets
       still dedupe safely after this deploy. */
    if (!prior || String(prior.client_id) !== String(target.clientId) ||
        String(prior.conversation_id) !== String(target.conversationId) ||
        String(prior.sender_staff_id) !== String(staffId) ||
        prior.direction !== "outbound" || prior.sender_kind !== "staff" ||
        prior.channel !== target.channel || prior.rendered_body !== text) {
      throw Object.assign(new Error("idempotency_key_reused"), {
        code: "IDEMPOTENCY_CONFLICT"
      });
    }
    return {
      message: prior,
      conversationId: target.conversationId,
      outcome: null,
      detail: null,
      deduped: true
    };
  }

  const messageId = ins.rows[0].id;

  /* THE THREAD LINK IS SET IN THE INSERT, AND CONFIRMED HERE.

     linkMessage() joins conversations and requires org AND client to match, so
     it is the check that the id written above really is this client's thread in
     this org. It is a no-op on the normal path (the column already holds that
     value) and it is what catches a mis-pointed id. Swallowed the same way
     src/handlers/comms.mjs swallows it: the message row is committed, and a
     thread-index failure must not lose a message somebody is about to send. */
  try {
    await linkMessage(db, { messageId, conversationId: target.conversationId });
    // The thread's clock moves to this message's own recorded time, not to a
    // new Date() invented here — the same rule threadMessage() follows.
    await upsertConversation(db, {
      orgId,
      clientId: target.clientId,
      channel: target.channel,
      lastPulseAt: ins.rows[0].created_at || null
    });
  } catch (err) {
    console.error(`[compose] threading failed for message ${messageId}: ${err && err.message}`);
  }

  // ---- send ---------------------------------------------------------------
  // Every rule lives on the other side of this call. See the header.
  const result = await dispatchMessage(db, messageId, options);

  /* THE TELEMETRY SEAM src/workflows/messaging.mjs DESCRIBED, NOW SUPPLIED.
     Its header: "the `staffId` argument below is the place a staff-initiated
     send would pass one; there is no such send today". This is that send.

     SMS ONLY, and that is not an oversight. `text_sent` is one of the five kinds
     in src/shifts/telemetry.mjs's frozen vocabulary; there is no kind for an
     email, and filing an email under `text_sent` would make the count a lie.
     The correct move when a vocabulary has no word is to report the gap, not to
     borrow the nearest word — so an emailed reply writes no staff_events row and
     that is recorded in docs/REPLY-INBOX-SPEC.md.

     ONLY ON A REAL SEND. A blocked, deferred or held message is not a text this
     person sent, and counting one would inflate their numbers with messages the
     client never received. logStaffEvent never throws.

     The body is NOT copied into `detail` — client-facing copy about a consumer's
     file does not belong in a work index. Same rule as sendTemplated. */
  if (target.channel === "sms" && result.outcome === OUTCOME.SENT) {
    await logStaffEvent(db, {
      orgId,
      staffId,
      shiftId: shiftId || null,
      kind: "text_sent",
      detail: {
        client_id: target.clientId,
        conversation_id: target.conversationId,
        channel: target.channel,
        message_id: messageId
      }
    });
  }

  /* Read the row back rather than reporting what was inserted. dispatchMessage
     has just written status, blocked_reason, last_error and possibly
     scheduled_at onto it, and the caller needs what the row SAYS, not what was
     hoped for it. */
  const final = await db.query(
    `SELECT id, conversation_id, client_id, channel, direction, rendered_body,
            subject, status, provider, blocked_reason, last_error, scheduled_at,
            sender_staff_id, created_at
       FROM messages WHERE id = $1`,
    [messageId]
  );

  return {
    message: final.rows[0] || null,
    conversationId: target.conversationId,
    outcome: result.outcome,
    detail: result.detail,
    deduped: false
  };
}

export default composeAndSend;
