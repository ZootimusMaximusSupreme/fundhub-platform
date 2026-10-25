#!/usr/bin/env node
// Law: .ai/rules/animation-overlay-frame-review.md (owner-set 2026-10-25).
// Non-blocking reminder: final mux or contact sheet without frame-review evidence.
// Usage:
//   node scripts/animation-overlay-frame-review-check.mjs [plan-dir] [--final /path/to/review-final.mp4]
//   npm run animation:frame-review-check -- marketing/ads/animation-plans/foo/
// Exit 0 always (warn on stderr). FUNDHUB_SKIP_FRAME_REVIEW=1 silences warnings.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PASS_JSON = 'frame-review-pass.json';
const CONTACT_NAMES = ['contact-sheet-final.jpg', 'contact-sheet-final.png', 'contact-sheet.jpg'];

function hasContactSheet(dir) {
  for (const name of CONTACT_NAMES) {
    if (fs.existsSync(path.join(dir, name))) return true;
  }
  const frameReview = path.join(dir, 'frame-review');
  if (fs.existsSync(frameReview) && fs.statSync(frameReview).isDirectory()) {
    const pngs = fs.readdirSync(frameReview).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
    if (pngs.length > 0) return true;
  }
  return false;
}

function hasPassFile(dir) {
  return fs.existsSync(path.join(dir, PASS_JSON));
}

function warn(msg) {
  console.error(`[animation-overlay-frame-review] ${msg}`);
}

function main() {
  if (process.env.FUNDHUB_SKIP_FRAME_REVIEW === '1') {
    process.exit(0);
  }

  const args = process.argv.slice(2);
  let planDir = '';
  let finalVideo = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--final' && args[i + 1]) {
      finalVideo = path.resolve(args[++i]);
    } else if (!args[i].startsWith('-')) {
      planDir = path.resolve(process.cwd(), args[i]);
    }
  }

  if (!planDir) {
    warn(
      'Pass an animation plan directory to check for frame-review evidence, or set FUNDHUB_SKIP_FRAME_REVIEW=1. Law: .ai/rules/animation-overlay-frame-review.md',
    );
    process.exit(0);
  }

  if (!fs.existsSync(planDir)) {
    warn(`Plan directory not found: ${planDir}`);
    process.exit(0);
  }

  const rel = path.relative(ROOT, planDir) || planDir;
  const passOk = hasPassFile(planDir);
  const sheetOk = hasContactSheet(planDir);
  const finalExists = finalVideo && fs.existsSync(finalVideo);

  if (finalExists && !passOk && !sheetOk) {
    warn(
      `Final mux exists (${finalVideo}) but ${rel} has no ${PASS_JSON} and no contact sheet / frame-review/ images. View frames on the final mux before calling acceptable.`,
    );
    process.exit(0);
  }

  if ((sheetOk || finalExists) && !passOk) {
    warn(
      `${rel}: contact sheet or final mux present but ${PASS_JSON} is missing. Save verdict + evidence per animation-overlay-frame-review law.`,
    );
    process.exit(0);
  }

  if (!passOk && !sheetOk && !finalExists) {
    warn(
      `${rel}: no frame-review evidence yet. After overlay finalize, extract and view frames on the final mux, then write ${PASS_JSON}.`,
    );
  }

  process.exit(0);
}

main();
