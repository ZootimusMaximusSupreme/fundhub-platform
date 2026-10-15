// Batch 16 practice tests: the chrome and small controls of three client money pages, in a real
// Chromium with fake /api answers (no live data).
//
//   money-accounts.html   Try again on a load error; the Add account / Add a business head buttons;
//                         the Back link (client and staff); the six-link Money nav
//   money-alerts.html     Show all N / Show fewer on a protection's texts; Try again; the Back link and
//                         the seven-link nav (Alerts is the current page); the jump links to Accounts and
//                         Setup (the words the page really paints; the row's quoted words are older)
//   money-banks.html      Try again; the Back link and the eight-link nav (Plan and Banks included)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { json, proofRows, sharedScreens, waitFor } from "./fin-b16-kit.mjs";
import { CLIENT, CLIENT_ID, STAFF, sampleAnswer } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ALERTS_FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "src/finance/file-alerts/file-alerts.fixture.json"), "utf8"));
const FRAME = "/app/financeos.html";

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const ACCOUNTS_VIEW = {
  ok: true,
  client_id: CLIENT_ID,
  containers: [{ id: ME, kind: "personal", name: "Chris (personal)", archived_at: null, business: null,
    accounts: [{ id: "a1", source: "bank_account", name: "Personal Checking", mask: "1101", type: "depository", subtype: "checking",
      container_id: ME, current_cents: 421055, provider: "manual", closed_at: null }], cards: [], loans: [], bills: [] }],
  unassigned: { accounts: [], cards: [], loans: [], bills: [] },
  billing: { containers: 1, price_per_container_cents: null, monthly_cents: null },
};

/** A GET that fails with `status` until `state.ok` is set, then answers `body`. Counts every read. */
function flaky(body) {
  const state = { ok: false, reads: [] };
  const handler = async (route, { url }) => {
    state.reads.push(new URL(url).search);
    if (!state.ok) return json(route, { ok: false, error: "query_failed" }, 500);
    return json(route, body);
  };
  return { state, handler };
}

const navOf = (page) => page.evaluate(() => [...document.querySelectorAll(".mnav a")].map((a) => ({
  label: a.textContent.trim(), href: a.getAttribute("href"), current: a.getAttribute("aria-current"),
})));
const backOf = (page) => page.evaluate(() => {
  const a = document.getElementById("money-back");
  return [a && a.textContent.trim(), a && a.getAttribute("href")];
});

// ───────────────────────── money-accounts.html ─────────────────────────

test("Accounts: a failed load shows Try again, and pressing it reads again and paints the accounts", { timeout: 90_000 }, async () => {
  await proof.check(/^'Try again' button on a load error/, async () => {
    const read = flaky(ACCOUNTS_VIEW);
    const { page, errors } = await screens.open("/app/money-accounts.html", { session: CLIENT, handlers: { "/api/money/accounts": read.handler } });
    await page.waitForSelector('[data-act="retry"]');
    assert.match(await page.locator("#accounts-root").innerText(), /Something went wrong on our side while loading your accounts/);
    assert.equal(await page.locator("#add-account").count(), 0, "no accounts are painted over the error");
    assert.deepEqual(read.state.reads, [""]);
    read.state.ok = true;
    await page.locator('[data-act="retry"]').click();
    await waitFor(() => read.state.reads.length === 2);
    await page.waitForSelector("#add-account");
    assert.equal(await page.locator('[data-act="retry"]').count(), 0, "the error is gone once the read works");
    assert.match(await page.locator("#accounts-root").innerText(), /Personal Checking/);
    assert.deepEqual(errors, []);
    await page.close();
  }, "money-accounts.html");
});

test("Accounts: Add account and Add a business open their own form and put the cursor in its name box", { timeout: 90_000 }, async () => {
  await proof.check(/^Head buttons: 'Add account' and 'Add a business'/, async () => {
    const { page, errors } = await screens.open(`/app/money-accounts.html?client_id=${CLIENT_ID}`, {
      session: STAFF, handlers: { "/api/money/accounts": ACCOUNTS_VIEW },
    });
    await page.waitForSelector("#add-account");
    const state = () => page.evaluate(() => ({
      account: document.querySelector("#add-account").open,
      business: document.querySelector("#add-business").open,
      focused: document.activeElement && document.activeElement.name,
      inside: document.activeElement && (document.activeElement.closest("details") || {}).id,
    }));
    const folded = await state();
    assert.equal(folded.account, false, "the Add account form starts folded");
    assert.equal(folded.business, false, "the Add a business form starts folded");
    await page.locator('[data-act="open-add"]').click();
    assert.deepEqual(await state(), { account: true, business: false, focused: "name", inside: "add-account" });
    await page.locator('[data-act="open-business"]').click();
    const after = await state();
    assert.equal(after.business, true, "Add a business opens its form");
    assert.equal(after.inside, "add-business", "and the cursor goes to that form, not the other one");
    assert.equal(after.focused, "name");
    assert.deepEqual(errors, []);
    await page.close();
  }, "money-accounts.html");
});

