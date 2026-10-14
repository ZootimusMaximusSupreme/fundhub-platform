// Slice 1 (money screens): Products & Commissions — the product ladder, the
// product editor's own price rules, the stat tiles, and the SLO connections tab.
// Each test presses one control against fake API answers and checks the exact
// request it sends and what it paints. Nothing leaves the browser.
import { test, expect } from "@playwright/test";
import { freezeClock, json, openScreen, OWNER } from "./harness.mjs";

const PRODUCTS = {
  ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
  items: [
    { code: "funding_bundle", name: "Funding Bundle", category: "funding", default_price: 3000, min_price: 2000, max_price: 5000, price_is_variable: true, active_rules: 2 },
    { code: "diy_letters", name: "DIY Letters", category: "repair", default_price: 1000, min_price: 1000, max_price: 1000, price_is_variable: false, active_rules: 1 },
  ],
};

const LEDGER = {
  ok: true, count: 5, limit: 200, offset: 0, hasMore: false,
  items: [
    { id: "1c000000-0000-4000-8000-000000000001", status: "earned", staff_name: "Casey Reed", amount: "300.00", basis: "3000.00", split_percent: "10", product_name_at_earning: "Funding Bundle", earned_at: "2026-10-02T12:00:00Z" },
    { id: "1c000000-0000-4000-8000-000000000002", status: "approved", staff_name: "Casey Reed", amount: "150.00", basis: "1500.00", split_percent: "10", product_name_at_earning: "Repair DFY", earned_at: "2026-09-28T12:00:00Z" },
    { id: "1c000000-0000-4000-8000-000000000003", status: "paid", staff_name: "Casey Reed", amount: "90.00", basis: "900.00", split_percent: "10", product_name_at_earning: "Repair trial", earned_at: "2026-10-01T12:00:00Z", paid_at: "2026-10-03T12:00:00Z" },
    // Paid last month: not part of PAID MTD. Voided: not owed, so not part of ACCRUED.
    { id: "1c000000-0000-4000-8000-000000000004", status: "paid", staff_name: "Casey Reed", amount: "70.00", basis: "700.00", split_percent: "10", product_name_at_earning: "Repair trial", earned_at: "2026-09-02T12:00:00Z", paid_at: "2026-09-05T12:00:00Z" },
    { id: "1c000000-0000-4000-8000-000000000005", status: "void", staff_name: "Casey Reed", amount: "40.00", basis: "400.00", split_percent: "10", product_name_at_earning: "Repair DFY", earned_at: "2026-10-04T12:00:00Z" },
  ],
};

const CONNECTIONS = {
  ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
  items: [
    { id: "5c000000-0000-4000-8000-000000000001", name: "Course SLO", cf_funnel_id: "funnel-1", cf_product_id: "cf-prod-1", product_id: "funding_bundle", product_code: "funding_bundle", product_name: "Funding Bundle", active: true },
    { id: "5c000000-0000-4000-8000-000000000002", name: "Old funnel", cf_funnel_id: "funnel-0", cf_product_id: "cf-prod-0", product_id: "diy_letters", product_code: "diy_letters", product_name: "DIY Letters", active: false },
  ],
};

function rule(n, name) {
  return {
    id: `77777777-7777-4777-8777-77777777777${n}`, name, basis: "front_end", stacking: "base", product_id: null,
    product_name: null, role: "closer", staff_id: null, staff_name: null, calc_method: "percent", percent: "10.00",
    flat_amount: null, amount_basis: "deposit_collected", effective_from: "2026-08-20T00:00:00Z", effective_to: null,
    notes: "Owner-set", tiers: [],
  };
}
const RULES = { ok: true, count: 3, rules: [rule(1, "Closer front-end"), rule(2, "Closer back-end"), rule(3, "Manager override")] };

async function open(page, { connections = CONNECTIONS, products = PRODUCTS, rules = RULES } = {}) {
  const productWrites = [];
  const sloWrites = [];
  await freezeClock(page, "2026-10-13T12:00:00Z");
  await openScreen(page, "/app/products-commissions.html", OWNER, {
    "/api/read/products": products,
    "/api/read/commissions": LEDGER,
    "/api/read/slo-connections": connections,
    "/api/commission-rules": rules,
    "/api/products": async (route, { method }) => {
      if (method !== "POST") return json(route, PRODUCTS);
      const body = route.request().postDataJSON();
      productWrites.push(body);
      return json(route, { ok: true, action: body.action, product: { code: body.code || "new_product", name: body.name } });
    },
    "/api/slo-connections": async (route, { method }) => {
      if (method !== "POST") return json(route, connections);
      sloWrites.push(route.request().postDataJSON());
      return json(route, { ok: true, connection: { id: "5c000000-0000-4000-8000-000000000009" } });
    },
  });
  return { productWrites, sloWrites };
}

