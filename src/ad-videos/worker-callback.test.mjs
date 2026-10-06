// The video-worker callback signature — src/ad-videos/worker-callback.mjs.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §9.5: the callback is
// "HMAC-signed over the timestamp plus the body, with a 5-minute window". These
// checks need no database and no network, so they run everywhere (a skipped
// test is not green, CLAUDE.md §12). The secret below is a fake made for this
// file; it is not VIDEO_WORKER_CALLBACK_SECRET and never was.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  signCallback, verifyCallback, WorkerCallbackError,
  CALLBACK_TIMESTAMP_HEADER, CALLBACK_SIGNATURE_HEADER, CALLBACK_WINDOW_SECONDS, MIN_SECRET_LENGTH
} from "./worker-callback.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SECRET = "fundhub-test-secret-not-real-0123456789abcdef";
const OTHER_SECRET = "a-different-fake-secret-0123456789abcdef-xyz";
const TS = 1791270000; // 2026-10-06T07:00:00Z
const NOW_MS = TS * 1000;
const BODY = JSON.stringify({ job_id: "5f0c7a1e-2b3d-4c5e-8f90-1a2b3c4d5e6f:build_cut:1", status: "done" });

/** Headers the worker would send for this body. */
function signed(body = BODY, ts = TS, secret = SECRET) {
  return {
    [CALLBACK_TIMESTAMP_HEADER]: String(ts),
    [CALLBACK_SIGNATURE_HEADER]: signCallback(body, ts, secret)
  };
}

function check(extra = {}) {
  return verifyCallback({ headers: signed(), rawBody: BODY, secret: SECRET, now: NOW_MS, ...extra });
}

describe("the signature is HMAC-SHA256 over '<ts>.<body>'", () => {
  test("it equals a plain HMAC of the timestamp, a dot, and the body", () => {
    const expected = createHmac("sha256", SECRET).update(`${TS}.${BODY}`).digest("hex");
    assert.equal(signCallback(BODY, TS, SECRET), expected);
  });

  test("known answer, pinned so the construction cannot drift", () => {
    assert.equal(
      signCallback(BODY, TS, SECRET),
      "78aea78a4b246291f78d43dff5ae2a4d69a1679f01e63a4627fa55d7d81639d1"
    );
  });

  test("64 lowercase hex characters", () => {
    assert.match(signCallback(BODY, TS, SECRET), /^[0-9a-f]{64}$/);
  });

  test("the raw bytes and the same text sign the same", () => {
    assert.equal(signCallback(Buffer.from(BODY, "utf8"), TS, SECRET), signCallback(BODY, TS, SECRET));
    assert.equal(signCallback(BODY, String(TS), SECRET), signCallback(BODY, TS, SECRET));
  });

  test("the header names", () => {
    assert.equal(CALLBACK_TIMESTAMP_HEADER, "x-fundhub-video-timestamp");
    assert.equal(CALLBACK_SIGNATURE_HEADER, "x-fundhub-video-signature");
    assert.equal(CALLBACK_WINDOW_SECONDS, 300);
  });
});

