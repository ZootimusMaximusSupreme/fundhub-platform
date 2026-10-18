// Finish-853 batch 02: opening the Transfers page, practice test.
//
// Row (desks-e.json, public/app/money-transfers.html): "Open the page (client signed in, or
// staff with ?client_id=); 401 sends to /portal-login.html or /login.html?next=".
//
// The page is built from the REAL files (repair cycle 1). public/app/money-transfers.html is read as
// text: the script it loads is the file its <script src> points at (a missing file or a removed tag
// stops the test), and the stand-in page can only hand the script an element whose id is really in
// that html (a renamed #transfers-root, #money-back or #money-nav opens a blank page here too). The
// money nav's links are the html's own. The script then runs WHOLE in a vm with a fake network.
// The test reads the exact request the page sends on open, what it paints from the fake answer,
// and where a 401 sends the person. Practice test with fake data: not a real client's session.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { REPO_ROOT } from "./fin-b02-sql-kit.mjs";

const APP = path.join(REPO_ROOT, "public/app");
const HTML = fs.readFileSync(path.join(APP, "money-transfers.html"), "utf8");

/** Every local file the html asks the browser for (scripts and stylesheets), resolved under /app. */
function localAssets(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)) out.push({ kind: "script", src: m[1], tag: m[0] });
  for (const m of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/gi)) out.push({ kind: "style", src: m[1], tag: m[0] });
  return out.filter((a) => !/^(?:[a-z]+:)?\/\//i.test(a.src) && !a.src.startsWith("data:"));
}
const ASSETS = localAssets(HTML);
const SCRIPT = ASSETS.find((a) => a.kind === "script" && path.basename(a.src) === "money-transfers.js");
assert.ok(SCRIPT, "money-transfers.html no longer loads money-transfers.js, so the page opens blank");
const JS = fs.readFileSync(path.join(APP, SCRIPT.src), "utf8");

/** ids really present in the html, and the money nav's own links, in order. */
const HTML_IDS = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const NAV_HTML = /<nav\b[^>]*\bid="money-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(HTML);
const NAV_HREFS = NAV_HTML ? [...NAV_HTML[1].matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]) : [];
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "src/http/fixtures/money-transfers.sample.json"), "utf8"));
const PATH = "/app/money-transfers.html";
const flush = () => new Promise((r) => setImmediate(r));

/**
 * Open the standalone page. `search` is the address query; `role` is what the browser has saved
 * for the signed-in person (nothing for a logged-out one); `answer` is the fake network reply.
 */
async function openPage({ search = "", role = null, token = "", answer = { status: 200, body: FIXTURE } } = {}) {
  const calls = [];
  const stored = {};
  if (role) stored.fh_role = role;
  if (token) stored.fh_token = token;
  const root = { innerHTML: "", addEventListener() {}, removeEventListener() {}, contains: () => true };
  const attrs = new Map();
  const back = { setAttribute: (k, v) => attrs.set(`back:${k}`, v), textContent: "Back" };
  const links = NAV_HREFS.map((href) => ({
    href,
    getAttribute() { return this.href; },
    setAttribute(k, v) { if (k === "href") this.href = v; }
  }));
  const nav = { querySelectorAll: () => links };
  const location = { search, pathname: PATH, href: `${PATH}${search}` };
  const sandbox = {
    console,
    URLSearchParams,
    encodeURIComponent,
    setTimeout,
    Date,
    location,
    localStorage: { getItem: (k) => (Object.hasOwn(stored, k) ? stored[k] : null) },
    confirm: () => false,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { status: answer.status, json: async () => answer.body };
    },
    document: {
      readyState: "complete",
      // Only an element the real html has: a renamed or removed id is a null here, as in the browser.
      getElementById: (id) => (HTML_IDS.has(id) ? ({ "transfers-root": root, "money-back": back, "money-nav": nav })[id] || null : null),
      addEventListener() {}
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(JS, sandbox, { filename: "money-transfers.js" });
  for (let i = 0; i < 6; i += 1) await flush();
  return { calls, location, root, back: { attrs, node: back }, links, html: () => root.innerHTML };
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ");

test("Open as a client: one GET with no client id, the sign-in token sent, and the page paints the moves", async () => {
  const page = await openPage({ role: "client", token: "fake-token" });
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].url, "/api/money/transfers");
  assert.equal(page.calls[0].init.method, "GET");
  assert.equal(page.calls[0].init.headers.authorization, "Bearer fake-token");
  assert.equal(page.calls[0].init.credentials, "same-origin");
  const t = text(page.html());
  assert.match(t, /Transfers/);
  assert.match(t, /Waiting for your OK/);
  assert.match(t, /Practice mode/);
  assert.doesNotMatch(t, /Staff only/, "a client's own page carries no staff form");
  assert.equal(page.location.href, PATH, "an answered page stays where it is");
});

