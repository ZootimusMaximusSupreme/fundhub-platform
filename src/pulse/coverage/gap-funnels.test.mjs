import test from "node:test";
import assert from "node:assert/strict";

import {
  GAP_DOORS,
  GAP_WIDGET_CHECKS,
  MIN_CARD_BOX_BYTES,
  TRACKING_SCRIPTS,
  WIDGET_DOORS,
  cardBoxScriptUrl,
  gapChecks,
  orderPriceCents,
  scriptSrcs,
  tillPriceCents,
  tillProblems,
  videoFiles
} from "./gap-funnels.mjs";

const FUNNEL = "https://apply.fundhub.ai";
const APP = "https://fundhub.ai";

const TILL = JSON.stringify({
  ok: true,
  name: "Complete Funding Diagnostic",
  priceCents: 14700,
  priceDisplay: "$147",
  demo: false,
  checkout: { ready: true }
});

const VENDOR = "https://cdn.embedded.fanbasis.io";
const SDK = `${VENDOR}/embed/index.js`;
// The card box code is about 21 KB. This stand-in defines the one name the page calls.
const SDK_BODY = `(function(w){w.PaymentCheckout={create:function(){return{attachToElement:function(){}}}};})(window);/*${"x".repeat(MIN_CARD_BOX_BYTES)}*/`;
const JS_BODY = "(function(){var fh=1;})();";

/** The live /roadmap page, cut down to what the checks read. o.<part> = false drops that part. */
function roadmapHtml(app = APP, o = {}) {
  const on = (k) => o[k] !== false;
  return [
    '<section id="fh-order">Get My Roadmap — Funding Roadmap</section>',
    on("hook") ? 'call("GET","slo-checkout") call(\'POST\',\'slo-checkout\',body)' : "",
    "<b>$147</b>",
    on("clarity") ? `<script src="${app}/js/clarity.js" defer></script>` : "",
    on("attribution") ? `<script src="${app}/funnel/fh-attribution.js"></script>` : "",
    on("sdk") ? `<script>var SDK_SRC='${SDK}'; card=window.PaymentCheckout.create(cfg); card.attachToElement(el);</script>` : "<script>var nothing=1;</script>",
    on("vsl") ? `<video id="fh-vsl" autoplay muted playsinline poster="${app}/funnel/slo-vsl-poster.jpg" src="${app}/funnel/slo-vsl.mp4"></video>` : "",
    on("testimonial") ? `<video playsinline poster="${app}/funnel/slo-testimonial-colin2-poster.jpg" src="${app}/funnel/slo-testimonial-colin2.mp4"></video>` : "",
    on("beacon") ? `<script src="${app}/funnel/vsl-watch-beacon.js"></script>` : "",
    on("events") ? `<script src="${app}/funnel/fh-events.js"></script>` : ""
  ].join("\n");
}

/** The ClickFunnels call calendar. */
function phonecallHtml({ picker = true, token = true, query = true } = {}) {
  if (!picker) return "<title>Meeting with Chris</title>";
  return (
    '<title>Meeting with Chris</title><div id="cronofy-date-time-picker" data-controller="cronofy--date-time-picker" ' +
    (token ? 'data-cronofy--date-time-picker-element-token-value="yByfh_oyw8HVmjmMN1RR48SOXk6GJRH9dzuc" ' : "") +
    (query ? 'data-cronofy--date-time-picker-availability-query-json-value="{&quot;participants&quot;:[]}" ' : "") +
    "></div>"
  );
}

/** The native ClickFunnels checkout page. */
function orderHtml(cents = 14700, { form = true, price = true } = {}) {
  return (
    "<title>Order</title>" +
    (form ? '<div data-page-element="Checkout/V2"></div><div data-page-element="CheckoutSubmitButton/V1"></div>' : "") +
    (price ? `<script type="application/json">{"product":{"price_cents":${cents},"display_price":"$${cents / 100}.00"}}</script>` : "")
  );
}

const GOOD = {
  "/roadmap": roadmapHtml(APP),
  "/api/public/slo-checkout": { body: TILL, cors: "GET, POST, OPTIONS" },
  "/api/public/slo-pull": { status: 405, body: '{"ok":false,"error":"method_not_allowed"}', cors: "POST, OPTIONS" },
  "/api/public/slo-status": { status: 400, body: '{"ok":false,"error":"ref_required"}', cors: "GET, OPTIONS" },
  "/api/public/slo-repair-checkout": { status: 405, body: '{"ok":false,"error":"method_not_allowed"}', cors: "POST, OPTIONS" },
  "/embed/index.js": SDK_BODY,
  "/funnel/fh-attribution.js": JS_BODY,
  "/funnel/fh-events.js": JS_BODY,
  "/funnel/vsl-watch-beacon.js": JS_BODY,
  "/js/clarity.js": JS_BODY,
  "/funnel/slo-vsl.mp4": { body: "x", headers: { "content-length": "57398098" } },
  "/funnel/slo-vsl-poster.jpg": { body: "x", headers: { "content-length": "240305" } },
  "/funnel/slo-testimonial-colin2.mp4": { body: "x", headers: { "content-length": "40473460" } },
  "/funnel/slo-testimonial-colin2-poster.jpg": { body: "x", headers: { "content-length": "237974" } },
  "/schedule/phonecall": phonecallHtml(),
  "/order": orderHtml(14700),
  "/api/webhooks/clickfunnels": { status: 405, body: '{"ok":false,"error":"Method not allowed"}' },
  "/watch": "Get Started <!-- fh-watch-lede:start -->",
  "/thank-you": "You're All Set <script src=\"https://fundhub.ai/funnel/thankyou-sort.js\"></script>",
  "/roadmap-thank-you": "You're All Set <section id=\"fh-expect\"></section>",
  "/apply": "cf_svy_funding_target_amount fetch('https://fundhub.ai/api/webhooks/clickfunnels', { method: 'POST' })",
  "/roadmap-book": '<iframe id="fh-book-frame" src="https://apply.fundhub.ai/funding-book-call"></iframe>',
  "/funding-book-call": "Book Your Funding Call <div id=\"cronofy-date-time-picker\"></div><div id=\"formContainer\"></div>",
  "/partner/": '<span data-price="partner"></span><script src="/partner/funnel.js"></script>',
  "/partner/menu/": 'Four Ways In <span data-price-label="partner"></span><script src="/partner/funnel.js"></script>',
  "/partner/trial/": '<form data-checkout="trial"></form><script src="/partner/funnel.js"></script>',
  "/partner/board/": '<form data-checkout="board"></form><script src="/partner/funnel.js"></script>',
  "/partner/funnel.js": 'var API = "/api/public/funnel-checkout"; fetch(API, { method: "POST" });',
  "/education/": '<a href="/education/enroll/?program=credit-mastery">Enroll in Credit Mastery</a>',
  "/education/enroll/": '<form id="enroll-form"></form> fetch("/api/public/education-enroll", { method: "POST" })',
  "/affiliates/": '<form id="pform"></form> fetch("/api/public/partner-apply", { method: "POST" })',
  "/roadmap/pay.html": '<form id="pay"></form> fetch("/api/public/slo-checkout", { method: "POST" })',
  "/roadmap/pull.html": '<form id="pull"></form> fetch("/api/public/slo-pull", { method: "POST" })',
  "/optimize.html": '<form id="opt"></form> fetch("/api/public/optimize")',
  "/optimize-plan.html": '<form id="intake"></form> fetch("/api/public/optimize")',
  "/": '<form id="appform"></form><script src="/js/homepage-survey.js?v=1"></script>',
  "/js/homepage-survey.js": 'fetch("/api/public/survey-submit", { method: "POST" });',
  "/start.html": '<a href="https://apply.fundhub.ai/watch">Go to apply</a>'
};