describe("a valid signature passes", () => {
  test("signed now, checked now", () => {
    assert.deepEqual(check(), { ok: true, reason: null });
  });

  test("checked 5 minutes later exactly still passes; the window is inclusive", () => {
    assert.equal(check({ now: NOW_MS + 300_000 }).ok, true);
    assert.equal(check({ now: NOW_MS - 300_000 }).ok, true, "a worker clock a little ahead is fine");
  });

  test("header names in any letter case, as Node or Netlify hands them over", () => {
    const h = signed();
    const mixed = {
      "X-Fundhub-Video-Timestamp": h[CALLBACK_TIMESTAMP_HEADER],
      "X-FUNDHUB-VIDEO-SIGNATURE": h[CALLBACK_SIGNATURE_HEADER]
    };
    assert.equal(check({ headers: mixed }).ok, true);
  });

  test("a fetch Headers object works too", () => {
    assert.equal(check({ headers: new Headers(signed()) }).ok, true);
  });

  test("array header values (Node's raw form) use the first value", () => {
    const h = signed();
    const arr = {
      [CALLBACK_TIMESTAMP_HEADER]: [h[CALLBACK_TIMESTAMP_HEADER]],
      [CALLBACK_SIGNATURE_HEADER]: [h[CALLBACK_SIGNATURE_HEADER]]
    };
    assert.equal(check({ headers: arr }).ok, true);
  });

  test("an uppercase hex signature is the same signature", () => {
    const h = signed();
    h[CALLBACK_SIGNATURE_HEADER] = h[CALLBACK_SIGNATURE_HEADER].toUpperCase();
    assert.equal(check({ headers: h }).ok, true);
  });

  test("a raw Buffer body checks the same as its text", () => {
    assert.equal(check({ rawBody: Buffer.from(BODY, "utf8") }).ok, true);
  });

  test("now can be a Date or a function", () => {
    assert.equal(check({ now: new Date(NOW_MS) }).ok, true);
    assert.equal(check({ now: () => NOW_MS }).ok, true);
  });
});

describe("a changed body fails, with a plain reason", () => {
  test("one character changed", () => {
    const out = check({ rawBody: BODY.replace("done", "dona") });
    assert.equal(out.ok, false);
    assert.match(out.reason, /signature does not match/);
    assert.match(out.reason, /body was changed/);
  });

  test("same JSON, different spacing — the raw bytes are what count", () => {
    const respaced = JSON.stringify(JSON.parse(BODY), null, 2);
    assert.equal(check({ rawBody: respaced }).ok, false);
  });

  test("an extra field added", () => {
    const tampered = JSON.stringify({ ...JSON.parse(BODY), status: "done", approved: true });
    assert.equal(check({ rawBody: tampered }).ok, false);
  });

  test("the timestamp header changed after signing", () => {
    const h = signed();
    h[CALLBACK_TIMESTAMP_HEADER] = String(TS + 1);
    const out = check({ headers: h });
    assert.equal(out.ok, false);
    assert.match(out.reason, /signature does not match/);
  });
});

describe("an old timestamp fails, with a plain reason", () => {
  test("over 5 minutes old", () => {
    const out = check({ now: NOW_MS + 301_000 });
    assert.deepEqual(out, { ok: false, reason: "the timestamp is more than 5 minutes old" });
  });

  test("a day old, correctly signed, still fails — a copied callback dies", () => {
    const out = check({ now: NOW_MS + 86_400_000 });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "the timestamp is more than 5 minutes old");
  });

  test("over 5 minutes in the future fails too", () => {
    const out = check({ now: NOW_MS - 301_000 });
    assert.deepEqual(out, { ok: false, reason: "the timestamp is more than 5 minutes in the future" });
  });
});

describe("a wrong secret fails, with a plain reason", () => {
  test("signed with one secret, checked with another", () => {
    const out = verifyCallback({
      headers: signed(BODY, TS, OTHER_SECRET), rawBody: BODY, secret: SECRET, now: NOW_MS
    });
    assert.equal(out.ok, false);
    assert.match(out.reason, /secret is wrong/);
  });

  test("no secret set: fails closed, before reading anything else", () => {
    for (const secret of [undefined, null, ""]) {
      const out = check({ secret });
      assert.deepEqual(out, { ok: false, reason: "no callback secret is set" });
    }
  });

  test("a masked secret is named as masked", () => {
    const out = check({ secret: "****************" + "c".repeat(20) });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "the callback secret is a masked copy, not the real secret");
  });

  test("a short secret is refused on both sides", () => {
    assert.equal(MIN_SECRET_LENGTH, 32);
    const short = "s".repeat(31);
    assert.match(check({ secret: short }).reason, /too short/);
    assert.throws(() => signCallback(BODY, TS, short), WorkerCallbackError);
  });
});

