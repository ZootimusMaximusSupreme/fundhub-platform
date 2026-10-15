// Batch 24 (finish the 853), the marketing owner doors that only read: one ad
// number's drawer, the numbers by angle, what each paid job cost, and the
// flywheel card and its run poll.
//
// The real api/ handlers, the real roll-up code, a stand-in database that
// answers by the conditions the SQL text names. The repo-file reader is handed
// in through the handler's own seam, so GitHub is never asked. Nothing is
// written or sent. This is a PRACTICE TEST with fake data. It is not a live
// check.

import assert from "node:assert/strict";
import test from "node:test";

import marketingAd from "../../../../api/marketing/ad.mjs";
import marketingAngles from "../../../../api/marketing/angles.mjs";
import marketingCosts from "../../../../api/marketing/costs.mjs";
import marketingFlywheel from "../../../../api/marketing/flywheel.mjs";
import flywheelJob from "../../../../api/marketing/flywheel/job.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { stampStage } from "../../../marketing/flywheel/stamp.mjs";
import { ORG_ID, OTHER_ORG_ID, assertRoleGate, hit, sqlCalls } from "./s5-route-kit.mjs";

const OWNER_ROLES = ["owner", "admin"];
const NOW = new Date("2026-10-14T19:00:00.000Z"); // noon in Phoenix

/* ── marketing/ad: one ad number's drawer ────────────────────────────────── */

const AD_ROW = (over = {}) => ({
  ad_number: "43", ads: 2, spend_cents: "30000", impressions: "9000", link_clicks: "210", plays: "5000", p25: "2100", thruplay: "900", two_sec: "3000",
  ad_days: 6, link_click_days: 6, play_days: 6, two_sec_days: 6, leads: 12, booked: 5, showed: 4, sales: 2, roadmaps: 1,
  cash_cents: "59400", cash_unknown: 0, reported_cash_cents: "59400", maturing_leads: 0, ...over,
});

function adRules({ metaAds = null, number = "43", labels = true, tagged = false, row = AD_ROW(), org = ORG_ID } = {}) {
  const ads = metaAds ?? [
    { id: "ad-row-1", external_id: "120001", name: "Ad 43 hook", status: "ACTIVE", ad_set_external_id: "set-1", org_id: ORG_ID, fundhub_ad_number: "43" },
    { id: "ad-row-2", external_id: "120002", name: "Ad 43 hook B", status: "PAUSED", ad_set_external_id: "set-1", org_id: ORG_ID, fundhub_ad_number: "43" },
    { id: "ad-row-x", external_id: "999", name: "Their ad 43", status: "ACTIVE", ad_set_external_id: "set-9", org_id: OTHER_ORG_ID, fundhub_ad_number: "43" },
  ];
  return [
    [/FROM ads a\s+JOIN ad_sets s ON s\.id = a\.ad_set_id AND s\.org_id = a\.org_id\s+WHERE a\.org_id = \$1\s+AND a\.fundhub_ad_number = \$2/, (_sql, p) =>
      ads.filter((a) => a.org_id === p[0] && a.fundhub_ad_number === p[1])],
    [/SELECT DISTINCT ON \(s\.ad_id\)/, (_sql, p) => (labels && (p[1] || []).includes(number)
      ? [{ ad_number: number, title: "The call that was never a roadmap", funnel_key: "slo", script_format: "talking_head", angle_key: "speed_of_money" }]
      : [])],
    [/FROM client_ad_attribution WHERE org_id = \$1 AND ad_id = \$2/, (_sql, p) => [{ found: tagged && p[1] === number }]],
    [/WITH [\s\S]*lead_by_number/, (_sql, p) => (p[0] === org && (p[4] || []).includes(number) && row ? [row] : [])],
    [/FROM ad_metrics_daily m\s+JOIN ads a ON a\.id = m\.ad_id AND a\.org_id = m\.org_id\s+WHERE m\.org_id = \$1\s+AND a\.fundhub_ad_number = \$2/, [
      { date: "2026-10-12", ad_id: "ad-row-1", video_play_curve: [100, 60, 41, 30] },
      { date: "2026-10-13", ad_id: "ad-row-1", video_play_curve: null },
    ]],
    [/FROM ad_watch_curve_alerts w/, [{ ad_id: "ad-row-1", dies_before_25_alerted_on: "2026-10-12", updated_at: "2026-10-12T20:00:00.000Z" }]],
    [/FROM ad_watch_curve_diagnoses d/, [{ id: "dg-1", date: "2026-10-12", ad_id: "ad-row-1", diagnosis: "opening", fix_type: "words", film_note: "New first line, same body.", next_take_improved: null, created_at: "2026-10-13T05:00:00.000Z" }]],
    [/max\(last_synced_at\) AS meta_synced_at/, [{ meta_synced_at: "2026-10-14T05:00:00.000Z" }]],
    [/max\(synced_at\) AS metrics_synced_at/, [{ metrics_synced_at: "2026-10-14T05:01:00.000Z", latest_metrics_date: "2026-10-13" }]],
  ];
}