function keyOf(url) {
  const u = new URL(url);
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1) + "/";
  if (path.startsWith("/js/homepage-survey.js")) return "/js/homepage-survey.js";
  return path;
}

function typeFor(key) {
  if (key.endsWith(".js")) return "text/javascript";
  if (key.endsWith(".mp4")) return "video/mp4";
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (key.startsWith("/api/")) return "application/json";
  return "text/html; charset=utf-8";
}

/**
 * A page is a string or { status, body, headers, throw, cors }. cors is the
 * allow-methods list a door answers with; like the real door, it echoes the
 * Origin the call came from (corsOrigin / corsHeaders override that).
 */
function fakeFetch(pages, calls) {
  return async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || "GET",
      origin: init.headers && init.headers.origin
    });
    const key = keyOf(url);
    const hit = pages[key];
    if (hit === undefined) {
      return { status: 404, headers: new Headers({ "content-type": "text/html" }), text: async () => "missing fixture" };
    }
    if (hit && hit.throw) throw new Error(hit.throw);
    const entry = typeof hit === "string" ? { body: hit } : hit;
    const headers = new Headers({ "content-type": typeFor(key), ...(entry.headers || {}) });
    const origin = init.headers && init.headers.origin;
    if (entry.cors && origin) {
      headers.set("access-control-allow-origin", entry.corsOrigin ?? origin);
      headers.set("access-control-allow-methods", entry.cors);
      headers.set("access-control-allow-headers", entry.corsHeaders ?? "content-type");
    }
    return {
      status: entry.status ?? 200,
      headers,
      // Like a real Response: where the call ended after any redirect (entry.endedAt sets a redirect).
      url: entry.endedAt ? String(new URL(entry.endedAt, String(url))) : String(url),
      text: async () => entry.body ?? ""
    };
  };
}

function ctx(pages, calls = []) {
  return {
    fetchImpl: fakeFetch(pages, calls),
    funnelBaseUrl: FUNNEL,
    appBaseUrl: APP,
    calls
  };
}

const byId = (rows, id) => rows.find((item) => item.id === id);

test("gap funnels: every live door passes when markers are present", async () => {
  const calls = [];
  const rows = await gapChecks(ctx(GOOD, calls));
  // The 21 doors plus the Tier 1 widget checks (2026-10-09).
  assert.equal(rows.length, GAP_DOORS.length + GAP_WIDGET_CHECKS.length);
  assert.equal(GAP_DOORS.length, 21);
  assert.equal(GAP_WIDGET_CHECKS.length, 6);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["detail", "id", "status", "suggestedFix"]);
    assert.equal(row.status, "PASS", `${row.id} ${row.detail}`);
    assert.equal(row.suggestedFix, null);
  }
  assert.ok(calls.length >= GAP_DOORS.length);
  // Read only: GET, and HEAD for the video and picture files. Never a POST.
  assert.ok(calls.every((call) => call.method === "GET" || call.method === "HEAD"));
  assert.ok(calls.filter((call) => call.method === "HEAD").every((call) => /\.(mp4|jpg)$/.test(call.url)));
  // Our two sites, plus the card company's script the checkout widget loads.
  assert.ok(calls.every((call) => call.url.startsWith(FUNNEL) || call.url.startsWith(APP) || call.url.startsWith(VENDOR)));
  // One call per address: the till is read once for the page, not once per reader.
  assert.equal(new Set(calls.map((c) => c.url)).size, calls.length);
});

test("gap funnels: the ids do not repeat Recon's funnel:roadmap-sales", () => {
  const ids = GAP_DOORS.map((door) => door.id);
  assert.ok(!ids.includes("funnel:roadmap-sales"));
  assert.ok(ids.includes("funnel:roadmap-checkout"));
  assert.equal(new Set(ids).size, ids.length);
});

test("gap funnels: Recon's two markers (fh-order, offer line) are not read again here", async () => {
  const pages = { ...GOOD, "/roadmap": "call('GET','slo-checkout') call('POST','slo-checkout',b) <b>$147</b>" };
  const rows = await gapChecks(ctx(pages));
  assert.equal(byId(rows, "funnel:roadmap-checkout").status, "PASS");
});

