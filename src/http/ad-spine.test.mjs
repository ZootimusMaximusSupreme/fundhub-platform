/* Database-free tests for /api/read/ad-spine.
 *
 * WHY THIS FILE EXISTS. Its sibling src/http/ad-spine.pg.test.mjs is the real
 * end-to-end proof, and it skips entirely with DATABASE_URL unset — which means
 * that on a machine with no Postgres, nothing in this endpoint was executed at
 * all. A skipped .pg.test.mjs is not green (CLAUDE.md §12).
 *
 * The handler was written with that in mind: readDays, windowFor, buildFilters,
 * buildQuery and shapeGroup are all exported and all pure. The single most
 * important claim the endpoint makes — that an unknown never quietly becomes 0 —
 * lives in shapeGroup, which is plain JavaScript and needs no database in front
 * of it. This file asserts it, and runs everywhere.
 *
 * NO `.pg.` IN THE NAME, ON PURPOSE: npm test's glob is src/** and scripts/**
 * (CLAUDE.md §12) and this file is meant to run on every push.
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";

import {
  buildFilters,
  buildQuery,
  shapeGroup,
  windowFor,
  AD_NUMBER_MATCH,
  LABELS,
  GROUPS
} from "../../api/read/ad-spine.mjs";

// readDays is imported from where it now LIVES rather than from the handler.
// It used to be a copy inside api/read/ad-spine.mjs; the single definition moved
// to src/http/read-api.mjs so finance-command and ad-spine cannot drift apart.
import { readDays, DEFAULT_DAYS, MAX_DAYS } from "./read-api.mjs";

const ORG = "11111111-2222-3333-4444-555555555555";

/* row — a grouped row shaped the way buildQuery really returns one, so a test
   overriding one field is not silently exercising a shape Postgres never sends.
   has_window: true because the handler ALWAYS builds a window in grouped mode. */
const row = (over = {}) => ({
  label_key: "x",
  label_name: null,
  ads: 3,
  ads_with_number: 2,
  spend_cents: null,
  impressions: null,
  clicks: null,
  video_continuous_2s_watched: null,
  video_p75_watched: null,
  ad_days_reported: 0,
  ads_reported_in_window: 0,
  people: null,
  people_booked: null,
  has_window: true,
  ...over
});

describe("ad-spine: unknown never becomes zero", () => {
  test("a group with no spend reported keeps spend null, and still counts its people as 0", () => {
    const g = shapeGroup(row());

    // THE HEADLINE CLAIM. "Nobody told us what this cost" is not "this cost
    // nothing", and the two must not look the same on a screen.
    assert.strictEqual(g.spend_cents, null,
      `an unknown spend came back as ${JSON.stringify(g.spend_cents)} instead of null`);
    assert.strictEqual(g.impressions, null);
    assert.strictEqual(g.clicks, null);

    // People go the other way, and only because a row is written whenever
    // somebody arrives: no row means nobody arrived. Two of the three ads carry
    // our number, so somebody COULD have been matched, so 0 is a real answer.
    assert.strictEqual(g.people, 0);
    assert.strictEqual(g.people_booked, 0);
  });

  test("spend of exactly 0 comes back as 0, not as null", () => {
    // node-postgres hands a bigint back as a STRING. "0" is falsy-adjacent in
    // several tempting ways; it must survive as the number 0, because "we spent
    // nothing" is a real fact and a different one from "nobody told us".
    const g = shapeGroup(row({ spend_cents: "0", impressions: "0", clicks: "0", ad_days_reported: 4 }));
    assert.strictEqual(g.spend_cents, 0, "a reported spend of zero was thrown away as unknown");
    assert.strictEqual(g.impressions, 0);
    assert.strictEqual(g.clicks, 0);
    assert.strictEqual(g.ad_days_reported, 4);
  });

  test("a big spend arrives as a string and survives as a number", () => {
    const g = shapeGroup(row({ spend_cents: "1002999" }));
    assert.strictEqual(g.spend_cents, 1002999);
  });

  test("a group in which no ad carries our number says 'cannot tell', not zero", () => {
    const g = shapeGroup(row({ ads_with_number: 0, ads: 7 }));

    assert.strictEqual(g.people, null,
      "a group nobody could be matched to reported 0 people instead of null");
    assert.strictEqual(g.people_booked, null);

    // And the cost refuses, with a count of null rather than a claimed 0.
    assert.equal(g.cost_per_booked_person.status, "INSUFFICIENT");
    assert.strictEqual(g.cost_per_booked_person.cost_cents, null);
    assert.strictEqual(g.cost_per_booked_person.n, null,
      "an unmeasurable group claimed a booked count of 0");
    assert.match(g.cost_per_booked_person.note, /number/i);
  });

  test("a row from the no-window branch reports no people at all, whatever ads_with_number says", () => {
    /* buildQuery has a branch that builds no date window and therefore never
       runs the people pass. Nothing reaches it through the endpoint today — the
       handler always builds a window for grouped mode — but shapeGroup is
       exported and the next caller will not know that. Without the has_window
       gate this returns 0 people from a question that was never asked. */
    const g = shapeGroup(row({ has_window: false, ads_with_number: 5 }));

    assert.strictEqual(g.people, null, "people were invented from a query that never counted them");
    assert.strictEqual(g.people_booked, null);
    assert.strictEqual(g.cost_per_booked_person.n, null);
    assert.match(g.cost_per_booked_person.note, /window/i);
  });

  test("enough booked people, and the cost is computed rather than refused", () => {
    // MIN_N_RATE is 10 and lives in src/ops/discoveries.mjs. It is NOT restated
    // here: this asserts that the one rule is reached, not what it is.
    const g = shapeGroup(row({ spend_cents: "3000", people: 12, people_booked: 11 }));
    assert.equal(g.cost_per_booked_person.status, "MEASURED");
    assert.strictEqual(g.cost_per_booked_person.cost_cents, Math.round(3000 / 11));
  });

  test("too few booked people, and the cost refuses rather than guessing", () => {
    const g = shapeGroup(row({ spend_cents: "3000", people: 2, people_booked: 1 }));
    assert.equal(g.cost_per_booked_person.status, "INSUFFICIENT");
    assert.strictEqual(g.cost_per_booked_person.cost_cents, null);
    assert.strictEqual(g.cost_per_booked_person.n, 1, "a real booked count of 1 was hidden");
  });

  test("no money field is ever converted to dollars — cents stay cents", () => {
    const g = shapeGroup(row({ spend_cents: "12345", people: 20, people_booked: 20 }));
    assert.strictEqual(g.spend_cents, 12345);
    assert.equal(typeof g.spend_cents, "number", "cents came back as a formatted string");
  });
});