test("marketing/ad gives one ad number's drawer: its row for the last 30 Arizona days, the Meta ads that carry it, the watch curve and the alerts and diagnoses, for this company only", async () => {
  assert.equal(ROUTES["marketing/ad"], marketingAd);
  const done = await hit(marketingAd, { role: "admin", query: { n: "43" }, deps: { now: () => NOW }, rules: adRules() });
  assert.equal(done.status, 200);
  const ad = done.body.ad;
  assert.equal(ad.ad_number, "43");
  assert.equal(ad.title, "The call that was never a roadmap");
  assert.equal(ad.angle_key, "speed_of_money");
  assert.equal(ad.funnel_key, "slo");
  assert.equal(ad.spend_cents, 30000);
  assert.equal(ad.leads, 12);
  assert.equal(ad.cash_cents, 59400);
  assert.equal(ad.roas, 1.98, "cash over spend");
  assert.deepEqual(ad.meta_ads.map((m) => [m.id, m.external_id, m.status]), [["ad-row-1", "120001", "ACTIVE"], ["ad-row-2", "120002", "PAUSED"]], "another company's ad with the same number is not listed");
  assert.deepEqual(ad.curve.map((c) => [c.date, c.video_play_curve]), [["2026-10-12", [100, 60, 41, 30]], ["2026-10-13", null]]);
  assert.deepEqual(ad.watch.alerts, [{ ad_id: "ad-row-1", dies_before_25_alerted_on: "2026-10-12", updated_at: "2026-10-12T20:00:00.000Z" }]);
  assert.deepEqual(ad.watch.diagnoses.map((d) => [d.diagnosis, d.fix_type, d.next_take_improved]), [["opening", "words", null]]);
  assert.equal(done.body.as_of, "2026-10-14T05:00:00.000Z");

  // Every read is this company's and this number's, over the 30 days ending today in Arizona.
  const [metaAds] = sqlCalls(done, /FROM ads a\s+JOIN ad_sets s/);
  assert.deepEqual(metaAds.params, [ORG_ID, "43"]);
  assert.match(metaAds.sql, /ORDER BY a\.created_at, a\.id/);
  const [curve] = sqlCalls(done, /m\.date::text AS date, m\.ad_id, m\.video_play_curve/);
  assert.deepEqual(curve.params, [ORG_ID, "43", "2026-09-15", "2026-10-14"]);
  assert.match(curve.sql, /m\.date BETWEEN \$3::date AND \$4::date\s+ORDER BY m\.date, a\.created_at, m\.ad_id/, "oldest day first");
  for (const pattern of [/FROM ad_watch_curve_alerts w/, /FROM ad_watch_curve_diagnoses d/]) {
    assert.deepEqual(sqlCalls(done, pattern)[0].params, [ORG_ID, "43"]);
  }
  assert.match(sqlCalls(done, /FROM ad_watch_curve_diagnoses d/)[0].sql, /ORDER BY m\.date DESC, d\.created_at DESC, d\.id\s+LIMIT 100/);
  assert.equal(done.db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0, "a drawer read writes nothing");
});

