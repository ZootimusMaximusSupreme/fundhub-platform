// Which funnel, and which step of it, each funnel page is.
//
// Contract: docs/tracking/tracking-spec.md, "Pages → funnel and step". The
// server works out funnel and step from the page with this one map; the
// browser cannot invent them. A page that is not here is refused
// (page_invalid) by POST /api/public/slo-interest.
//
// To add a page, add one line to MAP. Rows come from
// docs/tracking/page-inventory.md. The browser tracker
// (public/funnel/fh-events.js) keeps the same list of pages.

const MAP = {
  "/watch":              { funnel: "watch", step: 1 },
  "/apply":              { funnel: "watch", step: 2 },
  "/funding-book-call":  { funnel: "watch", step: 3 },
  "/thank-you":          { funnel: "watch", step: 4 },
  "/order":              { funnel: "watch", step: 5 },
  "/roadmap":            { funnel: "roadmap", step: 1 },
  "/roadmap-book":       { funnel: "roadmap", step: 2 },
  "/roadmap-thank-you":  { funnel: "roadmap", step: 3 },
  // fundhub.ai/ (the homepage survey). The browser sends "/home" there,
  // because apply.fundhub.ai/ is a different page.
  "/home":               { funnel: "homepage", step: 1 },
  "/portal-login.html":  { funnel: "portal", step: 1 },
};

for (const row of Object.values(MAP)) Object.freeze(row);

/** page → { funnel, step }. Read-only. */
export const FUNNEL_PAGE_MAP = Object.freeze(MAP);

/** The page allow-list: every page on the map, and nothing else. */
export const FUNNEL_PAGES = new Set(Object.keys(FUNNEL_PAGE_MAP));

/**
 * A page as the browser sent it → the form the map uses: trimmed, at most 60
 * characters, lower case, no trailing slash. Same rule the door has always
 * used for kind "page" and "click".
 */
export function normalizePage(raw) {
  return String(raw ?? "").trim().slice(0, 60).toLowerCase().replace(/\/+$/, "");
}

/** { page, funnel, step } for a funnel page, or null when it is not on the map. */
export function funnelFor(raw) {
  const page = normalizePage(raw);
  if (!Object.hasOwn(FUNNEL_PAGE_MAP, page)) return null;
  const { funnel, step } = FUNNEL_PAGE_MAP[page];
  return { page, funnel, step };
}
