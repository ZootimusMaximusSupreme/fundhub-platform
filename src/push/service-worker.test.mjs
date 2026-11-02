// The service worker, RUN — not read.
//
// WHY THIS FILE IS NOT A GREP. A service worker is the one piece of code on this
// site that survives a deploy: a bad one keeps serving the page that would have
// loaded its own replacement, on every client's device, forever. The claim that
// matters — "an /api/ response can never enter the cache" — is a claim about
// what the code DOES, and a regular expression over the source cannot make it.
// One `caches.put()` inside a branch a scan did not follow would pass a text
// check and put a client's financial file on their phone's disk.
//
// So public/app/client-portal-sw.js is loaded into a fake ServiceWorkerGlobalScope
// with a fake CacheStorage and a fake network, real events are dispatched into
// it, and the fake cache is inspected afterwards. Every assertion below is about
// the state that resulted, never about the text of the file.
//
// THE TWO INDEPENDENT DEFENCES, and both are tested:
//   1. the worker refuses to cache an /api/ or /.netlify/ path, and
//   2. it is registered for the single URL /app/client-portal.html, so a request
//      to /api/ is not in its scope and never reaches it at all.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SW_FILE = path.resolve(HERE, "../../public/app/client-portal-sw.js");
const PORTAL_FILE = path.resolve(HERE, "../../public/app/client-portal.html");
const ORIGIN = "https://portal.test";

/* A CacheStorage that is a Map, so "what ended up in the cache" is a fact this
   test can read rather than a promise it has to trust. */
function fakeCaches() {
  const store = new Map();
  const keyOf = (req) => (req && req.url) ? req.url : String(req);
  const api = {
    _store: store,
    async keys() { return [...store.keys()]; },
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return {
        async put(req, res) { m.set(keyOf(req), res); },
        async match(req) { return m.get(keyOf(req)); }
      };
    },
    async delete(name) { return store.delete(name); },
    async match(req) {
      for (const m of store.values()) {
        const hit = m.get(keyOf(req));
        if (hit) return hit;
      }
      return undefined;
    },
    /** every URL now sitting in any cache */
    cachedUrls() {
      const out = [];
      for (const m of store.values()) out.push(...m.keys());
      return out;
    }
  };
  return api;
}

function loadWorker({ network } = {}) {
  const listeners = new Map();
  const notifications = [];
  const caches = fakeCaches();
  const state = {
    unregistered: false,
    claimed: false,
    skippedWaiting: false,
    navigations: [],
    openedWindows: []
  };

  const sandbox = {
    console,
    URL,
    Response,
    Request,
    Promise,
    setTimeout,
    caches,
    atob: globalThis.atob,
    fetch: network || (async () => new Response("fresh", { status: 200, headers: { "Content-Type": "text/html" } }))
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = new URL(ORIGIN + "/app/client-portal-sw.js");
  sandbox.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  sandbox.skipWaiting = () => { state.skippedWaiting = true; };
  sandbox.registration = {
    unregister: async () => { state.unregistered = true; return true; },
    showNotification: async (title, options) => { notifications.push({ title, options }); }
  };
  sandbox.clients = {
    matchAll: async () => state.windows || [],
    claim: async () => { state.claimed = true; },
    openWindow: async (url) => { state.openedWindows.push(url); return null; }
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SW_FILE, "utf8"), sandbox, { filename: SW_FILE });

  async function dispatch(type, event) {
    const waits = [];
    const ev = {
      ...event,
      waitUntil: (p) => waits.push(p),
      respondWith: (p) => { ev._response = p; }
    };
    for (const fn of listeners.get(type) || []) await fn(ev);
    await Promise.all(waits);
    return ev;
  }

  return { sandbox, caches, dispatch, notifications, state, listeners };
}

const req = (url, init) => new Request(url.startsWith("http") ? url : ORIGIN + url, init);

