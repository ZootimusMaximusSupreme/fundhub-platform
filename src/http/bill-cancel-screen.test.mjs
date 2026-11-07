// public/app/bill-cancel.js — the Repeat bills card ("Cancel it for me") on
// the Strategy screen. Runs the card's own render functions, and the press, in
// Node with the fictional sample block in
// src/http/fixtures/money-strategy-bill-cancel.sample.json. Also runs
// money-strategy.js beside it, so the card is checked where it is mounted.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import * as math from "../../public/app/money-strategy-math.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const CARD_JS = fs.readFileSync(path.join(APP, "bill-cancel.js"), "utf8");
const STRATEGY_JS = fs.readFileSync(path.join(APP, "money-strategy.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "bill-cancel.css"), "utf8");
const PAGE = fs.readFileSync(path.join(APP, "money-strategy.html"), "utf8");
const FOS = fs.readFileSync(path.join(APP, "financeos.html"), "utf8");
const BLOCK = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-strategy-bill-cancel.sample.json"), "utf8"));
const PLAN = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-strategy.sample.json"), "utf8"));

function load(withCard = true) {
  const sandbox = { window: {} };
  if (withCard) vm.runInNewContext(CARD_JS, sandbox);
  vm.runInNewContext(STRATEGY_JS, sandbox);
  return sandbox.window;
}
const W = load();
const C = W.FHBillCancel;
const block = () => JSON.parse(JSON.stringify(BLOCK));
const text = (html) => html.replace(/<[^>]+>/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const rowOf = (html, id) => {
  const m = html.match(new RegExp('<li class="bill-row" data-bill-row="' + id + '">[\\s\\S]*?</li>'));
  assert.ok(m, "no row for " + id);
  return m[0];
};
const byName = (b, name) => b.bills.find((x) => x.name === name);

describe("the card's four states", () => {
  test("no block, or no bills: nothing (Things to check already says none were found)", () => {
    assert.equal(C.renderCard(undefined), "");
    assert.equal(C.renderCard({ ok: true, viewer: "client", bills: [] }), "");
  });

  test("a failed read says so, with Try again, and nothing else", () => {
    const html = C.renderCard({ ok: false, reason: "read_failed" });
    assert.match(html, /<h2 class="eyebrow" id="s-bills">Repeat bills<\/h2>/);
    assert.match(text(html), /We could not load your repeat bills\. Try again$/);
    assert.match(html, /data-act="retry"/);
    assert.doesNotMatch(html, /cancel-bill/);
  });

  test("full: one row per bill, short words, the button only where it can be pressed", () => {
    const b = block();
    const html = C.renderCard(b);
    assert.equal((html.match(/class="bill-row"/g) || []).length, b.bills.length);
    // The button makes a request; the team works on it (Codex CX16).
    assert.match(text(html), /^Repeat bills Tap Cancel it for me and our team will work on it\./);
    assert.doesNotMatch(text(html), /our team cancels it/);
    const none = byName(b, "Sample Streaming");
    const row = rowOf(html, none.id);
    assert.match(row, /data-act="cancel-bill" data-bill="b1000000-0000-4000-8000-000000000001"/);
    assert.match(text(row), /Sample Streaming Every month · \$15\.99 · Sample Checking ····4821/);
    assert.match(row, /aria-label="Cancel it for me: Sample Streaming">Cancel it for me<\/button>/);
  });
});

describe("Requested / Working / Cancelled, in words and shapes", () => {
  const b = block();
  const html = C.renderCard(b);
  test("Requested: the word, the day it was asked, no button", () => {
    const row = rowOf(html, byName(b, "Sample Gym").id);
    assert.match(row, /<span class="tag bill-state">Requested<\/span><span class="caption">Nov 6<\/span>/);
    assert.doesNotMatch(row, /data-act="cancel-bill"/);
  });
  test("Working: the dashed pill, no button", () => {
    const row = rowOf(html, byName(b, "Sample Design Suite").id);
    assert.match(row, /bill-state bill-working">Working</);
    assert.doesNotMatch(row, /data-act="cancel-bill"/);
  });
  test("Cancelled shows only once the team marks the ask done, never while it is asked or worked on", () => {
    for (const name of ["Sample Gym", "Sample Design Suite"]) assert.doesNotMatch(rowOf(html, byName(b, name).id), /Cancelled/, name);
    assert.equal(C.statusHtml({ state: "requested", asked_on: "2026-11-06" }).includes("Cancelled"), false);
    assert.equal(C.statusHtml({ state: "working" }).includes("Cancelled"), false);
    assert.match(C.statusHtml({ state: "cancelled", cancelled_on: "2026-10-22" }), />Cancelled</);
  });
  test("Cancelled: the ink pill and the day, no button, no link", () => {
    const row = rowOf(html, byName(b, "Sample Cloud Storage").id);
    assert.match(row, /bill-state bill-done">Cancelled<\/span><span class="caption">Oct 22</);
    assert.doesNotMatch(row, /data-act="cancel-bill"/);
    assert.doesNotMatch(row, /Cancel on their site/);
    assert.match(text(row), /Every year · \$119\.88/);
  });
  test("a charge after Cancelled says Charged again and offers Ask again", () => {
    const row = rowOf(html, byName(b, "Sample Music").id);
    assert.match(row, /<span class="warn-word">Charged again<\/span><span class="caption">Nov 3</);
    assert.match(row, /aria-label="Ask again to cancel Sample Music">Ask again<\/button>/);
    assert.doesNotMatch(row, />Cancelled</);
  });
  test("an unknown amount is left out, never $0.00", () => {
    const row = rowOf(html, byName(b, "Sample Phone Plan With A Very Long Merchant Name For Wrapping Checks").id);
    assert.doesNotMatch(row, /\$0\.00/);
    assert.match(text(row), /Every month · Sample Card ····1180/);
  });
});

describe("the merchant's own cancel link", () => {
  test("shows only where a team member saved one, opening in a new tab", () => {
    const b = block();
    const html = C.renderCard(b);
    assert.match(rowOf(html, byName(b, "Sample Streaming").id),
      /<a class="bill-link" href="https:\/\/example\.com\/account\/cancel" target="_blank" rel="noopener noreferrer">Cancel on their site<\/a>/);
    assert.doesNotMatch(rowOf(html, byName(b, "Sample Gym").id), /bill-link"/);
    assert.equal((html.match(/Cancel on their site/g) || []).length, 1);
  });

  test("the client sees no link form; the team sees one per bill", () => {
    const client = C.renderCard(block());
    assert.doesNotMatch(client, /set_cancel_link|save-cancel-link|bill-link-form/);
    const staff = block();
    staff.viewer = "staff";
    const html = C.renderCard(staff);
    assert.equal((html.match(/data-act="save-cancel-link"/g) || []).length, staff.bills.length);
    assert.match(html, /<input id="bl-b1000000-0000-4000-8000-000000000001" type="url" inputmode="url" autocomplete="off" placeholder="https:\/\/" value="https:\/\/example\.com\/account\/cancel">/);
  });
});

describe("long lists and odd names", () => {
  test("more than 14 bills: the first 12, then Show all; show_all draws every one", () => {
    const b = block();
    const many = [];
    for (let i = 0; i < 20; i += 1) many.push({ ...b.bills[0], id: "b-" + i, name: "Sample bill " + i });
    const html = C.renderCard({ ok: true, viewer: "client", bills: many });
    assert.equal((html.match(/class="bill-row"/g) || []).length, 12);
    assert.match(html, /data-act="bills-all">Show all 20</);
    const all = C.renderCard({ ok: true, viewer: "client", bills: many, show_all: true });
    assert.equal((all.match(/class="bill-row"/g) || []).length, 20);
    assert.doesNotMatch(all, /bills-all/);
    const fourteen = C.renderCard({ ok: true, viewer: "client", bills: many.slice(0, 14) });
    assert.equal((fourteen.match(/class="bill-row"/g) || []).length, 14, "no Show all that hides one or two");
  });

  test("names are escaped", () => {
    const html = C.renderCard({ ok: true, viewer: "client", bills: [{ ...block().bills[0], name: '<img src=x onerror="x">' }] });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=&quot;x&quot;&gt;/);
  });
});

describe("mounted in the Strategy section", () => {
  const settings = { method: "avalanche", monthly_cents: 150000, goal: null };
  test("under Things to check, before the debts table", () => {
    const d = JSON.parse(JSON.stringify(PLAN));
    d.bill_cancel = block();
    d.bill_cleanup = { ok: true, checked_bills: 6, window_days: 90, flags: [] };
    const html = W.FHMoneyStrategy.render(d, math.buildPlan(d.inputs, settings), settings, {});
    const cleanup = html.indexOf('class="card cleanup-card"');
    const bills = html.indexOf('class="card bills-card"');
    const debts = html.indexOf('class="card debts-card"');
    assert.ok(cleanup > 0 && bills > cleanup && debts > bills, "Things to check → Repeat bills → debts");
  });

  test("with no cards or loans, the bills still show under the empty plan", () => {
    const d = JSON.parse(JSON.stringify(PLAN));
    d.inputs.debts = [];
    d.bill_cancel = block();
    const html = W.FHMoneyStrategy.render(d, math.buildPlan(d.inputs, settings), settings, {});
    assert.match(html, /No cards or loans with a balance yet/);
    assert.match(html, /class="card bills-card"/);
  });

  test("without bill-cancel.js on the page the section paints exactly as before", () => {
    const bare = load(false);
    const d = JSON.parse(JSON.stringify(PLAN));
    d.bill_cancel = block();
    const html = bare.FHMoneyStrategy.render(d, math.buildPlan(d.inputs, settings), settings, {});
    assert.doesNotMatch(html, /bills-card/);
  });

  test("both pages load the card's script before money-strategy.js and its styles after money-strategy.css", () => {
    for (const html of [PAGE, FOS]) {
      assert.match(html, /<script defer src="bill-cancel\.js"><\/script>\n<script defer src="money-strategy\.js"><\/script>/);
      assert.match(html, /<link rel="stylesheet" href="money-strategy\.css">\n<link rel="stylesheet" href="bill-cancel\.css">/);
    }
  });
});

describe("the press", () => {
  function fakeButton(attrs, rowInput = "") {
    const slot = { textContent: "", hidden: true };
    const input = { value: rowInput };
    const row = { querySelector: (sel) => (sel.indexOf("bill-err") >= 0 ? slot : sel.indexOf("url") >= 0 ? input : null) };
    return {
      slot,
      disabled: false,
      textContent: attrs.label || "Cancel it for me",
      getAttribute: (k) => attrs[k] || null,
      closest: () => row
    };
  }

  test("Cancel it for me posts the bill id (and the client id for staff), then repaints with the answer", async () => {
    const answer = block();
    answer.bills[0].cancel = { state: "requested", asked_on: "2026-11-07", can_ask: false };
    const sent = [];
    let painted = 0;
    const data = { bill_cancel: block() };
    const t = fakeButton({ "data-bill": answer.bills[0].id });
    await new Promise((done) => {
      C.act(t, "cancel-bill", {
        data, path: "/api/money/strategy", clientId: "client-1",
        send: (p, body) => { sent.push({ p, body }); return Promise.resolve({ status: 200, body: { ok: true, created: true, bill_cancel: answer } }); },
        repaint: () => { painted += 1; done(); }
      });
      assert.equal(t.disabled, true);
      assert.equal(t.textContent, "Sending…");
    });
    // The body was built inside the page's own realm; compare it as JSON.
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ p: "/api/money/strategy", body: { action: "cancel_bill", bill_id: answer.bills[0].id, client_id: "client-1" } }]);
    assert.equal(painted, 1);
    assert.equal(data.bill_cancel.bills[0].cancel.state, "requested");
  });

  test("a refused press keeps the button, puts it back, and says why in that row", async () => {
    const data = { bill_cancel: block() };
    const t = fakeButton({ "data-bill": "b1" });
    let painted = 0;
    await C.act(t, "cancel-bill", {
      data, path: "/api/money/strategy",
      send: () => Promise.resolve({ status: 404, body: { ok: false, error: "bill_not_found", message: "x" } }),
      repaint: () => { painted += 1; }
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(painted, 0);
    assert.equal(t.disabled, false);
    assert.equal(t.textContent, "Cancel it for me");
    assert.equal(t.slot.hidden, false);
    assert.equal(t.slot.textContent, "That bill is not on file anymore. Reload the page.");
  });

  test("Save link refuses a link that is not https before sending anything", () => {
    const data = { bill_cancel: block() };
    const t = fakeButton({ "data-bill": "b1", label: "Save link" }, "http://example.com");
    let sent = 0;
    C.act(t, "save-cancel-link", { data, path: "/x", send: () => { sent += 1; return Promise.resolve({}); }, repaint() {} });
    assert.equal(sent, 0);
    assert.match(t.slot.textContent, /https:\/\//);
  });

  test("Show all keeps working after the next answer comes back", async () => {
    const data = { bill_cancel: block() };
    let painted = 0;
    C.act({ getAttribute: () => null }, "bills-all", { data, repaint: () => { painted += 1; } });
    assert.equal(data.bill_cancel.show_all, true);
    assert.equal(painted, 1);
    const t = fakeButton({ "data-bill": "b1" });
    await new Promise((done) => C.act(t, "cancel-bill", {
      data, path: "/x", send: () => Promise.resolve({ status: 200, body: { ok: true, bill_cancel: block() } }), repaint: done
    }));
    assert.equal(data.bill_cancel.show_all, true);
  });

  test("only its own three buttons are handled here", () => {
    for (const a of ["cancel-bill", "save-cancel-link", "bills-all"]) assert.equal(C.handles(a), true);
    for (const a of ["retry", "save", "use-amount", null]) assert.equal(C.handles(a), false);
  });
});

describe("the styles", () => {
  test("scoped under .fh-strategy, 44px controls, 13px pills, no hand-rolled shadow", () => {
    for (const rule of CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
      const sel = rule.split("{")[0].trim();
      if (!sel || sel.startsWith("@media")) continue;
      for (const s of sel.replace(/^@media[^{]*\{/, "").split(",")) assert.match(s.trim(), /^\.fh-strategy /, s);
    }
    assert.match(CSS, /\.bills-card \.bill-btn\{min-height:44px/);
    assert.match(CSS, /\.bill-link\{[^}]*min-height:44px/);
    assert.match(CSS, /\.bill-link-row input\{[^}]*min-height:44px[^}]*font-size:16px/);
    assert.match(CSS, /\.bill-state\{[^}]*font-size:13px/);
    assert.doesNotMatch(CSS, /box-shadow/);
  });
});
