// /api/chat/portal-message — client portal chat widget.
//
//   GET  — signed-in client reads THEIR OWN messages across channels
//   POST — client → staff note; lands on the existing sms/email conversation
//
// Threaded on the client's conversation — not a separate silo (spec §4.3).

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { upsertConversation, linkMessage } from "../../src/conversations/store.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  answerPortalMessage, portalAssistantContext
} from "../../src/chat/portal-assistant.mjs";
import { prequalFromCustomFields, formatPrequalUsd } from "../../src/http/portal-prequal.mjs";

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["client"], { db });
  if (!principal) return;

  const clientId = principal.clientId || principal.account?.client_id || principal.id;
  const orgId = principal.orgId || principal.org_id;
  if (!clientId || !orgId) {
    return res.status(403).json({ ok: false, error: "no_client_scope" });
  }

  try {
    if (req.method === "GET") {
      /* Keep the legacy conversation id for the widget. History spans all of
         this client's channels, even when an older SMS thread is selected. */
      const convo = await db.query(
        `SELECT id FROM conversations
          WHERE org_id = $1 AND client_id = $2
          ORDER BY CASE WHEN channel = 'sms' THEN 0 ELSE 1 END,
                   COALESCE(last_pulse_at, created_at) DESC
          LIMIT 1`,
        [orgId, clientId]
      );
      const conversationId = convo.rows[0]?.id || null;
      /* The generic staff helper returns the OLDEST 100 first. That leaves
         a long-running buyer unable to see new replies after 100 messages.
         Only show this authenticated client's SMS and email rows. Staff alerts
         also carry a client_id for context, so exclude their known receipt
         keys before limiting; they were addressed to employees, not clients.
         Show the latest N chronologically across both channels.
         Stable id tiebreakers keep concurrent equal-timestamp notes ordered. */
      const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
      const recent = await db.query(
        `SELECT * FROM (
           SELECT m.id, m.direction, m.channel, m.rendered_body, m.status,
                  m.sender_staff_id, m.sender_kind, m.created_at,
                  s.name AS sender_name
             FROM messages m
             LEFT JOIN staff s ON s.id = m.sender_staff_id AND s.org_id = m.org_id
            WHERE m.org_id = $1 AND m.client_id = $2
              AND m.channel IN ('sms', 'email')
              AND COALESCE(m.provider_ref, '') NOT LIKE 'staff-alert:%'
              AND COALESCE(m.provider_ref, '') NOT LIKE 'setter:%:closer:%'
              AND COALESCE(m.template_key, '') NOT IN
                  ('SMS-S04C-STAFF-BOOKED', 'SMS-DEAL-CLOSE-WIN')
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT $3
         ) recent ORDER BY recent.created_at ASC, recent.id ASC`,
        [orgId, clientId, limit]
      );
      const messages = recent.rows;
      return res.status(200).json({
        ok: true,
        conversation_id: conversationId,
        messages
      });
    }

    if (req.method !== "POST") {
      res.setHeader("allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const body = req.body || {};
    const text = String(body.body || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "body_required" });
    if (text.length > 8000) return res.status(400).json({ ok: false, error: "body_too_long" });

    const channel = String(body.channel || "sms").toLowerCase();
    if (channel !== "sms" && channel !== "email") {
      return res.status(400).json({ ok: false, error: "channel_must_be_sms_or_email" });
    }

    /* Same draft retried after a lost ACK must not become a second client note.
       Optional for older portal versions; a new UI supplies a per-attempt UUID.
       Prefix the authenticated client ID so another client choosing the same
       key can never claim, overwrite or dedupe this client's message. */
    const suppliedKey = body.idempotency_key;
    if (suppliedKey != null &&
        (typeof suppliedKey !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(suppliedKey))) {
      return res.status(400).json({ ok: false, error: "invalid_idempotency_key" });
    }
    const providerRef = suppliedKey ? `portal:${clientId}:${suppliedKey}` : null;

    const convo = await upsertConversation(db, {
      orgId,
      clientId,
      channel,
      lastPulseAt: new Date().toISOString()
    });

    const ins = await db.query(
      `INSERT INTO messages (
         org_id, client_id, conversation_id, direction, channel,
         rendered_body, status, compliance_check_passed, sender_kind, provider_ref
       ) VALUES ($1, $2, $3, 'inbound', $4, $5, 'received', true, 'client', $6)
       ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
       RETURNING *`,
      [orgId, clientId, convo.id, channel, text, providerRef]
    );
    const message = ins.rows[0];
    if (!message && providerRef) {
      /* The existing messages unique index arbitrates concurrent duplicates.
         Read back the original only inside this authenticated org AND client. */
      const existing = await db.query(
        `SELECT id, org_id, client_id, conversation_id, direction, channel,
                rendered_body, sender_kind, status
           FROM messages
          WHERE org_id = $1 AND client_id = $2 AND provider_ref = $3
          LIMIT 1`,
        [orgId, clientId, providerRef]
      );
      const prior = existing.rows[0];
      if (!prior) {
        return res.status(409).json({ ok: false, error: "retry_state_unknown" });
      }
      if (prior.direction !== "inbound" || prior.sender_kind !== "client" ||
          prior.channel !== channel || prior.rendered_body !== text) {
        return res.status(409).json({ ok: false, error: "idempotency_key_reused" });
      }
      return res.status(200).json({
        ok: true, conversation_id: prior.conversation_id,
        message: prior, reply: null, deduped: true
      });
    }
    try {
      await linkMessage(db, { messageId: message.id, conversationId: convo.id });
    } catch { /* non-fatal */ }

    /* The assistant reply. Best-effort by design: the client's message is
       already committed above, so a model outage must not turn a saved message
       into a 500. Worst case they get the fallback line and staff still see the
       thread. */
    let reply = null;
    try {
      reply = await replyFor(db, { orgId, clientId, question: text, conversationId: convo.id, channel });
    } catch {
      reply = null;
    }

    return res.status(200).json({
      ok: true,
      conversation_id: convo.id,
      message,
      reply
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}

/* Build the assistant's reply and, when the model actually answered, keep it on
   the thread so staff read the same conversation the client saw.
   status='delivered', NOT 'queued' — src/messaging/dispatch.mjs claims outbound
   rows with status='queued', so a queued row here would be texted or emailed to
   the client on top of the portal reply they already read. */
async function replyFor(database, { orgId, clientId, question, conversationId, channel }) {
  const found = await database.query(
    `SELECT first_name, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = found.rows[0] || {};
  const cf = client.custom_fields || {};
  const context = portalAssistantContext({
    client,
    prequalDisplay: formatPrequalUsd(prequalFromCustomFields(cf))
  });

  const answer = await answerPortalMessage({ question, context });

  /* Persist assistant or canned fallback — the portal reloads from this thread. */
  try {
    const saved = await database.query(
      `INSERT INTO messages (
         org_id, client_id, conversation_id, direction, channel,
         rendered_body, status, provider, compliance_check_passed, sender_kind
       ) VALUES ($1, $2, $3, 'outbound', $4, $5, 'delivered', 'internal', true, 'agent')
       RETURNING id`,
      [orgId, clientId, conversationId, channel, answer.text]
    );
    await linkMessage(database, {
      messageId: saved.rows[0].id,
      conversationId
    });
  } catch { /* the reply still goes to the POST body; the thread copy is a bonus */ }

  return { text: answer.text, source: answer.ok ? "assistant" : "fallback" };
}
