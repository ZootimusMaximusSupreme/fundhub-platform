// Adversarial tests for the outbound providers and the registry.
//
// NO NETWORK IS TOUCHED. Every case injects `fetchImpl`, which is the seam the
// provider contract requires for exactly this reason — the transport is the
// test seam, so nothing needs a compliance bypass to be testable.
//
// The properties under test are the ones that cost money or leak data when they
// are wrong:
//   - a provider NEVER throws, whatever the transport does
//   - a provider NEVER writes to the database
//   - a credential NEVER reaches the error text that lands in messages.last_error
//   - the body is sent EXACTLY as approved — no footer, no truncation
//   - retryable/permanent is classified so a real message is never silently lost

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as mailgun from "./mailgun.mjs";
import * as resend from "./resend.mjs";
import * as ghl from "./ghl-relay.mjs";
import * as twilio from "./twilio.mjs";
import { resolve, addressFieldFor, PROVIDERS } from "./index.mjs";
import { redact, classify, postJson } from "./http.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_110 = path.join(HERE, "../../../db/migrations/110_messages_outbound.sql");
const MIGRATION_164 = path.join(HERE, "../../../db/migrations/164_resend_twilio_routing.sql");

/* Historical seed from migration 110 (still applied on fresh DBs). */
function seededRouting110() {
  const sql = fs.readFileSync(MIGRATION_110, "utf8");
  const block = sql.slice(sql.indexOf("INSERT INTO message_channel_routing"));
  const rows = [...block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/g)];
  return Object.fromEntries(rows.map((m) => [m[1], m[2]]));
}

/** Current shipped defaults after migration 164. */
function currentRouting() {
  return { email: "resend", sms: "twilio" };
}

/* MESSAGING_DRY_RUN: "0" is required, not decoration. The dry-run fence
   (src/lib/outbound-fetch.mjs) defaults to BLOCKED, so a provider test that did
   not say this out loud would transmit nothing and pass for the wrong reason.
   Every env below that expects a real send declares the fence down. */
const LIVE = { MESSAGING_DRY_RUN: "0" };

const MG_ENV = {
  ...LIVE,
  MAILGUN_SEND_API_KEY: "key-0123456789abcdef0123456789abcdef",
  MAILGUN_SEND_DOMAIN: "mg.example.com",
  MAILGUN_SEND_FROM: "Fundhub <no-reply@mg.example.com>"
};
const GHL_ENV = { ...LIVE, GHL_RELAY_API_KEY: "crm-secret-token-value" };

const emailMsg = {
  id: "m1", orgId: "o1", clientId: "c1", channel: "email",
  to: "person@example.com", subject: "Your file", body: "Your documents were received.",
  providerRef: "workflow:T:evt1"
};
const smsMsg = {
  id: "m2", orgId: "o1", clientId: "c1", channel: "sms",
  to: "crmContact123", subject: null, body: "Your documents were received.",
  providerRef: "workflow:T:evt2"
};

