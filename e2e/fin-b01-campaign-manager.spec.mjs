// Campaign manager: the eleven controls that steer a partner's real ad money
// (finish-the-853, batch 01). Each one is pressed against fake answers and judged
// on the exact request it sends and the words it paints.
//
//   needs-attention tiles (4) · partner select · drawer: Change daily budget,
//   Stop spending, Start spending again · Sync Meta now · Request Meta agency
//   access · Link box Save this link
//
// NO BACKEND: page.route() answers /api/**. Nothing reaches Meta.
import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const PARTNER_A = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
const PARTNER_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CAMP_1 = "c1c1c1c1-0000-4000-8000-000000000001";
const CAMP_2 = "c2c2c2c2-0000-4000-8000-000000000002";
const CAMP_3 = "c3c3c3c3-0000-4000-8000-000000000003";
const AD_1 = "ad1ad1ad-0000-4000-8000-000000000001";
const ASSET_1 = "a5a5a5a5-0000-4000-8000-000000000001";

const items = (rows) => ({ ok: true, count: rows.length, limit: 200, offset: 0, hasMore: false, items: rows });

const CAMPAIGNS = [
  { id: CAMP_1, name: "Funding spring push", platform: "meta", offer_type: "funding", approval_state: "live", budget_cents: 10000, spend_yesterday_cents: 4200, roas_7d: 2.1, ad_set_count: 1, ad_count: 2, last_error: null, has_disclosure_asset: false, status: "ACTIVE", synced_at: "2026-10-13T10:00:00Z", created_at: "2026-09-01T10:00:00Z", approved_at: "2026-09-02T10:00:00Z", strategy_key: null, special_ad_category: "CREDIT", targeting: {} },
  { id: CAMP_2, name: "Repair retargeting", platform: "meta", offer_type: "credit_repair", approval_state: "paused", budget_cents: 5000, spend_yesterday_cents: 0, roas_7d: null, ad_set_count: 1, ad_count: 1, last_error: "Ad account is disabled", has_disclosure_asset: false, status: "PAUSED", synced_at: null, created_at: "2026-09-03T10:00:00Z", approved_at: null, strategy_key: null, special_ad_category: null, targeting: {} },
  { id: CAMP_3, name: "Mastery cold", platform: "meta", offer_type: "funding", approval_state: "live", budget_cents: null, spend_yesterday_cents: 100, roas_7d: 1.2, ad_set_count: 0, ad_count: 0, last_error: "Token expired", has_disclosure_asset: true, status: "ACTIVE", synced_at: null, created_at: "2026-09-04T10:00:00Z", approved_at: null, strategy_key: null, special_ad_category: null, targeting: {} },
];
const SPEND = [
  { scope: "partner", campaign_name: null, platform: null, daily_limit_cents: 50000, spend_today_cents: 50000, breached_at: "2026-10-13T08:00:00Z", max_daily_increase_pct: 20 },
  { scope: "campaign", campaign_name: "Funding spring push", platform: "meta", daily_limit_cents: 20000, spend_today_cents: 1000, breached_at: null, max_daily_increase_pct: 20 },
];
const LOG = [
  { id: "l1", created_at: "2026-10-13T09:00:00Z", actor: "agent", agent_name: "Optimizer", rule_key: "kill_switch_ceiling", target_type: "campaign", target_id: CAMP_1, reason: "Ceiling hit", before: { status: "ACTIVE" }, after: { status: "PAUSED" }, executed_at: null, execute_error: null, revertible: false },
  { id: "l2", created_at: "2026-10-13T09:10:00Z", actor: "human", user_name: "Jordan", rule_key: null, target_type: "campaign", target_id: CAMP_2, reason: "Pause by hand", before: {}, after: {}, executed_at: "2026-10-13T09:10:01Z", execute_error: "Meta refused", revertible: false },
  { id: "l3", created_at: "2026-10-13T09:20:00Z", actor: "human", user_name: "Jordan", rule_key: null, target_type: "campaign", target_id: CAMP_3, reason: "Budget", before: {}, after: {}, executed_at: "2026-10-13T09:20:01Z", execute_error: null, revertible: false },
];
const CONNECTIONS = [
  { id: "k1", platform: "meta", external_ad_account_id: "act_1", external_business_id: "biz1", connection_state: "active", platform_verification_state: "verified", has_access_token: true, token_expired: false, token_expires_at: "2027-01-01T00:00:00Z", has_refresh_token: true, last_synced_at: "2026-10-13T10:00:00Z", campaign_count: 3, can_launch: true, can_launch_credit_offer: true, blockers: [], last_error: null },
  { id: "k2", platform: "meta", external_ad_account_id: "act_2", external_business_id: null, connection_state: "pending", platform_verification_state: "unverified", has_access_token: false, token_expired: false, token_expires_at: null, has_refresh_token: false, last_synced_at: null, campaign_count: 0, can_launch: false, can_launch_credit_offer: false, blockers: [{ severity: "blocker", task_key: "verify_business", title: "Verify the business", detail: "Not verified" }], last_error: null },
  { id: "k3", platform: "meta", external_ad_account_id: "act_3", external_business_id: "biz3", connection_state: "active", platform_verification_state: "verified", has_access_token: true, token_expired: false, token_expires_at: "2027-01-01T00:00:00Z", has_refresh_token: true, last_synced_at: null, campaign_count: 1, can_launch: true, can_launch_credit_offer: false, blockers: [{ severity: "warning", task_key: "link_croa_disclosure", title: "Link a disclosure", detail: "Credit offers need one" }], last_error: null },
];
const FATIGUE = [
  { ad_id: AD_1, ad_name: "Hook A", campaign_name: "Funding spring push", platform: "meta", spend_cents: 9000, impressions: 12000, frequency: 3.2, ctr: 1.1, roas: 1.9, last_date: "2026-10-13", rotated_at: null, hours_until_next_rotation: null, recommendation: "refresh" },
];

