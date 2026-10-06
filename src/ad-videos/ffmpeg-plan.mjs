// @ts-check
// src/ad-videos/ffmpeg-plan.mjs — the ffmpeg argument lists for one ad master
// (spec docs/specs/marketing-machine-2026-10-04.md §9.3, and §9.1 step 3).
//
// ═══════════════════════════════════════════════════════════════════════════
// PURE. Nothing in this file runs ffmpeg, reads a file, or calls anybody. Each
// builder returns an argument list (argv WITHOUT the program name) for one run
// of ffmpeg (or ffprobe, for probeArgs). Each parser reads what that run
// printed. The video worker (video-worker/, spec §9.5) is the thin shell that
// runs them; every list here is pinned by src/ad-videos/ffmpeg-plan.test.mjs.
//
// ADS ONLY. Every builder throws NotAnAdError unless video_kind is 'ad'. The
// master is cut to 1080x1920, which is right for a paid ad and wrong for
// everything else: VSLs, portal videos and testimonials keep 4K end to end
// (.claude/rules/video-4k-unless-ad.md). A caller that leaves video_kind out is
// refused too, so a forgotten field can never shrink a VSL.
//
// THE RUNS, IN ORDER
//   prepare   probeArgs → parseProbe (ffprobe JSON)
//             audioExtractArgs (mono 16 kHz Opus 32 kbps .ogg, for Whisper)
//             silenceArgs → parseSilence (noise -35 dB, d=0.12)
//   cut       pieceArgs, one run per piece: ONE decode of ONE input each, so a
//             take is never split and trimmed inside one decode (§9.3)
//             loudnormPass1Args on each piece → parseLoudnorm
//             blackdetectArgs on each piece → parseBlackdetect
//             cutChecks → { ok, reasons } (any failure blocks the master)
//   join      concatList + concatArgs (stream copy: nothing is encoded here)
//             loudnormPass1Args on the join → parseLoudnorm
//             finalArgs = loudnorm pass 2 (linear) + the ONE final encode
//
// The worker needs ffmpeg 6.1+ built with libzimg: zscale is in the HDR chain
// and -fps_mode is in the final encode.
//
// WHY THIS FILE DOES NOT IMPORT merge-takes-media.mjs. That module has a
// silence parser of the same shape, but it also pulls in the Mac-only
// whisper.cpp lookup (it names a credentials/ folder). This file has to stay
// free of that, because the worker callback and the cut step will import it
// from code Netlify bundles. So the two small parsers below are written again
// here, and merge-takes-media.mjs is left exactly as it is.
// ═══════════════════════════════════════════════════════════════════════════

/* ─────────────────────────────────────────────────────────────────────────
   The numbers the spec sets.
   ───────────────────────────────────────────────────────────────────────── */

/** The master's frame rate, size and sound. Ads only: 1080x1920 at 30 fps. */
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const AUDIO_RATE = 48000;
/** 48000 / 30: one video frame holds exactly this many sound samples. */
export const SAMPLES_PER_FRAME = AUDIO_RATE / FPS;
/** 15 ms fades at both ends of every piece, counted in samples (720). */
export const FADE_SAMPLES = Math.round(0.015 * AUDIO_RATE);

/** Two-pass loudness target for the master (spec §9.3). */
export const LOUDNORM = Object.freeze({ I: -14, TP: -1.5, LRA: 11 });

/** silencedetect settings for the prepare step (spec §9.1 step 3). */
export const SILENCE = Object.freeze({ noiseDb: -35, minSeconds: 0.12 });

/** Colour transfers that mean the phone filmed HDR (HLG and PQ). */
export const HDR_TRANSFERS = Object.freeze(["arib-std-b67", "smpte2084"]);

/** iPhone HDR → SDR bt709, prepended to the piece filters (spec §9.3, word for word). */
export const TONEMAP_CHAIN =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709," +
  "tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

