// /optimize: the intake that is still on the page (finish-the-853, batch 01, repair cycle 1).
//
// The map row reads "Audit intake and Pay for Audit: first name, last name, email, phone, SMS
// consent. Posts to /api/public/optimize ...". Pay for Audit was taken off the page on purpose
// (docs/journeys/optimize-actual.md), and src/pulse/coverage/fin-b01-retired-controls.mjs checks
// the live page for it. The other half of that row is NOT retired: the four boxes and the SMS
// consent box are still shipped, and what a person typed (and whether they ticked SMS) is written
// to sessionStorage `fh_opt`, which the SmartCredit and roadmap hand-offs read. A consent that is
// written down as true when the box was left empty is the break this file exists to catch.
//
// PRACTICE TEST: fake answers, the real shipped page. Nothing is sent anywhere.
import { test, expect } from "@playwright/test";

test.describe.configure({ timeout: 60_000 });

const CONFIG = { ok: true, bookUrl: "https://apply.fundhub.ai/schedule/phonecall", smartCredit: { affiliateUrl: "https://smartcredit.example.test/signup" } };

async function open(page) {
  const requests = [];
  page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
  await page.route("**/api/public/optimize", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONFIG) }));
  await page.route("**/optimize-plan", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>plan</title><p>plan</p>" }));
  await page.route("https://smartcredit.example.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>smartcredit</p>" }));
  await page.goto("/optimize.html");
  await expect(page.locator("#opt")).toBeVisible();
  return { requests };
}

const stored = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("fh_opt") || "null"));

async function typeThem(page, { sms }) {
  await page.locator("#first").fill("Dana");
  await page.locator("#last").fill("Whitfield");
  await page.locator("#email").fill("dana@example.test");
  await page.locator("#phone").fill("(602) 555-0142");
  if (sms) await page.locator("#sms").check();
}

// Stop the SmartCredit link from leaving the page, after the page's own click handler has run.
async function holdTheLink(page) {
  await page.evaluate(() => document.getElementById("go").addEventListener("click", (e) => e.preventDefault()));
}

test.describe("optimize: the intake and the SMS consent that are still on the page", () => {
  test("the four boxes and the SMS consent box are on the page, with the opt-out wording", async ({ page }) => {
    await open(page);
    for (const id of ["first", "last", "email", "phone"]) await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator("#sms")).not.toBeChecked();
    await expect(page.locator(".consent label[for='sms']")).toContainText("Reply STOP to opt out");
  });

  test("Get My Credit Report writes what was typed and sms_consent true when the SMS box was ticked", async ({ page }) => {
    await open(page);
    await typeThem(page, { sms: true });
    await page.locator("#sc-agree").check();
    await holdTheLink(page);
    await page.locator("#go").click();
    expect(await stored(page)).toEqual({
      first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "(602) 555-0142", sms_consent: true,
    });
  });

  test("sms_consent is false when the SMS box was left empty, and the report link still works", async ({ page }) => {
    await open(page);
    await typeThem(page, { sms: false });
    await page.locator("#sc-agree").check();
    await holdTheLink(page);
    await page.locator("#go").click();
    const got = await stored(page);
    expect(got.sms_consent).toBe(false);
    expect(got).toEqual({ first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "(602) 555-0142", sms_consent: false });
  });

  test("unticking the SMS box again writes false, not the earlier true", async ({ page }) => {
    await open(page);
    await typeThem(page, { sms: true });
    await page.locator("#sms").uncheck();
    await page.locator("#sc-agree").check();
    await holdTheLink(page);
    await page.locator("#go").click();
    expect((await stored(page)).sms_consent).toBe(false);
  });

  test("the report link writes nothing until the SmartCredit agreement box is ticked", async ({ page }) => {
    await open(page);
    await typeThem(page, { sms: true });
    await holdTheLink(page);
    await page.locator("#go").click();
    await expect(page.locator("#sc-err")).toBeVisible();
    expect(await stored(page)).toBeNull();
  });

  test("See my roadmap carries the same typed values and the same consent to the next page", async ({ page }) => {
    await open(page);
    await typeThem(page, { sms: true });
    await page.locator("#roadmap").click();
    await page.waitForURL("**/optimize-plan");
    expect(await stored(page)).toEqual({
      first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "(602) 555-0142", sms_consent: true,
    });
  });

  test("See my roadmap with the SMS box empty carries sms_consent false", async ({ page }) => {
    await open(page);
    await typeThem(page, { sms: false });
    await page.locator("#roadmap").click();
    await page.waitForURL("**/optimize-plan");
    expect((await stored(page)).sms_consent).toBe(false);
  });

  test("the page never posts: its only call to the optimize door is the GET for its config", async ({ page }) => {
    const { requests } = await open(page);
    await typeThem(page, { sms: true });
    await page.locator("#sc-agree").check();
    await holdTheLink(page);
    await page.locator("#go").click();
    const optimize = requests.filter((r) => /\/api\/public\/optimize/.test(r.url));
    expect(optimize.length).toBeGreaterThan(0);
    for (const r of optimize) expect(r.method).toBe("GET");
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
  });
});