test("gap funnels: sales page 404 fails and does not post", async () => {
  const calls = [];
  const pages = { ...GOOD, "/roadmap": { status: 404, body: "not found" } };
  const rows = await gapChecks(ctx(pages, calls));
  const row = byId(rows, "funnel:roadmap-checkout");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /\/roadmap answered 404/);
  assert.match(row.suggestedFix, /Recon/);
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("gap funnels: HTTP 200 with the checkout hook gone fails", async () => {
  // The real page minus the one thing under test: its slo-checkout calls.
  const pages = { ...GOOD, "/roadmap": roadmapHtml(APP, { hook: false }) };
  const rows = await gapChecks(ctx(pages));
  const row = byId(rows, "funnel:roadmap-checkout");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /form cannot post/);
  assert.match(row.detail, /checkout post slo-checkout/);
  assert.match(row.detail, /till read slo-checkout/);
  assert.equal(rows.filter((item) => item.status === "FAIL").length, 1);
});

test("gap funnels: a comment that only names slo-checkout is not the hook", async () => {
  const pages = { ...GOOD, "/roadmap": "<!-- talks to slo-checkout --> fh-order $147" };
  const row = byId(await gapChecks(ctx(pages)), "funnel:roadmap-checkout");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /checkout post slo-checkout/);
});

test("gap funnels: the booking page loses its calendar picker", async () => {
  const pages = { ...GOOD, "/funding-book-call": "Book Your Funding Call <div id=\"formContainer\"></div>" };
  const row = byId(await gapChecks(ctx(pages)), "funnel:funding-book-call");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /calendar picker cronofy-date-time-picker/);
});

test("gap funnels: the watch lede block counts only as the real head block", async () => {
  const pages = { ...GOOD, "/watch": "Get Started .fh-watch-lede{color:red}" };
  const row = byId(await gapChecks(ctx(pages)), "funnel:watch");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /watch lede fh-watch-lede/);
});

test("gap funnels: a till that is not ready fails the sales page", async () => {
  const pages = { ...GOOD, "/api/public/slo-checkout": JSON.stringify({ ok: true, priceDisplay: "$147", demo: false, checkout: { ready: false } }) };
  const row = byId(await gapChecks(ctx(pages)), "funnel:roadmap-checkout");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /checkout till is not ready, so Pay cannot charge a card/);
  assert.match(row.suggestedFix, /GET \/api\/public\/slo-checkout/);
});

test("gap funnels: a till in demo mode fails the sales page", async () => {
  const pages = { ...GOOD, "/api/public/slo-checkout": JSON.stringify({ ok: true, priceDisplay: "$147", demo: true, checkout: { ready: true } }) };
  const row = byId(await gapChecks(ctx(pages)), "funnel:roadmap-checkout");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /demo mode, so Pay charges no card/);
});

test("gap funnels: a page that shows another price than the till charges fails", async () => {
  const pages = { ...GOOD, "/roadmap": '<section id="fh-order">Funding Roadmap</section> slo-checkout <b>$297</b>' };
  const row = byId(await gapChecks(ctx(pages)), "funnel:roadmap-checkout");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /the page does not show the \$147 the till charges/);
});

test("gap funnels: a till that answers 500 or not JSON fails, never passes", async () => {
  const five = byId(await gapChecks(ctx({ ...GOOD, "/api/public/slo-checkout": { status: 500, body: "boom" } })), "funnel:roadmap-checkout");
  assert.equal(five.status, "FAIL");
  assert.match(five.detail, /checkout till \/api\/public\/slo-checkout answered 500/);
  const junk = byId(await gapChecks(ctx({ ...GOOD, "/api/public/slo-checkout": "<html>Netlify</html>" })), "funnel:roadmap-checkout");
  assert.equal(junk.status, "FAIL");
  assert.match(junk.detail, /did not answer JSON/);
});

test("gap funnels: tillProblems names each problem in plain words", () => {
  assert.deepEqual(tillProblems(TILL, "price $147 here"), []);
  assert.deepEqual(tillProblems(TILL, "no price"), ["the page does not show the $147 the till charges"]);
  assert.deepEqual(tillProblems("{}", "x"), [
    "checkout till says not ok",
    "checkout till is not ready, so Pay cannot charge a card",
    "checkout till has no price"
  ]);
  assert.deepEqual(tillProblems("null", "x"), ["checkout till did not answer JSON"]);
});

test("gap funnels: watch and thank-you down fail", async () => {
  const pages = {
    ...GOOD,
    "/watch": { status: 503, body: "" },
    "/thank-you": { status: 404, body: "" }
  };
  const rows = await gapChecks(ctx(pages));
  const watch = byId(rows, "funnel:watch");
  const thanks = byId(rows, "funnel:thank-you");
  assert.equal(watch.status, "FAIL");
  assert.match(watch.detail, /\/watch answered 503/);
  assert.equal(thanks.status, "FAIL");
  assert.match(thanks.detail, /\/thank-you answered 404/);
});

test("gap funnels: apply form that cannot post fails", async () => {
  const pages = { ...GOOD, "/apply": "cf_svy_funding_target_amount <form></form>" };
  const rows = await gapChecks(ctx(pages));
  const row = byId(rows, "funnel:apply-form");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /form cannot post/);
  assert.match(row.detail, /webhooks\/clickfunnels/);
});

test("gap funnels: apply form whose webhook door is gone fails even with the markers present", async () => {
  const pages = { ...GOOD, "/api/webhooks/clickfunnels": { status: 404, body: "not found" } };
  const row = byId(await gapChecks(ctx(pages)), "funnel:apply-form");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /post door \/api\/webhooks\/clickfunnels answered 404/);
});

test("gap funnels: pull form whose slo-pull door answers 500 fails, a 405 passes", async () => {
  const dead = byId(await gapChecks(ctx({ ...GOOD, "/api/public/slo-pull": { status: 500, body: "" } })), "offer:roadmap-pull");
  assert.equal(dead.status, "FAIL");
  assert.match(dead.detail, /post door \/api\/public\/slo-pull answered 500/);
  const alive = byId(await gapChecks(ctx(GOOD)), "offer:roadmap-pull");
  assert.equal(alive.status, "PASS");
});

test("gap funnels: a post door that throws fails that door and names it", async () => {
  const pages = { ...GOOD, "/api/public/slo-pull": { throw: "socket hang up" } };
  const row = byId(await gapChecks(ctx(pages)), "offer:roadmap-pull");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /post door \/api\/public\/slo-pull unreachable: socket hang up/);
});

