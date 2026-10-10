// /app/money-banks.html — runs money-banks.js's own render functions against
// the sample fixture: the real GET /api/money/banks read of the FinanceOS test
// client (Fundhub LLC, Phoenix AZ), taken read-only on 2026-10-06. One file,
// unchanged (.claude/rules/sample-clients-consistent.md). Tests that need a
// tracker line or a date add them to a copy and say so.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-banks.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-banks.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-banks.css"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-banks.sample.json"), "utf8"));
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox;
}
const B = load().window.FHMoneyBanks;
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/* A tracker line, as the read returns it, for the tests that need one. */
function withRelationship(d, over = {}) {
  d.relationships = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", bank: "Chase", bank_key: "chase", account_kind: "business",
    lender_id: null, container_id: "386c687a-167d-4d44-a000-8d50b5a80191", container_name: "Fundhub LLC",
    status: "seasoning", status_text: "Open · 10 of 30 days seasoned", planned_open_on: null, planned_deposit_cents: null,
    deposit_plan_cents: 1000000, deposit_plan_source: { label: "Bank book · Chase", ref: "lenders.minimum_deposit · LEGACY-INBRANCHBIZCC-CHASE" },
    opened_on: "2026-09-26", days_open: 10, months_of_history: 0,
    deposits: [{ id: "d1", amount_cents: 1000000, deposited_on: "2026-09-27", note: null }], deposits_total_cents: 1000000,
    seasoning: { days: 30, quote: "30+ days of liquidity seasoning strongly improves odds", source: { label: "Bank book · Chase", ref: "lenders.stated_requirements · LEGACY-INBRANCHBIZCC-CHASE" } },
    seasoned_on: "2026-10-26", notes: null, source: { label: "Set by staff", ref: "blueprint_bank_relationship_todos (461)" },
    ...over
  }];
  return d;
}

test("the page loads its script and styles, reads /api/money/banks, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money-banks\.js"><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="money-banks\.css">/);
  assert.match(HTML, /id="banks-root"/);
  assert.match(HTML, /<div class="app">/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.match(JS, /"\/api\/money\/banks"/);
});

test("the money nav, with Banks marked as the current page in words and fill", () => {
  const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/)[0];
  const hrefs = nav.match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
  assert.deepEqual(hrefs, ["/app/financeos.html#overview", "/app/financeos.html#plan", "/app/financeos.html#accounts",
    "/app/financeos.html#credit", "/app/financeos.html#connections", "/app/financeos.html#payments",
    "/app/financeos.html#banks", "/app/financeos.html#setup"]);
  assert.match(nav, /href="\/app\/financeos\.html#banks" aria-current="page">Banks</);
});

test("full: the four parts, from the real read, each rule with its source", () => {
  const html = B.render(fixture());
  const t = text(html);
  assert.match(t, /Banks Test Test · Banks to open near Phoenix, AZ/);
  // Banks near you — the bank book's steps
  assert.match(t, /Banks near you/);
  assert.match(t, /Chase .*Deposit \$10,000 .*Season it 30\+ days/);
  assert.match(t, /Open a business checking account at Chase\. Source: Bank book · Chase/);
  assert.match(t, /Leave it there 30\+ days before you apply\. Source: Bank book · Chase/);
  assert.match(t, /Deposit amount: not set\. Staff set it with the plan\./, "Wells Fargo lists no minimum");
  assert.match(t, /Not listed here: American Express, Elan Financial/);
  // Card stacking
  assert.match(t, /Card stacking order/);
  assert.match(t, /Personal cards first, then business cards\..* Source: Fundhub funding order/);
  assert.match(t, /Apply for one card → wait for decision → then submit second card to increase odds Source: Bank book · Chase/);
  assert.match(t, /One hard pull on Experian per card\./);
  assert.match(t, /No credit pull on file yet, so UnderwriteIQ cannot say if you can card stack\./);
  assert.match(t, /One at a time: wait for the decision before you send the next one\. Never shotgun applications\. Source: Fundhub application order/);
  assert.match(t, /Days between two banks: not set\./);
  assert.match(t, /Inquiries cost fundability\. Any more than zero should come off\. Source: Owner rule, 2026-09-29/);
  assert.match(t, /Open it in the LLC name, using the EIN\..* Source: Fundhub checklist · Open a business checking account/);
  // Next funding sequence (owner 2026-10-06: never "round two"; a sequence has ~6 rounds)
  assert.match(t, /Next funding sequence .*Date Not set/);
  assert.doesNotMatch(t, /next funding round|round two/i);
  assert.match(t, /Estimated amount Not worked out yet/);
  assert.match(t, /No credit pull on file yet\. UnderwriteIQ needs one to say your file is ready\. Source: UnderwriteIQ/);
  assert.match(t, /Fundhub LLC has no NAICS code \(industry code\) on file\. Source: Fundhub funding order/);
  // Tracker — empty in the real read
  assert.match(t, /Your bank relationships .*No banks on your plan yet/);
  assert.match(t, /Your advisor adds banks to your plan\./);
  // Not set
  assert.match(t, /Not set yet .*Next funding sequence date .*Days between card applications at two banks/);
});

