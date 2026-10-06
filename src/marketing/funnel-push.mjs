// @ts-check
// Job kind 'funnel_push': put a built funnel's three pages on ClickFunnels as
// NEW custom HTML pages, then prove each one live (build unit X4). Started only
// by Chris's Push live tap and its confirm (POST marketing/funnels/push-live),
// never by the clock. Registered in src/marketing/job-kinds.mjs.
//
// IT NEVER CHANGES A PAGE IT DID NOT MAKE.
//   * Before anything is made, all three addresses are checked against the live
//     ClickFunnels page list. One that is already a page stops the push before
//     any page is made, and nothing is changed.
//   * A page is made with POST .../pages/custom_html (a NEW page). Its id is
//     saved the moment ClickFunnels answers (marketing_funnel_pages.cf_page_id).
//   * The only PUT is the page token going into a page this push made: the
//     provider refuses any id that is not one of this funnel's saved cf_page_id
//     values (src/messaging/providers/clickfunnels-pages.mjs putOwnPageHtml).
//   * A retry after a crash between "made" and "saved" finds its own page by
//     the marker in its description (the funnel tag and our page row's id,
//     which nobody else can know) and takes it back; any other page at that
//     address stops the push.
//
// IT NEVER CALLS A PAGE LIVE ANYWHERE BUT ITS OWN ADDRESS.
//   * The address ClickFunnels answers for a page is saved as it is. Unless it
//     is that page's own address on the funnel host (https://apply.fundhub.ai
//     + the page's path), the push stops right there: no token, no proof, no
//     next page, and the funnel stays a draft. Which host ClickFunnels serves a
//     standalone custom HTML page on is not known until the first real push,
//     and a live funnel can never move, so a wrong host must never go live.
//   * An answer with no address at all is never filled in with a guess: the
//     push stops before saving that page (a Retry takes it back by its marker).
//   * The proof reads each page at its own address, and step 4 checks all three
//     once more before the funnel says "live".
//
// SAVED STEPS (a retry skips what is done): check addresses → make each page
// (thank-you, booking, then the landing page last, so the door people arrive
// at opens only when the rest exist) → check it is at its own address → token
// → prove with a cache-busted GET that the live page carries the funnel tag and
// the tracking → the funnel is live, and its three pages are queued for the repo (repo outbox, U05) in the
// same transaction: marketing/landing-pages/funnels/<key>/<page>.html. A page
// that is made but not proven yet fails the job with the reason; Retry proves it
// again and makes nothing new.

import * as cfPages from "../messaging/providers/clickfunnels-pages.mjs";
import { pathsFromPages, urlFor, FUNNEL_HOST } from "./funnel-paths.mjs";
import { tagMeta, trackingGaps } from "./funnel-tracking.mjs";
import {
  loadFunnel, markPagePushed, markPageSent, markPageProved, markPageProofFailed, markFunnelLive, sha256
} from "./funnel-store.mjs";
import { FunnelJobError } from "./funnel-build.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { enqueueRepoWrite } from "../repo/outbox.mjs";
import { wakeWorker } from "./wake.mjs";

/** The push order: the landing page goes last. */
export const PUSH_ORDER = Object.freeze(["thank_you", "booking", "landing"]);
export const PROOF_TRIES = 4;
export const PROOF_WAIT_MS = 15_000;

const ROLE_WORD = Object.freeze({ landing: "Landing", booking: "Book a call", thank_you: "Thank you" });
const SDK_TAG = '<script src="https://sdk.myclickfunnels.com/sdk.js" defer></script>';

/** The description that marks a ClickFunnels page as one this machine made for this page row. */
export function pageMarker(funnel, page) {
  return `Fundhub funnel ${funnel.tag} page ${page.role} ${page.id}. Made by the Fundhub dashboard.`;
}

/** Where a live funnel's page is saved in the repo (src/repo/allow-list.mjs). */
export function repoPathFor(funnel, page) {
  return `marketing/landing-pages/funnels/${funnel.key}/${String(page.role).replace(/_/g, "-")}.html`;
}

/** The saved page with the ClickFunnels page token added before the SDK tag. */
export function withPageToken(html, token) {
  const h = String(html ?? "");
  if (!token || h.includes('name="cf-page-token"')) return h;
  const meta = `<meta name="cf-page-token" content="${String(token).replace(/"/g, "&quot;")}">`;
  return h.includes(SDK_TAG) ? h.replace(SDK_TAG, `${meta}\n${SDK_TAG}`) : h.replace(/<\/head>/i, `${meta}\n</head>`);
}

