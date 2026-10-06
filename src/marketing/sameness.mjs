// @ts-check
// src/marketing/sameness.mjs — is a new script too close to what is already out there?
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.6 "The check loop", step 4:
//   * Compare the hook to the last 30 hooks, and the body to the last 30 bodies, by
//     word-trigram overlap. Above 0.5, rewrite once.
//   * Every hook and every CTA in the batch must be different.
//   * The long intro may appear on at most 1 in 5 ads, and the short intro on at most
//     2 in 5.
// Appendix A rule 34: every ad in a batch is a whole different ad. No hook swaps on the
// same body. Rule 31: the full intro only where Chris is the proof, a short one on some,
// none on others.
//
// PURE. No database, no files, no network. The writer (src/marketing/writer.mjs) reads
// the last 30 scripts and the batch's scripts and hands them in.
//
// THE MEASURES, AND WHY EACH ONE IS SHAPED THIS WAY
//
//   overlap(new, old) = the share of the NEW text's word trigrams that also appear in the
//     old text. Containment, not Jaccard: a new hook that copies an old one and adds three
//     words is still a copy, and Jaccard would let the extra words water that down. A
//     text under 3 words has no trigram, so it is compared whole (1 when the words are
//     the same, else 0).
//   words: lower case, ↑ marks and punctuation dropped, curly apostrophes made straight,
//     "$" kept on a number so "$300,000" and "300,000" stay different words.
//   a duplicate hook or CTA: the same words after that tidying. "Rewrite once" handles
//     near-copies through the overlap rule; a duplicate inside one batch is refused.
//   intro caps: a batch of N planned scripts may carry floor(N / 5) long intros and
//     floor(2N / 5) short intros, never fewer than 1 of each. "1 in 5" has no answer for
//     a 3-script Write now; the floor of 1 lets one intro ad through there (a default
//     the writer unit, U24, picked and recorded in its report; not an owner decision).
//   long intro: "my name is chris". Short intro: "i'm chris" / "im chris" / "i am chris".

/** Above this, the writer rewrites once (spec §7.6). */
export const OVERLAP_LIMIT = 0.5;

/** How many recent hooks and bodies the new script is compared with (spec §7.6). */
export const RECENT_LIMIT = 30;

/** Share of a batch that may open with each intro (spec §7.6). */
export const INTRO_RATIOS = Object.freeze({ long: 1 / 5, short: 2 / 5 });

/**
 * The words of a text, tidied for comparing. Never throws.
 * @param {unknown} text
 * @returns {string[]}
 */