/* HOOK RATE AND HOLD RATE.
 *
 *   hook rate = kept watching past the opening ÷ impressions
 *   hold rate = p75 views ÷ kept watching past the opening
 *
 * "Kept watching past the opening" is Meta's two-continuous-seconds count,
 * video_continuous_2s_watched. META PUBLISHES NO 3-SECOND FIELD (378's header),
 * so this is not the number Ads Manager prints beside the words "hook rate".
 *
 * The arithmetic itself is proved in src/ops/meta-marketing.test.mjs, where
 * watchRate lives. What is proved HERE is the wiring: that the endpoint feeds
 * the right column into the right side of the right rate, and that a missing
 * video number reaches the caller as nothing rather than as a zero. */
describe("ad-spine: how far into the video people got", () => {
  test("a photo-only group has no hook rate at all — not zero, not '0%'", () => {
    // The single most damaging thing this endpoint could do. A photo ad has no
    // video, so video_continuous_2s_watched sums to NULL. Reading that as 0
    // would put "0% hook rate" beside a perfectly good photo ad and it would
    // look like the worst ad in the account.
    const g = shapeGroup(row({
      impressions: "50000", video_continuous_2s_watched: null, video_p75_watched: null
    }));

    assert.strictEqual(g.video_continuous_2s_watched, null);
    assert.strictEqual(g.hook_rate.rate, null,
      `a photo-only group reported a hook rate of ${JSON.stringify(g.hook_rate.rate)}`);
    assert.notStrictEqual(g.hook_rate.rate, 0, "an unknown hook rate became zero");
    assert.strictEqual(g.hold_rate.rate, null);
    assert.equal(g.hook_rate.status, "INSUFFICIENT");
  });

  test("both rates are computed from the right two columns", () => {
    const g = shapeGroup(row({
      impressions: "10000",
      // a quarter of the people shown it kept watching past the opening
      video_continuous_2s_watched: "2500",
      video_p75_watched: "500"      // a fifth of those got three quarters in
    }));

    assert.strictEqual(g.hook_rate.rate, 0.25,
      "hook rate is not past-the-opening views over impressions");
    assert.strictEqual(g.hold_rate.rate, 0.2,
      "hold rate is not p75 over past-the-opening views");
    assert.equal(g.hook_rate.status, "MEASURED");
    assert.equal(g.hold_rate.status, "MEASURED");

    // The raw counts travel too, so a reader can check the division themselves.
    assert.strictEqual(g.video_continuous_2s_watched, 2500);
    assert.strictEqual(g.video_p75_watched, 500);
  });

  test("a real zero survives — a video nobody watched is a measurement", () => {
    const g = shapeGroup(row({
      impressions: "10000", video_continuous_2s_watched: "0", video_p75_watched: "0"
    }));
    assert.strictEqual(g.video_continuous_2s_watched, 0, "a reported zero was thrown away as unknown");
    assert.strictEqual(g.hook_rate.rate, 0);
    assert.equal(g.hook_rate.status, "MEASURED");

    // But hold rate divides BY that zero, so it has nothing to divide by.
    assert.strictEqual(g.hold_rate.rate, null, "hold rate divided by zero and produced a number");
  });

  test("a tiny sample is refused under the same one threshold, not a second one", () => {
    // Nine impressions is not a hook rate, it is noise. MIN_N_RATE is not
    // restated here — this asserts the one rule is reached.
    const g = shapeGroup(row({
      impressions: "9", video_continuous_2s_watched: "3", video_p75_watched: "1"
    }));
    assert.strictEqual(g.hook_rate.rate, null, "a hook rate was computed off nine impressions");
    assert.equal(g.hook_rate.status, "INSUFFICIENT");
    assert.strictEqual(g.hook_rate.n, 9, "the refusal hid how far short the sample was");
  });

  test("a group with no reported day has no rates, because it has no numbers", () => {
    const g = shapeGroup(row());
    assert.strictEqual(g.hook_rate.rate, null);
    assert.strictEqual(g.hold_rate.rate, null);
  });

  test("the no-window branch reports no video numbers either", () => {
    const g = shapeGroup(row({ has_window: false }));
    assert.strictEqual(g.video_continuous_2s_watched, null);
    assert.strictEqual(g.hook_rate.rate, null);
  });

  test("the rate is defined once — the endpoint does no dividing of its own", async () => {
    /* THE RULE THIS PROTECTS: one definition, in one file. If somebody later
       writes `video_continuous_2s_watched / impressions` straight into the handler, the two
       definitions drift and two screens disagree about the same ad. */
    const src = await readFile(new URL("../../api/read/ad-spine.mjs", import.meta.url), "utf8");
    // Comments talk about the rule at length. Only real code counts here.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    assert.ok(code.includes("hook_rate: watchRate("),
      "hook rate is worked out somewhere other than the shared watchRate()");
    assert.ok(code.includes("hold_rate: watchRate("),
      "hold rate is worked out somewhere other than the shared watchRate()");
    assert.ok(!code.includes("MIN_N_RATE"),
      "the endpoint names the small-sample threshold itself, which is a second copy of the one rule");
    assert.ok(!/video_\w*watched\s*\/|\/\s*impressions/.test(code),
      "the endpoint divides the video counts itself instead of asking watchRate()");
  });
});

