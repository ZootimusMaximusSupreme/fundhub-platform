// Beat: checkout-doors. Every hour, can a buyer reach a checkout that works?
//
// Coverage batch W2 (ops/workflows/coverage-every-surface-2026-10-10.md, unit W2), 2026-10-10.
// Three doors, three steps, one question each:
//
//   funnel-till        GET /api/public/funnel-checkout. Does the till the /partner/ pages read answer,
//                      say checkout is ready, and show a price and a live buy button for autopsy,
//                      board and trial? (api/public/funnel-checkout.mjs funnelCatalogue)
//   repair-door        GET /api/public/slo-repair-checkout. The door is POST only, so a GET must answer
//                      405 with its own words. A 405 proves the route is mounted. A 404 means it fell
//                      out of the ROUTES map. The buyer's POST is never sent.
//   paid-service-link  The newest hosted checkout links waiting on a "do it for me" dispute round
//                      (paid_service_requests at awaiting_payment, not expired). Does each one answer
//                      to a HEAD? A link that 404s is a buyer who clicks and sees nothing.
//
// READ ONLY. The beat reads one table through ctx.read (Postgres itself refuses a write there) and sends
// GET and HEAD only, to our own site and to the hosted checkout page. It sends no body and saves nothing.
// A detail holds a path and a status, never a page, a link or a key.
//
// WHAT GREEN DOES NOT PROVE. It does not press Pay and does not charge a card. A till that answers is not
// a card that settles. The morning lane (src/pulse/coverage/gap-checkout.mjs) reads what happened to the
// buyers who did press. A host that turns away a bot (403, 429) is "unclear", never red.
//
// No imports but the contract and the lib: the judging rules live in lib/checkout-doors.mjs so the beat
// and the morning lane can never disagree.

import {
  TEST_CLIENT_EMAIL_RE, isWebAddress, judgeCheckoutLink, judgeFunnelCatalogue, judgeRepairDoor, plain
} from "./lib/checkout-doors.mjs";

export const id = "checkout-doors";
export const title = "Checkout doors answer";
export const kind = "probe";
export const covers = ["route:public/funnel-checkout", "route:public/slo-repair-checkout", "route:paid-services"];
export const box = false;
// Our own site for the two doors. Any other host (the hosted checkout page) for the waiting links: GET or HEAD.
export const reads = [
  { host: "SITE", methods: ["GET"] },
  { host: "*", methods: ["GET", "HEAD"] }
];
export const steps = ["funnel-till", "repair-door", "paid-service-link"];
export const damp = 2;
export const deadlineMs = 9000;

export const FUNNEL_PATH = "/api/public/funnel-checkout";
export const REPAIR_PATH = "/api/public/slo-repair-checkout";
export const MAX_LINKS = 3;

/* The newest live invitations. A row at awaiting_payment always carries an expiry (a database rule), and a link
   past its expiry is no longer an invitation, so it is left out. Test clients are left out like the lanes do. */
export const LINKS_SQL = `
  SELECT r.id::text AS id, r.checkout_url
    FROM paid_service_requests r
    LEFT JOIN clients c ON c.id = r.client_id AND c.org_id = r.org_id
   WHERE r.status = 'awaiting_payment'
     AND btrim(COALESCE(r.checkout_url, '')) <> ''
     AND r.checkout_expires_at > now()
     AND NOT (COALESCE(c.is_demo, false)
              OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
              OR COALESCE(c.email, '') ~* $1::text)
   ORDER BY r.requested_at DESC
   LIMIT ${MAX_LINKS}
`;

const NO_ANSWER = Object.freeze({ ok: false, status: 0, class: "none", body: "", headers: {} });
const settle = (promise) => Promise.resolve(promise).then(
  (r) => r || NO_ANSWER,
  (e) => ({ ...NO_ANSWER, class: "refused", error: String((e && e.message) || e).slice(0, 80) })
);

const bodyOf = (res) => String((res && (res.body ?? res.bodySnippet)) ?? "");

/** The header named `name`, any case, or null. The probe may hand headers as a plain object or a Map-like. */
function headerOf(res, name) {
  const h = res && res.headers;
  if (!h) return null;
  if (typeof h.get === "function") return h.get(name);
  const want = String(name).toLowerCase();
  for (const [k, v] of Object.entries(h)) if (String(k).toLowerCase() === want) return Array.isArray(v) ? v.join(", ") : String(v);
  return null;
}