/**
 * The page's own address (urlFor(path)) when `url` is that address — https, the
 * funnel host, no port, the same path (a trailing slash or upper case is the
 * same page) — else null. A query or a fragment is not the page's address.
 * @param {unknown} url
 * @param {string} path
 */
export function ownAddress(url, path) {
  if (typeof url !== "string" || !url.trim()) return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== FUNNEL_HOST || u.port || u.username || u.password) return null;
  if (u.search || u.hash) return null;
  const p = u.pathname.toLowerCase().replace(/\/+$/, "");
  return p === String(path) ? urlFor(path) : null;
}

/** A ClickFunnels answer that will be the same on a retry (bad key, refused page). 408 and 429 are worth a retry. */
export function finalStatus(status) {
  const s = Number(status);
  return s >= 400 && s < 500 && s !== 408 && s !== 429;
}

const wrongHost = (page, url) =>
  `ClickFunnels put ${page.path} at ${url}, not at ${urlFor(page.path)}. The funnel was not made live, and no more pages were made.`;

/**
 * run(job, ctx) — the handler contract of src/marketing/job-kinds.mjs.
 * ctx: { db, env, deps: { cf?, sleep?, now?, proofTries?, proofWaitMs? } }
 */
export async function run(job, ctx = /** @type {any} */ ({})) {
  const db = ctx.db;
  const env = ctx.env ?? process.env;
  const deps = ctx.deps ?? {};
  const cf = deps.cf ?? cfPages;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const tries = deps.proofTries ?? PROOF_TRIES;
  const waitMs = deps.proofWaitMs ?? PROOF_WAIT_MS;
  const orgId = job.org_id;
  const funnelId = job.payload && job.payload.funnel_id;

  const found = await loadFunnel(db, orgId, funnelId);
  if (!found || !found.funnel.kind) throw new FunnelJobError("That funnel was not found, or it was not built here.");
  let { funnel, pages } = found;
  if (funnel.status === "live") return { funnel_id: funnel.id, url: funnel.landing_url, already_live: true, pages: [] };
  if (pages.length !== 3 || pages.some((p) => !p.html)) throw new FunnelJobError("Build the pages first. Nothing was pushed.");
  const confirm = job.payload && job.payload.confirm_url;
  if (confirm && confirm !== funnel.landing_url) {
    throw new FunnelJobError(`The address you confirmed (${confirm}) is not this funnel's address (${funnel.landing_url}). Nothing was pushed.`);
  }
  const creds = cf.cfCreds(env);
  if ("error" in creds) throw new FunnelJobError(`${creds.error} Nothing was pushed.`);

  // 1. Check every address that is not ours yet, before making anything.
  const list = await cf.listPages({ env, creds });
  if (!list.ok) throw new Error(list.error);
  const livePaths = pathsFromPages(list.pages);
  const adopt = new Map();
  for (const page of pages) {
    if (page.cf_page_id || !livePaths.has(page.path)) continue;
    const mine = list.pages.find((p) => p && p.description === pageMarker(funnel, page)
      && pathsFromPages([p]).has(page.path));
    if (mine && mine.id != null) { adopt.set(page.id, mine); continue; }
    throw new FunnelJobError(`${page.path} is already a page on ClickFunnels, and this machine did not make it. Nothing was changed. Rename the funnel and push again.`);
  }

  // 2. Make each page (or take back our own), save its id at once, put its token in.
  const order = PUSH_ORDER.map((role) => pages.find((p) => p.role === role)).filter(Boolean);
  let created = 0;
  let adopted = 0;
  for (const page of order) {
    let token = null;
    if (!page.cf_page_id) {
      const own = adopt.get(page.id);
      let made;
      if (own) {
        made = { id: String(own.id), publicId: own.public_id != null ? String(own.public_id) : null, url: typeof own.url === "string" ? own.url : null, token: null };
        adopted += 1;
      } else {
        const r = await cf.createCustomHtmlPage({
          env, creds, workspace: list.workspace,
          name: `${funnel.name} - ${ROLE_WORD[page.role]}`,
          description: pageMarker(funnel, page),
          html: page.html,
          path: page.path
        });
        if (!r.ok) {
          if (finalStatus(r.status)) throw new FunnelJobError(r.error);
          throw new Error(r.error);
        }
        made = r;
        token = r.token;
        created += 1;
      }
      const answered = typeof made.url === "string" ? made.url.trim() : "";
      if (!/^https:\/\/[^/?#\s]+/i.test(answered)) {
        // Never guessed. The page is on ClickFunnels with our marker, so a Retry
        // takes it back by that marker; it is never made twice.
        throw new FunnelJobError(`ClickFunnels answered without the page address for ${page.path}. The funnel was not made live, and no more pages were made.`);
      }
      const liveUrl = ownAddress(answered, page.path) ?? answered;
      const row = await markPagePushed(db, { pageId: page.id, cfPageId: made.id, publicId: made.publicId, liveUrl });
      if (!row) throw new Error(`The ${page.role} page was saved by another run at the same moment.`);
      Object.assign(page, row);
    }
    // At its own address, or the push stops here (the page id stays saved, so a
    // Retry stops here again and makes nothing new).
    if (page.live_url !== urlFor(page.path)) throw new FunnelJobError(wrongHost(page, page.live_url));
    const owned = pages.map((p) => p.cf_page_id).filter(Boolean).map(String);
    if (!token && !page.sent_sha256) {
      const read = await cf.getPage({ env, creds, pageId: page.cf_page_id });
      if (!read.ok) throw new Error(read.error);
      token = read.token;
    }
    if (token) {
      const html = withPageToken(page.html, token);
      const sentSha = sha256(html);
      if (page.sent_sha256 !== sentSha) {
        const put = await cf.putOwnPageHtml({ env, creds, pageId: page.cf_page_id, html, ownedIds: owned });
        if (!put.ok) {
          if (put.refused) throw new FunnelJobError(put.error);
          throw new Error(put.error);
        }
        await markPageSent(db, { pageId: page.id, sentSha });
        page.sent_sha256 = sentSha;
      }
    }
  }

  // 3. Prove each page live: a cache-busted GET that shows the tag and the tracking.
  const unproved = [];
  for (const page of order) {
    if (page.proved_at) continue;
    let proof = null;
    for (let i = 0; i < tries; i += 1) {
      if (i > 0) await sleep(waitMs);
      const got = await cf.fetchLivePage({ env, url: urlFor(page.path), now: deps.now ? deps.now() : Date.now() });
      const gaps = got.ok ? trackingGaps(got.html, funnel.tag) : [];
      proof = {
        checked_at: new Date().toISOString(),
        url: got.url,
        status: got.status,
        has_tag: got.ok && got.html.includes(tagMeta(funnel.tag)),
        gaps,
        error: got.error
      };
      if (got.ok && gaps.length === 0) break;
    }
    if (proof && proof.status === 200 && proof.has_tag && proof.gaps.length === 0) {
      await markPageProved(db, { pageId: page.id, proof });
      page.proved_at = proof.checked_at;
    } else {
      await markPageProofFailed(db, { pageId: page.id, proof });
      unproved.push(`${page.path} (${proof && proof.error ? proof.error : proof && proof.gaps.length ? proof.gaps.join("; ") : "not answering yet"})`);
    }
  }
  if (unproved.length) {
    throw new Error(`The pages are on ClickFunnels, but these are not proven live yet: ${unproved.join(", ")}. Retry checks them again and makes nothing new.`);
  }

  // 4. Live.
  // Every page at its own address (host and path), and the landing page at the
  // funnel's address, or the funnel stays a draft.
  for (const p of order) {
    if (p.live_url !== urlFor(p.path)) throw new FunnelJobError(wrongHost(p, p.live_url));
  }
  const landing = pages.find((p) => p.role === "landing");
  if (!landing || landing.path !== funnel.path || landing.live_url !== urlFor(funnel.path)) {
    throw new FunnelJobError(`The first page is at ${landing ? landing.live_url : "no address"}, not at ${urlFor(funnel.path)}. The funnel was not made live.`);
  }
  // Live, and the three pages queued for the repo through the outbox in the same
  // transaction (they are committed when the outbox drains).
  const live = await withTransaction(db, async (tx) => {
    const row = await markFunnelLive(tx, { funnelId: funnel.id, landingUrl: landing.live_url });
    if (row) {
      for (const p of order) {
        await enqueueRepoWrite(tx, {
          orgId, opId: `funnel-page-live-${p.id}`, path: repoPathFor(funnel, p), mode: "replace", content: p.html
        });
      }
    }
    return row;
  });
  if (live) await (deps.wake ?? wakeWorker)(env);
  return {
    funnel_id: funnel.id,
    url: (live && live.landing_url) || landing.live_url,
    created,
    adopted,
    pages: order.map((p) => ({ role: p.role, path: p.path, cf_page_id: p.cf_page_id, live_url: p.live_url, proved: !!p.proved_at }))
  };
}
