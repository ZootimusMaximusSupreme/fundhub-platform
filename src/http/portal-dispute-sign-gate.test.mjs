/* CP-07 — the portal's dispute-letter signature could be recorded when the
 * consent wording never loaded.
 *
 * THE BUG. public/app/client-portal.html asks GET /api/consent/capture for the
 * legal paragraph and its version. When that read failed (or came back with no
 * paragraph, or no version) the card said "You can still draw your signature",
 * left the pad and the button live, and posted consent_version null. The server
 * read null as "the current version" and stored the client as agreeing to words
 * this page never showed them. The letters then started on that signature.
 *
 * THE FIX, SCREEN HALF (this file). The pad and the button stay dead until the
 * server has handed over BOTH the text and its version, and submit() refuses on
 * its own when the version is missing, so a click that gets past a disabled
 * button still records nothing. The SERVER half is in
 * src/http/consent-capture.test.mjs ("a client signature with no wording
 * version is refused (CP-07)").
 *
 * HOW THIS RUNS THE PAGE. The signature card's script is an IIFE that exports
 * nothing, so the SHIPPED script is executed — not a slice, not a copy — against
 * a stub browser, the same way src/http/portal-loading-line.test.mjs runs the
 * portal's main script. Ink is faked as "present" on purpose: the only thing
 * left standing between the client and a POST is the wording gate, which is the
 * thing under test.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = path.resolve(HERE, "../../public/app/client-portal.html");
const html = fs.readFileSync(PORTAL, "utf8");

const CLIENT = "22222222-2222-2222-2222-222222222222";
const WORDS = "I authorize Fundhub to prepare credit dispute letters from my credit file for my review.";

/* The signature card's script: the <script> that holds KIND = "dispute_authorization". */
function signScript() {
  const marker = 'var KIND = "dispute_authorization";';
  const at = html.indexOf(marker);
  assert.ok(at !== -1, "the dispute signature script moved or lost its KIND");
  const open = html.lastIndexOf("<script>", at);
  const close = html.indexOf("</script>", at);
  assert.ok(open !== -1 && close !== -1, "could not find the script tags around the signature card");
  return html.slice(open + "<script>".length, close);
}
const SCRIPT = signScript();

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

function makeEl(id) {
  const listeners = {};
  const classes = new Set();
  const el = {
    id,
    value: "",
    disabled: false,
    className: "",
    textContent: "",
    clientWidth: 640,
    clientHeight: 96,
    width: 640,
    height: 160,
    style: {},
    listeners,
    classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        const want = on === undefined ? !classes.has(c) : !!on;
        if (want) classes.add(c); else classes.delete(c);
        return want;
      }
    },
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 96 }),
    setPointerCapture() { el.captured = (el.captured || 0) + 1; },
    releasePointerCapture() {}
  };
  return el;
}

/* A canvas context that does nothing, and whose pixels are all solid ink. */
function makeCtx() {
  const px = new Uint8ClampedArray(64 * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255; }
  return new Proxy({}, {
    get(target, prop) {
      if (prop === "getImageData") return () => ({ data: px });
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
}

/**
 * startCard — execute the shipped signature script.
 *
 *   get:   what GET /api/consent/capture answers, or a function for a held-open read.
 *   post:  what POST /api/consent/capture answers.
 *   signedIn: false gives the card no client id at all.
 *
 * Returns the elements, the recorded fetches, and helpers to click and draw.
 */
async function startCard({ get, post, signedIn = true } = {}) {
  const els = new Map();
  const byId = (id) => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };
  const card = byId("dispute-auth-card");
  const canvas = byId("cpSignPad");
  const submitBtn = byId("cpSignSubmit");
  const name = byId("cpSignName");
  name.value = "Dana Client";
  const ctx = makeCtx();
  canvas.getContext = () => ctx;

  const fetches = [];
  let releaseGet = null;
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    URLSearchParams, JSON, Promise, Math, String, Date,
    location: { search: signedIn ? "?id=" + CLIENT : "", pathname: "/app/client-portal.html" },
    localStorage: {
      getItem: (k) => (k === "fh_token" ? "tok" : null),
      setItem() {}, removeItem() {}
    },
    document: { getElementById: byId },
    fetch: (url, init = {}) => {
      const method = (init.method || "GET").toUpperCase();
      fetches.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null });
      if (method === "POST") {
        const p = typeof post === "function" ? post() : post;
        return Promise.resolve(p || reply(200, { ok: true, consent: {} }));
      }
      if (typeof get === "function") {
        return new Promise((resolve) => { releaseGet = () => resolve(get()); });
      }
      return Promise.resolve(get || reply(500, null));
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);
  await settle();

  const drawPointerDown = () => {
    const ev = { pointerId: 1, clientX: 20, clientY: 20, prevented: 0, preventDefault() { this.prevented++; } };
    canvas.listeners.pointerdown(ev);
    return ev;
  };
  return {
    card, canvas, submitBtn, name,
    disclosure: byId("cpDisclosure"),
    msg: byId("cpSignMsg"),
    fetches,
    posts: () => fetches.filter((f) => f.method === "POST"),
    gets: () => fetches.filter((f) => f.method === "GET"),
    release: async () => { releaseGet(); await settle(); },
    /* The click handler is called directly, even on a disabled button: the
       point is that submit() refuses on its own, not only the disabled flag. */
    clickSubmit: async () => { submitBtn.listeners.click(); await settle(); },
    drawPointerDown
  };
}

