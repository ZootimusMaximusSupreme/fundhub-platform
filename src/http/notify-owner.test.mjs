import { test } from "node:test";
import assert from "node:assert/strict";

import handler, { MAX_TEXT, NOTIFY_SECRET_HEADER } from "../../api/ops/notify-owner.mjs";

const SECRET = "s".repeat(40);

function res() {
  const out = { statusCode: 0, body: null, headers: {} };
  out.status = (code) => { out.statusCode = code; return out; };
  out.json = (body) => { out.body = body; return out; };
  out.setHeader = (k, v) => { out.headers[k] = v; };
  return out;
}

function call({ method = "POST", secret = SECRET, text = "Shipped.", env = { OPS_NOTIFY_SECRET: SECRET }, send } = {}) {
  const sent = [];
  const r = res();
  const req = { method, headers: secret == null ? {} : { [NOTIFY_SECRET_HEADER]: secret }, body: { text } };
  const fake = send || (async (args) => { sent.push(args); return { delivery_status: "sent", sent_to_last4: "6457", error: null }; });
  return handler(req, r, { env, send: fake }).then(() => ({ r, sent }));
}

test("notify-owner: only POST", async () => {
  const { r, sent } = await call({ method: "GET" });
  assert.equal(r.statusCode, 405);
  assert.equal(sent.length, 0);
});

test("notify-owner: no secret on the server is 503 and sends nothing", async () => {
  for (const env of [{}, { OPS_NOTIFY_SECRET: "short" }, { OPS_NOTIFY_SECRET: "*".repeat(40) }]) {
    const { r, sent } = await call({ env });
    assert.equal(r.statusCode, 503);
    assert.equal(sent.length, 0);
  }
});

test("notify-owner: a missing or wrong secret is 401 and sends nothing", async () => {
  for (const secret of [null, "", "x".repeat(40), SECRET + "x"]) {
    const { r, sent } = await call({ secret });
    assert.equal(r.statusCode, 401);
    assert.equal(sent.length, 0);
  }
});

test("notify-owner: empty or too-long text is 400 and sends nothing", async () => {
  for (const text of ["", "   ", "x".repeat(MAX_TEXT + 1)]) {
    const { r, sent } = await call({ text });
    assert.equal(r.statusCode, 400);
    assert.equal(sent.length, 0);
  }
});

test("notify-owner: the right secret sends the text to the owner number only", async () => {
  const { r, sent } = await call({ text: "Shipped 81b50d23." });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.sent_to_last4, "6457");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, "Shipped 81b50d23.");
  assert.equal(sent[0].dryRun, false);
  assert.equal("to" in sent[0], false, "the caller never names a number");
});

test("notify-owner: a failed send answers 502 with the reason", async () => {
  const send = async () => ({ delivery_status: "failed", sent_to_last4: "6457", error: "twilio 401" });
  const { r } = await call({ send });
  assert.equal(r.statusCode, 502);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /twilio 401/);
});

/* Texting hours (owner law 2026-10-09, .claude/rules/texting-hours.md): outside 6 a.m. to 10 p.m. Arizona
   time the door answers 202 held and nothing is sent. The hold is inside textMorningBrief, the real sender. */
test("notify-owner: at 2:07 a.m. Arizona the real sender holds it: 202, delivery_status held_quiet_hours, nothing sent", async () => {
  const { textMorningBrief } = await import("../../src/pulse/notify.mjs");
  const twilio = [];
  const send = (args) => textMorningBrief({
    ...args, now: new Date("2026-10-10T09:07:00Z"),
    sendImpl: async (m) => { twilio.push(m); return { status: "sent" }; }
  });
  const { r } = await call({ send, env: { OPS_NOTIFY_SECRET: SECRET, PULSE_SMS_TO: "+15555556457" } });
  assert.equal(r.statusCode, 202);
  assert.deepEqual(r.body, { ok: true, delivery_status: "held_quiet_hours", sent_to_last4: "6457", error: null });
  assert.equal(twilio.length, 0, "nothing reached Twilio");
});

test("notify-owner: the same real sender at noon Arizona sends (200)", async () => {
  const { textMorningBrief } = await import("../../src/pulse/notify.mjs");
  const twilio = [];
  const send = (args) => textMorningBrief({
    ...args, now: new Date("2026-10-09T19:00:00Z"),
    sendImpl: async (m) => { twilio.push(m); return { status: "sent", providerMessageId: "SM1" }; }
  });
  const { r } = await call({ send, env: { OPS_NOTIFY_SECRET: SECRET, PULSE_SMS_TO: "+15555556457" } });
  assert.equal(r.statusCode, 200);
  assert.equal(twilio.length, 1);
});
