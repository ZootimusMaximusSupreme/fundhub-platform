// src/meta/meta-spec.test.mjs — the four money events, held to Meta's own rules.
//
// Lead, InitiateCheckout and Schedule go through the real track door
// (src/funnel/track.mjs → src/meta/track-send.mjs); Purchase goes through the
// real payment webhook handler (src/handlers/meta-purchase.mjs). Both hand the
// events to the real sender (src/messaging/providers/meta-capi.mjs), which
// talks to a FAKE fetch with a FAKE token. Nothing here reaches Meta; what is
// checked is the exact request body that would be sent.
//
// The rules (checked 2026-10-05, developers.facebook.com):
//   R1 Server event parameters — event_name; event_time is a Unix time in
//      SECONDS and not more than 7 days old (else Meta rejects the whole
//      request); action_source is one of Meta's listed values; user_data is
//      required; event_source_url is required for website events.
//      docs/marketing-api/conversions-api/parameters/server-event
//   R2 Customer information parameters — em / ph are SHA-256 of the
//      normalised value (email trimmed + lowercased; phone digits only, no
//      leading zeros, with country code); fbc, fbp, client_ip_address and
//      client_user_agent are NOT hashed; client_user_agent is required for
//      website events.
//      docs/marketing-api/conversions-api/parameters/customer-information-parameters
//   R3 fbc / fbp — "fb.<subdomain index>.<creation time in ms>.<fbclid|random>",
//      fbclid case kept. docs/marketing-api/conversions-api/parameters/fbp-and-fbc
//   R4 Custom data / Pixel reference — Purchase needs value (a number) and
//      currency (ISO 4217, three letters). docs/marketing-api/conversions-api/
//      parameters/custom-data; docs/meta-pixel/reference
//   R5 Deduplication — the browser's eventID must equal the server's event_id,
//      and the event names must match. Meta drops a server copy that matches a
//      browser copy; it does not promise to drop two server copies.
//      docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events
//
// WHAT THIS CANNOT PROVE: what Meta's servers do with the request. That is
// Events Manager — see the checklist in docs/tracking/meta-events.md.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { isIP } from "node:net";

import { recordTrack, TRACK_CAP_SQL } from "../funnel/track.mjs";
import { SESSION_CONTACT_SQL } from "./user-data.mjs";
import { RECORD_META_SQL } from "./track-send.mjs";
import { clearMetaTokenCache } from "./token.mjs";
import { onMoneyEventForMeta } from "../handlers/meta-purchase.mjs";
import { SLO_PRICE_CENTS } from "../slo/offer.mjs";

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const FAKE_TOKEN = "fake-capi-token-for-tests-only";
const ON = { META_CAPI_ENABLED: "1", ADAPTERS_DRY_RUN: "0", META_CAPI_ACCESS_TOKEN: FAKE_TOKEN };
const NOW = new Date("2026-10-05T18:00:00Z");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS]";
const SID = "mu3h6mzc43murjui5hfj8x9u"; // same shape as a live fh_sid
const FBC = "fb.1.1759600000000.IwAR2AbC_dEf-123"; // mixed case: fbclid case is kept
const FBP = "fb.1.1759600000000.1116446470";
const CONTACT = { email: "  Pat.Buyer@Gmail.COM ", phone: "+1 (480) 555-0100", actor: "person" };

const ACTION_SOURCES = ["email", "website", "app", "phone_call", "chat", "physical_store", "system_generated", "business_messaging", "other"];
const HEX64 = /^[a-f0-9]{64}$/;
const FB_ID = /^fb\.\d\.\d{13}\.[A-Za-z0-9_.-]+$/;

