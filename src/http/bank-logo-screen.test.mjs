// Bank logos on the screens (owner rule 2026-11-07). public/app/bank-logo.js is
// the one helper; the Accounts and Banks sections put it beside every bank.
// Runs the page scripts in Node, the same way the other money screen tests do.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const read = (f) => fs.readFileSync(path.join(APP, f), "utf8");
const HELPER = read("bank-logo.js");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PLAID_LOGO = `data:image/png;base64,${PNG}`;

function sandbox({ helper = true, scripts = [] } = {}) {
  const box = { window: {} };
  if (helper) vm.runInNewContext(HELPER, box);
  for (const s of scripts) vm.runInNewContext(read(s), box);
  return box.window;
}
const imgs = (html) => html.match(/<img\b[^>]*>/g) || [];

describe("the helper", () => {
  const L = sandbox().FHBankLogo;

  test("a Plaid logo renders one lazy, fixed-size image whose alt text names the bank", () => {
    const html = L.html(PLAID_LOGO, "Chase");
    assert.equal(imgs(html).length, 1);
    assert.match(html, /class="fh-bank-logo"/);
    assert.match(html, /alt="Chase logo"/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /width="28" height="28"/);
    assert.ok(html.includes(`src="${PLAID_LOGO}"`));
  });

  test("a bank-book file renders too; the sandbox tail is not in the alt text", () => {
    const html = L.html("/assets/lenders/chase.png", "Chase (Plaid sandbox — test data)");
    assert.match(html, /src="\/assets\/lenders\/chase\.png"/);
    assert.match(html, /alt="Chase logo"/);
  });

  test("null, the placeholder tile and anything unsafe render nothing", () => {
    for (const bad of [null, undefined, "", "/assets/lenders/placeholder.svg", "javascript:alert(1)",
      "https://evil.example/x.png", "/assets/lenders/../x.png", "data:image/svg+xml;base64,PHN2Zz4=",
      'data:image/png;base64,iVBORw0KGgo" onerror="x']) {
      assert.equal(L.html(bad, "Chase"), "", String(bad));
    }
  });

  test("a bank with no name still gets alt text, and names are escaped", () => {
    assert.match(L.html(PLAID_LOGO, ""), /alt="Bank logo"/);
    assert.match(L.html(PLAID_LOGO, 'A "B" <C>'), /alt="A &quot;B&quot; &lt;C&gt; logo"/);
  });
});

describe("Accounts", () => {
  const view = (logo) => ({
    ok: true,
    client_id: "11111111-2222-3333-4444-555555555555",
    containers: [{
      id: "c1", kind: "personal", name: "Chris (personal)", archived_at: null, business: null,
      accounts: [{ id: "a1", source: "bank_account", name: "Total Checking", mask: "1101", type: "depository", subtype: "checking",
        container_id: "c1", current_cents: 421055, provider: "plaid", closed_at: null, institution: "Chase", logo, logo_source: logo ? "plaid" : null }],
      cards: [], loans: [], bills: []
    }],
    unassigned: { accounts: [], cards: [], loans: [], bills: [] },
    billing: { containers: 1, price_per_container_cents: null, monthly_cents: null }
  });

  test("each account shows its bank's logo, named for the bank", () => {
    const M = sandbox({ scripts: ["money-accounts.js"] }).FHMoneyAccounts;
    const html = M.render(view(PLAID_LOGO));
    const list = imgs(html);
    assert.equal(list.length, 1);
    assert.match(list[0], /alt="Chase logo"/);
    assert.ok(html.indexOf("fh-bank-logo") < html.indexOf("Total Checking"), "the logo sits before the account name");
  });

  test("no logo → the name alone, no empty box", () => {
    const M = sandbox({ scripts: ["money-accounts.js"] }).FHMoneyAccounts;
    const html = M.render(view(null));
    assert.equal(imgs(html).length, 0);
    assert.match(html, /Total Checking/);
  });

  test("the page still renders when the helper is not loaded", () => {
    const M = sandbox({ helper: false, scripts: ["money-accounts.js"] }).FHMoneyAccounts;
    const html = M.render(view(PLAID_LOGO));
    assert.equal(imgs(html).length, 0);
    assert.match(html, /Total Checking/);
  });
});

