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

test("a null is a dash, never $0.00; an unset price is left out, never $X (QA23)", () => {
  const html = M.render(view());
  const t = text(html);
  assert.match(t, /Mystery Savings ••5505.*— balance/);
  assert.match(t, /Due day —/);
  assert.match(t, /Minimum —/);
  assert.doesNotMatch(t, /\$0\.00/);
  assert.doesNotMatch(t, /\$X/);
  assert.doesNotMatch(html, /class="caption billing"/, "no price line without a price");
  const priced = view();
  priced.billing = { containers: 2, price_per_container_cents: 4900, monthly_cents: 9800 };
  assert.match(text(M.render(priced)), /2 containers with accounts · \$49\.00 per container a month · \$98\.00 a month\. Empty containers are free\./);
});

test("one add form, two ways to save: Track the balance (picked) or Just record it", () => {
  const html = M.render(view());
  assert.equal((html.match(/data-form="add_account"/g) || []).length, 1, "one form");
  assert.equal((html.match(/data-form="add_tradeline"/g) || []).length, 0, "no second add form");
  const form = /<form data-form="add_account" novalidate>[\s\S]*?<\/form>/.exec(html)[0];
  assert.match(html, /<summary>Add an account<\/summary>/);
  assert.match(form, /role="radiogroup" aria-labelledby="na-mode-h"/);
  assert.match(form, /<label class="btn"><input type="radio" name="mode" value="track" checked aria-describedby="na-mode-help"> Track the balance<\/label>/);
  assert.match(form, /<label class="btn"><input type="radio" name="mode" value="record" aria-describedby="na-mode-help"> Just record it<\/label>/);
  assert.match(form, /id="na-mode-help">It joins your balances\.<\/p>/);
  for (const [id, label] of [["na-creditor", "Bank or lender"], ["na-product", "Card name"], ["na-record_type", "Type"],
    ["na-record_limit", "Limit"], ["na-opened", "Opened"], ["na-belongs_to", "Belongs to"]]) {
    assert.match(form, new RegExp(`data-mode="record"[^>]* hidden><label for="${id}">${label}</label>`), label);
  }
  assert.match(form, /<div class="f" data-mode="record" data-only-limit="1" hidden><label for="na-record_limit">/);
  assert.match(form, /name="opened" type="month"/);
  /* Until What you have hands over its read, the choices are the server's types and this read's businesses. */
  assert.match(form, /<option value="line_of_credit">Line of credit<\/option>/);
  assert.match(form, /<option value="personal" selected>Personal<\/option><option value="entity:aaaaaaaa-0000-0000-0000-000000000002">Fundhub LLC<\/option>/);
  assert.equal((form.match(/class="btn-primary"/g) || []).length, 1, "one Save");
});

test("Just record it takes What you have's own choices once that card has its read", () => {
  const sandbox = { window: { FHTradelines: { addOptions: {
    types: [{ value: "credit_card", label: "Credit card", limit: true }, { value: "loan", label: "Loan", limit: false }],
    belongs_to: [{ value: "personal", label: "Personal" }, { value: "business:sample rentals llc", label: "Sample Rentals LLC" }] } } } };
  vm.runInNewContext(JS, sandbox);
  const form = /<form data-form="add_account" novalidate>[\s\S]*?<\/form>/.exec(sandbox.window.FHMoneyAccounts.render(view()))[0];
  assert.match(form, /<option value="business:sample rentals llc">Sample Rentals LLC<\/option>/);
  assert.doesNotMatch(form, /line_of_credit/, "the card's own type list");
});

