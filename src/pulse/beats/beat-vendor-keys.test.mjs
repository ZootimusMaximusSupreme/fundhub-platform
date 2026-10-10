// Tests for beat-vendor-keys.mjs: a PASS and a FAIL for every vendor, the masked-key skips, the
// exact requests that go out (GET only, the right header, the right host), and that no key, account
// id or answer body ever reaches the result. No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-vendor-keys.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource, missingFixGuidePaths, fixGuideProblems } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { CHECKOUT_API_KEY_ENVS, DEFAULT_CHECKOUT_API_BASE } from "../../payments/commas-api.mjs";
import { TWILIO_DEFAULT_BASE, RESEND_DEFAULT_BASE } from "../coverage/gap-keys.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const FILE = path.join(HERE, "beat-vendor-keys.mjs");

// Recognisable fakes, so a leak is easy to see.
const SID = "ACtestsid0000000000000000000000ff";
const TOKEN = "TWILIO-TOKEN-should-never-be-printed";
const RESEND = "RESEND-KEY-should-never-be-printed";
const COMMAS = "COMMAS-KEY-should-never-be-printed";
const ENV = { TWILIO_SEND_ACCOUNT_SID: SID, TWILIO_SEND_AUTH_TOKEN: TOKEN, RESEND_API_KEY: RESEND, CORTANA_COMMAS_API_KEY: COMMAS };

const U = {
  twilio: `GET https://api.twilio.com/2010-04-01/Accounts/${SID}.json`,
  resend: "GET https://api.resend.com/domains",
  commas: "GET https://www.fanbasis.com/public-api/checkout-sessions/transactions?page=1&per_page=1"
};
const OK = {
  [U.twilio]: { status: 200, body: JSON.stringify({ status: "active", auth_token: TOKEN, sid: SID, friendly_name: "ACME PRIVATE" }) },
  [U.resend]: { status: 200, body: JSON.stringify({ data: [{ name: "private-domain.example" }] }) },
  [U.commas]: { status: 200, body: JSON.stringify({ status: "success", data: { transactions: [{ email: "buyer@example.com" }] } }) }
};
const world = (over = {}) => ({ env: ENV, http: { ...OK }, ...over });
const withHttp = (patch, over = {}) => world({ http: { ...OK, ...patch }, ...over });
const go = (over) => runBeat(beat, makeFakeCtx(beat, over));
const redAt = (r, step) => { assert.equal(r.ok, false, `expected red, got green: ${r.detail}`); assert.equal(r.step, step, r.detail); return r; };

/* ---------------- the beat is a valid beat ---------------- */

test("it is a valid beat: id, kind, damp 2, declared hosts, fix guide, self test, static pin", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-vendor-keys.mjs" }), []);
  assert.equal(beat.kind, "probe");
  assert.equal(beat.damp, 2, "a vendor can have a bad moment, so two reds in a row");
  assert.deepEqual(beat.covers, []);
  assert.deepEqual(beat.steps, ["twilio-key", "resend-key", "commas-key"]);
  assert.deepEqual(beat.reads.map((r) => [r.host, r.methods.join()]), [["api.twilio.com", "GET"], ["api.resend.com", "GET"], ["www.fanbasis.com", "GET"]]);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.deepEqual(fixGuideProblems(beat.fixGuide), []);
  assert.deepEqual(missingFixGuidePaths(beat.fixGuide, (p) => fs.existsSync(path.join(ROOT, p))).missing, []);
  assert.deepEqual(pinBeatSource(fs.readFileSync(FILE, "utf8")), []);
});

test("the addresses and key names are the ones the repo already uses", () => {
  assert.equal(beat.TWILIO_HOST, new URL(TWILIO_DEFAULT_BASE).hostname);
  assert.equal(beat.RESEND_HOST, new URL(RESEND_DEFAULT_BASE).hostname);
  assert.equal(beat.COMMAS_DEFAULT_BASE, DEFAULT_CHECKOUT_API_BASE);
  assert.equal(beat.COMMAS_HOST, new URL(DEFAULT_CHECKOUT_API_BASE).hostname);
  assert.deepEqual([...beat.COMMAS_KEY_ENVS], [...CHECKOUT_API_KEY_ENVS], "same keys, same order as checkoutConfig()");
  const commasApi = fs.readFileSync(path.join(ROOT, "src/payments/commas-api.mjs"), "utf8");
  assert.ok(commasApi.includes(`"${beat.COMMAS_BASE_ENV}"`), "the base-URL setting name is the real one");
});

