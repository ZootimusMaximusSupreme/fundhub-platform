// src/funnel/track-meta.test.mjs — a saved track row → its Meta server copy.
//
// The database, the bus and Meta are all stand-ins; the sender is the real one
// (src/messaging/providers/meta-capi.mjs) talking to a fake fetch with a fake
// token, so what is asserted is the actual request body.
//
// What this proves: the four new top-level fields are kept only when valid
// (meta_event_id, fbc, fbp, url — a sensitive url query value is dropped), and
// the two new props (payment_result order_ref, survey_answer last); the hook
// runs only for a saved row, from a person, with the switch on, for a mapped
// event that carries the browser's meta_event_id (the browser's once-rules
// decide that); it never holds up the answer; agents (automated browsers, and
// sessions whose step-1 email was a company or test email) never reach Meta;
// em / ph come hashed from the session's contact row; the outcome lands on the
// row as payload.meta; and the door (api/public/slo-interest.mjs) hands over
// the client IP and user agent, answers first, then waits a capped time. The
// step-1 contact row now keeps session_id.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { recordTrack, TRACK_CAP_SQL, cleanPageUrl, cleanProps } from "./track.mjs";
import { SESSION_CONTACT_SQL, sha256 } from "../meta/user-data.mjs";
import { RECORD_META_SQL } from "../meta/track-send.mjs";
import { clearMetaTokenCache } from "../meta/token.mjs";
import handler, { recordInterest, META_WAIT_MS } from "../../api/public/slo-interest.mjs";

const SID = "sess-abcdef12";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const FAKE_TOKEN = "fake-capi-token-for-tests-only";
const ON = { META_CAPI_ENABLED: "1", ADAPTERS_DRY_RUN: "0", META_CAPI_ACCESS_TOKEN: FAKE_TOKEN };
const FBC = "fb.1.1727900000000.IwAR2abcDEF";
const FBP = "fb.1.1727900000000.1116446470";

beforeEach(() => clearMetaTokenCache());

/** Bus + events table + Meta, all stand-ins. */
function harness({ contact = null, env = ON, metaStatus = 200 } = {}) {
  const rows = [];
  const queries = [];
  const updates = [];
  const jobs = [];
  const metaCalls = [];
  const deps = {
    orgId: "org-1",
    userAgent: UA,
    clientIp: "203.0.113.7",
    env,
    now: new Date("2026-10-02T18:00:00Z"),
    onMetaSend: (job) => jobs.push(job),
    fetchImpl: async (url, init) => {
      metaCalls.push({ url, body: JSON.parse(init.body), raw: init.body });
      const out = metaStatus === 200 ? { events_received: JSON.parse(init.body).data.length } : { error: { message: "Invalid OAuth access token" } };
      return new Response(JSON.stringify(out), { status: metaStatus });
    },
    db: {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql === TRACK_CAP_SQL) return { rows: [{ n: 0 }] };
        if (sql === SESSION_CONTACT_SQL) return { rows: contact ? [contact] : [] };
        if (sql === RECORD_META_SQL) { updates.push({ patch: params[0], id: params[1] }); return { rows: [] }; }
        throw new Error(`unexpected sql: ${sql}`);
      }
    },
    async emit(_db, name, payload, opts) {
      if (rows.some((r) => r.opts.idempotencyKey === opts.idempotencyKey)) return { id: null, deduped: true };
      rows.push({ name, payload: structuredClone(payload), opts });
      return { id: `evt-${rows.length}`, deduped: false };
    }
  };
  return { rows, queries, updates, jobs, metaCalls, deps, settle: () => Promise.all(jobs) };
}

/* A post as the browser makes it for a Meta-mapped event: meta_event_id is
   "<sid>.<seq>" unless a test says otherwise (pass meta_event_id: undefined for
   a post without one). */
const send = (h, body) => recordTrack({
  session_id: SID, page: "/roadmap", seq: 1, meta_event_id: `${SID}.${body.seq ?? 1}`, ...body
}, h.deps);

