import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {protectedBuild, recordAnimatedOutput, registerCleanSource, validateCleanSource} from './animation-clean-source.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fundhub-clean-source-'));
const plans = path.join(root, 'marketing', 'ads', 'animation-plans');
const plan = path.join(plans, 'ad-1');
const clean = path.join(root, 'Ad 1 — Post Submagic Pre Animation.mp4');
const output = path.join(root, 'Ad 1 — Animated.mp4');
fs.mkdirSync(plan, {recursive: true});
fs.writeFileSync(clean, 'clean-captioned-submagic-export');

test('a registered clean source passes only while its exact bytes are unchanged', () => {
  registerCleanSource({planDir: plan, sourcePath: clean, verifiedClean: true});
  const pass = validateCleanSource({planDir: plan, sourcePath: clean, outputPath: output});
  assert.equal(pass.ok, true, pass.errors.join('\n'));

  fs.appendFileSync(clean, '-changed');
  const fail = validateCleanSource({planDir: plan, sourcePath: clean, outputPath: output});
  assert.equal(fail.ok, false);
  assert.ok(fail.errors.some((line) => line.includes('changed after it was approved')));
});

test('an animation output is permanently rejected as the next source', () => {
  const clean2 = path.join(root, 'Ad 2 — Post Submagic Pre Animation.mp4');
  const output2 = path.join(root, 'Ad 2 — Animated.mp4');
  const plan2 = path.join(plans, 'ad-2');
  fs.mkdirSync(plan2, {recursive: true});
  fs.writeFileSync(clean2, 'clean-ad-two');
  fs.writeFileSync(output2, 'animated-ad-two');
  registerCleanSource({planDir: plan2, sourcePath: clean2, verifiedClean: true});
  recordAnimatedOutput({planDir: plan2, sourcePath: clean2, outputPath: output2});

  const plan3 = path.join(plans, 'ad-3');
  fs.mkdirSync(plan3, {recursive: true});
  assert.throws(
    () => registerCleanSource({planDir: plan3, sourcePath: output2, verifiedClean: true}),
    /already recorded as an animated output/
  );
});

test('the protected builder checks source and schedule before recording its output', () => {
  const plan4 = path.join(plans, 'ad-4');
  const clean4 = path.join(root, 'Ad 4 — Post Submagic Pre Animation.mp4');
  const output4 = path.join(root, 'Ad 4 — Animated.mp4');
  fs.mkdirSync(plan4, {recursive: true});
  fs.writeFileSync(clean4, 'clean-ad-four');
  fs.writeFileSync(path.join(plan4, 'schedule.json'), JSON.stringify({
    width: 1080,
    height: 1920,
    fps: 30,
    video_seconds: 10,
    clips: [{
      n: 1, template: 'SimpleDiagram', mode: 'beside', scale: 1, dx: 0, dy: 0,
      start_frame: 0, frames: 90,
      words_on_video_box: [20, 300, 1060, 420], min_text_px_clip: 32,
      visual_size: 'large', key_content_boxes: [{name: 'main chart', box: [40, 160, 1040, 620]}],
      visible_words_fraction: 0.9, visible_measured_by: 'visible-check.py',
      key_content_visible_fractions: {'main chart': 0.9}, key_content_measured_by: 'visible-check.py',
    }],
  }));
  registerCleanSource({planDir: plan4, sourcePath: clean4, verifiedClean: true});
  const result = protectedBuild({
    planDir: plan4,
    sourcePath: clean4,
    outputPath: output4,
    command: [process.execPath, '-e', "require('node:fs').copyFileSync(process.argv[1], process.argv[2])", clean4, output4],
  });
  assert.equal(result.outputPath, fs.realpathSync(output4));
  fs.mkdirSync(path.join(plans, 'ad-5'), {recursive: true});
  assert.throws(
    () => registerCleanSource({planDir: path.join(plans, 'ad-5'), sourcePath: output4, verifiedClean: true}),
    /already recorded as an animated output/
  );
});
