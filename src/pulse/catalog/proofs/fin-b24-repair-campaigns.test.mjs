// Batch 24, repair cycle 1: campaigns/detail and campaigns/sync.
//
// An independent checker found these stayed green when the product broke:
//   * campaigns/detail: the stand-in answered canned rows for every statement, so
//     what the statements compute (sums, the 30-day window, which ad sets and
//     actions belong to the campaign, the flags) was never judged.
//   * campaigns/sync: the daily numbers were judged only for spend, impressions
//     and clicks. The re-pull overwrite list, ctr and roas, the video counts
//     (unknown must stay NULL, never 0), the ad set budget, the buzz scan's
//     partner scope and Meta's verification word were not.
//
// The real api/ handlers, the real partner-scope wrapper, the real sync code. The
// statements that decide a number are pinned as written (a pin judges what the
// statement says; it does not run it, there is no Postgres here); every row-level
// condition is a stand-in table that keeps a row only while the statement's text
// carries that row's condition. This is a PRACTICE TEST with fake data. It is not
// a live check.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before, mock } from "node:test";

import campaignDetail from "../../../../api/campaigns/detail.mjs";
import campaignSync, { insightUpsertSql, metaVerificationState } from "../../../../api/campaigns/sync.mjs";
import { encryptToken } from "../../../adplatforms/tokens.mjs";
import { AD_TODAY_SQL, adAccountDay } from "../../../lib/ad-account-day.mjs";
import { ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";
import { assertSqlHas, flat } from "./fin-b24-repair-kit.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const CAMPAIGN = "ca000000-0000-4000-8000-000000000001";
const CONN = "33000000-0000-4000-8000-000000000003";
const asPartner = { account: { kind: "partner", partnerId: PARTNER } };

/* ── campaigns/detail ────────────────────────────────────────────────────── */

test("campaigns/detail's statements keep what the row's words name: this campaign's ad sets and actions, daily numbers summed over the window asked, and each flag as written", async () => {
  const rules = [
    [/FROM campaigns c WHERE c\.id = \$1/, (_sql, p) => (p[0] === CAMPAIGN ? [{ id: CAMPAIGN, name: "Funding Dream", has_disclosure_asset: true }] : [])],
    [/FROM ad_sets s WHERE s\.campaign_id = \$1/, [{ id: "as-1", in_learning_phase: false, ad_count: 3 }]],
    [/FROM ad_metrics_daily m\s+JOIN ads a ON a\.id = m\.ad_id/, [{ date: "2026-10-13", spend_cents: "900", impressions: "3000", clicks: "60", conversions: "3" }]],
    [/FROM action_log\s+WHERE target_id = \$1 OR target_id IN/, [{ id: "al-1", revertible: true }]],
  ];
  const done = await hit(campaignDetail, { ...asPartner, query: { id: CAMPAIGN, days: "7", partner_id: OTHER_PARTNER }, rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.equal(done.body.has_disclosure_asset, true);

  const [campaign] = sqlCalls(done, /FROM campaigns c WHERE/);
  assertSqlHas(campaign.sql, [
    ["(c.disclosure_asset_id IS NOT NULL) AS has_disclosure_asset", "the flag says a disclosure asset exists, not that none does"],
    ["FROM campaigns c WHERE c.id = $1", "one campaign"],
  ], "the campaign statement");

  const [sets] = sqlCalls(done, /FROM ad_sets s/);
  assertSqlHas(sets.sql, [
    ["(s.learning_until IS NOT NULL AND s.learning_until > now()) AS in_learning_phase", "in learning only while the learning date is still ahead"],
    ["(SELECT count(*)::int FROM ads a WHERE a.ad_set_id = s.id) AS ad_count", "an ad set's own ads, not every ad"],
    ["FROM ad_sets s WHERE s.campaign_id = $1 ORDER BY s.created_at", "this campaign's ad sets only, with no way around the condition"],
  ], "the ad sets statement");
  assert.deepEqual(sets.params, [CAMPAIGN]);

  const [series] = sqlCalls(done, /FROM ad_metrics_daily m/);
  assertSqlHas(series.sql, [
    ["sum(m.spend_cents)::bigint AS spend_cents", "spend adds up across the day's ads"],
    ["sum(m.impressions)::bigint AS impressions", "impressions add up"],
    ["sum(m.clicks)::bigint AS clicks", "clicks add up"],
    ["sum(m.conversions)::bigint AS conversions", "conversions add up, not count"],
    [`WHERE a.campaign_id = $1 AND m.date > ${AD_TODAY_SQL} - ($2::int || ' days')::interval`, "the window is that many DAYS back from today in Arizona"],
    ["GROUP BY m.date ORDER BY m.date ASC", "one row per day, oldest first"],
  ], "the daily numbers statement");
  assert.deepEqual(series.params, [CAMPAIGN, 7]);

  const [actions] = sqlCalls(done, /FROM action_log/);
  assertSqlHas(actions.sql, [
    ["WHERE target_id = $1 OR target_id IN (SELECT id FROM ad_sets WHERE campaign_id = $1)", "this campaign and its own ad sets, not every ad set"],
    ["(undo_payload IS NOT NULL AND undone_at IS NULL) AS revertible", "revertible only while there is something to undo and it is not already undone"],
    ["ORDER BY created_at DESC LIMIT 50", "the 50 newest"],
  ], "the recent actions statement");
  assert.match(flat(actions.sql), /LIMIT 50$/, "the limit is 50 and nothing more");
  assert.deepEqual(actions.params, [CAMPAIGN]);
});

/* ── campaigns/sync ──────────────────────────────────────────────────────── */

const keyName = "AD_TOKEN_ENC_KEY";
const saved = {};
before(() => {
  for (const k of [keyName, "NTFY_TOPIC", "MESSAGING_DRY_RUN", "AD_VIDEO_SMS_TO", "PULSE_SMS_TO", "META_API_VERSION"]) saved[k] = process.env[k];
  process.env[keyName] = crypto.randomBytes(32).toString("base64");
  delete process.env.AD_VIDEO_SMS_TO;
  delete process.env.PULSE_SMS_TO;
  delete process.env.META_API_VERSION;
});
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const TODAY = () => adAccountDay(new Date());
const respond = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });

/* Meta's address, one pull. `insight` is the daily row; `verification` is what
   Meta says about the business (null: Meta says nothing). */
function fakeMeta({ insight = {}, verification = "verified", adSet = { id: "m-s1", name: "Broad", status: "ACTIVE", daily_budget: "5000", campaign_id: "m-c1" } } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes("/insights?")) return respond({ data: [{ ad_id: "m-ad-1", date_start: TODAY(), spend: "10.00", impressions: "100", clicks: "5", inline_link_clicks: "4", ...insight }] });
    if (u.includes("/campaigns?")) return respond({ data: [{ id: "m-c1", name: "Funding Dream", status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "7000" }] });
    if (u.includes("/adsets?")) return respond({ data: [adSet] });
    if (u.includes("/ads?")) return respond({ data: [{ id: "m-ad-1", name: "Ad 43 hook", status: "ACTIVE", adset_id: "m-s1" }] });
    if (/\/12345\?/.test(u)) return respond(verification === null ? {} : { verification_status: verification });
    return respond({ data: [] });
  };
}