describe("the new top-level fields", () => {
  test("meta_event_id, fbc, fbp and url are stored when valid", async () => {
    const h = harness({ env: {} });
    await send(h, {
      event: "continue", props: { step: 1 }, meta_event_id: "sess-abcdef12.1",
      fbc: FBC, fbp: FBP, url: "https://apply.fundhub.ai/roadmap"
    });
    const p = h.rows[0].payload;
    assert.equal(p.meta_event_id, "sess-abcdef12.1");
    assert.equal(p.fbc, FBC);
    assert.equal(p.fbp, FBP);
    assert.equal(p.url, "https://apply.fundhub.ai/roadmap");
  });

  test("absent or junk → not stored at all (the old row shape is unchanged)", async () => {
    const h = harness({ env: {} });
    await send(h, { event: "scroll", props: { depth: 50 }, meta_event_id: "has space", fbc: "nope", fbp: 7, url: "javascript:alert(1)" });
    for (const k of ["meta_event_id", "fbc", "fbp", "url"]) assert.equal(Object.hasOwn(h.rows[0].payload, k), false, k);
  });

  test("url: a fundhub.ai page only; no anchor; a query value that is an email or phone is dropped", () => {
    assert.equal(cleanPageUrl("https://apply.fundhub.ai/roadmap?utm_source=fb&email=pat%40gmail.com&phone=4155550134#fhw"),
      "https://apply.fundhub.ai/roadmap?utm_source=fb");
    assert.equal(cleanPageUrl("https://apply.fundhub.ai/roadmap?e=pat@gmail.com&p=(415)%20555-0134&utm_content=43"),
      "https://apply.fundhub.ai/roadmap?utm_content=43");
    assert.equal(cleanPageUrl("https://fundhub.ai/"), "https://fundhub.ai/");
    assert.equal(cleanPageUrl("https://evil.example/roadmap"), null);
    assert.equal(cleanPageUrl("https://fundhub.ai.evil.example/"), null);
    assert.equal(cleanPageUrl("ftp://apply.fundhub.ai/x"), null);
    assert.equal(cleanPageUrl("/roadmap"), null);
    assert.equal(cleanPageUrl(""), null);
    assert.equal(cleanPageUrl(42), null);
  });

  test("payment_result keeps order_ref; our slo_<hex> refs survive a long digit run", () => {
    assert.deepEqual(cleanProps("payment_result", { result: "success", order_ref: "slo_8f3a1c20240115d" }),
      { result: "success", order_ref: "slo_8f3a1c20240115d" }, "a run that reads as a date");
    assert.deepEqual(cleanProps("payment_result", { result: "success", order_ref: "slo_4242424242424242ab" }),
      { result: "success", order_ref: "slo_4242424242424242ab" }, "nine or more digits in a row");
    assert.deepEqual(cleanProps("payment_result", { result: "success", order_ref: "ord-123456789" }),
      { result: "success" }, "any other ref still gets the value check");
    assert.deepEqual(cleanProps("payment_result", { result: "success", order_ref: "has space" }), { result: "success" });
    assert.deepEqual(cleanProps("payment_result", { result: "success", order_ref: "x".repeat(65) }), { result: "success" });
    assert.deepEqual(cleanProps("payment_result", { result: "success", order_ref: "pat@gmail.com" }), { result: "success" });
  });

  test("survey_answer keeps last as a true / false flag", () => {
    assert.deepEqual(cleanProps("survey_answer", { survey: "apply", last: true }), { survey: "apply", last: true });
    assert.deepEqual(cleanProps("survey_answer", { survey: "apply", last: "false" }), { survey: "apply", last: false });
    assert.deepEqual(cleanProps("survey_answer", { survey: "apply", last: "yes" }), { survey: "apply" });
    assert.deepEqual(cleanProps("survey_answer", { survey: "apply", last: 1 }), { survey: "apply" });
  });
});