const good = (over = {}) => ({
  status: 200, ok: true,
  json: () => Promise.resolve({
    ok: true,
    disclosure: { version: "dispute-auth-v1", title: "Dispute letter authorization", text: WORDS },
    status: { valid: false },
    ...over
  })
});
const answer = (status, body) => ({ status, ok: status === 200, json: () => Promise.resolve(body) });

describe("portal dispute signature card — the wording gate (CP-07)", () => {
  test("PASS: with the wording and its version on screen the pad and button are live and the POST names the version", async () => {
    const c = await startCard({ get: good() });
    assert.equal(c.disclosure.textContent, WORDS, "the server's paragraph is not on screen");
    assert.equal(c.submitBtn.disabled, false, "the button stayed dead with the wording on screen — nobody could sign");
    assert.notEqual(c.canvas.style.pointerEvents, "none", "the pad stayed dead with the wording on screen");
    assert.equal(c.card.classes.has("is-locked"), false);

    const ev = c.drawPointerDown();
    assert.equal(ev.prevented, 1, "the pad ignored a stroke with the wording on screen");
    assert.equal(c.canvas.captured, 1);

    await c.clickSubmit();
    assert.equal(c.posts().length, 1, "a signature with the wording on screen was not posted");
    const body = c.posts()[0].body;
    assert.equal(body.consent_version, "dispute-auth-v1");
    assert.equal(body.kind, "dispute_authorization");
    assert.equal(body.capture_method, "signature");
    assert.equal(body.granted_name, "Dana Client");
  });

  test("while the wording is still loading the card is dead", async () => {
    const c = await startCard({ get: () => good() });
    assert.equal(c.gets().length, 1, "the card never asked for the wording");
    assert.equal(c.submitBtn.disabled, true, "the button is live before any wording has arrived");
    assert.equal(c.canvas.style.pointerEvents, "none", "the pad is live before any wording has arrived");
    const ev = c.drawPointerDown();
    assert.equal(ev.prevented, 0, "the pad took a stroke before the wording arrived");
    await c.clickSubmit();
    assert.equal(c.posts().length, 0, "a signature was posted before the wording arrived");

    await c.release();
    assert.equal(c.submitBtn.disabled, false, "the card never woke up once the wording arrived");
  });

  /* One case per way the wording fails to be fully on screen. Each of these used
     to leave the card live and post consent_version null. */
  const FAILURES = [
    ["the read fails (server error)", () => answer(500, { ok: false })],
    ["the read is refused (signed out)", () => answer(401, { ok: false })],
    ["the answer is not JSON", () => ({ status: 200, ok: true, json: () => Promise.reject(new Error("bad json")) })],
    ["the server has no disclosure", () => good({ disclosure: null })],
    ["the disclosure has text but no version", () => good({ disclosure: { text: WORDS } })],
    ["the disclosure has a version but no text", () => good({ disclosure: { version: "dispute-auth-v1" } })],
    ["the disclosure has an empty version", () => good({ disclosure: { version: "", text: WORDS } })]
  ];

  for (const [label, make] of FAILURES) {
    test(`FAIL: when ${label}, nothing can be signed or posted`, async () => {
      const c = await startCard({ get: make() });
      assert.equal(c.submitBtn.disabled, true, "the button is live without the wording");
      assert.equal(c.canvas.style.pointerEvents, "none", "the pad is live without the wording");
      assert.equal(c.card.classes.has("is-locked"), true);

      const ev = c.drawPointerDown();
      assert.equal(ev.prevented, 0, "the pad took a stroke without the wording");
      assert.equal(c.canvas.captured, undefined, "the pad captured the pointer without the wording");

      await c.clickSubmit();
      assert.equal(c.posts().length, 0,
        `a signature was posted with no wording on screen: ${JSON.stringify(c.posts())}`);
      assert.match(c.msg.className, /\berr\b/, "the client was not told why nothing happened");
      assert.match(c.msg.textContent, /wording/i);
    });
  }

  test("the failure line no longer tells the client they can still sign", async () => {
    const c = await startCard({ get: answer(500, { ok: false }) });
    assert.doesNotMatch(c.disclosure.textContent, /still draw/i,
      "the card still invites a signature while the wording is missing");
    assert.match(c.disclosure.textContent, /cannot sign|can't sign|not sign/i);
  });

  test("FAIL: a client with no id gets no read and no POST", async () => {
    const c = await startCard({ get: good(), signedIn: false });
    assert.equal(c.gets().length, 0, "the card asked for the wording with no client id");
    assert.equal(c.submitBtn.disabled, true);
    await c.clickSubmit();
    assert.equal(c.posts().length, 0);
  });

  test("a refused POST leaves the card usable while the wording is still on screen", async () => {
    const c = await startCard({ get: good(), post: answer(500, { ok: false }) });
    await c.clickSubmit();
    assert.equal(c.posts().length, 1);
    assert.equal(c.submitBtn.disabled, false, "a failed save left the client with a dead button");
    assert.match(c.msg.className, /\berr\b/);
  });

  test("the card is the same one the server's version rule protects", () => {
    /* The screen and the server must agree on the field name, or a signed-in
       client's valid POST would be refused as "no version". */
    assert.match(SCRIPT, /consent_version:\s*disclosureVersion/);
    assert.match(SCRIPT, /if \(!disclosureVersion\)/);
  });
});
