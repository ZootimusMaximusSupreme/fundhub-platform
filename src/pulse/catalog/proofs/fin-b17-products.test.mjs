// Batch 17 practice tests: eleven small controls of Products & Commissions (public/app/products-commissions.html),
// in a real Chromium with fake /api answers. No live data, nothing leaves the browser.
//
//   + Add product, the editor's Cancel / close X / click outside, a product row click
//   View payout ledger and Back to rules, a rule's See these payouts, the ledger's two filters
//   a rule's header click and its Rate history, the Rails column, the three tabs
//   Page open: who am I (the SLO connections tab for owner and admin only), SLO connections Cancel

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, waitFor } from "./fin-b17-kit.mjs";
import { asRole, bodyOf, frozenClock, json, OWNER, sharedScreens } from "./fin-b17-browser-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const PAGE = "/app/products-commissions.html";

const PRODUCTS = {
  ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
  items: [
    // `rails` is not a column the API sends today; a page that read it would paint it. The page must not.
    { code: "funding_bundle", name: "Funding Bundle", category: "Funding", default_price: 3000, min_price: 2000, max_price: 5000, price_is_variable: true, active_rules: 2, rails: ["slo-book", "vsl-main"] },
    { code: "diy_letters", name: "DIY Letters", category: "Repair", default_price: 1000, min_price: 1000, max_price: 1000, price_is_variable: false, active_rules: 1, rails: ["slo-book"] },
  ],
};

const LEDGER = {
  ok: true, count: 5, limit: 200, offset: 0, hasMore: false,
  items: [
    { id: "1c000000-0000-4000-8000-000000000001", status: "earned", staff_name: "Casey Reed", amount: "300.00", basis: "3000.00", split_percent: "10", product_name_at_earning: "Funding Bundle", earned_at: "2026-10-02T12:00:00Z" },
    { id: "1c000000-0000-4000-8000-000000000002", status: "approved", staff_name: "Casey Reed", amount: "150.00", basis: "1500.00", split_percent: "10", product_name_at_earning: "Repair DFY", earned_at: "2026-09-28T12:00:00Z" },
    { id: "1c000000-0000-4000-8000-000000000003", status: "paid", staff_name: "Jordan Blake", amount: "90.00", basis: "900.00", split_percent: "10", product_name_at_earning: "Repair trial", earned_at: "2026-10-01T12:00:00Z", paid_at: "2026-10-03T12:00:00Z" },
    { id: "1c000000-0000-4000-8000-000000000004", status: "paid", staff_name: "Jordan Blake", amount: "70.00", basis: "700.00", split_percent: "10", product_name_at_earning: "Repair trial", earned_at: "2026-09-02T12:00:00Z", paid_at: "2026-09-05T12:00:00Z" },
    { id: "1c000000-0000-4000-8000-000000000005", status: "earned", staff_name: "Jordan Blake", amount: "40.00", basis: "400.00", split_percent: "10", product_name_at_earning: "Repair DFY", earned_at: "2026-10-04T12:00:00Z" },
  ],
};

const CONNECTIONS = {
  ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
  items: [{ id: "5c000000-0000-4000-8000-000000000001", name: "Course SLO", cf_funnel_id: "funnel-1", cf_product_id: "cf-prod-1", product_id: "funding_bundle", product_code: "funding_bundle", product_name: "Funding Bundle", active: true }],
};

