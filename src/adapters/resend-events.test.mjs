/* Resend delivery events — T5-16.
 *
 * "Sent" was the last thing that ever happened to an email. The dispatcher
 * wrote status='sent' the moment Resend answered 2xx and nothing ever moved
 * that row again, because there was no resend branch in the webhook door at
 * all. So a bounce, a spam complaint and a confirmed delivery all looked
 * identical from inside the system: sent.
 *
 * RESEND_WEBHOOK_SECRET does not exist in any environment yet. That is a real
 * blocker, and the first test below is the one that proves this endpoint
 * refuses everything until it does, rather than quietly accepting forgeries.
 */
import { test } from "node:test";
import assert from "node:assert";
import { createHmac } from "node:crypto";
import {
  handleResendDeliveryEvent, verifyResendSignature, normalizeResendEvent,
  RESEND_STATUS_MAP, IGNORED_RESEND_EVENTS
} from "./resend-events.mjs";

const SECRET = "whsec_" + Buffer.from("resend-test-signing-key-0123456789").toString("base64");
const NOW = () => Date.parse("2026-08-18T12:00:00Z");
const MSG_ID = "re_msg_0123456789";

function signed(body, { secret = SECRET, at = Math.floor(NOW() / 1000) } = {}) {
  const rawBody = JSON.stringify(body);
  const id = "msg_2abc";
  const key = Buffer.from(String(secret).slice("whsec_".length), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${at}.${rawBody}`).digest("base64");
  return { rawBody, body, headers: { "svix-id": id, "svix-timestamp": String(at), "svix-signature": `v1,${sig}` } };
}

const forbiddenDb = () => ({
  query: () => { throw new Error("the database was touched for a request that should have been refused"); }
});

const dbWith = (row) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT id, org_id, client_id FROM messages/.test(sql)) return { rows: row ? [row] : [] };
      if (/SELECT id, org_id FROM clients/.test(sql)) return { rows: [] };
      if (/UPDATE messages/.test(sql)) return { rowCount: 1 };
      if (/INSERT INTO opt_outs/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
};

const ROW = { id: "m-1", org_id: "org-1", client_id: "cl-1" };
const evt = (type) => ({ type, data: { email_id: MSG_ID, to: ["person@example.com"] } });

test("with NO signing secret, nothing is accepted and the database is never touched", async () => {
  /* The named blocker, asserted. An endpoint that answered 200 here would look
     configured while proving nothing, and nobody would find out until somebody
     asked why no email had ever been marked delivered. */
  const s = signed(evt("email.delivered"));
  const out = await handleResendDeliveryEvent({
    db: forbiddenDb(), body: s.body, rawBody: s.rawBody, headers: s.headers, secret: undefined, now: NOW
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 503);
  assert.equal(out.reason, "not_configured");
});

test("an UNSIGNED event is refused before the database is touched", async () => {
  const s = signed(evt("email.delivered"));
  const out = await handleResendDeliveryEvent({
    db: forbiddenDb(), body: s.body, rawBody: s.rawBody, headers: {}, secret: SECRET, now: NOW
  });
  assert.equal(out.status, 401);
  assert.equal(out.reason, "bad_signature");
});

test("an event signed with the WRONG secret is refused", async () => {
  const other = "whsec_" + Buffer.from("a-different-key-aaaaaaaaaaaaaaaaaa").toString("base64");
  const s = signed(evt("email.delivered"), { secret: other });
  const out = await handleResendDeliveryEvent({
    db: forbiddenDb(), body: s.body, rawBody: s.rawBody, headers: s.headers, secret: SECRET, now: NOW
  });
  assert.equal(out.status, 401);
});

test("a captured event replayed later is refused", async () => {
  /* Without a replay window a signature is valid forever, so a captured receipt
     could be posted back months later to re-mark a message. */
  const s = signed(evt("email.delivered"));
  const muchLater = () => NOW() + 60 * 60 * 1000;
  const out = await handleResendDeliveryEvent({
    db: forbiddenDb(), body: s.body, rawBody: s.rawBody, headers: s.headers, secret: SECRET, now: muchLater
  });
  assert.equal(out.status, 401);
});

test("a tampered body no longer verifies", async () => {
  const s = signed(evt("email.delivered"));
  const out = await handleResendDeliveryEvent({
    db: forbiddenDb(), body: s.body,
    rawBody: s.rawBody.replace(MSG_ID, "re_msg_somebody_elses"),
    headers: s.headers, secret: SECRET, now: NOW
  });
  assert.equal(out.status, 401);
});

test("key rotation works — any one valid signature in the header passes", () => {
  const s = signed(evt("email.delivered"));
  const withOld = `v1,AAAAnotarealsignature ${s.headers["svix-signature"]}`;
  assert.equal(verifyResendSignature({
    id: s.headers["svix-id"], timestamp: s.headers["svix-timestamp"],
    signature: withOld, rawBody: s.rawBody, secret: SECRET, now: NOW
  }), true);
});

test("a delivered event marks the message delivered", async () => {
  const s = signed(evt("email.delivered"));
  const db = dbWith(ROW);
  const out = await handleResendDeliveryEvent({ db, ...s, secret: SECRET, now: NOW });
  assert.equal(out.status, 200);
  assert.equal(out.updated, 1);
  const upd = db.calls.find((c) => /UPDATE messages/.test(c.sql));
  assert.equal(upd.params[1], "delivered");
});

test("a bounce and a failure are different statuses, not one", async () => {
  for (const [type, expected] of [["email.bounced", "bounced"], ["email.failed", "failed"]]) {
    const db = dbWith(ROW);
    await handleResendDeliveryEvent({ db, ...signed(evt(type)), secret: SECRET, now: NOW });
    const upd = db.calls.find((c) => /UPDATE messages/.test(c.sql));
    assert.equal(upd.params[1], expected, `${type} should write ${expected}`);
  }
});

test("a suppressed event is a receipt: the message leaves 'sent' as bounced", async () => {
  const db = dbWith(ROW);
  const out = await handleResendDeliveryEvent({ db, ...signed(evt("email.suppressed")), secret: SECRET, now: NOW });
  assert.equal(out.status, 200);
  assert.notEqual(out.reason, "unknown_event");
  assert.equal(out.updated, 1);
  const upd = db.calls.find((c) => /UPDATE messages/.test(c.sql));
  assert.ok(upd, "no UPDATE messages ran for email.suppressed");
  assert.equal(upd.params[1], "bounced");
});

test("a complaint writes the opt-out BEFORE it touches the message row", async () => {
  /* Order matters and is not cosmetic: a failure updating the message must not
     cost us the withdrawal of consent, because that is the half with legal
     weight. */
  const db = dbWith(ROW);
  const out = await handleResendDeliveryEvent({ db, ...signed(evt("email.complained")), secret: SECRET, now: NOW });
  assert.equal(out.optedOut, true);
  const optIdx = db.calls.findIndex((c) => /INSERT INTO opt_outs/.test(c.sql));
  const updIdx = db.calls.findIndex((c) => /UPDATE messages/.test(c.sql));
  assert.ok(optIdx !== -1, "no opt-out was written for a spam complaint");
  assert.ok(optIdx < updIdx, "the opt-out must be written first");
  const ins = db.calls[optIdx];
  assert.equal(ins.params[2], "email");
  assert.equal(ins.params[3], "provider_complaint_resend",
    "filed under its own source so an operator can see which provider carried it");
});

test("an open does not erase the record that the mail arrived", async () => {
  for (const type of ["email.opened", "email.clicked", "email.sent"]) {
    assert.ok(IGNORED_RESEND_EVENTS.has(type), `${type} must not move a delivery state`);
    const out = await handleResendDeliveryEvent({ db: dbWith(ROW), ...signed(evt(type)), secret: SECRET, now: NOW });
    assert.equal(out.updated, 0);
    assert.equal(out.reason, "not_delivery_state");
  }
});

test("a receipt for a message we do not have is acknowledged, not retried forever", async () => {
  const out = await handleResendDeliveryEvent({ db: dbWith(null), ...signed(evt("email.delivered")), secret: SECRET, now: NOW });
  assert.equal(out.status, 200, "a 500 here makes Resend retry the same event indefinitely");
  assert.equal(out.reason, "unmatched");
  assert.equal(out.updated, 0);
});

test("the row is matched on Resend's BARE id, not Mailgun's bracketed one", async () => {
  /* Resend stores a bare id; the Mailgun matcher strips angle brackets off a
     Message-ID. Reusing that matcher here would never find the row. */
  const db = dbWith(ROW);
  await handleResendDeliveryEvent({ db, ...signed(evt("email.delivered")), secret: SECRET, now: NOW });
  const sel = db.calls.find((c) => /FROM messages/.test(c.sql));
  assert.ok(!/btrim/i.test(sel.sql), "that is the Mailgun id format, not Resend's");
  assert.equal(sel.params[0], MSG_ID);
  assert.match(sel.sql, /direction = 'outbound'/);
  assert.match(sel.sql, /channel = 'email'/, "a colliding id must not move a text message");
});

test("an unknown event name is acknowledged and changes nothing", async () => {
  const out = await handleResendDeliveryEvent({ db: dbWith(ROW), ...signed(evt("email.something_new")), secret: SECRET, now: NOW });
  assert.equal(out.status, 200);
  assert.equal(out.updated, 0);
});

test("a malformed payload is refused, never a crash", async () => {
  for (const body of [null, {}, { type: 123 }, { type: "email.delivered" }]) {
    const s = signed(body);
    await assert.doesNotReject(() => handleResendDeliveryEvent({ db: dbWith(null), ...s, secret: SECRET, now: NOW }));
  }
});

test("normalizeResendEvent reads the id and recipient Resend actually sends", () => {
  const n = normalizeResendEvent({ type: "email.delivered", data: { email_id: "re_1", to: ["A@Example.COM"] } });
  assert.equal(n.type, "email.delivered");
  assert.equal(n.providerMessageId, "re_1");
  assert.equal(n.recipient, "a@example.com", "lower-cased for the client lookup");
});

test("delivered is not the same value as sent — the whole point of the file", () => {
  assert.equal(RESEND_STATUS_MAP["email.delivered"], "delivered");
  assert.notEqual(RESEND_STATUS_MAP["email.delivered"], "sent");
});
