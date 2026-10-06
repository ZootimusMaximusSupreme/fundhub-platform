// @ts-check
// Voice pairs: what the machine wrote, next to what Chris changed it to.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.2 ("Learning from edits"):
// every edit Chris makes to a machine line saves a voice_pairs row (migration
// 414). Plan unit U25. Pure: no clock, no database.
//
//   diffVoicePairs(oldScript, newScript) -> [{before, after, kind}]
//       The lines (or parts) that changed between two versions of one script.
//   keepMachineLines(pairs, machineScript) -> the pairs whose `before` is a
//       line the machine wrote (its latest version in the same script).
//
// HOW LINES ARE LINED UP
//   1. Both versions carry parts ([{kind, text}], spec §7.4): compare parts.
//      Otherwise compare the body's non-blank lines (kind null = not said).
//   2. Lines that stayed the same (after trimming and squeezing spaces) are
//      anchors, found with a longest-common-subsequence pass.
//   3. Between two anchors, the old lines and the new lines are paired in
//      order. That pair is one edit. A line only removed, or only added, has no
//      partner and is not a pair: a pair needs the machine's words AND Chris's.
//   4. A pair where the words did not really change, or one side is blank, is
//      dropped. The kind is the old part's kind (what the machine meant it as).
//
// Very long scripts (over MAX_SEGMENTS lines on either side) give no pairs
// rather than a slow answer: the save itself never waits on this.

/** Past this many lines on either side, no pairs are worked out. */
export const MAX_SEGMENTS = 1000;

/** The kinds a part may have (spec §7.4). */
export const PART_KINDS = Object.freeze(["hook", "line2", "body", "cue", "reveal", "cta"]);

/* voice_pairs.kind has the label-key shape (414 voice_pairs_kind_ck). */
const KIND_SHAPE = /^[a-z][a-z0-9_]{1,48}$/;

/** @typedef {{text: string, key: string, kind: string|null}} Segment */
/** @typedef {{before: string, after: string, kind: string|null}} VoicePair */

/** Trim and squeeze every run of spaces, so a stray space is not an edit. @param {unknown} s */
export function squeeze(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** @param {unknown} parts @returns {boolean} */
function hasParts(parts) {
  return Array.isArray(parts) && parts.length > 0 &&
    parts.every((p) => p && typeof p === "object" && typeof p.text === "string");
}

/**
 * @param {unknown} kind
 * @returns {string|null}
 */
function kindOf(kind) {
  return typeof kind === "string" && KIND_SHAPE.test(kind) ? kind : null;
}

/** @param {any} script @param {boolean} useParts @returns {Segment[]} */
function segments(script, useParts) {
  if (useParts) {
    return script.parts
      .map((/** @type {any} */ p) => ({ text: String(p.text).trim(), key: squeeze(p.text), kind: kindOf(p.kind) }))
      .filter((/** @type {Segment} */ s) => s.key !== "");
  }
  return String(script?.body ?? "")
    .split(/\r?\n/)
    .map((line) => ({ text: line.trim(), key: squeeze(line), kind: null }))
    .filter((s) => s.key !== "");
}

/**
 * Longest common subsequence of two key lists: the [i, j] index pairs of the
 * lines that stayed the same, in order.
 * @param {string[]} a @param {string[]} b
 * @returns {Array<[number, number]>}
 */
function anchors(a, b) {
  const n = a.length;
  const m = b.length;
  /** @type {Uint32Array[]} */
  const len = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
    }
  }
  /** @type {Array<[number, number]>} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/**
 * The lines Chris changed between two versions of one script.
 * @param {{body?: string, parts?: unknown}} oldScript  the version he edited
 * @param {{body?: string, parts?: unknown}} newScript  what he saved
 * @returns {VoicePair[]}
 */
export function diffVoicePairs(oldScript, newScript) {
  if (!oldScript || !newScript) return [];
  const useParts = hasParts(oldScript.parts) && hasParts(newScript.parts);
  const a = segments(oldScript, useParts);
  const b = segments(newScript, useParts);
  if (!a.length || !b.length || a.length > MAX_SEGMENTS || b.length > MAX_SEGMENTS) return [];

  const keep = anchors(a.map((s) => s.key), b.map((s) => s.key));
  /** @type {VoicePair[]} */
  const out = [];
  const seen = new Set();
  let pi = 0;
  let pj = 0;
  for (const [ai, bj] of [...keep, [a.length, b.length]]) {
    const olds = a.slice(pi, ai);
    const news = b.slice(pj, bj);
    const k = Math.min(olds.length, news.length);
    for (let x = 0; x < k; x++) {
      const before = olds[x];
      const after = news[x];
      if (before.key === after.key) continue;
      const id = `${before.key}\u0000${after.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ before: before.text, after: after.text, kind: before.kind ?? after.kind ?? null });
    }
    pi = ai + 1;
    pj = bj + 1;
  }
  return out;
}

/**
 * Keep only the pairs whose `before` is a line the machine wrote. The machine's
 * lines are every part and every body line of its latest version of the same
 * script, so a line the machine wrote is still its line after an earlier edit
 * changed a different line.
 * @param {VoicePair[]} pairs
 * @param {{body?: string, parts?: unknown}|null|undefined} machineScript
 * @returns {VoicePair[]}
 */
export function keepMachineLines(pairs, machineScript) {
  if (!machineScript || !Array.isArray(pairs) || !pairs.length) return [];
  const lines = new Set();
  if (hasParts(machineScript.parts)) for (const s of segments(machineScript, true)) lines.add(s.key);
  for (const s of segments(machineScript, false)) lines.add(s.key);
  return pairs.filter((p) => lines.has(squeeze(p.before)));
}
