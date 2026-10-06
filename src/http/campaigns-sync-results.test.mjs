// The daily Meta sync now saves purchases, cost per purchase, link clicks and
// landing page views (408). These pin the request and the write with no
// database: the field list, the SQL, the values in order, and the safe fallback
// when 408 is not applied yet. The end-to-end proof against Postgres is in
// src/http/ad-number.pg.test.mjs and skips without DATABASE_URL.
//
// Lives under src/ because npm test's glob is "src/**" and "scripts/**"
// (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  insightsRequestUrl,
  insightUpsertSql,
  insightUpsertParams,
  hasMetaResultColumns
} from "../../api/campaigns/sync.mjs";

const connection = { external_ad_account_id: "act_1234567890" };
const fieldsOf = (url) => new URL(url).searchParams.get("fields").split(",");

const RAW = {
  ad_id: "120253626574340264",
  date_start: "2026-09-30",
  spend: "272.35",
  impressions: "1247",
  clicks: "60",
  ctr: "4.8",
  actions: [
    { action_type: "link_click", value: "43" },
    { action_type: "landing_page_view", value: "33" },
    { action_type: "omni_purchase", value: "2" }
  ],
  cost_per_action_type: [{ action_type: "omni_purchase", value: "136.18" }]
};
const ARGS = { orgId: "o", partnerId: "p", adId: "a", day: "2026-09-30", raw: RAW };

describe("the insights request", () => {
  test("asks Meta for cost_per_action_type, and for actions once", () => {
    const f = fieldsOf(insightsRequestUrl(connection, { since: "2026-09-01", until: "2026-09-28" }));
    assert.ok(f.includes("cost_per_action_type"));
    assert.equal(f.filter((x) => x === "actions").length, 1, "a field asked for twice");
    assert.equal(new Set(f).size, f.length, "a field asked for twice");
  });

  test("every field it asks for is one Meta's SDK declares (no invented names)", () => {
    // facebook_business/adobjects/adsinsights.py — checked 2026-10-05 for the two
    // money names; the video names were checked on 2026-09-09 (src/adplatforms/meta.mjs).
    const known = new Set([
      "ad_id", "spend", "impressions", "clicks", "ctr", "actions", "purchase_roas", "date_start",
      "cost_per_action_type",
      "video_continuous_2_sec_watched_actions", "video_play_actions",
      "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions",
      "video_p95_watched_actions", "video_p100_watched_actions", "video_thruplay_watched_actions",
      "video_play_curve_actions"
    ]);
    for (const f of fieldsOf(insightsRequestUrl(connection, { since: "2026-09-01", until: "2026-09-28" }))) {
      assert.ok(known.has(f), `${f} is not a field this file has checked against Meta`);
    }
  });
});

describe("the write", () => {
  test("with 408: the four columns are inserted and updated on a re-pull", () => {
    const sql = insightUpsertSql({ withResults: true });
    for (const c of ["purchases", "cost_per_purchase_cents", "link_clicks", "landing_page_views"]) {
      assert.ok(new RegExp(`\\b${c}\\b`).test(sql.split("ON CONFLICT")[0]), `${c} is not inserted`);
      assert.ok(sql.includes(`${c} = EXCLUDED.${c}`), `${c} is not refreshed on a re-pull`);
    }
    assert.ok(sql.includes("$22"), "four new values need $19..$22");
    assert.ok(!sql.includes("$23"));
  });

  test("without 408: exactly the write it always was — no new column named", () => {
    const sql = insightUpsertSql({ withResults: false });
    for (const c of ["purchases", "cost_per_purchase_cents", "link_clicks", "landing_page_views"]) {
      assert.ok(!sql.includes(c), `${c} is named in the old write — the sync would break before 408`);
    }
    assert.ok(sql.includes("$18::jsonb)"));
    assert.ok(!sql.includes("$19"));
  });

  test("the values line up with the SQL, money in cents, Meta's numbers in place", () => {
    const p = insightUpsertParams({ ...ARGS, withResults: true });
    assert.equal(p.length, 22);
    assert.equal(p[4], 27235, "spend in cents");
    assert.equal(p[6], 60, "clicks (all clicks) unchanged");
    assert.deepEqual(p.slice(18), [2, 13618, 43, 33]);
  });

  test("Meta sent no actions: the four values are NULL, not 0", () => {
    const p = insightUpsertParams({
      ...ARGS, withResults: true,
      raw: { ad_id: "x", date_start: "2026-09-30", spend: "5", impressions: "8", clicks: "1" }
    });
    assert.deepEqual(p.slice(18), [null, null, null, null]);
  });

  test("without 408 the values stop at 18", () => {
    assert.equal(insightUpsertParams({ ...ARGS, withResults: false }).length, 18);
  });
});

describe("is 408 there?", () => {
  test("all four columns found → true", async () => {
    assert.equal(await hasMetaResultColumns(async () => ({ rows: [{ n: 4 }] })), true);
  });

  test("fewer than four → false, the old write", async () => {
    assert.equal(await hasMetaResultColumns(async () => ({ rows: [{ n: 0 }] })), false);
    assert.equal(await hasMetaResultColumns(async () => ({ rows: [{ n: 3 }] })), false);
  });

  test("the question itself fails → false, never a thrown sync", async () => {
    assert.equal(await hasMetaResultColumns(async () => { throw new Error("db down"); }), false);
    assert.equal(await hasMetaResultColumns(async () => ({})), false);
  });

  test("it asks the catalog by the four names, not information_schema", async () => {
    let seen;
    await hasMetaResultColumns(async (sql, params) => { seen = { sql, params }; return { rows: [{ n: 4 }] }; });
    assert.ok(seen.sql.includes("pg_attribute"));
    assert.deepEqual(seen.params[0], ["purchases", "cost_per_purchase_cents", "link_clicks", "landing_page_views"]);
  });
});
