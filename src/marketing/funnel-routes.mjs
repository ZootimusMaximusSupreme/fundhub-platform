// @ts-check
// Shared pieces of the funnel builder's routes (build unit X4):
//   POST marketing/funnels/create     api/marketing/funnels/create.mjs
//   POST marketing/funnels/rename     api/marketing/funnels/rename.mjs
//   POST marketing/funnels/build      api/marketing/funnels/build.mjs
//   POST marketing/funnels/push-live  api/marketing/funnels/push-live.mjs
//   GET  marketing/funnel?id=         api/marketing/funnel.mjs
// (GET marketing/funnels, U03's list, shows the same funnels with their
// address, tag, status and pages.) Contract: docs/specs/marketing-machine-api.md.
//
// Each route keeps its own gate in its own file (scripts/journeys/extract.mjs
// reads it there). What they share is here: the request checks, the live
// ClickFunnels address read, and the wake.

import { InvalidError } from "./http.mjs";
import { FUNNEL_OFFERS, isFunnelOffer, normalizePath, pathsFromPages } from "./funnel-paths.mjs";
import { URL_TAG_LANES } from "./url-tags.mjs";
import { isCampaign } from "./offer-inputs.mjs";
import * as cfPages from "../messaging/providers/clickfunnels-pages.mjs";
import { wakeFunnelWorker } from "./funnel-transport.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refuse any key a route does not take. */
export function onlyKeys(body, allowed) {
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) throw new InvalidError(k, `${k} is not something this button sends.`);
  }
}

/** A funnel id from the body or the query. */
export function funnelId(v, field = "id") {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new InvalidError(field, "Which funnel? Send its id.");
  return v;
}

/**
 * POST marketing/funnels/create's body →
 *   { offerKey, lane, name, campaign, base, build }
 */
export function validateCreate(body) {
  onlyKeys(body, ["request_id", "offer_key", "lane", "name", "campaign", "path", "build"]);
  if (!isFunnelOffer(body.offer_key)) {
    throw new InvalidError("offer_key", `Pick an offer sold on a call: ${Object.keys(FUNNEL_OFFERS).join(" or ")}.`);
  }
  const offer = FUNNEL_OFFERS[body.offer_key];
  let lane = offer.lane;
  if (body.lane !== undefined && body.lane !== null) {
    if (typeof body.lane !== "string" || !URL_TAG_LANES.includes(body.lane)) {
      throw new InvalidError("lane", `The lane must be one the database knows: ${URL_TAG_LANES.join(", ")}.`);
    }
    lane = body.lane;
  }
  let name = `${offer.product.name} book a call`;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) {
      throw new InvalidError("name", "A funnel name is 1 to 80 characters.");
    }
    name = body.name.trim();
  }
  let campaign = null;
  if (body.campaign !== undefined && body.campaign !== null) {
    if (!isCampaign(body.campaign)) throw new InvalidError("campaign", "The campaign is a flywheel folder name, like partner.");
    campaign = body.campaign;
  }
  let base = null;
  if (body.path !== undefined && body.path !== null && body.path !== "") {
    base = typeof body.path === "string" ? normalizePath(body.path) : null;
    if (!base) throw new InvalidError("path", "An address is letters and numbers, like blueprint.");
  }
  if (body.build !== undefined && typeof body.build !== "boolean") throw new InvalidError("build", "build is true or false.");
  return { offerKey: body.offer_key, lane, name, campaign, base, build: body.build !== false };
}

/** POST marketing/funnels/rename's body → { id, base }. */
export function validateRename(body) {
  onlyKeys(body, ["request_id", "id", "path"]);
  const id = funnelId(body.id);
  const base = typeof body.path === "string" ? normalizePath(body.path) : null;
  if (!base) throw new InvalidError("path", "Type the new address, like blueprint-vip.");
  return { id, base };
}

/**
 * Every address the live ClickFunnels workspace already serves (READ ONLY).
 * { ok: true, taken: Set } or { ok: false, error }.
 */
export async function liveTakenPaths({ env = process.env, cf = cfPages } = {}) {
  /** @type {any} */
  const list = await cf.listPages({ env });
  if (!list.ok) return { ok: false, error: list.error };
  return { ok: true, taken: pathsFromPages(list.pages) };
}

/** The 503 when ClickFunnels cannot be read: nothing is made or moved blind. */
export function sendLiveUnreadable(res, error, what) {
  return res.status(503).json({
    error: "clickfunnels_unreadable",
    message: `${what} The live ClickFunnels pages could not be read, so the address could not be checked. ${error}`
  });
}

/** A unique-index refusal from Postgres, as plain words, or null. */
export function knownConflict(err) {
  if (!err || err.code !== "23505") return null;
  const c = String(err.constraint || err.message || "");
  if (/marketing_jobs_one_funnel_job_uq/.test(c)) {
    return new InvalidError("id", "The pages are already being written or pushed. Wait for that to finish.");
  }
  if (/marketing_funnel_pages_org_path_uq|marketing_funnels_org_path_uq|marketing_funnels_org_key_uq/.test(c)) {
    return new InvalidError("path", "That address was just taken. Try again.");
  }
  return null;
}

/**
 * Wake the worker for a job this request queued. When the wake fails the job is
 * failed with the reason (nothing would run it), and the answer says so.
 */
export async function wakeOrFail(database, { job, token, env, wake = wakeFunnelWorker }) {
  if (!job || job.status !== "queued") return { started: false, reason: null };
  const woke = await wake({ jobId: job.id, token, env });
  if (woke.ok) return { started: true, reason: null };
  const reason = `The worker could not be started: ${woke.reason}. Press the button again.`;
  await database.query(
    `UPDATE marketing_jobs SET status = 'failed', error = $2, finished_at = now()
      WHERE id = $1 AND status = 'queued'`,
    [job.id, reason]
  );
  return { started: false, reason };
}
