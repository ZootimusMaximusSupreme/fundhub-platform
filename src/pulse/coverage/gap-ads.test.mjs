// Ad data gap checks. Fakes only: no database, no Meta, no budget change.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { HOURLY_WINDOW_DAYS as SYNC_WINDOW } from "../../../api/campaigns/sync.mjs";
import { DUE_PARTNERS_SQL } from "../../workflows/meta-campaign-sync-sweeper.mjs";
import { FRESH_HOURS } from "../machine.mjs";
import {
  HOURLY_RED_HOURS,
  HOURLY_WINDOW_DAYS,
  NEW_AD_GRACE_HOURS,
  RUNNING_BARE_SQL,
  SPEND_WINDOW_DAYS,
  SPEND_DAYS_SQL,
  SYNC_DUE_SQL,
  UNMAPPED_SQL,
  closedDays,
  gapChecks,
  naVerify
} from "./gap-ads.mjs";

const NOW = new Date("2026-10-06T13:00:00Z"); // 6:00 a.m. Phoenix
const FRESH_SYNC = new Date("2026-10-06T12:30:00Z");
const KEYS = ["detail", "id", "status", "suggestedFix"];

function scopeFor(answers, seen = []) {
  const tx = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (!(sql in answers)) throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
      const a = answers[sql];
      if (a instanceof Error) throw a;
      return { rows: Array.isArray(a) ? a : [a] };
    }
  };
  return async (fn) => fn(tx);
}

