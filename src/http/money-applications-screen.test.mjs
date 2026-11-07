// The tracker card (public/app/money-applications.js) — runs its own render
// functions in Node against rows built by the REAL tracker shape
// (src/finance/applications-tracker.mjs trackerRow/summarize), so a fixture can
// never drift from what the server sends. One sample person: a Chase business
// card Fundhub tracked and approved, a Bank of America card waiting on papers,
// and a credit union loan the client added. Checks: the bank book's logo or the
// name alone, status as a mark and a word, the approved amount, the facts line,
// the account note, the right buttons on the right rows, four states, escaping,
// scoped styles with no px font size and no hand-rolled shadow, 44px controls,
// a phone layout, and that Finance OS → Applications paints this card.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { trackerRow, summarize, fromFundhubRow, fromSelfRow } from "../finance/applications-tracker.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const JS = fs.readFileSync(path.join(APP, "money-applications.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-applications.css"), "utf8");
const DECLINES_JS = fs.readFileSync(path.join(APP, "money-declines.js"), "utf8");
const FINANCEOS = fs.readFileSync(path.join(APP, "financeos.html"), "utf8");
const DECLINES_HTML = fs.readFileSync(path.join(APP, "money-declines.html"), "utf8");

function load(...sources) {
  const sandbox = { window: {} };
  for (const src of sources) vm.runInNewContext(src, sandbox);
  return sandbox.window;
}
const W = load(JS);
const A = W.FHApplications;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const chase = fromFundhubRow({
  id: "c0000000-0000-4000-8000-000000000011", org_id: ORG, client_id: CLIENT, bank: "Chase", lender_name: "Chase", lender_id: "d1",
  product_name: "Ink Business Cash", lender_table: "OnlineBizCC", status: "Approved", approved_amount: "10000.00", requested_amount: "15000.00",
  submitted_date: new Date(2026, 9, 1), status_updated_date: new Date(2026, 9, 8, 10), approval_excluded_at: null, created_at: new Date(2026, 8, 30)
});
const boa = fromFundhubRow({
  id: "c0000000-0000-4000-8000-000000000013", org_id: ORG, client_id: CLIENT, bank: "Bank of America", lender_name: "Bank of America", lender_id: null,
  product_name: "Business Advantage", lender_table: "OnlineBizCC", status: "Missing Docs", approved_amount: null, requested_amount: null,
  submitted_date: new Date(2026, 9, 20), status_updated_date: null, approval_excluded_at: null, created_at: new Date(2026, 9, 20)
});
const loan = fromSelfRow({ id: "e0000000-0000-4000-8000-000000000001", bank: "Desert Credit Union", product: null, kind: "loan", owner_kind: "personal",
  applied_on: new Date(2026, 10, 2), requested_cents: "2000000", status: "approved", approved_cents: "2000000", decided_on: new Date(2026, 10, 5), last4: null });
const pendingSelf = fromSelfRow({ id: "e0000000-0000-4000-8000-000000000002", bank: "Chase", product: "Freedom", kind: "card", owner_kind: null,
  applied_on: new Date(2026, 10, 3), requested_cents: null, status: "applied", approved_cents: null, decided_on: null, last4: null });

/* The logos the shared lookup (findLogos) answers for these banks. */
function sample() {
  const rows = [
    trackerRow(loan),
    trackerRow(pendingSelf),
    trackerRow(boa, { logo: "/assets/lenders/bank-of-america.png" }),
    trackerRow(chase, { account: { id: "acct-1", name: "Chase Ink Business Cash", mask: null, provider: "manual" }, logo: "/assets/lenders/chase.png" })
  ];
  return { ok: true, rows, counts: summarize(rows), can_add: true };
}
const rowHtml = (html, id) => {
  const start = html.indexOf(`data-fa-id="${id}"`);
  const end = html.indexOf("</li>", start);
  return html.slice(start, end);
};