test("Accounts: the Back link and the six-link Money nav, for the client and for staff naming a client", { timeout: 90_000 }, async () => {
  const six = ["Money", "Accounts", "Credit", "Connections", "Payments", "Setup"];
  const hash = ["overview", "accounts", "credit", "connections", "payments", "setup"];
  await proof.check(/^Header link 'Back to my portal'/, async () => {
    const asClient = await screens.open("/app/money-accounts.html", { session: CLIENT, handlers: { "/api/money/accounts": ACCOUNTS_VIEW } });
    await asClient.page.waitForSelector("#add-account");
    assert.deepEqual(await backOf(asClient.page), ["Back to my portal", "client-portal.html"]);
    await asClient.page.close();
    const asStaff = await screens.open(`/app/money-accounts.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/accounts": ACCOUNTS_VIEW } });
    await asStaff.page.waitForSelector("#add-account");
    assert.deepEqual(await backOf(asStaff.page), ["Back to Finance OS", `finance-os.html?client_id=${CLIENT_ID}`]);
    await asStaff.page.close();
  }, "money-accounts.html");
  await proof.check(/^Money nav: Money, Accounts, Credit, Connections, Payments, Setup/, async () => {
    const asClient = await screens.open("/app/money-accounts.html", { session: CLIENT, handlers: { "/api/money/accounts": ACCOUNTS_VIEW } });
    await asClient.page.waitForSelector("#add-account");
    const clientNav = await navOf(asClient.page);
    assert.deepEqual(clientNav.map((l) => l.label), six);
    assert.deepEqual(clientNav.map((l) => l.href), hash.map((h) => `${FRAME}#${h}`), "each word goes to its own tab, with no client named");
    assert.deepEqual(clientNav.filter((l) => l.current).map((l) => l.label), ["Accounts"]);
    await asClient.page.close();
    const asStaff = await screens.open(`/app/money-accounts.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/accounts": ACCOUNTS_VIEW } });
    await asStaff.page.waitForSelector("#add-account");
    const staffNav = await navOf(asStaff.page);
    assert.deepEqual(staffNav.map((l) => l.label), six);
    assert.deepEqual(staffNav.map((l) => l.href), hash.map((h) => `${FRAME}?client_id=${CLIENT_ID}#${h}`), "every link carries the client, before the #tab");
    await asStaff.page.close();
  }, "money-accounts.html");
});

// ───────────────────────── money-alerts.html ─────────────────────────

const fixtureCopy = () => JSON.parse(JSON.stringify(ALERTS_FIXTURE));
function textRow(i, kind = "payment_timing", over = {}) {
  return { id: `00000000-0000-4000-8000-0000000009${String(i).padStart(2, "0")}`, kind, kind_label: "Pay before close", account_id: null,
    label: `Business Amex ending 440${i}`, threshold: 3, due_on: null, cash_kind: null, body: `Fundhub alert number ${i}: pay before the close.`,
    delivery: "text", message_id: null, task_id: null, sent_at: `2026-09-${String(10 + i).padStart(2, "0")}T07:30:00.000Z`,
    cleared_at: null, open: false, ...over };
}

test("Alerts: Show all N lists every text of that one protection, Show fewer folds it back", { timeout: 90_000 }, async () => {
  await proof.check(/^'Show all N' \/ fewer texts list per protection/, async () => {
    const data = fixtureCopy();
    data.alerts = [textRow(1), textRow(2), textRow(3), textRow(4), textRow(5), textRow(6, "promo_end", { kind_label: "Promo rate ending" })];
    const { page, errors } = await screens.open(`/app/money-alerts.html?client_id=${CLIENT_ID}`, {
      session: STAFF, handlers: { "/api/money/alerts": data },
    });
    await page.waitForSelector("#fa-k-payment_timing");
    const card = page.locator("#fa-k-payment_timing");
    const sent = () => card.locator(".sent-item").count();
    assert.equal(await sent(), 3, "three texts are listed before Show all");
    const more = card.locator('[data-act="more"]');
    assert.equal((await more.innerText()).trim(), "Show all 5 texts", "the button says how many there are");
    assert.equal(await more.getAttribute("aria-expanded"), "false");
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll("#fa-k-payment_timing .sent-item").length === 5);
    assert.equal((await card.locator('[data-act="more"]').innerText()).trim(), "Show fewer");
    assert.equal(await card.locator('[data-act="more"]').getAttribute("aria-expanded"), "true");
    assert.match(await card.innerText(), /Fundhub alert number 5/);
    assert.equal(await page.locator("#fa-k-promo_end .sent-item").count(), 1, "another protection is not opened by it");
    assert.equal(await page.locator('#fa-k-promo_end [data-act="more"]').count(), 0, "a protection with three or fewer texts has no button");
    await card.locator('[data-act="more"]').click();
    await page.waitForFunction(() => document.querySelectorAll("#fa-k-payment_timing .sent-item").length === 3);
    assert.equal((await card.locator('[data-act="more"]').innerText()).trim(), "Show all 5 texts");
    assert.deepEqual(errors, []);
    await page.close();
  }, "money-alerts.html");
});

test("Alerts: a failed load shows Try again, and pressing it reads again and paints the protections", { timeout: 90_000 }, async () => {
  await proof.check(/^'Try again' button on a load error/, async () => {
    const read = flaky(fixtureCopy());
    const { page, errors } = await screens.open(`/app/money-alerts.html?client_id=${CLIENT_ID}`, {
      session: STAFF, handlers: { "/api/money/alerts": read.handler },
    });
    await page.waitForSelector('[data-act="retry"]');
    assert.match(await page.locator("#alerts-root").innerText(), /We could not load your alerts/);
    assert.equal(await page.locator("#fa-k-payment_timing").count(), 0);
    read.state.ok = true;
    await page.locator('[data-act="retry"]').click();
    await waitFor(() => read.state.reads.length === 2);
    await page.waitForSelector("#fa-k-payment_timing");
    assert.equal(await page.locator('[data-act="retry"]').count(), 0);
    assert.deepEqual(read.state.reads, [`?client_id=${CLIENT_ID}`, `?client_id=${CLIENT_ID}`], "it asks for the same client again");
    assert.deepEqual(errors, []);
    await page.close();
  }, "money-alerts.html");
});

test("Alerts: the Back link and the seven-link nav, for the client and for staff", { timeout: 90_000 }, async () => {
  await proof.check(/^Header link 'Back to my portal' and Money nav \(adds an Alerts tab\)/, async () => {
    const labels = ["Money", "Accounts", "Credit", "Connections", "Payments", "Setup", "Alerts"];
    const hash = ["overview", "accounts", "credit", "connections", "payments", "setup"];
    const asClient = await screens.open("/app/money-alerts.html", { session: CLIENT, handlers: { "/api/money/alerts": fixtureCopy() } });
    await asClient.page.waitForSelector("#fa-k-payment_timing");
    assert.deepEqual(await backOf(asClient.page), ["Back to my portal", "client-portal.html"]);
    const clientNav = await navOf(asClient.page);
    assert.deepEqual(clientNav.map((l) => l.label), labels);
    assert.deepEqual(clientNav.map((l) => l.href), [...hash.map((h) => `${FRAME}#${h}`), "/app/money-alerts.html"]);
    assert.deepEqual(clientNav.filter((l) => l.current).map((l) => l.label), ["Alerts"]);
    await asClient.page.close();
    const asStaff = await screens.open(`/app/money-alerts.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/alerts": fixtureCopy() } });
    await asStaff.page.waitForSelector("#fa-k-payment_timing");
    assert.deepEqual(await backOf(asStaff.page), ["Back to Finance OS", `finance-os.html?client_id=${CLIENT_ID}`]);
    const staffNav = await navOf(asStaff.page);
    assert.deepEqual(staffNav.map((l) => l.href), [
      ...hash.map((h) => `${FRAME}?client_id=${CLIENT_ID}#${h}`), `/app/money-alerts.html?client_id=${CLIENT_ID}`,
    ]);
    await asStaff.page.close();
  }, "money-alerts.html");
});

