// Client portal: the six Unlock buttons and the Unlock pay now button
// (finish-the-853, batch 01, generation 2).
//
// WHAT THIS IS. A practice test. In the shipped page no product has a checkout link,
// so a real client never sees an Unlock button (the page says so itself in paintTile
// and in openUnlock). The page has a written rule for the day a link is added: the
// Unlock button appears for exactly the products that have one, it opens the modal for
// that product, and Unlock pay now sends the client to that product's own link. These
// tests give products a fake link the way a later change would (the PRODUCTS table
// gets a checkoutUrl) and judge that rule in a real page. They also judge the shipped
// state: no link, no button.
//
// NO BACKEND: page.route() answers /api/** and the fake pay address. Nobody is charged.
import { test, expect } from "@playwright/test";
import { CLIENT_ID, json } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const CLIENT = { ok: true, staff: { id: CLIENT_ID, client_id: CLIENT_ID, name: "Dana Whitfield", email: "dana@example.com", role: "client", org_id: "org-1", status: "active" } };

const SUMMARY = {
  ok: true, prequal_amount: null, prequal_display: null, soft_pull_complete: false,
  scores: { experian: null, equifax: null, transunion: null, experian_business: null },
  documents: [], payments: [],
};

// The six products, as the page words them (client-portal.html PRODUCTS).
const PRODUCTS = {
  SOFT_PULL: { name: "UnderwriteIQ soft-pull assessment", price: "$32" },
  FUNDING_DFY: { name: "Funding, done-for-you", price: "On your call" },
  REPAIR_DFY: { name: "Capital readiness, done-for-you", price: "On your call" },
  REPAIR_TRIAL: { name: "Capital readiness test run (first round, done for you)", price: "On your call" },
  UWIQ_DELIVERABLES: { name: "Capital Blueprint", price: "On your call" },
  FUNDING_MASTERY: { name: "Capital Academy", price: "On your call" },
};
const KEYS = Object.keys(PRODUCTS);
const PAY_HOST = "https://pay.example.test";
const linkFor = (key) => `${PAY_HOST}/${key.toLowerCase()}`;
const ALL_LINKS = Object.fromEntries(KEYS.map((key) => [key, linkFor(key)]));

/* Open the portal. `links` is { PRODUCT_KEY: "https://..." }: each is put on that product's
   checkoutUrl the moment the page defines its PRODUCTS table, the way a later change would. */
async function openPortal(page, { links = {}, entitlements = [], summary = {} } = {}) {
  const pay = { hits: [], button: null };
  // The pay button as the client sees it, reported out of the page every time it changes (the page
  // is gone once it has left for the pay address).
  await page.exposeFunction("__reportPayButton", (state) => { pay.button = state; });
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", "client");
    localStorage.removeItem("fh_demo");
    document.addEventListener("DOMContentLoaded", function () {
      var go = document.getElementById("um-go");
      if (!go) return;
      var tell = function () { window.__reportPayButton({ text: go.textContent, disabled: go.disabled }); };
      new MutationObserver(tell).observe(go, { childList: true, characterData: true, subtree: true, attributes: true });
    });
    var table;
    Object.defineProperty(window, "PRODUCTS", {
      configurable: true,
      get() { return table; },
      set(v) {
        for (var k of Object.keys(s.links)) if (v && v[k]) v[k].checkoutUrl = s.links[k];
        table = v;
      },
    });
  }, { links });
  await page.route(`${PAY_HOST}/**`, async (route) => {
    pay.hits.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>pay page</body></html>" });
  });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session") || /\/api\/session\b/.test(url)) return json(route, CLIENT);
    if (url.includes("/api/read/portal-summary")) return json(route, { ...SUMMARY, ...summary });
    if (url.includes("entitlement")) return json(route, { ok: true, items: entitlements });
    return json(route, { ok: true, items: [] });
  });
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await page.waitForLoadState("domcontentloaded");
  // The tiles are painted once the entitlement read lands; wait for the first tile to say Locked.
  await expect(page.locator('[data-tile="SOFT_PULL"] .lockrow')).toBeVisible();
  return pay;
}

const unlock = (page, key) => page.locator(`[data-tile="${key}"] [data-unlock="${key}"]`);

