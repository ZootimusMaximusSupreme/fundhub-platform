// A film link for the teleprompter. The Shoot tab (signed in) mints it.
// The phone opens /app/teleprompter.html?k=<token> and never sees a login page.
//
// The token is not a staff session. It cannot open the CRM. It can read that
// one shoot, mark takes on it, and save a script edit for a script on it,
// until it expires or the shoot is closed.
//
// Same shape as src/contracts/signed-link.mjs: HMAC, a clock, fail closed
// when there is no secret. Scheme "f1" so a document link or a contract link
// signed with the same secret can never pass as a film link.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SCHEME = "f1";
/**
 * Ten years: for Chris this link does not expire (owner call 2026-10-10: "why are you sending
 * expiring links"). Closing the shoot still kills it, and a new secret kills every old one.
 */
export const FILM_TTL_SECONDS = 60 * 60 * 24 * 365 * 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FILM_LINK_CLOSED =
  "That film link did not open. Open the teleprompter from the Shoot tab again.";

export function secretFromEnv(env = process.env) {
  const secret = env.FILM_URL_SECRET || env.DOCUMENT_URL_SECRET;
  if (!secret || String(secret).length < 32) {
    throw new Error(
      "FILM_URL_SECRET is missing or too short (need >= 32 chars). DOCUMENT_URL_SECRET is the fallback."
    );
  }
  return String(secret);
}

function sign(secret, orgId, shootId, exp) {
  return createHmac("sha256", secret).update([SCHEME, orgId, shootId, exp].join("|")).digest("hex");
}

/**
 * Mint the key the Shoot tab puts on the teleprompter link.
 * @returns {{ token: string, expiresAt: number, expiresAtIso: string, path: string }}
 */
export function mintFilmKey({ orgId, shootId, ttlSeconds = FILM_TTL_SECONDS, secret, now = Date.now } = {}) {
  if (!UUID.test(String(orgId || "")) || !UUID.test(String(shootId || ""))) {
    throw new Error("mintFilmKey needs an org id and a shoot id");
  }
  const key = secret ?? secretFromEnv();
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > FILM_TTL_SECONDS) {
    throw new Error("ttlSeconds must be from 1 second up to 10 years");
  }
  const exp = Math.floor(now() / 1000) + Math.floor(ttl);
  const sig = sign(key, orgId, shootId, String(exp));
  const token = `${orgId}.${shootId}.${exp}.${sig}`;
  return {
    token,
    expiresAt: exp,
    expiresAtIso: new Date(exp * 1000).toISOString(),
    path: "/app/teleprompter.html?k=" + token
  };
}

/** The shoot this key names, or null when it is missing, expired, or forged. */
export function readFilmKey(token, { secret, now = Date.now } = {}) {
  try {
    const key = secret ?? secretFromEnv();
    const parts = String(token || "").split(".");
    if (parts.length !== 4) return null;
    const [orgId, shootId, exp, sig] = parts;
    if (!UUID.test(orgId) || !UUID.test(shootId) || !/^[0-9]{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return null;
    if (Number(exp) * 1000 <= now()) return null;
    const expect = sign(key, orgId, shootId, exp);
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { orgId, shootId, expiresAt: Number(exp) };
  } catch {
    return null;
  }
}

export function filmTokenFromReq(req) {
  const h = req?.headers || {};
  for (const name of Object.keys(h)) {
    if (String(name).toLowerCase() !== "x-shoot-film") continue;
    const v = h[name];
    if (Array.isArray(v)) return String(v[0] || "").trim();
    return typeof v === "string" ? v.trim() : "";
  }
  return "";
}

/**
 * A valid film key, null when the request has none, or { bad: true } when
 * a key was sent and it does not verify. A bad key must not fall through
 * to the open read.
 */
export function filmFromReq(req, { filmSecret, env = process.env, now = Date.now } = {}) {
  const raw = filmTokenFromReq(req);
  if (!raw) return null;
  let secret = filmSecret;
  if (!secret) {
    try { secret = secretFromEnv(env); } catch { return { bad: true }; }
  }
  const clock = typeof now === "function" ? now : () => new Date(now).getTime();
  return readFilmKey(raw, { secret, now: clock }) || { bad: true };
}