function byId(rows) {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

const HEALTHY = {
  [SYNC_DUE_SQL]: { last_synced_at: FRESH_SYNC, due: 1 },
  [SPEND_DAYS_SQL]: {
    last_saved: FRESH_SYNC,
    first_day: "2026-09-01",
    rows_0: 4,
    rows_1: 4,
    spent_days: "2026-10-03,2026-10-04,2026-10-05,2026-10-06",
    running: 2
  },
  [UNMAPPED_SQL]: { unmapped: 0, with_spend: 4, names: null },
  [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, running: 2, bare: 0, names: null }
};

function assertShape(r) {
  // A nothing-to-judge row (na) carries one extra key, na: { code, args }. No other row may.
  assert.deepEqual(Object.keys(r).sort(), r.status === "na" ? [...KEYS, "na"].sort() : KEYS);
  assert.equal(typeof r.id, "string");
  assert.ok(r.id.length > 0);
  assert.ok(r.status === "PASS" || r.status === "FAIL" || r.status === "skip" || r.status === "na");
  assert.equal(typeof r.detail, "string");
  assert.ok(r.detail.length > 0);
  if (r.status === "na") {
    assert.equal(r.na.code, "no-running-ad");
    assert.equal(r.na.args.check, r.id);
    assert.equal(r.na.args.running, 0);
    assert.match(r.detail, /Judged the day/);
  }
  if (r.status === "FAIL") {
    assert.equal(typeof r.suggestedFix, "string");
    assert.match(r.suggestedFix, /Recon \(AG-07\)/);
    assert.match(r.suggestedFix, /Do not invent a second watchdog/);
    assert.match(r.suggestedFix, /Do not change budgets/);
    assert.match(r.suggestedFix, /Do not pause campaigns/);
    assert.match(r.suggestedFix, /Do not upload video/);
    assert.match(r.suggestedFix, /Do not auto-fix/);
  } else {
    assert.equal(r.suggestedFix, null);
  }
}

test("gap ads: four checks, read-only sql, hourly window matches the sync", () => {
  assert.equal(HOURLY_WINDOW_DAYS, SYNC_WINDOW);
  assert.equal(HOURLY_WINDOW_DAYS, 3);
  assert.equal(HOURLY_RED_HOURS, 3);
  assert.equal(FRESH_HOURS, 36);
  for (const sql of [SYNC_DUE_SQL, SPEND_DAYS_SQL, UNMAPPED_SQL, RUNNING_BARE_SQL]) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  }
  assert.match(SYNC_DUE_SQL, /platform = 'meta'/);
  assert.match(SYNC_DUE_SQL, /connection_state IN \('active', 'pending'\)/);
  assert.match(SYNC_DUE_SQL, /encrypted_access_token IS NOT NULL/);
  assert.match(SYNC_DUE_SQL, /external_ad_account_id NOT ILIKE 'pending:%'/);
  assert.match(DUE_PARTNERS_SQL, /connection_state IN \('active', 'pending'\)/);
  assert.doesNotMatch(SYNC_DUE_SQL, /encrypted_access_token(?! IS NOT NULL)/);
  const src = fs.readFileSync(new URL("./gap-ads.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.deepEqual(closedDays(NOW), ["2026-10-04", "2026-10-05"]);
  assert.equal(SPEND_WINDOW_DAYS, 28);
  assert.equal(NEW_AD_GRACE_HOURS, 24);
});

test("running means the ad, its ad set and its campaign are all ACTIVE", () => {
  for (const sql of [SPEND_DAYS_SQL, RUNNING_BARE_SQL]) {
    assert.match(sql, /JOIN ad_sets s ON s\.id = a\.ad_set_id/);
    assert.match(sql, /JOIN campaigns c ON c\.id = a\.campaign_id/);
    assert.match(sql, /upper\(coalesce\(a\.status, ''\)\) = 'ACTIVE'/);
    assert.match(sql, /upper\(coalesce\(s\.status, ''\)\) = 'ACTIVE'/);
    assert.match(sql, /upper\(coalesce\(c\.status, ''\)\) = 'ACTIVE'/);
  }
  assert.match(SPEND_DAYS_SQL, /AT TIME ZONE 'America\/Phoenix'/);
});

test("spent_days lists days with real spend from the day before the gap to today", () => {
  assert.match(SPEND_DAYS_SQL, /string_agg\(x\.d, ','/);
  assert.match(SPEND_DAYS_SQL, /date BETWEEN \(\$1::date - 1\) AND \(\$2::date \+ 1\)/);
  assert.match(SPEND_DAYS_SQL, /GROUP BY date\s+HAVING sum\(spend_cents\) > 0/);
  assert.match(SPEND_DAYS_SQL, /\) AS spent_days/);
});

test("the number check looks only at ads that spent money in the 28-day window", () => {
  assert.match(UNMAPPED_SQL, /m\.spend_cents > 0/);
  assert.match(UNMAPPED_SQL, /m\.date >= \$1::date/);
  assert.match(UNMAPPED_SQL, /btrim\(a\.fundhub_ad_number\) = ''/);
});

test("no database: four skips and nothing is read", async () => {
  const rows = await gapChecks({ now: NOW });
  assert.deepEqual(rows.map((r) => r.id), [
    "ads-meta-sync-stale",
    "ads-spend-day-missing",
    "ads-number-unmapped",
    "ads-running-no-metrics"
  ]);
  for (const r of rows) {
    assertShape(r);
    assert.equal(r.status, "skip");
    assert.match(r.detail, /no database/);
  }
});

test("fresh sync, full days, mapped numbers, running ads with rows: four PASS", async () => {
  const seen = [];
  const rows = await gapChecks({ scope: scopeFor(HEALTHY, seen), now: NOW });
  for (const r of rows) assertShape(r);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "PASS"]);
  const spend = seen.find((q) => q.sql === SPEND_DAYS_SQL);
  assert.deepEqual(spend.params, ["2026-10-04", "2026-10-05"]);
  const running = seen.find((q) => q.sql === RUNNING_BARE_SQL);
  assert.equal(running.params[0].toISOString(), "2026-10-05T13:00:00.000Z");
  const unmapped = seen.find((q) => q.sql === UNMAPPED_SQL);
  assert.deepEqual(unmapped.params, ["2026-09-08"]);
  assert.match(byId(rows)["ads-spend-day-missing"].detail, /2026-10-04 and 2026-10-05/);
});

