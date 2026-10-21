// roadmap-pages: every hour, can a buyer on /roadmap still see the card boxes, and does the old /order
// page still charge what the till charges?
//
// Same reads, same verdicts as the morning checks in gap-funnels.mjs (the truth lives in
// lib/funnel-pages-truth.mjs):
//   funnel:card-box-script-loads     GET https://apply.fundhub.ai/roadmap (268 KB; the card box script tag
//                                    sits near byte 195,000, so the probe reads this host up to 512 KB),
//                                    find the SDK_SRC the widget loads, GET that script: it must answer
//                                    200 as JavaScript, be big enough to be the card box code, and still
//                                    define PaymentCheckout. No script, no card boxes, no sale.
//   funnel:order-price-matches-till  GET https://apply.fundhub.ai/order (290 KB). While it is a working
//                                    checkout, its price must equal the till's (GET /api/public/slo-checkout,
//                                    asked the way the widget asks, from apply.fundhub.ai). A 404, a 410 or
//                                    a redirect off /order is green: a page that is gone charges nothing.
//
// What it guards, and why each surface is on `covers`:
//   page:roadmap/index.html   funnel:card-box-script-loads here; lead:pipe-cut-with-traffic at the
//                             lead-pipe-cut-with-traffic step of the lead-pipe beat
//   page:roadmap/pay.html     funnel:order-price-matches-till here; payments:checkout-started-no-link at the
//                             payments-checkout-started-no-link step of the pay-links beat
// Those are the exact deep checks src/pulse/tripwires.mjs names; the test holds each to an hourly step.
//
// Read only: GETs through ctx.http to apply.fundhub.ai, our own site (the till) and the card company's
// script host ("*" never reaches our own main site). No read of the database beyond the company id.
// Never takes a card, never posts a lead, never opens ClickFunnels.

import { laneSelfTest, runLaneBeat } from "./lib/money-hourly.mjs";
import { checkCardBox, checkOrderPrice, makeGetter } from "./lib/funnel-pages-truth.mjs";
import { webFromHttp } from "./lib/web-reader.mjs";

export const HOURLY_CHECK_IDS = Object.freeze(["funnel:card-box-script-loads", "funnel:order-price-matches-till"]);

/** The deep checks a covered page names that run hourly in another beat: check id -> [beat id, step]. */
export const RUNS_ELSEWHERE = Object.freeze({
  "lead:pipe-cut-with-traffic": Object.freeze(["lead-pipe", "lead-pipe-cut-with-traffic"]),
  "payments:checkout-started-no-link": Object.freeze(["pay-links", "payments-checkout-started-no-link"])
});

/** The only funnel host this beat may read (declared in `reads`). */
export const FUNNEL_HOST = "apply.fundhub.ai";
export const DEFAULT_FUNNEL_ORIGIN = `https://${FUNNEL_HOST}`;

const SITE = "https://fundhub.ai";
const SDK = "https://cdn.embedded.fanbasis.io/embed/index.js";
const ROADMAP_PAGE = `<html><body>${"x".repeat(1000)}<script>var SDK_SRC='${SDK}';window.PaymentCheckout&&PaymentCheckout.create({});</script></body></html>`;
const CARD_JS = `(function(){window.PaymentCheckout={create:function(){}};${"/* card box */".repeat(300)}})();`;
const orderPage = (cents) => `<div data-page-element="Checkout/V2"><button class="CheckoutSubmitButton">Pay</button><script>{"price_cents":${cents}}</script></div>`;
const TILL = JSON.stringify({ ok: true, priceCents: 14700, priceDisplay: "$147", checkout: { ready: true }, demo: false });
const HTML = Object.freeze({ "content-type": "text/html; charset=utf-8" });

