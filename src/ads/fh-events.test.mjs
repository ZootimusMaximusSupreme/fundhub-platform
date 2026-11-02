// src/ads/fh-events.test.mjs — step opens and button presses on /watch and /roadmap.
//
// public/funnel/fh-events.js is loaded on every step of both funnels and sends
// kind "track" events to api/public/slo-interest.mjs (docs/tracking/tracking-spec.md).
// This file holds the page open and the press labels; every other tracked event
// is in src/ads/fh-events-track.test.mjs. Both run the real script against the
// tiny fake page in src/ads/fh-events-harness.mjs.
//
// The door tests below still hold the old kinds "page" and "click", which the
// door keeps accepting unchanged (spec: "Old kinds ... keep working").
//
// WHAT THIS CANNOT TEST: a real browser, ClickFunnels, or Clarity. The live
// check is the Playwright / view-source walk recorded on the board.
//
// npm test's glob is src/** and scripts/** only (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { recordInterest } from "../../api/public/slo-interest.mjs";
import {
  PUSH_MANIFEST,
  FH_EVENTS_SRC,
  CLARITY_SRC,
  VSL_WATCH_BEACON_SRC,
  wrapCustomHtmlDocument,
  clarityHeadHtml,
  ga4HeadHtml,
  nextFooterCode,
} from "../../marketing/landing-pages/tracking-manifest.mjs";
import { makePage, SRC } from "./fh-events-harness.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const clicks = (p) => p.events("click").map((b) => b.props.label);

describe("fh-events.js, the page", () => {
  test("opening a step sends one page_view, once per session", () => {
    const p = makePage({ pathname: "/watch/", title: "Watch the video" }).run();
    assert.equal(p.sent.length, 1);
    assert.equal(p.sent[0].url, "https://fundhub.ai/api/public/slo-interest");
    const b = p.bodies()[0];
    assert.equal(b.kind, "track");
    assert.equal(b.event, "page_view");
    assert.equal(b.page, "/watch");
    assert.equal(b.seq, 1);
    assert.deepEqual(b.props, { title: "Watch the video" });
    assert.match(b.session_id, /^[A-Za-z0-9_-]{8,80}$/);
    const again = makePage({ pathname: "/watch", storage: p.store }).run();
    assert.equal(again.events("page_view").length, 0, "same session, same page: no second page_view");
  });

  test("a page that is not a funnel step sends nothing", () => {
    const p = makePage({ pathname: "/somewhere-else" });
    const a = p.node("a", { cls: ["btn"], text: "Go", attrs: { href: "/x" } });
    p.add(a).run();
    p.click(a);
    p.win.fhTrack("continue", { step: 1 });
    assert.equal(p.sent.length, 0);
  });

  test("the fundhub.ai homepage is /home; apply.fundhub.ai/ stays off the map; /order is on it", () => {
    for (const hostname of ["fundhub.ai", "www.fundhub.ai"]) {
      const p = makePage({ hostname, pathname: "/" }).run();
      assert.deepEqual(p.bodies().map((b) => [b.event, b.page]), [["page_view", "/home"]], hostname);
      assert.equal(p.store["fh_pg_/home"], "1");
    }
    assert.equal(makePage({ hostname: "apply.fundhub.ai", pathname: "/" }).run().sent.length, 0);
    assert.equal(makePage({ hostname: "fundhub.ai", pathname: "/pricing" }).run().sent.length, 0);
    assert.equal(makePage({ hostname: "apply.fundhub.ai", pathname: "/order/" }).run().bodies()[0].page, "/order");
  });

  test("the /funding-book-call calendar inside the /roadmap-book frame stays quiet", () => {
    const p = makePage({ pathname: "/funding-book-call", framed: true }).run();
    assert.equal(p.sent.length, 0);
    assert.equal(p.win.fhTrack, undefined);
  });

  test("an automated browser says so", () => {
    assert.equal(makePage({ pathname: "/watch", webdriver: true }).run().bodies()[0].webdriver, true);
  });
});

