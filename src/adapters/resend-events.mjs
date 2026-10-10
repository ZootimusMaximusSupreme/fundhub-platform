// Resend delivery events — the missing half of "did that email actually land?"
//
// WHY THIS FILE EXISTS (T5-16). Outbound email goes through Resend. The
// dispatcher writes status='sent' the moment Resend answers 2xx, and until now
// NOTHING EVER MOVED THAT ROW AGAIN. There was no `resend` branch in the
// webhook door, so a bounce, a complaint or a confirmed delivery had nowhere to
// arrive. "Sent" meant "we handed it over", which is not the same claim as "it
// arrived" and was being read as if it were.
//
// The Mailgun delivery adapter cannot serve this. It matches a receipt to a row
// on `btrim(provider_message_id, '<>')`, which is Mailgun's angle-bracketed
// Message-ID format; Resend stores a bare uuid, so a Mailgun-shaped matcher
// would never find the row even if a Resend event reached it.
//
// FAILS CLOSED, LIKE EVERY OTHER WEBHOOK HERE. With no signing secret nothing
// is accepted. A forged delivery event can mark a live message dead or opt a
// client out of email, so an unsigned one is refused rather than trusted — the
// same decision recorded in src/adapters/mailgun.mjs, where "the bug was never
// calling it".
//
// RESEND_WEBHOOK_SECRET IS NOT SET ANYWHERE YET. That is a real blocker and it
// is named rather than worked around: until it exists, this endpoint refuses
// everything, which is the correct behaviour and not a bug to route around.

import { createHmac, timingSafeEqual } from "node:crypto";
import { recordOptOut } from "../lib/opt-out.mjs";

/* Resend signs with Svix. The signed content is `<id>.<timestamp>.<body>`, the
   secret is base64 after a `whsec_` prefix, and the signature header carries one
   or more space-separated `v1,<base64>` values so a secret can be rotated
   without dropping traffic. */
const SVIX_PREFIX = "whsec_";
const TOLERANCE_SECONDS = 60 * 5;

export function verifyResendSignature({ id, timestamp, signature, rawBody, secret, now = Date.now }) {
  if (!secret || !id || !timestamp || !signature || rawBody == null) return false;

  /* REPLAY WINDOW. A signature stays valid forever without one, so a captured
     event could be posted back months later to re-mark a message or re-open an
     opt-out. Five minutes is Svix's own recommendation. */
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(now() / 1000) - ts) > TOLERANCE_SECONDS) return false;

  const key = String(secret).startsWith(SVIX_PREFIX)
    ? Buffer.from(String(secret).slice(SVIX_PREFIX.length), "base64")
    : Buffer.from(String(secret), "utf8");

  const expected = createHmac("sha256", key)
    .update(`${id}.${ts}.${rawBody}`)
    .digest("base64");

  // The header may carry several versioned signatures; any one matching is a
  // pass, which is what makes key rotation possible.
  for (const part of String(signature).split(/\s+/)) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(value, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/* Resend's event names → our `messages.status`.

   `email.sent` and `email.opened` are absent deliberately. The row is already
   'sent' by the time an event could arrive, and letting an open overwrite
   'delivered' would lose the only record that the mail actually landed — the
   same reasoning as IGNORED_DELIVERY_EVENTS in the Mailgun adapter.

   `email.complained` maps to a status AND writes an opt-out. The opt-out is the
   part with legal weight. */
export const RESEND_STATUS_MAP = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": null,
  "email.failed": "failed",
  /* Resend refused to send because the address is on its suppression list (an
     earlier bounce or complaint). It is a final answer: the mail never left. It
     files as 'bounced', the same word a hard bounce gets, so the row leaves 'sent'
     and the morning report stops calling it a message with no receipt. Before this
     line the event was captured and then dropped as unknown_event. */
  "email.suppressed": "bounced"
};

export const IGNORED_RESEND_EVENTS = new Set([
  "email.sent", "email.opened", "email.clicked", "email.scheduled"
]);

/* A complaint through Resend is the same withdrawal of consent a Mailgun one
   is, filed under its own source so an operator can see which provider carried
   it. It does NOT raise a review task here — Resend has no template id on the
   payload, so a task would name nothing actionable. */
export const RESEND_COMPLAINT_SOURCE = "provider_complaint_resend";

