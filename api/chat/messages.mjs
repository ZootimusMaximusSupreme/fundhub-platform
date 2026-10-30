// /api/chat/messages — chat-widget messaging surface.
//
//   GET  ?kind=internal|client          list threads
//   GET  ?conversation_id=              thread messages
//   POST { kind:"internal", peer_staff_id, body }
//   POST { kind:"internal", conversation_id, body }
//   POST { kind:"client", client_id|conversation_id, channel?, body }
//        → reuses composeAndSend (compliance gate). No second send path.
//
// Client→staff from the portal uses api/chat/portal-message.mjs.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { requireActiveShift } from "../../src/http/middleware/requireActiveShift.mjs";
import { SUPER_ROLES } from "../../src/http/middleware/requireRole.mjs";
import { composeAndSend } from "../../src/messaging/compose.mjs";
import {
  getOrCreateInternalThread,
  pairKey,
  sendInternalMessage,
  listInternalThreads,
  listThreadMessages
} from "../../src/chat/internal.mjs";
import { safeError } from "../../src/http/health.mjs";

async function listClientThreads(database, { orgId, limit }) {
  const res = await database.query(
    `SELECT c.id, c.kind, c.channel, c.client_id, c.last_pulse_at, c.created_at,
            cl.name AS client_name, cl.email AS client_email,
            (SELECT m.rendered_body FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_body
       FROM conversations c
       JOIN clients cl ON cl.id = c.client_id
      WHERE c.org_id = $1 AND c.kind = 'client'
      ORDER BY COALESCE(c.last_pulse_at, c.created_at) DESC
      LIMIT $2`,
    [orgId, limit]
  );
  return res.rows;
}

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;
  const orgId = principal.orgId;
  const staffId = principal.staffId;
  if (!orgId || !staffId) return res.status(403).json({ ok: false, error: "no_org_scope" });

  try {
    if (req.method === "GET") {
      const conversationId = req.query?.conversation_id;
      if (conversationId) {
        // Participant check for internal; client threads: any staff in org (C-2).
        const convo = await db.query(
          `SELECT id, kind, org_id FROM conversations WHERE id = $1 AND org_id = $2`,
          [conversationId, orgId]
        );
        if (!convo.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
        if (convo.rows[0].kind === "internal") {
          const part = await db.query(
            `SELECT 1 FROM conversation_participants
              WHERE conversation_id = $1 AND staff_id = $2`,
            [conversationId, staffId]
          );
          if (!part.rows[0]) return res.status(403).json({ ok: false, error: "forbidden" });
        }
        const messages = await listThreadMessages(db, {
          orgId,
          conversationId,
          limit: Number(req.query?.limit) || 100
        });
        return res.status(200).json({ ok: true, conversation: convo.rows[0], messages });
      }

      const kind = String(req.query?.kind || "internal").toLowerCase();
      const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 30));
      if (kind === "internal") {
        const threads = await listInternalThreads(db, {
          orgId,
          staffId,
          limit
        });
        return res.status(200).json({ ok: true, kind: "internal", threads });
      }
      if (kind === "client") {
        const threads = await listClientThreads(db, { orgId, limit });
        return res.status(200).json({ ok: true, kind: "client", threads });
      }
      return res.status(400).json({ ok: false, error: "unknown_kind" });
    }

    if (req.method !== "POST") {
      res.setHeader("allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const body = req.body || {};
    const kind = String(body.kind || "").toLowerCase();

    if (kind === "internal") {
      // No compliance gate, no shift gate — internal ping (spec §4.3).
      let conversationId = body.conversation_id || null;
      /* THE RIGHT THREAD OR NO SEND. When the widget names both the teammate and
         a thread, the thread must be the one between the sender and that
         teammate. A thread id left over from the last teammate (a slow thread
         lookup that landed after the pick changed) used to win and the note
         went to the wrong person. */
      if (conversationId && body.peer_staff_id) {
        const convo = await db.query(
          `SELECT kind, internal_pair_key FROM conversations WHERE id = $1 AND org_id = $2`,
          [conversationId, orgId]
        );
        const row = convo.rows[0];
        if (!row || row.kind !== "internal" || row.internal_pair_key !== pairKey(staffId, body.peer_staff_id)) {
          return res.status(409).json({ ok: false, error: "conversation_peer_mismatch" });
        }
      }
      if (!conversationId) {
        if (!body.peer_staff_id) {
          return res.status(400).json({ ok: false, error: "peer_staff_id_required" });
        }
        const convo = await getOrCreateInternalThread(db, {
          orgId,
          staffId,
          peerStaffId: body.peer_staff_id
        });
        conversationId = convo.id;
      }
      const result = await sendInternalMessage(db, {
        orgId,
        staffId,
        conversationId,
        body: body.body,
        idempotencyKey: body.idempotency_key || null
      });
      return res.status(200).json({
        ok: true,
        kind: "internal",
        conversation_id: conversationId,
        message: result.message,
        deduped: result.deduped
      });
    }

    if (kind === "client") {
      /* THE RIGHT CLIENT OR NO SEND. composeAndSend takes a thread id over a
         client id, so a thread left over from the last client plus a newly
         picked client used to text the OLD client. When both are named they
         must agree: a client thread that belongs to that client. */
      if (body.conversation_id && body.client_id) {
        const convo = await db.query(
          `SELECT kind, client_id FROM conversations WHERE id = $1 AND org_id = $2`,
          [body.conversation_id, orgId]
        );
        const row = convo.rows[0];
        if (!row || row.kind !== "client" || String(row.client_id) !== String(body.client_id)) {
          return res.status(409).json({ ok: false, error: "conversation_client_mismatch" });
        }
      }
      // Same path as /api/messages — compliance gate via composeAndSend.
      const shift = await requireActiveShift(req, res, {
        db, principal, exempt: SUPER_ROLES
      });
      if (!shift) return;

      const result = await composeAndSend(db, {
        orgId,
        staffId,
        shiftId: shift.id,
        conversationId: body.conversation_id || null,
        clientId: body.client_id || null,
        channel: body.channel || "sms",
        body: body.body,
        subject: body.subject || null,
        idempotencyKey: body.idempotency_key || null
      });

      return res.status(200).json({
        ok: true,
        kind: "client",
        conversation_id: result.conversationId,
        message: result.message,
        outcome: result.outcome,
        detail: result.detail,
        deduped: result.deduped
      });
    }

    return res.status(400).json({
      ok: false,
      error: "unknown_kind",
      allowed: ["internal", "client"]
    });
  } catch (err) {
    const code = err.code;
    if (code === "SELF" || code === "BODY") {
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (code === "NOT_FOUND") return res.status(404).json({ ok: false, error: err.message });
    if (code === "FORBIDDEN") return res.status(403).json({ ok: false, error: err.message });
    if (code === "IDEMPOTENCY_CONFLICT") {
      return res.status(409).json({ ok: false, error: "idempotency_key_reused" });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
