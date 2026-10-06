// @ts-check
// src/ad-videos/animations.mjs — where each animation lands on the finished
// ad, and the ffmpeg argument lists that lay it on and finish the file.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHERE THE RULES COME FROM
//
//   docs/specs/marketing-machine-2026-10-04.md §9.4 (every limit below), §9.1
//   step 11 (render, overlay, finalize), §9.3 (the overlay re-encodes the
//   video once with the master's settings and copies the sound), and owner
//   decision §2 item 9: the order NEVER changes —
//
//       cut → Submagic captions → OUR animation overlays → finalize
//
//   The master Submagic sees never has an animation in it. Animations go over
//   Submagic's captioned export, last.
// ═══════════════════════════════════════════════════════════════════════════
//
// PURE. No database, no network, no files, no clock, no ffmpeg, no Remotion.
// Every input is an argument; every builder returns an argv list (WITHOUT the
// program name) for the video worker (spec §9.5) to run. Proved by
// src/ad-videos/animations.test.mjs.
//
// NOT WIRED IN (2026-10-06). Nothing live imports this file. The live
// pipeline still places B-roll INSIDE Submagic before its export
// (src/ad-videos/broll.mjs, called from pipeline.mjs placeBrollAndExport) —
// that is the OLD order. When the worker's render_and_overlay job goes live
// with this file, that Submagic placement must be switched off in the same
// change, or the animations land twice.
//
// THE PARTS
//
//   planAnimations()   the writer's animation_plan rows → clips with exact
//                      start and end times on the Submagic export, plus the
//                      ones skipped and why. Anchors come from the cut plan
//                      (src/ad-videos/align.mjs alignTakes, U16), re-mapped
//                      through Submagic's words when the export's length moved.
//   cacheKey()         sha256(template + canonical props): a clip whose
//                      template and props did not change is never rendered
//                      again (spec §9.1 step 11.1, §9.6).
//   overlayArgs()      lays every clip over the Submagic export in ONE video
//                      encode (the master's settings from ffmpeg-plan.mjs,
//                      U17) and copies the sound as it is.
//   finalizeArgs()     fixes the loudness only when it is more than 1 LU off
//                      (Submagic's cleanAudio moves it) and remuxes with
//                      +faststart. The picture is copied, never encoded again.
//   finalizeChecks()   the finished file is 1080x1920, within 0.3 s of the
//                      master, at -14 LUFS (±1), and starts fast.
//
// TWO MODES (spec §9.4, setting animation_mode)
//
//   fullframe  today's renders are opaque, so a clip covers the whole frame,
//              captions included, for its 2–3 s. Limits: nothing in the first
//              3 s or on the CTA line, at least 4 s of Chris's face between
//              clips, at most 3 s a clip (ProofWall 4 s, ProofFlood 6 s), at
//              most 35% of the runtime.
//   overlay    once see-through renders ship (a `transparent` prop, no
//              background, no grid; ProRes 4444 .mov or VP9 .webm with alpha).
//              The clip draws only inside the kit's text-safe band (y 269 to
//              1248, ops/workflows/broll-v2-2026-10-02.md line 36), so the
//              captions must sit outside that band: caption_position_y.

import { createHash } from "node:crypto";
import { ALIGN_DEFAULTS, linesFromParts, resolveAnchor, spokenWords, wordsMatch } from "./align.mjs";
import {
  FPS, WIDTH, HEIGHT, LOUDNORM, FINAL_VIDEO, FINAL_AUDIO,
  assertAd, snapPiece, loudnormPass2Args, parseProbe
} from "./ffmpeg-plan.mjs";
import { validateAnimationPlan } from "../marketing/animation-plan.mjs";

/* ─────────────────────────────────────────────────────────────────────────
   The numbers. The first block is spec §9.4 / §9.1 step 11 word for word.
   The second block is not in the spec: each is a safe default, named here so
   nobody has to ask (written in the U30 report).
   ───────────────────────────────────────────────────────────────────────── */
export const ANIMATION_DEFAULTS = Object.freeze({
  /* §9.4 full-frame limits */
  noClipsBefore: 3,         // no clip in the first 3 s
  minFaceBetween: 4,        // at least 4 s of Chris's face between two clips
  maxClipSeconds: 3,        // at most 3 s a clip (ProofWall 4 s, ProofFlood 6 s: FULLFRAME_LONGER)
  maxShare: 0.35,           // all clips together: at most 35% of the runtime
  /* §9.4 timing */
  remapOver: 0.1,           // the export runs more than 0.1 s off the master → re-map via Submagic's words
  /* §9.1 step 11.3 finalize */
  durationTolerance: 0.3,   // the finished file runs within 0.3 s of the master
  loudnessTolerance: 1,     // re-fix the loudness when it is more than 1 LU off -14 LUFS

  /* Safe defaults (not in the spec). */
  minAlignedShare: 0.5,     // a re-map needs at least half the cut's words found in Submagic's words
  captionBandPct: 15        // a bare caption_position_y covers 15% of the frame height from that line down
});

/** The longer full-frame caps the spec names, by template family (prefix). */
export const FULLFRAME_LONGER = Object.freeze({ ProofWall: 4, ProofFlood: 6 });

