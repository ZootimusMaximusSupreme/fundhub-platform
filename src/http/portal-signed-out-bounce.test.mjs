/* A signed-out client who opens the portal must land on the sign-in page WITH
 * THEIR EMAIL ALREADY FILLED IN.
 *
 * WHY THIS FILE EXISTS. Owner-set 2026-08-29 ("just send it to the portal"):
 * EMAIL-DS02-DIY-LETTERS-READY stopped linking to /portal-login.html and started
 * linking to the portal itself, {{portal_url}} —
 * /app/client-portal.html?email=<theirs> (clientContext() in
 * src/workflows/messaging.mjs). That is right for a client who is already signed
 * in, and it moves the whole burden of the signed-out case onto ONE line in
 * public/app/shell.js: signInUrl(). If that bounce ever stops carrying ?email=,
 * the new link is strictly WORSE than the one it replaced — the client arrives
 * at an empty box and has to type the address the email already knew. Nothing
 * else in the suite covers that, and it would fail silently and invisibly.
 *
 * HOW THIS TESTS AN IIFE THAT EXPORTS NOTHING. Identical approach to
 * src/http/app-client-carry.test.mjs, which is the file this harness is modelled
 * on: shell.js redirects on load and returns no handle, so it is EXECUTED
 * against a stub browser and the assertions are made on where it navigated.
 * Deliberately not a regex over the source — a text scan would pass on code that
 * never runs, and the whole question here is what the URL ENDS UP as.
 *
 * THE SESSION IS THE VARIABLE. /api/auth/session answering "no" is what a
 * signed-out visitor is, so these tests differ only in that answer and in the
 * query string on the way in.
 *
 * It lives under src/ rather than public/ because package.json's test glob only
 * walks src/ and scripts/ (see the traps section of CLAUDE.md).
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SHELL_SRC = fs.readFileSync(path.join(APP, "shell.js"), "utf8");

function makeEl(id = "") {
  return {
    id, innerHTML: "", textContent: "", title: "",
    style: { cssText: "", display: "", visibility: "" },
    classList: { contains: () => false, add() {}, remove() {} },
    parentNode: null,
    setAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    removeAttribute() {}, appendChild() {}, addEventListener() {},
    closest: () => null
  };
}

/**
 * runShell — execute shell.js against a stub browser and hand back where it went.
 *
 * `signedIn` false makes /api/auth/session answer not-ok, which is exactly the
 * shape getSession() treats as "no session" before it falls back to the demo
 * key. `store` starts empty on the signed-out runs because that is what a client
 * arriving from an email actually has: no token, no cached role.
 */
async function runShell({ page = "client-portal.html", search = "",
                          signedIn = false, role = "client",
                          store = {} } = {}) {
  const navigations = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    URLSearchParams,
    setTimeout: () => 0,
    setInterval: () => 0,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    location: {
      pathname: "/app/" + page,
      search,
      set href(v) { navigations.push({ how: "href", to: v }); },
      get href() { return "http://x/app/" + page + search; },
      replace: (v) => { navigations.push({ how: "replace", to: v }); }
    },
    document: {
      readyState: "complete",
      head: { appendChild(el) { el.parentNode = this; }, removeChild(el) { el.parentNode = null; } },
      documentElement: { style: { visibility: "" }, classList: { add() {}, remove() {}, contains: () => false } },
      body: { appendChild() {} },
      addEventListener() {},
      createElement: () => makeEl(),
      getElementById: () => makeEl(),
      querySelectorAll: () => []
    },
    fetch: (url) => {
      const u = String(url);
      if (u.indexOf("/api/auth/session") === 0) {
        if (!signedIn) return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }) });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true, staff: { id: "s1", name: "Marcus Webb", email: "marcus@example.com", role }
          })
        });
      }
      if (u.indexOf("/api/health") === 0) {
        return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, db: "up", migrations: 217 }) });
      }
      return Promise.reject(new Error("unexpected request: " + u));
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // matchMedia is optional in shell.js (it feature-tests window.matchMedia).
  vm.createContext(sandbox);
  vm.runInContext(SHELL_SRC, sandbox, { filename: "shell.js" });
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
  return { navigations, store };
}

const last = (navs) => (navs.length ? navs[navs.length - 1].to : "");

describe("a signed-out client opening the portal is sent to sign in", () => {
  test("the bounce happens at all, and it goes to the CLIENT sign-in page", async () => {
    const { navigations } = await runShell({ search: "" });
    assert.ok(navigations.length > 0, "a signed-out visitor was left sitting on the portal");
    const to = last(navigations);
    assert.match(to, /^\/portal-login\.html/,
      "sent to " + to + " — a client has no password, so /login.html is a dead end");
  });

  test("?email= from the emailed link is CARRIED so the address box is pre-filled", async () => {
    const { navigations } = await runShell({ search: "?email=marcus%40example.com" });
    const to = last(navigations);
    assert.equal(to, "/portal-login.html?email=marcus%40example.com",
      "the email the message already knew was dropped on the way to sign-in");
  });

  test("an address needing encoding survives the round trip intact", async () => {
    const { navigations } = await runShell({ search: "?email=" + encodeURIComponent("a+b@ex ample.com") });
    const to = last(navigations);
    const got = new URLSearchParams(to.slice(to.indexOf("?"))).get("email");
    assert.equal(got, "a+b@ex ample.com", "the address was mangled in transit");
  });

  test("no ?email= on the way in means no empty ?email= on the way out", async () => {
    const { navigations } = await runShell({ search: "?id=not-an-email" });
    assert.equal(last(navigations), "/portal-login.html",
      "a bare visit picked up a parameter that says nothing");
  });

  test("the portal link's own URL shape — the one the email sends — bounces correctly", async () => {
    // Exactly what {{portal_url}} renders to in src/workflows/messaging.mjs.
    const { navigations } = await runShell({ search: "?email=" + encodeURIComponent("marcus@example.com") });
    assert.equal(last(navigations), "/portal-login.html?email=marcus%40example.com");
  });
});

describe("a signed-in client is NOT bounced", () => {
  test("a real client session stays on the portal", async () => {
    const { navigations } = await runShell({
      signedIn: true, role: "client",
      search: "?email=marcus%40example.com",
      store: { fh_token: "t0ken", fh_role: "client" }
    });
    const wentToSignIn = navigations.some((n) => String(n.to).indexOf("portal-login.html") !== -1);
    assert.equal(wentToSignIn, false,
      "a signed-in client was sent to sign in again: " + JSON.stringify(navigations));
  });
});
