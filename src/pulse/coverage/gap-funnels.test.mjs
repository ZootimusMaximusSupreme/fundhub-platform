import test from "node:test";
import assert from "node:assert/strict";

import { GAP_DOORS, gapChecks } from "./gap-funnels.mjs";

const FUNNEL = "https://apply.fundhub.ai";
const APP = "https://fundhub.ai";

const GOOD = {
  "/roadmap": '<section id="fh-order">Get My Roadmap — Funding Roadmap</section> slo-checkout',
  "/watch": "Get Started <!-- fh-watch-lede:start -->",
  "/thank-you": "You're All Set <script src=\"https://fundhub.ai/funnel/thankyou-sort.js\"></script>",
  "/roadmap-thank-you": "You're All Set <section id=\"fh-expect\"></section>",
  "/apply": "cf_svy_funding_target_amount fetch('https://fundhub.ai/api/webhooks/clickfunnels', { method: 'POST' })",
  "/roadmap-book": '<iframe id="fh-book-frame" src="https://apply.fundhub.ai/funding-book-call"></iframe>',
  "/funding-book-call": "Book Your Funding Call <div id=\"formContainer\"></div>",
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
    if (!hit) {
      return { status: 404, text: async () => "missing fixture" };
    }
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
});

test("gap funnels: sales page 404 fails and does not post", async () => {
  const calls = [];
  const pages = { ...GOOD, "/roadmap": { status: 404, body: "not found" } };
  const rows = await gapChecks(ctx(pages, calls));
  const row = rows.find((item) => item.id === "funnel:roadmap-sales");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /\/roadmap answered 404/);
  assert.match(row.suggestedFix, /Recon/);
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("gap funnels: HTTP 200 with the checkout anchor gone fails", async () => {
  const pages = {
    ...GOOD,
    "/roadmap": "Get My Roadmap Funding Roadmap slo-checkout"
  };
  const rows = await gapChecks(ctx(pages));
  const row = rows.find((item) => item.id === "funnel:roadmap-sales");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /checkout anchor fh-order/);
  assert.equal(rows.filter((item) => item.status === "FAIL").length, 1);
});

test("gap funnels: watch and thank-you down fail", async () => {
  const pages = {
    ...GOOD,
    "/watch": { status: 503, body: "" },
    "/thank-you": { status: 404, body: "" }
  };
  const rows = await gapChecks(ctx(pages));
  const watch = rows.find((item) => item.id === "funnel:watch");
  const thanks = rows.find((item) => item.id === "funnel:thank-you");
  assert.equal(watch.status, "FAIL");
  assert.match(watch.detail, /\/watch answered 503/);
  assert.equal(thanks.status, "FAIL");
  assert.match(thanks.detail, /\/thank-you answered 404/);
});

test("gap funnels: apply form that cannot post fails", async () => {
  const pages = { ...GOOD, "/apply": "cf_svy_funding_target_amount <form></form>" };
  const rows = await gapChecks(ctx(pages));
  const row = rows.find((item) => item.id === "funnel:apply-form");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /form cannot post/);
  assert.match(row.detail, /webhooks\/clickfunnels/);
});

test("gap funnels: morning status-only page fails when the checkout hook is gone", async () => {
  const pages = {
    ...GOOD,
    "/partner/trial/": "<h1>Trial</h1><script src=\"/partner/funnel.js\"></script>"
  };
  const rows = await gapChecks(ctx(pages));
  const row = rows.find((item) => item.id === "offer:partner-trial");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /answered 200/);
  assert.match(row.detail, /morning ping only checks HTTP status/);
  assert.match(row.detail, /trial checkout form/);
  assert.match(row.detail, /form cannot post/);
});

test("gap funnels: homepage survey script without a post fails", async () => {
  const pages = { ...GOOD, "/js/homepage-survey.js": "function render(){ return null; }" };
  const rows = await gapChecks(ctx(pages));
  const row = rows.find((item) => item.id === "offer:home-survey");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /form cannot post/);
  assert.match(row.detail, /survey-submit/);
});

test("gap funnels: a thrown fetch fails that door only", async () => {
  const rows = await gapChecks({
    funnelBaseUrl: FUNNEL,
    appBaseUrl: APP,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/watch")) throw new Error("dns down");
      const key = keyOf(url);
      const hit = GOOD[key];
      return { status: 200, text: async () => hit };
    }
  });
  const watch = rows.find((item) => item.id === "funnel:watch");
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