describe("client-portal-sw.js — run in a fake service worker scope", () => {
  let w;
  beforeEach(() => { w = loadWorker(); });

  test("an /api/ request never reaches the cache", async () => {
    // Every shape a request to the API can take, including one that succeeds.
    const apiUrls = [
      "/api/read/portal-summary",
      "/api/read/client-progress?client_id=abc",
      "/api/push/subscribe",
      "/.netlify/functions/api/read/portal-summary"
    ];
    for (const u of apiUrls) {
      const ev = await w.dispatch("fetch", { request: req(u) });
      // The worker must not even answer for these — it hands them to the
      // network untouched, which is what `return` before respondWith means.
      assert.equal(ev._response, undefined, `${u} was intercepted`);
      if (ev._response) await ev._response;
    }
    assert.deepEqual(w.caches.cachedUrls(), [], "something reached the cache");
  });

  test("a portal page request is served network-first and cached as a fallback", async () => {
    const ev = await w.dispatch("fetch", { request: req("/app/client-portal.html") });
    assert.ok(ev._response, "the worker did not answer for its own page");
    const res = await ev._response;
    assert.equal(await res.text(), "fresh", "a cached copy was preferred over the network");
    assert.deepEqual(w.caches.cachedUrls(), [ORIGIN + "/app/client-portal.html"]);
  });

  test("with no network, the cached page is served; with no cache, an honest offline page", async () => {
    // First load fills the cache.
    const first = await w.dispatch("fetch", { request: req("/app/client-portal.html") });
    await first._response;

    // Now the network is gone.
    w.sandbox.fetch = async () => { throw new Error("offline"); };
    const offline = await w.dispatch("fetch", { request: req("/app/client-portal.html") });
    assert.equal(await (await offline._response).text(), "fresh");

    const missing = await w.dispatch("fetch", { request: req("/app/never-seen.html") });
    const res = await missing._response;
    assert.equal(res.status, 503);
    assert.match(await res.text(), /You are offline/);
  });

  test("a POST is never cached and never intercepted", async () => {
    const ev = await w.dispatch("fetch", { request: req("/app/client-portal.html", { method: "POST" }) });
    assert.equal(ev._response, undefined);
    assert.deepEqual(w.caches.cachedUrls(), []);
  });

  test("a cross-origin response is not cached", async () => {
    w.sandbox.fetch = async () => new Response("elsewhere", { status: 200 });
    const ev = await w.dispatch("fetch", { request: req("https://fonts.googleapis.com/css2?family=Inter") });
    await ev._response;
    assert.deepEqual(w.caches.cachedUrls(), []);
  });

  test("a non-200 response is not cached, so an error page cannot become the app", async () => {
    w.sandbox.fetch = async () => new Response("nope", { status: 500 });
    const ev = await w.dispatch("fetch", { request: req("/app/client-portal.html") });
    await ev._response;
    assert.deepEqual(w.caches.cachedUrls(), []);
  });

  test("activate deletes every cache that is not this version", async () => {
    await w.caches.open("fundhub-portal-v0");
    await w.caches.open("something-else");
    await w.caches.open("fundhub-portal-v1");
    await w.dispatch("activate", {});
    assert.deepEqual(await w.caches.keys(), ["fundhub-portal-v1"]);
    assert.equal(w.state.claimed, true);
  });

  test("the page can order the worker to remove itself", async () => {
    await w.caches.open("fundhub-portal-v1");
    await w.dispatch("message", { data: { type: "fundhub-unregister" } });
    assert.equal(w.state.unregistered, true);
    assert.deepEqual(await w.caches.keys(), []);
  });

  test("KILL_SWITCH true unregisters the worker and empties every cache on activate", async () => {
    // The kill switch is a one-line flip and a deploy. Proving it works means
    // proving it against the same file, with the flag flipped in memory.
    const source = fs.readFileSync(SW_FILE, "utf8");
    assert.match(source, /const KILL_SWITCH = false;/, "the kill switch constant moved or was renamed");

    const killedFile = source.replace("const KILL_SWITCH = false;", "const KILL_SWITCH = true;");
    const sandbox = { console, URL, Response, Request, Promise, setTimeout, caches: fakeCaches(),
      fetch: async () => new Response("x") };
    sandbox.self = sandbox;
    sandbox.location = new URL(ORIGIN + "/app/client-portal-sw.js");
    const found = new Map();
    sandbox.addEventListener = (t, fn) => { if (!found.has(t)) found.set(t, []); found.get(t).push(fn); };
    sandbox.skipWaiting = () => {};
    let unregistered = false;
    sandbox.registration = { unregister: async () => { unregistered = true; }, showNotification: async () => {} };
    sandbox.clients = { matchAll: async () => [], claim: async () => {}, openWindow: async () => {} };
    vm.createContext(sandbox);
    vm.runInContext(killedFile, sandbox, { filename: "kill-switch-sw.js" });

    await sandbox.caches.open("fundhub-portal-v1");
    const waits = [];
    for (const fn of found.get("activate")) await fn({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);

    assert.equal(unregistered, true, "the kill switch did not unregister the worker");
    assert.deepEqual(await sandbox.caches.keys(), [], "the kill switch left caches behind");
  });
});

describe("client-portal-sw.js — what a push event puts on the lock screen", () => {
  let w;
  beforeEach(() => { w = loadWorker(); });

  const push = (payload) => w.dispatch("push", {
    data: { json: () => payload }
  });

  test("it shows exactly what the server sent and adds nothing", async () => {
    await push({ kind: "payment_due", title: "FundHub", body: "A payment is due soon. Open FundHub.", url: "/app/client-portal.html", tag: "payment_due" });
    assert.equal(w.notifications.length, 1);
    assert.equal(w.notifications[0].title, "FundHub");
    assert.equal(w.notifications[0].options.body, "A payment is due soon. Open FundHub.");
    assert.equal(w.notifications[0].options.tag, "payment_due");
  });

  test("a payload with no body still shows something generic", async () => {
    await push({});
    assert.match(w.notifications[0].options.body, /update on your file/);
  });

  test("a malformed payload does not throw and does not show a blank banner", async () => {
    await w.dispatch("push", { data: { json: () => { throw new Error("not json"); } } });
    assert.equal(w.notifications.length, 1);
    assert.equal(w.notifications[0].title, "FundHub");
  });

  test("an off-site url in the payload is ignored — a notification is not an open redirect", async () => {
    await push({ url: "https://evil.example/steal" });
    assert.equal(w.notifications[0].options.data.url, "/app/client-portal.html");

    await push({ url: "//evil.example/steal" });
    assert.equal(w.notifications[1].options.data.url, "/app/client-portal.html");

    await push({ url: "/app/client-portal.html?tab=docs" });
    assert.equal(w.notifications[2].options.data.url, "/app/client-portal.html?tab=docs");
  });

  test("tapping the notification opens the portal when no window is open", async () => {
    await push({ url: "/app/client-portal.html" });
    const notification = { close() {}, data: { url: "/app/client-portal.html" } };
    await w.dispatch("notificationclick", { notification });
    assert.deepEqual(w.state.openedWindows, ["/app/client-portal.html"]);
  });

  test("a lesson tap opens the lesson when an existing portal cannot navigate outside its scope", async () => {
    for (const failure of ["throws", "null"]) {
      const current = loadWorker();
      let focused = 0;
      current.state.windows = [{ url: ORIGIN + "/app/client-portal.html",
        focus: async () => { focused++; },
        navigate: async () => { if (failure === "throws") throw new Error("outside worker scope"); return null; } }];
      await current.dispatch("notificationclick", {
        notification: { close() {}, data: { url: "/slideshows/the-call.html" } }
      });
      assert.deepEqual(current.state.openedWindows, ["/slideshows/the-call.html"]);
      assert.equal(focused, 0, "do not focus the old portal as if it were the lesson");
    }
  });

  test("a lesson tap reuses a window only after navigation succeeds", async () => {
    let focused = 0;
    w.state.windows = [{ url: ORIGIN + "/app/client-portal.html", focus: async () => {},
      navigate: async (url) => {
        w.state.navigations.push(url);
        return { focus: async () => { focused++; } };
      } }];
    await w.dispatch("notificationclick", {
      notification: { close() {}, data: { url: "/slideshows/the-call.html" } }
    });
    assert.deepEqual(w.state.navigations, ["/slideshows/the-call.html"]);
    assert.deepEqual(w.state.openedWindows, []);
    assert.equal(focused, 1);
  });
});

describe("the registration in client-portal.html", () => {
  const html = fs.readFileSync(PORTAL_FILE, "utf8");

  test("the worker is scoped to one page, so /api/ is outside its scope entirely", () => {
    // This is the SECOND defence and it is structural: a scope of "/app/" would
    // put the worker in front of every staff CRM screen, and a scope of "/"
    // would put it in front of /api/.
    assert.match(html, /var SW_SCOPE = "\/app\/client-portal\.html";/);
    assert.match(html, /navigator\.serviceWorker\.register\(SW_URL, \{ scope: SW_SCOPE \}\)/);
  });

  test("permission is never requested on page load", () => {
    // requestPermission must appear only inside the click path. If it ever moves
    // to load, the client's one and only prompt is spent before they read why.
    // Comment lines are dropped first — the header of that script block
    // explains the rule and naming it there must not count as calling it.
    const code = html.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    const calls = [...code.matchAll(/Notification\.requestPermission\(\)/g)].map((m) => m.index);
    assert.equal(calls.length, 1, "there should be exactly one permission ask, found " + calls.length);
    const start = code.indexOf("function turnOn(");
    const end = code.indexOf("function turnOff(");
    assert.ok(start > 0 && end > start, "turnOn/turnOff were renamed");
    assert.ok(calls[0] > start && calls[0] < end, "requestPermission() moved out of the button handler");
  });

  test("the page carries the manifest and the iPhone home-screen tags", () => {
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(html, /apple-mobile-web-app-capable/);
  });

  test("there is a kill switch that needs no deploy", () => {
    assert.match(html, /killSwitchRequested/);
    assert.match(html, /get\("push"\) === "off"/);
  });
});
