// Signed R2 links — the pure signer in src/storage/r2-sign.mjs.
//
// No database, no network, no real key. Every key pair below is either AWS's
// own published example pair or an obvious fake made of repeated characters.
//
// THE PROOF THAT THE SIGNER IS RIGHT is AWS's worked example, reproduced byte
// for byte: same canonical request, same string to sign, same signature, same
// URL. Source — AWS, Amazon S3 API Reference, "Authenticating Requests: Using
// Query Parameters (AWS Signature Version 4)", section "An Example":
//   https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
// Fetched 2026-10-06. That live address now redirects to the API reference
// index, so the text was read from the Internet Archive copy taken 2025-01-04:
//   https://web.archive.org/web/20250104061234/https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
// The example: object test.txt in bucket examplebucket, shared for 24 hours
// (86400 seconds), timestamp Fri, 24 May 2013 00:00:00 GMT, region us-east-1,
// and AWS's published example credentials (not a real account).
//
// R2's own facts (host, region "auto", path style, 7-day cap) are from
// Cloudflare, "Presigned URLs":
//   https://developers.cloudflare.com/r2/api/s3/presigned-urls/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  presignV4, presignR2, finalVideoKey, uriEncode, r2Host, R2SignError,
  MAX_EXPIRES_SEC, DEFAULT_EXPIRES_SEC, R2_REGION, SIGNABLE_METHODS
} from "./r2-sign.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ── AWS's published example, copied from the page cited above ─────────────── */
const AWS_EXAMPLE = {
  method: "GET",
  host: "examplebucket.s3.amazonaws.com",
  objectPath: "/test.txt",
  region: "us-east-1",
  service: "s3",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  expiresSec: 86400,
  now: new Date("2013-05-24T00:00:00Z")
};

const AWS_CANONICAL_REQUEST = [
  "GET",
  "/test.txt",
  "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host",
  "host:examplebucket.s3.amazonaws.com",
  "",
  "host",
  "UNSIGNED-PAYLOAD"
].join("\n");

const AWS_STRING_TO_SIGN = [
  "AWS4-HMAC-SHA256",
  "20130524T000000Z",
  "20130524/us-east-1/s3/aws4_request",
  "3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04"
].join("\n");

const AWS_SIGNATURE = "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404";

const AWS_URL =
  "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404";

/* ── Fakes for the R2 side. Obviously not keys. ────────────────────────────── */
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const FAKE_ID = "a".repeat(32);
const FAKE_SECRET = "b".repeat(64);
const PARTNER = "5f0c7a1e-2b3d-4c5e-8f90-1a2b3c4d5e6f";
const NOW = new Date("2026-10-06T07:00:00Z");

function r2(extra = {}) {
  return {
    method: /** @type {"GET"} */ ("GET"),
    accountId: ACCOUNT,
    bucket: "fundhub-ad-video",
    key: "partners/" + PARTNER + "/ad-video/final/91-r1.mp4",
    accessKeyId: FAKE_ID,
    secretAccessKey: FAKE_SECRET,
    now: NOW,
    ...extra
  };
}

function refused(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof R2SignError, `expected R2SignError, got ${err && err.name}`);
    assert.equal(err.code, code);
    assert.ok(err.message.startsWith("R2 link:") || err.message.startsWith("Final video key:"),
      "the message says which tool refused, in words");
    return true;
  });
}

describe("AWS's published SigV4 presigned-URL example, reproduced exactly", () => {
  const out = presignV4(AWS_EXAMPLE);

  test("the canonical request is AWS's, line for line", () => {
    assert.equal(out.canonicalRequest, AWS_CANONICAL_REQUEST);
    assert.equal(
      createHash("sha256").update(out.canonicalRequest).digest("hex"),
      "3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04",
      "the hash AWS prints in its string to sign"
    );
  });

  test("the string to sign is AWS's", () => {
    assert.equal(out.stringToSign, AWS_STRING_TO_SIGN);
  });

  test("the signature is AWS's: aeeed9bb…f604d404", () => {
    assert.equal(out.signature, AWS_SIGNATURE);
  });

  test("the whole URL is the one AWS prints to compare against", () => {
    assert.equal(out.url, AWS_URL);
  });

  test("the same code path signs R2 links (presignR2 is presignV4 with R2's host, path and region)", () => {
    const viaR2 = presignR2(r2());
    const viaV4 = presignV4({
      method: "GET",
      host: `${ACCOUNT}.r2.cloudflarestorage.com`,
      objectPath: `/fundhub-ad-video/partners/${PARTNER}/ad-video/final/91-r1.mp4`,
      region: "auto",
      service: "s3",
      accessKeyId: FAKE_ID,
      secretAccessKey: FAKE_SECRET,
      expiresSec: 86400,
      now: NOW
    }).url;
    assert.equal(viaR2, viaV4);
  });
});