/* ---------------- all green ---------------- */

test("PASS: three keys accepted; exactly three GETs go out, each with its own header, and nothing else", async () => {
  const seen = [];
  const http = async (method, url, opts) => { seen.push({ method, url, headers: opts?.headers }); return OK[`${method} ${url}`]; };
  const ctx = makeFakeCtx(beat, { env: ENV, http });
  const r = await runBeat(beat, ctx);
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(r.notRun, []);
  assert.deepEqual(r.skipped, []);
  assert.match(r.detail, /Twilio, Resend, Commas took our keys/);
  assert.deepEqual(seen.map((s) => s.method), ["GET", "GET", "GET"]);
  assert.deepEqual(seen.map((s) => new URL(s.url).host), ["api.twilio.com", "api.resend.com", "www.fanbasis.com"]);
  const tw = seen[0].headers;
  assert.equal(tw.Authorization, `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`);
  assert.equal(seen[1].headers.Authorization, `Bearer ${RESEND}`);
  assert.equal(seen[2].headers["x-api-key"], COMMAS);
  assert.deepEqual(ctxLog(ctx).refused, []);
  assert.deepEqual(ctxLog(ctx).http.map((h) => h.host), ["api.twilio.com", "api.resend.com", "www.fanbasis.com"]);
});

test("no key, account id, token, header or answer body ever reaches the result", async () => {
  const bodies = [TOKEN, SID, RESEND, COMMAS, "ACME PRIVATE", "private-domain.example", "buyer@example.com", Buffer.from(`${SID}:${TOKEN}`).toString("base64")];
  const check = (r) => {
    const out = JSON.stringify(r);
    for (const s of bodies) assert.ok(!out.includes(s), `leaked: ${s.slice(0, 12)}...`);
  };
  check(await go(world()));
  check(await go(withHttp({ [U.twilio]: { status: 401, body: JSON.stringify({ code: 20003, message: `bad auth ${TOKEN}`, sid: SID }) } })));
  check(await go(withHttp({ [U.resend]: { status: 400, body: JSON.stringify({ message: `API key is invalid ${RESEND}` }) } })));
  check(await go(withHttp({ [U.commas]: { status: 200, body: `<html>${COMMAS} buyer@example.com</html>` } })));
  check(await go(withHttp({ [U.twilio]: { status: 0, ok: false, class: "network", error: `connect ECONNRESET ${TOKEN}` } })));
});

/* ---------------- twilio-key ---------------- */

test("FAIL twilio-key: 401 and 403 are red and name Twilio", async () => {
  for (const status of [401, 403]) {
    const r = redAt(await go(withHttp({ [U.twilio]: { status, body: '{"code":20003}' } })), "twilio-key");
    assert.match(r.detail, new RegExp(`Twilio refused our text key \\(HTTP ${status}\\)`));
    assert.match(r.detail, /No text can leave/);
  }
});

test("FAIL twilio-key: a suspended or closed account is red even though the key was taken", async () => {
  for (const status of ["suspended", "closed", "SUSPENDED"]) {
    const r = redAt(await go(withHttp({ [U.twilio]: { status: 200, body: JSON.stringify({ status }) } })), "twilio-key");
    assert.match(r.detail, new RegExp(`account is ${status.toLowerCase()}`));
  }
});

test("PASS twilio-key: an active account, and a 200 with an unreadable body, are accepted", async () => {
  assert.equal((await go(world())).ok, true);
  assert.equal((await go(withHttp({ [U.twilio]: { status: 200, body: "not json" } }))).ok, true);
});

/* ---------------- resend-key ---------------- */

test("PASS resend-key: 200 is accepted; a send-only key (401 restricted_api_key) is accepted too", async () => {
  assert.equal((await go(world())).ok, true);
  const sendOnly = await go(withHttp({ [U.resend]: { status: 401, body: '{"name":"restricted_api_key","message":"This API key is restricted to only send emails"}' } }));
  assert.equal(sendOnly.ok, true, sendOnly.detail);
});

