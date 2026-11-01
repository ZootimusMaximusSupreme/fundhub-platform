// The lock-screen gate, and the send path it sits in.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — credit-repair messaging.
//
// THE CLAIM UNDER TEST, and it is a whitelist claim, not a banned-word one:
//
//   With the detail flag off — which is everywhere, today — the set of strings
//   that can reach a push service is FINITE AND WRITTEN DOWN. Every payload
//   buildPushPayload can produce is enumerated below by taking the product of
//   the approved kinds, bodies, titles, urls and tags. Then bodies are generated
//   in bulk — the sentences a reviewer actually got onto a locked screen, plus
//   thousands of machine-made ones — and every single one either throws or
//   lands inside that enumerated set. Nothing is stripped or edited on the way.
//
// WHY A PROPERTY TEST AND NOT A LIST. The gate that was here before was a list
// of about twenty-five lender names and some money-shaped regular expressions,
// and it passed its own examples while letting "You owe 24000 this month. Pay
// 900 today." straight through. A test made of examples can only ever prove the
// examples. This one proves the complement: that the reachable set is closed.
//
// It is tested at BOTH levels, because a gate is only worth what its weakest
// caller is:
//   1. directly against buildPushPayload(), and
//   2. through src/messaging/providers/web-push.mjs's send() with a fake
//      network — decrypting the bytes that fake network was handed and checking
//      the plaintext, rather than trusting that the gate ran.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildPushPayload,
  assertLockScreenSafe,
  APPROVED_BODIES,
  APPROVED_BODY_KEYS,
  APPROVED_TITLES,
  APPROVED_URLS,
  APPROVED_TAGS,
  GENERIC_BODIES,
  PUSH_KINDS,
  DEFAULT_URL,
  PushPayloadRefused
} from "./payload.mjs";
import { send as webPushSend } from "../messaging/providers/web-push.mjs";
import { generateVapidKeys, b64u, decryptPayload } from "./crypto.mjs";

/* A real subscription's shape, with keys that are real curve points so a
   refusal cannot be mistaken for a crypto failure. The private half is kept so
   the test can decrypt what the fake network was handed. */
function realSubscription() {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  return {
    keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) },
    privateKey: ua.getPrivateKey()
  };
}

const VAPID = generateVapidKeys();
const ENV = {
  VAPID_PUBLIC_KEY: VAPID.publicKey,
  VAPID_PRIVATE_KEY: VAPID.privateKey,
  VAPID_SUBJECT: "mailto:support@fundhub.ai",
  // The fence must be explicitly down or nothing transmits, and then a test
  // that asserts "the network was never called" would pass for the wrong reason.
  MESSAGING_DRY_RUN: "0"
};

/* ═══════════════════════════════════════════════════════════════════════════
   THE REACHABLE SET, WRITTEN DOWN

   Every payload the gate can emit with the flag off, computed from the approved
   lists themselves rather than pasted, so adding an approved body cannot make
   this test quietly stop covering it. */
