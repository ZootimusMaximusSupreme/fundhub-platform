// Proves the six panels on the staff Finance OS desk (public/app/finance-os.html):
// the figures on screen are the figures the five reads carried, said in words,
// and a missing or refused read says so instead of printing zero.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, json, proofRows, startScreens } from "./s4-screen-harness.mjs";

const proof = proofRows(import.meta.url);
const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const compact = (value) => String(value).replace(/\s+/g, " ");

const basis = { lines: 3, counted: 3, unknown: 0 };
const GRID = {
  ok: true, lines: 3,
  rows: [
    { key: "credit_limit", label: "Credit limit", display: "30000.00", basis },
    { key: "balance", label: "Balance", display: "7500.00", basis },
    { key: "available", label: "Available", display: "22500.00", basis },
    { key: "utilization", label: "Utilization", display: "25%", basis },
    { key: "apr", label: "Average APR", display: "19.9%", basis },
    { key: "cheapest", label: "Cheapest money", display: "12.99% · Chase · 5000.00", basis },
    { key: "lines", label: "Open cards", display: "3", unit: "count" },
  ],
};
const DETAIL = {
  ok: true,
  client: { first_name: "Dana", last_name: "Whitfield", email: "dana@example.com" },
  transactions: [
    { product_name: "Roadmap", created_at: "2026-09-02T17:00:00Z", amount_paid: "297.00", status: "succeeded" },
    { product_name: "Diagnostic", created_at: "2026-09-05T17:00:00Z", amount_paid: "99.00", status: "failed" },
  ],
  invoices: [
    { status: "open", due_at: "2026-10-20", created_at: "2026-10-01", amount_due: "1500.00", amount_paid: "500.00", balance_due: "1000.00" },
  ],
};
const BANKS = {
  ok: true,
  surface: { groups: [
    { key: "personal", accounts: [{ id: "a1", name: "Personal Checking", mask: "1101", account_type: "depository", current_display: "4210.55" }] },
    { key: "business", accounts: [
      { id: "b1", name: "Business Checking", mask: "2202", account_type: "depository", current_display: "21406.00" },
      { id: "i1", name: "Brokerage", mask: "9090", account_type: "investment", current_display: "15000.00" },
    ] },
    { key: "mystery", accounts: [{ id: "u1", name: "Old Savings", account_type: "depository", current_display: "88.10" }] },
  ] },
  details: { a1: { hand_entered: true }, b1: { hand_entered: false }, i1: { hand_entered: false }, u1: { hand_entered: false } },
};
const BILLS = {
  ok: true,
  bills: [
    { merchant_display: "Adobe", cadence: "monthly", typical_amount_display: "54.99", next_expected_on: "2026-11-01" },
    { merchant_key: "mystery_charge", cadence: "weekly", typical_amount_display: "10.00", next_expected_unknown_reason: "not enough history yet" },
  ],
};
const SUGGESTIONS = {
  ok: true, hasPull: true,
  costingYou: [{ title: "Pay Chase Ink down to 30%", severity: "high", lines: ["It costs about $40 a month in interest."] }],
  notAFactor: [{ title: "Your oldest card's age", lines: ["Age of accounts does not move the score this month."] }],
};

async function openDesk(open, overrides = {}) {
  const answer = (name, body) => async (route) => {
    if (overrides[name]) return route.fulfill({ status: overrides[name].status, contentType: "application/json", body: JSON.stringify(overrides[name].body) });
    return json(route, body);
  };
  const handlers = {
    "/api/read/finance-os-suggestions": answer("suggestions", SUGGESTIONS),
    "/api/read/finance-os?": answer("grid", GRID),
    "/api/dashboard/client?id=": answer("detail", DETAIL),
    "/api/finance/bank-accounts": answer("banks", BANKS),
    "/api/finance/bills": answer("bills", BILLS),
  };
  const { page, errors } = await open(`/app/finance-os.html?client_id=${CLIENT_ID}`, { session: OWNER, handlers });
  await page.waitForSelector(".fos-panel");
  return { page, errors };
}

const panelText = async (page, title) => compact(await page.locator(".fos-panel", { has: page.locator("h2", { hasText: title }) }).first().innerText());