/* A mounted section with a document that records events (patch 4). */
function mountWith(post) {
  const events = [];
  const sandbox = { window: {
    document: { dispatchEvent: (e) => events.push(e), addEventListener() {}, removeEventListener() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  } };
  vm.runInNewContext(JS, sandbox);
  const listeners = {};
  const el = { innerHTML: "", querySelector: () => null, contains: () => true, addEventListener: (k, fn) => { listeners[k] = fn; } };
  const sent = [];
  sandbox.window.FinanceOS.sections.accounts.mount(el, { clientId: "11111111-2222-3333-4444-555555555555",
    apiGet: async () => ({ status: 200, body: view() }), apiPost: async (p, b) => { sent.push(b); return post(b); } });
  /* The submit handler starts the save and returns; the save is done a tick later. */
  const submit = (elements) => {
    listeners.submit({ preventDefault() {},
      target: { getAttribute: (k) => (k === "data-form" ? "add_account" : null), elements, querySelector: () => null } });
    return settle();
  };
  return { el, events, sent, submit };
}
const radio = (value, checked) => ({ name: "mode", type: "radio", value, checked });
const box = (name, value) => ({ name, type: "text", value });
function settle() { return new Promise((r) => setTimeout(r, 0)); }

test("each save fires fh:accounts-changed after the repaint, so What you have reloads", async () => {
  const m = mountWith(async () => ({ status: 201, body: view() }));
  await settle();
  await m.submit([radio("track", true), radio("record", false), box("name", "Chase Ink"), box("type", "credit_card"), box("limit", "10,000"),
    box("creditor", "ignored"), box("record_type", "loan")]);
  assert.deepEqual(m.sent, [{ action: "add_account", name: "Chase Ink", type: "credit_card", limit: "10,000", client_id: "11111111-2222-3333-4444-555555555555" }]);
  assert.deepEqual(m.events.map((e) => [e.type, e.detail.action]), [["fh:accounts-changed", "add_account"]]);
  assert.match(m.el.innerHTML, /Your businesses/);
});

test("Just record it posts add_tradeline and keeps this section's own view", async () => {
  const m = mountWith(async () => ({ status: 201, body: { ok: true, action: "add_tradeline", view: "tradelines", groups: [] } }));
  await settle();
  await m.submit([radio("track", false), radio("record", true), box("name", ""), box("creditor", "Bank of America"), box("product", "Customized Cash"),
    box("record_type", "credit_card"), box("record_limit", "6,000"), box("opened", "2024-02"), box("belongs_to", "entity:" + BIZ)]);
  assert.deepEqual(m.sent, [{ action: "add_tradeline", creditor: "Bank of America", type: "credit_card", belongs_to: "entity:" + BIZ,
    product: "Customized Cash", limit: "6,000", opened: "2024-02", client_id: "11111111-2222-3333-4444-555555555555" }]);
  assert.deepEqual(m.events.map((e) => [e.type, e.detail.action]), [["fh:accounts-changed", "add_tradeline"]]);
  assert.match(m.el.innerHTML, /Your businesses/, "the section is not painted with the What you have answer");
  const empty = mountWith(async () => ({ status: 201, body: view() }));
  await settle();
  await empty.submit([radio("record", true), box("creditor", ""), box("record_type", "credit_card"), box("belongs_to", "personal")]);
  assert.deepEqual(empty.sent, [], "no bank or lender: nothing is sent");
});

test("forms ask for last 4 only — never a full account number, EIN or SSN", () => {
  const html = M.render(view());
  assert.match(html, /EIN — last 4 only/);
  assert.match(html, /name="ein_last4"[^>]*maxlength="4"/);
  assert.match(html, /name="last4"[^>]*maxlength="4"/);
  assert.doesNotMatch(html, /name="(ein|ssn|account_number|routing_number)"/);
});

test("industry guidance is shown on new and saved business profiles", () => {
  const html = M.render(view());
  assert.equal((html.match(/A wrong category can delay approval with Whop or Commas\./g) || []).length, 2);
  assert.match(html, /name="industry"[^>]*aria-describedby="nb-industry-help"/);
  assert.match(html, /name="industry"[^>]*aria-describedby="b-aaaaaaaa-0000-0000-0000-000000000002-industry-help"/);
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

test("loans (wave 3, G2): the add form's due day and minimum show for a loan; a loan row shows due day and payment", () => {
  const html = M.render(view());
  // Due day and minimum carry data-only-due (card or loan); the limit stays card-only.
  assert.match(html, /<div class="f only-card" data-only-due="1"><label for="na-due_day">/);
  assert.match(html, /<div class="f only-card" data-only-due="1"><label for="na-minimum">/);
  assert.match(html, /<div class="f only-card" data-only-card="1"><label for="na-limit">/);
  assert.match(JS, /var hasDue = isCard \|\| type === "loan";/);

  const v = view();
  v.containers[0].loans = [{ id: "l1", source: "bank_account", name: "SBA Loan", type: "loan", subtype: null,
    container_id: BIZ, current_cents: 4800000, limit_cents: null, provider: "manual", closed_at: null,
    due_day: 1, min_due_cents: 105000 }];
  const t = text(M.render(v));
  assert.match(t, /SBA Loan/);
  assert.match(t, /\$48,000\.00 owed/);
  assert.match(t, /Due the 1st · Payment \$1,050\.00/);
});
