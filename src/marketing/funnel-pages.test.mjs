// The three pages of a dashboard-built funnel (build unit X4): every page's
// head carries the funnel tag and the tracking manifest's scripts, the words
// are escaped, and the booking page frames the live calendar.
// Pure: no database, no network.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage, esc, CALENDAR_URL } from "./funnel-pages.mjs";
import { funnelTagBlock, tagMeta, trackingGaps, pageDocument } from "./funnel-tracking.mjs";
import { pagePaths, FUNNEL_ROLES } from "./funnel-paths.mjs";
import {
  metaPixelHeadHtml, FH_ATTRIBUTION_SRC, FH_EVENTS_SRC, META_PIXEL_FALLBACK_ID, ga4HeadHtml
} from "../../marketing/landing-pages/tracking-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COPY = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/funnel-copy-good.json"), "utf8"));
const FUNNEL = {
  id: "00000000-0000-4000-8000-0000000000f1", tag: "fnl-blueprint", key: "blueprint",
  offer_key: "capital_blueprint", lane: "uwiq", path: "/blueprint"
};
const PATHS = pagePaths("/blueprint");
const ENV = { META_PIXEL_ID: "1234567890", GA_MEASUREMENT_ID: "G-TEST123" };
const page = (role) => renderPage({ funnel: FUNNEL, page: { role, path: PATHS[role] }, copy: COPY, paths: PATHS, env: ENV });
const headOf = (html) => html.split("</head>")[0];

describe("every page carries the tag and the tracking", () => {
  for (const role of FUNNEL_ROLES) {
    test(`${role}: the head has the funnel tag first, then the manifest's head`, () => {
      const html = page(role);
      const head = headOf(html);
      assert.ok(head.includes(tagMeta("fnl-blueprint")), "tag meta");
      assert.ok(head.indexOf("fh-funnel:start") < head.indexOf("fbq('init'"), "the tag comes before the pixel");
      assert.ok(head.includes(metaPixelHeadHtml("1234567890")), "the manifest's Meta pixel with PageView eventID");
      assert.ok(head.includes(ga4HeadHtml(ENV)), "GA4 from the manifest when its id is set");
      assert.ok(head.includes('src="https://sdk.myclickfunnels.com/sdk.js"'), "the ClickFunnels SDK");
      assert.ok(html.includes(`<script src="${FH_ATTRIBUTION_SRC}"></script>`), "fh-attribution.js");
      assert.ok(html.includes(`<script src="${FH_EVENTS_SRC}"></script>`), "fh-events.js");
      assert.deepEqual(trackingGaps(html, "fnl-blueprint"), []);
    });

    test(`${role}: window.FH_FUNNEL names this funnel and this page`, () => {
      const m = headOf(page(role)).match(/window\.FH_FUNNEL=(\{.*?\});<\/script>/);
      assert.ok(m, "the config block");
      const cfg = JSON.parse(m[1]);
      assert.deepEqual(cfg, {
        id: FUNNEL.id, tag: "fnl-blueprint", key: "blueprint", offer: "capital_blueprint", lane: "uwiq",
        page: { role, path: PATHS[role], step: FUNNEL_ROLES.indexOf(role) + 1 }
      });
    });
  }

  test("no pixel id in env: the pixel that has always been live", () => {
    const html = renderPage({ funnel: FUNNEL, page: { role: "landing", path: "/blueprint" }, copy: COPY, paths: PATHS, env: {} });
    assert.ok(html.includes(`fbq('init', '${META_PIXEL_FALLBACK_ID}')`));
    assert.ok(!html.includes("googletagmanager.com"), "no GA4 when no id is set");
  });

  test("trackingGaps names what is missing", () => {
    const gaps = trackingGaps("<html><head></head><body></body></html>", "fnl-x");
    assert.equal(gaps.length, 5);
    assert.match(gaps.join("\n"), /funnel tag fnl-x/);
  });

  test("the config cannot close its own script tag", () => {
    const block = funnelTagBlock({ ...FUNNEL, key: "</script><script>alert(1)</script>" }, { role: "landing", path: "/x" });
    assert.ok(!block.includes("</script><script>alert"), "escaped");
    assert.throws(() => funnelTagBlock(FUNNEL, { role: "nope", path: "/x" }), /unknown page role/);
  });

  test("a page token goes in the head when there is one", () => {
    const html = pageDocument({ funnel: FUNNEL, page: { role: "landing", path: "/blueprint" }, bodyHtml: "<p>x</p>", pageToken: "cfp_abc", env: ENV });
    assert.ok(headOf(html).includes('<meta name="cf-page-token" content="cfp_abc">'));
  });
});

describe("the pages", () => {
  test("landing: the words, both buttons to the booking page, the house footer", () => {
    const html = page("landing");
    assert.ok(html.includes(esc(COPY.landing.headline)));
    assert.equal((html.match(/data-fh-next href="\/blueprint-book"/g) || []).length, 2);
    for (const b of COPY.landing.bullets) assert.ok(html.includes(esc(b.title)));
    assert.equal((html.match(/<details data-fh-faq>/g) || []).length, COPY.landing.faq.length);
    assert.match(html, /Fundhub LLC is not a bank or a lender/);
    assert.match(html, /https:\/\/fundhub\.ai\/privacy\//);
  });

  test("booking: frames the live calendar, sizes it, sends a booked visitor to this funnel's thank-you page", () => {
    const html = page("booking");
    assert.equal(CALENDAR_URL, "https://apply.fundhub.ai/funding-book-call");
    assert.ok(html.includes(`<iframe id="fh-book-frame" title="Book your Fundhub call" src="${CALENDAR_URL}"`));
    assert.match(html, /fh-book-height/);
    assert.match(html, /var KEY='fh_booking_v1',TY="\/blueprint-thank-you"/);
    assert.ok(!html.includes("/roadmap-thank-you"), "never the roadmap's thank-you page");
  });

  test("thank-you: what happens next", () => {
    const html = page("thank_you");
    for (const s of COPY.thank_you.next_steps) assert.ok(html.includes(esc(s.title)));
    assert.ok(!html.includes("fh-book-frame"));
  });

  test("the words are escaped: a model cannot add a tag", () => {
    const evil = structuredClone(COPY);
    evil.landing.headline = '<img src=x onerror="alert(1)">';
    const html = renderPage({ funnel: FUNNEL, page: { role: "landing", path: "/blueprint" }, copy: evil, paths: PATHS, env: ENV });
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  });

  test("phone first: no text under 11px, 16px side gutters", () => {
    const html = page("landing");
    const sizes = [...html.matchAll(/font-size:([\d.]+)px/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 5);
    assert.ok(sizes.every((n) => n >= 11), `sizes under 11px: ${sizes.filter((n) => n < 11)}`);
    assert.match(html, /\.fh-f \.wrap\{max-width:760px;margin:0 auto;padding:0 16px\}/);
    assert.match(html, /min-height:52px/);
  });

  test("an unknown role is refused", () => {
    assert.throws(() => renderPage({ funnel: FUNNEL, page: { role: "x", path: "/x" }, copy: COPY, paths: PATHS, env: ENV }), /unknown page role/);
  });
});