/** Where a see-through clip may draw: the kit's text-safe band
    (no text in the top 14%, y 0–269, or the bottom 35%, y 1248–1920). */
export const OVERLAY_DRAW_ZONE = Object.freeze({ top: 269, bottom: 1248 });

export const MODES = Object.freeze(["fullframe", "overlay"]);
export const STYLES = Object.freeze(["words", "bullets"]);

/** The Submagic word types that are not spoken words. */
const NOT_WORDS = new Set(["silence", "punctuation", "pause", "gap"]);

const EPS = 1e-6;

/* ─────────────────────────────────────────────────────────────────────────
   Small pure helpers.
   ───────────────────────────────────────────────────────────────────────── */

/** @param {unknown} v @returns {number|null} A finite number, or null (never 0 for "unknown"). */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const round3 = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
/** Seconds as ffmpeg reads them: six decimals. */
const secs = (/** @type {number} */ x) => x.toFixed(6);
const say1 = (/** @type {number} */ x) => (Math.round(x * 10) / 10).toFixed(1);
const say2 = (/** @type {number} */ x) => (Math.round(x * 100) / 100).toFixed(2);

/** @param {unknown} v */
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * canonicalJson(value) → one string for one value: object keys sorted at
 * every depth, arrays kept in order, undefined keys dropped (as JSON does).
 * Two props objects that mean the same render give the same string.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === undefined || typeof value === "function") return "null";
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalJson(v === undefined ? null : v)).join(",") + "]";
  if (isPlainObject(value)) {
    const o = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(o).filter((k) => o[k] !== undefined && typeof o[k] !== "function").sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
  }
  const s = JSON.stringify(value);
  return s === undefined ? "null" : s;
}

/**
 * cacheKey(template, props) → sha256 hex of template + canonical props
 * (spec §9.1 step 11.1: "cached in R2 by a hash of template + props").
 * The props are the ones the render receives, so they hold the clip's length
 * (durationInFrames) and, in overlay mode, transparent: true — a 2 s and a
 * 3 s render, or an opaque and a see-through one, never share a key.
 * @param {string} template @param {unknown} props
 */
export function cacheKey(template, props) {
  return createHash("sha256").update(String(template) + canonicalJson(props ?? {})).digest("hex");
}

/** The full-frame cap for a template, in seconds. @param {string} id */
export function fullframeMaxSeconds(id, o = ANIMATION_DEFAULTS) {
  for (const [prefix, s] of Object.entries(FULLFRAME_LONGER)) if (String(id).startsWith(prefix)) return s;
  return o.maxClipSeconds;
}

/**
 * captionZoneFrom(captionZone) → {top, bottom} in pixels of the 1080x1920
 * frame, or null when it is not set.
 *
 *   {top, bottom}  pixels, measured from a test export (spec §8.3 settings:
 *                  "caption_position_y: null; set from a test export")
 *   a number       caption_position_y as Submagic takes it (0–80): the
 *                  captions' top edge, in percent of the frame height. They
 *                  are taken to cover captionBandPct (15%) below that.
 *   null           not set
 *
 * @param {unknown} captionZone
 * @returns {{top: number, bottom: number}|null}
 */
export function captionZoneFrom(captionZone, o = ANIMATION_DEFAULTS) {
  if (captionZone === null || captionZone === undefined || captionZone === "") return null;
  if (typeof captionZone === "number" || typeof captionZone === "string") {
    const y = num(captionZone);
    if (y === null || y < 0 || y > 100) return null;
    return { top: Math.round((y / 100) * HEIGHT), bottom: Math.round(((y + o.captionBandPct) / 100) * HEIGHT) };
  }
  if (isPlainObject(captionZone)) {
    const z = /** @type {any} */ (captionZone);
    const fromY = num(z.caption_position_y ?? z.position_y);
    if (fromY !== null && num(z.top) === null) return captionZoneFrom(fromY, o);
    const top = num(z.top), bottom = num(z.bottom);
    if (top === null || bottom === null || bottom <= top) return null;
    return { top, bottom };
  }
  return null;
}

/** True when the captions sit wholly outside the band the overlays draw in. @param {{top: number, bottom: number}} zone */
export function captionsClear(zone) {
  return zone.bottom <= OVERLAY_DRAW_ZONE.top || zone.top >= OVERLAY_DRAW_ZONE.bottom;
}

/* ─────────────────────────────────────────────────────────────────────────
   The master's clock. The cut plan's out times are the aligner's; the master
   is built from pieces snapped to the 1/30 s grid (ffmpeg-plan.mjs
   snapPiece), so every time here is read on the snapped pieces — the master
   that was actually encoded, not the plan before snapping.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {{w: string, start: number, end: number, line_idx: number}} MasterWord
 * @typedef {{plan: any, words: MasterWord[], duration: number}} Master
 */

