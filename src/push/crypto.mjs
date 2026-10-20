// Web push cryptography, out of node:crypto and nothing else.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS INSTEAD OF `npm i web-push`
//
// CLAUDE.md §8: "No new dependencies without asking." web-push is a 30-line
// wrapper around two published RFCs plus a fetch; the whole of it is below in
// about the same space its own README takes. What follows is not clever and it
// is not novel — it is RFC 8291 (Message Encryption for Web Push) and RFC 8292
// (VAPID) transcribed, and it is CHECKED AGAINST THE PUBLISHED TEST VECTORS in
// crypto.test.mjs next door. Hand-rolled crypto that has never met a known-good
// vector is not finished, and this repository would rather have no push than
// unverified encryption over a client's phone.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE TWO HALVES, AND THEY DO DIFFERENT JOBS
//
//   1. VAPID (RFC 8292) authenticates US TO THE PUSH SERVICE. A signed JWT that
//      says "the application server at this contact address is sending this".
//      It is not encryption and it protects nothing about the message body.
//
//   2. aes128gcm (RFC 8291 over RFC 8188) encrypts the message TO THE BROWSER.
//      The push service — Apple, Google, Mozilla — relays a blob it cannot
//      read. This is what makes it acceptable to put anything at all in a push
//      payload, and it is why the body never travels in the clear even though
//      the endpoint URL is an ordinary HTTPS POST.
//
// Neither one makes the message private ON ARRIVAL. A decrypted notification
// renders on a locked screen. That is src/push/payload.mjs's problem, not this
// file's, and it is a separate and stricter gate.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE KEY LADDER (RFC 8291 §3.4), because it is easy to get subtly wrong
//
//   ecdh_secret = ECDH(our ephemeral private key, the browser's p256dh)
//   key_info    = "WebPush: info" || 0x00 || ua_public || as_public
//   IKM         = HKDF(salt = auth_secret, ikm = ecdh_secret, key_info, 32)
//   PRK         = HKDF-Extract(salt = the random 16-byte salt, IKM)
//   CEK         = HKDF-Expand(PRK, "Content-Encoding: aes128gcm" || 0x00, 16)
//   NONCE       = HKDF-Expand(PRK, "Content-Encoding: nonce" || 0x00, 12)
//
// A FRESH EPHEMERAL KEYPAIR AND A FRESH SALT PER MESSAGE, ALWAYS. Reusing
// either across two messages to the same subscription reuses the AES-GCM nonce
// under the same key, which is the one failure mode that breaks GCM outright:
// two ciphertexts under one key/nonce pair leak the XOR of the plaintexts and
// the authentication key with them. The only place a caller may pin them is a
// test asserting a published vector, and that is why `salt` and `serverKeys`
// are options rather than parameters — you have to reach for them.

import crypto from "node:crypto";

/* The named curve. P-256 / prime256v1 / secp256r1 are three names for it; Node
   answers to the middle one and the RFCs use the first. */
const CURVE = "prime256v1";

/** RFC 8188 §2: the aes128gcm record structure's fixed sizes. */
export const SALT_BYTES = 16;
export const TAG_BYTES = 16;
export const NONCE_BYTES = 12;
export const CEK_BYTES = 16;
export const DEFAULT_RECORD_SIZE = 4096;

/* Push services reject a body over their own limit; 4096 bytes of ciphertext is
   the smallest limit in the field (and what the RFC's example uses), so the
   plaintext ceiling is that minus the 86-byte header, the 1-byte delimiter and
   the 16-byte tag. A payload over this is a bug in the caller, not something to
   truncate — a half-sent notification is worse than a refused one. */
export const MAX_PAYLOAD_BYTES = DEFAULT_RECORD_SIZE - 86 - 1 - TAG_BYTES;

export class PushCryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = "PushCryptoError";
  }
}

/* ── base64url, both directions ───────────────────────────────────────────
   Node's "base64url" encoding produces unpadded output and its decoder accepts
   both alphabets and both padding states, which is exactly what the wire needs:
   browsers hand back unpadded base64url, and some older ones pad. */
