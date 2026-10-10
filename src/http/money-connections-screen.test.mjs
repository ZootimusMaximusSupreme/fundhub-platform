// /app/money-connections.html — a client's merchant processors.
// Runs money-connections.js's own render functions against a fixture that the
// real handlers produced (api/money/connections.mjs over the in-memory 442
// tables, for the test client's real containers).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-connections.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-connections.js"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-connections.sample.json"), "utf8"));

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window.FHMoneyConnections;
}
const M = load();
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("client frame: no staff shell, reads the connections endpoint", () => {
  assert.match(HTML, /<script defer src="money-connections\.js"><\/script>/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.match(HTML, /class="app"/);
  assert.match(JS, /"\/api\/money\/connections"/);
});

test("the shared money nav: six links, board order, Connections is current", () => {
  const hrefs = [...HTML.matchAll(/<nav class="mnav"[\s\S]*?<\/nav>/g)][0][0].match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
  assert.deepEqual(hrefs, ["/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
    "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup"]);
  assert.match(HTML, /href="\/app\/financeos\.html#connections" aria-current="page"/);
});

test("no px font sizes and no inline styles (UI-STANDARDS §12.7)", () => {
  assert.doesNotMatch(HTML, /font-size:\s*\d+px/);
  assert.doesNotMatch(HTML + JS, /style="/);
});

test("full state: tiles with a comparison, three processor cards, month table per container", () => {
  const d = fixture();
  const html = M.render(d, null);
  const t = text(html);
  assert.match(t, /Sales this month \$1,791\.00 3 sales · down \$503\.00 vs last month/);
  assert.match(t, /Refunds this month \$0\.00 down \$297\.00 vs last month/);
  for (const name of ["Commas", "Whop", "Open API"]) assert.match(html, new RegExp(`<h2 class="prov-name">${name}</h2>`));
  assert.match(t, /Waiting for secret/);
  assert.match(t, /Key ending in SNYc/);
  assert.match(html, /\/api\/webhooks\/merchant-whop\//);
  assert.match(t, /Month over month/);
  assert.match(t, /Sep 2026 \$2,294\.00 \$297\.00 \$68\.90 \$1,928\.10 \$1,800\.00/);
  assert.match(html, /data-act="disable"/);
});

test("status is said in words, never colour alone (UI-STANDARDS §12.6)", () => {
  const html = M.render(fixture(), null);
  assert.match(html, /class="state state-active">Connected</);
  assert.match(html, /class="state state-waiting">Waiting for secret</);
});

test("the key shows only in the reveal right after create, with a copy button", () => {
  const d = fixture();
  const api = d.connections.find((c) => c.provider === "api");
  const shown = M.render(d, { id: api.id, api_key: "fhm_TESTKEYTESTKEYTESTKEY" });
  assert.match(text(shown), /shown this one time/);
  assert.match(shown, /data-copy="fhm_TESTKEYTESTKEYTESTKEY"/);
  assert.doesNotMatch(M.render(d, null), /fhm_TESTKEY/);
});

test("empty: no connection → dashes and a plain next step, never $0.00 tiles", () => {
  const d = fixture();
  d.connections = [];
  d.summary.containers = [];
  const t = text(M.render(d, null));
  assert.match(t, /No processor connected yet/);
  assert.match(t, /Sales this month — connect a processor to see this/);
  assert.doesNotMatch(t, /Month over month/);
});

test("empty: no business → one action, add a business", () => {
  const d = fixture();
  d.connections = [];
  d.containers = [];
  const html = M.render(d, null);
  assert.match(text(html), /No business set up yet/);
  assert.match(html, /href="\/app\/money-accounts\.html">Add a business/);
  assert.doesNotMatch(html, /data-act="create"/);
});

test("loading is skeletons in the real layout; error says what failed and offers a retry", () => {
  assert.match(M.renderLoading(), /aria-busy="true"/);
  const err = M.renderError("nodb");
  assert.match(err, /role="alert"/);
  assert.match(err, /database is not answering/);
  assert.match(err, /data-act="retry"/);
  assert.equal(M.classify({ status: 401, body: null }), "signin");
  assert.equal(M.classify({ status: 200, body: { ok: true } }), "ok");
});

test("mountable section: FinanceOS.sections.connections.mount(el, ctx) paints into el via ctx.apiGet", async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  const section = sandbox.window.FinanceOS.sections.connections;
  assert.equal(typeof section.mount, "function");
  const classes = new Set();
  const el = {
    innerHTML: "", classList: { add: (c) => classes.add(c) },
    addEventListener() {}, removeEventListener() {}, contains: () => true
  };
  const asked = [];
  const handle = section.mount(el, {
    clientId: "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e",
    apiGet: async (p) => { asked.push(p); return { status: 200, body: fixture() }; },
    apiPost: async () => ({ status: 500, body: null })
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, ["/api/money/connections?client_id=f1cb9c27-f858-4db1-b6bb-4eddc898bb8e"]);
  assert.ok(classes.has("fos-connections"), "scopes the section CSS");
  assert.match(el.innerHTML, /Sales this month/);
  assert.doesNotMatch(el.innerHTML, /class="mbar"|class="mnav"/, "no page chrome inside the section");
  let signedOut = false;
  const el2 = { ...el, innerHTML: "" };
  section.mount(el2, { apiGet: async () => ({ status: 401, body: null }), onSignIn: () => { signedOut = true; } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(signedOut, true);
  handle.unmount();
  assert.equal(el.innerHTML, "");
});

test("the CSS is scoped to the section, so it cannot leak into other FinanceOS tabs", () => {
  const css = fs.readFileSync(path.join(APP, "money-connections.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "")
    .replace(/@media[^{]+\{/g, "").match(/[^{}]+(?=\{)/g).map((s) => s.trim()).filter(Boolean);
  for (const group of selectors) {
    for (const sel of group.split(",")) assert.match(sel.trim(), /^\.fos-connections\b/, `unscoped selector: ${sel}`);
  }
  assert.doesNotMatch(css, /font-size:\s*\d+px/);
});

/* Pull mode (migration 457): the same fixture with Whop switched to "Paste your
   API key". Fields are the ones publicConnection() adds for a pull row. */
function pullFixture(patch = {}) {
  const d = fixture();
  const w = d.connections.find((c) => c.provider === "whop");
  Object.assign(w, {
    mode: "pull", status: "active", webhook_url: null, has_secret: null, has_api_key: true, api_key_hint: "9f2c",
    last_synced_at: "2026-10-06T11:00:00.000Z", last_sync_error: null, sync_partway: false
  }, patch);
  d.__now = Date.parse("2026-10-06T12:00:00Z");
  return { d, w };
}

test("Commas and Whop offer 'Paste your API key' (default) or webhook; the open API does not", () => {
  const html = M.render(fixture(), null);
  for (const p of ["commas", "whop"]) {
    assert.match(html, new RegExp(`<select id="mode-${p}" data-mode="${p}"><option value="pull">Paste your API key`));
  }
  assert.doesNotMatch(html, /data-mode="api"/);
});

test("pull connection: key hint, last synced, Sync now, a key box — never a webhook address or a saved key", () => {
  const { d, w } = pullFixture();
  const html = M.render(d, null);
  const block = html.slice(html.indexOf(`data-conn="${w.id}"`));
  const t = text(block.slice(0, block.indexOf("act-msg")));
  assert.match(t, /Read with your API key ending in 9f2c · Last synced: 1h ago/);
  assert.match(block, new RegExp(`data-act="sync" data-id="${w.id}">Sync now<`));
  assert.match(block, new RegExp(`data-apikey="${w.id}"`));
  assert.match(t, /API key saved\. Paste a new one to replace it\./);
  assert.doesNotMatch(block.slice(0, block.indexOf("act-msg")), /merchant-whop|data-secret/);
});

test("pull connection waiting for a key says so in words; no Sync now until a key is saved", () => {
  const { d, w } = pullFixture({ status: "waiting", has_api_key: false, api_key_hint: null, last_synced_at: null });
  const html = M.render(d, null);
  assert.match(html, /class="state state-waiting">Waiting for API key</);
  const block = html.slice(html.indexOf(`data-conn="${w.id}"`));
  assert.match(text(block), /Paste your Whop API key/);
  assert.match(text(block), /Last synced: never/);
  assert.doesNotMatch(block.slice(0, block.indexOf("act-msg")), /data-act="sync"/);
});

test("a failed or partway sync is said in words; Sync now answers back under the connection", () => {
  const { d, w } = pullFixture({ last_sync_error: "The processor did not accept this API key.", sync_partway: true });
  const html = M.render(d, null, { id: w.id, text: "Synced. 4 new items." });
  assert.match(text(html), /Last sync did not finish: The processor did not accept this API key\./);
  assert.match(text(html), /Still reading your history/);
  assert.match(html, /aria-live="polite">Synced\. 4 new items\.</);
});

test("money: cents to dollars, null is a dash", () => {
  assert.equal(M.money(179100), "$1,791.00");
  assert.equal(M.money(null), "—");
  assert.equal(M.money(-500), "−$5.00");
});
