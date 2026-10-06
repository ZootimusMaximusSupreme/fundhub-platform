// Why Aug 4–16 never reached ad_metrics_daily, and the rule that stops it
// happening again. No database.
//
// Read off production (read only, 2026-10-05): the first rows were written
// 2026-08-24 23:04 UTC by a Sync press whose window was 7 days, so the earliest
// stored day is Aug 17; the 28-day daily pull came later (2026-09-09 commit,
// first logged ship 2026-09-16). Nothing ever asked Meta for a day older than
// its window. The rule now: when an ad account has nothing stored from before
// the window, the pull asks Meta for the whole history (date_preset=maximum).
// The end-to-end proof (a real first pull, and the fallback when Meta refuses)
// is in src/http/ad-number.pg.test.mjs, which needs DATABASE_URL.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  insightsRequestUrl,
  needsFullHistory,
  earliestStoredDay,
  insightWindow
} from "../../api/campaigns/sync.mjs";

const connection = { external_ad_account_id: "act_982103620742368" };

describe("the whole-history request", () => {
  test("date_preset=maximum replaces the date window, everything else is the same request", () => {
    const max = new URL(insightsRequestUrl(connection, { datePreset: "maximum" }));
    const win = new URL(insightsRequestUrl(connection, { since: "2026-09-08", until: "2026-10-05" }));
    assert.equal(max.searchParams.get("date_preset"), "maximum");
    assert.equal(max.searchParams.get("time_range"), null, "both a preset and a range were sent");
    assert.equal(win.searchParams.get("date_preset"), null);
    assert.equal(win.searchParams.get("time_range"), '{"since":"2026-09-08","until":"2026-10-05"}');
    for (const k of ["fields", "time_increment", "level", "limit"]) {
      assert.equal(max.searchParams.get(k), win.searchParams.get(k), k);
    }
    assert.equal(max.pathname, win.pathname, "the whole history must be asked of the same ad account");
  });
});

describe("needsFullHistory — when a pull reaches back past its window", () => {
  const { since } = insightWindow(Date.UTC(2026, 9, 5, 7));   // the 07:00 UTC daily pull

  test("nothing stored yet: the whole history (this is the case that lost Aug 4–16)", () => {
    assert.equal(needsFullHistory({ earliestStored: null, since }), true);
  });

  test("only days inside the window stored: the whole history — older days were never asked for", () => {
    assert.equal(needsFullHistory({ earliestStored: since, since }), true);
    assert.equal(needsFullHistory({ earliestStored: "2026-10-01", since }), true);
  });

  test("days older than the window stored: the 28-day window, as before", () => {
    // The Fundhub account today: its oldest stored day is 2026-08-17.
    assert.equal(needsFullHistory({ earliestStored: "2026-08-17", since }), false);
  });

  test("could not tell (the question failed): keep the window, never guess", () => {
    assert.equal(needsFullHistory({ earliestStored: undefined, since }), false);
  });

  test("replayed against what happened: the 2026-08-24 first pull would have asked for everything", () => {
    const first = insightWindow(Date.UTC(2026, 7, 24, 23, 4));
    assert.equal(needsFullHistory({ earliestStored: null, since: first.since }), true);
  });
});

describe("earliestStoredDay", () => {
  test("asks for the oldest day of THIS connection's ads, as text", async () => {
    let seen;
    const d = await earliestStoredDay(async (sql, params) => {
      seen = { sql, params };
      return { rows: [{ d: "2026-08-17" }] };
    }, "conn-1");
    assert.equal(d, "2026-08-17");
    assert.ok(seen.sql.includes("to_char(min(m.date), 'YYYY-MM-DD')"), "a DATE would come back as a local-midnight JS Date");
    assert.ok(seen.sql.includes("a.connection_id = $1"));
    assert.deepEqual(seen.params, ["conn-1"]);
  });

  test("no stored day is null; a failed question is undefined", async () => {
    assert.equal(await earliestStoredDay(async () => ({ rows: [{ d: null }] }), "c"), null);
    assert.equal(await earliestStoredDay(async () => { throw new Error("db down"); }, "c"), undefined);
  });
});

describe("the sync falls back when Meta refuses the whole history", () => {
  const src = readFileSync(new URL("../../api/campaigns/sync.mjs", import.meta.url), "utf8");
  test("a refused whole-history pull is reported in full_history and the window pull still runs", () => {
    const i = src.indexOf('insightsRequestUrl(connection, { datePreset: "maximum" })');
    const j = src.indexOf("whole history refused, used the");
    const k = src.indexOf("insightsRequestUrl(connection, { since, until })", j);
    assert.ok(i > 0 && j > i && k > j, "the fallback to the window is not after the refused whole-history pull");
  });
});

describe("rows saved before 408 stay unknown — NULL, never 0", () => {
  const sql408 = readFileSync(new URL("../../db/migrations/408_ad_metrics_meta_results.sql", import.meta.url), "utf8");
  const code = sql408.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  test("the four columns are added with no default and no NOT NULL", () => {
    for (const c of ["purchases", "cost_per_purchase_cents", "link_clicks", "landing_page_views"]) {
      const line = code.split("\n").find((l) => l.includes(`ADD COLUMN IF NOT EXISTS ${c} `));
      assert.ok(line, `${c} is not added`);
      assert.equal(/DEFAULT|NOT NULL/i.test(line), false, `${c}: ${line.trim()}`);
    }
  });

  test("408 writes no value into any existing row", () => {
    assert.equal(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|COALESCE/i.test(code), false);
  });
});
