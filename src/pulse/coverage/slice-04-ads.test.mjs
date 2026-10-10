import test from "node:test";
import assert from "node:assert/strict";

import { SWEEP_CRON as META_DAILY_CRON, HOURLY_CRON } from "../../workflows/meta-campaign-sync-sweeper.mjs";
import { SWEEP_CRON as AD_VIDEO_CRON } from "../../workflows/ad-video-sweeper.mjs";
import { SWEEP_CRON as WATCH_DIAG_CRON } from "../../workflows/watch-curve-diagnosis-sweeper.mjs";

import { CHECKS, SLICE_ID, gaps } from "./slice-04-ads.mjs";

test("slice 04-ads: every id is set and redAfter is 3x schedule", () => {
  assert.equal(SLICE_ID, "04-ads");
  assert.equal(CHECKS.length, 4);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
  }
});

test("slice 04-ads: crons match workflow modules", () => {
  assert.equal(META_DAILY_CRON, "0 7 * * *");
  assert.equal(HOURLY_CRON, "30 * * * *");
  assert.equal(AD_VIDEO_CRON, "*/5 * * * *");
  assert.equal(WATCH_DIAG_CRON, "30 7 * * *");
});

test("slice 04-ads: nightly Meta sync is on machine.mjs; the rest are gaps", () => {
  const byId = Object.fromEntries(CHECKS.map((row) => [row.id, row]));
  assert.equal(byId["meta-campaign-sync-sweeper"].alreadyInRegistry, true);
  assert.match(byId["meta-campaign-sync-sweeper"].proof, /meta-sync/);

  assert.equal(byId["meta-campaign-sync-hourly"].alreadyInRegistry, false);
  assert.equal(byId["ad-video-sweeper"].alreadyInRegistry, false);
  assert.equal(byId["watch-curve-diagnosis-sweeper"].alreadyInRegistry, false);

  assert.deepEqual(
    gaps().map((g) => g.id).sort(),
    [
      "ad-video-sweeper",
      "meta-campaign-sync-hourly",
      "watch-curve-diagnosis-sweeper"
    ]
  );
});
