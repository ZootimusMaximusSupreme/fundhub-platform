// @ts-check
// src/storage/r2-sign.mjs — signed links for Fundhub's private Cloudflare R2
// buckets, and the one place the finished-ad key layout is written down.
//
// WHAT THIS IS FOR (spec docs/specs/marketing-machine-2026-10-04.md)
//   §9.5  Videos live in the private bucket `fundhub-ad-video`. Submagic and Meta
//         get signed GET links that last 24 hours. The video worker gets signed
//         PUT links to save what it builds.
//   §9.1 step 11 / §9.4  The finished ad lands at
//         partners/<house partner id>/ad-video/final/<ad>-r<round>.mp4
//   §12.1 The funnel videos move to the `fundhub-media` bucket; a signed PUT is
//         how a script puts each file there without the AWS SDK.
//
// PURE ON PURPOSE. This file builds a string. It never opens a connection, never
// reads process.env and never reads a file. The caller passes the account, the
// bucket and the key pair (Appendix D names: CLOUDFLARE_ACCOUNT_ID,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_AD_VIDEO, R2_BUCKET_MEDIA).
// node:crypto is the only import. Signing a link is not sending anything, so
// the outbound fence (src/lib/outbound-fetch.mjs) has nothing to fence here.
//
// THE ALGORITHM is AWS Signature Version 4, query-string form ("presigned URL"),
// exactly as AWS documents it in "Authenticating Requests: Using Query
// Parameters (AWS Signature Version 4)":
//   https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
// r2-sign.test.mjs reproduces that page's worked example byte for byte.
//
// R2 SPECIFICS (Cloudflare, "Presigned URLs",
//   https://developers.cloudflare.com/r2/api/s3/presigned-urls/):
//   - host is <ACCOUNT_ID>.r2.cloudflarestorage.com, the S3 API domain. Signed
//     links do not work on a custom domain such as media.fundhub.ai.
//   - region is "auto" ("Required by SDK but not used by R2").
//   - path style: /<bucket>/<key>, the same shape `aws s3 presign` prints there.
//   - expiry is 1 second to 7 days (604,800 seconds).
//   - GET, PUT, HEAD (and DELETE) are signable. DELETE is left out here on
//     purpose: nothing in this build deletes a video, and deleting data needs
//     Chris's OK first (CLAUDE.md §11).
//
// A signed GET link answers 403 to a HEAD request (spec §9.5), because the
// method is part of what is signed. Sign HEAD separately when a HEAD is needed.

import { createHash, createHmac } from "node:crypto";

export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";
export const R2_REGION = "auto";
export const S3_SERVICE = "s3";

/** AWS and Cloudflare both cap a presigned link at seven days. */
export const MAX_EXPIRES_SEC = 604800;

/** Spec §9.5: Submagic and Meta get links that last 24 hours. */
export const DEFAULT_EXPIRES_SEC = 86400;

export const SIGNABLE_METHODS = Object.freeze(["GET", "PUT", "HEAD"]);

const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

/* Cloudflare account ids are 32 hex characters. Checked strictly because the id
   becomes part of the host name: anything looser could point a signed link at
   somebody else's server. Lowercased before use, because an HTTP client sends
   the host in lowercase and the host is part of the signature. */
const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/i;

/* R2 bucket names: 3-63 characters, lowercase letters, digits and hyphens, not
   starting or ending with a hyphen. `fundhub-ad-video` and `fundhub-media`
   both fit. */
const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/* An access key id goes into X-Amz-Credential between slashes, so it must not
   carry one. R2 key ids are 32 hex characters; AWS ids are 16-128 letters and
   digits (AWS's own example is AKIAIOSFODNN7EXAMPLE). */
const ACCESS_KEY_ID_RE = /^[A-Za-z0-9]{16,128}$/;

const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const REGION_RE = /^[a-z0-9-]{1,64}$/;
const SERVICE_RE = /^[a-z0-9-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* S3's object key limit is 1,024 bytes of UTF-8. */
const MAX_KEY_BYTES = 1024;

/* A MASKED KEY IS NOT A KEY. Same rule as isMaskedSecret() in
   src/adapters/oxylabs.mjs and the masked OpenAI key in src/agents/model.mjs:
   a run of four asterisks is the hidden form a dashboard shows, copied in place
   of the value. Signing with it makes a link that answers 403 with no clue why.
   Not imported from oxylabs.mjs, because that module loads node:http and this
   one promises to load nothing but node:crypto. */
const MASKED_RE = /\*{4,}/;

/* Control characters and lone UTF-16 surrogates. A lone surrogate turns into
   U+FFFD when it is encoded, so the link would point at a different key than
   the one asked for. */
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export class R2SignError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "R2SignError";
    this.code = code;
  }
}

/**
 * AWS's UriEncode(). Every byte of the UTF-8 form is percent-encoded except the
 * unreserved characters A-Z a-z 0-9 - . _ ~. A space is %20, never +. Hex is
 * uppercase. The slash is kept only when `keepSlash` is set, which AWS asks for
 * in the object key name and nowhere else.
 *
 * Written out by hand because AWS says to: encodeURIComponent leaves ! ' ( ) *
 * alone, and S3 would then compute a different signature from ours.
 *
 * @param {string} value
 * @param {boolean} [keepSlash]
 * @returns {string}
 */
