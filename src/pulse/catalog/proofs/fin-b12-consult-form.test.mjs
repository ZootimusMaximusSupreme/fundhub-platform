// Batch 12 practice test: the consult form on /consulting/.
// Practice test means a real page in Chromium and a judgement of exactly what the page does when the
// form is sent. Nothing here reads live data and nothing is sent anywhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startScreens } from "./s4-screen-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);

// ───────────────────────────── consulting form ─────────────────────────────

test("Consult form: it opens an email with the typed words, takes no card, and sends nothing to the server", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Consult request form: name, email, agency, help, note/, async () => {
    const { page, errors } = await open("/consulting/", { session: null, handlers: {} });
    await page.waitForSelector("#consult-form");
    const api = [];
    page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.method() + " " + request.url()); });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.enable");
    const navigations = [];
    cdp.on("Page.frameRequestedNavigation", (event) => navigations.push(event.url));

    // The form asks for exactly five things and nothing that is a card, a password or a number to pay with.
    const fields = await page.evaluate(() => [...document.querySelectorAll("#consult-form input, #consult-form select, #consult-form textarea")]
      .map((el) => `${el.tagName.toLowerCase()}:${el.name}`));
    assert.deepEqual(fields, ["input:name", "input:email", "input:agency", "select:help", "textarea:note"]);
    const sensitive = await page.evaluate(() => [...document.querySelectorAll("#consult-form [autocomplete]")]
      .map((el) => el.getAttribute("autocomplete")).filter((a) => /^cc-|password|card/.test(a)));
    assert.deepEqual(sensitive, []);
    assert.match(await page.locator("#consult-form .fine").innerText(), /Nothing is charged/);

    // The support address on the page is the one the email goes to.
    const address = (await page.locator("#consult-form .fine a[href^='mailto:']").getAttribute("href")).replace(/^mailto:/, "");
    assert.match(address, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);

    // An empty form does not leave the page: the browser holds it on the required boxes.
    await page.locator("#consult-form button[type=submit]").click();
    await page.waitForTimeout(250);
    assert.deepEqual(navigations.filter((u) => u.startsWith("mailto:")), []);

    // A "Ask about" button fills the help box.
    await page.locator('[data-help="Offer tools"]').first().click();
    assert.equal(await page.locator("#help").inputValue(), "Offer tools");

    await page.locator("#name").fill("Dana Whitfield");
    await page.locator("#email").fill("dana@example.com");
    await page.locator("#agency").fill("Whitfield Media");
    await page.locator("#note").fill("We sell through webinars.\nTeam of six.");
    await page.locator("#consult-form button[type=submit]").click();
    const deadline = Date.now() + 5000;
    while (!navigations.some((u) => u.startsWith("mailto:")) && Date.now() < deadline) await page.waitForTimeout(50);
    const mail = navigations.find((u) => u.startsWith("mailto:"));
    assert.ok(mail, "the form opened an email");
    const [to, query] = mail.replace(/^mailto:/, "").split("?");
    assert.equal(to, address, "to the support address shown on the page");
    const parsed = new URLSearchParams(query);
    assert.equal(parsed.get("subject"), "FH Consulting consult — Whitfield Media");
    assert.equal(parsed.get("body"), "Name: Dana Whitfield\nEmail: dana@example.com\nAgency: Whitfield Media\nHelp: Offer tools\n\nWe sell through webinars.\nTeam of six.");
    assert.deepEqual(api, [], "nothing was sent to the server");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