export function b64u(buf) {
  return Buffer.from(buf).toString("base64url");
}
export function unb64u(str) {
  if (str == null) throw new PushCryptoError("expected a base64url string, got nothing");
  return Buffer.from(String(str), "base64url");
}

/* ── HKDF ─────────────────────────────────────────────────────────────────
   crypto.hkdfSync(digest, ikm, salt, info, keylen) does extract-and-expand in
   one call and returns an ArrayBuffer. Wrapped so every call site reads the
   same and so the Buffer conversion happens once. */
function hkdf(salt, ikm, info, length) {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length));
}

/** A fresh ECDH keypair on P-256. One per message — see the header. */
export function newServerKeys() {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  return { ecdh, publicKey: ecdh.getPublicKey(), privateKey: ecdh.getPrivateKey() };
}

/** Rebuild an ECDH context from a stored 32-byte private scalar. */
function ecdhFromPrivate(privateKey) {
  const ecdh = crypto.createECDH(CURVE);
  // setPrivateKey wants exactly 32 bytes; a scalar with a leading zero byte
  // arrives 31 bytes long from some encoders, so it is left-padded here rather
  // than throwing an error nobody can act on.
  const d = Buffer.from(privateKey);
  ecdh.setPrivateKey(d.length === 32 ? d : Buffer.concat([Buffer.alloc(32 - d.length), d]));
  return ecdh;
}

/**
 * deriveContentKeys — the ladder in the header, exported so the vector test can
 * assert every rung rather than only the final ciphertext. A test that can only
 * see the last value cannot say WHICH step is wrong when it disagrees.
 */
export function deriveContentKeys({ ecdhSecret, uaPublic, asPublic, authSecret, salt }) {
  if (!Buffer.isBuffer(ecdhSecret) || ecdhSecret.length !== 32) {
    throw new PushCryptoError("ecdhSecret must be 32 bytes");
  }
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new PushCryptoError("the browser's p256dh must be a 65-byte uncompressed P-256 point");
  }
  if (authSecret.length !== 16) {
    // Every browser sends 16. A different length is a corrupted subscription,
    // and guessing at it would produce keys that silently decrypt to nothing.
    throw new PushCryptoError(`auth secret must be 16 bytes, got ${authSecret.length}`);
  }

  // RFC 8291 §3.4. The two public keys go in RECEIVER FIRST — reversing them
  // produces a valid-looking key that the browser cannot derive.
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    uaPublic,
    asPublic
  ]);
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), CEK_BYTES);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), NONCE_BYTES);
  return { ikm, cek, nonce };
}

/**
 * encryptPayload(plaintext, { p256dh, auth }) → Buffer
 *
 * The complete aes128gcm body, ready to be the request body of the POST to the
 * push service: header (salt ‖ record size ‖ key id length ‖ our public key)
 * followed by one encrypted record.
 *
 * ONE RECORD, ALWAYS. RFC 8188 allows many; a push payload has a hard 4 KB
 * ceiling and no browser has ever needed a second one. Supporting multiple
 * records would add a padding-and-sequence loop with no caller.
 *
 * `salt` and `serverKeys` exist for the RFC vector test. Production must not
 * pass them — see the nonce-reuse note in the header.
 */
