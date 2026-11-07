import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EVIDENCE = join(process.cwd(), "ops/workflows/build-evidence/company-cash");
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000011";
const OTHER_ACCOUNT_ID = "00000000-0000-4000-8000-000000000012";
const ITEM_ID = "00000000-0000-4000-8000-000000000013";
const TX_ID = "00000000-0000-4000-8000-000000000014";
const CRS_ID = "00000000-0000-4000-8000-000000000015";
const AD_ID = "00000000-0000-4000-8000-000000000016";

const emptyBank = (configured = true) => ({ ok: true, configured, realtime_balance_available: false, items: [], accounts: [], transactions: [] });
const emptyCash = () => ({ ok: true, summary: {
  month: "2026-11-01", bank_posted_cents: null, bank_available_cents: null, bank_balance_as_of: null,
  crs_reserve_cents: null, crs_fulfilled_pull_count: 2, crs_unpriced_pull_count: 1,
  ad_approved_unpaid_cents: 0, tech_due_cents: 0, meta_spend_cents: null,
  processor_receipts_cents: null, known_remaining_cents: null, available_cents: null,
  missing: ["business_bank_balance", "crs_invoice", "ad_review", "tech_review"]
}, account: null, obligations: [], recurring_candidates: [] });
const fullBank = (realtime_balance_available = true) => ({ ok: true, configured: true, realtime_balance_available,
  items: [{ id: ITEM_ID, institution_name: "Arizona Financial", last_synced_at: "2026-11-02T12:00:00Z" }],
  accounts: [
    { id: ACCOUNT_ID, company_plaid_item_id: ITEM_ID, name: "Fundhub Business Checking", mask: "1234", account_type: "depository", account_subtype: "checking", holder_category: "business", currency_code: "USD", selected_for_cash: true, current_balance_cents: 1000000, available_balance_cents: 990000, balance_as_of: "2026-11-02T12:00:00Z" },
    { id: OTHER_ACCOUNT_ID, company_plaid_item_id: ITEM_ID, name: "Business Savings", mask: "5678", account_type: "depository", account_subtype: "savings", holder_category: "business", currency_code: "USD", selected_for_cash: false, current_balance_cents: 300000, available_balance_cents: 300000, balance_as_of: "2026-11-02T12:00:00Z" }
  ], transactions: [
    { id: TX_ID, company_bank_account_id: ACCOUNT_ID, amount_cents: -10000, posted_on: "2026-11-02", merchant_name: "CRS", owner_category: null, is_pending: false }
  ] });
const fullCash = () => ({ ok: true, summary: {
  month: "2026-11-01", bank_posted_cents: 1000000, bank_available_cents: 990000,
  bank_balance_as_of: "2026-11-02T12:00:00Z", crs_reserve_cents: 10000,
  crs_fulfilled_pull_count: 2, crs_unpriced_pull_count: 0, crs_priced_pull_cents: 790,
  ad_approved_unpaid_cents: 50000, tech_due_cents: 15000, meta_spend_cents: 41000,
  processor_receipts_cents: null, known_remaining_cents: 925000, available_cents: 925000, missing: []
}, account: { id: ACCOUNT_ID, name: "Fundhub Business Checking", mask: "1234", institution_name: "Arizona Financial" },
  obligations: [
    { id: CRS_ID, kind: "crs", label: "CRS November invoice", amount_cents: 10000, due_on: "2026-11-12", billing_month: "2026-11-01", source_ref: "CRS-NOV", invoice_verified_at: "2026-11-02T12:00:00Z", invoice_covers_through_on: "2026-11-02", status: "approved", paid_transaction_posted: false },
    { id: AD_ID, kind: "ad", label: "November ad funding", amount_cents: 50000, due_on: "2026-11-10", billing_month: "2026-11-01", status: "approved", paid_transaction_posted: false },
    { id: "00000000-0000-4000-8000-000000000017", kind: "tech", label: "Software budget", amount_cents: 15000, due_on: "2026-11-20", billing_month: "2026-11-01", status: "approved", paid_transaction_posted: false }
  ], recurring_candidates: [{ merchantDisplay: "Observed software charge", typicalAmountCents: -2500, cadence: "monthly", is_confirmed_tech: false }] });

