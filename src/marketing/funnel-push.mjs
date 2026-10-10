// @ts-check
// Job kind 'funnel_push': put a built funnel's three pages live on the funnel
// host, apply.fundhub.ai, each at its own NEW path, then prove each one live
// (build unit X4, fixed in X4F). Started only by Chris's Push live tap and its
// confirm (POST marketing/funnels/push-live), never by the clock. Registered in
// src/marketing/job-kinds.mjs.
//
// WHY A CLICKFUNNELS FUNNEL (X4F, live test 2026-10-06). ClickFunnels serves a
// standalone custom HTML page on the workspace subdomain only, never on
// apply.fundhub.ai. Every live apply.fundhub.ai page (/roadmap, /watch,
// /funding-book-call) is a step of a ClickFunnels funnel whose domain is
// apply.fundhub.ai. So each marketing funnel gets ONE ClickFunnels funnel of its
// own on that domain, and its three pages are steps in it, in order landing ->
// booking -> thank-you, each step at the page's path.
//
// IT NEVER CHANGES A PAGE OR A FUNNEL IT DID NOT MAKE.
//   * Before anything is made, every address is checked against the live
//     ClickFunnels pages and funnels. One that is used by anything this machine
//     did not make stops the push before anything is made, and nothing is changed.
//   * The ClickFunnels funnel is made with POST .../funnels (a NEW funnel on the
//     apply.fundhub.ai domain) and found again by its name, which carries the
//     funnel tag and our funnel row's id (cfFunnelName). It is never changed.
//   * A page is made with POST .../pages/custom_html inside that funnel (a NEW
//     page). Its id is saved the moment ClickFunnels answers
//     (marketing_funnel_pages.cf_page_id).
//   * The only PUTs are on pages this push made: the page token into the page,
//     and (below) moving a page the first push made on its own into the funnel.
//     The provider refuses any id that is not one of this funnel's saved
//     cf_page_id values (src/messaging/providers/clickfunnels-pages.mjs).
//   * A retry after a crash between "made" and "saved" finds its own page by the
//     marker in its description (the funnel tag and our page row's id, which
//     nobody else can know) and takes it back; anything else at that address
//     stops the push.
//   * It never deletes a page or a funnel.
//
// A PAGE THE FIRST PUSH MADE ON ITS OWN. The shipped X4 push made standalone
// pages (page 25568231, /blueprint-thank-you on the subdomain, funnel
// fnl-blueprint). A page row that holds such a page is never made again (the
// database keeps its id for good, 425): the push makes a step for it in the
// funnel (a new page of ours at that address, marked with stepMarker), then
// moves our own page onto that step (PUT funnel.show_page_step_id). The page
// made for the step is left on ClickFunnels, unlinked; it is never deleted from
// here. ClickFunnels has no other way to put an existing page in a funnel:
// workflow steps (createworkflowstep) have no page step type.
//
// IT NEVER CALLS A PAGE LIVE ANYWHERE BUT ITS OWN ADDRESS.
//   * A page's address is apply.fundhub.ai + its step's path, and only when the
//     page is a step of OUR funnel on that domain. ClickFunnels' `url` for a
//     funnel page is always the subdomain, so it is kept for the record only.
//   * A page at any other address stops the push right there: no token, no
//     proof, no next page, and the funnel stays a draft.
//   * Before the proof, the funnel's steps are read back: exactly our three
//     pages, in order landing -> booking -> thank-you, or the push stops.
//   * The proof reads each page at its own address (cache-busted), and step 4
//     checks all three once more before the funnel says "live".
//
// SAVED STEPS (a retry skips what is done): read pages, funnels and domains →
// check addresses → the ClickFunnels funnel (made once) → each page (thank-you,
// booking, then the landing page last, so the door people arrive at opens only
// when the rest exist; each step placed so the order is landing, booking,
// thank-you) → check it is at its own address → token → the steps in order →
// prove with a cache-busted GET that the live page carries the funnel tag and
// the tracking → the funnel is live, and its three pages are queued for the repo
// (repo outbox, U05) in the same transaction:
// marketing/landing-pages/funnels/<key>/<page>.html. A page that is made but not
// proven yet fails the job with the reason; Retry proves it again and makes
// nothing new.

import * as cfPages from "../messaging/providers/clickfunnels-pages.mjs";
import { pathsFromPages, pathsFromFunnels, urlFor, FUNNEL_HOST, FUNNEL_ROLES } from "./funnel-paths.mjs";
import { tagMeta, trackingGaps } from "./funnel-tracking.mjs";
import {
  loadFunnel, markPagePushed, markPageAddress, markPageSent, markPageProved, markPageProofFailed, markFunnelLive, sha256
} from "./funnel-store.mjs";
import { FunnelJobError } from "./funnel-build.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { enqueueRepoWrite } from "../repo/outbox.mjs";
import { wakeWorker } from "./wake.mjs";