function syncWorld({ dying = [], verificationState = "unverified" } = {}) {
  const world = {
    connection: {
      id: CONN, org_id: ORG_ID, partner_id: PARTNER, platform: "meta", connection_state: "active", last_error: null,
      external_ad_account_id: "act_982103620742368", external_business_id: "12345", platform_verification_state: verificationState, last_synced_at: null,
      encrypted_access_token: encryptToken(["fake", "meta", "token"].join("-"), { partnerId: PARTNER }), created_at: "2026-08-01T00:00:00Z",
    },
    writes: [], metrics: [], alerts: [], verificationWrites: [],
  };
  world.rules = [
    [/FROM ad_platform_connections\s+WHERE partner_id = \$1 AND platform = 'meta'/, (_s, p) => (p[0] === PARTNER ? [world.connection] : [])],
    [/FROM pg_attribute/, [{ n: 4 }]],
    [/min\(m\.date\)/, [{ d: null }]],
    [/UPDATE ad_platform_connections\s+SET last_synced_at = now\(\)/, () => []],
    [/UPDATE ad_platform_connections\s+SET platform_verification_state = \$2/, (sql, p) => {
      world.verificationWrites.push(p[1]);
      if (/IS DISTINCT FROM \$2/.test(sql) && world.connection.platform_verification_state === p[1]) return [];
      world.connection.platform_verification_state = p[1];
      return [];
    }],
    [/UPDATE ad_platform_connections SET last_error = \$2 WHERE id = \$1/, []],
    [/FROM campaigns WHERE connection_id = \$1 AND external_id = \$2/, []],
    [/INSERT INTO campaigns/, (_s, p) => { world.writes.push({ table: "campaigns", params: p }); return [{ id: "camp-1" }]; }],
    [/FROM ad_sets WHERE connection_id = \$1 AND external_id = \$2/, []],
    [/INSERT INTO ad_sets/, (_s, p) => { world.writes.push({ table: "ad_sets", params: p }); return [{ id: "set-1" }]; }],
    [/FROM ads WHERE connection_id = \$1 AND external_id = \$2/, []],
    [/INSERT INTO ads \(/, (_s, p) => { world.writes.push({ table: "ads", params: p }); return [{ id: "ad-row-1", fundhub_ad_number: null, fundhub_ad_number_source: null }]; }],
    [/^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/, []],
    [/UPDATE ads\s+SET fundhub_ad_number = \$2::text/, (_s, p) => [{ id: p[0], fundhub_ad_number: p[1] }]],
    [/INSERT INTO ad_metrics_daily/, (sql, p) => { world.metrics.push({ sql, params: p }); return []; }],
    [/fundhub_reresolve_ad_numbers/, [{ filled: 0 }]],
    // The buzz scan: a row stays only while the statement still names each of its conditions.
    [/FROM ads a\s+JOIN LATERAL/, (sql, p) => shelf(dying, [
      clause(/a\.partner_id = \$1/, (row, params) => row.partner_id === params[0]),
      clause(/upper\(coalesce\(a\.status, ''\)\) = 'ACTIVE'/, (row) => String(row.status).toUpperCase() === "ACTIVE"),
      clause(/al\.dies_before_25_alerted_on IS NULL\s+OR al\.dies_before_25_alerted_on < CURRENT_DATE/, (row) => row.alerted_on == null || row.alerted_on < "2026-10-14"),
    ])(sql, p)],
    [/INSERT INTO ad_watch_curve_alerts/, (_s, p) => { world.alerts.push(p); return []; }],
  ];
  return world;
}

const pull = (world, meta) => hit(campaignSync, { ...asPartner, method: "POST", body: { partner_id: OTHER_PARTNER }, deps: { fetch: meta }, rules: world.rules });

const RICH = {
  ctr: "5.25",
  purchase_roas: [{ action_type: "omni_purchase", value: "3.1" }],
  video_play_actions: [{ action_type: "video_view", value: "80" }],
  video_continuous_2_sec_watched_actions: [{ action_type: "video_view", value: "60" }],
  video_p25_watched_actions: [{ action_type: "video_view", value: "40" }],
  video_p50_watched_actions: [{ action_type: "video_view", value: "30" }],
  video_p75_watched_actions: [{ action_type: "video_view", value: "20" }],
  video_p95_watched_actions: [{ action_type: "video_view", value: "10" }],
  video_p100_watched_actions: [{ action_type: "video_view", value: "8" }],
  video_thruplay_watched_actions: [{ action_type: "video_view", value: "25" }],
  video_play_curve_actions: [{ action_type: "video_view", value: [100, 60, 40] }],
};
// Positions in the daily row's bound values (the statement's own column order).
const AT = { ctr: 7, roas: 8, twoSec: 9, plays: 10, p25: 11, p50: 12, p75: 13, p95: 14, p100: 15, thru: 16, curve: 17 };

test("campaigns/sync saves every daily number Meta sent as sent (rates, video counts and the curve), and overwrites every one of them when a day is pulled again", async () => {
  const world = syncWorld();
  const done = await pull(world, fakeMeta({ insight: RICH }));
  assert.equal(done.status, 200);
  const [row] = world.metrics;
  assert.equal(world.metrics.length, 1);
  const p = row.params;
  assert.deepEqual(p.slice(0, 7), [ORG_ID, PARTNER, "ad-row-1", TODAY(), 1000, 100, 5], "spend in cents, impressions, clicks");
  assert.equal(p[AT.ctr], 5.25, "ctr is Meta's number");
  assert.equal(p[AT.roas], 3.1, "roas is Meta's purchase roas");
  assert.deepEqual(
    [p[AT.twoSec], p[AT.plays], p[AT.p25], p[AT.p50], p[AT.p75], p[AT.p95], p[AT.p100], p[AT.thru]],
    [60, 80, 40, 30, 20, 10, 8, 25], "every video count as Meta sent it",
  );
  assert.equal(p[AT.curve], "[100,60,40]", "the second-by-second curve");

  // A day pulled again must overwrite every column it wrote, not itself.
  const sql = flat(row.sql);
  const columns = /INSERT INTO ad_metrics_daily \(([^)]*)\)/.exec(sql)[1].split(",").map((c) => c.trim());
  const sets = Object.fromEntries([...sql.split("DO UPDATE SET")[1].matchAll(/(\w+) = ([\w.()]+)/g)].map((m) => [m[1], m[2]]));
  const keys = new Set(["org_id", "partner_id", "ad_id", "date"]);
  for (const column of columns.filter((c) => !keys.has(c))) {
    assert.equal(sets[column], `EXCLUDED.${column}`, `${column} is overwritten with the newly pulled value`);
  }
  assert.ok(columns.includes("spend_cents") && columns.includes("ctr") && columns.includes("video_play_curve"));
  assert.equal(flat(insightUpsertSql({ withResults: true })).includes("purchases = EXCLUDED.purchases"), true, "the four Meta result columns too");
});