test("FAIL resend-key: 400 'API key is invalid', a plain 401 and a 403 are red and name Resend", async () => {
  const bad = redAt(await go(withHttp({ [U.resend]: { status: 400, body: '{"message":"API key is invalid"}' } })), "resend-key");
  assert.match(bad.detail, /Resend says our email key is invalid \(HTTP 400\)/);
  const u401 = redAt(await go(withHttp({ [U.resend]: { status: 401, body: '{"name":"missing_api_key"}' } })), "resend-key");
  assert.match(u401.detail, /Resend refused our email key \(HTTP 401\)/);
  const u403 = redAt(await go(withHttp({ [U.resend]: { status: 403, body: "{}" } })), "resend-key");
  assert.match(u403.detail, /HTTP 403/);
});

/* ---------------- commas-key ---------------- */

test("PASS commas-key: 200 with status success is accepted", async () => {
  assert.equal((await go(world())).ok, true);
});

test("FAIL commas-key: 401 and 403 are red and name Commas; 200 in a shape we do not know is red too", async () => {
  for (const status of [401, 403]) {
    const r = redAt(await go(withHttp({ [U.commas]: { status, body: '{"status":"error","message":"Invalid API key or unauthorized user context"}' } })), "commas-key");
    assert.match(r.detail, new RegExp(`Commas refused our checkout key \\(HTTP ${status}\\)`));
  }
  const shape = redAt(await go(withHttp({ [U.commas]: { status: 200, body: "<html>sign in</html>" } })), "commas-key");
  assert.match(shape.detail, /shape we do not know/);
  const err = redAt(await go(withHttp({ [U.commas]: { status: 200, body: '{"status":"error"}' } })), "commas-key");
  assert.match(err.detail, /shape we do not know/);
});

test("commas-key uses the first key that is set, in checkoutConfig's order (CORTANA first), even if the second is real", async () => {
  const seen = [];
  const http = async (method, url, opts) => { seen.push(opts.headers["x-api-key"]); return OK[`${method} ${url}`]; };
  const env = { CORTANA_COMMAS_API_KEY: "first-key", FANBASIS_CHECKOUT_API_KEY: "second-key" };
  await go({ env, http });
  assert.deepEqual(seen, ["first-key"]);
  seen.length = 0;
  await go({ env: { FANBASIS_CHECKOUT_API_KEY: "second-key" }, http });
  assert.deepEqual(seen, ["second-key"]);
  // a mask in the first slot is not skipped over (checkoutConfig would pick it, and so does the beat): the step is skipped
  seen.length = 0;
  const r = await go({ env: { CORTANA_COMMAS_API_KEY: "****************1234", FANBASIS_CHECKOUT_API_KEY: "second-key" }, http });
  assert.deepEqual(seen, []);
  assert.ok(r.skipped.includes("commas-key"));
  assert.match(r.steps.find((s) => s.name === "commas-key").why, /Commas was not asked/);
});

/* ---------------- the vendor having a bad moment ---------------- */

test("FAIL (damped by the runner): a 5xx, a timeout, a network error and a surprise status are red at the right vendor", async () => {
  const cases = [
    ["twilio-key", U.twilio, { status: 503 }, /Twilio answered HTTP 503/],
    ["twilio-key", U.twilio, { status: 0, ok: false, class: "timeout", error: "timed out" }, /Twilio did not answer \(timeout\)/],
    ["resend-key", U.resend, { status: 502 }, /Resend answered HTTP 502/],
    ["resend-key", U.resend, { status: 429, body: '{"name":"rate_limit_exceeded"}' }, /Resend answered HTTP 429/],
    ["commas-key", U.commas, { status: 0, ok: false, class: "network", error: "reset" }, /Commas did not answer \(network\)/],
    ["commas-key", U.commas, { status: 500 }, /Commas answered HTTP 500/],
    ["commas-key", U.commas, { status: 0, ok: false, class: "blocked", error: "fence" }, /web fence is holding/]
  ];
  for (const [step, url, answer, rx] of cases) {
    const r = redAt(await go(withHttp({ [url]: answer })), step);
    assert.match(r.detail, rx);
  }
  assert.equal(beat.damp, 2);
});

