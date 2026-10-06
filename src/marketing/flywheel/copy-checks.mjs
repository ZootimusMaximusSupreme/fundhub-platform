// @ts-check
// The copy stage's checker, in code, so no model can skip it or report a clean
// pass it did not earn. Ported from .claude/workflows/copy.js (banScan,
// keepsSpecifics, ctaCollisions) for flywheel step 4 on the server (design
// docs/specs/command-center-design-2026-10-05.md §3.2 row 4; unit X3's brief:
// "the copy checker regex stays in code"). Chris sees copy only after this ran.
//
// ONE LIST, NOT A FOURTH COPY. The banned words, phrases and openers come from
// marketing/ads/rules-data.mjs, the file scripts/ads/check-script.mjs enforces
// and copy.js is held equal to (scripts/ads/check-script.test.mjs). The shapes
// (em dash, "it's not X, it's Y", stacked fragments, sycophancy, a closing
// rhetorical question) are copy.js's regexes word for word.
//
// Pure: no clock, no network.

import { BANNED_WORDS, BANNED_PHRASES, BANNED_OPENERS } from "../../../marketing/ads/rules-data.mjs";

/**
 * banScan(text) → [{kind, hit}] — the mechanical humanizer pass (copy.js banScan).
 * @param {string} text
 */
export function banScan(text) {
  /** @type {{kind: string, hit: string}[]} */
  const hits = [];
  if (!text) return hits;
  const lower = text.toLowerCase();

  for (const w of BANNED_WORDS) {
    if (new RegExp(`\\b${w}(s|d|ed|ing|es)?\\b`, "i").test(text)) hits.push({ kind: "word", hit: w });
  }
  for (const p of BANNED_PHRASES) if (lower.includes(p)) hits.push({ kind: "phrase", hit: p });
  for (const o of BANNED_OPENERS) if (lower.trimStart().startsWith(o)) hits.push({ kind: "opener", hit: o });

  if (text.includes("—")) hits.push({ kind: "shape", hit: "em dash" });
  if (/\b(it'?s|this is|that'?s) not [^.,;]{1,50}, it'?s /i.test(text)) {
    hits.push({ kind: "shape", hit: "negative parallelism (it's not X, it's Y)" });
  }
  // Three or more consecutive very short sentences, stacked for drama.
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  let run = 0;
  for (const s of sentences) {
    run = s.split(/\s+/).length <= 4 ? run + 1 : 0;
    if (run >= 3) { hits.push({ kind: "shape", hit: "stacked staccato fragments" }); break; }
  }
  if (/^\s*(great question|absolutely|certainly|i'?d be happy to)/i.test(text)) {
    hits.push({ kind: "shape", hit: "sycophancy" });
  }
  if (sentences.length > 2 && /\?\s*$/.test(text.trim())) {
    hits.push({ kind: "shape", hit: "ends on a rhetorical question" });
  }
  return hits;
}

/**
 * Did the rewrite sand off the concrete detail that made the piece work?
 * @param {string} text
 * @param {string[]} tokens
 */
export function keepsSpecifics(text, tokens) {
  if (!tokens.length) return true;
  return tokens.some((t) => text.toLowerCase().includes(String(t).toLowerCase()));
}

/** The concrete figures in the offer a rewrite must keep (copy.js SPECIFIC_TOKENS). */
export function specificTokens(offerText) {
  return (String(offerText || "").match(/\$[\d,]+|\b\d{2,}%|\b\d+ (?:days?|weeks?|months?)\b/g) || []).slice(0, 12);
}

const CTA_STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "at", "it", "is",
  "we", "you", "your", "our", "us", "that", "this", "with", "for", "before", "after", "will",
  "can", "do", "does", "get", "got", "book", "grab", "take", "see", "watch", "read", "make"]);

/**
 * The Andromeda check (copy.js ctaCollisions): the pieceIds whose closing lines
 * collapse into another reason's close (70% or more of the content words shared).
 * Two pieces on the same reason may close alike.
 * @param {{pieceId: string, reasonId?: string, cta?: string}[]} pieces
 */
export function ctaCollisions(pieces) {
  const key = (t) => new Set(String(t || "").toLowerCase().replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter((w) => w.length > 2 && !CTA_STOP.has(w)));
  const overlap = (a, b) => {
    if (!a.size || !b.size) return 0;
    let hit = 0;
    for (const w of a) if (b.has(w)) hit += 1;
    return hit / Math.min(a.size, b.size);
  };
  const keyed = pieces.filter((p) => p.cta).map((p) => ({ pieceId: p.pieceId, reasonId: p.reasonId, k: key(p.cta) }));
  const collided = new Set();
  for (let i = 0; i < keyed.length; i++) {
    for (let j = i + 1; j < keyed.length; j++) {
      if (keyed[i].reasonId && keyed[i].reasonId === keyed[j].reasonId) continue;
      if (overlap(keyed[i].k, keyed[j].k) >= 0.7) { collided.add(keyed[i].pieceId); collided.add(keyed[j].pieceId); }
    }
  }
  return [...collided];
}

/** A piece's text as the scanner reads it. */
export function pieceText(p) {
  return [p.hook, p.body, p.cta].filter(Boolean).join("\n\n");
}

/** A piece id the way copy.js makes it: ANGLE-LENGTH, upper case, safe characters. */
export function pieceId(angleId, suffix) {
  return `${angleId}-${suffix}`.toUpperCase().replace(/[^A-Z0-9-]/g, "");
}
