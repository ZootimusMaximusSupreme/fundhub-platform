// The secret code on the morning and evening report link.
//
// WHY. Chris reads the brief text on his phone and taps "Full report". He asked
// for no login on that page. The report holds company numbers, so the page is
// not open to the whole internet either: the link carries a long code, and only
// the exact link opens that one report.
//
//   https://fundhub.ai/app/morning-brief.html?date=YYYY-MM-DD[&kind=evening]&k=<code>
//
// THE CODE. k = base64url(HMAC_SHA256(BRIEF_LINK_SECRET,
//                 "brief-v1|" + orgId + "|" + kind + "|" + date)), first 32 characters.
// The "brief-v1" prefix means a code made for any other link with the same
// secret can never pass here. One code opens one org, one kind, one day.
//
// HOW LONG. A code works for a Phoenix date up to 14 days old, never a future
// date. After that the link says it is not valid.
//
// NO SECRET, NO LINK. BRIEF_LINK_SECRET missing, shorter than 32 characters, or a
// Netlify mask (starts with *) means no code can be made and none can pass.
// Nothing here throws: the morning text must still go out without a link.
//
// Never print or log a code or the secret.
//
// This file has no imports from morning-brief.mjs on purpose: morning-brief.mjs
// imports this one, and a loop between the two would be fragile.

import { createHmac, timingSafeEqual } from "node:crypto";

export const BRIEF_PAGE_PATH = "/app/morning-brief.html";
export const BRIEF_LINK_SECRET_ENV = "BRIEF_LINK_SECRET";
export const BRIEF_LINK_SCHEME = "brief-v1";
export const BRIEF_TOKEN_LENGTH = 32;
export const BRIEF_LINK_MAX_AGE_DAYS = 14;
export const DEFAULT_BASE_URL = "https://fundhub.ai";

const KINDS = Object.freeze(["morning", "evening"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
// Arizona does not change its clocks, so Phoenix is always UTC-7.
const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The usable secret, or null. Never throws. */
function secretFrom(env) {
  try {
    const raw = env ? env[BRIEF_LINK_SECRET_ENV] : undefined;
    if (typeof raw !== "string") return null;
    if (raw.length < 32 || raw.startsWith("*")) return null;
    return raw;
  } catch {
    return null;
  }
}

/** True when a link code can be made and checked. Says nothing about the value. */
export function briefLinkConfigured(env = process.env) {
  return secretFrom(env) != null;
}

function normKind(kind) {
  if (kind == null || kind === "") return "morning";
  return typeof kind === "string" && KINDS.includes(kind) ? kind : null;
}

function validDate(date) {
  if (typeof date !== "string" || !DATE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

function validOrg(orgId) {
  return typeof orgId === "string" && UUID.test(orgId);
}

function phoenixToday(now) {
  const ms = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.now();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - PHOENIX_OFFSET_MS).toISOString().slice(0, 10);
}

/** True when date is today in Phoenix or up to 14 days before it. */
export function briefDateInWindow(date, now = new Date()) {
  if (!validDate(date)) return false;
  const today = phoenixToday(now);
  if (!today) return false;
  const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
  return age >= 0 && age <= BRIEF_LINK_MAX_AGE_DAYS;
}

function mac(secret, orgId, kind, date) {
  return createHmac("sha256", secret)
    .update(`${BRIEF_LINK_SCHEME}|${orgId}|${kind}|${date}`)
    .digest("base64url")
    .slice(0, BRIEF_TOKEN_LENGTH);
}

/** The code for one org, kind and day, or null when it cannot be made. */
export function signBriefToken({ orgId, kind, date, env = process.env } = {}) {
  const secret = secretFrom(env);
  const k = normKind(kind);
  if (!secret || !k || !validOrg(orgId) || !validDate(date)) return null;
  return mac(secret, orgId, k, date);
}

/**
 * The cheap checks that need no database: a usable secret, a code of the right
 * shape, a real kind, and a date inside the 14-day window. The public route runs
 * this first so a junk request never touches the database.
 */
export function briefRequestPlausible({ kind, date, token, env = process.env, now = new Date() } = {}) {
  if (!secretFrom(env)) return false;
  if (typeof token !== "string" || !TOKEN.test(token)) return false;
  if (!normKind(kind)) return false;
  return briefDateInWindow(date, now);
}

/** True only for the exact code made for this org, kind and day, inside the window. */
export function verifyBriefToken({ orgId, kind, date, token, env = process.env, now = new Date() } = {}) {
  try {
    if (!briefRequestPlausible({ kind, date, token, env, now })) return false;
    const expected = signBriefToken({ orgId, kind, date, env });
    if (!expected) return false;
    const a = Buffer.from(token, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** The full report link with its code, or null when no code can be made. Never throws. */
export function briefUrl({ orgId, kind, date, env = process.env, baseUrl } = {}) {
  try {
    const token = signBriefToken({ orgId, kind, date, env });
    if (!token) return null;
    const k = normKind(kind);
    const base = String(baseUrl || env?.APP_BASE_URL || env?.URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
    const tail = k === "evening" ? "&kind=evening" : "";
    return `${base}${BRIEF_PAGE_PATH}?date=${date}${tail}&k=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}
