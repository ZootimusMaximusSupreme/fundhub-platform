/* Hole N14, live 2026-09-18 — a good load of the client portal said "We could
 * not load your file" for about a second before the client appeared.
 *
 * Staff opened /app/client-portal.html?id=<#11> and the line under the greeting
 * (#greeting-sub-pre) read "We could not load your file. Use the link we sent
 * you, or sign in again." from first paint until the file read landed — about a
 * second on the hole-13 reviewers' loads, 150–700 ms on the fixer's two looks.
 * The refusal was the line's STARTING text in the markup, so every load showed
 * it, good or bad.
 *
 * The fix: the line starts as loading words. The refusal is painted only when
 * there really is no file at this link — no id at all, or the staff read says
 * the id is no file (not found, or not an id).
 *
 * HOW THIS RUNS THE PAGE. The portal's main script is one DOMContentLoaded
 * handler that exports nothing, so it is EXECUTED — the whole shipped script,
 * not a slice — against a stub browser, the same way as
 * src/http/portal-staff-greeting.test.mjs. The line's starting text is read
 * from the shipped markup, and every text the script writes to it is recorded,
 * so the assertions cover everything a person could see on that line.
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
const REFUSAL = /We could not load your file/;

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

/* What the line says before any script runs — straight from the markup. */
function startingText() {
  const m = html.match(/<div\b[^>]*\bid="greeting-sub-pre"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(m, "#greeting-sub-pre is gone from client-portal.html");
  return m[1].trim();
}
const START = startingText();

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

/* The line under the greeting: starts as the markup says, keeps every text. */
function makeLine() {
  const el = makeEl();
  let text = START;
  const seen = [START];
  Object.defineProperty(el, "textContent", {
    get: () => text,
    set: (v) => { text = String(v); seen.push(text); }
  });
  return { el, seen };
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
const CLIENT_NO_FILE = {
  ok: true, principal: "client",
  staff: { id: "a2", role: "client", principal_kind: "client", name: "No File", status: "active" },
  had_call: true
};

const SIM_FILE = {
  ok: true, source: "api",
  data: {
    client: { first_name: "Sim", last_name: "Eleven-Blueprint", custom_fields: {} },
    latest_booking: null, messages: [], transactions: []
  }
};

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

/**
 * startPortal — execute the shipped main script. The staff file read
 * (FHData.client) is held open until `answer(res)` is called, so a test can
 * look at the line WHILE the read is in flight, which is the second the hole
 * was about.
 */
async function startPortal({ search = "", session = STAFF_CHRIS, store = { fh_role: "owner" } } = {}) {
  const els = new Map();
  const line = makeLine();
  els.set("greeting-sub-pre", line.el);
  const byId = (id) => { if (!els.has(id)) els.set(id, makeEl()); return els.get(id); };
  let answer = () => { throw new Error("the staff file read was never made"); };
  let ready = null;

  const FHData = {
    param: (k) => new URLSearchParams(search).get(k),
    client: () => new Promise((resolve) => { answer = resolve; }),
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
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(session) }),
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
  await settle();
  return {
    line,
    answer: async (res) => { answer(res); await settle(); },
    greeting: () => byId("greeting").textContent
  };
}

describe("client portal — the line under the greeting while the file loads (hole N14)", () => {
  test("the line starts as loading words, not the refusal", () => {
    assert.doesNotMatch(START, REFUSAL,
      "the markup starts the line as 'We could not load your file' — every good load shows it until the read lands");
    assert.match(START, /^Loading/, "the line should start as a loading state");
  });

  test("staff opening #11 by ?id= — never the refusal, before or after the file lands", async () => {
    const p = await startPortal({ search: "?id=" + ELEVEN });
    assert.doesNotMatch(p.line.el.textContent, REFUSAL, "while the file read is in flight the line says the file failed");
    assert.match(p.line.el.textContent, /^Loading/);
    await p.answer(SIM_FILE);
    assert.equal(p.greeting(), "Welcome back, Sim");
    assert.doesNotMatch(p.line.el.textContent, /^Loading/, "the loading words must go once the file lands");
    for (const t of p.line.seen) assert.doesNotMatch(t, REFUSAL, "a good load showed: " + t);
  });

  test("a client on their own link — never the refusal", async () => {
    const p = await startPortal({ search: "", session: CLIENT_SIM, store: { fh_role: "client" } });
    assert.doesNotMatch(p.line.el.textContent, /^Loading/, "the loading words must go once the client is known");
    for (const t of p.line.seen) assert.doesNotMatch(t, REFUSAL, "a good load showed: " + t);
  });

  test("a real failure still says so — staff with no id", async () => {
    const p = await startPortal({ search: "" });
    assert.match(p.line.el.textContent, REFUSAL);
  });

  test("a real failure still says so — a client with no file", async () => {
    const p = await startPortal({ search: "", session: CLIENT_NO_FILE, store: { fh_role: "client" } });
    assert.match(p.line.el.textContent, REFUSAL);
  });

  test("a real failure still says so — staff with an id that is no file", async () => {
    const p = await startPortal({ search: "?id=00000000-0000-4000-8000-000000000000" });
    await p.answer({ ok: false, source: "notfound", data: null, error: "no such record" });
    assert.match(p.line.el.textContent, REFUSAL, "a stale or wrong id must not end on a friendly welcome");
  });

  test("a real failure still says so — staff with something that is not an id", async () => {
    const p = await startPortal({ search: "?id=not-an-id" });
    await p.answer({ ok: false, source: "badrequest", data: null, error: "That request was not accepted." });
    assert.match(p.line.el.textContent, REFUSAL);
  });
});
