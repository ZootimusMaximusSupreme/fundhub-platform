// Funnel and public offer doors. Read-only GET. Never posts a lead.
// Never mints a Commas product. Never opens ClickFunnels admin.
//
// The morning pulse (Recon, AG-07) already reads apply.fundhub.ai/roadmap for
// the checkout anchor (fh-order) and the offer line (funnel-doors.mjs). This
// file does not read those two again. On /roadmap it reads what Recon does not:
// the slo-checkout hook, whether the till is ready, and whether the page shows
// the price the till charges. Other funnel pages are not in Recon's body check.
// Public offer pages in the registry are scored up on HTTP 200 alone, so a blank
// page still looks fine. This file fails when a marker named in the page code is
// missing. A form's post door that the registry does not ping (slo-pull and the
// ClickFunnels webhook answer 405 to a GET by design) is read with one GET.
//
// One tripwire: Recon. This module does not register a second monitor.
//
// Tier 1, 2026-10-09: six checks on what a buyer needs to pay and to book. They
// read the live /roadmap page and what it loads (the card box script, the four
// tracking scripts, the videos), the call calendar, the old /order checkout, and
// the cross-site rule the widget lives by. GET and HEAD only. Each one asks a
// yes-or-no question a buyer would feel. See GAP_WIDGET_CHECKS.

import {
  CLARITY_SRC,
  FH_ATTRIBUTION_SRC,
  FH_EVENTS_SRC,
  VSL_WATCH_BEACON_SRC
} from "../../../marketing/landing-pages/tracking-manifest.mjs";

export const DEFAULT_FUNNEL_BASE_URL = "https://apply.fundhub.ai";
export const DEFAULT_APP_BASE_URL = "https://fundhub.ai";

const FIX =
  "Restore the missing offer copy, checkout hook, or form post on that live page. " +
  "If the till is not ready, is in demo mode, or shows another price, read GET /api/public/slo-checkout. " +
  "Do not post a lead from this check. Recon (AG-07) is the morning tripwire.";

