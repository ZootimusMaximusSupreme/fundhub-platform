// Finish-853 batch 15, repair cycle 1: the two Command Center FRAME rows, pressed on the frame's own
// parts and not through the Today tab.
//
//   Frame: 5-minute auto reload, reload on focus, footer 'as of' stamp
//   Frame: tab strip (Today, Ideas, Scripts, Shoot, Launch, Numbers) with hash routing that keeps its place
//
// Why this file exists. The earlier tests of these rows ran through Today, and Today runs its OWN
// 5-minute timer and its OWN focus reload (public/app/marketing-cc-today.js). Today registers no
// refresh(ctx), so the frame's reload (due() in public/app/marketing-command-center.js: a 30 second tick on
// REFRESH_MS, plus visibilitychange and focus on REFOCUS_MS) is never what moves it. That frame reload is
// the ONLY reload Ideas, Scripts, Shoot, Launch and Numbers get. So here it is pressed on a tab that
// registers a refresh(ctx): the probe tab the frame's own spec uses (e2e/helpers/cc-frame-probe.mjs),
// which counts every refresh on window.__probe.
//
// The strip tests press every tab link and read the address it goes to, press a tab with a view inside
// it (#probe/ads), and prove the last tab is remembered for a tab that is not Settings.
//
// A practice test: a real page in Chromium, fake /api answers, no live data.

import { test, expect } from "@playwright/test";
import { OWNER, json, wireApi, withSession } from "./harness.mjs";
import { withProbe } from "./helpers/cc-frame-probe.mjs";

const PAGE = "/app/marketing-command-center.html";
// 19:00 UTC is 12:00 PM in Arizona.
const NOW = "2026-10-05T19:00:00Z";

test.use({ timezoneId: "America/Phoenix", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function openProbe(page, hash = "#probe") {
  await page.clock.install({ time: new Date(NOW) });
  await withSession(page, OWNER);
  await wireApi(page, OWNER, {
    "/api/marketing/probe": async (route) => json(route, { ok: true, word: "Read through ctx.api.", spend_cents: 123456, as_of: NOW }),
    "/api/marketing/costs": async (route) => json(route, { ok: false, error: "not_found" }, 404)
  });
  await withProbe(page);
  await page.goto(PAGE + hash);
  if (hash.startsWith("#probe")) await expect(page.locator("#prWord")).toHaveText("Read through ctx.api.");
  else await expect(page.locator('#mccTabs .tab[data-tab="probe"]')).toHaveText("Probe");
}

const refreshes = (page) => page.evaluate(() => window.__probe.refreshes);

test("the frame's own reload: a tab with refresh() is read again at 5 minutes, on focus after a minute away, on coming back into view, and never while the page is hidden", async ({ page }) => {
  await openProbe(page);
  expect(await refreshes(page), "nothing reads again when the tab first draws").toBe(0);

  // Four and a half minutes: the 30 second beat has fired nine times and read nothing.
  await page.clock.runFor(4 * 60 * 1000 + 30 * 1000);
  expect(await refreshes(page), "no reload before 5 minutes").toBe(0);

  // The 5 minute mark. The 30 second beat was started a moment before the tab drew, so the tab is a
  // few milliseconds short of 5 minutes at the 5:00 beat and is read at the 5:30 beat at the latest.
  await page.clock.runFor(30 * 1000);
  expect(await refreshes(page)).toBeLessThanOrEqual(1);
  await page.clock.runFor(30 * 1000);
  await expect.poll(() => refreshes(page), { message: "the 5 minute reload" }).toBe(1);

  // Back into focus 20 seconds later: inside the minute, so nothing is read.
  await page.clock.runFor(20 * 1000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(300);
  expect(await refreshes(page), "a focus inside a minute of the last read reads nothing").toBe(1);

  // A minute and a second since the last read: a focus reads again.
  await page.clock.runFor(41 * 1000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => refreshes(page), { message: "the reload on focus" }).toBe(2);

  // Coming back into view (visibilitychange) a minute later reads again.
  await page.clock.runFor(61 * 1000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => refreshes(page), { message: "the reload on coming back into view" }).toBe(3);

  // A page that is out of view reads nothing, not even at 5 minutes.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  });
  await page.clock.runFor(5 * 60 * 1000 + 30 * 1000);
  await page.waitForTimeout(300);
  expect(await refreshes(page), "a hidden page is never read").toBe(3);
});

const TABS = ["ideas", "scripts", "shoot", "launch", "numbers"];

test("the frame strip: every tab link goes to its own address, and the gear goes to Settings", async ({ page }) => {
  await openProbe(page, "#today");
  const strip = page.locator("#mccTabs .tab");
  await expect(strip).toHaveText(["Today", "Ideas", "Scripts", "Shoot", "Launch", "Probe", "Numbers"]);
  for (const key of ["today", ...TABS, "probe"]) {
    await expect(page.locator(`#mccTabs .tab[data-tab="${key}"]`)).toHaveAttribute("href", `#${key}`);
  }
  await expect(page.locator("#mccGear .gear")).toHaveAttribute("href", "#settings");

  // Press each one: the address becomes that tab's own, and that tab's panel is the one shown.
  for (const key of TABS) {
    await page.locator(`#mccTabs .tab[data-tab="${key}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${key}$`));
    await expect(page.locator(`#tab-${key}`)).toBeVisible();
    await expect(page.locator(`#mccTabs .tab[data-tab="${key}"]`)).toHaveAttribute("aria-current", "page");
    await expect(page.locator('#mccTabs .tab[aria-current="page"]')).toHaveCount(1);
  }
  await page.locator("#mccGear .gear").click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.locator("#tab-settings")).toBeVisible();
});

test("the frame strip: the last tab is remembered whichever tab it was, and a view inside a tab (#probe/ads) keeps its place", async ({ page }) => {
  await openProbe(page, "#launch");
  await expect(page.locator("#tab-launch")).toBeVisible();
  await expect(page).toHaveURL(/#launch$/);

  // Open the page again with no tab in the link: the last tab comes back, and it is not Settings.
  await page.goto(PAGE);
  await expect(page).toHaveURL(/#launch$/);
  await expect(page.locator("#tab-launch")).toBeVisible();
  await expect(page.locator('#mccTabs .tab[aria-current="page"]')).toHaveText("Launch");

  // A link to a view inside a tab: the tab gets the view, and the address keeps it.
  await page.goto(PAGE + "#probe/ads");
  await expect(page.locator("#prParam")).toHaveText("View: ads");
  await expect(page).toHaveURL(/#probe\/ads$/);
  // A deeper view (a whole view path, not only its first word), opened fresh.
  await page.goto(PAGE + "#probe/ads/91");
  await page.reload();
  await expect(page.locator("#prParam")).toHaveText("View: ads/91");
  await expect(page).toHaveURL(/#probe\/ads\/91$/);
});