export async function run(ctx) {
  if (!/^https:\/\/[^/]+$/.test(String(ctx.siteUrl || ""))) {
    throw ctx.fail(steps[0], "the site address (URL) is not set for this run, so no checkout door can be asked");
  }
  // Both site doors start together. Each promise already has a catch on it (ctx hands out quiet promises).
  const till = settle(ctx.http.get(`${ctx.siteUrl}${FUNNEL_PATH}`));
  const door = settle(ctx.http.get(`${ctx.siteUrl}${REPAIR_PATH}`));

  await ctx.step("funnel-till", async () => {
    const res = await till;
    if (!Number.isInteger(res.status) || res.status === 0) {
      throw ctx.fail("funnel-till", `GET ${FUNNEL_PATH} got no answer (${plain(res.class)})`);
    }
    const problems = judgeFunnelCatalogue({ status: res.status, body: bodyOf(res) });
    if (problems.length) throw ctx.fail("funnel-till", `GET ${FUNNEL_PATH}: ${problems.join("; ")}`);
  });

  await ctx.step("repair-door", async () => {
    const res = await door;
    const why = judgeRepairDoor({ status: res.status, body: bodyOf(res), allow: headerOf(res, "allow") });
    if (why) throw ctx.fail("repair-door", `GET ${REPAIR_PATH}: ${why}`);
  });

  let links;
  try {
    links = (await ctx.read(LINKS_SQL, [TEST_CLIENT_EMAIL_RE])).rows;
  } catch (err) {
    throw ctx.fail("paid-service-link", `the waiting checkout links could not be read: ${String((err && err.message) || err).slice(0, 100)}`);
  }
  if (!links.length) {
    ctx.skipStep("paid-service-link", "no paid-service checkout link is waiting for a buyer");
    return ctx.done("the funnel till and the repair door answer; no paid-service link is waiting to be asked about");
  }

  let alive = 0;
  let unclear = 0;
  // Every HEAD starts together, so three slow hosts cost one wait, not three.
  const asked = links.slice(0, MAX_LINKS).map((link) => {
    const url = String(link.checkout_url || "");
    return { link, url, call: isWebAddress(url) ? settle(ctx.http.head(url)) : null };
  });
  await ctx.step("paid-service-link", async () => {
    const dead = [];
    for (const a of asked) {
      const who = plain(String(a.link.id).slice(0, 8), 8);
      if (!a.call) {
        dead.push(`${who} is not a web address`);
        continue;
      }
      let res = await a.call;
      if (res.status === 405 || res.status === 501) res = await settle(ctx.http.get(a.url));
      const verdict = judgeCheckoutLink(res.status);
      if (verdict === "dead") dead.push(`${who} answered ${res.status}`);
      else if (verdict === "alive") alive += 1;
      else unclear += 1;
    }
    if (dead.length) throw ctx.fail("paid-service-link", `${dead.length} of ${asked.length} waiting checkout links do not answer: ${dead.join("; ")}`);
  });

  return ctx.done(
    `the funnel till and the repair door answer; ${alive} of ${asked.length} waiting paid-service links answer` +
      `${unclear ? `, ${unclear} unclear (a host that turns away a bot)` : ""}`
  );
}

export const fixGuide = [
  "A checkout door a buyer uses is not answering right. Find the step named in the text.",
  "",
  "Likely causes:",
  "- funnel-till: the Commas checkout key is missing or wrong, so checkout.ready is false and every /partner/ buy button is off. An item with no price means its offers.mjs row or constant was changed.",
  "- funnel-till with 404 or 500: the route fell out of the ROUTES map in netlify/functions/api.mjs, or the function crashed on load. Read the Netlify function log.",
  "- repair-door answering 404: the slo-repair-checkout route fell out of the ROUTES map. Answering 200 or 500: the handler changed or crashed.",
  "- paid-service-link: a hosted checkout link was made and the host no longer knows it, or the link in the row is not a web address.",
  "Steps:",
  "- Open GET /api/public/funnel-checkout in a browser and read checkout.ready and each item's priceCents and available.",
  "- Run node scripts/pulse/run-beat.mjs checkout-doors. It prints each step and the first one that stopped.",
  "- For a dead hosted link, reach the buyer with a fresh link from the existing paid-services door. Do not mint a Commas catalog product.",
  "- If it began right after a deploy, roll back to the last good deploy in Netlify, then fix forward.",
  "Files: api/public/funnel-checkout.mjs, api/public/slo-repair-checkout.mjs, api/paid-services.mjs, src/paid-services/checkout.mjs, src/payments/commas-api.mjs, netlify/functions/api.mjs"
].join("\n");

/* ---------------- self test: no network, no database ---------------- */

const SITE = "https://fundhub.ai";
const LINK = "https://pay.example.test/c/live-link";

const CATALOGUE = {
  ok: true,
  checkout: { ready: true },
  items: [
    { slug: "autopsy", selfServe: true, priceCents: 2700, available: true },
    { slug: "board", selfServe: true, priceCents: 4700, available: true },
    { slug: "trial", selfServe: true, priceCents: 9700, available: true },
    { slug: "partner", selfServe: false, priceCents: 1000000, available: false }
  ]
};

/** The right answer from every door and the one waiting link, as the fake ctx wants it. */
export function goodAnswers() {
  return {
    http: {
      [`GET ${SITE}${FUNNEL_PATH}`]: { status: 200, body: JSON.stringify(CATALOGUE) },
      [`GET ${SITE}${REPAIR_PATH}`]: {
        status: 405, body: JSON.stringify({ ok: false, error: "method_not_allowed" }), headers: { allow: "POST, OPTIONS" }
      },
      [`HEAD ${LINK}`]: { status: 200 }
    },
    read: [{ match: /FROM paid_service_requests/, rows: [{ id: "11111111-1111-4111-8111-111111111111", checkout_url: LINK }] }]
  };
}

export const selfTest = {
  pass: () => goodAnswers(),
  // The funnel till says checkout is not ready: no /partner/ buyer can pay.
  fail: () => {
    const good = goodAnswers();
    return {
      ...good,
      http: {
        ...good.http,
        [`GET ${SITE}${FUNNEL_PATH}`]: { status: 200, body: JSON.stringify({ ...CATALOGUE, checkout: { ready: false } }) }
      }
    };
  }
};