function base(over = {}) {
  const calls = { list: [], write: [], sync: [], agency: [], link: [], library: [], detail: [], spend: [] };
  const handlers = {
    "/api/read/partners": items([{ id: PARTNER_A, name: "Acme Funding", slug: "acme" }, { id: PARTNER_B, name: "Beta Capital", slug: "beta" }]),
    "/api/campaigns/spend": (route, { url }) => { calls.spend.push(url); return json(route, items(SPEND)); },
    "/api/campaigns/list": (route, { url }) => { calls.list.push(url); return json(route, items(CAMPAIGNS)); },
    "/api/campaigns/fatigue": items(FATIGUE),
    "/api/campaigns/connections": items(CONNECTIONS),
    "/api/campaigns/action-log": items(LOG),
    "/api/campaigns/detail": (route, { url }) => {
      calls.detail.push(url);
      const id = new URL(url).searchParams.get("id");
      const c = CAMPAIGNS.find((x) => x.id === id);
      return json(route, { ok: true, ...c, ad_sets: [], metrics_daily: [], recent_actions: [] });
    },
    "/api/campaigns/write": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      calls.write.push(body);
      return over.write ? over.write(route, body) : json(route, { ok: true, action: body.action });
    },
    "/api/campaigns/sync": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      calls.sync.push(body);
      return over.sync ? over.sync(route, body) : json(route, { ok: true, message: "Pulled in 3 campaigns, 4 ad sets, 6 ads and 21 days of numbers." });
    },
    "/api/campaigns/meta-agency": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      calls.agency.push(body);
      return over.agency ? over.agency(route, body) : json(route, { ok: true, message: "Saved. Partner admin must Approve once in Meta Business Settings → Requests." });
    },
    "/api/campaigns/link-asset": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      calls.link.push(body);
      return over.link ? over.link(route, body) : json(route, {
        ok: true, ad: { fundhub_ad_number: body.fundhub_ad_number || null, asset_id: body.asset_id || null },
        spine: { script_type: "vsl", lane: "funding", angle_key: "second_chance", hook_key: null, offer_key: null },
      });
    },
    "/api/creative/library": (route, { url }) => {
      calls.library.push(url);
      return json(route, items([{ id: ASSET_1, kind: "video", format: "9x16", created_at: "2026-10-01T00:00:00Z", copy_text: "Second chance hook" }]));
    },
    ...(over.extra || {}),
  };
  return { calls, handlers };
}

async function open(page, { partner = PARTNER_A, over = {} } = {}) {
  const b = base(over);
  await openScreen(page, `/app/campaign-manager.html${partner ? `?partner_id=${partner}` : ""}`, OWNER, b.handlers);
  if (partner) await expect(page.locator("#campRows tr.rowbtn")).toHaveCount(3, { timeout: 10_000 });
  return b;
}

const tile = (page, title) => page.locator("#attnRow button", { hasText: title });

test.describe("campaign manager: needs-attention tiles", () => {
  test("each tile counts its own read: 1 limit hit, 2 changes not carried out, 2 connections stuck, 2 campaigns in error", async ({ page }) => {
    await open(page);
    await expect(tile(page, "Daily limits already hit").locator(".an")).toHaveText("1");
    await expect(tile(page, "Changes that did not go through").locator(".an")).toHaveText("2");
    await expect(tile(page, "Connections that cannot go live").locator(".an")).toHaveText("2");
    await expect(tile(page, "Campaigns with an error on them").locator(".an")).toHaveText("2");
  });

  test("Daily limits already hit: pressing it filters the limits table to the breached one", async ({ page }) => {
    await open(page);
    await expect(page.locator("#spendRows tr")).toHaveCount(2);
    await tile(page, "Daily limits already hit").click();
    await expect(page.locator("#spendRows tr")).toHaveCount(1);
    await expect(page.locator("#spendRows tr")).toContainText("partner");
    await expect(page.locator("#spendRows tr")).toContainText("breached");
  });

  test("Changes that did not go through: pressing it filters the action log to the two that failed or never ran", async ({ page }) => {
    await open(page);
    await expect(page.locator("#logRows tr")).toHaveCount(3);
    await tile(page, "Changes that did not go through").click();
    await expect(page.locator("#logRows tr")).toHaveCount(2);
    await expect(page.locator("#logRows")).toContainText("Ceiling hit");
    await expect(page.locator("#logRows")).toContainText("Pause by hand");
    await expect(page.locator("#logRows")).not.toContainText("Budget");
  });

  test("Connections that cannot go live: counts a connection that cannot launch and one with a blocker, not the clean one", async ({ page }) => {
    await open(page);
    await expect(tile(page, "Connections that cannot go live").locator(".an")).toHaveText("2");
    await tile(page, "Connections that cannot go live").click();
    await expect(page.locator("#connRows tr")).toHaveCount(3);
    await expect(page.locator("#connRows")).toContainText("Verify the business");
  });

  test("Campaigns with an error on them: pressing it shows every campaign again, with the two errors in the platform's own words", async ({ page }) => {
    await open(page);
    await tile(page, "Campaigns with an error on them").click();
    await expect(page.locator("#campRows")).toContainText("Ad account is disabled");
    await expect(page.locator("#campRows")).toContainText("Token expired");
  });

  test("a read that failed shows no number and no all-clear on its tile", async ({ page }) => {
    await open(page, {
      over: { extra: { "/api/campaigns/spend": (route) => json(route, { ok: false, error: "query_failed" }, 500) } },
    });
    const limits = tile(page, "Daily limits already hit");
    await expect(limits.locator(".an")).not.toHaveText("0");
    await expect(limits.locator(".an")).not.toHaveText("1");
    await expect(limits.locator(".ad")).toContainText("could not reach the data");
    // The tiles that did read still show their own counts.
    await expect(tile(page, "Changes that did not go through").locator(".an")).toHaveText("2");
  });
});