const reply = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
async function open(page, { bank = fullBank(), cash = fullCash(), bankError = false, cashGate = null,
  bankPost = null, bankGet = null, matchLookup = null, authSession = null } = {}) {
  const calls = [];
  const passkeyCalls = [];
  Object.defineProperty(calls, "passkeyCalls", { value: passkeyCalls });
  await page.addInitScript(() => localStorage.setItem("fh_token", "test-owner-session"));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/auth/passkey") {
      passkeyCalls.push(route.request().postDataJSON());
      return reply(route, { ok: true, enrolled: true, assured: true, recovery_required: false });
    }
    if (path === "/api/auth/session") return authSession ? authSession(route) : reply(route, { ok: true, staff: { id: "00000000-0000-4000-8000-000000000099", role: "owner", name: "Owner", org_id: "00000000-0000-4000-8000-000000000098" } });
    if (path === "/api/health") return reply(route, { ok: true, db: "up", migrations: 548 });
    if (path === "/api/owner/company-bank") {
      if (route.request().method() === "GET") {
        if (url.searchParams.has("match_obligation_id")) {
          if (matchLookup) return matchLookup(route, url.searchParams);
          const obligationId = url.searchParams.get("match_obligation_id");
          const obligation = cash.obligations.find(row => row.id === obligationId);
          const selected = bank.accounts.find(row => row.selected_for_cash === true);
          const transactions = obligation && selected ? bank.transactions.filter(row =>
            row.company_bank_account_id === selected.id && !row.is_pending && row.posted_on &&
            row.amount_cents === -obligation.amount_cents) : [];
          return reply(route, { ok: true, obligation_id: obligationId, transactions, has_more: false,
            next_before_posted_on: null, next_before_id: null });
        }
        if (bankGet) return bankGet(route, url);
        return bankError ? reply(route, { ok: false }, 503) : reply(route, bank);
      }
      const body = JSON.parse(route.request().postData() || "{}"); calls.push({ path, body });
      if (bankPost) return bankPost(route, body);
      if (body.action === "link_token") return reply(route, { ok: true, linkToken: "test-link-token" });
      return reply(route, { ok: true, account: { id: ACCOUNT_ID } });
    }
    if (path === "/api/owner/company-cash") {
      if (route.request().method() === "GET") {
        if (cashGate) await cashGate.promise;
        return reply(route, cash);
      }
      const body = JSON.parse(route.request().postData() || "{}"); calls.push({ path, body });
      return reply(route, { ok: true, obligation: { id: CRS_ID } });
    }
    return reply(route, { ok: true });
  });
  await page.goto("/app/company-cash.html", { waitUntil: "domcontentloaded" });
  return calls;
}
async function markedScreenshot(page, name, target, caption) {
  mkdirSync(EVIDENCE, { recursive: true });
  const locator = page.locator(target);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No review target for ${name}: ${target}`);
  await page.evaluate(({ box, caption, name }) => {
    const old = document.querySelector("#ccReviewMark"); if (old) old.remove();
    const wrap = document.createElement("div"); wrap.id = "ccReviewMark";
    wrap.style.cssText = `position:fixed;left:${Math.max(6, box.x - 7)}px;top:${Math.max(6, box.y - 7)}px;width:${Math.min(innerWidth - box.x - 6, box.width + 14)}px;height:${box.height + 14}px;border:4px solid #df2525;border-radius:18px;z-index:999999;pointer-events:none;box-shadow:0 0 0 2px #fff;`;
    const arrow = document.createElement("div"); arrow.textContent = "↘";
    arrow.style.cssText = "position:absolute;right:8px;top:-42px;color:#f6cd2e;font-size:42px;font-weight:900;text-shadow:0 2px 2px #000;";
    const label = document.createElement("div"); label.textContent = caption;
    label.style.cssText = (innerWidth < 600
      ? name.startsWith("full-") ? "position:absolute;left:0;top:-50px;" : "position:fixed;right:8px;bottom:8px;"
      : "position:absolute;left:calc(100% + 12px);top:4px;") +
      "background:#fff7cd;color:#1f2020;padding:3px 8px;border:1px solid #e5ba12;border-radius:5px;font:700 13px/1.2 sans-serif;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;text-overflow:ellipsis;";
    wrap.appendChild(arrow); wrap.appendChild(label); document.body.appendChild(wrap);
  }, { box, caption, name });
  await page.screenshot({ path: join(EVIDENCE, name + ".png") });
  await page.locator("#ccReviewMark").evaluate(node => node.remove());
}