test("hourly sync 5 h old is FAIL; the 36 h machine row is a different check", async () => {
  const answers = {
    ...HEALTHY,
    [SYNC_DUE_SQL]: { last_synced_at: new Date("2026-10-06T08:00:00Z"), due: 1 }
  };
  const rows = await gapChecks({ scope: scopeFor(answers), now: NOW });
  const stale = byId(rows)["ads-meta-sync-stale"];
  assertShape(stale);
  assert.equal(stale.status, "FAIL");
  assert.match(stale.detail, /5 h ago/);
  assert.match(stale.detail, /Red after 3 h/);
  assert.match(stale.suggestedFix, /meta-campaign-sync-hourly/);
  assert.match(stale.suggestedFix, /machine meta-sync/);
  assert.equal(byId(rows)["ads-spend-day-missing"].status, "PASS");
});

test("no Meta account due: stale check skips", async () => {
  const answers = {
    ...HEALTHY,
    [SYNC_DUE_SQL]: { last_synced_at: null, due: 0 }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-meta-sync-stale"];
  assertShape(r);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /machine meta-sync/);
});

test("hourly sync never stamped is FAIL", async () => {
  const answers = {
    ...HEALTHY,
    [SYNC_DUE_SQL]: { last_synced_at: null, due: 1 },
    [RUNNING_BARE_SQL]: { ...HEALTHY[RUNNING_BARE_SQL], last_synced_at: null }
  };
  const rows = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }));
  assert.equal(rows["ads-meta-sync-stale"].status, "FAIL");
  assert.match(rows["ads-meta-sync-stale"].detail, /never stamped/);
  assert.equal(rows["ads-running-no-metrics"].status, "skip");
});

test("a closed day with older spend and no row is FAIL", async () => {
  const answers = {
    ...HEALTHY,
    [SPEND_DAYS_SQL]: {
      last_saved: FRESH_SYNC,
      first_day: "2026-09-01",
      rows_0: 4,
      rows_1: 0,
      spent_days: "2026-10-03,2026-10-04,2026-10-06",
      running: 2
    }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-spend-day-missing"];
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2026-10-05/);
  assert.match(r.detail, /2 ads are running/);
  assert.match(r.detail, /Older spend starts 2026-09-01/);
  assert.doesNotMatch(r.detail, /2026-10-04/);
});

test("a new account whose first spend day is today does not fail the closed days", async () => {
  const answers = {
    ...HEALTHY,
    [SPEND_DAYS_SQL]: { last_saved: FRESH_SYNC, first_day: "2026-10-06", rows_0: 0, rows_1: 0, running: 1 }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-spend-day-missing"];
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /not due yet/);
});

