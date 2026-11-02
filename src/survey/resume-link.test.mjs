import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  RESUME_BASE_URL, RESUME_TTL_SECONDS, readSurveyResumeToken, surveyResumeSecret, surveyResumeToken, surveyResumeUrl
} from "./resume-link.mjs";

const ORG = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CLIENT = "c3b1a9d2-5f4e-4c1a-8b7d-2e6f9a0b1c3d";
const OTHER_CLIENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SECRET = "unit-test-resume-secret-0123456789abcdef0123456789";
const ENV = { UNSUBSCRIBE_TOKEN_SECRET: SECRET };
const NOW = Date.parse("2026-10-31T17:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const EPOCH_DAY = Date.UTC(2026, 0, 1) / DAY;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const mint = (over = {}) => surveyResumeToken({ clientId: CLIENT, now: () => NOW, env: ENV, ...over });
const read = (token, over = {}) => readSurveyResumeToken(token, { now: () => NOW, env: ENV, ...over });

/* The wire format written out a second time, independently of the module: 16 bytes of
   client, the expiry as base36 text, and the first 16 bytes of the HMAC-SHA256 of the
   scheme, the client's bytes and that text. Building tokens here is how the tests can
   make a validly signed token the module would never write. */
function build({ client = CLIENT, expiry, secret = SECRET, scheme = "survey-resume-v1" }) {
  const bytes = Buffer.from(client.replace(/-/g, ""), "hex");
  const tag = createHmac("sha256", secret).update(`${scheme}|`).update(bytes).update(expiry).digest().subarray(0, 16);
  return bytes.toString("base64url") + expiry + tag.toString("base64url");
}
const dayOf = (ms) => Math.floor(ms / DAY) - EPOCH_DAY;

/* Change one character of a token to a different, valid one. */
function flip(token, at) {
  const next = ALPHABET[(ALPHABET.indexOf(token[at]) + 1) % ALPHABET.length];
  return token.slice(0, at) + next + token.slice(at + 1);
}

function quietly(fn) {
  const real = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(" "));
  try { return { value: fn(), warnings }; } finally { console.warn = real; }
}

test("a good token reads back the client", () => {
  assert.deepEqual(read(mint()), { clientId: CLIENT });
});

test("the token is 46 characters: 22 of client, 2 of expiry day, 22 of tag — and nothing about the person", () => {
  const token = mint();
  assert.equal(token.length, 46);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  // The client part is the 16 bytes of the uuid. The expiry is the 30th day on, as whole days since
  // 2026-01-01 in base36. The tag is 16 bytes. There is no room for an email, a phone, a name or a company.
  assert.equal(Buffer.from(token.slice(0, 22), "base64url").toString("hex"), CLIENT.replace(/-/g, ""));
  assert.equal(token.slice(22, 24), dayOf(NOW + 30 * DAY).toString(36));
  assert.equal(token.slice(22, 24), "99", "30 November 2026");
  assert.equal(Buffer.from(token.slice(24), "base64url").length, 16);
  const extras = mint({ email: "pat.lee@example.com", phone: "+15551234567", name: "Pat Lee", orgId: ORG });
  assert.equal(extras, token, "personal fields passed in change nothing; neither does the company");
});

test("the wire format is pinned: a token built by hand from the spec is the token the module writes", () => {
  assert.equal(mint(), build({ expiry: "99" }));
  assert.deepEqual(read(build({ expiry: "99" })), { clientId: CLIENT });
});

test("the link is /apply?r= and short enough for a text: 79 characters", () => {
  const url = surveyResumeUrl({ orgId: ORG, clientId: CLIENT, now: () => NOW, env: ENV });
  assert.ok(url.startsWith(`${RESUME_BASE_URL}?r=`));
  assert.equal(RESUME_BASE_URL, "https://apply.fundhub.ai/apply");
  assert.equal(url.length, 33 + 46);
  assert.deepEqual(read(new URL(url).searchParams.get("r")), { clientId: CLIENT });
});

test("a tampered token is null, whichever character was touched", () => {
  const token = mint();
  for (let at = 0; at < token.length; at++) {
    assert.equal(read(flip(token, at)), null, `flipped character ${at} of ${token.length}`);
  }
  assert.equal(read(token.slice(0, -1)), null, "truncated");
  assert.equal(read(token + "A"), null, "extended");
  assert.equal(read(token.slice(24) + token.slice(22, 24) + token.slice(0, 22)), null, "parts swapped");
  assert.equal(read(token.slice(0, 22) + "zz" + token.slice(24)), null, "an expiry nobody signed");
});

