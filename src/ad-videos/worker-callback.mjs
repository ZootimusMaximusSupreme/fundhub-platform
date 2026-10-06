// @ts-check
// src/ad-videos/worker-callback.mjs — the signature on a video-worker callback.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §9.5: when the video worker
// (video-worker/, on Render) finishes a job it calls Netlify back. That callback
// is "HMAC-signed over the timestamp plus the body, with a 5-minute window", and
// it lands on a `provider === 'video-worker'` branch in src/http/router.mjs, not
// in ROUTES. That branch is not built yet (it needs §16.4: Render and R2). This
// file is the part of it that can be built and proved now: pure, no database,
// no network, node:crypto only.
//
// THE SHAPE
//   signature = hex( HMAC-SHA256( secret, "<ts>.<raw body>" ) )
//   ts        = Unix time in whole seconds, as text
//   headers   = X-Fundhub-Video-Timestamp: <ts>
//               X-Fundhub-Video-Signature: <signature>
//   secret    = VIDEO_WORKER_CALLBACK_SECRET (Appendix D), at least 32 characters
//
// Same construction as the Resend/Svix check in src/adapters/resend-events.mjs
// (`<id>.<ts>.<body>`, 5-minute window) minus the message id, because a worker
// job already carries its own id inside the body (`<id>:<type>:<cut_version>`).
//
// WHY THE TIMESTAMP IS SIGNED. Without it a signature is good forever, so a
// callback copied off the wire could be posted again a week later to move a row
// that has since moved on. With it, a copy is dead after 5 minutes. The handler
// still re-reads the row's state before it acts (§9.5), which covers a replay
// inside the window.
//
// WHY THE RAW BODY. Sign and check the exact bytes that crossed the wire. A body
// parsed to JSON and stringified again can come back with different spacing or
// key order, and then a good callback fails.

import { createHmac, timingSafeEqual } from "node:crypto";

export const CALLBACK_TIMESTAMP_HEADER = "x-fundhub-video-timestamp";
export const CALLBACK_SIGNATURE_HEADER = "x-fundhub-video-signature";

/** Spec §9.5: a 5-minute window, either side of now. */
export const CALLBACK_WINDOW_SECONDS = 300;

/* A shorter secret is guessable offline from one captured callback. 32
   characters is 16 random bytes in hex at the very least; `openssl rand -hex 32`
   gives 64. */
export const MIN_SECRET_LENGTH = 32;

/* Same masked-key rule as src/adapters/oxylabs.mjs isMaskedSecret(): four or
   more asterisks is a dashboard mask copied in place of the value. */
const MASKED_RE = /\*{4,}/;

const SIGNATURE_RE = /^[0-9a-f]{64}$/i;
const TIMESTAMP_RE = /^\d{1,12}$/;

/* Anything above this is a millisecond clock passed by mistake (it is the year
   2286 in seconds). */
const MAX_TS_SECONDS = 9_999_999_999;

export class WorkerCallbackError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "WorkerCallbackError";
    this.code = code;
  }
}

/**
 * Why a secret cannot be used, in plain words, or null when it can.
 *
 * @param {unknown} secret
 * @returns {string | null}
 */
function secretProblem(secret) {
  if (typeof secret !== "string" || secret === "") return "no callback secret is set";
  if (MASKED_RE.test(secret)) return "the callback secret is a masked copy, not the real secret";
  if (secret.length < MIN_SECRET_LENGTH) {
    return `the callback secret is too short (under ${MIN_SECRET_LENGTH} characters)`;
  }
  return null;
}

/**
 * @param {string | Uint8Array} body
 * @param {string} tsText
 * @param {string} secret
 * @returns {Buffer}
 */
function digest(body, tsText, secret) {
  const mac = createHmac("sha256", secret);
  mac.update(`${tsText}.`, "utf8");
  if (typeof body === "string") mac.update(body, "utf8");
  else mac.update(body);
  return mac.digest();
}

/**
 * Sign a callback body. The worker sends the result as
 * X-Fundhub-Video-Signature and `ts` as X-Fundhub-Video-Timestamp.
 *
 * @param {string | Uint8Array} body  the exact bytes that will be sent
 * @param {number | string} ts        Unix time in whole seconds
 * @param {string} secret             VIDEO_WORKER_CALLBACK_SECRET
 * @returns {string} 64 lowercase hex characters
 */