describe("ad-spine: the date window", () => {
  test("days defaults, and a value that is not a whole number in range is refused", () => {
    assert.equal(readDays(undefined).days, DEFAULT_DAYS);
    assert.equal(readDays(undefined).days, 30);
    assert.equal(readDays("").days, DEFAULT_DAYS);
    assert.equal(readDays("7").days, 7);
    assert.equal(readDays(String(MAX_DAYS)).days, MAX_DAYS);

    for (const bad of ["banana", "0", "-5", "366", "1.5", "1e2", "0x1E", " ", "7abc"]) {
      assert.ok(readDays(bad).error, `days=${bad} was accepted instead of refused`);
    }
  });

  test("one day is today only, and thirty days spans exactly thirty", () => {
    const fixed = new Date("2026-09-09T13:45:00Z");

    const one = windowFor(1, fixed);
    assert.equal(one.to, "2026-09-09");
    assert.equal(one.from, one.to, "a one-day window did not start and end on the same day");
    assert.equal(one.days, 1);

    const thirty = windowFor(30, fixed);
    assert.equal(thirty.to, "2026-09-09");
    assert.equal(thirty.from, "2026-08-11");
    const spanDays =
      (Date.parse(thirty.to + "T00:00:00Z") - Date.parse(thirty.from + "T00:00:00Z")) / 86400000 + 1;
    assert.equal(spanDays, 30, `the 30-day window covers ${spanDays} days`);
  });

  test("the window is the ad account's days (Arizona), so it matches Meta's rows on every machine", () => {
    // Meta dates ad_metrics_daily in the ad account's zone, America/Phoenix
    // (UTC-7 all year). Arizona's whole day runs 07:00 UTC to 06:59:59 UTC.
    assert.equal(windowFor(1, new Date("2026-09-09T07:00:00Z")).to, "2026-09-09");
    assert.equal(windowFor(1, new Date("2026-09-10T06:59:59Z")).to, "2026-09-09");
    // The measured failure: 5:45pm Arizona on Oct 5 is already Oct 6 in UTC.
    // The window must still end on Oct 5, or a 7-day window drops Sep 29.
    const late = windowFor(7, new Date("2026-10-06T00:45:43Z"));
    assert.equal(late.to, "2026-10-05");
    assert.equal(late.from, "2026-09-29");
  });
});

