import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const TAG_BYTES = 16;

function keyFor(keyId, env = {}) {
  const varName = keyId === "v1" ? "AD_TOKEN_ENC_KEY" : `AD_TOKEN_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = env[varName];
  if (!raw) throw new Error(`${varName} is not set`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`${varName} must be 32 bytes base64-encoded`);
  return key;
}

export function decryptSavedToken(stored, { partnerId, env = {} } = {}) {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!partnerId) throw new Error("partnerId is required to open the saved key");
  const parts = String(stored).split(":");
  if (parts.length !== 4) throw new Error("saved key is malformed");
  const [keyId, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, env), Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(String(partnerId), "utf8"));
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== TAG_BYTES) throw new Error("saved key auth tag is malformed");
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("saved key authentication failed");
  }
}
