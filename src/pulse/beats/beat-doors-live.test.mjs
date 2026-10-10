// Tests for the doors-live beat. No network, no database: the fake ctx answers only what it is told.
// The expectations in beat-doors-live.mjs were also proved with one real GET per door on the live
// site (2026-10-09); see the header of that file. The live run is `node scripts/pulse/run-beat.mjs doors-live`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-doors-live.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://fundhub.ai";
const url = (p) => `GET ${SITE}${p}`;
const START = "<!-- fh-canonical:start v1 -->";
const LINK = '<link rel="canonical" href="https://apply.fundhub.ai/roadmap">';
const GOOD_ROADMAP = `<html><head>${START}${LINK}<!-- fh-canonical:end --></head><body>sales</body></html>`;

const runWith = async (http, over = {}) => {
  const ctx = makeFakeCtx(beat, { http, ...over });
  const result = await runBeat(beat, ctx);
  return { result, log: ctxLog(ctx) };
};
/** The good answers with some doors changed. */
const good = (changes = {}) => ({ ...beat.goodAnswers(), ...Object.fromEntries(Object.entries(changes).map(([p, v]) => [url(p), v])) });

test("doors-live is a valid beat, passes the static pin and its own self test", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-doors-live.mjs" }), []);
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-doors-live.mjs"), "utf8")), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.equal(beat.damp, 2);
  assert.equal(beat.box, false);
  assert.equal(beat.kind, "probe");
  assert.deepEqual(beat.covers, []);
  assert.deepEqual(beat.reads, [{ host: "SITE", methods: ["GET"] }]);
});

test("the door list is the launch list, each with a status and a marker check", () => {
  assert.deepEqual(beat.DOORS.map((d) => d.path), [
    "/api/health?strict=1", "/roadmap", "/roadmap/pay.html", "/portal-login.html",
    "/api/webhooks/commas", "/api/webhooks/clickfunnels", "/api/public/survey-submit",
    "/api/public/slo-interest", "/api/public/slo-checkout", "/api/auth/magic-link"
  ]);
  assert.deepEqual(beat.steps, beat.DOORS.map((d) => d.step));
  for (const d of beat.DOORS) {
    assert.match(d.step, /^door-/);
    assert.equal(typeof d.check, "function");
    assert.ok([200, 405].includes(d.status));
  }
  // slo-checkout answers a GET with its page config. It is NOT a 405 door (proved live).
  assert.equal(beat.DOORS.find((d) => d.path === "/api/public/slo-checkout").status, 200);
});

test("PASS: every door right -> green, every step ran, ten GETs to our own host, no other method", async () => {
  const { result, log } = await runWith(beat.goodAnswers());
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.notRun, []);
  assert.equal(result.steps.length, 10);
  assert.equal(log.http.length, 10);
  assert.ok(log.http.every((c) => c.method === "GET" && c.host === "fundhub.ai" && c.status > 0));
  assert.deepEqual(log.reads, [], "this beat reads no data");
  assert.deepEqual(log.refused, []);
});

test("PASS: /roadmap that redirects to the sales page host still counts (the probe follows it)", async () => {
  const { result } = await runWith(good({ "/roadmap": { status: 200, finalHost: "apply.fundhub.ai", redirects: 1, body: GOOD_ROADMAP } }));
  assert.equal(result.ok, true, result.detail);
});

/* ---------------- FAIL: one test per kind of break ---------------- */

test("FAIL: a door that 404s -> red at that door's step, naming the path and both statuses", async () => {
  const { result } = await runWith(good({ "/api/public/survey-submit": { status: 404, body: '{"ok":false,"error":"not_found"}' } }));
  assert.equal(result.ok, false);
  assert.equal(result.step, "door-survey-submit");
  assert.match(result.detail, /GET \/api\/public\/survey-submit answered 404, wanted 405/);
});