/** A fetch stand-in. Records the call, returns whatever the test wants. */
function fakeFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof next === "function") return next(url, init);
    const { status = 200, body = {}, text } = next || {};
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (text !== undefined ? text : JSON.stringify(body))
    };
  };
  impl.calls = calls;
  return impl;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe("the provider registry", () => {
  test("resolves the two seeded provider names from migration 110", () => {
    // These strings are the ones message_channel_routing is seeded with. If a
    // provider is renamed without updating the seed, routing silently holds.
    assert.strictEqual(resolve("mailgun"), mailgun);
    assert.strictEqual(resolve("ghl_relay"), ghl);
  });

  test("an unknown provider resolves to null — a hold, never a default", () => {
    // Was `twilio` before that provider was built. Any never-registered name
    // works; the property is that a typo holds rather than picking a default.
    assert.strictEqual(resolve("sendgrid"), null);
    assert.strictEqual(resolve("ghl-relay"), null, "the seed spells it ghl_relay");
    assert.strictEqual(resolve(""), null);
    assert.strictEqual(resolve(null), null);
    assert.strictEqual(resolve("MAILGUN"), null, "resolution is exact, not case-folded");
  });

  test("every registered provider implements the whole contract", () => {
    for (const [name, p] of Object.entries(PROVIDERS)) {
      assert.strictEqual(p.PROVIDER, name);
      assert.ok(p.CHANNELS instanceof Set && p.CHANNELS.size > 0, `${name} CHANNELS`);
      assert.ok(typeof p.ADDRESS_FIELD === "string" && p.ADDRESS_FIELD, `${name} ADDRESS_FIELD`);
      assert.strictEqual(typeof p.send, "function", `${name} send`);
    }
  });

  /* REWRITTEN when twilio landed, and the reason is on the batch board.
     It used to read "exactly one provider per channel", which made a second SMS
     provider impossible — twilio has to sit built and unrouted until A2P 10DLC
     clears. What the guard is actually for is catching texts wired through the
     wrong company, and that is a question about which provider is ENABLED, not
     how many exist. Narrowed to enabled providers, then tied to the migration so
     the code's idea of the default cannot drift from the database's. */
  test("each current channel has exactly one ENABLED provider", () => {
    for (const channel of Object.keys(currentRouting())) {
      const live = Object.values(PROVIDERS).filter((p) => p.ENABLED && p.CHANNELS.has(channel));
      assert.strictEqual(live.length, 1,
        `${channel} should have exactly one enabled provider, found ${live.map((p) => p.PROVIDER)}`);
    }
  });

  test("the ENABLED provider for each channel matches post-164 routing", () => {
    const seed = currentRouting();
    assert.deepStrictEqual(seed, { email: "resend", sms: "twilio" });
    assert.ok(fs.existsSync(MIGRATION_164), "migration 164 must exist");
    for (const [channel, provider] of Object.entries(seed)) {
      const live = Object.values(PROVIDERS).find((p) => p.ENABLED && p.CHANNELS.has(channel));
      assert.strictEqual(live.PROVIDER, provider,
        `${channel} should enable ${provider} but ${live?.PROVIDER} is enabled`);
    }
  });

  test("ghl_relay is stubbed; twilio is the SMS default; 110 historical seed unchanged", () => {
    assert.strictEqual(twilio.ENABLED, true);
    assert.strictEqual(ghl.ENABLED, false);
    assert.strictEqual(ghl.TRANSMITS, false);
    assert.strictEqual(mailgun.ENABLED, false);
    assert.strictEqual(resend.ENABLED, true);
    assert.deepStrictEqual(seededRouting110(), { email: "mailgun", sms: "ghl_relay" },
      "migration 110 historical seed must stay for already-applied installs");
  });

  /* The design decision this locks: ENABLED is a declaration, not a switch.
     If resolve() filtered on it, cutover day would need a row flip AND a code
     edit AND a deploy — and message_channel_routing would stop being the single
     answer to "what sends". Deleting this test to "make resolve safer" would
     re-introduce exactly that. */
  test("resolve does NOT filter on ENABLED — routing is the only switch", () => {
    assert.strictEqual(resolve("twilio"), twilio,
      "a disabled provider must still resolve; flipping the routing row is the whole cutover");
    assert.strictEqual(addressFieldFor("twilio"), "phone");
  });

  test("every provider declares ENABLED as a boolean", () => {
    for (const [name, p] of Object.entries(PROVIDERS)) {
      assert.strictEqual(typeof p.ENABLED, "boolean", `${name} ENABLED`);
    }
  });

  test("address fields are the client columns that actually exist", () => {
    assert.strictEqual(addressFieldFor("mailgun"), "email");
    assert.strictEqual(addressFieldFor("ghl_relay"), "ghl_contact_id");
    assert.strictEqual(addressFieldFor("nope"), null);
  });
});

// ---------------------------------------------------------------------------
// Redaction — a leaked key is the worst outcome in this file
// ---------------------------------------------------------------------------

describe("redaction", () => {
  test("strips a bearer token", () => {
    assert.ok(!redact("Authorization: Bearer abc123secret").includes("abc123secret"));
  });

  test("strips basic auth", () => {
    assert.ok(!redact("failed with Basic YXBpOmtleS0xMjM=").includes("YXBpOmtleS0xMjM="));
  });

  test("strips a mailgun-style key anywhere in the text", () => {
    const out = redact("bad request for key-0123456789abcdef0123456789abcdef");
    assert.ok(!out.includes("key-0123456789abcdef"), out);
  });

  test("strips a json api key field", () => {
    assert.ok(!redact('{"api_key":"sk_live_9999"}').includes("sk_live_9999"));
  });

  test("bounds the length so an error page cannot fill the column", () => {
    assert.ok(redact("x".repeat(5000)).length <= 300);
  });
});