export function encryptPayload(plaintext, {
  p256dh,
  auth,
  salt = crypto.randomBytes(SALT_BYTES),
  serverKeys = null,
  recordSize = DEFAULT_RECORD_SIZE
} = {}) {
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), "utf8");
  if (data.length > MAX_PAYLOAD_BYTES) {
    throw new PushCryptoError(
      `push payload is ${data.length} bytes; the limit is ${MAX_PAYLOAD_BYTES}`
    );
  }

  const uaPublic = Buffer.isBuffer(p256dh) ? p256dh : unb64u(p256dh);
  const authSecret = Buffer.isBuffer(auth) ? auth : unb64u(auth);
  const saltBuf = Buffer.isBuffer(salt) ? salt : unb64u(salt);
  if (saltBuf.length !== SALT_BYTES) {
    throw new PushCryptoError(`salt must be ${SALT_BYTES} bytes, got ${saltBuf.length}`);
  }

  const keys = serverKeys || newServerKeys();
  const ecdh = keys.ecdh || ecdhFromPrivate(keys.privateKey);
  const asPublic = keys.publicKey || ecdh.getPublicKey();

  let ecdhSecret;
  try {
    ecdhSecret = ecdh.computeSecret(uaPublic);
  } catch {
    // A p256dh that is not a point on the curve. Opaque on purpose and never
    // echoing the value back: the input is subscriber-supplied.
    throw new PushCryptoError("the browser's p256dh key is not a valid P-256 public key");
  }

  const { cek, nonce } = deriveContentKeys({
    ecdhSecret, uaPublic, asPublic, authSecret, salt: saltBuf
  });

  // RFC 8188 §2: the record is plaintext ‖ delimiter, and 0x02 marks the LAST
  // record. 0x01 here would make every browser wait for a record that never
  // arrives and drop the notification without a word.
  const record = Buffer.concat([data, Buffer.from([0x02])]);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(SALT_BYTES + 4 + 1);
  saltBuf.copy(header, 0);
  header.writeUInt32BE(recordSize, SALT_BYTES);
  header.writeUInt8(asPublic.length, SALT_BYTES + 4);

  return Buffer.concat([header, asPublic, ct]);
}

/**
 * decryptPayload(body, { privateKey, authSecret }) → Buffer
 *
 * THE RECEIVER'S HALF, and it exists for one reason: to prove the sender's half
 * against the published vector. RFC 8291 §5 gives the browser's private key and
 * the expected wire bytes, so decrypting those bytes back to the exact expected
 * plaintext proves BOTH that the vector was transcribed correctly AND that this
 * file's key ladder is right — an AES-GCM tag does not verify by accident.
 *
 * Nothing in the product calls this. It is not dead code to delete: delete it
 * and the vector test loses the half of its evidence that cannot be faked.
 */
export function decryptPayload(body, { privateKey, authSecret } = {}) {
  const buf = Buffer.isBuffer(body) ? body : unb64u(body);
  if (buf.length < SALT_BYTES + 5) throw new PushCryptoError("body is too short to be aes128gcm");

  const salt = buf.subarray(0, SALT_BYTES);
  const idLen = buf.readUInt8(SALT_BYTES + 4);
  const asPublic = buf.subarray(SALT_BYTES + 5, SALT_BYTES + 5 + idLen);
  const ct = buf.subarray(SALT_BYTES + 5 + idLen);
  if (ct.length <= TAG_BYTES) throw new PushCryptoError("body carries no ciphertext");

  const ecdh = ecdhFromPrivate(Buffer.isBuffer(privateKey) ? privateKey : unb64u(privateKey));
  const uaPublic = ecdh.getPublicKey();
  const authBuf = Buffer.isBuffer(authSecret) ? authSecret : unb64u(authSecret);

  const { cek, nonce } = deriveContentKeys({
    ecdhSecret: ecdh.computeSecret(asPublic),
    uaPublic,
    asPublic,
    authSecret: authBuf,
    salt
  });

  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ct.subarray(ct.length - TAG_BYTES));
  const record = Buffer.concat([
    decipher.update(ct.subarray(0, ct.length - TAG_BYTES)),
    decipher.final()
  ]);

  // Strip the RFC 8188 padding delimiter and any zero padding after it.
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0x00) end--;
  if (end < 0 || (record[end] !== 0x01 && record[end] !== 0x02)) {
    throw new PushCryptoError("decrypted record has no padding delimiter");
  }
  return record.subarray(0, end);
}

/* ═══════════════════════════════════════════════════════════════════════════
   VAPID — RFC 8292
   ══════════════════════════════════════════════════════════════════════════ */

