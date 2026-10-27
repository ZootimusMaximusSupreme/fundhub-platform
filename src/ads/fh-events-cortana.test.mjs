import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePage, SRC } from "./fh-events-harness.mjs";

const SID = "sess-abcdef12";

function page(opts = {}) {
  return makePage({ pathname: "/watch", cortana: true, ...opts,
    storage: { fh_sid: SID, ...(opts.storage || {}) } }).run();
}

function names(p) { return p.cortanaCalls.map(([name]) => name); }

test("free watch view reaches Cortana once with safe identity and attribution", () => {
  const p = page({
    cookie: "ak_tid=tid-12345678; _fbp=fb.1.1700000000000.1234567890",
    storage: { fh_attribution: JSON.stringify({ utm_source: "meta", utm_content: "ad-42", email: "hidden@example.com" }) }
  });
  assert.deepEqual(names(p), ["book_call_watch_view"]);
  const [name, data] = p.cortanaCalls[0];
  assert.equal(name, "book_call_watch_view");
  assert.equal(data.event_id, `dr.b.book_call_watch_view.${SID}`);
  assert.equal(data.schema_version, "fh-cortana-v1");
  assert.equal(data.funnel, "book_call");
  assert.equal(data.page_path, "/watch");
  assert.equal(data.ak_tid, "tid-12345678");
  assert.equal(data.utm_content, "ad-42");
  assert.equal(data.fbp, "fb.1.1700000000000.1234567890");
  assert.equal("email" in data, false);
  assert.equal("value" in data, false);
  assert.equal("currency" in data, false);
  assert.ok(data.occurred_at.endsWith("Z"));

  const reload = page({ storage: p.store });
  assert.deepEqual(names(reload), []);
});

test("application milestones, calendar and booking message are first-occurrence observations", () => {
  const p = page({ pathname: "/apply" });
  p.win.fhTrack("survey_answer", { survey: "apply", step_num: 1, answer: "private" });
  p.win.fhTrack("survey_answer", { survey: "apply", step_num: 9, last: true });
  p.win.fhTrack("survey_answer", { survey: "apply", step_num: 9, last: true });
  for (const event of ["calendar_view", "time_selected", "booking_confirmed", "booking_confirmed"]) {
    p.fireWin("message", { origin: "https://apply.fundhub.ai",
      data: { fh: "track", event, props: { calendar: "funding-book-call" } } });
  }
  assert.deepEqual(names(p), [
    "book_call_apply_view", "book_call_apply_started", "book_call_apply_final_answer",
    "book_call_calendar_view", "book_call_time_selected", "book_call_booking_observed"
  ]);
  assert.equal(p.events("booking_confirmed").length, 2, "Fundhub's source events are not suppressed");
  assert.ok(p.cortanaCalls.every(([, data]) => data.session_id === SID));
  assert.ok(p.cortanaCalls.every(([, data]) => !JSON.stringify(data).includes("private")));
  assert.ok(p.cortanaCalls.every(([, data]) => !("value" in data)));

  const reload = page({ pathname: "/apply", storage: p.store });
  reload.win.fhTrack("booking_confirmed", { calendar: "funding-book-call" });
  assert.deepEqual(names(reload), []);
});

test("thank-you is not a purchase; paid funnel and rejected relay do not create free milestones", () => {
  const thanks = page({ pathname: "/thank-you" });
  assert.deepEqual(names(thanks), ["book_call_thank_you_view"]);
  thanks.win.fhTrack("survey_route", { offer: "call-booked" });
  assert.deepEqual(names(thanks), ["book_call_thank_you_view"]);

  const paid = page({ pathname: "/roadmap" });
  paid.win.fhTrack("survey_answer", { last: true });
  paid.win.fhTrack("booking_confirmed", { calendar: "funding-book-call" });
  assert.deepEqual(names(paid), []);

  const rejected = page({ pathname: "/apply" });
  rejected.fireWin("message", { origin: "https://untrusted.example",
    data: { fh: "track", event: "booking_confirmed", props: {} } });
  assert.deepEqual(names(rejected), ["book_call_apply_view"]);
});

