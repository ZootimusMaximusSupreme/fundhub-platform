// @ts-check
// The database half of the funnel builder (build unit X4). Tables:
// marketing_funnels (410, builder columns 425), marketing_funnel_pages (425),
// marketing_jobs (409/411).
//
// Every function takes the db or the caller's transaction. Short statements
// only: nothing here is held open across a model, ClickFunnels or GitHub call
// (spec §4 trap 3). The rules (unique address, tag in the page, a live page
// never changes) are in the database; these functions turn the refusals into
// plain words.

import { createHash } from "node:crypto";
import {
  FUNNEL_ROLES, FUNNEL_OFFERS, pagePaths, keyFor, tagFor, urlFor, refuseReason,
  nextFreePath, reservedPaths
} from "./funnel-paths.mjs";
import { enqueueJob } from "./jobs.mjs";
import { InvalidError, NotFoundError } from "./http.mjs";

/** The two job kinds the builder uses (src/marketing/job-kinds.mjs). */
export const BUILD_KIND = "funnel";
export const PUSH_KIND = "funnel_push";
export const FUNNEL_JOB_KINDS = Object.freeze([BUILD_KIND, PUSH_KIND]);

/** @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number | null }> }} Db */

export const sha256 = (text) => createHash("sha256").update(String(text), "utf8").digest("hex");

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── what is taken ────────────────────────────────────────────────────────── */

function pathOfUrl(url) {
  try { return new URL(url).pathname.toLowerCase().replace(/\/+$/, "") || "/"; } catch { return null; }
}

/**
 * Every address and key this company already uses in our own rows: every
 * built page, every built funnel's address, and the path of every funnel's
 * landing_url (the hand-mapped ones too).
 * @param {Db} db
 * @param {string} orgId
 * @param {{ exceptFunnelId?: string|null }} [opts] leave one funnel out (a rename)
 */
export async function ownTaken(db, orgId, { exceptFunnelId = null } = {}) {
  const taken = new Set();
  const keys = new Set();
  const pages = await db.query(
    `SELECT path FROM marketing_funnel_pages WHERE org_id = $1 AND ($2::uuid IS NULL OR funnel_id <> $2::uuid)`,
    [orgId, exceptFunnelId]
  );
  for (const r of pages.rows) taken.add(String(r.path).toLowerCase());
  const funnels = await db.query(
    `SELECT id, key, path, landing_url FROM marketing_funnels WHERE org_id = $1`,
    [orgId]
  );
  for (const r of funnels.rows) {
    if (exceptFunnelId && String(r.id) === String(exceptFunnelId)) continue;
    keys.add(r.key);
    if (r.path) taken.add(String(r.path).toLowerCase());
    const p = pathOfUrl(r.landing_url);
    if (p && p !== "/") taken.add(p);
  }
  return { taken, keys };
}

/* ── views ────────────────────────────────────────────────────────────────── */

/** One page as the API shows it (no HTML unless asked). */
export function pageView(p, { withHtml = false } = {}) {
  const status = p.proved_at ? "live" : p.cf_page_id ? "pushed" : p.built_at ? "built" : "empty";
  const out = {
    id: p.id,
    position: Number(p.position),
    role: p.role,
    path: p.path,
    url: p.live_url || urlFor(p.path),
    status,
    built_at: iso(p.built_at),
    pushed_at: iso(p.pushed_at),
    proved_at: iso(p.proved_at),
    live_url: p.live_url ?? null,
    events_seen: p.events_seen == null ? 0 : Number(p.events_seen),
    last_event_at: iso(p.last_event_at)
  };
  if (withHtml) {
    return { ...out, copy: p.page_copy ?? null, html: p.html ?? null };
  }
  return out;
}

/** SQL fragment: a funnel's pages as a JSON list, for SELECT f.*, … FROM marketing_funnels f. */
export const PAGES_JSON_SQL = `COALESCE((
    SELECT json_agg(json_build_object(
             'id', p.id, 'position', p.position, 'role', p.role, 'path', p.path,
             'built_at', p.built_at, 'cf_page_id', p.cf_page_id, 'live_url', p.live_url,
             'pushed_at', p.pushed_at, 'proved_at', p.proved_at,
             'events_seen', p.events_seen, 'last_event_at', p.last_event_at)
           ORDER BY p.position)
      FROM marketing_funnel_pages p
     WHERE p.funnel_id = f.id), '[]'::json) AS pages`;

/* ── create ───────────────────────────────────────────────────────────────── */

/**
 * Make a book-a-call funnel and its three empty pages, inside the caller's
 * transaction. The address is `base` when given (checked), else the first free
 * one from the offer's word. `liveTaken` is every address ClickFunnels already
 * serves (read before the transaction).
 * Returns { funnel, pages }.
 * @param {Db} tx
 * @param {{ orgId: string, staffId: string|null, offerKey: string, lane: string, name: string,
 *           campaign: string|null, base: string|null, liveTaken: Set<string> }} input
 */