const GOOD = Object.freeze({
  [`GET ${DEFAULT_FUNNEL_ORIGIN}/roadmap`]: Object.freeze({ status: 200, body: ROADMAP_PAGE, headers: HTML }),
  [`GET ${SDK}`]: Object.freeze({ status: 200, body: CARD_JS, headers: Object.freeze({ "content-type": "text/javascript" }) }),
  [`GET ${DEFAULT_FUNNEL_ORIGIN}/order`]: Object.freeze({ status: 200, body: orderPage(14700), headers: HTML, finalUrl: `${DEFAULT_FUNNEL_ORIGIN}/order` }),
  [`GET ${SITE}/api/public/slo-checkout`]: Object.freeze({ status: 200, body: TILL, headers: Object.freeze({ "content-type": "application/json" }) })
});

function originOf(value, fallback) {
  return String(value || fallback).replace(/\/+$/, "");
}

function hostOf(origin) {
  try { return new URL(origin).hostname.toLowerCase(); } catch { return ""; }
}

export const LANE = Object.freeze({
  checks: Object.freeze(HOURLY_CHECK_IDS.map((checkId) => Object.freeze({ id: checkId, step: checkId.replaceAll(":", "-") }))),
  /** web is a fetch-shaped reader over ctx.http (lib/web-reader.mjs). Same origins the morning lane uses. */
  runWith: async (io, web) => {
    const origins = {
      funnel: originOf(io.env && io.env.FUNNEL_URL, DEFAULT_FUNNEL_ORIGIN),
      app: originOf(io.baseUrl, SITE)
    };
    if (hostOf(origins.funnel) !== FUNNEL_HOST) {
      const why = `FUNNEL_URL points at ${hostOf(origins.funnel) || "an address that is not one"}, a host this beat may not read, so the funnel pages were not opened`;
      return HOURLY_CHECK_IDS.map((checkId) => ({ id: checkId, status: "skip", detail: why, suggestedFix: null }));
    }
    const get = makeGetter(web);
    return Promise.all([checkCardBox(get, origins), checkOrderPrice(get, origins)]);
  },
  selfTest: Object.freeze({
    passHttp: GOOD,
    // The card company now answers the script address with an error page: no card boxes, no sale.
    failHttp: Object.freeze({
      ...GOOD,
      [`GET ${SDK}`]: Object.freeze({ status: 200, body: "<html><body>Bad gateway</body></html>", headers: HTML })
    })
  })
});

export const id = "roadmap-pages";
export const title = "Roadmap card box loads and order price matches";
export const kind = "probe";
export const covers = ["page:roadmap/index.html", "page:roadmap/pay.html"];
export const box = false;
export const reads = [
  { host: FUNNEL_HOST, methods: ["GET"] },
  { host: "SITE", methods: ["GET"] },
  { host: "*", methods: ["GET"] }
];
export const checkIds = HOURLY_CHECK_IDS;
export const steps = ["read", ...LANE.checks.map((check) => check.step)];
export const damp = 1;
export const deadlineMs = 11000;

export async function run(ctx) {
  const lane = { ...LANE, run: (io) => LANE.runWith(io, webFromHttp(ctx.http)) };
  return runLaneBeat(ctx, lane, { noun: "roadmap page" });
}

export const fixGuide = [
  "The roadmap card box script did not load, or the old /order page charges a price the till does not.",
  "",
  "Likely causes:",
  "- The card company's script address (the SDK_SRC on /roadmap) is down or now answers an error page.",
  "- The /roadmap page was re-pushed without the widget, so it no longer names a card box script.",
  "- The /order checkout still sells at an old price after the till price changed.",
  "",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs roadmap-pages and read the red step: it names the address and what it answered.",
  "- Open https://apply.fundhub.ai/roadmap, press Continue, and see if the card boxes draw on step 2. Check the card company's status page.",
  "- For /order, make it match the till price or take it down by API (a 404 or a redirect clears it). Chris never opens ClickFunnels.",
  "Files: src/pulse/beats/lib/funnel-pages-truth.mjs, src/pulse/coverage/gap-funnels.mjs, api/public/slo-checkout.mjs"
].join("\n");

export const selfTest = {
  pass: () => laneSelfTest(LANE),
  fail: () => laneSelfTest(LANE, true)
};