for (const width of [1440, 390]) {
  test(`company cash ${width}: loading, empty, error, and full states are honest`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let release;
    const gate = { promise: new Promise(resolve => { release = resolve; }) };
    await open(page, { cashGate: gate });
    await expect(page.locator("#ccLoading")).toBeVisible();
    await markedScreenshot(page, `loading-${width}`, "#ccLoading .cc-skeleton-hero", "Loading company cash");
    release();
    await expect(page.locator("#ccAvailable")).toHaveText("$9,250.00");
    await expect(page.locator("#ccBankCash")).toHaveText("$10,000.00");
    await expect(page.locator("#ccProcessor")).toContainText("Not reconciled");
    await markedScreenshot(page, `full-${width}`, "#ccAvailable", "Bank current balance less tracked reserves");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    await page.unroute("**/api/**");
    await open(page, { bank: emptyBank(false), cash: emptyCash() });
    await expect(page.locator("#ccEmpty")).toBeVisible();
    await page.locator("#ccEmptyAction").click();
    await expect(page.locator("#ccBankNotConfigured")).toBeVisible();
    await expect(page.locator("#ccConnect")).toBeHidden();
    await markedScreenshot(page, `empty-${width}`, "#ccBankNotConfigured", "Plaid setup pending; no dead connect control");

    await page.unroute("**/api/**");
    await open(page, { bankError: true });
    await expect(page.locator("#ccError")).toBeVisible();
    await markedScreenshot(page, `error-${width}`, "#ccError", "Bank read failed; retry offered");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("owner controls save reviewed amounts, match only posted debits, and confirm actual Plaid account", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { window.Plaid = { create: config => ({ open() { config.onSuccess("public-test-token", {
    institution: { name: "Arizona Financial" }, accounts: [{ id: "plaid-business-checking", name: "Business Checking", type: "depository", subtype: "checking", mask: "9999" }]
  }); } }) }; });
  const calls = await open(page);
  await expect(page.locator("#ccFull")).toBeVisible();
  await page.locator("#ccRefreshBalance").click();
  await expect.poll(() => calls.at(-1)?.body.action).toBe("refresh_balance");
  expect(calls.at(-1).body.item_id).toBe(ITEM_ID);
  await page.locator("#ccAddObligation").click();
  await page.locator("#ccKind").selectOption("tech");
  await page.locator("#ccStatus").selectOption("approved");
  await page.locator("#ccLabel").fill("Confirmed software bill");
  await page.locator("#ccAmount").fill("");
  await page.locator("#ccBillingMonth").fill("2026-11");
  await page.locator("#ccSaveObligation").click();
  await expect(page.locator("#ccFormError")).toContainText("Enter the exact amount");
  await page.locator("#ccAmount").fill("0");
  await page.locator("#ccSaveObligation").click();
  await expect(page.locator("#ccObligationDialog")).toBeHidden();
  expect(calls.at(-1).body.obligation).toMatchObject({ kind: "tech", status: "approved", amount_cents: 0, billing_month: "2026-11-01" });

  await page.locator("#ccAddObligation").click();
  await page.locator("#ccKind").selectOption("crs");
  await page.locator("#ccLabel").fill("Verified CRS invoice");
  await page.locator("#ccAmount").fill("125.00");
  await page.locator("#ccBillingMonth").fill("2026-11");
  await page.locator("#ccSourceRef").fill("CRS-125");
  await page.locator("#ccInvoiceVerified").check();
  await page.locator("#ccSaveObligation").click();
  await expect(page.locator("#ccFormError")).toContainText("covered-through date");
  await page.locator("#ccInvoiceCoverage").fill("2026-11-02");
  await page.locator("#ccSaveObligation").click();
  await expect(page.locator("#ccObligationDialog")).toBeHidden();
  expect(calls.at(-1).body.obligation).toMatchObject({ kind: "crs", invoice_verified: true,
    invoice_covers_through_on: "2026-11-02", amount_cents: 12500, source_ref: "CRS-125" });

  await page.getByRole("button", { name: "Review as tech bill" }).click();
  await expect(page.locator("#ccAmount")).toHaveValue("");
  await expect(page.locator("#ccLabel")).toHaveValue("");
  await page.locator("#ccCancelObligation").click();

  await page.getByRole("button", { name: "Match payment" }).first().click();
  await page.locator(`input[name="ccPayment"][value="${TX_ID}"]`).check();
  await page.locator("#ccSaveMatch").click();
  await expect.poll(() => calls.at(-1)?.body.action).toBe("match_payment");
  expect(calls.at(-1).body).toMatchObject({ action: "match_payment", transaction_id: TX_ID, obligation_id: CRS_ID });
  await expect(page.locator("#ccMatchDialog")).toBeHidden();

  await page.getByLabel("Category for CRS").selectOption("crs");
  await page.getByRole("button", { name: "Save tag" }).click();
  await expect.poll(() => calls.at(-1)?.body.action).toBe("tag_transaction");
  expect(calls.at(-1).body).toMatchObject({ action: "tag_transaction", transaction_id: TX_ID, category: "crs" });
  await expect(page.locator("#ccMessage")).toHaveText("Transaction tag saved.");

  await page.getByRole("button", { name: "Use for company cash" }).click();
  await page.locator(`input[name="ccAccount"][value="${OTHER_ACCOUNT_ID}"]`).check();
  await page.locator("#ccAccountConfirm").check();
  await page.locator("#ccSaveAccount").click();
  await expect.poll(() => calls.at(-1)?.body.action).toBe("select_account");
  expect(calls.at(-1).body).toMatchObject({ action: "select_account", account_id: OTHER_ACCOUNT_ID, confirm_business_account: true });

  await page.locator("#ccBusinessConfirm").check(); await page.locator("#ccReadConsent").check();
  await page.locator("#ccConnect").click();
  await page.locator('input[name="ccAccount"][value="plaid-business-checking"]').check();
  await page.locator("#ccAccountConfirm").check();
  await page.locator("#ccSaveAccount").click();
  await expect.poll(() => calls.at(-1)?.body.action).toBe("exchange");
  expect(calls.at(-1).body).toMatchObject({ action: "exchange", account_id: "plaid-business-checking", confirm_business_account: true, consent: true });
  expect(calls.passkeyCalls.map(call => call.action)).toEqual(["status", "status"]);
  expect(calls.passkeyCalls.every(call => call.target_kind === "company_bank")).toBe(true);
  expect(calls.some(c => c.body.action === "transfer")).toBe(false);
});

