// Beat: doors-live. Every hour, GET the launch-path doors and pages on our own site.
//
// READ ONLY. GET only, host SITE only (ctx.http). It sends no body, saves nothing, and never
// names a body in its words: a detail holds the path and the status, nothing the page said.
//
// A door counts as alive only when BOTH are true:
//   1. the status is the one that door really answers (read from its handler, then proved
//      with one real GET on the live site, 2026-10-09)
//   2. a content marker is in the body, so a 200 error page, a blank page or the wrong page
//      goes red too
//
// WHAT EACH DOOR REALLY ANSWERS TO A GET (handler read, then proved live):
//   /api/health?strict=1      200 {"ok":true,"pending":0,...}          api/health.mjs (503 when not ok)
//   /roadmap                  301 to https://apply.fundhub.ai/roadmap, then 200. The probe follows
//                              the redirect by hand, so this scores the page a buyer lands on.
//   /roadmap/pay.html         200, a static page with <form id="pay">
//   /portal-login.html        200, a static page with the sign-in form
//   /api/webhooks/commas      405 {"error":"Method not allowed"}       api/webhooks/[provider].mjs
//   /api/webhooks/clickfunnels  405, same handler
//   /api/public/survey-submit 405 {"error":"method_not_allowed"}      api/public/survey-submit.mjs
//   /api/public/slo-interest  200 {"ok":true}                          api/public/slo-interest.mjs
//   /api/public/slo-checkout  200 (NOT 405: the GET returns the page config, with priceCents)
//                              api/public/slo-checkout.mjs. The board guessed 405; the handler
//                              and the live site both say 200, so 200 is the expectation.
//   /api/auth/magic-link      405 {"error":"method_not_allowed"}       api/auth/magic-link.mjs
//
// THE 64 KB LIMIT. The probe reads at most 64 KB of a page. The /roadmap page is 268 KB and its
// fh-order anchor and offer copy sit at about 78 KB, past the limit, so the marker the daily pulse
// uses (src/pulse/funnel-doors.mjs checkFunnelRoadmapSales) cannot be used here. The first 64 KB of
// /roadmap holds the head block the push script writes (marketing/landing-pages/slo/slo-canonical-head.html,
// marker "fh-canonical", pinned by src/http/roadmap-canonical.test.mjs). The markers are two lines of that
// block: "fh-canonical:start v1" and the canonical link to apply.fundhub.ai/roadmap. Both are written by
// the machine on every push. The hand-edited banner comment in the page body (it carries the price and
// date and changes with every price edit) is NOT used: a reword of it would text Chris for a page that is fine.
//
// HOW IT RUNS. All ten GETs start together (about 8 s at worst, not 80 s). The steps then read the
// answers one by one, in order, so a red names the first door that is wrong and the detail lists the
// others that are wrong too.
//
// No imports: this beat needs nothing but ctx.

export const id = "doors-live";
export const title = "Front doors and key pages answer";
export const kind = "probe";
export const covers = [];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const damp = 2;
export const deadlineMs = 10000;

/** Letters, digits and . _ - only, cut short. A value from a page never goes into a detail raw. */
const plain = (v) => String(v ?? "").replace(/[^a-z0-9._-]/gi, "").slice(0, 16) || "none";

const NOT_ALLOWED = /method[ _]not[ _]allowed/i;

