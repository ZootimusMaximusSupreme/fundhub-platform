// src/messaging/providers/meta-capi.test.mjs — the one Meta server sender.
//
// Fakes only: a stand-in fetch and a made-up token. Nothing here reaches Meta.
//
// What this proves: the kill switch (exactly "1"); the request (URL, body
// shape, test_event_code passthrough, batches of 1000); the fence (ADAPTERS
// holds it when the flag is not an off value); no token → skipped with the
// reason; Meta's own error text comes back; a hung call stops at ~3 s; it never
// throws; and nothing raw about a person leaves (em / ph / external_id must be
// SHA-256 hex; only listed user_data and custom_data keys survive).

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  sendMetaEvents, metaCapiEnabled, metaEventsUrl, sanitizeEvent,
  MAX_BATCH, TIMEOUT_MS, DEFAULT_PIXEL_ID, TRANSMITS, DEFAULT_API_VERSION
} from "./meta-capi.mjs";
import { clearMetaTokenCache } from "../../meta/token.mjs";
import { sha256 } from "../../meta/user-data.mjs";

const FAKE_TOKEN = "fake-capi-token-for-tests-only";
const ON = { META_CAPI_ENABLED: "1", ADAPTERS_DRY_RUN: "0", META_CAPI_ACCESS_TOKEN: FAKE_TOKEN };

