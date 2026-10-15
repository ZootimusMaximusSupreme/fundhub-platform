// Batch 24, repair cycle 1: marketing/ad, marketing/angles, marketing/flywheel
// and marketing/flywheel/job.
//
// An independent checker found these stayed green when the product broke:
//   * marketing/ad and marketing/angles: only 8 of the drawer row's 23 fields were
//     judged, the statements that name "this company", "this number" and "30
//     days" were answered by canned rows, and the alerts, diagnoses and script
//     label reads lost their company or number conditions unseen. A cancelled
//     booking counted as booked and failed payments counted as cash.
//   * marketing/flywheel: the words ("six steps in plain words", "saved rows") were
//     judged for only a few of the states; the saved-run overlay was never fed a
//     saved row.
//   * marketing/flywheel/job: the ledger statement's job condition, the step
//     list, the attempt count and the stop-at-cap sentence were not judged.
//
// The real api/ handlers. Statements that compute a number (sum, count, window,
// status list) are pinned as written (a pin judges what the statement says; it
// does not run it, there is no Postgres here). Every row-level condition is a
// stand-in table that keeps a row only while the statement's text carries that
// row's condition. This is a PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import test from "node:test";

import marketingAd from "../../../../api/marketing/ad.mjs";
import marketingAngles from "../../../../api/marketing/angles.mjs";
import marketingFlywheel from "../../../../api/marketing/flywheel.mjs";
import flywheelJob from "../../../../api/marketing/flywheel/job.mjs";
import { hashOf, stampStage } from "../../../marketing/flywheel/stamp.mjs";
import { ORG_ID, OTHER_ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";
import { assertSqlHas } from "./fin-b24-repair-kit.mjs";

const NOW = new Date("2026-10-14T19:00:00.000Z"); // noon in Phoenix

/* The statement every ad-number read runs (marketing/ad, marketing/angles and the
   Ads table share it). Each fragment is a condition a number's meaning rests on. */
const AD_NUMBERS_PINS = [
  ["FROM client_ad_attribution a JOIN clients c ON c.id = a.client_id AND c.org_id = a.org_id WHERE a.org_id = $1 AND c.is_demo IS NOT TRUE AND (a.captured_at AT TIME ZONE 'America/Phoenix')::date BETWEEN $2::date AND $3::date",
    "a lead of this company, not a demo client, tagged inside the window (both ends)"],
  ["a.ad_id IS NOT NULL AND ($5::text[] IS NULL OR a.ad_id = ANY($5::text[]))", "only the numbers asked for"],
  ["bk.org_id = l.org_id AND bk.status IN ('booked', 'rescheduled', 'noshow', 'completed')", "a booked call is a booked, rescheduled, no-show or completed booking, never a cancelled one"],
  ["co.org_id = l.org_id AND co.client_id = l.client_id AND co.outcome <> 'no_show' AND co.is_demo IS NOT TRUE", "showed is a call that was not a no-show"],
  ["s.org_id = l.org_id AND s.client_id = l.client_id AND s.status = 'active' AND s.is_demo IS NOT TRUE", "a sale is an active sale"],
  ["FROM transactions t WHERE t.org_id = l.org_id AND t.client_id = l.client_id AND t.status = 'succeeded' AND t.is_demo IS NOT TRUE", "cash is succeeded payments of this company, never failed ones"],
  ["FROM ad_metrics_daily m JOIN ads a ON a.id = m.ad_id AND a.org_id = m.org_id WHERE m.org_id = $1 AND m.date BETWEEN $2::date AND $3::date AND a.fundhub_ad_number IS NOT NULL AND ($5::text[] IS NULL OR a.fundhub_ad_number = ANY($5::text[]))",
    "spend is this company's, inside the window (both ends), for ads that carry a number"],
];

/* ── marketing/ad ────────────────────────────────────────────────────────── */

// Hand-worked from the row's words: ctr 210/9000, hook 3000/9000, hold 2100/5000, thruplay 900/5000, cpl 30000/12,
// cost per booked 30000/5, roas cash 59400 / spend 30000, close rate sales 2 / showed 4.
const AD_ROW = {
  ad_number: "43", ads: 2, spend_cents: "30000", impressions: "9000", link_clicks: "210", plays: "5000", p25: "2100", thruplay: "900", two_sec: "3000",
  ad_days: 6, link_click_days: 5, play_days: 4, two_sec_days: 3, leads: 12, booked: 5, showed: 4, sales: 2, roadmaps: 1,
  cash_cents: "59400", cash_unknown: 1, reported_cash_cents: "41000", maturing_leads: 2,
};

function adRules({ number = "43", row = AD_ROW, scripts = null, tagged = null, metaAds = null } = {}) {
  const ads = metaAds ?? [
    { id: "ad-row-1", external_id: "120001", name: "Ad 43 hook", status: "ACTIVE", ad_set_external_id: "set-1", org_id: ORG_ID, fundhub_ad_number: "43", created_at: "1" },
    { id: "ad-row-x", external_id: "999", name: "Their ad 43", status: "ACTIVE", ad_set_external_id: "set-9", org_id: OTHER_ORG_ID, fundhub_ad_number: "43", created_at: "2" },
    { id: "ad-row-7", external_id: "7777", name: "Ad 7", status: "ACTIVE", ad_set_external_id: "set-7", org_id: ORG_ID, fundhub_ad_number: "7", created_at: "3" },
  ];
  const scriptRows = scripts ?? [
    { org_id: ORG_ID, ad_id: "43", title: "The call that was never a roadmap", funnel_key: "slo", script_format: "talking_head", angle_key: "speed_of_money", archived_at: null, created_at: "2026-10-01" },
    // Another company's newer script for the same number: a lost company condition would pick it.
    { org_id: OTHER_ORG_ID, ad_id: "43", title: "Their script", funnel_key: "x", script_format: "x", angle_key: "lender_secret", archived_at: null, created_at: "2026-10-09" },
  ];
  const attributions = tagged ?? [{ org_id: ORG_ID, ad_id: "43" }];
  const alerts = [
    { org_id: ORG_ID, fundhub_ad_number: "43", ad_id: "ad-row-1", dies_before_25_alerted_on: "2026-10-12", updated_at: "2026-10-12T20:00:00.000Z" },
    { org_id: OTHER_ORG_ID, fundhub_ad_number: "43", ad_id: "ad-row-x", dies_before_25_alerted_on: "2026-10-12", updated_at: "2026-10-12T20:00:00.000Z" },
    { org_id: ORG_ID, fundhub_ad_number: "7", ad_id: "ad-row-7", dies_before_25_alerted_on: "2026-10-11", updated_at: "2026-10-11T20:00:00.000Z" },
  ];
  const diagnoses = [
    { org_id: ORG_ID, fundhub_ad_number: "43", id: "dg-1", date: "2026-10-12", ad_id: "ad-row-1", diagnosis: "opening", fix_type: "words", film_note: "New first line.", next_take_improved: null, created_at: "2026-10-13T05:00:00.000Z" },
    { org_id: OTHER_ORG_ID, fundhub_ad_number: "43", id: "dg-x", date: "2026-10-12", ad_id: "ad-row-x", diagnosis: "ask", fix_type: "words", film_note: "Theirs.", next_take_improved: null, created_at: "2026-10-13T05:00:00.000Z" },
    { org_id: ORG_ID, fundhub_ad_number: "7", id: "dg-7", date: "2026-10-12", ad_id: "ad-row-7", diagnosis: "offer", fix_type: "words", film_note: "Ad 7.", next_take_improved: null, created_at: "2026-10-13T05:00:00.000Z" },
  ];
  const company = (re) => clause(re, (r, p) => r.org_id === p[0]);
  const numbered = (re) => clause(re, (r, p) => r.fundhub_ad_number === p[1]);
  return [
    [/FROM ads a\s+JOIN ad_sets s ON s\.id = a\.ad_set_id/, (sql, p) => shelf(ads, [company(/a\.org_id = \$1/), numbered(/a\.fundhub_ad_number = \$2/)])(sql, p)],
    [/SELECT DISTINCT ON \(s\.ad_id\)/, (sql, p) => {
      const kept = shelf(scriptRows, [
        company(/s\.org_id = \$1/),
        clause(/s\.ad_id = ANY\(\$2::text\[\]\)/, (r, params) => !params[1] || params[1].includes(r.ad_id)),
      ])(sql, p);
      return kept.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 1).map((r) => ({ ad_number: r.ad_id, ...r }));
    }],
    [/FROM client_ad_attribution WHERE org_id = \$1 AND ad_id = \$2/, (sql, p) => {
      const kept = shelf(attributions, [company(/WHERE org_id = \$1/), clause(/AND ad_id = \$2/, (r, params) => r.ad_id === params[1])])(sql, p);
      return [{ found: kept.length > 0 }];
    }],
    [/WITH [\s\S]*lead_by_number/, (_sql, p) => (p[0] === ORG_ID && (p[4] || []).includes(number) && row ? [row] : [])],
    [/FROM ad_metrics_daily m\s+JOIN ads a ON a\.id = m\.ad_id AND a\.org_id = m\.org_id\s+WHERE m\.org_id = \$1\s+AND a\.fundhub_ad_number = \$2/, []],
    [/FROM ad_watch_curve_alerts w/, (sql, p) => shelf(alerts, [company(/w\.org_id = \$1/), numbered(/a\.fundhub_ad_number = \$2/)])(sql, p)],
    [/FROM ad_watch_curve_diagnoses d/, (sql, p) => shelf(diagnoses, [company(/d\.org_id = \$1/), numbered(/a\.fundhub_ad_number = \$2/)])(sql, p)],
    [/max\(last_synced_at\) AS meta_synced_at/, [{ meta_synced_at: "2026-10-14T05:00:00.000Z" }]],
    [/max\(synced_at\) AS metrics_synced_at/, [{ metrics_synced_at: null, latest_metrics_date: null }]],
  ];
}

