#!/usr/bin/env node
// Size check for an overlay schedule, run BEFORE the clips are laid on a video.
// Law: .ai/rules/animation-size-readable.md (owner-set 2026-10-25).
//
//   node marketing/broll/scripts/validate-overlay-schedule.mjs <schedule.json> [--json]
//
// It fails (exit 1) when a clip would ship too small or empty:
//   * a beside or in-front clip under scale 0.65 (portrait) — Ad 1 used 0.46-0.52;
//   * a clip whose words box on the video is under 60% of the words band width;
//   * a clip whose smallest words would be under 28 px tall on a 1080-wide video;
//   * a product or proof clip behind Chris (Dashboard, Proof, CreditFile
//     templates) with no real content source; any behind clip with no measured
//     visible share, or where his cut-out hides more than half of its words box;
//   * a clip whose words box runs off the frame, or two clips at the same time;
//   * a clip whose placed box (dx/dy or x/y, clip size times scale) hangs off
//     the picture, or a clip file that is not the full frame and leaves a
//     black empty side (owner-set 2026-10-25, animation-rules section 2);
//   * a schedule with no frame size, or not a full 1080x1920 / wide frame.
// Warnings (exit 0): words box between 60% and 70% of the band width.
//
// Schedule rows (fields the check reads; older schedules may lack the new ones):
//   start_frame, frames, scale, dx, dy (or x, y on older rows), spot,
//   width, height on a clip only when the file is not a full-frame see-through render
//   mode: "beside" | "behind" | "front"   (read from spot when missing)
//   words_on_video_box: [x0, y0, x1, y1]  (where the words sit on the video)
//   min_text_px_clip: smallest words height in the clip at scale 1
//   content_source: repo path of the real footage a behind clip shows
//   visible_words_fraction: share of the words box not covered by his cut-out
//     (measured on every frame of the window by tools/visible-check.py, which
//     also writes visible_measured_by)
// Words boxes on a portrait ad stay in the text-safe band, y 269-1248.
// A row marked words_band: "top" may also use the clear sky above y 269,
// but still stays above the caption line at y 1248.
// Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';

const PORTRAIT = {w: 1080, h: 1920, bandW: 1080};
/** Text-safe band on a portrait ad (owner-set 2026-10-02; marketing/broll/src/brand/tokens.ts SAFE). */
const SAFE_BAND = {top: 269, bottom: 1248};
/** Real footage or real proof, not a template file. */
const FOOTAGE_RE = /\.(mp4|mov|webm|png|jpe?g)$|\/proof-[a-z]+\/?$/i;
export const LIMITS = {
  besideMinScale: 0.65,
  bandShareFail: 0.6,
  bandShareWarn: 0.7,
  minTextPx1080: 28,
  behindMinVisible: 0.5,
  /** One empty side this big (share of the frame) is a black slab, not a see-through gap. */
  blackGap: 0.4,
};

/** Product and proof beats: behind him they must show real footage or real proof. */
const REAL_CONTENT_RE = /Dashboard|Proof|CreditFile/;

const finite = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Top-left of the scaled clip. The lay-on uses dx/dy. Older rows store the same corner as x/y. */
const originOf = (c) => {
  const dx = finite(c.dx);
  const dy = finite(c.dy);
  return {
    x: dx != null ? dx : (finite(c.x) ?? 0),
    y: dy != null ? dy : (finite(c.y) ?? 0),
  };
};

/**
 * Pixel size of the file before scale.
 * A see-through ProRes clip is the full video frame (clear pixels, not black).
 * width and height on the clip row mean the file itself is smaller than that.
 */
const assetSize = (c, W, H) => {
  const w = finite(c.width);
  const h = finite(c.height);
  if (w > 0 && h > 0) return {w, h};
  return {w: W, h: H};
};

const edgeList = (edges) => {
  const named = edges.map((e) => `the ${e}`);
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
};