test("a failed bank link shows the error and opens no bank window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { window.Plaid = { create() { throw new Error("Plaid should not open"); } }; });
  const calls = await open(page, { bankPost: (route, body) => body.action === "link_token"
    ? reply(route, { ok: false, error: "not_configured" }, 503) : reply(route, { ok: true }) });
  await page.locator("#ccBusinessConfirm").check(); await page.locator("#ccReadConsent").check();
  await page.locator("#ccConnect").click();
  await expect(page.locator("#ccMessage")).toHaveText("Bank connections are not enabled yet.");
  await expect(page.locator("#ccMessage a")).toHaveCount(0);
  expect(calls.map(c => c.body.action)).toEqual(["link_token"]);
});

test("an unavailable live balance stays explicit, and bank labels render as text", async ({ page }) => {
  const malicious = '<img src=x onerror="window.__companyCashInjected=true">';
  const bank = fullBank(false);
  bank.accounts[0].name = malicious;
  bank.transactions[0].merchant_name = malicious;
  const cash = fullCash();
  cash.obligations[0].label = malicious;
  cash.recurring_candidates[0].merchantDisplay = malicious;
  await open(page, { bank, cash });
  await expect(page.locator("#ccBalanceNotReady")).toBeVisible();
  await expect(page.locator("#ccRefreshBalance")).toBeHidden();
  await expect(page.locator("#ccBankAccounts")).toContainText(malicious);
  await expect(page.locator("#ccObligations")).toContainText(malicious);
  await expect(page.locator("#ccTransactions")).toContainText(malicious);
  await expect(page.locator("#ccRecurring")).toContainText(malicious);
  expect(await page.evaluate(() => window.__companyCashInjected === true)).toBe(false);
  expect(await page.locator("#ccFull img").count()).toBe(0);
});