test("marketing/ad gives every field of the drawer's row as its words name them, with the script's own words, and the statements behind it say what the row means", async () => {
  const done = await hit(marketingAd, { role: "admin", query: { n: "43", org_id: OTHER_ORG_ID }, deps: { now: () => NOW }, rules: adRules() });
  assert.equal(done.status, 200);
  const { meta_ads: metaAds, curve, watch, ...row } = done.body.ad;
  assert.deepEqual(row, {
    ad_number: "43",
    title: "The call that was never a roadmap",
    funnel_key: "slo",
    script_format: "talking_head",
    angle_key: "speed_of_money",
    spend_cents: 30000,
    impressions: 9000,
    ctr: 0.0233,
    hook_rate: 0.3333,
    hold_25: 0.42,
    thruplay_rate: 0.18,
    leads: 12,
    booked: 5,
    showed: 4,
    sales: 2,
    close_rate: 0.5,
    roadmaps: 1,
    cash_cents: 59400,
    reported_cash_cents: 41000,
    cpl_cents: 2500,
    cost_per_booked_cents: 6000,
    roas: 1.98,
    maturing: true,
    ads: 2,
    link_clicks: 210,
    plays: 5000,
    ad_days: 6,
    reported_days: { link_clicks: 5, plays: 4, two_sec: 3 },
    maturing_leads: 2,
    cash_unknown: 1,
  });
  assert.deepEqual(metaAds.map((m) => m.id), ["ad-row-1"], "this company's ads that carry the number, not another company's, not another number's");
  assert.deepEqual(watch.alerts.map((a) => a.ad_id), ["ad-row-1"], "alerts of this company's ads of this number");
  assert.deepEqual(watch.diagnoses.map((d) => d.id), ["dg-1"], "diagnoses of this company's ads of this number");
  assert.deepEqual(sqlCalls(done, /FROM ad_watch_curve_alerts/)[0].params, [ORG_ID, "43"]);
  assert.deepEqual(sqlCalls(done, /FROM ad_watch_curve_diagnoses/)[0].params, [ORG_ID, "43"]);
  assert.deepEqual(sqlCalls(done, /SELECT DISTINCT ON/)[0].params.slice(0, 2), [ORG_ID, ["43"]]);

  // The ad numbers read: company, number, window.
  const [read] = sqlCalls(done, /lead_by_number/);
  assert.deepEqual(read.params.slice(0, 3), [ORG_ID, "2026-09-15", "2026-10-14"], "30 Arizona days ending today, both ends");
  assert.deepEqual(read.params[4], ["43"]);
  assertSqlHas(read.sql, AD_NUMBERS_PINS, "the ad number read");
});

