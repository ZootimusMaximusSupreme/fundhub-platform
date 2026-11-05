// Short-lived proof that the public homepage saved a complete funding survey.
// It grants only the calendar handoff; unlike the email resume code, it reads
// no saved contact or answers. The two uses share a key but have distinct tags.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { surveyResumeSecret } from "./resume-link.mjs";

export const BOOKING_TICKET_TTL_MS = 10 * 60_000;
const SCHEME = "homepage-survey-booking-v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const TOKEN_BYTES = 4 + NONCE_BYTES + TAG_BYTES;

function clockMs(now) {
  return typeof now === "function" ? Number(now()) : now == null ? Date.now() : Number(now);
}

function tag(payload, key) {
  return createHmac("sha256", key).update(`${SCHEME}|`).update(payload).digest().subarray(0, TAG_BYTES);
}

export function mintBookingTicket({ now, secret, env = process.env, random = randomBytes } = {}) {
  const key = secret ?? surveyResumeSecret(env);
  const expires = Math.floor(clockMs(now) / 1000) + Math.floor(BOOKING_TICKET_TTL_MS / 1000);
  if (!Number.isSafeInteger(expires) || expires <= 0 || expires > 0xffffffff) {
    throw new Error("Booking ticket clock is outside the supported range");
  }
  const nonce = random(NONCE_BYTES);
  if (!Buffer.isBuffer(nonce) || nonce.length !== NONCE_BYTES) throw new Error("Invalid booking ticket nonce");
  const payload = Buffer.alloc(4 + NONCE_BYTES);
  payload.writeUInt32BE(expires, 0);
  nonce.copy(payload, 4);
  return Buffer.concat([payload, tag(payload, key)]).toString("base64url");
}

export function validBookingTicket(token, { now, secret, env = process.env } = {}) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length !== TOKEN_BYTES || bytes.toString("base64url") !== token) return false;
    const payload = bytes.subarray(0, 4 + NONCE_BYTES);
    const expires = payload.readUInt32BE(0);
    const current = Math.floor(clockMs(now) / 1000);
    if (!Number.isSafeInteger(current) || current > expires || expires - current > BOOKING_TICKET_TTL_MS / 1000) return false;
    const key = secret ?? surveyResumeSecret(env);
    return timingSafeEqual(bytes.subarray(payload.length), tag(payload, key));
  } catch {
    return false;
  }
}
