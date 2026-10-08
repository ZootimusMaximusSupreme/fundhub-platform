// Credit soft-pull approve door. Report only. Never auto-fix.
// One GET of the approve screen. One GET of its read route, with no link token.
// One in-process GET of the same read, with a link signed for a real client, to
// see the database half answer. None of these GETs pulls credit or sends bureau
// mail. The handler is only ever asked to read.
// Recon (AG-07) is the one tripwire. Do not invent a second watchdog.
// Do not edit the approve page from this check.
//
// The plain up/down ping of both doors is reg:soft-pull-approve.html and
// reg:soft-pull-approve in the registry. What these add: the screen is really
// the approve screen, the unsigned answer has the right shape, and a signed
// read reaches the database and comes back with the words and the price.

import { secretFromEnv } from "../../documents/signed-url.mjs";
import { signSoftPullApproveUrl } from "../../consent/approve-token.mjs";

export const DEFAULT_BASE_URL = "https://fundhub.ai";
export const APPROVE_PAGE_PATH = "/app/soft-pull-approve.html";
export const APPROVE_READ_PATH = "/api/soft-pull-approve";

/** The screen calls this path. A 200 page that lacks it is not the approve screen. */
export const PAGE_MARKER = "/api/soft-pull-approve";

/** What GET /api/soft-pull-approve returns when the link is real. */
export const READ_KIND = "soft_pull_consent";

export const CHECK_IDS = Object.freeze([
  "soft-pull:approve-page",
  "soft-pull:approve-read",
  "soft-pull:approve-signed-read"
]);

/** Each GET gets this long. Both run at once, and the lane step has 26 seconds. */
export const FETCH_TIMEOUT_MS = 8000;

/** The newest real client. Any client will do: the read is thrown away. */
export const CLIENT_PICK_SQL = `
/* gap:soft-pull-client */
SELECT c.id::text AS id
  FROM clients c
 WHERE c.org_id = $1::uuid
   AND c.is_demo IS NOT TRUE
 ORDER BY c.created_at DESC
 LIMIT 1
`.trim();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not invent a second watchdog. " +
  "Do not pull credit. Do not send bureau mail. Do not edit the approve page. Do not auto-fix.";

const PAGE_FIX =
  `Put the soft-pull approve screen back at ${APPROVE_PAGE_PATH}. ${TRIPWIRE}`;

const READ_FIX =
  `Fix GET ${APPROVE_READ_PATH} so the approve screen can read it. Do not POST. ${TRIPWIRE}`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function originOf(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function httpStatus(res) {
  const n = Number(res && res.status);
  return Number.isInteger(n) ? n : null;
}

async function bodyText(res) {
  if (res && typeof res.text === "function") return String((await res.text()) ?? "");
  if (res && typeof res.json === "function") {
    const value = await res.json();
    return JSON.stringify(value);
  }
  return "";
}

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Unsigned refusal, or the disclosure read. Never a credit pull. */
export function approveReadShape(status, body) {
  if (!body || typeof body !== "object") return false;
  if (status === 200) {
    return body.ok === true
      && body.kind === READ_KIND
      && body.disclosure != null
      && typeof body.disclosure === "object"
      && body.pricing != null
      && typeof body.pricing === "object";
  }
  if (status === 400 || status === 401) {
    return body.ok === false && typeof body.error === "string" && body.error.length > 0;
  }
  return false;
}

async function readGet(fetchImpl, url, accept) {
  const init = {
    method: "GET",
    credentials: "omit",
    headers: { accept }
  };
  // A door that never answers must not hold up the whole morning pulse.
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }
  const res = await fetchImpl(url, init);
  const text = await bodyText(res);
  return { status: httpStatus(res), text };
}

export async function checkApprovePage({ fetchImpl, baseUrl = DEFAULT_BASE_URL } = {}) {
  const id = "soft-pull:approve-page";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch in this run — approve screen not opened");
  }
  const url = `${originOf(baseUrl)}${APPROVE_PAGE_PATH}`;
  try {
    const { status, text } = await readGet(fetchImpl, url, "text/html");
    if (status === 404 || (status != null && status >= 500)) {
      const extra = text ? `: ${clip(text, 120)}` : "";
      return check(id, "FAIL", `soft-pull approve screen answered ${status}${extra}`, PAGE_FIX);
    }
    if (status === 200 && text.includes(PAGE_MARKER)) {
      return check(id, "PASS", "soft-pull approve screen loaded");
    }
    const why = status === 200 ? "without its read route" : `answered ${status == null ? "nothing" : status}`;
    return check(id, "FAIL", `soft-pull approve screen ${why}`, PAGE_FIX);
  } catch (err) {
    return check(id, "FAIL", `soft-pull approve screen unreachable: ${clip(err && err.message)}`, PAGE_FIX);
  }
}