test.describe("campaign manager: partner select", () => {
  test("with no partner chosen nothing is read, and choosing one sends partner_id on every read", async ({ page }) => {
    const b = base();
    await openScreen(page, "/app/campaign-manager.html", OWNER, b.handlers);
    await expect(page.locator("#scopeName")).toHaveText("No partner selected");
    expect(b.calls.list).toEqual([]);
    await expect(page.locator("#partnerSel option")).toHaveText(["Choose a partner", "Acme Funding", "Beta Capital"]);
    await page.locator("#partnerSel").selectOption(PARTNER_B);
    await expect(page).toHaveURL(new RegExp(`partner_id=${PARTNER_B}`));
    await expect(page.locator("#scopeName")).toHaveText("Beta Capital");
    await expect.poll(() => b.calls.list.length).toBeGreaterThan(0);
    for (const url of [...b.calls.list, ...b.calls.spend]) {
      expect(new URL(url, "http://x").searchParams.get("partner_id")).toBe(PARTNER_B);
    }
  });

  test("switching to another partner re-reads for that partner, not the first", async ({ page }) => {
    const b = await open(page, { partner: PARTNER_A });
    await expect(page.locator("#scopeName")).toHaveText("Acme Funding");
    await page.locator("#partnerSel").selectOption(PARTNER_B);
    await expect(page.locator("#scopeName")).toHaveText("Beta Capital");
    const last = b.calls.list[b.calls.list.length - 1];
    expect(new URL(last, "http://x").searchParams.get("partner_id")).toBe(PARTNER_B);
  });
});

async function openDrawer(page, over) {
  const b = await open(page, { over });
  await page.locator(`#campRows tr[data-c="${CAMP_1}"]`).click();
  await expect(page.locator("#drawer")).toHaveClass(/\bon\b/);
  await expect(page.locator('[data-cw="pause"]')).toBeEnabled();
  // The drawer paints twice: once from the list row, once when the detail read lands,
  // and the second paint rebuilds the budget box. Wait for the second so a typed
  // value is never wiped by it.
  await expect(page.locator("#dwSub")).toHaveText("last 30 days");
  // A success line is replaced by the drawer's hint a moment later (the page reads the
  // detail again), so record every sentence the line holds and judge those.
  await page.evaluate(() => {
    window.__cwSeen = [];
    const note = () => {
      const el = document.getElementById("cwMsg");
      if (el && el.textContent) window.__cwSeen.push(el.textContent);
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  return b;
}

test.describe("campaign manager: drawer controls that change Meta", () => {
  test("Stop spending asks first, names the campaign, and sends pause for that campaign and partner", async ({ page }) => {
    const b = await openDrawer(page);
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); d.accept(); });
    await page.locator('[data-cw="pause"]').click();
    await expect.poll(() => b.calls.write.length).toBe(1);
    expect(asked).toContain("Stop spending on “Funding spring push” on Meta?");
    expect(b.calls.write[0]).toEqual({ campaign_id: CAMP_1, action: "pause", reason: "campaign-manager drawer", partner_id: PARTNER_A });
    await expect.poll(() => page.evaluate(() => window.__cwSeen)).toContain("Meta has stopped spending on this campaign.");
  });

  test("Stop spending answered No sends nothing and says so", async ({ page }) => {
    const b = await openDrawer(page);
    page.once("dialog", (d) => d.dismiss());
    await page.locator('[data-cw="pause"]').click();
    await expect(page.locator("#cwMsg")).toHaveText("Nothing was sent — you cancelled.");
    expect(b.calls.write).toEqual([]);
  });

  test("Start spending again asks first, names the campaign, and sends resume", async ({ page }) => {
    const b = await openDrawer(page);
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); d.accept(); });
    await page.locator('[data-cw="resume"]').click();
    await expect.poll(() => b.calls.write.length).toBe(1);
    expect(asked).toContain("Start spending on “Funding spring push” again on Meta?");
    expect(b.calls.write[0].action).toBe("resume");
    expect(b.calls.write[0].campaign_id).toBe(CAMP_1);
    await expect.poll(() => page.evaluate(() => window.__cwSeen)).toContain("Meta is spending on this campaign again.");
  });

  test("Change daily budget sends the typed cents, and the question shows the old and the new amount", async ({ page }) => {
    const b = await openDrawer(page);
    await expect(page.locator("#cwBudget")).toHaveValue("10000");
    await page.locator("#cwBudget").fill("25000");
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); d.accept(); });
    await page.locator('[data-cw="update_budget"]').click();
    await expect.poll(() => b.calls.write.length).toBe(1);
    expect(asked).toContain("to 250.00?");
    expect(asked).toContain("It is now 100.00.");
    expect(b.calls.write[0]).toEqual({ campaign_id: CAMP_1, action: "update_budget", reason: "campaign-manager drawer", partner_id: PARTNER_A, budget_cents: 25000 });
    await expect.poll(() => page.evaluate(() => window.__cwSeen)).toContain("Meta has the new daily budget.");
  });

  test("a drawer refresh keeps the typed daily budget until it is sent", async ({ page }) => {
    const b = await openDrawer(page);
    await page.locator("#cwBudget").fill("30000");
    await page.locator('#dwMetrics button[data-m="impressions"]').click();
    await expect(page.locator("#cwBudget")).toHaveValue("30000");
    page.once("dialog", (d) => d.accept());
    await page.locator('[data-cw="update_budget"]').click();
    await expect.poll(() => b.calls.write.length).toBe(1);
    expect(b.calls.write[0].budget_cents).toBe(30000);
  });

  test("a daily budget under 100 cents is refused on the page: no question, nothing sent", async ({ page }) => {
    const b = await openDrawer(page);
    await page.locator("#cwBudget").fill("50");
    let dialogs = 0;
    page.on("dialog", (d) => { dialogs += 1; d.dismiss(); });
    await page.locator('[data-cw="update_budget"]').click();
    await expect(page.locator("#cwMsg")).toHaveText("Enter a daily budget of at least 100 cents.");
    expect(dialogs).toBe(0);
    expect(b.calls.write).toEqual([]);
  });

  test("a budget the server refuses says Nothing changed on Meta, with the server's reason", async ({ page }) => {
    const b = await openDrawer(page, {
      write: (route) => json(route, { ok: false, error: "guardrail", message: "That is more than 20% over today's budget." }, 409),
    });
    await page.locator("#cwBudget").fill("90000");
    page.once("dialog", (d) => d.accept());
    await page.locator('[data-cw="update_budget"]').click();
    await expect(page.locator("#cwMsg")).toHaveText("Nothing changed on Meta. That is more than 20% over today's budget.");
    expect(b.calls.write).toHaveLength(1);
  });
});