describe("ad-spine: the SQL, read without a database", () => {
  const grouped = (over = {}) => buildQuery({
    orgId: ORG,
    groupBy: "angle",
    limit: 50,
    offset: 0,
    query: {},
    window: { from: "2026-08-11", to: "2026-09-09", days: 30 },
    ...over
  });

  test("nothing in the money path is coalesced", () => {
    // A single coalesce anywhere here turns "nobody told us" into 0 and the
    // whole point of the endpoint is lost, silently.
    assert.ok(!/coalesce/i.test(grouped().sql), "the grouped query coalesces a sum");
    assert.ok(!/coalesce/i.test(buildQuery({
      orgId: ORG, groupBy: null, limit: 50, offset: 0, query: {}
    }).sql));
  });

  test("the date bounds sit on the spend JOIN, never in the WHERE after it", () => {
    /* In WHERE, the date test would turn the LEFT JOIN back into an inner one
       and silently drop every ad that spent nothing in the window — which is
       exactly the group a reader most wants to see. */
    const { sql } = grouped();
    const joinAt = sql.indexOf("LEFT JOIN ad_metrics_daily");
    assert.ok(joinAt > -1, "the spend join is not in the grouped query at all");

    const after = sql.slice(joinAt);
    const dateAt = after.indexOf("m.date >=");
    const whereAt = after.indexOf("WHERE");
    assert.ok(dateAt > -1, "the window is not applied to the spend join");
    assert.ok(whereAt > -1, "the grouped query lost its WHERE");
    assert.ok(dateAt < whereAt,
      "the spend window moved into WHERE, which turns the LEFT JOIN into an inner one");

    // And there is no m.date test anywhere after that WHERE either.
    assert.ok(!after.slice(whereAt).includes("m.date"),
      "a spend date test appears after WHERE");
  });

  test("the plain list carries no money and no dated table", () => {
    const { sql } = buildQuery({ orgId: ORG, groupBy: null, limit: 50, offset: 0, query: {} });
    assert.ok(!sql.includes("spend_cents"), "the list grew a spend column");
    assert.ok(!sql.includes("ad_metrics_daily"), "the list grew a join to a per-day table");
    assert.ok(!sql.includes("client_ad_attribution"), "the list grew a join to people");
    assert.ok(sql.includes("ORDER BY a.created_at DESC, v.ad_row_id DESC"),
      "the list lost its stable newest-first ordering");
  });

  test("the two passes are separate, so per-day rows cannot multiply people", () => {
    const { sql } = grouped();
    assert.ok(sql.includes("WITH people AS"), "the people pass is not its own CTE");
    assert.ok(sql.includes("count(DISTINCT v.ad_row_id)"),
      "ads are counted with count(*), so a 30-day ad would read as 30 ads");
    assert.ok(sql.includes("count(DISTINCT a.client_id)"),
      "people are not counted distinctly, so a person who books twice counts twice");
  });

  test("the ad-number comparison is written in exactly one place", () => {
    const { sql } = grouped();
    const hits = sql.split(AD_NUMBER_MATCH).length - 1;
    assert.equal(hits, 1, `the leading-zero rule appears ${hits} times, not once`);
    assert.ok(AD_NUMBER_MATCH.includes("::bigint"),
      "the ad numbers are compared as text, so '042' would not match '42'");
  });

  test("a group with no window says so on every row", () => {
    assert.ok(grouped().sql.includes("true                       AS has_window"));
    const noWindow = grouped({ window: null });
    assert.ok(noWindow.sql.includes("false        AS has_window"));
    assert.ok(!noWindow.sql.includes("ad_metrics_daily"),
      "a query with no window still joined the dated table");
    assert.ok(!noWindow.sql.includes("WITH people AS"),
      "a query with no window still ran the people pass");
  });

  test("the video sums ride the same join as the money, and only the two that are needed", () => {
    const { sql } = grouped();
    assert.ok(sql.includes("sum(m.video_continuous_2s_watched)"),
      "the past-the-opening count is not summed, so hook rate has no numerator");
    assert.ok(sql.includes("sum(m.video_p75_watched)"),
      "the p75 count is not summed, so hold rate has no numerator");

    // The other six of 378's eight columns are deliberately not selected: they
    // are not part of either rate and nothing asked for them yet.
    for (const unused of ["video_p25_watched", "video_p50_watched", "video_p95_watched",
                          "video_p100_watched", "video_thruplay_watched", "video_plays"]) {
      assert.ok(!sql.includes(unused), `the grouped query pulls ${unused}, which nothing reads`);
    }

    // sum() skips NULLs by itself. A coalesce here would turn every photo ad in
    // the group into "nobody watched it" — the exact mistake 378's header warns
    // about — and the no-coalesce test above already guards the whole query.
    assert.ok(!sql.includes("ad_metrics_daily") || sql.includes("LEFT JOIN ad_metrics_daily"),
      "the video sums came in on an inner join, which would drop ads with no reported day");
  });

  test("a query with no window pulls no video numbers either", () => {
    const { sql } = grouped({ window: null });
    assert.ok(!sql.includes("sum(m.video_continuous_2s_watched)"));
    assert.ok(sql.includes("NULL::bigint AS video_continuous_2s_watched"),
      "the no-window branch dropped the video columns instead of returning them as unknown");
    assert.ok(sql.includes("NULL::bigint AS video_p75_watched"));
  });

  test("nothing from the query string is ever pasted into the SQL", () => {
    const nasty = "'; DROP TABLE ads; --";
    const { sql, params, filters } = grouped({ query: { angle: nasty } });
    assert.ok(!sql.includes(nasty), "a query-string value was interpolated into the SQL");
    assert.ok(params.includes(nasty), "the value was not bound as a parameter");
    assert.deepEqual(filters, { angle: nasty });
  });

  test("every parameter placeholder is used, and none is skipped", () => {
    for (const groupBy of [null, ...GROUPS]) {
      const { sql, params } = buildQuery({
        orgId: ORG,
        groupBy,
        limit: 50,
        offset: 0,
        query: {},
        window: groupBy ? { from: "2026-08-11", to: "2026-09-09", days: 30 } : null
      });
      for (let i = 1; i <= params.length; i++) {
        assert.ok(new RegExp(`\\$${i}(\\D|$)`).test(sql),
          `group_by=${groupBy}: $${i} is bound but never used`);
      }
      assert.ok(!new RegExp(`\\$${params.length + 1}(\\D|$)`).test(sql),
        `group_by=${groupBy}: the SQL reads a $${params.length + 1} that was never bound`);
    }
  });

  test("lane groups without a dictionary, because lane has nowhere to look one up", () => {
    const { sql } = grouped({ groupBy: "lane" });
    assert.ok(!sql.includes("ad_labels"), "lane joined a dictionary it has no rows in");
    assert.ok(sql.includes("NULL::text AS label_name"), "lane invented a friendly name");
    assert.equal(LABELS.lane.kind, null);
  });
});

