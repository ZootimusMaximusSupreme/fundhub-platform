// The weekly schedule's time math (src/marketing/schedule.mjs). Spec §2 item 1, §7.4,
// §7.7. Plan unit U35. Pure: no database, no network.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  nextReleaseAt, weekKey, planWindowStart, planRetryUntil, voiceExportFrom, weeklyWindow,
  nightlyDay, chrisOnPage, scriptsReadyText, zoneOf, dayIn,
  BATCH_KINDS, PLAN_LEAD_MS, PLAN_RETRY_MS, PAGE_SEEN_FRESH_MS, FINISH_POLL_MS
} from "./schedule.mjs";
import { START_BATCH_KIND } from "./ideas-store.mjs";

const DEFAULTS = Object.freeze({ batch_weekday: 1, batch_time: "07:00", timezone: "America/Phoenix" });
const HOUR = 3600 * 1000;

describe("Monday 07:00 America/Phoenix is 14:00 UTC every week (Arizona keeps no daylight time)", () => {
  test("60 weeks in a row, across both US clock changes: always Monday 14:00 UTC, always 7 days apart", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    let prev = null;
    for (let i = 0; i < 60; i++) {
      const r = nextReleaseAt(DEFAULTS, now);
      assert.equal(r.getUTCDay(), 1, `${r.toISOString()} is a Monday in UTC`);
      assert.equal(r.getUTCHours(), 14, `${r.toISOString()} is 14:00 UTC`);
      assert.equal(r.getUTCMinutes(), 0);
      if (prev) assert.equal(r.getTime() - prev.getTime(), 7 * 24 * HOUR);
      prev = r;
      now = new Date(r.getTime() + 1000);
    }
  });

  test("the defaults hold when the settings row leaves them out", () => {
    assert.equal(nextReleaseAt({}, new Date("2026-10-06T12:00:00Z")).toISOString(), "2026-10-12T14:00:00.000Z");
    assert.equal(nextReleaseAt(null, new Date("2026-10-06T12:00:00Z")).toISOString(), "2026-10-12T14:00:00.000Z");
  });

  test("strictly after now: at 14:00 UTC on the Monday itself, the next drop is a week later", () => {
    assert.equal(nextReleaseAt(DEFAULTS, new Date("2026-10-12T13:59:59Z")).toISOString(), "2026-10-12T14:00:00.000Z");
    assert.equal(nextReleaseAt(DEFAULTS, new Date("2026-10-12T14:00:00Z")).toISOString(), "2026-10-19T14:00:00.000Z");
  });

  test("a zone with daylight time moves the UTC hour, so the settings zone is really used", () => {
    const denver = { ...DEFAULTS, timezone: "America/Denver" };
    assert.equal(nextReleaseAt(denver, new Date("2026-07-01T00:00:00Z")).toISOString(), "2026-07-06T13:00:00.000Z");
    assert.equal(nextReleaseAt(denver, new Date("2026-12-01T00:00:00Z")).toISOString(), "2026-12-07T14:00:00.000Z");
  });

  test("a zone that is not real falls back to Arizona", () => {
    assert.equal(zoneOf("Mars/Olympus"), "America/Phoenix");
    assert.equal(zoneOf(""), "America/Phoenix");
    assert.equal(zoneOf("America/Denver"), "America/Denver");
  });
});

describe("week_key is the ISO week of release_at in the settings zone", () => {
  test("ordinary weeks and the year boundary (2026 has 53 ISO weeks)", () => {
    assert.equal(weekKey(new Date("2026-10-12T14:00:00Z"), "America/Phoenix"), "2026-W42");
    assert.equal(weekKey(new Date("2026-12-28T14:00:00Z"), "America/Phoenix"), "2026-W53");
    assert.equal(weekKey(new Date("2027-01-04T14:00:00Z"), "America/Phoenix"), "2027-W01");
  });

  test("the zone's calendar day decides, not UTC's: Sunday 23:00 in Arizona is Monday 06:00 UTC", () => {
    const sundayNight = { batch_weekday: 0, batch_time: "23:00", timezone: "America/Phoenix" };
    const r = nextReleaseAt(sundayNight, new Date("2026-10-06T00:00:00Z"));
    assert.equal(r.toISOString(), "2026-10-12T06:00:00.000Z");
    assert.equal(weekKey(r, "America/Phoenix"), "2026-W41", "Sunday Oct 11 in Arizona is ISO week 41");
    assert.equal(weekKey(r, "UTC"), "2026-W42", "the same moment is Monday in UTC");
  });

  test("the shape the database checks (414 marketing_batches_week_key_ck)", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 60; i++) {
      const r = nextReleaseAt(DEFAULTS, now);
      assert.match(weekKey(r, "America/Phoenix"), /^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/);
      now = new Date(r.getTime() + 1000);
    }
  });
});

