// The published RFC test vectors. This file is the reason src/push/crypto.mjs
// is allowed to exist without a dependency.
//
// RFC 8291 §5 ("Push Message Encryption Example") fixes every input that is
// normally random — both keypairs, the auth secret, and the salt — and prints
// the exact bytes that must come out. Two assertions are made against it, and
// they fail independently:
//
//   FORWARD  encrypt the RFC's plaintext with the RFC's inputs and compare the
//            whole wire body, byte for byte, with the RFC's expected output.
//
//   REVERSE  decrypt the RFC's expected output with the RFC's receiver key and
//            check it comes back as the exact expected plaintext.
//
// THE REVERSE DIRECTION IS THE ONE THAT CANNOT BE FUDGED, and it is here on
// purpose. If a constant below had been mistyped, the forward test could be
// "fixed" by pasting whatever this code produced — and the result would be a
// green test over broken crypto, which is worse than no test. The reverse test
// has no such escape: AES-GCM authenticates, so an expected-output string that
// is even one bit wrong fails to decrypt at all, and a key ladder that is wrong
// cannot recover a 41-character English sentence by luck.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  encryptPayload,
  decryptPayload,
  deriveContentKeys,
  vapidHeaders,
  generateVapidKeys,
  audienceFor,
  MAX_PAYLOAD_BYTES,
  b64u,
  unb64u
} from "./crypto.mjs";

/* ── RFC 8291 §5, transcribed ─────────────────────────────────────────────
   https://www.rfc-editor.org/rfc/rfc8291#section-5 */
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  // Application server (us) — the ephemeral keypair for this one message.
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  // User agent (the browser) — what a real subscription's p256dh/auth are.
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  recordSize: 4096,
  // The complete aes128gcm body: header ‖ our public key ‖ one encrypted record.
  expectedBody:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  // The intermediate values the RFC also publishes, so a failure says WHERE.
  expectedIkm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  expectedCek: "oIhVW04MRdy2XN9CiKLxTg",
  expectedNonce: "4h_95klXJ5E_qnoN"
};

const serverKeysFromVector = () => {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(unb64u(V.asPrivate));
  return { ecdh, publicKey: ecdh.getPublicKey() };
};

describe("RFC 8291 §5 — the published push encryption vector", () => {
  test("the transcribed public keys match the transcribed private keys", () => {
    // Catches a mistyped constant before it can be blamed on the algorithm.
    const as = crypto.createECDH("prime256v1");
    as.setPrivateKey(unb64u(V.asPrivate));
    assert.equal(b64u(as.getPublicKey()), V.asPublic, "application server keypair disagrees");

    const ua = crypto.createECDH("prime256v1");
    ua.setPrivateKey(unb64u(V.uaPrivate));
    assert.equal(b64u(ua.getPublicKey()), V.uaPublic, "user agent keypair disagrees");
  });

  test("the key ladder produces the RFC's IKM, CEK and nonce", () => {
    const as = serverKeysFromVector();
    const { ikm, cek, nonce } = deriveContentKeys({
      ecdhSecret: as.ecdh.computeSecret(unb64u(V.uaPublic)),
      uaPublic: unb64u(V.uaPublic),
      asPublic: unb64u(V.asPublic),
      authSecret: unb64u(V.authSecret),
      salt: unb64u(V.salt)
    });
    assert.equal(b64u(ikm), V.expectedIkm, "IKM (RFC 8291 §3.4) does not match");
    assert.equal(b64u(cek), V.expectedCek, "content encryption key does not match");
    assert.equal(b64u(nonce), V.expectedNonce, "nonce does not match");
  });

  test("FORWARD — encrypting the RFC's plaintext produces the RFC's exact bytes", () => {
    const actual = encryptPayload(V.plaintext, {
      p256dh: V.uaPublic,
      auth: V.authSecret,
      salt: V.salt,
      serverKeys: serverKeysFromVector(),
      recordSize: V.recordSize
    });

    const actualB64 = b64u(actual);
    // Printed, not merely asserted: the task this was built for asks for the
    // expected and the actual side by side, and a reader of CI output should
    // not have to re-run anything to see them.
    console.log("RFC 8291 §5 expected:", V.expectedBody);
    console.log("RFC 8291 §5 actual  :", actualB64);

    assert.equal(actual.length, 144, "wire body should be 21-byte header + 65-byte key + 58-byte record");
    assert.equal(actualB64, V.expectedBody);
  });

  test("REVERSE — the RFC's exact bytes decrypt back to the RFC's plaintext", () => {
    const back = decryptPayload(unb64u(V.expectedBody), {
      privateKey: V.uaPrivate,
      authSecret: V.authSecret
    });
    assert.equal(back.toString("utf8"), V.plaintext);
  });

  test("a tampered ciphertext does not decrypt — the tag is real", () => {
    const body = unb64u(V.expectedBody);
    body[body.length - 20] ^= 0x01;      // one bit, inside the ciphertext
    assert.throws(() => decryptPayload(body, {
      privateKey: V.uaPrivate,
      authSecret: V.authSecret
    }));
  });
});