test("all three steps run even when the first is red, and the result names every vendor that failed", async () => {
  const ctx = makeFakeCtx(beat, withHttp({
    [U.twilio]: { status: 401 },
    [U.commas]: { status: 403 }
  }));
  const r = await runBeat(beat, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.step, "twilio-key", "the first red vendor is where it stopped");
  assert.match(r.detail, /Twilio refused/);
  assert.match(r.detail, /Commas refused/);
  assert.ok(!/Resend/.test(r.detail), "Resend was fine");
  assert.deepEqual(r.steps.map((s) => [s.name, s.ok]), [["twilio-key", false], ["resend-key", true], ["commas-key", false]]);
  assert.equal(ctxLog(ctx).http.length, 3, "the three vendors are all asked");
});

/* ---------------- masked or missing keys: a skip, never a red ---------------- */

test("a masked or missing key is skipped with a reason; the other vendors still run and can still go red", async () => {
  const laptop = { ...ENV, TWILIO_SEND_AUTH_TOKEN: "****************f377", RESEND_API_KEY: "" };
  const r = await go({ env: laptop, http: OK });
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(r.skipped, ["twilio-key", "resend-key"]);
  assert.match(r.detail, /Commas took our key/);
  assert.match(r.detail, /Not asked: Twilio, Resend/);
  assert.ok(r.steps.filter((s) => s.skipped).every((s) => /was not asked/.test(s.why)));
  // the one that is asked can still be red
  redAt(await go({ env: laptop, http: { ...OK, [U.commas]: { status: 401 } } }), "commas-key");
  // with nothing to ask, it is green and says so
  const none = await go({ env: {}, http: {} });
  assert.equal(none.ok, true);
  assert.deepEqual(none.skipped, ["twilio-key", "resend-key", "commas-key"]);
  assert.match(none.detail, /No key was asked/);
});

/* ---------------- on the server a missing key is a red, not a quiet green ---------------- */

const LIVE = { NETLIFY: "true" };

test("FAIL on the server: no keys at all is red at the first vendor and names all three (the hour is not green)", async () => {
  const r = redAt(await go({ env: { ...LIVE }, http: {} }), "twilio-key");
  assert.match(r.detail, /TWILIO_SEND_ACCOUNT_SID and TWILIO_SEND_AUTH_TOKEN are empty or only stars on the server/);
  assert.match(r.detail, /RESEND_API_KEY is empty or only stars on the server/);
  assert.match(r.detail, /CORTANA_COMMAS_API_KEY and FANBASIS_CHECKOUT_API_KEY are empty or only stars on the server/);
  assert.match(r.detail, /No customer text can leave/);
  assert.match(r.detail, /No email can leave/);
});

test("FAIL on the server: one missing or star-only key is red at its own vendor, the others still run", async () => {
  const resend = redAt(await go({ env: { ...LIVE, ...ENV, RESEND_API_KEY: "" }, http: OK }), "resend-key");
  assert.match(resend.detail, /RESEND_API_KEY is empty or only stars on the server\. No email can leave/);
  const twilio = redAt(await go({ env: { ...LIVE, ...ENV, TWILIO_SEND_AUTH_TOKEN: "****************f377" }, http: OK }), "twilio-key");
  assert.match(twilio.detail, /^TWILIO_SEND_AUTH_TOKEN is empty or only stars on the server/);
  assert.ok(!/TWILIO_SEND_ACCOUNT_SID/.test(twilio.detail), "only the part that is missing is named");
  const commas = redAt(await go({ env: { ...LIVE, ...ENV, CORTANA_COMMAS_API_KEY: "****" }, http: OK }), "commas-key");
  assert.match(commas.detail, /No buyer can get a card page/);
  // a missing key does not stop the other vendors from being asked
  const ctx = makeFakeCtx(beat, { env: { ...LIVE, ...ENV, RESEND_API_KEY: "" }, http: OK });
  await runBeat(beat, ctx);
  assert.equal(ctxLog(ctx).http.length, 2, "Twilio and Commas are still asked");
  // the value of a key is never in the red
  assert.ok(![TOKEN, RESEND, COMMAS].some((k) => JSON.stringify(resend).includes(k)));
});

