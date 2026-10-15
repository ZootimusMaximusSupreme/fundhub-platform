// Batch 24, repair cycle 1: the Winner's Board (GET /api/adintel/board).
//
// An independent checker broke this door in eighteen ways and eleven stayed
// green: only the movers feed was really judged. The other four views each got
// one canned row for any statement that matched one pattern, so what decides
// their rows (this company, this week, the company's own ads left out) was never
// tested, and the movers feed could lose its week filter or its rank filter.
//
// The real api/ handler and the real board read model. The stand-in table keeps
// a row only while the statement's own text carries that row's condition, so a
// statement that loses a condition brings the row back and the test turns red.
// This is a PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import test from "node:test";

import adintelBoard from "../../../../api/adintel/board.mjs";
import { ANGLES } from "../../../creative-intel/taxonomy.mjs";
import { RANK_BASIS_NOTE, NO_SPEND_NOTE } from "../../../creative-intel/board.mjs";
import { ORG_ID, OTHER_ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const WEEK = "2026-W41";
const OLD_WEEK = "2026-W40";
const asPartner = { account: { kind: "partner", partnerId: PARTNER } };
// A request that tries to talk its way into another company or another partner.
const HOSTILE = { partner_id: OTHER_PARTNER, org_id: OTHER_ORG_ID };

const signal = (over = {}) => ({
  org_id: ORG_ID, iso_week: WEEK, content_hash: "h", platform: "meta", advertiser_id: "adv-1", headline: "Get funded fast",
  destination_domain: "example.test", media_kind: "video", angle: ANGLES[0], ad_format: "video", promise_shape: "speed",
  compliance_risk: "clean", funnel: "vsl", hook_line: "In 24 hours", screen_state: "passed", ad_age_days: 40, variant_count: 3,
  relaunch_count: 1, creative_velocity: 2, placement_spread: 3, landing_page_changed: false, offer_price_cents: null,
  offer_term: null, new_entrant: false, death_watch: false, cross_platform_echo: false, tiktok_perf_bucket: null,
  winner_score_rank: 1, winner_score_band: "hot", rank_delta: null, watch_group: "direct", last_observed_on: "2026-10-09",
  first_seen_at: "2026-10-06T00:00:00.000Z", on_watch_list: false,
  // columns that exist and must never reach a partner:
  winner_score: 0.91, weights_version: "w3", cost_cents: 41, vendor_run_id: "run-9",
  ...over,
});

/* Each condition of the board's statements, keyed on the statement's own text. A
   condition the statement no longer writes is not applied, so the row it kept out
   comes back. Alias-free on purpose: the column is what is judged. */
const CONDITIONS = [
  clause(/\b[sr]\.org_id = \$1/, (row, p) => row.org_id === p[0]),
  clause(/\bs\.iso_week = \$2/, (row, p) => row.iso_week === p[1]),
  clause(/\bs\.winner_score_rank IS NOT NULL/, (row) => row.winner_score_rank != null),
  clause(/\bs\.death_watch IS TRUE/, (row) => row.death_watch === true),
  clause(/\bs\.new_entrant IS TRUE/, (row) => row.new_entrant === true),
  clause(/coalesce\(w\.watch_group, 'direct'\) <> 'own'/, (row) => (row.watch_group ?? "direct") !== "own"),
  clause(/\bk\.angle = \$(\d+)/, (row, p, m) => row.angle === p[Number(m[1]) - 1]),
  clause(/\bs\.winner_score_band = \$(\d+)/, (row, p, m) => row.winner_score_band === p[Number(m[1]) - 1]),
  clause(/\bc\.platform = \$(\d+)/, (row, p, m) => row.platform === p[Number(m[1]) - 1]),
  clause(/\bk\.compliance_risk = \$(\d+)/, (row, p, m) => row.compliance_risk === p[Number(m[1]) - 1]),
];

function boardRules({ signals = [], records = [], weeks = null } = {}) {
  const weekRows = weeks || [
    { org_id: ORG_ID, iso_week: WEEK, creatives: 3, computed_at: "2026-10-12T05:00:00.000Z" },
    { org_id: ORG_ID, iso_week: OLD_WEEK, creatives: 2, computed_at: "2026-10-05T05:00:00.000Z" },
    { org_id: OTHER_ORG_ID, iso_week: "2026-W44", creatives: 9, computed_at: "2026-11-02T05:00:00.000Z" },
  ];
  return [
    [/FROM ad_creative_signals\s+WHERE org_id = \$1\s+GROUP BY iso_week/, (sql, p) => shelf(weekRows, [
      clause(/WHERE org_id = \$1/, (row, params) => row.org_id === params[0]),
    ])(sql, p)],
    [/SELECT DISTINCT r\.content_hash/, (sql, p) => shelf(records, CONDITIONS)(sql, p)],
    [/count\(DISTINCT c\.content_hash\)/, (sql, p) => {
      const kept = shelf(signals, CONDITIONS)(sql, p);
      const groups = new Map();
      for (const row of kept) {
        const key = `${row.advertiser_id}|${row.platform}`;
        const g = groups.get(key) || { advertiser_id: row.advertiser_id, platform: row.platform, hashes: new Set(), first_seen_at: row.first_seen_at, on_watch_list: row.on_watch_list };
        g.hashes.add(row.content_hash);
        groups.set(key, g);
      }
      return [...groups.values()].map((g) => ({ advertiser_id: g.advertiser_id, platform: g.platform, creatives: g.hashes.size, first_seen_at: g.first_seen_at, on_watch_list: g.on_watch_list }));
    }],
    [/FROM ad_creative_signals s\s+JOIN ad_creatives_seen c/, (sql, p) => shelf(signals, CONDITIONS)(sql, p)],
  ];
}

const hashes = (out) => out.body.items.map((i) => i.content_hash).sort();
const FEED = /FROM ad_creative_signals s\s+JOIN ad_creatives_seen c/;

test("adintel/board movers keeps only this company's ranked creatives of the chosen week, leaves out the company's own ads, and flags a blocked creative do-not-copy", async () => {
  const signals = [
    signal({ content_hash: "h-top", winner_score_rank: 1 }),
    signal({ content_hash: "h-second", winner_score_rank: 2, winner_score_band: "warm" }),
    // Each of these must be kept out by one named condition of the statement.
    signal({ content_hash: "h-own", watch_group: "own", winner_score_rank: 3 }),
    signal({ content_hash: "h-other-company", org_id: OTHER_ORG_ID, winner_score_rank: 4 }),
    signal({ content_hash: "h-last-week", iso_week: OLD_WEEK, winner_score_rank: 5 }),
    signal({ content_hash: "h-unranked", winner_score_rank: null }),
    // A creative the screen blocked is shown, greyed: clean risk, blocked state.
    signal({ content_hash: "h-blocked", compliance_risk: "clean", screen_state: "blocked", winner_score_rank: 6 }),
  ];
  const done = await hit(adintelBoard, { ...asPartner, query: HOSTILE, rules: boardRules({ signals }) });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true, "the page reads ok:true; without it the screen says the server failed");
  assert.equal(done.body.view, "movers");
  assert.equal(done.body.week, WEEK);
  assert.deepEqual(done.body.items.map((i) => i.content_hash), ["h-top", "h-second", "h-blocked"], "ranked best first; not the company's own, not another company's, not last week's, not unranked");
  assert.equal(done.body.items.find((i) => i.content_hash === "h-blocked").do_not_copy, true, "a blocked screen state is do-not-copy whatever its risk word says");
  assert.equal(done.body.items.find((i) => i.content_hash === "h-top").do_not_copy, false);
  const body = JSON.stringify(done.body);
  for (const secret of ["winner_score\"", "weights_version", "cost_cents", "vendor_run_id", "watch_group"]) {
    assert.equal(body.includes(secret), false, `${secret} never reaches a partner`);
  }
  const [call] = sqlCalls(done, FEED);
  assert.deepEqual(call.params, [ORG_ID, WEEK, OLD_WEEK, 51, 0], "the company is the sign-in's, never the one in the address");
  assert.deepEqual(sqlCalls(done, /GROUP BY iso_week/)[0].params, [ORG_ID, 1]);
  assert.deepEqual(done.db.calls.find((c) => /set_config\('fundhub\.partner_id'/.test(c.sql)).params, [PARTNER]);
  assert.match(call.sql, /ORDER BY s\.winner_score_rank ASC/);
});

test("adintel/board movers narrows by each filter on its own, and a named week is used as given", async () => {
  const signals = [
    signal({ content_hash: "hot-meta", winner_score_band: "hot", platform: "meta", angle: ANGLES[0] }),
    signal({ content_hash: "warm-meta", winner_score_band: "warm", platform: "meta", angle: ANGLES[1] }),
    signal({ content_hash: "hot-tiktok", winner_score_band: "hot", platform: "tiktok", angle: ANGLES[1] }),
    signal({ content_hash: "risky-meta", winner_score_band: "cold", platform: "meta", angle: ANGLES[0], compliance_risk: "implies_guaranteed_approval" }),
  ];
  const ask = (query) => hit(adintelBoard, { ...asPartner, query: { ...query, org_id: OTHER_ORG_ID }, rules: boardRules({ signals }) });

  assert.deepEqual(hashes(await ask({ band: "hot" })), ["hot-meta", "hot-tiktok"], "band hot: not warm, not cold");
  assert.deepEqual(hashes(await ask({ band: "warm" })), ["warm-meta"]);
  assert.deepEqual(hashes(await ask({ platform: "meta" })), ["hot-meta", "risky-meta", "warm-meta"], "platform meta: not tiktok");
  assert.deepEqual(hashes(await ask({ platform: "tiktok" })), ["hot-tiktok"]);
  assert.deepEqual(hashes(await ask({ angle: ANGLES[1] })), ["hot-tiktok", "warm-meta"]);
  assert.deepEqual(hashes(await ask({ risk: "implies_guaranteed_approval" })), ["risky-meta"], "risk filter");
  assert.deepEqual(hashes(await ask({ band: "hot", platform: "meta", angle: ANGLES[0] })), ["hot-meta"], "all three at once");
  // A stray value narrows nothing and blanks nothing.
  assert.deepEqual(hashes(await ask({ band: "lukewarm", platform: "myspace", risk: "none", angle: "not-an-angle" })), ["hot-meta", "hot-tiktok", "risky-meta", "warm-meta"]);

  const named = await hit(adintelBoard, {
    ...asPartner, query: { week: "2026-W38", org_id: OTHER_ORG_ID },
    rules: boardRules({ signals: signals.map((s) => ({ ...s, iso_week: "2026-W38" })) }),
  });
  assert.equal(named.body.week, "2026-W38");
  assert.equal(named.body.ok, true);
  assert.equal(named.body.items.length, 4, "the named week's rows, not the latest week's");
  assert.deepEqual(sqlCalls(named, FEED)[0].params.slice(0, 3), [ORG_ID, "2026-W38", "2026-W37"]);
});

test("adintel/board death watch, new entrants, saturation and weeks each keep only this company's rows for the week, without the company's own advertisers", async () => {
  const signals = [
    signal({ content_hash: "dw-ok", death_watch: true, advertiser_id: "adv-dw" }),
    signal({ content_hash: "dw-other-company", org_id: OTHER_ORG_ID, death_watch: true, advertiser_id: "adv-x" }),
    signal({ content_hash: "dw-last-week", iso_week: OLD_WEEK, death_watch: true, advertiser_id: "adv-old" }),
    signal({ content_hash: "dw-own", death_watch: true, watch_group: "own", advertiser_id: "adv-own" }),
    signal({ content_hash: "not-dying", death_watch: false, advertiser_id: "adv-fine" }),
    signal({ content_hash: "ne-ok", new_entrant: true, advertiser_id: "adv-ne" }),
    signal({ content_hash: "ne-other-company", org_id: OTHER_ORG_ID, new_entrant: true, advertiser_id: "adv-ne-x" }),
    signal({ content_hash: "ne-last-week", iso_week: OLD_WEEK, new_entrant: true, advertiser_id: "adv-ne-old" }),
    signal({ content_hash: "ne-own", new_entrant: true, watch_group: "own", advertiser_id: "adv-ne-own" }),
  ];
  const records = [
    { org_id: ORG_ID, content_hash: "r-ok", advertiser_id: "adv-1", angle: ANGLES[0], ad_format: "video", funnel: "vsl", watch_group: "direct" },
    { org_id: ORG_ID, content_hash: "r-ok-2", advertiser_id: "adv-2", angle: ANGLES[0], ad_format: "video", funnel: "vsl", watch_group: "direct" },
    { org_id: OTHER_ORG_ID, content_hash: "r-other-company", advertiser_id: "adv-9", angle: ANGLES[0], ad_format: "video", funnel: "vsl", watch_group: "direct" },
    { org_id: ORG_ID, content_hash: "r-own", advertiser_id: "adv-own", angle: ANGLES[0], ad_format: "video", funnel: "vsl", watch_group: "own" },
  ];
  const ask = (view) => hit(adintelBoard, { ...asPartner, query: { view, ...HOSTILE }, rules: boardRules({ signals, records }) });

  const dying = await ask("death-watch");
  assert.equal(dying.status, 200);
  assert.equal(dying.body.ok, true);
  assert.equal(dying.body.view, "death-watch");
  assert.deepEqual(hashes(dying), ["dw-ok"], "this company, this week, dying, and not the company's own");
  assert.deepEqual(sqlCalls(dying, FEED).at(-1).params, [ORG_ID, WEEK, 51, 0]);

  const entrants = await ask("new-entrants");
  assert.equal(entrants.status, 200);
  assert.equal(entrants.body.ok, true);
  assert.deepEqual(entrants.body.items.map((e) => e.advertiser_id), ["adv-ne"], "this company, this week, new, and not the company's own");
  assert.deepEqual(sqlCalls(entrants, /count\(DISTINCT c\.content_hash\)/)[0].params, [ORG_ID, WEEK, 51]);

  const grid = await ask("saturation");
  assert.equal(grid.status, 200);
  assert.equal(grid.body.ok, true);
  assert.equal(grid.body.meta.totals.creatives, 2, "two live creatives of this company, not the other company's, not the company's own");
  assert.equal(grid.body.meta.totals.advertisers, 2);
  assert.deepEqual(grid.body.items.map((c) => [c.angle, c.advertisers, c.ads]), [[ANGLES[0], 2, 2]]);
  assert.deepEqual(sqlCalls(grid, /SELECT DISTINCT r\.content_hash/)[0].params, [ORG_ID, "2026-10-05", "2026-10-11"]);

  const weeks = await ask("weeks");
  assert.equal(weeks.status, 200);
  assert.equal(weeks.body.ok, true);
  assert.deepEqual(weeks.body.items.map((w) => w.iso_week), [WEEK, OLD_WEEK], "this company's rolled-up weeks, not another company's later one");
  assert.deepEqual(sqlCalls(weeks, /GROUP BY iso_week/).at(-1).params, [ORG_ID, 51]);
});