/** @param {any} cutPlan @returns {Master} */
function masterTimeline(cutPlan) {
  let out = 0;
  /** @type {any[]} */
  const pieces = [];
  /** @type {MasterWord[]} */
  const words = [];
  for (const p of cutPlan.pieces) {
    const s = snapPiece({ start: Number(p.start), end: Number(p.end) });
    const dur = Math.max(0, s.duration);
    const piece = { ...p, start: s.start, end: s.end, out_start: out, out_end: out + dur };
    pieces.push(piece);
    for (const w of Array.isArray(p.words) ? p.words : []) {
      const a = Math.min(dur, Math.max(0, Number(w.start) - s.start));
      const b = Math.min(dur, Math.max(a, Number(w.end) - s.start));
      words.push({ w: String(w.w ?? ""), start: out + a, end: out + b, line_idx: Number(w.line_idx) });
    }
    out += dur;
  }
  /* Bullets cue starts, re-read on the snapped pieces. */
  const cues = (Array.isArray(cutPlan.cues) ? cutPlan.cues : []).map((/** @type {any} */ c) => {
    if (c?.start === null || c?.start === undefined) return { ...c };
    const at = Number(c.start);
    const piece = pieces.find((p) => p.take_id === c.take_id &&
      (p.words || []).some((/** @type {any} */ w) => Math.abs(Number(w.start) - at) <= EPS && Number(w.line_idx) === Number(c.line_idx)));
    return { ...c, out_start: piece ? round3(piece.out_start + Math.max(0, at - piece.start)) : null };
  });
  return { plan: { ...cutPlan, pieces, cues }, words, duration: out };
}

/** The script's lines: the cut plan's own, else rebuilt from parts. @param {any} cutPlan @param {any[]} parts @param {string} style */
function scriptLines(cutPlan, parts, style) {
  if (Array.isArray(cutPlan.lines) && cutPlan.lines.length && cutPlan.lines.every((/** @type {any} */ l) => typeof l?.text === "string")) {
    return cutPlan.lines;
  }
  return linesFromParts(parts, style).map((l) => ({ line_idx: l.line_idx, kind: l.kind, text: l.text, state: null }));
}

/**
 * A words-style anchor that was not heard word for word: the script line its
 * phrase starts in. Returns the line index or null.
 * @param {any[]} lines @param {string} phrase
 */
function lineOfPhrase(lines, phrase) {
  const keys = spokenWords(String(phrase).split(/\s+/)).filter((t) => !t.opt).map((t) => t.t);
  if (!keys.length) return null;
  /** @type {{t: string, line_idx: number}[]} */
  const flat = [];
  for (const l of lines) {
    for (const t of spokenWords(String(l.text).split(/\s+/))) if (!t.opt) flat.push({ t: t.t, line_idx: Number(l.line_idx) });
  }
  for (let x = 0; x + keys.length <= flat.length; x++) {
    if (keys.every((k, y) => wordsMatch(k, flat[x + y].t, ALIGN_DEFAULTS) > 0)) return flat[x].line_idx;
  }
  return null;
}

/**
 * Where an anchor lands on the master: {time, line_idx, fallback} or {reason}.
 * @param {Master} master @param {any[]} lines @param {any} anchor @param {string} style
 */
function anchorOnMaster(master, lines, anchor, style) {
  const r = resolveAnchor(master.plan, anchor);
  if (r.found && r.time !== null) return { time: Number(r.time), line_idx: r.line_idx, fallback: Boolean(r.fallback), reason: null };
  if (style === "bullets") {
    return { time: null, line_idx: r.line_idx, fallback: false, reason: r.reason === "no such cue" ? "its cue is not in the script" : "its cue was cut" };
  }
  /* Words style: the phrase was not heard word for word. If its line is in
     the cut (said differently), the clip lands on that line's start and is
     flagged as a fallback; if the line was cut, the clip is skipped (§9.4). */
  const phrase = typeof anchor === "string" ? anchor : anchor?.phrase ?? "";
  const li = lineOfPhrase(lines, phrase);
  if (li === null) return { time: null, line_idx: null, fallback: false, reason: "its phrase is not in the script" };
  const line = lines.find((l) => Number(l.line_idx) === li);
  const first = master.words.find((w) => w.line_idx === li);
  if (!first || line?.state === "missing") return { time: null, line_idx: li, fallback: false, reason: "its line was cut" };
  return { time: first.start, line_idx: li, fallback: true, reason: null };
}

/* ─────────────────────────────────────────────────────────────────────────
   Re-mapping through Submagic's words. Submagic is told to leave the timing
   alone (no removeSilencePace, removeBadTakes off), so normally the export
   runs the master's length and the master's clock is the export's clock.
   When the export runs more than 0.1 s off, the master's words are lined up
   against Submagic's (longest common run of spoken words, the aligner's own
   word match) and every time is read through those pairs.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Submagic words[] → [{text, start, end}], spoken words only. Accepts
 * text/word and startTime/start (the provider's shape is not pinned), drops
 * silences and punctuation, and drops a word with no usable time rather than
 * placing it at zero.
 * @param {unknown} words
 */
