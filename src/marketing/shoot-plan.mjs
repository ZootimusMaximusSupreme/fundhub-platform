// @ts-check
// Shoot Day, the pure half: which approved scripts to film, in what order, how
// long it takes, and the exact file name each take gets. No database, no
// network, no clock. Every rule here is proved by src/marketing/shoot-plan.test.mjs.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §8.1 (teleprompter timing),
// §8.2 (Shoot Day); design docs/specs/command-center-design-2026-10-05.md §3.4;
// shape docs/specs/marketing-machine-api.md §7.1. Unit X5.
//
// THE FILE NAME IS OWNER LAW (marketing/ads/NAMING.md, .claude/rules/ad-naming.md):
//
//   `{Offer} Ad {number} — {angle} Take {number}.mp4`
//
//   * Offer  the offer's own word. Only ONE offer word is on file in the repo:
//            SLO, for the roadmap offer (every name in NAMING.md). An offer with
//            no word on file gets NO name and a sentence saying why. A word is
//            never made up (CLAUDE.md §2 "Never invent").
//   * Ad #   the script's ad number (ad_scripts.ad_id, given once on Approve).
//   * Angle  "the name of that script. The words in the title." So the script's
//            title, word for word (spaces folded), never angle_key and never a
//            nickname.
//   * Take # the next take: the highest take number already filed for this ad
//            before the shoot started, plus the takes rolled on this shoot, plus 1.
//
// src/ad-videos/merge-takes.mjs parseTakeName() reads the four parts back. The
// test proves every name made here reads back to the same four parts, so the
// clip Chris names from this screen is the clip the join step groups.

import { offerFacts } from "./offer-facts.mjs";

/* ── the offer word ──────────────────────────────────────────────────────── */

/** Offer key (marketing_funnels.offer_key, src/marketing/offer-facts.mjs) → the
    word that starts the file name. Add a word here only when Chris names one. */
export const OFFER_WORDS = Object.freeze(Object.assign(Object.create(null), {
  slo_roadmap: "SLO"
}));

/** The ad lane 'slo' (migration 406) is the roadmap's own lane: same word. */
export const LANE_WORDS = Object.freeze(Object.assign(Object.create(null), {
  slo: "SLO"
}));

/**
 * The offer word for a script, or null when none is on file.
 * @param {{offer_key?: string|null, lane?: string|null}} s  offer_key may be the
 *   script's own or its funnel's (the store passes whichever is set)
 */
export function offerWordFor(s) {
  const key = s && typeof s.offer_key === "string" ? s.offer_key : null;
  if (key && OFFER_WORDS[key]) return OFFER_WORDS[key];
  const lane = s && typeof s.lane === "string" ? s.lane : null;
  if (lane && LANE_WORDS[lane]) return LANE_WORDS[lane];
  return null;
}

/* ── the angle name ──────────────────────────────────────────────────────── */

/**
 * The angle name: the script's title, spaces folded, or null when it has none.
 * @param {{title?: string|null}} s
 */
export function angleNameFor(s) {
  const t = s && typeof s.title === "string" ? s.title.replace(/\s+/g, " ").trim() : "";
  return t || null;
}

/* ── the take file name ──────────────────────────────────────────────────── */

const AD_RE = /^(0|[1-9][0-9]{0,8})$/;

/**
 * `{Offer} Ad {n} — {angle} Take {k}.mp4`, or null when any part is missing.
 * @param {{offerWord: string|null, adId: string|number|null, angle: string|null, takeNo: number}} p
 */
export function takeFileName({ offerWord, adId, angle, takeNo }) {
  if (!offerWord || !angle) return null;
  const ad = adId == null ? "" : String(adId);
  if (!AD_RE.test(ad)) return null;
  if (!Number.isInteger(takeNo) || takeNo < 1) return null;
  return `${offerWord} Ad ${ad} — ${angle} Take ${takeNo}.mp4`;
}

/**
 * Why a script has no file name, in plain words; null when it has one.
 * @param {{ad_id?: string|null, title?: string|null, offer_key?: string|null, lane?: string|null}} s
 */
export function takeNameProblem(s) {
  if (!s || s.ad_id == null || !AD_RE.test(String(s.ad_id))) {
    return "This script has no ad number yet. Approve it first.";
  }
  if (!angleNameFor(s)) return "This script has no title, so its angle name is unknown.";
  if (!offerWordFor(s)) {
    const facts = s.offer_key ? offerFacts(s.offer_key) : null;
    if (facts) return `The ${facts.label} offer has no file-name word yet (like SLO for the roadmap), so the file name is unknown.`;
    return "This script names no offer with a file-name word, so the file name is unknown.";
  }
  return null;
}

/* ── what the teleprompter rolls ─────────────────────────────────────────── */

/** @param {any} parts */
function partsList(parts) {
  return Array.isArray(parts) ? parts.filter((p) => p && typeof p.text === "string") : [];
}

