// /app/money-setup.html — runs money-setup.js's own render functions against
// fixtures. Prices not set paint "$X"; done is only what the read says.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readSetupStatus } from "../finance/money-setup.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-setup.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-setup.js"), "utf8");

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window.FHMoneySetup;
}
const S = load();
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function fresh() {
  return {
    ok: true,
    client: { id: "c1", name: "Ada Lane" },
    paid: false, paid_at: null,
    setup_fee_cents: null, price_per_container_cents: null,
    containers: 0, monthly_cents: null, open_checkout: null,
    soft_pull: { requested: false, completed: false, last_pulled_at: null, price: { base_cents: 3200, business_addon_cents: 1000 } },
    entitled: false,
    steps: [
      { key: "pay", label: "Pay setup fee", done: false },
      { key: "soft_pull", label: "Run your soft pull", done: false },
      { key: "accounts", label: "Add your businesses and accounts", done: false },
      { key: "live", label: "You're live", done: false }
    ],
    current_step: "pay"
  };
}

test("the page loads money-setup.js, keeps out of the staff shell, and carries the money nav", () => {
  assert.match(HTML, /<script defer src="money-setup\.js"><\/script>/);
  assert.match(HTML, /id="setup-root"/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.match(JS, /"\/api\/money\/setup"/);
  const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/);
  assert.ok(nav);
  const hrefs = [...nav[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
    "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup"]);
  assert.match(nav[0], /<a href="\/app\/financeos\.html#setup" aria-current="page">Setup<\/a>/);
});

test("no price set: $X everywhere, no pay button, soft pull is the one primary action", () => {
  const html = S.render(fresh());
  const t = text(html);
  assert.match(t, /Pay setup fee \(\$X\)/);
  assert.match(t, /Setup \$X one time · \$X per container per month · you have 0 containers/);
  assert.match(t, /The setup price is not set yet/);
  assert.doesNotMatch(html, /data-act="checkout"/, "a pay button with no price would do nothing");
  assert.doesNotMatch(t, /\$0\.00/);
  assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
  assert.match(html, /class="btn-primary" type="button" data-act="soft-pull"/);
  assert.match(t, /not a hard inquiry/);
  assert.match(t, /\$32\.00, plus \$10\.00 for each business/);
  assert.match(html, /href="money-accounts\.html"/);
});

test("price set: pay button is the primary, labelled with the amount", () => {
  const d = fresh();
  d.setup_fee_cents = 49700;
  d.price_per_container_cents = 4900;
  d.containers = 2;
  const html = S.render(d);
  assert.match(html, /class="btn-primary" type="button" data-act="checkout">Pay \$497\.00 setup</);
  assert.match(html, /class="btn-line" type="button" data-act="soft-pull"/);
  assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
  assert.match(text(html), /Setup \$497\.00 one time · \$49\.00 per container per month · you have 2 containers/);
});

test("an open checkout says finish paying and links to it", () => {
  const d = fresh();
  d.open_checkout = { url: "https://pay.example/x", amount_cents: 49700 };
  const html = S.render(d);
  assert.match(html, /href="https:\/\/pay\.example\/x"[^>]*>Finish paying</);
});

test("done steps say Done in words, with dates; all done shows the live link", () => {
  const d = fresh();
  d.paid = true; d.paid_at = "2026-10-01T10:00:00Z";
  d.soft_pull.requested = true; d.soft_pull.completed = true; d.soft_pull.last_pulled_at = "2026-10-03T15:00:00Z";
  d.containers = 2; d.entitled = true;
  d.steps.forEach((s) => { s.done = true; });
  d.current_step = null;
  const html = S.render(d);
  const t = text(html);
  assert.match(t, /Done · paid Oct 1, 2026/);
  assert.match(t, /Done · last pulled Oct 3, 2026/);
  assert.match(t, /Done · 2 containers/);
  assert.match(t, /4 of 4 steps done/);
  assert.match(html, /href="money\.html">Open Money</);
  assert.doesNotMatch(html, /class="btn-primary"/);
});

