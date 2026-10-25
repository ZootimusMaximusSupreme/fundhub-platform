// The size check that runs before overlays are laid on a video
// (marketing/broll/scripts/validate-overlay-schedule.mjs; law
// .ai/rules/animation-size-readable.md, owner-set 2026-10-25).
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchedule } from "../../marketing/broll/scripts/validate-overlay-schedule.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const base = { width: 1080, height: 1920, fps: 30, video_seconds: 60 };
const beside = (over = {}) => ({
  n: 1, template: "QualifyToday", start_frame: 30, frames: 90, scale: 0.75, dx: 40, dy: 300, mode: "beside",
  words_on_video_box: [120, 400, 960, 900], min_text_px_clip: 40, ...over,
});
const dash = (over = {}) => ({
  n: 2, template: "BlueprintDashboardReal", start_frame: 300, frames: 600, scale: 1, dx: 0, dy: 0, mode: "behind",
  words_boxes: [[40, 280, 870, 334], [812, 400, 1052, 880]], min_text_px_clip: 28,
  content_source: "marketing/broll/public/blueprint/blueprint-6-month-timelapse.mp4", visible_words_fraction: 0.9,
  visible_measured_by: "visible-check.py, worst 5% of 600 frames", ...over,
});
const run = (clips) => validateSchedule({ ...base, clips }, { repoRoot: REPO });

test("a big beside clip and a real dashboard behind him pass", () => {
  const { fails } = run([beside(), dash()]);
  assert.deepEqual(fails, []);
});

test("a beside clip at scale 0.48 fails as too small", () => {
  const { fails } = run([beside({ scale: 0.48 })]);
  assert.ok(fails.some((f) => /too small/.test(f)), fails.join("\n"));
});

test("words under 28 px on the video fail", () => {
  const { fails } = run([beside({ min_text_px_clip: 30, scale: 0.7 })]);
  assert.ok(fails.some((f) => /px tall/.test(f)), fails.join("\n"));
});

test("a narrow words box fails", () => {
  const { fails } = run([beside({ words_on_video_box: [800, 400, 1060, 900] })]);
  assert.ok(fails.some((f) => /band width/.test(f)), fails.join("\n"));
});

test("a dashboard behind him with no real footage fails (the empty card)", () => {
  const { fails } = run([dash({ template: "BlueprintDashboardOS", content_source: undefined })]);
  assert.ok(fails.some((f) => /content_source/.test(f)), fails.join("\n"));
});

test("a behind clip his head mostly hides fails, and one never measured fails", () => {
  assert.ok(run([dash({ visible_words_fraction: 0.3 })]).fails.some((f) => /hide/.test(f)));
  assert.ok(run([dash({ visible_words_fraction: undefined })]).fails.some((f) => /visible_words_fraction/.test(f)));
});

test("two clips at once and a missing frame size fail", () => {
  assert.ok(run([beside(), beside({ n: 3, start_frame: 60 })]).fails.some((f) => /two clips at once/.test(f)));
  assert.ok(validateSchedule({ clips: [beside()] }).fails.length > 0);
});

test("the Capital Blueprint Ad 1 layout Chris rejected fails (scale 0.48-0.52 chips, empty dashboard card)", () => {
  const ad1 = [
    beside({ n: 1, template: "PullAwayLoss", scale: 0.48, words_on_video_box: [36, 240, 520, 700] }),
    beside({ n: 2, template: "CreditFileExam", start_frame: 200, scale: 0.52, words_on_video_box: [560, 200, 1040, 620] }),
    dash({ n: 3, template: "BlueprintDashboardOS", start_frame: 400, content_source: undefined, visible_words_fraction: undefined }),
  ];
  assert.equal(run(ad1).fails.length >= 3, true);
});

test("a graphic that sits fully inside the frame passes the on-screen check", () => {
  const { fails } = run([beside()]);
  assert.equal(fails.some((f) => /hangs off the screen|black empty side/.test(f)), false, fails.join("\n"));
});

test("a graphic shoved off the left or the right fails the on-screen check", () => {
  const left = run([beside({ dx: -400 })]);
  assert.ok(left.fails.some((f) => /hangs off the screen on the left/.test(f)), left.fails.join("\n"));
  const right = run([beside({ dx: 500 })]);
  assert.ok(right.fails.some((f) => /hangs off the screen on the right/.test(f)), right.fails.join("\n"));
});

test("a half-width clip that leaves half the picture empty fails", () => {
  const { fails } = run([beside({ width: 540, height: 1920, scale: 1, dx: 0, dy: 0 })]);
  assert.ok(fails.some((f) => /black empty side/.test(f)), fails.join("\n"));
});

test("a template file is not real content, a hand-typed visible share is not a measurement, words in the top 14% fail", () => {
  assert.ok(run([dash({ content_source: "marketing/broll/src/templates/BlueprintDashboardReal.tsx" })]).fails.some((f) => /not footage/.test(f)));
  assert.ok(run([dash({ visible_measured_by: undefined })]).fails.some((f) => /not measured/.test(f)));
  assert.ok(run([beside({ words_on_video_box: [64, 0, 1022, 628] })]).fails.some((f) => /words band/.test(f)));
});
