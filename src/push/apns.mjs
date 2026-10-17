import crypto from "node:crypto";
import http2 from "node:http2";
import { buildPushPayload } from "./payload.mjs";

const TOPIC = "ai.fundhub.app";
const HOST = Object.freeze({
  development: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com"
});

export class APNSError extends Error {
  constructor(message) {
    super(message);
    this.name = "APNSError";
  }
}

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function apnsProviderToken(env = process.env, now = Date.now()) {
  const keyId = String(env.APNS_KEY_ID || "");
  const teamId = String(env.APNS_TEAM_ID || "");
  if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new APNSError("APNs key ID or team ID is not configured.");
  }
  const encodedKey = String(env.APNS_PRIVATE_KEY_BASE64 || "");
  if (!encodedKey) throw new APNSError("APNs signing key is not configured.");
  let key;
  try {
    key = crypto.createPrivateKey(Buffer.from(encodedKey, "base64"));
  } catch {
    throw new APNSError("APNs signing key is not usable.");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new APNSError("APNs signing key must be a P-256 private key.");
  }
  const head = encoded({ alg: "ES256", kid: keyId });
  const body = encoded({ iss: teamId, iat: Math.floor(now / 1000) });
  const signed = `${head}.${body}`;
  const signature = crypto.sign("sha256", Buffer.from(signed), { key, dsaEncoding: "ieee-p1363" });
  return `${signed}.${signature.toString("base64url")}`;
}

async function postHttp2(url, headers, payload, { timeoutMs = 10_000 } = {}) {
  return await new Promise((resolve, reject) => {
    const session = http2.connect(url.origin);
    let settled = false;
    const timer = setTimeout(() => {
      session.destroy();
      finish(null, new APNSError("APNs timed out."));
    }, timeoutMs);
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.close();
      if (error) reject(error);
      else resolve(result);
    };
    session.once("error", (error) => finish(null, error));
    let request;
    try { request = session.request({ ":method": "POST", ":path": url.pathname, ...headers }); }
    catch (error) { finish(null, error); return; }
    let status = 0;
    const chunks = [];
    request.on("response", (replyHeaders) => { status = Number(replyHeaders[":status"] || 0); });
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("error", (error) => finish(null, error));
    request.once("end", () => finish({ status, body: Buffer.concat(chunks).toString("utf8") }));
    request.end(payload);
  });
}

export async function sendAPNS({ token, environment, notification, ttlSeconds = 3600, expiresAt = null } = {}, {
  env = process.env, now = Date.now(), post = postHttp2
} = {}) {
  if (!HOST[environment]) throw new APNSError("Unknown APNs environment.");
  if (!/^(?:[0-9a-f]{2}){16,256}$/.test(String(token || ""))) {
    throw new APNSError("Invalid APNs device token.");
  }
  const approved = JSON.parse(buildPushPayload(notification));
  const path = `/3/device/${token}`;
  const url = new URL(path, HOST[environment]);
  let expiration = Math.floor(now / 1000) + Math.max(0, Math.min(86_400, Number(ttlSeconds) || 0));
  if (expiresAt != null) {
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs)) throw new APNSError("Invalid APNs expiry.");
    expiration = Math.min(expiration, Math.floor(expiresMs / 1000));
    if (expiration <= Math.floor(now / 1000)) {
      return { status: "failed", gone: false, reason: "invite_expired" };
    }
  }
  const headers = {
    authorization: `bearer ${apnsProviderToken(env, now)}`,
    "apns-topic": TOPIC,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "apns-expiration": String(expiration),
    "apns-collapse-id": approved.tag,
    "content-type": "application/json"
  };
  const payload = JSON.stringify({
    aps: { alert: { title: approved.title, body: approved.body }, sound: "default" },
    path: approved.url
  });
  try {
    const reply = await post(url, headers, payload);
    if (reply.status === 200) return { status: "sent", gone: false };
    let reason = "APNs rejected the notification";
    try { reason = JSON.parse(reply.body)?.reason || reason; } catch { /* APNs did not send JSON. */ }
    const gone = reply.status === 410 || ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(reason);
    return { status: "failed", gone, reason };
  } catch (error) {
    return { status: "failed", gone: false, reason: error instanceof APNSError ? error.message : "APNs was unavailable" };
  }
}

export default { sendAPNS, apnsProviderToken };
