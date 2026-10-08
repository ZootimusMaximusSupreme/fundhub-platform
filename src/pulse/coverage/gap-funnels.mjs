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
    till: { host: "app", path: "/api/public/slo-checkout" }
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
    postTo: { host: "app", path: "/api/public/slo-pull" },
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

const TIMEOUT_MS = 10000;

/** One memoized GET per url for the whole run, so a door read twice is fetched once. */
function makeGetter(fetchImpl) {
  const seen = new Map();
  return function get(url, accept) {
    const key = `${url}|${accept || ""}`;
    if (!seen.has(key)) {
      seen.set(key, (async () => {
        const init = {
          method: "GET",
          redirect: "follow",
          headers: { accept: accept || "text/html" }
        };
        if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
          init.signal = AbortSignal.timeout(TIMEOUT_MS);
        }
        const res = await fetchImpl(url, init);
        const text = typeof res.text === "function" ? await res.text() : "";
        return { status: Number(res.status), text: String(text || "") };
      })());
    }
    return seen.get(key);
  };
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
      const probe = await get(target, "application/json");
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
      const cfg = await get(target, "application/json");
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

/**
 * @param {object} [ctx]
 * @param {typeof fetch|null} [ctx.fetchImpl] ctx.fetch, then global fetch, when omitted; null skips
 * @param {string} [ctx.funnelBaseUrl] default apply.fundhub.ai (the pulse's FUNNEL_URL env wins when set)
 * @param {string} [ctx.appBaseUrl] default fundhub.ai (the pulse passes it as ctx.baseUrl)
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
  // All doors at once: the pulse runs inside a 26 second function.
  return Promise.all(GAP_DOORS.map((door) => checkDoor(door, get, origins)));
}