export function uriEncode(value, keepSlash = false) {
  let out = "";
  for (const byte of Buffer.from(String(value), "utf8")) {
    const isUnreserved =
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || byte === 0x2e || byte === 0x5f || byte === 0x7e; // - . _ ~
    if (isUnreserved || (keepSlash && byte === 0x2f)) out += String.fromCharCode(byte);
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/**
 * @param {Date | number | undefined} now
 * @returns {{ amzDate: string, dateStamp: string }}
 */
function amzDates(now) {
  const when = now === undefined ? new Date() : now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(when.getTime())) {
    throw new R2SignError("bad_time", "R2 link: the signing time is not a real date.");
  }
  // 2013-05-24T00:00:00.000Z → 20130524T000000Z
  const amzDate = when.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * @param {unknown} expiresSec
 * @returns {number}
 */
function checkExpiry(expiresSec) {
  const n = expiresSec === undefined ? DEFAULT_EXPIRES_SEC : expiresSec;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new R2SignError("bad_expiry", "R2 link: the expiry must be a whole number of seconds.");
  }
  if (n < 1) {
    throw new R2SignError("bad_expiry", "R2 link: the expiry must be at least 1 second.");
  }
  if (n > MAX_EXPIRES_SEC) {
    throw new R2SignError(
      "expiry_too_long",
      `R2 link: the expiry is over 7 days (${MAX_EXPIRES_SEC} seconds), the most a signed link can last.`
    );
  }
  return n;
}

/**
 * @param {unknown} method
 * @returns {string}
 */
function checkMethod(method) {
  const m = String(method ?? "").toUpperCase();
  if (!SIGNABLE_METHODS.includes(m)) {
    throw new R2SignError("bad_method", `R2 link: the method must be one of ${SIGNABLE_METHODS.join(", ")}.`);
  }
  return m;
}

/**
 * @param {unknown} accessKeyId
 * @param {unknown} secretAccessKey
 */
function checkKeyPair(accessKeyId, secretAccessKey) {
  if (typeof accessKeyId !== "string" || accessKeyId === "") {
    throw new R2SignError("no_access_key_id", "R2 link: no access key id was given.");
  }
  if (MASKED_RE.test(accessKeyId)) {
    throw new R2SignError("masked_access_key_id", "R2 link: the access key id is a masked copy, not the real one.");
  }
  if (!ACCESS_KEY_ID_RE.test(accessKeyId)) {
    throw new R2SignError("bad_access_key_id", "R2 link: the access key id must be 16 to 128 letters and digits.");
  }
  if (typeof secretAccessKey !== "string" || secretAccessKey === "") {
    throw new R2SignError("no_secret", "R2 link: no secret access key was given.");
  }
  if (MASKED_RE.test(secretAccessKey)) {
    throw new R2SignError("masked_secret", "R2 link: the secret access key is a masked copy, not the real one.");
  }
}

/**
 * @param {Buffer | string} key
 * @param {string} data
 * @returns {Buffer}
 */
function hmac(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Signature Version 4, query-string form, for any S3-compatible host.
 * presignR2() is the one the app should call; this is exported so the test can
 * run AWS's own worked example through the exact same code.
 *
 * `objectPath` is the path BEFORE encoding and must start with "/". Each byte is
 * encoded with uriEncode(), slashes kept.
 *
 * @param {{
 *   method: string,
 *   host: string,
 *   objectPath: string,
 *   region: string,
 *   service?: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   expiresSec?: number,
 *   now?: Date | number,
 * }} opts
 * @returns {{ url: string, canonicalRequest: string, stringToSign: string, signature: string }}
 */
export function presignV4(opts) {
  const {
    method, host, objectPath, region, service = S3_SERVICE,
    accessKeyId, secretAccessKey, expiresSec, now
  } = opts || /** @type {any} */ ({});

  const verb = checkMethod(method);
  if (typeof host !== "string" || !HOST_RE.test(host)) {
    throw new R2SignError("bad_host", "R2 link: the host must be a lowercase host name.");
  }
  if (typeof objectPath !== "string" || !objectPath.startsWith("/")) {
    throw new R2SignError("bad_path", "R2 link: the path must start with a slash.");
  }
  if (typeof region !== "string" || !REGION_RE.test(region)) {
    throw new R2SignError("bad_region", "R2 link: the region is not a region name.");
  }
  if (typeof service !== "string" || !SERVICE_RE.test(service)) {
    throw new R2SignError("bad_service", "R2 link: the service is not a service name.");
  }
  checkKeyPair(accessKeyId, secretAccessKey);
  const expires = checkExpiry(expiresSec);
  const { amzDate, dateStamp } = amzDates(now);

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = uriEncode(objectPath, true);

  /** @type {Array<[string, string]>} */
  const params = [
    ["X-Amz-Algorithm", SIGV4_ALGORITHM],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"]
  ];
  // Sorted by encoded name, byte order, as AWS's canonical query string asks.
  const canonicalQuery = params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    verb,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    UNSIGNED_PAYLOAD
  ].join("\n");

  const stringToSign = [
    SIGV4_ALGORITHM,
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex")
  ].join("\n");

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const url = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return { url, canonicalRequest, stringToSign, signature };
}

/**
 * @param {unknown} key
 * @returns {string}
 */
function checkObjectKey(key) {
  if (typeof key !== "string" || key === "") {
    throw new R2SignError("no_key", "R2 link: no object key was given.");
  }
  if (key.startsWith("/")) {
    throw new R2SignError("bad_key", "R2 link: the object key must not start with a slash.");
  }
  if (CONTROL_RE.test(key) || LONE_SURROGATE_RE.test(key)) {
    throw new R2SignError("bad_key", "R2 link: the object key has a character that cannot be sent.");
  }
  /* "." and ".." are left alone by uriEncode (they are unreserved), and every
     HTTP client folds them away before it sends the request. The client would
     then ask for a different key than the one that was signed — or, worse, a
     key outside the folder the caller meant. Refused outright. */
  if (key.split("/").some((part) => part === "." || part === "..")) {
    throw new R2SignError("bad_key", "R2 link: the object key must not contain a . or .. folder.");
  }
  if (Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES) {
    throw new R2SignError("bad_key", `R2 link: the object key is over ${MAX_KEY_BYTES} bytes.`);
  }
  return key;
}

/**
 * A signed link to one object in an R2 bucket. Pure: no network, no env reads.
 *
 * @param {{
 *   method: 'GET' | 'PUT' | 'HEAD',
 *   accountId: string,
 *   bucket: string,
 *   key: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   expiresSec?: number,
 *   now?: Date | number,
 * }} opts  expiresSec defaults to 86,400 (24 hours, spec §9.5) and is refused
 *          above 604,800 (7 days). now defaults to the current time.
 * @returns {string} the https URL
 */
export function presignR2(opts) {
  const { method, accountId, bucket, key, accessKeyId, secretAccessKey, expiresSec, now } =
    opts || /** @type {any} */ ({});
  if (typeof accountId !== "string" || !ACCOUNT_ID_RE.test(accountId)) {
    throw new R2SignError("bad_account_id", "R2 link: the Cloudflare account id must be 32 hex characters.");
  }
  if (typeof bucket !== "string" || !BUCKET_RE.test(bucket)) {
    throw new R2SignError(
      "bad_bucket",
      "R2 link: the bucket name must be 3 to 63 lowercase letters, digits or hyphens."
    );
  }
  const objectKey = checkObjectKey(key);
  return presignV4({
    method,
    host: r2Host(accountId),
    objectPath: `/${bucket}/${objectKey}`,
    region: R2_REGION,
    service: S3_SERVICE,
    accessKeyId,
    secretAccessKey,
    expiresSec,
    now
  }).url;
}

/**
 * The S3 API host for an account: <account>.r2.cloudflarestorage.com.
 *
 * @param {string} accountId
 * @returns {string}
 */
export function r2Host(accountId) {
  if (typeof accountId !== "string" || !ACCOUNT_ID_RE.test(accountId)) {
    throw new R2SignError("bad_account_id", "R2 link: the Cloudflare account id must be 32 hex characters.");
  }
  return `${accountId.toLowerCase()}.r2.cloudflarestorage.com`;
}

/**
 * Where a finished ad lives in the ad-video bucket (spec §9.1 step 11):
 *   partners/<partner_id>/ad-video/final/<ad>-r<round>.mp4
 *
 * The partner id is the house partner's uuid, lowercased so the key matches
 * `partner_id::text` — creative_assets checks its storage_key with
 * `LIKE 'partners/' || partner_id::text || '/%'` (migration 045). The ad number
 * is written without leading zeros (ads are identified by number; "084" is ad
 * 84). The round is the row's round count, a whole number 0 or more; the caller
 * decides where it starts counting.
 *
 * @param {{ partnerId: string, adNumber: number | string, round: number }} opts
 * @returns {string}
 */
export function finalVideoKey(opts) {
  const { partnerId, adNumber, round } = opts || /** @type {any} */ ({});
  if (typeof partnerId !== "string" || !UUID_RE.test(partnerId)) {
    throw new R2SignError("bad_partner_id", "Final video key: the partner id must be a uuid.");
  }
  const adText = typeof adNumber === "number" ? String(adNumber) : String(adNumber ?? "");
  if (!/^\d{1,9}$/.test(adText) || Number(adText) < 1) {
    throw new R2SignError("bad_ad_number", "Final video key: the ad number must be a whole number, 1 or more.");
  }
  if (typeof round !== "number" || !Number.isInteger(round) || round < 0 || round > 9999) {
    throw new R2SignError("bad_round", "Final video key: the round must be a whole number, 0 or more.");
  }
  return `partners/${partnerId.toLowerCase()}/ad-video/final/${Number(adText)}-r${round}.mp4`;
}
