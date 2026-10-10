// Tests for the checkout-doors beat. No network, no database: the fake ctx answers only what it is told.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-checkout-doors.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource, missingFixGuidePaths } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { TEST_CLIENT_EMAIL_RE as LIB_RE } from "./lib/checkout-doors.mjs";
import { TEST_CLIENT_EMAIL_RE } from "../coverage/gap-payments.mjs";
import { ROUTES } from "../../../netlify/functions/api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SITE = "https://fundhub.ai";
const LINK = "https://pay.example.test/c/live-link";
const FUNNEL = `GET ${SITE}${beat.FUNNEL_PATH}`;
const REPAIR = `GET ${SITE}${beat.REPAIR_PATH}`;

const runWith = async (overrides) => {
  const ctx = makeFakeCtx(beat, overrides);
  const result = await runBeat(beat, ctx);
  return { result, log: ctxLog(ctx) };
};
const good = () => beat.goodAnswers();
const withHttp = (changes) => ({ ...good(), http: { ...good().http, ...changes } });
const links = (...urls) => [{ match: /FROM paid_service_requests/, rows: urls.map((u, i) => ({ id: `0000000${i}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, checkout_url: u })) }];

test("checkout-doors is a valid beat, passes the static pin and its own self test", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-checkout-doors.mjs" }), []);
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-checkout-doors.mjs"), "utf8")), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.equal(beat.box, false);
  assert.equal(beat.kind, "probe");
  assert.deepEqual(beat.steps, ["funnel-till", "repair-door", "paid-service-link"]);
});

test("covers names three real routes, and the fix guide names files that exist", () => {
  for (const key of beat.covers) assert.ok(Object.hasOwn(ROUTES, key.replace(/^route:/, "")), key);
  const { missing, anyExists } = missingFixGuidePaths(beat.fixGuide, (p) => fs.existsSync(path.join(ROOT, p)));
  assert.deepEqual(missing, []);
  assert.ok(anyExists);
});

test("the test-client pattern is the one the morning lanes use", () => {
  assert.equal(LIB_RE, TEST_CLIENT_EMAIL_RE);
});

test("the read is a single SELECT with no write word, no bank and no key", () => {
  const sql = beat.LINKS_SQL;
  assert.match(sql, /^\s*SELECT\b/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|drop|alter|create|grant)\b/i);
  assert.match(sql, /paid_service_requests/);
  assert.match(sql, /checkout_expires_at > now\(\)/);
});

test("PASS: every door right, one waiting link that answers -> green, every step ran, only GET and HEAD", async () => {
  const { result, log } = await runWith(good());
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.notRun, []);
  assert.deepEqual(result.skipped, []);
  assert.match(result.detail, /1 of 1 waiting paid-service links answer/);
  assert.ok(log.http.every((c) => c.method === "GET" || c.method === "HEAD"));
  assert.deepEqual(log.http.map((c) => `${c.method} ${c.host}`).sort(), ["GET fundhub.ai", "GET fundhub.ai", "HEAD pay.example.test"]);
  assert.deepEqual(log.refused, []);
  assert.equal(log.reads.length, 1);
  assert.deepEqual(log.reads[0].params, [TEST_CLIENT_EMAIL_RE]);
});

test("PASS: no waiting link is a skipped step, still green, and no second host is touched", async () => {
  const { result, log } = await runWith({ ...good(), read: links() });
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.skipped, ["paid-service-link"]);
  assert.deepEqual(log.http.map((c) => c.host), ["fundhub.ai", "fundhub.ai"]);
});

test("PASS: a host that turns away a bot (403) or refuses HEAD then GET is unclear, not red", async () => {
  const wall = await runWith(withHttp({ [`HEAD ${LINK}`]: { status: 403 } }));
  assert.equal(wall.result.ok, true, wall.result.detail);
  assert.match(wall.result.detail, /1 unclear/);
  const noHead = await runWith(withHttp({ [`HEAD ${LINK}`]: { status: 405 }, [`GET ${LINK}`]: { status: 200 } }));
  assert.equal(noHead.result.ok, true, noHead.result.detail);
  assert.deepEqual(noHead.log.http.filter((c) => c.host === "pay.example.test").map((c) => c.method), ["HEAD", "GET"]);
});

test("PASS: at most three waiting links are asked about, all at once", async () => {
  const urls = [1, 2, 3, 4, 5].map((n) => `https://pay.example.test/c/${n}`);
  const http = { ...good().http };
  for (const u of urls) http[`HEAD ${u}`] = { status: 200 };
  const { result, log } = await runWith({ ...good(), http, read: links(...urls) });
  assert.equal(result.ok, true, result.detail);
  assert.equal(log.http.filter((c) => c.method === "HEAD").length, 3);
});

/* ---------------- FAIL: one test per kind of break ---------------- */

test("FAIL: checkout not ready -> red at funnel-till", async () => {
  const { result } = await runWith({ ...beat.selfTest.fail() });
  assert.equal(result.ok, false);
  assert.equal(result.step, "funnel-till");
  assert.match(result.detail, /checkout is not ready, so no funnel buyer can pay/);
});

test("FAIL: an item with no price, an item turned off, an item gone", async () => {
  const cat = JSON.parse(withHttp({}).http[FUNNEL].body);
  const cases = [
    [cat.items.map((i) => (i.slug === "board" ? { ...i, priceCents: null } : i)), /board has no price/],
    [cat.items.map((i) => (i.slug === "trial" ? { ...i, available: false } : i)), /trial is priced but not available/],
    [cat.items.filter((i) => i.slug !== "autopsy"), /no longer lists autopsy/]
  ];
  for (const [items, re] of cases) {
    const { result } = await runWith(withHttp({ [FUNNEL]: { status: 200, body: JSON.stringify({ ...cat, items }) } }));
    assert.equal(result.step, "funnel-till");
    assert.match(result.detail, re);
  }
});

test("FAIL: the till answers 404, 500, an HTML page, or nothing", async () => {
  for (const status of [404, 500, 503]) {
    const { result } = await runWith(withHttp({ [FUNNEL]: { status, body: "x" } }));
    assert.equal(result.step, "funnel-till", `status ${status}`);
    assert.match(result.detail, new RegExp(`answered ${status}, not 200`));
  }
  const html = await runWith(withHttp({ [FUNNEL]: { status: 200, body: "<html>home</html>" } }));
  assert.match(html.result.detail, /did not answer JSON/);
  const none = await runWith({ ...good(), http: { ...good().http, [FUNNEL]: new Error("getaddrinfo ENOTFOUND") } });
  assert.equal(none.result.step, "funnel-till");
});

test("FAIL: the repair door answers 404, 200, 500, or a 405 that is not its own", async () => {
  const body405 = JSON.stringify({ ok: false, error: "method_not_allowed" });
  const cases = [
    [{ status: 404, body: "{}" }, /answered 404 \(the route fell out/],
    [{ status: 200, body: "<html>home</html>" }, /answered 200, wanted 405/],
    [{ status: 500, body: "boom" }, /answered 500/],
    [{ status: 405, body: "<html>Not allowed by the edge</html>" }, /not with its own answer/],
    [{ status: 405, body: body405, headers: { allow: "GET" } }, /no longer lists POST/]
  ];
  for (const [answer, re] of cases) {
    const { result } = await runWith(withHttp({ [REPAIR]: answer }));
    assert.equal(result.ok, false);
    assert.equal(result.step, "repair-door");
    assert.match(result.detail, re);
  }
});

test("FAIL: a waiting link that answers 404 or 410 or 500, or is not a web address -> red at paid-service-link", async () => {
  for (const status of [404, 410, 502]) {
    const { result } = await runWith(withHttp({ [`HEAD ${LINK}`]: { status } }));
    assert.equal(result.step, "paid-service-link", `status ${status}`);
    assert.match(result.detail, new RegExp(`answered ${status}`));
  }
  const bad = await runWith({ ...good(), read: links("not a link") });
  assert.equal(bad.result.step, "paid-service-link");
  assert.match(bad.result.detail, /is not a web address/);
});

test("FAIL: a read that fails is red at paid-service-link with the reason, never a green", async () => {
  const { result } = await runWith({ ...good(), read: [{ match: /FROM paid_service_requests/, error: "relation \"paid_service_requests\" does not exist" }] });
  assert.equal(result.ok, false);
  assert.equal(result.step, "paid-service-link");
  assert.match(result.detail, /could not be read/);
});

test("a link on our own site is never asked through the '*' read (it reads as unclear)", async () => {
  const own = `${SITE}/pay/abc`;
  const { result, log } = await runWith({ ...good(), read: links(own) });
  assert.equal(result.ok, true, result.detail);
  assert.match(result.detail, /1 unclear/);
  assert.equal(log.http.length, 2, "only the two door GETs went out; the HEAD to our own host was turned away by the ctx");
  assert.deepEqual(log.refused, [], "turning it away is not a refusal the harness counts as the beat misbehaving");
});