/** The push order: the landing page goes last. */
export const PUSH_ORDER = Object.freeze(["thank_you", "booking", "landing"]);
/** The order people move through the funnel's steps. */
export const STEP_ORDER = FUNNEL_ROLES;
export const PROOF_TRIES = 4;
export const PROOF_WAIT_MS = 15_000;

const ROLE_WORD = Object.freeze({ landing: "Landing", booking: "Book a call", thank_you: "Thank you" });
const SDK_TAG = '<script src="https://sdk.myclickfunnels.com/sdk.js" defer></script>';

/** The description that marks a ClickFunnels page as one this machine made for this page row. */
export function pageMarker(funnel, page) {
  return `Fundhub funnel ${funnel.tag} page ${page.role} ${page.id}. Made by the Fundhub dashboard.`;
}

/** The description of the step page made for a page the first push made on its own. */
export function stepMarker(funnel, page) {
  return `Fundhub funnel ${funnel.tag} page ${page.role} ${page.id}: the step page ${page.cf_page_id} moves onto. Made by the Fundhub dashboard.`;
}

/** The ClickFunnels funnel's name: the tag and our funnel row's id, so it is found again and never confused. */
export function cfFunnelName(funnel) {
  return `Fundhub ${funnel.tag} ${funnel.id}`;
}