test("marketing/ad answers a number with no ad-days as unknown spend, not zero; 404s a number the company has never seen; 400s a number that is not digits; owner and admin only", async () => {
  const quiet = await hit(marketingAd, { query: { n: "43" }, deps: { now: () => NOW }, rules: adRules({ metaAds: [], tagged: true, labels: false, row: null }) });
  assert.equal(quiet.status, 200, "a lead carried the number, so it exists");
  assert.equal(quiet.body.ad.spend_cents, null);
  assert.equal(quiet.body.ad.impressions, null);
  assert.equal(quiet.body.ad.leads, 0);
  assert.equal(quiet.body.ad.ads, 0);
  assert.deepEqual(quiet.body.ad.meta_ads, []);

  const unknown = await hit(marketingAd, { query: { n: "43" }, deps: { now: () => NOW }, rules: adRules({ metaAds: [], tagged: false, labels: false }) });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "not_found");
  for (const bad of [undefined, "", "abc", "12345678901", "4 3"]) {
    const out = await hit(marketingAd, { query: bad === undefined ? {} : { n: bad }, rules: adRules() });
    assert.equal(out.status, 400, String(bad));
    assert.equal(out.body.field, "n");
    assert.equal(sqlCalls(out, /FROM ads a/).length, 0);
  }
  await assertRoleGate(marketingAd, OWNER_ROLES, { query: { n: "43" }, deps: { now: () => NOW }, rules: adRules() });
  const post = await hit(marketingAd, { method: "POST", query: { n: "43" }, rules: adRules() });
  assert.equal(post.status, 405);
  const noCompany = await hit(marketingAd, { staff: { org_id: null }, query: { n: "43" }, rules: adRules() });
  assert.equal(noCompany.status, 403);
});

/* ── marketing/angles: the numbers by angle ──────────────────────────────── */

function angleRules() {
  const company = (re) => (sql, p, rows) => rows.filter((r) => !re.test(sql) || r.org_id === p[0]);
  const labels = [
    { org_id: ORG_ID, ad_row_id: "a1", ad_number: "43", spine_angle_key: "speed_of_money", campaign_external_id: null, campaign_funnel_key: null },
    { org_id: ORG_ID, ad_row_id: "a2", ad_number: "7", spine_angle_key: "approval_without_credit", campaign_external_id: null, campaign_funnel_key: null },
    { org_id: ORG_ID, ad_row_id: "a3", ad_number: null, spine_angle_key: null, campaign_external_id: null, campaign_funnel_key: null },
    { org_id: OTHER_ORG_ID, ad_row_id: "ax", ad_number: "99", spine_angle_key: "lender_secret", campaign_external_id: null, campaign_funnel_key: null },
  ];
  const spend = [
    { org_id: ORG_ID, ad_row_id: "a1", spend_cents: "20000", link_clicks: "200", ad_days: 3, link_click_days: 3 },
    { org_id: ORG_ID, ad_row_id: "a2", spend_cents: "10000", link_clicks: "90", ad_days: 3, link_click_days: 3 },
    { org_id: ORG_ID, ad_row_id: "a3", spend_cents: "5000", link_clicks: "10", ad_days: 1, link_click_days: 1 },
    // Another company's spend that names a row id this company also holds: a lost company condition would add it.
    { org_id: OTHER_ORG_ID, ad_row_id: "a2", spend_cents: "777700", link_clicks: "1", ad_days: 1, link_click_days: 1 },
  ];
  return [
    [/-- m5:ad_labels/, (sql, p) => company(/WHERE v\.org_id = \$1/)(sql, p, labels)],
    [/-- m5:script_labels/, (sql, p) => (/s\.org_id = \$1/.test(sql) && p[0] !== ORG_ID ? [] : [{ ad_number: "43", funnel_key: "slo", angle_key: "amount_of_money" }])],
    [/-- m5:ad_spend/, (sql, p) => company(/WHERE a\.org_id = \$1/)(sql, p, spend)],
    [/lead_by_number/, (_sql, p) => (p[0] === ORG_ID ? [
      { ad_number: "43", ads: 1, spend_cents: "20000", ad_days: 3, leads: 10, booked: 4, showed: 3, sales: 1, roadmaps: 0, cash_cents: "99700", cash_unknown: 0, reported_cash_cents: "99700", maturing_leads: 0 },
      { ad_number: "7", ads: 1, spend_cents: "10000", ad_days: 3, leads: 0, booked: 0, showed: 0, sales: 0, roadmaps: 0, cash_cents: "0", cash_unknown: 0, reported_cash_cents: "0", maturing_leads: 0 },
      // A lead tagged with a number this company has no ad for: only another company's label could give it an angle.
      { ad_number: "99", ads: 0, spend_cents: null, ad_days: 0, leads: 4, booked: 1, showed: 1, sales: 0, roadmaps: 0, cash_cents: "0", cash_unknown: 0, reported_cash_cents: "0", maturing_leads: 0 },
    ] : [])],
    [/max\(last_synced_at\) AS meta_synced_at/, [{ meta_synced_at: "2026-10-14T05:00:00.000Z" }]],
    [/max\(synced_at\) AS metrics_synced_at/, [{ metrics_synced_at: null, latest_metrics_date: null }]],
  ];
}