test("FAIL: a door that answers 500 or 503 -> red", async () => {
  for (const status of [500, 502, 503]) {
    const { result } = await runWith(good({ "/api/webhooks/commas": { status, body: "boom" } }));
    assert.equal(result.step, "door-commas", `status ${status}`);
    assert.match(result.detail, new RegExp(`answered ${status}, wanted 405`));
  }
});

test("FAIL: a 405 door that answers 200 (the route fell through to a page) -> red", async () => {
  const { result } = await runWith(good({ "/api/auth/magic-link": { status: 200, body: "<html>home</html>" } }));
  assert.equal(result.step, "door-magic-link");
  assert.match(result.detail, /answered 200, wanted 405/);
});

test("FAIL: a 405 that is not the door's own answer (a platform page) -> red at the marker", async () => {
  const { result } = await runWith(good({ "/api/webhooks/clickfunnels": { status: 405, body: "<html>Not allowed by the edge</html>" } }));
  assert.equal(result.step, "door-clickfunnels");
  assert.match(result.detail, /not with this door's own answer/);
});

test("FAIL: a 200 with the wrong marker -> red (the page was overwritten)", async () => {
  for (const [p, stepName, body] of [
    ["/roadmap", "door-roadmap", "<html><head><title>Default page</title></head></html>"],
    ["/roadmap/pay.html", "door-pay-page", "<html><body>Not the checkout</body></html>"],
    ["/portal-login.html", "door-portal-login", "<html><body>Welcome</body></html>"]
  ]) {
    const { result } = await runWith(good({ [p]: { status: 200, body } }));
    assert.equal(result.ok, false, p);
    assert.equal(result.step, stepName, p);
    assert.match(result.detail, /not the right page/, p);
  }
});

test("FAIL: /roadmap needs BOTH push-block markers (the start line and the canonical link)", async () => {
  const noLink = await runWith(good({ "/roadmap": { status: 200, body: `${START} a page with no canonical link` } }));
  assert.equal(noLink.result.step, "door-roadmap");
  assert.match(noLink.result.detail, /markers missing: 1 of 2/);
  const noStart = await runWith(good({ "/roadmap": { status: 200, body: `${LINK} but no push block` } }));
  assert.equal(noStart.result.step, "door-roadmap");
  assert.match(noStart.result.detail, /markers missing: 1 of 2/);
  const wrongLink = await runWith(good({ "/roadmap": { status: 200, body: `${START}<link rel="canonical" href="https://example.com/roadmap">` } }));
  assert.equal(wrongLink.result.step, "door-roadmap");
});

test("PASS: a reworded hand-edited banner or a changed price in the page body does NOT turn /roadmap red", async () => {
  for (const banner of ["FUNDHUB SLO - 01 SALES PAGE ($97, 2027-01-01)", "some other words entirely", ""]) {
    const { result } = await runWith(good({ "/roadmap": { status: 200, body: `${GOOD_ROADMAP}<!-- ${banner} -->` } }));
    assert.equal(result.ok, true, `banner "${banner}": ${result.detail}`);
  }
});

test("the /roadmap markers are lines the push script really writes (same file the push reads)", () => {
  const root = path.join(HERE, "..", "..", "..");
  const frag = fs.readFileSync(path.join(root, "marketing/landing-pages/slo/slo-canonical-head.html"), "utf8");
  const road = beat.DOORS.find((d) => d.path === "/roadmap");
  assert.equal(road.check({ status: 200, body: frag }), null, "the push fragment must satisfy the beat's markers");
  assert.ok(road.check({ status: 200, body: frag.replace("fh-canonical:start v1", "x") }), "dropping the start line must fail");
  assert.ok(road.check({ status: 200, body: frag.replace("https://apply.fundhub.ai/roadmap", "https://apply.fundhub.ai/other") }), "changing the canonical link must fail");
});

test("FAIL: an empty 200 page -> red at the marker", async () => {
  const { result } = await runWith(good({ "/roadmap/pay.html": { status: 200, body: "" } }));
  assert.equal(result.step, "door-pay-page");
});

test("FAIL: portal-login with the form but no email box -> red", async () => {
  const { result } = await runWith(good({ "/portal-login.html": { status: 200, body: '<form id="f"><input name="q"></form>' } }));
  assert.equal(result.step, "door-portal-login");
  assert.match(result.detail, /markers missing: 1 of 2/);
});

test("FAIL: health that is not ok, or has migrations pending, or is not JSON -> red at door-health", async () => {
  const cases = [
    [{ status: 200, body: JSON.stringify({ ok: false, state: "down", pending: 0 }) }, /ok false, state down, pending 0/],
    [{ status: 200, body: JSON.stringify({ ok: true, state: "up", pending: 2 }) }, /ok true, state up, pending 2/],
    [{ status: 200, body: JSON.stringify({ ok: true, state: "up" }) }, /pending none/],
    [{ status: 200, body: "<html>Site is down</html>" }, /not the health answer/],
    [{ status: 503, body: JSON.stringify({ ok: false }) }, /answered 503, wanted 200/]
  ];
  for (const [answer, re] of cases) {
    const { result } = await runWith(good({ "/api/health?strict=1": answer }));
    assert.equal(result.step, "door-health");
    assert.match(result.detail, re);
  }
});

test("FAIL: slo-interest and slo-checkout answer 200 but not their own answer -> red", async () => {
  const a = await runWith(good({ "/api/public/slo-interest": { status: 200, body: "<html>app shell</html>" } }));
  assert.equal(a.result.step, "door-slo-interest");
  const b = await runWith(good({ "/api/public/slo-interest": { status: 200, body: '{"ok":false}' } }));
  assert.equal(b.result.step, "door-slo-interest");
  const c = await runWith(good({ "/api/public/slo-checkout": { status: 200, body: '{"ok":true}' } }));
  assert.equal(c.result.step, "door-slo-checkout");
  assert.match(c.result.detail, /no priceCents/);
  const d = await runWith(good({ "/api/public/slo-checkout": { status: 400, body: '{"ok":false}' } }));
  assert.equal(d.result.step, "door-slo-checkout");
});

test("FAIL: a door that does not answer at all (timeout, network, refused) -> red, with the class and no raw error text", async () => {
  for (const klass of ["timeout", "network", "refused", "http_5xx"]) {
    const { result } = await runWith(good({ "/api/public/slo-interest": { status: 0, ok: false, class: klass, error: "ECONNRESET at 10.0.0.9 secret-token-abc" } }));
    assert.equal(result.step, "door-slo-interest", klass);
    assert.match(result.detail, new RegExp(`got no answer \\(${klass.replace("_", "[_]")}\\)`));
    assert.doesNotMatch(result.detail, /ECONNRESET|secret-token|10\.0\.0\.9/);
  }
});

test("FAIL: a door nobody gave an answer to (the fake refuses to guess) -> red, not green", async () => {
  const answers = beat.goodAnswers();
  delete answers[url("/roadmap/pay.html")];
  const { result } = await runWith(answers);
  assert.equal(result.ok, false);
  assert.equal(result.step, "door-pay-page");
  assert.match(result.detail, /got no answer/);
});

test("MUTATION: every door can go red by itself (wrong status), and every door with a marker goes red on an empty body", async () => {
  for (const door of beat.DOORS) {
    const wrongStatus = await runWith(good({ [door.path]: { status: 418, body: "" } }));
    assert.equal(wrongStatus.result.ok, false, `${door.path} stayed green on 418`);
    assert.equal(wrongStatus.result.step, door.step, door.path);

    const emptyBody = await runWith(good({ [door.path]: { status: door.status, body: "" } }));
    assert.equal(emptyBody.result.ok, false, `${door.path} has no marker: an empty body stayed green`);
    assert.equal(emptyBody.result.step, door.step, door.path);
  }
});

test("MUTATION: the right status with the right body is green for every door, one at a time (the loop above is not just always red)", async () => {
  for (const door of beat.DOORS) {
    const { result } = await runWith(good({ [door.path]: beat.goodAnswers()[url(door.path)] }));
    assert.equal(result.ok, true, `${door.path}: ${result.detail}`);
  }
});

/* ---------------- the words ---------------- */

test("the detail lists every other door that is wrong too, so the first text says how big it is", async () => {
  const { result } = await runWith(good({
    "/api/public/survey-submit": { status: 404, body: "" },
    "/api/auth/magic-link": { status: 500, body: "" },
    "/roadmap/pay.html": { status: 200, body: "nothing" }
  }));
  assert.equal(result.step, "door-pay-page", "the first wrong door in list order");
  assert.match(result.detail, /Also wrong: \/api\/public\/survey-submit, \/api\/auth\/magic-link/);
  assert.ok(result.detail.length <= 300);
});

test("the detail never holds a page body, a query string or a header", async () => {
  const body = "SECRET-BODY-TEXT-123 <html>Bearer abc.def</html>";
  const { result } = await runWith(good({ "/roadmap": { status: 200, body }, "/api/health?strict=1": { status: 500, body } }));
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.detail, /SECRET-BODY|Bearer|strict=1/);
  assert.match(result.detail, /GET \/api\/health answered 500, wanted 200/);
});

