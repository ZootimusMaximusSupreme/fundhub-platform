// Batch 24 (finish the 853), the campaign doors: one campaign's detail, the
// creative-to-ad link, and the Meta pull.
//
// The real api/ handlers, the real partner-scope wrapper, the real sync code, a
// stand-in database that keeps its own rows and answers by the conditions the
// SQL text names, and a stand-in for Meta's address and the phone buzz. Nothing
// leaves the building and no real key is used. This is a PRACTICE TEST with
// fake data. It is not a live check.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before, mock } from "node:test";

import campaignDetail from "../../../../api/campaigns/detail.mjs";
import campaignLinkAsset from "../../../../api/campaigns/link-asset.mjs";
import campaignSync from "../../../../api/campaigns/sync.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { encryptToken } from "../../../adplatforms/tokens.mjs";
import { adAccountDay } from "../../../lib/ad-account-day.mjs";
import { ORG_ID, OTHER_ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const CAMPAIGN = "ca000000-0000-4000-8000-000000000001";
const AD = "ad000000-0000-4000-8000-000000000001";
const ASSET = "ae000000-0000-4000-8000-000000000001";
const CONN = "33000000-0000-4000-8000-000000000003";
const asPartner = { account: { kind: "partner", partnerId: PARTNER } };
const scopeOf = (out) => out.db.calls.find((c) => /set_config\('fundhub\.partner_id'/.test(c.sql));

/* ── campaigns/detail ────────────────────────────────────────────────────── */

const CAMPAIGN_ROW = {
  id: CAMPAIGN, name: "Funding Dream", platform: "meta", status: "ACTIVE", objective: "OUTCOME_LEADS", offer_type: "funding",
  special_ad_category: "CREDIT", budget_cents: 5000, targeting: {}, strategy_key: null, approval_state: "approved",
  approved_at: "2026-10-01T00:00:00.000Z", last_error: null, synced_at: "2026-10-13T08:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z",
  has_disclosure_asset: true,
};

function detailRules({ campaign = CAMPAIGN_ROW } = {}) {
  return [
    [/FROM campaigns c WHERE c\.id = \$1/, (_sql, p) => (campaign && p[0] === CAMPAIGN ? [campaign] : [])],
    [/FROM ad_sets s WHERE s\.campaign_id = \$1/, [
      { id: "as-1", name: "Broad", status: "ACTIVE", budget_cents: 5000, approval_state: "approved", learning_until: null, in_learning_phase: false, ad_count: 3 },
    ]],
    [/FROM ad_metrics_daily m\s+JOIN ads a ON a\.id = m\.ad_id/, [
      { date: "2026-10-12", spend_cents: "1200", impressions: "4000", clicks: "120", conversions: "6", frequency: "1.2", ctr: "3.000000", cpa_cents: "200", roas: null },
      { date: "2026-10-13", spend_cents: "900", impressions: "3000", clicks: "60", conversions: "3", frequency: "1.1", ctr: "2.000000", cpa_cents: "300", roas: null },
    ]],
    [/FROM action_log\s+WHERE target_id = \$1 OR target_id IN/, [
      { id: "al-1", actor: "agent", rule_key: "pause_losers", reason: "CPA too high", before: { status: "ACTIVE" }, after: { status: "PAUSED" }, executed_at: "2026-10-12T05:00:00.000Z", execute_error: null, undone_at: null, created_at: "2026-10-12T05:00:00.000Z", revertible: true },
    ]],
  ];
}

test("campaigns/detail gives one campaign with its ad sets, its daily numbers for the window asked and its recent actions, for the partner on the login", async () => {
  assert.equal(ROUTES["campaigns/detail"], campaignDetail);
  const done = await hit(campaignDetail, { ...asPartner, query: { id: CAMPAIGN, partner_id: OTHER_PARTNER }, rules: detailRules() });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.equal(done.body.id, CAMPAIGN);
  assert.equal(done.body.name, "Funding Dream");
  assert.equal(done.body.approval_state, "approved");
  assert.equal(done.body.has_disclosure_asset, true);
  assert.deepEqual(done.body.ad_sets.map((s) => [s.id, s.ad_count]), [["as-1", 3]]);
  assert.deepEqual(done.body.metrics_daily.map((d) => [d.date, d.spend_cents, d.clicks]), [["2026-10-12", "1200", "120"], ["2026-10-13", "900", "60"]]);
  assert.deepEqual(done.body.recent_actions.map((a) => [a.id, a.rule_key, a.revertible]), [["al-1", "pause_losers", true]]);
  assert.deepEqual(scopeOf(done).params, [PARTNER], "the scope is the partner's own id; the partner_id in the address is ignored");
  const [series] = sqlCalls(done, /FROM ad_metrics_daily m/);
  assert.deepEqual(series.params, [CAMPAIGN, 30], "30 days unless asked for another number");
  assert.match(series.sql, /WHERE a\.campaign_id = \$1 AND m\.date > /);
  assert.match(series.sql, /GROUP BY m\.date ORDER BY m\.date ASC/);
  assert.match(series.sql, /round\(100\.0 \* sum\(m\.clicks\) \/ NULLIF\(sum\(m\.impressions\), 0\), 6\) AS ctr/, "the day's rate is clicks over impressions, not an average of rates");
  assert.deepEqual(sqlCalls(done, /FROM ad_sets s/)[0].params, [CAMPAIGN]);
  assert.deepEqual(sqlCalls(done, /FROM action_log/)[0].params, [CAMPAIGN]);
  assert.match(sqlCalls(done, /FROM action_log/)[0].sql, /ORDER BY created_at DESC LIMIT 50/);

  for (const [days, want] of [["7", 7], ["500", 180], ["0", 30], ["-5", 1], ["abc", 30]]) {
    const out = await hit(campaignDetail, { ...asPartner, query: { id: CAMPAIGN, days }, rules: detailRules() });
    assert.equal(sqlCalls(out, /FROM ad_metrics_daily m/)[0].params[1], want, `days=${days}`);
  }
});

test("campaigns/detail says not found for a campaign the partner cannot see, wants an id, makes staff name a partner, and refuses a client or affiliate login", async () => {
  const gone = await hit(campaignDetail, { ...asPartner, query: { id: CAMPAIGN }, rules: detailRules({ campaign: null }) });
  assert.equal(gone.status, 404);
  assert.equal(gone.body.error, "not_found");
  assert.equal(sqlCalls(gone, /FROM ad_sets/).length, 0, "nothing else is read for a campaign that is not there");

  const noId = await hit(campaignDetail, { ...asPartner, query: {}, rules: detailRules() });
  assert.equal(noId.status, 400);
  assert.equal(noId.body.error, "bad_request");
  const staffAlone = await hit(campaignDetail, { query: { id: CAMPAIGN }, rules: detailRules() });
  assert.equal(staffAlone.status, 400);
  assert.equal(staffAlone.body.error, "partner_id_required");
  const staff = await hit(campaignDetail, { query: { id: CAMPAIGN, partner_id: PARTNER }, rules: detailRules() });
  assert.equal(staff.status, 200);
  assert.deepEqual(scopeOf(staff).params, [PARTNER]);
  for (const kind of ["client", "affiliate"]) {
    const refused = await hit(campaignDetail, { account: { kind, clientId: kind === "client" ? AD : null }, query: { id: CAMPAIGN, partner_id: PARTNER }, rules: detailRules() });
    assert.equal(refused.status, 403, kind);
    assert.equal(sqlCalls(refused, /FROM campaigns c/).length, 0);
  }
  const post = await hit(campaignDetail, { ...asPartner, method: "POST", query: { id: CAMPAIGN }, rules: detailRules() });
  assert.equal(post.status, 405);
});

/* ── campaigns/link-asset: which creative runs on which ad, and the ad number ── */

function linkWorld({ ad = { id: AD, org_id: ORG_ID, partner_id: PARTNER, asset_id: null, fundhub_ad_number: null }, asset = { id: ASSET, org_id: ORG_ID, partner_id: PARTNER }, updateError = null } = {}) {
  const world = { updates: [], ad };
  world.rules = [
    [/FROM ads WHERE id = \$1 AND partner_id = \$2/, (_sql, p) => (world.ad && world.ad.id === p[0] && world.ad.partner_id === p[1] ? [world.ad] : [])],
    [/FROM creative_assets WHERE id = \$1/, (_sql, p) => (asset && asset.id === p[0] ? [asset] : [])],
    [/UPDATE ads SET/, (sql, p) => {
      if (updateError) return updateError;
      world.updates.push({ sql, params: p });
      return [{ id: AD, org_id: ORG_ID, partner_id: PARTNER, asset_id: world.ad.asset_id, fundhub_ad_number: world.ad.fundhub_ad_number, fundhub_ad_number_source: null, external_id: "ext-1", name: "Ad 43" }];
    }],
    [/FROM v_ad_label_spine WHERE ad_row_id = \$1/, [{ ad_row_id: AD, angle_key: "speed_of_money" }]],
  ];
  return world;
}
const link = (world, body, options = {}) => hit(campaignLinkAsset, { ...asPartner, method: "POST", body, rules: world.rules, ...options });

test("campaigns/link-asset sets the creative and our ad number on this partner's ad, each only when its key is sent, and a blank or null clears it", async () => {
  assert.equal(ROUTES["campaigns/link-asset"], campaignLinkAsset);
  const both = linkWorld();
  const done = await link(both, { ad_id: AD, asset_id: ASSET, fundhub_ad_number: "43", partner_id: OTHER_PARTNER });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.equal(done.body.ad.id, AD);
  assert.equal(done.body.spine.angle_key, "speed_of_money", "the label spine row is read back, the proof the link did something");
  const [update] = both.updates;
  assert.match(update.sql, /SET asset_id = \$3, fundhub_ad_number = \$4, fundhub_ad_number_source = \$5, updated_at = now\(\)/);
  assert.match(update.sql, /WHERE id = \$1 AND partner_id = \$2/);
  assert.deepEqual(update.params, [AD, PARTNER, ASSET, "43", "manual"], "the partner is the login's, a typed number is a manual number");
  assert.deepEqual(scopeOf(done).params, [PARTNER]);

  // Only the number: the creative is left alone.
  const onlyNumber = linkWorld();
  await link(onlyNumber, { ad_id: AD, fundhub_ad_number: "91" });
  assert.deepEqual(onlyNumber.updates[0].params, [AD, PARTNER, "91", "manual"]);
  assert.doesNotMatch(onlyNumber.updates[0].sql.split("RETURNING")[0], /asset_id =/);
  // Only the creative: the number is left alone.
  const onlyAsset = linkWorld();
  await link(onlyAsset, { ad_id: AD, asset_id: ASSET });
  assert.deepEqual(onlyAsset.updates[0].params, [AD, PARTNER, ASSET]);
  assert.doesNotMatch(onlyAsset.updates[0].sql.split("RETURNING")[0], /fundhub_ad_number/);
  // null and "" both clear, and clearing the number clears its source too.
  for (const blank of [null, "", "   "]) {
    const clear = linkWorld();
    await link(clear, { ad_id: AD, asset_id: blank, fundhub_ad_number: blank });
    assert.deepEqual(clear.updates[0].params, [AD, PARTNER, null, null, null], JSON.stringify(blank));
  }
});

test("campaigns/link-asset refuses another partner's or company's creative, an ad that is not theirs, and anything that is not a uuid or a number; nothing is written", async () => {
  const cases = [
    [{ asset: { id: ASSET, org_id: ORG_ID, partner_id: OTHER_PARTNER } }, { ad_id: AD, asset_id: ASSET }, 400, "cross_partner"],
    [{ asset: { id: ASSET, org_id: OTHER_ORG_ID, partner_id: PARTNER } }, { ad_id: AD, asset_id: ASSET }, 400, "cross_org"],
    [{ asset: null }, { ad_id: AD, asset_id: ASSET }, 404, "asset_not_found"],
    [{ ad: { id: AD, org_id: ORG_ID, partner_id: OTHER_PARTNER } }, { ad_id: AD, fundhub_ad_number: "43" }, 404, "ad_not_found"],
    [{}, { asset_id: ASSET }, 400, "ad_id_required"],
    [{}, { ad_id: "nope", asset_id: ASSET }, 400, "ad_id_not_a_uuid"],
    [{}, { ad_id: AD }, 400, "nothing_to_set"],
    [{}, { ad_id: AD, asset_id: "nope" }, 400, "asset_id_not_a_uuid"],
    [{}, { ad_id: AD, fundhub_ad_number: "12abc" }, 400, "invalid_ad_number"],
    [{}, { ad_id: AD, fundhub_ad_number: "1234567890" }, 400, "invalid_ad_number"],
  ];
  for (const [options, body, status, error] of cases) {
    const world = linkWorld(options);
    const out = await link(world, body);
    assert.equal(out.status, status, error);
    assert.equal(out.body.error, error);
    assert.equal(world.updates.length, 0, `${error}: nothing written`);
  }
  // The database's own refusals come back as a sentence, not a 500.
  const check = linkWorld({ updateError: Object.assign(new Error("violates check constraint"), { code: "23514" }) });
  const bad = await link(check, { ad_id: AD, fundhub_ad_number: "43" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_ad_number");
  const trigger = linkWorld({ updateError: Object.assign(new Error("creative crosses partners"), { code: "P0001" }) });
  const crossed = await link(trigger, { ad_id: AD, asset_id: ASSET });
  assert.equal(crossed.status, 400);
  assert.equal(crossed.body.error, "cross_partner");

  // Staff name the partner in the body; a client or affiliate login is refused; a GET is a 405.
  const staffAlone = await hit(campaignLinkAsset, { method: "POST", body: { ad_id: AD, fundhub_ad_number: "43" }, rules: linkWorld().rules });
  assert.equal(staffAlone.status, 400);
  assert.equal(staffAlone.body.error, "partner_id_required");
  const staffWorld = linkWorld();
  const staff = await hit(campaignLinkAsset, { method: "POST", body: { ad_id: AD, fundhub_ad_number: "43", partner_id: PARTNER }, rules: staffWorld.rules });
  assert.equal(staff.status, 200);
  assert.deepEqual(scopeOf(staff).params, [PARTNER]);
  for (const kind of ["client", "affiliate"]) {
    const w = linkWorld();
    const out = await hit(campaignLinkAsset, { account: { kind, clientId: kind === "client" ? AD : null }, method: "POST", body: { ad_id: AD, fundhub_ad_number: "43", partner_id: PARTNER }, rules: w.rules });
    assert.equal(out.status, 403, kind);
    assert.equal(w.updates.length, 0);
  }
  const get = await hit(campaignLinkAsset, { ...asPartner, method: "GET", rules: [] });
  assert.equal(get.status, 405);
});

/* ── campaigns/sync: the Meta pull ───────────────────────────────────────── */

const keyName = "AD_TOKEN_ENC_KEY";
const ntfyName = "NTFY_TOPIC";
const fenceName = "MESSAGING_DRY_RUN";
const saved = {};
before(() => {
  for (const k of [keyName, ntfyName, fenceName, "AD_VIDEO_SMS_TO", "PULSE_SMS_TO", "META_API_VERSION"]) saved[k] = process.env[k];
  process.env[keyName] = crypto.randomBytes(32).toString("base64");
  delete process.env.AD_VIDEO_SMS_TO;
  delete process.env.PULSE_SMS_TO;
  delete process.env.META_API_VERSION;
});
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function fakeMeta({ insightsFail = null, dying = false } = {}) {
  const seen = [];
  const fn = async (url) => {
    const u = String(url);
    seen.push(u);
    const respond = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (insightsFail && u.includes("/insights?")) return respond({ error: { message: insightsFail, code: 190 } }, 400);
    if (u.includes("/insights?")) {
      return respond({ data: [{ ad_id: "m-ad-1", date_start: adAccountDay(new Date()), spend: "10.00", impressions: "100", clicks: "5", inline_link_clicks: "4" }] });
    }
    if (u.includes("/campaigns?")) return respond({ data: [{ id: "m-c1", name: "Funding Dream", status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "5000" }] });
    if (u.includes("/adsets?")) return respond({ data: [{ id: "m-s1", name: "Broad", status: "ACTIVE", daily_budget: "5000", campaign_id: "m-c1" }] });
    if (u.includes("/ads?")) return respond({ data: [{ id: "m-ad-1", name: "Ad 43 hook", status: "ACTIVE", adset_id: "m-s1" }] });
    if (/\/12345\?/.test(u)) return respond({ verification_status: "verified" });
    return respond({ data: [] });
  };
  fn.seen = seen;
  fn.dying = dying;
  return fn;
}

function syncWorld({ state = "pending", token = true, account = "act_982103620742368", dyingRows = [] } = {}) {
  const world = {
    connection: {
      id: CONN, org_id: ORG_ID, partner_id: PARTNER, platform: "meta", connection_state: state, last_error: "an old error",
      external_ad_account_id: account, external_business_id: "12345", platform_verification_state: "unverified", last_synced_at: null,
      encrypted_access_token: token ? encryptToken(["fake", "meta", "token"].join("-"), { partnerId: PARTNER }) : null, created_at: "2026-08-01T00:00:00Z",
    },
    writes: [], metrics: [], alerts: [],
  };
  let n = 0;
  world.rules = [
    [/FROM ad_platform_connections\s+WHERE partner_id = \$1 AND platform = 'meta'/, (_sql, p) => (p[0] === PARTNER ? [world.connection] : [])],
    [/FROM pg_attribute/, [{ n: 4 }]],
    [/min\(m\.date\)/, [{ d: null }]],
    [/UPDATE ad_platform_connections\s+SET last_synced_at = now\(\)/, (sql, p) => {
      if (p[0] === CONN) {
        world.connection.last_synced_at = "now";
        world.connection.last_error = null;
        if (/CASE WHEN connection_state = 'pending'\s+THEN 'active'/.test(sql) && world.connection.connection_state === "pending") world.connection.connection_state = "active";
      }
      return [];
    }],
    [/UPDATE ad_platform_connections\s+SET platform_verification_state = \$2/, (_sql, p) => { world.connection.platform_verification_state = p[1]; return []; }],
    [/UPDATE ad_platform_connections SET last_error = \$2 WHERE id = \$1/, (_sql, p) => { world.connection.last_error = p[1]; return []; }],
    [/FROM campaigns WHERE connection_id = \$1 AND external_id = \$2/, []],
    [/INSERT INTO campaigns/, (_sql, p) => { world.writes.push({ table: "campaigns", params: p }); return [{ id: "camp-1" }]; }],
    [/FROM ad_sets WHERE connection_id = \$1 AND external_id = \$2/, []],
    [/INSERT INTO ad_sets/, (_sql, p) => { world.writes.push({ table: "ad_sets", params: p }); return [{ id: "set-1" }]; }],
    [/FROM ads WHERE connection_id = \$1 AND external_id = \$2/, []],
    [/INSERT INTO ads \(/, (_sql, p) => { world.writes.push({ table: "ads", params: p }); return [{ id: "ad-row-1", fundhub_ad_number: null, fundhub_ad_number_source: null }]; }],
    [/^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/, []],
    [/UPDATE ads\s+SET fundhub_ad_number = \$2::text/, (_sql, p) => { world.writes.push({ table: "ads.number", params: p }); return [{ id: p[0], fundhub_ad_number: p[1] }]; }],
    [/INSERT INTO ad_metrics_daily/, (sql, p) => { world.metrics.push({ sql, params: p }); return []; }],
    [/fundhub_reresolve_ad_numbers/, [{ filled: 0 }]],
    [/FROM ads a\s+JOIN LATERAL/, dyingRows],
    [/INSERT INTO ad_watch_curve_alerts/, (_sql, p) => { world.alerts.push(p); return []; }],
  ];
  return world;
}

const NOON_ARIZONA = Date.parse("2026-10-14T19:00:00Z"); // 12:00 in Phoenix, inside the texting window
const DYING_ROW = { ad_id: "ad-row-1", org_id: ORG_ID, partner_id: PARTNER, ad_name: "Ad 43 hook", metric_date: "2026-10-13", video_plays: 1000, video_p25_watched: 200, clicks: 5, link_clicks: null, landing_page_views: null, link_clicks_saved: false };
const HEALTHY_ROW = { ...DYING_ROW, ad_id: "ad-row-2", ad_name: "Ad 7 hook", video_p25_watched: 700 };

test("campaigns/sync pulls the campaign, ad set, ad and daily numbers into this partner's tables, switches a pending connection to active the moment Meta answers, and writes Meta's verification word", async () => {
  assert.equal(ROUTES["campaigns/sync"], campaignSync);
  const world = syncWorld({ state: "pending" });
  const meta = fakeMeta();
  const done = await hit(campaignSync, { ...asPartner, method: "POST", body: { partner_id: OTHER_PARTNER }, deps: { fetch: meta }, rules: world.rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.deepEqual([done.body.connections, done.body.campaigns, done.body.ad_sets, done.body.ads, done.body.insights], [1, 1, 1, 1, 1]);
  assert.deepEqual(done.body.errors, []);
  assert.match(done.body.message, /Pulled in 1 campaign, 1 ad set, 1 ad and 1 day of numbers\./);
  assert.deepEqual(scopeOf(done).params, [PARTNER], "the pull is for the login's partner, not the one in the body");
  assert.equal(world.connection.connection_state, "active", "a pending connection earned active by Meta answering");
  assert.equal(world.connection.last_error, null);
  assert.ok(world.connection.last_synced_at);
  assert.equal(world.connection.platform_verification_state, "approved", "Meta's own word, never awarded by us");

  const campaign = world.writes.find((w) => w.table === "campaigns").params;
  assert.deepEqual([campaign[0], campaign[1], campaign[2], campaign[3], campaign[4]], [ORG_ID, PARTNER, CONN, "m-c1", "Funding Dream"]);
  assert.equal(campaign[8], 5000, "the budget is Meta's number in cents");
  const adSet = world.writes.find((w) => w.table === "ad_sets").params;
  assert.deepEqual([adSet[0], adSet[1], adSet[2], adSet[3], adSet[4]], [ORG_ID, PARTNER, CONN, "camp-1", "m-s1"]);
  const ad = world.writes.find((w) => w.table === "ads").params;
  assert.deepEqual(ad, [ORG_ID, PARTNER, CONN, "camp-1", "set-1", "m-ad-1", "Ad 43 hook", "ACTIVE"]);
  assert.equal(world.metrics.length, 1);
  assert.deepEqual(world.metrics[0].params.slice(0, 8), [ORG_ID, PARTNER, "ad-row-1", adAccountDay(new Date()), 1000, 100, 5, world.metrics[0].params[7]]);
  assert.equal(world.metrics[0].params[4], 1000, "$10.00 of spend is 1,000 cents");
  assert.match(world.metrics[0].sql, /ON CONFLICT \(ad_id, date\) DO UPDATE SET/);
  assert.ok(meta.seen.every((u) => u.startsWith("https://graph.facebook.com/")), "only Meta was asked");
  assert.match(done.body.note, /META_APP_ID/, "the missing app credentials are said out loud");
});

test("campaigns/sync tells the truth when Meta refuses: nothing is counted, a pending connection stays pending with Meta's sentence on it, and the answer is 502", async () => {
  const world = syncWorld({ state: "pending" });
  const done = await hit(campaignSync, { ...asPartner, method: "POST", body: {}, deps: { fetch: fakeMeta({ insightsFail: "Invalid OAuth access token." }) }, rules: world.rules });
  assert.equal(done.status, 502);
  assert.equal(done.body.ok, false);
  assert.equal(done.body.partial, false);
  assert.deepEqual([done.body.campaigns, done.body.ad_sets, done.body.ads, done.body.insights], [0, 0, 0, 0]);
  assert.match(done.body.message, /Nothing was saved/);
  assert.match(done.body.errors[0].error, /Invalid OAuth access token/);
  assert.equal(world.connection.connection_state, "pending", "a refused read earns nothing");
  assert.match(world.connection.last_error, /Invalid OAuth access token/);
  assert.equal(world.writes.length, 0);
  assert.equal(world.metrics.length, 0);
});

test("campaigns/sync says which connection it cannot use and why: expired, no key, no ad account number, or none at all", async () => {
  const cases = [
    [{ state: "expired" }, /is expired\. Reconnect the ad account\./],
    [{ token: false }, /no saved key/],
    [{ account: "pending:biz:123" }, /no ad account number yet/],
  ];
  for (const [options, message] of cases) {
    const world = syncWorld(options);
    const meta = fakeMeta();
    const out = await hit(campaignSync, { ...asPartner, method: "POST", body: {}, deps: { fetch: meta }, rules: world.rules });
    assert.equal(out.status, 400);
    assert.equal(out.body.error, "no_meta_connection");
    assert.match(out.body.message, message);
    assert.equal(meta.seen.length, 0, "Meta is not asked when the row cannot be used");
    assert.equal(world.writes.length, 0);
  }
  const none = syncWorld();
  none.rules[0] = [/FROM ad_platform_connections/, []];
  const out = await hit(campaignSync, { ...asPartner, method: "POST", body: {}, deps: { fetch: fakeMeta() }, rules: none.rules });
  assert.equal(out.status, 400);
  assert.equal(out.body.need, "Connect a Meta ad account for this partner first.");
});

test("campaigns/sync buzzes the owner once for each running ad that dies before 25% and is not tapping through, and records the day; a healthy ad gets no buzz", async () => {
  const ntfy = ["fake", "topic", "for", "tests"].join("-");
  process.env[ntfyName] = ntfy;
  process.env[fenceName] = "off";
  mock.timers.enable({ apis: ["Date"], now: NOON_ARIZONA });
  const realFetch = globalThis.fetch;
  const buzzes = [];
  globalThis.fetch = async (url, init = {}) => {
    buzzes.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: "ntfy-1" }), { status: 200 });
  };
  try {
    const world = syncWorld({ state: "active", dyingRows: [DYING_ROW, HEALTHY_ROW] });
    const done = await hit(campaignSync, { ...asPartner, method: "POST", body: {}, deps: { fetch: fakeMeta() }, rules: world.rules });
    assert.equal(done.status, 200);
    assert.equal(buzzes.length, 1, "one buzz, for the one dying ad");
    assert.match(buzzes[0].url, new RegExp(`^https://ntfy\\.sh`));
    assert.match(buzzes[0].body.title, /^Ad 43 hook: people leave before the quarter mark, so change the opening\.$/);
    assert.equal(buzzes[0].body.topic, ntfy);
    assert.deepEqual(world.alerts, [["ad-row-1", ORG_ID, PARTNER]], "today is recorded for that ad only, so it buzzes once a day");
    const dyingScan = sqlCalls(done, /FROM ads a\s+JOIN LATERAL/)[0];
    assert.deepEqual(dyingScan.params, [PARTNER]);
    assert.match(dyingScan.sql, /al\.dies_before_25_alerted_on IS NULL\s+OR al\.dies_before_25_alerted_on < CURRENT_DATE/);
    assert.match(dyingScan.sql, /upper\(coalesce\(a\.status, ''\)\) = 'ACTIVE'/);

    // A person tapping through is a hop, not a dying opening: no buzz.
    buzzes.length = 0;
    const hop = syncWorld({ state: "active", dyingRows: [{ ...DYING_ROW, clicks: 500 }] });
    await hit(campaignSync, { ...asPartner, method: "POST", body: {}, deps: { fetch: fakeMeta() }, rules: hop.rules });
    assert.equal(buzzes.length, 0);
    assert.deepEqual(hop.alerts, []);
  } finally {
    globalThis.fetch = realFetch;
    mock.timers.reset();
    delete process.env[ntfyName];
    delete process.env[fenceName];
  }
});

test("campaigns/sync keeps a good pull when the buzz cannot go out, and does not mark the day as buzzed so tomorrow tries again; staff must name a partner; a client login is refused", async () => {
  // Outside 6 a.m. to 10 p.m. Arizona time: the buzz is held, the sync still answers ok.
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-14T10:00:00Z") }); // 3 a.m. in Phoenix
  try {
    const world = syncWorld({ state: "active", dyingRows: [DYING_ROW] });
    const done = await hit(campaignSync, { ...asPartner, method: "POST", body: {}, deps: { fetch: fakeMeta() }, rules: world.rules });
    assert.equal(done.status, 200);
    assert.equal(done.body.ok, true);
    assert.deepEqual(world.alerts, [], "a held buzz is not recorded as sent");
  } finally {
    mock.timers.reset();
  }

  const unnamed = syncWorld();
  const staffAlone = await hit(campaignSync, { method: "POST", body: {}, deps: { fetch: fakeMeta() }, rules: unnamed.rules });
  assert.equal(staffAlone.status, 400);
  assert.equal(staffAlone.body.error, "partner_id_required");
  const named = syncWorld();
  const staff = await hit(campaignSync, { method: "POST", body: { partner_id: PARTNER, connection_id: CONN }, deps: { fetch: fakeMeta() }, rules: named.rules });
  assert.equal(staff.status, 200);
  assert.deepEqual(scopeOf(staff).params, [PARTNER]);
  assert.deepEqual(sqlCalls(staff, /FROM ad_platform_connections\s+WHERE partner_id/)[0].params, [PARTNER, CONN]);
  for (const kind of ["client", "affiliate"]) {
    const w = syncWorld();
    const meta = fakeMeta();
    const out = await hit(campaignSync, { account: { kind, clientId: kind === "client" ? AD : null }, method: "POST", body: { partner_id: PARTNER }, deps: { fetch: meta }, rules: w.rules });
    assert.equal(out.status, 403, kind);
    assert.equal(meta.seen.length, 0);
  }
  const get = await hit(campaignSync, { ...asPartner, method: "GET", rules: [] });
  assert.equal(get.status, 405);
});