test("marketing/angles rolls this company's saved spend and leads up by angle for the last 30 Arizona days: a script's angle wins over the creative's, an ad with no angle is in no row, nothing of another company is counted", async () => {
  assert.equal(ROUTES["marketing/angles"], marketingAngles);
  const angleNames = new Map([["amount_of_money", "Amount of money"], ["approval_without_credit", "Approval without credit"]]);
  const done = await hit(marketingAngles, { role: "admin", deps: { now: () => NOW, angleNames }, rules: angleRules() });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.rows, [
    { angle_key: "amount_of_money", name: "Amount of money", spend_cents: 20000, ads: 1, leads: 10, booked: 4, sales: 1, cash_cents: 99700, roas: 4.985 },
    { angle_key: "approval_without_credit", name: "Approval without credit", spend_cents: 10000, ads: 1, leads: 0, booked: 0, sales: 0, cash_cents: 0, roas: 0 },
  ]);
  assert.equal(done.body.as_of, "2026-10-14T05:00:00.000Z");
  const [spend] = sqlCalls(done, /-- m5:ad_spend/);
  assert.deepEqual(spend.params, [ORG_ID, "2026-09-15", "2026-10-14"], "30 Arizona days ending today");
  assert.deepEqual(sqlCalls(done, /-- m5:ad_labels/)[0].params, [ORG_ID]);
  assert.deepEqual(sqlCalls(done, /lead_by_number/)[0].params.slice(0, 3), [ORG_ID, "2026-09-15", "2026-10-14"]);
  assert.equal(done.db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0);

  // A key the angles file does not name shows the key, and nothing is guessed.
  const unnamed = await hit(marketingAngles, { deps: { now: () => NOW, angleNames: new Map() }, rules: angleRules() });
  assert.deepEqual(unnamed.body.rows.map((r) => r.name), ["amount_of_money", "approval_without_credit"]);
});