const REACHABLE_PAYLOADS = new Set();
const REACHABLE_BODIES = new Set(Object.values(APPROVED_BODIES));
for (const kind of PUSH_KINDS) {
  for (const body of Object.values(APPROVED_BODIES)) {
    for (const title of APPROVED_TITLES) {
      for (const url of APPROVED_URLS) {
        for (const tag of APPROVED_TAGS) {
          REACHABLE_PAYLOADS.add(JSON.stringify({ kind, title, body, url, tag }));
        }
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BODIES A REVIEWER ACTUALLY GOT ONTO A LOCKED SCREEN

   Every one of these was ALLOWED by the banned-word gate that used to be here,
   with the flag off, and the network really was called for the first one. They
   are quoted exactly. */
const REVIEWER_LEAKS = [
  "You owe 24000 this month. Pay 900 today.",
  "Pay 900 today.",
  "Your payment of 1200 is due Friday.",
  "Minimum due 95 by Friday.",
  "Balance 42.5k due.",
  "Your Prosper loan is past due.",
  "Bread Financial needs a payment.",
  "Best Egg statement is ready.",
  "Your Marcus account was updated.",
  "Your Ally auto loan needs attention.",
  "Your Credit One card is due.",
  "Your OppLoans payment is late.",
  "Your 90-day late was removed.",
  "Your late payments were deleted from your report.",
  "Your inquiry removal is done."
];

/* The sentences the old gate did catch. They must still be refused — a
   whitelist that let these back in would be a regression even though the reason
   for the refusal has changed. */
const OLD_FORBIDDEN = [
  "Your $4,200 payment is due Friday.",
  "You owe 4200 dollars on Friday.",
  "1,250.00 is due tomorrow.",
  "Your Amex statement closes in 2 days.",
  "Chase reported a new balance.",
  "Capital One is due soon.",
  "Your Experian score changed.",
  "TransUnion updated your file.",
  "Your FICO score is now 642.",
  "Your score moved to 712.",
  "Your dispute letters were mailed.",
  "A new collection appeared on your report.",
  "Your credit repair round is complete.",
  "A charge-off was removed.",
  "Your credit report was updated."
];

/* ═══════════════════════════════════════════════════════════════════════════
   THE GENERATOR

   A deterministic pseudo-random source, so a failure is reproducible from the
   seed printed in the assertion rather than being a coin toss in CI. */
function rng(seed) {
  let s = seed >>> 0;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

const LENDERS = [
  "Prosper", "Bread Financial", "Best Egg", "Marcus", "Ally", "Credit One",
  "OppLoans", "Upgrade", "Happy Money", "LendingPoint", "Achieve", "Reach Financial",
  "Rocket Loans", "Universal Credit", "Mission Lane", "Petal", "Chime", "Varo",
  "First Premier", "Merrick Bank", "Comenity", "Genesis FS", "Fortiva", "Milestone",
  "Amex", "Chase", "Capital One", "Discover"
];
const AMOUNTS = [
  "24000", "900", "1200", "95", "42.5k", "$4,200", "4200 dollars", "1,250.00",
  "twelve hundred", "2.4k", "USD 900", "900.00", "9 hundred", "١٢٠٠", "1200"
];
const CREDIT_WORDS = [
  "dispute", "inquiry removal", "late payment", "90-day late", "charge-off",
  "collection", "derogatory", "score", "bureau", "tradeline", "goodwill letter",
  "deletion", "round two", "past due", "delinquent"
];
const FRAMES = [
  (x) => `You owe ${x} this month.`,
  (x) => `Pay ${x} today.`,
  (x) => `Your ${x} needs attention.`,
  (x) => `${x} is due Friday.`,
  (x) => `Your ${x} was removed.`,
  (x) => `Minimum due ${x} by Friday.`,
  (x) => `${x}`,
  (x) => `Open FundHub. ${x}`,
  (x) => `A payment is due soon. Open FundHub. ${x}`
];

/** Mutations of an approved body. These are the nastiest cases: a string that
    looks approved to a human but is not the approved one. */
const MUTATORS = [
  (s) => s + " ",
  (s) => " " + s,
  (s) => s.toUpperCase(),
  (s) => s.toLowerCase(),
  (s) => s.replace(".", ""),
  (s) => s + "​",                       // zero-width space
  (s) => s.replace("FundHub", "FundHub "),
  (s) => s.replace("FundHub", "FundHμb"),    // greek mu, looks like a u
  (s) => s + " Pay 900 today.",
  (s) => "Pay 900 today. " + s,
  (s) => s.replace(/\.$/, "。"),         // ideographic full stop
  (s) => s.normalize("NFD"),
  (s) => s.replace(" ", " ")            // non-breaking space
];

function generateBody(next) {
  const roll = next();
  if (roll < 0.22) {
    return FRAMES[Math.floor(next() * FRAMES.length)](AMOUNTS[Math.floor(next() * AMOUNTS.length)]);
  }
  if (roll < 0.44) {
    return FRAMES[Math.floor(next() * FRAMES.length)](LENDERS[Math.floor(next() * LENDERS.length)]);
  }
  if (roll < 0.62) {
    return FRAMES[Math.floor(next() * FRAMES.length)](CREDIT_WORDS[Math.floor(next() * CREDIT_WORDS.length)]);
  }
  if (roll < 0.80) {
    const base = Object.values(APPROVED_BODIES)[Math.floor(next() * APPROVED_BODY_KEYS.length)];
    return MUTATORS[Math.floor(next() * MUTATORS.length)](base);
  }
  if (roll < 0.90) {
    // Pure noise, including characters a naive gate never considers.
    const n = 1 + Math.floor(next() * 60);
    let out = "";
    for (let i = 0; i < n; i++) out += String.fromCharCode(32 + Math.floor(next() * 200));
    return out;
  }
  // The exact approved text. These are the ONLY generated strings allowed to
  // survive, and if none of them did the test would be passing vacuously.
  return Object.values(APPROVED_BODIES)[Math.floor(next() * APPROVED_BODY_KEYS.length)];
}

/* ═══════════════════════════════════════════════════════════════════════════ */

describe("the whitelist — with detail off, the reachable set is closed", () => {
  test("the approved lists are internally consistent", () => {
    for (const kind of PUSH_KINDS) {
      assert.ok(Object.hasOwn(APPROVED_BODIES, kind), `kind ${kind} has no approved body`);
      assert.equal(GENERIC_BODIES[kind], APPROVED_BODIES[kind]);
    }
    assert.deepEqual(APPROVED_TITLES, ["FundHub"]);
    assert.equal(APPROVED_URLS[0], DEFAULT_URL);
    assert.equal(APPROVED_URLS.length, 23, "portal plus the 22 published lesson routes");
    assert.equal(new Set(APPROVED_URLS).size, APPROVED_URLS.length);
    for (const url of APPROVED_URLS.slice(1)) {
      assert.match(url, /^\/slideshows\/[a-z0-9-]+\.html$/);
    }
    assert.deepEqual([...APPROVED_TAGS], [...PUSH_KINDS]);
    // Every approved body must be readable over a shoulder. Spot-check the one
    // property a human would check: no digits at all, anywhere.
    for (const [key, body] of Object.entries(APPROVED_BODIES)) {
      assert.equal(/\d/.test(body), false, `approved body ${key} contains a digit`);
    }
  });

  test("PROPERTY: 20,000 generated bodies, and the only survivors are approved ones", () => {
    const next = rng(20260906);
    const survivors = new Set();
    let refused = 0;
    let allowed = 0;

    for (let i = 0; i < 20000; i++) {
      const body = generateBody(next);
      let json = null;
      try {
        json = buildPushPayload({ kind: "payment_due", body });
      } catch (err) {
        assert.ok(err instanceof PushPayloadRefused,
          `body ${JSON.stringify(body)} threw something other than a refusal: ${err && err.message}`);
        refused += 1;
        continue;
      }
      allowed += 1;
      const parsed = JSON.parse(json);
      // Nothing is edited: whatever came out must be a string we already wrote.
      assert.ok(REACHABLE_BODIES.has(parsed.body),
        `a body that is not on the approved list reached the payload: ${JSON.stringify(parsed.body)} (input ${JSON.stringify(body)})`);
      assert.ok(REACHABLE_PAYLOADS.has(json),
        `a payload outside the enumerated reachable set was built: ${json}`);
      survivors.add(parsed.body);
    }

    // Not vacuous: some inputs really did get through, and they are exactly the
    // approved sentences.
    assert.ok(allowed > 0, "nothing at all was allowed — the test proves nothing");
    assert.ok(refused > 15000, `only ${refused} of 20000 were refused; the generator is too tame`);
    for (const s of survivors) assert.ok(REACHABLE_BODIES.has(s));
    console.log(`      property: 20000 bodies → ${refused} refused, ${allowed} allowed, ${survivors.size} distinct survivors, all approved`);
  });

  test("PROPERTY: titles, urls and tags are whitelisted too, so the whole payload is enumerable", () => {
    const next = rng(777);
    const badTitles = ["Amex alert", "FundHub ", "fundhub", "You owe 24000", "", "FundHub — payment"];
    const badUrls = ["/app/client-portal.html?client=9f3a", "/app/other.html", "/", "//evil.example", "https://evil.example"];
    const badTags = ["you-owe-24000", "payment due", "PAYMENT_DUE", "x".repeat(50)];

    for (const title of badTitles) {
      if (title === "") {
        // Empty means "use the default", which is the approved title.
        assert.equal(JSON.parse(buildPushPayload({ kind: "update", title })).title, "FundHub");
        continue;
      }
      assert.throws(() => buildPushPayload({ kind: "update", title }), PushPayloadRefused,
        `title ${JSON.stringify(title)} was allowed`);
    }
    for (const url of badUrls) {
      assert.throws(() => buildPushPayload({ kind: "update", url }), PushPayloadRefused,
        `url ${JSON.stringify(url)} was allowed`);
    }
    for (const tag of badTags) {
      assert.throws(() => buildPushPayload({ kind: "update", tag }), PushPayloadRefused,
        `tag ${JSON.stringify(tag)} was allowed`);
    }

    // And a fuzz over all four fields at once: whatever is built is in the set.
    let built = 0;
    for (let i = 0; i < 5000; i++) {
      const pick = (arr) => arr[Math.floor(next() * arr.length)];
      const note = {
        kind: next() < 0.7 ? pick(PUSH_KINDS) : pick(["collections_call", "", "__proto__", "toString"]),
        body: next() < 0.5 ? generateBody(next) : undefined,
        bodyKey: next() < 0.3 ? pick([...APPROVED_BODY_KEYS, "__proto__", "nope", "constructor"]) : undefined,
        title: next() < 0.3 ? pick([...APPROVED_TITLES, ...badTitles]) : undefined,
        url: next() < 0.3 ? pick([...APPROVED_URLS, ...badUrls]) : undefined,
        tag: next() < 0.3 ? pick([...APPROVED_TAGS, ...badTags]) : undefined
      };
      let json = null;
      try { json = buildPushPayload(note); } catch (err) {
        assert.ok(err instanceof PushPayloadRefused, `threw a non-refusal: ${err && err.message}`);
        continue;
      }
      built += 1;
      assert.ok(REACHABLE_PAYLOADS.has(json), `payload outside the enumerated set: ${json}`);
    }
    assert.ok(built > 0, "nothing was built — the fuzz proves nothing");
    console.log(`      property: 5000 whole-payload cases → ${built} built, every one inside the ${REACHABLE_PAYLOADS.size}-payload reachable set`);
  });

  for (const body of REVIEWER_LEAKS) {
    test(`the reviewer's leak is refused: ${JSON.stringify(body)}`, () => {
      assert.throws(
        () => buildPushPayload({ kind: "payment_due", body }),
        (err) => err instanceof PushPayloadRefused && err.reason === "not_approved",
        "this reached the payload"
      );
    });
  }

  for (const body of OLD_FORBIDDEN) {
    test(`still refused: ${JSON.stringify(body)}`, () => {
      assert.throws(() => buildPushPayload({ kind: "payment_due", body }), PushPayloadRefused);
    });
  }
});

describe("buildPushPayload — the ordinary path still works", () => {
  test("the default body for every kind is approved and passes its own gate", () => {
    for (const kind of PUSH_KINDS) {
      const payload = JSON.parse(buildPushPayload({ kind }));
      assert.equal(payload.body, GENERIC_BODIES[kind]);
      assert.equal(payload.title, "FundHub");
      assert.equal(payload.url, DEFAULT_URL);
      assert.equal(payload.tag, kind);
      assert.doesNotThrow(() => assertLockScreenSafe(payload.body));
    }
  });

  test("the default payment body is the one the owner asked for", () => {
    assert.equal(JSON.parse(buildPushPayload({ kind: "payment_due" })).body,
      "A payment is due soon. Open FundHub.");
  });

  test("a different wording is chosen BY KEY, never by writing it", () => {
    const payload = JSON.parse(buildPushPayload({ kind: "payment_due", bodyKey: "payment_past_due" }));
    assert.equal(payload.body, APPROVED_BODIES.payment_past_due);
    // An unknown key is refused and names the keys that exist.
    assert.throws(() => buildPushPayload({ kind: "payment_due", bodyKey: "you_owe_24000" }),
      (err) => err.reason === "unknown_body_key" && /approved keys are/.test(err.message));
  });

  test("passing the approved sentence as text is accepted; one character off is not", () => {
    assert.doesNotThrow(() => buildPushPayload({ kind: "check_in", body: APPROVED_BODIES.check_in }));
    assert.throws(() => buildPushPayload({ kind: "check_in", body: APPROVED_BODIES.check_in + " " }),
      PushPayloadRefused);
  });

  test("nothing is ever silently stripped — the text is refused whole", () => {
    // A sanitiser would produce "Your  payment is due" and tell nobody. Prove
    // the function has no partial-success path by proving it throws.
    let built = null;
    try { built = buildPushPayload({ kind: "payment_due", body: "Your $4,200 payment is due." }); } catch (e) { /* expected */ }
    assert.equal(built, null);
  });

  test("with allowDetail true free text is allowed — the flag is real, and it is off by default", () => {
    const payload = JSON.parse(buildPushPayload(
      { kind: "payment_due", body: "Your $4,200 Amex payment is due Friday." },
      { allowDetail: true }
    ));
    assert.match(payload.body, /\$4,200/);
    // The caps and the same-origin check survive the flag.
    assert.throws(() => buildPushPayload({ kind: "update", body: "a".repeat(200) }, { allowDetail: true }), /the cap is/);
    assert.throws(() => buildPushPayload({ kind: "update", url: "https://evil.example" }, { allowDetail: true }), /same-origin path/);
    // And the default really is off: the same call without the option throws.
    assert.throws(() => buildPushPayload({ kind: "payment_due", body: "Your $4,200 Amex payment is due Friday." }));
  });

  test("nothing in the repository turns the flag on", async () => {
    // The claim in the module header, checked rather than asserted in prose.
    const { execFileSync } = await import("node:child_process");
    const root = new URL("../../", import.meta.url).pathname;
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "-n", "allowDetail"], { cwd: root, encoding: "utf8" });
    } catch (err) {
      // git grep exits 1 when there are no matches at all.
      hits = "";
    }
    const turnsItOn = hits.split("\n").filter((line) =>
      /allowDetail\s*[:=]\s*true/.test(line) &&
      !/^src\/push\/payload\.(mjs|test\.mjs):/.test(line) &&
      !/^src\/messaging\/providers\/web-push\.mjs:/.test(line));
    assert.deepEqual(turnsItOn, [],
      `something outside the push module sets allowDetail true:\n${turnsItOn.join("\n")}`);
  });

  test("an unknown kind is refused rather than defaulted", () => {
    assert.throws(() => buildPushPayload({ kind: "collections_call" }), /unknown push kind/);
  });

  test("an off-site tap target is refused", () => {
    assert.throws(() => buildPushPayload({ kind: "update", url: "https://evil.example" }), /same-origin path/);
    assert.throws(() => buildPushPayload({ kind: "update", url: "//evil.example" }), /same-origin path/);
    assert.doesNotThrow(() => buildPushPayload({ kind: "update", url: DEFAULT_URL }));
  });

  test("an over-long body is refused rather than cut mid-word on a phone", () => {
    assert.throws(() => buildPushPayload({ kind: "update", body: "a".repeat(200) }), PushPayloadRefused);
  });
});

describe("the send path refuses it too — the gate cannot be walked around", () => {
  const sub = realSubscription();

  test("PROPERTY: 250 generated bodies through the real provider, and the bytes on the wire are decrypted and checked", async () => {
    const next = rng(4242);
    let calls = 0;
    let sent = 0;
    const plaintexts = new Set();

    for (let i = 0; i < 250; i++) {
      const body = generateBody(next);
      let captured = null;
      const fetchImpl = async (url, init) => { calls += 1; captured = init; return new Response("", { status: 201 }); };

      const result = await webPushSend({
        id: `row-${i}`,
        to: "https://updates.push.services.mozilla.com/wpush/v2/abc",
        pushKeys: sub.keys,
        notification: { kind: "payment_due", body }
      }, { env: ENV, fetchImpl });

      if (result.status !== "sent") {
        assert.equal(captured, null, `the network was called for a refused body: ${JSON.stringify(body)}`);
        assert.equal(result.retryable, false, "a refusal must not be retried forever");
        continue;
      }
      sent += 1;
      assert.ok(captured && Buffer.isBuffer(captured.body), "nothing was posted");
      // Read what the phone would read: decrypt the record with the device's own
      // private key, rather than trusting that the gate ran.
      const clear = JSON.parse(decryptPayload(captured.body, {
        privateKey: sub.privateKey, authSecret: sub.keys.auth
      }).toString("utf8"));
      assert.ok(REACHABLE_BODIES.has(clear.body),
        `unapproved text reached the wire: ${JSON.stringify(clear.body)} (input ${JSON.stringify(body)})`);
      plaintexts.add(clear.body);
    }

    assert.ok(sent > 0, "nothing was ever sent — the test proves nothing");
    assert.equal(calls, sent, "the network was called more times than a send succeeded");
    for (const s of plaintexts) assert.ok(REACHABLE_BODIES.has(s));
    console.log(`      property: 250 sends attempted → ${sent} reached the fake network, every decrypted body approved`);
  });

  test("the reviewer's own reproduction — that exact notification never reaches the network now", async () => {
    let called = 0;
    const fetchImpl = async () => { called += 1; return new Response("", { status: 201 }); };
    const result = await webPushSend({
      id: "row-1",
      to: "https://updates.push.services.mozilla.com/wpush/v2/abc",
      pushKeys: sub.keys,
      notification: { kind: "payment_due", title: "FundHub", body: "You owe 24000 this month. Pay 900 today." }
    }, { env: ENV, fetchImpl });

    assert.equal(called, 0, "the push service was called with a client's money on the banner");
    assert.equal(result.status, "rejected");
    assert.equal(result.retryable, false);
    assert.match(result.error, /locked screen/);
  });

  test("a creditor name never reaches the network either", async () => {
    let called = 0;
    const fetchImpl = async () => { called += 1; return new Response("", { status: 201 }); };
    const result = await webPushSend({
      to: "https://fcm.googleapis.com/fcm/send/abc",
      pushKeys: sub.keys,
      notification: { kind: "statement_close", body: "Your Capital One statement closes tomorrow." }
    }, { env: ENV, fetchImpl });
    assert.equal(called, 0);
    assert.equal(result.status, "rejected");
  });

  test("the generic version of the same notification DOES go out", async () => {
    // The negative tests above are only meaningful if the positive path works.
    let seen = null;
    const fetchImpl = async (url, init) => { seen = { url, init }; return new Response("", { status: 201 }); };

    const result = await webPushSend({
      id: "row-2",
      to: "https://updates.push.services.mozilla.com/wpush/v2/abc",
      pushKeys: sub.keys,
      notification: { kind: "payment_due" }
    }, { env: ENV, fetchImpl });

    assert.equal(result.status, "sent", result.error || "");
    assert.ok(seen, "nothing was sent");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers["Content-Encoding"], "aes128gcm");
    assert.match(seen.init.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    assert.ok(Buffer.isBuffer(seen.init.body), "the body should be the encrypted record");
    // The plaintext must not be recoverable from the wire body.
    assert.equal(seen.init.body.includes(Buffer.from("payment", "utf8")), false);
  });

  test("a dead subscription reports itself as gone rather than as a retryable failure", async () => {
    for (const status of [404, 410]) {
      const result = await webPushSend({
        to: "https://fcm.googleapis.com/fcm/send/dead",
        pushKeys: sub.keys,
        notification: { kind: "update" }
      }, { env: ENV, fetchImpl: async () => new Response("", { status }) });
      assert.equal(result.gone, true, `HTTP ${status} was not treated as gone`);
      assert.equal(result.status, "rejected");
    }
  });

  test("a push service having a bad hour is retryable, not permanent", async () => {
    const result = await webPushSend({
      to: "https://fcm.googleapis.com/fcm/send/x",
      pushKeys: sub.keys,
      notification: { kind: "update" }
    }, { env: ENV, fetchImpl: async () => new Response("", { status: 500 }) });
    assert.equal(result.status, "failed");
    assert.equal(result.retryable, true);
  });

  test("with no VAPID key nothing is sent, and it is retryable so it goes out once configured", async () => {
    let called = 0;
    const result = await webPushSend({
      to: "https://fcm.googleapis.com/fcm/send/x",
      pushKeys: sub.keys,
      notification: { kind: "update" }
    }, { env: { MESSAGING_DRY_RUN: "0" }, fetchImpl: async () => { called += 1; return new Response(""); } });
    assert.equal(called, 0);
    assert.equal(result.status, "failed");
    assert.match(result.error, /not configured/);
  });

  test("the messaging fence holds it when MESSAGING_DRY_RUN is not explicitly off", async () => {
    let called = 0;
    const result = await webPushSend({
      to: "https://fcm.googleapis.com/fcm/send/x",
      pushKeys: sub.keys,
      notification: { kind: "update" }
    }, {
      env: { ...ENV, MESSAGING_DRY_RUN: undefined },
      fetchImpl: async () => { called += 1; return new Response(""); }
    });
    assert.equal(called, 0, "the fence let a send through");
    assert.equal(result.status, "failed");
  });
});

describe("the provider's shape", () => {
  test("it wears the same contract every other provider does, and ships unrouted", async () => {
    const p = await import("../messaging/providers/web-push.mjs");
    assert.equal(typeof p.PROVIDER, "string");
    assert.ok(p.CHANNELS instanceof Set && p.CHANNELS.size > 0);
    assert.equal(typeof p.ADDRESS_FIELD, "string");
    assert.equal(typeof p.send, "function");
    assert.equal(p.ENABLED, false, "web push is not routed; ENABLED must say so");
    assert.equal(p.TRANSMITS, true);

    // And it really is absent from the registry, so nothing in the message queue
    // can reach it by accident.
    const registry = await import("../messaging/providers/index.mjs");
    assert.equal(registry.resolve("web_push"), null,
      "web_push is in the provider registry — the dispatcher could now route to it");
  });
});