/** The ClickFunnels funnel's own address on the domain (it sends people on to the first step). */
export function cfFunnelPath(funnel) {
  return `/${funnel.tag}`;
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
 * The address people open for a page, when the page is a step of OUR funnel
 * (whose domain is the funnel host, checked before any page is made): the
 * funnel host + the step's path. Else null.
 * @param {{ funnelId: string|null, funnelPublicId?: string|null, stepPath: string|null }} where (stepOf)
 * @param {{ id: any, public_id?: any }} cfFunnel
 */
export function addressIn(where, cfFunnel) {
  if (!where || !cfFunnel || !where.stepPath) return null;
  const ours = (where.funnelId != null && where.funnelId === String(cfFunnel.id))
    || (where.funnelPublicId != null && cfFunnel.public_id != null && where.funnelPublicId === String(cfFunnel.public_id));
  return ours ? urlFor(where.stepPath) : null;
}

/** The address to save for a page ClickFunnels just answered: ours on the funnel host, else its own url as it is. */
function answeredAddress(page, cfFunnel) {
  const own = addressIn(cfPages.stepOf(page), cfFunnel);
  if (own) return own;
  const url = page && typeof page.url === "string" ? page.url.trim() : "";
  return /^https:\/\/[^/?#\s]+/i.test(url) ? url : null;
}

/** A ClickFunnels answer that will be the same on a retry (bad key, refused page). 408 and 429 are worth a retry. */
export function finalStatus(status) {
  const s = Number(status);
  return s >= 400 && s < 500 && s !== 408 && s !== 429;
}

/** Throw a ClickFunnels failure: final when a retry would get the same answer. */
function raise(r) {
  if (r.refused || finalStatus(r.status)) throw new FunnelJobError(r.error);
  throw new Error(r.error);
}

const wrongHost = (page, url) =>
  `ClickFunnels put ${page.path} at ${url || "no address"}, not at ${urlFor(page.path)}. The funnel was not made live, and no more pages were made.`;

/** Where a step goes so the funnel reads landing, booking, thank-you: after each earlier page already in it. */
export function sortOrderFor(page, pages) {
  const before = STEP_ORDER.slice(0, STEP_ORDER.indexOf(page.role));
  return before.filter((role) => {
    const q = pages.find((p) => p.role === role);
    return !!(q && q.cf_page_id && q.live_url === urlFor(q.path));
  }).length;
}

/**
 * run(job, ctx) — the handler contract of src/marketing/job-kinds.mjs.
 * ctx: { db, env, deps: { cf?, sleep?, now?, proofTries?, proofWaitMs?, wake? } }
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

  // 1. Read what is on ClickFunnels: the pages, the funnels, and the funnel host's domain.
  const list = await cf.listPages({ env, creds });
  if (!list.ok) throw new Error(list.error);
  const workspace = list.workspace;
  const fl = await cf.listFunnels({ env, creds, workspace });
  if (!fl.ok) throw new Error(fl.error);
  const dl = await cf.listDomains({ env, creds, workspace });
  if (!dl.ok) throw new Error(dl.error);
  const domain = dl.domains.find((d) => d && String(d.name || "").trim().toLowerCase() === FUNNEL_HOST);
  if (!domain || domain.id == null) {
    throw new FunnelJobError(`${FUNNEL_HOST} is not a website domain on ClickFunnels, so nothing can go live there. Nothing was pushed.`);
  }
  const name = cfFunnelName(funnel);
  const mineByName = fl.funnels.filter((f) => f && f.name === name && !f.archived);
  if (mineByName.length > 1) {
    throw new FunnelJobError(`ClickFunnels has ${mineByName.length} funnels named ${name}, so the push cannot tell which is this one. Nothing was changed.`);
  }
  let cfFunnel = mineByName[0] || null;
  if (cfFunnel && String(cfFunnel.domain_id) !== String(domain.id)) {
    throw new FunnelJobError(`The ClickFunnels funnel made for ${funnel.path} is not on ${FUNNEL_HOST}. The funnel was not made live, and nothing more was changed.`);
  }

  // 2. Check every address before making anything. Ours: the pages this funnel
  // saved, and pages marked with this funnel's page rows. Anything else on an
  // address we need stops the push.
  const ownIds = new Set(pages.map((p) => p.cf_page_id).filter(Boolean).map(String));
  const markers = new Set(pages.flatMap((p) => [pageMarker(funnel, p), stepMarker(funnel, p)]));
  const others = list.pages.filter((p) => p && !ownIds.has(String(p.id)) && !markers.has(p.description));
  const taken = new Set([...pathsFromPages(others), ...pathsFromFunnels(fl.funnels.filter((f) => f && f.name !== name))]);
  const adopt = new Map();
  for (const page of pages) {
    if (page.cf_page_id) {
      if (page.live_url !== urlFor(page.path) && taken.has(page.path)) {
        throw new FunnelJobError(`${page.path} is already a page on ClickFunnels, and this machine did not make it. Nothing was changed.`);
      }
      continue;
    }
    const mine = list.pages.find((p) => p && p.description === pageMarker(funnel, page) && pathsFromPages([p]).has(page.path));
    if (mine && mine.id != null) { adopt.set(page.id, mine); continue; }
    if (taken.has(page.path)) {
      throw new FunnelJobError(`${page.path} is already a page on ClickFunnels, and this machine did not make it. Nothing was changed. Rename the funnel and push again.`);
    }
  }
  if (!cfFunnel && taken.has(cfFunnelPath(funnel))) {
    throw new FunnelJobError(`${cfFunnelPath(funnel)} is already used on ClickFunnels, so this funnel's ClickFunnels funnel cannot be made there. Nothing was changed.`);
  }

  // 3. The funnel's own ClickFunnels funnel, on the funnel host's domain. Made once.
  let funnelMade = false;
  if (!cfFunnel) {
    const made = await cf.createFunnel({ env, creds, workspace, name, path: cfFunnelPath(funnel), domainId: String(domain.id) });
    if (!made.ok) raise(made);
    funnelMade = true;
    cfFunnel = made.funnel;
    if (made.domainId !== String(domain.id)) {
      throw new FunnelJobError(`ClickFunnels made the funnel for ${funnel.path} without the ${FUNNEL_HOST} domain. The funnel was not made live, and no pages were made.`);
    }
  }
  const cfFunnelRef = /** @type {{ id: any, public_id?: any }} */ (cfFunnel);

  // 4. Make each page in the funnel (or take back our own), save its id at
  // once, check it is at its own address, put its token in.
  const order = PUSH_ORDER.map((role) => pages.find((p) => p.role === role)).filter(Boolean);
  const owned = () => pages.map((p) => p.cf_page_id).filter(Boolean).map(String);
  let created = 0;
  let adopted = 0;
  let moved = 0;
  for (const page of order) {
    let token = null;
    if (!page.cf_page_id) {
      const own = adopt.get(page.id);
      let made;
      if (own) {
        made = { id: String(own.id), publicId: own.public_id != null ? String(own.public_id) : null, page: own, token: null };
        adopted += 1;
      } else {
        const r = await cf.createCustomHtmlPage({
          env, creds, workspace,
          funnelId: String(cfFunnelRef.id),
          sortOrder: sortOrderFor(page, pages),
          name: `${funnel.name} - ${ROLE_WORD[page.role]}`,
          description: pageMarker(funnel, page),
          html: page.html,
          path: page.path
        });
        if (!r.ok) raise(r);
        made = r;
        token = r.token;
        created += 1;
      }
      const answered = answeredAddress(made.page, cfFunnelRef);
      if (!answered) {
        // Never guessed. The page is on ClickFunnels with our marker, so a Retry
        // takes it back by that marker; it is never made twice.
        throw new FunnelJobError(`ClickFunnels answered without the page address for ${page.path}. The funnel was not made live, and no more pages were made.`);
      }
      const row = await markPagePushed(db, { pageId: page.id, cfPageId: made.id, publicId: made.publicId, liveUrl: answered });
      if (!row) throw new Error(`The ${page.role} page was saved by another run at the same moment.`);
      Object.assign(page, row);
    }

    // Not at its own address yet: read where it sits on ClickFunnels.
    if (page.live_url !== urlFor(page.path)) {
      const read = await cf.getPage({ env, creds, pageId: page.cf_page_id });
      if (!read.ok) raise(read);
      let where = addressIn(read, cfFunnelRef);
      token = read.token;
      if (!where && read.standalone && !page.proved_at) {
        await moveIntoFunnel({ cf, env, creds, workspace, funnel, page, pages, cfFunnel: cfFunnelRef, listed: list.pages, owned: owned() });
        moved += 1;
        const again = await cf.getPage({ env, creds, pageId: page.cf_page_id });
        if (!again.ok) raise(again);
        where = addressIn(again, cfFunnelRef);
        token = again.token;
      }
      if (where !== urlFor(page.path)) {
        throw new FunnelJobError(wrongHost(page, where || (read.page && read.page.url) || page.live_url));
      }
      const row = await markPageAddress(db, { pageId: page.id, cfPageId: page.cf_page_id, liveUrl: where });
      if (!row) throw new Error(`The ${page.role} page was changed by another run at the same moment.`);
      Object.assign(page, row);
    }

    if (!token && !page.sent_sha256) {
      const read = await cf.getPage({ env, creds, pageId: page.cf_page_id });
      if (!read.ok) raise(read);
      token = read.token;
    }
    if (token) {
      const html = withPageToken(page.html, token);
      const sentSha = sha256(html);
      if (page.sent_sha256 !== sentSha) {
        const put = await cf.putOwnPageHtml({ env, creds, pageId: page.cf_page_id, html, ownedIds: owned() });
        if (!put.ok) raise(put);
        await markPageSent(db, { pageId: page.id, sentSha });
        page.sent_sha256 = sentSha;
      }
    }
  }

  // 5. The funnel's steps, read back: our three pages, landing -> booking -> thank-you.
  const steps = await cf.funnelStructure({ env, creds, funnelId: String(cfFunnelRef.id) });
  if (!steps.ok) throw new Error(steps.error);
  const want = STEP_ORDER.map((role) => String((pages.find((p) => p.role === role) || {}).cf_page_id));
  const got = steps.steps.map((s) => s.pageId);
  if (got.length !== want.length || got.some((id, i) => id !== want[i])) {
    throw new FunnelJobError(`The ClickFunnels funnel for ${funnel.path} does not hold its three pages in order (landing, booking, thank-you): it holds pages ${got.join(", ") || "none"}, not ${want.join(", ")}. The funnel was not made live.`);
  }

  // 6. Prove each page live: a cache-busted GET that shows the tag and the tracking.
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

  // 7. Live.
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
    cf_funnel_id: String(cfFunnelRef.id),
    funnel_made: funnelMade,
    created,
    adopted,
    moved,
    pages: order.map((p) => ({ role: p.role, path: p.path, cf_page_id: p.cf_page_id, live_url: p.live_url, proved: !!p.proved_at }))
  };
}

