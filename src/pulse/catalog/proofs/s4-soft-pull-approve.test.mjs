// Proves the client's soft-pull approval page (public/app/soft-pull-approve.html):
// the signed link is checked first, the wording and price come from the server,
// and a filled form sends the link, the person and each business exactly.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const LINK = "?org=org-1&client=c-1&exp=1999999999&sig=test-signature";
const READ = {
  ok: true,
  contact: { first_name: "Dana" },
  consent: { valid: false },
  disclosure: { version: "2.1", text: "I authorize a soft credit inquiry." },
  pricing: { base_cents: 3200, business_addon_cents: 1000, max_businesses: 20, base_display: "$32", business_addon_display: "$10" },
};

async function openApproval(open, { query = LINK, read = READ, down = false } = {}) {
  const gets = [];
  const posts = [];
  const handlers = {
    "/api/soft-pull-approve": async (route, { method, url }) => {
      if (down) return route.abort();
      if (method === "POST") {
        posts.push(JSON.parse(route.request().postData() || "{}"));
        return json(route, { ok: true, pricing: { total_display: "$42" }, checkout: { checkout_url: "https://pay.example.test/c/abc", amount_display: "$42" } });
      }
      gets.push(new URL(url).search);
      return json(route, read, read.ok ? 200 : 410);
    },
  };
  // The client opens this from a link in a message: no staff or portal login is on the browser.
  const opened = await open(`/app/soft-pull-approve.html${query}`, { session: null, handlers });
  return { ...opened, gets, posts };
}

async function fillPerson(page, { street = "12 Main St" } = {}) {
  await page.locator("#granted_name").fill("Dana Whitfield");
  await page.locator("#ssn").fill("123-45-6789");
  await page.locator("#dob").fill("1985-04-12");
  await page.locator("#address_line1").fill(street);
  await page.locator("#city").fill("Phoenix");
  await page.locator("#state").fill("AZ");
  await page.locator("#postal_code").fill("85004");
}

async function fillBusiness(page, i, { ein = "123456789", incorporated = "2021-03" } = {}) {
  await page.locator(`#biz_name_${i}`).fill(`Acme ${i + 1} LLC`);
  await page.locator(`#biz_line1_${i}`).fill("500 Commerce Way");
  await page.locator(`#biz_city_${i}`).fill("Tempe");
  await page.locator(`#biz_state_${i}`).fill("AZ");
  await page.locator(`#biz_zip_${i}`).fill("85281");
  await page.locator(`#biz_ein_${i}`).fill(ein);
  if (incorporated) await page.locator(`#biz_inc_${i}`).fill(incorporated);
}

test("the signed link is read first; the wording, price and name come from the server", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Page open: verifies the signed link/, async () => {
    const { page, gets, errors } = await openApproval(open);
    await page.waitForSelector("#f");
    assert.deepEqual(gets, ["?org=org-1&client=c-1&exp=1999999999&sig=test-signature"], "the whole signed link goes to the server");
    assert.match(await page.locator(".lede").first().innerText(), /^Hi Dana\./);
    assert.match(await page.locator("#total_line").innerText(), /Total due: \$32/);
    assert.deepEqual(errors, []);
    await page.close();
  });

  await proof.check(/^Disclosure card: the soft-pull authorization words and version/, async () => {
    const { page } = await openApproval(open, { read: { ...READ, disclosure: { version: "9.9", text: "Words that only the server wrote." } } });
    await page.waitForSelector("#f");
    assert.equal(await page.locator(".disc").innerText(), "Words that only the server wrote.");
    assert.match(await page.locator(".card .fine").first().innerText(), /Version 9\.9/);
    await page.close();
  });
});

test("a link missing a part, or refused by the server, shows a wall and no form", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Link wall: 'This page needs a full link'/, async () => {
    const wall = async (opened, words) => {
      await opened.page.waitForFunction(() => document.querySelector("h1")?.textContent === "Link problem");
      assert.equal(await opened.page.locator(".err").innerText(), words);
      assert.equal(await opened.page.locator("#f").count(), 0, "no form behind a wall");
      await opened.page.close();
    };

    // a link missing any one of its four parts asks the server nothing
    for (const part of ["org", "client", "exp", "sig"]) {
      const query = `?${LINK.slice(1).split("&").filter((pair) => !pair.startsWith(`${part}=`)).join("&")}`;
      const partial = await openApproval(open, { query });
      await partial.page.waitForFunction(() => document.querySelector("h1")?.textContent === "Link problem");
      assert.deepEqual(partial.gets, [], `without ${part} the server is not asked`);
      await wall(partial, "This page needs a full link from your advisor.");
    }

    // a link the server refuses: its own words are shown; with no words, a plain sentence
    for (const read of [
      { ok: false, error: "link_expired", message: "This link has expired." },
      { ok: false, error: "bad_signature", message: "This link is not valid." },
      { ok: false },
    ]) {
      await wall(await openApproval(open, { read }), read.message || "Could not open this link.");
    }

    // no server at all
    await wall(await openApproval(open, { down: true }), "Could not reach the server.");
  });
});

test("the person's boxes and the business boxes are sent exactly, and the total follows the businesses", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts } = await openApproval(open);
  await page.waitForSelector("#f");

  await proof.check(/^Form fields: full legal name, SSN, date of birth/, async () => {
    await fillPerson(page, { street: "   " });
    await page.locator("#go").click();
    assert.equal(await page.locator("#msg .err").innerText(), "Enter your current street address, city, state and ZIP.");
    assert.deepEqual(posts, [], "an address of only spaces sends nothing");
    await fillPerson(page);
  });

  await proof.check(/^Business fields: name, street, city, state, ZIP, EIN/, async () => {
    await page.locator("#add_biz").click();
    assert.match(await page.locator("#total_line").innerText(), /Total due: \$42/);
    await fillBusiness(page, 0, { ein: "12345" });
    await page.locator("#go").click();
    assert.equal(await page.locator("#msg .err").innerText(), "Business 1: enter a 9-digit EIN (you can type 12-3456789).");
    assert.deepEqual(posts, []);
    await fillBusiness(page, 0);
    await page.locator("#go").click();
    await waitFor(() => posts.length === 1);
    assert.deepEqual(posts[0], {
      org: "org-1", client: "c-1", exp: "1999999999", sig: "test-signature",
      granted_name: "Dana Whitfield", ssn: "123-45-6789", dob: "1985-04-12",
      address_line1: "12 Main St", city: "Phoenix", state: "AZ", postal_code: "85004",
      businesses: [{
        name: "Acme 1 LLC", address_line1: "500 Commerce Way", city: "Tempe", state: "AZ", postal_code: "85281",
        ein: "12-3456789", incorporated_date: "2021-03", extra_owner_name: "",
      }],
    });
    await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Consent saved");
    assert.equal(await page.locator(".btn-pay").innerText(), "Pay $42 assessment");
  });
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
