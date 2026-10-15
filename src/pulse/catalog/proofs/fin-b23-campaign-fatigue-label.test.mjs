// Practice test (fake data, real page): the creative fatigue panel in
// campaign-manager.html.
//  - Label: each row's Label button carries its own ad, the box names that ad,
//    and the save sends exactly that ad's id.
//  - The four values and the verdict: every column of every row is read by its
//    own header and judged cell by cell (frequency, CTR, ROAS, next rotation,
//    recommendation badge and row stripe), so two columns swapped, a verdict
//    stuck on one word, or a value cut to the wrong number of decimals is red.

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

async function openPanel(open, { ads = ADS, waitFor: waitText = "Hook Beta", saveAnswer = { ok: true, ad: { fundhub_ad_number: "43", asset_id: null }, spine: { script_type: "vsl", lane: "cold" } } } = {}) {
  const posts = [];
  const handlers = {
    "/api/read/partners": { ok: true, items: [{ id: PARTNER, name: "Proof Partner", slug: "proof" }] },
    "/api/campaigns/fatigue": { ok: true, items: ads },
    "/api/creative/library": { ok: true, items: [ASSET] },
    "/api/campaigns/link-asset": async (route) => {
      posts.push(bodyOf(route));
      return json(route, saveAnswer);
    },
  };
  const opened = await open(`/app/campaign-manager.html?partner_id=${PARTNER}`, { handlers });
  await opened.page.waitForFunction((text) => document.querySelector("#fatRows")?.innerText.includes(text), waitText);
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

// Four ads whose values all differ, so a swap between two columns can never look right.
const SPREAD = [
  { ad_name: "Hook Alpha", ad_id: AD_A, campaign_name: "Spring Funding", platform: "meta", spend_cents: 12345, impressions: 10000, frequency: 3.25, ctr: 1.5, roas: 2.1, last_date: "2026-10-12", rotated_at: null, hours_until_next_rotation: 6, recommendation: "refresh" },
  { ad_name: "Hook Beta", ad_id: AD_B, campaign_name: "Summer Pitch", platform: "tiktok", spend_cents: 5000, impressions: 4000, frequency: 1.2, ctr: 2.4, roas: 3.3, last_date: "2026-10-11", rotated_at: "2026-10-10T08:05:00Z", hours_until_next_rotation: null, recommendation: "ok" },
  { ad_name: "Hook Gamma", ad_id: "dddddddd-4444-4444-8444-dddddddddddd", campaign_name: "Fall Retarget", platform: "meta", spend_cents: 99900, impressions: 250000, frequency: 2.5, ctr: 0.75, roas: 0.8, last_date: "2026-10-09", rotated_at: null, hours_until_next_rotation: 0.5, recommendation: "queue" },
  { ad_name: "Hook Delta", ad_id: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee", campaign_name: "Winter Cold", platform: "tiktok", spend_cents: null, impressions: null, frequency: null, ctr: null, roas: null, last_date: "2026-10-08", rotated_at: null, hours_until_next_rotation: null, recommendation: "unconfigured" },
];
const DASH = "\u2014";

test("every column of every ad shows that ad's own frequency, CTR, ROAS, next rotation and verdict", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { page, errors } = await openPanel(open, { ads: SPREAD, waitFor: "Hook Delta" });

  const headers = await page.locator("#secFatigue thead th").evaluateAll((ths) => ths.map((th) => th.textContent.trim()));
  assert.deepEqual(headers, ["Ad", "Campaign", "Platform", "Spend", "Impressions", "Frequency", "CTR", "ROAS", "Last date", "Rotated", "Next rotation", "Recommendation", "Label"]);

  // Each row, read column by column under its own header.
  const rows = await page.locator("#fatRows tr").evaluateAll((trs, names) => trs.map((tr) => {
    const cells = [...tr.children];
    const byHeader = {};
    names.forEach((name, i) => { byHeader[name] = cells[i].textContent.trim(); });
    byHeader.stripe = ["stripe-bad", "stripe-warn", "stripe-ok"].find((c) => tr.classList.contains(c)) || "";
    byHeader.badge = cells[11].querySelector(".badge").className.split(/\s+/).filter((c) => /^b-/.test(c)).join(" ");
    return byHeader;
  }), headers);

  assert.deepEqual(rows, [
    { Ad: "Hook Alphaad aaaaaaaa\u2026", Campaign: "Spring Funding", Platform: "meta", Spend: "123.45", Impressions: "10,000", Frequency: "3.25", CTR: "1.50%", ROAS: "2.10", "Last date": "Oct 12", Rotated: DASH, "Next rotation": "6.0h", Recommendation: "refresh", Label: "Label\u2026", stripe: "stripe-bad", badge: "b-alert" },
    { Ad: "Hook Betaad bbbbbbbb\u2026", Campaign: "Summer Pitch", Platform: "tiktok", Spend: "50.00", Impressions: "4,000", Frequency: "1.20", CTR: "2.40%", ROAS: "3.30", "Last date": "Oct 11", Rotated: "Oct 10, 2026 08:05", "Next rotation": DASH, Recommendation: "ok", Label: "Label\u2026", stripe: "stripe-ok", badge: "b-ok" },
    { Ad: "Hook Gammaad dddddddd\u2026", Campaign: "Fall Retarget", Platform: "meta", Spend: "999.00", Impressions: "250,000", Frequency: "2.50", CTR: "0.75%", ROAS: "0.80", "Last date": "Oct 09", Rotated: DASH, "Next rotation": "0.5h", Recommendation: "queue", Label: "Label\u2026", stripe: "stripe-warn", badge: "b-warn" },
    { Ad: "Hook Deltaad eeeeeeee\u2026", Campaign: "Winter Cold", Platform: "tiktok", Spend: DASH, Impressions: DASH, Frequency: DASH, CTR: DASH, ROAS: DASH, "Last date": "Oct 08", Rotated: DASH, "Next rotation": DASH, Recommendation: "unconfigured", Label: "Label\u2026", stripe: "", badge: "b-gray" },
  ]);
  assert.equal(await page.locator("#fatFoot").innerText(), "4 of 4 ads with activity in the last 7 days \u00b7 most heavily repeated first");
  assert.deepEqual(errors, []);
  await page.close();
});