test("marketing/angles says unknown spend as null, never 0, when no ad-day was saved, and is for owner and admin only", async () => {
  const rules = [
    [/-- m5:ad_labels/, []],
    [/-- m5:ad_spend/, []],
    [/lead_by_number/, []],
    [/max\(last_synced_at\)/, [{ meta_synced_at: null }]],
    [/max\(synced_at\)/, [{ metrics_synced_at: null, latest_metrics_date: null }]],
  ];
  const empty = await hit(marketingAngles, { deps: { now: () => NOW, angleNames: new Map() }, rules });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { rows: [], as_of: null });
  await assertRoleGate(marketingAngles, OWNER_ROLES, { deps: { now: () => NOW, angleNames: new Map() }, rules });
  const post = await hit(marketingAngles, { method: "POST", rules });
  assert.equal(post.status, 405);
});

/* ── marketing/costs: what each paid job cost last time, and the caps ────── */

function costRules({ month = 12.5, avatarJob = true } = {}) {
  return [
    [/INSERT INTO marketing_settings/, []],
    [/SELECT \* FROM marketing_settings WHERE org_id = \$1/, (_sql, p) => [{ org_id: p[0], max_month_cost_usd: 50, max_batch_cost_usd: 40, run_caps: { avatar: 6 } }]],
    [/FROM marketing_jobs j\s+JOIN marketing_model_usage u ON u\.job_id = j\.id/, (_sql, p) => (avatarJob && p[1] === "avatar" && p[0] === ORG_ID ? [{
      id: "job-9", created_at: "2026-10-13T10:00:00.000Z", finished_at: "2026-10-13T10:08:00.000Z", cost_usd: 1.234567891, unpriced: 0, searches: 23, fetches: 4, calls: 11,
    }] : [])],
    [/WITH bounds AS/, [{ month_priced_usd: String(month), month_null_input: 0, month_null_output: 0, month_null_cache_read: 0, month_null_cache_write: 0, batch_priced_usd: 0, unpriced_rows: 0 }]],
  ];
}

test("marketing/costs gives each job kind's last measured cost and minutes (unknown when never measured), this month's spend against the cap, and the run caps, for this company", async () => {
  assert.equal(ROUTES["marketing/costs"], marketingCosts);
  const done = await hit(marketingCosts, { role: "admin", deps: { now: () => NOW }, rules: costRules() });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.equal(done.body.as_of, NOW.toISOString());
  assert.deepEqual(done.body.kinds.avatar, {
    job_id: "job-9", last_cost_usd: 1.234568, last_minutes: 8, measured_at: "2026-10-13T10:08:00.000Z",
    last_searches: 23, last_fetches: 4, last_calls: 11, unpriced_calls: 0, run_cap_usd: 6,
  });
  assert.equal(done.body.kinds.offer, null, "a kind never measured is unknown, not $0");
  assert.equal(done.body.kinds.quick_copy, null, "a kind with no job in this build is unknown");
  assert.deepEqual(done.body.month, { used_usd: 12.5, cap_usd: 50, unpriced_calls: 0 });
  assert.equal(done.body.run_caps.avatar, 6);
  assert.match(done.body.avatar_line, /About \$1\.23 and 8 minutes \(last run, Oct 13\)\. Stops at \$6/);
  assert.match(done.body.avatar_line, /\$12\.50 of \$50 used this month\./);
  const [last] = sqlCalls(done, /FROM marketing_jobs j/).filter((c) => c.params[1] === "avatar");
  assert.deepEqual(last.params, [ORG_ID, "avatar"]);
  assert.match(last.sql, /j\.status = 'done' AND j\.finished_at IS NOT NULL/);
  assert.match(last.sql, /ORDER BY j\.finished_at DESC\s+LIMIT 1/);
  assert.deepEqual(sqlCalls(done, /WITH bounds AS/)[0].params.slice(0, 2), [ORG_ID, null]);

  const none = await hit(marketingCosts, { deps: { now: () => NOW }, rules: costRules({ avatarJob: false }) });
  assert.equal(none.body.kinds.avatar, null);
  assert.match(none.body.avatar_line, /^Cost: unknown, not measured yet\./);
  await assertRoleGate(marketingCosts, OWNER_ROLES, { deps: { now: () => NOW }, rules: costRules() });
  const post = await hit(marketingCosts, { method: "POST", rules: costRules() });
  assert.equal(post.status, 405);
});