test("portal App Store tap reaches Cortana without a page-view milestone", () => {
  const p = page({ pathname: "/portal-login.html", hostname: "fundhub.ai" });
  assert.deepEqual(names(p), []);
  const [link] = p.addHtml('<a href="https://apps.apple.com/us/app/fundhub-portal/id6823985032">Get Fundhub Portal</a>');
  p.click(link);
  assert.deepEqual(names(p), ["book_call_app_download_tap"]);
  assert.equal(p.cortanaCalls[0][1].page_path, "/portal-login.html");
  assert.equal(p.events("app_download_tap").length, 1);
  p.click(link);
  assert.deepEqual(names(p), ["book_call_app_download_tap"]);
  assert.equal(p.events("app_download_tap").length, 2);
});

test("async Cortana hub receives queued first view; missing or throwing hub never blocks Fundhub", () => {
  const late = makePage({ pathname: "/watch", storage: { fh_sid: SID } }).run();
  assert.equal(late.events("page_view").length, 1);
  const calls = [];
  late.win.CortanaTracking = { trackEvent: (name, data) => calls.push([name, data]) };
  late.advance(250);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "book_call_watch_view");

  const broken = makePage({ pathname: "/watch", storage: { fh_sid: SID }, cortana: true });
  broken.win.akTracking = { trackEvent() { throw new Error("provider down"); } };
  broken.run();
  assert.equal(broken.events("page_view").length, 1);
  assert.equal(JSON.parse(broken.store.fh_dr_pending_v1).length, 1, "a thrown call stays queued");

  const bot = page({ webdriver: true });
  assert.deepEqual(names(bot), []);
  assert.equal(bot.events("page_view").length, 1);
});

test("a hub arriving after ten seconds receives the saved milestone once", () => {
  const p = makePage({ pathname: "/watch", storage: { fh_sid: SID } }).run();
  p.advance(11_000);
  assert.equal(JSON.parse(p.store.fh_dr_pending_v1).length, 1);
  const accepted = [];
  p.win.akTracking = { trackEvent: (name, data) => accepted.push([name, data]) };
  p.advance(5_000);
  assert.deepEqual(accepted.map(([name]) => name), ["book_call_watch_view"]);
  assert.equal(p.store.fh_dr_book_call_watch_view, "1");
  assert.deepEqual(JSON.parse(p.store.fh_dr_pending_v1), []);
  p.advance(10_000);
  assert.equal(accepted.length, 1);
});

test("rejected hub promise retries, and only acceptance clears the session record", async () => {
  const p = makePage({ pathname: "/watch", storage: { fh_sid: SID } });
  const calls = [];
  p.win.akTracking = { trackEvent: (name, data) => {
    calls.push([name, data]);
    if (calls.length === 1) return Promise.reject(new Error("hub unavailable"));
    if (calls.length === 2) return Promise.resolve({ ok: false });
    return Promise.resolve();
  } };
  p.run();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(p.store.fh_dr_book_call_watch_view, undefined);
  assert.equal(JSON.parse(p.store.fh_dr_pending_v1).length, 1);
  p.advance(250);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 2);
  assert.equal(p.store.fh_dr_book_call_watch_view, undefined);
  p.advance(250);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 3);
  assert.equal(calls[0][1].event_id, calls[1][1].event_id);
  assert.equal(p.store.fh_dr_book_call_watch_view, "1");
  assert.deepEqual(JSON.parse(p.store.fh_dr_pending_v1), []);
});

test("reload recovers a rejected milestone without a duplicate after acceptance", () => {
  const first = makePage({ pathname: "/watch", storage: { fh_sid: SID } });
  first.win.akTracking = { trackEvent() { throw new Error("hub unavailable"); } };
  first.run();
  first.advance(10_500);
  assert.equal(JSON.parse(first.store.fh_dr_pending_v1).length, 1);
  assert.equal(first.store.fh_dr_book_call_watch_view, undefined);

  const recovered = page({ storage: first.store });
  assert.deepEqual(names(recovered), ["book_call_watch_view"]);
  assert.equal(recovered.cortanaCalls[0][1].event_id, `dr.b.book_call_watch_view.${SID}`);
  assert.equal(recovered.store.fh_dr_book_call_watch_view, "1");
  assert.deepEqual(JSON.parse(recovered.store.fh_dr_pending_v1), []);
  const again = page({ storage: recovered.store });
  assert.deepEqual(names(again), []);
});

