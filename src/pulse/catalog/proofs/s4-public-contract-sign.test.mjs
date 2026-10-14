// Proves the public contract signing page (public/contract.html): the signed
// link goes to the server untouched, Sign stays off until a name and the tick
// are in, and pressing Sign (the big button or the sticky bar copy) sends the
// typed name and the tick and then shows the signed record.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const LINK = "?id=7e000000-0000-4000-8000-000000000001&sig=link-signature&exp=1999999999";
const UNSIGNED = {
  title: "Funding Agreement", status: "sent", can_sign: true, verified: true, source_kind: "text",
  body: "This agreement is between Fundhub and the client.", fields: [], signers: [],
  signer: { status: "pending", name: "Dana Whitfield" }, sent_at: "2026-10-08T10:00:00Z",
  signature_statement: "I have read this document and I agree to it. Typing my name here is my signature.",
};
const SIGNED = {
  ...UNSIGNED, status: "signed",
  signer: { status: "signed", name: "Dana Whitfield", signer_name: "Dana Whitfield", signed_at: "2026-10-09T15:30:00Z" },
};

async function openContract(open, { refuse = false } = {}) {
  const gets = [];
  const posts = [];
  const handlers = {
    "/api/contracts/sign": async (route, { method, url }) => {
      if (method === "POST") {
        posts.push(bodyOf(route));
        return json(route, refuse ? { ok: false, message: "That link was already used." } : { ok: true, contract: SIGNED }, refuse ? 409 : 200);
      }
      gets.push(new URL(url).search);
      return json(route, { ok: true, contract: UNSIGNED });
    },
  };
  const opened = await open(`/contract.html${LINK}`, { handlers });
  await opened.page.waitForSelector("#signPanel", { state: "visible" });
  return { ...opened, gets, posts };
}

for (const [row, button] of [[/^Sign: posts the typed name and tick/, "#go"], [/^Sign \(sticky bar copy/, "#barGo"]]) {
  test(`${button}: needs a name and the tick, sends both, and shows the signed record`, { timeout: 60_000 }, async (t) => {
    const { open } = await startScreens(t);
    await proof.check(row, async () => {
      const { page, gets, posts, errors } = await openContract(open);
      assert.deepEqual(gets, [LINK], "the link goes to the server exactly as it came");
      assert.equal(await page.locator("#title").innerText(), "Funding Agreement");
      assert.equal(await page.locator(button).isDisabled(), true, "Sign is off with no name and no tick");
      await page.locator("#name").fill("D");
      await page.locator("#agree").check();
      assert.equal(await page.locator(button).isDisabled(), true, "one letter is not a name");
      await page.locator("#name").fill("Dana Whitfield");
      assert.equal(await page.locator(button).isEnabled(), true);
      await page.locator("#agree").uncheck();
      assert.equal(await page.locator(button).isDisabled(), true, "no tick, no signing");
      await page.locator("#agree").check();
      await page.locator(button).click();
      await waitFor(() => posts.length === 1);
      assert.deepEqual(posts[0], { signer_name: "Dana Whitfield", agreed: true, field_values: {} });
      await page.waitForFunction(() => /This document is signed\. Nothing else is needed from you\./.test(document.querySelector("#doneText")?.innerText || ""));
      assert.match(await page.locator("#doneRecord").innerText(), /Signed by Dana Whitfield/);
      assert.equal(await page.locator("#signPanel").isHidden(), true);
      assert.deepEqual(errors, []);
      await page.close();
    });
  });
}

test("a refused signature is said as not signed and the button comes back", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posts } = await openContract(open, { refuse: true });
  await page.locator("#name").fill("Dana Whitfield");
  await page.locator("#agree").check();
  await page.locator("#go").click();
  await waitFor(() => posts.length === 1);
  await page.waitForFunction(() => /not signed[\s\S]*That link was already used\./i.test(document.querySelector("#msg")?.innerText || ""));
  assert.equal(await page.locator("#go").isEnabled(), true);
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