describe("fh-events.js, the presses", () => {
  test("the VSL 'Tap for sound' is named vsl:unmute; every press is sent, Clarity hears it once", () => {
    const p = makePage({ pathname: "/watch" });
    const overlay = p.node("div", { id: "fh-unmute", cls: ["unmute"] });
    const pill = p.node("span");
    overlay.append(pill);
    p.add(overlay).run();
    p.click(pill); p.click(pill);
    assert.deepEqual(clicks(p), ["vsl:unmute", "vsl:unmute"]);
    assert.equal(p.events("click")[0].props.element_id, "fh-unmute");
    assert.deepEqual(p.calls, [["event", "vsl:unmute"]], "Clarity hears the same press, once");
  });

  test("a click on the VSL itself counts only while the sound overlay is showing", () => {
    const p = makePage({ pathname: "/watch" });
    const overlay = p.node("div", { id: "fh-unmute", cls: ["unmute", "hidden"] });
    const video = p.node("video", { id: "fh-vsl", attrs: { autoplay: "" }, video: {} });
    p.add(overlay, video).run();
    p.click(video);
    assert.equal(p.events("click").length, 0);
  });

  test("a testimonial started by hand tells Clarity video:play:<file>; the VSL's own autoplay does not", () => {
    const p = makePage({ pathname: "/roadmap" });
    const gene = p.node("video", { video: { currentSrc: "https://fundhub.ai/funnel/slo-testimonial-gene.mp4" } });
    const vsl = p.node("video", { id: "fh-vsl", attrs: { autoplay: "" }, video: { currentSrc: "https://fundhub.ai/funnel/slo-vsl.mp4" } });
    p.add(gene, vsl).run();
    p.fireDoc("play", vsl); p.fireDoc("play", gene); p.fireDoc("play", gene);
    assert.deepEqual(p.calls, [["event", "video:play:slo-testimonial-gene"]]);
    assert.equal(p.events("click").length, 0, "a video start is a video event, not a click");
    assert.deepEqual(p.events("video").map((b) => b.props.video), ["slo-vsl", "slo-testimonial-gene", "slo-testimonial-gene"]);
  });

  test("the sticky roadmap bar is cta:sticky, not a second copy of the same words", () => {
    const p = makePage({ pathname: "/roadmap" });
    const bar = p.node("div", { id: "fh-sticky", css: { position: "fixed" } });
    const a = p.node("a", { cls: ["btn"], text: "Get My $297 Funding Roadmap", attrs: { href: "#fh-order" } });
    bar.append(a);
    p.add(bar).run();
    p.click(a);
    const c = p.events("click")[0].props;
    assert.equal(c.label, "cta:sticky");
    assert.equal(c.href_path, "#fh-order");
    assert.equal(c.section, "fh-sticky");
  });

  test("the testimonial Play button is not a click; it is a carousel play", () => {
    const p = makePage({ pathname: "/roadmap" });
    const grid = p.node("div", { cls: ["proofgrid"] });
    const card = p.node("figure", { cls: ["tcard"] });
    const btn = p.node("button", { cls: ["tplay"], text: "Play" });
    card.append(btn);
    grid.append(card);
    p.add(grid).run();
    p.click(btn);
    assert.equal(p.events("click").length, 0);
    assert.deepEqual(p.events("carousel").map((b) => b.props), [{ carousel: "testimonials", action: "play", index: 1 }]);
  });

  test("a CTA button is cta:<words>; two with the same words are told apart by order", () => {
    const p = makePage({ pathname: "/watch" });
    const a = p.node("a", { cls: ["btn"], text: "Get Started", attrs: { href: "/apply" } });
    const b = p.node("a", { cls: ["btn"], text: "Get Started", attrs: { href: "/apply" } });
    p.add(a, b).run();
    p.click(a); p.click(b);
    assert.deepEqual(clicks(p), ["cta:get-started", "cta:get-started-2"]);
    assert.deepEqual(p.events("click").map((c) => c.props.nth), [1, 2]);
  });

  test("a plain link is click:<words>; a pay button is a cta", () => {
    const p = makePage({ pathname: "/roadmap" });
    const link = p.node("a", { text: "Talk to us first", attrs: { href: "https://apply.fundhub.ai/roadmap-book" } });
    const pay = p.node("button", { text: "Pay $297", attrs: { "data-pay": "" } });
    p.add(link, pay).run();
    p.click(link); p.click(pay);
    assert.deepEqual(clicks(p), ["click:talk-to-us-first", "cta:pay-297"]);
    assert.equal(p.events("click")[0].props.href_path, "/roadmap-book");
  });

  test("data-fh-track names a button on purpose", () => {
    const p = makePage({ pathname: "/thank-you" });
    const b = p.node("button", { text: "Go", attrs: { "data-fh-track": "Book Call Top" } });
    p.add(b).run();
    p.click(b);
    assert.equal(p.events("click")[0].props.label, "click:book-call-top");
  });

  test("a click on something that is not a button sends nothing", () => {
    const p = makePage({ pathname: "/watch" });
    const para = p.node("p", { text: "Some words" });
    p.add(para).run();
    p.click(para);
    assert.equal(p.events("click").length, 0);
  });
});

