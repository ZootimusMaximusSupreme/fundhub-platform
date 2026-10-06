// src/ad-videos/merge-takes-media.mjs — the media half of joining takes.
//
// ffmpeg reads each take (size, frame rate, loudness, silence, black frames),
// whisper.cpp hears each take (every word, with its real time), the pure
// planner in src/ad-videos/merge-takes.mjs decides the cuts, and ffmpeg cuts
// and joins them into ONE master MP4.
//
// ═══════════════════════════════════════════════════════════════════════════
// NOTHING HERE COSTS MONEY OR LEAVES THE MACHINE.
//
//   * ffmpeg and whisper.cpp are local programs. No vendor is called, so there
//     is no outbound request and nothing for src/lib/outbound-fetch.mjs to
//     fence. Speech-to-text is whisper.cpp on this machine — never the OpenAI
//     Whisper API in src/company-brain/transcribe.mjs, which is paid.
//   * The takes come in through a `fetchTake` port and the master goes out as
//     a file path. Where the bytes came from (Drive, a folder) is the caller's.
//   * `spawn` is injected, so every argument list is checked by a test with no
//     ffmpeg at all, and the real-ffmpeg tests use tiny synthetic clips.
//
// WHERE IT CAN RUN. The Netlify worker has no ffmpeg and no whisper.cpp
// (ffmpeg-static is a devDependency and is not bundled into functions), so
// resolveLocalJoiner() says so there and the sweeper HOLDS a multi-take angle
// rather than sending a lone take. On the Mac both are present.
// ═══════════════════════════════════════════════════════════════════════════
//
// THE 4K LAW (.claude/rules/video-4k-unless-ad.md): the master keeps the
// takes' own picture size. When takes differ, the master is the SMALLEST of
// them — a bigger take is scaled down, a smaller one is never scaled up. Takes
// with different shapes (a tall phone take and a wide camera take) are never
// squeezed together: that join is refused.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  planBestOf, buildEdl, avoidBlack, refineWordsWithSilence, summarizePlan, DEFAULTS
} from "./merge-takes.mjs";

/** Loudness the master is levelled to. -16 LUFS is the usual target for
    phone-first social video; the true peak stays under -1.5 dB. */
export const TARGET_LUFS = -16;
/** The most a single take's level is pushed up or down to match the others. */
export const MAX_GAIN_DB = 12;

export const ENCODE = Object.freeze({
  /* Submagic re-encodes everything it is handed, so this only has to be
     clean, not small. CRF 17 on x264 is visually lossless for a talking head. */
  crf: 17,
  preset: "veryfast",
  audioBitrate: "192k",
  /* A 12 ms fade at each cut, so a join never clicks. */
  fade: 0.012
});

/* ─────────────────────────────────────────────────────────────────────────
   Finding the programs.
   ───────────────────────────────────────────────────────────────────────── */

function whichSafe(name, spawn) {
  try {
    const r = spawn("which", [name], { encoding: "utf8" });
    return r && r.status === 0 ? String(r.stdout || "").trim() || null : null;
  } catch {
    return null;
  }
}

/** FFMPEG_BIN, then ffmpeg on the PATH, then the ffmpeg-static devDependency. */
export function findFfmpeg({ env = process.env, spawn = spawnSync, exists = fs.existsSync } = {}) {
  const explicit = String(env.FFMPEG_BIN || "").trim();
  if (explicit && exists(explicit)) return explicit;
  const onPath = whichSafe("ffmpeg", spawn);
  if (onPath) return onPath;
  try {
    const bundled = fileURLToPath(new URL("../../node_modules/ffmpeg-static/ffmpeg", import.meta.url));
    if (exists(bundled)) return bundled;
  } catch { /* not a file URL — no bundled copy */ }
  return null;
}

/**
 * resolveLocalJoiner() → { ok: true, ffmpeg, whisperBin, model, buildMaster }
 *                      | { ok: false, why }
 *
 * Reuses the repo's own whisper.cpp lookup (src/company-brain/local-whisper.mjs:
 * WHISPER_CPP_BIN, Homebrew, credentials/hormozi-kb-work/whisper.cpp) and its
 * model lookup (WHISPER_CPP_MODEL, credentials/hormozi-kb-work/models). It
 * never downloads a model: a missing one is reported, not fetched.
 */