/** The whole graphic has to stay inside the picture. A half-width file must not leave a black side. */
function onScreenFails(c, name, W, H) {
  const sc = Number(c.scale);
  const {x, y} = originOf(c);
  const asset = assetSize(c, W, H);
  const pw = Math.round(asset.w * sc);
  const ph = Math.round(asset.h * sc);
  const right = x + pw;
  const bottom = y + ph;
  const out = [];
  const off = [];
  if (x < 0) off.push('left');
  if (y < 0) off.push('top');
  if (right > W) off.push('right');
  if (bottom > H) off.push('bottom');
  if (off.length) {
    out.push(`${name}: the animation hangs off the screen on ${edgeList(off)}. It starts at x ${x}, y ${y} and is ${pw} by ${ph} pixels on a ${W} by ${H} video. The whole graphic has to stay inside the picture.`);
  }
  const fullFrame = Math.abs(asset.w - W) <= 1 && Math.abs(asset.h - H) <= 1;
  if (!fullFrame) {
    const coverW = Math.max(0, Math.min(right, W) - Math.max(x, 0));
    const coverH = Math.max(0, Math.min(bottom, H) - Math.max(y, 0));
    const emptyW = W - coverW;
    const emptyH = H - coverH;
    if (emptyW >= W * LIMITS.blackGap || emptyH >= H * LIMITS.blackGap) {
      out.push(`${name}: this clip is ${asset.w} by ${asset.h} pixels, not the full ${W} by ${H} picture, and it leaves a black empty side (${Math.round(emptyW)} px across, ${Math.round(emptyH)} px tall). Half the video cannot be a black slab. Use a full-frame see-through clip and keep it inside the picture.`);
    }
  }
  return out;
}

const modeOf = (c) => {
  if (c.mode) return String(c.mode).toLowerCase();
  const s = String(c.spot || '').toLowerCase();
  if (s.includes('behind')) return 'behind';
  if (s.includes('front')) return 'front';
  return 'beside';
};

