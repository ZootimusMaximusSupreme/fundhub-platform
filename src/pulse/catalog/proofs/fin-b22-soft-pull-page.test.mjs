// The client's soft-pull page, page half: a real page in Chromium, a fake /api answer, one form filled in.
// A practice test. It judges the two draft-journey steps that are about what the person SEES:
//   "They authorize the soft pull first, then pay, on one page"
//   "After submit the same page shows Pay for that total"
// The server half (consent before link, the exact total) is src/http/fin-b22-soft-pull-flow.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { json, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const TOKEN = { org: "org-1", client: "c-1", exp: "1999999999", sig: "test-signature" };
const LINK = `?org=${TOKEN.org}&client=${TOKEN.client}&exp=${TOKEN.exp}&sig=${TOKEN.sig}`;
const PAGE = `/app/soft-pull-approve.html${LINK}`;
const WORDS = "I authorize a soft credit inquiry. It does not affect my score.";
const READ = {
  ok: true,
  contact: { first_name: "Dana" },
  consent: { valid: false },
  disclosure: { version: "2.1", text: WORDS },
  pricing: { base_cents: 3200, business_addon_cents: 1000, max_businesses: 20, base_display: "$32", business_addon_display: "$10" },
};

// What the person types, and so what the server must be sent.
const TYPED = Object.freeze({
  granted_name: "Dana Whitfield", ssn: "123-45-6789", dob: "1985-04-12",
  address_line1: "12 Main St", city: "Phoenix", state: "AZ", postal_code: "85004",
});

/**
 * The server's own refusals, written the way api/soft-pull-approve.mjs makes them (same codes, same order).
 * A page that stops sending the typed name, the social, the date of birth, the address or the signed link, or
 * that renames a field, gets the same refusal the real server gives: it stays on the form with the reason and
 * no Pay button, so the tests below that wait for "Authorization saved" fail.
 */
function refuse(body) {
  const bad = (status, error, message) => ({ status, body: { ok: false, error, message } });
  for (const key of ["org", "client", "exp", "sig"]) {
    if (String(body[key] ?? "") !== TOKEN[key]) return bad(401, "invalid_or_expired", "This approval link is invalid or has expired.");
  }
  if (String(body.granted_name || "").trim().length < 2) return bad(400, "name_required", "Type your full legal name to approve the soft pull.");
  if (String(body.ssn || "").replace(/\D/g, "").length !== 9) return bad(400, "ssn_required", "Enter a valid 9-digit Social Security number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.dob || "").trim())) return bad(400, "dob_required", "Enter your date of birth as YYYY-MM-DD.");
  const state = String(body.state || "").trim().toUpperCase();
  if (!String(body.address_line1 || "").trim() || !String(body.city || "").trim() || !/^[A-Z]{2}$/.test(state) || !String(body.postal_code || "").trim()) {
    return bad(400, "address_required", "Enter your current street address, city, state, and ZIP.");
  }
  if (!Array.isArray(body.businesses)) return bad(400, "businesses_invalid", "Businesses must be a list.");
  for (const [i, row] of body.businesses.entries()) {
    const n = i + 1;
    if (String(row.name || "").trim().length < 2) return bad(400, "business_name_required", `Business ${n}: enter the business name.`);
    if (!String(row.address_line1 || "").trim() || !String(row.city || "").trim() || !/^[A-Z]{2}$/.test(String(row.state || "").trim().toUpperCase()) || !String(row.postal_code || "").trim()) {
      return bad(400, "business_address_required", `Business ${n}: enter street, city, state, and ZIP.`);
    }
    if (String(row.ein || "").replace(/\D/g, "").length !== 9) return bad(400, "business_ein_required", `Business ${n}: enter the 9-digit EIN.`);
    if (!String(row.incorporated_date || "").trim()) return bad(400, "business_incorporated_required", `Business ${n}: enter when this business was incorporated.`);
  }
  return null;
}

async function openApproval(open, answer) {
  const posts = [];
  const reads = [];
  const handlers = {
    "/api/soft-pull-approve": async (route, { method }) => {
      if (method === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        posts.push(body);
        const refused = refuse(body);
        const out = refused || (typeof answer === "function" ? answer(posts.length) : answer);
        return json(route, out.body, out.status || 200);
      }
      // the page asks with the whole signed link, or the server would never answer it
      const asked = new URL(route.request().url()).searchParams;
      reads.push(Object.fromEntries(asked));
      const whole = ["org", "client", "exp", "sig"].every((key) => asked.get(key) === TOKEN[key]);
      return whole ? json(route, READ) : json(route, { ok: false, error: "invalid_or_expired", message: "link" }, 401);
    },
  };
  const opened = await open(PAGE, { session: null, handlers });
  await opened.page.waitForSelector("#f");
  return { ...opened, posts, reads };
}

async function fillPerson(page) {
  await page.locator("#granted_name").fill(TYPED.granted_name);
  await page.locator("#ssn").fill(TYPED.ssn);
  await page.locator("#dob").fill(TYPED.dob);
  await page.locator("#address_line1").fill(TYPED.address_line1);
  await page.locator("#city").fill(TYPED.city);
  await page.locator("#state").fill(TYPED.state);
  await page.locator("#postal_code").fill(TYPED.postal_code);
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

  // the authorization words on the page are the words the server sent, whole, and the version beside them
  assert.equal(await page.locator(".disc").innerText(), WORDS, "the disclosure text is the server's text");
  assert.match(await page.locator(".card .fine").first().innerText(), /Version 2\.1/);
  assert.match(await page.locator(".card h2").first().innerText(), /Soft pull authorization/);
  assert.equal(await page.locator(".btn-pay").count(), 0, "no Pay button before the form is saved");
  assert.equal(await page.locator('a[href*="pay."], a[href*="checkout"]').count(), 0, "no payment link before the form is saved");
  assert.equal(await page.locator("#go").innerText(), "I agree — submit soft-pull approval");
  const leadText = await page.locator(".lede").first().innerText();
  assert.match(leadText, /You can authorize now, even before your call\./);
  assert.match(leadText, /The pull starts only after your authorization and payment are both on file\./);

  // the page itself orders it: the authorization words, then what happens next with submit before pay
  const order = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      authorize: text.indexOf("Soft pull authorization"),
      next: text.indexOf("What happens next"),
      submitStep: text.indexOf("Your information is sent securely and saved for this authorization."),
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

test("what is sent is what was typed, under the names the server reads, with the whole signed link", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts, reads } = await openApproval(open, SAVED(5200, "$52", "https://pay.example.test/c/typed"));
  assert.equal(reads.length, 1, "the page read its words once, with the whole signed link");
  assert.deepEqual(reads[0], TOKEN);

  await fillPerson(page);
  await page.locator("#add_biz").click();
  await fillBusiness(page, 0);
  await page.locator("#biz_owner_0").fill("Pat Lee");
  await page.locator("#add_biz").click();
  await fillBusiness(page, 1);
  await page.locator("#go").click();
  await waitFor(() => posts.length === 1);
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Authorization saved");

  const sent = posts[0];
  // the signed link, as it was on the page's own address
  for (const key of ["org", "client", "exp", "sig"]) assert.equal(sent[key], TOKEN[key], `${key} went back with the form`);
  // the signature is the typed full name, and the identity fields are the typed values
  assert.deepEqual(
    { granted_name: sent.granted_name, ssn: sent.ssn, dob: sent.dob, address_line1: sent.address_line1, city: sent.city, state: sent.state, postal_code: sent.postal_code },
    TYPED,
  );
  // a company is sent under the names the server reads, with the EIN dashed and the owner carried
  assert.equal(sent.businesses.length, 2);
  assert.deepEqual(sent.businesses[0], {
    name: "Acme 1 LLC", address_line1: "500 Commerce Way", city: "Tempe", state: "AZ", postal_code: "85281",
    ein: "12-3456789", incorporated_date: "2021-03", extra_owner_name: "Pat Lee",
  });
  assert.equal(sent.businesses[1].extra_owner_name, "");
  // the page sends no words of its own for the server to record
  for (const key of Object.keys(sent)) assert.ok(!/consent|disclosure|text|version|method/i.test(key), `the form sent ${key}`);
  await page.close();
});