export async function checkApproveRead({ fetchImpl, baseUrl = DEFAULT_BASE_URL } = {}) {
  const id = "soft-pull:approve-read";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch in this run — approve read API not opened");
  }
  const url = `${originOf(baseUrl)}${APPROVE_READ_PATH}`;
  try {
    const { status, text } = await readGet(fetchImpl, url, "application/json");
    if (status === 404 || (status != null && status >= 500)) {
      const extra = text ? `: ${clip(text, 120)}` : "";
      return check(id, "FAIL", `soft-pull read API answered ${status}${extra}`, READ_FIX);
    }
    const body = parseJson(text);
    if (approveReadShape(status, body)) {
      const shape = status === 200 ? "approval read shape" : "unsigned link shape";
      return check(id, "PASS", `soft-pull read API answered ${status} with the ${shape}`);
    }
    return check(
      id,
      "FAIL",
      `soft-pull read API answered ${status == null ? "nothing" : status} but the body was not the approval read shape`,
      READ_FIX
    );
  } catch (err) {
    return check(id, "FAIL", `soft-pull read API unreachable: ${clip(err && err.message)}`, READ_FIX);
  }
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

/** The word and the price the approve screen paints. Names and contact stay out. */
export function signedReadShape(status, body) {
  if (status !== 200 || !body || typeof body !== "object") return false;
  const text = body.disclosure && typeof body.disclosure === "object" ? body.disclosure.text : null;
  const base = body.pricing && typeof body.pricing === "object" ? Number(body.pricing.base_cents) : NaN;
  return body.ok === true
    && body.kind === READ_KIND
    && typeof text === "string" && text.trim().length > 0
    && Number.isFinite(base) && base > 0
    && body.consent != null && typeof body.consent === "object"
    && body.contact != null && typeof body.contact === "object";
}

/**
 * The approve read, with a link signed for a real client, run in-process.
 * The signed-out GET only ever sees the first refusal, which is answered before
 * the database or the words are touched. This one gets past it: it signs a link
 * the same way the closer's Present cockpit does, hands it to the real handler
 * with the pulse's database, and checks the 200 has the words and the price.
 * GET only. The handler writes nothing on a GET.
 */
export async function checkApproveSignedRead(ctx = {}) {
  const id = "soft-pull:approve-signed-read";
  const db = ctx.db;
  const orgId = typeof ctx.orgId === "string" ? ctx.orgId.trim() : "";
  if (!db || typeof db.query !== "function") {
    return check(id, "skip", "no database in this run — signed approve read not opened");
  }
  if (!UUID_RE.test(orgId)) {
    return check(id, "skip", "no company in this run — signed approve read not opened");
  }
  const env = ctx.env && typeof ctx.env === "object" ? ctx.env : process.env;

  let secret;
  try {
    secret = secretFromEnv(env);
  } catch {
    return check(
      id,
      "FAIL",
      "approval links cannot be signed: DOCUMENT_URL_SECRET is missing or too short",
      `Set DOCUMENT_URL_SECRET (32 or more characters) on Netlify. ${TRIPWIRE}`
    );
  }

  let clientId;
  try {
    const found = await db.query(CLIENT_PICK_SQL, [orgId]);
    clientId = found && found.rows && found.rows[0] ? found.rows[0].id : null;
  } catch (err) {
    return check(id, "FAIL", `could not pick a client to read: ${clip(err && err.message)}`, READ_FIX);
  }
  if (!clientId) return check(id, "skip", "no real client on file — signed approve read not opened");

  try {
    const handler = typeof ctx.approveHandler === "function"
      ? ctx.approveHandler
      : (await import("../../../api/soft-pull-approve.mjs")).default;
    const signed = signSoftPullApproveUrl({ orgId, clientId, ttlSeconds: 300, secret });
    const query = Object.fromEntries(new URL(signed.path, "https://link.invalid").searchParams);
    const res = mockRes();
    await handler({ method: "GET", headers: {}, query, body: null }, res, { db, env, secret });
    const status = Number(res.statusCode) || 0;
    if (signedReadShape(status, res.body)) {
      return check(id, "PASS", "signed approve read answered 200 with the words, the price and the consent state");
    }
    const code = res.body && typeof res.body.error === "string" ? ` (${clip(res.body.error, 60)})` : "";
    return check(
      id,
      "FAIL",
      `signed approve read answered ${status || "nothing"}${code} and not the approval read shape`,
      READ_FIX
    );
  } catch (err) {
    return check(id, "FAIL", `signed approve read threw: ${clip(err && err.message)}`, READ_FIX);
  }
}

/**
 * Soft-pull approve door. One tripwire, three readings.
 * @param {{ fetchImpl?: Function, fetch?: Function, baseUrl?: string, db?: object, orgId?: string, env?: object }} [ctx]
 * @returns {Promise<Array<{ id: string, status: string, detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = ctx.fetchImpl || ctx.fetch;
  const baseUrl = ctx.baseUrl;
  const [page, read] = await Promise.all([
    checkApprovePage({ fetchImpl, baseUrl }),
    checkApproveRead({ fetchImpl, baseUrl })
  ]);
  return [page, read, await checkApproveSignedRead(ctx)];
}