test("a changed owner sign-in stops a late Plaid callback before any exchange", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.addInitScript(() => {
    window.__plaidOpened = false;
    window.Plaid = { create: () => ({ open() { window.__plaidOpened = true; } }) };
  });
  const calls = await open(page, { bankPost: async (route, body) => {
    if (body.action === "link_token") { await gate; return reply(route, { ok: true, linkToken: "late-token" }); }
    return reply(route, { ok: true });
  } });
  await page.locator("#ccBusinessConfirm").check();
  await page.locator("#ccReadConsent").check();
  await page.locator("#ccConnect").click();
  await expect.poll(() => calls.filter(c => c.body.action === "link_token").length).toBe(1);
  await page.evaluate(() => localStorage.setItem("fh_token", "another-owner-session"));
  release();
  await expect(page.locator("#ccErrorText")).toContainText("sign-in changed");
  expect(await page.evaluate(() => window.__plaidOpened)).toBe(false);
  expect(calls.map(c => c.body.action)).toEqual(["link_token"]);
});

test("a sign-in switch scrubs old company data and destroys the open bank window", async ({ page }) => {
  const bank = fullBank();
  bank.accounts[0].name = "Owner A private bank";
  bank.transactions[0].merchant_name = "Owner A private merchant";
  const cash = fullCash();
  cash.obligations[0].label = "Owner A private invoice";
  cash.recurring_candidates[0].merchantDisplay = "Owner A private software";
  await page.addInitScript(() => {
    window.__plaidTest = { opened: 0, exited: 0, destroyed: 0, config: null };
    window.Plaid = { create: config => {
      window.__plaidTest.config = config;
      return {
        open() { window.__plaidTest.opened += 1; },
        exit() { window.__plaidTest.exited += 1; },
        destroy() { window.__plaidTest.destroyed += 1; }
      };
    } };
  });
  const calls = await open(page, { bank, cash });
  await expect(page.locator("#ccFull")).toBeVisible();
  await page.getByRole("button", { name: "Use for company cash" }).click();
  await expect(page.locator(`input[name="ccAccount"][value="${OTHER_ACCOUNT_ID}"]`)).toHaveCount(1);
  await page.locator("#ccCancelAccount").click();
  await page.locator("#ccAddObligation").click();
  await page.locator("#ccLabel").fill("Owner A unsaved private draft");
  await page.locator("#ccAmount").fill("21.43");
  await page.locator("#ccSourceRef").fill("OWNER-A-PRIVATE-REF");
  await page.locator("#ccCancelObligation").click();
  await page.locator("#ccBusinessConfirm").check();
  await page.locator("#ccReadConsent").check();
  await page.locator("#ccConnect").click();
  await expect.poll(() => page.evaluate(() => window.__plaidTest.opened)).toBe(1);
  await page.evaluate(() => localStorage.setItem("fh_token", "different-owner-session"));
  await expect(page.locator("#ccErrorText")).toContainText("sign-in changed");
  const scrubbed = await page.evaluate(() => ({
    markup: document.body.innerHTML,
    draft: document.getElementById("ccLabel").value,
    amount: document.getElementById("ccAmount").value,
    ref: document.getElementById("ccSourceRef").value,
    plaid: { exited: window.__plaidTest.exited, destroyed: window.__plaidTest.destroyed }
  }));
  for (const privateText of ["Owner A private bank", "Owner A private merchant", "Owner A private invoice",
    "Owner A private software", OTHER_ACCOUNT_ID]) expect(scrubbed.markup).not.toContain(privateText);
  expect(scrubbed).toMatchObject({ draft: "", amount: "", ref: "", plaid: { exited: 1, destroyed: 1 } });
  await page.evaluate(() => window.__plaidTest.config.onSuccess("late-public-token", {
    accounts: [{ id: "late-account", name: "Late account", type: "depository" }]
  }));
  expect(calls.map(c => c.body.action)).toEqual(["link_token"]);
  await expect(page.locator("#ccAccountOptions")).toBeEmpty();
});

