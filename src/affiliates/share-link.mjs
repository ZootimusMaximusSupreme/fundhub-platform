// The share link an affiliate hands to a friend. ONE builder, used everywhere.
//
// WHY THIS IS ITS OWN FILE IN src/ RATHER THAN LIVING IN THE HANDLER.
//
// It started inside api/affiliates/refer.mjs, which is the right home for the
// endpoint that mints a code but the wrong home for a function two other things
// need. src/progress/read.mjs returns the same link on every page load, and
// importing a handler to get at it would have been the ONLY `src/` → `api/`
// import in this repository — checked 2026-09-05, there are no others. That
// direction drags requirePrincipal and a connection pool into a read path and
// inverts the layering every other module here follows.
//
// The alternative was to build the link in two places. Two builders for one
// string is how the enrolment reply and the progress page end up handing a
// client two different links for the same code, and only one of them works.
//
// THE ORIGIN IS CONFIGURED, NEVER GUESSED FROM THE REQUEST. Working an origin
// out from request headers means assuming a protocol when x-forwarded-proto is
// absent, which is right behind Netlify and wrong against a plain-http dev
// server — and a share link that 404s is worse than no link at all. The
// resolution order is the one src/messaging/unsubscribe.mjs:234 already uses:
// the configured base, then Netlify's own URL, then the live site.
//
// WHERE THE LINK POINTS. public/start.html:34 reads `ref` (or `a1`) off the
// query string, stores it, records the visit through
// api/public/affiliate-click.mjs and forwards to the apply funnel with the code
// attached. So this is the existing front door, not a new one.

/**
 * shareUrlFor(code, env?) → the public URL that attributes a signup to `code`.
 * Returns null for a missing code rather than a link with an empty ref, which
 * would attribute a real signup to nobody and read as a working link.
 */
export function shareUrlFor(code, env = process.env) {
  const c = code == null ? "" : String(code).trim();
  if (!c) return null;
  const base = String(env.APP_BASE_URL || env.URL || "https://fundhub.ai").replace(/\/+$/, "");
  return `${base}/start.html?ref=${encodeURIComponent(c)}`;
}

export default shareUrlFor;

// ONE LINK PER OFFER (owner call 2026-10-06). The affiliate page used to show one
// generic link that always landed on /watch, while the $297 text sent people to
// /roadmap, and an affiliate could not tell which link was live. Now every offer
// a referral can buy through gets its own row: same code, different page.
//
// The code rides as BOTH a1 and ref. a1 is the name public/funnel/fh-attribution.js,
// the ClickFunnels adapter and api/public/slo-checkout.mjs read; ref is the name
// people expect. /roadmap also uses ?ref= for its paid return, but only together
// with client_id and a slo_ ref, so an AFF- code never trips it.
//
// Only offers with a live page belong here. /blueprint returned 404 on 2026-10-06.
export const OFFER_PAGES = Object.freeze([
  Object.freeze({ key: "funding_dfy", name: "Book a call", url: "https://apply.fundhub.ai/watch" }),
  Object.freeze({ key: "slo_roadmap", name: "Roadmap", url: "https://apply.fundhub.ai/roadmap" })
]);

/**
 * offerLinksFor(code) → [{ key, name, url }] one per offer page, or [] for a
 * missing code (an empty ref would credit a real sale to nobody).
 */
export function offerLinksFor(code) {
  const c = code == null ? "" : String(code).trim();
  if (!c) return [];
  const q = encodeURIComponent(c);
  return OFFER_PAGES.map((o) => ({ key: o.key, name: o.name, url: `${o.url}?a1=${q}&ref=${q}` }));
}