test("empty closed days with every ad paused is nothing to judge (na no-running-ad), not a FAIL", async () => {
  // Measured live 2026-10-08: all 7 ads PAUSED, and Oct 5 has no row at all.
  // Measured live 2026-10-09: running = 0, last day empty, sync fresh.
  const answers = {
    ...HEALTHY,
    [SPEND_DAYS_SQL]: { last_saved: FRESH_SYNC, first_day: "2026-08-04", rows_0: 0, rows_1: 0, running: 0 }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-spend-day-missing"];
  assertShape(r);
  assert.equal(r.status, "na");
  assert.deepEqual(r.na, { code: "no-running-ad", args: { check: "ads-spend-day-missing", running: 0 } });
  assert.match(r.detail, /no ad is running/);
  assert.match(r.detail, /2026-10-04 and 2026-10-05/);
  assert.match(r.detail, /Judged the day an ad runs\./);
});

test("no running ad but the running count did not come back: stays a skip, never na", async () => {
  // The old skip said "no ad is running" from a missing number. A missing number is not zero.
  for (const running of [undefined, null, "", "x"]) {
    const answers = {
      ...HEALTHY,
      [SPEND_DAYS_SQL]: { last_saved: FRESH_SYNC, first_day: "2026-08-04", rows_0: 0, rows_1: 0, running }
    };
    const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-spend-day-missing"];
    assertShape(r);
    assert.equal(r.status, "skip", `running = ${String(running)}`);
    assert.match(r.detail, /no ad is running/);
  }
  for (const running of [undefined, null, ""]) {
    const answers = {
      ...HEALTHY,
      [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, running, bare: 0, names: null }
    };
    const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-running-no-metrics"];
    assertShape(r);
    assert.equal(r.status, "skip", `running = ${String(running)}`);
  }
});

test("an ad is running: neither row is ever na (PASS or FAIL, as before)", async () => {
  const variants = [
    [HEALTHY, ["PASS", "PASS", "PASS", "PASS"]],
    [spendAnswer({ rows_0: 4, rows_1: 0, running: 1 }), ["PASS", "FAIL", "PASS", "PASS"]],
    [
      { ...HEALTHY, [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, running: 2, bare: 1, names: "SLO Ad 3" } },
      ["PASS", "PASS", "PASS", "FAIL"]
    ]
  ];
  for (const [answers, want] of variants) {
    const rows = await gapChecks({ scope: scopeFor(answers), now: NOW });
    assert.deepEqual(rows.map((r) => r.status), want);
    for (const r of rows) {
      assertShape(r);
      assert.equal(r.na, undefined, `${r.id} must not carry na`);
    }
  }
});

test("one running ad and one empty closed day is still a FAIL", async () => {
  const answers = {
    ...HEALTHY,
    [SPEND_DAYS_SQL]: {
      last_saved: FRESH_SYNC,
      first_day: "2026-08-04",
      rows_0: 3,
      rows_1: 0,
      spent_days: "2026-10-03,2026-10-04,2026-10-06",
      running: 1
    }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-spend-day-missing"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 ad is running, so that day should have synced/);
});

function spendAnswer(over) {
  return {
    ...HEALTHY,
    [SPEND_DAYS_SQL]: {
      last_saved: FRESH_SYNC,
      first_day: "2026-08-04",
      rows_0: 4,
      rows_1: 0,
      spent_days: "2026-10-03,2026-10-04,2026-10-06",
      running: 7,
      ...over
    }
  };
}

async function spendRow(over) {
  const rows = await gapChecks({ scope: scopeFor(spendAnswer(over)), now: NOW });
  const r = byId(rows)["ads-spend-day-missing"];
  assertShape(r);
  return r;
}

test("relaunch morning: ads are ACTIVE again but did not spend after the empty day, so skip", async () => {
  // Measured live 2026-10-08: Oct 4 spent 12021 cents, Oct 5 has no row, Oct 6 and 7
  // hold one zero-spend row. If every ad were switched back on, status alone said "running".
  const r = await spendRow({ spent_days: "2026-10-03,2026-10-04" });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /No spend row for 2026-10-05/);
  assert.match(r.detail, /No ad spent money after it/);
  assert.match(r.detail, /not a missed sync/);
});

test("ads only started after the empty day: no spend before it, so skip", async () => {
  const r = await spendRow({ spent_days: "2026-10-06" });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /No ad spent money before it/);
});

test("no spend on either side of the empty day: skip says both sides", async () => {
  const r = await spendRow({ spent_days: "" });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /No ad spent money before or after it/);
});

test("a missing spent_days answer is never a FAIL", async () => {
  const r = await spendRow({ spent_days: null });
  assert.equal(r.status, "skip");
});

test("the older closed day is empty and yesterday has spend after it: FAIL", async () => {
  const r = await spendRow({ rows_0: 0, rows_1: 4, spent_days: "2026-10-03,2026-10-05,2026-10-06" });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /missing for 2026-10-04\./);
  assert.doesNotMatch(r.detail, /2026-10-05/);
});

