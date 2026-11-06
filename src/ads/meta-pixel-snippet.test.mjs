// The browser SDK runs only on public marketing URLs with neutral referrers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  META_PIXEL_FALLBACK_ID,
  metaPixelId,
  metaPixelHeadHtml,
  nextFunnelHeadCode,
  neutralizeHostedTracking,
  nextHeadCode,
  wrapCustomHtmlDocument,
  headBlocksHtml,
  PUSH_MANIFEST,
} from "../../marketing/landing-pages/tracking-manifest.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const count = (hay, needle) => String(hay).split(needle).length - 1;

const BARE_PAGEVIEW = "fbq('track', 'PageView');";
const ID_PAGEVIEW = "fbq('track', 'PageView', {}, {eventID: window.__fhPv});";

function runSnippet(html, { href = "https://apply.fundhub.ai/blueprint", referrer = "", frame = false, secure = true, loading = false, form = false, win = null } = {}) {
  const scripts = [...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 1);
  const w = win || (() => {
    const inserted = [];
    const document = {
      referrer, readyState: loading ? "loading" : "complete", form,
      querySelector: () => document.form ? { tagName: "FORM", hidden: true } : null,
      addEventListener: (name, cb) => { if (name === "DOMContentLoaded") document.ready = cb; },
      createElement: tag => ({ tagName: tag.toUpperCase() }),
      getElementsByTagName: () => [{ parentNode: { insertBefore: node => inserted.push(node) } }],
    };
    const ctx = { URL, document, location: { href }, crypto: secure ? { randomUUID } : {}, __inserted: inserted };
    ctx.window = ctx.self = ctx;
    ctx.top = frame ? {} : ctx;
    return vm.createContext(ctx);
  })();
  for (const code of scripts) vm.runInContext(code, w);
  return w;
}

/** The fbq calls the page made, as plain arrays (the stub queues them until fbevents.js loads). */
const calls = (w) => JSON.parse(JSON.stringify((w.fbq?.queue || []).map((a) => Array.from(a))));
const pageViews = (w) => calls(w).filter((c) => c[0] === "track" && c[1] === "PageView");

const PV_RE = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

describe("pixel id: META_PIXEL_ID env, fallback when missing", () => {
  test("META_PIXEL_ID wins", () => {
    assert.deepEqual(metaPixelId({ META_PIXEL_ID: " 1234567890 " }), { id: "1234567890", envName: "META_PIXEL_ID" });
  });

  test("missing: the pixel that has always been live, named as a fallback", () => {
    assert.equal(META_PIXEL_FALLBACK_ID, "2403674420141513");
    const r = metaPixelId({});
    assert.equal(r.id, "2403674420141513");
    assert.match(r.envName, /^fallback/);
  });

  test("not digits: fallback, never a broken pixel", () => {
    const r = metaPixelId({ META_PIXEL_ID: "abc-not-a-pixel" });
    assert.equal(r.id, META_PIXEL_FALLBACK_ID);
    assert.match(r.envName, /not digits/);
  });

  test("only META_PIXEL_ID counts, the same name the server sender reads", () => {
    for (const name of ["FACEBOOK_PIXEL_ID", "FB_PIXEL_ID", "PIXEL_ID", "META_PIXEL", "FB_PIXEL"]) {
      assert.equal(metaPixelId({ [name]: "999999999" }).id, META_PIXEL_FALLBACK_ID, name);
    }
  });

  test("the snippet carries whatever id it is given", () => {
    const html = metaPixelHeadHtml(metaPixelId({ META_PIXEL_ID: "1234567890" }).id);
    assert.ok(html.includes("fbq('init', '1234567890');"));
    assert.equal(html.includes("facebook.com/tr"), false);
    assert.equal(html.includes(META_PIXEL_FALLBACK_ID), false);
  });
});

