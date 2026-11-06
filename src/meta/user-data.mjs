// Meta Conversions API — the `user_data` half of a server event.
//
// Contract: the "Phase 4 contract" section of docs/tracking/meta-events.md.
//
// What Meta gets about a person, and how:
//   * em / ph — SHA-256 hex of the email (lowercased, trimmed) and of the phone
//     (digits only, no leading zeros; a 10-digit US number gets a leading 1).
//     NEVER the raw value.
//     Only a directly collected, same-session public contact may be matched.
//   * client_ip_address / client_user_agent — from the request headers.
//   * fbp — the Meta browser cookie with a numeric random part.
// The original click ID can carry arbitrary URL text; it stays in first-party tracking.
//
// Never sent: card numbers, Social Security number, date of birth, survey
// answers about income or credit, soft-pull field values, raw email or phone.

import crypto from "node:crypto";
import { isIP } from "node:net";

/** SHA-256 hex. */
export function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

const HASHED = /^[a-f0-9]{64}$/;
/** True for a SHA-256 hex string — the only shape em / ph / external_id may take. */
export const isHashed = (v) => typeof v === "string" && HASHED.test(v);

/** Lowercased, trimmed email, or "" when it is not an email. */
export function normalizeEmail(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

/**
 * Meta's phone rule ("Customer Information Parameters", developers.facebook.com):
 * remove symbols, letters and any leading zeros; include the country code.
 * So: digits only, leading zeros dropped ("0044 20…" → "4420…"), and a
 * 10-digit US number gets its leading 1. "" when too short to be a phone.
 */
export function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D+/g, "").replace(/^0+/, "");
  if (digits.length < 7 || digits.length > 15) return "";
  return digits.length === 10 ? `1${digits}` : digits;
}

export function hashEmail(raw) {
  const e = normalizeEmail(raw);
  return e ? sha256(e) : null;
}

export function hashPhone(raw) {
  const p = normalizePhone(raw);
  return p ? sha256(p) : null;
}

// fbc = "fb.<subdomain index>.<ms>.<fbclid>", fbp = "fb.<subdomain index>.<ms>.<random>".
// Same shape public/funnel/fh-events.js accepts (FB_COOKIE).
const FBC = /^fb\.[0-9]\.\d{10,16}\.[A-Za-z0-9_.-]{1,500}$/;
const FBP = /^fb\.[0-9]\.\d{10,16}\.[A-Za-z0-9_.-]{1,100}$/;
const OUTBOUND_FBP = /^fb\.[0-9]\.\d{13}\.\d{8,10}$/;

/** The fbc value when it has Meta's shape, else null. */
export function cleanFbc(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length <= 540 && FBC.test(s) ? s : null;
}

/** The fbp value when it has Meta's shape, else null. */
export function cleanFbp(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length <= 130 && FBP.test(s) ? s : null;
}

// Preserve old first-party attribution via cleanFbp, but do not pass
// free-text labels or short numeric fields to the external recipient.
export function outboundFbp(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  return OUTBOUND_FBP.test(s) ? s : null;
}

/** A real IPv4 / IPv6 address (port and brackets stripped), else null. */
export function cleanIp(raw) {
  let s = String(raw ?? "").split(",")[0].trim();
  if (!s) return null;
  if (s.startsWith("[")) s = s.slice(1, s.indexOf("]") > 0 ? s.indexOf("]") : undefined);
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.split(":")[0];
  return isIP(s) ? s : null;
}

/**
 * The client's IP from request headers: x-nf-client-connection-ip, else the
 * first x-forwarded-for hop, else the socket address the adapter resolved.
 */
export function clientIpFrom(req) {
  const h = req?.headers || {};
  const pick = (name) => h[name] || h[name.toLowerCase()] || "";
  return cleanIp(pick("x-nf-client-connection-ip"))
    || cleanIp(String(pick("x-forwarded-for")).split(",")[0])
    || cleanIp(req?.socket?.remoteAddress)
    || null;
}

/**
 * user_data for one server event. Only keys with a value are present; em and
 * ph are arrays of SHA-256 hex, never the raw value.
 */
export function buildUserData({ email, phone, ip, userAgent, fbp } = {}) {
  const out = {};
  const ipClean = cleanIp(ip);
  if (ipClean) out.client_ip_address = ipClean;
  const ua = String(userAgent ?? "").trim().slice(0, 512);
  if (ua) out.client_user_agent = ua;
  const p = outboundFbp(fbp);
  if (p) out.fbp = p;
  const em = hashEmail(email);
  if (em) out.em = [em];
  const ph = hashPhone(phone);
  if (ph) out.ph = [ph];
  return out;
}