describe("malformed callbacks fail, with a plain reason", () => {
  test("headers missing", () => {
    assert.equal(check({ headers: {} }).reason, "the timestamp header is missing");
    assert.equal(check({ headers: undefined }).reason, "the timestamp header is missing");
    assert.equal(
      check({ headers: { [CALLBACK_TIMESTAMP_HEADER]: String(TS) } }).reason,
      "the signature header is missing"
    );
  });

  test("no body", () => {
    assert.equal(check({ rawBody: undefined }).reason, "the callback has no body");
    assert.equal(check({ rawBody: null }).reason, "the callback has no body");
    assert.equal(check({ rawBody: { status: "done" } }).reason, "the callback body is not raw text");
  });

  test("a timestamp that is not whole seconds", () => {
    for (const bad of ["1791270000.5", "-1791270000", "soon", "1e9"]) {
      const h = signed();
      h[CALLBACK_TIMESTAMP_HEADER] = bad;
      assert.equal(check({ headers: h }).reason, "the timestamp is not whole seconds", bad);
    }
  });

  test("a signature of the wrong shape", () => {
    for (const bad of ["abc", "z".repeat(64), "a".repeat(63), "a".repeat(65), "sha256=" + "a".repeat(64)]) {
      const h = signed();
      h[CALLBACK_SIGNATURE_HEADER] = bad;
      assert.equal(check({ headers: h }).reason, "the signature is not 64 hex characters", bad);
    }
  });

  test("a clock that is not a number", () => {
    assert.equal(check({ now: () => Number.NaN }).ok, false);
  });

  test("no options at all is a refusal, not a crash", () => {
    assert.equal(verifyCallback(undefined).ok, false);
  });

  test("every failure carries a reason in words", () => {
    const outs = [
      check({ rawBody: BODY + " " }), check({ now: NOW_MS + 999_999 }), check({ secret: OTHER_SECRET }),
      check({ headers: {} }), check({ secret: "" })
    ];
    for (const out of outs) {
      assert.equal(out.ok, false);
      assert.equal(typeof out.reason, "string");
      assert.ok(out.reason.length > 10);
      assert.ok(!out.reason.includes(SECRET), "the secret is never echoed");
    }
  });
});

describe("signing refuses what would never verify", () => {
  test("an object body is refused: sign the bytes you send", () => {
    assert.throws(() => signCallback({ status: "done" }, TS, SECRET), /raw body text/);
  });

  test("a millisecond clock is refused", () => {
    assert.throws(() => signCallback(BODY, NOW_MS, SECRET), /milliseconds/);
  });

  test("a timestamp that is not whole seconds is refused", () => {
    assert.throws(() => signCallback(BODY, 1.5, SECRET), WorkerCallbackError);
    assert.throws(() => signCallback(BODY, -1, SECRET), WorkerCallbackError);
    assert.throws(() => signCallback(BODY, undefined, SECRET), WorkerCallbackError);
  });

  test("no secret, or a masked one, is refused", () => {
    assert.throws(() => signCallback(BODY, TS, ""), /no callback secret/);
    assert.throws(() => signCallback(BODY, TS, "****************" + "d".repeat(20)), /masked/);
  });
});

describe("constant-time compare, no network, no dependency", () => {
  const src = fs.readFileSync(path.join(HERE, "worker-callback.mjs"), "utf8");
  const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  test("the signature is compared with timingSafeEqual, never with === or a string compare", () => {
    assert.match(code, /timingSafeEqual\(given, expected\)/);
    assert.ok(!/(sigText|given|expected)\s*[!=]==/.test(code));
    assert.ok(!/[!=]==\s*(sigText|given|expected)\b(?!\.length)/.test(code));
    assert.ok(!/\.(equals|localeCompare)\(/.test(code));
  });

  test("node:crypto is the only import", () => {
    const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    assert.deepEqual(imports, ["node:crypto"]);
    assert.ok(!/\bimport\s*\(/.test(code), "no dynamic import");
    assert.ok(!/\brequire\s*\(/.test(code), "no require");
  });

  test("it never calls fetch, opens a socket or reads the environment", () => {
    assert.ok(!/\bfetch\s*\(/.test(code));
    assert.ok(!/\bnode:(https?|net|tls|dgram|dns)\b/.test(code));
    assert.ok(!/process\.env/.test(code));
  });
});
