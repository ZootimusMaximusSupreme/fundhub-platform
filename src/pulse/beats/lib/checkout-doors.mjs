// checkout-doors: the pure rules for the three checkout doors a buyer hits (coverage batch W2, 2026-10-10).
// No network, no database, no clock. The hourly beat (beat-checkout-doors.mjs) and the morning lane
// (src/pulse/coverage/gap-checkout.mjs) both judge with these, so the two can never disagree.
//
// THE THREE DOORS
//   funnel till   GET /api/public/funnel-checkout answers the catalogue the /partner/ pages render.
//                 It carries `checkout.ready` and, for each self-serve item, a price and `available`.
//                 (api/public/funnel-checkout.mjs funnelCatalogue.)
//   repair door   /api/public/slo-repair-checkout is POST only. A GET answers 405 with
//                 {"ok":false,"error":"method_not_allowed"} and an `allow: POST, OPTIONS` header.
//                 A 405 is the proof the route is mounted. A 404 means it fell out of the ROUTES map.
//   paid service  a hosted checkout link on a paid_service_requests row. A live invitation answers
//                 2xx or 3xx. 404 and 410 are a dead link. 5xx is the host failing. A 4xx other than
//                 those (401, 403, 405, 429) is a bot wall or a method refusal: it proves nothing, so
//                 it is "unclear", never red.

/** The same test-client pattern gap-payments.mjs holds (a drift test keeps the two equal). */
export const TEST_CLIENT_EMAIL_RE =
  String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$|^(e2e|demo)\+`;

/** The three items a stranger can pay for on the /partner/ pages. The fourth (partner) is sold on a call. */
export const SELF_SERVE_SLUGS = Object.freeze(["autopsy", "board", "trial"]);

const NOT_ALLOWED = /method[ _]not[ _]allowed/i;

/** Letters, digits and . _ - only, cut short. A value from an answer never goes into a detail raw. */
export function plain(value, max = 24) {
  return String(value ?? "").replace(/[^a-z0-9._-]/gi, "").slice(0, max) || "none";
}

export function parseJson(text) {
  try {
    const v = JSON.parse(String(text ?? ""));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * judgeFunnelCatalogue({ status, body }) -> a list of plain-words problems. [] means the till is sound.
 * `body` is the text of the answer.
 */
export function judgeFunnelCatalogue({ status, body } = {}) {
  const out = [];
  if (status !== 200) {
    out.push(`the funnel till answered ${Number.isInteger(status) && status > 0 ? status : "nothing"}, not 200`);
    return out;
  }
  const cat = parseJson(body);
  if (!cat) {
    out.push("the funnel till did not answer JSON");
    return out;
  }
  if (cat.ok !== true) out.push("the funnel till says not ok");
  if (!cat.checkout || cat.checkout.ready !== true) {
    out.push("the funnel till says checkout is not ready, so no funnel buyer can pay");
  }
  const items = Array.isArray(cat.items) ? cat.items : [];
  if (items.length === 0) {
    out.push("the funnel till lists no items");
    return out;
  }
  for (const slug of SELF_SERVE_SLUGS) {
    const item = items.find((i) => i && i.slug === slug);
    if (!item) {
      out.push(`the funnel till no longer lists ${slug}`);
      continue;
    }
    if (!Number.isInteger(item.priceCents) || item.priceCents <= 0) {
      out.push(`${slug} has no price on the till (a page would show a dash and a dead button)`);
    } else if (item.available !== true) {
      out.push(`${slug} is priced but not available (the buy button is turned off)`);
    }
  }
  return out;
}

/** The self-serve prices on a catalogue, { slug: cents } for every item with a whole-cent price. */
export function funnelPrices(body) {
  const cat = parseJson(body);
  const out = {};
  for (const item of Array.isArray(cat && cat.items) ? cat.items : []) {
    if (item && typeof item.slug === "string" && Number.isInteger(item.priceCents) && item.priceCents > 0) {
      out[item.slug] = item.priceCents;
    }
  }
  return out;
}

/**
 * judgeRepairDoor({ status, body, allow }) -> null when the door is mounted, else one short reason.
 * A GET to a POST-only door must answer 405. Anything else is a break.
 */
export function judgeRepairDoor({ status, body, allow } = {}) {
  if (!Number.isInteger(status) || status === 0) return "the repair checkout door gave no answer";
  if (status === 404) return "the repair checkout door answered 404 (the route fell out of the ROUTES map)";
  if (status >= 500) return `the repair checkout door answered ${status}`;
  if (status !== 405) return `the repair checkout door answered ${status}, wanted 405 for a GET`;
  if (!NOT_ALLOWED.test(String(body ?? ""))) return "the repair checkout door answered 405 but not with its own answer (method not allowed)";
  if (allow != null && allow !== "" && !/POST/i.test(String(allow))) return "the repair checkout door no longer lists POST as allowed";
  return null;
}

/**
 * judgeCheckoutLink(status) -> "alive" | "dead" | "unclear".
 * alive: 2xx or 3xx. dead: 404, 410, any 5xx, or no answer code at all with an error.
 * unclear: any other 4xx. A host that turns away a bot is not a dead link.
 */
export function judgeCheckoutLink(status) {
  const s = Number(status);
  if (!Number.isInteger(s) || s <= 0) return "unclear";
  if (s >= 200 && s < 400) return "alive";
  if (s === 404 || s === 410 || s >= 500) return "dead";
  return "unclear";
}

/** An http or https address only, with a host. The lane never asks about anything else. */
export function isWebAddress(value) {
  try {
    const u = new URL(String(value));
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}