test("campaigns/sync keeps a number Meta did not send NULL (never 0), and still saves the ones it did", async () => {
  const world = syncWorld();
  const done = await pull(world, fakeMeta({ insight: {} }));
  assert.equal(done.status, 200);
  const p = world.metrics[0].params;
  assert.equal(p[AT.ctr], null, "no ctr sent: unknown");
  assert.equal(p[AT.roas], null, "no roas sent: unknown");
  for (const [name, at] of Object.entries(AT).filter(([name]) => name !== "ctr" && name !== "roas")) {
    assert.equal(p[at], null, `${name}: Meta sent nothing, so it is unknown and not 0`);
  }
  assert.deepEqual(p.slice(18, 22), [null, null, 4, null], "of the four result columns only link clicks came from Meta (inline link clicks 4)");
});

test("campaigns/sync saves the ad set's own daily budget, and the campaign's", async () => {
  const world = syncWorld();
  await pull(world, fakeMeta({ adSet: { id: "m-s1", name: "Broad", status: "ACTIVE", daily_budget: "4200", campaign_id: "m-c1" } }));
  const adSet = world.writes.find((w) => w.table === "ad_sets").params;
  assert.equal(adSet[7], 4200, "the ad set's budget is the ad set's, not 0");
  assert.equal(adSet[6], "ACTIVE");
  assert.equal(world.writes.find((w) => w.table === "campaigns").params[8], 7000, "the campaign's budget is its own");
});