test("Alerts: the jump links go to Accounts or Setup, and carry the client for staff", { timeout: 120_000 }, async () => {
  await proof.check(/^Jump links to Accounts and Setup/, async () => {
    const linksOf = (page) => page.evaluate(() => [...document.querySelectorAll("#alerts-root a")]
      .map((a) => [a.textContent.trim(), a.getAttribute("href")]));
    const open = async (data, session, query) => {
      const o = await screens.open(`/app/money-alerts.html${query}`, { session, handlers: { "/api/money/alerts": data } });
      await o.page.waitForSelector("#alerts-root .card");
      return o;
    };
    // Cash that cannot be checked for a reason the client can fix, and cards not sorted into personal or business.
    const fixable = fixtureCopy();
    fixable.reserve.personal = { state: "unknown", reason: "no_cash_accounts", months: 6, cash_cents: null, cash_accounts: 0,
      minimums_cents: null, need_cents: null, short_cents: null, open_alert_id: null };
    fixable.reserve.not_counted = { debts: 2, minimums_cents: 5000 };
    const a = await open(fixable, STAFF, `?client_id=${CLIENT_ID}`);
    const toAccounts = `${FRAME}?client_id=${CLIENT_ID}#accounts`;
    const links = await linksOf(a.page);
    assert.ok(links.some(([t, h]) => t === "Open Accounts" && h === toAccounts), "the unfixable-cash note jumps to Accounts, with the client");
    assert.ok(links.some(([t, h]) => t === "Sort them in Accounts" && h === toAccounts), "the not-sorted note jumps to Accounts, with the client");
    await a.page.close();
    // The same data for the client themself names nobody.
    const own = await open(fixable, CLIENT, "");
    assert.ok((await linksOf(own.page)).some(([t, h]) => t === "Open Accounts" && h === `${FRAME}#accounts`));
    await own.page.close();
    // Not on a plan yet: Set up FinanceOS goes to Setup.
    const notEnrolled = fixtureCopy();
    notEnrolled.enrolled = { blueprint: false, finance_os: false, any: false };
    const s = await open(notEnrolled, STAFF, `?client_id=${CLIENT_ID}`);
    assert.ok((await linksOf(s.page)).some(([t, h]) => t === "Set up FinanceOS" && h === `${FRAME}?client_id=${CLIENT_ID}#setup`));
    await s.page.close();
    // Nothing to watch: Add an account goes to Accounts.
    const empty = fixtureCopy();
    empty.cards = [];
    empty.alerts = [];
    empty.reserve = { months: 6, personal: { state: "unknown", reason: "no_cash_accounts" }, business: { state: "unknown", reason: "no_cash_accounts" }, not_counted: { debts: 0, minimums_cents: null } };
    const e = await open(empty, STAFF, `?client_id=${CLIENT_ID}`);
    assert.ok((await linksOf(e.page)).some(([t, h]) => t === "Add an account" && h === toAccounts));
    await e.page.close();
  }, "money-alerts.html");
});