test("Open as staff with ?client_id=: the read carries that client, and the back link and nav keep it", async () => {
  const id = FIXTURE.client.id;
  const page = await openPage({ search: `?client_id=${id}`, role: "owner" });
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].url, `/api/money/transfers?client_id=${encodeURIComponent(id)}`);
  assert.equal(page.back.attrs.get("back:href"), `finance-os.html?client_id=${encodeURIComponent(id)}`);
  assert.equal(page.back.node.textContent, "Back to Finance OS");
  // The nav is the html's own seven links; each keeps the client, a #section stays after the query.
  assert.ok(page.links.length >= 5, "the money nav has its links in the html");
  assert.deepEqual(page.links.map((a) => a.href), NAV_HREFS.map((href) => {
    const [base, ...frag] = href.split("#");
    return `${base}?client_id=${encodeURIComponent(id)}${frag.length ? `#${frag.join("#")}` : ""}`;
  }));
  const t = text(page.html());
  assert.match(t, /Waiting for the client's OK/);
  assert.match(t, /Staff only/);
  assert.match(t, /Take it off the list/);
  assert.doesNotMatch(t, /Yes, move/, "staff never get the client's yes button");
});

test("401 for a client sends them to the client sign-in page", async () => {
  const page = await openPage({ role: "client", answer: { status: 401, body: { ok: false, error: "unauthorized" } } });
  assert.equal(page.calls.length, 1);
  assert.equal(page.location.href, "/portal-login.html");
});

test("401 for a person with no saved role and no client id also goes to the client sign-in page", async () => {
  const page = await openPage({ answer: { status: 401, body: null } });
  assert.equal(page.location.href, "/portal-login.html");
});

test("401 for staff sends them to the staff sign-in page, with this exact page as next", async () => {
  const page = await openPage({ role: "closer", answer: { status: 401, body: { ok: false } } });
  assert.equal(page.location.href, `/login.html?next=${encodeURIComponent(PATH)}`);
});

test("401 on a staff address (?client_id=) keeps the whole address in next, whatever the saved role", async () => {
  const id = FIXTURE.client.id;
  for (const role of [null, "owner", "client"]) {
    const page = await openPage({ search: `?client_id=${id}`, role, answer: { status: 401, body: null } });
    assert.equal(page.location.href, `/login.html?next=${encodeURIComponent(`${PATH}?client_id=${id}`)}`, String(role));
  }
});

test("a 401 never paints the page's error card, and other refusals do not sign the person out", async () => {
  const signedOut = await openPage({ role: "client", answer: { status: 401, body: null } });
  assert.doesNotMatch(text(signedOut.html()), /We could not load your money moves/);
  for (const status of [403, 500, 503]) {
    const page = await openPage({ role: "client", answer: { status, body: { ok: false } } });
    assert.equal(page.location.href, PATH, `status ${status} stays on the page`);
    assert.match(text(page.html()), /We could not load your money moves/, `status ${status} says so`);
    assert.match(page.html(), /data-act="retry"/);
  }
});

/* ── the page file itself: what the browser is told to load and where the script finds its places ── */

test("the html loads its script and its stylesheet from files that exist, and the script is not left out", () => {
  assert.ok(ASSETS.length >= 3, "the html asks for brand css, page css and the script");
  for (const a of ASSETS) {
    const file = a.src.startsWith("/") ? path.join(REPO_ROOT, "public", a.src.slice(1)) : path.join(APP, a.src);
    assert.ok(fs.existsSync(file), `${a.src} is not a file under public/app`);
    assert.ok(fs.statSync(file).size > 0, `${a.src} is empty`);
  }
  assert.match(SCRIPT.tag, /\bdefer\b/, "the script is deferred so the root exists when it runs");
});

test("every element the script looks for by id is in the html", () => {
  const wanted = [...JS.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(wanted)].sort(), ["money-back", "money-nav", "transfers-root"]);
  for (const id of new Set(wanted)) assert.ok(HTML_IDS.has(id), `#${id} is not in money-transfers.html`);
  // and the root really starts the page: it is inside <main>, with the loading line the script replaces
  assert.match(HTML, /<main>\s*<div id="transfers-root"/);
});

test("with the html's own ids the page opens and paints; with the root gone it would open blank", async () => {
  const page = await openPage({ role: "client", token: "fake-token" });
  assert.equal(page.calls.length, 1, "one read on open");
  assert.match(text(page.html()), /Transfers/);
  assert.notEqual(page.html(), "", "the root was painted");
});
