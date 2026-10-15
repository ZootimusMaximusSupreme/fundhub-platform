// Finish-853 batch 15, repair cycle 1: the Settings tab's funnel card, every box pressed on the real page.
//
//   Settings: funnel card: name, landing page, lane select (funding600, premium, sorting, uwiq, wl, slo,
//   unknown), ad button select, weight, Running checkbox, 'books a call' checkbox, mix of 6 script kinds
//
// What can and cannot be read from saved data. The marketing_funnels table itself refuses a blank name, a
// landing page that is not https, a lane that is not one of the seven (an enum), a weight below zero and a
// blank ad button, so the live check on this row (fin-b15-display-contracts.mjs mkt-settings-funnel-card)
// judges the three things the table does not guard: the mix, the default ad set, and a campaign on two
// funnels. What the saved row can NOT say is whether the card sent what Chris typed: Running inverted, the
// wrong lane, a weight that lost its decimal. Those are judged here, on the exact request the card sends.
//
// A practice test: a real page in Chromium, fake /api answers, no live data. The campaign and ad set parts
// of the card are held by e2e/marketing-cc-settings.spec.mjs; this file adds every other box.

import { test, expect } from "@playwright/test";
import { OWNER, json, wireApi, withSession } from "./harness.mjs";
import { exampleResponse } from "../src/marketing/api-contract.mjs";

const PAGE = "/app/marketing-command-center.html#settings";
// 15:04:05 UTC is 8:04 AM in Arizona.
const NOW = "2026-10-12T15:04:05Z";

test.use({ timezoneId: "America/Phoenix", locale: "en-US", viewport: { width: 390, height: 844 } });

const save = (page) => page.locator("#setSave");
const SETTINGS = () => exampleResponse("GET marketing/settings").settings;
const FUNNELS = () => exampleResponse("GET marketing/funnels");

async function open(page) {
  const posts = [];
  await page.clock.install({ time: new Date(NOW) });
  await withSession(page, OWNER);
  await wireApi(page, OWNER, {
    "/api/marketing/settings": async (route, { method }) => {
      if (method === "POST") return json(route, { settings: SETTINGS() });
      return json(route, { settings: SETTINGS() });
    },
    "/api/marketing/funnels": async (route, { method }) => {
      if (method === "POST") {
        const sent = JSON.parse(route.request().postData() || "{}");
        posts.push(sent);
        const base = FUNNELS().funnels.find((f) => f.key === sent.funnel.key);
        const { updated_at: _u, ...fields } = sent.funnel;
        return json(route, { funnel: { ...base, ...fields, updated_at: "2026-10-12T15:05:00.000Z" } });
      }
      return json(route, FUNNELS());
    },
    "/api/marketing/health": async (route) => json(route, exampleResponse("GET marketing/health"))
  });
  await page.goto(PAGE);
  // Both reads must be on screen before a box is touched: the settings read paints the whole tab again,
  // and a box typed into before that is typed over.
  await expect(page.locator("#set-days")).toBeVisible();
  await expect(page.locator('[data-funnel="book_call"]')).toBeVisible();
  await expect(save(page)).toBeVisible();
  return { posts };
}

const card = (page) => page.locator('[data-funnel="book_call"]');
const UPDATED_AT = "2026-10-06T18:00:00.000Z";