// ───────────────────────── money-banks.html ─────────────────────────

test("Banks: a failed load shows Try again, and pressing it reads again and paints the bank plan", { timeout: 90_000 }, async () => {
  await proof.check(/^'Try again' button on a load error/, async () => {
    const read = flaky(sampleAnswer("money-banks.sample.json"));
    const { page, errors } = await screens.open(`/app/money-banks.html?client_id=${CLIENT_ID}`, {
      session: STAFF, handlers: { "/api/money/banks": read.handler },
    });
    await page.waitForSelector('[data-act="retry"]');
    assert.match(await page.locator("#banks-root").innerText(), /Something went wrong on our side while loading your bank plan/);
    assert.equal(await page.locator(".fh-banks .addbank").count(), 0, "no plan is painted over the error");
    read.state.ok = true;
    await page.locator('[data-act="retry"]').click();
    await waitFor(() => read.state.reads.length === 2);
    await page.waitForSelector(".fh-banks .addbank");
    assert.equal(await page.locator('[data-act="retry"]').count(), 0);
    assert.deepEqual(read.state.reads, [`?client_id=${CLIENT_ID}`, `?client_id=${CLIENT_ID}`]);
    assert.deepEqual(errors, []);
    await page.close();
  }, "money-banks.html");
});

test("Banks: the Back link and the eight-link nav, for the client and for staff", { timeout: 90_000 }, async () => {
  await proof.check(/^Header link 'Back to my portal' and Money nav \(8 links incl\. Plan and Banks\)/, async () => {
    const labels = ["Money", "Plan", "Accounts", "Credit", "Connections", "Payments", "Banks", "Setup"];
    const hash = ["overview", "plan", "accounts", "credit", "connections", "payments", "banks", "setup"];
    const asClient = await screens.open("/app/money-banks.html", { session: CLIENT, handlers: { "/api/money/banks": sampleAnswer("money-banks.sample.json") } });
    await asClient.page.waitForSelector(".fh-banks .card");
    assert.deepEqual(await backOf(asClient.page), ["Back to my portal", "client-portal.html"]);
    const clientNav = await navOf(asClient.page);
    assert.deepEqual(clientNav.map((l) => l.label), labels);
    assert.deepEqual(clientNav.map((l) => l.href), hash.map((h) => `${FRAME}#${h}`));
    assert.deepEqual(clientNav.filter((l) => l.current).map((l) => l.label), ["Banks"]);
    await asClient.page.close();
    const asStaff = await screens.open(`/app/money-banks.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/banks": sampleAnswer("money-banks.sample.json") } });
    await asStaff.page.waitForSelector(".fh-banks .card");
    assert.deepEqual(await backOf(asStaff.page), ["Back to Finance OS", `finance-os.html?client_id=${CLIENT_ID}`]);
    const staffNav = await navOf(asStaff.page);
    assert.deepEqual(staffNav.map((l) => l.href), hash.map((h) => `${FRAME}?client_id=${CLIENT_ID}#${h}`));
    await asStaff.page.close();
  }, "money-banks.html");
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