describe("the windows around a release", () => {
  const release = new Date("2026-10-12T14:00:00Z");

  test("planning starts 3 hours before; a failed plan is retried until 24 hours after", () => {
    assert.equal(PLAN_LEAD_MS, 3 * HOUR);
    assert.equal(PLAN_RETRY_MS, 24 * HOUR);
    assert.equal(planWindowStart(release).toISOString(), "2026-10-12T11:00:00.000Z");
    assert.equal(planRetryUntil(release).toISOString(), "2026-10-13T14:00:00.000Z");
    assert.equal(voiceExportFrom(release).toISOString(), "2026-10-12T09:00:00.000Z");
  });

  test("weeklyWindow: in the plan window from 04:00 Arizona until the drop", () => {
    const before = weeklyWindow(DEFAULTS, new Date("2026-10-12T10:59:59Z"));
    assert.equal(before.in_plan_window, false);
    assert.equal(before.release_at.toISOString(), "2026-10-12T14:00:00.000Z");
    assert.equal(before.week_key, "2026-W42");

    const at = weeklyWindow(DEFAULTS, new Date("2026-10-12T11:00:00Z"));
    assert.equal(at.in_plan_window, true);
    assert.equal(at.plan_from.toISOString(), "2026-10-12T11:00:00.000Z");

    const after = weeklyWindow(DEFAULTS, new Date("2026-10-12T14:00:00Z"));
    assert.equal(after.in_plan_window, false, "at the drop the next window is next week's");
    assert.equal(after.week_key, "2026-W43");
  });

  test("weeklyWindow: the voice export is due from 5 hours before the drop", () => {
    assert.equal(weeklyWindow(DEFAULTS, new Date("2026-10-12T08:59:59Z")).voice_due, false);
    assert.equal(weeklyWindow(DEFAULTS, new Date("2026-10-12T09:00:00Z")).voice_due, true);
  });
});

describe("the nightly chores", () => {
  test("one night per value: before 02:00 Arizona it is still last night", () => {
    assert.equal(nightlyDay(DEFAULTS, new Date("2026-10-12T08:59:59Z")), "2026-10-11", "01:59 Arizona");
    assert.equal(nightlyDay(DEFAULTS, new Date("2026-10-12T09:00:00Z")), "2026-10-12", "02:00 Arizona");
    assert.equal(nightlyDay(DEFAULTS, new Date("2026-10-13T06:59:00Z")), "2026-10-12", "23:59 Arizona");
    assert.equal(nightlyDay({}, new Date("2026-10-12T09:00:00Z")), "2026-10-12", "no zone: Arizona");
  });

  test("dayIn reads the zone's calendar", () => {
    assert.equal(dayIn(new Date("2026-10-12T03:00:00Z"), "America/Phoenix"), "2026-10-11");
    assert.equal(dayIn(new Date("2026-10-12T03:00:00Z"), "UTC"), "2026-10-12");
  });
});

describe("Write now: is Chris on the page?", () => {
  const now = new Date("2026-10-12T15:00:00Z");
  test("a page_seen beat 2 minutes old or newer means yes; older, missing or unreadable means no", () => {
    assert.equal(PAGE_SEEN_FRESH_MS, 2 * 60 * 1000);
    assert.equal(chrisOnPage(new Date(now.getTime() - 119 * 1000), now), true);
    assert.equal(chrisOnPage(new Date(now.getTime() - 120 * 1000), now), true);
    assert.equal(chrisOnPage(new Date(now.getTime() - 121 * 1000), now), false);
    assert.equal(chrisOnPage(null, now), false);
    assert.equal(chrisOnPage("not a time", now), false);
  });
});

describe("the buzz words carry the real counts", () => {
  test("N of M ready, K failed", () => {
    assert.equal(scriptsReadyText({ ready: 18, total: 21, failed: 3 }), "Scripts: 18 of 21 ready, 3 failed.");
    assert.equal(scriptsReadyText({ ready: 3, total: 3, failed: 0 }), "Scripts: 3 of 3 ready, 0 failed.");
    assert.equal(scriptsReadyText({ ready: "20", total: "21", failed: "1" }), "Scripts: 20 of 21 ready, 1 failed.");
  });
  test("an unknown count is left out, never shown as 0", () => {
    assert.equal(scriptsReadyText({ ready: 2, total: null, failed: null }), "Scripts: 2 ready.");
    assert.equal(scriptsReadyText({}), "Scripts are ready.");
  });
});

describe("the job kinds", () => {
  test("start_batch is the kind Write now queues", () => {
    assert.equal(BATCH_KINDS.start, START_BATCH_KIND);
    assert.deepEqual(Object.values(BATCH_KINDS).sort(), [
      "expire_drafts", "finish_batch", "nightly_script_check", "release_batch", "start_batch", "voice_export", "write_slot"
    ]);
    assert.equal(FINISH_POLL_MS, 30 * 1000);
  });
});