test("restored queue drops unsafe data and keeps Cortana fields non-revenue", () => {
  const p = page({
    storage: {
      fh_attribution: JSON.stringify({ utm_source: "meta", utm_campaign: "buyer@example.com", utm_content: "ad-42" }),
      fh_dr_pending_v1: JSON.stringify([
        { name: "book_call_watch_view", page: "/watch", sid: SID, at: 1_000_000, email: "buyer@example.com" },
        { name: "purchase", page: "/order", sid: SID, at: 1_000_000 }
      ])
    }
  });
  assert.deepEqual(names(p), ["book_call_watch_view"]);
  const data = p.cortanaCalls[0][1];
  assert.equal(data.utm_source, "meta");
  assert.equal(data.utm_content, "ad-42");
  assert.equal("utm_campaign" in data, false);
  assert.equal("email" in data, false);
  assert.equal("value" in data, false);
  assert.equal("currency" in data, false);
});

test("a stored free-call milestone does not replay from a paid page or an automated browser", () => {
  const pending = JSON.stringify([{ name: "book_call_watch_view", page: "/watch", sid: SID, at: 1_000_000 }]);
  const storage = { fh_sid: SID, fh_dr_pending_v1: pending };
  const paid = page({ pathname: "/roadmap", storage });
  assert.deepEqual(names(paid), []);
  assert.equal(paid.store.fh_dr_pending_v1, pending);
  const bot = page({ webdriver: true, storage });
  assert.deepEqual(names(bot), []);
  assert.equal(bot.store.fh_dr_pending_v1, pending);
});

test("application step loads the Fundhub hub only when its page lacks the pixel", () => {
  const hub = "https://app.directroas.com/api/hub/v1/cmsdutl8e00mukv041vwuo39w";
  const missing = makePage({ pathname: "/apply", storage: { fh_sid: SID } }).run();
  const added = missing.document.querySelectorAll("script");
  assert.equal(added.length, 1);
  assert.equal(added[0].getAttribute("src"), hub);
  const received = [];
  missing.win.akTracking = { trackEvent: (name) => received.push(name) };
  missing.advance(250);
  assert.deepEqual(received, ["book_call_apply_view"]);

  const present = makePage({ pathname: "/apply", storage: { fh_sid: SID } });
  present.html.append(present.node("script", { attrs: { src: hub } }));
  present.run();
  assert.equal(present.document.querySelectorAll("script").length, 1);

  const paid = makePage({ pathname: "/roadmap", storage: { fh_sid: SID } }).run();
  assert.equal(paid.document.querySelectorAll("script").length, 0);
});

