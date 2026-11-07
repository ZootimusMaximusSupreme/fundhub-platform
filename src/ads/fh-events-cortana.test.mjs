// Fundhub keeps its own page, survey, booking and app-click observations.
// Exercise both installed and missing vendor SDKs without contacting either.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makePage } from "./fh-events-harness.mjs";

const SID = "sess-abcdef12";
const names = p => p.cortanaCalls.map(([name]) => name);
const page = (opts = {}) => makePage({ cortana: true, ...opts, storage: { fh_sid: SID, ...opts.storage } }).run();

test("no browser loads, queues or replays a DirectROAS milestone on any tracked page", () => {
  const queue = JSON.stringify([{ name: "book_call_booking_observed", page: "/funding-book-call--02424", sid: SID, at: 1000000 }]);
  const pages = ["/watch", "/apply", "/home", "/funding-book-call", "/funding-book-call--02424",
    "/thank-you", "/thank-you--80c5a", "/portal-login.html", "/order", "/roadmap", "/roadmap-book", "/roadmap-thank-you",
    "/blueprint", "/blueprint-book"];
  for (const pathname of pages) {
    for (const installed of [false, true]) {
      const p = makePage({ pathname: pathname === "/home" ? "/" : pathname,
        hostname: pathname === "/home" ? "fundhub.ai" : "apply.fundhub.ai",
        cortana: installed, storage: { fh_sid: SID, fh_dr_pending_v1: queue } });
      if (pathname.startsWith("/blueprint")) p.win.FH_FUNNEL = { tag: "fnl-blueprint", page: { path: pathname } };
      p.run();
      const late = [];
      p.win.CortanaTracking = { trackEvent: (...args) => late.push(args) };
      for (const event of ["survey_answer", "calendar_view", "time_selected", "booking_confirmed", "app_download_tap"])
        p.win.fhTrack(event, { survey: "apply", last: true, calendar: "funding-book-call" });
      p.advance(35_000);
      assert.deepEqual(names(p), [], pathname);
      assert.deepEqual(late, [], pathname);
      assert.equal(p.store.fh_dr_pending_v1, queue, "the old vendor queue was never touched");
      assert.ok(p.sent.every(send => send.url === "https://fundhub.ai/api/public/slo-interest"));
      assert.ok(!p.document.querySelectorAll("script").some(el => /directroas/i.test(el.getAttribute("src") || "")));
      assert.equal(p.events("booking_confirmed").length, 1);
      assert.equal(p.events("app_download_tap").length, 1);
    }
  }
});

const TESTFLIGHT = "https://testflight.apple.com/join/AbC123xyz";
const APP_STORE = "https://apps.apple.com/us/app/fundhub-portal/id6823985032";
const APPLE = /^https:\/\/(testflight|apps)\.apple\.com\//;
const SETTING = { testflight_url: TESTFLIGHT, app_store_url: APP_STORE, listing_verified: true };
const NO_LINK = [
  {},
  { testflight_url: "", app_store_url: "", listing_verified: true },
  { testflight_url: "https://example.com/join/AbC123xyz", app_store_url: "https://example.com/app/id1234567890", listing_verified: true }
];
const CARDS = fs.readdirSync(new URL("../../public/funnel/", import.meta.url)).filter((f) => /-download\.js$/.test(f)).sort();

async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

