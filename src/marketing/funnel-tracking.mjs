// @ts-check
// The tag and the tracking every page of a dashboard-built funnel carries
// (build unit X4, owner order 2026-10-05: "every time a funnel is made we tag it").
//
// PURE. No database, no network.
//
// THE HEAD comes from the push manifest, not from here:
// marketing/landing-pages/tracking-manifest.mjs wrapCustomHtmlDocument() puts in
// the Meta pixel with its one PageView (eventID window.__fhPv), Clarity and GA4
// when their ids are set, the ClickFunnels page token and SDK, and at the end of
// the body fh-attribution.js (UTMs, fbclid, fbc/fbp onto every form) and
// fh-events.js (page views, presses, scroll, the framed calendar's booking).
// A custom HTML page refuses head_code (ClickFunnels answers 422), so all of it
// rides inside the one document, the same way the /roadmap pages do it.
//
// THE TAG is one marked block that goes FIRST in <head>:
//   <meta name="fh-funnel-tag" content="fnl-blueprint">
//   <script>window.FH_FUNNEL = {id, tag, key, offer, lane, page:{role, path, step}}</script>
// public/funnel/fh-events.js reads window.FH_FUNNEL: a page that is not on its
// fixed page list may still send when FH_FUNNEL names this very page, and every
// event it sends carries funnel_tag. The door (src/funnel/track.mjs) then checks
// the tag and the page against marketing_funnel_pages, so the funnel and step on
// the saved row come from our database, never from the browser.
// Leads and bookings carry the funnel through landing_path: fh-attribution.js
// stamps the first page a visitor landed on (this funnel's first page) on every
// form, the framed booking calendar included, and that address belongs to one
// funnel only (marketing_funnel_pages_org_path_uq).
//
// UTMs keep the ad-number law (migration 286, src/marketing/url-tags.mjs): the
// ad's url_tags carry utm_campaign = this funnel's lane and utm_content = the ad
// number. The tag never rides in a UTM.

import {
  wrapCustomHtmlDocument, metaPixelId, FH_ATTRIBUTION_SRC, FH_EVENTS_SRC, hasScriptSrc
} from "../../marketing/landing-pages/tracking-manifest.mjs";
import { FUNNEL_ROLES } from "./funnel-paths.mjs";

export const FUNNEL_MARKER = "fh-funnel";

/** The exact meta line the database checks for (migration 425 trigger). */
export function tagMeta(tag) {
  return `<meta name="fh-funnel-tag" content="${String(tag)}">`;
}

/* JSON that is safe inside a <script>: no "</script>", no "<!--". */
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * The marked head block for one page.
 * @param {{ id: string, tag: string, key: string, offer_key?: string|null, lane: string }} funnel
 * @param {{ role: string, path: string }} page
 */
export function funnelTagBlock(funnel, page) {
  const step = FUNNEL_ROLES.indexOf(page.role) + 1;
  if (step < 1) throw new Error(`funnelTagBlock: unknown page role ${JSON.stringify(page.role)}`);
  const config = {
    id: funnel.id,
    tag: funnel.tag,
    key: funnel.key,
    offer: funnel.offer_key ?? null,
    lane: funnel.lane,
    page: { role: page.role, path: page.path, step }
  };
  return [
    `<!-- ${FUNNEL_MARKER}:start -->`,
    tagMeta(funnel.tag),
    `<script>window.FH_FUNNEL=${scriptJson(config)};</script>`,
    `<!-- ${FUNNEL_MARKER}:end -->`
  ].join("\n");
}

/**
 * The whole page: the tag block first in <head>, then the manifest's tracking
 * head, then the body, then the manifest's footer scripts.
 * @param {{ funnel: any, page: { role: string, path: string }, bodyHtml: string,
 *           pageToken?: string|null, env?: Record<string, string|undefined> }} opts
 */
export function pageDocument({ funnel, page, bodyHtml, pageToken = null, env = process.env }) {
  return wrapCustomHtmlDocument({
    bodyHtml,
    pageToken: pageToken || undefined,
    pixelId: metaPixelId(env).id,
    includeVslBeacon: false,
    headFirstHtml: funnelTagBlock(funnel, page),
    env
  });
}

/**
 * What a page is missing, as plain words (empty when it carries everything).
 * Used before a page is saved, and on the live page after a push.
 * @param {string} html
 * @param {string} tag
 */
export function trackingGaps(html, tag) {
  const h = String(html ?? "");
  const out = [];
  const head = h.split(/<\/head>/i)[0] || "";
  if (!head.includes(tagMeta(tag))) out.push(`the funnel tag ${tag} is not in the page head`);
  if (!head.includes("window.FH_FUNNEL=")) out.push("the tracking config (window.FH_FUNNEL) is not in the page head");
  if (!head.includes("fbq('init'")) out.push("the Meta pixel is not in the page head");
  if (!hasScriptSrc(h, FH_ATTRIBUTION_SRC)) out.push("fh-attribution.js is not on the page");
  if (!hasScriptSrc(h, FH_EVENTS_SRC)) out.push("fh-events.js is not on the page");
  return out;
}