describe("the door accepts exactly what the script sends", () => {
  const capture = () => {
    const events = [];
    return { events, emit: async (_d, name, payload, opts) => { events.push({ name, payload, opts }); return { id: "e", deduped: false }; } };
  };
  const deps = (cap) => ({ emit: cap.emit, orgId: "org-1", db: { query: async () => ({ rows: [{ n: 0 }] }) }, userAgent: "Mozilla/5.0" });

  test("the script's page map is the spec's page map, row for row", () => {
    const spec = fs.readFileSync(path.join(ROOT, "docs/tracking/tracking-spec.md"), "utf8");
    const table = spec.slice(spec.indexOf("## Pages → funnel and step"), spec.indexOf("## Events"));
    const want = [...table.matchAll(/^\| (\/[a-z0-9-]+) \| ([a-z-]+) \| (\d+) \|$/gm)].map((m) => [m[1], m[2], Number(m[3])]);
    const got = [...SRC.match(/var PAGES = \{([\s\S]*?)\};/)[1].matchAll(/"(\/[a-z0-9-]+)": \["([a-z-]+)", (\d+)\]/g)].map((m) => [m[1], m[2], Number(m[3])]);
    assert.ok(want.length >= 9, "the spec table was read");
    assert.deepEqual(got, want);
  });

  test("the seven /watch and /roadmap steps still open through the old kind \"page\"", async () => {
    const listed = ["/watch", "/apply", "/funding-book-call", "/thank-you", "/roadmap", "/roadmap-book", "/roadmap-thank-you"];
    for (const page of listed) {
      const cap = capture();
      const out = await recordInterest({ kind: "page", session_id: "sess-abcdef12", page }, deps(cap));
      assert.equal(out.ok, true, page);
      assert.equal(cap.events[0].name, "funnel.page");
      assert.equal(cap.events[0].opts.idempotencyKey, `funnel-page:sess-abcdef12:${page}`);
      assert.equal(cap.events[0].opts.skipInngest, true, "page opens stay local-only");
    }
  });

  test("a click is one row per session, page and button", async () => {
    const cap = capture();
    const out = await recordInterest({
      kind: "click", session_id: "sess-abcdef12", page: "/roadmap/", target: "VSL:Unmute",
      utm_content: "42-phase", utm_source: "fb", webdriver: false,
    }, deps(cap));
    assert.equal(out.ok, true);
    assert.equal(out.actor, "person");
    assert.equal(cap.events[0].name, "funnel.click");
    assert.equal(cap.events[0].opts.idempotencyKey, "funnel-click:sess-abcdef12:/roadmap:vsl:unmute");
    assert.equal(cap.events[0].payload.target, "vsl:unmute");
    assert.equal(cap.events[0].payload.page, "/roadmap");
    assert.equal(cap.events[0].payload.attribution.utm_content, "42-phase");
    assert.equal(cap.events[0].payload.email, undefined);
  });

  test("a made-up page or a junk label is refused and writes nothing", async () => {
    const cap = capture();
    const bad = [
      { kind: "page", session_id: "sess-abcdef12", page: "/admin" },
      { kind: "click", session_id: "sess-abcdef12", page: "/watch", target: "" },
      { kind: "click", session_id: "sess-abcdef12", page: "/watch", target: "has space" },
      { kind: "click", session_id: "sess-abcdef12", page: "/watch", target: "x".repeat(65) },
      { kind: "click", page: "/watch", target: "cta:go" },
    ];
    for (const b of bad) {
      const out = await recordInterest(b, deps(cap));
      assert.equal(out.ok, false, JSON.stringify(b));
    }
    assert.equal(cap.events.length, 0);
  });

  test("a session that has pressed 60 things is not saved a 61st", async () => {
    const cap = capture();
    const out = await recordInterest(
      { kind: "click", session_id: "sess-abcdef12", page: "/watch", target: "cta:one-more" },
      { ...deps(cap), db: { query: async () => ({ rows: [{ n: 60 }] }) } }
    );
    assert.equal(out.ok, true);
    assert.equal(out.saved, false);
    assert.equal(cap.events.length, 0);
  });

  test("a repeat press is not saved twice", async () => {
    const out = await recordInterest(
      { kind: "click", session_id: "sess-abcdef12", page: "/watch", target: "cta:get-started" },
      { ...deps(capture()), emit: async () => ({ id: null, deduped: true }) }
    );
    assert.equal(out.saved, false);
  });
});