/** A new VAPID keypair, in the base64url form the browser and env vars want. */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey();
  // OpenSSL drops leading zero bytes from an EC private scalar. VAPID keys are
  // fixed-width P-256 values, so restore those bytes before base64url encoding.
  const fixedPrivateKey = Buffer.concat([Buffer.alloc(32 - privateKey.length), privateKey]);
  return {
    publicKey: b64u(ecdh.getPublicKey()),
    privateKey: b64u(fixedPrivateKey)
  };
}

/* A raw 32-byte scalar is not something node:crypto will sign with directly, so
   it is rebuilt as a JWK. The public point is DERIVED from the private scalar
   rather than taken from configuration — a mismatched pair would otherwise
   produce a signature the push service rejects with a message that names
   neither half. */
function vapidSigningKey(privateKey) {
  const ecdh = ecdhFromPrivate(Buffer.isBuffer(privateKey) ? privateKey : unb64u(privateKey));
  const pub = ecdh.getPublicKey();
  return {
    publicKey: pub,
    key: crypto.createPrivateKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        d: b64u(ecdh.getPrivateKey()),
        x: b64u(pub.subarray(1, 33)),
        y: b64u(pub.subarray(33, 65))
      }
    })
  };
}

/** The `aud` claim is the push service's ORIGIN, not the endpoint path. A JWT
    audienced to the full URL is rejected by every push service. */
export function audienceFor(endpoint) {
  let u;
  try {
    u = new URL(String(endpoint));
  } catch {
    throw new PushCryptoError("push endpoint is not a URL");
  }
  if (u.protocol !== "https:") throw new PushCryptoError("push endpoint must be https");
  return u.origin;
}

/**
 * vapidHeaders({ endpoint, subject, publicKey, privateKey }) → { Authorization }
 *
 * The single `vapid` scheme from RFC 8292 §3.2 — `Authorization: vapid t=…, k=…`.
 * The older two-header form (`Authorization: WebPush …` plus `Crypto-Key: p256ecdsa=…`)
 * is draft-era and Apple's push service refuses it outright, so it is not offered.
 *
 * EXPIRY IS TWELVE HOURS, not the 24-hour maximum. Every push service rejects a
 * JWT more than 24 hours out; a clock a couple of hours fast on either side then
 * turns a valid token into a 401 that looks like a key problem. Half the window
 * absorbs that and costs nothing — the token is minted per request.
 */
export function vapidHeaders({
  endpoint,
  subject,
  publicKey,
  privateKey,
  expirySeconds = 12 * 60 * 60,
  now = Date.now()
} = {}) {
  const sub = String(subject || "").trim();
  if (!/^(mailto:|https:\/\/)/.test(sub)) {
    // RFC 8292 §2.1: the push service uses this to reach a human when our
    // traffic misbehaves. A bare email address is the common mistake.
    throw new PushCryptoError("VAPID subject must be a mailto: or https:// URL");
  }

  const { key, publicKey: derivedPublic } = vapidSigningKey(privateKey);

  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" }), "utf8"));
  const claims = b64u(Buffer.from(JSON.stringify({
    aud: audienceFor(endpoint),
    exp: Math.floor(now / 1000) + expirySeconds,
    sub
  }), "utf8"));
  const signingInput = `${header}.${claims}`;

  // ieee-p1363 is r‖s, 64 raw bytes. Node's default is DER, which every push
  // service rejects — and rejects with a generic 401, which is why this line is
  // the single most expensive one in the file to get wrong.
  const signature = crypto.sign("sha256", Buffer.from(signingInput, "utf8"), {
    key,
    dsaEncoding: "ieee-p1363"
  });

  const jwt = `${signingInput}.${b64u(signature)}`;
  return {
    Authorization: `vapid t=${jwt}, k=${publicKey ? String(publicKey) : b64u(derivedPublic)}`
  };
}

export default {
  encryptPayload,
  decryptPayload,
  deriveContentKeys,
  vapidHeaders,
  generateVapidKeys,
  newServerKeys,
  audienceFor,
  b64u,
  unb64u
};