test("gap funnels: morning status-only page fails when the checkout hook is gone", async () => {
  const pages = {
    ...GOOD,
    "/partner/trial/": "<h1>Trial</h1><script src=\"/partner/funnel.js\"></script>"
  };
  const rows = await gapChecks(ctx(pages));
  const row = byId(rows, "offer:partner-trial");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /answered 200/);
  assert.match(row.detail, /morning ping only checks HTTP status/);
  assert.match(row.detail, /trial checkout form/);
  assert.match(row.detail, /form cannot post/);
});

test("gap funnels: homepage survey script without a post fails", async () => {
  const pages = { ...GOOD, "/js/homepage-survey.js": "function render(){ return null; }" };
  const rows = await gapChecks(ctx(pages));
  const row = byId(rows, "offer:home-survey");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /form cannot post/);
  assert.match(row.detail, /survey-submit/);
});

test("gap funnels: a thrown fetch fails that door only", async () => {
  const pages = { ...GOOD, "/watch": { throw: "dns down" } };
  const rows = await gapChecks(ctx(pages));
  const watch = byId(rows, "funnel:watch");
  assert.equal(watch.status, "FAIL");
  assert.match(watch.detail, /unreachable: dns down/);
  assert.equal(rows.filter((item) => item.status === "PASS").length, rows.length - 1);
});

test("gap funnels: no fetch skips the live read", async () => {
  const rows = await gapChecks({ fetchImpl: null });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "skip");
  assert.equal(rows[0].id, "funnel:doors");
  assert.equal(rows[0].suggestedFix, null);
});

test("gap funnels: the pulse's names work (fetch, baseUrl, env.FUNNEL_URL) and fetch is read only", async () => {
  const calls = [];
  // The page names its scripts and videos on the app site it is told about.
  const pages = { ...GOOD, "/roadmap": roadmapHtml("https://preview.example.test") };
  const rows = await gapChecks({
    fetch: fakeFetch(pages, calls),
    baseUrl: "https://preview.example.test/",
    env: { FUNNEL_URL: "https://funnel.example.test" }
  });
  assert.equal(rows.length, GAP_DOORS.length + GAP_WIDGET_CHECKS.length);
  assert.ok(rows.every((r) => r.status === "PASS"), JSON.stringify(rows.filter((r) => r.status !== "PASS")));
  assert.ok(calls.every((c) => c.method === "GET" || c.method === "HEAD"));
  const hosts = new Set(calls.map((c) => new URL(c.url).host));
  // The two sites it was told about, plus the card company's script the widget loads. No hard-coded fundhub.ai.
  assert.deepEqual([...hosts].sort(), ["cdn.embedded.fanbasis.io", "funnel.example.test", "preview.example.test"]);
});

test("gap funnels: doors are read at the same time, not one after another", async () => {
  let inFlight = 0;
  let peak = 0;
  const inner = fakeFetch(GOOD, []);
  const fetchImpl = async (url, init) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      return await inner(url, init);
    } finally {
      inFlight -= 1;
    }
  };
  await gapChecks({ fetchImpl, funnelBaseUrl: FUNNEL, appBaseUrl: APP });
  assert.ok(peak >= 10, `peak in flight was ${peak}`);
});

// ---------------------------------------------------------------------------
// Tier 1, 2026-10-09: the six checks on what a buyer needs to pay and to book.
// Fake fetch only. Every call is a GET or a HEAD.
// ---------------------------------------------------------------------------

const ID = {
  card: "funnel:card-box-script-loads",
  book: "funnel:book-and-order-pages-live",
  price: "funnel:order-price-matches-till",
  track: "funnel:roadmap-tracking-scripts",
  video: "funnel:sales-videos-play",
  cors: "funnel:widget-cross-site-call"
};

const failing = (rows) => rows.filter((r) => r.status === "FAIL").map((r) => r.id).sort();

async function runWith(change, calls = []) {
  return gapChecks(ctx({ ...GOOD, ...change }, calls));
}

test("tier 1: six new ids, none repeated, none a door id", () => {
  const ids = GAP_WIDGET_CHECKS.map((c) => c.id);
  assert.deepEqual([...ids].sort(), Object.values(ID).sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => !GAP_DOORS.some((d) => d.id === id)));
});

test("tier 1: on the real shape of the pages all six pass and say what they read", async () => {
  const rows = await runWith({});
  for (const id of Object.values(ID)) assert.equal(byId(rows, id).status, "PASS", `${id} ${byId(rows, id).detail}`);
  assert.match(byId(rows, ID.card).detail, /embed\/index\.js answers 200 as JavaScript/);
  assert.match(byId(rows, ID.track).detail, /fh-attribution\.js, fh-events\.js, vsl-watch-beacon\.js, Clarity clarity\.js/);
  assert.match(byId(rows, ID.cors).detail, /slo-checkout, slo-pull, slo-status, slo-repair-checkout/);
});

// ---- card box script -------------------------------------------------------

test("card box: the card company's script gone (404) fails only the card box row", async () => {
  const rows = await runWith({ "/embed/index.js": { status: 404, body: "Not found" } });
  assert.deepEqual(failing(rows), [ID.card]);
  assert.match(byId(rows, ID.card).detail, /embed\/index\.js answered 404/);
  assert.match(byId(rows, ID.card).suggestedFix, /no script means no sale/);
});

test("card box: a 200 that is a web page, not JavaScript, fails", async () => {
  const rows = await runWith({ "/embed/index.js": { body: "<html>maintenance</html>", headers: { "content-type": "text/html" } } });
  assert.deepEqual(failing(rows), [ID.card]);
  assert.match(byId(rows, ID.card).detail, /came back as text\/html, not JavaScript/);
});

test("card box: with no content type, a body that starts with a tag still fails", async () => {
  const rows = await runWith({ "/embed/index.js": { body: "<html></html>", headers: { "content-type": "" } } });
  assert.match(byId(rows, ID.card).detail, /came back as a web page, not JavaScript/);
});