export async function createBuiltFunnel(tx, input) {
  const offer = FUNNEL_OFFERS[input.offerKey];
  if (!offer) throw new InvalidError("offer_key", "That offer cannot get a book-a-call funnel.");
  // One create at a time per company, so two presses cannot pick the same address.
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('marketing_funnel_create:' || $1, 0))`, [input.orgId]);
  const own = await ownTaken(tx, input.orgId);
  const taken = new Set([...own.taken, ...input.liveTaken]);
  const reserved = reservedPaths();
  let base;
  if (input.base) {
    const why = refuseReason(input.base, { taken, keys: own.keys, reserved });
    if (why) throw new InvalidError("path", why);
    base = input.base;
  } else {
    const pick = nextFreePath(offer.base, { taken, keys: own.keys, reserved });
    if ("error" in pick) throw new InvalidError("path", pick.error);
    base = pick.base;
  }
  const key = keyFor(base);
  const tag = tagFor(key);
  const paths = pagePaths(base);

  const f = await tx.query(
    `INSERT INTO marketing_funnels
       (org_id, key, name, landing_url, offer_key, lane, book_call, kind, path, tag,
        utm_campaign, campaign, status, created_by, active)
     VALUES ($1, $2, $3, $4, $5, $6::ad_lane, true, 'book_a_call', $7, $8, $9, $10, 'draft', $11, false)
     RETURNING *`,
    [input.orgId, key, input.name, urlFor(paths.landing), input.offerKey, input.lane, base, tag,
      input.lane, input.campaign, input.staffId]
  );
  const funnel = f.rows[0];
  const pages = [];
  for (const [i, role] of FUNNEL_ROLES.entries()) {
    const p = await tx.query(
      `INSERT INTO marketing_funnel_pages (org_id, funnel_id, position, role, path)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.orgId, funnel.id, i + 1, role, paths[role]]
    );
    pages.push(p.rows[0]);
  }
  return { funnel, pages };
}

/* ── read ─────────────────────────────────────────────────────────────────── */

/**
 * A built funnel and its pages (with HTML), or null.
 * @param {Db} db
 * @param {string} orgId
 * @param {string} id
 * @param {{ lock?: boolean }} [opts] lock the funnel row (inside a transaction)
 */
export async function loadFunnel(db, orgId, id, { lock = false } = {}) {
  if (!UUID_RE.test(String(id || ""))) return null;
  const f = await db.query(
    `SELECT * FROM marketing_funnels WHERE id = $1 AND org_id = $2${lock ? " FOR UPDATE" : ""}`,
    [id, orgId]
  );
  const funnel = f.rows[0];
  if (!funnel) return null;
  const p = await db.query(
    `SELECT * FROM marketing_funnel_pages WHERE funnel_id = $1 AND org_id = $2 ORDER BY position`,
    [id, orgId]
  );
  return { funnel, pages: p.rows };
}

/** The build or push job still queued or running for this funnel, or null. */
export async function inFlightJob(db, funnelId) {
  const r = await db.query(
    `SELECT * FROM marketing_jobs
      WHERE kind = ANY($2::text[]) AND status IN ('queued', 'running') AND payload->>'funnel_id' = $1
      ORDER BY created_at DESC LIMIT 1`,
    [String(funnelId), FUNNEL_JOB_KINDS]
  );
  return r.rows[0] || null;
}

/** The last few build and push jobs for a funnel, newest first. */
export async function funnelJobs(db, orgId, funnelId, { limit = 6 } = {}) {
  const r = await db.query(
    `SELECT id, kind, status, attempts, error, result, created_at, claimed_at, finished_at, run_after
       FROM marketing_jobs
      WHERE org_id = $1 AND kind = ANY($3::text[]) AND payload->>'funnel_id' = $2
      ORDER BY created_at DESC LIMIT $4`,
    [orgId, String(funnelId), FUNNEL_JOB_KINDS, limit]
  );
  return r.rows.map((j) => ({
    id: j.id, kind: j.kind, status: j.status, attempts: j.attempts, error: j.error ?? null,
    result: j.result ?? null, created_at: iso(j.created_at), claimed_at: iso(j.claimed_at),
    finished_at: iso(j.finished_at), run_after: iso(j.run_after)
  }));
}

/** Enqueue a build or push job for a funnel. A second one while one is in flight is refused by 425's index. */
export async function enqueueFunnelJob(tx, { orgId, funnelId, kind, staffId = null, extra = {} }) {
  const job = await enqueueJob(tx, { orgId, kind, payload: { funnel_id: String(funnelId), ...extra } });
  if (staffId) {
    await tx.query(`UPDATE marketing_jobs SET requested_by = $2 WHERE id = $1`, [job.id, staffId]);
    job.requested_by = staffId;
  }
  return job;
}

/** A job as the API shows it. */
export function jobView(j) {
  if (!j) return null;
  return { id: j.id, kind: j.kind, status: j.status, created_at: iso(j.created_at) };
}

/* ── rename ───────────────────────────────────────────────────────────────── */