test("marketing/ad opens a number the company knows only from a script, or only from a tagged lead of its own, and not one only another company knows", async () => {
  const onlyScript = await hit(marketingAd, { query: { n: "43" }, deps: { now: () => NOW }, rules: adRules({ metaAds: [], tagged: [], row: null }) });
  assert.equal(onlyScript.status, 200, "a script carries the number, so the company knows it");
  assert.equal(onlyScript.body.ad.title, "The call that was never a roadmap");
  assert.equal(onlyScript.body.ad.spend_cents, null, "no ad-day: unknown, not 0");
  assert.equal(onlyScript.body.ad.leads, 0);

  const onlyLead = await hit(marketingAd, { query: { n: "43" }, deps: { now: () => NOW }, rules: adRules({ metaAds: [], scripts: [], row: null }) });
  assert.equal(onlyLead.status, 200, "a lead of this company was tagged with it");
  assert.equal(onlyLead.body.ad.title, null);

  // Another company's script and another company's tagged lead of the number are not this company's knowledge.
  const foreign = await hit(marketingAd, {
    query: { n: "43" }, deps: { now: () => NOW },
    rules: adRules({
      metaAds: [], row: null,
      scripts: [{ org_id: OTHER_ORG_ID, ad_id: "43", title: "Theirs", funnel_key: "x", script_format: "x", angle_key: "x", archived_at: null, created_at: "2026-10-09" }],
      tagged: [{ org_id: OTHER_ORG_ID, ad_id: "43" }],
    }),
  });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "not_found");
});

/* ── marketing/angles ────────────────────────────────────────────────────── */

