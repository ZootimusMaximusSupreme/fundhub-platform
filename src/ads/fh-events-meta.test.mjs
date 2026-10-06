// src/ads/fh-events-meta.test.mjs — the shared tracker's Meta side.
//
// public/funnel/fh-events.js against the "Phase 4 contract" in
// docs/tracking/meta-events.md: for every event the map sends to Meta, the
// browser calls fbq with eventID "<fh_sid>.<seq>" and posts the same id to our
// database as meta_event_id, so Meta counts the browser copy and the server
// copy once. PageView is the head snippet's (never fired here); ViewContent is
// "<__fhPv>.vc"; Purchase is "purchase.<order_ref>", once per order;
// InitiateCheckout once per session; ReachedBuyBox once per page load. Every
// post carries url (no query), fbc and fbp; fbc is built from fbclid when
// Meta's _fbc cookie is missing.
//
// Runs the real script on the fake page in src/ads/fh-events-harness.mjs.
// WHAT THIS CANNOT TEST: the real Meta pixel or Test Events. The live check is
// the phone checklist in docs/tracking/tracking-spec.md.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makePage } from "./fh-events-harness.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { SLO_VALUE, CURRENCY } from "../meta/map.mjs";

const SID = "sess-abcdef12";
const PV = `pv.${SID}.k3j9x`;
const FBCLID = "IwAR0x_9-AbC";
const FBP = "fb.1.1700000000000.1234567890";

function page(opts = {}) {
  return makePage({ fbq: true, fhPv: PV, ...opts, storage: { fh_sid: SID, ...(opts.storage || {}) } });
}

/** [method, name, custom_data, eventID] per fbq call. */
const fbqs = (p) => p.fbqCalls.map(([m, n, cd, o]) => [m, n, cd, o && o.eventID]);
const named = (p, name) => fbqs(p).filter((c) => c[1] === name);

describe("page_view: PageView id and ViewContent", () => {
  test("page_view carries __fhPv as meta_event_id; PageView is never fired by the tracker", () => {
    const p = page({ pathname: "/roadmap" }).run();
    const pv = p.events("page_view")[0];
    assert.equal(pv.meta_event_id, PV);
    assert.equal(named(p, "PageView").length, 0, "the head snippet fires PageView, not the tracker");
    assert.deepEqual(fbqs(p), [["track", "ViewContent", { content_name: "/roadmap" }, `${PV}.vc`]]);
  });

  test("ViewContent on /roadmap, /watch, /apply and /home only", () => {
    for (const [hostname, pathname, name] of [
      ["apply.fundhub.ai", "/roadmap/", "/roadmap"], ["apply.fundhub.ai", "/watch", "/watch"],
      ["apply.fundhub.ai", "/apply", "/apply"], ["fundhub.ai", "/", "/home"],
    ]) {
      const p = page({ hostname, pathname }).run();
      assert.deepEqual(fbqs(p), [["track", "ViewContent", { content_name: name }, `${PV}.vc`]], name);
    }
    for (const pathname of ["/thank-you", "/roadmap-book", "/funding-book-call", "/order", "/roadmap-thank-you"]) {
      const p = page({ pathname }).run();
      assert.equal(p.fbqCalls.length, 0, pathname);
      assert.equal(p.events("page_view")[0].meta_event_id, PV, `${pathname} still carries the PageView id`);
    }
  });

  test("no __fhPv (or a junk one): pv.<sid>.<seq>, and ViewContent still goes", () => {
    for (const fhPv of [undefined, "", "has space", { x: 1 }, "x".repeat(200)]) {
      const p = page({ pathname: "/watch", fhPv, storage: { fh_seq: "6" } }).run();
      const id = `pv.${SID}.7`;
      assert.equal(p.events("page_view")[0].meta_event_id, id, JSON.stringify(fhPv));
      assert.deepEqual(fbqs(p), [["track", "ViewContent", { content_name: "/watch" }, `${id}.vc`]]);
    }
  });

  test("a second load in the same session sends no page_view and no ViewContent", () => {
    const p = page({ pathname: "/roadmap" }).run();
    const again = page({ pathname: "/roadmap", storage: p.store }).run();
    assert.equal(again.sent.length, 0);
    assert.equal(again.fbqCalls.length, 0);
  });
});

