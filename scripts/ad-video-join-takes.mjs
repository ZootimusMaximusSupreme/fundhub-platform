#!/usr/bin/env node
// Join every take of one angle into ONE master — on this machine.
//
// .claude/rules/ad-video-best-of-clips.md: one finished video per ad, from the
// best of every take, in script order, with dead air, repeats, false starts and
// filler cut, BEFORE Submagic sees it. The planner and the cutter are
// src/ad-videos/merge-takes*.mjs. This script runs them where ffmpeg and
// whisper.cpp exist (the Netlify worker has neither, so there a multi-take
// angle waits at `staged` with a note pointing here).
//
// TWO MODES.
//
//   --dir <folder> [--out <folder>] [--keep]
//       OFFLINE. Reads the takes in a local folder, groups them by their
//       marketing/ads/NAMING.md names, and writes one "<angle> Master.mp4" and
//       one "<angle> Master.edl.json" per angle into --out (default: <folder>/masters).
//       No database, no Drive, no Submagic, no paid API. This is how a join is
//       watched and checked before anything is spent.
//
//   --live
//       ONE REAL PASS of the ad-video sweeper from this machine — the same
//       sweep() the Netlify background worker runs, with the same limits and
//       the same saveFinished port, reading .env. A multi-take angle is joined
//       here and its master goes to Submagic, which SPENDS Submagic credit when
//       ADAPTERS_DRY_RUN is off. Agents run it; Chris does not.
//
// Speech-to-text is whisper.cpp: WHISPER_CPP_BIN / WHISPER_CPP_MODEL, else the
// repo's own lookup (Homebrew, credentials/hormozi-kb-work/whisper.cpp). A
// missing model is reported, never downloaded.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "./load-env.mjs";
import { parseTakeName, groupKey, groupLabel, findScript } from "../src/ad-videos/merge-takes.mjs";
import { loadScripts } from "../src/ad-videos/merge-takes-step.mjs";
import { resolveLocalJoiner } from "../src/ad-videos/merge-takes-media.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIDEO = /\.(mp4|mov|m4v)$/i;

function args(argv) {
  const out = { live: false, keep: false, dir: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") out.live = true;
    else if (a === "--keep") out.keep = true;
    else if (a === "--dir") out.dir = argv[++i];
    else if (a === "--out") out.out = argv[++i];
  }
  return out;
}

async function live() {
  loadEnv();
  const { sweep } = await import("../src/workflows/ad-video-sweeper.mjs");
  const { db } = await import("../src/db.mjs");
  const worker = await import("../netlify/functions/ad-video-worker-background.mjs");
  const result = await sweep(db, { limit: worker.TAKES_PER_PASS, saveFinished: worker.saveFinished });
  console.log(JSON.stringify(result, null, 2));
  try { await db.end?.(); } catch { /* the pool may already be closed */ }
  return result.ok ? 0 : 1;
}

async function offline({ dir, out, keep }) {
  const folder = path.resolve(dir);
  const outDir = path.resolve(out || path.join(folder, "masters"));
  fs.mkdirSync(outDir, { recursive: true });

  const groups = new Map();
  const unnamed = [];
  for (const file of fs.readdirSync(folder).filter((f) => VIDEO.test(f)).sort()) {
    const parsed = parseTakeName(file);
    if (!parsed) { unnamed.push(file); continue; }
    const key = groupKey(parsed);
    if (!groups.has(key)) groups.set(key, { parsed, members: [] });
    const g = groups.get(key);
    if (g.members.some((m) => m.takeNo === parsed.takeNo)) { unnamed.push(`${file} (second file for Take ${parsed.takeNo})`); continue; }
    g.members.push({ id: file, takeNo: parsed.takeNo, path: path.join(folder, file) });
  }
  for (const f of unnamed) console.log(`skipped — not a NAMING.md take name: ${f}`);
  if (!groups.size) { console.log("no NAMING.md takes in", folder); return 1; }

  const joiner = await resolveLocalJoiner({ env: process.env, cwd: ROOT });
  if (!joiner.ok) { console.log(`cannot join here: ${joiner.why}`); return 1; }
  const scripts = loadScripts();

  let failed = 0;
  for (const { parsed, members } of groups.values()) {
    const label = groupLabel(parsed);
    const script = findScript(scripts, parsed);
    if (!script) { console.log(`${label}: no script with that title in the repo — skipped`); failed++; continue; }
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-join-"));
    const master = path.join(outDir, `${label} Master.mp4`);
    try {
      const built = await joiner.buildMaster({
        members, script, workDir, outPath: master,
        fetchTake: async (m) => ({ ok: true, path: m.path })
      });
      if (!built.ok) { console.log(`${label}: NOT joined — ${built.error}`); failed++; continue; }
      const report = {
        angle: label,
        script: script.source,
        takes: built.takes,
        format: built.format,
        duration: built.duration,
        summary: built.summary,
        lines: built.plan.lines.map((l) => ({
          line: l.lineIndex + 1,
          text: l.text,
          take: l.pick?.takeNo ?? null,
          from: l.pick ? l.pick.hit.start : null,
          to: l.pick ? l.pick.hit.end : null,
          defects: l.pick?.hit.defects ?? null,
          attempts: l.attempts,
          falseStarts: l.falseStarts
        })),
        missing: built.plan.missing.map((i) => i + 1),
        cuts: built.segments
      };
      fs.writeFileSync(master.replace(/\.mp4$/, ".edl.json"), JSON.stringify(report, null, 2));
      console.log(`${label}: ${master}\n  ${built.summary}`);
    } finally {
      if (!keep) fs.rmSync(workDir, { recursive: true, force: true });
      else console.log(`  work folder kept: ${workDir}`);
    }
  }
  return failed ? 1 : 0;
}

const a = args(process.argv.slice(2));
if (!a.live && !a.dir) {
  console.log("usage: node scripts/ad-video-join-takes.mjs --dir <folder of takes> [--out <folder>] [--keep]\n" +
    "       node scripts/ad-video-join-takes.mjs --live   (one real sweeper pass from this machine — spends Submagic)");
  process.exit(2);
}
process.exit(a.live ? await live() : await offline(a));