describe("when the hook runs", () => {
  test("switch off (the default) → no job and not one extra query", async () => {
    const h = harness({ env: {} });
    const out = await send(h, { event: "continue", props: { step: 1 } });
    assert.deepEqual(out, { ok: true, actor: "person", saved: true });
    assert.equal(h.jobs.length, 0);
    assert.deepEqual(h.queries.map((q) => q.sql), [TRACK_CAP_SQL]);
  });

  test("an event that maps to nothing → no job, even with an id", async () => {
    const h = harness();
    await send(h, { event: "scroll", props: { depth: 50 } });
    await send(h, { event: "buybox_tab", seq: 2, props: { tab: 1 } });
    assert.equal(h.jobs.length, 0);
    assert.equal(h.metaCalls.length, 0);
  });

  test("no meta_event_id on the post → no job and no extra query (a repeat the browser held back)", async () => {
    const h = harness();
    await send(h, { event: "buybox_tab", props: { tab: 2 }, meta_event_id: undefined });
    await send(h, { event: "payment_result", seq: 2, props: { result: "success", order_ref: "slo_ab12" }, meta_event_id: undefined });
    await send(h, { event: "section_view", seq: 3, props: { section: "fhw" }, meta_event_id: undefined });
    await send(h, { event: "page_view", seq: 4, page: "/watch", meta_event_id: undefined });
    assert.equal(h.jobs.length, 0);
    assert.equal(h.metaCalls.length, 0);
    assert.ok(h.queries.every((q) => q.sql === TRACK_CAP_SQL));
  });

  test("a row that was not saved (a retry of the same seq) → no job", async () => {
    const h = harness();
    await send(h, { event: "continue", props: { step: 1 } });
    await send(h, { event: "continue", props: { step: 1 } });
    await h.settle();
    assert.equal(h.jobs.length, 1);
    assert.equal(h.metaCalls.length, 1);
  });

  test("an automated or bot browser never reaches Meta", async () => {
    const h = harness();
    await send(h, { event: "continue", props: { step: 1 }, webdriver: true });
    await recordTrack({ session_id: SID, page: "/roadmap", seq: 2, event: "continue" },
      { ...h.deps, userAgent: "Mozilla/5.0 HeadlessChrome/120" });
    assert.equal(h.jobs.length, 0);
    assert.equal(h.metaCalls.length, 0);
  });

  test("a session whose step-1 email was ours or a test email never reaches Meta", async () => {
    const h = harness({ contact: { email: "sam@fundhub.ai", phone: null, actor: "agent" } });
    await send(h, { event: "continue", props: { step: 1 } });
    const results = await h.settle();
    assert.equal(h.metaCalls.length, 0);
    assert.deepEqual(results, [{ ok: true, sent: 0, skipped: "agent_session" }]);
    assert.equal(h.updates[0].patch.meta.skipped, "agent_session");
  });

  test("the answer never waits on Meta", async () => {
    const h = harness();
    let release;
    h.deps.fetchImpl = () => new Promise((resolve) => { release = () => resolve(new Response('{"events_received":1}')); });
    const out = await send(h, { event: "continue", props: { step: 1 } });
    assert.deepEqual(out, { ok: true, actor: "person", saved: true }, "answered while Meta is still pending");
    assert.equal(h.jobs.length, 1);
    await new Promise((r) => setImmediate(r));
    release();
    assert.equal((await h.settle())[0].sent, 1);
  });
});