test.describe("campaign manager: Sync Meta now and Request Meta agency access", () => {
  test("Sync Meta now with no partner is off and says to pick one", async ({ page }) => {
    const b = base();
    await openScreen(page, "/app/campaign-manager.html", OWNER, b.handlers);
    await expect(page.locator("#syncMetaBtn")).toBeDisabled();
    await expect(page.locator("#syncMetaMsg")).toContainText("Pick a partner first");
    expect(b.calls.sync).toEqual([]);
  });

  test("Sync Meta now sends the partner, paints the server's own sentence, and reads the panels again", async ({ page }) => {
    const b = await open(page);
    const before = b.calls.list.length;
    await page.locator("#syncMetaBtn").click();
    await expect.poll(() => b.calls.sync.length).toBe(1);
    expect(b.calls.sync[0]).toEqual({ partner_id: PARTNER_A });
    await expect(page.locator("#syncMetaMsg")).toHaveText("Pulled in 3 campaigns, 4 ad sets, 6 ads and 21 days of numbers.");
    await expect.poll(() => b.calls.list.length).toBeGreaterThan(before);
  });

  test("a sync that fails says so in the server's words and does not read the panels again", async ({ page }) => {
    const b = await open(page, {
      over: { sync: (route) => json(route, { ok: false, error: "meta_down", message: "Meta did not answer. Nothing was saved." }, 502) },
    });
    const before = b.calls.list.length;
    await page.locator("#syncMetaBtn").click();
    await expect(page.locator("#syncMetaMsg")).toHaveText("Meta did not answer. Nothing was saved.");
    expect(b.calls.list.length).toBe(before);
  });

  test("Request agency access: a blank Business ID sends nothing", async ({ page }) => {
    const b = await open(page);
    await page.locator("#metaActId").fill("act_999");
    await page.locator("#metaAgencyBtn").click();
    await expect(page.locator("#metaAgencyMsg")).toHaveText("Paste the partner Meta Business ID first.");
    expect(b.calls.agency).toEqual([]);
  });

  test("Request agency access sends the typed business id, the partner and the typed ad account", async ({ page }) => {
    const b = await open(page);
    await page.locator("#metaBizId").fill("  1234567890  ");
    await page.locator("#metaActId").fill("act_555");
    await page.locator("#metaAgencyBtn").click();
    await expect.poll(() => b.calls.agency.length).toBe(1);
    expect(b.calls.agency[0]).toEqual({ meta_business_id: "1234567890", partner_id: PARTNER_A, ad_account_id: "act_555" });
    await expect(page.locator("#metaAgencyMsg")).toContainText("Partner admin must Approve once in Meta Business Settings");
  });

  test("Request agency access with no ad account leaves that key out, and a refusal is said as nothing saved", async ({ page }) => {
    const b = await open(page, {
      over: { agency: (route) => json(route, { ok: false, message: "That Business ID is not valid." }, 400) },
    });
    await page.locator("#metaBizId").fill("1234567890");
    await page.locator("#metaAgencyBtn").click();
    await expect.poll(() => b.calls.agency.length).toBe(1);
    expect(b.calls.agency[0]).toEqual({ meta_business_id: "1234567890", partner_id: PARTNER_A });
    await expect(page.locator("#metaAgencyMsg")).toHaveText("Nothing was saved. That Business ID is not valid.");
  });
});