test("card box: an empty or tiny script fails", async () => {
  const empty = byId(await runWith({ "/embed/index.js": { body: "  " } }), ID.card);
  assert.equal(empty.status, "FAIL");
  assert.match(empty.detail, /came back empty/);
  const tiny = byId(await runWith({ "/embed/index.js": { body: "var a=1;" } }), ID.card);
  assert.equal(tiny.status, "FAIL");
  assert.match(tiny.detail, /too small to be the card box code/);
});

test("card box: a script that no longer defines PaymentCheckout fails", async () => {
  const rows = await runWith({ "/embed/index.js": { body: `var other=1;/*${"x".repeat(MIN_CARD_BOX_BYTES)}*/` } });
  assert.equal(byId(rows, ID.card).status, "FAIL");
  assert.match(byId(rows, ID.card).detail, /no longer defines PaymentCheckout/);
});

test("card box: the page no longer naming a card box script fails", async () => {
  const rows = await runWith({ "/roadmap": roadmapHtml(APP, { sdk: false }) });
  assert.equal(byId(rows, ID.card).status, "FAIL");
  assert.match(byId(rows, ID.card).detail, /no longer names a card box script/);
});

test("card box: the script host being unreachable fails", async () => {
  const rows = await runWith({ "/embed/index.js": { throw: "getaddrinfo ENOTFOUND" } });
  assert.equal(byId(rows, ID.card).status, "FAIL");
  assert.match(byId(rows, ID.card).detail, /unreachable: getaddrinfo ENOTFOUND/);
});

test("card box, tracking and videos: with /roadmap down they skip and say why, and the page row fails once", async () => {
  const rows = await runWith({ "/roadmap": { status: 404, body: "nope" } });
  for (const id of [ID.card, ID.track, ID.video]) {
    assert.equal(byId(rows, id).status, "skip", id);
    assert.match(byId(rows, id).detail, /\/roadmap answered 404/);
    assert.match(byId(rows, id).detail, /funnel:roadmap-checkout reports the page/);
  }
  assert.equal(byId(rows, "funnel:roadmap-checkout").status, "FAIL");
  assert.deepEqual(failing(rows), ["funnel:roadmap-checkout"]);
});

// ---- the call calendar and the order page ----------------------------------

test("book and order: the call calendar page down (404) fails", async () => {
  const rows = await runWith({ "/schedule/phonecall": { status: 404, body: "gone" } });
  assert.deepEqual(failing(rows), [ID.book]);
  assert.match(byId(rows, ID.book).detail, /\/schedule\/phonecall answered 404/);
  assert.match(byId(rows, ID.book).suggestedFix, /Chris does not open ClickFunnels/);
});

test("book and order: a calendar page that lost its calendar box, its token, or its query fails", async () => {
  const noBox = byId(await runWith({ "/schedule/phonecall": phonecallHtml({ picker: false }) }), ID.book);
  assert.equal(noBox.status, "FAIL");
  assert.match(noBox.detail, /lost its calendar box/);
  const noToken = byId(await runWith({ "/schedule/phonecall": phonecallHtml({ token: false }) }), ID.book);
  assert.equal(noToken.status, "FAIL");
  assert.match(noToken.detail, /no access token, so it can show no times/);
  const noQuery = byId(await runWith({ "/schedule/phonecall": phonecallHtml({ query: false }) }), ID.book);
  assert.equal(noQuery.status, "FAIL");
  assert.match(noQuery.detail, /no availability query/);
});

test("book and order: the old /order page never turns this row red, whatever state it is in", async () => {
  // The way out of the price mismatch is to take /order down (checker, 2026-10-09). A page
  // that is meant to go must not keep the call calendar row red every morning.
  const states = {
    gone404: { status: 404, body: "" },
    gone410: { status: 410, body: "" },
    down500: { status: 500, body: "" },
    redirected: { body: "<title>Roadmap</title>", endedAt: "/roadmap" },
    noForm: orderHtml(14700, { form: false }),
    noPrice: orderHtml(14700, { price: false }),
    unreachable: { throw: "getaddrinfo ENOTFOUND" }
  };
  for (const [name, order] of Object.entries(states)) {
    const rows = await runWith({ "/order": order });
    assert.equal(byId(rows, ID.book).status, "PASS", `${name}: ${byId(rows, ID.book).detail}`);
    assert.ok(!failing(rows).includes(ID.book), name);
  }
});

test("book and order: only the calendar page decides this row, and the bad /order is not named in its failure", async () => {
  const rows = await runWith({ "/schedule/phonecall": { status: 404, body: "" }, "/order": { status: 404, body: "" } });
  const row = byId(rows, ID.book);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /\/schedule\/phonecall answered 404/);
  assert.doesNotMatch(row.detail, /\/order/);
  assert.doesNotMatch(row.suggestedFix, /order page/);
});

test("book and order: this row never reads /order at all", async () => {
  const calls = [];
  const rows = await runWith({}, calls);
  assert.equal(byId(rows, ID.book).status, "PASS");
  assert.match(byId(rows, ID.book).detail, /funnel:order-price-matches-till/);
  // /order is fetched once, by the price row.
  assert.equal(calls.filter((c) => c.url === `${FUNNEL}/order`).length, 1);
});

// ---- the order page charges what the till charges --------------------------

test("order price: /order at $297 while the till says $147 fails, and the page row stays green", async () => {
  const rows = await runWith({ "/order": orderHtml(29700) });
  assert.deepEqual(failing(rows), [ID.price]);
  assert.equal(byId(rows, ID.book).status, "PASS");
  assert.match(byId(rows, ID.price).detail, /charges \$297 but the till says \$147/);
  assert.match(byId(rows, ID.price).suggestedFix, /make \/order match the till, or take \/order down/);
});

test("order price: the same price on both passes, whichever price it is", async () => {
  const same = byId(await runWith({}), ID.price);
  assert.equal(same.status, "PASS");
  assert.match(same.detail, /both say \$147/);
  const till297 = JSON.stringify({ ok: true, priceCents: 29700, priceDisplay: "$297", demo: false, checkout: { ready: true } });
  const rows = await runWith({ "/order": orderHtml(29700), "/api/public/slo-checkout": { body: till297, cors: "GET, POST, OPTIONS" } });
  assert.equal(byId(rows, ID.price).status, "PASS");
  assert.match(byId(rows, ID.price).detail, /both say \$297/);
});

