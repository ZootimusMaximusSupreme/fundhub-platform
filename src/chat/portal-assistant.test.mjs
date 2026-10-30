import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  answerPortalMessage,
  portalAssistantContext,
  portalAssistantSystemPrompt,
  PORTAL_ASSISTANT_FALLBACK
} from "./portal-assistant.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KEYED = { ANTHROPIC_API_KEY: "sk-ant-test" };

function anthropicReply(text) {
  return async () => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text }] })
  });
}

test("context carries only the client's own facts", () => {
  const ctx = portalAssistantContext({
    client: { first_name: "Chris", custom_fields: { crs_paid: true, call_outcome: "booked" } },
    prequalDisplay: "$50,000"
  });
  assert.equal(ctx.firstName, "Chris");
  assert.equal(ctx.prequalDisplay, "$50,000");
  assert.equal(ctx.softPullComplete, true);
  assert.equal(ctx.hasBookedCall, true);
});

test("context reports a missing pre-qual as missing, never zero", () => {
  const ctx = portalAssistantContext({ client: { custom_fields: {} } });
  assert.equal(ctx.prequalDisplay, null);
  assert.equal(ctx.softPullComplete, false);
  assert.equal(ctx.firstName, null);
});

test("system prompt forbids promising an outcome", () => {
  const p = portalAssistantSystemPrompt(portalAssistantContext({ client: {} }));
  assert.match(p, /Never promise, guarantee, or predict a funding amount/);
  assert.match(p, /Never give legal, tax, or investment advice/);
  assert.match(p, /Never state a dollar figure that is not in the list above/);
});

test("system prompt states the pre-qual amount is not an approval", () => {
  const p = portalAssistantSystemPrompt(
    portalAssistantContext({ client: {}, prequalDisplay: "$50,000" })
  );
  assert.match(p, /\$50,000/);
  assert.match(p, /not an approval and not a guarantee/);
});

test("system prompt tells the model to say the number is not in yet", () => {
  const p = portalAssistantSystemPrompt(portalAssistantContext({ client: {} }));
  assert.match(p, /NO pre-qualified amount/);
});

test("system prompt forbids Markdown, which the widget renders literally", () => {
  assert.match(
    portalAssistantSystemPrompt(portalAssistantContext({ client: {} })),
    /does not render Markdown/
  );
});

test("a live Claude reply comes back as the answer", async () => {
  const out = await answerPortalMessage({
    question: "When is my call?",
    context: portalAssistantContext({ client: { first_name: "Chris" } }),
    env: KEYED,
    fetchImpl: anthropicReply("Your advisor will confirm the time with you.")
  });
  assert.equal(out.ok, true);
  assert.equal(out.mode, "live");
  assert.equal(out.text, "Your advisor will confirm the time with you.");
});

test("no API key falls back and never leaks the shadow marker to a client", async () => {
  const out = await answerPortalMessage({
    question: "How much do I get?",
    context: {},
    env: {}
  });
  assert.equal(out.ok, false);
  assert.equal(out.mode, "shadow");
  assert.equal(out.text, PORTAL_ASSISTANT_FALLBACK);
  assert.doesNotMatch(out.text, /SHADOW/);
});

test("an Anthropic error falls back instead of throwing", async () => {
  const out = await answerPortalMessage({
    question: "Hello",
    context: {},
    env: KEYED,
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) })
  });
  assert.equal(out.ok, false);
  assert.equal(out.text, PORTAL_ASSISTANT_FALLBACK);
});

test("an empty question does not call the model", async () => {
  let called = false;
  const out = await answerPortalMessage({
    question: "   ",
    env: KEYED,
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; }
  });
  assert.equal(called, false);
  assert.equal(out.text, PORTAL_ASSISTANT_FALLBACK);
});

test("portal-message stores the assistant reply as delivered, never queued", () => {
  const src = readFileSync(path.join(ROOT, "api/chat/portal-message.mjs"), "utf8");
  assert.match(src, /answerPortalMessage/);
  assert.match(src, /'delivered', 'internal', true, 'agent'/);
  assert.doesNotMatch(src, /'outbound', \$4, \$5, 'queued'/);
});

test("portal-message admits GET for the signed-in client's own thread", () => {
  const src = readFileSync(path.join(ROOT, "api/chat/portal-message.mjs"), "utf8");
  assert.match(src, /req\.method === "GET"/);
  assert.match(src, /FROM messages m/);
  assert.match(src, /m\.org_id = \$1 AND m\.client_id = \$2 AND m\.conversation_id = \$3/);
  assert.match(src, /ORDER BY m\.created_at DESC, m\.id DESC/, "the newest saved messages must remain reachable");
  assert.match(src, /allow", "GET, POST"/);
  assert.match(src, /client_id = \$2/);
});

test("the portal chat widget reloads the thread after send", () => {
  const js = readFileSync(path.join(ROOT, "public/app/chat-widget.js"), "utf8");
  assert.match(js, /loadPortalThread/);
  assert.match(js, /\/api\/chat\/portal-message/);
});
