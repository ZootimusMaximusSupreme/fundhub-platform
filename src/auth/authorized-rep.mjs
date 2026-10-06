// An authorized representative opens someone else's file.
//
// A dad watches both kids. Staff add him. He is not an affiliate and he is not
// a second copy of either kid. One login, many files. One live person per file.
// Texts and emails for a linked file go to him. A file with nobody linked still
// messages the client.

import { hashPassword } from "./hash.mjs";
import { newToken } from "./session.mjs";
import { pool, db as sharedDb } from "../db.mjs";
import { normalizePhone } from "../messaging/providers/bland-voice.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function connector(db) {
  if (typeof db?.connect === "function") return () => db.connect();
  if (db === sharedDb) return () => pool().connect();
  return null;
}

async function withTransaction(db, fn) {
  const acquire = connector(db);
  if (!acquire) return fn(db);
  const client = await acquire();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** The live representative on this file, or null. */
export async function liveRepContact(db, clientId) {
  if (!clientId) return null;
  const { rows } = await db.query(
    `SELECT a.id AS account_id, a.email, a.phone, a.name
       FROM client_authorized_reps r
       JOIN accounts a ON a.id = r.account_id
      WHERE r.client_id = $1
        AND r.removed_at IS NULL
        AND a.kind = 'authorized_rep'
        AND a.status = 'active'
      LIMIT 1`,
    [clientId]
  );
  return rows[0] || null;
}

/**
 * Where a message for this file goes.
 * A live representative replaces the client address. No representative leaves
 * the client address as it was. A representative with no address for this
 * channel does not fall back to the client — the message has nowhere to go.
 */
export async function destinationAddress(db, clientId, channel, fallback) {
  const rep = await liveRepContact(db, clientId);
  if (!rep) return fallback ?? null;
  if (channel === "email") return rep.email || null;
  if (channel === "sms" || channel === "voice") return rep.phone || null;
  return fallback ?? null;
}

/** Point merge-tag context at the representative. The kid's name stays. */
export async function applyRepToContext(db, clientId, base) {
  if (!base || !base.contact) return base;
  const rep = await liveRepContact(db, clientId);
  if (!rep) return base;
  const email = rep.email || null;
  base.contact.email = email;
  base.contact.phone = rep.phone || null;
  if (!email) return base;
  const origin = String(process.env.APP_BASE_URL || process.env.URL || "https://fundhub.ai").replace(/\/+$/, "");
  const portalLoginUrl = `${origin}/portal-login.html?email=${encodeURIComponent(email)}`;
  const portalUrl = `${origin}/app/client-portal.html?email=${encodeURIComponent(email)}`;
  base.portal_login_url = portalLoginUrl;
  base.portal_url = portalUrl;
  base.CLIENT_PORTAL_URL = portalLoginUrl;
  if (base.custom_values) base.custom_values.portal_link = portalLoginUrl;
  return base;
}

/** The file this session is acting as. Writes it onto the session when empty. */
export async function actingClientId(db, { accountId, orgId, sessionId, activeClientId } = {}) {
  if (activeClientId) {
    const live = await db.query(
      `SELECT 1 FROM client_authorized_reps
        WHERE account_id = $1 AND client_id = $2 AND org_id = $3 AND removed_at IS NULL`,
      [accountId, activeClientId, orgId]
    );
    if (live.rows[0]) return activeClientId;
  }
  const first = await db.query(
    `SELECT client_id FROM client_authorized_reps
      WHERE account_id = $1 AND org_id = $2 AND removed_at IS NULL
      ORDER BY created_at ASC, client_id ASC
      LIMIT 1`,
    [accountId, orgId]
  );
  const id = first.rows[0]?.client_id || null;
  if (id && sessionId) {
    await db.query(
      `UPDATE account_sessions SET active_client_id = $2 WHERE id = $1`,
      [sessionId, id]
    );
  }
  return id;
}

export async function listRepFiles(db, accountId) {
  const { rows } = await db.query(
    `SELECT r.client_id, c.first_name, c.last_name
       FROM client_authorized_reps r
       JOIN clients c ON c.id = r.client_id
      WHERE r.account_id = $1 AND r.removed_at IS NULL
      ORDER BY r.created_at ASC, r.client_id ASC`,
    [accountId]
  );
  return rows;
}

/* orgId binds the link to the caller's company, the same way actingClientId()
   above already does. api/auth/authorized-rep-file.mjs passes principal.orgId;
   without it a link row from another company would have been honoured. Left
   optional so the existing in-company callers and tests keep their shape. */
export async function setActiveFile(db, { accountId, clientId, orgId } = {}) {
  const live = orgId
    ? await db.query(
      `SELECT 1 FROM client_authorized_reps
        WHERE account_id = $1 AND client_id = $2 AND org_id = $3 AND removed_at IS NULL`,
      [accountId, clientId, orgId]
    )
    : await db.query(
      `SELECT 1 FROM client_authorized_reps
        WHERE account_id = $1 AND client_id = $2 AND removed_at IS NULL`,
      [accountId, clientId]
    );
  if (!live.rows[0]) return { ok: false, status: 403, error: "not_your_file" };
  await db.query(
    `UPDATE account_sessions
        SET active_client_id = $2
      WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [accountId, clientId]
  );
  return { ok: true, clientId };
}

/**
 * Inbound text from a number that is not on a client row.
 * Lands on the file this person was last looking at, or the oldest linked file.
 */
export async function clientIdForRepPhone(db, orgId, phone) {
  const ph = normalizePhone(phone) || String(phone || "").trim();
  if (!orgId || !ph) return null;
  const { rows } = await db.query(
    `SELECT r.client_id
       FROM accounts a
       JOIN client_authorized_reps r
         ON r.account_id = a.id AND r.removed_at IS NULL
       LEFT JOIN account_sessions s
         ON s.account_id = a.id
        AND s.revoked_at IS NULL
        AND s.active_client_id = r.client_id
      WHERE a.org_id = $1
        AND a.phone = $2
        AND a.kind = 'authorized_rep'
        AND a.status = 'active'
      ORDER BY s.last_seen_at DESC NULLS LAST, r.created_at ASC
      LIMIT 1`,
    [orgId, ph]
  );
  return rows[0]?.client_id || null;
}

export async function addAuthorizedRep(db, { orgId, clientId, email, name, phone, staffId } = {}) {
  const mail = String(email || "").trim().toLowerCase();
  const person = String(name || "").trim();
  const e164 = normalizePhone(phone);
  if (!mail || !EMAIL_RE.test(mail)) return { ok: false, status: 400, error: "email_required" };
  if (!person) return { ok: false, status: 400, error: "name_required" };
  if (!e164) return { ok: false, status: 400, error: "phone_required" };
  if (!staffId) return { ok: false, status: 400, error: "staff_required" };

  const client = await db.query(
    `SELECT id FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  if (!client.rows[0]) return { ok: false, status: 404, error: "client_not_found" };

  const onAFile = await db.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, mail]
  );
  if (onAFile.rows[0]) return { ok: false, status: 409, error: "email_is_a_client" };

  return withTransaction(db, async (tx) => {
    const existing = await tx.query(
      `SELECT id, kind FROM accounts WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
      [orgId, mail]
    );
    let accountId;
    let replaced = false;
    if (existing.rows[0]) {
      if (existing.rows[0].kind !== "authorized_rep") {
        return { ok: false, status: 409, error: "email_is_another_login" };
      }
      accountId = existing.rows[0].id;
      await tx.query(
        `UPDATE accounts
            SET name = $2,
                phone = $3,
                status = 'active',
                password_hash = COALESCE(password_hash, $4),
                activated_at = COALESCE(activated_at, now())
          WHERE id = $1`,
        [accountId, person, e164, await hashPassword(newToken())]
      );
    } else {
      const ins = await tx.query(
        `INSERT INTO accounts
           (org_id, kind, email, name, phone, password_hash, status,
            invited_by, invited_at, activated_at)
         VALUES ($1, 'authorized_rep', $2, $3, $4, $5, 'active', $6, now(), now())
         RETURNING id`,
        [orgId, mail, person, e164, await hashPassword(newToken()), staffId]
      );
      accountId = ins.rows[0].id;
    }

    const live = await tx.query(
      `SELECT account_id FROM client_authorized_reps
        WHERE client_id = $1 AND removed_at IS NULL`,
      [clientId]
    );
    if (live.rows[0] && live.rows[0].account_id === accountId) {
      return { ok: true, accountId, email: mail, replaced: false };
    }
    if (live.rows[0]) {
      replaced = true;
      await tx.query(
        `UPDATE client_authorized_reps SET removed_at = now()
          WHERE client_id = $1 AND removed_at IS NULL`,
        [clientId]
      );
      await tx.query(
        `UPDATE account_sessions SET active_client_id = NULL
          WHERE account_id = $1 AND active_client_id = $2`,
        [live.rows[0].account_id, clientId]
      );
    }
    await tx.query(
      `INSERT INTO client_authorized_reps (org_id, account_id, client_id, added_by)
       VALUES ($1, $2, $3, $4)`,
      [orgId, accountId, clientId, staffId]
    );
    return { ok: true, accountId, email: mail, replaced };
  });
}

export async function removeAuthorizedRep(db, { orgId, clientId } = {}) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      `UPDATE client_authorized_reps SET removed_at = now()
        WHERE org_id = $1 AND client_id = $2 AND removed_at IS NULL
        RETURNING account_id`,
      [orgId, clientId]
    );
    if (!rows[0]) return { ok: false, status: 404, error: "no_rep" };
    const accountId = rows[0].account_id;
    const next = await tx.query(
      `SELECT client_id FROM client_authorized_reps
        WHERE account_id = $1 AND removed_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1`,
      [accountId]
    );
    await tx.query(
      `UPDATE account_sessions
          SET active_client_id = $2
        WHERE account_id = $1 AND revoked_at IS NULL AND active_client_id = $3`,
      [accountId, next.rows[0]?.client_id || null, clientId]
    );
    return { ok: true };
  });
}
