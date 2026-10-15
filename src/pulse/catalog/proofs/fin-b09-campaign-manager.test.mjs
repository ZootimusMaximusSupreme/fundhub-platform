// Practice test (real page, fake /api answers) for the sixteen Campaign Manager controls in batch 09:
// the campaign filters (approval rail, platform, offer, limit, pager), the row click and the drawer
// (close, Days), the connection rail, the action log (state rail, target, rule), the two group-by
// rails and the window select, and the Connect ClickFunnels form.
// The expected rows are worked out in this file from the fake data, not copied from the page.
// It reads no live data. Each row is claimed only inside the callback that asserts it.

import assert from "node:assert/strict";
import test from "node:test";

import { bodyOf, json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b09-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const PID = "5c1d8e24-3b7a-4c5e-9a10-6f2b3d4e5a77";
const PLATFORMS = ["meta", "tiktok", "google"];
const OFFERS = ["funding", "credit_cards", "credit_repair"];
const APPROVALS = ["draft", "awaiting_approval", "approved", "live", "paused", "archived"];

// 25 campaigns. Platform, offer and approval state cycle at different speeds so every filter has a
// different answer. The array order is the order the page must keep.
const CAMPAIGNS = Array.from({ length: 25 }, (_, i) => ({
  id: `camp-${String(i + 1).padStart(2, "0")}`,
  name: `Campaign ${String(i + 1).padStart(2, "0")}`,
  platform: PLATFORMS[i % 3],
  offer_type: OFFERS[Math.floor(i / 3) % 3],
  approval_state: APPROVALS[i % 6],
  strategy_key: null, budget_cents: 5000 + i * 100, spend_yesterday_cents: 1000, roas_7d: 1.5,
  ad_set_count: 1, ad_count: 2, has_disclosure_asset: false, status: "ACTIVE", special_ad_category: null,
  created_at: "2026-10-01T10:00:00Z", approved_at: null, synced_at: null, last_error: null,
}));
const namesOf = (rows) => rows.map((c) => c.name);

// 12 actions: who, what was touched, which rule, and whether it was carried out.
const TARGETS = ["campaign", "ad_set", "ad", "creative_asset", "connection", "social_post", "autopilot"];
const RULES = ["scale_winner", "cpa_over_target", "cpa_recovering", "frequency_bands", "ctr_below_floor",
  "kill_no_conversions", "kill_switch_ceiling", "learning_phase"];
const ACTIONS = Array.from({ length: 24 }, (_, i) => ({
  id: `act-${String(i + 1).padStart(2, "0")}`,
  created_at: "2026-10-10T10:00:00Z",
  actor: i % 3 === 0 ? "agent" : "human",
  agent_name: "Optimiser", user_name: "Jordan Blake",
  target_type: TARGETS[i % 7], target_id: null, rule_key: RULES[i % 8],
  reason: `Reason ${String(i + 1).padStart(2, "0")}`,
  before: {}, after: {}, metrics_snapshot: {},
  executed_at: i % 5 === 0 ? null : "2026-10-10T10:01:00Z",
  execute_error: i % 7 === 3 ? "Meta said no." : null,
  undone_at: null,
  revertible: i % 4 === 1,
}));
const reasons = (rows) => rows.map((a) => a.reason);

const CONNECTIONS = [
  ["meta", "pending"], ["meta", "active"], ["tiktok", "active"], ["google", "expired"],
  ["meta", "revoked"], ["tiktok", "needs_verification"], ["meta", "active"],
].map(([platform, state], i) => ({
  id: `conn-${i + 1}`, platform, external_ad_account_id: `act_${1000 + i}`, external_business_id: null,
  connection_state: state, platform_verification_state: "approved", has_access_token: true, token_expired: false,
  token_expires_at: "2027-01-01T00:00:00Z", has_refresh_token: true, last_synced_at: null,
  campaign_count: 1, can_launch: true, can_launch_credit_offer: true, blockers: [], last_error: null,
}));

async function openManager({ session = OWNER, detail = null, connect = null, sync = null, query = `?partner_id=${PID}` } = {}) {
  const requests = { detail: [], adBooks: [], spine: [], connect: [], sync: [] };
  const { page, errors } = await screens.open(`/app/campaign-manager.html${query}`, {
    session,
    handlers: {
      "/api/campaigns/list": { ok: true, count: CAMPAIGNS.length, items: CAMPAIGNS },
      "/api/campaigns/spend": { ok: true, items: [] },
      "/api/campaigns/fatigue": { ok: true, items: [] },
      "/api/campaigns/connections": { ok: true, items: CONNECTIONS },
      "/api/campaigns/action-log": { ok: true, items: ACTIONS },
      "/api/campaigns/detail": async (route, { url }) => {
        requests.detail.push(new URL(url).searchParams);
        const id = new URL(url).searchParams.get("id");
        const found = CAMPAIGNS.find((c) => c.id === id);
        return json(route, detail ? detail(found) : { ok: true, ...found, targeting: {}, ad_sets: [], metrics_daily: [], recent_actions: [] });
      },
      "/api/read/ad-books": async (route, { url }) => {
        const group = new URL(url).searchParams.get("group_by");
        requests.adBooks.push(group);
        return json(route, { ok: true, total_leads: 40, total_books: 7, unknown_ad_ids: [],
          groups: [{ key: `${group}:first`, leads: 12, books: 3, first_book_at: null, last_book_at: null }] });
      },
      "/api/read/ad-spine": async (route, { url }) => {
        const q = new URL(url).searchParams;
        requests.spine.push({ group_by: q.get("group_by"), days: q.get("days"), limit: q.get("limit") });
        return json(route, { ok: true, window: { from: "2026-09-01", to: "2026-10-01" }, limit: 200, hasMore: false,
          people_rows_in_window: 5,
          items: [{ key: `${q.get("group_by")}:one`, name: `${q.get("group_by")} one`, ads: 2, ads_reported_in_window: 2,
            spend_cents: 1234, people: 4, people_booked: 1, ad_days_reported: 3 }] });
      },
      "/api/analytics/clickfunnels-connect": async (route) => {
        requests.connect.push(bodyOf(route));
        return json(route, connect || { ok: true });
      },
      "/api/analytics/clickfunnels-sync": async (route) => {
        requests.sync.push(bodyOf(route));
        return json(route, sync || { ok: true });
      },
    },
  });
  await page.waitForFunction(() => /5 of 5 panels loaded/.test(document.querySelector("#footNote").textContent));
  return { page, errors, requests };
}

const campNames = (page) => page.$$eval("#campRows tr.rowbtn td:first-child b", (els) => els.map((e) => e.textContent));
const railOn = (page, rail) => page.$$eval(`${rail} button.on`, (els) => els.map((e) => e.dataset.v));
const railCounts = (page, rail) => page.$$eval(`${rail} button`, (els) => Object.fromEntries(els.map((e) => [e.dataset.v, e.querySelector(".n")?.textContent ?? null])));
const logReasons = (page) => page.$$eval("#logRows tr.rowbtn td:nth-child(5)", (els) => els.map((e) => e.textContent.trim()));

test("Campaign approval-state rail: each state shows its own campaigns, marks itself on, and counts them", async () => {
  await proof.check(/^Campaign approval-state rail/, async () => {
    const { page, errors } = await openManager();
    const expectedCounts = Object.fromEntries(["all", ...APPROVALS].map((s) =>
      [s, String(s === "all" ? CAMPAIGNS.length : CAMPAIGNS.filter((c) => c.approval_state === s).length)]));
    assert.deepEqual(await railCounts(page, "#campRail"), expectedCounts);
    for (const state of ["all", ...APPROVALS]) {
      await page.locator(`#campRail button[data-v="${state}"]`).click();
      const expected = CAMPAIGNS.filter((c) => state === "all" || c.approval_state === state);
      assert.deepEqual(await campNames(page), namesOf(expected).slice(0, 50), `state ${state}`);
      assert.deepEqual(await railOn(page, "#campRail"), [state]);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Campaign Platform select and Offer select each narrow the list, and together they both apply", async () => {
  await proof.check(/^Campaign Platform select/, async () => {
    const { page, errors } = await openManager();
    for (const platform of PLATFORMS) {
      await page.locator("#fPlatform").selectOption(platform);
      assert.deepEqual(await campNames(page), namesOf(CAMPAIGNS.filter((c) => c.platform === platform)), platform);
    }
    await page.locator("#fPlatform").selectOption("all");
    assert.equal((await campNames(page)).length, CAMPAIGNS.length);

    // The platform choice still holds when a state is picked on the rail.
    await page.locator("#fPlatform").selectOption("tiktok");
    await page.locator('#campRail button[data-v="paused"]').click();
    assert.deepEqual(await campNames(page),
      namesOf(CAMPAIGNS.filter((c) => c.platform === "tiktok" && c.approval_state === "paused")));
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Campaign Offer select/, async () => {
    const { page, errors } = await openManager();
    for (const offer of OFFERS) {
      await page.locator("#fOffer").selectOption(offer);
      assert.deepEqual(await campNames(page), namesOf(CAMPAIGNS.filter((c) => c.offer_type === offer)), offer);
    }
    // Platform and offer together: both must hold.
    await page.locator("#fPlatform").selectOption("google");
    await page.locator("#fOffer").selectOption("credit_cards");
    assert.deepEqual(await campNames(page),
      namesOf(CAMPAIGNS.filter((c) => c.platform === "google" && c.offer_type === "credit_cards")));
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Campaign Limit select sets the page size and the pager walks pages without a gap or an overlap", async () => {
  await proof.check(/^Campaign Limit select/, async () => {
    const { page, errors } = await openManager();
    for (const [limit, expected] of [["10", 10], ["25", 25], ["50", 25], ["200", 25]]) {
      await page.locator("#fLimit").selectOption(limit);
      assert.equal((await campNames(page)).length, expected, `limit ${limit}`);
    }
    await page.locator("#fLimit").selectOption("10");
    assert.match(await page.locator("#campPager").innerText(), /showing 1–10 of 25/);
    assert.deepEqual(await campNames(page), namesOf(CAMPAIGNS.slice(0, 10)));
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Campaign pager/, async () => {
    const { page, errors } = await openManager();
    await page.locator("#fLimit").selectOption("10");
    assert.equal(await page.locator("#cPrev").isDisabled(), true, "no Previous on the first page");
    assert.equal(await page.locator("#cNext").isEnabled(), true);

    await page.locator("#cNext").click();
    assert.deepEqual(await campNames(page), namesOf(CAMPAIGNS.slice(10, 20)));
    assert.match(await page.locator("#campPager").innerText(), /showing 11–20 of 25/);
    assert.equal(await page.locator("#cPrev").isEnabled(), true);

    await page.locator("#cNext").click();
    assert.deepEqual(await campNames(page), namesOf(CAMPAIGNS.slice(20, 25)));
    assert.match(await page.locator("#campPager").innerText(), /showing 21–25 of 25/);
    assert.equal(await page.locator("#cNext").isDisabled(), true, "no Next on the last page");

    await page.locator("#cPrev").click();
    assert.deepEqual(await campNames(page), namesOf(CAMPAIGNS.slice(10, 20)));
    // A new filter starts again from the first page.
    await page.locator("#fPlatform").selectOption("meta");
    assert.match(await page.locator("#campPager").innerText(), /showing 1–9 of 9/);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Campaign row click opens the drawer on that campaign and asks for its detail; Enter does the same", async () => {
  await proof.check(/^Campaign row click/, async () => {
    const { page, errors, requests } = await openManager();
    assert.equal(await page.locator("#drawer.on").count(), 0);
    await page.locator('#campRows tr[data-c="camp-04"]').click();
    await waitFor(() => requests.detail.length === 1, "the detail read");
    assert.equal(requests.detail[0].get("id"), "camp-04");
    assert.equal(requests.detail[0].get("days"), "30");
    assert.equal(requests.detail[0].get("partner_id"), PID);
    assert.equal(await page.locator("#drawer.on").count(), 1);
    assert.equal(await page.locator("#dwTitle").innerText(), "Campaign 04");
    assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"), "false");
    assert.equal(await page.locator("#scrim.on").count(), 1);

    // A different row, from the keyboard.
    await page.keyboard.press("Escape");
    await page.locator('#campRows tr[data-c="camp-09"]').focus();
    await page.keyboard.press("Enter");
    await waitFor(() => requests.detail.length === 2, "the second detail read");
    assert.equal(requests.detail[1].get("id"), "camp-09");
    assert.equal(await page.locator("#dwTitle").innerText(), "Campaign 09");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Drawer close: the X, the scrim and the Escape key each shut it", async () => {
  await proof.check(/^Drawer: close/, async () => {
    const { page, errors, requests } = await openManager();
    const shut = async (how) => {
      await page.locator('#campRows tr[data-c="camp-02"]').click();
      await page.waitForSelector("#drawer.on");
      await how();
      await page.waitForFunction(() => !document.querySelector("#drawer").classList.contains("on"));
      assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"), "true");
      assert.equal(await page.locator("#scrim.on").count(), 0);
    };
    await shut(() => page.locator("#dwClose").click());
    await shut(async () => {
      // A point left of the drawer that is the scrim itself (not the sidebar above it).
      const hit = await page.evaluate(() => document.elementFromPoint(420, 450)?.id);
      assert.equal(hit, "scrim", "x=420 is the scrim");
      await page.mouse.click(420, 450);
    });
    await shut(() => page.keyboard.press("Escape"));
    assert.equal(requests.detail.length, 3, "each open read the detail once; closing reads nothing");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Drawer Days select re-reads the detail for that many days and keeps the choice on screen", async () => {
  await proof.check(/^Drawer: Days select/, async () => {
    const { page, errors, requests } = await openManager();
    await page.locator('#campRows tr[data-c="camp-05"]').click();
    await waitFor(() => requests.detail.length === 1, "the first detail read");
    assert.equal(requests.detail[0].get("days"), "30");
    // Wait for the first answer to be painted: until then the page only re-draws on a pick (see the
    // product finding in the batch 09 manifest).
    await page.waitForFunction(() => !/still loading/.test(document.querySelector("#dwSub").innerText));
    assert.deepEqual(await page.locator("#dwDays option").allInnerTexts(), ["7", "14", "30", "90", "180"]);
    let count = 1;
    for (const days of ["7", "90", "180", "14"]) {
      await page.locator("#dwDays").selectOption(days);
      count += 1;
      await waitFor(() => requests.detail.length === count, `the read for ${days} days`);
      const last = requests.detail.at(-1);
      assert.equal(last.get("days"), days);
      assert.equal(last.get("id"), "camp-05", "still the same campaign");
      await page.waitForFunction((d) => document.querySelector("#dwDays").value === d, days);
      assert.match(await page.locator("#dwSub").innerText(), new RegExp(`last ${days} days`));
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Connections state rail shows only that state's connections and counts each", async () => {
  await proof.check(/^Connections state rail/, async () => {
    const { page, errors } = await openManager();
    const states = ["all", "pending", "active", "expired", "revoked", "needs_verification"];
    const rows = () => page.$$eval("#connRows tr td:nth-child(2)", (els) => els.map((e) => e.childNodes[0].textContent.trim()));
    assert.deepEqual(await railCounts(page, "#connRail"), Object.fromEntries(states.map((s) =>
      [s, String(s === "all" ? CONNECTIONS.length : CONNECTIONS.filter((c) => c.connection_state === s).length)])));
    for (const state of states) {
      await page.locator(`#connRail button[data-v="${state}"]`).click();
      const expected = CONNECTIONS.filter((c) => state === "all" || c.connection_state === state).map((c) => c.external_ad_account_id);
      assert.deepEqual(await rows(), expected, `state ${state}`);
      assert.deepEqual(await railOn(page, "#connRail"), [state]);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Action log state rail: agent, human, revertible and failed each keep exactly their own actions", async () => {
  await proof.check(/^Action log state rail/, async () => {
    const { page, errors } = await openManager();
    const failed = (a) => a.execute_error !== null || a.executed_at === null;
    const by = {
      all: () => true,
      agent: (a) => a.actor === "agent",
      human: (a) => a.actor === "human",
      revertible: (a) => a.revertible === true,
      failed,
    };
    assert.deepEqual(await railCounts(page, "#logRail"),
      Object.fromEntries(Object.entries(by).map(([s, f]) => [s, String(ACTIONS.filter(f).length)])));
    for (const [state, keep] of Object.entries(by)) {
      await page.locator(`#logRail button[data-v="${state}"]`).click();
      assert.deepEqual(await logReasons(page), reasons(ACTIONS.filter(keep)), `state ${state}`);
      assert.deepEqual(await railOn(page, "#logRail"), [state]);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Action log Target select keeps only that kind of thing, and works together with the state rail", async () => {
  await proof.check(/^Action log Target select/, async () => {
    const { page, errors } = await openManager();
    for (const target of TARGETS) {
      await page.locator("#fTarget").selectOption(target);
      assert.deepEqual(await logReasons(page), reasons(ACTIONS.filter((a) => a.target_type === target)), target);
    }
    await page.locator("#fTarget").selectOption("campaign");
    await page.locator('#logRail button[data-v="human"]').click();
    assert.deepEqual(await logReasons(page),
      reasons(ACTIONS.filter((a) => a.target_type === "campaign" && a.actor === "human")));
    await page.locator("#fTarget").selectOption("all");
    await page.locator('#logRail button[data-v="all"]').click();
    assert.equal((await logReasons(page)).length, ACTIONS.length);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Action log Rule select keeps only that rule, for every rule in the list", async () => {
  await proof.check(/^Action log Rule select/, async () => {
    const { page, errors } = await openManager();
    const options = await page.$$eval("#fRule option", (els) => els.map((e) => e.value));
    assert.deepEqual(options, ["all", ...RULES]);
    for (const rule of RULES) {
      await page.locator("#fRule").selectOption(rule);
      assert.deepEqual(await logReasons(page), reasons(ACTIONS.filter((a) => a.rule_key === rule)), rule);
    }
    // A rule with nothing under it says so in words rather than showing a blank table.
    await page.locator("#fTarget").selectOption("autopilot");
    await page.locator("#fRule").selectOption("cpa_over_target");
    assert.equal((await logReasons(page)).length, 0, "no autopilot action carries that rule in this data");
    assert.match(await page.locator("#logRows").innerText(), /Nothing here until someone sets a target cost per sale\./);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Ad performance group-by rail: each pick asks the server for that grouping and shows its answer", async () => {
  await proof.check(/^Ad performance group-by rail/, async () => {
    const { page, errors, requests } = await openManager();
    const groups = ["lane", "ad_id", "variant", "gate", "entry", "primary_offer", "secondary_offer"];
    await waitFor(() => requests.adBooks.includes("lane"), "the first read, grouped by lane");
    assert.deepEqual(await railOn(page, "#adBooksRail"), ["lane"]);
    for (const group of groups) {
      await page.locator(`#adBooksRail button[data-v="${group}"]`).click();
      await waitFor(() => requests.adBooks.at(-1) === group, `the read grouped by ${group}`);
      // The page prints the group's key with its underscores opened up.
      await page.waitForFunction((g) => document.querySelector("#adBooksRows").innerText.includes(`${g.replace(/_/g, " ")}:first`), group);
      assert.deepEqual(await railOn(page, "#adBooksRail"), [group]);
      assert.match(await page.locator("#adBooksFoot").innerText(), new RegExp(`1 ${group.replace(/_/g, " ")} group`));
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Angle/hook group-by rail and Window select: each pick re-reads with that grouping and that many days", async () => {
  await proof.check(/^Angle\/hook group-by rail/, async () => {
    const { page, errors, requests } = await openManager();
    await waitFor(() => requests.spine.length >= 1, "the first spine read");
    assert.deepEqual(requests.spine[0], { group_by: "angle", days: "30", limit: "200" });
    assert.deepEqual(await railOn(page, "#spineRail"), ["angle"]);
    for (const group of ["hook", "lane", "offer", "script_type", "angle"]) {
      await page.locator(`#spineRail button[data-v="${group}"]`).click();
      await waitFor(() => requests.spine.at(-1).group_by === group, `the read grouped by ${group}`);
      assert.equal(requests.spine.at(-1).days, "30", "the window is kept when the grouping changes");
      await page.waitForFunction((g) => document.querySelector("#spineRows").innerText.includes(`${g} one`), group);
      assert.deepEqual(await railOn(page, "#spineRail"), [group]);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Angle\/hook Window select/, async () => {
    const { page, errors, requests } = await openManager();
    await waitFor(() => requests.spine.length >= 1, "the first spine read");
    assert.deepEqual(await page.locator("#spineDays option").allInnerTexts(), ["7 days", "14 days", "30 days", "90 days"]);
    await page.locator('#spineRail button[data-v="hook"]').click();
    await waitFor(() => requests.spine.at(-1).group_by === "hook", "the hook read");
    for (const days of ["7", "90", "14"]) {
      await page.locator("#spineDays").selectOption(days);
      await waitFor(() => requests.spine.at(-1).days === days, `the read for ${days} days`);
      assert.equal(requests.spine.at(-1).group_by, "hook", "the grouping is kept when the window changes");
      assert.equal(await page.locator("#spineDays").inputValue(), days);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Connect ClickFunnels needs both boxes, sends them trimmed, clears the key, then syncs", async () => {
  await proof.check(/^Connect ClickFunnels/, async () => {
    const { page, errors, requests } = await openManager();
    // Nothing typed, then only one box: it says so and sends nothing.
    await page.locator("#cfConnectBtn").click();
    assert.equal(await page.locator("#cfConnectMsg").innerText(), "Enter both the API key and the subdomain first.");
    await page.locator("#cfApiKey").fill("cf-test-key-0001");
    await page.locator("#cfConnectBtn").click();
    assert.equal(await page.locator("#cfConnectMsg").innerText(), "Enter both the API key and the subdomain first.");
    assert.equal(requests.connect.length, 0);

    await page.locator("#cfApiKey").fill("  cf-test-key-0001  ");
    await page.locator("#cfSubdomain").fill(" fundhub-demo ");
    await page.locator("#cfConnectBtn").click();
    await waitFor(() => requests.connect.length === 1, "the connect request");
    assert.deepEqual(requests.connect[0], { api_key: "cf-test-key-0001", subdomain: "fundhub-demo" });
    await page.waitForFunction(() => document.querySelector("#cfConnectMsg").innerText === "Connected and synced.");
    assert.equal(await page.locator("#cfApiKey").inputValue(), "", "the key box is emptied once it is saved");
    assert.equal(requests.sync.length, 1, "one sync follows the connect");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Connect ClickFunnels: a refusal is shown in the server's words and the key is kept", async () => {
  const { page, requests } = await openManager({
    connect: { ok: false, error: "bad_key", message: "ClickFunnels did not accept that API key." },
  });
  await page.locator("#cfApiKey").fill("cf-test-key-0002");
  await page.locator("#cfSubdomain").fill("fundhub-demo");
  await page.locator("#cfConnectBtn").click();
  await page.waitForFunction(() => document.querySelector("#cfConnectMsg").innerText === "ClickFunnels did not accept that API key.");
  assert.equal(await page.locator("#cfApiKey").inputValue(), "cf-test-key-0002");
  assert.equal(requests.sync.length, 0, "no sync after a refusal");
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
