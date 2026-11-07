import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openScreen, json, OWNER, CLOSER, CLIENT_ID, CLIENT_ROW } from "./harness.mjs";
import { PROPERTY_CONSENT_TEXT, PROPERTY_CONSENT_VERSION } from "../src/finance/crs-property-contract.mjs";
const evidence = path.resolve("ops/workflows/crs-property-setup-2026-11-06-evidence");
const consent = { text: PROPERTY_CONSENT_TEXT, version: PROPERTY_CONSENT_VERSION };
const empty = { ok: true, status: "empty", identityReady: true, connectionReady: true, mayOrder: true, consent };
const full = { ok: true, status: "completed", mayOrder: false, environment: "production", providerRequestId: "11111111-1111-4111-8111-111111111111", checkedAt: "2026-11-06T23:00:00Z",
  report: { summary: { ownedPropertyCount: 1, foreclosureEventCount: 0 }, properties: [{ borrowerOwnedAsset: true,
    address: { line1: "100 Synthetic Test Way", city: "Test City", state: "AZ", zip: "85001" }, providerCurrentOwners: ["Synthetic Property"], recordedRecentSalePrice: 250000,
    transactions: [{ recordedAt: "2020-01-02", documentType: "Mortgage record", originalLoanAmount: 100000, salePrice: null, lender: "Synthetic Lender" }] }] } };