test("campaigns/sync writes the verification word Meta sent, as the column's own word, and writes nothing when Meta says nothing or says a word it does not know", async () => {
  // The pure mapping, every word the column's check allows.
  const mapping = [
    ["verified", "approved"], ["VERIFIED", "approved"], [" verified ", "approved"],
    ["not_verified", "unverified"],
    ["pending", "submitted"], ["pending_submission", "submitted"], ["pending_need_more_info", "submitted"],
    ["failed", "rejected"], ["rejected", "rejected"], ["revoked", "rejected"], ["ineligible", "rejected"], ["expired", "rejected"],
    ["", null], [null, null], [undefined, null], ["mystery_word", null], ["approved", null],
  ];
  for (const [word, want] of mapping) assert.equal(metaVerificationState(word), want, JSON.stringify(word));

  // And what the pull does with it.
  for (const [word, state, writes] of [
    ["verified", "approved", ["approved"]],
    ["not_verified", "unverified", ["unverified"]],
    ["pending_submission", "submitted", ["submitted"]],
    ["failed", "rejected", ["rejected"]],
    ["mystery_word", "submitted", []],
    [null, "submitted", []],
  ]) {
    const world = syncWorld({ verificationState: "submitted" });
    const done = await pull(world, fakeMeta({ verification: word }));
    assert.equal(done.status, 200, String(word));
    assert.deepEqual(world.verificationWrites, writes, `Meta said ${JSON.stringify(word)}`);
    assert.equal(world.connection.platform_verification_state, state, `Meta said ${JSON.stringify(word)}`);
  }
});