/**
 * A retake whose new opening is the only new line ("first line only", spec
 * §8.2, design J11): the script needs a retake AND it came from an opening idea.
 * @param {{needs_retake?: boolean, idea_kind?: string|null}} s
 */
export function isFirstLineOnly(s) {
  return !!s && s.needs_retake === true && s.idea_kind === "opening";
}

/**
 * The words the teleprompter rolls. First-line-only retakes roll the hook only
 * (the rest of the old take is kept). Everything else rolls the whole body,
 * which is the teleprompter text (spec §7.9: the body, byte for byte).
 * @param {{body?: string|null, parts?: any, needs_retake?: boolean, idea_kind?: string|null}} s
 */
export function teleprompterText(s) {
  const body = s && typeof s.body === "string" ? s.body : "";
  if (!isFirstLineOnly(s)) return body;
  const hook = partsList(s.parts).find((p) => p.kind === "hook");
  if (hook && hook.text.trim()) return hook.text.trim();
  const first = body.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).find(Boolean);
  return first || body;
}

/* ── read time: the v1 teleprompter's own clock (tools/teleprompter) ─────── */

export const DEFAULT_WPM = 150;
export const MIN_WPM = 80;
export const MAX_WPM = 260;
export const DEFAULT_PAUSE_SECONDS = 0.8;
/** Takes and resets, per ad (spec §8.2). */
export const RESET_SECONDS_PER_AD = 120;