test("each application shows the bank's own logo from the bank book, or its name alone — never a drawn one", () => {
  const html = A.renderCard(sample());
  assert.match(rowHtml(html, chase.id), /<span class="fa-logo"><img src="\/assets\/lenders\/chase\.png" alt=""/);
  assert.match(rowHtml(html, boa.id), /<img src="\/assets\/lenders\/bank-of-america\.png"/);
  assert.doesNotMatch(rowHtml(html, loan.id), /<img|fa-logo/, "no book row: the name only");
  assert.match(text(rowHtml(html, loan.id)), /Desert Credit Union/);
  for (const bad of ["javascript:alert(1)", "https://evil.example/logo.png", "/assets/../secrets.png", "/app/x.js"]) {
    assert.equal(A.safeLogo(bad), "", bad);
  }
  assert.equal(A.safeLogo("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=", "Plaid's own image is allowed");
});

test("status is a mark and a word, and the approved amount sits beside it", () => {
  const html = A.renderCard(sample());
  assert.match(rowHtml(html, chase.id), /<span class="fa-chip is-approved"><span class="fa-mark" aria-hidden="true">✓<\/span>Approved<\/span>/);
  assert.match(text(rowHtml(html, chase.id)), /Approved \$10,000 approved limit/);
  assert.match(rowHtml(html, boa.id), /fa-chip is-pending"><span class="fa-mark" aria-hidden="true">…<\/span>Pending/);
  assert.match(rowHtml(html, pendingSelf.id), /fa-chip is-applied"><span class="fa-mark" aria-hidden="true">•<\/span>Applied/);
  assert.match(text(rowHtml(html, loan.id)), /\$20,000 approved/);
  assert.doesNotMatch(text(rowHtml(html, loan.id)), /approved limit/, "a loan has an amount, not a limit");
  const noAmount = A.renderCard({ ok: true, can_add: true, counts: { total: 1, approved: 1 }, rows: [trackerRow({ ...chase, approved_cents: null })] });
  assert.match(text(noAmount), /Amount not told yet/, "unknown stays unknown, never $0");
  assert.doesNotMatch(text(noAmount), /\$0\b/);
});

test("the facts line: the day applied, what was asked, the answer day, and who added it", () => {
  const html = A.renderCard(sample());
  assert.match(text(rowHtml(html, chase.id)), /Applied Oct 1, 2026 · Asked \$15,000 · Approved Oct 8, 2026 · Fundhub is tracking this one/);
  assert.match(text(rowHtml(html, loan.id)), /Applied Nov 2, 2026 · Asked \$20,000 · Approved Nov 5, 2026 · You added this/);
  assert.match(text(rowHtml(html, boa.id)), /Applied Oct 20, 2026 · Fundhub is tracking this one/);
  assert.match(text(rowHtml(html, chase.id)), /Ink Business Cash · Credit card · Business/);
});

test("the account note and the buttons: on the accounts, a loan to add by hand, and only the client's own rows change", () => {
  const html = A.renderCard(sample());
  assert.match(text(rowHtml(html, chase.id)), /On your accounts\. The balance shows once your bank connection sees it\./);
  assert.match(text(rowHtml(html, loan.id)), /Add the loan on your Accounts page once the money lands/);
  assert.doesNotMatch(rowHtml(html, chase.id), /Change status|Add to my accounts/, "a Fundhub round row is read only, and it is already on the accounts");
  assert.match(rowHtml(html, loan.id), /data-fa-act="edit"[^>]*>Change status/);
  assert.match(rowHtml(html, pendingSelf.id), /<form class="fa-form" id="fa-e-e0000000-0000-4000-8000-000000000002" data-fa-form="edit"/);
  const waiting = A.renderCard({ ok: true, can_add: true, counts: { total: 1, approved: 1 }, rows: [trackerRow(chase)] });
  assert.match(waiting, /data-fa-act="add-account">Add to my accounts/);
  assert.match(text(waiting), /Not on your accounts yet/);
});

test("the head counts applications and never adds approved limits together", () => {
  const html = A.renderCard(sample());
  assert.match(text(html), /Your bank applications 2 of 4 approved\. 1 pending\. 1 waiting on the bank\./);
  assert.doesNotMatch(text(html.slice(0, html.indexOf("<ul"))), /\$/, "no dollar total anywhere in the head");
  assert.equal((html.match(/fa-btn-dark/g) || []).length, 1 + 2, "one dark save per form, and the forms start hidden");
  assert.match(html, /<form class="fa-form" id="fa-add" data-fa-form="add" hidden/);
  assert.match(html, /data-fa-act="open-add" aria-expanded="false" aria-controls="fa-add">Add an application/);
});

test("the add form asks only for what the tracker stores, with labels, and shows the approval fields only on an approval", () => {
  const html = A.renderCard(sample());
  const form = html.slice(html.indexOf('id="fa-add"'), html.indexOf("</form>", html.indexOf('id="fa-add"')));
  for (const f of ["bank", "product", "kind", "owner_kind", "applied_on", "requested_amount", "status", "approved_amount", "last4", "decided_on"]) {
    assert.match(form, new RegExp(`data-fa-field="${f}"`), f);
  }
  for (const id of form.match(/ id="(fa-add-[a-z0-9]+)"/g).map((m) => m.slice(5, -1))) {
    assert.match(form, new RegExp(`<label for="${id}">`), `label for ${id}`);
  }
  assert.match(form, /<div class="fa-when" data-fa-when="approved" hidden>/);
  assert.match(form, /maxlength="4" pattern="\[0-9\]\{2,4\}"/);
  assert.match(text(form), /Only the last 4\. We never store a full card number\./);
  assert.doesNotMatch(form, /ssn|social|routing|account number/i);
});

test("four states: loading in the real layout, empty with one way forward, error in words, and a long list that pages at 25", () => {
  const loading = A.renderLoading();
  assert.match(loading, /aria-busy="true"/);
  assert.match(text(loading), /Loading your applications/);
  const empty = A.renderCard({ ok: true, rows: [], counts: { total: 0 }, can_add: true });
  // One short line, no explanation (short client words, QA15).
  assert.match(empty, /<p class="fa-empty">No bank applications yet\.<\/p>/);
  assert.match(empty, /data-fa-act="open-add"/);
  const error = A.renderCard({ ok: false, error: "tracker_unavailable" });
  assert.match(error, /role="alert"/);
  assert.match(text(error), /We could not load your applications/);
  assert.match(error, /data-fa-act="retry">Try again/);
  assert.doesNotMatch(text(error), /\b(500|503|tracker_unavailable)\b/, "never a raw code");
  const many = { ok: true, can_add: true, rows: Array.from({ length: 30 }, (_, i) => trackerRow({ ...pendingSelf, id: `e0000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}` })) };
  many.counts = summarize(many.rows);
  const page = A.renderCard(many);
  assert.equal((page.match(/<li class="fa-row"/g) || []).length, 25);
  assert.match(page, /data-fa-act="more">Show all 30 applications/);
  assert.equal((A.renderFull(many, { all: true }).match(/<li class="fa-row"/g) || []).length, 30);
});

test("bank names and products are escaped, never run", () => {
  const evil = trackerRow({ ...pendingSelf, bank: "<img src=x onerror=alert(1)>", product: "\"><script>1</script>" });
  const html = A.renderCard({ ok: true, can_add: true, rows: [evil], counts: summarize([evil]) });
  assert.doesNotMatch(html, /<img src=x|<script>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("money and dates read like a person writes them", () => {
  assert.equal(A.money(1000000), "$10,000");
  assert.equal(A.money(250050), "$2,500.50");
  assert.equal(A.money(5), "$0.05");
  assert.equal(A.money(null), "");
  assert.equal(A.money(10.5), "", "a value that is not whole cents is not shown");
  assert.equal(A.day("2026-10-01"), "Oct 1, 2026");
  assert.equal(A.day(null), "");
});

test("a save answer is said in words", () => {
  assert.equal(A.problem({ status: 400, body: { ok: false, error: "invalid_applied_on", message: "The day you applied cannot be in the future." } }), "The day you applied cannot be in the future.");
  assert.match(A.problem({ status: 0, body: null }), /could not reach the server/);
  assert.match(A.savedFlash({ body: { ok: true, account: { status: "added" } } }), /^Saved\. It is on your accounts now/);
  assert.match(A.savedFlash({ body: { ok: true, account: { status: "ambiguous" } } }), /last 4 digits/);
  assert.equal(A.savedFlash({ body: { ok: true, account: { status: "not_needed" } } }), "Saved.");
});

test("Finance OS → Applications paints this card from the same read, and falls back to the old list without it", () => {
  const both = load(JS, DECLINES_JS);
  const view = { eligible: false, can_paste: false, applications: [], declines: [], tracker: sample() };
  const html = both.FHMoneyDeclines.render(view);
  assert.match(html, /<div class="dc-block dc-apps-card" data-slot="apps"><section class="fh-apps card"/);
  assert.match(text(html), /2 of 4 approved/);
  assert.equal(both.FHMoneyDeclines.isEmpty({ applications: [], declines: [], tracker: { rows: [{}] } }), false, "a tracked application is not an empty page");
  const alone = load(DECLINES_JS);
  assert.doesNotMatch(alone.FHMoneyDeclines.render(view), /fh-apps/);
  assert.match(text(alone.FHMoneyDeclines.render({ eligible: true, can_paste: true, applications: [], declines: [] })), /No bank applications on your file yet/);
  assert.equal(typeof A.mount, "function", "the Blueprint funding area mounts it on its own");
  assert.equal(W.FinanceOS.applicationsCard, A);
});

test("the client's Applications view: the title, then one short line at most before the list (QA15)", () => {
  const both = load(JS, DECLINES_JS);
  const locked = both.FHMoneyDeclines.render({ eligible: false, can_paste: false, applications: [], declines: [], tracker: sample() });
  const before = text(locked.slice(0, locked.indexOf('<div class="dc-block dc-apps-card"')));
  assert.equal(before, "Your applications Decline help comes with the Capital Blueprint.");
  const open = both.FHMoneyDeclines.render({ eligible: true, can_paste: true, applications: [], declines: [], tracker: sample() });
  assert.match(open, /<div class="dc-head"><div><h1>Your applications<\/h1><\/div><\/div>/, "no explanation under the title");
  assert.doesNotMatch(text(open), /We read it, show the likely reasons|works on getting a second look/);
});

test("mounted on its own: a read with no tracker paints nothing, not an error card", async () => {
  const el = { innerHTML: "", addEventListener() {}, removeEventListener() {}, querySelector() { return null; } };
  const answers = [
    { ok: true, view: { eligible: true, can_paste: true, applications: [], declines: [] } },
    { ok: true, view: { eligible: true, can_paste: true, applications: [], declines: [], tracker: { ok: false, error: "tracker_unavailable" } } }
  ];
  let i = 0;
  const m = A.mount(el, { apiGet: async () => answers[i++] });
  assert.match(el.innerHTML, /aria-busy="true"/, "loading first");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.innerHTML, "", "no tracker in the read: no card at all");
  await m.reload();
  assert.match(el.innerHTML, /role="alert"/, "a tracker the server says failed still shows the error card");
  assert.match(text(el.innerHTML), /We could not load your applications/);
});

test("both pages load the card's script before the section that uses it, and its stylesheet", () => {
  for (const html of [FINANCEOS, DECLINES_HTML]) {
    const card = html.indexOf('<script defer src="money-applications.js"></script>');
    const section = html.indexOf('<script defer src="money-declines.js"></script>');
    assert.ok(card > 0 && section > card, "card script first");
    assert.match(html, /<link rel="stylesheet" href="money-applications\.css">/);
  }
  assert.doesNotMatch(JS, /require\(|import /, "plain browser script, no dependency");
});

test("styles: all under .fh-apps, no px font size, no hand-rolled shadow, 44px controls, 16px inputs, one column on a phone", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "");
  const selectors = css.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  assert.ok(selectors.length > 40);
  for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-apps(\.|\s|$)/, part);
  assert.doesNotMatch(css, /font-size\s*:\s*\d+px/);
  assert.doesNotMatch(css, /box-shadow/, "the resting shadow comes from fundhub-brand.css (UI-STANDARDS §12.2)");
  assert.match(css, /\.fh-apps \.fa-btn\{[^}]*min-height:44px;min-width:44px/);
  assert.match(css, /\.fh-apps \.fa-input\{[^}]*min-height:44px[^}]*font-size:1rem/);
  assert.match(css, /\.fh-apps \.fa-btn-dark\{[^}]*border-radius|\.fh-apps \.fa-btn\{[^}]*border-radius:8px/);
  assert.match(css, /\.fh-apps\{[^}]*border-radius:10px/);
  assert.match(css, /\.fh-apps \[hidden\]\{display:none !important\}/, "[hidden] is respected");
  const phone = CSS.match(/@media \(max-width:760px\)\{([\s\S]*?)\n\}/)[1];
  assert.match(phone, /\.fh-apps \.fa-top\{grid-template-columns:minmax\(0,1fr\)\}/);
  for (const m of css.matchAll(/(?:^|[;{])\s*(?:min-)?width\s*:\s*(\d+)px/g)) assert.ok(Number(m[1]) <= 44, m[0]);
  assert.match(css, /overflow-wrap:anywhere/);
});