const handlers = {
  "/api/dashboard/client?": { ok: true, client: CLIENT_ROW, transactions: [], messages: [], tasks: [], crs_results: [], active_blockers: [] },
  "/api/consent/capture": { ok: true, status: { valid: true }, identity: { on_file: true } }
};
async function open(page, property, role = OWNER) {
  return openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}#ccp-view-credit`, role,
    { ...handlers, "/api/finance/property-report": property });
}
async function marked(page, name) {
  fs.mkdirSync(evidence, { recursive: true });
  const group = page.locator("#ccp-property-report"); await group.scrollIntoViewIfNeeded();
  await group.evaluate(el => {
    el.style.position = "relative";
    const caption = document.createElement("p"); caption.dataset.proof = "1";
    caption.textContent = "LOCAL DRAFT · Client Workspace / Credit & inquiries · synthetic data";
    caption.style.cssText = "color:#950909;font-size:13px;background:#fff8a8;padding:8px;margin:0 0 12px"; el.prepend(caption);
    const target = el.querySelector("#ccp-property-order:not([hidden])") || el.querySelector("#ccp-property-state");
    const r = target.getBoundingClientRect(), b = el.getBoundingClientRect();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.dataset.proof = "1";
    svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%"); svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible";
    const x = Math.min(el.clientWidth - 24, r.left - b.left + r.width - 12), y = r.top - b.top + 10;
    svg.innerHTML = `<circle cx="${x}" cy="${y}" r="14" fill="white" stroke="red" stroke-width="3"/><text x="${x}" y="${y + 5}" text-anchor="middle" fill="red" font-size="16">1</text><path d="M${x - 70},${y - 26} L${x - 19},${y - 5} l-14,-15 m14,15 l-20,2" fill="none" stroke="#e5ad00" stroke-width="5"/>`;
    el.appendChild(svg);
  });
  await group.screenshot({ path: path.join(evidence, `${name}-MARKED.png`) });
  await group.evaluate(el => { el.querySelectorAll("[data-proof]").forEach(v => v.remove()); el.style.position = ""; });
}
for (const width of [1440, 390]) {
  test(`property report has loading, empty, failed and full states at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let release; const held = new Promise(resolve => { release = resolve; });
    await open(page, async route => { await held; return json(route, empty); });
    await expect(page.locator("#ccp-property-state")).toContainText("Loading");
    await marked(page, `loading-${width}`); release();
    await expect(page.locator("#ccp-property-state")).toContainText("No property report");
    await expect(page.getByRole("button", { name: "Run property report", exact: true })).toBeDisabled();
    await marked(page, `empty-${width}`);
    await page.route("**/api/finance/property-report?*", route => json(route, { ok: false, error: "property_service_unavailable" }, 503));
    await page.getByRole("button", { name: "Reload saved report", exact: true }).click();
    await expect(page.locator("#ccp-property-state")).toContainText("could not answer"); await marked(page, `error-${width}`);
    await page.route("**/api/finance/property-report?*", route => json(route, full));
    await page.getByRole("button", { name: "Reload saved report", exact: true }).click();
    await expect(page.locator("#ccp-property-result")).toContainText("Foreclosure activity events: 0");
    await page.locator("#ccp-property-result summary").click();
    await expect(page.locator("#ccp-property-result")).toContainText("Original recorded loan amount: $100,000");
    await expect(page.locator("#ccp-property-result")).toContainText("current equity and current valuation: unknown");
    await marked(page, `full-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator("#ccp-property-refresh").boundingBox()).height).toBeGreaterThanOrEqual(44);
  });
}
test("opening and reloading only read; a separate permission and one click make one order", async ({ page }) => {
  const posts = [];
  await open(page, route => {
    if (route.request().method() === "POST") { posts.push(route.request().postDataJSON()); return json(route, full); }
    return json(route, empty);
  });
  await expect(page.locator("#ccp-property-order")).toBeDisabled(); expect(posts).toHaveLength(0);
  await page.getByRole("button", { name: "Reload saved report", exact: true }).click(); expect(posts).toHaveLength(0);
  await expect(page.locator("#ccp-property-consent-text")).toHaveText(PROPERTY_CONSENT_TEXT);
  await page.locator("#ccp-property-consent").check();
  await page.getByRole("button", { name: "Run property report", exact: true }).click();
  await expect(page.locator("#ccp-property-result")).toContainText("Borrower-owned properties: 1");
  expect(posts).toHaveLength(1); expect(posts[0].consent_version).toBe(PROPERTY_CONSENT_VERSION);
  expect(Object.keys(posts[0]).sort()).toEqual(["client_id", "consent_accepted", "consent_version", "operation_id"]);
});
test("closer never sees property report controls or makes property reads", async ({ page }) => {
  let reads = 0; await open(page, route => { reads++; return json(route, empty); }, CLOSER);
  await expect(page.locator("#ccp-property-report")).toBeHidden(); expect(reads).toBe(0);
});
test("a switched session discards the pending private property response", async ({ page }) => {
  let release; const held = new Promise(resolve => { release = resolve; });
  await open(page, async route => { await held; return json(route, full); });
  await expect(page.locator("#ccp-property-state")).toContainText("Loading");
  await page.evaluate(() => { localStorage.setItem("fh_token", "synthetic-other-session"); dispatchEvent(new Event("storage")); });
  release(); await expect(page.locator("#ccp-property-report")).toBeHidden();
  await expect(page.locator("#ccp-property-result")).toBeEmpty();
});
test("switching clients during a held order resets permission and old completion cannot release the new order", async ({ page }) => {
  const clientB = "bbbbbbbb-2222-4222-8222-222222222222";
  let releaseA, releaseB;
  const heldA = new Promise(resolve => { releaseA = resolve; });
  const heldB = new Promise(resolve => { releaseB = resolve; });
  const posts = [];
  const fullB = { ...full, report: { ...full.report, summary: { ...full.report.summary, ownedPropertyCount: 2 } } };
  await open(page, async route => {
    if (route.request().method() === "GET") return json(route, empty);
    const request = route.request().postDataJSON(); posts.push(request);
    if (request.client_id === CLIENT_ID) { await heldA; return json(route, full); }
    await heldB; return json(route, fullB);
  });
  const permission = page.locator("#ccp-property-consent");
  const order = page.locator("#ccp-property-order");
  await expect(permission).toBeEnabled(); await permission.check(); await order.click();
  await expect(permission).toBeDisabled(); await expect.poll(() => posts.length).toBe(1);
  await page.evaluate(id => {
    const url = new URL(location.href); url.searchParams.set("client_id", id); history.replaceState(null, "", url);
    document.dispatchEvent(new CustomEvent("ccp:client", { detail: { id, first_name: "Synthetic", last_name: "Client B", custom_fields: {} } }));
  }, clientB);
  await expect(page.locator("#ccp-property-state")).toContainText("No property report");
  await expect(permission).toBeEnabled(); await expect(permission).not.toBeChecked();
  await expect(order).toBeDisabled(); expect(posts).toHaveLength(1);
  await permission.check(); await expect(order).toBeEnabled(); await order.click();
  await expect(permission).toBeDisabled(); await expect(order).toBeDisabled(); await expect.poll(() => posts.length).toBe(2);
  const oldCompletion = page.waitForResponse(response => response.request().method() === "POST"
    && response.url().endsWith("/api/finance/property-report") && response.request().postDataJSON().client_id === CLIENT_ID);
  releaseA(); await oldCompletion;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#ccp-property-state")).toContainText("Requesting this client's property report");
  await expect(permission).toBeDisabled(); await expect(order).toBeDisabled();
  await expect(page.locator("#ccp-property-result")).toBeEmpty(); expect(posts).toHaveLength(2);
  releaseB(); await expect(page.locator("#ccp-property-result")).toContainText("Borrower-owned properties: 2");
  await expect(permission).not.toBeChecked();
  expect(posts.map(request => request.client_id)).toEqual([CLIENT_ID, clientB]);
  expect(posts.every(request => request.consent_accepted === true && request.consent_version === PROPERTY_CONSENT_VERSION)).toBe(true);
});