function ruleRow(id, name, extra = {}) {
  return {
    id, name, basis: "front_end", stacking: "base", product_id: null, product_name: null, role: "closer",
    staff_id: null, staff_name: null, calc_method: "percent", percent: "10.00", flat_amount: null,
    amount_basis: "deposit_collected", effective_from: "2026-08-20T00:00:00Z", effective_to: null, notes: "Owner-set", tiers: [], ...extra,
  };
}
// "Closer front-end" has two versions (v1 closed on 2026-09-01, v2 open since then). "Manager override" has one.
const RULES = {
  ok: true, count: 3,
  rules: [
    ruleRow("77777777-7777-4777-8777-777777777771", "Closer front-end", { percent: "8.00", effective_to: "2026-09-01T00:00:00Z", notes: "First rate" }),
    ruleRow("77777777-7777-4777-8777-777777777772", "Closer front-end", { percent: "10.00", effective_from: "2026-09-01T00:00:00Z", notes: "Raised after the Q3 review" }),
    ruleRow("77777777-7777-4777-8777-777777777773", "Manager override", { role: "sales_manager", percent: "2.00", notes: "Owner-set" }),
  ],
};

// A rule with no product named covers all products, so every product's editor lists it, with its open rate.
const ALL_PRODUCT_RULES = "77777777-7777-4777-8777-777777777771 Closer front-end — 10%77777777-7777-4777-8777-777777777773 Manager override — 2%";