test("health values in the detail are cut to plain letters and digits", async () => {
  const { result } = await runWith(good({ "/api/health?strict=1": { status: 200, body: JSON.stringify({ ok: false, state: "<script>alert(1)</script> down at db.internal", pending: 0 }) } }));
  assert.equal(result.step, "door-health");
  assert.doesNotMatch(result.detail, /[<>()]/);
  assert.match(result.detail, /state scriptalert1scri,/, "cut to 16 plain characters");
});

/* ---------------- how it runs ---------------- */

test("all ten GETs are in flight at the same time (the beat does not take ten round trips in a row)", async () => {
  let inFlight = 0;
  let peak = 0;
  const http = async (method, address) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight--;
    return beat.goodAnswers()[`${method} ${address}`];
  };
  const ctx = makeFakeCtx(beat, { http });
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, true, result.detail);
  assert.equal(peak, 10);
});

test("a door that hangs is cut by the beat deadline and the step is named", async () => {
  const http = (method, address) => (address.endsWith("/roadmap/pay.html") ? new Promise(() => {}) : beat.goodAnswers()[`${method} ${address}`]);
  const ctx = makeFakeCtx(beat, { http });
  const result = await runBeat(beat, ctx, { deadlineMs: 300 });
  assert.equal(result.ok, false);
  assert.equal(result.step, "door-pay-page");
  assert.match(result.detail, /deadline 300 ms passed in step door-pay-page/);
});

test("it only ever asks our own host: a site address that is not https is a red, not a call", async () => {
  const { result, log } = await runWith(beat.goodAnswers(), { siteUrl: "http://fundhub.ai" });
  assert.equal(result.ok, false);
  assert.equal(result.step, "door-health");
  assert.match(result.detail, /site address/);
  assert.equal(log.http.length, 0);
});

test("a door path with a different host cannot be reached: ctx refuses any host the beat did not declare", async () => {
  const ctx = makeFakeCtx(beat, { http: beat.goodAnswers() });
  await assert.rejects(() => ctx.http.get("https://example.com/x"), /host_not_declared/);
  assert.equal(ctxLog(ctx).refused.length, 1);
});

test("the self test: pass is green at every declared step, fail is red at a declared step", async () => {
  const pass = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(pass.ok, true);
  assert.deepEqual(pass.notRun, []);
  const fail = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(fail.ok, false);
  assert.equal(fail.step, "door-magic-link");
  assert.ok(beat.steps.includes(fail.step));
});
