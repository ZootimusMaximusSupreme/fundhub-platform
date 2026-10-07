// /app/financeos.html — the client's one-page FinanceOS (owner call 2026-10-06:
// "it all should be on 1 page"). Runs financeos.js and every section script in
// Node against a tiny fake page. No browser, no database.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "financeos.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "financeos.js"), "utf8");
const OVERVIEW = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-overview.sandbox.json"), "utf8"));

const TABS = ["overview", "next", "plan", "banks", "strategy", "fundability", "accounts", "credit", "connections", "payments", "setup"];
const LABELS = ["Overview", "Next steps", "Plan", "Banks", "Strategy", "Fundability", "Accounts", "Credit", "Connections", "Payments", "Setup"];
const SCRIPTS = ["money.js", "money-next.js", "money-plan.js", "money-banks.js", "money-strategy.js", "money-fundability.js", "money-accounts.js", "money-credit.js", "money-connections.js", "money-payments.js", "money-setup.js"];
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the page has every tab, in order, each opening its own panel", () => {
  const nav = HTML.match(/<nav class="fos-tabs"[\s\S]*?<\/nav>/);
  assert.ok(nav, "financeos.html lost its tab bar");
  const tabs = [...nav[0].matchAll(/<a role="tab" id="tab-([a-z]+)" href="#([a-z]+)" aria-controls="fos-([a-z]+)"[^>]*>([^<]+)<\/a>/g)];
  assert.deepEqual(tabs.map((m) => m[1]), TABS);
  assert.deepEqual(tabs.map((m) => m[2]), TABS);
  assert.deepEqual(tabs.map((m) => m[3]), TABS);
  assert.deepEqual(tabs.map((m) => m[4]), LABELS);
  for (const k of TABS) {
    assert.match(HTML, new RegExp('<section class="fos-panel" id="fos-' + k + '" role="tabpanel" aria-labelledby="tab-' + k + '"'));
  }
  assert.match(HTML, /<span class="sub">FinanceOS<\/span>/);
  assert.match(HTML, /id="fos-sandbox" role="note" hidden/);
  assert.doesNotMatch(HTML, /src="shell\.js"/, "client-facing: no staff shell");
  assert.doesNotMatch(HTML, /FundHub/);
});

test("the page loads every section script, then financeos.js last, and both section stylesheets", () => {
  const srcs = [...HTML.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  // money-trends.js (wave 4, H6) is not a tab: it draws the Trends line graphs
  // inside Overview and the sales line under Connections. It loads right after
  // money.js, before financeos.js mounts anything.
  assert.deepEqual(srcs, [SCRIPTS[0], "money-trends.js", ...SCRIPTS.slice(1), "financeos.js"]);
  assert.match(HTML, /<link rel="stylesheet" href="money-connections\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="money-payments\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="money-next\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="money-plan\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="money-banks\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="money-strategy\.css">/);
  assert.match(HTML, /<link rel="stylesheet" href="money-fundability\.css">/);
  // Each section script says which tab it fills.
  const keys = { "money.js": "overview", "money-next.js": "next", "money-plan.js": "plan", "money-banks.js": "banks", "money-strategy.js": "strategy", "money-fundability.js": "fundability", "money-accounts.js": "accounts", "money-credit.js": "credit",
    "money-connections.js": "connections", "money-payments.js": "payments", "money-setup.js": "setup" };
  for (const s of SCRIPTS) {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(APP, s), "utf8"), sandbox);
    const sec = sandbox.window.FinanceOS && sandbox.window.FinanceOS.sections && sandbox.window.FinanceOS.sections[keys[s]];
    assert.ok(sec && typeof sec.mount === "function", s + " does not expose FinanceOS.sections." + keys[s]);
  }
});

test("section styles are scoped, so one tab's .chart or .grid never reaches another", () => {
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const k of ["overview", "accounts", "credit", "setup"]) assert.match(css, new RegExp("#fos-" + k + " \\.card\\{"));
  assert.match(css, /:where\(#fos-payments\) \.card\{/);
  // No bare section selector at the top level: every .chart / .grid rule is scoped.
  assert.doesNotMatch(css, /(^|\})\s*\.(chart|grid|tiles|acct|key|legend)\b/m);
});

