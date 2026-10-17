/* Hole 13 round 2, live 2026-09-18 — the staff view of #11's portal greeted the
 * person signed in, not the client on the file.
 *
 * A browser holding the staff sign-in cookie but no saved role (fh_role) —
 * storage cleared, a fresh tab after a wipe — opened
 * /app/client-portal.html?id=<#11> and read "Welcome back, Chris" / "Chris
 * Stanbridge" for the whole first load, 4 of 4. The page decided "staff or
 * client" from the saved role alone, found none, took the client branch and
 * painted the session's own name. A reload said Sim only because shell.js had
 * saved the role in between.
 *
 * The fix: with no saved role, the page waits on the session read it already
 * makes and takes the role from that answer.
 *
 * HOW THIS RUNS THE PAGE. The portal's main script is one DOMContentLoaded
 * handler that exports nothing, so it is EXECUTED — the whole shipped script,
 * not a slice — against a stub browser, and the assertions read the greeting a
 * person would see. The session answer and the saved role are the only things
 * that differ between cases, plus the query string. Same approach as
 * src/http/portal-signed-out-bounce.test.mjs.
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

const ELEVEN = "029964c5-4d8e-47ed-88c9-53ac13863fd4";

/* The script right after data.js is the portal's main one. */
function mainScript() {
  const tag = '<script defer src="data.js"></script>';
  const a = html.indexOf(tag);
  assert.ok(a !== -1, "data.js tag is gone from client-portal.html");
  const open = html.indexOf("<script>", a + tag.length);
  const close = html.indexOf("</script>", open);
  const src = html.slice(open + "<script>".length, close);
  assert.match(src, /DOMContentLoaded/, "the main portal script moved");
  return src;
}
const MAIN = mainScript();

function makeEl() {
  const el = {
    textContent: "", innerHTML: "", hidden: false, value: "", href: "",
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener() {}, appendChild() {}, insertBefore() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null
  };
  el.parentNode = el;
  return el;
}

const STAFF_CHRIS = {
  ok: true, principal: "staff",
  staff: { id: "s1", role: "owner", name: "Chris Stanbridge", email: "chris@fundhub.ai", status: "active" }
};
const CLIENT_SIM = {
  ok: true, principal: "client",
  staff: { id: "a1", role: "client", principal_kind: "client", name: "Sim Eleven-Blueprint", client_id: ELEVEN, status: "active" },
  had_call: true
};
const NOBODY = { ok: false, error: "unauthorized" };

/**
 * runPortal — execute the shipped main script and hand back what it painted.
 * `session` is what GET /api/auth/session answers; `store` is local storage.
 */
async function runPortal({ search = "", session = NOBODY, store = {} } = {}) {
  const els = new Map();
  const byId = (id) => { if (!els.has(id)) els.set(id, makeEl()); return els.get(id); };
  const calls = { client: [], session: 0, order: [] };
  let ready = null;

  const FHData = {
    param: (k) => new URLSearchParams(search).get(k),
    client: (id) => {
      calls.client.push(id);
      calls.order.push("client");
      return Promise.resolve({
        ok: true,
        data: {
          client: { first_name: "Sim", last_name: "Eleven-Blueprint", custom_fields: {} },
          latest_booking: null, messages: [], transactions: []
        }
      });
    },
    wire() {}, banner() {},
    portalContracts: () => ({}), portalSummary: () => Promise.resolve({ ok: true, data: { upcoming_call: null } }), entitlements: () => ({})
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    URLSearchParams, URL, Date, JSON, Promise,
    setTimeout: () => 0, clearTimeout() {},
    location: { search, pathname: "/app/client-portal.html", href: "https://fundhub.ai/app/client-portal.html" + search },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    fetch: (url) => {
      if (String(url).startsWith("/api/auth/session")) {
        calls.session++;
        calls.order.push("session");
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(session) });
    },
    FHData,
    document: {
      body: makeEl(),
      getElementById: byId,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => makeEl(),
      addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") ready = fn; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(MAIN, sandbox);
  assert.ok(ready, "the portal script no longer starts on DOMContentLoaded");
  await ready();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return {
    greeting: byId("greeting").textContent,
    pill: byId("who-name").textContent,
    calls
  };
}

describe("client portal — the staff view greets the client on the file (hole 13)", () => {
  test("staff cookie, no saved role, ?id= — greets Sim, not the person signed in", async () => {
    const r = await runPortal({ search: "?id=" + ELEVEN, session: STAFF_CHRIS });
    assert.equal(r.greeting, "Welcome back, Sim", "the greeting must name the client on the file");
    assert.equal(r.pill, "Sim Eleven-Blueprint");
    assert.deepEqual(r.calls.client, [ELEVEN], "a staff session reads the client file");
  });

  test("staff cookie, no saved role, ?client_id= — same answer", async () => {
    const r = await runPortal({ search: "?client_id=" + ELEVEN, session: STAFF_CHRIS });
    assert.equal(r.greeting, "Welcome back, Sim");
    assert.equal(r.pill, "Sim Eleven-Blueprint");
    assert.deepEqual(r.calls.client, [ELEVEN]);
  });

  test("staff with a saved role — unchanged, and no wait on the session first", async () => {
    const r = await runPortal({ search: "?id=" + ELEVEN, session: STAFF_CHRIS, store: { fh_role: "owner" } });
    assert.equal(r.greeting, "Welcome back, Sim");
    assert.deepEqual(r.calls.client, [ELEVEN]);
    assert.equal(r.calls.session, 0, "a saved role answers without asking the server");
  });

  test("a client with no saved role on their own ?id= — greeted by their own name, no staff read", async () => {
    const r = await runPortal({ search: "?id=" + ELEVEN, session: CLIENT_SIM });
    assert.equal(r.greeting, "Welcome back, Sim");
    assert.equal(r.pill, "Sim Eleven-Blueprint");
    assert.deepEqual(r.calls.client, [], "a client never calls the staff-only client read");
  });

  test("a client signed in, saved role client, no id in the link — unchanged", async () => {
    const r = await runPortal({ search: "", session: CLIENT_SIM, store: { fh_role: "client" } });
    assert.equal(r.greeting, "Welcome back, Sim");
    assert.deepEqual(r.calls.client, []);
  });

  test("a stranger with ?id= — no staff read, no borrowed name", async () => {
    const r = await runPortal({ search: "?id=" + ELEVEN, session: NOBODY });
    assert.deepEqual(r.calls.client, [], "nobody signed in must not get the staff read");
    assert.equal(r.greeting, "Welcome");
    assert.equal(r.pill, "—");
  });
});
