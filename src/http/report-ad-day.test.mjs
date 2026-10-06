// Every report that reads ad_metrics_daily counts days the way Meta does — in
// the ad account's zone (America/Phoenix) — and shows click rate as clicks over
// impressions, not an average of averages.
//
// Measured 2026-10-05 at 5:45pm Arizona against production, read-only:
//   campaign list "spend yesterday"  0.00 shown, 120.18 true
//   7-day ad spend (pulse, KPIs)     523.79 shown, 606.53 true
//   fatigue CTR, SLO1, 7 days        7.58% shown, 9.87% true
//   campaign detail CTR, Oct 3       7.29% shown, 4.83% true
// These tests run without a database: they hold the SQL to the rule, and the
// day helper to the boundary that caused the first two.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { AD_TODAY_SQL, AD_ACCOUNT_TZ, adAccountDay } from "../lib/ad-account-day.mjs";
import { fetchRows as listRows } from "../../api/campaigns/list.mjs";
import { fetchRows as fatigueRows } from "../../api/campaigns/fatigue.mjs";
import { fetchRows as detailRows } from "../../api/campaigns/detail.mjs";
import { loadAdSpend } from "../ops/pulse.mjs";
import { computeKpis } from "../dashboard/kpis.mjs";

/* A stand-in transaction: records every statement, answers with rows the code
   can walk past. */
function recorder(rowsFor = () => []) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql: String(sql), params });
      return { rows: rowsFor(String(sql)) };
    }
  };
}

const metricsSql = (seen) => seen.map((q) => q.sql).filter((s) => /ad_metrics_daily/.test(s));

describe("the ad account's day", () => {
  test("is Arizona, and SQL says so", () => {
    assert.equal(AD_ACCOUNT_TZ, "America/Phoenix");
    assert.equal(AD_TODAY_SQL, "(now() AT TIME ZONE 'America/Phoenix')::date");
  });

  test("5:45pm Arizona on Oct 5 is still Oct 5, though UTC has moved to Oct 6", () => {
    const t = new Date("2026-10-06T00:45:43Z");
    assert.equal(t.toISOString().slice(0, 10), "2026-10-06", "UTC is a day ahead here");
    assert.equal(adAccountDay(t), "2026-10-05");
  });

  test("midnight Arizona is 07:00 UTC, all year (no daylight time)", () => {
    assert.equal(adAccountDay(new Date("2026-10-06T06:59:59Z")), "2026-10-05");
    assert.equal(adAccountDay(new Date("2026-10-06T07:00:00Z")), "2026-10-06");
    assert.equal(adAccountDay(new Date("2026-01-15T06:59:59Z")), "2026-01-14");
    assert.equal(adAccountDay(new Date("2026-07-15T07:00:00Z")), "2026-07-15");
  });
});

describe("reports over ad_metrics_daily never cut days with CURRENT_DATE", () => {
  test("campaign list: yesterday and the 7-day window are the account's days", async () => {
    const tx = recorder();
    await listRows(tx, { limit: 10, offset: 0, query: {} });
    const sql = tx.seen[0].sql;
    assert.ok(sql.includes(`m.date = ${AD_TODAY_SQL} - 1`), "spend_yesterday is not the account's yesterday");
    assert.ok(sql.includes(`m.date > ${AD_TODAY_SQL} - 8`), "roas_7d is not the account's last 7 days");
    assert.doesNotMatch(sql, /CURRENT_DATE/);
  });

  test("fatigue: window on the account's days", async () => {
    const tx = recorder();
    await fatigueRows(tx, { limit: 10, offset: 0, query: {}, partnerId: "p" });
    const [sql] = metricsSql(tx.seen);
    assert.ok(sql.includes(`d.date > ${AD_TODAY_SQL} -`));
    assert.doesNotMatch(sql, /CURRENT_DATE/);
  });

  test("campaign detail: daily series on the account's days", async () => {
    const tx = recorder((sql) => (/FROM campaigns c WHERE c.id/.test(sql) ? [{ id: "c1" }] : []));
    await detailRows(tx, { query: { id: "c1", days: "30" } });
    const [sql] = metricsSql(tx.seen);
    assert.ok(sql.includes(`m.date > ${AD_TODAY_SQL} -`));
    assert.doesNotMatch(sql, /CURRENT_DATE/);
  });

  test("ops pulse ad spend: last N of the account's days", async () => {
    const tx = recorder(() => [{ cents: "60653" }]);
    const out = await loadAdSpend(tx, { orgId: "o", days: 7 });
    assert.equal(out.spend_cents, 60653);
    const [sql] = metricsSql(tx.seen);
    assert.ok(sql.includes(`date >= (${AD_TODAY_SQL} - ($2::int - 1))`));
    assert.doesNotMatch(sql, /CURRENT_DATE/);
  });

  test("company KPIs ad spend: last N of the account's days", async () => {
    const tx = recorder(() => [{}]);
    await computeKpis(tx, { orgId: "o", period: "7d" });
    const sql = metricsSql(tx.seen).find((s) => /spend_cents/.test(s));
    assert.ok(sql, "the KPI spend query was not sent");
    assert.ok(sql.includes(`date >= (${AD_TODAY_SQL} - ($2::int - 1))`));
    assert.doesNotMatch(sql, /CURRENT_DATE/);
  });
});

describe("click rate is clicks over impressions", () => {
  const WEIGHTED = /round\(100\.0 \* sum\((d|m)\.clicks\) \/ NULLIF\(sum\(\1\.impressions\), 0\), 6\) AS ctr/;

  test("fatigue: one rate for the whole window, not the mean of daily rates", async () => {
    const tx = recorder();
    await fatigueRows(tx, { limit: 10, offset: 0, query: {}, partnerId: "p" });
    const [sql] = metricsSql(tx.seen);
    assert.match(sql, WEIGHTED);
    assert.doesNotMatch(sql, /avg\(d\.ctr\)/);
  });

  test("campaign detail: each day's rate is that day's clicks over its impressions", async () => {
    const tx = recorder((sql) => (/FROM campaigns c WHERE c.id/.test(sql) ? [{ id: "c1" }] : []));
    await detailRows(tx, { query: { id: "c1" } });
    const [sql] = metricsSql(tx.seen);
    assert.match(sql, WEIGHTED);
    assert.doesNotMatch(sql, /avg\(m\.ctr\)/);
  });

  test("the arithmetic the SQL does, on the measured SLO1 week", () => {
    // Five days of SLO1 (Sep 30 – Oct 4): the mean of the daily rates was 7.58%;
    // 15 clicks on 152 impressions is the rate Meta itself would report.
    const clicks = 15, impressions = 152;
    assert.equal(Math.round(10000 * clicks / impressions) / 100, 9.87);
  });
});