describe("every step of /watch and /roadmap carries the tracking", () => {
  const ROW = Object.fromEntries(PUSH_MANIFEST.map((r) => [r.key, r]));
  const watchRows = ["apply-watch", "apply-survey", "apply-book", "apply-thank-you"];
  const roadmapRows = ["slo-297-sales", "slo-297-booking", "slo-297-thank-you"];

  test("watch builder steps list the events script and Clarity as footer scripts", () => {
    for (const k of ["apply-watch", "apply-book", "apply-thank-you"]) {
      assert.ok(ROW[k].extraFooterScripts.includes(FH_EVENTS_SRC), `${k} events`);
      assert.ok(ROW[k].extraFooterScripts.includes(CLARITY_SRC), `${k} clarity`);
    }
    assert.equal(ROW["apply-watch"].vslBeacon, true);
  });

  test("the watch survey step gets the events script and Clarity at push time", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts/cf-push-custom-html.mjs"), "utf8");
    const at = script.indexOf("function injectApplySurveyRuntime");
    const body = script.slice(at, script.indexOf("async function pageOnApplyStep"));
    assert.match(body, /FH_EVENTS_SRC/);
    assert.match(body, /CLARITY_SRC/);
    assert.ok(watchRows.every((k) => ROW[k]));
  });

  test("roadmap custom HTML steps are wrapped with events, Clarity and the video beacon", () => {
    for (const k of ["slo-297-sales", "slo-297-booking"]) {
      assert.equal(ROW[k].vslBeacon, true, `${k} has a film on it`);
    }
    for (const k of roadmapRows) {
      const html = wrapCustomHtmlDocument({
        bodyHtml: "<p>x</p>", pageToken: "cfp_x", pixelId: "123", includeVslBeacon: ROW[k].vslBeacon,
        env: { CLARITY_PROJECT_ID: "p1" },
      });
      assert.ok(html.includes(FH_EVENTS_SRC), `${k} events`);
      assert.ok(html.includes(CLARITY_SRC), `${k} clarity`);
      assert.equal(html.includes(VSL_WATCH_BEACON_SRC), !!ROW[k].vslBeacon, `${k} beacon`);
    }
  });

  test("the events script is not added twice, and Clarity is deferred like its head tag", () => {
    const html = wrapCustomHtmlDocument({
      bodyHtml: `<script src="${FH_EVENTS_SRC}"></script>`, pixelId: "1", includeVslBeacon: false, env: {},
    });
    assert.equal(html.split(FH_EVENTS_SRC).length - 1, 1);
    assert.ok(clarityHeadHtml({ CLARITY_PROJECT_ID: "p" }).includes(`${CLARITY_SRC}" defer`));
    assert.equal(ga4HeadHtml({}), "", "no measurement id means no GA4 tag");
    assert.ok(ga4HeadHtml({ GA_MEASUREMENT_ID: "G-TEST1234" }).includes("G-TEST1234"));
    assert.equal(ga4HeadHtml({ GA_MEASUREMENT_ID: "not-an-id" }), "");
    const next = nextFooterCode("", { extraSrcs: [FH_EVENTS_SRC, CLARITY_SRC] }).next;
    assert.ok(next.includes(`<script src="${CLARITY_SRC}" defer></script>`));
    assert.equal(nextFooterCode(next, { extraSrcs: [FH_EVENTS_SRC, CLARITY_SRC] }).changed, false, "second push adds nothing");
  });

  test("/watch and /roadmap are in different funnels, and the map says which", () => {
    const watchIds = new Set(PUSH_MANIFEST.filter((r) => r.liveUrl.includes("/watch") || r.key.startsWith("apply-")).map((r) => r.funnelId));
    const roadmapIds = new Set(PUSH_MANIFEST.filter((r) => r.key.startsWith("slo-297-")).map((r) => r.funnelId));
    assert.deepEqual([...watchIds], ["968281"], "the watch path is the Fundhub Funnel");
    assert.deepEqual([...roadmapIds], ["984178"], "the $297 roadmap is Fundhub $297 Roadmap");
    assert.equal(PUSH_MANIFEST.every((r) => r.funnelId), true, "every row names its funnel");
  });

  test("the native calendar step takes its footer scripts through the whole-footer replace push", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts/cf-push-custom-html.mjs"), "utf8");
    const at = script.indexOf('row.strategy === "head_footer_append_only" && row.extraFooterScripts?.length');
    assert.ok(at > -1, "branch exists");
    assert.ok(at < script.indexOf("DO_NOT_FULL_REPLACE_PATHS.has(row.path) ||"), "and sits before the append branch");
    assert.match(script.slice(at, at + 400), /pushBuilderFooter/);
  });

  test("Clarity stays quiet inside the booking frame", () => {
    const clarity = fs.readFileSync(path.join(ROOT, "public/js/clarity.js"), "utf8");
    assert.match(clarity, /window\.self !== window\.top/);
  });
});