describe("the same eventID on fbq and on the database post", () => {
  test("every mapped event: fbq eventID === meta_event_id === <sid>.<seq>", () => {
    const p = page({ pathname: "/roadmap" }).run();
    const cases = [
      ["continue", { step: 1, bbv: 2 }, "Lead"],
      ["booking_confirmed", { calendar: "funding-book-call" }, "Schedule"],
      ["survey_route", { survey: "apply", offer: "slo" }, "SurveyRouted"],
      ["video", { video: "slo-vsl", action: "progress", pct: 50 }, "VideoProgress"],
      ["softpull_submit", { businesses: 2, bbv: 2 }, "SoftPullSubmitted"],
    ];
    for (const [event, props, meta] of cases) {
      p.win.fhTrack(event, props);
      const body = p.bodies().at(-1);
      assert.equal(body.event, event);
      assert.equal(body.meta_event_id, `${SID}.${body.seq}`, event);
      const call = fbqs(p).at(-1);
      assert.equal(call[1], meta, event);
      assert.equal(call[3], body.meta_event_id, `${event}: the browser and the server use one id`);
    }
  });

  test("standard events use track, custom events use trackCustom, with the contract's custom_data", () => {
    const p = page({ pathname: "/roadmap" }).run();
    p.fbqCalls.length = 0;
    p.win.fhTrack("continue", { step: 1, bbv: 2 });
    p.win.fhTrack("booking_confirmed", { calendar: "funding-book-call" });
    p.win.fhTrack("survey_route", { survey: "apply", offer: "slo" });
    p.win.fhTrack("video", { video: "slo-vsl", action: "progress", pct: 25, current_s: 50, duration_s: 200 });
    p.win.fhTrack("softpull_submit", { businesses: 2, bbv: 2 });
    assert.deepEqual(fbqs(p).map(([m, n, cd]) => [m, n, cd]), [
      ["track", "Lead", { content_name: "roadmap_buybox" }],
      ["track", "Schedule", { content_name: "funding-book-call" }],
      ["trackCustom", "SurveyRouted", { offer: "slo" }],
      ["trackCustom", "VideoProgress", { video: "slo-vsl", pct: 25 }],
      ["trackCustom", "SoftPullSubmitted", { businesses: 2 }],
    ]);
  });

  test("events the map does not name carry no meta_event_id and call no fbq", () => {
    const p = page({ pathname: "/roadmap" }).run();
    p.fbqCalls.length = 0;
    p.win.fhTrack("continue", { step: 2 });
    p.win.fhTrack("payment_attempt", { amount_cents: 29700 });
    p.win.fhTrack("field_focus", { form: "s1", field: "email" });
    p.win.fhTrack("video", { video: "slo-vsl", action: "play" });
    p.win.fhTrack("video", { video: "slo-vsl", action: "progress", pct: 10 });
    p.win.fhTrack("section_view", { section: "fh-order" });
    p.advance(16_000);
    p.scrollTo(4000);
    for (const b of p.bodies().slice(1)) assert.equal("meta_event_id" in b, false, b.event);
    assert.equal(p.fbqCalls.length, 0);
  });

  test("a booking confirmed in the framed calendar becomes Schedule on the parent page", () => {
    const p = page({ pathname: "/apply" }).run();
    p.fireWin("message", { origin: "https://apply.fundhub.ai", data: { fh: "track", event: "booking_confirmed", props: { calendar: "funding-book-call" } } });
    const body = p.events("booking_confirmed")[0];
    assert.deepEqual(named(p, "Schedule"), [["track", "Schedule", { content_name: "funding-book-call" }, body.meta_event_id]]);
  });
});