describe("the head snippet: one PageView, with eventID window.__fhPv", () => {
  const html = metaPixelHeadHtml(META_PIXEL_FALLBACK_ID);

  test("source: one init, one PageView call, and it carries the event id; no bare PageView", () => {
    assert.equal(count(html, "fbq('init'"), 1);
    assert.equal(count(html, "fbq('track'"), 2);
    assert.equal(count(html, ID_PAGEVIEW), 1);
    assert.equal(count(html, BARE_PAGEVIEW), 0);
    assert.ok(html.startsWith("<!-- Meta Pixel (Fundhub) -->\n<script>"), "the comment the push uses to find it");
  });

  test("public landing visits use independent UUIDs, with automatic collection disabled before init", () => {
    const w = runSnippet(html, { loading: true });
    assert.match(w.__fhPv, PV_RE);
    assert.equal(w.fbq, undefined, "the neutral id is available before the third-party SDK");
    w.document.ready();
    assert.equal(w.__fhMetaPixelAllowed, true);
    assert.deepEqual(calls(w), [
      ["set", "autoConfig", false, META_PIXEL_FALLBACK_ID],
      ["init", META_PIXEL_FALLBACK_ID],
      ["track", "PageView", {}, { eventID: w.__fhPv }],
      ["track", "ViewContent", {}, { eventID: w.__fhPv + ".vc" }],
    ]);
    assert.equal(w.__inserted.length, 1);
    assert.equal(w.__inserted[0].referrerPolicy, "no-referrer");
    assert.equal(w.__inserted[0].src, "https://connect.facebook.net/en_US/fbevents.js");
    assert.notEqual(runSnippet(html).__fhPv, w.__fhPv);
    runSnippet(html, { win: w });
    assert.equal(w.__inserted.length, 1);
    assert.equal(pageViews(w).length, 1);
  });

  test("hosted contact forms and fields added during HTML parsing use only the server copy", () => {
    const watch = runSnippet(html, { href: "https://apply.fundhub.ai/watch", form: false });
    assert.match(watch.__fhPv, PV_RE);
    assert.equal(watch.fbq, undefined);
    const w = runSnippet(html, { loading: true });
    w.document.form = true;
    w.document.ready();
    assert.match(w.__fhPv, PV_RE);
    assert.equal(w.__inserted.length, 0);
    assert.equal(w.fbq, undefined);
    assert.equal(w.__fhMetaPixelAllowed, undefined);
  });

  test("paid visits and private referrers keep an opaque CAPI-only page id, without the browser SDK", () => {
    for (const options of [
      { href: "https://apply.fundhub.ai/watch?utm_source=facebook&fbclid=opaque" },
      { href: "https://apply.fundhub.ai/blueprint?utm_campaign=summer&ad_id=123" },
      { referrer: "https://apply.fundhub.ai/funding-book-call--02424" },
      { referrer: "https://external.example/private?token=example" },
      { referrer: "https://m.facebook.com/stories/123" },
    ]) {
      const w = runSnippet(html, options);
      assert.match(w.__fhPv, PV_RE);
      assert.equal(w.__inserted.length, 0);
      assert.equal(w.__fhMetaPixelAllowed, undefined);
    }
  });

  test("restricted surfaces never request a script, publish an id or expose a no-JS beacon", () => {
    const base = "https://apply.fundhub.ai";
    const blocked = [
      ...["apply", "watch?ticket=secret", "watch#private", "funding-book-call", "funding-book-call--02424", "roadmap", "order", "blueprint-book"].map(path => ({ href: base + "/" + path })),
      { href: "https://fundhub.ai/" }, { href: "https://unknown.example/watch" }, { frame: true }, { secure: false },
      { href: base + "/watch?utm_source=facebook&resume=signed" }, { href: base + "/blueprint?utm_source=facebook#secret" },
    ];
    for (const options of blocked) {
      const w = runSnippet(html, options);
      assert.equal(w.__inserted.length, 0, JSON.stringify(options));
      assert.equal(w.fbq, undefined);
      assert.equal(w.__fhMetaPixelAllowed, undefined);
      assert.equal(w.__fhPv, undefined);
    }
    assert.doesNotMatch(html, /<noscript|facebook\.com\/tr/i);
  });

  test("the push's page-head cleanup still finds the new block (one kept, or dropped under a funnel pixel)", () => {
    const two = `${html}\n${html}`;
    assert.equal(nextHeadCode(two, { funnelHead: "" }).next, html);
    assert.equal(nextHeadCode(html, { funnelHead: html }).next, "");
  });
});

