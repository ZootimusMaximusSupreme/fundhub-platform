import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, test } from "node:test";
import { apnsProviderToken, sendAPNS } from "./apns.mjs";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const env = {
  APNS_KEY_ID: "ABCDEFGHIJ",
  APNS_TEAM_ID: "1234567890",
  APNS_PRIVATE_KEY_BASE64: Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" })).toString("base64")
};
const token = "ab".repeat(32);

describe("native APNs transport", () => {
  test("signs a verifiable ES256 provider token for this team", () => {
    const signed = apnsProviderToken(env, 1_700_000_000_000);
    const [head, body, sig] = signed.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(head, "base64url")), { alg: "ES256", kid: "ABCDEFGHIJ" });
    assert.deepEqual(JSON.parse(Buffer.from(body, "base64url")), { iss: "1234567890", iat: 1_700_000_000 });
    assert.equal(crypto.verify("sha256", Buffer.from(`${head}.${body}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")), true);
  });

  test("uses the selected Apple environment and only approved lock-screen copy", async () => {
    const calls = [];
    const post = async (url, headers, body) => {
      calls.push({ url, headers, body: JSON.parse(body) });
      return { status: 200, body: "" };
    };
    const result = await sendAPNS({ token, environment: "development", notification: { kind: "test" } },
      { env, now: 1_700_000_000_000, post });
    assert.deepEqual(result, { status: "sent", gone: false });
    assert.equal(calls[0].url.href, `https://api.sandbox.push.apple.com/3/device/${token}`);
    assert.equal(calls[0].headers["apns-topic"], "ai.fundhub.app");
    assert.equal(calls[0].headers["apns-push-type"], "alert");
    assert.equal(calls[0].headers["apns-expiration"], String(1_700_000_000 + 3600));
    assert.equal(calls[0].body.aps.alert.body, "Test notification from FundHub.");
    assert.equal(calls[0].body.path, "/app/client-portal.html");
    await sendAPNS({ token, environment: "production", notification: { kind: "update" } },
      { env, post });
    assert.equal(calls[1].url.origin, "https://api.push.apple.com");
    await assert.rejects(sendAPNS({ token, environment: "production",
      notification: { kind: "update", body: "You owe $900 today." } }, { env, post }), /refused/);
    assert.equal(calls.length, 2, "unsafe copy never reached APNs");
  });

  test("retires an invalid token but keeps a temporary Apple failure", async () => {
    const gone = await sendAPNS({ token, environment: "production", notification: { kind: "test" } },
      { env, post: async () => ({ status: 410, body: '{"reason":"Unregistered"}' }) });
    assert.equal(gone.gone, true);
    const retry = await sendAPNS({ token, environment: "production", notification: { kind: "test" } },
      { env, post: async () => ({ status: 503, body: '{"reason":"ServiceUnavailable"}' }) });
    assert.equal(retry.gone, false);
    assert.equal(retry.status, "failed");
  });
});