export function submagicSpoken(words) {
  /** @type {{text: string, start: number, end: number}[]} */
  const out = [];
  for (const w of Array.isArray(words) ? words : []) {
    if (!w || typeof w !== "object") continue;
    const type = typeof w.type === "string" ? w.type.toLowerCase() : "word";
    if (NOT_WORDS.has(type)) continue;
    const text = String(w.text ?? w.word ?? "").trim();
    const start = num(w.startTime ?? w.start);
    const end = num(w.endTime ?? w.end);
    if (!text || start === null) continue;
    out.push({ text, start, end: end === null || end < start ? start : end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * remap(masterWords, submagicWords) → {ok, map, aligned, total, reason}
 * map(t) turns a master time into an export time: exact on a paired word,
 * straight-line between two pairs, and shifted like the nearest pair outside
 * them.
 * @param {MasterWord[]} masterWords @param {unknown} submagicWords
 */
export function remapThroughWords(masterWords, submagicWords, o = ANIMATION_DEFAULTS) {
  const A = spokenWords(masterWords.map((w) => w.w)).filter((t) => !t.opt).map((t) => ({ t: t.t, time: masterWords[t.src].start }));
  const sm = submagicSpoken(submagicWords);
  const B = spokenWords(sm.map((w) => w.text)).filter((t) => !t.opt).map((t) => ({ t: t.t, time: sm[t.src].start }));
  const fail = (/** @type {string} */ reason, aligned = 0) => ({ ok: false, map: (/** @type {number} */ t) => t, aligned, total: A.length, reason });
  if (!A.length) return fail("the cut has no words to line up");
  if (!B.length) return fail("Submagic sent no words to line them up with");

  /* Longest common run, as a table of lengths. */
  const n = A.length, m = B.length, W = m + 1;
  const L = new Int32Array((n + 1) * W);
  const cache = new Map();
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = wordsMatch(A[i].t, B[j].t, ALIGN_DEFAULTS, cache) > 0
        ? L[(i + 1) * W + j + 1] + 1
        : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  /** @type {{m: number, e: number}[]} */
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (wordsMatch(A[i].t, B[j].t, ALIGN_DEFAULTS, cache) > 0 && L[i * W + j] === L[(i + 1) * W + j + 1] + 1) {
      const last = pairs[pairs.length - 1];
      if (!last || (A[i].time > last.m + EPS && B[j].time > last.e + EPS)) pairs.push({ m: A[i].time, e: B[j].time });
      i++; j++;
    } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++;
    else j++;
  }
  const aligned = L[0];
  if (aligned / n < o.minAlignedShare - EPS || !pairs.length) {
    return fail(`only ${aligned} of the cut's ${n} words were found in Submagic's words`, aligned);
  }
  const map = (/** @type {number} */ t) => {
    if (t <= pairs[0].m) return t + (pairs[0].e - pairs[0].m);
    const z = pairs[pairs.length - 1];
    if (t >= z.m) return t + (z.e - z.m);
    let lo = 0, hi = pairs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pairs[mid].m <= t) lo = mid; else hi = mid;
    }
    const a = pairs[lo], b = pairs[hi];
    return a.e + ((t - a.m) * (b.e - a.e)) / (b.m - a.m);
  };
  return { ok: true, map, aligned, total: n, reason: null };
}

/* ─────────────────────────────────────────────────────────────────────────
   The planner.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {{index: number, template: string, props: Record<string, unknown>, start: number, end: number,
 *   start_frame: number, frames: number, seconds: number, cache_key: string, anchor: unknown,
 *   anchor_time: number, line_idx: number|null, fallback: boolean}} PlannedClip
 * @typedef {{index: number|null, anchor: unknown, template: string|null, code: string, reason: string}} SkippedClip
 */

/**
 * planAnimations({cutPlan, animationPlan, catalog, parts, style, submagicWords,
 *                 exportDuration, captionZone, mode}) → {items, skipped}
 *
 * cutPlan         ad_videos.cut_plan: alignTakes()'s answer (src/ad-videos/align.mjs)
 * animationPlan   the writer's rows [{anchor, template, props, seconds}] (spec §7.6)
 * catalog         marketing/broll/catalog.json
 * parts, style    the script (ad_scripts.parts) and 'words' | 'bullets'
 * submagicWords   Submagic's words[] for the export (needed only when the
 *                 export runs more than 0.1 s off the master)
 * exportDuration  the Submagic export's length in seconds (probe it)
 * captionZone     where the captions sit (see captionZoneFrom); overlay mode only
 * mode            'fullframe' | 'overlay' (setting animation_mode)
 *
 * items    [{index, template, props, start, end, start_frame, frames, seconds,
 *            cache_key, anchor, anchor_time, line_idx, fallback}] in play order.
 *          props are the render's props: the writer's, plus durationInFrames,
 *          plus transparent: true in overlay mode. start / end are seconds on
 *          the export, on the 1/30 s frame grid (start_frame, frames exact).
 *          fallback: the anchor's words were not heard as written, so the clip
 *          lands on the start of its line (words) or its cue (bullets).
 * skipped  [{index, anchor, template, code, reason}], reason in plain words.
 *
 * Refuses (throws) only when the inputs cannot be planned at all: no cut, no
 * catalog, an unknown mode or style, or an export length that is unknown.
 */
export function planAnimations({
  cutPlan, animationPlan, catalog, parts, style, submagicWords = null,
  exportDuration, captionZone = null, mode, opts = {}
} = /** @type {any} */ ({})) {
  const o = { ...ANIMATION_DEFAULTS, ...opts };
  if (!MODES.includes(mode)) throw new Error(`planAnimations: the animation mode must be fullframe or overlay, not ${JSON.stringify(mode ?? null)}`);
  if (!STYLES.includes(style)) throw new Error(`planAnimations: the script style must be words or bullets, not ${JSON.stringify(style ?? null)}`);
  if (!cutPlan || !Array.isArray(cutPlan.pieces) || !cutPlan.pieces.length) throw new Error("planAnimations: there is no cut plan, so there is nothing to lay animations on");
  if (!Array.isArray(catalog) || !catalog.length) throw new Error("planAnimations: the animation catalog is missing");
  if (!Array.isArray(parts)) throw new Error("planAnimations: the script's parts are missing");
  const exportLen = num(exportDuration);
  if (exportLen === null || exportLen <= 0) throw new Error("planAnimations: the Submagic export's length is unknown; probe the export first");
  const plan = Array.isArray(animationPlan) ? animationPlan : [];

  /** @type {PlannedClip[]} */
  const items = [];
  /** @type {SkippedClip[]} */
  const skipped = [];
  const skip = (/** @type {number|null} */ index, /** @type {any} */ row, /** @type {string} */ code, /** @type {string} */ reason) =>
    skipped.push({
      index,
      anchor: row && typeof row === "object" ? row.anchor ?? null : null,
      template: row && typeof row.template === "string" ? row.template : null,
      code, reason
    });
  const done = () => {
    items.sort((a, b) => a.start_frame - b.start_frame || a.index - b.index);
    skipped.sort((a, b) => (a.index ?? -1) - (b.index ?? -1));
    return { items, skipped };
  };

  /* 1. Each row against the catalog: the very checks the writer had to pass
        (src/marketing/animation-plan.mjs), re-run because the catalog or the
        script may have moved since. Plan-level notes (too few, the format)
        are the writer's business, not the overlay's. */
  const body = parts.map((p) => String(p?.text ?? "")).join("\n\n");
  const v = validateAnimationPlan(plan, { catalog, body, parts, style, scriptFormat: undefined });
  /** @type {Map<number, {code: string, message: string}[]>} */
  const rowErrors = new Map();
  for (const e of v.errors) {
    if (e.item === null || e.item === undefined) continue;
    if (!rowErrors.has(e.item)) rowErrors.set(e.item, []);
    rowErrors.get(e.item).push(e);
  }
  const byId = new Map(catalog.filter((e) => e && typeof e.id === "string").map((e) => [e.id, e]));

  /** @type {{index: number, row: any, entry: any}[]} */
  const rows = [];
  plan.forEach((row, index) => {
    const errs = rowErrors.get(index);
    if (errs && errs.length) { skip(index, row, errs[0].code, errs.map((e) => e.message).join(" ")); return; }
    const entry = byId.get(row.template);
    const props = isPlainObject(row.props) ? row.props : {};
    const defFormat = isPlainObject(entry.default_props) ? entry.default_props.format : undefined;
    if (entry.width !== WIDTH || entry.height !== HEIGHT || entry.fps !== FPS ||
      (props.format !== undefined && props.format !== defFormat)) {
      skip(index, row, "wrong_size", `${entry.id} does not render tall 1080x1920 at 30 fps${props.format !== undefined ? ` with format ${JSON.stringify(props.format)}` : ""}, so it cannot go over an ad.`);
      return;
    }
    rows.push({ index, row, entry });
  });

  /* 2. Overlay mode: the captions must sit where the overlays never draw. */
  if (mode === "overlay" && rows.length) {
    const zone = captionZoneFrom(captionZone, o);
    const problem = !zone
      ? ["no_caption_zone", "The caption position is not set, so a see-through animation could cover the captions. Set caption_position_y from a test export first."]
      : !captionsClear(zone)
        ? ["captions_in_the_way", `The captions sit at y ${Math.round(zone.top)}-${Math.round(zone.bottom)}, inside the band the animations draw in (y ${OVERLAY_DRAW_ZONE.top}-${OVERLAY_DRAW_ZONE.bottom}). Move caption_position_y below ${Math.ceil((OVERLAY_DRAW_ZONE.bottom / HEIGHT) * 100)}%.`]
        : null;
    if (problem) {
      for (const r of rows) skip(r.index, r.row, problem[0], problem[1]);
      return done();
    }
  }

  /* 3. The clock: the master's, or the export's through Submagic's words. */
  const master = masterTimeline(cutPlan);
  const lines = scriptLines(cutPlan, parts, style);
  let toExport = (/** @type {number} */ t) => t;
  if (rows.length && Math.abs(exportLen - master.duration) > o.remapOver + EPS) {
    const r = remapThroughWords(master.words, submagicWords, o);
    if (!r.ok) {
      const why = `The Submagic export runs ${say2(exportLen)} s and the master ${say2(master.duration)} s, ` +
        `more than ${o.remapOver} s apart, and the times could not be re-mapped: ${r.reason}.`;
      for (const x of rows) skip(x.index, x.row, "cannot_remap", why);
      return done();
    }
    toExport = r.map;
  }

  /* The CTA line, on the export's clock. */
  const ctaIdx = new Set(lines.filter((l) => l.kind === "cta").map((l) => Number(l.line_idx)));
  const ctaWords = master.words.filter((w) => ctaIdx.has(w.line_idx));
  const cta = ctaWords.length
    ? { start: toExport(Math.min(...ctaWords.map((w) => w.start))), end: toExport(Math.max(...ctaWords.map((w) => w.end))) }
    : null;

  /* 4. Each anchor → a start frame on the export. */
  const totalFrames = Math.floor(exportLen * FPS + EPS);
  /** @type {{index: number, row: any, entry: any, startFrame: number, frames: number, at: number, line_idx: number|null, fallback: boolean}[]} */
  const placed = [];
  for (const r of rows) {
    const a = anchorOnMaster(master, lines, r.row.anchor, style);
    if (a.time === null) {
      skip(r.index, r.row, "anchor_cut", `Skipped: ${a.reason}, so this animation has nothing to land on.`);
      continue;
    }
    const at = Math.max(0, toExport(a.time));
    const startFrame = Math.round(at * FPS);
    if (startFrame >= totalFrames) {
      skip(r.index, r.row, "past_the_end", `Its anchor lands at ${say2(at)} s, after the video ends (${say2(exportLen)} s).`);
      continue;
    }
    const want = Math.round(Number(r.row.seconds) * FPS);
    let frames = want;
    if (mode === "fullframe") {
      const capF = Math.round(fullframeMaxSeconds(r.entry.id, o) * FPS);
      if (r.entry.min_frames > capF) {
        skip(r.index, r.row, "too_long_for_fullframe",
          `${r.entry.id} runs at least ${say2(r.entry.min_frames / FPS)} s. A full-frame clip may run at most ${fullframeMaxSeconds(r.entry.id, o)} s.`);
        continue;
      }
      frames = Math.min(want, capF);
    }
    placed.push({ ...r, startFrame, frames, at, line_idx: a.line_idx, fallback: a.fallback });
  }

  /* 5. The limits, in play order. */
  placed.sort((a, b) => a.startFrame - b.startFrame || a.index - b.index);
  const budgetF = Math.floor(o.maxShare * exportLen * FPS + EPS);
  const firstAllowedF = Math.round(o.noClipsBefore * FPS);
  const gapF = Math.round(o.minFaceBetween * FPS);
  const ctaStartF = cta ? Math.round(cta.start * FPS) : null;
  const ctaEndF = cta ? Math.round(cta.end * FPS) : null;
  let usedF = 0;
  /** @type {number|null} */
  let lastEndF = null;

  for (const p of placed) {
    const minF = p.entry.min_frames;
    const startS = p.startFrame / FPS;
    let frames = p.frames;
    /** @param {string} code @param {string} reason */
    const no = (code, reason) => skip(p.index, p.row, code, reason);

    if (mode === "fullframe") {
      if (p.startFrame < firstAllowedF) { no("in_the_hook", `It would start at ${say2(startS)} s. No animation goes in the first ${o.noClipsBefore} seconds.`); continue; }
      if (ctaStartF !== null && ctaEndF !== null) {
        if (p.startFrame >= ctaStartF && p.startFrame < ctaEndF) { no("on_the_cta", `It would start at ${say2(startS)} s, on the call to action (${say2(ctaStartF / FPS)}-${say2(ctaEndF / FPS)} s). No animation covers the call to action.`); continue; }
        if (p.startFrame < ctaStartF && p.startFrame + frames > ctaStartF) {
          frames = ctaStartF - p.startFrame;
          if (frames < minF) { no("runs_into_the_cta", `It would run into the call to action at ${say2(ctaStartF / FPS)} s, and ${p.entry.id} cannot be cut shorter than ${say2(minF / FPS)} s.`); continue; }
        }
      }
    }
    if (p.startFrame + frames > totalFrames) {
      frames = totalFrames - p.startFrame;
      if (frames < minF) { no("past_the_end", `It would run past the end of the video, and ${p.entry.id} cannot be cut shorter than ${say2(minF / FPS)} s.`); continue; }
    }
    if (mode === "fullframe") {
      if (lastEndF !== null && p.startFrame < lastEndF + gapF) {
        no("too_close", `It would start ${say2(Math.max(0, p.startFrame - lastEndF) / FPS)} s after the animation before it. Chris's face needs at least ${o.minFaceBetween} seconds between animations.`);
        continue;
      }
      if (usedF + frames > budgetF) {
        frames = budgetF - usedF;
        if (frames < minF) { no("over_the_share", `Animations would cover more than ${Math.round(o.maxShare * 100)}% of the video (${say1((o.maxShare * exportLen))} of ${say1(exportLen)} s).`); continue; }
      }
    } else if (lastEndF !== null && p.startFrame < lastEndF) {
      no("overlaps", `It would start at ${say2(startS)} s, while the animation before it is still on screen (until ${say2(lastEndF / FPS)} s).`);
      continue;
    }

    const props = {
      ...(isPlainObject(p.row.props) ? p.row.props : {}),
      durationInFrames: frames,
      ...(mode === "overlay" ? { transparent: true } : {})
    };
    items.push({
      index: p.index,
      template: p.entry.id,
      props,
      start: round3(p.startFrame / FPS),
      end: round3((p.startFrame + frames) / FPS),
      start_frame: p.startFrame,
      frames,
      seconds: round3(frames / FPS),
      cache_key: cacheKey(p.entry.id, props),
      anchor: p.row.anchor,
      anchor_time: round3(p.at),
      line_idx: p.line_idx,
      fallback: p.fallback
    });
    usedF += frames;
    lastEndF = p.startFrame + frames;
  }

  return done();
}

/* ─────────────────────────────────────────────────────────────────────────
   ffmpeg: the overlay (one video encode, sound copied) and the finalize.
   ───────────────────────────────────────────────────────────────────────── */

/** An item's exact frames: start_frame + frames, else start / end on the grid. @param {any} item */
function frameSpan(item) {
  const sf = num(item?.start_frame), f = num(item?.frames);
  if (sf !== null && f !== null && Number.isInteger(sf) && Number.isInteger(f)) return { startFrame: sf, frames: f };
  const s = snapPiece({ start: Number(item?.start), end: Number(item?.end) });
  return { startFrame: Math.round(s.start * FPS), frames: s.frames };
}

/**
 * overlayArgs({video_kind, base, items, out}) → argv
 *
 * Lays each rendered clip over the Submagic export at its frame:
 *   [k:v] trim=end_frame=N, setpts=PTS-STARTPTS + startFrame/(30·TB)
 *   [prev][ak] overlay=0:0, eof_action=pass, enable between the clip's first
 *   and last frame (half a frame of slack each side, so rounding never drops
 *   a frame)
 * then ONE video encode with the master's final settings (FINAL_VIDEO from
 * ffmpeg-plan.mjs: H.264 High crf 18, 12M/24M, yuv420p bt709, 30 fps cfr)
 * and the sound copied as it is (-c:a copy). A .webm clip is decoded with
 * libvpx-vp9, the decoder that keeps VP9's alpha. No clips → a stream copy,
 * so the picture is not encoded at all.
 *
 * base   the Submagic export (local path)
 * items  planAnimations() items, each with src: the rendered clip's local path
 * out    the overlaid file (.mp4); finalizeArgs() runs on it next
 *
 * @param {{video_kind: unknown, base: string, items?: any[], out: string}} o
 */
export function overlayArgs({ video_kind, base, items = [], out }) {
  assertAd(video_kind, "overlayArgs");
  if (!base || !out) throw new Error("overlayArgs: base (the Submagic export) and out are both needed");
  const list = Array.isArray(items) ? [...items] : [];
  if (!list.length) {
    return [
      "-hide_banner", "-nostats", "-y", "-i", base,
      "-map", "0:v:0", "-map", "0:a:0",
      "-c", "copy",
      "-map_metadata", "-1",
      "-f", "mp4", out
    ];
  }
  const spans = list.map((it, i) => {
    if (!it || typeof it.src !== "string" || !it.src) throw new Error(`overlayArgs: clip ${i + 1} has no src (the rendered file)`);
    const sp = frameSpan(it);
    if (!(sp.frames >= 1) || !(sp.startFrame >= 0)) throw new Error(`overlayArgs: clip ${i + 1} has no frames to show`);
    return { src: it.src, ...sp };
  }).sort((a, b) => a.startFrame - b.startFrame);

  const args = ["-hide_banner", "-nostats", "-y", "-i", base];
  for (const s of spans) {
    if (/\.webm$/i.test(s.src)) args.push("-c:v", "libvpx-vp9");
    args.push("-i", s.src);
  }
  const graph = [];
  let prev = "0:v";
  spans.forEach((s, i) => {
    const from = secs((s.startFrame - 0.5) / FPS);
    const to = secs((s.startFrame + s.frames - 0.5) / FPS);
    graph.push(`[${i + 1}:v]trim=end_frame=${s.frames},setpts=PTS-STARTPTS+${s.startFrame}/(${FPS}*TB)[a${i}]`);
    graph.push(`[${prev}][a${i}]overlay=x=0:y=0:eof_action=pass:enable='between(t,${from},${to})'[v${i + 1}]`);
    prev = `v${i + 1}`;
  });
  args.push(
    "-filter_complex", graph.join(";"),
    "-map", `[${prev}]`, "-map", "0:a:0",
    ...FINAL_VIDEO,
    "-c:a", "copy",
    "-map_metadata", "-1",
    "-f", "mp4", out
  );
  return args;
}

/** A loudness entry → integrated LUFS: a number, or parseLoudnorm's result. @param {unknown} entry */
function lufsOf(entry) {
  if (entry && typeof entry === "object") return num(/** @type {any} */ (entry).input_i);
  return num(entry);
}

/**
 * True when the overlaid file's loudness is more than 1 LU off -14 LUFS
 * (Submagic's cleanAudio moves it). Null when it was not measured.
 * @param {unknown} loudness  parseLoudnorm(pass 1 on the overlaid file)
 * @returns {boolean|null}
 */
export function needsLoudnessFix(loudness, o = ANIMATION_DEFAULTS) {
  const i = lufsOf(loudness);
  if (i === null) return null;
  return Math.abs(i - LOUDNORM.I) > o.loudnessTolerance + EPS;
}

/**
 * finalizeArgs({video_kind, src, out, loudness}) → argv
 *
 * The finished file. The picture is copied (it was encoded once, in the
 * overlay). The sound is re-levelled with loudnorm pass 2 (-14 LUFS, linear,
 * ffmpeg-plan.mjs) and AAC 192k 48 kHz stereo only when it is more than 1 LU
 * off; otherwise it is copied too. Always +faststart (the index first, so a
 * phone starts playing before the whole file arrives).
 *
 * loudness  parseLoudnorm(loudnormPass1Args on the overlaid file). Refuses
 *           when it is unmeasured: a silent file is not finished.
 *
 * @param {{video_kind: unknown, src: string, out: string, loudness: any}} o
 */
export function finalizeArgs({ video_kind, src, out, loudness }) {
  assertAd(video_kind, "finalizeArgs");
  if (!src || !out) throw new Error("finalizeArgs: src and out are both needed");
  const fix = needsLoudnessFix(loudness);
  if (fix === null) throw new Error("finalizeArgs: the overlaid file's loudness was not measured, so it cannot be finished");
  const head = ["-hide_banner", "-nostats", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0"];
  const tail = ["-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", out];
  if (!fix) return [...head, "-c", "copy", ...tail];
  return [...head, "-c:v", "copy", ...loudnormPass2Args({ video_kind, loudness }), ...FINAL_AUDIO, ...tail];
}

/**
 * faststartFromHead(bytes) → true when the MP4's index (moov) comes before the
 * media (mdat), false when after, null when the bytes given cannot tell.
 * Reads only the top-level box headers, so the first 64 KB of the file is
 * plenty.
 * @param {Uint8Array|ArrayBuffer|null|undefined} bytes
 * @returns {boolean|null}
 */
export function faststartFromHead(bytes) {
  if (!bytes) return null;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let at = 0;
  while (at + 8 <= u8.byteLength) {
    let size = dv.getUint32(at);
    const type = String.fromCharCode(u8[at + 4], u8[at + 5], u8[at + 6], u8[at + 7]);
    if (type === "moov") return true;
    if (type === "mdat") return false;
    if (size === 1) {
      if (at + 16 > u8.byteLength) return null;
      size = dv.getUint32(at + 8) * 2 ** 32 + dv.getUint32(at + 12);
    }
    if (size < 8) return null;
    at += size;
  }
  return null;
}

/**
 * finalizeChecks({probe, expectedDuration, loudness, faststart, head}) → {ok, reasons}
 *
 * The finished file passes only when every one holds (spec §9.1 step 11.3):
 *   * it is 1080x1920
 *   * it runs within 0.3 s of the master (expectedDuration)
 *   * its loudness was re-fixed: within 1 LU of -14 LUFS
 *   * it starts fast (+faststart: moov before mdat)
 *
 * probe      parseProbe() of the finished file (raw ffprobe JSON is read too)
 * loudness   parseLoudnorm(pass 1 on the finished file), or LUFS as a number
 * faststart  true / false if the caller already knows, else
 * head       the file's first bytes (faststartFromHead reads them)
 *
 * @param {{probe: any, expectedDuration: unknown, loudness: unknown, faststart?: boolean|null,
 *   head?: Uint8Array|ArrayBuffer|null, opts?: Partial<typeof ANIMATION_DEFAULTS>}} o
 */
export function finalizeChecks({ probe, expectedDuration, loudness, faststart = null, head = null, opts = {} }) {
  const o = { ...ANIMATION_DEFAULTS, ...opts };
  /** @type {string[]} */
  const reasons = [];
  const p = probe && (Array.isArray(probe.streams) || typeof probe === "string") ? parseProbe(probe) : probe;

  if (!p || !p.ok) {
    reasons.push("The finished file could not be read (no picture or no length).");
  } else {
    if (p.width !== WIDTH || p.height !== HEIGHT) {
      reasons.push(`The finished file is ${p.width ?? "?"}x${p.height ?? "?"}. An ad must be ${WIDTH}x${HEIGHT}.`);
    }
    const want = num(expectedDuration);
    const got = num(p.duration);
    if (want === null) reasons.push("The master's length is unknown, so the finished length cannot be checked.");
    else if (got === null) reasons.push("The finished file's length is unknown.");
    else if (Math.abs(got - want) > o.durationTolerance + EPS) {
      reasons.push(`The finished file runs ${say2(got)} s and the master ${say2(want)} s. They must be within ${o.durationTolerance} s.`);
    }
  }

  const lufs = lufsOf(loudness);
  if (lufs === null) reasons.push("The finished file's loudness was not measured.");
  else if (Math.abs(lufs - LOUDNORM.I) > o.loudnessTolerance + EPS) {
    reasons.push(`The finished file is at ${say1(lufs)} LUFS. It must be within ${o.loudnessTolerance} of ${LOUDNORM.I} LUFS.`);
  }

  const fast = typeof faststart === "boolean" ? faststart : faststartFromHead(head);
  if (fast === null) reasons.push("It could not be told whether the file starts fast (+faststart).");
  else if (!fast) reasons.push("The file does not start fast: its index (moov) sits after the video (mdat). Remux it with +faststart.");

  return { ok: reasons.length === 0, reasons };
}