test("a pull in flight shows waiting, and no button to start another", () => {
  const d = fresh();
  d.soft_pull.requested = true;
  const html = S.render(d);
  assert.match(text(html), /Waiting on results/);
  assert.doesNotMatch(html, /data-act="soft-pull"/);
});

/* R07 — a Capital Blueprint buyer already has Finance OS. They owe no setup fee. */
test("R07: the real read for a client who already has Finance OS paints pay Done and no Pay button", async () => {
  const CID = "11111111-2222-3333-4444-555555555555";
  const db = {
    query: async (sql) => {
      if (/FROM clients/.test(sql)) return { rows: [{ id: CID, first_name: "Ada", last_name: "Lane" }] };
      if (/FROM payment_links/.test(sql)) {
        return { rows: [{ id: "pl-old", status: "sent", amount_cents: 49700, checkout_url: "https://pay.example/old" }] };
      }
      if (/FROM subscriptions/.test(sql)) return { rows: [{ id: "sub-blueprint" }] };
      if (/FROM entities/.test(sql)) return { rows: [{ n: 0 }] };
      return { rows: [] };
    }
  };
  const read = await readSetupStatus(db, {
    orgId: "org-1", clientId: CID, env: { FINANCE_OS_SETUP_FEE_CENTS: "49700" }, asOf: new Date("2026-10-14T12:00:00Z")
  });
  const html = S.render(JSON.parse(JSON.stringify(read)));
  assert.doesNotMatch(html, /data-act="checkout"/, "no Pay button for someone who already has Finance OS");
  assert.doesNotMatch(text(html), /Finish paying/);
  assert.match(html, /<li class="step done" data-step="pay">/);
  assert.match(text(html), /Pay setup fee \(\$497\.00\)/, "the existing step label stays");
  assert.match(html, /class="btn-primary" type="button" data-act="soft-pull"/, "the soft pull is the one filled button");
  assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
});

test("R07: an entitled payload whose pay step is still open never paints a Pay button", () => {
  const d = fresh();
  d.entitled = true;
  d.setup_fee_cents = 49700;
  d.open_checkout = { url: "https://pay.example/old", amount_cents: 49700 };
  d.steps[3].done = true; // live
  const html = S.render(d);
  assert.doesNotMatch(html, /data-act="checkout"/);
  assert.doesNotMatch(html, /Finish paying/);
  assert.match(html, /<li class="step done" data-step="pay">/);
  assert.match(text(html), /2 of 4 steps done/);
  assert.equal(S.primaryKey(d), "soft_pull");
});

test("R07: a stale page whose Pay button is pressed after the plan went on reloads, and says nothing wrong", async () => {
  const listeners = {};
  const el = { innerHTML: "", addEventListener: (t, f) => { listeners[t] = f; }, contains: () => true };
  const msg = { textContent: "" };
  const btn = {
    textContent: "Pay $497.00 setup", disabled: false,
    getAttribute: () => "checkout", parentNode: { querySelector: () => msg }, closest() { return btn; }
  };
  let reads = 0;
  const apiGet = async () => { reads += 1; return { status: 200, body: { ...fresh(), setup_fee_cents: 49700 } }; };
  const apiPost = async () => ({ status: 409, body: { ok: false, error: "already_entitled" } });
  S.mount(el, { clientId: "c1", apiGet, apiPost });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(reads, 1);
  listeners.click({ target: btn });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(reads, 2, "the page re-reads so the step repaints");
  assert.equal(msg.textContent, "", "no 'checkout page could not be opened' message");
});

test("loading and error states", () => {
  assert.match(S.renderLoading(), /aria-busy="true"/);
  assert.match(S.renderError("offline"), /could not reach the server/);
  assert.match(S.renderError("server"), /role="alert"/);
  assert.match(S.renderError("server"), /data-act="retry"/);
  assert.equal(S.classify({ status: 401, body: null }), "signin");
  assert.equal(S.classify({ status: 200, body: { ok: true } }), "ok");
  assert.match(S.actWords({ status: 409, body: { error: "price_not_set" } }, "checkout"), /not set yet/);
});
