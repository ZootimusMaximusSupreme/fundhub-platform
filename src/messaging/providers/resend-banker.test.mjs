// Resend's banker additions (495): a From only on a domain this account sends
// for, and a reply tag that names the banker instead of a client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { send, allowedFrom } from "./resend.mjs";

const C = "0d6f2c1e-1111-4222-8333-444455556666";
const ENV = { RESEND_API_KEY: "re_" + "k".repeat(30), RESEND_FROM: "Fundhub <hello@fundhub.ai>", RESEND_REPLY_TO_DOMAIN: "reply.example.org", MESSAGING_DRY_RUN: "0" };

test("a From is allowed only on the default domain or a listed extra domain", () => {
  assert.equal(allowedFrom("Partners <partners@fundhub.ai>", ENV.RESEND_FROM, ENV), "Partners <partners@fundhub.ai>");
  assert.equal(allowedFrom("partners@other.example", ENV.RESEND_FROM, ENV), null);
  assert.equal(allowedFrom("partners@other.example", ENV.RESEND_FROM, { RESEND_EXTRA_FROM_DOMAINS: "other.example" }), "partners@other.example");
  assert.equal(allowedFrom("a@fundhub.ai\r\nBcc: x@y.z", ENV.RESEND_FROM, ENV), null);
});

async function capture(message) {
  let payload = null;
  const fetchImpl = async (_url, init) => { payload = JSON.parse(init.body); return new Response('{"id":"msg_1"}', { status: 200 }); };
  const result = await send({ to: "jane@bank.example", subject: "Hi", body: "Hello", ...message }, { env: ENV, fetchImpl });
  return { result, payload };
}

test("a banker email uses its own From and a banker reply tag", async () => {
  const { result, payload } = await capture({ from: "Partners <partners@fundhub.ai>", replyTag: `bk-${C}`, unsubscribeUrl: "https://fundhub.ai/unsubscribe.html?x=1" });
  assert.equal(result.status, "sent");
  assert.equal(payload.from, "Partners <partners@fundhub.ai>");
  assert.equal(payload.reply_to, `reply+bk-${C}@reply.example.org`);
  assert.equal(payload.headers["List-Unsubscribe"], "<https://fundhub.ai/unsubscribe.html?x=1>");
});

test("a From on another domain is refused, not swapped for the default", async () => {
  const { result, payload } = await capture({ from: "partners@other.example", replyTag: `bk-${C}` });
  assert.equal(result.status, "rejected");
  assert.equal(payload, null);
});

test("client mail is unchanged: default From and the client reply tag", async () => {
  const { payload } = await capture({ clientId: C });
  assert.equal(payload.from, ENV.RESEND_FROM);
  assert.equal(payload.reply_to, `reply+${C}@reply.example.org`);
  const forged = await capture({ clientId: C, replyTag: "bk-not-a-uuid" });
  assert.equal(forged.payload.reply_to, `reply+${C}@reply.example.org`);
});