test("every rule line printed with a source carries the exact book row on hover", () => {
  const html = B.render(fixture());
  const srcs = html.match(/<span class="src caption" title="[^"]*">Source: [^<]+<\/span>/g) || [];
  assert.ok(srcs.length > 20, `only ${srcs.length} sources printed`);
  assert.ok(srcs.every((s) => !/title=""/.test(s)), "a source without its reference");
  assert.match(html, /title="lenders\.minimum_deposit · LEGACY-INBRANCHBIZCC-CHASE">Source: Bank book · Chase/);
});

test("nothing unknown paints as money: no $0.00, no NaN, no undefined", () => {
  const t = text(B.render(fixture()));
  assert.doesNotMatch(t, /\$0(\.00)?\b|NaN|undefined|null/);
});

test("a client never sees a plan control; staff do", () => {
  const client = B.render(withRelationship(fixture()));
  assert.doesNotMatch(client, /data-form=|data-act="skip"|Staff only/);
  const staff = B.render(withRelationship(fixture()), { staff: true });
  // Bank of America is not on the plan yet: staff get its plan form, with the book's id.
  assert.match(staff, /data-form="plan" data-lender="d9bd0743-5439-4041-bd11-18925ac8ecf3" data-bank="Bank of America"/);
  // The deposit box starts empty: blank keeps the bank book's minimum (and its source);
  // only a typed amount becomes staff's own number.
  const bofaForm = staff.match(/<form data-form="plan" data-lender="d9bd0743[\s\S]*?<\/form>/)[0];
  assert.match(bofaForm, /Deposit \(\$\) · blank = book&#39;s \$5,000/);
  assert.match(bofaForm, /<input name="deposit" inputmode="decimal" placeholder="5000\.00">/);
  // Chase is open: staff get the deposit form on its tracker line.
  assert.match(staff, /data-form="deposit"/);
  assert.match(staff, /Add a bank to the plan/);
  // The real read's client has not bought the Capital Blueprint: no date form, said in words.
  assert.doesNotMatch(staff, /data-form="round"/);
  assert.match(text(staff), /The next funding sequence date is part of the Capital Blueprint\. This client has not bought it/);
  const d = fixture();
  d.next_round.can_set_date = true;
  assert.match(B.render(d, { staff: true }), /data-form="round"/);
});

test("a bank already on the plan says so instead of offering it again", () => {
  const t = text(B.render(withRelationship(fixture()), { staff: true }));
  assert.match(t, /Chase .*On your plan Open · 10 of 30 days seasoned/);
});

test("the tracker: status in words, history, deposits, seasoning with its source", () => {
  const t = text(B.render(withRelationship(fixture())));
  assert.match(t, /Chase Business · Fundhub LLC Open · 10 of 30 days seasoned Sep 26, 2026 0 months \$10,000 1 deposit 30\+ days Source: Bank book · Chase/);
  const planned = text(B.render(withRelationship(fixture(), {
    status: "planned", status_text: "Planned · date not set", opened_on: null, days_open: null, months_of_history: null,
    deposits: [], deposits_total_cents: null, seasoned_on: null
  })));
  assert.match(planned, /Planned · date not set Day not set — \$10,000 Source: Bank book · Chase/);
});

test("location unknown: banks near you says what is missing and links to the fix", () => {
  const d = fixture();
  d.location = { states: [], home_state: null, business_state: null, businesses: [], text: null, source: null };
  d.recommended_banks = [];
  const html = B.render(d);
  assert.match(text(html), /We do not know your state yet/);
  assert.match(html, /href="\/app\/financeos\.html#accounts"/);
});

test("at most one primary button, and none on a page with nothing to retry", () => {
  assert.equal((B.render(fixture(), { staff: true }).match(/class="btn-primary"/g) || []).length, 0);
  assert.equal((B.renderError("server").match(/class="btn-primary"/g) || []).length, 1);
});

test("loading is a skeleton in the real layout; errors say what failed in words", () => {
  assert.match(B.renderLoading(), /aria-busy="true"/);
  assert.match(text(B.renderError("offline")), /could not reach the server/);
  assert.match(text(B.renderError("nodb")), /database is not answering/);
  assert.match(B.renderError("nodb"), /data-act="retry"/);
  assert.equal(B.classify({ status: 401, body: null }), "signin");
  assert.equal(B.classify({ status: 503, body: { ok: false } }), "nodb");
  assert.equal(B.classify({ status: 200, body: { ok: true } }), "ok");
});

test("money is cents; typed dollars become cents without float maths", () => {
  assert.equal(B.money(1000000), "$10,000");
  assert.equal(B.money(150050), "$1,500.50");
  assert.equal(B.money(null), "—");
  assert.equal(B.toCents("5,000.05"), 500005);
  assert.equal(B.toCents("19.9"), 1990);
  assert.equal(B.toCents("abc"), null);
  assert.equal(B.day("2026-10-20"), "Oct 20, 2026");
});

test("FinanceOS section: mount(el, ctx) paints into el through ctx.apiGet, with no page chrome", async () => {
  const sandbox = load();
  const section = sandbox.window.FinanceOS.sections.banks;
  assert.equal(section.title, "Banks");
  assert.equal(typeof section.mount, "function");
  const el = { innerHTML: "", listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener(t) { delete this.listeners[t]; }, contains: () => true };
  const asked = [];
  const handle = section.mount(el, { clientId: CLIENT, apiGet: async (p) => { asked.push(p); return fixture(); }, apiPost: async () => ({ ok: true }) });
  await handle.reload();
  assert.equal(asked[0], `/api/money/banks?client_id=${CLIENT}`);
  assert.match(el.innerHTML, /^<div class="fh-banks">/);
  assert.match(text(el.innerHTML), /Banks near you/);
  assert.match(el.innerHTML, /Add a bank to the plan/, "a clientId (staff desk) shows plan controls");
  assert.doesNotMatch(el.innerHTML, /class="mbar"|class="mnav"/);
  assert.equal(typeof el.listeners.click, "function");
  assert.equal(typeof el.listeners.submit, "function");
  handle.unmount();
  assert.equal(el.innerHTML, "");
});

test("a client session's mount asks without a client_id and shows no controls", async () => {
  const sandbox = load();
  const el = { innerHTML: "", addEventListener() {}, removeEventListener() {}, contains: () => true };
  const asked = [];
  const handle = sandbox.window.FinanceOS.sections.banks.mount(el, { apiGet: async (p) => { asked.push(p); return { status: 200, body: fixture() }; } });
  await handle.reload();
  assert.equal(asked[0], "/api/money/banks");
  assert.doesNotMatch(el.innerHTML, /data-form=/);
});

test("the section's styles all live under .fh-banks, with no px font sizes", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const selectors = css.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-banks(\s|$)/, part);
  assert.doesNotMatch(CSS, /font-size\s*:\s*\d/);
  assert.doesNotMatch(CSS, /font\s*:\s*\d/);
});