test.describe("client portal: Unlock buttons (practice test with fake checkout links)", () => {
  test("as shipped no product has a checkout link: no tile shows an Unlock button and every tile still offers Talk to an advisor", async ({ page }) => {
    await openPortal(page);
    for (const key of KEYS) {
      await expect(page.locator(`[data-tile="${key}"] .lockrow`)).toContainText("Locked");
      await expect(unlock(page, key), key).toBeHidden();
      await expect(page.locator(`[data-tile="${key}"] [data-book]`), key).toBeVisible();
    }
    await expect(page.locator("#unlock-modal")).not.toHaveClass(/on/);
  });

  test("a product with a checkout link shows its Unlock button, and pressing it opens the modal with that product's name, price and pay button", async ({ page }) => {
    await openPortal(page, { links: ALL_LINKS });
    for (const key of KEYS) {
      await expect(unlock(page, key), key).toBeVisible();
      await expect(unlock(page, key), key).toHaveText("Unlock");
      await unlock(page, key).click();
      await expect(page.locator("#unlock-modal"), key).toHaveClass(/on/);
      await expect(page.locator("#um-title"), key).toHaveText(PRODUCTS[key].name);
      await expect(page.locator("#um-price"), key).toHaveText(PRODUCTS[key].price);
      await expect(page.locator("#um-desc"), key).not.toHaveText("");
      await expect(page.locator("#um-go"), key).toBeVisible();
      await expect(page.locator("#um-go"), key).toHaveText(`Unlock — ${PRODUCTS[key].price}`);
      await expect(page.locator("#um-talk"), key).toHaveText("Talk to an advisor first");
      await expect(page.locator("#um-pay-msg"), key).toBeHidden();
      await page.locator("#um-x").click();
      await expect(page.locator("#unlock-modal"), key).not.toHaveClass(/on/);
    }
  });

  test("only the products that have a link show the button: one link, one Unlock button", async ({ page }) => {
    await openPortal(page, { links: { FUNDING_DFY: linkFor("FUNDING_DFY") } });
    await expect(unlock(page, "FUNDING_DFY")).toBeVisible();
    for (const key of KEYS.filter((k) => k !== "FUNDING_DFY")) {
      await expect(unlock(page, key), key).toBeHidden();
    }
  });

  test("a product the client already owns shows View status, not Unlock, even when it has a link", async ({ page }) => {
    await openPortal(page, {
      links: ALL_LINKS,
      entitlements: [{ entitlement_code: "metro2-letter-pack", active: true }],
    });
    const owned = page.locator('[data-tile="REPAIR_DFY"]');
    await expect(owned.locator(".lockrow")).toHaveText(/Included/i);
    await expect(owned.locator("[data-unlock]")).toHaveCount(0);
    await expect(owned.locator("[data-status='REPAIR_DFY']")).toHaveText(/View status/i);
    // The products the client does not own still sell.
    await expect(unlock(page, "FUNDING_DFY")).toBeVisible();
    await expect(unlock(page, "SOFT_PULL")).toBeVisible();
  });

  test("a soft pull that already ran is not sold again, even when the product has a link", async ({ page }) => {
    await openPortal(page, { links: ALL_LINKS, summary: { soft_pull_complete: true } });
    await expect(page.locator('[data-tile="SOFT_PULL"] [data-unlock]')).toHaveCount(0);
    await expect(page.locator('[data-tile="SOFT_PULL"] .lockrow')).not.toContainText("Locked");
    await expect(unlock(page, "FUNDING_DFY")).toBeVisible();
  });
});

test.describe("client portal: Unlock modal, Unlock pay now (practice test with fake checkout links)", () => {
  for (const key of KEYS) {
    test(`Unlock pay now for ${key} goes to that product's own checkout link and says it is opening`, async ({ page }) => {
      const pay = await openPortal(page, { links: ALL_LINKS });
      await unlock(page, key).click();
      await page.locator("#um-go").click({ noWaitAfter: true });
      await page.waitForURL(linkFor(key));
      // One request, to this product's own link. The button said it was opening and was already off.
      expect(pay.hits).toEqual([linkFor(key)]);
      expect(pay.button).toEqual({ text: "Opening secure checkout…", disabled: true });
    });
  }

  test("View status opens the same modal with Close, and Close never sends the client to a checkout link", async ({ page }) => {
    const pay = await openPortal(page, {
      links: ALL_LINKS,
      entitlements: [{ entitlement_code: "metro2-letter-pack", active: true }],
    });
    await page.locator("[data-tile='REPAIR_DFY'] [data-status='REPAIR_DFY']").click();
    await expect(page.locator("#unlock-modal")).toHaveClass(/on/);
    await expect(page.locator("#um-price")).toHaveText("Included");
    await expect(page.locator("#um-go")).toHaveText("Close");
    await page.locator("#um-go").click();
    await expect(page.locator("#unlock-modal")).not.toHaveClass(/on/);
    await page.waitForTimeout(250);
    expect(pay.hits).toEqual([]);
    expect(page.url()).toContain("/app/client-portal.html");
  });

  test("Escape closes the Unlock modal and sends nobody to a checkout link", async ({ page }) => {
    const pay = await openPortal(page, { links: ALL_LINKS });
    await unlock(page, "SOFT_PULL").click();
    await expect(page.locator("#unlock-modal")).toHaveClass(/on/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#unlock-modal")).not.toHaveClass(/on/);
    await page.waitForTimeout(250);
    expect(pay.hits).toEqual([]);
  });
});
