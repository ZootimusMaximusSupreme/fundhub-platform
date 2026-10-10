// @ts-check
// The funnel address system (build unit X4, owner order 2026-10-05: "we should
// have a url system so I don't have to name them, or allow me to name them in
// the dash").
//
// PURE. No database, no network. The caller hands in every address that is
// already taken (the live ClickFunnels pages, read through
// src/messaging/providers/clickfunnels-pages.mjs, plus every address our own
// marketing_funnels / marketing_funnel_pages rows hold), and this file picks a
// free one or says why a chosen one is refused.
//
// THE SHAPE. A book-a-call funnel is three pages that share one base word:
//   landing    /blueprint
//   booking    /blueprint-book
//   thank_you  /blueprint-thank-you
// An address is free only when all three are free. The base comes from the
// offer (capital_blueprint -> "blueprint"); a taken base gets -2, -3, ... in
// order, so the first Blueprint funnel is /blueprint and the next /blueprint-2.
//
// RESERVED. Every page the live funnels already use (src/funnel/pages.mjs, the
// push manifest's paths and live URLs) and the site's own words (api, app,
// login, privacy, terms, ...) can never be picked, even if ClickFunnels has no
// page there today. A name is refused, never bent into a different one.

import { FUNNEL_PAGE_MAP } from "../funnel/pages.mjs";
import { PUSH_MANIFEST, DO_NOT_FULL_REPLACE_PATHS } from "../../marketing/landing-pages/tracking-manifest.mjs";
import { OFFERS } from "../config/offers.mjs";

/** Where every funnel page lives (the push manifest's live URLs all sit here). */
export const FUNNEL_HOST = "apply.fundhub.ai";

/** The pages of a book-a-call funnel, in order. */
export const FUNNEL_ROLES = Object.freeze(["landing", "booking", "thank_you"]);
const SUFFIX = Object.freeze({ landing: "", booking: "-book", thank_you: "-thank-you" });

/** A base address: "/" then lower-case words joined by single hyphens. */
export const PATH_RE = /^\/[a-z0-9]+(-[a-z0-9]+)*$/;
/** The longest base. "-thank-you" is added to it, and a page address may be 60. */
export const MAX_BASE_LENGTH = 48;
/** How far the counter goes before it gives up ("/blueprint-50"). */
export const MAX_SUFFIX = 50;

/**
 * The offers a book-a-call funnel can be built for. Each names the base word of
 * its address, the lane its ads carry (utm_campaign), and the product in
 * src/config/offers.mjs it sells — the price is read from there, never typed.
 * capital_blueprint's lane is the registry's (marketing/ads/registry.json:
 * rules.uwiq.primary_offer = capital_blueprint); funding_dfy's is funding600,
 * the first lane whose primary offer it is (a different lane can be sent).
 */
export const FUNNEL_OFFERS = Object.freeze({
  capital_blueprint: Object.freeze({ base: "blueprint", lane: "uwiq", product: OFFERS.UWIQ_DELIVERABLES }),
  funding_dfy: Object.freeze({ base: "funding", lane: "funding600", product: OFFERS.FUNDING_DFY })
});

/** True when a book-a-call funnel can be built for this offer key. */
export function isFunnelOffer(key) {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(FUNNEL_OFFERS, key);
}

/* Words the site itself uses. Never a funnel's first word. */
const SITE_WORDS = Object.freeze([
  "api", "app", "admin", "login", "logout", "privacy", "terms", "funnel", "funnels",
  "home", "index", "checkout", "order", "pay", "payment", "schedule", "book", "booking",
  "thank-you", "thankyou", "apply", "watch", "roadmap", "climate", "partner", "partners",
  "portal", "assets", "static", "js", "css", "img", "images", "video", "videos", "robots",
  "sitemap", "favicon", "well-known", "netlify", "test"
]);

function pathOf(url) {
  try { return new URL(url).pathname.toLowerCase().replace(/\/+$/, "") || "/"; } catch { return null; }
}

/** Every address that is reserved for good, as a Set of "/words". */
export function reservedPaths() {
  const out = new Set(["/"]);
  for (const w of SITE_WORDS) out.add(`/${w}`);
  for (const p of Object.keys(FUNNEL_PAGE_MAP)) out.add(p);
  for (const p of DO_NOT_FULL_REPLACE_PATHS) out.add(String(p).toLowerCase());
  for (const row of PUSH_MANIFEST) {
    if (row.path) out.add(String(row.path).toLowerCase());
    const live = row.liveUrl ? pathOf(row.liveUrl) : null;
    if (live) out.add(live);
  }
  return out;
}

/* "/fnl" is the ClickFunnels funnel's own address (/fnl-blueprint, see
   src/marketing/funnel-push.mjs cfFunnelPath), so no page may take it. */
const RESERVED_PREFIXES = Object.freeze(["/roadmap", "/funding-book-call", "/schedule", "/fundhub-297", "/api", "/app", "/.well-known", "/fnl"]);

