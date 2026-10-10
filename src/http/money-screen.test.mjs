// /app/money.html — the client's Finance OS page.
// Runs money.js's own render functions against the contract fixture
// (ops/workflows/finance-os-build-2026-10-06.md) and checks the hard rules
// from docs/finance/client-finance-os-build-spec-2026-09-19.md §4–§4c.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money.js"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-overview.sandbox.json"), "utf8"));

/** Load money.js with no document, so only its pure render functions run. */
function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window.FHMoney;
}
const M = load();
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the page loads money.js, reads the overview endpoint, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money\.js"><\/script>/);
  assert.match(HTML, /id="money-root"/);
  assert.doesNotMatch(HTML, /src="shell\.js"/, "client page: no staff shell or sidebar");
  assert.doesNotMatch(HTML, /crm-sidebar\.css/);
  assert.match(JS, /"\/api\/money\/overview"/);
  assert.match(JS, /link-initialize\.js/);
  assert.match(JS, /\/api\/banking\/link-token/);
  assert.match(JS, /\/api\/banking\/link-exchange/);
});

test("money is cents formatted as dollars; null is a dash, never $0.00; a floor says 'at least'", () => {
  assert.equal(M.money(123456), "$1,234.56");
  assert.equal(M.money(5), "$0.05");
  assert.equal(M.money(0), "$0.00");
  assert.equal(M.money(null), "—");
  assert.equal(M.money(undefined), "—");
  assert.equal(M.money(672040, true), "at least $6,720.40");
  assert.equal(M.money(null, true), "—");
});

test("cash paints personal and business apart and never adds them", () => {
  const html = M.render(fixture());
  const t = text(html);
  assert.match(t, /Personal cash \$4,210\.55/);
  assert.match(t, /Business cash \$18,750\.00/);
  // 421055 + 1875000 = 2296055 → "$22,960.55" must not appear anywhere.
  assert.doesNotMatch(t, /22,960\.55/, "personal + business cash was added into one number");
  assert.doesNotMatch(t, /total cash/i);
  // And no line of money.js adds one cash kind to another.
  assert.doesNotMatch(JS, /cash\.(personal|business|unknown)[^;\n]*\+[^;\n]*cash\./);
});

test("a null anywhere renders as a dash, not $0.00", () => {
  const d = fixture();
  d.debt.cards[0].min_due_cents = null;
  d.debt.cards[0].due_on = null;
  d.debt.by_kind.business = null;
  const t = text(M.render(d));
  assert.doesNotMatch(t, /\$0\.00/, "a missing number was painted as $0.00");
  assert.match(t, /Not sure yet: —/);
  assert.match(t, /Minimum —/);
});

test("debt shows the total, the split by kind, and every card with limit, room, used and due", () => {
  const t = text(M.render(fixture()));
  assert.match(t, /\$6,720\.40/);
  assert.match(t, /Personal \$1,320\.40/);
  assert.match(t, /Business \$5,400\.00/);
  assert.match(t, /Business Amex ••4404/);
  assert.match(t, /\$25,000\.00/);
  assert.match(t, /\$19,600\.00/);
  assert.match(t, /21\.6%/);
  assert.match(t, /Oct 21, 2026/);
  const floor = fixture();
  floor.debt.is_floor = true;
  assert.match(text(M.render(floor)), /at least \$6,720\.40/);
});

test("the sandbox banner shows only when sandbox is true", () => {
  assert.match(M.render(fixture()), /Test data — Plaid sandbox/);
  const live = fixture();
  live.sandbox = false;
  assert.doesNotMatch(M.render(live), /class="sandbox"|Test data — Plaid sandbox/);
});

test("cashflow draws personal and business as two charts, and no bars without bank activity", () => {
  const html = M.render(fixture());
  assert.match(html, /class="card flow" data-kind="personal"/);
  assert.match(html, /class="card flow" data-kind="business"/);
  assert.doesNotMatch(html, /data-kind="unknown"[^>]*class="card flow"|class="card flow" data-kind="unknown"/,
    "the not-sure-yet chart only draws when it has numbers");
  const quiet = fixture();
  quiet.cashflow.has_transactions = false;
  const q = M.render(quiet);
  assert.match(q, /No bank activity yet/);
  assert.doesNotMatch(q, /class="bar-in"|class="bar-out"/, "fake bars were drawn with no transactions");
});

test("empty: no accounts means one action, Connect a bank", () => {
  const d = fixture();
  d.accounts = [];
  const html = M.render(d);
  assert.ok(M.isEmpty(d));
  assert.match(html, /No bank accounts yet/);
  assert.equal((html.match(/data-act="connect"/g) || []).length, 1);
  assert.doesNotMatch(html, /tile-cash/);
});