test("both closed days empty with ads spending before and today: FAIL names both days", async () => {
  const r = await spendRow({ rows_0: 0, rows_1: 0, spent_days: "2026-10-03,2026-10-06" });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /missing for 2026-10-04 and 2026-10-05/);
  assert.match(r.detail, /7 ads are running/);
});

test("spent_days as a real array also counts", async () => {
  const r = await spendRow({ spent_days: ["2026-10-03", "2026-10-04", "2026-10-06"] });
  assert.equal(r.status, "FAIL");
});

test("spend days skip when the save is older than 36 h", async () => {
  const answers = {
    ...HEALTHY,
    [SPEND_DAYS_SQL]: {
      last_saved: new Date("2026-10-04T21:00:00Z"),
      first_day: "2026-09-01",
      rows_0: 0,
      rows_1: 0,
      running: 2
    }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-spend-day-missing"];
  assertShape(r);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /40 h ago/);
  assert.match(r.detail, /machine meta-sync/);
});

test("spend days skip when nothing has ever been saved", async () => {
  const answers = {
    ...HEALTHY,
    [SPEND_DAYS_SQL]: { last_saved: null, first_day: null, rows_0: 0, rows_1: 0, running: 0 }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-spend-day-missing"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, /never saved/);
});

test("Phoenix evening is still the previous ad-account day", async () => {
  const now = new Date("2026-10-06T06:30:00Z"); // 11:30 p.m. Phoenix on Oct 5
  const seen = [];
  await gapChecks({ scope: scopeFor(HEALTHY, seen), now });
  const spend = seen.find((q) => q.sql === SPEND_DAYS_SQL);
  assert.deepEqual(spend.params, ["2026-10-03", "2026-10-04"]);
});

test("ads with spend and no number are FAIL", async () => {
  const answers = {
    ...HEALTHY,
    [UNMAPPED_SQL]: { unmapped: 2, with_spend: 5, names: "SLO Ad 7, SLO Ad 8" }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-number-unmapped"];
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 ads have spend in the last 28 days and no Fundhub ad number: SLO Ad 7, SLO Ad 8/);
  assert.match(r.suggestedFix, /fundhub_ad_number/);
});

test("no ad spent in the window: number check skips", async () => {
  const answers = {
    ...HEALTHY,
    [UNMAPPED_SQL]: { unmapped: 0, with_spend: 0, names: null }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-number-unmapped"];
  assertShape(r);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /last 28 days/);
});

test("every ad that spent has a number: PASS names the count and the window", async () => {
  const r = byId(await gapChecks({ scope: scopeFor(HEALTHY), now: NOW }))["ads-number-unmapped"];
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /Every ad that spent in the last 28 days has a Fundhub ad number \(4 ads\)/);
});

test("a running ad with no metrics row is FAIL while the sync is fresh", async () => {
  const answers = {
    ...HEALTHY,
    [RUNNING_BARE_SQL]: {
      last_synced_at: FRESH_SYNC,
      running: 2,
      bare: 1,
      names: "SLO Ad 3"
    }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-running-no-metrics"];
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 running ad has no metrics row: SLO Ad 3/);
});

test("a bare running ad skips when the sync itself is past 36 h", async () => {
  const answers = {
    ...HEALTHY,
    [SYNC_DUE_SQL]: { last_synced_at: new Date("2026-10-04T21:00:00Z"), due: 1 },
    [RUNNING_BARE_SQL]: {
      last_synced_at: new Date("2026-10-04T21:00:00Z"),
      running: 2,
      bare: 2,
      names: "SLO Ad 3, SLO Ad 4"
    }
  };
  const rows = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }));
  assert.equal(rows["ads-meta-sync-stale"].status, "FAIL");
  assert.equal(rows["ads-running-no-metrics"].status, "skip");
  assert.match(rows["ads-running-no-metrics"].detail, /ads-meta-sync-stale owns that/);
});

