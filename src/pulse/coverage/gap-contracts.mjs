// Contract and e-sign gaps for the morning pulse. Report only. Read only.
// Never signs a contract. Never edits a page. Never auto-fixes.
//
// Slice 10 already watches the chaser machine row and the registry door.
// This file does not repeat those two. A GET to the sign link with no token
// answers 404 on purpose. That closed door is not a break.
//
// Recon (AG-07) is read by the daily pulse itself (id: recon). This file does
// not read it again.

// ONE JUDGE, TWO CLOCKS (2026-10-20). The sent and signed checks, their SQL, and the sign door's
// verdict live in src/pulse/beats/lib/contracts-truth.mjs, so this morning lane and the hourly beat
// contract-signing run the same code. The template check (it needs the offer list) stays here.
//
// NO REPO FILE IS READ AT RUN TIME (2026-10-20). The route check used to read
// netlify/functions/api.mjs from disk, a file the live bundle does not carry, so on the server it
// could only ever say "could not read the route map". It now reads the ROUTES map the router itself
// is built from (imported, so the bundler packs it), which is the same table the old text search
// looked in.

import { OFFERS, resolveContractTemplateKey } from "../../config/offers.mjs";
import { ROUTES } from "../../../netlify/functions/api.mjs";
import {
  NO_SECOND, SIGN_PATH, FORGED_LINK, check, checkSent, checkStored, judgeSignDoor, needDb, probeBody, readFailed, readRows,
  signDoorDown
} from "../beats/lib/contracts-truth.mjs";

export {
  FORGED_LINK,
  SQL_SENT,
  SQL_SIGNED,
  classifyBareSignGet,
  classifyForgedSignGet
} from "../beats/lib/contracts-truth.mjs";

const DEFAULT_BASE_URL = "https://fundhub.ai";
/** A hung sign door must show as a red row, not wait for the pulse's own step cut. */
const FETCH_TIMEOUT_MS = 15_000;

export const CHECK_IDS = Object.freeze([
  "contracts:sent-unsignable",
  "contracts:sign-route",
  "contracts:signed-not-stored",
  "contracts:template-missing"
]);

/** Active templates for the keys this company should already have. SELECT only. */
export const SQL_TEMPLATES = `
  /* gap:templates */
  SELECT template_key
    FROM contract_templates
   WHERE org_id = $1::uuid
     AND active = true
     AND is_demo IS NOT TRUE
     AND template_key = ANY($2::text[])`;

/**
 * Template keys a live client offer sends, plus the funding-plus-repair
 * agreement. Offers with no contract key are not in this list.
 */
export function liveContractTemplateKeys() {
  const keys = new Set();
  for (const offer of Object.values(OFFERS)) {
    if (offer && offer.contractTemplateKey) keys.add(offer.contractTemplateKey);
  }
  const combo = resolveContractTemplateKey({
    offerKey: "FUNDING_DFY",
    tier: "FUNDING_PLUS_REPAIR"
  });
  if (combo) keys.add(combo);
  return [...keys].sort();
}

function offerLabel(templateKey) {
  const names = [];
  for (const offer of Object.values(OFFERS)) {
    if (offer && offer.contractTemplateKey === templateKey && offer.name) {
      names.push(offer.name);
    }
  }
  if (templateKey === "REPAIR-AND-FUNDING-AGREEMENT") names.push("Funding plus repair");
  return names.length ? `${names.join(", ")} (${templateKey})` : templateKey;
}

/**
 * True when the router mounts the client sign door.
 * With source text (tests), the text is searched for the route key. Otherwise the router's own
 * ROUTES map is read. Returns null when there is no map to read, so the caller can lean on the
 * live probe instead of crashing the whole lane.
 */
export function signRouteIsWired(source, routes = ROUTES) {
  if (source != null) return /"contracts\/sign"\s*:/.test(String(source));
  if (!routes || typeof routes !== "object") return null;
  return Object.prototype.hasOwnProperty.call(routes, "contracts/sign");
}

function fetchOf(ctx) {
  if (typeof ctx.fetchImpl === "function") return ctx.fetchImpl;
  if (typeof ctx.fetch === "function") return ctx.fetch;
  return null;
}