/** The cut checks (spec §9.3, best-of-clips law). */
export const CUT_CHECKS = Object.freeze({
  /** No piece may be shorter than this many frames. */
  minPieceFrames: 8,
  /** The loudest point of any piece, in dB true peak. Above this blocks. */
  peakLimitDbtp: -1,
  /* How far one piece may sit from the middle piece before the sound "jumps".
     The spec says "matched" and gives no number; 3 dB is the default picked
     here: one sentence to the next from the same take moves about 1-2 dB on
     its own, so a tighter line would block good cuts. */
  loudnessToleranceDb: 3,
  /* Loudness of a piece under one second is not a steady number (the meter
     works in 0.4 s blocks), so short pieces are left out of the match. Their
     peaks are still checked. */
  loudnessMinSeconds: 1
});

/** blackdetect settings: d=0.03 is under one frame at 30 fps, so a single
    black frame is caught. Thresholds match merge-takes-media.mjs. */
export const BLACKDETECT = Object.freeze({ minSeconds: 0.03, picTh: 0.98, pixTh: 0.1 });

/* The piece encode: an intermediate, so it is nearly lossless and quick.
   The sound stays PCM inside a .mov, because AAC adds its own silence at the
   front of every piece and would break the sample-exact joins. */
const PIECE_VIDEO = Object.freeze(["-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p"]);
const PIECE_AUDIO = Object.freeze(["-c:a", "pcm_s16le", "-ar", String(AUDIO_RATE), "-ac", "2"]);

/** Every picture this file writes is tagged bt709, limited range. */
export const BT709_TAGS = Object.freeze([
  "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"
]);

/** The final video encode (spec §9.3 table). Exported so the overlay step
    (§9.4) re-encodes with the very same settings. */
export const FINAL_VIDEO = Object.freeze([
  "-c:v", "libx264", "-profile:v", "high", "-preset", "medium",
  "-crf", "18", "-maxrate", "12M", "-bufsize", "24M",
  "-pix_fmt", "yuv420p", ...BT709_TAGS,
  "-fps_mode", "cfr", "-r", String(FPS)
]);

/** The final sound: AAC 192k, 48 kHz, stereo. */
export const FINAL_AUDIO = Object.freeze(["-c:a", "aac", "-b:a", "192k", "-ar", String(AUDIO_RATE), "-ac", "2"]);

/* ─────────────────────────────────────────────────────────────────────────
   Ads only.
   ───────────────────────────────────────────────────────────────────────── */

export class NotAnAdError extends Error {
  /** @param {string} what  @param {unknown} kind */
  constructor(what, kind) {
    super(
      `${what}: this video is not an ad (video_kind ${kind === undefined ? "missing" : `'${String(kind)}'`}). ` +
      "Only ads are cut to 1080x1920 here. Every other video keeps 4K end to end."
    );
    this.name = "NotAnAdError";
    this.code = "not_an_ad";
  }
}

/** @param {unknown} kind @param {string} what */
export function assertAd(kind, what) {
  if (kind !== "ad") throw new NotAnAdError(what, kind);
}

/* ─────────────────────────────────────────────────────────────────────────
   Small pure helpers.
   ───────────────────────────────────────────────────────────────────────── */

/** @param {unknown} v @returns {number|null} A finite number, or null (never 0 for "unknown"). */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Seconds as ffmpeg reads them: six decimals, so a 1/30 s grid stays exact to the microsecond. */
const secs = (/** @type {number} */ x) => x.toFixed(6);

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** @param {string} p A path inside the concat list, quoted the way the concat demuxer reads it. */
const quoteConcat = (p) => `'${String(p).replace(/'/g, "'\\''")}'`;

/**
 * snapPiece({ start, end }) → { start, end, duration, frames, samples }
 *
 * Both edges move to the nearest 1/30 s, so the piece is a whole number of
 * frames: frames = round(30·D), and the sound is frames × 1600 samples.
 *
 * @param {{ start: number, end: number }} piece
 */