test("marketing/angles' statements pin what each number rests on: this company, the 30 days, ad-days that exist, the live script, and the lead results as defined", async () => {
  const rules = [
    [/-- m5:ad_labels/, []],
    [/-- m5:script_labels/, []],
    [/-- m5:ad_spend/, []],
    [/lead_by_number/, []],
    [/max\(last_synced_at\) AS meta_synced_at/, [{ meta_synced_at: "2026-10-14T05:00:00.000Z" }]],
    [/max\(synced_at\) AS metrics_synced_at/, [{ metrics_synced_at: null, latest_metrics_date: null }]],
  ];
  const done = await hit(marketingAngles, { role: "admin", query: { org_id: OTHER_ORG_ID }, deps: { now: () => NOW, angleNames: new Map() }, rules });
  assert.equal(done.status, 200);
  const [spend] = sqlCalls(done, /-- m5:ad_spend/);
  assert.deepEqual(spend.params, [ORG_ID, "2026-09-15", "2026-10-14"]);
  assertSqlHas(spend.sql, [
    ["FROM ads a JOIN ad_metrics_daily m ON m.ad_id = a.id", "an ad with no saved ad-day is not in the spend (an inner join, never a left join)"],
    ["WHERE a.org_id = $1 AND m.org_id = $1 AND m.date BETWEEN $2::date AND $3::date", "this company, inside the window (both ends)"],
    ["GROUP BY a.id", "one row per ad"],
  ], "the ad spend read");
  const [labels] = sqlCalls(done, /-- m5:ad_labels/);
  assert.deepEqual(labels.params, [ORG_ID]);
  assertSqlHas(labels.sql, [["WHERE v.org_id = $1", "this company's ads only"]], "the ad labels read");
  // The script labels are asked for with the company: they are only read when there are numbers to name.
  const withNumbers = await hit(marketingAngles, {
    deps: { now: () => NOW, angleNames: new Map() },
    rules: [
      [/-- m5:ad_labels/, [{ ad_row_id: "a1", ad_number: "43", spine_angle_key: null, campaign_external_id: null, campaign_funnel_key: null }]],
      [/-- m5:script_labels/, []],
      [/-- m5:ad_spend/, []],
      [/lead_by_number/, []],
      [/max\(last_synced_at\)/, [{ meta_synced_at: null }]],
      [/max\(synced_at\)/, [{ metrics_synced_at: null, latest_metrics_date: null }]],
    ],
  });
  const [script] = sqlCalls(withNumbers, /-- m5:script_labels/);
  assert.deepEqual(script.params, [ORG_ID, ["43"]]);
  assertSqlHas(script.sql, [
    ["FROM ad_scripts s WHERE s.org_id = $1 AND s.ad_id IS NOT NULL AND s.archived_at IS NULL AND s.ad_id = ANY ($2::text[])", "the live script of this company's numbers"],
  ], "the script labels read");
  assertSqlHas(sqlCalls(withNumbers, /lead_by_number/)[0].sql, AD_NUMBERS_PINS, "the ad number read");
});

/* ── marketing/flywheel ──────────────────────────────────────────────────── */

const NOTES = "# Owner notes\n\nOffer key: PARTNER_ENTRY\n\n## Notes\n";
const AVATAR = (status = "approved", counts = { quotes: 140, languageEntries: 120 }) => stampStage({
  stage: 1, version: 1, status, counts, body: "# Who we sell to\n\nThe owner.\n\n## Review card\n\nOK.",
});
const RESEARCH = stampStage({ stage: 2, version: 1, status: "approved", counts: { rowsVerified: 10, competitorsFound: 4, rowsWithFirstSeen: 8 }, body: "# The market\n\nMany sellers.\n\n## Review card\n\nOK." });
const OFFER = (status, inputs) => stampStage({
  stage: 3, version: 2, status, inputs, counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 },
  body: "# The offer\n\nA clear price.\n\n## Review card\n\nOK.",
});
const filesOf = (map) => Object.fromEntries(Object.entries(map).map(([name, text]) => [name, { text, source: "github" }]));

/* The saved-run reads: the newest run per step and the newest avatar run, each
   kept only while its statement still names this company (and this campaign),
   and the ledger summed for that run alone. */
