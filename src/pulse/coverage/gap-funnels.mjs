// Funnel and public offer doors. Read-only GET. Never posts a lead.
// Never mints a Commas product. Never opens ClickFunnels admin.
//
// The morning pulse (Recon, AG-07) already reads apply.fundhub.ai/roadmap for
// the checkout anchor and the offer line. Other funnel pages are not in that
// body check. Public offer pages in the registry are scored up on HTTP 200
// alone, so a blank page still looks fine. This file fails when a marker
// named in the page code is missing.
//
// One tripwire: Recon. This module does not register a second monitor.

export const DEFAULT_FUNNEL_BASE_URL = "https://apply.fundhub.ai";
export const DEFAULT_APP_BASE_URL = "https://fundhub.ai";

const FIX =
  "Restore the missing offer copy, checkout anchor, or form post on that live page. Recon (AG-07) is the morning tripwire.";

/** Markers are the strings the page source already uses. */
export const GAP_DOORS = [
  {
    id: "funnel:roadmap-sales",
    host: "funnel",
    path: "/roadmap",
    morning: "partial",
    passDetail: "checkout anchor fh-order, roadmap offer copy, and slo-checkout",
    need: [
      { name: "checkout anchor fh-order", re: /id=["']fh-order["']|#fh-order/i },
      { name: "roadmap offer copy", re: /Funding Roadmap|Get My Roadmap/i },
      { name: "checkout hook slo-checkout", re: /slo-checkout/ }
    ]
  },
  {
    id: "funnel:watch",
    host: "funnel",
    path: "/watch",
    morning: "none",
    passDetail: "Get Started and the watch lede block",
    need: [
      { name: "offer copy Get Started", re: /Get Started/ },
      { name: "watch lede fh-watch-lede", re: /fh-watch-lede/ }
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
    passDetail: "booking offer copy and the calendar form",
    need: [
      { name: "booking offer copy", re: /Book Your Funding Call/ },
      { name: "booking form formContainer", re: /formContainer/ }
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

function failDetail(door, url, status, missing) {
  const bits = [`${url} answered ${status}`];
  if (door.morning === "status" && status >= 200 && status < 300) {
    bits.push("morning ping only checks HTTP status");
  }
  if (door.formPost) bits.push("form cannot post");
  bits.push(`missing ${missing.join("; ")}`);
  return bits.join("; ");
}

async function readGet(fetchImpl, url, accept) {
  const res = await fetchImpl(url, {
    method: "GET",
    redirect: "follow",
    headers: { accept: accept || "text/html" }
  });
  const text = typeof res.text === "function" ? await res.text() : "";
  return { status: Number(res.status), text: String(text || "") };
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

async function checkDoor(door, fetchImpl, origins) {
  const url = `${origins[door.host]}${door.path}`;
  let page;
  try {
    page = await readGet(fetchImpl, url, door.accept);
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
        const js = await readGet(fetchImpl, src.url, "text/javascript,*/*");
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
  if (missing.length) {
    return check(door.id, "FAIL", failDetail(door, url, page.status, missing), FIX);
  }
  return check(door.id, "PASS", `${url} has ${door.passDetail}`);
}

/**
 * @param {object} [ctx]
 * @param {typeof fetch|null} [ctx.fetchImpl] global fetch when omitted; null skips
 * @param {string} [ctx.funnelBaseUrl]
 * @param {string} [ctx.appBaseUrl]
 * @returns {Promise<Array<{id:string,status:string,detail:string,suggestedFix:string|null}>>}
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
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
    funnel: originOf(ctx.funnelBaseUrl, DEFAULT_FUNNEL_BASE_URL),
    app: originOf(ctx.appBaseUrl, DEFAULT_APP_BASE_URL)
  };
  const rows = [];
  for (const door of GAP_DOORS) {
    rows.push(await checkDoor(door, fetchImpl, origins));
  }
  return rows;
}
