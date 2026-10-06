// The weekly brief must not add up running totals.
//
// Every funnel_page_stats and video_watch_stats row is already a total over the
// days before its stat_date (7, 30 or 90 — the row does not say which). The
// brief used to sum(views) over every row in the week, so overlapping totals
// were added together, and a single 90-day row was printed as the week's views
// (measured 2026-10-05: VSL 642 printed; that week was 77). Runs without a
// database.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pullFunnelPages, pullVideoStats, buildNumbersSection } from "./weekly-brief.mjs";

function fakeDb(rows) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push(String(sql));
      if (/FROM analytics_connections/.test(sql)) return { rows: [{ connection_state: "active", last_synced_at: null }] };
      return { rows };
    }
  };
}

const week = { orgId: "o", from: new Date("2026-09-28T00:00:00Z"), to: new Date("2026-10-05T00:00:00Z") };

describe("weekly brief: ClickFunnels and YouTube rows are running totals", () => {
  test("funnel pages: the latest row per page, never a sum across rows", async () => {
    const db = fakeDb([{ funnel_name: "Fundhub Funnel", page_name: "VSL", stat_date: "2026-10-04", views: 642, conversions: 0 }]);
    const out = await pullFunnelPages(db, week);
    const sql = db.seen.find((s) => /funnel_page_stats/.test(s));
    assert.match(sql, /DISTINCT ON \(clickfunnels_page_id\)/);
    assert.match(sql, /ORDER BY clickfunnels_page_id, stat_date DESC/);
    assert.doesNotMatch(sql, /sum\(views\)/i);
    assert.equal(out.pages[0].views, 642);
  });

  test("videos: the latest row per video, never a sum across rows", async () => {
    const db = fakeDb([]);
    await pullVideoStats(db, week);
    const sql = db.seen.find((s) => /video_watch_stats/.test(s));
    assert.match(sql, /DISTINCT ON \(youtube_video_id\)/);
    assert.doesNotMatch(sql, /sum\(views\)/i);
    assert.doesNotMatch(sql, /sum\(estimated_minutes_watched\)/i);
  });

  test("the text says what the number is, and when it was pulled", () => {
    const text = buildNumbersSection({
      ads: { totalLeads: 0, totalBooks: 0, byLane: [] },
      funnel: { available: true, pages: [{ funnel_name: "Fundhub Funnel", page_name: "VSL", stat_date: "2026-10-04", views: 642, conversions: 0 }] },
      video: { available: false, reason: "YouTube is not connected yet" },
      features: { available: false, reason: "no PR data source wired in" },
      from: week.from,
      to: week.to
    });
    assert.match(text, /running total as of the day it was pulled/);
    assert.match(text, /It is not this week's count\./);
    assert.match(text, /- Fundhub Funnel \/ VSL: 642 views, 0 conversions \(pulled 2026-10-04\)/);
  });

  test("an unknown count stays unknown, never 0", () => {
    const text = buildNumbersSection({
      ads: { totalLeads: 0, totalBooks: 0, byLane: [] },
      funnel: { available: true, pages: [{ funnel_name: "F", page_name: "P", stat_date: "2026-10-04", views: null, conversions: null }] },
      video: { available: false, reason: "x" },
      features: { available: false, reason: "y" },
      from: week.from,
      to: week.to
    });
    assert.match(text, /- F \/ P: unknown views, unknown conversions/);
  });
});
