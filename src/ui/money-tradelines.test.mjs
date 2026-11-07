// The "What you have" card (public/app/money-tradelines.js), run in Node
// against the sample view built by the real tradelineView()
// (src/http/fixtures/money-tradelines.sample.json). Checks the four states,
// the short words, the chips and that nothing on the card invents a number.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const JS = fs.readFileSync(path.join(APP, "money-tradelines.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-tradelines.css"), "utf8");
const LOGO = fs.readFileSync(path.join(APP, "bank-logo.js"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.resolve(HERE, "../http/fixtures/money-tradelines.sample.json"), "utf8"));

function load({ withLogos = true, extras = null } = {}) {
  const sandbox = { window: { FinanceOS: extras ? { extras } : undefined } };
  if (withLogos) vm.runInNewContext(LOGO, sandbox);
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const T = W.FHTradelines;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const view = () => JSON.parse(JSON.stringify(FIXTURE));

describe("the full card", () => {
  const html = T.render(view(), false);
  const words = text(html);

  test("Personal, each business and Not sorted yet, in that order", () => {
    const heads = [...html.matchAll(/<section class="tl-group" data-group="[^"]+"><div class="tl-group-head"><h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
    assert.deepEqual(heads, ["Personal", "Sample Studio LLC", "Sample Rentals LLC", "Not sorted yet"]);
  });

  test("every row says where it came from", () => {
    assert.match(html, /<span class="tl-chip is-report">Report<\/span><span class="tl-chip is-plaid">Plaid<\/span>/,
      "the Chase card is on the report and in Plaid");
    assert.match(html, /<span class="tl-chip is-you">Added by you<\/span>/);
    assert.match(html, /Authorized user/, "an authorized-user line is marked");
  });

  test("banks you use carry the Existing relationship tag and their own logo", () => {
    assert.match(words, /Banks you use/);
    const banks = [...html.matchAll(/<li class="tl-bank" data-bank="([^"]+)">([\s\S]*?)<\/li>/g)];
    assert.deepEqual(banks.map((b) => b[1]), ["american_express", "chase", "navy_federal", "truist"]);
    for (const b of banks) assert.match(b[2], /Existing relationship/);
    assert.match(banks[1][2], /<img class="fh-bank-logo" src="\/assets\/lenders\/chase\.png"/, "Chase: the bank book's file (no Plaid logo saved)");
    assert.match(banks[0][2], /src="\/assets\/lenders\/american-express\.png"/, "Amex: the bank book's file");
  });

  test("a Plaid logo on the read is drawn as is", () => {
    const d = view();
    d.relationships[1].logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    assert.match(T.renderBanks(d.relationships), /<img class="fh-bank-logo" src="data:image\/png;base64,iVBOR/);
  });

    test("a bank we cannot name shows its name only, never a borrowed logo", () => {
    const row = /<li class="tl-row" data-item="[^"]+"><div class="tl-main">(?!<img)<div class="tl-text"><p class="tl-name">Capital One<\/p>/.test(html);
    assert.ok(row, "Capital One: no logo, the name stands alone");
  });

  test("facts are short and only what is on file: type, bank, limit, opened", () => {
    assert.match(words, /Chase Freedom Unlimited Credit card · Chase · Limit \$8,000 · Opened Apr 2019/);
    assert.match(words, /Truist Checking · Opened Aug 2025/, "no limit on a checking account, and no invented one");
    assert.match(words, /Sample Auto Finance Loan · Opened Feb 2023/, "a loan shows no limit");
    assert.match(words, /1 closed account not shown\./);
    assert.doesNotMatch(words, /\$0\b|NaN|undefined|null/);
    assert.doesNotMatch(html, /[A-Z]{4,} [A-Z]{4,}/, "no all-caps body text");
  });

  test("no add form or add button of its own: the one add form is the Accounts section's (patch 6)", () => {
    assert.doesNotMatch(html, /<form|<input|<select|data-act="tl-open"|add_tradeline/);
    assert.doesNotMatch(words, /Add an account|Save account/);
    assert.doesNotMatch(html, /<button/, "the full card has no control at all");
  });
});

describe("handing the read's choices to the Accounts add form", () => {
  async function mounted(body) {
    const events = [];
    const sandbox = { window: {
      document: { dispatchEvent: (e) => events.push(e), addEventListener() {}, removeEventListener() {} },
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
    } };
    vm.runInNewContext(LOGO, sandbox);
    vm.runInNewContext(JS, sandbox);
    const el = { innerHTML: "", addEventListener() {}, contains: () => true };
    sandbox.window.FHTradelines.mount(el, { apiGet: async () => ({ status: 200, body }) });
    await new Promise((r) => setTimeout(r, 0));
    return { T: sandbox.window.FHTradelines, events, el };
  }

  test("after a read, its own Just record it choices are handed over, with an event", async () => {
    const m = await mounted(view());
    assert.deepEqual(m.T.addOptions, view().add);
    assert.deepEqual(m.events.map((e) => [e.type, e.detail.add]), [["fh:tradelines-ready", view().add]]);
    assert.match(m.el.innerHTML, /What you have/);
  });

  test("a read that is not this view hands over nothing and shows nothing", async () => {
    const m = await mounted({ ok: true, containers: [] });
    assert.equal(m.T.addOptions, null);
    assert.deepEqual(m.events.map((e) => [e.type, e.detail.add]), [["fh:tradelines-ready", null]]);
    assert.equal(m.el.innerHTML, "");
  });
});

describe("the other three states", () => {
  test("empty: says what will appear and how", () => {
    const d = view();
    d.groups = [{ key: "personal", kind: "personal", name: "Personal", items: [], closed: 0 }];
    d.relationships = [];
    const words = text(T.render(d));
    assert.match(words, /No accounts yet Add one, or connect a bank\./);
    assert.doesNotMatch(words, /Add an account/, "the add form is the Accounts section's, just above");
  });

  test("loading: skeletons in the real layout", () => {
    const html = T.renderLoading();
    assert.match(html, /aria-busy="true"/);
    assert.equal((html.match(/tl-sk-l/g) || []).length, 3);
  });

  test("error: what failed in plain words, and one way to try again", () => {
    const html = T.renderError("offline");
    assert.match(text(html), /We could not load your accounts\. We could not reach the server\./);
    assert.match(html, /data-act="tl-retry">Try again<\/button>/);
    assert.doesNotMatch(text(T.renderError("nodb")), /\b5\d\d\b/, "no status codes");
  });
});

describe("words for a refused save", () => {
  test("a refused field is shown as the sentence that names it", () => {
    assert.equal(T.writeWords({ status: 400, body: { ok: false, error: "limit must be more than $0" } }), "Limit must be more than $0.");
    assert.equal(T.writeWords({ status: 404, body: { ok: false, error: "business_not_found" } }), "That business was not found. Reload and try again.");
    assert.equal(T.writeWords({ status: 0, body: null }), "We could not reach the server. Check your connection and try again.");
    assert.equal(T.writeWords({ status: 500, body: { ok: false } }), "That did not save. Try again.");
  });

  test("money: whole dollars show no cents; unknown shows nothing", () => {
    assert.equal(T.money(800000), "$8,000");
    assert.equal(T.money(1000050), "$10,000.50");
    assert.equal(T.money(null), "");
  });
});

describe("mounting", () => {
  test("it registers as the Accounts extra, and shares the box if one is already there", () => {
    assert.equal(typeof W.FinanceOS.extras.accounts.mount, "function");
    const calls = [];
    const before = { mount: () => calls.push("before") };
    const W2 = load({ extras: { accounts: before } });
    assert.notEqual(W2.FinanceOS.extras.accounts, before, "the earlier card is wrapped, not dropped");
  });
});

describe("the stylesheet", () => {
  test("every rule is scoped under .fh-tl, controls are 44px, and no shadow is hand-rolled", () => {
    const selectors = [...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter((s) => !/^\d+%$/.test(s));
    for (const s of selectors) for (const part of s.split(",")) assert.match(part.trim(), /^\.fh-tl\b/, `unscoped: ${part}`);
    assert.match(CSS, /\.fh-tl \.tl-btn\{[^}]*min-height:44px/);
    assert.doesNotMatch(CSS, /\.tl-(form|input|grid|field|problem|actions|flash)\b/, "no rules left for the add form that moved");
    const shadows = [...CSS.matchAll(/box-shadow:([^;}]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(shadows, ["var(--panel-shadow)"], "only the shared token");
    assert.match(CSS, /prefers-reduced-motion/);
  });
});