export function snapPiece({ start, end }) {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new Error("snapPiece: start and end must be numbers of seconds");
  const kStart = Math.max(0, Math.round(s * FPS));
  const kEnd = Math.round(e * FPS);
  const frames = kEnd - kStart;
  return {
    start: kStart / FPS,
    end: kEnd / FPS,
    duration: frames / FPS,
    frames,
    samples: frames * SAMPLES_PER_FRAME
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Prepare: probe, sound for Whisper, silences.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * ffprobe argv: the whole file as JSON (format + every stream).
 * @param {{ video_kind: unknown, src: string }} o
 */
export function probeArgs({ video_kind, src }) {
  assertAd(video_kind, "probeArgs");
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", src];
}

/**
 * @typedef {{ ok: boolean, width: number|null, height: number|null, rotation: number,
 *   fps: number|null, color_transfer: string|null, creation_time: string|null,
 *   duration: number|null, has_audio: boolean }} Probe
 */

/** "30000/1001" → 29.97; "0/0" → null. @param {unknown} rate */
function parseRate(rate) {
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(String(rate ?? "").trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? 1 : Number(m[2]);
  if (!(a > 0) || !(b > 0)) return null;
  return Math.round((a / b) * 1000) / 1000;
}

/** Any angle → (-180, 180]. @param {number} deg */
function normaliseAngle(deg) {
  let r = Math.round(deg) % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r;
}

/**
 * parseProbe(ffprobe JSON) → { ok, width, height, rotation, fps, color_transfer,
 *                              creation_time, duration, has_audio }
 *
 * width × height is the picture as it SHOWS: a phone stores a tall video as a
 * wide picture plus "turn this 90°" (side_data_list → Display Matrix), and
 * ffmpeg turns it while decoding, so at ±90° the two are swapped. An older
 * file that only carries tags.rotate (clockwise) is read the same way.
 * creation_time is the file's own clock (format tags first, then the video
 * stream's), as an ISO time; it is saved as recorded_at. Unknown is null.
 *
 * @param {unknown} json  ffprobe's stdout (string) or the parsed object
 * @returns {Probe}
 */
export function parseProbe(json) {
  /** @type {any} */
  let o = json;
  if (typeof json === "string") {
    try { o = JSON.parse(json); } catch { o = null; }
  }
  const streams = Array.isArray(o?.streams) ? o.streams : [];
  const v = streams.find((/** @type {any} */ s) => s?.codec_type === "video" && !s?.disposition?.attached_pic) || null;
  const has_audio = streams.some((/** @type {any} */ s) => s?.codec_type === "audio");

  let rotation = 0;
  const matrix = (Array.isArray(v?.side_data_list) ? v.side_data_list : [])
    .find((/** @type {any} */ d) => d && num(d.rotation) !== null);
  if (matrix) rotation = normaliseAngle(Number(matrix.rotation));
  else if (num(v?.tags?.rotate) !== null) rotation = normaliseAngle(-Number(v.tags.rotate));

  let width = num(v?.width);
  let height = num(v?.height);
  if (width !== null && height !== null && Math.abs(rotation) === 90) [width, height] = [height, width];

  const rawTime = o?.format?.tags?.creation_time ?? v?.tags?.creation_time ?? null;
  const when = rawTime ? new Date(String(rawTime)) : null;
  const creation_time = when && !Number.isNaN(when.getTime()) ? when.toISOString() : null;

  const duration = num(o?.format?.duration) ?? num(v?.duration);
  const color_transfer = typeof v?.color_transfer === "string" && v.color_transfer ? v.color_transfer : null;

  return {
    ok: Boolean(v) && duration !== null,
    width,
    height,
    rotation,
    fps: parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate),
    color_transfer,
    creation_time,
    duration,
    has_audio
  };
}

/** True when the take was filmed HDR (HLG or PQ) and needs the tonemap chain. @param {{ color_transfer?: string|null }|null|undefined} probe */
export function isHdr(probe) {
  return HDR_TRANSFERS.includes(String(probe?.color_transfer || ""));
}

/**
 * The take's sound for Whisper: mono, 16 kHz, Opus at 32 kbps, in .ogg.
 * About 0.24 MB a minute, far under Whisper's 25 MB cap.
 * @param {{ video_kind: unknown, src: string, out: string }} o
 */
export function audioExtractArgs({ video_kind, src, out }) {
  assertAd(video_kind, "audioExtractArgs");
  return [
    "-hide_banner", "-nostats", "-y", "-i", src,
    "-map", "0:a:0", "-vn",
    "-ac", "1", "-ar", "16000",
    "-c:a", "libopus", "-b:a", "32k",
    "-map_metadata", "-1",
    "-f", "ogg", out
  ];
}

/**
 * silencedetect over the take's sound (noise -35 dB, at least 0.12 s).
 * Read the result with parseSilence.
 * @param {{ video_kind: unknown, src: string }} o
 */
export function silenceArgs({ video_kind, src }) {
  assertAd(video_kind, "silenceArgs");
  return [
    "-hide_banner", "-nostats", "-i", src,
    "-map", "0:a:0", "-vn",
    "-af", `silencedetect=noise=${SILENCE.noiseDb}dB:d=${SILENCE.minSeconds}`,
    "-f", "null", "-"
  ];
}

/**
 * silencedetect lines → [{ start, end }] in seconds. A silence still open when
 * the file ends runs to `duration` (or stays open-ended at start + 3600).
 * @param {unknown} stderr @param {number|null} [duration]
 */
export function parseSilence(stderr, duration = null) {
  /** @type {{ start: number, end: number }[]} */
  const out = [];
  /** @type {number|null} */
  let open = null;
  for (const line of String(stderr || "").split("\n")) {
    const a = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (a) { open = Math.max(0, Number(a[1])); continue; }
    const b = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (b && open !== null) { out.push({ start: open, end: Number(b[1]) }); open = null; }
  }
  if (open !== null) {
    const d = num(duration);
    out.push({ start: open, end: d !== null ? d : open + 3600 });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
   Cut: one piece at a time.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * pieceArgs({ video_kind, src, out, start, end, probe, flip, gainDb }) → argv
 *
 * One piece of one take, re-encoded on its own:
 *   * input  -ss S -t D -i take, with S and D on the 1/30 s grid
 *   * video  [tonemap if HDR], scale=1080:1920:flags=lanczos, fps=30,
 *            [hflip], setsar=1, then exactly N = round(30·D) frames
 *            (x264 crf 12 veryfast, yuv420p, tagged bt709)
 *   * sound  48 kHz, [volume], trimmed then padded to exactly N × 1600
 *            samples, with 15 ms (720-sample) fades in and out, kept as PCM
 *   * no metadata is copied (an iPhone file carries where it was filmed)
 *   * written as .mov whatever `out` is called, because PCM sound needs it
 *
 * WHY THE N FRAMES ARE CAPPED WITH trim=end_frame=N AND NOT -frames:v N.
 * Spec §9.3 names -frames:v. Measured 2026-10-06 with ffmpeg 6.0 on 16
 * synthetic pieces (29.97 fps SDR and HLG takes): -frames:v N gave N frames
 * every time but stopped the whole file at the Nth frame, so every piece lost
 * 192-848 sound samples (up to 18 ms) and the joins would drift. With the cap
 * inside the filter chain instead, all 14 in-range pieces came out at exactly
 * N frames AND exactly N × 1600 samples. Same frame count, sound left whole.
 *
 * `probe` is parseProbe's result for the take. It refuses a take whose size is
 * unknown, a take with no sound, a wide take (scaling a wide picture to
 * 1080x1920 would squash it; best-of-clips law: never squeeze takes), and a
 * piece that runs past the take's end by more than half a frame (it would come
 * out with missing frames and made-up silence; measured, not guessed).
 *
 * `gainDb` is optional (cutChecks says how much a piece is off); it is held to
 * ±12 dB and left out of the argv when it is 0 or missing.
 *
 * @param {{ video_kind: unknown, src: string, out: string, start: number, end: number,
 *   probe: Probe, flip?: boolean, gainDb?: number|null }} o
 */
export function pieceArgs({ video_kind, src, out, start, end, probe, flip = false, gainDb = null }) {
  assertAd(video_kind, "pieceArgs");
  const p = snapPiece({ start, end });
  if (p.frames < 1) throw new Error(`pieceArgs: the piece ${secs(Number(start))}-${secs(Number(end))} s is shorter than one frame`);
  if (!probe || probe.width === null || probe.height === null || !(probe.width > 0) || !(probe.height > 0)) {
    throw new Error("pieceArgs: the take's picture size is unknown; probe the take first");
  }
  if (probe.has_audio === false) throw new Error("pieceArgs: this take has no sound");
  const aspect = probe.width / probe.height;
  const tall = WIDTH / HEIGHT;
  if (Math.abs(aspect - tall) / tall > 0.01) {
    throw new Error(
      `pieceArgs: this take shows as ${probe.width}x${probe.height}, not tall 9:16. ` +
      "Cutting it to 1080x1920 would squash the picture, so it is refused."
    );
  }

  if (probe.duration !== null && p.end > probe.duration + 1 / (2 * FPS)) {
    throw new Error(
      `pieceArgs: the piece ends at ${secs(p.end)} s but the take ends at ${secs(probe.duration)} s. ` +
      "It would need missing frames and made-up silence, so it is refused."
    );
  }

  const vf = [
    ...(isHdr(probe) ? [TONEMAP_CHAIN] : []),
    `scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
    `fps=${FPS}`,
    ...(flip === true ? ["hflip"] : []),
    "setsar=1",
    `trim=end_frame=${p.frames}`
  ].join(",");

  const gain = num(gainDb);
  const g = gain === null ? 0 : Math.round(clamp(gain, -12, 12) * 100) / 100;
  const af = [
    `aresample=${AUDIO_RATE}`,
    ...(g !== 0 ? [`volume=${g.toFixed(2)}dB`] : []),
    `atrim=end_sample=${p.samples}`,
    `apad=whole_len=${p.samples}`,
    `afade=t=in:ss=0:ns=${FADE_SAMPLES}`,
    `afade=t=out:ss=${p.samples - FADE_SAMPLES}:ns=${FADE_SAMPLES}`
  ].join(",");

  return [
    "-hide_banner", "-nostats", "-y",
    "-ss", secs(p.start), "-t", secs(p.duration), "-i", src,
    "-map", "0:v:0", "-map", "0:a:0",
    "-vf", vf,
    "-af", af,
    ...PIECE_VIDEO, ...BT709_TAGS,
    ...PIECE_AUDIO,
    "-map_metadata", "-1",
    "-f", "mov", out
  ];
}

/**
 * blackdetect over a piece (or the joined master). Read with parseBlackdetect.
 * The picture is shrunk first so the check is quick.
 * @param {{ video_kind: unknown, src: string }} o
 */
export function blackdetectArgs({ video_kind, src }) {
  assertAd(video_kind, "blackdetectArgs");
  return [
    "-hide_banner", "-nostats", "-i", src,
    "-map", "0:v:0", "-an",
    "-vf", `scale=320:-2,blackdetect=d=${BLACKDETECT.minSeconds}:pic_th=${BLACKDETECT.picTh}:pix_th=${BLACKDETECT.pixTh.toFixed(2)}`,
    "-f", "null", "-"
  ];
}

/** blackdetect lines → [{ start, end }] in seconds. @param {unknown} stderr */
export function parseBlackdetect(stderr) {
  /** @type {{ start: number, end: number }[]} */
  const out = [];
  for (const m of String(stderr || "").matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) {
    out.push({ start: Number(m[1]), end: Number(m[2]) });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
   Loudness: pass 1 measures, pass 2 (inside finalArgs) applies.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Loudness pass 1: measure only, nothing is written. Run it on each piece
 * (for cutChecks) and on the joined master (for finalArgs).
 * @param {{ video_kind: unknown, src: string }} o
 */
export function loudnormPass1Args({ video_kind, src }) {
  assertAd(video_kind, "loudnormPass1Args");
  return [
    "-hide_banner", "-nostats", "-i", src,
    "-map", "0:a:0", "-vn",
    "-af", `loudnorm=I=${LOUDNORM.I}:TP=${LOUDNORM.TP}:LRA=${LOUDNORM.LRA}:print_format=json`,
    "-f", "null", "-"
  ];
}

/**
 * @typedef {{ ok: boolean, input_i: number|null, input_tp: number|null, input_lra: number|null,
 *   input_thresh: number|null, target_offset: number|null, output_i: number|null,
 *   output_tp: number|null, normalization_type: string|null }} Loudness
 */

/**
 * loudnorm's JSON block (pass 1, or pass 2's print-out) → numbers.
 * "-inf" (a silent file) reads as null, never 0. ok is true only when all
 * five numbers pass 2 needs are there.
 *
 * @param {unknown} stderr  ffmpeg's stderr, or the block already parsed
 * @returns {Loudness}
 */
export function parseLoudnorm(stderr) {
  /** @type {any} */
  let j = null;
  if (stderr && typeof stderr === "object") {
    j = stderr;
  } else {
    const s = String(stderr || "");
    const at = s.lastIndexOf("\"input_i\"");
    if (at >= 0) {
      const open = s.lastIndexOf("{", at);
      const close = s.indexOf("}", at);
      try { j = JSON.parse(s.slice(open, close + 1)); } catch { j = null; }
    }
  }
  const out = {
    input_i: num(j?.input_i),
    input_tp: num(j?.input_tp),
    input_lra: num(j?.input_lra),
    input_thresh: num(j?.input_thresh),
    target_offset: num(j?.target_offset),
    output_i: num(j?.output_i),
    output_tp: num(j?.output_tp),
    normalization_type: typeof j?.normalization_type === "string" ? j.normalization_type : null
  };
  const ok = [out.input_i, out.input_tp, out.input_lra, out.input_thresh, out.target_offset].every((x) => x !== null);
  return { ok, ...out };
}

/**
 * Loudness pass 2, as the `-af` pair that finalArgs puts in its one encode:
 * loudnorm I=-14:TP=-1.5:LRA=11 fed pass 1's numbers with linear=true, then
 * aresample=48000 (loudnorm works at 192 kHz inside). Refuses when pass 1 has
 * no numbers (a silent master).
 *
 * @param {{ video_kind: unknown, loudness: Loudness|null|undefined }} o
 */
export function loudnormPass2Args({ video_kind, loudness }) {
  assertAd(video_kind, "loudnormPass2Args");
  if (!loudness || !loudness.ok) {
    throw new Error("loudnormPass2Args: the sound could not be measured in pass 1, so it cannot be levelled");
  }
  const f = (/** @type {number|null} */ x, /** @type {number} */ lo, /** @type {number} */ hi) => clamp(Number(x), lo, hi).toFixed(2);
  return [
    "-af",
    `loudnorm=I=${LOUDNORM.I}:TP=${LOUDNORM.TP}:LRA=${LOUDNORM.LRA}` +
      `:measured_I=${f(loudness.input_i, -99, 0)}` +
      `:measured_TP=${f(loudness.input_tp, -99, 99)}` +
      `:measured_LRA=${f(loudness.input_lra, 0, 99)}` +
      `:measured_thresh=${f(loudness.input_thresh, -99, 0)}` +
      `:offset=${f(loudness.target_offset, -99, 99)}` +
      `:linear=true:print_format=json,aresample=${AUDIO_RATE}`
  ];
}

/* ─────────────────────────────────────────────────────────────────────────
   Join, then encode once.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * The concat demuxer's list: one `file '<path>'` line per piece, in order.
 * @param {string[]} paths
 */
export function concatList(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error("concatList: there are no pieces to join");
  return paths.map((p) => `file ${quoteConcat(p)}`).join("\n") + "\n";
}

/**
 * Join the pieces with no re-encode (every piece already has the same
 * settings and an exact length), into one .mov.
 * @param {{ video_kind: unknown, list: string, out: string }} o
 */
export function concatArgs({ video_kind, list, out }) {
  assertAd(video_kind, "concatArgs");
  return [
    "-hide_banner", "-nostats", "-y",
    "-f", "concat", "-safe", "0", "-i", list,
    "-map", "0:v:0", "-map", "0:a:0",
    "-c", "copy",
    "-f", "mov", out
  ];
}

/**
 * The one final encode of the master: loudness pass 2 on the sound, then
 * H.264 High crf 18 (maxrate 12M, bufsize 24M), yuv420p tagged bt709,
 * constant 30 fps, AAC 192k 48 kHz stereo, +faststart. About 60 MB a minute.
 *
 * @param {{ video_kind: unknown, src: string, out: string, loudness: Loudness }} o
 */
export function finalArgs({ video_kind, src, out, loudness }) {
  assertAd(video_kind, "finalArgs");
  return [
    "-hide_banner", "-nostats", "-y", "-i", src,
    "-map", "0:v:0", "-map", "0:a:0",
    ...loudnormPass2Args({ video_kind, loudness }),
    ...FINAL_VIDEO,
    ...FINAL_AUDIO,
    "-map_metadata", "-1",
    "-movflags", "+faststart",
    "-f", "mp4", out
  ];
}

/* ─────────────────────────────────────────────────────────────────────────
   The cut checks. Any failure blocks the master.
   ───────────────────────────────────────────────────────────────────────── */

/** @param {unknown} entry  a loudness entry: a number (LUFS) or parseLoudnorm's result */
const loudOf = (entry) => (entry && typeof entry === "object" ? num(/** @type {any} */ (entry).input_i) : num(entry));
/** @param {unknown} entry */
const peakOf = (entry) => (entry && typeof entry === "object" ? num(/** @type {any} */ (entry).input_tp) : null);

/** @param {number[]} xs */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const fmt1 = (/** @type {number} */ x) => (Math.round(x * 10) / 10).toFixed(1);
const fmt2 = (/** @type {number} */ x) => x.toFixed(2);

/**
 * cutChecks({ video_kind, pieces, loudness, peaks, blackdetect }) → { ok, reasons, gain_db }
 *
 *   pieces       [{ start, end, take_id?, line_idx? }] — the aligner's pieces,
 *                in master order (each is snapped to 1/30 s here, as pieceArgs does)
 *   loudness     one entry per piece: parseLoudnorm(pass 1 on that piece), or a
 *                plain integrated loudness number; null when not measured
 *   peaks        optional, one true peak (dBTP) per piece; when missing, the
 *                piece's loudness entry's input_tp is used
 *   blackdetect  parseBlackdetect hits: one list per piece ([[...], [...]]), or
 *                one list for the joined master (times on the master's clock)
 *
 * Blocks, each with one plain reason:
 *   * a piece shorter than 8 frames
 *   * a piece more than 3 dB louder or quieter than the middle piece
 *     (pieces of a second or more; shorter ones cannot be measured steadily)
 *   * a piece whose true peak is above -1 dBTP
 *   * any black picture at all
 *   * a video that is not an ad
 *
 * gain_db[i] is how many dB would bring piece i to the middle loudness (0 when
 * it was not measured). pieceArgs takes it as gainDb to rebuild a piece.
 *
 * @param {{ video_kind: unknown, pieces: { start: number, end: number }[],
 *   loudness?: unknown[], peaks?: (number|null)[], blackdetect?: unknown[],
 *   opts?: Partial<typeof CUT_CHECKS> }} o
 */
export function cutChecks({ video_kind, pieces, loudness = [], peaks = [], blackdetect = [], opts = {} }) {
  const o = { ...CUT_CHECKS, ...opts };
  if (video_kind !== "ad") {
    return { ok: false, reasons: [new NotAnAdError("cutChecks", video_kind).message], gain_db: [] };
  }
  if (!Array.isArray(pieces) || !pieces.length) {
    return { ok: false, reasons: ["There are no pieces to join."], gain_db: [] };
  }

  /** @type {string[]} */
  const reasons = [];
  const snapped = pieces.map((p) => snapPiece(p));
  const label = (/** @type {number} */ i) => `Piece ${i + 1}`;

  // 1. Length.
  snapped.forEach((p, i) => {
    if (p.frames < o.minPieceFrames) {
      reasons.push(
        `${label(i)} is too short: ${Math.max(0, p.frames)} frames (${fmt2(Math.max(0, p.duration))} s). ` +
        `Each piece needs at least ${o.minPieceFrames} frames.`
      );
    }
  });

  // 2. Loudness matched across pieces.
  const levels = snapped.map((p, i) => (p.duration >= o.loudnessMinSeconds ? loudOf(loudness[i]) : null));
  const measured = /** @type {number[]} */ (levels.filter((x) => x !== null));
  const middle = measured.length ? median(measured) : null;
  const gain_db = levels.map((l) => (l === null || middle === null ? 0 : Math.round((middle - l) * 10) / 10));
  if (middle !== null && measured.length >= 2) {
    levels.forEach((l, i) => {
      if (l === null) return;
      const off = l - middle;
      if (Math.abs(off) > o.loudnessToleranceDb) {
        reasons.push(
          `${label(i)} is ${fmt1(Math.abs(off))} dB ${off > 0 ? "louder" : "quieter"} than the other pieces. ` +
          "The sound would jump at the join."
        );
      }
    });
  }

  // 3. Peaks at -1 dBTP or lower.
  snapped.forEach((_, i) => {
    const pk = num(peaks[i]) ?? peakOf(loudness[i]);
    if (pk !== null && pk > o.peakLimitDbtp) {
      reasons.push(`${label(i)} peaks at ${fmt1(pk)} dB. The loudest point must stay at ${o.peakLimitDbtp} dB or lower.`);
    }
  });

  // 4. No black picture anywhere.
  const perPiece = blackdetect.some((x) => Array.isArray(x));
  if (perPiece) {
    blackdetect.forEach((hits, i) => {
      for (const h of Array.isArray(hits) ? hits : []) {
        reasons.push(`${label(i)} goes black at ${fmt2(Number(h.start))}-${fmt2(Number(h.end))} s of that piece.`);
      }
    });
  } else {
    const edges = [];
    let t = 0;
    for (const p of snapped) { edges.push(t); t += Math.max(0, p.duration); }
    for (const h of /** @type {any[]} */ (blackdetect)) {
      const at = Number(h?.start);
      let idx = 0;
      for (let i = 0; i < edges.length; i++) if (at >= edges[i] - 1e-9) idx = i;
      reasons.push(`The picture goes black at ${fmt2(at)}-${fmt2(Number(h?.end))} s of the master (${label(idx).toLowerCase()}).`);
    }
  }

  return { ok: reasons.length === 0, reasons, gain_db };
}