/* ── marketing/flywheel and marketing/flywheel/job ───────────────────────── */

const FILES = (extra = {}) => ({
  "00-OWNER-NOTES.md": { text: "# Owner notes\n\nOffer key: PARTNER_ENTRY\n\n## Notes\n", source: "github" },
  "01-avatar.md": { text: stampStage({ stage: 1, version: 2, status: "approved", counts: { quotes: 140, languageEntries: 120 }, body: "# Who we sell to\n\nThe business owner.\n\n## Review card\n\nOK." }), source: "github" },
  ...extra,
});
function flywheelDeps({ files = FILES(), campaigns = ["capital-blueprint", "partner"], jobs = {} } = {}) {
  const reads = [];
  return {
    reads,
    deps: {
      env: {},
      roots: [],
      readFlywheel: async (args) => { reads.push(args); return { campaigns, files, source: "github", fallback_reason: null, commit_sha: "abc1234" }; },
      latestStageJobs: async () => jobs,
    },
  };
}
const staffReads = [
  [/FROM marketing_jobs/, []],
];

test("marketing/flywheel lists every campaign and the six steps of one in plain words, picks partner when none is named, and reads files and saved rows only", async () => {
  assert.equal(ROUTES["marketing/flywheel"], marketingFlywheel);
  const h = flywheelDeps();
  const done = await hit(marketingFlywheel, { role: "admin", query: {}, deps: h.deps, rules: staffReads });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.equal(done.body.campaign, "partner", "partner when it exists");
  assert.equal(done.body.campaign_words, "Partner offer");
  assert.deepEqual(done.body.campaigns.map((c) => c.name).sort(), ["capital-blueprint", "partner"]);
  assert.ok(done.body.offers.length > 0 && done.body.offers.every((o) => o.key && o.name));
  assert.equal(done.body.source, "github");
  assert.equal(done.body.commit_sha, "abc1234");
  assert.deepEqual(done.body.stages.map((s) => s.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(done.body.stages.map((s) => s.file), ["01-avatar.md", "02-ad-research.md", "03-offer.md", "04-copy.md", "05-ad-strategy.md", "06-spend.md"]);
  const avatar = done.body.stages[0];
  assert.equal(avatar.approved, true, "the stamp says approved");
  assert.equal(avatar.source, "github");
  assert.equal(avatar.version, 2);
  assert.match(done.body.stages[3].can_run.reason, /Approve step 3 first \(the offer\)\./, "the copy waits for the offer, and says so");
  assert.equal(done.body.stages[3].can_run.ok, false);
  assert.equal(done.body.stages[1].state, "MISSING");
  assert.equal(typeof done.body.advice, "string");
  assert.equal(done.db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0, "free: it writes nothing");
  assert.deepEqual(h.reads.map((r) => [r.orgId, r.campaign]), [[ORG_ID, null], [ORG_ID, "partner"]], "the company comes from the sign-in");

  // The same file with the stamp saying draft: done, but not approved, and the card says so.
  const draftFile = { text: stampStage({ stage: 1, version: 2, status: "draft", counts: { quotes: 140, languageEntries: 120 }, body: "# Who we sell to\n\nThe business owner.\n\n## Review card\n\nOK." }), source: "github" };
  const draft = flywheelDeps({ files: FILES({ "01-avatar.md": draftFile }) });
  const unreviewed = await hit(marketingFlywheel, { query: { campaign: "partner" }, deps: draft.deps, rules: staffReads });
  assert.equal(unreviewed.body.stages[0].approved, false);
  assert.equal(unreviewed.body.stages[0].state_word, "Done");
  assert.equal(done.body.stages[0].state_word, "Done, approved");

  const named = flywheelDeps();
  const one = await hit(marketingFlywheel, { query: { campaign: "capital-blueprint" }, deps: named.deps, rules: staffReads });
  assert.equal(one.body.campaign, "capital-blueprint");
  assert.deepEqual(named.reads.map((r) => r.campaign), ["capital-blueprint"]);
});

test("marketing/flywheel refuses a campaign name that is not a folder name, says no such flywheel for one that is not there, and answers an honest empty card when there are none; owner and admin only", async () => {
  const bad = await hit(marketingFlywheel, { query: { campaign: "../etc" }, deps: flywheelDeps().deps, rules: staffReads });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "campaign");
  const missing = await hit(marketingFlywheel, { query: { campaign: "nope" }, deps: flywheelDeps().deps, rules: staffReads });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "not_found");
  const none = await hit(marketingFlywheel, { deps: flywheelDeps({ campaigns: [] }).deps, rules: staffReads });
  assert.equal(none.status, 200);
  assert.equal(none.body.campaign, null);
  assert.deepEqual(none.body.stages, []);
  assert.match(none.body.advice, /No flywheel yet/);
  await assertRoleGate(marketingFlywheel, OWNER_ROLES, { query: {}, deps: flywheelDeps().deps, rules: staffReads });
  const post = await hit(marketingFlywheel, { method: "POST", deps: flywheelDeps().deps, rules: staffReads });
  assert.equal(post.status, 405);
});