test("hash routing: #tab picks the tab, anything else opens Overview", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  const F = sandbox.window.FHFinanceOS;
  assert.equal(F.tabFromHash("#accounts"), "accounts");
  assert.equal(F.tabFromHash("#Payments"), "payments");
  assert.equal(F.tabFromHash(""), "overview");
  assert.equal(F.tabFromHash("#nope"), "overview");
  // Links to the old standalone pages switch tabs instead of leaving.
  assert.equal(F.tabForHref("money-credit.html"), "credit");
  assert.equal(F.tabForHref("/app/money-accounts.html?client_id=x"), "accounts");
  assert.equal(F.tabForHref("money.html"), "overview");
  assert.equal(F.tabForHref("/app/financeos.html#setup"), "setup");
  assert.equal(F.tabForHref("https://pay.example/checkout"), "");
  assert.equal(F.tabForHref("client-portal.html"), "");
  assert.equal(F.tabForHref("/portal-login.html"), "");
});

/* A fake page just big enough for financeos.js: the tab links, the panels,
   main, the header bits, location and fetch. */
function fakePage(hash, sections, opts = {}) {
  const els = {};
  const listeners = {};
  function el(id) {
    const e = { id, hidden: false, innerHTML: "", textContent: "", attrs: {}, listeners: {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; }, addEventListener(k, fn) { this.listeners[k] = fn; },
      classList: { list: [], add(c) { this.list.push(c); } }, focus() {} };
    els[id] = e;
    return e;
  }
  for (const k of TABS) { el("tab-" + k); el("fos-" + k); }
  ["fos-client", "fos-sandbox", "money-back"].forEach(el);
  const tabs = el("tabs");
  tabs.scrollWidth = 0; tabs.clientWidth = 0;
  const main = el("main");
  const body = el("body");
  const fetched = [];
  const location = { hash, search: opts.search || "", pathname: "/app/financeos.html", href: "/app/financeos.html" + hash };
  const window = {
    FinanceOS: { sections },
    location,
    localStorage: { getItem: (k) => (opts.storage || {})[k] || null },
    addEventListener(k, fn) { listeners[k] = fn; },
    fetch(p) {
      fetched.push(p);
      const status = opts.status || 200;
      return Promise.resolve({ status, json: () => Promise.resolve(status === 200 ? OVERVIEW : { ok: false }) });
    },
    document: {
      readyState: "complete", title: "", body,
      getElementById: (id) => els[id] || null,
      querySelector: (s) => (s === ".fos-tabs" ? tabs : s === "main" ? main : null)
    }
  };
  return { window, els, listeners, fetched, location };
}