/**
 * Move a draft funnel to a new address, inside the caller's transaction.
 * Refused when any page is on ClickFunnels (live addresses never change), when
 * a build or push is in flight, or when the address is taken or reserved.
 * `rerender(page, paths)` returns the new HTML for a built page (the links
 * between the pages name the addresses), or null to leave it.
 * @param {Db} tx
 * @param {{ orgId: string, id: string, base: string, liveTaken: Set<string>,
 *           rerender: (page: any, funnel: any, paths: any) => string|null }} input
 */
export async function renameFunnel(tx, { orgId, id, base, liveTaken, rerender }) {
  const found = await loadFunnel(tx, orgId, id, { lock: true });
  if (!found || !found.funnel.kind) throw new NotFoundError("That funnel was not found, or it was not built here.");
  const { funnel, pages } = found;
  if (funnel.status === "live" || pages.some((p) => p.cf_page_id)) {
    throw new InvalidError("id", `${funnel.path} is live, so its address never changes. Build a new funnel for a new address.`);
  }
  if (await inFlightJob(tx, funnel.id)) {
    throw new InvalidError("id", "The pages are being written or pushed right now. Rename it when that finishes.");
  }
  if (base === funnel.path) throw new InvalidError("path", `The funnel is already at ${base}.`);
  const own = await ownTaken(tx, orgId, { exceptFunnelId: funnel.id });
  const why = refuseReason(base, { taken: new Set([...own.taken, ...liveTaken]), keys: new Set(), reserved: reservedPaths() });
  if (why) throw new InvalidError("path", why);
  const paths = pagePaths(base);
  const current = new Set(pages.map((p) => p.path));
  if (FUNNEL_ROLES.some((role) => current.has(paths[role]))) {
    throw new InvalidError("path", "That name reuses one of this funnel's own page addresses. Pick a different word.");
  }

  // None of the new addresses is in use (checked above), so the pages can move
  // one at a time without two of them ever sharing an address.
  for (const p of pages) {
    await tx.query(`UPDATE marketing_funnel_pages SET path = $2 WHERE id = $1`, [p.id, `${paths[p.role]}`]);
  }
  const f = await tx.query(
    `UPDATE marketing_funnels
        SET path = $2, landing_url = $3,
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE id = $1 RETURNING *`,
    [funnel.id, base, urlFor(paths.landing)]
  );
  const moved = f.rows[0];
  for (const p of pages) {
    if (!p.html) continue;
    const html = rerender({ ...p, path: paths[p.role] }, moved, paths);
    if (html) {
      await tx.query(`UPDATE marketing_funnel_pages SET html = $2, html_sha256 = $3 WHERE id = $1`, [p.id, html, sha256(html)]);
    }
  }
  return loadFunnel(tx, orgId, funnel.id);
}

/* ── build and push records ───────────────────────────────────────────────── */

/** Save one page's checked words and its HTML (one short statement). */
export async function savePageBuild(db, { pageId, copy, html, jobId }) {
  const r = await db.query(
    `UPDATE marketing_funnel_pages
        SET page_copy = $2::jsonb, html = $3, html_sha256 = $4, built_at = now(), build_job_id = $5
      WHERE id = $1 AND cf_page_id IS NULL
      RETURNING *`,
    [pageId, JSON.stringify(copy), html, sha256(html), jobId || null]
  );
  return r.rows[0] || null;
}

/** Record the ClickFunnels page this machine just created (the first thing after the create answers). */
export async function markPagePushed(db, { pageId, cfPageId, publicId, liveUrl }) {
  const r = await db.query(
    `UPDATE marketing_funnel_pages
        SET cf_page_id = $2, cf_public_id = $3, live_url = $4, pushed_at = now()
      WHERE id = $1 AND cf_page_id IS NULL
      RETURNING *`,
    [pageId, String(cfPageId), publicId, liveUrl]
  );
  return r.rows[0] || null;
}

export async function markPageSent(db, { pageId, sentSha }) {
  await db.query(`UPDATE marketing_funnel_pages SET sent_sha256 = $2 WHERE id = $1 AND cf_page_id IS NOT NULL`, [pageId, sentSha]);
}

export async function markPageProved(db, { pageId, proof }) {
  await db.query(
    `UPDATE marketing_funnel_pages SET proved_at = now(), proof = $2::jsonb WHERE id = $1 AND cf_page_id IS NOT NULL`,
    [pageId, JSON.stringify(proof)]
  );
}

export async function markPageProofFailed(db, { pageId, proof }) {
  await db.query(`UPDATE marketing_funnel_pages SET proof = $2::jsonb WHERE id = $1`, [pageId, JSON.stringify(proof)]);
}

/** Every page proven: the funnel is live at its landing page's address, and active
    (a draft is made inactive, so nothing plans or loads ads for a page that is not up yet). */
export async function markFunnelLive(db, { funnelId, landingUrl }) {
  const r = await db.query(
    `UPDATE marketing_funnels
        SET status = 'live', live_at = now(), landing_url = $2, active = true,
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
      WHERE id = $1 AND kind IS NOT NULL AND status = 'draft'
      RETURNING *`,
    [funnelId, landingUrl]
  );
  return r.rows[0] || null;
}