test("funnel card: every box sends exactly what was typed or picked, and only what changed", async ({ page }) => {
  const { posts } = await open(page);
  await page.locator("#fn-book_call-name").fill("Book a call, version two");
  await page.locator("#fn-book_call-url").fill("https://apply.fundhub.ai/watch-two");
  await page.locator("#fn-book_call-lane").selectOption("uwiq");
  await page.locator("#fn-book_call-cta").selectOption("APPLY_NOW");
  await page.locator("#fn-book_call-weight").fill("2.5");
  await card(page).locator('[data-field="active"]').uncheck();
  await card(page).locator('[data-field="book_call"]').uncheck();
  await page.locator("#fn-book_call-mix-standard").fill("3");
  await page.locator("#fn-book_call-mix-sorting").fill("0");
  await page.locator("#fn-book_call-mix-long").fill("1");
  await expect(card(page).locator(".funnel-hd .chip")).toHaveText("Not running");

  await save(page).click();
  await expect(page.locator("#setSay")).toHaveText("Saved 8:04 AM.");
  expect(posts).toHaveLength(1);
  expect(posts[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(posts[0].funnel).toEqual({
    key: "book_call",
    name: "Book a call, version two",
    landing_url: "https://apply.fundhub.ai/watch-two",
    lane: "uwiq",
    book_call: false,
    active: false,
    format_mix: { standard: 3, long: 1 },
    cta_type: "APPLY_NOW",
    weight: 2.5,
    updated_at: UPDATED_AT
  });
});

test("funnel card: each box alone sends only its own field, with the right word for it", async ({ page }) => {
  const { posts } = await open(page);
  // Each box is tried on a freshly opened tab, so the page's own repaint after a save can never be in the
  // way of the next box (the answer here never changes the saved funnel).
  const one = async (act, expected) => {
    await page.reload();
    await expect(page.locator("#set-days")).toBeVisible();
    await expect(card(page)).toBeVisible();
    await expect(save(page)).toBeDisabled();
    posts.length = 0;
    await act();
    await expect(save(page)).toBeEnabled();
    await save(page).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].funnel).toEqual({ key: "book_call", ...expected, updated_at: UPDATED_AT });
  };
  await one(() => page.locator("#fn-book_call-lane").selectOption("slo"), { lane: "slo" });
  await one(() => card(page).locator('[data-field="book_call"]').uncheck(), { book_call: false });
  await one(() => card(page).locator('[data-field="active"]').uncheck(), { active: false });
  await one(() => page.locator("#fn-book_call-cta").selectOption("SIGN_UP"), { cta_type: "SIGN_UP" });
  await one(() => page.locator("#fn-book_call-weight").fill("0"), { weight: 0 });
  await one(() => page.locator("#fn-book_call-name").fill("Book a call (new)"), { name: "Book a call (new)" });
  await one(() => page.locator("#fn-book_call-url").fill("https://apply.fundhub.ai/other"), { landing_url: "https://apply.fundhub.ai/other" });
  await one(() => page.locator("#fn-book_call-mix-long").fill("4"), { format_mix: { standard: 2, sorting: 1, long: 4 } });
});

test("funnel card: a box that is not allowed is named in words, the old value stays, and nothing is sent", async ({ page }) => {
  const { posts } = await open(page);
  await page.locator("#fn-book_call-name").fill("   ");
  await page.locator("#fn-book_call-url").fill("http://apply.fundhub.ai/watch");
  await page.locator("#fn-book_call-weight").fill("-1");
  await save(page).click();
  await expect(page.locator("#setSay")).toContainText("Did not save.");
  await expect(card(page).locator("#fn-book_call-name")).toHaveAttribute("aria-invalid", "true");
  await expect(card(page)).toContainText("The funnel needs a name, up to 120 letters.");
  await expect(card(page)).toContainText("must be a full web address that starts with https://");
  await expect(card(page)).toContainText("must be a number, 0 or more");
  await expect(page.locator("#fn-book_call-url")).toHaveValue("http://apply.fundhub.ai/watch");
  expect(posts).toEqual([]);

  // A mix that is every kind at zero is refused as a changed mix, and the same card still saves a box next to it.
  await page.locator("#fn-book_call-name").fill("Book a call");
  await page.locator("#fn-book_call-url").fill("https://apply.fundhub.ai/watch");
  await page.locator("#fn-book_call-weight").fill("1");
  await page.locator("#fn-book_call-mix-standard").fill("0");
  await page.locator("#fn-book_call-mix-sorting").fill("0");
  await save(page).click();
  await expect(card(page)).toContainText("needs numbers, 0 or more, with at least one above 0");
  expect(posts).toEqual([]);
});
