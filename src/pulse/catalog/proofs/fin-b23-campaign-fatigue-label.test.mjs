// Practice test (fake data, real page): the Label button on each row of the
// creative fatigue panel in campaign-manager.html. It proves the rendered
// control, which the older fatigue test did not: each row's Label button carries
// its own ad, the box names that ad, and the save sends exactly that ad's id.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, json, startPages, waitFor } from "./fin-b23-browser-kit.mjs";

const PARTNER = "partner-proof";
const AD_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const AD_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const ADS = [
  { ad_name: "Hook Alpha", ad_id: AD_A, campaign_name: "Spring Funding", platform: "meta", spend_cents: 12345, impressions: 10000, frequency: 3.25, ctr: 1.5, roas: 2.1, last_date: "2026-10-12", rotated_at: null, hours_until_next_rotation: 6, recommendation: "refresh" },
  { ad_name: "Hook Beta", ad_id: AD_B, campaign_name: "Spring Funding", platform: "meta", spend_cents: 5000, impressions: 4000, frequency: 1.2, ctr: 2.4, roas: 3.3, last_date: "2026-10-12", rotated_at: null, hours_until_next_rotation: null, recommendation: "ok" },
];
const ASSET = { id: "cccccccc-3333-4333-8333-cccccccccccc", kind: "video", format: "9x16", created_at: "2026-10-01T10:00:00Z", copy_text: "Funding in 30 days" };

async function openPanel(open, { saveAnswer = { ok: true, ad: { fundhub_ad_number: "43", asset_id: null }, spine: { script_type: "vsl", lane: "cold" } } } = {}) {
  const posts = [];
  const handlers = {
    "/api/read/partners": { ok: true, items: [{ id: PARTNER, name: "Proof Partner", slug: "proof" }] },
    "/api/campaigns/fatigue": { ok: true, items: ADS },
    "/api/creative/library": { ok: true, items: [ASSET] },
    "/api/campaigns/link-asset": async (route) => {
      posts.push(bodyOf(route));
      return json(route, saveAnswer);
    },
  };
  const opened = await open(`/app/campaign-manager.html?partner_id=${PARTNER}`, { handlers });
  await opened.page.waitForFunction(() => document.querySelector("#fatRows")?.innerText.includes("Hook Beta"));
  return { ...opened, posts };
}

test("each Label button carries its own ad and the save sends exactly that ad", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { page, posts, errors } = await openPanel(open);

  const buttons = page.locator("#fatRows button[data-link-ad]");
  assert.equal(await buttons.count(), 2, "one Label button per ad row");
  assert.deepEqual(await buttons.evaluateAll((els) => els.map((e) => e.getAttribute("data-link-ad"))), [AD_A, AD_B]);
  assert.deepEqual(await buttons.evaluateAll((els) => els.map((e) => e.getAttribute("data-link-name"))), ["Hook Alpha", "Hook Beta"]);
  assert.equal(await page.locator("#linkBox").isVisible(), false, "the link box is closed until Label is pressed");

  // Press Label on the second row: the box opens and names that ad, not the first.
  await buttons.nth(1).click();
  await page.locator("#linkBox").waitFor({ state: "visible" });
  const who = await page.locator("#linkWho").innerText();
  assert.match(who, /Hook Beta/);
  assert.doesNotMatch(who, /Hook Alpha/);

  // Saving with nothing picked says so and sends nothing.
  await page.locator("#linkSaveBtn").click();
  await page.waitForFunction(() => /Nothing was sent\. Pick a creative/.test(document.querySelector("#linkMsg").innerText));
  assert.deepEqual(posts, []);

  // Our ad number only: the second row's full id goes, with the partner, and no asset key.
  await page.locator("#linkNumber").fill("43");
  await page.locator("#linkSaveBtn").click();
  await waitFor(() => posts.length === 1, "the first save");
  assert.deepEqual(posts[0], { ad_id: AD_B, partner_id: PARTNER, fundhub_ad_number: "43" });
  await page.waitForFunction(() => /Saved\. Our number for this ad is 43\./.test(document.querySelector("#linkMsg").innerText));
  assert.match(await page.locator("#linkMsg").innerText(), /It now carries these labels: vsl, cold\./);

  // Press Label on the first row: the box switches to that ad and the typed number is cleared.
  await buttons.nth(0).click();
  await page.waitForFunction(() => /Hook Alpha/.test(document.querySelector("#linkWho").innerText));
  assert.equal(await page.locator("#linkNumber").inputValue(), "");
  await page.locator("#linkAsset").selectOption(ASSET.id);
  await page.locator("#linkSaveBtn").click();
  await waitFor(() => posts.length === 2, "the second save");
  assert.deepEqual(posts[1], { ad_id: AD_A, partner_id: PARTNER, asset_id: ASSET.id });
  assert.deepEqual(errors, []);
  await page.close();
});

test("a refused save is said out loud and nothing is shown as saved", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { page, posts } = await openPanel(open, { saveAnswer: { ok: false, error: "forbidden", message: "not your ad" } });
  await page.locator('#fatRows button[data-link-ad]').first().click();
  await page.locator("#linkNumber").fill("7");
  await page.locator("#linkSaveBtn").click();
  await waitFor(() => posts.length === 1, "the save");
  await page.waitForFunction(() => /Nothing was saved\./.test(document.querySelector("#linkMsg").innerText));
  assert.doesNotMatch(await page.locator("#linkMsg").innerText(), /Saved\./);
  await page.close();
});