test("order price: when the till cannot be read it skips, never passes", async () => {
  const tillDown = byId(await runWith({ "/api/public/slo-checkout": { status: 500, body: "boom" } }), ID.price);
  assert.equal(tillDown.status, "skip");
  assert.match(tillDown.detail, /funnel:roadmap-checkout reports the till/);
  const tillJunk = byId(await runWith({ "/api/public/slo-checkout": { body: "<html>", cors: "GET, POST, OPTIONS" } }), ID.price);
  assert.equal(tillJunk.status, "skip");
  assert.match(tillJunk.detail, /gave no usable price/);
});

test("order price: an order page that errors or cannot be reached skips, never passes and never fails", async () => {
  const down500 = byId(await runWith({ "/order": { status: 500, body: "" } }), ID.price);
  assert.equal(down500.status, "skip");
  assert.match(down500.detail, /\/order answered 500, so its price was not read/);
  const blocked = byId(await runWith({ "/order": { status: 403, body: "" } }), ID.price);
  assert.equal(blocked.status, "skip");
  const unreachable = byId(await runWith({ "/order": { throw: "getaddrinfo ENOTFOUND" } }), ID.price);
  assert.equal(unreachable.status, "skip");
  assert.match(unreachable.detail, /unreachable: getaddrinfo ENOTFOUND/);
});

test("order price: a live checkout with no price skips", async () => {
  const noPrice = byId(await runWith({ "/order": orderHtml(14700, { price: false }) }), ID.price);
  assert.equal(noPrice.status, "skip");
  assert.match(noPrice.detail, /has a checkout form but shows no price/);
});

// ---- taking /order down clears the price row, for good ---------------------

test("order price: /order taken down (404 or 410) is the fix, so the row passes and says it is retired", async () => {
  for (const status of [404, 410]) {
    const rows = await runWith({ "/order": { status, body: "" } });
    const row = byId(rows, ID.price);
    assert.equal(row.status, "PASS", `${status}: ${row.detail}`);
    assert.equal(row.suggestedFix, null);
    assert.match(row.detail, new RegExp(`answers ${status}: the old order page is down`));
    assert.deepEqual(failing(rows), [], `${status}: nothing is red once /order is down`);
  }
});

test("order price: /order sent on to another page (a redirect off /order) is the fix too, so the row passes", async () => {
  const rows = await runWith({ "/order": { body: "<title>Roadmap</title>", endedAt: "/roadmap" } });
  const row = byId(rows, ID.price);
  assert.equal(row.status, "PASS", row.detail);
  assert.match(row.detail, /sends buyers on to https:\/\/apply\.fundhub\.ai\/roadmap: the old order page is retired/);
  assert.deepEqual(failing(rows), []);
});

test("order price: a redirect that stays on /order (a trailing slash) does not count as retired", async () => {
  // Same page at /order/ with the wrong price must still go red.
  const rows = await runWith({ "/order": { body: orderHtml(29700), endedAt: "/order/" } });
  assert.equal(byId(rows, ID.price).status, "FAIL");
  assert.match(byId(rows, ID.price).detail, /charges \$297 but the till says \$147/);
});

test("order price: a fetch that does not say where it ended (no url) never reads as retired", async () => {
  // Some fetches give no response url. Then a wrong price must stay red, not pass as "sent on".
  const inner = fakeFetch({ ...GOOD, "/order": orderHtml(29700) }, []);
  const fetchImpl = async (url, init) => {
    const res = await inner(url, init);
    return { status: res.status, headers: res.headers, text: res.text };
  };
  const rows = await gapChecks({ fetchImpl, funnelBaseUrl: FUNNEL, appBaseUrl: APP });
  assert.equal(byId(rows, ID.price).status, "FAIL");
  assert.match(byId(rows, ID.price).detail, /charges \$297 but the till says \$147/);
});

test("order price: /order answering 200 without a checkout form skips with the reason (not red, not a green)", async () => {
  const rows = await runWith({ "/order": orderHtml(14700, { form: false }) });
  const row = byId(rows, ID.price);
  assert.equal(row.status, "skip");
  assert.match(row.detail, /is not a checkout any more \(no checkout form\)/);
  assert.deepEqual(failing(rows), []);
  // A price in the page with no form is not read as a price to compare.
  const wrong = await runWith({ "/order": orderHtml(29700, { form: false }) });
  assert.equal(byId(wrong, ID.price).status, "skip");
});

test("order price: the wrong price stays red only while /order is a working checkout", async () => {
  const live = await runWith({ "/order": orderHtml(29700) });
  assert.equal(byId(live, ID.price).status, "FAIL");
  assert.match(byId(live, ID.price).suggestedFix, /take \/order down \(a 404, a 410, or a redirect off \/order clears this row\)/);
  const down = await runWith({ "/order": { status: 404, body: "" } });
  assert.equal(byId(down, ID.price).status, "PASS");
  assert.equal(failing(down).length, 0);
});

// ---- the scripts that tie a sale to an ad ----------------------------------

test("tracking: the four scripts come from the same manifest the page push uses", () => {
  assert.deepEqual(
    TRACKING_SCRIPTS.map((s) => s.path),
    ["/funnel/fh-attribution.js", "/funnel/fh-events.js", "/funnel/vsl-watch-beacon.js", "/js/clarity.js"]
  );
});

test("tracking: each of the four scripts dropped from the page fails, and names itself", async () => {
  const cases = [
    ["attribution", /does not load fh-attribution\.js/],
    ["events", /does not load fh-events\.js/],
    ["beacon", /does not load vsl-watch-beacon\.js/],
    ["clarity", /does not load Clarity clarity\.js/]
  ];
  for (const [part, re] of cases) {
    const rows = await runWith({ "/roadmap": roadmapHtml(APP, { [part]: false }) });
    assert.deepEqual(failing(rows), [ID.track], part);
    assert.match(byId(rows, ID.track).detail, re, part);
    assert.match(byId(rows, ID.track).suggestedFix, /tie a sale to the ad/);
  }
});

