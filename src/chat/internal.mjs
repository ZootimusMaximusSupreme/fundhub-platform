// Staff↔staff internal messaging for the chat widget.
//
// Reuses messages + conversations. Does NOT go through the compliance gate
// (spec §4.3 — internal pings are not client outbound). Visually distinct via
// conversations.kind = 'internal'.

import { ROLE_TEST_STAFF } from "../auth/seed-role-accounts.mjs";

/** The one key an internal thread between two staff members is stored under. */
export function pairKey(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}

/* WHO IS A TEAMMATE IN THE CHAT LIST (owner, 2026-10-20): only active, working
   employees. Not a suspended or switched-off login, not a demo row, not one of
   the seeded "TEST — <Role>" logins agents use to prove each role, not a
   fixture on a test domain (example.com and friends), and not a principal
   kind (partner, client, affiliate) that happens to live in the staff table. */
export const NOT_TEAMMATE_ROLES = Object.freeze(["partner", "client", "affiliate"]);
export const ROLE_TEST_EMAILS = Object.freeze(ROLE_TEST_STAFF.map((s) => String(s.email).toLowerCase()));
export const TEST_EMAIL_DOMAIN_RE = "(^|\\.)(example\\.(com|org|net)|local|localhost|test|invalid)$";

/**
 * listWorkingTeammates(db, { orgId, staffId }) → [{ id, name, email, role }]
 * Everyone the signed-in staff member may message, never themselves.
 */
export async function listWorkingTeammates(db, { orgId, staffId, limit = 200 } = {}) {
  const r = await db.query(
    `SELECT id, name, email, role
       FROM staff
      WHERE org_id = $1
        AND status = 'active'
        AND active IS NOT FALSE
        AND id <> $2
        AND COALESCE(is_demo, false) = false
        AND lower(COALESCE(role, '')) <> ALL($3::text[])
        AND lower(btrim(COALESCE(email, ''))) <> ALL($4::text[])
        AND split_part(lower(btrim(COALESCE(email, ''))), '@', 2) !~ $5
      ORDER BY name ASC
      LIMIT $6`,
    [orgId, staffId, [...NOT_TEAMMATE_ROLES], [...ROLE_TEST_EMAILS], TEST_EMAIL_DOMAIN_RE, limit]
  );
  return r.rows;
}

/**
 * listAssignedClients(db, { orgId, staffId }) → [{ id, name, client_code }]
 * The clients this staff member is the assigned CSM for (owner, 2026-10-20:
 * "the clients assigned to them"). Real clients only. No phone, no email.
 */
export async function listAssignedClients(db, { orgId, staffId, limit = 200 } = {}) {
  const r = await db.query(
    `SELECT c.id,
            NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), '') AS name,
            c.client_code
       FROM clients c
      WHERE c.org_id = $1
        AND c.assigned_csm_staff_id = $2
        AND COALESCE(c.is_demo, false) = false
        AND c.custom_fields->>'crm_archived_at' IS NULL
      ORDER BY name ASC NULLS LAST, c.client_code ASC NULLS LAST
      LIMIT $3`,
    [orgId, staffId, limit]
  );
  return r.rows;
}

/**
 * getOrCreateInternalThread(db, { orgId, staffId, peerStaffId })
 */
export async function getOrCreateInternalThread(db, { orgId, staffId, peerStaffId }) {
  if (!orgId || !staffId || !peerStaffId) {
    throw new TypeError("getOrCreateInternalThread: orgId, staffId, peerStaffId required");
  }
  if (staffId === peerStaffId) {
    const e = new Error("cannot message yourself");
    e.code = "SELF";
    throw e;
  }

  const key = pairKey(staffId, peerStaffId);
  const existing = await db.query(
    `SELECT * FROM conversations
      WHERE org_id = $1 AND kind = 'internal' AND internal_pair_key = $2`,
    [orgId, key]
  );
  if (existing.rows[0]) return existing.rows[0];

  const peer = await db.query(
    `SELECT id FROM staff WHERE id = $1 AND org_id = $2 AND status = 'active'`,
    [peerStaffId, orgId]
  );
  if (!peer.rows[0]) {
    const e = new Error("peer staff not found in this org");
    e.code = "NOT_FOUND";
    throw e;
  }

  const ins = await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, kind, internal_pair_key, last_pulse_at)
     VALUES ($1, NULL, 'internal', 'internal', $2, now())
     RETURNING *`,
    [orgId, key]
  );
  const convo = ins.rows[0];
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, staff_id)
     VALUES ($1, $2), ($1, $3)
     ON CONFLICT DO NOTHING`,
    [convo.id, staffId, peerStaffId]
  );
  return convo;
}