/** /thank-you the way ClickFunnels serves it (a .fh-root with a .hero), then the tracker, then one card script. */
async function thanks(cardSrc, { config = SETTING, userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15", ...opts } = {}) {
  const p = makePage({ pathname: "/thank-you", cortana: true, fetchJson: config, ...opts,
    storage: { fh_sid: SID, ...(opts.storage || {}) } });
  p.addHtml('<div class="fh-root"><div class="hero"></div></div>');
  p.win.navigator.userAgent = userAgent;
  p.win.navigator.platform = /iPhone/.test(userAgent) ? "iPhone" : "";
  p.run().runScript(fs.readFileSync(new URL("../../public/funnel/device-destinations.js", import.meta.url), "utf8")).runScript(cardSrc);
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

  test(`${file}: each press on the card creates a Fundhub event without a vendor event`, async () => {
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
    assert.deepEqual(names(p), [], "seeing the card is not a tap");
    assert.equal(p.events("app_download_tap").length, 0);

    p.click(button.children[0] || button); // the arrow inside the link, when there is one
    assert.deepEqual(names(p), []);

    const taps = p.events("app_download_tap");
    assert.equal(taps.length, 1);
    assert.deepEqual(taps[0].props, {});
    assert.equal(taps[0].page, "/thank-you");
    assert.equal(p.events("click").length, 1, "the press is still an ordinary click too");

    p.click(button);
    p.click(button);
    assert.equal(p.events("app_download_tap").length, 3, "every press is saved, as a click is");
    assert.deepEqual(names(p), []);

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
    assert.deepEqual(names(p), []);
    assert.equal(p.events("app_download_tap").length, 0);
    const again = await thanks(src, { storage: p.store });
    assert.deepEqual(names(again), []);
    assert.equal(again.events("app_download_tap").length, 0);

    // Missing/rejected listings leave the browser card and no Apple download.
    for (const config of NO_LINK) {
      const none = await thanks(src, { config });
      assert.equal(downloadButton(none), null, JSON.stringify(config));
      assert.deepEqual(names(none), []);
    }
  });

  test(`${file}: non-Apple and uncertain visitors never create an Apple download or false download observation`, async () => {
    for (const userAgent of ["Mozilla/5.0 (Linux; Android 15)", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Private browser"]) {
      const p = await thanks(src, { userAgent });
      assert.equal(downloadButton(p), null);
      const browser = p.document.querySelector(".fh-prompter-download__button");
      assert.equal(browser.getAttribute("href"), "https://fundhub.ai/portal-login.html");
      p.click(browser);
      assert.equal(p.events("click").length, 1);
      assert.equal(p.events("app_download_tap").length, 0);
      assert.deepEqual(names(p), []);
    }
  });

  test(`${file}: an automated browser never reaches Cortana, but the Fundhub event goes, marked webdriver`, async () => {
    const bot = await thanks(src, { webdriver: true });
    bot.click(downloadButton(bot));
    assert.deepEqual(names(bot), []);
    assert.equal(bot.store.fh_dr_pending_v1, undefined);
    assert.deepEqual(bot.events("app_download_tap").map((b) => b.webdriver), [true]);
  });

  test(`${file}: an offline tap is saved internally and never replayed to a later vendor`, async () => {
    const first = await thanks(src, { cortana: false });
    first.click(downloadButton(first));
    assert.equal(first.events("app_download_tap").length, 1);
    const back = await thanks(src, { storage: first.store });
    back.advance(30_000);
    assert.deepEqual(names(back), []);
    assert.equal(back.store.fh_dr_pending_v1, undefined);
  });
}

test("a card with other markup, an App Store link and another setting key counts the same", () => {
  const p = page({ pathname: "/thank-you" });
  const [card] = p.addHtml(
    '<section id="fh-app-download" class="fh-app-download"><a class="fh-app-download__button" target="_blank" rel="noopener noreferrer" ' +
    'href="https://apps.apple.com/us/app/fundhub/id1234567890">View Fundhub on the App Store <span aria-hidden="true">→</span></a></section>');
  p.click(card.children[0]);
  assert.deepEqual(names(p), []);
  assert.equal(p.events("app_download_tap").length, 1);
});

test("the copied thank-you page preserves the first-party booking resend without calling a vendor", () => {
  const direct = page({ pathname: "/funding-book-call--02424", search: "?fh_tier=u" });
  direct.win.fhTrack("booking_confirmed", { calendar: "funding-book-call" });
  const thanks = page({ pathname: "/thank-you--80c5a", storage: direct.store });
  assert.deepEqual(thanks.events("page_view").map(row => row.page), ["/thank-you"]);
  assert.deepEqual(thanks.events("booking_confirmed"), direct.events("booking_confirmed"));
  assert.deepEqual(names(thanks), []);
  assert.equal(thanks.store.fh_dr_pending_v1, undefined);
});