const bodyOf = (res) => String(res?.body ?? res?.bodySnippet ?? "");
const jsonOf = (res) => {
  try {
    const v = JSON.parse(bodyOf(res));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

const needs = (res, ...markers) => {
  const text = bodyOf(res);
  const lost = markers.filter((m) => !m.test(text));
  return lost.length ? `answered 200 but it is not the right page (markers missing: ${lost.length} of ${markers.length})` : null;
};

const refusesGet = (res) => (NOT_ALLOWED.test(bodyOf(res)) ? null : "answered 405 but not with this door's own answer (method not allowed)");

/**
 * Each door: step name, path, the status it answers, and check(res) -> null or a short reason.
 * The step names start with "door-" so they cannot clash with any other check id under src/pulse.
 */
export const DOORS = Object.freeze([
  {
    step: "door-health", path: "/api/health?strict=1", status: 200,
    check: (res) => {
      const j = jsonOf(res);
      if (!j) return "answered 200 but the body is not the health answer";
      if (j.ok !== true || j.pending !== 0) return `says ok ${plain(j.ok)}, state ${plain(j.state)}, pending ${plain(j.pending)}`;
      return null;
    }
  },
  {
    step: "door-roadmap", path: "/roadmap", status: 200,
    check: (res) => needs(res, /fh-canonical:start v1/, /<link rel="canonical" href="https:\/\/apply\.fundhub\.ai\/roadmap">/)
  },
  {
    step: "door-pay-page", path: "/roadmap/pay.html", status: 200,
    check: (res) => needs(res, /<form[^>]*\bid="pay"/)
  },
  {
    step: "door-portal-login", path: "/portal-login.html", status: 200,
    check: (res) => needs(res, /<form[^>]*\bid="f"/, /type="email"/)
  },
  { step: "door-commas", path: "/api/webhooks/commas", status: 405, check: refusesGet },
  { step: "door-clickfunnels", path: "/api/webhooks/clickfunnels", status: 405, check: refusesGet },
  { step: "door-survey-submit", path: "/api/public/survey-submit", status: 405, check: refusesGet },
  {
    step: "door-slo-interest", path: "/api/public/slo-interest", status: 200,
    check: (res) => (jsonOf(res)?.ok === true ? null : "answered 200 but not with {ok:true}")
  },
  {
    step: "door-slo-checkout", path: "/api/public/slo-checkout", status: 200,
    check: (res) => {
      const j = jsonOf(res);
      return j && j.ok === true && Number.isInteger(j.priceCents) ? null : "answered 200 but not with the page config (no priceCents)";
    }
  },
  { step: "door-magic-link", path: "/api/auth/magic-link", status: 405, check: refusesGet }
]);

export const steps = DOORS.map((d) => d.step);

const shown = (door) => `GET ${door.path.split("?")[0]}`;

/** null when the door is fine, else one short reason. Never holds a page body. */
export function judge(door, res) {
  if (!res || !Number.isInteger(res.status) || res.status === 0) {
    return `${shown(door)} got no answer (${plain(res?.class || "none")})`;
  }
  if (res.status !== door.status) return `${shown(door)} answered ${res.status}, wanted ${door.status}`;
  const why = door.check(res);
  return why ? `${shown(door)} ${why}` : null;
}

const NO_ANSWER = Object.freeze({ ok: false, status: 0, class: "none", body: "" });
const settle = (promise) => Promise.resolve(promise).then((r) => r || NO_ANSWER, (e) => ({ ...NO_ANSWER, class: "refused", error: String((e && e.message) || e).slice(0, 80) }));

export async function run(ctx) {
  if (!/^https:\/\/[^/]+$/.test(String(ctx.siteUrl || ""))) {
    throw ctx.fail(steps[0], "the site address (URL) is not set for this run, so no door can be asked");
  }
  // Start every GET at once. Each promise already has a catch on it (ctx hands out quiet promises).
  const calls = DOORS.map((d) => settle(ctx.http.get(`${ctx.siteUrl}${d.path}`)));

  for (let i = 0; i < DOORS.length; i++) {
    const door = DOORS[i];
    await ctx.step(door.step, async () => {
      const bad = judge(door, await calls[i]);
      if (!bad) return;
      const others = [];
      for (let j = i + 1; j < DOORS.length; j++) {
        const more = judge(DOORS[j], await calls[j]);
        if (more) others.push(DOORS[j].path.split("?")[0]);
      }
      throw ctx.fail(door.step, others.length ? `${bad}. Also wrong: ${others.join(", ")}` : bad);
    });
  }
  return ctx.done(`all ${DOORS.length} doors and pages answered as expected`);
}

export const fixGuide = [
  "A front door or key page is not answering right. Find the one named after GET in the text.",
  "",
  "Likely causes:",
  "- A 404 on an /api door means the route fell out of the ROUTES map in netlify/functions/api.mjs, or the deploy is broken.",
  "- A 500 or 503 means the function crashed. Read the Netlify function log for that path.",
  "- A missing page marker means the page was overwritten. The /roadmap sales page lives in ClickFunnels. The pay and sign-in pages are files in public/.",
  "- door-roadmap with 403, 429 or 503 while the page opens fine in a browser: the sales page host (apply.fundhub.ai, behind Cloudflare) may be turning away the pulse request. This beat has only been seen from the laptop. Check that first before touching the page.",
  "- /api/health?strict=1 with ok false or pending above 0 means the database is down or a migration did not run.",
  "Steps:",
  "- Open the same address in a browser and read the status.",
  "- Run node scripts/pulse/run-beat.mjs doors-live. It prints each door and the first one that stopped.",
  "- If it began right after a deploy, roll back to the last good deploy in Netlify, then fix forward.",
  "- For a missing /roadmap marker, push marketing/landing-pages/slo/slo-01-sales.html again with scripts/cf-push-custom-html.mjs.",
  "Files: netlify/functions/api.mjs, api/health.mjs, marketing/landing-pages/slo/slo-01-sales.html, public/portal-login.html, public/roadmap/pay.html"
].join("\n");

/* ---------------- self test: no network, no database ---------------- */

const SITE = "https://fundhub.ai";

/** The right answer from every door, as the fake http wants it: { "GET <url>": partial }. */
export function goodAnswers() {
  const html = (body) => ({ status: 200, body });
  const refuse = (error) => ({ status: 405, body: JSON.stringify({ ok: false, error }) });
  return {
    [`GET ${SITE}/api/health?strict=1`]: { status: 200, body: JSON.stringify({ ok: true, db: "up", state: "up", pending: 0 }) },
    [`GET ${SITE}/roadmap`]: { ...html('<html><head><!-- fh-canonical:start v1 --><link rel="canonical" href="https://apply.fundhub.ai/roadmap"><!-- fh-canonical:end --></head><body>'), finalHost: "apply.fundhub.ai", redirects: 1 },
    [`GET ${SITE}/roadmap/pay.html`]: html('<html><body><form id="pay" novalidate></form>'),
    [`GET ${SITE}/portal-login.html`]: html('<html><body><form id="f"><input id="email" type="email"></form>'),
    [`GET ${SITE}/api/webhooks/commas`]: refuse("Method not allowed"),
    [`GET ${SITE}/api/webhooks/clickfunnels`]: refuse("Method not allowed"),
    [`GET ${SITE}/api/public/survey-submit`]: refuse("method_not_allowed"),
    [`GET ${SITE}/api/public/slo-interest`]: { status: 200, body: JSON.stringify({ ok: true }) },
    [`GET ${SITE}/api/public/slo-checkout`]: { status: 200, body: JSON.stringify({ ok: true, priceCents: 14700 }) },
    [`GET ${SITE}/api/auth/magic-link`]: refuse("method_not_allowed")
  };
}

export const selfTest = {
  pass: () => ({ http: goodAnswers() }),
  // One door answers 404: the route fell out of the map.
  fail: () => ({ http: { ...goodAnswers(), [`GET ${SITE}/api/auth/magic-link`]: { status: 404, body: JSON.stringify({ ok: false, error: "not_found" }) } } })
};