test("a form that is missing the typed name, the social, the date of birth or the address is refused by the server and shows its reason", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const cases = [
    ["#granted_name", "Dana Whitfield", "name_required", /legal name/],
    ["#ssn", "123-45-6789", "ssn_required", /9-digit Social Security/],
    ["#dob", "1985-04-12", "dob_required", /date of birth/],
  ];
  // The page's own checks stop a blank address. A blank name, social or date of birth is for the server to refuse:
  // the page must not "fix" it by sending something else, and it must not offer Pay on a refused save.
  for (const [selector, , code] of cases) {
    const { page, posts } = await openApproval(open, SAVED(3200, "$32"));
    await fillPerson(page);
    await page.locator(selector).fill("");
    // the browser's own required marker stops an empty required field; clear it so the server's rule is what answers
    await page.evaluate((sel) => { document.querySelector(sel).removeAttribute("required"); document.querySelector("#f").noValidate = true; }, selector);
    await page.locator("#go").click();
    await waitFor(() => posts.length === 1);
    await page.waitForSelector("#msg .err");
    assert.equal(posts[0][selector.slice(1)], "", `${code}: the page sent the blank it was given`);
    assert.equal(await page.locator(".btn-pay").count(), 0, `${code}: no Pay button on a refused save`);
    assert.equal(await page.locator("h1").innerText(), "Approve your soft-pull assessment");
    await page.close();
  }
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

  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Authorization saved");
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
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Authorization saved");
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

test("a save with no checkout shows saved authorization and asks for a payment link, never a dead Pay button", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts } = await openApproval(open, SAVED(4200, "$42", null));
  await fillPerson(page);
  await page.locator("#add_biz").click();
  await fillBusiness(page, 0);
  await page.locator("#go").click();
  await waitFor(() => posts.length === 1);
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Authorization saved");
  assert.equal(await page.locator(".btn-pay").count(), 0);
  assert.match(await page.locator(".pull-progress p").first().innerText(), /Ask your advisor for the payment link\./);
  await page.close();
});