test.describe("Products & Commissions: the ladder and the tiles", () => {
  test("Page open draws one ladder row per product with its price or band, and Variable or Fixed", async ({ page }) => {
    await open(page);
    const rows = page.locator("#prodBody tr[data-p]");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Funding Bundle");
    await expect(rows.nth(0)).toContainText("$2,000 – $5,000");
    await expect(rows.nth(0)).toContainText("Variable");
    await expect(rows.nth(1)).toContainText("DIY Letters");
    await expect(rows.nth(1)).toContainText("$1,000");
    await expect(rows.nth(1)).toContainText("Fixed");
  });

  test("the four tiles read the products, the active rules, and the accrued and paid ledger money (paid counts this month only, voided is not owed)", async ({ page }) => {
    await open(page);
    await expect(page.locator("#kProd")).toHaveText("2");
    await expect(page.locator("#kProdVar")).toHaveText("1 with variable pricing");
    await expect(page.locator("#kRules")).toHaveText("3");
    await expect(page.locator("#kAccrued")).toHaveText("$450.00");
    await expect(page.locator("#kPaid")).toHaveText("$90.00");
  });

  // Two reads paint ACTIVE RULES (the product list's sum of rules, and the rule
  // list's own length), and the ledger read repaints it too. Whichever lands last
  // wins. Hold the product read back and make its sum differ from the rule list,
  // so each writer is seen on its own.
  test("ACTIVE RULES shows the rule list's count, and the products' rule count when the product read lands last", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const products = { ...PRODUCTS, items: PRODUCTS.items.map((p) => ({ ...p, active_rules: p.active_rules + 1 })) };
    await open(page, { products: async (route) => { await held; await json(route, products); } });
    await expect(page.locator("#kRules")).toHaveText("3");
    release();
    await expect(page.locator("#kRules")).toHaveText("5");
  });
});

test.describe("Products & Commissions: the product editor's own rules", () => {
  async function newProduct(page) {
    await page.locator("#addProdBtn").click();
    await expect(page.locator("#editor")).toBeVisible();
  }

  test("a name is required, and a minimum above the maximum or a default outside the band is refused before anything is sent", async ({ page }) => {
    const { productWrites } = await open(page);
    const alerts = [];
    page.on("dialog", async (d) => { alerts.push(d.message()); await d.accept(); });
    await newProduct(page);

    await page.locator("#edSave").click();
    await expect.poll(() => alerts.length).toBe(1);
    expect(alerts[0]).toBe("Product name is required.");

    await page.locator("#p_name").fill("Capital Blueprint");
    await page.locator("#p_var").click();
    await page.locator("#p_price").fill("3000");
    await page.locator("#p_min").fill("5000");
    await page.locator("#p_max").fill("2000");
    await page.locator("#edSave").click();
    await expect.poll(() => alerts.length).toBe(2);
    expect(alerts[1]).toBe("Minimum cannot exceed maximum.");

    await page.locator("#p_min").fill("2000");
    await page.locator("#p_max").fill("2500");
    await page.locator("#edSave").click();
    await expect.poll(() => alerts.length).toBe(3);
    expect(alerts[2]).toBe("Default price must sit inside the min/max band.");

    // The other side of the band: a default under the minimum.
    await page.locator("#p_min").fill("3500");
    await page.locator("#p_max").fill("4000");
    await page.locator("#edSave").click();
    await expect.poll(() => alerts.length).toBe(4);
    expect(alerts[3]).toBe("Default price must sit inside the min/max band.");
    expect(productWrites).toEqual([]);
  });

  test("a valid new product sends create with the typed name, price, band and the Variable switch", async ({ page }) => {
    const { productWrites } = await open(page);
    await newProduct(page);
    await page.locator("#p_name").fill("Capital Blueprint");
    await page.locator("#p_cat").selectOption("Partner");
    await page.locator("#p_var").click();
    await page.locator("#p_price").fill("3000");
    await page.locator("#p_min").fill("2500");
    await page.locator("#p_max").fill("4000");
    await page.locator("#edSave").click();
    await expect.poll(() => productWrites.length).toBe(1);
    expect(productWrites[0]).toMatchObject({
      action: "create", name: "Capital Blueprint", category: "Partner",
      default_price: 3000, min_price: 2500, max_price: 4000, price_is_variable: true,
    });
    await expect(page.locator("#prodBody tr[data-p]")).toHaveCount(3);
  });

  test("editing a fixed-price product sends save with its code and the price as both ends of the band", async ({ page }) => {
    const { productWrites } = await open(page);
    await page.locator('#prodBody tr[data-p="diy_letters"]').click();
    await expect(page.locator("#editor")).toBeVisible();
    await page.locator("#p_price").fill("1200");
    await page.locator("#p_cat").selectOption("Funding");
    await page.locator("#edSave").click();
    await expect.poll(() => productWrites.length).toBe(1);
    expect(productWrites[0]).toMatchObject({
      action: "save", code: "diy_letters", category: "Funding",
      default_price: 1200, min_price: 1200, max_price: 1200, price_is_variable: false,
    });
  });
});

