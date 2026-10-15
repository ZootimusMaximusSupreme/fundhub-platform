// The client's soft-pull page, page half: a real page in Chromium, a fake /api answer, one form filled in.
// A practice test. It judges the two draft-journey steps that are about what the person SEES:
//   "They authorize the soft pull first, then pay, on one page"
//   "After submit the same page shows Pay for that total"
// The server half (consent before link, the exact total) is src/http/fin-b22-soft-pull-flow.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { json, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const LINK = "?org=org-1&client=c-1&exp=1999999999&sig=test-signature";
const PAGE = `/app/soft-pull-approve.html${LINK}`;
const READ = {
  ok: true,
  contact: { first_name: "Dana" },
  consent: { valid: false },
  disclosure: { version: "2.1", text: "I authorize a soft credit inquiry." },
  pricing: { base_cents: 3200, business_addon_cents: 1000, max_businesses: 20, base_display: "$32", business_addon_display: "$10" },
};

async function openApproval(open, answer) {
  const posts = [];
  const handlers = {
    "/api/soft-pull-approve": async (route, { method }) => {
      if (method === "POST") {
        posts.push(JSON.parse(route.request().postData() || "{}"));
        const out = typeof answer === "function" ? answer(posts.length) : answer;
        return json(route, out.body, out.status || 200);
      }
      return json(route, READ);
    },
  };
  const opened = await open(PAGE, { session: null, handlers });
  await opened.page.waitForSelector("#f");
  return { ...opened, posts };
}

async function fillPerson(page) {
  await page.locator("#granted_name").fill("Dana Whitfield");
  await page.locator("#ssn").fill("123-45-6789");
  await page.locator("#dob").fill("1985-04-12");
  await page.locator("#address_line1").fill("12 Main St");
  await page.locator("#city").fill("Phoenix");
  await page.locator("#state").fill("AZ");
  await page.locator("#postal_code").fill("85004");
}

async function fillBusiness(page, i) {
  await page.locator(`#biz_name_${i}`).fill(`Acme ${i + 1} LLC`);
  await page.locator(`#biz_line1_${i}`).fill("500 Commerce Way");
  await page.locator(`#biz_city_${i}`).fill("Tempe");
  await page.locator(`#biz_state_${i}`).fill("AZ");
  await page.locator(`#biz_zip_${i}`).fill("85281");
  await page.locator(`#biz_ein_${i}`).fill("123456789");
  await page.locator(`#biz_inc_${i}`).fill("2021-03");
}

const SAVED = (total, display, url = "https://pay.example.test/c/abc") => ({
  body: {
    ok: true,
    consent: { id: "cc-1", valid: true },
    pricing: { total_cents: total, total_display: display },
    checkout: url ? { id: "link-1", checkout_url: url, amount_cents: total, amount_display: display } : null,
    next: url ? `Pay ${display} next — use the Pay button below.` : `Consent saved. Ask your advisor for the ${display} pay link.`,
  },
  status: 201,
});

test("authorize first: nothing to pay is on the page until the form is saved, and the only action is to submit", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts, errors } = await openApproval(open, SAVED(3200, "$32"));

  assert.equal(await page.locator(".btn-pay").count(), 0, "no Pay button before the form is saved");
  assert.equal(await page.locator('a[href*="pay."], a[href*="checkout"]').count(), 0, "no payment link before the form is saved");
  assert.equal(await page.locator("#go").innerText(), "I agree — submit soft-pull approval");
  assert.match(await page.locator(".lede").first().innerText(), /Authorize first, then pay the total shown below\./);

  // the page itself orders it: the authorization words, then what happens next with submit before pay
  const order = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      authorize: text.indexOf("Soft pull authorization"),
      next: text.indexOf("What happens next"),
      submitStep: text.indexOf("You fill this in"),
      payStep: text.indexOf("You pay the total shown"),
    };
  });
  assert.ok(order.authorize >= 0 && order.authorize < order.next, "the authorization comes before the steps");
  assert.ok(order.submitStep >= 0 && order.submitStep < order.payStep, "step 1 is the form, step 2 is paying");

  // an incomplete form sends nothing, so nothing to pay can appear
  await page.locator("#go").click();
  await page.waitForTimeout(150);
  assert.deepEqual(posts, []);
  assert.equal(await page.locator(".btn-pay").count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test("after submit the same page shows Pay for the server's total, with the server's link", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts } = await openApproval(open, SAVED(5200, "$52", "https://pay.example.test/c/two-companies"));
  const before = new URL(page.url());

  await fillPerson(page);
  await page.locator("#add_biz").click();
  await page.locator("#add_biz").click();
  await fillBusiness(page, 0);
  await fillBusiness(page, 1);
  assert.match(await page.locator("#total_line").innerText(), /Total due: \$52/, "the page worked the same total before submit");
  await page.locator("#go").click();
  await waitFor(() => posts.length === 1);

  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Consent saved");
  const pay = page.locator(".btn-pay");
  assert.equal(await pay.count(), 1);
  assert.equal(await pay.innerText(), "Pay $52 assessment");
  assert.equal(await pay.getAttribute("href"), "https://pay.example.test/c/two-companies");
  assert.equal(posts[0].businesses.length, 2, "both companies went in the one request");
  const after = new URL(page.url());
  assert.equal(after.pathname, before.pathname, "still on the same page");
  assert.equal(after.search, before.search);
  assert.equal(posts.length, 1, "one save");
  await page.close();
});

test("the total on the Pay button is the server's, not a number the page worked out", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts } = await openApproval(open, SAVED(4200, "$42", "https://pay.example.test/c/server-total"));
  await fillPerson(page);
  await page.locator("#go").click();
  await waitFor(() => posts.length === 1);
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Consent saved");
  // no company was added, so the page's own total is $32; the server said $42 and the page shows what the server said
  assert.equal(await page.locator(".btn-pay").innerText(), "Pay $42 assessment");
  await page.close();
});

test("a save the server refuses stays on the form with the reason, and offers nothing to pay", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts } = await openApproval(open, { body: { ok: false, error: "ssn_required", message: "Enter a valid 9-digit Social Security number." }, status: 400 });
  await fillPerson(page);
  await page.locator("#go").click();
  await waitFor(() => posts.length === 1);
  await page.waitForSelector("#msg .err");
  assert.equal(await page.locator("#msg .err").innerText(), "Enter a valid 9-digit Social Security number.");
  assert.equal(await page.locator(".btn-pay").count(), 0);
  assert.equal(await page.locator("h1").innerText(), "Approve your soft-pull assessment");
  assert.equal(await page.locator("#go").isDisabled(), false, "the person can fix it and send again");
  await page.close();
});

test("a save with no checkout shows the saved consent and the total to ask for, never a dead Pay button", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts } = await openApproval(open, SAVED(4200, "$42", null));
  await fillPerson(page);
  await page.locator("#add_biz").click();
  await fillBusiness(page, 0);
  await page.locator("#go").click();
  await waitFor(() => posts.length === 1);
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Consent saved");
  assert.equal(await page.locator(".btn-pay").count(), 0);
  assert.match(await page.locator(".lede").first().innerText(), /Ask your advisor for the pay link for \$42\./);
  await page.close();
});