test.describe("campaign manager: the link box (Save this link)", () => {
  async function openLink(page, over) {
    const b = await open(page, { over });
    await page.locator(`[data-link-ad="${AD_1}"]`).click();
    await expect(page.locator("#linkBox")).toBeVisible();
    await expect(page.locator("#linkAsset option")).toHaveCount(2);
    return b;
  }

  test("pressing Label on an ad opens the box for that ad and reads this partner's creatives", async ({ page }) => {
    const b = await openLink(page);
    await expect(page.locator("#linkWho")).toContainText("Hook A");
    expect(new URL(b.calls.library[0], "http://x").searchParams.get("partner_id")).toBe(PARTNER_A);
  });

  test("Save with both a creative and our number sends both, with the ad's own id and the partner", async ({ page }) => {
    const b = await openLink(page);
    await page.locator("#linkAsset").selectOption(ASSET_1);
    await page.locator("#linkNumber").fill("43");
    await page.locator("#linkSaveBtn").click();
    await expect.poll(() => b.calls.link.length).toBe(1);
    expect(b.calls.link[0]).toEqual({ ad_id: AD_1, partner_id: PARTNER_A, asset_id: ASSET_1, fundhub_ad_number: "43" });
    await expect(page.locator("#linkMsg")).toContainText("Saved. Our number for this ad is 43. A creative is linked to it.");
    await expect(page.locator("#linkMsg")).toContainText("It now carries these labels: vsl, funding, second_chance.");
  });

  test("a blank field is left out of the request, never sent as an empty string", async ({ page }) => {
    const b = await openLink(page);
    await page.locator("#linkNumber").fill("77");
    await page.locator("#linkSaveBtn").click();
    await expect.poll(() => b.calls.link.length).toBe(1);
    expect(b.calls.link[0]).toEqual({ ad_id: AD_1, partner_id: PARTNER_A, fundhub_ad_number: "77" });
    expect("asset_id" in b.calls.link[0]).toBe(false);
  });

  test("a creative with no number leaves the number out of the request, never an empty string", async ({ page }) => {
    const b = await openLink(page);
    await page.locator("#linkAsset").selectOption(ASSET_1);
    await page.locator("#linkSaveBtn").click();
    await expect.poll(() => b.calls.link.length).toBe(1);
    expect(b.calls.link[0]).toEqual({ ad_id: AD_1, partner_id: PARTNER_A, asset_id: ASSET_1 });
    expect("fundhub_ad_number" in b.calls.link[0]).toBe(false);
  });

  test("nothing typed and nothing picked sends nothing", async ({ page }) => {
    const b = await openLink(page);
    await page.locator("#linkSaveBtn").click();
    await expect(page.locator("#linkMsg")).toHaveText("Nothing was sent. Pick a creative, type our ad number, or both.");
    expect(b.calls.link).toEqual([]);
  });

  test("a refusal is shown as Nothing was saved, with the endpoint's own sentence", async ({ page }) => {
    const b = await openLink(page, {
      link: (route) => json(route, { ok: false, error: "number_taken", message: "that number is already on another ad." }, 409),
    });
    await page.locator("#linkNumber").fill("43");
    await page.locator("#linkSaveBtn").click();
    await expect(page.locator("#linkMsg")).toHaveText("Nothing was saved. That number is already on another ad.");
    expect(b.calls.link).toHaveLength(1);
    await expect(page.locator("#linkSaveBtn")).toBeEnabled();
  });
});

/* ═══ Repair cycle 1: the holes an independent checker found ═════════════════════════════════════
   Each block below was written for a break that stayed green: a tile counting the wrong list, a
   tile that hides a read that failed, a money button that goes out after "No", a button whose words
   sit on the wrong action, a link box that prints what was typed instead of what was saved, and an
   agency request whose server sentence is thrown away. */

const CAMP_4 = "c4c4c4c4-0000-4000-8000-000000000004";
const CAMP_5 = "c5c5c5c5-0000-4000-8000-000000000005";
const row = (id, name, over = {}) => ({
  id, name, platform: "meta", offer_type: "funding", approval_state: "live", budget_cents: 10000, spend_yesterday_cents: 100,
  roas_7d: 1.1, ad_set_count: 1, ad_count: 1, last_error: null, has_disclosure_asset: false, status: "ACTIVE",
  synced_at: null, created_at: "2026-09-05T10:00:00Z", approved_at: null, strategy_key: null, special_ad_category: null, targeting: {},
  ...over,
});
// Four campaigns carry an error, one is clean.
const CAMPS_X = [
  row(CAMP_1, "Alpha", { last_error: "Ad account is disabled" }),
  row(CAMP_2, "Bravo", { last_error: "Token expired", approval_state: "paused", status: "PAUSED" }),
  row(CAMP_3, "Charlie", { last_error: "Payment method declined" }),
  row(CAMP_4, "Delta", { last_error: "Creative rejected", approval_state: "paused", status: "PAUSED" }),
  row(CAMP_5, "Echo"),
];
// Three changes did not go through: one never ran, two ran and were refused. One is clean.
const LOG_X = [
  { id: "x1", created_at: "2026-10-13T09:00:00Z", actor: "agent", agent_name: "Optimizer", rule_key: "kill_switch_ceiling", target_type: "campaign", target_id: CAMP_1, reason: "Never ran", before: {}, after: {}, executed_at: null, execute_error: null, revertible: false },
  { id: "x2", created_at: "2026-10-13T09:10:00Z", actor: "human", user_name: "Jordan", rule_key: null, target_type: "campaign", target_id: CAMP_2, reason: "Refused one", before: {}, after: {}, executed_at: "2026-10-13T09:10:01Z", execute_error: "Meta refused", revertible: false },
  { id: "x3", created_at: "2026-10-13T09:20:00Z", actor: "human", user_name: "Jordan", rule_key: null, target_type: "campaign", target_id: CAMP_3, reason: "Went through", before: {}, after: {}, executed_at: "2026-10-13T09:20:01Z", execute_error: null, revertible: false },
  { id: "x4", created_at: "2026-10-13T09:30:00Z", actor: "agent", agent_name: "Optimizer", rule_key: null, target_type: "campaign", target_id: CAMP_4, reason: "Refused two", before: {}, after: {}, executed_at: "2026-10-13T09:30:01Z", execute_error: "Budget too low", revertible: false },
];