export function validateSchedule(sched, {repoRoot = process.cwd()} = {}) {
  const fails = [];
  const warns = [];
  const W = Number(sched.width);
  const H = Number(sched.height);
  if (!W || !H) {
    fails.push('The schedule has no width and height, so the frame cannot be checked.');
    return {fails, warns};
  }
  const portrait = W === PORTRAIT.w && H === PORTRAIT.h;
  const wide = W / H > 1.7 && W / H < 1.8;
  if (!portrait && !wide) fails.push(`Frame ${W}x${H} is not a full 1080x1920 or 16:9 frame (black bars would show).`);
  const k = W / 1080;
  const bandW = portrait ? PORTRAIT.bandW : W * 0.4;
  const clips = Array.isArray(sched.clips) ? sched.clips : [];
  if (!clips.length) fails.push('The schedule has no clips.');
  const sorted = [...clips].sort((a, b) => a.start_frame - b.start_frame);
  let prevEnd = -1;
  let prevName = '';
  for (const c of sorted) {
    const name = `#${c.n ?? '?'} ${c.template ?? c.clip ?? ''}`.trim();
    const mode = modeOf(c);
    const sc = Number(c.scale);
    if (!(sc > 0)) {
      fails.push(`${name}: no scale.`);
      continue;
    }
    if (c.start_frame < prevEnd) fails.push(`${name}: starts before ${prevName} ends (two clips at once).`);
    prevEnd = c.start_frame + c.frames;
    prevName = name;
    if (sched.video_seconds && prevEnd > Math.round(sched.video_seconds * (sched.fps || 30)) + 1) {
      fails.push(`${name}: runs past the end of the video.`);
    }
    if (mode !== 'behind' && portrait && sc < LIMITS.besideMinScale) {
      fails.push(`${name}: scale ${sc} is too small to read on a phone. Beside clips need ${LIMITS.besideMinScale} or more. Use Behind with a full-width asset, or a bigger spot.`);
    }
    fails.push(...onScreenFails(c, name, W, H));
    const boxes = Array.isArray(c.words_boxes) ? c.words_boxes : Array.isArray(c.words_on_video_box) ? [c.words_on_video_box] : [];
    if (boxes.length && boxes.every((b) => Array.isArray(b) && b.length === 4)) {
      for (const b of boxes) {
        if (b[0] < 0 || b[1] < 0 || b[2] > W || b[3] > H) fails.push(`${name}: words box [${b.join(', ')}] runs off the frame.`);
        else if (portrait && ((c.words_band !== 'top' && b[1] < SAFE_BAND.top) || b[3] > SAFE_BAND.bottom)) fails.push(`${name}: words box [${b.join(', ')}] leaves the words band (y ${c.words_band === 'top' ? 0 : SAFE_BAND.top}-${SAFE_BAND.bottom}); the app buttons and captions cover words there.`);
      }
      const x0 = Math.min(...boxes.map((b) => b[0]));
      const x1 = Math.max(...boxes.map((b) => b[2]));
      const share = (x1 - x0) / bandW;
      if (share < LIMITS.bandShareFail) fails.push(`${name}: words are only ${Math.round(share * 100)}% of the words band width. They need 60% or more (70% to 90% is normal).`);
      else if (share < LIMITS.bandShareWarn) warns.push(`${name}: words are ${Math.round(share * 100)}% of the band width (70% to 90% is normal).`);
    } else if (mode !== 'behind') {
      fails.push(`${name}: no words_on_video_box, so the size cannot be checked.`);
    }
    if (c.min_text_px_clip != null) {
      const px = (Number(c.min_text_px_clip) * sc) / k;
      if (px < LIMITS.minTextPx1080) fails.push(`${name}: the smallest words land ${px.toFixed(0)} px tall (on a 1080-wide frame). They need ${LIMITS.minTextPx1080} px or more.`);
    } else {
      fails.push(`${name}: no min_text_px_clip (the smallest words height in the clip), so readability cannot be checked.`);
    }
    if (mode === 'behind') {
      const src = c.content_source;
      const needsReal = REAL_CONTENT_RE.test(String(c.template || ''));
      if (needsReal && !src) fails.push(`${name}: a product or proof clip behind Chris needs content_source (real footage, e.g. the Blueprint dashboard recording), not an empty card.`);
      else if (src && !fs.existsSync(path.resolve(repoRoot, src))) fails.push(`${name}: content_source ${src} is not in the repo.`);
      else if (needsReal && !FOOTAGE_RE.test(src)) fails.push(`${name}: content_source ${src} is not footage or proof images (a template file is not real content).`);
      const vis = c.visible_words_fraction;
      if (vis == null) fails.push(`${name}: no visible_words_fraction. Measure how much of the words box his cut-out leaves visible (tools/visible-check.py).`);
      else if (!/visible-check/.test(String(c.visible_measured_by || ''))) fails.push(`${name}: visible_words_fraction was not measured by visible-check.py on the person cut-out (visible_measured_by is missing).`);
      else if (vis < LIMITS.behindMinVisible) fails.push(`${name}: his head and body hide ${Math.round((1 - vis) * 100)}% of the words. At least ${Math.round(LIMITS.behindMinVisible * 100)}% must show.`);
      const covers = c.dx <= 0 && c.dx + W * sc >= W;
      if (!covers && sc >= 0.95) warns.push(`${name}: a behind clip that does not span the full width leaves an empty side.`);
    }
  }
  return {fails, warns};
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: validate-overlay-schedule.mjs <schedule.json> [--json]');
    process.exit(2);
  }
  const sched = JSON.parse(fs.readFileSync(file, 'utf8'));
  let root = path.dirname(path.resolve(file));
  while (root !== path.dirname(root) && !fs.existsSync(path.join(root, '.git'))) root = path.dirname(root);
  const {fails, warns} = validateSchedule(sched, {repoRoot: root});
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ok: !fails.length, fails, warns}, null, 1) + '\n');
  } else {
    for (const w of warns) console.log('WARN  ' + w);
    for (const f of fails) console.log('FAIL  ' + f);
    console.log(fails.length ? `NOT READY: ${fails.length} problem(s). Opus fixes the layout before this ships (too small, off the screen, or a black empty side).` : `OK: ${sched.clips.length} clips pass the size and on-screen check.`);
  }
  process.exit(fails.length ? 1 : 0);
}