test.describe("Products & Commissions: SLO connections", () => {
  test("the tab lists each connection with its ids and product, and counts only the ones that are on", async ({ page }) => {
    await open(page);
    await page.locator("#sloTab").click();
    const rows = page.locator("#sloBody tr[data-slo]");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Course SLO");
    await expect(rows.nth(0)).toContainText("funnel-1");
    await expect(rows.nth(0)).toContainText("cf-prod-1");
    await expect(rows.nth(0)).toContainText("Funding Bundle");
    await expect(rows.nth(0)).toContainText("On");
    await expect(rows.nth(1)).toContainText("Off");
    await expect(page.locator("#sloLiveCount")).toHaveText("1");
    await expect(page.locator("#sloLiveHint")).toHaveText("1 map is on. A signed paid webhook writes that Fundhub product.");
  });

  test("Add connection opens an empty form; each missing box is named and nothing is sent until all four are filled", async ({ page }) => {
    const { sloWrites } = await open(page);
    await page.locator("#sloTab").click();
    await page.locator("#addSloBtn").click();
    await expect(page.locator("#sloForm")).toBeVisible();
    await expect(page.locator("#slo_name")).toHaveValue("");
    const alerts = [];
    page.on("dialog", async (d) => { alerts.push(d.message()); await d.accept(); });
    await page.locator("#sloSave").click();
    await expect.poll(() => alerts.length).toBe(1);
    await page.locator("#slo_name").fill("Book SLO");
    await page.locator("#sloSave").click();
    await expect.poll(() => alerts.length).toBe(2);
    await page.locator("#slo_funnel").fill("funnel-9");
    await page.locator("#sloSave").click();
    await expect.poll(() => alerts.length).toBe(3);
    await page.locator("#slo_cfprod").fill("cf-prod-9");
    await page.locator("#sloSave").click();
    await expect.poll(() => alerts.length).toBe(4);
    expect(alerts).toEqual([
      "This connection needs a name.", "Paste the ClickFunnels funnel ID.",
      "Paste the ClickFunnels product ID.", "Pick a Fundhub product.",
    ]);
    expect(sloWrites).toEqual([]);
  });

  test("Save connection sends the typed ids, the picked product and the On switch, then re-reads the list", async ({ page }) => {
    const { sloWrites } = await open(page);
    await page.locator("#sloTab").click();
    await page.locator("#addSloBtn").click();
    await page.locator("#slo_name").fill("Book SLO");
    await page.locator("#slo_funnel").fill("funnel-9");
    await page.locator("#slo_cfprod").fill("cf-prod-9");
    await page.locator("#slo_product").selectOption("diy_letters");
    await page.locator("#slo_active").click();
    await page.locator("#sloSave").click();
    await expect.poll(() => sloWrites.length).toBe(1);
    expect(sloWrites[0]).toEqual({
      name: "Book SLO", cf_funnel_id: "funnel-9", cf_product_id: "cf-prod-9", product_code: "diy_letters", active: false,
    });
    await expect(page.locator("#sloForm")).toBeHidden();
  });

  test("clicking a row opens it for editing and Save sends that row's id, so it updates instead of adding", async ({ page }) => {
    const { sloWrites } = await open(page);
    await page.locator("#sloTab").click();
    await page.locator('#sloBody tr[data-slo="5c000000-0000-4000-8000-000000000001"]').click();
    await expect(page.locator("#slo_name")).toHaveValue("Course SLO");
    await expect(page.locator("#slo_funnel")).toHaveValue("funnel-1");
    await expect(page.locator("#slo_cfprod")).toHaveValue("cf-prod-1");
    await page.locator("#slo_funnel").fill("funnel-1b");
    await page.locator("#sloSave").click();
    await expect.poll(() => sloWrites.length).toBe(1);
    expect(sloWrites[0]).toMatchObject({
      id: "5c000000-0000-4000-8000-000000000001", name: "Course SLO", cf_funnel_id: "funnel-1b", cf_product_id: "cf-prod-1",
    });
  });
});