/** True when this one address can never be used. */
export function isReserved(path, reserved = reservedPaths()) {
  const p = String(path || "").toLowerCase();
  if (reserved.has(p)) return true;
  return RESERVED_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}-`) || p.startsWith(`${pre}/`));
}

/**
 * What Chris typed (or the offer word) as a base address, or null when nothing
 * usable is left. "Capital Blueprint!" -> "/capital-blueprint"; "/blueprint/" ->
 * "/blueprint". Never longer than MAX_BASE_LENGTH.
 */
export function normalizePath(raw) {
  const words = String(raw ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!words) return null;
  const cut = words.slice(0, MAX_BASE_LENGTH - 1).replace(/-+$/, "");
  const p = `/${cut}`;
  return PATH_RE.test(p) ? p : null;
}

/** The three page addresses for one base: { landing, booking, thank_you }. */
export function pagePaths(base) {
  return {
    landing: `${base}${SUFFIX.landing}`,
    booking: `${base}${SUFFIX.booking}`,
    thank_you: `${base}${SUFFIX.thank_you}`
  };
}

/** The funnel's key (marketing_funnels.key) for a base: "/blueprint-2" -> "blueprint_2". */
export function keyFor(base) {
  return String(base).replace(/^\//, "").replace(/-/g, "_").slice(0, 63);
}

/** The funnel's tag for a key. Never changes once saved. "blueprint_2" -> "fnl-blueprint-2". */
export function tagFor(key) {
  return `fnl-${String(key).replace(/_/g, "-")}`.slice(0, 64);
}

/** A tag the database takes (425 marketing_funnels_tag_ck): "fnl-" then words joined by single dashes, 64 at most. */
export function isTag(tag) {
  return typeof tag === "string" && tag.length <= 64 && /^fnl-[a-z0-9]+(-[a-z0-9]+)*$/.test(tag);
}

/** The full address of a path on the funnel host. */
export function urlFor(path, host = FUNNEL_HOST) {
  return `https://${host}${path}`;
}

/**
 * Why this base cannot be used, in plain words, or null when it can.
 *   taken     a Set of every address already used (live ClickFunnels pages and
 *             our own rows), lower case
 *   keys      a Set of funnel keys already used in the company
 *   reserved  reservedPaths() (passed in for tests)
 */
export function refuseReason(base, { taken = new Set(), keys = new Set(), reserved = reservedPaths() } = {}) {
  if (!base || !PATH_RE.test(base)) {
    return "An address is lower-case letters and numbers joined by single dashes, like /blueprint.";
  }
  if (base.length > MAX_BASE_LENGTH) return `That address is too long. Keep it to ${MAX_BASE_LENGTH - 1} letters or fewer.`;
  const pages = pagePaths(base);
  for (const role of FUNNEL_ROLES) {
    const p = pages[role];
    if (isReserved(p, reserved)) return `${p} belongs to a page the site already uses. Pick another name.`;
  }
  for (const role of FUNNEL_ROLES) {
    const p = pages[role];
    if (taken.has(p)) return `${p} is already a page. Pick another name.`;
  }
  if (keys.has(keyFor(base))) return `A funnel named ${keyFor(base)} already exists. Pick another name.`;
  return null;
}

/**
 * The first free base for a starting word: "/blueprint", then "/blueprint-2",
 * "/blueprint-3", ... Returns { base } or { error } when none of the first
 * MAX_SUFFIX is free (or the word itself is reserved, in which case "-2" and up
 * are tried, since a reserved word stays reserved).
 */
export function nextFreePath(word, opts = {}) {
  const start = normalizePath(word);
  if (!start) return { error: "There is no usable word to build an address from." };
  const stem = start.slice(0, MAX_BASE_LENGTH - 4).replace(/-+$/, "");
  for (let n = 1; n <= MAX_SUFFIX; n += 1) {
    const base = n === 1 ? start : `${stem}-${n}`;
    if (!refuseReason(base, opts)) return { base };
  }
  return { error: `Every address from ${start} to ${stem}-${MAX_SUFFIX} is taken. Type a name instead.` };
}

/**
 * Every address a list of ClickFunnels pages already uses (GET
 * /workspaces/{id}/pages rows): the page's current_path, its step's path and the
 * path of its public url. Lower case, no trailing slash.
 */
export function pathsFromPages(pages = []) {
  const out = new Set();
  const add = (p) => {
    if (typeof p !== "string" || !p.trim()) return;
    const clean = p.trim().toLowerCase().replace(/\/+$/, "");
    if (clean.startsWith("/")) out.add(clean);
  };
  for (const page of Array.isArray(pages) ? pages : []) {
    if (!page || typeof page !== "object") continue;
    add(page.current_path);
    if (page.show_page_step && typeof page.show_page_step === "object") add(page.show_page_step.current_path);
    if (typeof page.url === "string") add(pathOf(page.url));
  }
  return out;
}

/**
 * Every address a list of ClickFunnels funnels already uses (GET
 * /workspaces/{id}/funnels rows): a funnel's own current_path answers on its
 * domain too (apply.fundhub.ai/vsl sends people on to /watch). Archived funnels
 * count: nothing here proves their address is free. Lower case, no trailing slash.
 */
export function pathsFromFunnels(funnels = []) {
  const out = new Set();
  for (const f of Array.isArray(funnels) ? funnels : []) {
    if (!f || typeof f !== "object" || typeof f.current_path !== "string") continue;
    const clean = f.current_path.trim().toLowerCase().replace(/\/+$/, "");
    if (clean.startsWith("/")) out.add(clean);
  }
  return out;
}