test("tracking: a script that is only inside a comment does not count", async () => {
  const html = roadmapHtml(APP, { attribution: false }) + `\n<!-- <script src="${APP}/funnel/fh-attribution.js"></script> -->`;
  const row = byId(await runWith({ "/roadmap": html }), ID.track);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /does not load fh-attribution\.js/);
});

test("tracking: a script file that is gone (404) or is a web page fails", async () => {
  const gone = byId(await runWith({ "/funnel/fh-events.js": { status: 404, body: "" } }), ID.track);
  assert.equal(gone.status, "FAIL");
  assert.match(gone.detail, /fh-events\.js answered 404/);
  const html = byId(await runWith({ "/js/clarity.js": { body: "<html>x</html>", headers: { "content-type": "text/html" } } }), ID.track);
  assert.equal(html.status, "FAIL");
  assert.match(html.detail, /Clarity clarity\.js came back as text\/html, not JavaScript/);
  const empty = byId(await runWith({ "/funnel/fh-attribution.js": { body: "" } }), ID.track);
  assert.equal(empty.status, "FAIL");
  assert.match(empty.detail, /fh-attribution\.js came back empty/);
});

test("tracking: any other script from our own site that the page names must answer too; other sites' scripts are not read", async () => {
  const extra =
    roadmapHtml(APP) +
    `\n<script src="${APP}/funnel/money-extra.js"></script><script src="https://sdk.myclickfunnels.com/sdk.js"></script>`;
  const calls = [];
  const rows = await gapChecks(ctx({ ...GOOD, "/roadmap": extra }, calls));
  assert.equal(byId(rows, ID.track).status, "FAIL");
  assert.match(byId(rows, ID.track).detail, /money-extra\.js answered 404/);
  assert.ok(!calls.some((c) => c.url.includes("sdk.myclickfunnels.com")));
});

test("tracking: a version tag on the script address still counts as loaded", async () => {
  const html = roadmapHtml(APP).replace("/funnel/fh-events.js", "/funnel/fh-events.js?v=7");
  const row = byId(await runWith({ "/roadmap": html }), ID.track);
  assert.equal(row.status, "PASS", row.detail);
});

// ---- the sales page videos -------------------------------------------------

test("videos: a main video file that is gone (404 on HEAD) fails, only that row", async () => {
  const rows = await runWith({ "/funnel/slo-vsl.mp4": { status: 404, body: "" } });
  assert.deepEqual(failing(rows), [ID.video]);
  assert.match(byId(rows, ID.video).detail, /slo-vsl\.mp4 answered 404/);
});

test("videos: a poster served as a web page, a video served as a web page, and a size 0 file all fail", async () => {
  const poster = byId(await runWith({ "/funnel/slo-vsl-poster.jpg": { headers: { "content-type": "text/html" } } }), ID.video);
  assert.equal(poster.status, "FAIL");
  assert.match(poster.detail, /slo-vsl-poster\.jpg came back as text\/html, not a picture/);
  const video = byId(await runWith({ "/funnel/slo-vsl.mp4": { headers: { "content-type": "text/html" } } }), ID.video);
  assert.equal(video.status, "FAIL");
  assert.match(video.detail, /slo-vsl\.mp4 came back as text\/html, not a video/);
  const zero = byId(await runWith({ "/funnel/slo-testimonial-colin2.mp4": { headers: { "content-length": "0" } } }), ID.video);
  assert.equal(zero.status, "FAIL");
  assert.match(zero.detail, /slo-testimonial-colin2\.mp4 is empty \(size 0\)/);
});

test("videos: every bad file is named, not just the first", async () => {
  const rows = await runWith({
    "/funnel/slo-vsl.mp4": { status: 404, body: "" },
    "/funnel/slo-testimonial-colin2-poster.jpg": { status: 500, body: "" }
  });
  assert.match(byId(rows, ID.video).detail, /slo-vsl\.mp4 answered 404/);
  assert.match(byId(rows, ID.video).detail, /slo-testimonial-colin2-poster\.jpg answered 500/);
});

test("videos: a page with no video at all fails; a head request that throws fails", async () => {
  const none = byId(await runWith({ "/roadmap": roadmapHtml(APP, { vsl: false, testimonial: false }) }), ID.video);
  assert.equal(none.status, "FAIL");
  assert.match(none.detail, /names no video at all/);
  const threw = byId(await runWith({ "/funnel/slo-vsl.mp4": { throw: "socket hang up" } }), ID.video);
  assert.equal(threw.status, "FAIL");
  assert.match(threw.detail, /slo-vsl\.mp4 unreachable: socket hang up/);
});

test("videos: files are asked with HEAD only, so no video is downloaded", async () => {
  const calls = [];
  await runWith({}, calls);
  const media = calls.filter((c) => /\.(mp4|jpg)$/.test(c.url));
  assert.equal(media.length, 4);
  assert.ok(media.every((c) => c.method === "HEAD"));
});

// ---- the browser's cross-site rule -----------------------------------------

test("cross-site: each of the four widget doors is called the way the browser calls it, with the page's Origin", async () => {
  const calls = [];
  await runWith({}, calls);
  for (const door of WIDGET_DOORS) {
    const hit = calls.filter((c) => c.url === `${APP}${door.path}` && c.origin === FUNNEL);
    assert.equal(hit.length, 1, `${door.path} should be read once with Origin ${FUNNEL}`);
    assert.equal(hit[0].method, "GET");
  }
});

test("cross-site: the door that fails is named; a 400 or 405 to a bare GET is normal", async () => {
  const rows = await runWith({});
  assert.equal(byId(rows, ID.cors).status, "PASS");
  const dead = byId(await runWith({ "/api/public/slo-status": { status: 500, body: "", cors: "GET, OPTIONS" } }), ID.cors);
  assert.equal(dead.status, "FAIL");
  assert.match(dead.detail, /slo-status answered 500/);
  assert.match(dead.suggestedFix, /src\/slo\/cors\.mjs/);
  const gone = byId(await runWith({ "/api/public/slo-repair-checkout": undefined }), ID.cors);
  assert.equal(gone.status, "FAIL");
  assert.match(gone.detail, /slo-repair-checkout is gone \(answered 404\)/);
  const refused = byId(await runWith({ "/api/public/slo-pull": { status: 403, body: "", cors: "POST, OPTIONS" } }), ID.cors);
  assert.equal(refused.status, "FAIL");
  assert.match(refused.detail, /slo-pull answered 403/);
});