/** Every way one server event breaks Meta's written rules. [] when it follows them. */
function metaRuleBreaks(ev, nowMs) {
  const out = [];
  const nowS = Math.floor(nowMs / 1000);
  if (typeof ev.event_name !== "string" || !ev.event_name) out.push("R1 event_name missing");
  if (!Number.isInteger(ev.event_time)) out.push("R1 event_time not an integer");
  else {
    if (ev.event_time > 1e11) out.push("R1 event_time is milliseconds, not seconds");
    if (ev.event_time < nowS - 7 * 24 * 3600) out.push("R1 event_time older than 7 days");
    if (ev.event_time > nowS + 60) out.push("R1 event_time in the future");
  }
  if (!ACTION_SOURCES.includes(ev.action_source)) out.push(`R1 action_source ${ev.action_source}`);
  const ud = ev.user_data;
  if (!ud || typeof ud !== "object" || !Object.keys(ud).length) out.push("R1 user_data missing");
  if (ev.action_source === "website") {
    if (!/^https:\/\/([a-z0-9-]+\.)*fundhub\.ai\//.test(ev.event_source_url || "")) out.push("R1 website event without event_source_url");
    if (!ud?.client_user_agent) out.push("R2 website event without client_user_agent");
  }
  for (const k of ["em", "ph", "external_id"]) {
    if (ud?.[k] === undefined) continue;
    if (!Array.isArray(ud[k]) || !ud[k].every((v) => HEX64.test(v))) out.push(`R2 ${k} not SHA-256 hex`);
  }
  for (const k of ["fbc", "fbp"]) {
    if (ud?.[k] !== undefined && !FB_ID.test(ud[k])) out.push(`R3 ${k} not Meta's fb.<n>.<ms>.<id> shape (hashed?)`);
  }
  if (ud?.client_ip_address !== undefined && !isIP(ud.client_ip_address)) out.push("R2 client_ip_address not a plain IP (hashed?)");
  if (ud?.client_user_agent !== undefined && HEX64.test(ud.client_user_agent)) out.push("R2 client_user_agent hashed");
  if (typeof ev.event_id !== "string" || !ev.event_id) out.push("R5 event_id missing");
  if (ev.event_name === "Purchase") {
    const cd = ev.custom_data || {};
    if (typeof cd.value !== "number" || !Number.isFinite(cd.value) || cd.value <= 0) out.push("R4 Purchase value not a positive number");
    if (!/^[A-Z]{3}$/.test(cd.currency || "")) out.push("R4 Purchase currency not ISO 4217");
  }
  return out;
}

beforeEach(() => clearMetaTokenCache());

/** The track door, with the events table, the bus and Meta as stand-ins. */
function door() {
  const jobs = [];
  const wire = [];
  const deps = {
    orgId: "org-1",
    userAgent: UA,
    clientIp: "2600:1700:abcd::12",
    env: ON,
    now: NOW,
    onMetaSend: (job) => jobs.push(job),
    fetchImpl: async (url, init) => {
      wire.push({ url, body: JSON.parse(init.body), raw: init.body });
      return new Response(JSON.stringify({ events_received: JSON.parse(init.body).data.length }), { status: 200 });
    },
    db: {
      async query(sql) {
        if (sql === TRACK_CAP_SQL) return { rows: [{ n: 0 }] };
        if (sql === SESSION_CONTACT_SQL) return { rows: [CONTACT] };
        if (sql === RECORD_META_SQL) return { rows: [] };
        throw new Error(`unexpected sql: ${sql}`);
      }
    },
    async emit(_db, _name, _payload, opts) { return { id: `evt-${opts.idempotencyKey}`, deduped: false }; }
  };
  return { wire, post: (body) => recordTrack({ session_id: SID, fbc: FBC, fbp: FBP, ...body }, deps), settle: () => Promise.all(jobs) };
}

/* The posts exactly as public/funnel/fh-events.js makes them: meta_event_id is
   the eventID it gave fbq ("<fh_sid>.<seq>" of this post). */
const POSTS = {
  Lead: { event: "continue", seq: 24, page: "/roadmap", props: { step: 1, bbv: 2 }, url: "https://apply.fundhub.ai/roadmap" },
  InitiateCheckout: { event: "buybox_tab", seq: 25, page: "/roadmap", props: { tab: 2, bbv: 2 }, url: "https://apply.fundhub.ai/roadmap" },
  Schedule: { event: "booking_confirmed", seq: 31, page: "/roadmap-book", props: { calendar: "funding-book-call" }, url: "https://apply.fundhub.ai/roadmap-book" }
};

describe("Lead, InitiateCheckout, Schedule — the server copy from the track door", () => {
  for (const [name, post] of Object.entries(POSTS)) {
    test(`${name}: follows Meta's rules, under the browser's own eventID`, async () => {
      const d = door();
      const browserEventId = `${SID}.${post.seq}`;
      await d.post({ ...post, meta_event_id: browserEventId });
      await d.settle();
      assert.equal(d.wire.length, 1, "one request");
      const [ev] = d.wire[0].body.data;
      assert.deepEqual(metaRuleBreaks(ev, NOW.getTime()), []);
      // R5: same name and same id as the browser's fbq call, so Meta keeps one.
      assert.equal(ev.event_name, name);
      assert.equal(ev.event_id, browserEventId);
      assert.equal(ev.event_time, Math.floor(NOW.getTime() / 1000), "seconds, the moment the server got it");
      assert.equal(ev.action_source, "website");
      assert.equal(ev.event_source_url, post.url);
      // R2: hashed after Meta's normalising; the rest raw.
      assert.deepEqual(ev.user_data.em, [sha("pat.buyer@gmail.com")]);
      assert.deepEqual(ev.user_data.ph, [sha("14805550100")]);
      assert.equal(ev.user_data.fbc, FBC, "fbc raw, case kept");
      assert.equal(ev.user_data.fbp, FBP, "fbp raw");
      assert.equal(ev.user_data.client_ip_address, "2600:1700:abcd::12", "IP raw");
      assert.equal(ev.user_data.client_user_agent, UA, "user agent raw");
      for (const pii of ["pat.buyer", "Pat.Buyer", "5550100", "555-0100"]) {
        assert.ok(!d.wire[0].raw.includes(pii), `raw "${pii}" on the wire`);
      }
    });
  }

  test("InitiateCheckout value is the price charged, in dollars (integer cents / 100), USD", async () => {
    const d = door();
    await d.post({ ...POSTS.InitiateCheckout, meta_event_id: `${SID}.25` });
    await d.settle();
    assert.deepEqual(d.wire[0].body.data[0].custom_data, { value: SLO_PRICE_CENTS / 100, currency: "USD" });
    assert.equal(SLO_PRICE_CENTS / 100, 147);
  });

  test("Schedule carries only the calendar name in custom_data", async () => {
    const d = door();
    await d.post({ ...POSTS.Schedule, meta_event_id: `${SID}.31` });
    await d.settle();
    assert.deepEqual(d.wire[0].body.data[0].custom_data, { content_name: "funding-book-call" });
  });

  test("the browser's Purchase row sends nothing from the door (R5: one server copy, the webhook's)", async () => {
    const d = door();
    await d.post({ event: "payment_result", seq: 40, page: "/roadmap", props: { result: "success", order_ref: "slo_0123456789abcdef01234567" },
      meta_event_id: "purchase.slo_0123456789abcdef01234567" });
    await d.settle();
    assert.equal(d.wire.length, 0);
  });
});

describe("Purchase — the one server copy, from the payment webhook", () => {
  const REF = "slo_0123456789abcdef01234567";
  const CLIENT = "22222222-2222-4222-8222-222222222222";
  const ORG = "11111111-1111-4111-8111-111111111111";

  function webhookDb(amountCents) {
    return {
      async query(sql) {
        const text = String(sql);
        if (/UPDATE events SET payload = payload \|\|/.test(text)) return { rows: [] };
        if (/FROM payment_links/.test(text)) {
          return { rows: [{ id: "33333333-3333-4333-8333-333333333333", org_id: ORG, client_id: CLIENT, link_ref: REF, amount_cents: amountCents, status: "paid", is_demo: false }] };
        }
        if (/FROM clients/.test(text)) {
          return { rows: [{ id: CLIENT, email: CONTACT.email, phone: CONTACT.phone, is_demo: false, custom_fields: {} }] };
        }
        if (/FROM events/.test(text)) {
          return { rows: [{ meta_match: { fbc: FBC, fbp: FBP, client_ip_address: "203.0.113.9", client_user_agent: UA }, actor: "person" }] };
        }
        return { rows: [] };
      }
    };
  }

  async function purchaseOnWire(amountCents) {
    const wire = [];
    const fetchImpl = async (url, init) => {
      wire.push({ url, body: JSON.parse(init.body), raw: init.body });
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    };
    const out = await onMoneyEventForMeta({
      id: "evt-pay-1", name: "payment.received", orgId: ORG, clientId: CLIENT,
      payload: { source: "commas", product: "crs", productCode: "diagnostic", purpose: "diagnostic",
        amount: amountCents / 100, paymentId: "pay_777", providerRef: "pay_777", ref: REF, paymentLinkId: "33333333-3333-4333-8333-333333333333" }
    }, webhookDb(amountCents), { env: ON, fetchImpl, now: () => NOW.getTime() });
    return { out, wire };
  }

  test("follows Meta's rules: value in dollars from integer cents, USD, the browser's purchase.<order ref> id", async () => {
    const { out, wire } = await purchaseOnWire(SLO_PRICE_CENTS);
    assert.equal(out.sent, true);
    assert.equal(wire.length, 1);
    const [ev] = wire[0].body.data;
    assert.deepEqual(metaRuleBreaks(ev, NOW.getTime()), []);
    assert.equal(ev.event_name, "Purchase");
    assert.equal(ev.event_id, `purchase.${REF}`, "the id fh-events.js gives fbq on checkout:success");
    assert.deepEqual(ev.custom_data, { value: 147, currency: "USD" });
    assert.equal(typeof ev.custom_data.value, "number", "a number, not the string \"147.00\"");
    assert.equal(ev.action_source, "website");
    assert.equal(ev.event_source_url, "https://apply.fundhub.ai/roadmap");
    assert.deepEqual(ev.user_data.em, [sha("pat.buyer@gmail.com")]);
    assert.deepEqual(ev.user_data.ph, [sha("14805550100")]);
    assert.deepEqual(ev.user_data.external_id, [sha(CLIENT)]);
    assert.equal(ev.user_data.fbc, FBC);
    assert.equal(ev.user_data.fbp, FBP);
    assert.equal(ev.user_data.client_ip_address, "203.0.113.9");
    assert.equal(ev.user_data.client_user_agent, UA);
    assert.ok(!wire[0].raw.includes("Pat.Buyer") && !wire[0].raw.includes("5550100"), "no raw email or phone on the wire");
  });

  test("an order with extra businesses reports what was charged ($162.00 → 162), not the list price", async () => {
    const { wire } = await purchaseOnWire(16200);
    assert.deepEqual(wire[0].body.data[0].custom_data, { value: 162, currency: "USD" });
  });
});

test("the rule checker itself catches each break (so a pass above means something)", () => {
  const good = {
    event_name: "Purchase", event_time: Math.floor(NOW.getTime() / 1000), event_id: "purchase.x",
    action_source: "website", event_source_url: "https://apply.fundhub.ai/roadmap",
    user_data: { client_user_agent: UA, client_ip_address: "203.0.113.9", em: [sha("a@b.co")], fbc: FBC, fbp: FBP },
    custom_data: { value: 147, currency: "USD" }
  };
  assert.deepEqual(metaRuleBreaks(good, NOW.getTime()), []);
  const broken = (patch) => metaRuleBreaks({ ...good, ...patch }, NOW.getTime());
  assert.ok(broken({ event_time: NOW.getTime() }).some((m) => /milliseconds/.test(m)));
  assert.ok(broken({ event_time: Math.floor(NOW.getTime() / 1000) - 8 * 86400 }).some((m) => /7 days/.test(m)));
  assert.ok(broken({ event_source_url: undefined }).some((m) => /event_source_url/.test(m)));
  assert.ok(broken({ user_data: { ...good.user_data, client_user_agent: undefined } }).some((m) => /client_user_agent/.test(m)));
  assert.ok(broken({ user_data: { ...good.user_data, em: ["pat@gmail.com"] } }).some((m) => /em not SHA-256/.test(m)));
  assert.ok(broken({ user_data: { ...good.user_data, fbp: sha(FBP) } }).some((m) => /fbp/.test(m)));
  assert.ok(broken({ user_data: { ...good.user_data, client_ip_address: sha("203.0.113.9") } }).some((m) => /client_ip_address/.test(m)));
  assert.ok(broken({ custom_data: { value: "147.00", currency: "USD" } }).some((m) => /value/.test(m)));
  assert.ok(broken({ custom_data: { value: 147 } }).some((m) => /currency/.test(m)));
  assert.ok(broken({ event_id: undefined }).some((m) => /event_id/.test(m)));
  assert.ok(broken({ action_source: "web" }).some((m) => /action_source/.test(m)));
});