test("the hero says the available credit and how many cards it comes from", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Hero: 'available credit' figure/, async () => {
    const { page, errors } = await openDesk(open);
    const hero = compact(await page.locator(".fos-hero").innerText());
    assert.match(hero, /Dana Whitfield · available credit/i);
    assert.match(hero, /\$22,500\.00/);
    assert.match(hero, /Money still available to draw across 3 open credit cards\. This is the credit report only — it is not cash in the bank\./);
    assert.deepEqual(errors, []);
    await page.close();
    const none = await openDesk(open, { grid: { status: 200, body: { ok: true, lines: 0, rows: [] } } });
    assert.match(compact(await none.page.locator(".fos-hero").innerText()), /There is no credit report on file for this client yet\./);
    assert.doesNotMatch(compact(await none.page.locator(".fos-hero").innerText()), /\$0/);
    await none.page.close();
  });
});

test("the credit picture prints each server figure, with the cheapest money in dollars", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Credit picture panel/, async () => {
    const { page } = await openDesk(open);
    const text = await panelText(page, "Credit picture");
    for (const part of ["Credit limit", "$30,000.00", "Balance", "$7,500.00", "Available", "$22,500.00", "25%", "19.9%", "12.99% · Chase · $5,000.00", "counted all 3 credit cards"]) {
      assert.ok(text.includes(part), `the credit picture shows ${part}`);
    }
    await page.close();
  });
});

test("money in counts only paid rows, and invoiced says billed, paid and still owed", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Money in panel/, async () => {
    const { page } = await openDesk(open);
    const moneyIn = await panelText(page, "Money in");
    assert.match(moneyIn, /Paid so far.*\$297\.00/);
    assert.match(moneyIn, /across 1 payment; 1 more listed but not counted \(see status\)/);
    assert.match(moneyIn, /Roadmap.*paid/);
    assert.match(moneyIn, /Diagnostic.*failed/);
    const invoiced = await panelText(page, "Invoiced");
    assert.match(invoiced, /Billed.*\$1,500\.00/);
    assert.match(invoiced, /Paid.*\$500\.00/);
    assert.match(invoiced, /Still owed.*\$1,000\.00/);
    assert.match(invoiced, /due Oct 20, 2026/);
    await page.close();
  });
});

test("bank accounts sort into their panels and say when balances were typed by hand", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Bank accounts panels/, async () => {
    const { page } = await openDesk(open);
    assert.match(await panelText(page, "Personal"), /Personal Checking\s*····1101.*\$4,210\.55/);
    assert.match(await panelText(page, "Business"), /Business Checking\s*····2202.*\$21,406\.00/);
    assert.match(await panelText(page, "Investment"), /Brokerage\s*····9090.*\$15,000\.00/);
    assert.match(await panelText(page, "Not classified"), /Old Savings.*\$88\.10/);
    assert.match(compact(await page.locator(".fos-notes").innerText()), /Some balances below were typed in by hand\./);
    await page.close();

    // the note belongs to hand-typed balances only: with none typed in, it is not printed
    const bank = { ...BANKS, details: { a1: { hand_entered: false }, b1: { hand_entered: false }, i1: { hand_entered: false }, u1: { hand_entered: false } } };
    const synced = await openDesk(open, { banks: { status: 200, body: bank } });
    assert.match(await panelText(synced.page, "Personal"), /Personal Checking/);
    assert.doesNotMatch(await synced.page.locator("body").innerText(), /typed in by hand/);
    await synced.page.close();
  });
});

test("repeating charges show the charge, how often, the amount and the next date or why none", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Repeating charges panel/, async () => {
    const { page } = await openDesk(open);
    const text = await panelText(page, "Repeating charges");
    assert.match(text, /Adobe\s*monthly.*\$54\.99.*2026-11-01/);
    assert.match(text, /mystery_charge\s*weekly.*\$10\.00.*not enough history yet/);
    await page.close();
  });
});

test("the optimize panel shows findings, what is not a factor, and each state in its own words", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Optimize your accounts panel/, async () => {
    const found = await openDesk(open);
    const text = await panelText(found.page, "Optimize your accounts");
    assert.match(text, /Pay Chase Ink down to 30% high/i);
    assert.match(text, /It costs about \$40 a month in interest\./);
    assert.match(text, /Checked, not a factor/);
    assert.match(text, /Your oldest card's age/);
    await found.page.close();

    const notEntitled = await openDesk(open, { suggestions: { status: 403, body: { ok: false, entitled: false, reason: "no subscription" } } });
    assert.match(await panelText(notEntitled.page, "Optimize your accounts"), /does not have an active Finance OS subscription/);
    await notEntitled.page.close();

    const noPull = await openDesk(open, { suggestions: { status: 200, body: { ok: true, hasPull: false } } });
    assert.match(await panelText(noPull.page, "Optimize your accounts"), /No credit check has run for this client yet this month/);
    await noPull.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