/**
 * A page the first push made on its own (in no funnel) joins OUR funnel: a step
 * at its address is made first (a new page of ours, marked with stepMarker, made
 * once; a retry finds it by the marker), then our page is moved onto that step.
 * The step's first page stays on ClickFunnels, unlinked; nothing is deleted.
 * Throws a FunnelJobError when ClickFunnels puts the step anywhere else or will
 * not move the page.
 */
async function moveIntoFunnel({ cf, env, creds, workspace, funnel, page, pages, cfFunnel, listed, owned }) {
  const marker = stepMarker(funnel, page);
  let holder = listed.find((p) => p && p.description === marker) || null;
  let where = holder ? cfPages.stepOf(holder) : null;
  if (!holder) {
    const r = await cf.createCustomHtmlPage({
      env, creds, workspace,
      funnelId: String(cfFunnel.id),
      sortOrder: sortOrderFor(page, pages),
      name: `${funnel.name} - ${ROLE_WORD[page.role]} (step)`,
      description: marker,
      html: page.html,
      path: page.path
    });
    if (!r.ok) raise(r);
    holder = r.page;
    where = r;
  }
  const at = addressIn(where, cfFunnel);
  if (!where || !where.stepId || at !== urlFor(page.path)) {
    throw new FunnelJobError(`ClickFunnels put the step for ${page.path} at ${at || "no address in this funnel"}, not at ${urlFor(page.path)}. Page ${page.cf_page_id} was not moved, and the funnel was not made live.`);
  }
  const put = await cf.moveOwnPageOntoStep({ env, creds, pageId: page.cf_page_id, stepId: where.stepId, ownedIds: owned });
  if (!put.ok) {
    if (put.refused || finalStatus(put.status)) {
      throw new FunnelJobError(`${put.error} Page ${page.cf_page_id} stays where it is, and the funnel was not made live.`);
    }
    throw new Error(put.error);
  }
  return { stepPageId: String(holder.id) };
}