describe("Lead", () => {
  test("continue on /roadmap step 1 is Lead, every press", () => {
    const p = page({ pathname: "/roadmap" }).run();
    p.win.fhTrack("continue", { step: 1, bbv: 2 });
    p.win.fhTrack("continue", { step: 1, bbv: 2 });
    const ids = p.events("continue").map((b) => b.meta_event_id);
    assert.deepEqual(named(p, "Lead").map((c) => c[3]), ids);
    assert.equal(new Set(ids).size, 2);
  });

  test("continue anywhere but /roadmap is not a Lead", () => {
    const p = page({ pathname: "/apply" }).run();
    p.win.fhTrack("continue", { step: 1 });
    assert.equal(named(p, "Lead").length, 0);
    assert.equal("meta_event_id" in p.events("continue")[0], false);
  });

  test("/apply: the last question (page marks last:true) is Lead + SurveyStep on one id; earlier ones SurveyStep only", () => {
    const p = page({ pathname: "/apply" }).run();
    p.fbqCalls.length = 0;
    p.win.fhTrack("survey_answer", { survey: "apply", step_num: 1, question_id: "contact" });
    p.win.fhTrack("survey_answer", { survey: "apply", step_num: 9, question_id: "cf_svy_available_capital", last: true });
    const [first, last] = p.events("survey_answer");
    assert.deepEqual(fbqs(p), [
      ["trackCustom", "SurveyStep", { survey: "apply", step: 1 }, first.meta_event_id],
      ["track", "Lead", { content_name: "apply" }, last.meta_event_id],
      ["trackCustom", "SurveyStep", { survey: "apply", step: 9 }, last.meta_event_id],
    ]);
    assert.equal(last.meta_event_id, `${SID}.${last.seq}`);
  });

  test("/home: Lead only on the page's once-only last:true — a resend after a failed submit (no last) is not a second Lead", () => {
    const home = page({ hostname: "fundhub.ai", pathname: "/" }).run();
    home.win.fhTrack("survey_answer", { survey: "home", step_num: 1, question_id: "funding_target_amount" });
    home.win.fhTrack("survey_answer", { survey: "home", step_num: 10, question_id: "contact", last: true });
    home.win.fhTrack("survey_answer", { survey: "home", step_num: 10, question_id: "contact" });
    assert.deepEqual(named(home, "Lead").map((c) => c[2]), [{ content_name: "home" }]);

    const marked = page({ pathname: "/apply" }).run();
    marked.win.fhTrack("survey_answer", { survey: "apply", step_num: 8, question_id: "some_new_last_question", last: true });
    assert.equal(named(marked, "Lead").length, 1);
    assert.equal(marked.events("survey_answer")[0].props.last, true, "last rides to the database too");
  });
});

describe("InitiateCheckout, Purchase, ReachedBuyBox", () => {
  test("InitiateCheckout on the first buybox_tab tab 2 per session, 147 USD; tab 1 and repeats send nothing", () => {
    const p = page({ pathname: "/roadmap" }).run();
    p.win.fhTrack("buybox_tab", { tab: 1, bbv: 2 });
    p.win.fhTrack("buybox_tab", { tab: 2, bbv: 2 });
    p.win.fhTrack("buybox_tab", { tab: 1, bbv: 2 });
    p.win.fhTrack("buybox_tab", { tab: 2, bbv: 2 });
    const tabs = p.events("buybox_tab");
    assert.deepEqual(named(p, "InitiateCheckout"), [["track", "InitiateCheckout", { value: 147, currency: "USD" }, tabs[1].meta_event_id]]);
    assert.deepEqual(tabs.map((b) => "meta_event_id" in b), [false, true, false, false]);

    const reload = page({ pathname: "/roadmap", storage: p.store }).run();
    reload.win.fhTrack("buybox_tab", { tab: 2, bbv: 2 });
    assert.equal(named(reload, "InitiateCheckout").length, 0, "once per session, not per page load");
  });

  test("Purchase: eventID purchase.<order_ref>, 147 USD, once per order", () => {
    const ref = "slo_0123456789abcdef01234567";
    const p = page({ pathname: "/roadmap" }).run();
    p.win.fhTrack("payment_result", { result: "fail", code: "card_declined", bbv: 2 });
    p.win.fhTrack("payment_result", { result: "success", order_ref: ref, bbv: 2 });
    p.win.fhTrack("payment_result", { result: "success", order_ref: ref, bbv: 2 });
    const results = p.events("payment_result");
    assert.deepEqual(named(p, "Purchase"), [["track", "Purchase", { value: 147, currency: "USD" }, `purchase.${ref}`]]);
    assert.deepEqual(results.map((b) => b.meta_event_id), [undefined, `purchase.${ref}`, undefined]);
    assert.equal(results[1].props.order_ref, ref, "order_ref is posted with the event");

    const reload = page({ pathname: "/roadmap", storage: p.store }).run();
    reload.win.fhTrack("payment_result", { result: "success", order_ref: ref, bbv: 2 });
    assert.equal(named(reload, "Purchase").length, 0, "a reload of the paid page is not a second Purchase");
    reload.win.fhTrack("payment_result", { result: "success", order_ref: "slo_ffffffffffffffffffffffff", bbv: 2 });
    assert.deepEqual(named(reload, "Purchase").map((c) => c[3]), ["purchase.slo_ffffffffffffffffffffffff"], "a new order is a new Purchase");
  });

  test("no usable order_ref: no browser Purchase (the payment webhook sends it), and a junk ref is not posted", () => {
    const p = page({ pathname: "/roadmap" }).run();
    p.win.fhTrack("payment_result", { result: "success", bbv: 2 });
    for (const bad of ["has space", "a@b.co", "x".repeat(65), "slo_1;drop", 12345]) {
      p.win.fhTrack("payment_result", { result: "success", order_ref: bad, bbv: 2 });
    }
    assert.equal(named(p, "Purchase").length, 0);
    for (const b of p.events("payment_result")) {
      assert.equal("order_ref" in b.props, false);
      assert.equal("meta_event_id" in b, false);
    }
  });

  test("ReachedBuyBox: the first section_view of fh-cf-form or fhw per page load", () => {
    const p = page({ pathname: "/roadmap" }).run();
    p.win.fhTrack("section_view", { section: "fh-order" });
    p.win.fhTrack("section_view", { section: "fh-cf-form" });
    p.win.fhTrack("section_view", { section: "fhw" });
    const views = p.events("section_view");
    assert.deepEqual(named(p, "ReachedBuyBox"), [["trackCustom", "ReachedBuyBox", {}, views[1].meta_event_id]]);
    assert.deepEqual(views.map((b) => "meta_event_id" in b), [false, true, false]);

    const reload = page({ pathname: "/roadmap", storage: p.store }).run();
    reload.win.fhTrack("section_view", { section: "fhw" });
    assert.equal(named(reload, "ReachedBuyBox").length, 1, "per page load: a new load counts again");
  });
});

