// GET/POST /api/public/unsubscribe — the door behind the unsubscribe link.
//
// COMPLIANCE REVIEW REQUIRED. This is consent capture: a POST here withdraws a
// person's permission to be emailed, and the send gate reads that row on every
// later send.
//
// NO AUTH, BY DESIGN. Same class as the soft-pull approval link and the
// contract link: the person clicking is not signed in and must never be made
// to sign in to get out of a mailing list. The signed token IS the credential
// and it is verified before anything is read or written.
//
// GET DOES NOT UNSUBSCRIBE. THIS IS THE WHOLE REASON THE ENDPOINT HAS TWO
// VERBS. Mail security scanners fetch every URL in a message before the person
// ever sees it — the same behaviour documented in src/auth/magic-link.mjs,
// where it was burning single-use sign-in links before the client opened them.
// A GET that wrote the row would unsubscribe people who never clicked, and we
// would have no way of telling that from a real one. So GET reports the state
// and POST is the act.

import { db } from "../../src/db.mjs";
import { verifyUnsubscribeRequest, UNSUBSCRIBE_LINK_SOURCE } from "../../src/messaging/unsubscribe.mjs";
import { recordOptOut, isOptedOut } from "../../src/lib/opt-out.mjs";
import { safeError } from "../../src/http/health.mjs";
import { BANKER_CHANNEL } from "../../src/outreach/mail.mjs";

/* Read the token from the query string or the posted body. The page sends it
   both ways for the two verbs, and the shape matches api/soft-pull-approve.mjs
   so the two public token endpoints do not drift. */
function tokenFrom(req) {
  const q = req.query || {};
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch { body = {}; }
  }
  if (!body || typeof body !== "object" || Buffer.isBuffer(body)) body = {};
  return {
    org: q.org || body.org,
    client: q.client || body.client,
    channel: q.channel || body.channel,
    exp: q.exp || body.exp,
    sig: q.sig || body.sig
  };
}

export default async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  /* One answer for every kind of bad link — forged, tampered, expired or just
     truncated by a mail client. Telling them apart would let somebody probe
     which client ids exist, and none of the four is actionable by the reader
     anyway: the only useful thing to say is "this link no longer works". */
  const token = verifyUnsubscribeRequest(tokenFrom(req));
  if (!token) {
    return res.status(400).json({
      ok: false,
      error: "invalid_or_expired",
      message: "This unsubscribe link is not valid any more. Reply to any of our emails with the word STOP and we will take you off the list."
    });
  }

  try {
    /* A banker's link (495): same signed scheme, channel banker_email, and the
       id is their outreach contact. The channel is inside the signature, so a
       client's link can never reach this branch, nor a banker's link the other. */
    if (token.channel === BANKER_CHANNEL) {
      const invalid = () => res.status(400).json({
        ok: false,
        error: "invalid_or_expired",
        message: "This unsubscribe link is not valid any more. Reply to any of our emails with the word STOP and we will take you off the list."
      });
      if (method === "GET") {
        const row = (await db.query(
          `SELECT email_opt_out_at FROM outreach_contacts WHERE id = $1 AND org_id = $2`,
          [token.clientId, token.orgId])).rows[0];
        if (!row) return invalid();
        return res.status(200).json({ ok: true, channel: "email", already_unsubscribed: !!row.email_opt_out_at });
      }
      const done = await db.query(
        `UPDATE outreach_contacts SET email_opt_out_at = COALESCE(email_opt_out_at, now()), updated_at = now()
          WHERE id = $1 AND org_id = $2 RETURNING id`, [token.clientId, token.orgId]);
      if (!done.rows.length) return invalid();
      await db.query(
        `UPDATE outreach_email_sequences SET status = 'stopped', stopped_at = now(), stop_reason = 'opted_out', updated_at = now()
          WHERE org_id = $1 AND contact_id = $2 AND status = 'active'`, [token.orgId, token.clientId]);
      return res.status(200).json({ ok: true, channel: "email", unsubscribed: true });
    }

    if (method === "GET") {
      // Report only. See the header: a scanner following this link must not
      // change anything.
      const already = await isOptedOut(db, token.clientId, token.channel);
      return res.status(200).json({ ok: true, channel: token.channel, already_unsubscribed: already });
    }

    await recordOptOut(db, token.clientId, token.orgId, token.channel, UNSUBSCRIBE_LINK_SOURCE);
    return res.status(200).json({ ok: true, channel: token.channel, unsubscribed: true });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      error: safeError(err),
      message: "We could not record that just now. Please try again in a minute."
    });
  }
}
