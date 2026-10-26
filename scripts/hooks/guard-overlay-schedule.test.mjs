import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'guard-overlay-schedule.mjs');

const runHook = (command) => {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: ROOT,
    input: JSON.stringify({command, cwd: ROOT}),
    encoding: 'utf8',
  });
  assert.equal(result.status, 2, result.stderr);
  return JSON.parse(result.stdout);
};

const validSchedule = {
  width: 1080, height: 1920, fps: 30, video_seconds: 10,
  clips: [{
    n: 1, template: 'SimpleDiagram', mode: 'beside', scale: 1, dx: 0, dy: 0,
    start_frame: 0, frames: 90, words_band: 'top',
    words_on_video_box: [20, 20, 1060, 140], min_text_px_clip: 32,
    visual_size: 'large', key_content_boxes: [{name: 'main chart', box: [40, 160, 1040, 620]}],
    visible_words_fraction: 0.9, visible_measured_by: 'visible-check.py',
    key_content_visible_fractions: {'main chart': 0.9}, key_content_measured_by: 'visible-check.py',
  }],
};

test('the hook blocks both a bare lay-on and a wrapped build without a clean-source proof', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fundhub-overlay-hook-'));
  const plan = path.join(root, 'marketing', 'ads', 'animation-plans', 'ad-1');
  const builder = path.join(plan, 'tools', 'build-from-schedule.py');
  fs.mkdirSync(path.dirname(builder), {recursive: true});
  fs.writeFileSync(path.join(plan, 'schedule.json'), JSON.stringify(validSchedule));
  fs.writeFileSync(builder, '# placeholder\n');
  try {
    const direct = runHook(`FUNDHUB_SIZE_CHECK=off python3 ${builder} /tmp/clips /tmp/out.mp4 /tmp/clean.mp4`);
    assert.match(direct.reason, /Direct build-from-schedule\.py commands are not allowed/);

    const wrapped = runHook(`node scripts/animation-clean-source.mjs build --plan ${plan} --source /tmp/clean.mp4 --out /tmp/out.mp4 -- python3 ${builder} /tmp/clips /tmp/out.mp4 /tmp/clean.mp4`);
    assert.match(wrapped.reason, /Clean-source proof is missing/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
