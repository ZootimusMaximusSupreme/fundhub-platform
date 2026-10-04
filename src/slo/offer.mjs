// SLO diagnostic — public till constants. Price $147, list $297 shown crossed out (owner-set 2026-10-04).
//
// Owner-set 2026-09-17: pay, then pull, then pack, then book.
// Commas is the card API. ClickFunnels stays last. The live /watch funnel
// does not move.
//
// THE TITLE IS NOT INVENTED. commas-catalog-hands-off: reuse a keep title,
// never POST /public-api/products/create, never mint a new catalog row.
// Consulting Services Assessment is the diagnostic title already used by
// SOFT_PULL and /optimize.

export const SLO_PRICE_CENTS = 14700;

/** List price shown crossed out on the page. Display only, never charged. */
export const SLO_LIST_PRICE_CENTS = 29700;

export const SLO_KEEP_TITLE = "Consulting Services Assessment";

export const SLO_SOURCE = "slo";

/* purpose + products.code the Commas webhook already knows. That is what
   fires diagnostic.paid → C-00 (the pull) → analysis.completed (the pack).
   Do not guess this offer by dollar amount. */
export const SLO_PURPOSE = "diagnostic";

export const SLO_PRODUCT_CODE = "diagnostic";

export const SLO_PULL_PATH = "/roadmap/pull.html";

/** The $297 booking page (ClickFunnels, iframes /funding-book-call). Owner-set 2026-09-22. */
export const SLO_BOOK_PAGE_URL = "https://apply.fundhub.ai/roadmap-book";
export const SLO_BOOK_URL = "https://apply.fundhub.ai/schedule/phonecall";

export function sloPublicBase(env = process.env) {
  const raw = String(env.PUBLIC_BASE_URL || "https://fundhub.ai").trim();
  return raw.replace(/\/+$/, "") || "https://fundhub.ai";
}

/** Where Commas sends them after the card. Same window. The pull form. */
export function sloPullSuccessUrl(env = process.env) {
  return `${sloPublicBase(env)}${SLO_PULL_PATH}`;
}

/* ── The /roadmap widget (owner-set 2026-09-22) ──────────────────────────────
   The checkout is a two-step widget ON the /roadmap sales page
   (marketing/landing-pages/slo/slo-01-sales.html), not separate pages. */

/* DEMO PAY. SLO_DEMO_PAY="1" means the Pay button records the order exactly
   as a real one (a payment_links row with the real amount, is_demo = true) but
   Commas is never called and no card is charged. Anything else, including
   unset, is the real Commas path. Only the exact string "1" turns it on, so a
   typo fails toward the real till rather than toward giving pulls away. */
export const SLO_DEMO_PAY_ENV = "SLO_DEMO_PAY";

export function isSloDemoPay(env = process.env) {
  return String(env?.[SLO_DEMO_PAY_ENV] ?? "").trim() === "1";
}

/* payment_links.checkout_url is NOT NULL, and a demo order has no card page.
   This is not a URL anybody can pay at, on purpose: a staff screen that shows
   it shows something plainly not payable. */
export const SLO_DEMO_CHECKOUT_URL = "demo:no-charge";

/* Where a buyer goes after the pull. Funding bucket: the booking page with the
   pre-approval amount on it (?pa=, whole dollars — the page counts up to it).
   Repair bucket: the same page, no amount, as the "Talk to us first" link. */
export const SLO_ROADMAP_BOOK_URL = "https://apply.fundhub.ai/roadmap-book";

export function sloRoadmapBookUrl(pa = null) {
  const n = Number(pa);
  if (pa == null || !Number.isSafeInteger(n) || n <= 0) return SLO_ROADMAP_BOOK_URL;
  return `${SLO_ROADMAP_BOOK_URL}?pa=${n}`;
}