test("cancel and pagehide remove each Plaid widget without exchanging an account", async ({ page }) => {
  await page.addInitScript(() => {
    window.__plaidTest = { opened: 0, exited: 0, destroyed: 0, configs: [] };
    window.Plaid = { create: config => {
      window.__plaidTest.configs.push(config);
      return {
        open() { window.__plaidTest.opened += 1; },
        exit() { window.__plaidTest.exited += 1; },
        destroy() { window.__plaidTest.destroyed += 1; }
      };
    } };
  });
  const calls = await open(page);
  await page.locator("#ccBusinessConfirm").check();
  await page.locator("#ccReadConsent").check();
  await page.locator("#ccConnect").click();
  await expect.poll(() => page.evaluate(() => window.__plaidTest.opened)).toBe(1);
  await page.evaluate(() => window.__plaidTest.configs[0].onExit(null));
  expect(await page.evaluate(() => window.__plaidTest.destroyed)).toBe(1);
  await page.locator("#ccConnect").click();
  await expect.poll(() => page.evaluate(() => window.__plaidTest.opened)).toBe(2);
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  expect(await page.evaluate(() => ({ exited: window.__plaidTest.exited, destroyed: window.__plaidTest.destroyed })))
    .toEqual({ exited: 1, destroyed: 2 });
  await page.evaluate(() => window.__plaidTest.configs[1].onSuccess("late-token", {
    accounts: [{ id: "late-account", name: "Late account", type: "depository" }]
  }));
  expect(calls.map(c => c.body.action)).toEqual(["link_token", "link_token"]);
  expect(calls.passkeyCalls.map(call => call.action)).toEqual(["status", "status"]);
  expect(calls.some(c => c.body.action === "exchange")).toBe(false);
});

test("cancelling the company account picker never exchanges the Plaid token", async ({ page }) => {
  await page.addInitScript(() => {
    window.Plaid = { create: config => ({ open() { config.onSuccess("cancelled-picker-token", {
      institution: { name: "Arizona Financial" },
      accounts: [{ id: "plaid-business-checking", name: "Business Checking", type: "depository", subtype: "checking", mask: "9999" }]
    }); } }) };
  });
  const calls = await open(page);
  await page.locator("#ccBusinessConfirm").check();
  await page.locator("#ccReadConsent").check();
  await page.locator("#ccConnect").click();
  await expect(page.locator("#ccAccountDialog")).toBeVisible();
  await page.locator("#ccCancelAccount").click();
  await expect(page.locator("#ccAccountDialog")).toBeHidden();
  expect(calls.map(call => call.body.action)).toEqual(["link_token"]);
  expect(calls.passkeyCalls.map(call => call.action)).toEqual(["status"]);
  expect(calls.some(call => call.body.action === "exchange")).toBe(false);
});