/**
 * sendInternalMessage(db, { orgId, staffId, conversationId, body })
 * Inserts an outbound messages row with sender_kind='staff'. No dispatch.
 */
export async function sendInternalMessage(db, {
  orgId, staffId, conversationId, body, idempotencyKey = null
} = {}) {
  const text = String(body || "").trim();
  if (!text) {
    const e = new Error("body required");
    e.code = "BODY";
    throw e;
  }
  if (text.length > 8000) {
    const e = new Error("body too long");
    e.code = "BODY";
    throw e;
  }

  const part = await db.query(
    `SELECT 1 FROM conversation_participants
      WHERE conversation_id = $1 AND staff_id = $2`,
    [conversationId, staffId]
  );
  if (!part.rows[0]) {
    const e = new Error("not a participant");
    e.code = "FORBIDDEN";
    throw e;
  }

  const convo = await db.query(
    `SELECT id, org_id, kind FROM conversations WHERE id = $1 AND org_id = $2`,
    [conversationId, orgId]
  );
  if (!convo.rows[0] || convo.rows[0].kind !== "internal") {
    const e = new Error("internal conversation not found");
    e.code = "NOT_FOUND";
    throw e;
  }

  const providerRef = idempotencyKey ? `internal:${idempotencyKey}` : null;
  if (providerRef) {
    const prior = await db.query(
      `SELECT * FROM messages WHERE org_id = $1 AND provider_ref = $2`,
      [orgId, providerRef]
    );
    if (prior.rows[0]) {
      return { message: prior.rows[0], deduped: true };
    }
  }

  const ins = await db.query(
    `INSERT INTO messages (
       org_id, client_id, conversation_id, direction, channel,
       rendered_body, status, compliance_check_passed,
       sender_staff_id, sender_kind, provider_ref
     ) VALUES (
       $1, NULL, $2, 'outbound', 'internal',
       $3, 'delivered', true,
       $4, 'staff', $5
     ) RETURNING *`,
    [orgId, conversationId, text, staffId, providerRef]
  );

  await db.query(
    `UPDATE conversations SET last_pulse_at = now(), updated_at = now() WHERE id = $1`,
    [conversationId]
  );

  return { message: ins.rows[0], deduped: false };
}

/**
 * listInternalThreads(db, { orgId, staffId, limit })
 */
export async function listInternalThreads(db, { orgId, staffId, limit = 30 } = {}) {
  const res = await db.query(
    `SELECT c.id, c.kind, c.channel, c.last_pulse_at, c.created_at,
            (SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'email', s.email, 'role', s.role
             ) ORDER BY s.name)
               FROM conversation_participants cp
               JOIN staff s ON s.id = cp.staff_id
              WHERE cp.conversation_id = c.id) AS participants,
            (SELECT m.rendered_body FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_body
       FROM conversations c
       JOIN conversation_participants me
         ON me.conversation_id = c.id AND me.staff_id = $2
      WHERE c.org_id = $1 AND c.kind = 'internal'
      ORDER BY COALESCE(c.last_pulse_at, c.created_at) DESC
      LIMIT $3`,
    [orgId, staffId, Math.min(100, Math.max(1, Number(limit) || 30))]
  );
  return res.rows;
}

/**
 * listThreadMessages(db, { orgId, conversationId, limit })
 */
export async function listThreadMessages(db, { orgId, conversationId, limit = 100 } = {}) {
  const res = await db.query(
    `SELECT m.id, m.direction, m.channel, m.rendered_body, m.status,
            m.sender_staff_id, m.sender_kind, m.created_at,
            s.name AS sender_name
       FROM messages m
       LEFT JOIN staff s ON s.id = m.sender_staff_id
      WHERE m.org_id = $1 AND m.conversation_id = $2
      ORDER BY m.created_at ASC
      LIMIT $3`,
    [orgId, conversationId, Math.min(500, Math.max(1, Number(limit) || 100))]
  );
  return res.rows;
}

export { pairKey as _pairKeyForTests };