/** GET one path, return { status, body } or throw. */
async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  return probeBody(res);
}

async function checkSignRoute(ctx) {
  const id = "contracts:sign-route";
  // routeMounted: true / false / null (could not read the route map). Undefined reads the real map.
  const mounted = ctx.routeMounted === undefined
    ? signRouteIsWired()
    : (ctx.routeMounted === null ? null : ctx.routeMounted === true);
  if (mounted === false) {
    return check(
      id,
      "FAIL",
      "The sign link route is not wired. GET /api/contracts/sign is missing from the route map.",
      `Wire GET and POST /api/contracts/sign. A GET with no token should stay a 404. That 404 is the closed door, not a break. Do not sign as a client. ${NO_SECOND}`
    );
  }

  const fetchImpl = fetchOf(ctx);
  const origin = String(ctx.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const down = (message) => signDoorDown(id, message);

  // The bare GET: a test can hand in a finished probe instead of a fetch.
  let bare = null;
  if (ctx.signProbe) {
    try { bare = await probeBody(ctx.signProbe); } catch (err) {
      return down(String((err && err.message) || err).slice(0, 160));
    }
  } else if (fetchImpl) {
    try { bare = await getJson(fetchImpl, `${origin}${SIGN_PATH}`); } catch (err) {
      return down(String((err && err.message) || err).slice(0, 160));
    }
  }

  // The forged-link GET: proves the signing secret is set and the door checks links.
  let forged = null;
  if (ctx.signLinkProbe) {
    try { forged = await probeBody(ctx.signLinkProbe); } catch (err) {
      return down(String((err && err.message) || err).slice(0, 160));
    }
  } else if (fetchImpl && !ctx.signProbe) {
    try { forged = await getJson(fetchImpl, `${origin}${FORGED_LINK}`); } catch (err) {
      return down(String((err && err.message) || err).slice(0, 160));
    }
  }

  if (!bare && !forged) {
    if (mounted == null) {
      return check(id, "skip", "The sign link route could not be read from the route map and this run has no fetch.");
    }
    return check(
      id,
      "PASS",
      "The sign link route is wired. This run did not call it. A GET with no token is a 404 on purpose."
    );
  }
  return judgeSignDoor(id, bare, forged);
}

async function checkTemplates(db, orgId) {
  const id = "contracts:template-missing";
  const skipped = needDb(id, db, orgId, "contract templates");
  if (skipped) return skipped;
  const wanted = liveContractTemplateKeys();
  const read = await readRows(db, SQL_TEMPLATES, [orgId, wanted]);
  if (!read.ok) {
    return readFailed(id, "contract templates", read.error);
  }
  const have = new Set(read.rows.map((row) => row.template_key).filter(Boolean));
  const missing = wanted.filter((key) => !have.has(key));
  if (missing.length === 0) {
    return check(
      id,
      "PASS",
      `${wanted.length} live offer templates are on file.`
    );
  }
  return check(
    id,
    "FAIL",
    `Template missing for ${missing.length} live offer${missing.length === 1 ? "" : "s"}: ${missing.map(offerLabel).join("; ")}.`,
    `Add the missing contract template and leave it active. Do not mint a new offer. ${NO_SECOND}`
  );
}

/**
 * @param {object} [ctx]
 * @param {object} [ctx.db] read-only query client
 * @param {string} [ctx.orgId]
 * @param {boolean|null} [ctx.routeMounted] test override for the route map (null = could not read it)
 * @param {Function} [ctx.fetchImpl] GET the sign door (bare and with a forged link). Optional. ctx.fetch also works.
 * @param {string} [ctx.baseUrl]
 * @param {object} [ctx.signProbe] `{ status, body }` or a fetch Response. Used instead of the bare GET.
 * @param {object} [ctx.signLinkProbe] same shape. Used instead of the forged-link GET.
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  return [
    await checkSent(db, orgId),
    await checkSignRoute(ctx),
    await checkStored(db, orgId),
    await checkTemplates(db, orgId)
  ];
}
