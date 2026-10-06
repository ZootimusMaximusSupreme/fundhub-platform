#!/usr/bin/env node
/**
 * Copy on-screen notes from ACQ course twins into Alex Hormozi library duplicates.
 * No API — same lesson, different Drive file id.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_KB_OUT, readIngestState, writeIngestState } from "../src/company-brain/hormozi-kb.mjs";

const outRoot = DEFAULT_KB_OUT;
const LIB_SEGMENT = `${path.sep}alex-hormozi-library${path.sep}100m-money-models-videos${path.sep}`;

function titleKey(content) {
  const m = /^#\s+(.+?)\.mp4\s*$/m.exec(content);
  return m ? m[1].trim().toLowerCase() : null;
}

function onScreenSection(content) {
  const idx = content.indexOf("## On-screen notes");
  if (idx < 0) return null;
  return content.slice(idx).trim();
}

function hasRealNotes(section) {
  if (!section) return false;
  if (section.includes("(no on-screen notes extracted)")) return false;
  if (section.includes("### ")) return true;
  return section.replace(/\s+/g, " ").length > 40;
}

function lessonNumFromTitle(titleKeyStr) {
  const m = /^(\d+)\./.exec(titleKeyStr || "");
  return m ? m[1] : null;
}

function replaceOnScreen(content, section) {
  const idx = content.indexOf("## On-screen notes");
  if (idx < 0) return `${content.trim()}\n\n${section}\n`;
  return `${content.slice(0, idx).trimEnd()}\n\n${section}\n`;
}

function walkMd(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMd(p, acc);
    else if (ent.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

const byTitle = new Map();
const byLessonNum = new Map();
for (const filePath of walkMd(outRoot)) {
  if (filePath.includes(LIB_SEGMENT)) continue;
  const c = fs.readFileSync(filePath, "utf8");
  const key = titleKey(c);
  const section = onScreenSection(c);
  if (!key || !hasRealNotes(section)) continue;
  if (!byTitle.has(key)) byTitle.set(key, section);
  const num = lessonNumFromTitle(key);
  if (num && !byLessonNum.has(num)) byLessonNum.set(num, section);
}

const state = readIngestState(outRoot);
let updated = 0;
let skipped = 0;

for (const filePath of walkMd(outRoot)) {
  if (!filePath.includes(LIB_SEGMENT)) continue;
  const c = fs.readFileSync(filePath, "utf8");
  const key = titleKey(c);
  const existing = onScreenSection(c);
  if (hasRealNotes(existing)) {
    skipped += 1;
    continue;
  }
  let donor = key ? byTitle.get(key) : null;
  if (!donor && key) donor = byLessonNum.get(lessonNumFromTitle(key));
  if (!donor) {
    console.error("[sync-visual] no twin for", path.basename(filePath), key);
    continue;
  }
  fs.writeFileSync(filePath, replaceOnScreen(c, donor), "utf8");
  updated += 1;
  for (const rec of Object.values(state.videos || {})) {
    if (rec.outPath === filePath) {
      rec.visual = "done";
      delete rec.visualError;
    }
  }
}

const AUDIOBOOK_NOTE =
  "## On-screen notes\n\n(Audiobook — no slide visuals; use the speech transcript above.)\n";

for (const filePath of walkMd(outRoot)) {
  if (!filePath.includes("audiobook") && !filePath.includes("Audiobook")) continue;
  const c = fs.readFileSync(filePath, "utf8");
  if (!c.includes("(no on-screen notes extracted)")) continue;
  fs.writeFileSync(filePath, replaceOnScreen(c, AUDIOBOOK_NOTE.trim()), "utf8");
  for (const rec of Object.values(state.videos || {})) {
    if (rec.outPath === filePath) {
      rec.visual = "done";
      delete rec.visualError;
    }
  }
  updated += 1;
}

writeIngestState(outRoot, state);
console.log(JSON.stringify({ donors: byTitle.size, updated, skippedAlready: skipped }, null, 2));