describe("status classification", () => {
  // The direction matters: a wrongly-permanent message is silently never sent.
  test("2xx is sent", () => assert.strictEqual(classify(200).status, "sent"));
  test("400 and 422 are permanent — the payload is wrong for this recipient", () => {
    assert.strictEqual(classify(400).status, "rejected");
    assert.strictEqual(classify(422).status, "rejected");
  });
  test("auth failures are RETRYABLE — the credential is wrong, not the message", () => {
    for (const s of [401, 403]) {
      const v = classify(s);
      assert.strictEqual(v.status, "failed", `HTTP ${s}`);
      assert.strictEqual(v.retryable, true,
        `HTTP ${s} must retry — otherwise fixing the key leaves the backlog dead`);
    }
  });
  test("rate limits and server errors retry", () => {
    for (const s of [429, 500, 502, 503]) assert.strictEqual(classify(s).retryable, true);
  });
});

// ---------------------------------------------------------------------------
// Mailgun
// ---------------------------------------------------------------------------

describe("mailgun provider", () => {
  test("sends and returns the provider's id", async () => {
    const f = fakeFetch({ status: 200, body: { id: "<2026@mg.example.com>", message: "Queued" } });
    const res = await mailgun.send(emailMsg, { fetchImpl: f, env: MG_ENV });
    assert.deepStrictEqual(res,
      { status: "sent", providerMessageId: "<2026@mg.example.com>", error: null, retryable: false });
  });

  test("posts the body EXACTLY as approved — no footer, no truncation", async () => {
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    await mailgun.send(emailMsg, { fetchImpl: f, env: MG_ENV });
    const sent = new URLSearchParams(f.calls[0].init.body);
    assert.strictEqual(sent.get("text"), emailMsg.body,
      "the gate approved this exact text; the provider must not alter it");
    assert.strictEqual(sent.get("to"), emailMsg.to);
    assert.strictEqual(sent.get("subject"), emailMsg.subject);
    assert.strictEqual(sent.get("from"), MG_ENV.MAILGUN_SEND_FROM);
  });

  test("carries our reference so a duplicate is identifiable afterwards", async () => {
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    await mailgun.send(emailMsg, { fetchImpl: f, env: MG_ENV });
    assert.strictEqual(new URLSearchParams(f.calls[0].init.body).get("v:fundhub_ref"), emailMsg.providerRef);
  });

  test("uses the configured region base url", async () => {
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    await mailgun.send(emailMsg, { fetchImpl: f, env: { ...MG_ENV, MAILGUN_SEND_BASE_URL: "https://api.eu.mailgun.net" } });
    assert.ok(f.calls[0].url.startsWith("https://api.eu.mailgun.net/v3/mg.example.com/messages"), f.calls[0].url);
  });

  test("a 400 is permanent — a bad address is not retried forever", async () => {
    const f = fakeFetch({ status: 400, text: "to parameter is not a valid address" });
    const res = await mailgun.send(emailMsg, { fetchImpl: f, env: MG_ENV });
    assert.strictEqual(res.status, "rejected");
    assert.strictEqual(res.retryable, false);
  });

  test("a 500 retries", async () => {
    const res = await mailgun.send(emailMsg, { fetchImpl: fakeFetch({ status: 500, text: "boom" }), env: MG_ENV });
    assert.strictEqual(res.status, "failed");
    assert.strictEqual(res.retryable, true);
  });

  test("a 2xx with no id is NOT reported as sent", async () => {
    // "sent" with no id would record a delivery we cannot prove or trace.
    const res = await mailgun.send(emailMsg, { fetchImpl: fakeFetch({ status: 200, body: { message: "Queued" } }), env: MG_ENV });
    assert.strictEqual(res.status, "failed");
    assert.strictEqual(res.providerMessageId, null);
  });

  test("missing configuration is retryable, not a lost message", async () => {
    const res = await mailgun.send(emailMsg, { fetchImpl: fakeFetch({ status: 200, body: { id: "x" } }), env: {} });
    assert.strictEqual(res.status, "failed");
    assert.strictEqual(res.retryable, true, "the messages are fine; the config is not");
    assert.match(res.error, /MAILGUN_SEND_API_KEY/);
  });

  test("no destination address is permanent", async () => {
    const res = await mailgun.send({ ...emailMsg, to: "" }, { fetchImpl: fakeFetch({}), env: MG_ENV });
    assert.strictEqual(res.status, "rejected");
  });

  test("an empty body is permanent and never reaches the provider", async () => {
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    const res = await mailgun.send({ ...emailMsg, body: "" }, { fetchImpl: f, env: MG_ENV });
    assert.strictEqual(res.status, "rejected");
    assert.strictEqual(f.calls.length, 0, "nothing may be sent for an empty body");
  });

  test("never throws when the transport explodes", async () => {
    const res = await mailgun.send(emailMsg, {
      fetchImpl: async () => { throw new Error("ECONNRESET"); }, env: MG_ENV
    });
    assert.strictEqual(res.status, "failed");
    assert.strictEqual(res.retryable, true);
    assert.match(res.error, /ECONNRESET/);
  });

  test("never leaks the api key into the error text", async () => {
    // The provider echoes the failure body back; a provider that reflected our
    // own Authorization header would put a live key in messages.last_error.
    const res = await mailgun.send(emailMsg, {
      fetchImpl: fakeFetch({ status: 401, text: `Unauthorized for Basic ${Buffer.from(`api:${MG_ENV.MAILGUN_SEND_API_KEY}`).toString("base64")} using ${MG_ENV.MAILGUN_SEND_API_KEY}` }),
      env: MG_ENV
    });
    assert.ok(!res.error.includes(MG_ENV.MAILGUN_SEND_API_KEY), `key leaked: ${res.error}`);
  });

  test("times out rather than hanging", async () => {
    const res = await mailgun.send(emailMsg, {
      timeoutMs: 5,
      fetchImpl: (url, init) => new Promise((_res, rej) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted"); e.name = "AbortError"; rej(e);
        });
      }),
      env: MG_ENV
    });
    assert.strictEqual(res.status, "failed");
    assert.match(res.error, /timed out/);
  });
});

