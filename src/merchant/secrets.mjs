// Merchant connection credentials — the open-API key and the webhook secret.
//
// TWO DIFFERENT THINGS, STORED TWO DIFFERENT WAYS.
//
//   * The OPEN-API KEY is ours. We mint it, show it ONCE, and keep only its
//     sha256. A 256-bit random key needs no slow hash — same reasoning as
//     src/auth/session.mjs hashToken(). A leaked table yields no working key.
//
//   * The WEBHOOK SECRET is the processor's (Whop hands out a `ws_…` string,
//     Commas its own signing secret). We must be able to read it back to check
//     every signature, so it cannot be hashed. It is AES-256-GCM encrypted with
//     MERCHANT_SECRET_ENC_KEY, and the connection id is the additional
//     authenticated data, so a ciphertext copied onto another client's row fails
//     to decrypt. Same design as src/banking/plaid.mjs encryptPlaidToken().
//
// A SEPARATE KEY FROM PLAID_TOKEN_ENC_KEY, AD_TOKEN_ENC_KEY AND PII_ENC_KEY on
// purpose: a merchant webhook secret and a bank login must not share a blast
// radius (src/banking/plaid.mjs keyFor() makes the same call).
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const API_KEY_PREFIX = "fhm_";

export class MerchantSecretError extends Error {
  constructor(message, { code = "MERCHANT_SECRET", status = 500 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* newApiKey — "fhm_" + 32 random bytes, base64url. Shown once, never stored. */
export function newApiKey() {
  return API_KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
}

/* hashApiKey — sha256 hex of the exact key string. */
export function hashApiKey(key) {
  return crypto.createHash("sha256").update(String(key), "utf8").digest("hex");
}

/* The last four characters, so a screen can say which key is which. */
export function apiKeyHint(key) {
  const s = String(key || "");
  return s.length >= 4 ? s.slice(-4) : null;
}

function keyFor(keyId = "v1", env = process.env) {
  const varName = keyId === "v1" ? "MERCHANT_SECRET_ENC_KEY" : `MERCHANT_SECRET_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = env[varName];
  if (!raw) {
    // Named, never valued. Never a plaintext fallback.
    throw new MerchantSecretError(`${varName} is not set — refusing to store a webhook secret unencrypted`, {
      code: "NOT_CONFIGURED",
      status: 503
    });
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new MerchantSecretError(`${varName} must be 32 bytes base64-encoded (got ${key.length})`, {
      code: "NOT_CONFIGURED",
      status: 503
    });
  }
  return key;
}

/* encryptWebhookSecret(plain, { connectionId }) → "v1:<iv>:<tag>:<ct>" */
export function encryptWebhookSecret(plain, { connectionId, keyId = "v1", env = process.env } = {}) {
  if (plain === null || plain === undefined || plain === "") return null;
  if (!connectionId) throw new MerchantSecretError("encryptWebhookSecret: connectionId is required", { status: 400 });
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFor(keyId, env), iv);
  cipher.setAAD(Buffer.from(String(connectionId), "utf8"));
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [keyId, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/* decryptWebhookSecret(stored, { connectionId }) → string. Throws on tamper. */
export function decryptWebhookSecret(stored, { connectionId, env = process.env } = {}) {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!connectionId) throw new MerchantSecretError("decryptWebhookSecret: connectionId is required", { status: 400 });
  const parts = String(stored).split(":");
  if (parts.length !== 4) throw new MerchantSecretError("decryptWebhookSecret: malformed ciphertext");
  const [keyId, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, env), Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(String(connectionId), "utf8"));
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== TAG_BYTES) throw new MerchantSecretError("decryptWebhookSecret: malformed auth tag");
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new MerchantSecretError("decryptWebhookSecret: authentication failed", { code: "SECRET_AUTH_FAILED" });
  }
}

/* ── The client's PROCESSOR API KEY (pull mode, migration 457) ──────────────
   Same cipher and the same MERCHANT_SECRET_ENC_KEY as the webhook secret, but a
   different additional-data string ("<connection id>:api-key"). So a webhook
   secret's ciphertext copied into the api-key column — or the other way round —
   fails to decrypt instead of being used as the wrong credential. */
const apiKeyAad = (connectionId) => (connectionId ? `${connectionId}:api-key` : connectionId);

export function encryptProcessorApiKey(plain, { connectionId, keyId = "v1", env = process.env } = {}) {
  return encryptWebhookSecret(plain, { connectionId: apiKeyAad(connectionId), keyId, env });
}

export function decryptProcessorApiKey(stored, { connectionId, env = process.env } = {}) {
  return decryptWebhookSecret(stored, { connectionId: apiKeyAad(connectionId), env });
}