test("a new ad inside the 24 h review grace is not asked for a metrics row", async () => {
  const seen = [];
  await gapChecks({ scope: scopeFor(HEALTHY, seen), now: NOW });
  const q = seen.find((x) => x.sql === RUNNING_BARE_SQL);
  const hoursOld = (NOW.getTime() - q.params[0].getTime()) / 3600000;
  assert.equal(hoursOld, NEW_AD_GRACE_HOURS);
});

test("no running ad old enough: metrics check is nothing to judge (na no-running-ad)", async () => {
  // Measured live 2026-10-09: running = 0, bare = 0, sync 17:30 UTC the same day.
  const answers = {
    ...HEALTHY,
    [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, running: 0, bare: 0, names: null }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-running-no-metrics"];
  assertShape(r);
  assert.equal(r.status, "na");
  assert.deepEqual(r.na, { code: "no-running-ad", args: { check: "ads-running-no-metrics", running: 0 } });
  assert.match(r.detail, /older than 24 h/);
});

test("a stale or never-stamped sync with no running ad stays a skip: only the running count makes na", async () => {
  const never = { ...HEALTHY, [RUNNING_BARE_SQL]: { last_synced_at: null, running: 0, bare: 0, names: null } };
  const old = {
    ...HEALTHY,
    [RUNNING_BARE_SQL]: { last_synced_at: new Date("2026-10-04T21:00:00Z"), running: 0, bare: 0, names: null }
  };
  for (const answers of [never, old]) {
    const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-running-no-metrics"];
    assertShape(r);
    assert.equal(r.status, "skip");
  }
});

// ---------------------------------------------------------------------------
// naVerify: the audit proves a nothing-to-judge row again, with the lane's own SQL.

test("naVerify no-running-ad, ads-spend-day-missing: true at zero running ads, with the lane's own SQL and days", async () => {
  const seen = [];
  const answers = spendAnswer({ rows_0: 0, rows_1: 0, running: 0 });
  const ok = await naVerify["no-running-ad"]({ check: "ads-spend-day-missing" }, { scope: scopeFor(answers, seen), now: NOW });
  assert.equal(ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sql, SPEND_DAYS_SQL);
  assert.deepEqual(seen[0].params, ["2026-10-04", "2026-10-05"]);
});

test("naVerify no-running-ad, ads-spend-day-missing: false when an ad is running, or the count is missing", async () => {
  for (const running of [1, 7, "3"]) {
    const ok = await naVerify["no-running-ad"](
      { check: "ads-spend-day-missing" },
      { scope: scopeFor(spendAnswer({ running })), now: NOW }
    );
    assert.equal(ok, false, `running = ${running}`);
  }
  for (const running of [undefined, null, "", "x"]) {
    const ok = await naVerify["no-running-ad"](
      { check: "ads-spend-day-missing" },
      { scope: scopeFor(spendAnswer({ running })), now: NOW }
    );
    assert.equal(ok, false, `running = ${String(running)}`);
  }
});

test("naVerify no-running-ad, ads-running-no-metrics: true at zero running ads (cutoff is the 24 h grace), false otherwise", async () => {
  const seen = [];
  const none = { ...HEALTHY, [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, running: 0, bare: 0, names: null } };
  assert.equal(
    await naVerify["no-running-ad"]({ check: "ads-running-no-metrics" }, { scope: scopeFor(none, seen), now: NOW }),
    true
  );
  assert.equal(seen[0].sql, RUNNING_BARE_SQL);
  assert.equal((NOW.getTime() - seen[0].params[0].getTime()) / 3600000, NEW_AD_GRACE_HOURS);
  const some = { ...HEALTHY, [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, running: 2, bare: 1, names: "SLO Ad 3" } };
  assert.equal(
    await naVerify["no-running-ad"]({ check: "ads-running-no-metrics" }, { scope: scopeFor(some), now: NOW }),
    false
  );
  const missing = { ...HEALTHY, [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, bare: 0, names: null } };
  assert.equal(
    await naVerify["no-running-ad"]({ check: "ads-running-no-metrics" }, { scope: scopeFor(missing), now: NOW }),
    false
  );
});

test("naVerify no-running-ad: no read, no row, an unknown check or no args is false; a failed read throws", async () => {
  const none = { ...HEALTHY, [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, running: 0, bare: 0, names: null } };
  assert.equal(await naVerify["no-running-ad"]({ check: "ads-spend-day-missing" }, { now: NOW }), false);
  assert.equal(await naVerify["no-running-ad"]({ check: "ads-number-unmapped" }, { scope: scopeFor(none), now: NOW }), false);
  assert.equal(await naVerify["no-running-ad"]({}, { scope: scopeFor(none), now: NOW }), false);
  assert.equal(await naVerify["no-running-ad"](undefined, { scope: scopeFor(none), now: NOW }), false);
  const emptyScope = async (fn) => fn({ query: async () => ({ rows: [] }) });
  assert.equal(await naVerify["no-running-ad"]({ check: "ads-running-no-metrics" }, { scope: emptyScope, now: NOW }), false);
  const broken = { ...none, [RUNNING_BARE_SQL]: new Error("relation ads is missing") };
  await assert.rejects(
    naVerify["no-running-ad"]({ check: "ads-running-no-metrics" }, { scope: scopeFor(broken), now: NOW }),
    /relation ads is missing/
  );
});

test("naVerify no-running-ad: db.query works when scope is omitted", async () => {
  const db = {
    async query(sql) {
      return { rows: [sql === RUNNING_BARE_SQL ? { last_synced_at: FRESH_SYNC, running: 0, bare: 0 } : {}] };
    }
  };
  assert.equal(await naVerify["no-running-ad"]({ check: "ads-running-no-metrics" }, { db, now: NOW }), true);
});

test("round trip: the na row's own args pass naVerify, and fail the moment an ad runs", async () => {
  const quiet = spendAnswer({ rows_0: 0, rows_1: 0, running: 0 });
  quiet[RUNNING_BARE_SQL] = { last_synced_at: FRESH_SYNC, running: 0, bare: 0, names: null };
  const rows = byId(await gapChecks({ scope: scopeFor(quiet), now: NOW }));
  for (const id of ["ads-spend-day-missing", "ads-running-no-metrics"]) {
    assert.equal(rows[id].status, "na", id);
    assert.equal(await naVerify[rows[id].na.code](rows[id].na.args, { scope: scopeFor(quiet), now: NOW }), true, id);
  }
  const running = spendAnswer({ rows_0: 0, rows_1: 0, running: 1 });
  running[RUNNING_BARE_SQL] = { last_synced_at: FRESH_SYNC, running: 1, bare: 0, names: null };
  for (const id of ["ads-spend-day-missing", "ads-running-no-metrics"]) {
    assert.equal(await naVerify[rows[id].na.code](rows[id].na.args, { scope: scopeFor(running), now: NOW }), false, id);
  }
});

test("one broken query is its own FAIL and the other checks still run", async () => {
  const answers = {
    ...HEALTHY,
    [UNMAPPED_SQL]: new Error("relation ads is missing")
  };
  const rows = await gapChecks({ scope: scopeFor(answers), now: NOW });
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "FAIL", "PASS"]);
  const broken = rows[2];
  assertShape(broken);
  assert.match(broken.detail, /could not read ad data/);
  assert.match(broken.detail, /relation ads is missing/);
});

test("db.query works when scope is omitted", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push(sql);
      if (!(sql in HEALTHY)) throw new Error("unexpected");
      return { rows: [HEALTHY[sql]] };
    }
  };
  const rows = await gapChecks({ db, now: NOW });
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "PASS"]);
  assert.equal(seen.length, 4);
});