test("the spec names every Cortana milestone the tracker can send, and no other", () => {
  const spec = fs.readFileSync(new URL("../../docs/tracking/tracking-spec.md", import.meta.url), "utf8");
  const inSpec = new Set([...spec.matchAll(/`(book_call_[a-z_]+)`/g)].map((m) => m[1]));
  const allowed = new Set([...SRC.matchAll(/^\s+(book_call_[a-z_]+): \{/gm)].map((m) => m[1]));
  const named = new Set([...SRC.matchAll(/"(book_call_[a-z_]+)"/g)].map((m) => m[1]));
  assert.equal(allowed.size, 9);
  assert.deepEqual([...named].sort(), [...allowed].sort(), "a milestone the tracker sends must be on CORTANA_PAGES, or a reload drops it");
  assert.deepEqual([...inSpec].sort(), [...allowed].sort());
});

// ── the app-download tap on /thank-you ──────────────────────────────────────
// Every card script in public/funnel/ named *-download.js (the Prompter card today,
// the company app card when it lands) runs on the fake page beside the real tracker,
// against a fake setting, and its own button is pressed. The setting carries every
// key a card has read or may read, so these tests do not pin which one it is. Which
// links count, and on which pages: src/ads/fh-events-track.test.mjs.
// Spec: docs/tracking/tracking-spec.md, "App download tap".

const TESTFLIGHT = "https://testflight.apple.com/join/AbC123xyz";
const APP_STORE = "https://apps.apple.com/us/app/fundhub/id1234567890";
const APPLE = /^https:\/\/(testflight|apps)\.apple\.com\//;
const SETTING = { testflight_url: TESTFLIGHT, app_store_url: APP_STORE, listing_verified: true };
const NO_LINK = [
  {},
  { testflight_url: "", app_store_url: "", listing_verified: true },
  { testflight_url: "https://example.com/join/AbC123xyz", app_store_url: "https://example.com/app/id1234567890", listing_verified: true }
];
const TAP = "book_call_app_download_tap";
const CARDS = fs.readdirSync(new URL("../../public/funnel/", import.meta.url)).filter((f) => /-download\.js$/.test(f)).sort();

async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

/** /thank-you the way ClickFunnels serves it (a .fh-root with a .hero), then the tracker, then one card script. */
async function thanks(cardSrc, { config = SETTING, ...opts } = {}) {
  const p = makePage({ pathname: "/thank-you", cortana: true, fetchJson: config, ...opts,
    storage: { fh_sid: SID, ...(opts.storage || {}) } });
  p.addHtml('<div class="fh-root"><div class="hero"></div></div>');
  p.run().runScript(cardSrc);
  await settle();
  return p;
}

/** The card's button: the one link on the page that goes to Apple. */
const downloadButton = (p) => p.document.querySelectorAll("a[href]").find((a) => APPLE.test(a.getAttribute("href"))) || null;

test("there is at least one card script to run", () => {
  assert.ok(CARDS.length >= 1, "public/funnel/ has no *-download.js");
});

for (const file of CARDS) {
  const src = fs.readFileSync(new URL(`../../public/funnel/${file}`, import.meta.url), "utf8");

  test(`${file}: a press on the card's button is one Fundhub event each time and one Cortana milestone`, async () => {
    const p = await thanks(src, {
      cookie: "ak_tid=tid-12345678",
      storage: { fh_attribution: JSON.stringify({ utm_source: "meta", utm_content: "ad-42", email: "hidden@example.com" }) }
    });
    assert.equal(p.fetchCalls.length, 1, "the card read its setting");
    assert.match(p.fetchCalls[0], /^https:\/\/fundhub\.ai\/funnel\/.+\.json$/);
    const button = downloadButton(p);
    assert.ok(button, "the card drew its button");
    assert.match(button.textContent, /Download for iPhone/);
    assert.match(p.document.querySelector(".fh-prompter-download__note").textContent, /web portal/);
    assert.deepEqual(names(p), ["book_call_thank_you_view"], "seeing the card is not a tap");
    assert.equal(p.events("app_download_tap").length, 0);

    p.click(button.children[0] || button); // the arrow inside the link, when there is one
    assert.deepEqual(names(p), ["book_call_thank_you_view", TAP]);
    const [, data] = p.cortanaCalls[1];
    assert.deepEqual(Object.keys(data).sort(), [
      "ak_tid", "event_id", "funnel", "occurred_at", "page_path", "schema_version", "session_id", "stage",
      "utm_content", "utm_source"
    ], "the same envelope as the other eight");
    assert.equal(data.event_id, `dr.b.${TAP}.${SID}`);
    assert.equal(data.schema_version, "fh-cortana-v1");
    assert.equal(data.funnel, "book_call");
    assert.equal(data.stage, TAP);
    assert.equal(data.page_path, "/thank-you");
    assert.equal(data.session_id, SID);
    assert.equal(data.ak_tid, "tid-12345678");
    assert.equal(data.utm_content, "ad-42");
    assert.ok(data.occurred_at.endsWith("Z"));
    assert.equal(JSON.stringify(data).includes("apple.com"), false, "the link is not sent to Cortana");
    assert.equal(JSON.stringify(data).includes("hidden@example.com"), false);

    const taps = p.events("app_download_tap");
    assert.equal(taps.length, 1);
    assert.deepEqual(taps[0].props, {});
    assert.equal(taps[0].page, "/thank-you");
    assert.equal(p.events("click").length, 1, "the press is still an ordinary click too");

    p.click(button);
    p.click(button);
    assert.equal(p.events("app_download_tap").length, 3, "every press is saved, as a click is");
    assert.deepEqual(names(p), ["book_call_thank_you_view", TAP], "Cortana hears the first press only");
    assert.equal(p.store[`fh_dr_${TAP}`], "1");

    const reload = await thanks(src, { storage: p.store });
    reload.click(downloadButton(reload));
    assert.deepEqual(names(reload), [], "a reload does not count it again");
    assert.equal(reload.events("app_download_tap").length, 1);
  });

  test(`${file}: drawing the card, reloading and pressing anything but its link is never a tap`, async () => {
    const p = await thanks(src);
    const button = downloadButton(p);
    assert.ok(button, "the card drew its button");
    p.click(button.parentNode); // the card, off its link
    const [back] = p.addHtml('<a id="back" href="https://apply.fundhub.ai/watch">Back to the video</a>');
    p.click(back);
    assert.deepEqual(names(p), ["book_call_thank_you_view"]);
    assert.equal(p.events("app_download_tap").length, 0);
    const again = await thanks(src, { storage: p.store });
    assert.deepEqual(names(again), []);
    assert.equal(again.events("app_download_tap").length, 0);

    // The live setting is empty today: no card is drawn, so there is nothing to tap.
    for (const config of NO_LINK) {
      const none = await thanks(src, { config });
      assert.equal(downloadButton(none), null, JSON.stringify(config));
      assert.deepEqual(names(none), ["book_call_thank_you_view"]);
    }
  });

  test(`${file}: a missing or broken hub never blocks the Fundhub event; the tap waits and is sent once the hub is there`, async () => {
    const missing = await thanks(src, { cortana: false });
    missing.click(downloadButton(missing));
    assert.equal(missing.events("app_download_tap").length, 1);
    assert.deepEqual(JSON.parse(missing.store.fh_dr_pending_v1).map((item) => item.name), ["book_call_thank_you_view", TAP]);
    const got = [];
    missing.win.akTracking = { trackEvent: (name) => got.push(name) };
    missing.advance(250);
    assert.deepEqual(got, ["book_call_thank_you_view", TAP]);
    assert.equal(missing.store[`fh_dr_${TAP}`], "1");
    assert.deepEqual(JSON.parse(missing.store.fh_dr_pending_v1), []);
    missing.advance(10_000);
    assert.equal(got.length, 2, "sent once");

    const broken = await thanks(src, { cortana: false });
    broken.win.akTracking = { trackEvent() { throw new Error("provider down"); } };
    broken.click(downloadButton(broken));
    broken.advance(1_000);
    assert.equal(broken.events("app_download_tap").length, 1);
    assert.ok(JSON.parse(broken.store.fh_dr_pending_v1).some((item) => item.name === TAP), "a thrown call stays queued");
    assert.equal(broken.store[`fh_dr_${TAP}`], undefined);
  });

  test(`${file}: an automated browser never reaches Cortana, but the Fundhub event goes, marked webdriver`, async () => {
    const bot = await thanks(src, { webdriver: true });
    bot.click(downloadButton(bot));
    assert.deepEqual(names(bot), []);
    assert.equal(bot.store.fh_dr_pending_v1, undefined);
    assert.deepEqual(bot.events("app_download_tap").map((b) => b.webdriver), [true]);
  });

  test(`${file}: a tap saved while the hub was away goes out after a reload, once; a saved tap for another page is dropped`, async () => {
    const first = await thanks(src, { cortana: false });
    first.click(downloadButton(first));
    const back = await thanks(src, { storage: first.store });
    assert.deepEqual(names(back), ["book_call_thank_you_view", TAP]);
    assert.equal(back.cortanaCalls[1][1].event_id, `dr.b.${TAP}.${SID}`);
    assert.deepEqual(JSON.parse(back.store.fh_dr_pending_v1), []);
    assert.deepEqual(names(await thanks(src, { storage: back.store })), []);

    const otherPages = JSON.stringify(["/watch", "/apply", "/order"].map((page) => ({ name: TAP, page, sid: SID, at: 1_000_000 })));
    const dropped = await thanks(src, { storage: { fh_dr_pending_v1: otherPages } });
    assert.deepEqual(names(dropped), ["book_call_thank_you_view"]);
  });
}

test("a card with other markup, an App Store link and another setting key counts the same", () => {
  const p = page({ pathname: "/thank-you" });
  const [card] = p.addHtml(
    '<section id="fh-app-download" class="fh-app-download"><a class="fh-app-download__button" target="_blank" rel="noopener noreferrer" ' +
    'href="https://apps.apple.com/us/app/fundhub/id1234567890">View Fundhub on the App Store <span aria-hidden="true">→</span></a></section>');
  p.click(card.children[0]);
  assert.deepEqual(names(p), ["book_call_thank_you_view", TAP]);
  assert.equal(p.events("app_download_tap").length, 1);
});