describe("custom HTML pages: the wrapper puts in the one PageView", () => {
  const roadmapRows = PUSH_MANIFEST.filter((r) => r.strategy === "custom_html_put");

  test("/roadmap, /roadmap-book, /roadmap-thank-you, built from their real fragments", () => {
    assert.deepEqual(roadmapRows.map((r) => r.key).sort(), ["slo-297-booking", "slo-297-sales", "slo-297-thank-you"]);
    for (const row of roadmapRows) {
      const doc = wrapCustomHtmlDocument({
        bodyHtml: read(row.fragment),
        pageToken: "cfp_x",
        pixelId: metaPixelId({}).id,
        includeVslBeacon: !!row.vslBeacon,
        headFirstHtml: headBlocksHtml(row, read),
        env: { CLARITY_PROJECT_ID: "p1" },
      });
      assert.equal(count(doc, "fbq('init'"), 1, `${row.key} init`);
      assert.equal(count(doc, "'PageView'"), 1, `${row.key} PageView`);
      assert.equal(count(doc, ID_PAGEVIEW), 1, `${row.key} eventID`);
      assert.equal(count(doc, BARE_PAGEVIEW), 0, `${row.key} no bare PageView`);
    }
  });

  test("/apply: the fragment carries no pixel and no fbq call; the push adds the one snippet", () => {
    const frag = read("marketing/landing-pages/apply-survey.html");
    assert.equal(frag.includes("fbq("), false);
    const script = read("scripts/cf-push-custom-html.mjs");
    const at = script.indexOf("function injectApplySurveyRuntime");
    const body = script.slice(at, script.indexOf("async function pageOnApplyStep"));
    assert.match(body, /if \(pixelId && !out\.includes\("fbq\('init'"\)\) head\.push\(metaPixelHeadHtml\(pixelId\)\);/);
    assert.match(script, /const pixel = metaPixelId\(process\.env\);\n\s*const baseHtml = readFragment\(row\.fragment\);/);
  });
});