test("error and loading states say what is happening in words", () => {
  assert.match(M.renderError("offline"), /could not reach the server/);
  assert.match(M.renderError("server"), /role="alert"/);
  assert.match(M.renderError("server"), /data-act="retry"/);
  assert.match(M.renderLoading(), /aria-busy="true"/);
  assert.equal(M.classify({ status: 401, body: null }), "signin");
  assert.equal(M.classify({ status: 503, body: { ok: false } }), "nodb");
  assert.equal(M.classify({ status: 500, body: { ok: false, error: "internal_error" } }), "server");
  assert.equal(M.classify({ status: 200, body: { ok: true } }), "ok");
});

test("tip is printed verbatim, billing line says the count and '$X per container' until a price is set", () => {
  const d = fixture();
  d.tip = "Engine words <b>here</b> & there.";
  const html = M.render(d);
  assert.match(html, /Engine words &lt;b&gt;here&lt;\/b&gt; &amp; there\./);
  assert.match(text(html), /2 containers · \$X per container/);
  assert.doesNotMatch(text(html), /price not set/);
  d.billing.price_per_container_cents = 4900;
  assert.match(text(M.render(d)), /\$49\.00 per container · \$98\.00 a month/);
});

test("containers list their own accounts with masks and card details", () => {
  const html = M.render(fixture());
  assert.equal((html.match(/class="card box"/g) || []).length, 2);
  for (const mask of ["1101", "2202", "3303", "4404"]) assert.match(html, new RegExp("••" + mask));
  assert.match(text(html), /Fundhub LLC Business \$5,400\.00 owed here/);
});

test("the money nav: six links in the board's order, Money marked as the current page", () => {
  const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/);
  assert.ok(nav, "money.html lost the shared money nav");
  const links = [...nav[0].matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [
    ["/app/financeos.html#overview", "Money"],
    ["/app/financeos.html#accounts", "Accounts"],
    ["/app/financeos.html#credit", "Credit"],
    ["/app/financeos.html#connections", "Connections"],
    ["/app/financeos.html#payments", "Payments"],
    ["/app/financeos.html#setup", "Setup"]
  ]);
  assert.match(nav[0], /<a href="\/app\/financeos\.html#overview" aria-current="page">Money<\/a>/);
});

test("a loan payment in upcoming reads 'Loan payment', not 'Bill' (wave 3, G2)", () => {
  const d = fixture();
  d.upcoming = [{ type: "loan_due", name: "SBA Loan", on: "2026-11-01", amount_cents: 105000 }];
  const t = text(M.render(d));
  assert.match(t, /SBA Loan/);
  assert.match(t, /Loan payment/);
  assert.doesNotMatch(t, /SBA Loan[^·]*Bill/);
});

/* Wave 4, H2: debt.loans gets its own table next to "By card". */
const LOANS = [
  { account_id: "bbbbbbbb-0000-4000-8000-000000005505", name: "SBA Loan", mask: "5505",
    container_id: "aaaaaaaa-0000-4000-8000-000000000002", kind: "business",
    balance_cents: 4825000, due_on: "2026-11-01", payment_cents: 105000 },
  { account_id: "bbbbbbbb-0000-4000-8000-000000006606", name: "Student Loan", mask: null,
    container_id: null, kind: "unknown",
    balance_cents: null, due_on: null, payment_cents: null }
];

test("loans show in their own table: name ••mask, container, owed, payment, due (wave 4, H2)", () => {
  const d = fixture();
  d.debt.loans = JSON.parse(JSON.stringify(LOANS));
  const html = M.render(d);
  assert.match(html, /<h3 class="eyebrow">By loan<\/h3>/);
  const loanTable = html.match(/<table class="loans">[\s\S]*?<\/table>/);
  assert.ok(loanTable, "no loan table");
  const t = text(loanTable[0]);
  assert.match(t, /Loan Container Owed Payment Due/);
  assert.match(t, /SBA Loan ••5505 Fundhub LLC \$48,250\.00 \$1,050\.00 Nov 1, 2026/);
  // Unknown balance, payment and due date are dashes, never $0.00; no container → "Not sorted yet".
  assert.match(t, /Student Loan Not sorted yet — — —/);
  assert.doesNotMatch(t, /\$0\.00/, "a missing loan figure was painted as $0.00");
  // The card table is untouched and still sits in the same Debt block.
  assert.match(html, /<h3 class="eyebrow">By card<\/h3>/);
  assert.match(text(html.match(/<table class="cards">[\s\S]*?<\/table>/)[0]), /Business Amex ••4404/);
});

test("no loans: the loan card says so in words; cash still never adds up (wave 4, H2)", () => {
  const d = fixture();
  delete d.debt.loans;
  const html = M.render(d);
  assert.match(html, /<h3 class="eyebrow">By loan<\/h3>/);
  assert.match(text(html), /No loans on file\./);
  assert.doesNotMatch(html, /<table class="loans">/);
  const withLoans = fixture();
  withLoans.debt.loans = JSON.parse(JSON.stringify(LOANS));
  assert.doesNotMatch(text(M.render(withLoans)), /22,960\.55/, "personal + business cash was added into one number");
});

test("money.html carries the CSS the loan card needs (wave 4, H2)", () => {
  assert.match(HTML, /\.debt-side\{display:flex;flex-direction:column;gap:16px;min-width:0\}/);
});