test("payment matching reaches an exact posted debit beyond the newest 100 transactions", async ({ page }) => {
  const idFor = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const matches = Array.from({ length: 101 }, (_, index) => ({
    id: idFor(101 - index), posted_on: "2026-11-02", amount_cents: -10000,
    merchant_name: index === 100 ? "Old exact CRS debit" : `Exact debit ${index + 1}`, owner_category: null
  }));
  const lookupCalls = [];
  const calls = await open(page, { matchLookup: (route, query) => {
    lookupCalls.push(Object.fromEntries(query.entries()));
    const before = query.get("before_id");
    const start = before ? matches.findIndex(row => row.id === before) + 1 : 0;
    const transactions = matches.slice(start, start + 25);
    const hasMore = start + transactions.length < matches.length;
    return reply(route, { ok: true, obligation_id: CRS_ID, transactions, has_more: hasMore,
      next_before_posted_on: hasMore ? transactions.at(-1).posted_on : null,
      next_before_id: hasMore ? transactions.at(-1).id : null });
  } });
  await page.getByRole("button", { name: "Match payment" }).first().click();
  for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
    await expect(page.locator("#ccMatchMore")).toBeVisible();
    await page.locator("#ccMatchMore").click();
  }
  await expect(page.getByText("Old exact CRS debit")).toBeVisible();
  await expect(page.locator("#ccMatchMore")).toBeHidden();
  await page.locator(`input[name="ccPayment"][value="${idFor(1)}"]`).check();
  await page.locator("#ccSaveMatch").click();
  await expect.poll(() => calls.at(-1)?.body.action).toBe("match_payment");
  expect(calls.at(-1).body).toMatchObject({ obligation_id: CRS_ID, transaction_id: idFor(1) });
  expect(lookupCalls).toHaveLength(5);
  expect(lookupCalls[0]).toEqual({ match_obligation_id: CRS_ID });
  expect(lookupCalls[4]).toMatchObject({ match_obligation_id: CRS_ID,
    before_posted_on: "2026-11-02", before_id: idFor(2) });
});

test("same-token owner role revocation scrubs private data before any bank POST", async ({ page }) => {
  let role = "owner";
  const bank = fullBank(); bank.accounts[0].name = "Revoked owner's bank";
  const cash = fullCash(); cash.obligations[0].label = "Revoked owner's invoice";
  const calls = await open(page, { bank, cash, authSession: route => reply(route, { ok: true, staff: {
    id: "00000000-0000-4000-8000-000000000099", role,
    org_id: "00000000-0000-4000-8000-000000000098" } }) });
  await expect(page.locator("#ccFull")).toBeVisible();
  await page.locator("#ccAddObligation").click();
  await page.locator("#ccLabel").fill("Revoked owner's unsaved draft");
  await page.locator("#ccCancelObligation").click();
  await page.locator("#ccBusinessConfirm").check();
  await page.locator("#ccReadConsent").check();
  role = "sales_manager";
  await page.locator("#ccConnect").click();
  await expect(page.locator("#ccErrorText")).toContainText("sign-in changed");
  await expect(page.locator("#ccSignIn")).toHaveAttribute("href", "/login.html");
  const oldData = await page.evaluate(() => ({ text: document.body.textContent,
    draft: document.getElementById("ccLabel").value }));
  expect(oldData.text).not.toContain("Revoked owner's bank");
  expect(oldData.text).not.toContain("Revoked owner's invoice");
  expect(oldData.draft).toBe("");
  expect(calls).toEqual([]);
});

test("a forbidden owner bank GET clears the previous company view", async ({ page }) => {
  let forbidden = false;
  const bank = fullBank(); bank.accounts[0].name = "Previous owner's bank";
  const calls = await open(page, { bank, bankGet: route => forbidden
    ? reply(route, { ok: false, error: "forbidden" }, 403) : reply(route, bank) });
  await expect(page.locator("#ccFull")).toBeVisible();
  forbidden = true;
  await page.locator("#ccSync").click();
  await expect(page.locator("#ccErrorText")).toContainText("sign-in changed");
  expect(await page.locator("#ccBankAccounts").textContent()).not.toContain("Previous owner's bank");
  expect(await page.locator("#ccBankAccounts").innerHTML()).toBe("");
  expect(calls.map(call => call.body.action)).toEqual(["sync"]);
});