/** Markers are the strings the page source already uses. */
export const GAP_DOORS = [
  {
    id: "funnel:roadmap-checkout",
    host: "funnel",
    path: "/roadmap",
    morning: "partial",
    formPost: true,
    passDetail: "the slo-checkout post and till read, a ready till, and the price the till charges",
    need: [
      // The embedded Pay widget calls the till by name. A comment that only
      // mentions slo-checkout does not count.
      { name: "checkout post slo-checkout", re: /call\(\s*["']POST["']\s*,\s*["']slo-checkout["']/ },
      { name: "till read slo-checkout", re: /call\(\s*["']GET["']\s*,\s*["']slo-checkout["']/ }
    ],
    till: { host: "app", path: "/api/public/slo-checkout", cors: true }
  },
  {
    id: "funnel:watch",
    host: "funnel",
    path: "/watch",
    morning: "none",
    passDetail: "Get Started and the watch lede block",
    need: [
      { name: "offer copy Get Started", re: /Get Started/ },
      { name: "watch lede fh-watch-lede", re: /<!--\s*fh-watch-lede:start/ }
    ]
  },
  {
    id: "funnel:thank-you",
    host: "funnel",
    path: "/thank-you",
    morning: "none",
    passDetail: "thank-you copy and thankyou-sort.js",
    need: [
      { name: "thank-you copy", re: /You(?:'|’|&rsquo;)re All Set/ },
      { name: "thank-you script thankyou-sort.js", re: /thankyou-sort\.js/ }
    ]
  },
  {
    id: "funnel:roadmap-thank-you",
    host: "funnel",
    path: "/roadmap-thank-you",
    morning: "none",
    passDetail: "roadmap thank-you copy and the next-step block",
    need: [
      { name: "roadmap thank-you copy", re: /You(?:'|’|&rsquo;)re All Set/ },
      { name: "roadmap thank-you block fh-expect", re: /id=["']fh-expect["']/ }
    ]
  },
  {
    id: "funnel:apply-form",
    host: "funnel",
    path: "/apply",
    morning: "none",
    formPost: true,
    postTo: { host: "app", path: "/api/webhooks/clickfunnels" },
    passDetail: "apply survey and its post to the ClickFunnels webhook",
    need: [
      { name: "survey cf_svy_funding_target_amount", re: /cf_svy_funding_target_amount/ },
      { name: "form post webhooks/clickfunnels", re: /webhooks\/clickfunnels/ },
      { name: "form post method POST", re: /method:\s*["']POST["']/ }
    ]
  },
  {
    id: "funnel:roadmap-book",
    host: "funnel",
    path: "/roadmap-book",
    morning: "none",
    passDetail: "booking frame for the funding call",
    need: [
      { name: "booking frame fh-book-frame", re: /id=["']fh-book-frame["']/ },
      { name: "booking page funding-book-call", re: /funding-book-call/ }
    ]
  },
  {
    id: "funnel:funding-book-call",
    host: "funnel",
    path: "/funding-book-call",
    morning: "none",
    passDetail: "booking offer copy, the calendar picker and the booking form",
    need: [
      { name: "booking offer copy", re: /Book Your Funding Call/ },
      { name: "calendar picker cronofy-date-time-picker", re: /id=["']cronofy-date-time-picker["']/ },
      { name: "booking form formContainer", re: /id=["']formContainer["']/ }
    ]
  },
  {
    id: "offer:partner",
    host: "app",
    path: "/partner/",
    morning: "status",
    passDetail: "partner price hook and funnel.js",
    need: [
      { name: "partner price hook", re: /data-price=["']partner["']/ },
      { name: "checkout script funnel.js", re: /\/partner\/funnel\.js/ }
    ]
  },
  {
    id: "offer:partner-menu",
    host: "app",
    path: "/partner/menu/",
    morning: "status",
    passDetail: "menu offer copy and price hooks",
    need: [
      { name: "menu offer copy", re: /Four Ways In/ },
      { name: "partner price label", re: /data-price-label=["']partner["']/ },
      { name: "checkout script funnel.js", re: /\/partner\/funnel\.js/ }
    ]
  },
  {
    id: "offer:partner-trial",
    host: "app",
    path: "/partner/trial/",
    morning: "status",
    formPost: true,
    passDetail: "trial checkout form and funnel.js",
    need: [
      { name: "trial checkout form", re: /data-checkout=["']trial["']/ },
      { name: "checkout script funnel.js", re: /\/partner\/funnel\.js/ }
    ]
  },
  {
    id: "offer:partner-board",
    host: "app",
    path: "/partner/board/",
    morning: "status",
    formPost: true,
    passDetail: "board checkout form and funnel.js",
    need: [
      { name: "board checkout form", re: /data-checkout=["']board["']/ },
      { name: "checkout script funnel.js", re: /\/partner\/funnel\.js/ }
    ]
  },
  {
    id: "offer:partner-checkout-script",
    host: "app",
    path: "/partner/funnel.js",
    morning: "none",
    formPost: true,
    accept: "text/javascript,*/*",
    passDetail: "the funnel-checkout post",
    need: [
      { name: "checkout hook funnel-checkout", re: /\/api\/public\/funnel-checkout/ },
      { name: "form post method POST", re: /method:\s*["']POST["']/ }
    ]
  },
  {
    id: "offer:education",
    host: "app",
    path: "/education/",
    morning: "status",
    passDetail: "enroll links on the course offer",
    need: [
      { name: "enroll link", re: /\/education\/enroll\// },
      { name: "enroll offer copy", re: /Enroll in Credit Mastery/ }
    ]
  },
  {
    id: "offer:education-enroll",
    host: "app",
    path: "/education/enroll/",
    morning: "status",
    formPost: true,
    passDetail: "the enroll form post",
    need: [
      { name: "enroll form", re: /id=["']enroll-form["']/ },
      { name: "form post education-enroll", re: /\/api\/public\/education-enroll/ },
      { name: "form post method POST", re: /method:\s*["']POST["']/ }
    ]
  },
  {
    id: "offer:affiliates",
    host: "app",
    path: "/affiliates/",
    morning: "status",
    formPost: true,
    passDetail: "the affiliate form post",
    need: [
      { name: "affiliate form", re: /id=["']pform["']/ },
      { name: "form post partner-apply", re: /\/api\/public\/partner-apply/ },
      { name: "form post method POST", re: /method:\s*["']POST["']/ }
    ]
  },
  {
    id: "offer:roadmap-pay",
    host: "app",
    path: "/roadmap/pay.html",
    morning: "status",
    formPost: true,
    passDetail: "the pay form post",
    need: [
      { name: "pay form", re: /id=["']pay["']/ },
      { name: "checkout hook slo-checkout", re: /\/api\/public\/slo-checkout/ },
      { name: "form post method POST", re: /method:\s*["']POST["']/ }
    ]
  },
  {
    id: "offer:roadmap-pull",
    host: "app",
    path: "/roadmap/pull.html",
    morning: "status",
    formPost: true,
    postTo: { host: "app", path: "/api/public/slo-pull", cors: true },
    passDetail: "the pull form post",
    need: [
      { name: "pull form", re: /id=["']pull["']/ },
      { name: "form post slo-pull", re: /\/api\/public\/slo-pull/ },
      { name: "form post method POST", re: /method:\s*["']POST["']/ }
    ]
  },
  {
    id: "offer:optimize",
    host: "app",
    path: "/optimize.html",
    morning: "status",
    passDetail: "optimize form and the optimize hook",
    need: [
      { name: "optimize form", re: /id=["']opt["']/ },
      { name: "offer hook /api/public/optimize", re: /\/api\/public\/optimize/ }
    ]
  },
  {
    id: "offer:optimize-plan",
    host: "app",
    path: "/optimize-plan.html",
    morning: "status",
    passDetail: "plan form and the optimize hook",
    need: [
      { name: "plan form", re: /id=["']intake["']/ },
      { name: "offer hook /api/public/optimize", re: /\/api\/public\/optimize/ }
    ]
  },
  {
    id: "offer:home-survey",
    host: "app",
    path: "/",
    morning: "status",
    formPost: true,
    passDetail: "homepage survey form and its post to survey-submit",
    need: [
      { name: "homepage survey form", re: /id=["']appform["']/ },
      { name: "survey script homepage-survey.js", re: /homepage-survey\.js/ }
    ],
    script: {
      srcRe: /src=["']([^"']*homepage-survey\.js[^"']*)["']/,
      need: [
        { name: "form post survey-submit", re: /\/api\/public\/survey-submit/ },
        { name: "form post method POST", re: /method:\s*["']POST["']/ }
      ]
    }
  },
  {
    id: "offer:start",
    host: "app",
    path: "/start.html",
    morning: "status",
    passDetail: "affiliate hop to the watch page",
    need: [
      { name: "watch door", re: /apply\.fundhub\.ai\/watch/ }
    ]
  }
];

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function originOf(value, fallback) {
  return String(value || fallback).replace(/\/+$/, "");
}

function missingNames(text, need) {
  return (need || []).filter((row) => !row.re.test(text)).map((row) => row.name);
}

function failDetail(door, url, status, missing, till = []) {
  const bits = [`${url} answered ${status}`];
  if (door.morning === "status" && status >= 200 && status < 300) {
    bits.push("morning ping only checks HTTP status");
  }
  if (door.formPost) bits.push("form cannot post");
  if (missing.length) bits.push(`missing ${missing.join("; ")}`);
  if (till.length) bits.push(till.join("; "));
  return bits.join("; ");
}

/** One web call may wait this long. Netlify cuts the whole step at 26 seconds. */
const TIMEOUT_MS = 8000;
/** Whole lane budget. A row still waiting at this point becomes a skip, so the step ends in time. */
const DEADLINE_MS = 15000;

/** Reads one response header by name, whatever shape the response carries. Null when absent. */
function headerReader(res) {
  const h = res && res.headers;
  return (name) => {
    if (!h) return null;
    try {
      if (typeof h.get === "function") {
        const v = h.get(name);
        return v == null ? null : String(v);
      }
      const key = Object.keys(h).find((k) => k.toLowerCase() === String(name).toLowerCase());
      return key ? String(h[key]) : null;
    } catch {
      return null;
    }
  };
}

/**
 * One memoized call per address for the whole run, so a door read twice is fetched
 * once. get(url, accept, origin) reads a page. An origin makes the call the way the
 * browser makes it from that site. get.head(url) asks for the headers only.
 */
function makeGetter(fetchImpl) {
  const seen = new Map();
  function request(method, url, accept, origin) {
    const key = `${method}|${url}|${accept || ""}|${origin || ""}`;
    if (!seen.has(key)) {
      seen.set(key, (async () => {
        const headers = { accept: accept || (method === "HEAD" ? "*/*" : "text/html") };
        if (origin) headers.origin = origin;
        const init = { method, redirect: "follow", headers };
        if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
          init.signal = AbortSignal.timeout(TIMEOUT_MS);
        }
        const res = await fetchImpl(url, init);
        const text = method !== "HEAD" && typeof res.text === "function" ? await res.text() : "";
        // url is where the call ended after any redirect; "" when the fetch does not say.
        return { status: Number(res.status), text: String(text || ""), header: headerReader(res), url: String((res && res.url) || "") };
      })());
    }
    return seen.get(key);
  }
  const get = (url, accept, origin) => request("GET", url, accept, origin);
  get.head = (url) => request("HEAD", url);
  return get;
}

function surveyScriptUrl(appOrigin, html, srcRe) {
  const match = srcRe.exec(html);
  if (!match) return { missing: "survey script src" };
  const raw = match[1];
  if (raw.startsWith("//")) return { missing: "survey script left fundhub.ai" };
  if (/^https?:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return { missing: "survey script src" };
    }
    if (parsed.origin !== appOrigin) return { missing: "survey script left fundhub.ai" };
    return { url: parsed.href };
  }
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return { url: `${appOrigin}${path}` };
}

/** A post door answers a GET with 405 or a config body when it is routed. 404 and 5xx are dead. */
function postDoorAlive(status) {
  return (
    (status >= 200 && status < 300) ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 405
  );
}

/** The till's own answer against the page. Returns plain-words problems, [] when sound. */
export function tillProblems(body, html) {
  let cfg;
  try {
    cfg = JSON.parse(body);
  } catch {
    return ["checkout till did not answer JSON"];
  }
  if (!cfg || typeof cfg !== "object") return ["checkout till did not answer JSON"];
  const out = [];
  if (cfg.ok !== true) out.push("checkout till says not ok");
  if (!cfg.checkout || cfg.checkout.ready !== true) out.push("checkout till is not ready, so Pay cannot charge a card");
  if (cfg.demo === true) out.push("checkout is in demo mode, so Pay charges no card");
  const price = typeof cfg.priceDisplay === "string" ? cfg.priceDisplay.trim() : "";
  if (!/^\$\d/.test(price)) out.push("checkout till has no price");
  else if (!String(html).includes(price)) out.push(`the page does not show the ${price} the till charges`);
  return out;
}

async function checkDoor(door, get, origins) {
  const url = `${origins[door.host]}${door.path}`;
  let page;
  try {
    page = await get(url, door.accept);
  } catch (err) {
    return check(
      door.id,
      "FAIL",
      `${url} unreachable: ${String((err && err.message) || err).slice(0, 160)}`,
      FIX
    );
  }
  if (!(page.status >= 200 && page.status < 300)) {
    return check(door.id, "FAIL", `${url} answered ${page.status}`, FIX);
  }
  const missing = missingNames(page.text, door.need);
  if (door.script && missing.length === 0) {
    const src = surveyScriptUrl(origins.app, page.text, door.script.srcRe);
    if (src.missing) {
      missing.push(src.missing);
    } else {
      try {
        const js = await get(src.url, "text/javascript,*/*");
        if (!(js.status >= 200 && js.status < 300)) {
          missing.push(`survey script answered ${js.status}`);
        } else {
          missing.push(...missingNames(js.text, door.script.need));
        }
      } catch (err) {
        missing.push(`survey script unreachable: ${String((err && err.message) || err).slice(0, 120)}`);
      }
    }
  }
  if (door.postTo) {
    const target = `${origins[door.postTo.host]}${door.postTo.path}`;
    try {
      const probe = await get(target, "application/json", door.postTo.cors ? origins.funnel : undefined);
      if (!postDoorAlive(probe.status)) {
        missing.push(`post door ${door.postTo.path} answered ${probe.status}`);
      }
    } catch (err) {
      missing.push(`post door ${door.postTo.path} unreachable: ${String((err && err.message) || err).slice(0, 120)}`);
    }
  }
  let till = [];
  if (door.till) {
    const target = `${origins[door.till.host]}${door.till.path}`;
    try {
      const cfg = await get(target, "application/json", door.till.cors ? origins.funnel : undefined);
      till = cfg.status >= 200 && cfg.status < 300
        ? tillProblems(cfg.text, page.text)
        : [`checkout till ${door.till.path} answered ${cfg.status}`];
    } catch (err) {
      till = [`checkout till ${door.till.path} unreachable: ${String((err && err.message) || err).slice(0, 120)}`];
    }
  }
  if (missing.length || till.length) {
    return check(door.id, "FAIL", failDetail(door, url, page.status, missing, till), FIX);
  }
  return check(door.id, "PASS", `${url} has ${door.passDetail}`);
}

// ---------------------------------------------------------------------------
// Tier 1, 2026-10-09: what a buyer needs to pay and to book.
//
// Each check asks one yes-or-no question and reads only with GET and HEAD.
// When /roadmap itself cannot be read, the checks that start from that page
// skip and say so: funnel:roadmap-checkout (and the 5 minute watch) report the
// page being down, once. A skip is never a pass.
// ---------------------------------------------------------------------------

function clip(text, n = 420) {
  const s = String(text);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function skip(id, detail) {
  return check(id, "skip", clip(detail), null);
}

function fail(id, detail, fix) {
  return check(id, "FAIL", clip(detail), fix);
}

const is2xx = (status) => status >= 200 && status < 300;
const errText = (err) => String((err && err.message) || err).slice(0, 120);

function stripComments(html) {
  return String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
}

/** The value of one attribute inside one tag, or null. */
function attrOf(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? "") : null;
}

function absUrl(raw, base) {
  try {
    return new URL(String(raw).replace(/&amp;/g, "&").trim(), base).href;
  } catch {
    return null;
  }
}

function pathOf(href) {
  try {
    return new URL(href).pathname;
  } catch {
    return "";
  }
}

function siteOf(href) {
  try {
    return new URL(href).origin;
  } catch {
    return "";
  }
}

function fileName(href) {
  return pathOf(href).split("/").filter(Boolean).pop() || String(href);
}

/** Every <script src> the page loads (comments left out), as full addresses. */
export function scriptSrcs(html, base) {
  const out = new Set();
  for (const m of stripComments(html).matchAll(/<script\b[^>]*>/gi)) {
    const src = attrOf(m[0], "src");
    const url = src ? absUrl(src, base) : null;
    if (url) out.add(url);
  }
  return [...out];
}

/** Every video file and poster picture the page names, as { url, kind }. */
export function videoFiles(html, base) {
  const out = new Map();
  const add = (raw, kind) => {
    const url = raw ? absUrl(raw, base) : null;
    if (url && !out.has(url)) out.set(url, kind);
  };
  for (const m of stripComments(html).matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
    const open = ` ${m[1]}`;
    add(attrOf(open, "src"), "video");
    add(attrOf(open, "poster"), "poster");
    for (const s of m[2].matchAll(/<source\b[^>]*>/gi)) add(attrOf(s[0], "src"), "video");
  }
  return [...out].map(([url, kind]) => ({ url, kind }));
}

/** The card box script the widget loads (its SDK_SRC), or null when the page no longer names one. */
export function cardBoxScriptUrl(html, base) {
  const m = /\bSDK_SRC\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(stripComments(html));
  if (m) return absUrl(m[1] ?? m[2], base);
  return scriptSrcs(html, base).find((u) => /fanbasis/i.test(u)) || null;
}

/** The product price the ClickFunnels checkout page carries, in cents, or null. */
export function orderPriceCents(html) {
  const m = /(?:"|&quot;)price_cents(?:"|&quot;)\s*:\s*(\d+)/.exec(String(html ?? ""));
  return m ? Number(m[1]) : null;
}

/** The price the till reports, in cents, or null when the answer is not usable. */
export function tillPriceCents(body) {
  let cfg;
  try {
    cfg = JSON.parse(body);
  } catch {
    return null;
  }
  if (!cfg || typeof cfg !== "object") return null;
  if (Number.isInteger(cfg.priceCents) && cfg.priceCents > 0) return cfg.priceCents;
  const m = /^\$([\d,]+)(?:\.(\d{2}))?$/.exec(String(cfg.priceDisplay || "").trim());
  return m ? Number(m[1].replace(/,/g, "")) * 100 + Number(m[2] || 0) : null;
}

function dollars(cents) {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** A page that must answer 2xx. { page } when it does, { why } in plain words when it does not. */
async function readPage(get, url, accept, origin) {
  try {
    const page = await get(url, accept, origin);
    if (!is2xx(page.status)) return { why: `${url} answered ${page.status}` };
    return { page };
  } catch (err) {
    return { why: `${url} unreachable: ${errText(err)}` };
  }
}

/** Why a script answer is not usable JavaScript, in plain words. Null when it is. */
function scriptProblem(js) {
  if (!is2xx(js.status)) return `answered ${js.status}`;
  const type = (js.header("content-type") || "").split(";")[0].trim();
  if (type) {
    if (!/javascript|ecmascript/i.test(type)) return `came back as ${type}, not JavaScript`;
  } else if (/^\s*</.test(js.text)) {
    return "came back as a web page, not JavaScript";
  }
  if (!js.text.trim()) return "came back empty";
  return null;
}

// ---- 1. the card box script ------------------------------------------------

/** The card box code is about 21 KB. Anything under this is an error page or a stub. */
export const MIN_CARD_BOX_BYTES = 2000;

const CARD_BOX_FIX =
  "The widget on /roadmap draws the card boxes with this card company script and never sends a buyer away, " +
  "so no script means no sale. Open https://apply.fundhub.ai/roadmap, press Continue, and see if the boxes draw on step 2. " +
  "Check the card company's status page. Do not run a test order from this check.";

async function checkCardBox(get, origins) {
  const id = "funnel:card-box-script-loads";
  const pageUrl = `${origins.funnel}/roadmap`;
  const read = await readPage(get, pageUrl);
  if (read.why) {
    return skip(id, `${read.why}, so the card box script was not looked for (funnel:roadmap-checkout reports the page itself)`);
  }
  const src = cardBoxScriptUrl(read.page.text, pageUrl);
  if (!src) {
    return fail(
      id,
      `${pageUrl} no longer names a card box script (the SDK_SRC the widget loads). The widget changed, so this check needs a new look`,
      CARD_BOX_FIX
    );
  }
  let js;
  try {
    js = await get(src, "text/javascript,*/*");
  } catch (err) {
    return fail(id, `the card box script ${src} is unreachable: ${errText(err)}`, CARD_BOX_FIX);
  }
  const problem = scriptProblem(js);
  if (problem) return fail(id, `the card box script ${src} ${problem}`, CARD_BOX_FIX);
  if (js.text.length < MIN_CARD_BOX_BYTES) {
    return fail(id, `the card box script ${src} is only ${js.text.length} bytes, too small to be the card box code`, CARD_BOX_FIX);
  }
  // The widget calls window.PaymentCheckout.create(...). A script that no longer defines it draws nothing.
  if (/\bPaymentCheckout\b/.test(read.page.text) && !/\bPaymentCheckout\b/.test(js.text)) {
    return fail(id, `the card box script ${src} no longer defines PaymentCheckout, the name the page calls`, CARD_BOX_FIX);
  }
  return check(id, "PASS", `the card box script ${src} answers 200 as JavaScript (${js.text.length} bytes) and the page still names it`);
}

// ---- 2. the call calendar --------------------------------------------------
//
// The id keeps its first name (funnel:book-and-order-pages-live). The old /order
// page is NOT part of it any more: nothing links to /order, and the way out of the
// price mismatch is to take it down. A page that is meant to go would keep this row
// red every morning and hide a real calendar loss. /order is read by the price row.

const BOOK_AND_ORDER_FIX =
  "A buyer cannot book the call. Every delivered pack and the pull-failed page send buyers to " +
  "/schedule/phonecall. Open the page and see what the buyer sees. An agent restores the page through the ClickFunnels API. " +
  "Chris does not open ClickFunnels. This check cannot see the open times: those load in the browser from Cronofy.";

async function checkBookAndOrder(get, origins) {
  const id = "funnel:book-and-order-pages-live";
  const phoneUrl = `${origins.funnel}/schedule/phonecall`;
  const phone = await readPage(get, phoneUrl);
  const problems = [];
  if (phone.why) {
    problems.push(phone.why);
  } else {
    const t = phone.page.text;
    if (!/\bid=["']cronofy-date-time-picker["']/.test(t)) {
      problems.push("/schedule/phonecall lost its calendar box (cronofy-date-time-picker)");
    } else if (!/element-token-value=["'][^"']{20,}["']/.test(t)) {
      problems.push("/schedule/phonecall calendar has no access token, so it can show no times");
    } else if (!/availability-query-json-value=["'][^"']{20,}["']/.test(t)) {
      problems.push("/schedule/phonecall calendar has no availability query, so it can show no times");
    }
  }
  if (problems.length) return fail(id, problems.join("; "), BOOK_AND_ORDER_FIX);
  return check(
    id,
    "PASS",
    `${phoneUrl} has its calendar, token and availability query (the old /order page is read by funnel:order-price-matches-till)`
  );
}

// ---- 2b. the order page charges what the till charges ----------------------
//
// /order is the old native ClickFunnels checkout. The row asks one thing: can a
// buyer who lands there pay a price other than the till's? It goes red only while
// /order is a working checkout at another price. Taking /order down clears it.

const ORDER_PRICE_FIX =
  "The old order page and the till (what /roadmap charges) show different prices for the same product. " +
  "A buyer who lands on /order pays the other price, and a ClickFunnels order does not open the portal. " +
  "Decide which price is right, then make /order match the till, or take /order down (a 404, a 410, or a redirect off /order clears this row). " +
  "Do not edit it from this check.";

/** Where an answer ended after redirects, with the path trimmed of slashes; null when the fetch did not say. */
function endedAtPath(page) {
  if (!page.url) return null;
  return pathOf(page.url).replace(/\/+$/, "") || "/";
}

async function checkOrderPrice(get, origins) {
  const id = "funnel:order-price-matches-till";
  const orderUrl = `${origins.funnel}/order`;
  const tillUrl = `${origins.app}/api/public/slo-checkout`;
  let page;
  try {
    page = await get(orderUrl);
  } catch (err) {
    return skip(id, `${orderUrl} unreachable: ${errText(err)}, so its price was not read`);
  }
  // Taken down on purpose is a clear answer, not a failed read: a buyer cannot pay a wrong price at a page that is gone.
  if (page.status === 404 || page.status === 410) {
    return check(id, "PASS", `${orderUrl} answers ${page.status}: the old order page is down, so it cannot charge a price other than the till's`);
  }
  if (!is2xx(page.status)) {
    return skip(id, `${orderUrl} answered ${page.status}, so its price was not read`);
  }
  const endedAt = endedAtPath(page);
  if (endedAt !== null && endedAt !== "/order") {
    return check(id, "PASS", `${orderUrl} sends buyers on to ${page.url}: the old order page is retired, so it cannot charge a price other than the till's`);
  }
  const hasForm = /data-page-element=["']Checkout\/V2["']/.test(page.text) && /CheckoutSubmitButton/.test(page.text);
  if (!hasForm) {
    return skip(
      id,
      `${orderUrl} is up but is not a checkout any more (no checkout form), so there is no price to compare. If it was taken down on purpose, this row stays skipped until /order answers 404 or redirects`
    );
  }
  const orderCents = orderPriceCents(page.text);
  if (orderCents === null) {
    return skip(id, `${orderUrl} has a checkout form but shows no price, so there is nothing to compare`);
  }
  // Same call, same origin as the till read in funnel:roadmap-checkout, so it is fetched once.
  const till = await readPage(get, tillUrl, "application/json", origins.funnel);
  if (till.why) {
    return skip(id, `${till.why}, so the till price was not read (funnel:roadmap-checkout reports the till)`);
  }
  const tillCents = tillPriceCents(till.page.text);
  if (tillCents === null) {
    return skip(id, `${tillUrl} gave no usable price (funnel:roadmap-checkout reports the till)`);
  }
  if (orderCents !== tillCents) {
    return fail(
      id,
      `${orderUrl} charges ${dollars(orderCents)} but the till says ${dollars(tillCents)}, the price /roadmap charges`,
      ORDER_PRICE_FIX
    );
  }
  return check(id, "PASS", `${orderUrl} and the till both say ${dollars(tillCents)}`);
}

// ---- 3. the scripts that tie a sale to an ad -------------------------------

/** What /roadmap must load. The addresses come from the same manifest the page push uses. */
export const TRACKING_SCRIPTS = Object.freeze(
  [
    { name: "fh-attribution.js", src: FH_ATTRIBUTION_SRC },
    { name: "fh-events.js", src: FH_EVENTS_SRC },
    { name: "vsl-watch-beacon.js", src: VSL_WATCH_BEACON_SRC },
    { name: "Clarity clarity.js", src: CLARITY_SRC }
  ].map((s) => Object.freeze({ ...s, path: new URL(s.src).pathname }))
);

const MAX_SCRIPT_READS = 12;

const TRACKING_FIX =
  "These scripts tie a sale to the ad that paid for it. If /roadmap stops loading them, ads keep spending and nothing says which ad sold. " +
  "Push the page again with its tracking block, or put the script file back under public/funnel and deploy. Do not post a lead to test it.";

async function checkTrackingScripts(get, origins) {
  const id = "funnel:roadmap-tracking-scripts";
  const pageUrl = `${origins.funnel}/roadmap`;
  const read = await readPage(get, pageUrl);
  if (read.why) {
    return skip(id, `${read.why}, so its scripts were not looked for (funnel:roadmap-checkout reports the page itself)`);
  }
  const named = scriptSrcs(read.page.text, pageUrl);
  const problems = [];
  const toRead = [];
  for (const s of TRACKING_SCRIPTS) {
    const hit = named.find((u) => pathOf(u) === s.path);
    if (hit) toRead.push({ name: s.name, url: hit });
    else problems.push(`the page does not load ${s.name}`);
  }
  const home = siteOf(origins.app);
  for (const url of named) {
    if (siteOf(url) === home && !toRead.some((r) => r.url === url)) toRead.push({ name: fileName(url), url });
  }
  const answers = await Promise.all(
    toRead.slice(0, MAX_SCRIPT_READS).map(async (r) => {
      try {
        const problem = scriptProblem(await get(r.url, "text/javascript,*/*"));
        return problem ? `${r.name} ${problem}` : null;
      } catch (err) {
        return `${r.name} unreachable: ${errText(err)}`;
      }
    })
  );
  problems.push(...answers.filter(Boolean));
  if (problems.length) return fail(id, `${pageUrl}: ${problems.join("; ")}`, TRACKING_FIX);
  return check(
    id,
    "PASS",
    `${pageUrl} loads ${toRead.map((r) => r.name).join(", ")} and each one answers 200 as JavaScript`
  );
}

// ---- 4. the sales page videos ----------------------------------------------

const MAX_MEDIA_READS = 12;

const VIDEOS_FIX =
  "A video that does not load leaves a blank player on the sales page. Put the missing file back under public/funnel and deploy, " +
  "or fix its address on the page. Open https://apply.fundhub.ai/roadmap and press play to see it.";

async function checkSalesVideos(get, origins) {
  const id = "funnel:sales-videos-play";
  const pageUrl = `${origins.funnel}/roadmap`;
  const read = await readPage(get, pageUrl);
  if (read.why) {
    return skip(id, `${read.why}, so its videos were not looked for (funnel:roadmap-checkout reports the page itself)`);
  }
  const files = videoFiles(read.page.text, pageUrl);
  if (!files.some((f) => f.kind === "video")) {
    return fail(id, `${pageUrl} names no video at all, so the sales video is gone from the page`, VIDEOS_FIX);
  }
  const answers = await Promise.all(
    files.slice(0, MAX_MEDIA_READS).map(async (f) => {
      const name = fileName(f.url);
      try {
        const r = await get.head(f.url);
        if (!is2xx(r.status)) return `${name} answered ${r.status}`;
        const type = (r.header("content-type") || "").split(";")[0].trim();
        const want = f.kind === "video" ? /^video\//i : /^image\//i;
        if (!want.test(type)) return `${name} came back as ${type || "no type"}, not a ${f.kind === "video" ? "video" : "picture"}`;
        const length = r.header("content-length");
        if (length !== null && Number(length) === 0) return `${name} is empty (size 0)`;
        return null;
      } catch (err) {
        return `${name} unreachable: ${errText(err)}`;
      }
    })
  );
  const problems = answers.filter(Boolean);
  if (problems.length) return fail(id, `${pageUrl}: ${problems.join("; ")}`, VIDEOS_FIX);
  const shown = Math.min(files.length, MAX_MEDIA_READS);
  return check(id, "PASS", `${pageUrl} names ${files.length} video and picture files; the ${shown} checked all answer 200 with the right type and none is empty`);
}

// ---- 5. the browser's cross-site rule --------------------------------------

/** The four doors the widget calls from apply.fundhub.ai (src/slo/cors.mjs), and the verbs each must allow. */
export const WIDGET_DOORS = Object.freeze([
  Object.freeze({ path: "/api/public/slo-checkout", methods: Object.freeze(["GET", "POST"]) }),
  Object.freeze({ path: "/api/public/slo-pull", methods: Object.freeze(["POST"]) }),
  Object.freeze({ path: "/api/public/slo-status", methods: Object.freeze(["GET"]) }),
  Object.freeze({ path: "/api/public/slo-repair-checkout", methods: Object.freeze(["POST"]) })
]);

const CORS_FIX =
  "The widget runs on apply.fundhub.ai and calls these doors on fundhub.ai. The browser lets the call through only when the door " +
  "answers with that address in access-control-allow-origin (and lists the verb and the content-type header for a JSON post). " +
  "If it does not, the browser blocks the call with no error on the page, and nobody can pay. The rule lives in src/slo/cors.mjs. " +
  "Do not edit it from this check.";

async function corsProblem(get, origins, door) {
  const url = `${origins.app}${door.path}`;
  let r;
  try {
    r = await get(url, "application/json", origins.funnel);
  } catch (err) {
    return `${door.path} unreachable: ${errText(err)}`;
  }
  if (r.status === 404 || r.status === 410) return `${door.path} is gone (answered ${r.status})`;
  // A bare GET gets 400 (no order given) or 405 (post-only door). Both mean the door is there.
  if (!(is2xx(r.status) || r.status === 400 || r.status === 405)) return `${door.path} answered ${r.status}`;
  const allow = (r.header("access-control-allow-origin") || "").trim();
  if (allow !== origins.funnel && allow !== "*") {
    return `${door.path} gives ${origins.funnel} no permission, so the browser blocks the call`;
  }
  const verbs = (r.header("access-control-allow-methods") || "").toUpperCase();
  const lacking = door.methods.filter((m) => verbs.trim() !== "*" && !new RegExp(`\\b${m}\\b`).test(verbs));
  if (lacking.length) return `${door.path} does not allow ${lacking.join(" and ")} across sites`;
  if (door.methods.includes("POST")) {
    const heads = (r.header("access-control-allow-headers") || "").toLowerCase();
    if (heads.trim() !== "*" && !/\bcontent-type\b/.test(heads)) {
      return `${door.path} does not allow the content-type header, so the browser refuses the JSON post`;
    }
  }
  return null;
}

async function checkCrossSite(get, origins) {
  const id = "funnel:widget-cross-site-call";
  const problems = (await Promise.all(WIDGET_DOORS.map((door) => corsProblem(get, origins, door)))).filter(Boolean);
  if (problems.length) return fail(id, problems.join("; "), CORS_FIX);
  return check(
    id,
    "PASS",
    `${WIDGET_DOORS.map((d) => d.path.split("/").pop()).join(", ")} all let ${origins.funnel} call them (the same headers a browser reads before a post)`
  );
}

/** The Tier 1 checks, in the order they report. */
export const GAP_WIDGET_CHECKS = Object.freeze([
  Object.freeze({ id: "funnel:card-box-script-loads", run: checkCardBox }),
  Object.freeze({ id: "funnel:book-and-order-pages-live", run: checkBookAndOrder }),
  Object.freeze({ id: "funnel:order-price-matches-till", run: checkOrderPrice }),
  Object.freeze({ id: "funnel:roadmap-tracking-scripts", run: checkTrackingScripts }),
  Object.freeze({ id: "funnel:sales-videos-play", run: checkSalesVideos }),
  Object.freeze({ id: "funnel:widget-cross-site-call", run: checkCrossSite })
]);

/** A row still waiting at the deadline becomes a skip, so the step ends before Netlify cuts it. */
function withDeadline(promise, ms, id) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve(skip(id, `did not finish in ${ms >= 1000 ? `${Math.round(ms / 1000)} seconds` : `${ms} ms`}, so it was not read`)),
      ms
    );
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} [ctx]
 * @param {typeof fetch|null} [ctx.fetchImpl] ctx.fetch, then global fetch, when omitted; null skips
 * @param {string} [ctx.funnelBaseUrl] default apply.fundhub.ai (the pulse's FUNNEL_URL env wins when set)
 * @param {string} [ctx.appBaseUrl] default fundhub.ai (the pulse passes it as ctx.baseUrl)
 * @param {number} [ctx.deadlineMs] test hook: whole-lane wait before a pending row becomes a skip (default 15000)
 * @returns {Promise<Array<{id:string,status:string,detail:string,suggestedFix:string|null}>>}
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") && ctx.fetchImpl !== undefined
    ? ctx.fetchImpl
    : (ctx.fetch ?? globalThis.fetch);
  if (typeof fetchImpl !== "function") {
    return [
      check(
        "funnel:doors",
        "skip",
        "no fetch in this run — live funnel and offer pages were not read"
      )
    ];
  }
  const origins = {
    funnel: originOf(
      ctx.funnelBaseUrl || (ctx.env && ctx.env.FUNNEL_URL),
      DEFAULT_FUNNEL_BASE_URL
    ),
    app: originOf(ctx.appBaseUrl || ctx.baseUrl, DEFAULT_APP_BASE_URL)
  };
  const get = makeGetter(fetchImpl);
  const deadline = Number.isFinite(ctx.deadlineMs) ? ctx.deadlineMs : DEADLINE_MS;
  const jobs = [
    ...GAP_DOORS.map((door) => ({ id: door.id, run: () => checkDoor(door, get, origins) })),
    ...GAP_WIDGET_CHECKS.map((c) => ({ id: c.id, run: () => c.run(get, origins) }))
  ];
  // Everything at once: the pulse runs inside a 26 second function. A check that
  // throws on its own bug is a skip with the reason, never a pass.
  return Promise.all(
    jobs.map((job) =>
      withDeadline(
        Promise.resolve()
          .then(job.run)
          .catch((err) => skip(job.id, `the check could not run: ${errText(err)}`)),
        deadline,
        job.id
      )
    )
  );
}