describe("never PII in custom_data; fbq never breaks the page", () => {
  test("field values, survey answers, email and phone never reach fbq", () => {
    const p = page({ pathname: "/apply" }).run();
    const junk = { answer: "$50,000", email: "pat@gmail.com", phone: "4155550134", value: "742 Evergreen", first_name: "Pat", ssn: "123456789", dob: "01/02/1980" };
    p.win.fhTrack("survey_answer", { survey: "apply", step_num: 9, question_id: "cf_svy_available_capital", ...junk });
    p.win.fhTrack("booking_confirmed", { calendar: "funding-book-call", ...junk });
    p.win.fhTrack("softpull_submit", { businesses: 1, ...junk });
    p.win.fhTrack("survey_route", { survey: "apply", offer: "slo", ...junk });
    const allowed = { ViewContent: ["content_name"], Lead: ["content_name"], SurveyStep: ["survey", "step"], Schedule: ["content_name"],
      SoftPullSubmitted: ["businesses"], SurveyRouted: ["offer"] };
    for (const [, name, cd] of fbqs(p)) {
      assert.ok(allowed[name], name);
      for (const k of Object.keys(cd)) assert.ok(allowed[name].includes(k), `${name}.${k}`);
    }
    const all = JSON.stringify(p.fbqCalls);
    for (const v of ["50,000", "pat@gmail.com", "4155550134", "Evergreen", "Pat", "123456789", "1980"]) {
      assert.equal(all.includes(v), false, `${v} must never reach Meta`);
    }
  });

  test("no pixel on the page: the post still carries meta_event_id, and nothing throws", () => {
    const p = makePage({ pathname: "/roadmap", fhPv: PV, storage: { fh_sid: SID } }).run();
    p.win.fhTrack("continue", { step: 1, bbv: 2 });
    assert.equal(p.events("continue")[0].meta_event_id, `${SID}.2`);
  });

  test("an fbq that throws does not stop the post", () => {
    const p = makePage({ pathname: "/roadmap", storage: { fh_sid: SID } });
    p.win.fbq = () => { throw new Error("pixel broke"); };
    p.run();
    p.win.fhTrack("continue", { step: 1 });
    assert.equal(p.events("continue").length, 1);
  });

  test("fbq loaded after the tracker is used from then on", () => {
    const p = makePage({ pathname: "/roadmap", storage: { fh_sid: SID } }).run();
    const late = [];
    p.win.fbq = (...a) => late.push(a);
    p.win.fhTrack("continue", { step: 1 });
    assert.deepEqual(late.map((a) => [a[1], a[3].eventID]), [["Lead", `${SID}.2`]]);
  });

  test("an automated browser never calls fbq; the post still carries the id for the server to judge", () => {
    const p = page({ pathname: "/roadmap", webdriver: true }).run();
    p.win.fhTrack("continue", { step: 1 });
    p.win.fhTrack("buybox_tab", { tab: 2 });
    assert.equal(p.fbqCalls.length, 0);
    assert.equal(p.events("continue")[0].meta_event_id, `${SID}.2`);
    assert.equal(p.events("buybox_tab")[0].webdriver, true);
  });
});