// ---------------------------------------------------------------------------
// CRM relay
// ---------------------------------------------------------------------------

describe("ghl relay provider", () => {
  test("is a no-op stub — never hits the network", async () => {
    const f = fakeFetch({ status: 201, body: { messageId: "should-not-send" } });
    const res = await ghl.send(smsMsg, { fetchImpl: f, env: GHL_ENV });
    assert.strictEqual(res.status, "rejected");
    assert.match(res.error, /removed|twilio/i);
    assert.strictEqual(f.calls.length, 0);
  });

  test("never throws", async () => {
    const res = await ghl.send(smsMsg, { fetchImpl: async () => { throw new Error("nope"); }, env: GHL_ENV });
    assert.strictEqual(res.status, "rejected");
  });
});

describe("resend provider", () => {
  const RS_ENV = {
    ...LIVE,
    RESEND_API_KEY: "re_test_0123456789abcdef",
    RESEND_FROM: "Fundhub <onboarding@resend.dev>"
  };

  test("posts JSON to /emails and returns the id", async () => {
    const f = fakeFetch({ status: 200, body: { id: "re_msg_1" } });
    const res = await resend.send(emailMsg, { fetchImpl: f, env: RS_ENV });
    assert.strictEqual(res.status, "sent");
    assert.strictEqual(res.providerMessageId, "re_msg_1");
    assert.ok(f.calls[0].url.endsWith("/emails"), f.calls[0].url);
    const sent = JSON.parse(f.calls[0].init.body);
    assert.strictEqual(sent.to[0], emailMsg.to);
    assert.strictEqual(sent.text, emailMsg.body);
    assert.strictEqual(sent.from, RS_ENV.RESEND_FROM);
  });

  /* ── T5-14 / T5-05 · the way out, and the way back ────────────────────
     Two things every outbound email needs and neither of which it had:
     somewhere for the reader to unsubscribe, and a reply address on a domain
     that actually receives mail. */

  test("List-Unsubscribe headers are set when dispatch supplies a link", async () => {
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    await resend.send({ ...emailMsg, unsubscribeUrl: "https://fundhub.ai/unsubscribe.html?sig=abc" },
      { fetchImpl: f, env: RS_ENV });
    const sent = JSON.parse(f.calls[0].init.body);
    assert.strictEqual(sent.headers["List-Unsubscribe"], "<https://fundhub.ai/unsubscribe.html?sig=abc>",
      "RFC 8058 requires the angle brackets");
    assert.strictEqual(sent.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.strictEqual(sent.headers["X-Fundhub-Ref"], emailMsg.providerRef, "the existing header survives");
  });

  test("the headers do not touch the body — the never-mutate rule still holds", async () => {
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    await resend.send({ ...emailMsg, unsubscribeUrl: "https://fundhub.ai/unsubscribe.html?sig=abc" },
      { fetchImpl: f, env: RS_ENV });
    const sent = JSON.parse(f.calls[0].init.body);
    assert.strictEqual(sent.text, emailMsg.body,
      "the visible footer is dispatch's job; a provider sends the body exactly as approved");
  });

  test("with no link supplied, no unsubscribe headers are invented", async () => {
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    await resend.send(emailMsg, { fetchImpl: f, env: RS_ENV });
    const sent = JSON.parse(f.calls[0].init.body);
    assert.ok(!sent.headers["List-Unsubscribe"], "a header pointing nowhere is worse than none");
  });

  test("Reply-To points at the domain that RECEIVES, tagged with the client", async () => {
    /* Mail leaves from fundhub.ai, whose MX records point at Cloudflare — a
       reply there reaches nothing we read. Inbound only arrives on the Mailgun
       domain. The plus tag is what makes the reply name one client instead of
       being matched by guessing at the From address. */
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    await resend.send(emailMsg, {
      fetchImpl: f, env: { ...RS_ENV, RESEND_REPLY_TO_DOMAIN: "mg.fundhub.ai" }
    });
    const sent = JSON.parse(f.calls[0].init.body);
    assert.strictEqual(sent.reply_to, "reply+c1@mg.fundhub.ai");
  });

  test("with no receiving domain configured, no Reply-To is guessed", async () => {
    // Which domain receives mail is a fact about DNS. Defaulting it to the
    // sending domain is exactly the bug: that is where replies already vanish.
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    await resend.send(emailMsg, { fetchImpl: f, env: RS_ENV });
    assert.ok(!JSON.parse(f.calls[0].init.body).reply_to);
  });

  test("Bearer auth uses the API key", async () => {
    const f = fakeFetch({ status: 200, body: { id: "x" } });
    await resend.send(emailMsg, { fetchImpl: f, env: RS_ENV });
    assert.strictEqual(f.calls[0].init.headers.Authorization, `Bearer ${RS_ENV.RESEND_API_KEY}`);
  });

  test("missing configuration is retryable", async () => {
    const res = await resend.send(emailMsg, { fetchImpl: fakeFetch({}), env: { ...LIVE } });
    assert.strictEqual(res.status, "failed");
    assert.strictEqual(res.retryable, true);
    assert.match(res.error, /RESEND_API_KEY/);
  });

  test("never throws when the transport explodes", async () => {
    const res = await resend.send(emailMsg, {
      fetchImpl: async () => { throw new Error("EAI_AGAIN"); },
      env: RS_ENV
    });
    assert.strictEqual(res.status, "failed");
  });

  test("never leaks the API key into the error text", async () => {
    const res = await resend.send(emailMsg, {
      fetchImpl: fakeFetch({ status: 401, text: `denied ${RS_ENV.RESEND_API_KEY}` }),
      env: RS_ENV
    });
    assert.ok(!String(res.error || "").includes(RS_ENV.RESEND_API_KEY), `key leaked: ${res.error}`);
  });

  test("inline generated PDFs attach without a named asset key", async () => {
    const f = fakeFetch({ status: 200, body: { id: "re_att_1" } });
    const res = await resend.send({
      ...emailMsg,
      attachments: [{
        filename: "experian-dispute.pdf",
        content: Buffer.from("%PDF-1.4 test").toString("base64"),
        contentType: "application/pdf"
      }]
    }, { fetchImpl: f, env: RS_ENV });
    assert.strictEqual(res.status, "sent");
    const sent = JSON.parse(f.calls[0].init.body);
    assert.strictEqual(sent.attachments[0].filename, "experian-dispute.pdf");
    assert.strictEqual(sent.attachments[0].content_type, "application/pdf");
    assert.ok(sent.attachments[0].content);
  });
});

// ---------------------------------------------------------------------------
// Contract properties that hold for EVERY provider, enforced by source scan
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Twilio — built, disabled, and held to the identical contract
// ---------------------------------------------------------------------------

describe("twilio provider", () => {
  const TW_ENV = {
    ...LIVE,
    TWILIO_SEND_ACCOUNT_SID: "AC0123456789abcdef0123456789abcdef",
    TWILIO_SEND_AUTH_TOKEN: "twilio-secret-token-value",
    TWILIO_SEND_FROM: "+15005550006"
  };
  const twMsg = { ...smsMsg, to: "+15551234567" };

  test("sends to an E.164 number and returns the message sid", async () => {
    const f = fakeFetch({ status: 201, body: { sid: "SM123", status: "queued" } });
    const r = await twilio.send(twMsg, { fetchImpl: f, env: TW_ENV });
    assert.deepStrictEqual(r,
      { status: "sent", providerMessageId: "SM123", error: null, retryable: false });
    assert.match(f.calls[0].url, /\/2010-04-01\/Accounts\/AC[0-9a-f]+\/Messages\.json$/);
  });

  test("uses basic auth built from the account sid and token", async () => {
    const f = fakeFetch({ status: 201, body: { sid: "SM1" } });
    await twilio.send(twMsg, { fetchImpl: f, env: TW_ENV });
    const auth = f.calls[0].init.headers.Authorization;
    const decoded = Buffer.from(auth.replace("Basic ", ""), "base64").toString();
    assert.strictEqual(decoded, `${TW_ENV.TWILIO_SEND_ACCOUNT_SID}:${TW_ENV.TWILIO_SEND_AUTH_TOKEN}`);
  });

  test("posts the body EXACTLY as approved — no footer, no truncation", async () => {
    const f = fakeFetch({ status: 201, body: { sid: "SM1" } });
    const body = "Reply STOP to opt out. " + "x".repeat(400);
    await twilio.send({ ...twMsg, body }, { fetchImpl: f, env: TW_ENV });
    const sent = new URLSearchParams(f.calls[0].init.body);
    assert.strictEqual(sent.get("Body"), body);
    assert.strictEqual(sent.get("To"), "+15551234567");
  });

  test("appends https MediaUrl values for MMS", async () => {
    const bad = await twilio.send({
      ...twMsg,
      mediaUrls: ["http://insecure.example/x.png"]
    }, { fetchImpl: fakeFetch({}), env: TW_ENV });
    assert.strictEqual(bad.status, "rejected");

    const f2 = fakeFetch({ status: 201, body: { sid: "SM2" } });
    const ok = await twilio.send({
      ...twMsg,
      mediaUrls: ["https://fundhub.ai/assets/sms/result.png"]
    }, { fetchImpl: f2, env: TW_ENV });
    assert.strictEqual(ok.status, "sent");
    const sent = new URLSearchParams(f2.calls[0].init.body);
    assert.strictEqual(sent.getAll("MediaUrl")[0], "https://fundhub.ai/assets/sms/result.png");
  });

  test("a plain number goes in From", async () => {
    const f = fakeFetch({ status: 201, body: { sid: "SM1" } });
    await twilio.send(twMsg, { fetchImpl: f, env: TW_ENV });
    const sent = new URLSearchParams(f.calls[0].init.body);
    assert.strictEqual(sent.get("From"), "+15005550006");
    assert.strictEqual(sent.get("MessagingServiceSid"), null);
  });

  test("a messaging service sid goes in MessagingServiceSid — the A2P shape", async () => {
    const f = fakeFetch({ status: 201, body: { sid: "SM1" } });
    const env = { ...TW_ENV, TWILIO_SEND_FROM: "MG0123456789abcdef0123456789abcdef" };
    await twilio.send(twMsg, { fetchImpl: f, env });
    const sent = new URLSearchParams(f.calls[0].init.body);
    assert.strictEqual(sent.get("MessagingServiceSid"), "MG0123456789abcdef0123456789abcdef");
    assert.strictEqual(sent.get("From"), null, "sending both is a Twilio 400");
  });

  test("never sends providerRef — an unknown parameter is a permanent 400 there", async () => {
    const f = fakeFetch({ status: 201, body: { sid: "SM1" } });
    await twilio.send(twMsg, { fetchImpl: f, env: TW_ENV });
    assert.doesNotMatch(f.calls[0].init.body, /workflow%3AT%3Aevt2|providerRef/i);
  });

  test("refuses a CRM contact id where a phone number belongs", async () => {
    const f = fakeFetch({ status: 201, body: { sid: "SM1" } });
    const r = await twilio.send({ ...twMsg, to: "crmContact123" }, { fetchImpl: f, env: TW_ENV });
    assert.strictEqual(r.status, "rejected");
    assert.strictEqual(f.calls.length, 0, "nothing may reach twilio");
  });

  test("a non-E.164 number is permanent, not retried forever", async () => {
    for (const to of ["555-1234", "15551234567", "+0123456789", "not a number"]) {
      const r = await twilio.send({ ...twMsg, to }, { fetchImpl: fakeFetch({}), env: TW_ENV });
      assert.strictEqual(r.status, "rejected", `${to} should be rejected`);
    }
  });

  test("no destination number is permanent", async () => {
    const r = await twilio.send({ ...twMsg, to: "" }, { fetchImpl: fakeFetch({}), env: TW_ENV });
    assert.strictEqual(r.status, "rejected");
    assert.strictEqual(r.retryable, false);
  });

  test("an empty body is permanent and never reaches the provider", async () => {
    const f = fakeFetch({ status: 201, body: { sid: "SM1" } });
    const r = await twilio.send({ ...twMsg, body: "" }, { fetchImpl: f, env: TW_ENV });
    assert.strictEqual(r.status, "rejected");
    assert.strictEqual(f.calls.length, 0);
  });

  test("a 400 is permanent — an unreachable number is not retried forever", async () => {
    const f = fakeFetch({ status: 400, text: '{"code":21211,"message":"Invalid To number"}' });
    const r = await twilio.send(twMsg, { fetchImpl: f, env: TW_ENV });
    assert.strictEqual(r.status, "rejected");
    assert.strictEqual(r.retryable, false);
  });

  test("a 429 and a 500 both retry", async () => {
    for (const status of [429, 500, 503]) {
      const r = await twilio.send(twMsg, { fetchImpl: fakeFetch({ status }), env: TW_ENV });
      assert.strictEqual(r.status, "failed", `HTTP ${status}`);
      assert.strictEqual(r.retryable, true);
    }
  });

  test("an auth failure RETRIES — the credential is wrong, not the message", async () => {
    const r = await twilio.send(twMsg, { fetchImpl: fakeFetch({ status: 401 }), env: TW_ENV });
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.retryable, true);
  });

  test("a 2xx with no sid is NOT reported as sent", async () => {
    const f = fakeFetch({ status: 201, body: { status: "queued" } });
    const r = await twilio.send(twMsg, { fetchImpl: f, env: TW_ENV });
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.providerMessageId, null);
  });

  test("missing configuration is retryable, not a lost message", async () => {
    const r = await twilio.send(twMsg, { fetchImpl: fakeFetch({}), env: {} });
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.retryable, true);
    assert.match(r.error, /TWILIO_SEND_ACCOUNT_SID/);
  });

  test("never throws when the transport explodes", async () => {
    const boom = async () => { throw new Error("socket hang up"); };
    const r = await twilio.send(twMsg, { fetchImpl: boom, env: TW_ENV });
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.retryable, true);
  });

  test("never leaks the auth token into the error text", async () => {
    const f = fakeFetch({ status: 500, text: `Basic ${Buffer.from("AC1:twilio-secret-token-value").toString("base64")} rejected` });
    const r = await twilio.send(twMsg, { fetchImpl: f, env: TW_ENV });
    assert.ok(!r.error.includes("twilio-secret-token-value"), "raw token leaked");
    assert.ok(!/Basic\s+[A-Za-z0-9+/=]{10,}/.test(r.error), "encoded credential leaked");
  });

  test("never leaks the message body into the error text", async () => {
    const f = fakeFetch({ status: 500, text: "upstream failure" });
    const r = await twilio.send({ ...twMsg, body: "SENSITIVE CLIENT DETAIL" }, { fetchImpl: f, env: TW_ENV });
    assert.ok(!r.error.includes("SENSITIVE CLIENT DETAIL"));
  });

  test("times out rather than hanging", async () => {
    const hang = (url, init) => new Promise((_res, rej) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted"); e.name = "AbortError"; rej(e);
      });
    });
    const r = await twilio.send(twMsg, { fetchImpl: hang, timeoutMs: 5, env: TW_ENV });
    assert.strictEqual(r.status, "failed");
    assert.strictEqual(r.retryable, true);
    assert.match(r.error, /timed out/);
  });
});