const RUN = (over = {}) => ({
  id: "run-1", org_id: ORG_ID, kind: "flywheel_stage", status: "running", error: null, result: {}, attempts: 1,
  payload: { campaign: "partner", stage: 2 }, created_at: "2026-10-14T18:50:00.000Z", claimed_at: "2026-10-14T18:51:00.000Z", finished_at: null, ...over,
});
function savedRunRules({ stageRuns = [], avatarRuns = [], ledger = [] } = {}) {
  const sumFor = (jobId, key) => ledger.filter((r) => r.job_id === jobId).reduce((n, r) => n + r[key], 0);
  return [
    [/WITH newest AS/, (sql, p) => {
      const kept = shelf(stageRuns, [
        clause(/j\.org_id = \$1/, (r, params) => r.org_id === params[0]),
        clause(/j\.payload->>'campaign' = \$2/, (r, params) => r.payload.campaign === params[1]),
      ])(sql, p);
      const newest = new Map();
      for (const r of kept.sort((a, b) => b.created_at.localeCompare(a.created_at))) {
        const stage = r.kind === "offer" ? 3 : Number(r.payload.stage);
        if (!newest.has(stage)) newest.set(stage, { ...r, stage, spent_usd: ledger.some((l) => l.job_id === r.id) ? sumFor(r.id, "cost_usd") : 0 });
      }
      return [...newest.values()];
    }],
    [/FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = 'avatar' AND payload ->> 'campaign' = \$2/, (sql, p) => shelf(avatarRuns, [
      clause(/WHERE org_id = \$1/, (r, params) => r.org_id === params[0]),
      clause(/payload ->> 'campaign' = \$2/, (r, params) => r.payload.campaign === params[1]),
    ])(sql, p).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 1)],
    [/FROM marketing_model_usage WHERE job_id = \$1/, (_sql, p) => [{
      cost_usd: sumFor(p[0], "cost_usd"), unpriced: 0, searches: sumFor(p[0], "searches"), fetches: 0, calls: sumFor(p[0], "calls"),
    }]],
  ];
}
const flywheelDeps = (files, campaigns = ["capital-blueprint", "partner"]) => ({
  env: {}, roots: [],
  readFlywheel: async () => ({ campaigns, files: filesOf(files), source: "github", fallback_reason: null, commit_sha: "abc1234" }),
});
const wordsOf = (body) => body.stages.map((s) => [s.state_word, s.sentence]);
const read = (files, rules = savedRunRules(), query = { campaign: "partner" }) =>
  hit(marketingFlywheel, { role: "admin", query, deps: flywheelDeps(files), rules });