describe("Banks", () => {
  const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-banks.sample.json"), "utf8"));
  const withLogos = () => {
    const d = structuredClone(FIXTURE);
    for (const b of d.recommended_banks || []) Object.assign(b, { logo: "/assets/lenders/chase.png", logo_source: "bank_book" });
    for (const s of (d.card_stacking && d.card_stacking.items) || []) Object.assign(s, { logo: PLAID_LOGO, logo_source: "plaid" });
    for (const r of d.relationships || []) Object.assign(r, { logo: null, logo_source: null });
    return d;
  };

  test("every recommended bank and every card-stacking line shows its logo; a null one shows the name only", () => {
    const d = withLogos();
    const B = sandbox({ scripts: ["money-banks.js"] }).FHMoneyBanks;
    const html = B.render(d, { staff: false });
    const n = (d.recommended_banks || []).length + ((d.card_stacking && d.card_stacking.items) || []).length;
    assert.ok(n > 0, "the fixture has banks to show");
    assert.equal(imgs(html).length, n);
    for (const b of d.recommended_banks) assert.ok(html.includes(`alt="${b.name} logo"`), b.name);
    for (const r of d.relationships || []) assert.ok(html.includes(r.bank), r.bank);
  });

  test("a relationship with a logo shows it in its row", () => {
    const d = withLogos();
    d.relationships = [{ ...(d.relationships && d.relationships[0]), id: "rel-x", bank: "Wells Fargo", status: "planned",
      status_text: "Planned", logo: "/assets/lenders/wells-fargo.png", logo_source: "bank_book", deposits: [] }];
    const B = sandbox({ scripts: ["money-banks.js"] }).FHMoneyBanks;
    const html = B.render(d, { staff: false });
    const row = html.slice(html.indexOf('data-rel="rel-x"'));
    assert.match(row, /<img[^>]*alt="Wells Fargo logo"/);
  });

  test("the bank book's placeholder is never shown as a logo", () => {
    const d = withLogos();
    for (const b of d.recommended_banks) b.logo = "/assets/lenders/placeholder.svg";
    for (const s of d.card_stacking.items) s.logo = null;
    const B = sandbox({ scripts: ["money-banks.js"] }).FHMoneyBanks;
    assert.equal(imgs(B.render(d, { staff: false })).length, 0);
  });
});

describe("Overview", () => {
  const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-overview.sandbox.json"), "utf8"));
  const withLogos = (logo) => {
    const d = structuredClone(FIXTURE);
    for (const a of d.accounts) Object.assign(a, { logo, logo_source: logo ? "plaid" : null });
    return d;
  };

  test("each account, and each card row under Debt, shows its bank's logo named for the bank", () => {
    const d = withLogos(PLAID_LOGO);
    const M = sandbox({ scripts: ["money.js"] }).FHMoney;
    const html = M.render(d);
    const cards = (d.debt && d.debt.cards) || [];
    assert.ok(d.accounts.length > 0 && cards.length > 0, "the fixture has accounts and cards");
    assert.equal(imgs(html).length, d.accounts.length + cards.length);
    for (const img of imgs(html)) assert.match(img, /alt="First Platypus Bank logo"/, "the sandbox tail is not in the alt text");
    assert.ok(html.indexOf("fh-bank-logo") < html.indexOf("Personal Checking"), "the logo sits before the account name");
  });

  test("no logo, or no helper on the page → the names alone", () => {
    const M = sandbox({ scripts: ["money.js"] }).FHMoney;
    assert.equal(imgs(M.render(withLogos(null))).length, 0);
    const bare = sandbox({ helper: false, scripts: ["money.js"] }).FHMoney.render(withLogos(PLAID_LOGO));
    assert.equal(imgs(bare).length, 0);
    assert.match(bare, /Personal Checking/);
  });
});

describe("Credit", () => {
  const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-credit.sample.json"), "utf8"));

  test("a lender row with a logo shows it; the others show the lender's name alone", () => {
    const d = structuredClone(FIXTURE);
    d.accounts.list.forEach((a, i) => Object.assign(a, i === 1
      ? { logo: "/assets/lenders/american-express.png", logo_source: "bank_book" }
      : { logo: null, logo_source: null }));
    const C = sandbox({ scripts: ["money-credit.js"] }).FHMoneyCredit;
    const html = C.render(d);
    const list = imgs(html);
    assert.equal(list.length, 1);
    assert.match(list[0], /alt="AMEX logo"/);
    assert.match(html, /CHASE CARD SERVICES/);
  });

  test("the credit screen still renders when the helper is not loaded", () => {
    const d = structuredClone(FIXTURE);
    for (const a of d.accounts.list) a.logo = "/assets/lenders/chase.png";
    const html = sandbox({ helper: false, scripts: ["money-credit.js"] }).FHMoneyCredit.render(d);
    assert.equal(imgs(html).length, 0);
    assert.match(html, /CHASE CARD SERVICES/);
  });
});

describe("the pages load the helper before the screens, and its sheet before the Astra sheets", () => {
  for (const [page, screen] of [["money-accounts.html", "money-accounts.js"], ["money-banks.html", "money-banks.js"], ["financeos.html", "money.js"],
    ["financeos.html", "money-credit.js"], ["money.html", "money.js"], ["money-credit.html", "money-credit.js"]]) {
    test(`${page} (${screen})`, () => {
      const html = read(page);
      const helper = html.indexOf('src="/app/bank-logo.js"');
      assert.ok(helper > -1, "bank-logo.js is not on the page");
      assert.ok(helper < html.indexOf(`src="${screen}"`), "the helper loads after the screen");
      const sheet = html.indexOf('href="/app/bank-logo.css"');
      assert.ok(sheet > -1, "bank-logo.css is not on the page");
      assert.ok(sheet < html.indexOf('href="/app/fundhub-astra.css"'), "the Astra sheets must stay last (UI-STANDARDS §0)");
    });
  }
});