export async function resolveLocalJoiner({ env = process.env, spawn = spawnSync, exists = fs.existsSync, cwd = process.cwd() } = {}) {
  const ffmpeg = findFfmpeg({ env, spawn, exists });
  if (!ffmpeg) return { ok: false, why: "this machine has no ffmpeg (set FFMPEG_BIN, or install ffmpeg)" };

  let whisperBin = null;
  let model = null;
  try {
    const lw = await import("../company-brain/local-whisper.mjs");
    whisperBin = lw.resolveWhisperCppBin(env, spawn);
    model = lw.resolveWhisperModelPath(env, path.join(cwd, "credentials/hormozi-kb-work"));
  } catch (err) {
    return { ok: false, why: `the whisper.cpp lookup could not load: ${String(err?.message || err)}` };
  }
  if (!whisperBin) return { ok: false, why: "this machine has no whisper.cpp (set WHISPER_CPP_BIN)" };
  if (!model) return { ok: false, why: "this machine has no whisper.cpp model (set WHISPER_CPP_MODEL)" };

  const transcribe = whisperTranscriber({ ffmpeg, whisperBin, model, spawn });
  return {
    ok: true, ffmpeg, whisperBin, model,
    buildMaster: (args) => buildMaster({ ...args, ffmpeg, transcribe, spawn })
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Running ffmpeg, and reading what it prints. The parsers are pure.
   ───────────────────────────────────────────────────────────────────────── */

export function run(bin, args, { spawn = spawnSync, timeoutMs = 30 * 60 * 1000 } = {}) {
  const r = spawn(bin, args, {
    encoding: "utf8", stdio: "pipe", maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs
  }) || {};
  return {
    ok: r.status === 0,
    status: r.status ?? null,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
    error: r.error ? String(r.error.message || r.error) : null
  };
}

const tail = (s) => String(s || "").trim().split("\n").slice(-3).join(" / ").slice(0, 300);

function hmsToSeconds(h, m, s) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** `ffmpeg -i file` prints the facts to stderr. */
export function parseProbe(stderr) {
  const s = String(stderr || "");
  const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(s);
  const vline = (s.match(/Stream #\d+:\d+[^\n]*: Video:[^\n]*/) || [])[0] || "";
  const size = /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(vline);
  const fps = /([\d.]+)\s*fps/.exec(vline) || /([\d.]+)\s*tbr/.exec(vline);
  const rot = /rotation of (-?[\d.]+) degrees/.exec(s) || /rotate\s*:\s*(-?\d+)/.exec(s);
  let width = size ? Number(size[1]) : null;
  let height = size ? Number(size[2]) : null;
  const rotation = rot ? Math.round(Number(rot[1])) : 0;
  /* A phone stores a tall video as a wide picture plus "turn this 90°".
     ffmpeg turns it when it decodes, so the frames we cut are the turned
     size. */
  if (width && height && Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  return {
    ok: Boolean(dur),
    duration: dur ? hmsToSeconds(dur[1], dur[2], dur[3]) : null,
    width, height, rotation,
    fps: fps ? Number(fps[1]) : null,
    hasVideo: Boolean(vline),
    hasAudio: /Stream #\d+:\d+[^\n]*: Audio:/.test(s)
  };
}

/** silencedetect lines → [{ start, end }]. An open silence runs to `duration`. */
export function parseSilence(stderr, duration = null) {
  const out = [];
  let open = null;
  for (const line of String(stderr || "").split("\n")) {
    const a = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (a) { open = Math.max(0, Number(a[1])); continue; }
    const b = /silence_end:\s*([\d.]+)/.exec(line);
    if (b && open !== null) { out.push({ start: open, end: Number(b[1]) }); open = null; }
  }
  if (open !== null) out.push({ start: open, end: Number.isFinite(Number(duration)) && duration !== null ? Number(duration) : open + 3600 });
  return out;
}

/** blackdetect lines → [{ start, end }]. */
export function parseBlack(stderr) {
  const out = [];
  for (const m of String(stderr || "").matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) {
    out.push({ start: Number(m[1]), end: Number(m[2]) });
  }
  return out;
}

/** The loudnorm measurement block → { inputI, inputTp } (null when silent). */
export function parseLoudnorm(stderr) {
  const s = String(stderr || "");
  const at = s.lastIndexOf("\"input_i\"");
  if (at < 0) return { inputI: null, inputTp: null };
  const open = s.lastIndexOf("{", at);
  const close = s.indexOf("}", at);
  try {
    const j = JSON.parse(s.slice(open, close + 1));
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    return { inputI: num(j.input_i), inputTp: num(j.input_tp) };
  } catch {
    return { inputI: null, inputTp: null };
  }
}

/**
 * whisper.cpp `-ml 1 -sow -oj` output → [{ word, start, end }] in seconds.
 * One entry per word, because -ml 1 caps a segment at one token and -sow
 * splits on words; offsets are milliseconds.
 */
export function parseWhisperJson(json) {
  const obj = typeof json === "string" ? JSON.parse(json) : json;
  const out = [];
  for (const seg of obj?.transcription || []) {
    const text = String(seg?.text || "").trim();
    if (!text) continue;
    const from = Number(seg?.offsets?.from);
    const to = Number(seg?.offsets?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    out.push({ word: text, start: from / 1000, end: to / 1000 });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
   The argument lists. Pure, so a test reads them without running anything.
   ───────────────────────────────────────────────────────────────────────── */

export const probeArgs = (file) => ["-hide_banner", "-i", file];

export const loudnessArgs = (file) => [
  "-hide_banner", "-nostats", "-i", file, "-vn",
  "-af", `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"
];

export const silenceArgs = (file, { noiseDb = -35, minSec = 0.2 } = {}) => [
  "-hide_banner", "-nostats", "-i", file, "-vn",
  "-af", `silencedetect=noise=${noiseDb}dB:d=${minSec}`, "-f", "null", "-"
];

export const blackArgs = (file) => [
  "-hide_banner", "-nostats", "-i", file, "-an",
  "-vf", "scale=320:-2,blackdetect=d=0.04:pic_th=0.98:pix_th=0.10", "-f", "null", "-"
];

export const wavArgs = (file, out) => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", file,
  "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out
];

/** A frame rate as ffmpeg's fps filter wants it: 29.97 → 30000/1001. */
export function fpsExpr(fps) {
  const f = Number(fps);
  if (!Number.isFinite(f) || f <= 0) return "30";
  for (const base of [24, 30, 60, 120]) {
    if (Math.abs(f - (base * 1000) / 1001) < 0.02) return `${base * 1000}/1001`;
  }
  return String(Math.round(f * 1000) / 1000);
}

/** One cut of one take, re-encoded so every cut is frame-exact and shares one
    codec setup (the concat step then copies them without touching a frame). */
export function segmentArgs({ input, start, end, width, height, srcWidth, srcHeight, fps, gainDb = 0, crf = ENCODE.crf, preset = ENCODE.preset, fade = ENCODE.fade }, out) {
  const dur = Math.max(0.05, end - start);
  const f = Math.min(fade, dur / 4);
  const scale = (srcWidth !== width || srcHeight !== height) ? `scale=${width}:${height}:flags=lanczos,` : "";
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", start.toFixed(3), "-i", input, "-t", dur.toFixed(3),
    "-map", "0:v:0", "-map", "0:a:0",
    "-vf", `${scale}fps=${fpsExpr(fps)},format=yuv420p,setsar=1`,
    "-af", `volume=${Number(gainDb).toFixed(2)}dB,afade=t=in:st=0:d=${f.toFixed(3)},` +
      `afade=t=out:st=${Math.max(0, dur - f).toFixed(3)}:d=${f.toFixed(3)},aresample=48000`,
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", ENCODE.audioBitrate, "-ar", "48000", "-ac", "2",
    "-video_track_timescale", "90000",
    out
  ];
}

/** Join the cuts and level the sound once, over the whole master. */
export const concatArgs = (listFile, out) => [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "concat", "-safe", "0", "-i", listFile,
  "-c:v", "copy",
  "-af", `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`,
  "-c:a", "aac", "-b:a", ENCODE.audioBitrate, "-ar", "48000",
  "-movflags", "+faststart",
  out
];

/* ─────────────────────────────────────────────────────────────────────────
   Measuring one take.
   ───────────────────────────────────────────────────────────────────────── */

export function probe(ffmpeg, file, { spawn = spawnSync } = {}) {
  const r = run(ffmpeg, probeArgs(file), { spawn });
  return parseProbe(r.stderr);
}

export function measureLoudness(ffmpeg, file, { spawn = spawnSync } = {}) {
  const r = run(ffmpeg, loudnessArgs(file), { spawn });
  return parseLoudnorm(r.stderr);
}

/* The silence floor follows the take's own level: speech measured at -20 LUFS
   gets a -45 dB floor. A fixed floor would call quiet speech silence and cut
   words in half. */
export function silenceFloor(inputI) {
  const i = inputI === null || inputI === undefined || inputI === "" ? NaN : Number(inputI);
  if (!Number.isFinite(i)) return -45;
  return Math.max(-60, Math.min(-30, Math.round(i - 25)));
}

export function detectSilence(ffmpeg, file, { spawn = spawnSync, inputI = null, duration = null } = {}) {
  const r = run(ffmpeg, silenceArgs(file, { noiseDb: silenceFloor(inputI) }), { spawn });
  return parseSilence(r.stderr, duration);
}

export function detectBlack(ffmpeg, file, { spawn = spawnSync } = {}) {
  const r = run(ffmpeg, blackArgs(file), { spawn });
  return parseBlack(r.stderr);
}

/** whisper.cpp, word by word, on this machine. */
export function whisperTranscriber({ ffmpeg, whisperBin, model, spawn = spawnSync, threads = 4 }) {
  return async (file, { workDir }) => {
    const base = path.join(workDir, `${path.basename(file).replace(/\.[^.]+$/, "")}-words`);
    const wav = `${base}.wav`;
    const a = run(ffmpeg, wavArgs(file, wav), { spawn });
    if (!a.ok) return { ok: false, error: `ffmpeg could not pull the sound out: ${tail(a.stderr) || a.error}` };
    const w = run(whisperBin, [
      "-m", model, "-f", wav, "-l", "en", "-t", String(threads),
      "-ml", "1", "-sow", "-oj", "-of", base, "-np"
    ], { spawn });
    const jsonPath = `${base}.json`;
    if (!fs.existsSync(jsonPath)) return { ok: false, error: `whisper.cpp wrote no words: ${tail(w.stderr) || w.error}` };
    try {
      const words = parseWhisperJson(fs.readFileSync(jsonPath, "utf8"));
      return words.length ? { ok: true, words } : { ok: false, error: "whisper.cpp heard no words" };
    } catch (err) {
      return { ok: false, error: `whisper.cpp words could not be read: ${String(err?.message || err)}` };
    }
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Picture size and frame rate for the master.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * masterFormat(takes) → { ok, width, height, fps } | { ok: false, error }
 *
 * The smallest picture among the takes, never bigger than any of them, and
 * only when every take has the same shape. The frame rate is the one most
 * takes share (the lowest of a tie), so most cuts keep every frame.
 */
export function masterFormat(takes) {
  const sized = takes.filter((t) => t.width && t.height);
  if (!sized.length) return { ok: false, error: "no take has a readable picture size" };
  const ratio = (t) => t.width / t.height;
  const r0 = ratio(sized[0]);
  const odd = sized.find((t) => Math.abs(ratio(t) - r0) / r0 > 0.01);
  if (odd) {
    return { ok: false, error:
      `takes have different shapes (Take ${sized[0].takeNo} is ${sized[0].width}x${sized[0].height}, ` +
      `Take ${odd.takeNo} is ${odd.width}x${odd.height}) — they are not squeezed or padded into one master` };
  }
  const small = sized.reduce((a, b) => (b.height < a.height ? b : a));
  const counts = new Map();
  for (const t of takes) if (t.fps) counts.set(fpsExpr(t.fps), (counts.get(fpsExpr(t.fps)) || 0) + 1);
  const fps = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (evalFps(a[0]) - evalFps(b[0])))[0]?.[0] || "30";
  return { ok: true, width: small.width - (small.width % 2), height: small.height - (small.height % 2), fps };
}

function evalFps(expr) {
  const [a, b] = String(expr).split("/").map(Number);
  return b ? a / b : a;
}

/* ─────────────────────────────────────────────────────────────────────────
   Cutting and joining.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * renderMaster({ ffmpeg, takes, segments, format, workDir, outPath }) → { ok, path, duration, width, height }
 *
 * `takes[i]` = { path, width, height, gainDb }. Each segment is cut out of its
 * take and re-encoded alone, then the cuts are joined and the whole master is
 * levelled once. The result is read back and checked: right size, about the
 * right length, with sound.
 */
export function renderMaster({ ffmpeg, takes, segments, format, workDir, outPath, spawn = spawnSync, encode = {} }) {
  if (!segments.length) return { ok: false, error: "the edit list is empty — nothing to cut" };
  const parts = [];
  let expected = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const t = takes[s.takeIndex];
    const out = path.join(workDir, `cut-${String(i).padStart(4, "0")}.mp4`);
    const r = run(ffmpeg, segmentArgs({
      input: t.path, start: s.start, end: s.end,
      width: format.width, height: format.height, srcWidth: t.width, srcHeight: t.height,
      fps: evalFps(format.fps), gainDb: t.gainDb || 0, ...encode
    }, out), { spawn });
    if (!r.ok) return { ok: false, error: `cut ${i + 1} (Take ${s.takeNo} ${s.start}-${s.end}s) failed: ${tail(r.stderr) || r.error}` };
    parts.push(out);
    expected += s.end - s.start;
  }
  const list = path.join(workDir, "cuts.txt");
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const j = run(ffmpeg, concatArgs(list, outPath), { spawn });
  if (!j.ok) return { ok: false, error: `joining the cuts failed: ${tail(j.stderr) || j.error}` };

  const got = probe(ffmpeg, outPath, { spawn });
  if (!got.ok) return { ok: false, error: "the master could not be read back" };
  if (got.width !== format.width || got.height !== format.height) {
    return { ok: false, error: `the master came out ${got.width}x${got.height}, not ${format.width}x${format.height}` };
  }
  if (!got.hasAudio) return { ok: false, error: "the master has no sound" };
  if (Math.abs(got.duration - expected) > Math.max(0.5, expected * 0.05)) {
    return { ok: false, error: `the master runs ${got.duration?.toFixed(2)} s, the cuts add up to ${expected.toFixed(2)} s` };
  }
  return { ok: true, path: outPath, duration: got.duration, width: got.width, height: got.height, expected };
}

/**
 * buildMaster({ members, script, fetchTake, workDir, ffmpeg, transcribe }) → the master.
 *
 *   members    the takes of ONE angle: [{ id, takeNo, ... }]
 *   script     { lines: [...] } from findScript()
 *   fetchTake  (member) → { ok, path } — a local file for that take
 *   transcribe (path, { workDir }) → { ok, words: [{ word, start, end }] }
 *
 * Returns { ok, path, plan, segments, format, summary } or
 * { ok: false, retryable, error }. `retryable: false` means a person must look
 * (the takes do not follow the script, or cannot share one picture size).
 */
export async function buildMaster({
  members, script, fetchTake, workDir, ffmpeg, transcribe, spawn = spawnSync,
  outPath = null, options = {}, encode = {}, checkBlack = true
}) {
  const takes = [];
  for (const m of [...members].sort((a, b) => a.takeNo - b.takeNo)) {
    const got = await fetchTake(m);
    if (!got?.ok || !got.path) return { ok: false, retryable: true, error: `Take ${m.takeNo}: ${got?.error || "could not be fetched"}` };
    const info = probe(ffmpeg, got.path, { spawn });
    if (!info.ok) return { ok: false, retryable: false, error: `Take ${m.takeNo} could not be read as a video` };
    if (!info.hasAudio) return { ok: false, retryable: false, error: `Take ${m.takeNo} has no sound` };
    const loud = measureLoudness(ffmpeg, got.path, { spawn });
    const silences = detectSilence(ffmpeg, got.path, { spawn, inputI: loud.inputI, duration: info.duration });
    const black = checkBlack && info.hasVideo ? detectBlack(ffmpeg, got.path, { spawn }) : [];
    const heard = await transcribe(got.path, { workDir });
    if (!heard?.ok) return { ok: false, retryable: true, error: `Take ${m.takeNo}: ${heard?.error || "no words heard"}` };
    takes.push({
      id: m.id, takeNo: m.takeNo, path: got.path,
      width: info.width, height: info.height, fps: info.fps, duration: info.duration,
      inputI: loud.inputI, black, silences,
      words: refineWordsWithSilence(heard.words, silences)
    });
  }

  const format = masterFormat(takes);
  if (!format.ok) return { ok: false, retryable: false, error: format.error };

  const plan = planBestOf({ lines: script.lines, takes }, options);
  if (!plan.viable) return { ok: false, retryable: false, error: plan.why, plan };

  const blackByTake = Object.fromEntries(takes.map((t, i) => [i, t.black]));
  const segments = avoidBlack(buildEdl(plan, options), blackByTake, { minSegment: options.minSegment ?? DEFAULTS.minSegment });
  if (!segments.length) return { ok: false, retryable: false, error: "every cut was black or empty" };

  /* Every take is brought to the same level BEFORE the join, so the sound
     does not jump between cuts; the whole master is levelled once after. */
  for (const t of takes) {
    t.gainDb = Number.isFinite(t.inputI)
      ? Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, TARGET_LUFS - t.inputI))
      : 0;
  }

  const out = outPath || path.join(workDir, "master.mp4");
  const rendered = renderMaster({ ffmpeg, takes, segments, format, workDir, outPath: out, spawn, encode });
  if (!rendered.ok) return { ok: false, retryable: true, error: rendered.error, plan, segments };

  return {
    ok: true,
    path: rendered.path,
    duration: rendered.duration,
    format,
    plan,
    segments,
    takes: takes.map((t) => ({ takeNo: t.takeNo, width: t.width, height: t.height, fps: t.fps, inputI: t.inputI, gainDb: t.gainDb })),
    summary: summarizePlan(plan, segments)
  };
}