test("PASS on the server: all keys set and accepted is green, with nothing marked NOT CHECKED", async () => {
  const r = await go({ env: { ...LIVE, ...ENV }, http: OK });
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(r.skipped, []);
  assert.ok(!/NOT CHECKED/.test(r.detail));
});

test("on the server an off-host base-URL setting stays a skip, but the green says NOT CHECKED in plain words", async () => {
  const r = await go({ env: { ...LIVE, ...ENV, RESEND_BASE_URL: "https://evil.example.com" }, http: OK });
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(r.skipped, ["resend-key"]);
  assert.match(r.detail, /NOT CHECKED on the server: Resend/);
  // on a laptop the same setting is a plain skip with no such words
  const laptop = await go({ env: { ...ENV, RESEND_BASE_URL: "https://evil.example.com" }, http: OK });
  assert.ok(!/NOT CHECKED/.test(laptop.detail));
});

test("a half-set Twilio pair (account id but a mask for the token, or the other way) is skipped, not sent", async () => {
  const seen = [];
  const http = async (method, url) => { seen.push(url); return OK[`${method} ${url}`]; };
  for (const env of [{ ...ENV, TWILIO_SEND_AUTH_TOKEN: "****" }, { ...ENV, TWILIO_SEND_ACCOUNT_SID: "" }, { ...ENV, TWILIO_SEND_ACCOUNT_SID: undefined }]) {
    seen.length = 0;
    const r = await go({ env, http });
    assert.deepEqual(r.skipped, ["twilio-key"]);
    assert.ok(!seen.some((u) => u.includes("twilio")), "nothing went to Twilio");
  }
});

/* ---------------- a base-URL setting cannot send a key to another host ---------------- */

test("a base-URL setting that points off the vendor's host is skipped; the key is never sent there", async () => {
  const seen = [];
  const http = async (method, url, opts) => { seen.push(url); return OK[`${method} ${url}`]; };
  const env = {
    ...ENV,
    TWILIO_SEND_BASE_URL: "https://evil.example.com",
    RESEND_BASE_URL: "http://api.resend.com",
    FANBASIS_CHECKOUT_API_BASE: "https://www.fanbasis.com:8443/public-api"
  };
  const r = await go({ env, http });
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(r.skipped, ["twilio-key", "resend-key", "commas-key"]);
  assert.deepEqual(seen, []);
  // the same host, with or without a trailing slash, is used
  const same = { ...ENV, TWILIO_SEND_BASE_URL: "https://api.twilio.com/", FANBASIS_CHECKOUT_API_BASE: "https://www.fanbasis.com/public-api/" };
  seen.length = 0;
  const ok = await go({ env: same, http });
  assert.equal(ok.ok, true, ok.detail);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.filter((u) => u.includes("twilio")), [`https://api.twilio.com/2010-04-01/Accounts/${SID}.json`]);
  assert.deepEqual(seen.filter((u) => u.includes("fanbasis")), [`${beat.COMMAS_DEFAULT_BASE}/checkout-sessions/transactions?page=1&per_page=1`]);
});

test("a page that answers with a redirect off the vendor is not followed by the beat (the probe drops key headers cross-host)", () => {
  // The beat itself never follows a redirect: it makes one ctx.http.get per vendor.
  const source = fs.readFileSync(FILE, "utf8");
  assert.equal((source.match(/ctx\.http\.get\(/g) || []).length, 1, "one call site, in the loop");
  assert.ok(!/ctx\.http\.(?!get\b)/.test(source));
});

/* ---------------- read-only ---------------- */

test("the beat has no way to write: GET only, no database, no POST, nothing printed", () => {
  const source = fs.readFileSync(FILE, "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.deepEqual(pinBeatSource(fs.readFileSync(FILE, "utf8")), []);
  assert.ok(!/ctx\.read\b/.test(source), "this beat never touches the database");
  assert.ok(!/method:\s*["']POST/i.test(source));
  assert.ok(!/console\./.test(source));
});
