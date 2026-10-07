#!/usr/bin/env node
// Land one filmed take on this Mac as the original file.
//
// Nothing else in this repo does that. Drive helpers only keep a take after
// an upload, and the join step runs ffmpeg. This script does neither.
//
// It copies the bytes. The picture stays as the camera saved it, mirrored
// included. It does not upload, recompress, flip, or delete anything.
// If that name is already in the folder, it stops and leaves the old file.
//
//   node scripts/receive-filmed-take.mjs <source-file>
//   node scripts/receive-filmed-take.mjs --name "SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4" <source-file>
//
// Folder: marketing/ads/filmed/ (this Mac only, gitignored).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILMED_DIR = path.join(ROOT, "marketing", "ads", "filmed");

function safeName(raw) {
  const base = path.basename(String(raw || "").replaceAll("\\", "/")).trim();
  if (!base || base === "." || base === ".." || base.includes("\0")) return null;
  return base;
}

function readArgs(argv) {
  let name = null;
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") {
      name = argv[++i] ?? "";
      continue;
    }
    if (a.startsWith("-")) {
      console.error("Unknown flag. Nothing was written.");
      process.exit(2);
    }
    positionals.push(a);
  }
  return { name, source: positionals[0] || null, extra: positionals.length > 1 };
}

const { name: nameArg, source, extra } = readArgs(process.argv.slice(2));
if (extra || !source) {
  console.error('usage: node scripts/receive-filmed-take.mjs <source-file> [--name "file name.mp4"]');
  process.exit(2);
}

const name = safeName(nameArg || path.basename(source));
if (!name) {
  console.error("Need a file name. Nothing was written.");
  process.exit(2);
}

const src = path.resolve(source);
let st;
try { st = fs.statSync(src); } catch {
  console.error("That file is not here. Nothing was written.");
  process.exit(1);
}
if (!st.isFile()) {
  console.error("That path is not a file. Nothing was written.");
  process.exit(1);
}

fs.mkdirSync(FILMED_DIR, { recursive: true });
const dest = path.join(FILMED_DIR, name);
if (path.resolve(dest) === src) {
  console.log(dest);
  process.exit(0);
}

try {
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
} catch (err) {
  if (err && err.code === "EEXIST") {
    console.error("That name is already in the folder. The old file was left as it is. Nothing was written over it.");
    process.exit(1);
  }
  throw err;
}

console.log(dest);