function fakeSection() {
  const calls = [];
  return { calls, mount(el, ctx) { calls.push({ el, ctx }); el.innerHTML = "mounted " + el.id; return { reload() {} }; } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("only the open tab mounts; a hash change mounts the next one once; a missing section says Coming soon", async () => {
  const accounts = fakeSection();
  const credit = fakeSection();
  const page = fakePage("#accounts", { accounts, credit });
  vm.runInNewContext(JS, { window: page.window, URLSearchParams });
  await tick();
  assert.equal(accounts.calls.length, 1, "the open tab mounts");
  assert.equal(credit.calls.length, 0, "a closed tab does not mount");
  assert.equal(page.els["fos-accounts"].hidden, false);
  assert.equal(page.els["fos-overview"].hidden, true);
  assert.equal(page.els["tab-accounts"].attrs["aria-selected"], "true");
  assert.equal(page.els["tab-overview"].attrs["aria-selected"], "false");
  const ctx = accounts.calls[0].ctx;
  assert.equal(typeof ctx.apiGet, "function");
  assert.equal(typeof ctx.apiPost, "function");

  page.location.hash = "#credit";
  page.listeners.hashchange();
  page.location.hash = "#accounts";
  page.listeners.hashchange();
  page.location.hash = "#credit";
  page.listeners.hashchange();
  assert.equal(credit.calls.length, 1, "a tab mounts once, the first time it opens");
  assert.equal(accounts.calls.length, 1);

  page.location.hash = "#payments";
  page.listeners.hashchange();
  assert.match(page.els["fos-payments"].innerHTML, /coming soon/i);
  assert.equal(page.els["fos-payments"].hidden, false);
});

test("the header shows the client name and the sandbox banner from one overview read, shared with the Overview tab", async () => {
  const overview = fakeSection();
  const page = fakePage("", { overview });
  vm.runInNewContext(JS, { window: page.window, URLSearchParams });
  await tick();
  assert.equal(page.els["fos-client"].textContent, "Test Test");
  assert.equal(page.els["fos-sandbox"].hidden, false);
  assert.deepEqual(page.els.body.classList.list, ["fos-has-sandbox"]);
  const res = await overview.calls[0].ctx.apiGet("/api/money/overview");
  assert.equal(res.status, 200);
  assert.deepEqual(page.fetched, ["/api/money/overview"], "the overview read is made once, not twice");
});

test("staff: ?client_id= rides to every section and the back link goes to Finance OS", async () => {
  const accounts = fakeSection();
  const cid = "11111111-1111-4111-8111-111111111111";
  const page = fakePage("#accounts", { accounts }, { search: "?client_id=" + cid });
  vm.runInNewContext(JS, { window: page.window, URLSearchParams });
  await tick();
  assert.equal(accounts.calls[0].ctx.clientId, cid);
  assert.deepEqual(page.fetched, ["/api/money/overview?client_id=" + cid]);
  assert.equal(page.els["money-back"].attrs.href, "finance-os.html?client_id=" + cid);
});

test("a 401 sends a client to /portal-login.html and staff to /login.html, back to the same tab", async () => {
  const client = fakePage("#credit", {}, { status: 401 });
  vm.runInNewContext(JS, { window: client.window, URLSearchParams });
  await tick();
  assert.equal(client.location.href, "/portal-login.html");
  const staff = fakePage("#credit", {}, { status: 401, search: "?client_id=abc" });
  vm.runInNewContext(JS, { window: staff.window, URLSearchParams });
  await tick();
  assert.equal(staff.location.href, "/login.html?next=" + encodeURIComponent("/app/financeos.html?client_id=abc#credit"));
});

test("no element sums personal and business cash", () => {
  // The frame adds no number of its own.
  assert.doesNotMatch(JS, /cents|\.cash\b|cash\./, "financeos.js should never touch a money figure");
  assert.doesNotMatch(text(HTML), /total cash/i);
  // And the Overview tab it mounts keeps the two apart.
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(APP, "money.js"), "utf8"), sandbox);
  const t = text(sandbox.window.FHMoney.render(JSON.parse(JSON.stringify(OVERVIEW))));
  assert.match(t, /Personal cash \$4,210\.55/);
  assert.match(t, /Business cash \$18,750\.00/);
  assert.doesNotMatch(t, /22,960\.55/, "personal + business cash was added into one number");
  assert.doesNotMatch(t, /total cash/i);
});

test("the portal card and the client's allowed list point at the one page", () => {
  const portal = fs.readFileSync(path.join(APP, "client-portal.html"), "utf8");
  assert.match(portal, /id="money-link" href="\/app\/financeos\.html"/);
  assert.match(portal, /<div class="fb-t">FinanceOS<\/div>/);
  const shell = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
  assert.match(shell, /client: \["client-portal\.html", "affiliate\.html",\s*"financeos\.html"/);
});

test("the Overview tab's loan table renders and its CSS is copied in, scoped (wave 4, H2)", () => {
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /#fos-overview \.debt-side\{display:flex;flex-direction:column;gap:16px;min-width:0\}/);
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(APP, "money.js"), "utf8"), sandbox);
  const d = JSON.parse(JSON.stringify(OVERVIEW));
  d.debt.loans = [{ account_id: "x", name: "Mortgage", mask: "7707", container_id: null, kind: "personal",
    balance_cents: 31250000, due_on: "2026-11-15", payment_cents: 189900 }];
  const t = text(sandbox.window.FHMoney.render(d));
  assert.match(t, /By loan/);
  assert.match(t, /Mortgage ••7707 Personal \$312,500\.00 \$1,899\.00 Nov 15, 2026/);
});