const AVATAR_JOB = (over = {}) => ({
  id: "0b000000-0000-4000-8000-000000000009", org_id: ORG_ID, kind: "avatar", status: "running", attempts: 1, error: null, result: null,
  payload: { campaign: "partner", plan: {}, steps: [] }, created_at: "2026-10-14T18:50:00.000Z", claimed_at: "2026-10-14T18:51:00.000Z", finished_at: null, ...over,
});

test("marketing/flywheel/job polls one avatar run of this company step by step with the cost so far, and says not found for any other run", async () => {
  assert.equal(ROUTES["marketing/flywheel/job"], flywheelJob);
  const rules = (job) => [
    [/FROM marketing_jobs WHERE id = \$1 AND org_id = \$2 AND kind = 'avatar'/, (sql, p) =>
      (job && job.id === p[0] && (!/AND org_id = \$2/.test(sql) || job.org_id === p[1]) && job.kind === "avatar" ? [job] : [])],
    [/FROM marketing_model_usage/, [{ cost_usd: 1.9, unpriced: 0, searches: 23, fetches: 2, calls: 6 }]],
  ];
  const job = AVATAR_JOB();
  const done = await hit(flywheelJob, { role: "admin", query: { id: job.id }, rules: rules(job) });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.ok, true);
  assert.equal(done.body.job.id, job.id);
  assert.equal(done.body.job.status, "running");
  assert.equal(done.body.job.campaign, "partner");
  assert.ok(Array.isArray(done.body.job.steps));
  assert.equal(typeof done.body.job.sentence, "string");
  assert.deepEqual(sqlCalls(done, /FROM marketing_jobs WHERE id = \$1/)[0].params, [job.id, ORG_ID], "the lookup names the company");
  assert.deepEqual(sqlCalls(done, /FROM marketing_model_usage/)[0].params, [job.id]);
  assert.equal(done.body.job.cost_so_far_usd, 1.9);
  assert.equal(done.body.job.searches_so_far, 23);

  const foreign = await hit(flywheelJob, { query: { id: job.id }, rules: rules({ ...job, org_id: OTHER_ORG_ID }) });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "not_found");
  const none = await hit(flywheelJob, { query: {}, rules: rules(job) });
  assert.equal(none.status, 400);
  assert.equal(none.body.field, "id");
  await assertRoleGate(flywheelJob, OWNER_ROLES, { query: { id: job.id }, rules: rules(job) });
  const post = await hit(flywheelJob, { method: "POST", query: { id: job.id }, rules: rules(job) });
  assert.equal(post.status, 405);
});