/** A stand-in fetch that records each call and answers like Meta. */
function fakeMeta({ status = 200, reply } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const out = reply ? reply(body) : { events_received: body.data.length, messages: [], fbtrace_id: "x" };
    return new Response(JSON.stringify(out), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const EVENT = Object.freeze({
  event_name: "Lead",
  event_time: 1727900000,
  event_id: "sess-abcdef12.4",
  event_source_url: "https://apply.fundhub.ai/roadmap",
  action_source: "website",
  user_data: {
    client_ip_address: "203.0.113.7",
    client_user_agent: "Mozilla/5.0",
    fbc: "fb.1.1727900000000.IwAR2abc",
    fbp: "fb.1.1727900000000.1116446470",
    em: [sha256("pat@gmail.com")],
    ph: [sha256("14155550134")],
    external_id: [sha256("sess-abcdef12")]
  },
  custom_data: { content_name: "roadmap_buybox" }
});

beforeEach(() => clearMetaTokenCache());

describe("the kill switch", () => {
  test("off unless META_CAPI_ENABLED is exactly \"1\"", async () => {
    for (const v of [undefined, "", "0", "true", "yes", " 1", 1]) {
      const meta = fakeMeta();
      let tokenRead = false;
      const out = await sendMetaEvents([EVENT], {
        env: { ...ON, META_CAPI_ENABLED: v }, fetchImpl: meta.fetchImpl,
        scope: async () => { tokenRead = true; return []; }
      });
      assert.deepEqual(out, { ok: true, sent: 0, skipped: "disabled" }, String(v));
      assert.equal(meta.calls.length, 0);
      assert.equal(tokenRead, false);
    }
    assert.equal(metaCapiEnabled({ META_CAPI_ENABLED: "1" }), true);
    assert.equal(TRANSMITS, true);
  });
});

describe("the request", () => {
  test("POST to the pixel's events edge, data[] plus the token, nothing else", async () => {
    const meta = fakeMeta();
    const out = await sendMetaEvents([EVENT], { env: ON, fetchImpl: meta.fetchImpl });
    assert.deepEqual(out, { ok: true, sent: 1 });
    assert.equal(meta.calls.length, 1);
    const { url, init, body } = meta.calls[0];
    assert.equal(url, `https://graph.facebook.com/v26.0/${DEFAULT_PIXEL_ID}/events`);
    assert.equal(DEFAULT_PIXEL_ID, "2403674420141513");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.deepEqual(Object.keys(body).sort(), ["access_token", "data"]);
    assert.equal(body.access_token, FAKE_TOKEN);
    assert.deepEqual(body.data, [EVENT]);
  });

  test("META_API_VERSION and META_PIXEL_ID move the URL; junk values fall back", () => {
    assert.equal(metaEventsUrl({ META_API_VERSION: "v22.0", META_PIXEL_ID: "123456789" }),
      "https://graph.facebook.com/v22.0/123456789/events");
    assert.equal(metaEventsUrl({ META_API_VERSION: "../x", META_PIXEL_ID: "abc" }),
      `https://graph.facebook.com/v26.0/${DEFAULT_PIXEL_ID}/events`);
  });

  test("with META_API_VERSION unset, server events go to v26.0 (marketing machine M0 step 5)", () => {
    assert.equal(DEFAULT_API_VERSION, "v26.0");
    assert.equal(metaEventsUrl({}), `https://graph.facebook.com/v26.0/${DEFAULT_PIXEL_ID}/events`);
    assert.equal(metaEventsUrl({ META_API_VERSION: "  " }),
      `https://graph.facebook.com/v26.0/${DEFAULT_PIXEL_ID}/events`);
  });

  test("META_TEST_EVENT_CODE rides on every batch when set", async () => {
    const meta = fakeMeta();
    await sendMetaEvents([EVENT], { env: { ...ON, META_TEST_EVENT_CODE: " TEST123 " }, fetchImpl: meta.fetchImpl });
    assert.equal(meta.calls[0].body.test_event_code, "TEST123");
    const plain = fakeMeta();
    await sendMetaEvents([EVENT], { env: { ...ON, META_TEST_EVENT_CODE: "  " }, fetchImpl: plain.fetchImpl });
    assert.equal(Object.hasOwn(plain.calls[0].body, "test_event_code"), false);
  });

  test("batches of 1000; sent is what Meta says it received", async () => {
    const meta = fakeMeta({ reply: (b) => ({ events_received: b.data.length }) });
    const many = Array.from({ length: 2500 }, (_, i) => ({ ...EVENT, event_id: `sess-abcdef12.${i}` }));
    const out = await sendMetaEvents(many, { env: ON, fetchImpl: meta.fetchImpl });
    assert.equal(MAX_BATCH, 1000);
    assert.deepEqual(meta.calls.map((c) => c.body.data.length), [1000, 1000, 500]);
    assert.deepEqual(out, { ok: true, sent: 2500 });
  });

  test("an event with no time gets now, in seconds", async () => {
    const meta = fakeMeta();
    const { event_time: _drop, ...noTime } = EVENT;
    await sendMetaEvents([noTime], { env: ON, fetchImpl: meta.fetchImpl, now: 1_727_900_123_456 });
    assert.equal(meta.calls[0].body.data[0].event_time, 1_727_900_123);
  });
});

describe("never raw PII, only listed keys", () => {
  test("a raw email or phone in em / ph / external_id is dropped, not sent", async () => {
    const meta = fakeMeta();
    await sendMetaEvents([{
      ...EVENT,
      user_data: { ...EVENT.user_data, em: ["pat@gmail.com", sha256("pat@gmail.com")], ph: "4155550134", external_id: ["sess-abcdef12"] }
    }], { env: ON, fetchImpl: meta.fetchImpl });
    const sent = meta.calls[0].body.data[0].user_data;
    assert.deepEqual(sent.em, [sha256("pat@gmail.com")]);
    assert.equal(Object.hasOwn(sent, "ph"), false);
    assert.equal(Object.hasOwn(sent, "external_id"), false);
    const wire = meta.calls[0].init.body;
    for (const raw of ["pat@gmail.com", "4155550134", "sess-abcdef12\""]) assert.ok(!wire.includes(raw), raw);
  });

  test("unknown user_data, custom_data and top-level keys never leave", () => {
    const out = sanitizeEvent({
      ...EVENT,
      email: "pat@gmail.com",
      ssn: "123-45-6789",
      user_data: { ...EVENT.user_data, email: "pat@gmail.com", phone: "4155550134", dob: "1990-01-15", fn: "pat" },
      custom_data: { value: 297, currency: "USD", content_name: "x", ssn: "123-45-6789", income: "$90k", answer: "yes", card_number: "4242" }
    });
    assert.deepEqual(Object.keys(out).sort(),
      ["action_source", "custom_data", "event_id", "event_name", "event_source_url", "event_time", "user_data"]);
    assert.deepEqual(Object.keys(out.user_data).sort(),
      ["client_ip_address", "client_user_agent", "em", "external_id", "fbc", "fbp", "ph"]);
    assert.deepEqual(out.custom_data, { value: 297, currency: "USD", content_name: "x" });
    assert.equal(out.action_source, "website");
  });

  test("action_source: website by default, system_generated kept for a server-only event", async () => {
    assert.equal(sanitizeEvent({ ...EVENT, action_source: undefined }).action_source, "website");
    assert.equal(sanitizeEvent({ ...EVENT, action_source: "physical_store" }).action_source, "website");
    const meta = fakeMeta();
    const out = await sendMetaEvents([{
      event_name: "Purchase",
      event_time: 1727900000,
      event_id: "purchase.slo_ab12",
      action_source: "system_generated",
      user_data: { em: [sha256("pat@gmail.com")], ph: [sha256("14155550134")] },
      custom_data: { value: 297, currency: "USD" }
    }], { env: ON, fetchImpl: meta.fetchImpl });
    assert.deepEqual(out, { ok: true, sent: 1 });
    assert.deepEqual(meta.calls[0].body.data, [{
      event_name: "Purchase",
      event_time: 1727900000,
      event_id: "purchase.slo_ab12",
      action_source: "system_generated",
      user_data: { em: [sha256("pat@gmail.com")], ph: [sha256("14155550134")] },
      custom_data: { value: 297, currency: "USD" }
    }], "no event_source_url and no client_user_agent needed, none invented");
  });

  test("an event without a usable name or id is dropped", async () => {
    assert.equal(sanitizeEvent({ ...EVENT, event_name: "Lead; DROP" }), null);
    assert.equal(sanitizeEvent({ ...EVENT, event_id: "" }), null);
    assert.equal(sanitizeEvent(null), null);
    const meta = fakeMeta();
    const out = await sendMetaEvents([{ ...EVENT, event_id: "has space" }], { env: ON, fetchImpl: meta.fetchImpl });
    assert.deepEqual(out, { ok: true, sent: 0, skipped: "no_events" });
    assert.equal(meta.calls.length, 0);
  });
});

describe("when it cannot send", () => {
  test("no token → skipped with the reason, the source named, nothing sent", async () => {
    const meta = fakeMeta();
    const warned = [];
    const orig = console.warn;
    console.warn = (...a) => warned.push(a.join(" "));
    let out;
    try {
      out = await sendMetaEvents([EVENT], {
        env: { META_CAPI_ENABLED: "1", ADAPTERS_DRY_RUN: "0" },
        fetchImpl: meta.fetchImpl,
        scope: async (fn) => fn({ query: async () => ({ rows: [] }) })
      });
    } finally {
      console.warn = orig;
    }
    assert.equal(out.ok, false);
    assert.equal(out.sent, 0);
    assert.equal(out.skipped, "no_token");
    assert.match(out.error, /META_CAPI_ACCESS_TOKEN/);
    assert.equal(meta.calls.length, 0);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /META_CAPI_ACCESS_TOKEN/);
  });

  test("the ADAPTERS fence holds it unless ADAPTERS_DRY_RUN is an off value", async () => {
    for (const flag of [undefined, "1", "true"]) {
      const meta = fakeMeta();
      const orig = console.warn;
      console.warn = () => {};
      let out;
      try {
        out = await sendMetaEvents([EVENT], { env: { ...ON, ADAPTERS_DRY_RUN: flag }, fetchImpl: meta.fetchImpl });
      } finally {
        console.warn = orig;
      }
      assert.equal(out.ok, false, String(flag));
      assert.equal(out.blocked, true);
      assert.equal(out.sent, 0);
      assert.match(out.error, /ADAPTERS_DRY_RUN/);
      assert.equal(meta.calls.length, 0, "nothing reached fetch");
    }
  });

  test("Meta refuses → Meta's own words come back", async () => {
    const meta = fakeMeta({
      status: 400,
      reply: () => ({ error: { message: "Invalid parameter", type: "OAuthException", code: 100, error_user_msg: "event_time is too far in the past" } })
    });
    const out = await sendMetaEvents([EVENT], { env: ON, fetchImpl: meta.fetchImpl });
    assert.equal(out.ok, false);
    assert.equal(out.sent, 0);
    assert.match(out.error, /^400 Invalid parameter — event_time is too far in the past$/);
    assert.ok(!out.error.includes(FAKE_TOKEN));
  });

  test("a network failure or a throwing fetch is a result, never a throw", async () => {
    const out = await sendMetaEvents([EVENT], { env: ON, fetchImpl: async () => { throw new Error("socket hang up"); } });
    assert.equal(out.ok, false);
    assert.match(out.error, /socket hang up/);
    const weird = await sendMetaEvents("not a list", { env: ON, fetchImpl: async () => { throw new Error("no"); } });
    assert.deepEqual(weird, { ok: true, sent: 0, skipped: "no_events" });
  });

  test("a hung call stops at the ~3 s timeout", async () => {
    assert.equal(TIMEOUT_MS, 3000);
    const hung = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    const t0 = Date.now();
    const out = await sendMetaEvents([EVENT], { env: ON, fetchImpl: hung });
    const took = Date.now() - t0;
    assert.equal(out.ok, false);
    assert.match(out.error, /timed out after 3000ms/);
    assert.ok(took >= 2900 && took < 6000, `took ${took}ms`);
  });
});