export function words(text) {
  const s = String(text ?? "")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/↑/g, " ");
  return s.match(/\$?[a-z0-9]+(?:[',.][a-z0-9]+)*/g) || [];
}

/**
 * The text tidied to one comparable string (same words, single spaces).
 * @param {unknown} text
 */
export function sameKey(text) {
  return words(text).join(" ");
}

/**
 * Every word trigram in a text.
 * @param {unknown} text
 * @returns {Set<string>}
 */
export function wordTrigrams(text) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/**
 * The share (0 to 1) of the new text's word trigrams that the old text also has.
 * @param {unknown} newText
 * @param {unknown} oldText
 */
export function trigramOverlap(newText, oldText) {
  const a = wordTrigrams(newText);
  if (a.size === 0) {
    const k = sameKey(newText);
    return k && k === sameKey(oldText) ? 1 : 0;
  }
  const b = wordTrigrams(oldText);
  if (b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / a.size;
}

/**
 * The highest overlap of `text` against any of `others`, and which one it was.
 * @param {unknown} text
 * @param {unknown[]} others
 * @returns {{ overlap: number, index: number | null }}
 */
export function maxOverlap(text, others) {
  let best = 0;
  /** @type {number | null} */
  let index = null;
  (Array.isArray(others) ? others : []).forEach((o, i) => {
    if (o == null || !String(o).trim()) return;
    const v = trigramOverlap(text, o);
    if (v > best) { best = v; index = i; }
  });
  return { overlap: Math.round(best * 1000) / 1000, index };
}

/**
 * Which intro a script opens with: 'long' (my name is Chris), 'short' (I'm Chris) or null.
 * @param {unknown} text
 * @returns {'long' | 'short' | null}
 */
export function introKind(text) {
  const k = ` ${sameKey(text)} `;
  if (/ my name is chris /.test(k)) return "long";
  if (/ (?:i'm|im|i am) chris /.test(k)) return "short";
  return null;
}

/**
 * How many long and short intros a batch of `total` planned scripts may carry.
 * @param {number} total
 * @returns {{ long: number, short: number }}
 */
export function introCaps(total) {
  const n = Number.isFinite(total) && total > 0 ? Math.floor(total) : 1;
  return {
    long: Math.max(1, Math.floor(n * INTRO_RATIOS.long)),
    short: Math.max(1, Math.floor(n * INTRO_RATIOS.short))
  };
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/**
 * The hook of a script: its 'hook' part, else the first sentence of the body.
 * @param {{ parts?: any, body?: any }} script
 */
export function hookOf(script) {
  const parts = Array.isArray(script?.parts) ? script.parts : [];
  const p = parts.find((x) => x && x.kind === "hook" && String(x.text || "").trim());
  if (p) return String(p.text).trim();
  const body = String(script?.body ?? "").replace(/↑/g, " ").trim();
  return (body.split(SENTENCE_SPLIT)[0] || "").trim();
}

/**
 * The call to action of a script: its 'cta' part, else the last sentence of the body.
 * @param {{ parts?: any, body?: any }} script
 */
export function ctaOf(script) {
  const parts = Array.isArray(script?.parts) ? script.parts : [];
  const ctas = parts.filter((x) => x && x.kind === "cta" && String(x.text || "").trim());
  if (ctas.length) return String(ctas[ctas.length - 1].text).trim();
  const sentences = String(script?.body ?? "").replace(/↑/g, " ").trim().split(SENTENCE_SPLIT).filter(Boolean);
  return (sentences[sentences.length - 1] || "").trim();
}

/**
 * @typedef {{ hook?: string|null, body?: string|null, parts?: any }} ScriptText
 * @typedef {{
 *   hook_overlap: number, body_overlap: number, overlap_too_high: boolean,
 *   duplicate_hook: boolean, duplicate_cta: boolean,
 *   intro: { kind: 'long'|'short'|null, long_used: number, short_used: number,
 *            long_cap: number, short_cap: number, over: boolean },
 *   rewrite: boolean, refused: boolean, reasons: string[]
 * }} SamenessResult
 */

/**
 * Checks one new script against the last 30 scripts and the rest of its batch.
 *
 * draft:  { body, parts }  (hook and CTA come from parts, else the body)
 * recent: the last 30 scripts [{ hook, body }] (the writer leaves out the script's own
 *         earlier versions)
 * batch:  the other live scripts in the same batch [{ hook, body, parts }]
 * batchTotal: how many scripts the batch planned (marketing_batches.total)
 *
 * rewrite  — true when one rewrite is due: overlap above 0.5, a duplicate hook or CTA in
 *            the batch, or an intro over its cap.
 * refused  — true when the batch already has this hook or this CTA. A draft that is
 *            still refused after its one rewrite is not saved.
 *
 * @param {{ body?: any, parts?: any }} draft
 * @param {{ recent?: ScriptText[], batch?: ScriptText[], batchTotal?: number }} [ctx]
 * @returns {SamenessResult}
 */
export function checkSameness(draft, { recent = [], batch = [], batchTotal } = {}) {
  const hook = hookOf(draft);
  const cta = ctaOf(draft);
  const body = String(draft?.body ?? "");
  const recentList = (Array.isArray(recent) ? recent : []).slice(0, RECENT_LIMIT);
  const batchList = Array.isArray(batch) ? batch : [];

  const h = maxOverlap(hook, recentList.map((r) => r?.hook ?? hookOf(r || {})));
  const b = maxOverlap(body, recentList.map((r) => r?.body ?? ""));
  const overlapTooHigh = h.overlap > OVERLAP_LIMIT || b.overlap > OVERLAP_LIMIT;

  const hookKey = sameKey(hook);
  const ctaKey = sameKey(cta);
  const duplicateHook = !!hookKey && batchList.some((s) => sameKey(s?.hook ?? hookOf(s || {})) === hookKey);
  const duplicateCta = !!ctaKey && batchList.some((s) => sameKey(ctaOf(s || {})) === ctaKey);

  const kind = introKind(body);
  const total = Number.isFinite(batchTotal) && /** @type {number} */ (batchTotal) > 0
    ? /** @type {number} */ (batchTotal)
    : batchList.length + 1;
  const caps = introCaps(Math.max(total, batchList.length + 1));
  const kinds = batchList.map((s) => introKind(s?.body ?? ""));
  const longUsed = kinds.filter((k) => k === "long").length + (kind === "long" ? 1 : 0);
  const shortUsed = kinds.filter((k) => k === "short").length + (kind === "short" ? 1 : 0);
  const introOver = (kind === "long" && longUsed > caps.long) || (kind === "short" && shortUsed > caps.short);

  const reasons = [];
  if (h.overlap > OVERLAP_LIMIT) {
    reasons.push(`The hook repeats ${Math.round(h.overlap * 100)}% of a recent hook ("${recentHookText(recentList, h.index)}"). Write a new hook.`);
  }
  if (b.overlap > OVERLAP_LIMIT) {
    reasons.push(`The body repeats ${Math.round(b.overlap * 100)}% of a recent script. Write a whole different ad, not a hook swap (rule 34).`);
  }
  if (duplicateHook) reasons.push("Another script in this batch already has this hook. Every hook in a batch must be different.");
  if (duplicateCta) reasons.push("Another script in this batch already has this call to action. Every CTA in a batch must be different.");
  if (introOver) {
    reasons.push(kind === "long"
      ? `This batch already has ${longUsed - 1} of its ${caps.long} long intros ("My name is Chris"). Drop the long intro here (rule 31).`
      : `This batch already has ${shortUsed - 1} of its ${caps.short} short intros ("I'm Chris"). Drop the short intro here (rule 31).`);
  }

  return {
    hook_overlap: h.overlap,
    body_overlap: b.overlap,
    overlap_too_high: overlapTooHigh,
    duplicate_hook: duplicateHook,
    duplicate_cta: duplicateCta,
    intro: {
      kind, long_used: longUsed, short_used: shortUsed,
      long_cap: caps.long, short_cap: caps.short, over: introOver
    },
    rewrite: overlapTooHigh || duplicateHook || duplicateCta || introOver,
    refused: duplicateHook || duplicateCta,
    reasons
  };
}

/** @param {ScriptText[]} list @param {number|null} i */
function recentHookText(list, i) {
  if (i == null || !list[i]) return "";
  const t = String(list[i].hook ?? hookOf(list[i])).replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 87)}...` : t;
}