export function signCallback(body, ts, secret) {
  if (typeof body !== "string" && !(body instanceof Uint8Array)) {
    throw new WorkerCallbackError(
      "bad_body",
      "Worker callback: sign the raw body text, not an object. Stringify it once and send those same bytes."
    );
  }
  const tsText = typeof ts === "number" ? String(ts) : String(ts ?? "");
  if (!/^\d+$/.test(tsText)) {
    throw new WorkerCallbackError("bad_timestamp", "Worker callback: the timestamp must be whole seconds.");
  }
  if (Number(tsText) > MAX_TS_SECONDS) {
    throw new WorkerCallbackError(
      "bad_timestamp",
      "Worker callback: the timestamp looks like milliseconds. Send whole seconds."
    );
  }
  const problem = secretProblem(secret);
  if (problem) throw new WorkerCallbackError("bad_secret", `Worker callback: ${problem}.`);
  return digest(body, tsText, secret).toString("hex");
}

/**
 * One header, by name, from a plain object (any letter case, array values take
 * the first) or a fetch Headers object.
 *
 * @param {unknown} headers
 * @param {string} name
 * @returns {string | null}
 */
function readHeader(headers, name) {
  if (!headers || typeof headers !== "object") return null;
  const h = /** @type {any} */ (headers);
  let value;
  if (typeof h.get === "function") {
    value = h.get(name);
  } else {
    const want = name.toLowerCase();
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === want) { value = h[k]; break; }
    }
  }
  if (Array.isArray(value)) value = value[0];
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * @param {unknown} now
 * @returns {number} milliseconds
 */
function nowMs(now) {
  const v = typeof now === "function" ? now() : now;
  if (v === undefined || v === null) return Date.now();
  if (v instanceof Date) return v.getTime();
  return Number(v);
}

/**
 * Check a callback before anything acts on it.
 *
 * @param {{
 *   headers: unknown,
 *   rawBody: string | Uint8Array | null | undefined,
 *   secret: string | null | undefined,
 *   now?: number | Date | (() => number | Date),
 * }} opts  now is milliseconds, a Date, or a function returning either;
 *          it defaults to the current time.
 * @returns {{ ok: boolean, reason: string | null }} reason is plain words when ok is false
 */
export function verifyCallback(opts) {
  const { headers, rawBody, secret, now } = opts || /** @type {any} */ ({});

  // Checked first: with no usable secret nothing can be trusted, whatever came in.
  const problem = secretProblem(secret);
  if (problem) return fail(problem);

  if (rawBody == null) return fail("the callback has no body");
  if (typeof rawBody !== "string" && !(rawBody instanceof Uint8Array)) {
    return fail("the callback body is not raw text");
  }

  const tsText = readHeader(headers, CALLBACK_TIMESTAMP_HEADER);
  if (!tsText) return fail("the timestamp header is missing");
  const sigText = readHeader(headers, CALLBACK_SIGNATURE_HEADER);
  if (!sigText) return fail("the signature header is missing");

  if (!TIMESTAMP_RE.test(tsText)) return fail("the timestamp is not whole seconds");

  const nowSeconds = Math.floor(nowMs(now) / 1000);
  if (!Number.isFinite(nowSeconds)) return fail("the clock time to check against is not a number");
  const age = nowSeconds - Number(tsText);
  if (age > CALLBACK_WINDOW_SECONDS) return fail("the timestamp is more than 5 minutes old");
  if (age < -CALLBACK_WINDOW_SECONDS) return fail("the timestamp is more than 5 minutes in the future");

  if (!SIGNATURE_RE.test(sigText)) return fail("the signature is not 64 hex characters");

  const expected = digest(rawBody, tsText, /** @type {string} */ (secret));
  const given = Buffer.from(sigText, "hex");
  // Both are 32 bytes here (the regex above pins the length), so the compare
  // takes the same time whether the first byte or the last one differs.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return fail("the signature does not match (the body was changed, or the secret is wrong)");
  }
  return { ok: true, reason: null };
}

/**
 * @param {string} reason
 * @returns {{ ok: false, reason: string }}
 */
function fail(reason) {
  return { ok: false, reason };
}