test("marketing/flywheel names the six steps and says each one's state in plain words: nothing run, done and approved, out of date, needs a redo, waiting on a step", async () => {
  const LABELS = [
    ["Who we sell to", "Who we sell to, step 1 of 6"],
    ["What the market sells", "What the market sells, step 2 of 6"],
    ["The offer", "The offer, step 3 of 6"],
    ["Ad copy for the Partner offer", "Ad copy for the Partner offer, step 4 of 6"],
    ["Which ad strategy", "Which ad strategy, step 5 of 6"],
    ["Read the spend", "Read the spend, step 6 of 6"],
  ];
  const NOT_BUILT = ["Not on this page yet", "Not on this page yet: it ships in slice 5a. Cost not measured."];
  const NOT_BUILT_2 = ["Not on this page yet", "Not on this page yet: it ships in slice 10. Cost not measured."];

  const empty = await read({});
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.stages.map((s) => [s.label_words, s.step_words]), LABELS, "every step is named, and says which of six it is");
  assert.deepEqual(wordsOf(empty.body), [
    NOT_BUILT, NOT_BUILT_2,
    ["Not run yet", "Not started. Waiting on steps 1 and 2."],
    ["Not run yet", "Not started. Waiting on step 3."],
    ["Not run yet", "Not started. Waiting on steps 3 and 4."],
    ["Not run yet", "Not started. Waiting on steps 4 and 5."],
  ]);
  assert.equal(empty.body.advice, "Next to run: step 1, who we sell to.");
  assert.ok(empty.body.stages.every((s) => s.gate.sentence === null && s.document_md === null && s.review_card_md === null && s.files.length === 0), "a step with no file has no document, no card and no link");

  const ready = await read({ "00-OWNER-NOTES.md": NOTES, "01-avatar.md": AVATAR(), "02-ad-research.md": RESEARCH, "03-offer.md": OFFER("approved", { "01-avatar.md": hashOf(AVATAR()), "02-ad-research.md": hashOf(RESEARCH) }) });
  assert.deepEqual(wordsOf(ready.body).slice(0, 3), [
    ["Done, approved", "Done. 140 customer quotes. Version 1. Approved."],
    ["Done, approved", "Done. 10 checked findings. Version 1. Approved."],
    ["Done, approved", "Done. Price set, 3 bonuses. Version 2. Approved."],
  ]);
  assert.deepEqual(wordsOf(ready.body).slice(3), [
    ["Not run yet", "Not started."],
    ["Not run yet", "Not started. Waiting on step 4."],
    ["Not run yet", "Not started. Waiting on steps 4 and 5."],
  ]);
  assert.equal(ready.body.advice, "Next to run: step 4, ad copy for the partner offer.");
  const offerRow = ready.body.stages[2];
  assert.equal(offerRow.gate.sentence, null, "a step that clears the bar says nothing against it");
  assert.match(offerRow.document_md, /^# The offer\n\nA clear price\./, "the step's document, without its stamp");
  assert.match(offerRow.review_card_md, /^## Review card/);
  assert.deepEqual(offerRow.files, [{
    path: "marketing/flywheel/partner/03-offer.md",
    github_url: "https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/abc1234/marketing/flywheel/partner/03-offer.md",
  }]);
  // Done but not yet read by a person.
  const unread = await read({ "00-OWNER-NOTES.md": NOTES, "01-avatar.md": AVATAR("draft") });
  assert.deepEqual(wordsOf(unread.body)[0], ["Done", "Done. 140 customer quotes. Version 1. Not reviewed."]);

  const stale = await read({ "00-OWNER-NOTES.md": NOTES, "01-avatar.md": AVATAR(), "02-ad-research.md": RESEARCH, "03-offer.md": OFFER("approved", { "01-avatar.md": "deadbeef", "02-ad-research.md": hashOf(RESEARCH) }) });
  assert.deepEqual(wordsOf(stale.body)[2], ["Out of date", "Out of date: avatar changed since it was built, so this needs a redo."]);
  assert.equal(stale.body.stages[2].gate.sentence, "Does not clear the bar for the next step: avatar changed since it was built.");
  assert.equal(stale.body.advice, "1 step needs a redo. Do them in order: 3.");

  const thin = await read({ "00-OWNER-NOTES.md": NOTES, "01-avatar.md": AVATAR("draft", { quotes: 3, languageEntries: 2 }) });
  assert.deepEqual(wordsOf(thin.body)[0], ["Needs a redo", "Needs a redo: only 3 customer quotes, needs 20; only 2 phrases in the word bank, needs 100."]);
  assert.equal(thin.body.stages[0].gate.sentence, "Does not clear the bar for the next step: only 3 customer quotes, needs 20; only 2 phrases in the word bank, needs 100.");
  assert.equal(thin.body.advice, "1 step needs a redo. Do them in order: 1.");

  const waiting = await read({ "00-OWNER-NOTES.md": NOTES, "03-offer.md": OFFER("draft", {}) });
  assert.deepEqual(wordsOf(waiting.body)[2], ["Waiting on steps 1 and 2", "Waiting on steps 1 and 2."]);
  assert.equal(waiting.body.stages[2].gate.sentence, "Does not clear the bar for the next step: 01-avatar.md is missing; 02-ad-research.md is missing.");
  const oneMissing = await read({ "00-OWNER-NOTES.md": NOTES, "01-avatar.md": AVATAR(), "03-offer.md": OFFER("draft", { "01-avatar.md": hashOf(AVATAR()) }) });
  assert.deepEqual(wordsOf(oneMissing.body)[2], ["Waiting on step 2", "Waiting on step 2."]);

  // Every step done and approved: the footer says so, and each step's own words are its count.
  const OFFER_OK = OFFER("approved", { "01-avatar.md": hashOf(AVATAR()), "02-ad-research.md": hashOf(RESEARCH) });
  const BANK = "# Market language bank\n\nphrases the market uses\n";
  const COPY_OK = stampStage({
    stage: 4, version: 1, status: "approved", inputs: { "03-offer.md": hashOf(OFFER_OK), "01-avatar/Market_Language_Bank.md": hashOf(BANK) },
    counts: { hooks: 6, humanizerPassRun: 1, distinctReasons: 16 }, body: "# Ad copy\n\nSix hooks.\n\n## Review card\n\nOK.",
  });
  const STRATEGY_OK = stampStage({
    stage: 5, version: 1, status: "approved", inputs: { "03-offer.md": hashOf(OFFER_OK), "04-copy.md": hashOf(COPY_OK) },
    counts: { strategyNamed: 1, dailyBudgetStated: 1 }, body: "# Strategy\n\nOne strategy.\n\n## Review card\n\nOK.",
  });
  const SPEND_OK = stampStage({
    stage: 6, version: 1, status: "approved", inputs: { "04-copy.md": hashOf(COPY_OK), "05-ad-strategy.md": hashOf(STRATEGY_OK) },
    counts: { adsRead: 2 }, body: "# Spend\n\nTwo ads.\n\n## Review card\n\nOK.",
  });
  const everything = await read({
    "00-OWNER-NOTES.md": NOTES, "01-avatar.md": AVATAR(), "02-ad-research.md": RESEARCH, "03-offer.md": OFFER_OK,
    "01-avatar/Market_Language_Bank.md": BANK, "04-copy.md": COPY_OK, "05-ad-strategy.md": STRATEGY_OK, "06-spend.md": SPEND_OK,
  });
  assert.deepEqual(wordsOf(everything.body).slice(3), [
    ["Done, approved", "Done. 6 hooks, 16 reasons to buy. Version 1. Approved."],
    ["Done, approved", "Done. Strategy chosen. Version 1. Approved."],
    ["Done, approved", "Done. 2 ads read. Version 1. Approved."],
  ]);
  assert.equal(everything.body.advice, "Every step is current.");
  // The campaigns named, in words, with the chosen one's words from its own notes.
  assert.deepEqual(ready.body.campaigns.map((c) => ({ name: c.name, words: c.words })), [{ name: "capital-blueprint", words: "Capital blueprint" }, { name: "partner", words: "Partner offer" }]);
  assert.equal(ready.body.campaign_words, "Partner offer");
  assert.equal(JSON.stringify(ready.body).includes("sk-"), false);
});

test("marketing/flywheel shows the newest saved run of THIS company and THIS campaign: running with the dollars, could not finish, stopped at the cap, and the avatar run on step 1", async () => {
  const runs = [
    RUN({ id: "run-old", status: "failed", error: "an old failure", created_at: "2026-10-10T10:00:00.000Z", finished_at: "2026-10-10T10:05:00.000Z" }),
    RUN({ id: "run-now", status: "running", result: { progress: { step: "ads", step_n: 2, steps_total: 5, step_word: "reading ads" } } }),
    // Newer, and someone else's: another company, and another campaign. Neither may show.
    RUN({ id: "run-foreign", org_id: OTHER_ORG_ID, status: "failed", error: "their failure", created_at: "2026-10-14T19:30:00.000Z" }),
    RUN({ id: "run-other-campaign", payload: { campaign: "capital-blueprint", stage: 2 }, status: "failed", error: "other campaign", created_at: "2026-10-14T19:31:00.000Z" }),
  ];
  const ledger = [{ job_id: "run-now", cost_usd: 1.5, searches: 12, calls: 3 }, { job_id: "run-foreign", cost_usd: 99, searches: 99, calls: 9 }];
  const going = await read({ "00-OWNER-NOTES.md": NOTES }, savedRunRules({ stageRuns: runs, ledger }));
  const step2 = going.body.stages[1];
  assert.equal(step2.state_word, "Running");
  assert.equal(step2.sentence, "Running: step 2 of 5, reading ads. $1.50 spent so far.", "the run's own step and its own dollars");
  assert.equal(step2.run.job_id, "run-now");
  assert.equal(step2.run.status, "running");
  assert.equal(step2.run.cost_so_far_usd, 1.5);
  assert.equal(step2.run.resumable, false);
  assert.deepEqual(sqlCalls(going, /WITH newest AS/)[0].params, [ORG_ID, "partner"]);

  const failed = await read({}, savedRunRules({ stageRuns: [RUN({ id: "r", status: "failed", error: "the model refused the request" })] }));
  assert.deepEqual([failed.body.stages[1].state_word, failed.body.stages[1].sentence], ["Needs a redo", "Could not finish: the model refused the request"]);
  assert.equal(failed.body.stages[1].run.resumable, true);
  const capped = await read({}, savedRunRules({ stageRuns: [RUN({ id: "r", status: "failed", error: "Stopped at the $6 run cap.", result: { stopped_at_cap: true } })] }));
  assert.deepEqual([capped.body.stages[1].state_word, capped.body.stages[1].sentence], ["Stopped at the cap", "Stopped at the $6 run cap."]);

  // Step 1 reads the newest avatar run of this company and campaign, and says it in the run's own words.
  const avatar = (over) => ({
    id: "av-1", org_id: ORG_ID, kind: "avatar", status: "running", attempts: 1, error: null, result: null,
    payload: { campaign: "partner", step: "quotes", progress: { steps: { foundation: { status: "done" } } } },
    created_at: "2026-10-14T18:50:00.000Z", finished_at: null, ...over,
  });
  const av = [
    avatar({}),
    avatar({ id: "av-foreign", org_id: OTHER_ORG_ID, status: "failed", error: "their avatar failed", created_at: "2026-10-14T19:40:00.000Z" }),
  ];
  const withAvatar = await read({ "00-OWNER-NOTES.md": NOTES }, savedRunRules({ avatarRuns: av, ledger: [{ job_id: "av-1", cost_usd: 2.25, searches: 7, calls: 4 }] }));
  const one = withAvatar.body.stages[0];
  assert.equal(one.state_word, "Running");
  assert.equal(one.sentence, "Running: step 3 of 10, searching the web for buyer quotes, round 1. 0 new quotes so far. $2.25 spent so far, 7 searches.");
  assert.equal(one.run.job_id, "av-1", "this company's run, not the newer one of another company");
  assert.equal(one.run.kind, "avatar");

  const avatarFailed = await read({ "00-OWNER-NOTES.md": NOTES }, savedRunRules({ avatarRuns: [avatar({ status: "failed", error: "ran out of searches" })] }));
  assert.deepEqual([avatarFailed.body.stages[0].state_word, avatarFailed.body.stages[0].sentence], ["Could not finish", "Could not finish: ran out of searches"]);
  const avatarCapped = await read({ "00-OWNER-NOTES.md": NOTES }, savedRunRules({
    avatarRuns: [avatar({ status: "failed", error: "cap", payload: { campaign: "partner", step: "quotes", progress: { stopped_at_cap: { sentence: "Stopped at the $6 run cap." } } } })],
  }));
  assert.deepEqual([avatarCapped.body.stages[0].state_word, avatarCapped.body.stages[0].sentence], ["Stopped at the cap", "Stopped at the $6 run cap."]);
});

/* ── marketing/flywheel/job ──────────────────────────────────────────────── */

const JOB_ID = "0b000000-0000-4000-8000-000000000009";
const avatarJob = (over = {}) => ({
  id: JOB_ID, org_id: ORG_ID, kind: "avatar", status: "running", attempts: 2, error: null, result: null,
  payload: {
    campaign: "partner", step: "quotes", run_cap_usd: 6,
    progress: {
      started_at: "2026-10-14T18:51:30.000Z",
      steps: {
        foundation: { status: "done", attempts: 1, started_at: "2026-10-14T18:51:30.000Z", finished_at: "2026-10-14T18:53:00.000Z" },
        overview: { status: "done", attempts: 1, started_at: "2026-10-14T18:53:00.000Z", finished_at: "2026-10-14T18:55:00.000Z" },
        quotes: { status: "running", attempts: 2, started_at: "2026-10-14T18:55:00.000Z" },
      },
    },
  },
  created_at: "2026-10-14T18:50:00.000Z", finished_at: null, ...over,
});

test("marketing/flywheel/job reads the cost from THIS run's ledger rows only, and reports its steps one by one, its step number, attempts, start time and where it stopped", async () => {
  const ledger = [
    { job_id: JOB_ID, cost_usd: 1.5, searches: 20, calls: 5 },
    { job_id: "another-run", cost_usd: 40, searches: 900, calls: 500 },
  ];
  const rules = (job) => [
    [/FROM marketing_jobs WHERE id = \$1 AND org_id = \$2 AND kind = 'avatar'/, (sql, p) => shelf([job], [
      clause(/WHERE id = \$1 AND org_id = \$2/, (row, params) => row.id === params[0] && row.org_id === params[1]),
    ])(sql, p)],
    // The ledger sums the run's own rows: a statement that stops naming the job sums everyone's.
    [/FROM marketing_model_usage/, (sql, p) => {
      const kept = /WHERE job_id = \$1/.test(sql) ? ledger.filter((r) => r.job_id === p[0]) : ledger;
      const sum = (key) => kept.reduce((n, r) => n + r[key], 0);
      return [{ cost_usd: sum("cost_usd"), unpriced: 0, searches: sum("searches"), fetches: 0, calls: sum("calls") }];
    }],
  ];
  const done = await hit(flywheelJob, { role: "admin", query: { id: JOB_ID, org_id: OTHER_ORG_ID }, rules: rules(avatarJob()) });
  assert.equal(done.status, 200);
  const job = done.body.job;
  assert.equal(job.cost_so_far_usd, 1.5, "this run's own cost, not every run's");
  assert.equal(job.searches_so_far, 20);
  assert.match(job.sentence, /\$1\.50 spent so far, 20 searches\.$/);
  assert.equal(job.attempts, 2);
  assert.equal(job.status, "running");
  assert.equal(job.step, "quotes");
  assert.equal(job.step_n, 3, "step 3 is the one running");
  assert.equal(job.steps_total, 10);
  assert.equal(job.step_word, "searching the web for buyer quotes");
  assert.equal(job.started_at, "2026-10-14T18:51:30.000Z");
  assert.equal(job.stopped_at_cap, null);
  assert.deepEqual(job.steps.slice(0, 4).map((s) => [s.n, s.key, s.status, s.attempts]), [
    [1, "foundation", "done", 1], [2, "overview", "done", 1], [3, "quotes", "running", 2], [4, "sort", "not_started", 0],
  ]);
  assert.equal(job.steps.length, 10, "all ten steps, in order");
  assert.deepEqual(sqlCalls(done, /FROM marketing_model_usage/)[0].params, [JOB_ID]);
  assert.deepEqual(sqlCalls(done, /FROM marketing_jobs WHERE id/)[0].params, [JOB_ID, ORG_ID], "the company is the sign-in's, not the address's");

  // A run that stopped at its cap says so, in the run's own words.
  const capped = await hit(flywheelJob, {
    query: { id: JOB_ID },
    rules: rules(avatarJob({
      status: "failed", error: "cap",
      payload: { ...avatarJob().payload, progress: { ...avatarJob().payload.progress, stopped_at_cap: { sentence: "Stopped at the $6 run cap. $5.98 was spent." } } },
    })),
  });
  assert.equal(capped.body.job.sentence, "Stopped at the $6 run cap. $5.98 was spent.");
  assert.deepEqual(capped.body.job.stopped_at_cap, { sentence: "Stopped at the $6 run cap. $5.98 was spent." });
  assert.equal(capped.body.job.resumable, true);
});