describe("fbclid, fbc, fbp and url on every post", () => {
  test("url is origin + path, never the query; fbp and fbc come from Meta's cookies", () => {
    const fbc = `fb.1.1700000000123.${FBCLID}`;
    const p = page({ pathname: "/roadmap/", search: "?utm_source=fb&email=pat%40gmail.com", cookie: `a=1; _fbp=${FBP}; _fbc=${fbc}` }).run();
    p.win.fhTrack("scroll", { depth: 25 });
    for (const b of p.bodies()) {
      assert.equal(b.url, "https://apply.fundhub.ai/roadmap/");
      assert.equal(b.fbp, FBP);
      assert.equal(b.fbc, fbc);
    }
  });

  test("no _fbc cookie: fbc = fb.1.<ms>.<fbclid> from the landing URL, saved first touch in fh_attribution", () => {
    const p = page({ pathname: "/watch", search: `?utm_source=fb&fbclid=${FBCLID}` });
    p.clock.now = 1_700_000_000_000;
    const ms = p.clock.now;
    p.run();
    const want = `fb.1.${ms}.${FBCLID}`;
    assert.equal(p.bodies()[0].fbc, want);
    assert.equal("fbp" in p.bodies()[0], false, "no _fbp cookie, no fbp");
    const saved = JSON.parse(p.store.fh_attribution);
    assert.equal(saved.fbclid, FBCLID);
    assert.equal(saved.fbc, want);

    // The next page has no fbclid in its URL, and a later click id does not replace the first.
    p.clock.now += 60_000;
    const next = page({ pathname: "/apply", search: "?fbclid=IwARsecondclick", storage: p.store }).run();
    assert.equal(next.bodies()[0].fbc, want);
    assert.equal(JSON.parse(next.store.fh_attribution).fbclid, FBCLID);
  });

  test("fbc already built by fh-attribution.js is used as is; Meta's _fbc cookie wins over it", () => {
    const built = `fb.1.1700000000999.${FBCLID}`;
    const storage = { fh_attribution: JSON.stringify({ utm_source: "fb", fbclid: FBCLID, fbc: built }) };
    assert.equal(page({ pathname: "/roadmap", storage }).run().bodies()[0].fbc, built);
    const cookieFbc = "fb.1.1700000000555.IwARfromcookie";
    assert.equal(page({ pathname: "/roadmap", storage, cookie: `_fbc=${cookieFbc}` }).run().bodies()[0].fbc, cookieFbc);
  });

  test("a junk fbclid or cookie is never sent", () => {
    for (const search of ["?fbclid=a%40b.co", `?fbclid=${"x".repeat(501)}`, "?fbclid=", "?fbclid=has%20space"]) {
      const p = page({ pathname: "/roadmap", search, cookie: "_fbp=not-a-cookie; _fbc=fb.1.x.y" }).run();
      const b = p.bodies()[0];
      assert.equal("fbc" in b, false, search);
      assert.equal("fbp" in b, false, search);
      assert.equal(JSON.parse(p.store.fh_attribution || "{}").fbclid, undefined, search);
    }
  });

  test("the fbclid is not sent as its own field on track posts (fbc carries it)", () => {
    const p = page({ pathname: "/watch", search: `?fbclid=${FBCLID}` }).run();
    assert.equal("fbclid" in p.bodies()[0], false);
  });
});

test("the browser's price is the server's price (src/meta/map.mjs SLO_VALUE, from SLO_PRICE_CENTS)", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../../public/funnel/fh-events.js", import.meta.url)), "utf8");
  const m = src.match(/var PRICE = \{ value: (\d+(?:\.\d+)?), currency: "([A-Z]{3})" \};/);
  assert.ok(m, "fh-events.js has one PRICE line");
  assert.equal(Number(m[1]), SLO_VALUE, "Meta keeps the copy it gets first, usually the browser's");
  assert.equal(m[2], CURRENCY);
});
