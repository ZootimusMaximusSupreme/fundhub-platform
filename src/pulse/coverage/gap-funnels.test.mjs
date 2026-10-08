import test from "node:test";
import assert from "node:assert/strict";

import { GAP_DOORS, gapChecks, tillProblems } from "./gap-funnels.mjs";

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

const GOOD = {
  "/roadmap": '<section id="fh-order">Get My Roadmap — Funding Roadmap</section> call("GET","slo-checkout") call(\'POST\',\'slo-checkout\',body) <b>$147</b>',
  "/api/public/slo-checkout": TILL,
  "/api/public/slo-pull": { status: 405, body: '{"ok":false,"error":"method_not_allowed"}' },
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

function fakeFetch(pages, calls) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    const key = keyOf(url);
    const hit = pages[key];
    if (hit === undefined) {
      return { status: 404, text: async () => "missing fixture" };
    }
    if (hit && hit.throw) throw new Error(hit.throw);
    return { status: hit.status ?? 200, text: async () => hit.body ?? hit };
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
  assert.equal(rows.length, GAP_DOORS.length);
  assert.equal(GAP_DOORS.length, 21);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["detail", "id", "status", "suggestedFix"]);
    assert.equal(row.status, "PASS", `${row.id} ${row.detail}`);
    assert.equal(row.suggestedFix, null);
  }
  assert.ok(calls.length >= GAP_DOORS.length);
  assert.ok(calls.every((call) => call.method === "GET"));
  assert.ok(calls.every((call) => call.url.startsWith(FUNNEL) || call.url.startsWith(APP)));
  // One GET per address: the till is read once for the page, not once per reader.
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
  const pages = { ...GOOD, "/roadmap": "Get My Roadmap Funding Roadmap fh-order $147" };
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
  assert.equal(rows.filter((item) => item.status === "PASS").length, GAP_DOORS.length - 1);
});

test("gap funnels: no fetch skips the live read", async () => {
  const rows = await gapChecks({ fetchImpl: null });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "skip");
  assert.equal(rows[0].id, "funnel:doors");
  assert.equal(rows[0].suggestedFix, null);
});

test("gap funnels: the pulse's names work (fetch, baseUrl, env.FUNNEL_URL) and fetch is GET only", async () => {
  const calls = [];
  const rows = await gapChecks({
    fetch: fakeFetch(GOOD, calls),
    baseUrl: "https://preview.example.test/",
    env: { FUNNEL_URL: "https://funnel.example.test" }
  });
  assert.equal(rows.length, GAP_DOORS.length);
  assert.ok(rows.every((r) => r.status === "PASS"), JSON.stringify(rows.filter((r) => r.status !== "PASS")));
  assert.ok(calls.every((c) => c.method === "GET"));
  const hosts = new Set(calls.map((c) => new URL(c.url).host));
  assert.deepEqual([...hosts].sort(), ["funnel.example.test", "preview.example.test"]);
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