describe("presignR2 — Cloudflare's shape", () => {
  test("host is <account>.r2.cloudflarestorage.com and the path is /<bucket>/<key>", () => {
    const u = new URL(presignR2(r2()));
    assert.equal(u.protocol, "https:");
    assert.equal(u.host, `${ACCOUNT}.r2.cloudflarestorage.com`);
    assert.equal(u.pathname, `/fundhub-ad-video/partners/${PARTNER}/ad-video/final/91-r1.mp4`);
  });

  test("region is 'auto' in the credential scope, service s3", () => {
    const u = new URL(presignR2(r2()));
    assert.equal(R2_REGION, "auto");
    assert.equal(u.searchParams.get("X-Amz-Credential"), `${FAKE_ID}/20261006/auto/s3/aws4_request`);
    assert.equal(u.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(u.searchParams.get("X-Amz-Date"), "20261006T070000Z");
    assert.equal(u.searchParams.get("X-Amz-SignedHeaders"), "host");
    assert.match(u.searchParams.get("X-Amz-Signature") || "", /^[0-9a-f]{64}$/);
  });

  test("a link lasts 24 hours unless asked otherwise (spec §9.5)", () => {
    assert.equal(DEFAULT_EXPIRES_SEC, 86400);
    const u = new URL(presignR2(r2()));
    assert.equal(u.searchParams.get("X-Amz-Expires"), "86400");
    const short = new URL(presignR2(r2({ expiresSec: 3600 })));
    assert.equal(short.searchParams.get("X-Amz-Expires"), "3600");
  });

  test("the account id is lowercased, because the host is part of what is signed", () => {
    const upper = presignR2(r2({ accountId: ACCOUNT.toUpperCase() }));
    assert.equal(upper, presignR2(r2()));
    assert.equal(r2Host(ACCOUNT.toUpperCase()), `${ACCOUNT}.r2.cloudflarestorage.com`);
  });

  test("GET, PUT and HEAD each get their own signature (a GET link cannot be used for HEAD)", () => {
    assert.deepEqual([...SIGNABLE_METHODS], ["GET", "PUT", "HEAD"]);
    const sig = (method) => new URL(presignR2(r2({ method }))).searchParams.get("X-Amz-Signature");
    const seen = new Set([sig("GET"), sig("PUT"), sig("HEAD")]);
    assert.equal(seen.size, 3);
  });

  test("DELETE and anything else are refused; nothing in this build deletes a video", () => {
    refused(() => presignR2(r2({ method: "DELETE" })), "bad_method");
    refused(() => presignR2(r2({ method: "POST" })), "bad_method");
    refused(() => presignR2(r2({ method: undefined })), "bad_method");
  });

  test("the URL survives a client's URL parser unchanged, so the bytes sent are the bytes signed", () => {
    const keys = [
      "partners/" + PARTNER + "/ad-video/final/91-r1.mp4",
      "funnel/slo-vsl2-funding.mp4",
      "SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4",
      "odd/it's (really) *here*!~.mp4"
    ];
    for (const key of keys) {
      const url = presignR2(r2({ key }));
      assert.equal(new URL(url).href, url, key);
    }
  });

  test("the same inputs give the same link; a different second gives a different one", () => {
    assert.equal(presignR2(r2()), presignR2(r2()));
    assert.notEqual(presignR2(r2()), presignR2(r2({ now: new Date(NOW.getTime() + 1000) })));
    assert.equal(presignR2(r2({ now: NOW.getTime() })), presignR2(r2()), "a millisecond number works as now");
  });
});

describe("expiry: refused above 7 days", () => {
  test("7 days exactly is allowed; 1 second more is refused", () => {
    assert.equal(MAX_EXPIRES_SEC, 604800);
    const u = new URL(presignR2(r2({ expiresSec: 604800 })));
    assert.equal(u.searchParams.get("X-Amz-Expires"), "604800");
    refused(() => presignR2(r2({ expiresSec: 604801 })), "expiry_too_long");
    refused(() => presignR2(r2({ expiresSec: 30 * 86400 })), "expiry_too_long");
  });

  test("the refusal says so in plain words", () => {
    assert.throws(() => presignR2(r2({ expiresSec: 604801 })), /over 7 days/);
  });

  test("zero, negative, fractional and text expiries are refused", () => {
    refused(() => presignR2(r2({ expiresSec: 0 })), "bad_expiry");
    refused(() => presignR2(r2({ expiresSec: -5 })), "bad_expiry");
    refused(() => presignR2(r2({ expiresSec: 1.5 })), "bad_expiry");
    refused(() => presignR2(r2({ expiresSec: "86400" })), "bad_expiry");
    refused(() => presignR2(r2({ expiresSec: Number.NaN })), "bad_expiry");
  });

  test("the generic signer holds the same cap", () => {
    refused(() => presignV4({ ...AWS_EXAMPLE, expiresSec: 604801 }), "expiry_too_long");
  });
});

describe("key encoding (AWS UriEncode rules)", () => {
  test("letters, digits and - . _ ~ stay as they are", () => {
    assert.equal(uriEncode("AZaz09-._~"), "AZaz09-._~");
  });

  test("a space is %20, never +", () => {
    assert.equal(uriEncode("a b"), "a%20b");
    assert.ok(!presignR2(r2({ key: "a b.mp4" })).includes("+"));
  });

  test("hex is uppercase", () => {
    assert.equal(uriEncode("é"), "%C3%A9");
    assert.equal(uriEncode("—"), "%E2%80%94", "the em dash in a NAMING.md file name");
  });

  test("! ' ( ) * are encoded, which encodeURIComponent would leave alone", () => {
    assert.equal(uriEncode("!'()*"), "%21%27%28%29%2A");
  });

  test("the slash is kept in the key and encoded everywhere else", () => {
    assert.equal(uriEncode("photos/Jan/sample.jpg", true), "photos/Jan/sample.jpg");
    assert.equal(uriEncode("a/b"), "a%2Fb");
    assert.equal(uriEncode("+=&?#%"), "%2B%3D%26%3F%23%25");
  });

  test("a real file name lands in the path encoded once, slashes kept", () => {
    const key = "funnel/SLO Ad 7 — Haynes (1).mp4";
    const u = new URL(presignR2(r2({ key })));
    assert.equal(u.pathname, "/fundhub-ad-video/funnel/SLO%20Ad%207%20%E2%80%94%20Haynes%20%281%29.mp4");
    assert.equal(decodeURIComponent(u.pathname), "/fundhub-ad-video/" + key);
  });

  test("keys a client would fold or cannot send are refused", () => {
    refused(() => presignR2(r2({ key: "" })), "no_key");
    refused(() => presignR2(r2({ key: "/leading-slash.mp4" })), "bad_key");
    refused(() => presignR2(r2({ key: "partners/../other/x.mp4" })), "bad_key");
    refused(() => presignR2(r2({ key: "partners/./x.mp4" })), "bad_key");
    refused(() => presignR2(r2({ key: "a\nb.mp4" })), "bad_key");
    refused(() => presignR2(r2({ key: "a\u0000b" })), "bad_key");
    refused(() => presignR2(r2({ key: "lone\uD800surrogate" })), "bad_key");
    refused(() => presignR2(r2({ key: "x".repeat(1025) })), "bad_key");
    assert.ok(presignR2(r2({ key: "x".repeat(1024) })), "1,024 bytes is S3's limit and is allowed");
    assert.ok(presignR2(r2({ key: "file..name.mp4" })), "dots inside a name are fine");
  });
});

describe("inputs that would make a bad link are refused before anything is signed", () => {
  test("account id must be 32 hex characters", () => {
    refused(() => presignR2(r2({ accountId: "" })), "bad_account_id");
    refused(() => presignR2(r2({ accountId: "evil.example.com#" })), "bad_account_id");
    refused(() => presignR2(r2({ accountId: ACCOUNT.slice(1) })), "bad_account_id");
  });

  test("bucket must be an R2 bucket name", () => {
    refused(() => presignR2(r2({ bucket: "Fundhub" })), "bad_bucket");
    refused(() => presignR2(r2({ bucket: "a" })), "bad_bucket");
    refused(() => presignR2(r2({ bucket: "-fundhub" })), "bad_bucket");
    refused(() => presignR2(r2({ bucket: "fundhub/../x" })), "bad_bucket");
    assert.ok(presignR2(r2({ bucket: "fundhub-media" })), "the §12.1 media bucket");
  });

  test("a missing or masked key pair is refused, never signed", () => {
    refused(() => presignR2(r2({ accessKeyId: "" })), "no_access_key_id");
    refused(() => presignR2(r2({ accessKeyId: undefined })), "no_access_key_id");
    refused(() => presignR2(r2({ accessKeyId: "****************abcd" })), "masked_access_key_id");
    refused(() => presignR2(r2({ accessKeyId: "has/slash" + "a".repeat(16) })), "bad_access_key_id");
    refused(() => presignR2(r2({ secretAccessKey: "" })), "no_secret");
    refused(() => presignR2(r2({ secretAccessKey: "****************1369" })), "masked_secret");
  });

  test("the secret never appears in the link", () => {
    const url = presignR2(r2());
    assert.ok(!url.includes(FAKE_SECRET));
    assert.ok(!presignV4(AWS_EXAMPLE).url.includes("wJalrXUtnFEMI"));
  });

  test("a time that is not a date is refused", () => {
    refused(() => presignR2(r2({ now: new Date("not a date") })), "bad_time");
    refused(() => presignR2(r2({ now: Number.NaN })), "bad_time");
  });

  test("no options at all is a refusal, not a crash", () => {
    assert.throws(() => presignR2(undefined), R2SignError);
    assert.throws(() => presignV4(undefined), R2SignError);
  });
});

describe("finalVideoKey — spec §9.1 step 11", () => {
  test("partners/<partner_id>/ad-video/final/<ad>-r<round>.mp4", () => {
    assert.equal(
      finalVideoKey({ partnerId: PARTNER, adNumber: 91, round: 1 }),
      `partners/${PARTNER}/ad-video/final/91-r1.mp4`
    );
    assert.equal(
      finalVideoKey({ partnerId: PARTNER, adNumber: "104", round: 3 }),
      `partners/${PARTNER}/ad-video/final/104-r3.mp4`
    );
  });

  test("it passes creative_assets' storage_key check (migration 045: LIKE 'partners/' || partner_id::text || '/%')", () => {
    const upper = PARTNER.toUpperCase();
    const key = finalVideoKey({ partnerId: upper, adNumber: 91, round: 0 });
    assert.ok(key.startsWith(`partners/${PARTNER}/`), "uuid::text is lowercase, so the key is too");
  });

  test("ad numbers are numbers: '084' is ad 84", () => {
    assert.equal(finalVideoKey({ partnerId: PARTNER, adNumber: "084", round: 2 }),
      `partners/${PARTNER}/ad-video/final/84-r2.mp4`);
  });

  test("round 0 and up are allowed", () => {
    assert.ok(finalVideoKey({ partnerId: PARTNER, adNumber: 91, round: 0 }).endsWith("/91-r0.mp4"));
  });

  test("a bad partner, ad number or round is refused, never guessed", () => {
    refused(() => finalVideoKey({ partnerId: "fundhub-house", adNumber: 91, round: 1 }), "bad_partner_id");
    refused(() => finalVideoKey({ partnerId: "../" + PARTNER, adNumber: 91, round: 1 }), "bad_partner_id");
    refused(() => finalVideoKey({ partnerId: PARTNER, adNumber: 0, round: 1 }), "bad_ad_number");
    refused(() => finalVideoKey({ partnerId: PARTNER, adNumber: -3, round: 1 }), "bad_ad_number");
    refused(() => finalVideoKey({ partnerId: PARTNER, adNumber: "91-slug", round: 1 }), "bad_ad_number");
    refused(() => finalVideoKey({ partnerId: PARTNER, adNumber: 9.5, round: 1 }), "bad_ad_number");
    refused(() => finalVideoKey({ partnerId: PARTNER, adNumber: null, round: 1 }), "bad_ad_number");
    refused(() => finalVideoKey({ partnerId: PARTNER, adNumber: 91, round: -1 }), "bad_round");
    refused(() => finalVideoKey({ partnerId: PARTNER, adNumber: 91, round: 1.5 }), "bad_round");
    refused(() => finalVideoKey({ partnerId: PARTNER, adNumber: 91, round: "1" }), "bad_round");
    refused(() => finalVideoKey(undefined), "bad_partner_id");
  });

  test("the key signs cleanly into a link", () => {
    const key = finalVideoKey({ partnerId: PARTNER, adNumber: 91, round: 1 });
    const u = new URL(presignR2(r2({ key })));
    assert.equal(u.pathname, `/fundhub-ad-video/${key}`);
  });
});

describe("no network, no dependency", () => {
  const src = fs.readFileSync(path.join(HERE, "r2-sign.mjs"), "utf8");

  test("node:crypto is the only import", () => {
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    assert.deepEqual(imports, ["node:crypto"]);
    assert.ok(!/\bimport\s*\(/.test(src), "no dynamic import");
    assert.ok(!/\brequire\s*\(/.test(src), "no require");
  });

  test("it never calls fetch or opens a socket, and never reads the environment", () => {
    const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/\bfetch\s*\(/.test(code));
    assert.ok(!/\bnode:(https?|net|tls|dgram|dns)\b/.test(code));
    assert.ok(!/process\.env/.test(code));
  });
});