const SENTENCE_END = /[.!?]["”’')]*$/;
const COMMA = /[,;:]["”’')]*$/;

/**
 * Seconds to read `text` at `wpm`: every word gets 60/wpm, held 35% longer at a
 * sentence end and 15% at a comma; a blank line pauses `pause` seconds. The ↑
 * mark is not a word. Same numbers as tools/teleprompter/index.html timeline().
 * @param {string} text @param {{wpm?: number, pause?: number}} [opts]
 */
export function readSeconds(text, { wpm = DEFAULT_WPM, pause = DEFAULT_PAUSE_SECONDS } = {}) {
  const spw = 60 / wpm;
  const paras = String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let at = 0;
  paras.forEach((p, i) => {
    for (const tok of p.split(/\s+/)) {
      if (!tok || tok === "↑") continue;
      at += spw * (1 + (SENTENCE_END.test(tok) ? 0.35 : COMMA.test(tok) ? 0.15 : 0));
    }
    if (i < paras.length - 1) at += pause;
  });
  return at;
}

/** Words in `text`, ↑ not counted. @param {string} text */
export function wordCount(text) {
  return String(text || "").split(/\s+/).filter((w) => w && w !== "↑").length;
}

/**
 * "about N minutes": every script's read time plus 2 minutes per ad, rounded
 * up. Zero scripts is 0.
 * @param {Array<{read_seconds: number}>} scripts
 */
export function estimateMinutes(scripts) {
  const list = Array.isArray(scripts) ? scripts : [];
  if (!list.length) return 0;
  const secs = list.reduce((sum, s) => sum + (Number(s.read_seconds) || 0) + RESET_SECONDS_PER_AD, 0);
  return Math.ceil(secs / 60);
}

/* ── film order ──────────────────────────────────────────────────────────── */

/**
 * Plan order (spec §8.2): retakes and new openings first, then film order
 * (first = 1, unset last), then the ad number, then when it was approved.
 * @param {any} a @param {any} b
 */
export function planCompare(a, b) {
  const ra = a.needs_retake ? 0 : 1;
  const rb = b.needs_retake ? 0 : 1;
  if (ra !== rb) return ra - rb;
  const fa = a.film_order == null ? Infinity : Number(a.film_order);
  const fb = b.film_order == null ? Infinity : Number(b.film_order);
  if (fa !== fb) return fa < fb ? -1 : 1;
  const na = a.ad_id == null ? Infinity : Number(a.ad_id);
  const nb = b.ad_id == null ? Infinity : Number(b.ad_id);
  if (na !== nb) return na < nb ? -1 : 1;
  const la = a.locked_at ? Date.parse(a.locked_at) : Infinity;
  const lb = b.locked_at ? Date.parse(b.locked_at) : Infinity;
  if (la !== lb) return la < lb ? -1 : 1;
  return String(a.root_script_id || a.id).localeCompare(String(b.root_script_id || b.id));
}

/* ── one script, ready to film ───────────────────────────────────────────── */

/**
 * The plan fields added to the Script object S.
 * @param {any} s        the Script object (scriptView) plus offer_key/lane/idea_kind as read
 * @param {{wpm?: number, priorTake?: number, mark?: {takes?: number, got_it?: boolean}|null}} [opts]
 *   priorTake: the highest take number filed for this ad before the shoot.
 */
export function planFields(s, { wpm = DEFAULT_WPM, priorTake = 0, mark = null } = {}) {
  const takes = mark && Number.isInteger(mark.takes) && mark.takes > 0 ? mark.takes : 0;
  const base = Number.isInteger(priorTake) && priorTake > 0 ? priorTake : 0;
  const offerWord = offerWordFor(s);
  const angle = angleNameFor(s);
  const nextTake = base + takes + 1;
  const text = teleprompterText(s);
  return {
    angle_name: angle,
    offer_word: offerWord,
    take_no: nextTake,
    take_file_name: takeFileName({ offerWord, adId: s.ad_id, angle, takeNo: nextTake }),
    take_name_problem: takeNameProblem(s),
    last_take_file_name: takes > 0 ? takeFileName({ offerWord, adId: s.ad_id, angle, takeNo: base + takes }) : null,
    takes,
    got_it: !!(mark && mark.got_it === true),
    first_line_only: isFirstLineOnly(s),
    teleprompter_text: text,
    words: wordCount(text),
    read_seconds: Math.round(readSeconds(text, { wpm }))
  };
}

/* ── the progress board (spec §8.2 table) ────────────────────────────────── */

export const BOARD_STEPS = Object.freeze([
  "filmed", "matched", "cutting", "captions", "animations",
  "ready_to_approve", "approved", "loaded", "failed"
]);

/** Written at the start of failure_reason on a take joined into a master
    (src/ad-videos/merge-takes.mjs JOINED_PREFIX). Such a row is not the ad. */
export const JOINED_PREFIX = "joined into one master:";

const STEP_OF_STATE = Object.freeze({
  raw_landed: "matched",
  staged: "cutting",
  editing: "captions",
  transcribed: "captions",
  matched: "captions",
  rendered: "captions",
  awaiting_approval: "ready_to_approve",
  approved: "approved",
  delivered: "approved",
  failed: "failed",
  rejected: "failed"
});

const STEP_WORD = Object.freeze({
  filmed: "Filmed",
  matched: "Uploaded and matched",
  cutting: "Cutting",
  captions: "Captions",
  animations: "Animations",
  ready_to_approve: "Ready to approve",
  approved: "Approved",
  loaded: "Loaded",
  failed: "Stopped"
});

/**
 * One board row for one ad on the shoot, or null when it has neither a Got it
 * mark nor a landed clip yet.
 * @param {{ad_id: string|null, angle: string|null, mark?: any, video?: any}} p
 */
export function boardRow({ ad_id, angle, mark = null, video = null }) {
  if (video && video.status && STEP_OF_STATE[video.status]) {
    const step = STEP_OF_STATE[video.status];
    let reason = null;
    let word = STEP_WORD[step];
    let needsYou = false;
    if (video.status === "staged") reason = "The join step still runs on the Mac.";
    if (video.status === "awaiting_approval") needsYou = true;
    if (video.status === "rejected") {
      word = "Rejected";
      reason = "You said no to this cut. Film it again as a retake.";
    } else if (video.status === "failed") {
      reason = plainReason(video.failure_reason);
      needsYou = true;
    }
    return {
      ad_id: ad_id ?? null,
      angle: angle ?? null,
      step,
      step_word: word,
      since: toIso(video.updated_at),
      reason,
      can_retry: false,
      needs_you: needsYou
    };
  }
  if (mark && mark.got_it === true) {
    return {
      ad_id: ad_id ?? null,
      angle: angle ?? null,
      step: "filmed",
      step_word: STEP_WORD.filmed,
      since: typeof mark.at === "string" ? mark.at : null,
      reason: null,
      can_retry: false,
      needs_you: false
    };
  }
  return null;
}

/** Board rows that need Chris go on top; the rest keep the shoot's order. */
export function sortBoard(rows) {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.needs_you === b.r.needs_you ? a.i - b.i : a.r.needs_you ? -1 : 1))
    .map((x) => x.r);
}

/** @param {any} v */
function toIso(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A stored failure reason, short, one line. @param {any} r */
function plainReason(r) {
  const s = typeof r === "string" ? r.replace(/\s+/g, " ").trim() : "";
  if (!s) return "A step stopped and did not say why.";
  return s.length > 200 ? s.slice(0, 197) + "..." : s;
}

/* ── marks ───────────────────────────────────────────────────────────────── */

export const MARKS = Object.freeze(["got_it", "another_take"]);

/**
 * The marks after one press. Both presses count the take just rolled; Got it
 * also says it is the one to keep. Marks are {root_script_id: {takes, got_it, at}}.
 * @param {Record<string, any>} marks @param {string} root @param {"got_it"|"another_take"} mark @param {string} at ISO time
 */
export function applyMark(marks, root, mark, at) {
  const out = { ...(marks && typeof marks === "object" && !Array.isArray(marks) ? marks : {}) };
  const prev = out[root] && typeof out[root] === "object" ? out[root] : {};
  const takes = (Number.isInteger(prev.takes) && prev.takes > 0 ? prev.takes : 0) + 1;
  out[root] = { takes, got_it: mark === "got_it" ? true : prev.got_it === true, at };
  return out;
}
