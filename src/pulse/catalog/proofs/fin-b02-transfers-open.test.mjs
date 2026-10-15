// Finish-853 batch 02: opening the Transfers page, practice test.
//
// Row (desks-e.json, public/app/money-transfers.html): "Open the page (client signed in, or
// staff with ?client_id=); 401 sends to /portal-login.html or /login.html?next=".
//
// public/app/money-transfers.js is run WHOLE in a vm with a stand-in page and a fake network.
// The test reads the exact request the page sends on open, what it paints from the fake answer,
// and where a 401 sends the person. Practice test with fake data: not a real client's session.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { REPO_ROOT } from "./fin-b02-sql-kit.mjs";

const JS = fs.readFileSync(path.join(REPO_ROOT, "public/app/money-transfers.js"), "utf8");
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
  const links = ["money-overview.html", "money-banks.html#plan"].map((href) => ({
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
      getElementById: (id) => ({ "transfers-root": root, "money-back": back, "money-nav": nav })[id] || null,
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
  assert.deepEqual(page.links.map((a) => a.href), [
    `money-overview.html?client_id=${encodeURIComponent(id)}`,
    `money-banks.html?client_id=${encodeURIComponent(id)}#plan`
  ]);
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