export function normalizeResendEvent(body) {
  const b = body && typeof body === "object" ? body : {};
  const data = b.data && typeof b.data === "object" ? b.data : {};
  const to = Array.isArray(data.to) ? data.to[0] : data.to;
  return {
    type: String(b.type || ""),
    providerMessageId: data.email_id || data.id || null,
    recipient: to ? String(to).trim().toLowerCase() : null
  };
}

/**
 * handleResendDeliveryEvent({ db, body, rawBody, headers, secret })
 *   → { ok, status, reason?, updated, event?, optedOut? }
 *
 * Never throws on a bad payload: a malformed webhook is a refused webhook, not
 * a 500 that makes Resend retry forever.
 */
export async function handleResendDeliveryEvent({ db, body, rawBody, headers = {}, secret, now = Date.now } = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) h[String(k).toLowerCase()] = v;

  if (!secret) {
    /* NAMED, NOT SILENT. Answering 200 here would make an unconfigured
       endpoint look like a working one, and nobody would find out until
       somebody asked why no email has ever been marked delivered. */
    return { ok: false, status: 503, reason: "not_configured", updated: 0 };
  }

  const okSig = verifyResendSignature({
    id: h["svix-id"], timestamp: h["svix-timestamp"], signature: h["svix-signature"],
    rawBody: typeof rawBody === "string" ? rawBody : JSON.stringify(body ?? {}),
    secret, now
  });
  if (!okSig) return { ok: false, status: 401, reason: "bad_signature", updated: 0 };

  const evt = normalizeResendEvent(body);
  if (!evt.type) return { ok: true, status: 200, reason: "unknown_event", updated: 0 };
  if (IGNORED_RESEND_EVENTS.has(evt.type)) {
    return { ok: true, status: 200, reason: "not_delivery_state", updated: 0, event: evt.type };
  }

  const mapped = RESEND_STATUS_MAP[evt.type];
  if (!mapped) return { ok: true, status: 200, reason: "unknown_event", updated: 0, event: evt.type };

  /* Matched on Resend's own id, which it stores bare. Guarded to outbound email
     so a colliding id cannot move a row on another channel. */
  const found = await db.query(
    `SELECT id, org_id, client_id FROM messages
      WHERE provider_message_id = $1 AND direction = 'outbound' AND channel = 'email'`,
    [evt.providerMessageId]
  );
  const row = found.rows[0] || null;

  /* THE OPT-OUT COMES FIRST, for the same reason it does on the Mailgun path:
     a failure updating the message row must not cost us the withdrawal of
     consent. Getting that order wrong means we keep emailing somebody who
     reported us. */
  let optedOut = false;
  if (evt.type === "email.complained") {
    const target = row && row.client_id
      ? { clientId: row.client_id, orgId: row.org_id }
      : await resolveClientByEmail(db, evt.recipient);
    if (target) {
      await recordOptOut(db, target.clientId, target.orgId, "email", RESEND_COMPLAINT_SOURCE);
      optedOut = true;
    }
  }

  if (!row) {
    // Acknowledged so Resend stops retrying, but named — an unmatched receipt
    // usually means the dispatcher never stored provider_message_id.
    return { ok: true, status: 200, reason: "unmatched", updated: 0, event: evt.type, optedOut };
  }

  const upd = await db.query(
    `UPDATE messages SET status = $2, updated_at = now() WHERE id = $1`,
    [row.id, mapped]
  );
  return { ok: true, status: 200, updated: upd.rowCount ?? 0, event: evt.type, optedOut };
}

/* Last resort for a complaint we cannot tie to a message row — a complaint that
   names a recipient we know is still a withdrawal of consent, and dropping it
   on a technicality would be the system forgetting.

   Two rows, not one: an address held by more than one client cannot be resolved
   to a person, and opting out an arbitrary one of them is the T5-04 defect
   arriving through a different door. */
async function resolveClientByEmail(db, recipient) {
  const email = String(recipient || "").trim().toLowerCase();
  if (!email) return null;
  const r = await db.query(
    `SELECT id, org_id FROM clients WHERE lower(email) = $1 LIMIT 2`, [email]);
  if (r.rows.length !== 1) return null;
  return { clientId: r.rows[0].id, orgId: r.rows[0].org_id };
}