describe("ClickFunnels funnel head (builder steps of 968281)", () => {
  // GET /funnels/968281?expand[]=head_code, 2026-10-02: a bare pixel with no comment.
  const LIVE_968281 = `<link rel="preconnect" href="https://use.fontawesome.com" crossorigin>
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '2403674420141513');
fbq('track', 'PageView');
</script>

<script async src="https://app.directroas.com/api/hub/v1/cmsdutl8e00mukv041vwuo39w"></script>`;
  const PRE = '<link rel="preconnect" href="https://use.fontawesome.com" crossorigin>\n';
  const ROAS = '\n\n<script async src="https://app.directroas.com/api/hub/v1/cmsdutl8e00mukv041vwuo39w"></script>';

  test("the old pixel and independent Direct ROAS relay are replaced, with preconnect preserved", () => {
    const plan = nextFunnelHeadCode(LIVE_968281, META_PIXEL_FALLBACK_ID);
    assert.equal(plan.changed, true);
    assert.equal(plan.next, PRE + metaPixelHeadHtml(META_PIXEL_FALLBACK_ID) + "\n\n");
    assert.equal(count(plan.next, "fbq('init'"), 1);
    assert.equal(count(plan.next, ID_PAGEVIEW), 1);
    assert.equal(count(plan.next, BARE_PAGEVIEW), 0);
    assert.equal(count(plan.next, "<noscript>"), 0, "no fallback fires outside the guard");
    const w = runSnippet(plan.next);
    assert.equal(pageViews(w).length, 1);
    assert.match(w.__fhPv, PV_RE);
  });

  test("a second push changes nothing", () => {
    const once = nextFunnelHeadCode(LIVE_968281, META_PIXEL_FALLBACK_ID).next;
    assert.deepEqual(nextFunnelHeadCode(once, META_PIXEL_FALLBACK_ID), { next: once, changed: false });
  });

  test("a new env pixel id swaps in on the next push", () => {
    const once = nextFunnelHeadCode(LIVE_968281, META_PIXEL_FALLBACK_ID).next;
    const moved = nextFunnelHeadCode(once, "1234567890");
    assert.equal(moved.changed, true);
    assert.ok(moved.next.includes("fbq('init', '1234567890');"));
    assert.equal(count(moved.next, "fbq('init'"), 1);
  });

  test("migration removes the old fallback and leaves unrelated noscript elements alone", () => {
    const fallback = '<noscript><img src="https://www.facebook.com/tr?id=1234567890&ev=PageView&noscript=1"/></noscript>';
    const ordinary = "<noscript>Please enable JavaScript.</noscript>";
    const live = `${PRE}${metaPixelHeadHtml("1234567890")}\n${fallback}${ordinary}${ROAS}`;
    const plan = nextFunnelHeadCode(live, META_PIXEL_FALLBACK_ID);
    assert.equal(plan.next, `${PRE}${metaPixelHeadHtml(META_PIXEL_FALLBACK_ID)}\n${ordinary}\n\n`);
  });

  test("no pixel, or two, is refused: nothing is written blind", () => {
    assert.throws(() => nextFunnelHeadCode(PRE + ROAS, META_PIXEL_FALLBACK_ID), /0 pixel init/);
    assert.throws(() => nextFunnelHeadCode("", META_PIXEL_FALLBACK_ID), /0 pixel init/);
    assert.throws(() => nextFunnelHeadCode(`${LIVE_968281}\n${LIVE_968281}`, META_PIXEL_FALLBACK_ID), /2 pixel init/);
  });

  test("the manifest row and the push branch: PUT /funnels/{id}, whole head, replace, read back", () => {
    const row = PUSH_MANIFEST.find((r) => r.key === "funnel-968281-pixel");
    assert.ok(row);
    assert.equal(row.funnelId, "968281");
    assert.equal(row.strategy, "funnel_head_pixel");
    assert.equal(PUSH_MANIFEST.filter((r) => r.strategy === "funnel_head_pixel").length, 1, "984178 has no funnel head code");
    const script = read("scripts/cf-push-custom-html.mjs");
    const at = script.indexOf('if (row.strategy === "funnel_head_pixel")');
    assert.ok(at > -1 && at < script.indexOf("if (!row.path && !row.pageId)"), "branch runs before the page lookup");
    assert.match(script.slice(at, at + 300), /pushFunnelHeadPixel\(creds, row, pixel\.id, ctx, dryRun, snapDir\)/);
    const fn = script.slice(script.indexOf("async function pushFunnelHeadPixel"), script.indexOf("async function getPageCode"));
    assert.match(fn, /nextFunnelHeadCode\(live, pixelId\)/);
    assert.match(fn, /if \(dryRun\) return/);
    assert.match(fn, /\/funnels\/\$\{row\.funnelId\}`/);
    assert.match(fn, /method: "PUT"/);
    assert.match(fn, /funnel: \{ head_code: plan\.next, head_code_mode: "replace" \}/);
    assert.match(fn, /after\.trim\(\) === plan\.next\.trim\(\)/);
    assert.ok(fn.indexOf("writeFileSync(snapshot, live") < fn.indexOf('method: "PUT"'), "snapshot before the write");
  });
});

describe("fundhub.ai homepage (public/index.html)", () => {
  const HOME = read("public/index.html");

  test("carries the same snippet, once, in <head>, with the fallback pixel id written in", () => {
    const block = metaPixelHeadHtml(META_PIXEL_FALLBACK_ID);
    assert.equal(count(HOME, block), 1);
    assert.ok(HOME.indexOf(block) < HOME.indexOf("</head>"));
    assert.equal(count(HOME, "fbq('init'"), 1);
    assert.equal(count(HOME, "fbq("), 4, "configuration, init and explicit safe landing events");
    assert.equal(count(HOME, BARE_PAGEVIEW), 0);
  });

  test("home survey never loads the Pixel", () => {
    const head = HOME.slice(HOME.indexOf("<!-- Meta Pixel (Fundhub) -->"), HOME.indexOf("</head>"));
    const w = runSnippet(head, { href: "https://fundhub.ai/" });
    assert.equal(w.__inserted.length, 0);
    assert.equal(pageViews(w).length, 0);
  });
});

test("surgical migration retains unrelated markup and removes only the known financial event hooks", () => {
  const keep = '<noscript>Independent content</noscript><script>trackLocally();</script>';
  const input = keep + "<script>try{ if(typeof fbq!=='undefined') fbq('trackCustom','PreviewOpened',{content_name:d}); }catch(x){} savePreview();</script>";
  const output = neutralizeHostedTracking(input, META_PIXEL_FALLBACK_ID);
  assert.equal(output.next, keep + '<script> savePreview();</script>');
  assert.equal(neutralizeHostedTracking(output.next, META_PIXEL_FALLBACK_ID).changed, false);
  assert.throws(() => neutralizeHostedTracking("<script>fbq('trackCustom','Unknown')</script>", META_PIXEL_FALLBACK_ID), /unrecognized/);
});


test("the targeted hosted repair preserves both calendar URLs, form controls and independent first-party script tags", () => {
  const calendar = '<iframe data-src="https://apply.fundhub.ai/funding-book-call" data-src-unqualified="https://apply.fundhub.ai/funding-book-call--02424"></iframe>';
  const own = '<form><input name="answer" value="synthetic"></form><script src="https://fundhub.ai/funnel/fh-events.js"></script>';
  const css = '<style>.booking { height: 640px; }</style>';
  const reviewed = metaPixelHeadHtml(META_PIXEL_FALLBACK_ID);
  const fallback = '<noscript><img src="https://www.facebook.com/tr?id=123456"/></noscript>';
  const s = css + reviewed + fallback + calendar + own;
  assert.equal(neutralizeHostedTracking(s, META_PIXEL_FALLBACK_ID).next, css + reviewed + calendar + own);
});


test("the hosted plan rejects unknown Meta code without editing surrounding content", () => {
  const guarded = metaPixelHeadHtml(META_PIXEL_FALLBACK_ID);
  const copy = "<p>We use fbq and connect.facebook.net for public analytics.</p>";
  assert.equal(neutralizeHostedTracking(guarded + copy, META_PIXEL_FALLBACK_ID).changed, false);
  for (const unknown of [
    '<script>fbq("init", "123"); fbq("track", "PageView");</script>',
    "<script> fbq ( 'init' , '123' ); </script>",
    '<ScRiPt SrC="https://connect.facebook.net/en_US/fbevents.js"></ScRiPt>',
    "<script>window['fbq']('track', 'Lead');</script>",
    '<img src="https://www.facebook.com/tr?id=1">',
    '<script src="https://app.directroas.com/api/hub/custom"></script>',
    guarded.replace("  function publicVisit()", "  doSomethingElse(); function publicVisit()"),
  ]) {
    assert.throws(() => neutralizeHostedTracking(guarded + unknown, META_PIXEL_FALLBACK_ID), /unrecognized/);
  }
});
