// Real public tracker to the real CAPI serializer, with a fake HTTP transport.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { isIP } from "node:net";

import { recordTrack, TRACK_CAP_SQL } from "../funnel/track.mjs";
import { RECORD_META_SQL } from "./track-send.mjs";
import { clearMetaTokenCache } from "./token.mjs";

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const FAKE_TOKEN = "fake-capi-token-for-tests-only";
const ON = { META_CAPI_ENABLED: "1", ADAPTERS_DRY_RUN: "0", META_CAPI_ACCESS_TOKEN: FAKE_TOKEN };
const NOW = new Date("2026-10-05T18:00:00Z");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS]";
const SID = "mu3h6mzc43murjui5hfj8x9u"; // same shape as a live fh_sid
const FBC = "fb.1.1759600000000.IwAR2AbC_dEf-123"; // mixed case: fbclid case is kept
const FBP = "fb.1.1759600000000.1116446470";

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
  if (ev.custom_data) out.push("Public events must not contain custom parameters");
  return out;
}

beforeEach(() => clearMetaTokenCache());

/** The track door, with the events table, the bus and Meta as stand-ins. */
function door() {
  const jobs = [];
  const wire = [];
  const deps = {
    orgId: "org-1",
    publicContact: async () => ({ emailHash: sha("pat.buyer@gmail.com"), phoneHash: sha("14805550100"), actor: "person" }),
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
        if (sql === RECORD_META_SQL) return { rows: [] };
        throw new Error(`unexpected sql: ${sql}`);
      }
    },
    async emit(_db, _name, _payload, opts) { return { id: `evt-${opts.idempotencyKey}`, deduped: false }; }
  };
  return { wire, post: (body) => recordTrack({ session_id: SID, fbc: FBC, fbp: FBP, ...body }, deps), settle: () => Promise.all(jobs) };
}

const POSTS = {
  Lead: { event: "survey_answer", seq: 24, page: "/apply", props: { last: true, survey: "apply", completion_acknowledged: true } },
  Schedule: { event: "booking_confirmed", seq: 31, page: "/funding-book-call--02424",
    props: { calendar: "funding-book-call", credit_tier: "unqualified" },
    url: "https://apply.fundhub.ai/funding-book-call--02424?booking_ticket=secret" }
};

describe("neutral conversions through the saved track door", () => {
  for (const [name, post] of Object.entries(POSTS)) {
    test(`${name}: follows Meta's rules, under the browser's own eventID`, async () => {
      const d = door();
      const browserEventId = "01234567-89ab-4cde-8123-456789abcdef";
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
      assert.equal(ev.event_source_url, "https://apply.fundhub.ai/apply");
      assert.equal(ev.custom_data, undefined);
      // R2: hashed after Meta's normalising; the rest raw.
      assert.deepEqual(ev.user_data.em, [sha("pat.buyer@gmail.com")]);
      assert.deepEqual(ev.user_data.ph, [sha("14805550100")]);
      assert.equal(ev.user_data.fbc, undefined, "unverified click ids never cross the wire");
      assert.equal(ev.user_data.fbp, FBP, "fbp raw");
      assert.equal(ev.user_data.client_ip_address, "2600:1700:abcd::12", "IP raw");
      assert.equal(ev.user_data.client_user_agent, UA, "user agent raw");
      for (const pii of ["pat.buyer", "Pat.Buyer", "5550100", "555-0100"]) {
        assert.ok(!d.wire[0].raw.includes(pii), `raw "${pii}" on the wire`);
      }
    });
  }

});

test("the rule checker itself catches each break (so a pass above means something)", () => {
  const good = {
    event_name: "Lead", event_time: Math.floor(NOW.getTime() / 1000), event_id: "01234567-89ab-4cde-8123-456789abcdef",
    action_source: "website", event_source_url: "https://apply.fundhub.ai/apply",
    user_data: { client_user_agent: UA, client_ip_address: "203.0.113.9", em: [sha("a@b.co")], fbc: FBC, fbp: FBP }
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
  assert.ok(broken({ custom_data: { score: 800 } }).some(m => m.includes("custom parameters")));
  assert.ok(broken({ event_id: undefined }).some((m) => /event_id/.test(m)));
  assert.ok(broken({ action_source: "web" }).some((m) => /action_source/.test(m)));
});