test("cross-site: no permission header, or permission for another site, fails", async () => {
  const none = byId(await runWith({ "/api/public/slo-status": { status: 400, body: "{}" } }), ID.cors);
  assert.equal(none.status, "FAIL");
  assert.match(none.detail, /slo-status gives https:\/\/apply\.fundhub\.ai no permission, so the browser blocks the call/);
  const other = byId(
    await runWith({ "/api/public/slo-checkout": { body: TILL, cors: "GET, POST, OPTIONS", corsOrigin: "https://evil.example" } }),
    ID.cors
  );
  assert.equal(other.status, "FAIL");
  assert.match(other.detail, /slo-checkout gives https:\/\/apply\.fundhub\.ai no permission/);
  const star = byId(
    await runWith({ "/api/public/slo-status": { status: 400, body: "{}", cors: "GET, OPTIONS", corsOrigin: "*" } }),
    ID.cors
  );
  assert.equal(star.status, "PASS", star.detail);
});

test("cross-site: a post door that does not allow POST or the content-type header fails", async () => {
  const noPost = byId(await runWith({ "/api/public/slo-pull": { status: 405, body: "", cors: "GET, OPTIONS" } }), ID.cors);
  assert.equal(noPost.status, "FAIL");
  assert.match(noPost.detail, /slo-pull does not allow POST across sites/);
  const noHeader = byId(
    await runWith({ "/api/public/slo-checkout": { body: TILL, cors: "GET, POST, OPTIONS", corsHeaders: "x-other" } }),
    ID.cors
  );
  assert.equal(noHeader.status, "FAIL");
  assert.match(noHeader.detail, /slo-checkout does not allow the content-type header/);
  const noGet = byId(await runWith({ "/api/public/slo-status": { status: 400, body: "", cors: "POST, OPTIONS" } }), ID.cors);
  assert.equal(noGet.status, "FAIL");
  assert.match(noGet.detail, /slo-status does not allow GET across sites/);
});

test("cross-site: the four doors are real routes in the api route table", async () => {
  const { readFileSync } = await import("node:fs");
  const table = readFileSync(new URL("../../../netlify/functions/api.mjs", import.meta.url), "utf8");
  for (const door of WIDGET_DOORS) {
    const key = door.path.replace("/api/", "");
    assert.ok(table.includes(`"${key}":`), `${key} is not in the ROUTES map`);
  }
});

// ---- the whole lane --------------------------------------------------------

test("tier 1: a call that never answers ends in skips at the deadline, never in a pass", async () => {
  const started = Date.now();
  const rows = await gapChecks({
    fetchImpl: () => new Promise(() => {}),
    funnelBaseUrl: FUNNEL,
    appBaseUrl: APP,
    deadlineMs: 40
  });
  assert.ok(Date.now() - started < 3000);
  assert.equal(rows.length, GAP_DOORS.length + GAP_WIDGET_CHECKS.length);
  assert.ok(rows.every((r) => r.status === "skip"), JSON.stringify(rows.filter((r) => r.status !== "skip")));
  assert.ok(rows.every((r) => /did not finish in 40 ms/.test(r.detail)));
});

test("tier 1: never a POST, never a PUT, in any run", async () => {
  const calls = [];
  await runWith({}, calls);
  await runWith({ "/roadmap": { status: 500, body: "" } }, calls);
  await runWith({ "/embed/index.js": { throw: "x" }, "/order": orderHtml(29700) }, calls);
  assert.ok(calls.length > 60);
  assert.ok(calls.every((c) => c.method === "GET" || c.method === "HEAD"));
});

// ---- the page readers ------------------------------------------------------

test("readers: scripts are the real tags only, in full-address form", () => {
  const html =
    '<!-- <script src="/gone.js"></script> --><script src="/a.js"></script><script data-src="/no.js"></script>' +
    "<script src='https://x.example/b.js?v=2'></script><script>var s='src=\"/inline.js\"';</script>";
  assert.deepEqual(scriptSrcs(html, "https://apply.fundhub.ai/roadmap"), [
    "https://apply.fundhub.ai/a.js",
    "https://x.example/b.js?v=2"
  ]);
});

test("readers: videos are the src, the poster, and any source inside, each once", () => {
  const html =
    '<video poster="/p.jpg" src="/v.mp4"></video><video poster="/p.jpg"><source src="/w.mp4" type="video/mp4"></video>' +
    '<!-- <video src="/hidden.mp4"></video> -->';
  assert.deepEqual(videoFiles(html, "https://a.test/page"), [
    { url: "https://a.test/v.mp4", kind: "video" },
    { url: "https://a.test/p.jpg", kind: "poster" },
    { url: "https://a.test/w.mp4", kind: "video" }
  ]);
});

test("readers: the card box address, the order price, and the till price", () => {
  assert.equal(cardBoxScriptUrl("<script>var SDK_SRC='https://c.example/i.js';</script>", "https://a.test/"), "https://c.example/i.js");
  assert.equal(cardBoxScriptUrl('<script src="https://cdn.embedded.fanbasis.io/x.js"></script>', "https://a.test/"), "https://cdn.embedded.fanbasis.io/x.js");
  assert.equal(cardBoxScriptUrl("<p>nothing</p>", "https://a.test/"), null);
  assert.equal(orderPriceCents('{"price_cents":29700}'), 29700);
  assert.equal(orderPriceCents("{&quot;price_cents&quot;:14700}"), 14700);
  assert.equal(orderPriceCents("no price"), null);
  assert.equal(tillPriceCents(TILL), 14700);
  assert.equal(tillPriceCents('{"priceDisplay":"$1,297.50"}'), 129750);
  assert.equal(tillPriceCents("{}"), null);
  assert.equal(tillPriceCents("<html>"), null);
});
