// /app/money-accounts.html — the client's Accounts page.
// Runs money-accounts.js's own render functions in Node against a sample view
// shaped like GET /api/money/accounts, and checks the page's hard rules.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-accounts.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-accounts.js"), "utf8");

let SANDBOX;
function load() {
  SANDBOX = { window: {} };
  vm.runInNewContext(JS, SANDBOX);
  return SANDBOX.window.FHMoneyAccounts;
}
const M = load();
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const BIZ = "aaaaaaaa-0000-0000-0000-000000000002";
const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const view = () => ({
  ok: true,
  client_id: "11111111-2222-3333-4444-555555555555",
  containers: [
    { id: ME, kind: "personal", name: "Chris (personal)", archived_at: null, business: null,
      accounts: [{ id: "a1", source: "bank_account", name: "Personal Checking", mask: "1101", type: "depository", subtype: "checking",
        container_id: ME, current_cents: 421055, provider: "plaid", closed_at: null }],
      cards: [], loans: [], bills: [] },
    { id: BIZ, kind: "business", name: "Fundhub LLC", archived_at: null,
      business: { legal_name: "Fundhub LLC", dba: null, ein_last4: "0000", entity_type: "llc", formation_state: "AZ",
        started: "2021-03", industry: "Business funding", address_line1: "1 Sample St", city: "Phoenix", state: "AZ",
        postal_code: "85004", phone: "6025550100", website: "https://fundhub.ai" },
      accounts: [],
      cards: [
        { id: "c1", source: "bank_account", name: "Sample Chase Ink", mask: "9999", type: "credit", subtype: "credit card",
          container_id: BIZ, current_cents: 200000, limit_cents: 1000000, provider: "manual", closed_at: null, due_day: null, min_due_cents: null },
        { id: "c0", source: "bank_account", name: "Old Amex", mask: "4404", type: "credit", container_id: BIZ,
          current_cents: 1, limit_cents: 2, provider: "plaid", closed_at: "2026-10-06T00:00:00Z" }
      ],
      loans: [], bills: [] }
  ],
  unassigned: { accounts: [{ id: "u1", source: "bank_account", name: "Mystery Savings", mask: "5505", type: "depository",
    subtype: "savings", container_id: null, current_cents: null, provider: "manual", closed_at: null }], cards: [], loans: [], bills: [] },
  billing: { containers: 2, price_per_container_cents: null, monthly_cents: null }
});

test("the page loads money-accounts.js, carries the shared Money nav, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money-accounts\.js"><\/script>/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  const hrefs = [...HTML.matchAll(/<nav class="mnav"[\s\S]*?<\/nav>/g)][0][0].match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
  assert.deepEqual(hrefs, ["/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
    "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup"]);
  assert.match(HTML, /href="\/app\/financeos\.html#accounts" aria-current="page"/);
  assert.match(JS, /"\/api\/money\/accounts"/);
  assert.match(JS, /\/api\/banking\/link-token/);
  assert.match(JS, /\/api\/banking\/link-exchange/);
  assert.match(JS, /link-initialize\.js/);
  assert.doesNotMatch(HTML, /font-size:\s*\d+px/, "px sizes are thrown away (UI-STANDARDS §12.7)");
});

test("full: businesses with their info, you, Not sorted yet, Move to… on every bank row", () => {
  const html = M.render(view());
  const t = text(html);
  assert.match(t, /Your businesses/);
  assert.match(t, /Fundhub LLC/);
  assert.match(t, /EIN ••0000/);
  assert.match(t, /State formed in AZ/);
  assert.match(t, /Started Mar 2021/);
  assert.match(t, /Phone \(602\) 555-0100/);
  assert.match(t, /You Your personal/);
  assert.match(t, /Not sorted yet 1 account needs a home/);
  assert.match(t, /Sample Chase Ink ••9999/);
  assert.match(t, /\$2,000\.00 owed/);
  assert.match(t, /Limit \$10,000\.00/);
  assert.equal((html.match(/data-act="move"/g) || []).length, 3, "one Move to… per open bank row");
  assert.match(html, /<option value="aaaaaaaa-0000-0000-0000-000000000002" selected>Fundhub LLC \(business\)<\/option>/);
  assert.match(t, /1 closed account not shown/);
  assert.doesNotMatch(t, /Old Amex/);
  assert.match(html, /data-act="connect"/);
  assert.match(html, /data-form="add_account"/);
  assert.match(html, /data-form="create_business"/);
});

test("a null is a dash, never $0.00; unset price shows $X", () => {
  const t = text(M.render(view()));
  assert.match(t, /Mystery Savings ••5505.*— balance/);
  assert.match(t, /Due day —/);
  assert.match(t, /Minimum —/);
  assert.doesNotMatch(t, /\$0\.00/);
  assert.match(t, /\$X per container a month/);
});

test("forms ask for last 4 only — never a full account number, EIN or SSN", () => {
  const html = M.render(view());
  assert.match(html, /EIN — last 4 only/);
  assert.match(html, /name="ein_last4"[^>]*maxlength="4"/);
  assert.match(html, /name="last4"[^>]*maxlength="4"/);
  assert.doesNotMatch(html, /name="(ein|ssn|account_number|routing_number)"/);
});

test("exactly one filled button shows before any form is opened", () => {
  const html = M.render(view());
  const outside = html.replace(/<details[\s\S]*?<\/details>/g, "");
  assert.equal((outside.match(/class="btn-primary"/g) || []).length, 1);
});

test("four states: loading, empty, error, full", () => {
  assert.match(M.renderLoading(), /aria-busy="true"/);
  const empty = text(M.render({ ok: true, containers: [], unassigned: { accounts: [], cards: [], loans: [], bills: [] }, billing: {} }));
  assert.match(empty, /No businesses or accounts yet/);
  assert.match(M.render({ ok: true, containers: [], unassigned: {}, billing: {} }), /<details class="form card" id="add-business" open>/);
  assert.match(text(M.renderError("nodb")), /database is not answering/);
  assert.equal(M.classify({ status: 401, body: null }), "signin");
  assert.equal(M.classify({ status: 200, body: { ok: true } }), "ok");
});

test("the section mounts into any box for the one-page FinanceOS, with the host's api calls", async () => {
  const sec = SANDBOX.window.FinanceOS.sections.accounts;
  assert.equal(typeof sec.mount, "function");
  assert.doesNotMatch(M.render(view()), /<h1|class="mbar"|class="mnav"/, "no page chrome inside the section");
  const listeners = {};
  const el = { innerHTML: "", querySelector: () => null, contains: () => true,
    addEventListener: (k, fn) => { listeners[k] = fn; } };
  const asked = [];
  const ctx = {
    clientId: "11111111-2222-3333-4444-555555555555",
    apiGet: async (p) => { asked.push(p); return { status: 200, body: view() }; },
    apiPost: async () => ({ status: 200, body: view() })
  };
  const handle = sec.mount(el, ctx);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(asked, ["/api/money/accounts?client_id=11111111-2222-3333-4444-555555555555"]);
  assert.match(el.innerHTML, /Your businesses/);
  assert.equal(typeof handle.reload, "function");
  assert.ok(listeners.click && listeners.change && listeners.submit);
});

test("a refused write is said in words, not a status code", () => {
  assert.match(M.writeWords({ status: 404, body: { ok: false, error: "container_not_found" } }), /not found/);
  assert.match(M.writeWords({ status: 400, body: { ok: false, error: "last 4 only — that looks like a full account number" } }), /Not saved/);
});