/* The four tiles read four different lists. With the shipped fixtures three of them held the same
   number, so a tile could count the wrong list and still say the right thing. Here no two match:
   limits 1 · changes not through 3 · connections stuck 2 · campaigns in error 4. */
async function openTiles(page, extra = {}) {
  const b = base({ extra: { "/api/campaigns/list": items(CAMPS_X), "/api/campaigns/action-log": items(LOG_X), ...extra } });
  await openScreen(page, `/app/campaign-manager.html?partner_id=${PARTNER_A}`, OWNER, b.handlers);
  await expect(page.locator("#attnRow button")).toHaveCount(4);
  return b;
}
const TILES = {
  limits: "Daily limits already hit",
  changes: "Changes that did not go through",
  conns: "Connections that cannot go live",
  errors: "Campaigns with an error on them",
};

test.describe("campaign manager: needs-attention tiles, four different counts", () => {
  test("each tile counts its own list: limits 1, changes not through 3, connections stuck 2, campaigns in error 4", async ({ page }) => {
    await openTiles(page);
    await expect(tile(page, TILES.limits).locator(".an")).toHaveText("1");
    await expect(tile(page, TILES.changes).locator(".an")).toHaveText("3");
    await expect(tile(page, TILES.conns).locator(".an")).toHaveText("2");
    await expect(tile(page, TILES.errors).locator(".an")).toHaveText("4");
  });

  // One read fails at a time. Its tile shows no number and no all-clear; the other three keep their counts.
  const READS = [
    ["Daily limits already hit", "/api/campaigns/spend", { limits: null, changes: "3", conns: "2", errors: "4" }],
    ["Changes that did not go through", "/api/campaigns/action-log", { limits: "1", changes: null, conns: "2", errors: "4" }],
    ["Connections that cannot go live", "/api/campaigns/connections", { limits: "1", changes: "3", conns: null, errors: "4" }],
    ["Campaigns with an error on them", "/api/campaigns/list", { limits: "1", changes: "3", conns: "2", errors: null }],
  ];
  for (const [title, endpoint, want] of READS) {
    test(`when the read behind "${title}" fails, only that tile loses its number, and it is not shown as 0`, async ({ page }) => {
      await openTiles(page, { [endpoint]: (route) => json(route, { ok: false, error: "query_failed" }, 500) });
      const blank = tile(page, title);
      await expect(blank.locator(".ad")).toContainText("could not reach the data");
      // An em dash, never 0 and never a count: a failed read must not look like an all-clear.
      await expect(blank.locator(".an")).toHaveText("—");
      for (const [key, expected] of Object.entries(want)) {
        if (expected === null) continue;
        await expect(tile(page, TILES[key]).locator(".an")).toHaveText(expected);
      }
    });
  }

  test("Campaigns with an error on them: from a narrowed list, pressing it brings every campaign back", async ({ page }) => {
    await openTiles(page);
    await page.locator('#campRail button[data-v="paused"]').click();
    await expect(page.locator("#campRows tr.rowbtn")).toHaveCount(2);
    await tile(page, TILES.errors).click();
    await expect(page.locator("#campRows tr.rowbtn")).toHaveCount(5);
    await expect(page.locator('#campRail button[data-v="all"]')).toHaveAttribute("aria-pressed", "true");
  });

  test("Connections that cannot go live: from a narrowed list, pressing it shows every connection, with the blockers", async ({ page }) => {
    await openTiles(page);
    await page.locator('#connRail button[data-v="pending"]').click();
    await expect(page.locator("#connRows tr")).toHaveCount(1);
    await tile(page, TILES.conns).click();
    await expect(page.locator("#connRows tr")).toHaveCount(3);
    await expect(page.locator('#connRail button[data-v="all"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#connRows")).toContainText("Verify the business");
  });

  test("Changes that did not go through: from another filter, pressing it shows exactly the three that failed or never ran", async ({ page }) => {
    await openTiles(page);
    await page.locator('#logRail button[data-v="agent"]').click();
    await expect(page.locator("#logRows tr")).toHaveCount(2);
    await tile(page, TILES.changes).click();
    await expect(page.locator("#logRows tr")).toHaveCount(3);
    await expect(page.locator("#logRows")).toContainText("Never ran");
    await expect(page.locator("#logRows")).toContainText("Refused one");
    await expect(page.locator("#logRows")).toContainText("Refused two");
    await expect(page.locator("#logRows")).not.toContainText("Went through");
  });
});

test.describe("campaign manager: drawer money buttons, the No answer, the words, the floor", () => {
  test("Start spending again answered No sends nothing and says so", async ({ page }) => {
    const b = await openDrawer(page);
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
    await page.locator('[data-cw="resume"]').click();
    await expect(page.locator("#cwMsg")).toHaveText("Nothing was sent — you cancelled.");
    expect(asked).toContain("Start spending on “Funding spring push” again on Meta?");
    expect(b.calls.write).toEqual([]);
  });

  test("Change daily budget answered No sends nothing and says so", async ({ page }) => {
    const b = await openDrawer(page);
    await page.locator("#cwBudget").fill("25000");
    let asked = "";
    page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
    await page.locator('[data-cw="update_budget"]').click();
    await expect(page.locator("#cwMsg")).toHaveText("Nothing was sent — you cancelled.");
    expect(asked).toContain("to 250.00?");
    expect(b.calls.write).toEqual([]);
  });

  test("a daily budget of exactly 100 cents is accepted and asked about, and 99 is refused", async ({ page }) => {
    const b = await openDrawer(page);
    await page.locator("#cwBudget").fill("99");
    let dialogs = 0;
    page.on("dialog", (d) => { dialogs += 1; d.accept(); });
    await page.locator('[data-cw="update_budget"]').click();
    await expect(page.locator("#cwMsg")).toHaveText("Enter a daily budget of at least 100 cents.");
    expect(dialogs).toBe(0);
    expect(b.calls.write).toEqual([]);
    await page.locator("#cwBudget").fill("100");
    await page.locator('[data-cw="update_budget"]').click();
    await expect.poll(() => b.calls.write.length).toBe(1);
    expect(b.calls.write[0].budget_cents).toBe(100);
    expect(dialogs).toBe(1);
  });

  test("each drawer button says what it does: the words on a button and the action it sends belong together", async ({ page }) => {
    const b = await openDrawer(page);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Stop spending", exact: true }).click();
    await expect.poll(() => b.calls.write.length).toBe(1);
    expect(b.calls.write[0].action).toBe("pause");
    await page.getByRole("button", { name: "Start spending again", exact: true }).click();
    await expect.poll(() => b.calls.write.length).toBe(2);
    expect(b.calls.write[1].action).toBe("resume");
    await page.locator("#cwBudget").fill("30000");
    await page.getByRole("button", { name: "Change daily budget", exact: true }).click();
    await expect.poll(() => b.calls.write.length).toBe(3);
    expect(b.calls.write[2].action).toBe("update_budget");
    expect(b.calls.write[2].budget_cents).toBe(30000);
    await expect(page.getByLabel("New daily budget, in cents")).toBeVisible();
  });

  for (const [action, name] of [["pause", "Stop spending"], ["resume", "Start spending again"]]) {
    test(`${name} refused by the server says Nothing changed on Meta, with the reason, and never says it worked`, async ({ page }) => {
      const b = await openDrawer(page, { write: (route) => json(route, { ok: false, error: "meta_down", message: "Meta did not answer." }, 502) });
      page.once("dialog", (d) => d.accept());
      await page.locator(`[data-cw="${action}"]`).click();
      await expect(page.locator("#cwMsg")).toHaveText("Nothing changed on Meta. Meta did not answer.");
      expect(b.calls.write).toHaveLength(1);
      expect(b.calls.write[0].action).toBe(action);
      const seen = await page.evaluate(() => window.__cwSeen);
      expect(seen).not.toContain("Meta has stopped spending on this campaign.");
      expect(seen).not.toContain("Meta is spending on this campaign again.");
    });
  }
});

test.describe("campaign manager: link box, what was saved is what is printed", () => {
  async function openLinkBox(page, over) {
    const b = await open(page, { over });
    await page.locator(`[data-link-ad="${AD_1}"]`).click();
    await expect(page.locator("#linkBox")).toBeVisible();
    await expect(page.locator("#linkAsset option")).toHaveCount(2);
    return b;
  }

  test("the number printed is the one the server saved and read back, not the one that was typed", async ({ page }) => {
    await openLinkBox(page, {
      link: (route) => json(route, { ok: true, ad: { fundhub_ad_number: "0044", asset_id: null }, spine: { script_type: "vsl", lane: "funding", angle_key: null, hook_key: null, offer_key: null } }),
    });
    await page.locator("#linkNumber").fill("43");
    await page.locator("#linkSaveBtn").click();
    await expect(page.locator("#linkMsg")).toContainText("Our number for this ad is 0044.");
    await expect(page.locator("#linkMsg")).not.toContainText("43");
  });

  test("a creative picked but not saved by the server is not claimed as linked", async ({ page }) => {
    await openLinkBox(page, {
      link: (route) => json(route, { ok: true, ad: { fundhub_ad_number: "43", asset_id: null }, spine: { script_type: null, lane: null, angle_key: null, hook_key: null, offer_key: null } }),
    });
    await page.locator("#linkAsset").selectOption(ASSET_1);
    await page.locator("#linkNumber").fill("43");
    await page.locator("#linkSaveBtn").click();
    await expect(page.locator("#linkMsg")).toContainText("Saved. Our number for this ad is 43.");
    await expect(page.locator("#linkMsg")).not.toContainText("A creative is linked to it.");
    await expect(page.locator("#linkMsg")).toContainText("It still carries no labels: no creative is linked to it yet.");
  });

  test("a creative that has no script on it says it still carries no labels, and why", async ({ page }) => {
    await openLinkBox(page, {
      link: (route) => json(route, { ok: true, ad: { fundhub_ad_number: null, asset_id: ASSET_1 }, spine: { script_type: null, lane: null, angle_key: null, hook_key: null, offer_key: null } }),
    });
    await page.locator("#linkAsset").selectOption(ASSET_1);
    await page.locator("#linkSaveBtn").click();
    await expect(page.locator("#linkMsg")).toContainText("A creative is linked to it.");
    await expect(page.locator("#linkMsg")).toContainText("It still carries no labels: the creative it points at has no script on it.");
    await expect(page.locator("#linkMsg")).not.toContainText("Our number for this ad");
  });

  test("when the labels could not be read back it says so, and claims no label", async ({ page }) => {
    await openLinkBox(page, {
      link: (route) => json(route, { ok: true, ad: { fundhub_ad_number: "43", asset_id: ASSET_1 }, spine: null }),
    });
    await page.locator("#linkAsset").selectOption(ASSET_1);
    await page.locator("#linkSaveBtn").click();
    await expect(page.locator("#linkMsg")).toContainText("The labels could not be read back just now.");
    await expect(page.locator("#linkMsg")).not.toContainText("It now carries these labels");
  });

  test("the number is trimmed before it is sent", async ({ page }) => {
    const b = await openLinkBox(page);
    await page.locator("#linkNumber").fill("   43   ");
    await page.locator("#linkSaveBtn").click();
    await expect.poll(() => b.calls.link.length).toBe(1);
    expect(b.calls.link[0].fundhub_ad_number).toBe("43");
  });

  test("a number of spaces only is nothing typed: nothing is sent", async ({ page }) => {
    const b = await openLinkBox(page);
    await page.locator("#linkNumber").fill("    ");
    await page.locator("#linkSaveBtn").click();
    await expect(page.locator("#linkMsg")).toHaveText("Nothing was sent. Pick a creative, type our ad number, or both.");
    expect(b.calls.link).toEqual([]);
  });

  test("a second press while it is saving sends nothing: one write, the button off and saying Saving", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const b = await openLinkBox(page, {
      link: async (route, body) => {
        await held;
        return json(route, { ok: true, ad: { fundhub_ad_number: body.fundhub_ad_number, asset_id: null }, spine: null });
      },
    });
    await page.locator("#linkNumber").fill("43");
    await page.locator("#linkSaveBtn").click();
    await expect(page.locator("#linkSaveBtn")).toBeDisabled();
    await expect(page.locator("#linkSaveBtn")).toHaveText("Saving…");
    await page.locator("#linkSaveBtn").click({ force: true });
    await page.waitForTimeout(250);
    expect(b.calls.link).toHaveLength(1);
    release();
    await expect(page.locator("#linkSaveBtn")).toBeEnabled();
    await expect(page.locator("#linkSaveBtn")).toHaveText("Save this link");
    expect(b.calls.link).toHaveLength(1);
  });
});

test.describe("campaign manager: Request Meta agency access, the server's sentence and the re-read", () => {
  const SERVER_SAYS = "Saved in CRM as pending. Meta Graph could not complete the request, so a person has to approve it.";

  test("the sentence the server answered with is the one painted, not the page's own fallback", async ({ page }) => {
    await open(page, { over: { agency: (route) => json(route, { ok: true, message: SERVER_SAYS }) } });
    await page.locator("#metaBizId").fill("1234567890");
    await page.locator("#metaAgencyBtn").click();
    await expect(page.locator("#metaAgencyMsg")).toHaveText(SERVER_SAYS);
  });

  test("a good request reads the panels again; a refused one does not", async ({ page }) => {
    const ok = await open(page);
    const before = ok.calls.list.length;
    await page.locator("#metaBizId").fill("1234567890");
    await page.locator("#metaAgencyBtn").click();
    await expect.poll(() => ok.calls.agency.length).toBe(1);
    await expect.poll(() => ok.calls.list.length).toBeGreaterThan(before);
  });

  test("a refused request does not read the panels again", async ({ page }) => {
    const b = await open(page, { over: { agency: (route) => json(route, { ok: false, message: "That Business ID is not valid." }, 400) } });
    const before = b.calls.list.length;
    await page.locator("#metaBizId").fill("1234567890");
    await page.locator("#metaAgencyBtn").click();
    await expect(page.locator("#metaAgencyMsg")).toHaveText("Nothing was saved. That Business ID is not valid.");
    await page.waitForTimeout(300);
    expect(b.calls.list.length).toBe(before);
  });

  test("the ad account is trimmed before it is sent", async ({ page }) => {
    const b = await open(page);
    await page.locator("#metaBizId").fill("1234567890");
    await page.locator("#metaActId").fill("   act_555   ");
    await page.locator("#metaAgencyBtn").click();
    await expect.poll(() => b.calls.agency.length).toBe(1);
    expect(b.calls.agency[0].ad_account_id).toBe("act_555");
  });

  test("an ad account of spaces only is left out of the request", async ({ page }) => {
    const b = await open(page);
    await page.locator("#metaBizId").fill("1234567890");
    await page.locator("#metaActId").fill("     ");
    await page.locator("#metaAgencyBtn").click();
    await expect.poll(() => b.calls.agency.length).toBe(1);
    expect("ad_account_id" in b.calls.agency[0]).toBe(false);
  });

  test("with no partner chosen the request button sends nothing and says to pick one", async ({ page }) => {
    const b = base();
    await openScreen(page, "/app/campaign-manager.html", OWNER, b.handlers);
    await page.locator("#metaBizId").fill("1234567890");
    await page.locator("#metaAgencyBtn").click();
    await expect(page.locator("#metaAgencyMsg")).toHaveText("Nothing was sent. Pick a partner first.");
    expect(b.calls.agency).toEqual([]);
  });
});