describe("what Meta gets", () => {
  test("a step-1 Lead: browser id, hashed email and phone, IP, agent, fbc, fbp, url", async () => {
    const h = harness({ contact: { email: "Pat@Gmail.com", phone: "+14155550134", actor: "person" } });
    await send(h, {
      event: "continue", seq: 4, props: { step: 1, bbv: 2 }, meta_event_id: "sess-abcdef12.4",
      fbc: FBC, fbp: FBP, url: "https://apply.fundhub.ai/roadmap?utm_source=fb&email=pat%40gmail.com"
    });
    await h.settle();
    assert.equal(h.metaCalls.length, 1);
    const { url, body, raw } = h.metaCalls[0];
    assert.equal(url, "https://graph.facebook.com/v21.0/2403674420141513/events");
    assert.equal(body.access_token, FAKE_TOKEN);
    assert.deepEqual(body.data, [{
      event_name: "Lead",
      event_time: Math.floor(Date.parse("2026-10-02T18:00:00Z") / 1000),
      event_id: "sess-abcdef12.4",
      action_source: "website",
      event_source_url: "https://apply.fundhub.ai/roadmap?utm_source=fb",
      user_data: {
        client_ip_address: "203.0.113.7",
        client_user_agent: UA,
        fbc: FBC,
        fbp: FBP,
        em: [sha256("pat@gmail.com")],
        ph: [sha256("14155550134")],
        external_id: [sha256(SID)]
      },
      custom_data: { content_name: "roadmap_buybox" }
    }]);
    for (const rawPii of ["pat@gmail.com", "Pat@Gmail.com", "4155550134"]) {
      assert.ok(!raw.includes(rawPii), `raw "${rawPii}" must never be on the wire`);
    }
    const lookup = h.queries.find((q) => q.sql === SESSION_CONTACT_SQL);
    assert.deepEqual(lookup.params, ["org-1", SID]);
  });

  test("the outcome lands on the same row as payload.meta", async () => {
    const h = harness();
    await send(h, { event: "page_view", props: { title: "Roadmap" }, meta_event_id: "pv.sess-abcdef12.zz" });
    await h.settle();
    assert.deepEqual(h.updates, [{
      id: "evt-1",
      patch: { meta: { sent: 2, event_name: "PageView,ViewContent", event_id: "pv.sess-abcdef12.zz,pv.sess-abcdef12.zz.vc", at: "2026-10-02T18:00:00.000Z" } }
    }]);
    const data = h.metaCalls[0].body.data;
    assert.deepEqual(data.map((e) => [e.event_name, e.event_id, e.custom_data]), [
      ["PageView", "pv.sess-abcdef12.zz", undefined],
      ["ViewContent", "pv.sess-abcdef12.zz.vc", { content_name: "/roadmap" }]
    ]);
    assert.equal(data[0].event_source_url, "https://apply.fundhub.ai/roadmap", "no url sent → the page's address");
  });

  test("Meta refusing is recorded on the row, with Meta's words", async () => {
    const h = harness({ metaStatus: 401 });
    await send(h, { event: "softpull_submit", props: { businesses: 2 } });
    await h.settle();
    const note = h.updates[0].patch.meta;
    assert.equal(note.sent, 0);
    assert.equal(note.event_name, "SoftPullSubmitted");
    assert.equal(note.event_id, `${SID}.1`, "the browser's id");
    assert.match(note.error, /Invalid OAuth access token/);
    assert.ok(!JSON.stringify(h.updates).includes(FAKE_TOKEN));
  });

  test("test_event_code passes through from META_TEST_EVENT_CODE", async () => {
    const h = harness({ env: { ...ON, META_TEST_EVENT_CODE: "TEST4242" } });
    await send(h, { event: "booking_confirmed", page: "/apply", props: { calendar: "funding-book-call" } });
    await h.settle();
    assert.equal(h.metaCalls[0].body.test_event_code, "TEST4242");
  });

  test("InitiateCheckout: $147 under the browser's id; the next tab-2 post (no id) sends nothing", async () => {
    const h = harness();
    await send(h, { event: "buybox_tab", seq: 5, props: { tab: 2, bbv: 2 } });
    await send(h, { event: "buybox_tab", seq: 9, props: { tab: 2, bbv: 2 }, meta_event_id: undefined });
    await h.settle();
    assert.equal(h.metaCalls.length, 1);
    const ev = h.metaCalls[0].body.data[0];
    assert.equal(ev.event_name, "InitiateCheckout");
    assert.equal(ev.event_id, `${SID}.5`);
    assert.deepEqual(ev.custom_data, { value: 147, currency: "USD" }, "the price charged (SLO_PRICE_CENTS), in dollars");
  });

  test("the last survey question: Lead and SurveyStep in one request, one shared id", async () => {
    const h = harness();
    await send(h, { event: "survey_answer", page: "/apply", seq: 12,
      props: { survey: "apply", step_num: 10, question_id: "cf_svy_available_capital", last: true } });
    await h.settle();
    assert.deepEqual(h.metaCalls[0].body.data.map((e) => [e.event_name, e.event_id, e.custom_data]), [
      ["Lead", `${SID}.12`, { content_name: "apply" }],
      ["SurveyStep", `${SID}.12`, { survey: "apply", step: 10 }]
    ]);
    assert.equal(h.updates[0].patch.meta.event_name, "Lead,SurveyStep");
  });

  test("Purchase: the door sends no server copy — the payment webhook's is the one (Meta does not promise to dedupe two server copies)", async () => {
    const h = harness();
    await send(h, { event: "payment_result", props: { result: "success", bbv: 2, order_ref: "ord_9" }, meta_event_id: "purchase.ord_9" });
    await send(h, { event: "payment_result", seq: 2, props: { result: "success", bbv: 2, order_ref: "ord_9" }, meta_event_id: undefined });
    await send(h, { event: "payment_result", seq: 3, props: { result: "success", bbv: 2 } });
    await h.settle();
    assert.equal(h.rows[0].payload.props.order_ref, "ord_9", "the order ref is kept on the row");
    assert.equal(h.rows[0].payload.meta_event_id, "purchase.ord_9", "the browser's Purchase id is kept on the row");
    assert.equal(h.metaCalls.length, 0, "no Purchase to Meta from the track door");
    assert.equal(h.updates.length, 0, "nothing recorded: no job started");
  });
});