describe("ad-spine: filters", () => {
  test("a blank or missing filter is not a filter", () => {
    const params = ["org"];
    const { where, applied } = buildFilters({ angle: "", hook: "   ", offer: null }, params);
    assert.deepEqual(where, []);
    assert.deepEqual(applied, {});
    assert.deepEqual(params, ["org"], "a blank filter still bound a parameter");
  });

  test("filters combine, and each names the column from the frozen map", () => {
    const params = ["org"];
    const { where, applied } = buildFilters({ angle: "denial_angle", lane: "premium" }, params);
    assert.equal(where.length, 2);
    assert.deepEqual(applied, { angle: "denial_angle", lane: "premium" });
    assert.ok(where.some((w) => w.startsWith(LABELS.angle.column)));
    assert.ok(where.some((w) => w.startsWith(LABELS.lane.column)),
      "lane is not compared as text, so a nonsense lane would raise instead of matching nothing");
    assert.deepEqual(params, ["org", "denial_angle", "premium"]);
  });

  test("a value the caller invents cannot name a column", () => {
    const params = ["org"];
    const { where, applied } = buildFilters({ spend_cents: "1", org_id: "x" }, params);
    assert.deepEqual(where, [], "a name outside the five labels reached the SQL");
    assert.deepEqual(applied, {});
  });
});