test("company cash mobile Slow 4G and 4x CPU stays within CRM page budgets", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150,
    downloadThroughput: 200000, uploadThroughput: 93750, connectionType: "cellular4g" });
  await page.addInitScript(() => {
    window.__companyCashPerf = { lcp_ms: 0, lcp_element: null, cls: 0, shifts: [], interaction_ms: 0 };
    new PerformanceObserver(entries => { for (const entry of entries.getEntries()) {
      window.__companyCashPerf.lcp_ms = entry.startTime;
      window.__companyCashPerf.lcp_element = { tag: entry.element?.tagName, id: entry.element?.id,
        className: String(entry.element?.className || ""), size: entry.size };
    } }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver(entries => { for (const entry of entries.getEntries())
      if (!entry.hadRecentInput) {
        window.__companyCashPerf.cls += entry.value;
        window.__companyCashPerf.shifts.push({ value: entry.value, at_ms: entry.startTime,
          sources: entry.sources.map(source => ({ tag: source.node?.tagName, id: source.node?.id,
            className: String(source.node?.className || ""), from: source.previousRect.toJSON(), to: source.currentRect.toJSON() })) });
      } }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver(entries => { for (const entry of entries.getEntries())
      if (entry.interactionId) window.__companyCashPerf.interaction_ms = Math.max(window.__companyCashPerf.interaction_ms, entry.duration);
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  });
  await open(page);
  await expect(page.locator("#ccAvailable")).toHaveText("$9,250.00");
  await page.waitForTimeout(1000);
  await page.locator("#ccAddObligation").click();
  await expect(page.locator("#ccObligationDialog")).toBeVisible();
  await page.waitForTimeout(300);
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource").map(entry => ({
      path: new URL(entry.name).pathname, bytes: entry.encodedBodySize,
      start_ms: entry.startTime, end_ms: entry.responseEnd, duration_ms: entry.duration
    }));
    return { ...window.__companyCashPerf, ttfb_ms: nav.responseStart - nav.requestStart,
      dom_content_loaded_ms: nav.domContentLoadedEventEnd,
      fcp_ms: performance.getEntriesByType("paint").find(entry => entry.name === "first-contentful-paint")?.startTime ?? null,
      js_bytes: resources.filter(entry => entry.path.endsWith(".js")).reduce((sum, entry) => sum + entry.bytes, 0),
      page_bytes: nav.encodedBodySize + resources.reduce((sum, entry) => sum + entry.bytes, 0),
      resources };
  });
  const report = { scope: "Local full shared shell with safe API fixtures; production backend, hosting, and field INP not measured. Not Lighthouse.",
    viewport: "390x844", network: "150ms RTT / 1.6Mbps down / 750Kbps up", cpu: "4x slowdown",
    measured_at: new Date().toISOString(), ...metrics };
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, "mobile-performance.json"), JSON.stringify(report, null, 2) + "\n");
  expect(metrics.lcp_ms, "CRM LCP under 2.5s").toBeGreaterThan(0);
  expect(metrics.lcp_ms).toBeLessThan(2500);
  expect(metrics.cls, "CRM CLS under 0.1").toBeLessThan(0.1);
  if (metrics.interaction_ms > 0) expect(metrics.interaction_ms, "measured interaction under 200ms").toBeLessThan(200);
  expect(metrics.ttfb_ms, "local static TTFB under 600ms").toBeLessThan(600);
  expect(metrics.js_bytes, "CRM JS under 500KB").toBeLessThan(500000);
  expect(metrics.page_bytes, "CRM page under 2MB").toBeLessThan(2000000);
});