// ── the door ─────────────────────────────────────────────────────────────────

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {}, answeredAt: null,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.answeredAt = Date.now(); return this; }
  };
}

describe("api/public/slo-interest.mjs", () => {
  test("hands Meta the client IP (x-nf-client-connection-ip) and user agent, answers first", async () => {
    const h = harness();
    const { clientIp: _ip, userAgent: _ua, ...deps } = h.deps;
    const res = fakeRes();
    await handler({
      method: "POST",
      headers: { origin: "https://apply.fundhub.ai", "user-agent": UA, "x-nf-client-connection-ip": "198.51.100.23", "x-forwarded-for": "192.0.2.1, 10.0.0.1" },
      body: { kind: "track", event: "continue", seq: 3, session_id: SID, page: "/roadmap", props: { step: 1 }, meta_event_id: `${SID}.3` }
    }, res, deps);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, actor: "person", saved: true });
    assert.equal(h.metaCalls.length, 1, "the door waited for the send before it returned");
    const ud = h.metaCalls[0].body.data[0].user_data;
    assert.equal(ud.client_ip_address, "198.51.100.23");
    assert.equal(ud.client_user_agent, UA);
  });

  test("falls back to the first x-forwarded-for hop", async () => {
    const h = harness();
    const { clientIp: _ip, ...deps } = h.deps;
    await handler({
      method: "POST",
      headers: { "user-agent": UA, "x-forwarded-for": "192.0.2.1, 10.0.0.1" },
      body: { kind: "track", event: "softpull_submit", seq: 3, session_id: SID, page: "/roadmap", props: { businesses: 1 }, meta_event_id: `${SID}.3` }
    }, fakeRes(), deps);
    assert.equal(h.metaCalls[0].body.data[0].user_data.client_ip_address, "192.0.2.1");
  });

  test("the wait for Meta is capped", async () => {
    assert.equal(META_WAIT_MS, 4000);
    const h = harness();
    h.deps.fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    const res = fakeRes();
    const t0 = Date.now();
    await handler({
      method: "POST", headers: { "user-agent": UA },
      body: { kind: "track", event: "continue", seq: 3, session_id: SID, page: "/roadmap", meta_event_id: `${SID}.3` }
    }, res, { ...h.deps, metaWaitMs: 50 });
    assert.equal(res.statusCode, 200);
    assert.ok(Date.now() - t0 < 1500, "returned after the capped wait, not the send");
  });

  test("the step-1 contact row keeps the browser session id", async () => {
    const saved = [];
    const emit = async (_db, name, payload) => { saved.push({ name, payload }); return { id: "evt-c", deduped: false }; };
    const deps = { emit, db: { query: async () => ({ rows: [] }) }, syncCf: async () => ({ ok: true, id: 1 }), userAgent: "Mozilla/5.0", now: new Date("2026-10-02T18:00:00Z") };
    await recordInterest({ kind: "contact", email: "pat@gmail.com", session_id: SID }, deps);
    await recordInterest({ kind: "contact", email: "lee@gmail.com", session_id: "bad id!" }, deps);
    assert.equal(saved[0].payload.session_id, SID);
    assert.equal(Object.hasOwn(saved[1].payload, "session_id"), false, "an invalid session id is not kept");
  });
});