test("a token is for one client: another client's id cannot be swapped in, and each client's own token reads as them", () => {
  const mine = mint();
  const spliced = Buffer.from(OTHER_CLIENT.replace(/-/g, ""), "hex").toString("base64url") + mine.slice(22);
  assert.equal(read(spliced), null, "the other client's id with my expiry and my tag");
  assert.deepEqual(read(mint({ clientId: OTHER_CLIENT })), { clientId: OTHER_CLIENT });
  assert.notEqual(mint({ clientId: OTHER_CLIENT }), mine);
});

test("a token signed with a different key is null", () => {
  const token = mint({ env: { UNSUBSCRIBE_TOKEN_SECRET: "a-completely-different-secret-0123456789abcdef" } });
  assert.equal(read(token), null);
  assert.equal(read(build({ expiry: "99", secret: "a-completely-different-secret-0123456789abcdef" })), null);
});

test("expires after 30 days, counted in whole UTC days: never early, a day's grace at most", () => {
  assert.equal(RESUME_TTL_SECONDS, 30 * 24 * 60 * 60);
  const token = mint(); // made 31 October 17:00 UTC; good through the end of 30 November
  assert.ok(read(token, { now: () => NOW + 29 * DAY }), "day 29 still works");
  assert.ok(read(token, { now: () => NOW + 30 * DAY }), "the 30-day mark itself still works");
  assert.ok(read(token, { now: () => Date.parse("2026-11-30T23:59:59.999Z") }), "the last millisecond of the 30th day");
  assert.equal(read(token, { now: () => Date.parse("2026-12-01T00:00:00.000Z") }), null, "the next day it is dead");
  assert.equal(read(token, { now: () => NOW + 31 * DAY }), null);
  assert.equal(read(mint({ now: () => NOW - 31 * DAY })), null, "made 31 days ago");
  assert.ok(read(mint({ now: () => NOW - 29 * DAY })), "made 29 days ago");
});

test("whatever hour a link is made, it is good for at least 30 days and dead by 31", () => {
  for (let h = 0; h < 72; h += 3) {
    const madeAt = Date.parse("2026-10-31T00:00:00Z") + h * 60 * 60 * 1000;
    const token = mint({ now: () => madeAt });
    assert.ok(read(token, { now: () => madeAt + 30 * DAY }), `made +${h}h: alive at 30 days`);
    assert.equal(read(token, { now: () => madeAt + 31 * DAY }), null, `made +${h}h: dead at 31 days`);
  }
});

test("malformed input is null and never throws", () => {
  const good = mint();
  for (const bad of ["", " ", "abc", "!".repeat(46), "A".repeat(46), "A".repeat(44), "A".repeat(51), "A".repeat(100),
    good.replace(/.$/, "="), good + "=", `${good} `, ` ${good}`, good.toUpperCase(), null, undefined, 123, {}, [], [good]]) {
    assert.equal(read(bad), null, String(bad).slice(0, 20));
  }
});

test("the signature is scoped to this purpose: a tag made under another scheme does not verify", () => {
  assert.equal(read(build({ expiry: "99", scheme: "unsub-v1" })), null);
  assert.equal(read(build({ expiry: "99", scheme: "survey-resume-v2" })), null);
  assert.deepEqual(read(build({ expiry: "99", scheme: "survey-resume-v1" })), { clientId: CLIENT });
});

test("one spelling per token: the spare bits at the end of a base64 part cannot be rewritten", () => {
  const token = mint();
  // The last character of the client part and of the tag each carry four bits that decode to nothing.
  // Setting them gives a different string that decodes to the same bytes. It must not verify.
  for (const [at, label] of [[21, "client"], [45, "tag"]]) {
    const spare = ALPHABET.indexOf(token[at]) | 0b0001;
    const variant = token.slice(0, at) + ALPHABET[spare] + token.slice(at + 1);
    assert.notEqual(variant, token);
    assert.deepEqual(
      Buffer.from(variant.slice(at < 22 ? 0 : 24, at < 22 ? 22 : 46), "base64url"),
      Buffer.from(token.slice(at < 22 ? 0 : 24, at < 22 ? 22 : 46), "base64url"),
      `${label}: the variant decodes to the same bytes`
    );
    assert.equal(read(variant), null, `${label}: and is refused`);
  }
  // A signed expiry with a leading zero is a different spelling of the same day.
  assert.equal(read(build({ expiry: "099" })), null);
  assert.equal(read(build({ expiry: "0" })), null, "and the zero spelling of day 0 is the one-character form, which has expired");
  // Upper case is not base36 as we write it.
  assert.equal(read(build({ expiry: "9A" })), null);
});