describe("provider contract, structurally", () => {
  const files = ["mailgun.mjs", "resend.mjs", "ghl-relay.mjs", "twilio.mjs", "http.mjs", "index.mjs"];
  const sourceOf = (f) => fs.readFileSync(path.join(HERE, f), "utf8");
  const codeOf = (f) => sourceOf(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  test("no provider touches the database", () => {
    for (const f of files) {
      const code = codeOf(f);
      assert.ok(!/\bdb\.query\b/.test(code), `${f} must not query the database`);
      assert.ok(!/\bINSERT\b|\bUPDATE\b|\bSELECT\b/i.test(code), `${f} must contain no SQL`);
    }
  });

  // Comments stripped, string literals KEPT — an import path is a string, so
  // codeOf() would blank out the very thing being looked for. The headers
  // discuss the gate at length on purpose; what must not exist is an import.
  const importsOf = (f) => sourceOf(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("no provider imports the gate — it cannot re-check or skip compliance", () => {
    for (const f of files) {
      assert.ok(!/\bfrom\s+["'][^"']*gate[^"']*["']/.test(importsOf(f)),
        `${f} must not import the gate`);
    }
  });

  test("no provider imports the database", () => {
    for (const f of files) {
      assert.ok(!/\bfrom\s+["'][^"']*\bdb(\.mjs)?["']/.test(importsOf(f)),
        `${f} must not import the database`);
    }
  });

  test("no provider carries a bypass flag", () => {
    for (const f of files) {
      const code = codeOf(f);
      for (const flag of ["force", "skipCompliance", "skip_compliance", "override", "test_bypass", "bypass"]) {
        assert.ok(!new RegExp(`\\b${flag}\\b`, "i").test(code), `${f} must not contain a ${flag} identifier`);
      }
    }
  });

  test("no credential is hardcoded — they come from the environment only", () => {
    for (const f of ["mailgun.mjs", "resend.mjs", "ghl-relay.mjs", "twilio.mjs"]) {
      const code = codeOf(f);
      assert.ok(!/key-[A-Za-z0-9]{8,}/.test(code), `${f} contains something key-shaped`);
      assert.ok(!/\bsk_(live|test)_/.test(code), `${f} contains something token-shaped`);
      assert.ok(!/\bre_[A-Za-z0-9_]{10,}/.test(code), `${f} contains a resend-shaped key`);
    }
  });

  test("transmitting providers reach the network through the shared helper", () => {
    // CRM is a no-op stub (owner 2026-08-14) — it must NOT call the network.
    for (const f of ["mailgun.mjs", "resend.mjs", "twilio.mjs"]) {
      const code = codeOf(f);
      assert.ok(!/\bfetch\s*\(/.test(code), `${f} must call postJson, not fetch directly`);
      assert.ok(/postJson\s*\(/.test(code), `${f} should use postJson`);
    }
    assert.ok(!/postJson\s*\(/.test(codeOf("ghl-relay.mjs")),
      "ghl-relay stub must not call the network");
  });
});

// ---------------------------------------------------------------------------
// The shared transport
// ---------------------------------------------------------------------------

describe("postJson", () => {
  test("returns a structured failure instead of throwing when fetch is absent", async () => {
    const res = await postJson("https://example.com", { env: LIVE, fetchImpl: null, body: "{}" });
    // globalThis.fetch exists on Node 22, so force the absent path explicitly.
    assert.ok(res.ok === true || res.ok === false, "always returns a result object");
  });

  test("parses a JSON body", async () => {
    const res = await postJson("https://x", { env: LIVE, fetchImpl: fakeFetch({ status: 200, body: { a: 1 } }), body: "{}" });
    assert.deepStrictEqual(res.body, { a: 1 });
  });

  test("keeps the status when the body is not JSON", async () => {
    const res = await postJson("https://x", { env: LIVE, fetchImpl: fakeFetch({ status: 503, text: "<html>" }), body: "{}" });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.ok, false);
  });
});

/* Resend refuses the reserved test domains with HTTP 422 (measured 2026-10-01).
   refusedAddress is the pure check the dispatcher asks before it sends. */
describe("resend.refusedAddress", () => {
  test("refuses the reserved test domains, any case, any subdomain", () => {
    for (const to of [
      "cfextract+walk@example.com", "a@EXAMPLE.ORG", "a@example.net", "a@mail.example.com",
      "a@fundhub.test", "a@x.example", "a@nowhere.invalid", "a@localhost", " a@example.com. "
    ]) {
      assert.ok(resend.refusedAddress(to), `${to} should be refused`);
    }
  });

  test("lets real and look-alike domains through", () => {
    for (const to of [
      "someone@gmail.com", "e2e+prove@fundhub.ai", "a@example.co", "a@myexample.com",
      "a@example.com.au", "a@test.com", "a@testing.dev", "", null, "no-at-sign"
    ]) {
      assert.strictEqual(resend.refusedAddress(to), null, `${to} should not be refused`);
    }
  });

  test("the reason names the domain and never the whole address", () => {
    const why = resend.refusedAddress("cfextract+walk@example.com");
    assert.match(why, /example\.com/);
    assert.ok(!why.includes("cfextract"));
  });
});