test("campaigns/sync's buzz scan looks only at this partner's running ads that have not buzzed today, and buzzes the one that dies before 25%", async () => {
  const dying = (over) => ({ ad_id: "ad-row-1", org_id: ORG_ID, partner_id: PARTNER, ad_name: "Ad 43 hook", status: "ACTIVE", alerted_on: null, metric_date: "2026-10-13", video_plays: 1000, video_p25_watched: 200, clicks: 5, link_clicks: null, landing_page_views: null, link_clicks_saved: false, ...over });
  const rows = [
    dying({}),
    dying({ ad_id: "ad-other-partner", partner_id: OTHER_PARTNER, ad_name: "Their dying ad" }),
    dying({ ad_id: "ad-paused", status: "PAUSED", ad_name: "A paused ad" }),
    dying({ ad_id: "ad-buzzed", alerted_on: "2026-10-14", ad_name: "Already buzzed today" }),
  ];
  const topic = ["fake", "topic", "for", "tests"].join("-");
  process.env.NTFY_TOPIC = topic;
  process.env.MESSAGING_DRY_RUN = "off";
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-14T19:00:00Z") });
  const realFetch = globalThis.fetch;
  const buzzes = [];
  globalThis.fetch = async (url, init = {}) => {
    buzzes.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: "ntfy-1" }), { status: 200 });
  };
  try {
    const world = syncWorld({ dying: rows });
    const done = await pull(world, fakeMeta());
    assert.equal(done.status, 200);
    assert.deepEqual(buzzes.map((b) => b.body.title), ["Ad 43 hook: people leave before the quarter mark, so change the opening."], "one buzz, for this partner's one running ad that dies and has not buzzed today");
    assert.deepEqual(world.alerts, [["ad-row-1", ORG_ID, PARTNER]], "today is recorded for that ad only");
    assert.deepEqual(sqlCalls(done, /FROM ads a\s+JOIN LATERAL/)[0].params, [PARTNER], "the scan is bound to the login's partner");
  } finally {
    globalThis.fetch = realFetch;
    mock.timers.reset();
    delete process.env.NTFY_TOPIC;
    delete process.env.MESSAGING_DRY_RUN;
  }
});