test("an expiry of any length up to six characters reads back: the token grows after mid-2029", () => {
  const year2035 = Date.parse("2035-01-01T00:00:00Z");
  const token = mint({ now: () => year2035 });
  assert.equal(token.length, 47);
  assert.deepEqual(read(token, { now: () => year2035 }), { clientId: CLIENT });
  assert.equal(read(token, { now: () => year2035 + 32 * DAY }), null);
  assert.deepEqual(read(build({ expiry: dayOf(Date.parse("2100-01-01T00:00:00Z")).toString(36) }), { now: () => Date.parse("2099-12-31T00:00:00Z") }), { clientId: CLIENT });
});

test("a clock before the epoch cannot make a token, and the link falls back to the plain page", () => {
  const before = Date.parse("2025-06-01T00:00:00Z");
  assert.throws(() => mint({ now: () => before }), /outside the years a link can carry/);
  assert.throws(() => mint({ now: () => NaN }));
  const { value: url, warnings } = quietly(() => surveyResumeUrl({ clientId: CLIENT, now: () => before, env: ENV }));
  assert.equal(url, "https://apply.fundhub.ai/apply");
  assert.ok(warnings.some((w) => /survey-resume/.test(w)));
});

test("it uses the unsubscribe key, and falls back to the document key the same way", () => {
  assert.equal(surveyResumeSecret({ UNSUBSCRIBE_TOKEN_SECRET: SECRET }), SECRET);
  const doc = "document-url-secret-0123456789abcdef0123456789ab";
  assert.equal(surveyResumeSecret({ DOCUMENT_URL_SECRET: doc }), doc);
  assert.equal(surveyResumeSecret({ UNSUBSCRIBE_TOKEN_SECRET: SECRET, DOCUMENT_URL_SECRET: doc }), SECRET);
  const viaDoc = surveyResumeToken({ clientId: CLIENT, now: () => NOW, env: { DOCUMENT_URL_SECRET: doc } });
  assert.deepEqual(read(viaDoc, { env: { DOCUMENT_URL_SECRET: doc } }), { clientId: CLIENT });
});

test("no key: the token refuses, the link falls back to the plain apply page, a read is null", () => {
  assert.throws(() => surveyResumeToken({ clientId: CLIENT, env: {} }), /refusing to sign survey resume links/);
  assert.throws(() => surveyResumeToken({ clientId: CLIENT, env: { UNSUBSCRIBE_TOKEN_SECRET: "too-short" } }));
  const { value: url, warnings } = quietly(() => surveyResumeUrl({ orgId: ORG, clientId: CLIENT, env: {} }));
  assert.equal(url, "https://apply.fundhub.ai/apply", "a working door, never a blank link");
  assert.ok(warnings.some((w) => /survey-resume/.test(w) && /missing or too short/.test(w)), String(warnings));
  assert.equal(readSurveyResumeToken(mint(), { env: {} }), null);
});

test("an id that is not a uuid never makes a token", () => {
  assert.throws(() => surveyResumeToken({ clientId: "cl-1", env: ENV }), /uuid/);
  assert.throws(() => surveyResumeToken({ env: ENV }));
  assert.throws(() => surveyResumeToken());
  const { value: url } = quietly(() => surveyResumeUrl({ orgId: "org-1", clientId: "cl-1", env: ENV }));
  assert.equal(url, "https://apply.fundhub.ai/apply");
});

test("the company is not in the token: it is accepted for the shared call shape and ignored", () => {
  const a = surveyResumeUrl({ orgId: ORG, clientId: CLIENT, now: () => NOW, env: ENV });
  const b = surveyResumeUrl({ orgId: "anything", clientId: CLIENT, now: () => NOW, env: ENV });
  const c = surveyResumeUrl({ clientId: CLIENT, now: () => NOW, env: ENV });
  assert.equal(a, b);
  assert.equal(a, c);
});

test("an upper-case client id is accepted and read back lower-case", () => {
  const token = surveyResumeToken({ clientId: CLIENT.toUpperCase(), now: () => NOW, env: ENV });
  assert.equal(token, mint());
  assert.deepEqual(read(token), { clientId: CLIENT });
});

test("the clock may be a function, a number or a Date", () => {
  const a = surveyResumeToken({ clientId: CLIENT, now: () => NOW, env: ENV });
  const b = surveyResumeToken({ clientId: CLIENT, now: NOW, env: ENV });
  const c = surveyResumeToken({ clientId: CLIENT, now: new Date(NOW), env: ENV });
  assert.equal(a, b);
  assert.equal(a, c);
  assert.ok(read(a, { now: new Date(NOW + DAY) }));
});

test("a person's link is the same all UTC day, so a replayed send is stable, and new the next day", () => {
  assert.equal(mint(), mint());
  assert.equal(mint(), mint({ now: () => NOW + 5 * 60 * 60 * 1000 }), "same day, 22:00 UTC");
  assert.notEqual(mint(), mint({ now: () => NOW + 7 * 60 * 60 * 1000 }), "00:00 UTC the next day");
});