describe("push encryption, beyond the vector", () => {
  const subscription = () => {
    const ua = crypto.createECDH("prime256v1");
    ua.generateKeys();
    return {
      p256dh: b64u(ua.getPublicKey()),
      auth: b64u(crypto.randomBytes(16)),
      privateKey: b64u(ua.getPrivateKey())
    };
  };

  test("a random subscription round-trips", () => {
    const s = subscription();
    const body = encryptPayload("hello from fundhub", { p256dh: s.p256dh, auth: s.auth });
    assert.equal(
      decryptPayload(body, { privateKey: s.privateKey, authSecret: s.auth }).toString("utf8"),
      "hello from fundhub"
    );
  });

  test("every message gets a fresh salt and a fresh ephemeral key", () => {
    // The one failure mode that breaks AES-GCM outright is a repeated
    // key/nonce pair, and that is exactly what reusing either of these would
    // cause. Two encryptions of identical input must share no bytes up front.
    const s = subscription();
    const a = encryptPayload("same text", { p256dh: s.p256dh, auth: s.auth });
    const b = encryptPayload("same text", { p256dh: s.p256dh, auth: s.auth });
    assert.notEqual(a.subarray(0, 16).toString("hex"), b.subarray(0, 16).toString("hex"), "salt repeated");
    assert.notEqual(a.subarray(21, 86).toString("hex"), b.subarray(21, 86).toString("hex"), "ephemeral key repeated");
    assert.notEqual(a.toString("hex"), b.toString("hex"));
  });

  test("a payload over the push-service ceiling is refused, not truncated", () => {
    const s = subscription();
    assert.throws(
      () => encryptPayload("x".repeat(MAX_PAYLOAD_BYTES + 1), { p256dh: s.p256dh, auth: s.auth }),
      /limit is/
    );
  });

  test("a p256dh that is not a curve point is refused", () => {
    assert.throws(
      () => encryptPayload("hi", { p256dh: b64u(Buffer.alloc(65, 4)), auth: b64u(Buffer.alloc(16)) }),
      /not a valid P-256 public key/
    );
  });

  test("a wrong-length auth secret is refused rather than padded", () => {
    const s = subscription();
    assert.throws(
      () => encryptPayload("hi", { p256dh: s.p256dh, auth: b64u(Buffer.alloc(8)) }),
      /auth secret must be 16 bytes/
    );
  });
});

describe("RFC 8292 — VAPID", () => {
  const keys = generateVapidKeys();

  test("generated key pairs keep the fixed P-256 wire widths", () => {
    for (let i = 0; i < 4096; i += 1) {
      const generated = generateVapidKeys();
      assert.equal(unb64u(generated.publicKey).length, 65);
      assert.equal(unb64u(generated.privateKey).length, 32);
    }
  });

  test("the Authorization header is the single vapid scheme, and it verifies", () => {
    const { Authorization } = vapidHeaders({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc123",
      subject: "mailto:support@fundhub.ai",
      publicKey: keys.publicKey,
      privateKey: keys.privateKey
    });

    const m = /^vapid t=([^,]+), k=(.+)$/.exec(Authorization);
    assert.ok(m, "header is not the RFC 8292 §3.2 single-header form: " + Authorization);
    const [, jwt, k] = m;
    assert.equal(k, keys.publicKey);

    const [h, c, sig] = jwt.split(".");
    assert.deepEqual(JSON.parse(unb64u(h).toString("utf8")), { typ: "JWT", alg: "ES256" });

    const claims = JSON.parse(unb64u(c).toString("utf8"));
    // aud is the ORIGIN. A JWT audienced to the full endpoint path is rejected
    // by every push service, and the rejection names nothing useful.
    assert.equal(claims.aud, "https://updates.push.services.mozilla.com");
    assert.equal(claims.sub, "mailto:support@fundhub.ai");
    assert.ok(claims.exp > Math.floor(Date.now() / 1000), "already expired");
    assert.ok(claims.exp <= Math.floor(Date.now() / 1000) + 24 * 3600, "over the 24h maximum");

    // The signature must be raw r‖s (64 bytes), NOT DER. Verifying with
    // ieee-p1363 is what pins that.
    const pub = crypto.createECDH("prime256v1");
    pub.setPrivateKey(unb64u(keys.privateKey));
    const verifyKey = crypto.createPublicKey({
      format: "jwk",
      key: {
        kty: "EC", crv: "P-256",
        x: b64u(pub.getPublicKey().subarray(1, 33)),
        y: b64u(pub.getPublicKey().subarray(33, 65))
      }
    });
    assert.equal(unb64u(sig).length, 64, "signature is not raw r‖s — DER would be rejected");
    assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`, "utf8"),
      { key: verifyKey, dsaEncoding: "ieee-p1363" }, unb64u(sig)));
  });

  test("a bare email address as the subject is refused", () => {
    assert.throws(() => vapidHeaders({
      endpoint: "https://fcm.googleapis.com/fcm/send/x",
      subject: "support@fundhub.ai",
      privateKey: keys.privateKey
    }), /mailto:/);
  });

  test("a non-https endpoint is refused", () => {
    assert.throws(() => audienceFor("http://push.example/x"), /must be https/);
  });
});
