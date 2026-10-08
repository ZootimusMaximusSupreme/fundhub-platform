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
  RUNNING_BARE_SQL,
  SPEND_DAYS_SQL,
  SYNC_DUE_SQL,
  UNMAPPED_SQL,
  closedDays,
  gapChecks
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
  [SPEND_DAYS_SQL]: { last_saved: FRESH_SYNC, first_day: "2026-09-01", rows_0: 4, rows_1: 4 },
  [UNMAPPED_SQL]: { unmapped: 0, with_metrics: 4, names: null },
  [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, running: 2, bare: 0, names: null }
};

function assertShape(r) {
  assert.deepEqual(Object.keys(r).sort(), KEYS);
  assert.equal(typeof r.id, "string");
  assert.ok(r.id.length > 0);
  assert.ok(r.status === "PASS" || r.status === "FAIL" || r.status === "skip");
  assert.equal(typeof r.detail, "string");
  assert.ok(r.detail.length > 0);
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
  assert.equal(running.params[0].toISOString(), "2026-10-06T10:00:00.000Z");
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
    [SPEND_DAYS_SQL]: { last_saved: FRESH_SYNC, first_day: "2026-09-01", rows_0: 4, rows_1: 0 }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-spend-day-missing"];
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2026-10-05/);
  assert.match(r.detail, /Older spend starts 2026-09-01/);
  assert.doesNotMatch(r.detail, /2026-10-04/);
});

test("a new account whose first spend day is today does not fail the closed days", async () => {
  const answers = {
    ...HEALTHY,
    [SPEND_DAYS_SQL]: { last_saved: FRESH_SYNC, first_day: "2026-10-06", rows_0: 0, rows_1: 0 }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-spend-day-missing"];
  assertShape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /not due yet/);
});

test("spend days skip when the save is older than 36 h", async () => {
  const answers = {
    ...HEALTHY,
    [SPEND_DAYS_SQL]: {
      last_saved: new Date("2026-10-04T21:00:00Z"),
      first_day: "2026-09-01",
      rows_0: 0,
      rows_1: 0
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
    [SPEND_DAYS_SQL]: { last_saved: null, first_day: null, rows_0: 0, rows_1: 0 }
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
    [UNMAPPED_SQL]: { unmapped: 2, with_metrics: 5, names: "SLO Ad 7, SLO Ad 8" }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-number-unmapped"];
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 ads have spend and no Fundhub ad number: SLO Ad 7, SLO Ad 8/);
  assert.match(r.suggestedFix, /fundhub_ad_number/);
});

test("no spend rows yet: number check skips", async () => {
  const answers = {
    ...HEALTHY,
    [UNMAPPED_SQL]: { unmapped: 0, with_metrics: 0, names: null }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-number-unmapped"];
  assert.equal(r.status, "skip");
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

test("no running ad old enough: metrics check skips", async () => {
  const answers = {
    ...HEALTHY,
    [RUNNING_BARE_SQL]: { last_synced_at: FRESH_SYNC, running: 0, bare: 0, names: null }
  };
  const r = byId(await gapChecks({ scope: scopeFor(answers), now: NOW }))["ads-running-no-metrics"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, /old enough/);
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