/** The page open with fake answers. Returns the page and every write it made. */
async function openPage({ session = OWNER, products = PRODUCTS, ledger = LEDGER, rules = RULES, connections = CONNECTIONS } = {}) {
  const log = { products: [], slo: [], reads: [] };
  const handlers = {
    "/api/read/products": products,
    "/api/read/commissions": ledger,
    "/api/read/slo-connections": async (route) => { log.reads.push("slo-connections"); return json(route, connections); },
    "/api/commission-rules": rules,
    "/api/products": async (route, { method }) => {
      if (method !== "POST") return json(route, products);
      const body = bodyOf(route);
      log.products.push(body);
      return json(route, { ok: true, action: body.action, product: { code: body.code || "capital_blueprint", name: body.name } });
    },
    "/api/slo-connections": async (route, { method }) => {
      if (method !== "POST") return json(route, connections);
      log.slo.push(bodyOf(route));
      return json(route, { ok: true, connection: { id: "5c000000-0000-4000-8000-000000000009" } });
    },
  };
  const { page, errors } = await screens.open(PAGE, { session, handlers, init: frozenClock("2026-10-13T12:00:00Z") });
  await page.waitForFunction(() => document.querySelectorAll("#prodBody tr[data-p]").length > 0, null, { timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll("#ruleList .rule").length > 0 && document.querySelectorAll("#ledgerBody tr[data-id]").length > 0, null, { timeout: 15_000 });
  // the ledger read repaints the rule list when it lands; let every read finish before a control is pressed
  await page.waitForLoadState("networkidle");
  return { page, errors, log };
}

const visible = (page, selector) => page.locator(selector).isVisible();
const editorOpen = (page) => page.evaluate(() => ({
  editor: document.getElementById("editor").classList.contains("open"),
  scrim: document.getElementById("scrim").classList.contains("on"),
}));
const ledgerRows = (page) => page.evaluate(() => [...document.querySelectorAll("#ledgerBody tr[data-id]")].map((tr) => ({
  who: tr.children[2].textContent.trim(), status: tr.children[9].textContent.trim(), amount: tr.children[8].textContent.trim(),
})));
const fields = (page) => page.evaluate(() => ({
  mode: document.getElementById("edMode").textContent,
  title: document.getElementById("edTitle").textContent,
  name: document.getElementById("p_name").value,
  cat: document.getElementById("p_cat").value,
  price: document.getElementById("p_price").value,
  min: document.getElementById("p_min").value,
  max: document.getElementById("p_max").value,
  variable: document.getElementById("p_var").classList.contains("on"),
  minDisabled: document.getElementById("p_min").disabled,
  maxDisabled: document.getElementById("p_max").disabled,
  rules: document.getElementById("p_rules").textContent.trim(),
}));

// ───────────────────────────── + Add product, and the editor's three ways out ─────────────────────────────

test("+ Add product opens the empty editor, clears what an earlier product left, and Save then creates", { timeout: 90_000 }, async () => {
  await proof.check(/^'\+ Add product'/, async () => {
    const { page, errors, log } = await openPage();
    assert.deepEqual(await editorOpen(page), { editor: false, scrim: false });

    // an existing product opened first leaves its words in the boxes ...
    await page.locator('#prodBody tr[data-p="funding_bundle"]').click();
    assert.equal((await fields(page)).name, "Funding Bundle");
    await page.locator("#edCancel").click();
    assert.deepEqual(await editorOpen(page), { editor: false, scrim: false });

    // ... and + Add product opens the empty editor
    await page.locator("#addProdBtn").click();
    assert.deepEqual(await editorOpen(page), { editor: true, scrim: true });
    assert.deepEqual(await fields(page), {
      mode: "ADD PRODUCT", title: "New product", name: "", cat: "Repair", price: "0", min: "0", max: "0",
      variable: false, minDisabled: true, maxDisabled: true, rules: "Save the product first, then scope a rule to it.",
    });
    assert.deepEqual(log.products, [], "opening the editor saves nothing");

    // Save then creates: no product code is sent, because no product was being edited
    await page.locator("#p_name").fill("Capital Blueprint");
    await page.locator("#p_price").fill("3000");
    await page.locator("#edSave").click();
    await waitFor(() => log.products.length === 1, "the create");
    assert.deepEqual(log.products[0], {
      name: "Capital Blueprint", category: "Repair", default_price: 3000, min_price: 3000, max_price: 3000,
      price_is_variable: false, action: "create",
    });
    await page.waitForFunction(() => document.querySelectorAll("#prodBody tr[data-p]").length === 3);
    assert.deepEqual(await editorOpen(page), { editor: false, scrim: false }, "a saved product closes the editor");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("the editor closes from Cancel, from the close X and from a click outside it, and keeps nothing that was typed", { timeout: 90_000 }, async () => {
  await proof.check(/^Product editor 'Cancel', close X, click outside/, async () => {
    const { page, errors, log } = await openPage();
    const open = () => page.locator('#prodBody tr[data-p="funding_bundle"]').click();

    for (const [way, close] of [
      ["Cancel", () => page.locator("#edCancel").click()],
      ["the close X", () => page.locator("#edClose").click()],
      ["a click outside", () => page.locator("#scrim").click({ position: { x: 640, y: 500 } })],
    ]) {
      await open();
      assert.deepEqual(await editorOpen(page), { editor: true, scrim: true }, `${way}: open first`);
      await page.locator("#p_name").fill(`Typed then dropped by ${way}`);
      await page.locator("#p_price").fill("1");
      await close();
      assert.deepEqual(await editorOpen(page), { editor: false, scrim: false }, way);
      assert.deepEqual(log.products, [], `${way} sends nothing`);
      // the ladder still names the product as it was
      assert.match(await page.locator('#prodBody tr[data-p="funding_bundle"]').innerText(), /Funding Bundle/);
      // and the editor opens fresh from the product, not from what was typed
      await open();
      const f = await fields(page);
      assert.equal(f.name, "Funding Bundle", `${way}: the typed words are gone`);
      assert.equal(f.price, "3000");
      await page.locator("#edCancel").click();
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("a product row click opens the editor for that product with its name, price band, switch and rules", { timeout: 90_000 }, async () => {
  await proof.check(/^Product row click \(opens the editor for that product\)/, async () => {
    const { page, errors, log } = await openPage();
    await page.locator('#prodBody tr[data-p="funding_bundle"]').click();
    assert.deepEqual(await editorOpen(page), { editor: true, scrim: true });
    assert.deepEqual(await fields(page), {
      mode: "EDIT PRODUCT", title: "Funding Bundle", name: "Funding Bundle", cat: "Funding", price: "3000", min: "2000", max: "5000",
      variable: true, minDisabled: false, maxDisabled: false, rules: ALL_PRODUCT_RULES,
    });
    await page.locator("#edCancel").click();

    // a fixed-price product: the Variable switch is off and the band boxes are locked
    await page.locator('#prodBody tr[data-p="diy_letters"]').click();
    assert.deepEqual(await fields(page), {
      mode: "EDIT PRODUCT", title: "DIY Letters", name: "DIY Letters", cat: "Repair", price: "1000", min: "1000", max: "1000",
      variable: false, minDisabled: true, maxDisabled: true, rules: ALL_PRODUCT_RULES,
    });
    // Save sends THIS product's code
    await page.locator("#p_price").fill("1200");
    await page.locator("#edSave").click();
    await waitFor(() => log.products.length === 1, "the save");
    assert.equal(log.products[0].action, "save");
    assert.equal(log.products[0].code, "diy_letters");
    assert.equal(log.products[0].default_price, 1200);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── the Rails column ─────────────────────────────

test("the Rails column is a dash on every row, even when an answer carries a rails list", { timeout: 90_000 }, async () => {
  await proof.check(/^Products table 'Rails' column/, async () => {
    const { page, errors } = await openPage();
    const header = await page.evaluate(() => [...document.querySelectorAll("#tab-products thead th")].map((th) => th.textContent.trim()));
    assert.deepEqual(header, ["Product", "Category", "Price", "Variable", "Rails"]);
    const cells = await page.evaluate(() => [...document.querySelectorAll("#prodBody tr[data-p]")].map((tr) => ({
      cols: tr.children.length, rails: tr.children[4].textContent.trim(), title: tr.children[4].querySelector("span")?.getAttribute("title"),
    })));
    assert.equal(cells.length, 2);
    for (const cell of cells) {
      assert.equal(cell.cols, 5, "five cells in a five-column table");
      assert.equal(cell.rails, "—", "no funnels are painted: nothing records which funnels a product sits on");
      assert.equal(cell.title, "No rails source");
    }
    const text = await page.locator("#prodBody").innerText();
    assert.ok(!/slo-book|vsl-main/.test(text), "the rails the answer carried are not painted");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── the ledger link, and what opens it ─────────────────────────────

test("View payout ledger opens the ledger pane and Back to rules returns to the rules pane", { timeout: 90_000 }, async () => {
  await proof.check(/^'View payout ledger ->' and '<- Back to rules'/, async () => {
    const { page, errors } = await openPage();
    assert.equal(await visible(page, "#tab-products"), true);
    assert.equal(await visible(page, "#tab-ledger"), false);
    assert.equal((await page.locator("#ledgerLink").textContent()).trim(), "View payout ledger →");

    await page.locator("#ledgerLink").click();
    assert.equal(await visible(page, "#tab-ledger"), true);
    assert.equal(await visible(page, "#tab-products"), false);
    assert.equal(await visible(page, "#tab-rules"), false);
    assert.equal((await page.locator("#ledgerBack").textContent()).trim(), "← Back to rules");
    assert.equal((await ledgerRows(page)).length, 5, "every payout row is listed");
    assert.equal((await page.locator("#ledgerTotal").innerText()).trim(), "$650");

    await page.locator("#ledgerBack").click();
    assert.equal(await visible(page, "#tab-ledger"), false);
    assert.equal(await visible(page, "#tab-rules"), true, "Back lands on the rules, whichever tab was open before");
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".tabs .tab.on")].map((t) => t.dataset.tab)), ["rules"]);
    assert.equal(await page.evaluate(() => document.querySelector(".tabs").closest(".card").classList.contains("on-ledger")), false);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("a rule's See these payouts opens the ledger on the people that rule pays, or on everyone when no payout names it", { timeout: 90_000 }, async () => {
  await proof.check(/^Commission rule 'See these payouts ->'/, async () => {
    const { page, errors } = await openPage();
    // press the first rule's See these payouts, opening the rule first when it is folded
    const seePayouts = async () => {
      await page.locator('.tab[data-tab="rules"]').click();
      const first = page.locator("#ruleList .rule").first();
      if (!(await first.evaluate((el) => el.classList.contains("open")))) await first.locator(".rule-hd").click();
      await first.locator("[data-led]").click();
    };
    // the live ledger rows carry no rule id (the Rule version column is a dash), so no rule names a person
    await seePayouts();
    assert.equal(await visible(page, "#tab-ledger"), true);
    assert.equal(await page.locator("#perFilter").inputValue(), "", "no payout names the rule, so the ledger opens on Everyone");
    assert.equal(await page.locator("#statFilter").inputValue(), "");
    assert.equal((await ledgerRows(page)).length, 5);

    // a status left in the filter from before is reset by the button
    await page.locator("#statFilter").selectOption("Paid");
    assert.equal((await ledgerRows(page)).length, 2);
    await page.locator("#ledgerBack").click();
    await seePayouts();
    assert.equal(await page.locator("#statFilter").inputValue(), "", "the status filter is cleared");
    assert.equal((await ledgerRows(page)).length, 5);

    // when payouts do name the rule (the page's own LEDGER rows), the ledger opens on the one person it pays
    const ruleId = await page.evaluate(() => RULES[0].id);
    await page.evaluate((id) => {
      LEDGER.filter((l) => l.who === "Casey Reed").forEach((l) => { l.rule = id; });
      fillPersonFilter();
    }, ruleId);
    await page.locator("#ledgerBack").click();
    await seePayouts();
    assert.equal(await page.locator("#perFilter").inputValue(), "Casey Reed");
    assert.deepEqual((await ledgerRows(page)).map((r) => r.who), ["Casey Reed", "Casey Reed"]);
    assert.equal((await page.locator("#ledgerTotal").innerText()).trim(), "$450");
    // two people on one rule: nobody is singled out
    await page.evaluate((id) => { LEDGER.forEach((l) => { l.rule = id; }); }, ruleId);
    await page.locator("#ledgerBack").click();
    await seePayouts();
    assert.equal(await page.locator("#perFilter").inputValue(), "");
    assert.equal((await ledgerRows(page)).length, 5);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("the person and status filters narrow the payout rows and the total, together and apart", { timeout: 90_000 }, async () => {
  await proof.check(/^Ledger filters: person select and status select/, async () => {
    const { page, errors } = await openPage();
    await page.locator("#ledgerLink").click();
    const options = (id) => page.evaluate((sel) => [...document.getElementById(sel).options].map((o) => o.textContent), id);
    assert.deepEqual(await options("perFilter"), ["Everyone", "Casey Reed", "Jordan Blake"], "one option per person on the ledger");
    assert.deepEqual(await options("statFilter"), ["All statuses", "Accrued", "Approved", "Paid"]);
    const total = async () => (await page.locator("#ledgerTotal").innerText()).trim();

    assert.equal((await ledgerRows(page)).length, 5);
    assert.equal(await total(), "$650");

    await page.locator("#perFilter").selectOption("Casey Reed");
    assert.deepEqual((await ledgerRows(page)).map((r) => [r.who, r.status]), [["Casey Reed", "Accrued"], ["Casey Reed", "Approved"]]);
    assert.equal(await total(), "$450");

    await page.locator("#statFilter").selectOption("Approved");
    assert.deepEqual((await ledgerRows(page)).map((r) => [r.who, r.status, r.amount]), [["Casey Reed", "Approved", "$150"]]);
    assert.equal(await total(), "$150");

    await page.locator("#statFilter").selectOption("Paid");
    assert.equal((await ledgerRows(page)).length, 0);
    assert.match(await page.locator("#ledgerBody").innerText(), /Nothing matches that filter\./);
    assert.equal(await total(), "$0");

    await page.locator("#perFilter").selectOption("");
    assert.deepEqual((await ledgerRows(page)).map((r) => [r.who, r.amount]), [["Jordan Blake", "$90"], ["Jordan Blake", "$70"]]);
    assert.equal(await total(), "$160");

    await page.locator("#statFilter").selectOption("");
    assert.equal((await ledgerRows(page)).length, 5);
    assert.equal(await total(), "$650");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── a rule's header and its history ─────────────────────────────

test("a rule header click expands and folds the rule, and Rate history opens without folding it", { timeout: 90_000 }, async () => {
  await proof.check(/^Commission rule header click \(expand a rule\) and 'Rate history' disclosure/, async () => {
    const { page, errors } = await openPage();
    await page.locator('.tab[data-tab="rules"]').click();
    const rules = await page.evaluate(() => [...document.querySelectorAll("#ruleList .rule")].map((r) => r.querySelector(".rn").textContent));
    assert.deepEqual(rules, ["Closer front-end", "Manager override"], "two versions of one rule are one rule");
    const first = page.locator("#ruleList .rule").first();
    const isOpen = () => first.evaluate((el) => el.classList.contains("open"));
    assert.equal(await isOpen(), false);
    assert.equal(await first.locator(".rule-bd").isVisible(), false);

    await first.locator(".rule-hd").click();
    assert.equal(await isOpen(), true);
    assert.equal(await first.locator(".rule-bd").isVisible(), true);
    assert.equal(await page.locator("#ruleList .rule").nth(1).evaluate((el) => el.classList.contains("open")), false, "only this rule opens");

    // Rate history: closed first, then opened by its own summary, and the rule stays open
    const hist = first.locator("details.vhist");
    assert.equal(await hist.evaluate((el) => el.open), false);
    assert.match(await hist.locator("summary").textContent(), /Rate history — 2 versions, v2 open since 2026-09-01/);
    await hist.locator("summary").click();
    assert.equal(await hist.evaluate((el) => el.open), true);
    assert.equal(await isOpen(), true, "opening the history does not fold the rule");
    const rows = await hist.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, " ").trim())));
    assert.deepEqual(rows.map((r) => r.slice(0, 5)), [
      ["v2", "10%", "2026-09-01", "—", "Open"],
      ["v1", "8%", "2026-08-20", "2026-09-01", "Closed"],
    ]);
    assert.match(rows[0][5], /Raised after the Q3 review/);
    await hist.locator("summary").click();
    assert.equal(await hist.evaluate((el) => el.open), false);
    assert.equal(await isOpen(), true);

    await first.locator(".rule-hd").click();
    assert.equal(await isOpen(), false, "the header folds it again");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── tabs, and who sees the SLO tab ─────────────────────────────

const paneState = (page) => page.evaluate(() => ({
  tabs: [...document.querySelectorAll(".tabs .tab")].filter((t) => !t.hidden).map((t) => [t.dataset.tab, t.textContent.trim(), t.classList.contains("on")]),
  panes: [...document.querySelectorAll(".tabpane")].filter((p) => p.classList.contains("on")).map((p) => p.id),
}));

test("the Products and Commission rules tabs swap their panes, and SLO connections joins them for the owner", { timeout: 90_000 }, async () => {
  await proof.check(/^Tabs: Products, Commission rules, SLO connections/, async () => {
    const { page, errors, log } = await openPage({ session: asRole("owner") });
    await page.waitForFunction(() => !document.getElementById("sloTab").hidden);
    assert.deepEqual(await paneState(page), {
      tabs: [["products", "Products", true], ["rules", "Commission rules", false], ["slo", "SLO connections", false]],
      panes: ["tab-products"],
    });
    await page.locator('.tab[data-tab="rules"]').click();
    assert.deepEqual((await paneState(page)).panes, ["tab-rules"]);
    assert.deepEqual((await paneState(page)).tabs.map((t) => t[2]), [false, true, false]);
    assert.equal(await visible(page, "#ruleList"), true);
    await page.locator('.tab[data-tab="slo"]').click();
    assert.deepEqual((await paneState(page)).panes, ["tab-slo"]);
    assert.deepEqual((await paneState(page)).tabs.map((t) => t[2]), [false, false, true]);
    assert.match(await page.locator("#sloBody").innerText(), /Course SLO/);
    await page.locator('.tab[data-tab="products"]').click();
    assert.deepEqual((await paneState(page)).panes, ["tab-products"]);

    // the ledger is a link, not a tab: while it is open the tab row is out of the way, and Back to rules returns
    await page.locator("#ledgerLink").click();
    assert.equal(await visible(page, "#tab-ledger"), true);
    assert.equal(await visible(page, ".tabs"), false, "the tabs are not shown over the ledger");
    await page.locator("#ledgerBack").click();
    assert.equal(await visible(page, ".tabs"), true);
    assert.equal(await visible(page, "#tab-ledger"), false);
    assert.deepEqual((await paneState(page)).panes, ["tab-rules"]);
    assert.deepEqual(log.products, []);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Page open reads who is signed in: the SLO connections tab and its read are for the owner and admin only", { timeout: 120_000 }, async () => {
  await proof.check(/^Page open: who am I/, async () => {
    for (const role of ["owner", "admin"]) {
      const { page, errors, log } = await openPage({ session: asRole(role) });
      await page.waitForFunction(() => !document.getElementById("sloTab").hidden, null, { timeout: 8000 });
      await waitFor(() => log.reads.includes("slo-connections"), `${role} read of the connections`);
      assert.equal(await visible(page, "#sloTab"), true, role);
      assert.deepEqual(errors, []);
      await page.close();
    }
    // sales manager is the one other login the staff shell lets onto this page (the finance-gated screens)
    for (const role of ["sales_manager"]) {
      const { page, errors, log } = await openPage({ session: asRole(role) });
      // give the session answer time to land: the products read has already painted, so wait on the network going quiet
      await page.waitForLoadState("networkidle");
      assert.equal(await page.evaluate(() => document.getElementById("sloTab").hidden), true, `${role} does not get the tab`);
      assert.deepEqual(log.reads, [], `${role}: the connections are never read`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  });
});

// ───────────────────────────── SLO connections Cancel ─────────────────────────────

test("SLO connections Cancel closes the form and sends nothing, for a new connection and for an edited row", { timeout: 90_000 }, async () => {
  await proof.check(/^SLO connections 'Cancel'/, async () => {
    const { page, errors, log } = await openPage({ session: asRole("owner") });
    await page.waitForFunction(() => !document.getElementById("sloTab").hidden);
    await page.locator('.tab[data-tab="slo"]').click();
    const formOpen = () => page.evaluate(() => !document.getElementById("sloForm").hidden);
    assert.equal(await formOpen(), false);

    // a new connection, with words typed, then Cancel
    await page.locator("#addSloBtn").click();
    assert.equal(await formOpen(), true);
    await page.locator("#slo_name").fill("Typed then cancelled");
    await page.locator("#slo_funnel").fill("funnel-99");
    await page.locator("#sloCancel").click();
    assert.equal(await formOpen(), false);
    assert.deepEqual(log.slo, [], "Cancel sends nothing");
    // the next new connection starts empty
    await page.locator("#addSloBtn").click();
    assert.equal(await page.locator("#slo_name").inputValue(), "");
    assert.equal(await page.locator("#slo_funnel").inputValue(), "");
    await page.locator("#sloCancel").click();

    // an existing row opened for edit, changed, then Cancel: the row in the list is unchanged
    await page.locator('#sloBody tr[data-slo]').first().click();
    assert.equal(await formOpen(), true);
    assert.equal(await page.locator("#slo_name").inputValue(), "Course SLO");
    await page.locator("#slo_name").fill("Renamed and dropped");
    await page.locator("#sloCancel").click();
    assert.equal(await formOpen(), false);
    assert.deepEqual(log.slo, []);
    assert.match(await page.locator("#sloBody").innerText(), /Course SLO/);
    assert.ok(!/Renamed and dropped/.test(await page.locator("#sloBody").innerText()));
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  assert.equal(proof.rows.length, 11);
  proof.assertAllClaimed();
});
