// @ts-check
// src/ad-videos/align.mjs — the cut, made from the script: which seconds of
// which take, in script order, with the best attempt at every line kept once.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHERE THE RULES COME FROM
//
//   docs/specs/marketing-machine-2026-10-04.md §9.2 (every number below), §2
//   item 10 (the cut is made from the script, before Submagic, on plain code),
//   and the law .claude/rules/ad-video-best-of-clips.md (kill dead air,
//   repeats, false starts and filler; the best line once; script order).
// ═══════════════════════════════════════════════════════════════════════════
//
// PURE. No database, no network, no AI, no clock, no files, no ffmpeg. Every
// input is an argument, so every rule is proved by a unit test with a fake
// transcript (src/ad-videos/align.test.mjs, fixtures in
// src/ad-videos/fixtures/align-*.mjs).
//
// TWO ALIGNERS EXIST (2026-10-06). src/ad-videos/merge-takes.mjs is the LIVE
// one: the Mac-only joiner at `staged` runs it today with its own numbers
// (per-line defect score, 0.15 s / 0.12 s pads, 0.45 s max gap). This file is
// the spec §9.2 aligner for the new pipeline. Nothing live imports it yet: the
// video worker's build_cut job (spec §9.1 step 7) will call alignTakes() and
// save the result as ad_videos.cut_plan. merge-takes.mjs is not imported here
// and not changed, because none of its helpers matches a §9.2 rule exactly.
//
// THE STEPS, in the order alignTakes() runs them:
//
//   1. SPOKEN WORDS  spokenWords() — both sides become the words a person
//                    says: "$300,000", "300K", "300 grand" are all "three
//                    hundred thousand dollars" ("dollars" optional).
//   2. LINES         linesFromParts() — script lines from ad_scripts.parts,
//                    with the planned pauses (a blank line after the line).
//   3. ATTEMPTS      findAttempts() — every attempt at every line in every
//                    take, takes ordered by recorded_at.
//   4. STITCH        restarts within 8 s are joined at the word they restart.
//   5. PICK          the latest attempt with 90%+ coverage and no stall over
//                    1.0 s; a dynamic program across lines (0.15 per switch).
//   6. SAID DIFFERENTLY  a line under 85% keeps the speech between its kept
//                    neighbours when that speech is short enough.
//   7. BULLETS       the freestyle middle: 4-word restarts, cue anchors.
//   8. PIECES        silence-gated fillers out, edges 40/80 ms snapped to
//                    silence, gaps 250/450 ms of the source's own pause.

/* ─────────────────────────────────────────────────────────────────────────
   The numbers. The first block is spec §9.2 word for word. The second block
   is not in the spec: each one is a safe default, named here so nobody has
   to ask (written in the U16 report).
   ───────────────────────────────────────────────────────────────────────── */
export const ALIGN_DEFAULTS = Object.freeze({
  /* §9.2 */
  similarity: 0.8,            // edit similarity for words of 5+ letters
  fuzzyMinLetters: 5,
  restartWithin: 8.0,         // a restart joins the attempt it restarts within 8 s
  qualifyCoverage: 0.9,       // an attempt qualifies at 90% coverage ...
  stallOver: 1.0,             // ... and no stall over 1.0 s
  switchCost: 0.15,           // the dynamic program's cost of a take switch
  edgeBefore: 0.04,           // a piece starts 40 ms before the speech
  edgeAfter: 0.08,            // and ends 80 ms after it
  snapWithin: 0.25,           // edges snap to the nearest silence within 250 ms
  gapTail: 0.25,              // a gap keeps up to 250 ms of the source's pause
  plannedGapTail: 0.45,       // or 450 ms at a planned pause
  umSilence: 0.15,            // "um" / "uh" are cut only with 150 ms silence both sides
  likeSilence: 0.25,          // "like" / "you know" only with 250 ms
  saidDifferentlyUnder: 0.85,
  saidDifferentlyMaxRatio: 2, // the neighbours' gap must run under 2x the line
  bulletsRestartWords: 4,     // bullets: a restart is a run of 4+ words ...
  bulletsRestartSilence: 0.4, // ... whose first copy ends in 400 ms of silence ...
  bulletsRestartWithin: 6.0,  // ... and comes back within 6 s
  holdCoverage: 0.7,          // §9.1 step 7: under 70% the take parks at `cut`
  rematchCoverage: 0.5,       // §9.1 step 7: under 50% the match runs again

  /* Safe defaults (not in the spec). */
  minKeepCoverage: 0.5,       // an attempt under 50% is never kept as the line
  wordsPerSecond: 2.5,        // a line's expected length (150 words a minute)
  maxAttemptsPerLine: 8,      // attempts looked for per line per take
  repeatLookback: 8,          // a word repeating one of the last 8 script words is a restart
  fillerTolerance: 0.12,      // a silence "touches" a filler within 120 ms
  roundTo: 3                  // seconds are rounded to the millisecond
});

const EPS = 1e-9;

/* ═════════════════════════════════════════════════════════════════════════
   1. SPOKEN WORDS
   ═════════════════════════════════════════════════════════════════════════ */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** @type {Array<[number, string]>} */
const SCALES = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
const SCALE_WORDS = new Set(["hundred", "thousand", "million", "billion"]);
const NUMBER_WORDS = new Set([...ONES, ...TENS.filter(Boolean), ...SCALE_WORDS]);
/* "a" counts as "one" before these (§9.2). "grand" is here because "a grand"
   is spoken money ("one thousand dollars"). */
const A_IS_ONE_BEFORE = new Set(["hundred", "thousand", "million", "billion", "grand"]);
const SUFFIX_WORD = Object.freeze({ k: "thousand", m: "million", mm: "million", b: "billion", bn: "billion" });
const NUM_RE = /^(\$)?(\d[\d,]*(?:\.\d+)?)(k|mm|m|bn|b)?(%)?$/;

/** The "um / uh" class. Cut only with umSilence on both sides. */
export const UM_WORDS = Object.freeze(new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "hmm", "mm"]));

function under1000(n) {
  const out = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], "hundred"); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) out.push(ONES[n]); }
  else if (n > 0) out.push(ONES[n]);
  return out;
}

/** 300000 → ["three", "hundred", "thousand"]. Digit by digit past a trillion. */
export function numberToWords(n) {
  if (!Number.isSafeInteger(n) || n < 0) return null;
  if (n === 0) return ["zero"];
  if (n >= 1e12) return String(n).split("").map((d) => ONES[Number(d)]);
  const out = [];
  for (const [v, name] of SCALES) {
    if (n >= v) { out.push(...under1000(Math.floor(n / v)), name); n %= v; }
  }
  if (n) out.push(...under1000(n));
  return out;
}

const IRREGULAR = Object.freeze({
  "can't": ["can", "not"], cannot: ["can", "not"], "won't": ["will", "not"], "shan't": ["shall", "not"],
  "ain't": ["is", "not"], "let's": ["let", "us"], "y'all": ["you", "all"],
  gonna: ["going", "to"], wanna: ["want", "to"], gotta: ["got", "to"]
});
/* "<word>'s" means "<word> is" only after these; otherwise it is a possessive. */
const IS_AFTER = new Set(["it", "that", "there", "here", "what", "who", "where", "when", "why", "how", "he",
  "she", "this", "everyone", "everybody", "nobody", "somebody", "someone", "something", "nothing", "everything"]);

/** Contractions expanded (§9.2): "don't" → do not, "you're" → you are. */
export function expandContraction(w) {
  if (IRREGULAR[w]) return IRREGULAR[w];
  let m;
  if ((m = /^(.+)n't$/.exec(w))) return [m[1], "not"];
  if ((m = /^(.+)'re$/.exec(w))) return [m[1], "are"];
  if ((m = /^(.+)'ve$/.exec(w))) return [m[1], "have"];
  if ((m = /^(.+)'ll$/.exec(w))) return [m[1], "will"];
  if ((m = /^(.+)'d$/.exec(w))) return [m[1], "would"];
  if ((m = /^(.+)'m$/.exec(w))) return [m[1], "am"];
  if ((m = /^(.+)'s$/.exec(w))) return IS_AFTER.has(m[1]) ? [m[1], "is"] : [m[1] + "s"];
  return [w];
}

/* One raw word (a whisper word or one word of the script) → its pieces. CAPS
   and ↑ marks are dropped; hyphens, dashes and slashes split words. */
function subTokens(raw, src) {
  const s = String(raw ?? "").toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[↑↓]/g, " ")
    .replace(/[-–—/]+/g, " ");
  const out = [];
  for (let p of s.split(/\s+/)) {
    p = p.replace(/^[^a-z0-9$&%']+/, "").replace(/[^a-z0-9%']+$/, "").replace(/^'+|'+$/g, "");
    if (!p) continue;
    const m = NUM_RE.exec(p);
    if (m) {
      out.push({ kind: "num", dollar: Boolean(m[1]), digits: m[2].replace(/,/g, ""), suffix: m[3] || null, pct: Boolean(m[4]), src });
      continue;
    }
    if (p === "%") { out.push({ kind: "word", w: "percent", src }); continue; }
    if (p === "&") { out.push({ kind: "word", w: "and", src }); continue; }
    if (p === "$") { out.push({ kind: "dollar", src }); continue; }
    for (const w of expandContraction(p)) {
      const clean = w.replace(/[^a-z0-9]/g, "");
      if (clean) out.push({ kind: "word", w: clean, src });
    }
  }
  return out;
}

function numberWords(sub) {
  const [int, frac] = sub.digits.split(".");
  let words = numberToWords(Number(int)) || int.split("").map((d) => ONES[Number(d)]);
  if (frac) words = [...words, "point", ...frac.split("").map((d) => ONES[Number(d)])];
  if (sub.suffix) words.push(SUFFIX_WORD[sub.suffix]);
  return words;
}

/**
 * spokenWords(raws) → [{t, opt, src}] — the words a person says.
 *
 * `raws` is one string or a list of raw words (whisper words keep their own
 * index in `src`, so a cut maps back to real seconds). Numbers need the word
 * after them ("$300 grand", "a hundred"), so a list is read as one stream.
 * "dollars" is optional on both sides (`opt: true`): it never counts against
 * coverage, said or not.
 */
export function spokenWords(raws) {
  const list = Array.isArray(raws) ? raws : String(raws ?? "").split(/\s+/);
  const subs = [];
  list.forEach((raw, i) => subs.push(...subTokens(raw, i)));
  const out = [];
  const push = (t, src, opt = false) => out.push({ t, opt, src });
  const lastIsNumber = () => out.length > 0 && !out[out.length - 1].opt && NUMBER_WORDS.has(out[out.length - 1].t);
  let dollarSign = false;     // a lone "$" waiting for its number
  let dollarAfter = false;    // "$300 thousand": "dollars" waits for the scale word
  for (let k = 0; k < subs.length; k++) {
    const s = subs[k];
    const next = subs[k + 1];
    if (s.kind === "dollar") { dollarSign = true; continue; }
    if (s.kind === "num") {
      for (const w of numberWords(s)) push(w, s.src);
      if (s.pct) push("percent", s.src);
      if (s.dollar || dollarSign) {
        const scaleNext = !s.suffix && next && next.kind === "word" &&
          (SCALE_WORDS.has(next.w) || next.w === "grand" || next.w === "k");
        if (scaleNext) dollarAfter = true;
        else push("dollars", s.src, true);
      }
      dollarSign = false;
      continue;
    }
    let w = s.w;
    if (w === "a" && next && next.kind === "word" && A_IS_ONE_BEFORE.has(next.w)) w = "one";
    if (w === "grand" && lastIsNumber()) {
      push("thousand", s.src);
      push("dollars", s.src, true);
      dollarAfter = false;
      continue;
    }
    if (w === "k" && lastIsNumber()) w = "thousand";
    if (w === "dollar" || w === "dollars") { push("dollars", s.src, true); continue; }
    push(w, s.src);
    if (dollarAfter && SCALE_WORDS.has(w) && !(next && next.kind === "word" && SCALE_WORDS.has(next.w))) {
      push("dollars", s.src, true);
      dollarAfter = false;
    }
  }
  /* Tidy: one optional "dollars" at a time, and the "and" inside a spoken
     number ("a hundred and fifty") is dropped so it matches "150". */
  const tidy = [];
  for (let k = 0; k < out.length; k++) {
    const t = out[k];
    const prev = tidy[tidy.length - 1];
    if (t.opt && prev && prev.opt && prev.t === t.t) continue;
    if (t.t === "and" && prev && SCALE_WORDS.has(prev.t) && out[k + 1] &&
      NUMBER_WORDS.has(out[k + 1].t) && !SCALE_WORDS.has(out[k + 1].t)) continue;
    tidy.push(t);
  }
  return tidy;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** 1 − (edits ÷ the longer word's length). */
export function editSimilarity(a, b) {
  const A = String(a ?? ""), B = String(b ?? "");
  const L = Math.max(A.length, B.length);
  return L ? 1 - levenshtein(A, B) / L : 1;
}

/**
 * wordsMatch(a, b) → 2 same word, 1 close enough, 0 different.
 * Words of 5 or more letters (the longer of the two) match at an edit
 * similarity of 0.8: "lenders"/"lender", "loans"/"loan". Shorter words must
 * be the same word: "fund" is not "find".
 */
export function wordsMatch(a, b, opts = ALIGN_DEFAULTS, cache = null) {
  if (a === b) return 2;
  let key = null;
  if (cache) {
    key = a + "\u0000" + b;
    const seen = cache.get(key);
    if (seen !== undefined) return seen;
  }
  const minLetters = opts?.fuzzyMinLetters ?? ALIGN_DEFAULTS.fuzzyMinLetters;
  const similarity = opts?.similarity ?? ALIGN_DEFAULTS.similarity;
  const v = Math.max(a.length, b.length) >= minLetters && editSimilarity(a, b) >= similarity - EPS ? 1 : 0;
  if (cache) cache.set(key, v);
  return v;
}

/* ═════════════════════════════════════════════════════════════════════════
   2. LINES — from ad_scripts.parts [{kind: hook|line2|body|cue|reveal|cta, text}]
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * linesFromParts(parts, style) → [{line_idx, part_idx, kind, text, tokens,
 * countable, planned_pause, verbatim}]
 *
 * Each non-empty row of a part's text is one line. A line followed by a blank
 * row is a planned pause. The last line of a part is a planned pause when
 * another part follows, except between two cues: that is how the body text
 * reads (parts joined by a blank line, cues one per row; see the U01 contract
 * example). In bullets style a cue is freestyle (`verbatim: false`); every
 * other part, and every part in words style, is said word for word.
 */
export function linesFromParts(parts, style = "words") {
  const list = Array.isArray(parts) ? parts : [];
  const lines = [];
  list.forEach((p, pi) => {
    const kind = String(p?.kind || "body");
    const rows = String(p?.text ?? "").split(/\r?\n/);
    const nextKind = list[pi + 1] ? String(list[pi + 1]?.kind || "body") : null;
    const partEndsInPause = nextKind !== null && !(kind === "cue" && nextKind === "cue");
    rows.forEach((row, ri) => {
      const text = row.trim();
      if (!text) return;
      const tokens = spokenWords(text.split(/\s+/));
      const countable = tokens.filter((t) => !t.opt).length;
      if (!countable) return;
      const rest = rows.slice(ri + 1);
      const nextFull = rest.findIndex((r) => r.trim());
      const planned = nextFull === -1 ? partEndsInPause : nextFull > 0;
      lines.push({
        line_idx: lines.length, part_idx: pi, kind, text, tokens, countable,
        planned_pause: planned,
        verbatim: !(style === "bullets" && kind === "cue")
      });
    });
  });
  return lines;
}

/* ═════════════════════════════════════════════════════════════════════════
   3. TAKES
   ═════════════════════════════════════════════════════════════════════════ */

function parseTime(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/* whisper stretches a word into the pause after it (merge-takes measured a
   0.3 s "call," reported as 0.79 s). A word whose tail lies in a silence ends
   where the silence starts; one whose head lies in a silence starts where the
   silence ends. This is the "snapped to silence" half of §9.2 rule 5 applied
   to the word times, so a gap is measured on real sound, not on a guess. */
function refineWithSilence(w, silences) {
  if (!silences || !silences.length) return;
  let { start, end } = w;
  for (const s of silences) {
    if (s.end <= start || s.start >= end) continue;
    if (s.start <= start && s.end < end) start = Math.max(start, s.end);
    else if (s.start > start && s.end >= end) end = Math.min(end, s.start);
  }
  if (end - start >= 0.05) { w.start = start; w.end = end; }
}

/** One take, made ready: words cleaned, tokens spoken, silences sorted.
    `silences` missing (null) means "not measured": gaps are then read from
    the word times. An empty list means "measured, none found". */
export function prepareTake(raw, inputIdx = 0) {
  const words = [];
  for (const w of raw?.words || []) {
    const text = String(w?.w ?? w?.word ?? w?.text ?? "").trim();
    const start = Number(w?.start);
    const end = Number(w?.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (/^[[(].*[\])]$/.test(text)) continue;                  // [BLANK_AUDIO], (music)
    if (!/[a-z0-9$%&]/i.test(text)) continue;                   // punctuation alone
    words.push({ w: text, start, end: Math.max(end, start) });
  }
  words.sort((a, b) => a.start - b.start);
  const silences = Array.isArray(raw?.silences)
    ? raw.silences.map((s) => ({ start: Number(s?.start), end: Number(s?.end) }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
      .sort((a, b) => a.start - b.start)
    : null;
  for (const w of words) refineWithSilence(w, silences);
  const toks = spokenWords(words.map((w) => w.w)).map((t) => ({
    t: t.t, opt: t.opt, wi: t.src, start: words[t.src].start, end: words[t.src].end, um: UM_WORDS.has(t.t)
  }));
  const duration = Number(raw?.duration);
  return {
    take_id: raw?.take_id ?? null,
    recorded_at: raw?.recorded_at ?? null,
    rec: parseTime(raw?.recorded_at),
    inputIdx,
    order: inputIdx,
    words,
    toks,
    silences,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null
  };
}

/* ═════════════════════════════════════════════════════════════════════════
   4. ATTEMPTS — local alignment of one line against one take
   ═════════════════════════════════════════════════════════════════════════ */

/* Scores, whole numbers. A word that repeats one of the script words just
   said costs three gaps, so a restart is never swallowed into the attempt
   before it: the cheaper path skips the FIRST copy and keeps the second. */
const S = Object.freeze({ exact: 4, fuzzy: 3, sub: -3, gap: -2, filler: -1, repeat: -6 });

function matchMatrix(L, T, ctx) {
  const m = L.length, n = T.length;
  const M = new Uint8Array(m * n);
  for (let x = 0; x < m; x++) {
    for (let j = 0; j < n; j++) M[x * n + j] = wordsMatch(L[x].t, T[j].t, ctx.o, ctx.cache);
  }
  return M;
}

function alignLine(L, T, M, mask, o) {
  const m = L.length, n = T.length, W = n + 1;
  const H = new Int32Array((m + 1) * W);
  const D = new Uint8Array((m + 1) * W);
  /* A silence longer than the restart window ends any attempt: what comes
     after it is a new attempt, never the same one (§9.2 rule 3's 8 s). */
  const wall = new Uint8Array(n);
  for (let j = 1; j < n; j++) if (T[j].start - T[j - 1].end > o.restartWithin + EPS) wall[j] = 1;
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= m; i++) {
    const a = L[i - 1];
    for (let j = 1; j <= n; j++) {
      if (mask[j - 1]) continue;                                   // a claimed word is a wall
      const k = i * W + j;
      const b = T[j - 1];
      const mt = M[(i - 1) * n + (j - 1)];
      const cut = wall[j - 1] === 1;
      const diag = (cut ? 0 : H[k - W - 1]) + (mt === 2 ? S.exact : mt === 1 ? S.fuzzy : S.sub);
      const up = H[k - W] + (a.opt ? 0 : S.gap);
      /** @type {number} */
      let ins = S.gap;
      if (b.opt) ins = 0;
      else if (b.um) ins = S.filler;
      else {
        for (let x = i - 1; x >= 0 && x >= i - o.repeatLookback; x--) {
          if (!L[x].opt && M[x * n + (j - 1)]) { ins = S.repeat; break; }
        }
      }
      const left = (cut ? 0 : H[k - 1]) + ins;
      let v = 0, d = 0;
      if (diag > v) { v = diag; d = cut ? 4 : 1; }                  // 4: the path starts here
      if (up > v) { v = up; d = 2; }
      if (left > v) { v = left; d = 3; }
      H[k] = v; D[k] = d;
      if (v > best) { best = v; bi = i; bj = j; }
    }
  }
  if (best <= 0) return null;
  const ops = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0) {
    const d = D[i * W + j];
    if (!d) break;
    if (d === 1 || d === 4) {
      const mt = M[(i - 1) * n + (j - 1)];
      ops.push({ type: mt === 2 ? "match" : mt === 1 ? "fuzzy" : "sub", i: i - 1, j: j - 1 });
      if (d === 4) break;
      i--; j--;
    } else if (d === 2) { ops.push({ type: "del", i: i - 1, j: -1 }); i--; }
    else { ops.push({ type: "ins", i: -1, j: j - 1 }); j--; }
  }
  ops.reverse();
  return { score: best, ops };
}

const isHit = (op) => op.type === "match" || op.type === "fuzzy";

/* An inserted run that says the next script words again is the abandoned
   first copy of a restart ("that get a— that get a 760"). A cut-off word
   ("hid-") counts when the next script word starts with it. */
function isRestartRemnant(run, b, bTok, L, take, ctx) {
  const T = take.toks;
  const core = run.filter((j) => !T[j].opt && !T[j].um);
  if (!core.length || !L[b]) return false;
  if (T[bTok].start - T[run[run.length - 1]].end > ctx.o.restartWithin + EPS) return false;
  const first = T[core[0]];
  const raw = take.words[first.wi]?.w || "";
  const fragment = /[-–—]$/.test(raw) && L[b].t.startsWith(first.t) && first.t.length < L[b].t.length;
  if (!fragment && !wordsMatch(first.t, L[b].t, ctx.o, ctx.cache)) return false;
  if (fragment && core.length === 1) return true;
  let x = b, hits = 0;
  for (const j of core) {
    for (let y = x; y < Math.min(L.length, b + core.length + 2); y++) {
      if (wordsMatch(T[j].t, L[y].t, ctx.o, ctx.cache)) { hits++; x = y + 1; break; }
    }
  }
  return hits >= Math.ceil(core.length / 2);
}

function stallsIn(keep, take, o) {
  const T = take.toks;
  const out = [];
  let prev = -1, prevPos = -1;
  keep.forEach((k, pos) => {
    if (T[k].um) return;
    if (prev >= 0 && k - prev === pos - prevPos) {             // nothing cut between them
      const gap = T[k].start - T[prev].end;
      if (gap > o.stallOver + EPS) out.push({ at: T[prev].end, seconds: gap, k: prev });
    }
    prev = k; prevPos = pos;
  });
  return out;
}

function finishCandidate(c, line, take, o) {
  c.keep = [...new Set(c.keep)].sort((a, b) => a - b);
  const idxs = [...c.map.keys()];
  c.matched = c.map.size;
  c.first = idxs.length ? Math.min(...idxs) : -1;
  c.last = idxs.length ? Math.max(...idxs) : -1;
  c.coverage = line.countable ? c.matched / line.countable : 0;
  c.firstTok = c.keep[0];
  c.lastTok = c.keep[c.keep.length - 1];
  c.start = take.toks[c.firstTok].start;
  c.end = Math.max(...c.keep.map((k) => take.toks[k].end));
  c.stalls = stallsIn(c.keep, take, o);
  c.qualifies = c.coverage >= o.qualifyCoverage - EPS && c.stalls.length === 0;
  return c;
}

function describeHit(line, take, aligned, ctx) {
  const L = line.tokens;
  const { ops, score } = aligned;
  const remove = new Set();
  for (let x = 0; x < ops.length;) {
    if (ops[x].type !== "ins") { x++; continue; }
    let y = x;
    while (y + 1 < ops.length && ops[y + 1].type === "ins") y++;
    let z = y + 1;
    while (z < ops.length && ops[z].type === "del") z++;
    if (z < ops.length && isHit(ops[z])) {
      const run = ops.slice(x, y + 1).map((op) => op.j);
      if (isRestartRemnant(run, ops[z].i, ops[z].j, L, take, ctx)) run.forEach((j) => remove.add(j));
    }
    x = y + 1;
  }
  const keep = [];
  const map = new Map();
  const scripted = new Set();
  for (const op of ops) {
    if (op.j >= 0 && !remove.has(op.j)) keep.push(op.j);
    if (isHit(op)) {
      scripted.add(op.j);
      if (!L[op.i].opt && !map.has(op.i)) map.set(op.i, op.j);
    }
  }
  const tj = ops.filter((op) => op.j >= 0).map((op) => op.j);
  const c = {
    kind: "attempt", line_idx: line.line_idx, take, keep, map, scripted, score,
    span: [Math.min(...tj), Math.max(...tj)], when: 0, stitched: false
  };
  finishCandidate(c, line, take, ctx.o);
  c.when = c.start;
  return c;
}

/* Spec §9.2 rule 3: attempt A covers words 1..k; a later attempt B starts at
   word j, with j ≤ k+1, within 8 s. Join them at word j: A's words before j,
   then B. Both A and B stay candidates too, so a complete A is never lost to
   a half restart. */
function chain(P, B, line, take, o) {
  const j = B.first;
  let cut = -1;
  for (const [i, k] of P.map) if (i < j && k > cut) cut = k;
  if (cut < 0) return null;
  const map = new Map([...P.map].filter(([i]) => i < j));
  for (const [i, k] of B.map) map.set(i, k);
  const c = {
    kind: "attempt", line_idx: line.line_idx, take,
    keep: [...P.keep.filter((k) => k <= cut), ...B.keep],
    map,
    scripted: new Set([...[...P.scripted].filter((k) => k <= cut), ...B.scripted]),
    score: P.score + B.score,
    span: [P.span[0], B.span[1]], when: B.when, stitched: true
  };
  return finishCandidate(c, line, take, o);
}

function stitchRestarts(hits, line, take, o) {
  const cands = [];
  for (const B of [...hits].sort((a, b) => a.start - b.start)) {
    let pred = null;
    for (const P of cands) {
      if (P.lastTok >= B.firstTok) continue;
      const gap = B.start - P.end;
      if (gap < -EPS || gap > o.restartWithin + EPS) continue;
      if (B.first > P.last + 1 || B.first <= P.first) continue;
      if (!pred || P.end > pred.end + EPS || (Math.abs(P.end - pred.end) <= EPS && P.coverage > pred.coverage)) pred = P;
    }
    cands.push(B);
    if (pred) {
      const c = chain(pred, B, line, take, o);
      if (c) cands.push(c);
    }
  }
  return cands;
}

/* Two lines with the very same words (the hook said again as the last line)
   find the very same attempts, and the first of them in script order would
   claim every copy. Share the copies out by where they sit in the take: a
   copy belongs to the first of those lines that comes after the nearest
   other line said before it (hook, body, hook: the second copy follows the
   body, so it is the last line's). Then a line left with no copy takes one
   from an identical line that holds two or more: the latest copy when it
   comes later in the script, the earliest when it comes before. */
function shareIdenticalLines(lines, all, byLine) {
  const groups = new Map();
  for (const line of lines) {
    if (!line.verbatim) continue;
    const key = line.tokens.map((t) => t.t + (t.opt ? "?" : "")).join(" ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line.line_idx);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const inGroup = new Set(group);
    const copies = group.flatMap((x) => byLine.get(x) || []).sort((a, b) => a.start - b.start);
    if (!copies.length) continue;
    const others = [...byLine.entries()].filter(([x]) => !inGroup.has(x)).flatMap(([, hs]) => hs);
    /** @type {Map<number, any[]>} */
    const owner = new Map(group.map((x) => [x, []]));
    for (const c of copies) {
      let before = null;
      for (const h of others) if (h.end <= c.start + EPS && (!before || h.end > before.end)) before = h;
      const after = before ? before.line_idx : -1;
      const x = group.find((g) => g > after) ?? group[group.length - 1];
      owner.get(x)?.push(c);
    }
    for (const x of group) {
      if (owner.get(x)?.length) continue;
      const donor = group.filter((g) => (owner.get(g)?.length ?? 0) >= 2)
        .sort((a, b) => Math.abs(a - x) - Math.abs(b - x))[0];
      if (donor === undefined) continue;
      const held = owner.get(donor) ?? [];
      owner.get(x)?.push(x > donor ? held.pop() : held.shift());
    }
    /* Each line keeps its own attempt objects: the same words found by that
       line's own alignment. */
    /** @type {Map<number, any[]>} */
    const next = new Map(group.map((x) => [x, []]));
    for (const x of group) {
      for (const c of owner.get(x) ?? []) {
        const own = c.line_idx === x ? c
          : all.find((h) => h.line_idx === x && h.span[0] === c.span[0] && h.span[1] === c.span[1]);
        next.get(own ? x : c.line_idx)?.push(own || c);
      }
    }
    for (const x of group) {
      const list = next.get(x) ?? [];
      if (list.length) byLine.set(x, list);
      else byLine.delete(x);
    }
  }
}

/**
 * findAttempts(lines, take, opts) → Map(line_idx → candidates in that take).
 *
 * Every attempt at every word-for-word line (§9.2 rule 2). Each line is
 * aligned to the take again and again, walling off each attempt it finds.
 * Then the take's words are shared out — a word belongs to one attempt only,
 * the most matched words first — and restarts are stitched (rule 3).
 */
export function findAttempts(lines, take, opts = {}, cache = new Map()) {
  const o = { ...ALIGN_DEFAULTS, ...opts };
  const ctx = { o, cache };
  const T = take.toks;
  const all = [];
  for (const line of lines) {
    if (!line.verbatim || !T.length) continue;
    const M = matchMatrix(line.tokens, T, ctx);
    const mask = new Uint8Array(T.length);
    for (let a = 0; a < o.maxAttemptsPerLine; a++) {
      const aligned = alignLine(line.tokens, T, M, mask, o);
      if (!aligned) break;
      const hit = describeHit(line, take, aligned, ctx);
      const enough = hit.matched >= 2 || (line.countable <= 2 && hit.matched === line.countable && hit.matched >= 1);
      if (!enough || !hit.keep.length) break;
      all.push(hit);
      for (let q = hit.span[0]; q <= hit.span[1]; q++) mask[q] = 1;
    }
  }
  /* Most matched words first, then the most complete. A short line that is a
     piece of a longer one ("Grab your roadmap." inside "Tap below and grab
     your roadmap today.") matches inside every reading of the longer line;
     sorting by coverage alone would hand it those words whenever the longer
     reading missed a word, and throw the longer line's attempt away. */
  all.sort((a, b) => (b.score - a.score) || (b.coverage - a.coverage) || (a.span[0] - b.span[0]));
  const claimed = new Uint8Array(T.length);
  const byLine = new Map();
  for (const h of all) {
    let free = true;
    for (let q = h.span[0]; q <= h.span[1]; q++) if (claimed[q]) { free = false; break; }
    if (!free) continue;
    for (let q = h.span[0]; q <= h.span[1]; q++) claimed[q] = 1;
    if (!byLine.has(h.line_idx)) byLine.set(h.line_idx, []);
    byLine.get(h.line_idx).push(h);
  }
  shareIdenticalLines(lines, all, byLine);
  const out = new Map();
  for (const line of lines) {
    const hits = byLine.get(line.line_idx);
    if (hits) out.set(line.line_idx, stitchRestarts(hits, line, take, o));
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════════════════
   5. PICK — §9.2 rule 4
   ═════════════════════════════════════════════════════════════════════════ */

const later = (a, b) => a.take.order > b.take.order || (a.take.order === b.take.order && a.when > b.when + EPS);

/* One take's attempt at one line: the latest that qualifies (90%+ coverage,
   no stall over 1.0 s); if none does, the highest coverage, and on a tie the
   latest. */
function representative(cands) {
  if (!cands || !cands.length) return null;
  const q = cands.filter((c) => c.qualifies);
  if (q.length) {
    return q.reduce((a, b) => (b.when > a.when + EPS || (Math.abs(b.when - a.when) <= EPS && b.coverage > a.coverage)) ? b : a);
  }
  return cands.reduce((a, b) => (b.coverage > a.coverage + EPS ||
    (Math.abs(b.coverage - a.coverage) <= EPS && b.when >= a.when - EPS)) ? b : a);
}

/* The options for one line across takes: every take's qualifying attempt;
   if no take has one, the highest coverage (ties all stay in, so the dynamic
   program can keep the take it is already in). */
function optionsFrom(reps, o) {
  const usable = reps.filter((c) => c && c.coverage >= o.minKeepCoverage - EPS);
  const q = usable.filter((c) => c.qualifies);
  if (q.length) return q;
  if (!usable.length) return [];
  const top = Math.max(...usable.map((c) => c.coverage));
  return usable.filter((c) => c.coverage >= top - EPS);
}

/* The dynamic program across lines: cost = (1 − coverage) + switchCost for
   each switch between takes. Ties go to the later attempt. */
function choose(units, o) {
  let prev = null;
  for (const u of units) {
    if (!u.options.length) continue;
    const cur = u.options.map((c) => {
      const cost = 1 - c.coverage;
      if (!prev) return { cand: c, unit: u, total: cost, back: null };
      let best = null;
      for (const p of prev) {
        const total = p.total + cost + (p.cand.take.order !== c.take.order ? o.switchCost : 0);
        if (!best || total < best.total - EPS || (Math.abs(total - best.total) <= EPS && later(p.cand, best.back.cand))) {
          best = { cand: c, unit: u, total, back: p };
        }
      }
      return best;
    });
    prev = cur;
  }
  const picks = new Map();
  if (!prev) return picks;
  let end = null;
  for (const s of prev) {
    if (!end || s.total < end.total - EPS || (Math.abs(s.total - end.total) <= EPS && later(s.cand, end.cand))) end = s;
  }
  for (let s = end; s; s = s.back) picks.set(s.unit, s.cand);
  return picks;
}

/* ═════════════════════════════════════════════════════════════════════════
   6. BULLETS — the freestyle middle
   ═════════════════════════════════════════════════════════════════════════ */

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with",
  "your", "you", "my", "our", "we", "it", "is", "are", "be", "this", "that", "they", "them", "their", "i",
  "me", "so", "if", "then", "than", "as", "by", "from", "what", "which", "who", "how", "not", "do", "does",
  "can", "will", "just", "all", "any", "he", "she", "his", "her", "its", "was", "were", "have", "has", "had"]);

/** A cue's keywords: its words minus the small ones, and minus any word
    another cue in the same run also has ("file" in "the personal file" and
    "the business file" says nothing about which cue Chris is on). */
export function cueKeywords(text, otherCues = []) {
  const words = (s) => spokenWords(String(s ?? "").split(/\s+/)).filter((t) => !t.opt).map((t) => t.t);
  const toks = words(text);
  const keys = toks.filter((t) => !STOPWORDS.has(t) && t.length >= 3);
  const others = new Set(otherCues.flatMap(words));
  const own = keys.filter((t) => !others.has(t));
  return own.length ? own : keys.length ? keys : toks;
}

function silenceSpan(take, t0, t1, minDur, o) {
  if (take.silences) {
    return take.silences.some((s) => Math.min(s.end, t1 + o.fillerTolerance) - Math.max(s.start, t0 - o.fillerTolerance) >= minDur - EPS);
  }
  let last = t0;
  for (const w of take.words) {
    if (w.end <= t0 + EPS) continue;
    if (w.start >= t1 - EPS) break;
    if (w.start - last >= minDur - EPS) return true;
    last = Math.max(last, w.end);
  }
  return t1 - last >= minDur - EPS;
}

/* §9.2 bullets: a restart is a run of 4+ words that repeats; its first copy
   ends in 400 ms of silence and it comes back within 6 s. Keep the last copy.
   `seq` may run on into the next line (the reveal), so a false start of the
   reveal inside the middle is caught too; only the first `limit` entries of
   `seq` (the middle) are ever removed. */
function bulletRestarts(seq, limit, take, o, ctx) {
  const T = take.toks;
  const F = [];
  seq.forEach((k, pos) => { if (!T[k].um) F.push({ k, pos }); });
  const removed = new Set();
  let p = 0;
  while (p < F.length) {
    let found = -1;
    for (let q = p + 1; q < F.length; q++) {
      if (T[F[q].k].start - T[F[p].k].end > o.bulletsRestartWithin + 60) break;
      let r = 0;
      while (q + r < F.length && p + r < q && wordsMatch(T[F[p + r].k].t, T[F[q + r].k].t, ctx.o, ctx.cache)) r++;
      if (!r) continue;
      const words = new Set(F.slice(p, p + r).map((f) => T[f.k].wi)).size;
      if (words < o.bulletsRestartWords) continue;
      const endFirst = T[F[p + r - 1].k].end;
      const startSecond = T[F[q].k].start;
      if (startSecond - endFirst > o.bulletsRestartWithin + EPS) continue;
      if (!silenceSpan(take, endFirst, startSecond, o.bulletsRestartSilence, o)) continue;
      found = q;
      break;
    }
    if (found >= 0 && F[p].pos < limit) {
      for (let pos = F[p].pos; pos < F[found].pos && pos < limit; pos++) removed.add(seq[pos]);
      p = found;
    } else p++;
  }
  return removed;
}

function middleCandidate(unit, before, after, take, repOf, o, ctx) {
  const T = take.toks;
  let lo = 0, hi = T.length - 1, afterRep = null;
  if (before) {
    const r = repOf(before, take);
    if (!r) return null;
    lo = r.lastTok + 1;
  }
  if (after) {
    afterRep = repOf(after, take);
    if (!afterRep) return null;
    hi = afterRep.firstTok - 1;
  }
  if (hi < lo) return null;
  const mid = [];
  for (let k = lo; k <= hi; k++) mid.push(k);
  const seq = afterRep ? [...mid, ...afterRep.keep.slice(0, 40)] : mid;
  const removed = bulletRestarts(seq, mid.length, take, o, ctx);
  const keep = mid.filter((k) => !removed.has(k));
  if (!keep.some((k) => !T[k].um)) return null;

  const cues = [];
  let from = 0;
  for (const [ci, ln] of unit.lines.entries()) {
    const keys = cueKeywords(ln.text, unit.lines.filter((x) => x !== ln).map((x) => x.text));
    let pos = -1;
    for (let x = from; x < keep.length && pos < 0; x++) {
      if (keys.some((key) => wordsMatch(key, T[keep[x]].t, ctx.o, ctx.cache))) pos = x;
    }
    cues.push({ cue: ci + 1, line_idx: ln.line_idx, pos, keywords: keys });
    if (pos >= 0) from = pos + 1;
  }
  const lineOf = new Map();
  keep.forEach((k, x) => {
    let line = unit.lines[0].line_idx;
    for (const c of cues) if (c.pos >= 0 && c.pos <= x) line = c.line_idx;
    lineOf.set(k, line);
  });
  const heard = cues.filter((c) => c.pos >= 0).length;
  const c = {
    kind: "middle", take, keep, lineOf, cues, map: new Map(), scripted: new Set(),
    coverage: unit.lines.length ? heard / unit.lines.length : 0,
    firstTok: keep[0], lastTok: keep[keep.length - 1],
    start: T[keep[0]].start, end: Math.max(...keep.map((k) => T[k].end)),
    stalls: stallsIn(keep, take, o)
  };
  c.qualifies = c.coverage >= o.qualifyCoverage - EPS && c.stalls.length === 0;
  c.when = c.start;
  return c;
}

/* ═════════════════════════════════════════════════════════════════════════
   7. SAID DIFFERENTLY — §9.2 rule 7
   ═════════════════════════════════════════════════════════════════════════ */

function stretchCandidate(line, prevPick, nextPick, used, o, ctx) {
  if (!prevPick || !nextPick || prevPick.take !== nextPick.take) return null;
  const take = prevPick.take;
  const T = take.toks;
  const lo = prevPick.lastTok + 1, hi = nextPick.firstTok - 1;
  if (hi < lo) return null;
  const keep = [];
  for (let k = lo; k <= hi; k++) {
    if (used.get(take)?.has(k)) return null;                    // never play a word twice
    keep.push(k);
  }
  const speech = keep.filter((k) => !T[k].um);
  if (!speech.length) return null;
  const seconds = T[speech[speech.length - 1]].end - T[speech[0]].start;
  const expected = line.countable / o.wordsPerSecond;
  if (seconds >= o.saidDifferentlyMaxRatio * expected - EPS) return null;
  /* How much of the line is in that speech. A stretch with none of the
     line's words is not the line said differently: the line is missing. */
  const sub = keep.map((k) => T[k]);
  const M = matchMatrix(line.tokens, sub, ctx);
  const aligned = alignLine(line.tokens, sub, M, new Uint8Array(sub.length), o);
  const map = new Map();
  const scripted = new Set();
  for (const op of aligned?.ops || []) {
    if (!isHit(op)) continue;
    scripted.add(keep[op.j]);
    if (!line.tokens[op.i].opt && !map.has(op.i)) map.set(op.i, keep[op.j]);
  }
  if (!map.size) return null;
  const c = { kind: "stretch", line_idx: line.line_idx, take, keep, map, scripted, span: [lo, hi], score: 0, when: 0 };
  finishCandidate(c, line, take, o);
  c.when = c.start;
  return c;
}

/* ═════════════════════════════════════════════════════════════════════════
   8. PIECES — fillers, edges, gaps
   ═════════════════════════════════════════════════════════════════════════ */

const round = (x, places) => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};

function silenceAround(take, t, side, o) {
  if (take.silences) {
    let best = 0;
    for (const s of take.silences) {
      const touches = side === "before"
        ? (Math.abs(s.end - t) <= o.fillerTolerance + EPS || (s.start <= t && s.end >= t))
        : (Math.abs(s.start - t) <= o.fillerTolerance + EPS || (s.start <= t && s.end >= t));
      if (touches) best = Math.max(best, s.end - s.start);
    }
    return best;
  }
  return null;
}

function gapBefore(take, wi, o) {
  const w = take.words[wi];
  const s = silenceAround(take, w.start, "before", o);
  if (s !== null) return s;
  return wi > 0 ? w.start - take.words[wi - 1].end : w.start;
}

function gapAfter(take, wi, o) {
  const w = take.words[wi];
  const s = silenceAround(take, w.end, "after", o);
  if (s !== null) return s;
  if (wi + 1 < take.words.length) return take.words[wi + 1].start - w.end;
  return take.duration !== null ? take.duration - w.end : Infinity;
}

function wordToks(take, wi) {
  return take.toks.filter((t) => t.wi === wi && !t.opt).map((t) => t.t);
}

/* §9.2 rule 6: "um"/"uh" go only with 150 ms of silence on both sides;
   "like" and "you know" only with 250 ms. A word the script itself says is
   never a filler. Returns how many words to drop at index x (0, 1 or 2). */
function gatedFiller(E, x, o) {
  const e = E[x];
  if (e.scripted) return 0;
  const toks = wordToks(e.take, e.wi);
  if (toks.length !== 1) return 0;
  let thr = null, last = e;
  if (UM_WORDS.has(toks[0])) thr = o.umSilence;
  else if (toks[0] === "like" && !e.protect.has("like")) thr = o.likeSilence;
  else if (toks[0] === "you" && !e.protect.has("you know")) {
    const n = E[x + 1];
    if (n && n.take === e.take && n.wi === e.wi + 1 && !n.scripted) {
      const nt = wordToks(n.take, n.wi);
      if (nt.length === 1 && nt[0] === "know") { thr = o.likeSilence; last = n; }
    }
  }
  if (thr === null) return 0;
  const ok = gapBefore(e.take, e.wi, o) >= thr - EPS && gapAfter(last.take, last.wi, o) >= thr - EPS;
  return ok ? (last === e ? 1 : 2) : 0;
}

function silenceAt(take, t) {
  if (!take.silences) return null;
  return take.silences.find((s) => s.start - EPS <= t && t <= s.end + EPS) || null;
}

/* Snap a cut to the nearest silence within snapWithin, never past the speech
   it bounds (lo..hi). Inside a silence already: it stays. */
function snap(take, t, lo, hi, o) {
  if (!take.silences || !take.silences.length) return t;
  if (silenceAt(take, t)) return t;
  let best = null, bestD = Infinity;
  for (const s of take.silences) {
    const p = Math.min(Math.max(t, s.start), s.end);
    const d = Math.abs(p - t);
    if (d > o.snapWithin + EPS || p < lo - EPS || p > hi + EPS) continue;
    if (d < bestD) { best = p; bestD = d; }
  }
  return best === null ? t : best;
}

function buildPieces(E, o) {
  /* Group the kept words into pieces: a new piece wherever the next word is
     not the very next word of the same take, or the pause between them is too
     long — over 1.0 s inside a line (a stall), or more than the two edges plus
     the gap's tail between lines. */
  const tailFor = (e) => (e.lastOfUnit && e.plannedPause ? o.plannedGapTail : o.gapTail);
  const groups = [];
  let cur = null;
  for (let x = 0; x < E.length; x++) {
    const e = E[x], p = E[x - 1];
    let cont = false;
    if (p && p.take === e.take && e.wi === p.wi + 1) {
      const gap = e.take.words[e.wi].start - p.take.words[p.wi].end;
      cont = p.unit === e.unit
        ? gap <= o.stallOver + EPS
        : gap <= o.edgeAfter + tailFor(p) + o.edgeBefore + EPS;
    }
    if (cont) cur.push(e);
    else { cur = [e]; groups.push(cur); }
  }

  const pieces = groups.map((g, gi) => {
    const take = g[0].take;
    const W = take.words;
    const first = g[0], last = g[g.length - 1];
    const fw = W[first.wi], lw = W[last.wi];
    const prevEnd = first.wi > 0 ? W[first.wi - 1].end : 0;
    const nextStart = last.wi + 1 < W.length ? W[last.wi + 1].start : (take.duration ?? Infinity);
    /* 40 ms before the speech, snapped to silence, never into the word before. */
    let start = snap(take, fw.start - o.edgeBefore, prevEnd, fw.start, o);
    start = Math.min(Math.max(start, prevEnd, 0), fw.start);
    /* 80 ms after the speech, snapped to silence, never into the word after. */
    let end = snap(take, lw.end + o.edgeAfter, lw.end, nextStart, o);
    end = Math.max(Math.min(end, nextStart), lw.end);
    if (take.duration !== null) end = Math.min(end, take.duration);
    /* The gap: extend the tail into the source's own pause, by up to 250 ms
       (450 ms at a planned pause). Only into silence, never past the next
       word; the very last piece of the ad gets no tail. Nothing is added
       that the take does not hold: no inserted silence, no frozen frame. */
    if (gi < groups.length - 1) {
      const tail = tailFor(last);
      let bound;
      if (take.silences) {
        const s = silenceAt(take, end);
        bound = s ? Math.min(s.end, nextStart - o.edgeBefore) : end;
      } else {
        /* No silences and no next word: with the file's length unknown there
           is no proof of any air after the edge, so no tail. */
        bound = Number.isFinite(nextStart) ? nextStart - o.edgeBefore : end;
      }
      if (take.duration !== null) bound = Math.min(bound, take.duration);
      end = Math.max(end, Math.min(end + tail, bound));
    }
    return { take, start, end, entries: g };
  });

  /* Two pieces of one take never share a moment of its audio. */
  const byTake = new Map();
  for (const p of pieces) {
    if (!byTake.has(p.take)) byTake.set(p.take, []);
    byTake.get(p.take).push(p);
  }
  for (const list of byTake.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let x = 1; x < sorted.length; x++) {
      const A = sorted[x - 1], B = sorted[x];
      if (B.start >= A.end) continue;
      const aSpeech = A.take.words[A.entries[A.entries.length - 1].wi].end;
      A.end = Math.max(aSpeech, B.start);
      if (B.start < A.end) B.start = Math.min(A.end, B.take.words[B.entries[0].wi].start);
    }
  }
  return pieces;
}

/* ═════════════════════════════════════════════════════════════════════════
   9. alignTakes — the cut plan
   ═════════════════════════════════════════════════════════════════════════ */

const HOLD_KINDS = Object.freeze({ hook: "the hook", line2: "line 2", cta: "the call to action" });

/**
 * alignTakes({takes, parts, style, opts}) → the cut plan (ad_videos.cut_plan).
 *
 * takes:  [{take_id, recorded_at, words: [{w, start, end}], silences: [{start, end}], duration?}]
 * parts:  ad_scripts.parts — [{kind: hook|line2|body|cue|reveal|cta, text}]
 * style:  'words' | 'bullets'
 *
 * Returns
 *   pieces           [{take_id, start, end, line_idx, lines, out_start, out_end, words}] in play order
 *   missing_lines    [line_idx]
 *   said_differently [{line_idx, said, coverage, how}]
 *   coverage         0..1, the script's words heard in the cut (bullets: cues count by their words)
 *   stalls           [{line_idx, take_id, at, seconds}] pauses over 1.0 s inside kept speech (cut down)
 *   ok               false when §9.1 step 7 parks the take (hook, line 2 or CTA missing, or coverage < 70%)
 * plus lines (each line's state for the approval screen), cues (bullets anchors),
 * hold_reasons, rematch (coverage < 50%), takes and duration.
 */
export function alignTakes({ takes = [], parts = [], style = "words", opts = {} } = {}) {
  const o = { ...ALIGN_DEFAULTS, ...opts };
  const cache = new Map();
  const ctx = { o, cache };
  const st = style === "bullets" ? "bullets" : "words";
  const lines = linesFromParts(parts, st);

  /* Takes in the order they were filmed (§9.2 rule 2). A take with no
     recorded_at goes after the dated ones, in the order it was given. */
  const prepared = (Array.isArray(takes) ? takes : []).map((t, i) => prepareTake(t, i))
    .sort((a, b) => ((a.rec ?? Infinity) - (b.rec ?? Infinity)) || (a.inputIdx - b.inputIdx));
  prepared.forEach((t, i) => { t.order = i; });

  /* Units: one per word-for-word line; in bullets style each run of cues is
     one freestyle middle. */
  const units = [];
  for (let x = 0; x < lines.length;) {
    if (lines[x].verbatim) { units.push({ kind: "line", lines: [lines[x]], line: lines[x], options: [] }); x++; continue; }
    let y = x;
    while (y + 1 < lines.length && !lines[y + 1].verbatim) y++;
    units.push({ kind: "middle", lines: lines.slice(x, y + 1), line: null, options: [] });
    x = y + 1;
  }

  const attempts = new Map(prepared.map((t) => [t, findAttempts(lines, t, o, cache)]));
  const repCache = new Map();
  const repOf = (line, take) => {
    const key = line.line_idx + ":" + take.order;
    if (!repCache.has(key)) {
      const r = representative(attempts.get(take).get(line.line_idx));
      repCache.set(key, r && r.coverage >= o.minKeepCoverage - EPS ? r : null);
    }
    return repCache.get(key);
  };

  units.forEach((u, ui) => {
    if (u.kind === "line") {
      u.options = optionsFrom(prepared.map((t) => repOf(u.line, t)), o);
    } else {
      const before = units[ui - 1]?.kind === "line" ? units[ui - 1].line : null;
      const after = units[ui + 1]?.kind === "line" ? units[ui + 1].line : null;
      const cands = prepared.map((t) => middleCandidate(u, before, after, t, repOf, o, ctx)).filter(Boolean);
      const q = cands.filter((c) => c.qualifies);
      if (q.length) u.options = q;
      else if (cands.length) {
        const top = Math.max(...cands.map((c) => c.coverage));
        u.options = cands.filter((c) => c.coverage >= top - EPS);
      }
    }
  });

  const picks = choose(units, o);

  /* Rule 7, then the final selection per unit. Word-for-word picks claim
     their words first; a stretch never reuses a word; a middle drops any
     word another unit already plays. */
  const used = new Map();
  const claim = (c) => {
    if (!used.has(c.take)) used.set(c.take, new Set());
    for (const k of c.keep) used.get(c.take).add(k);
  };
  for (const u of units) if (u.kind === "line" && picks.get(u)) claim(picks.get(u));
  const solid = (u) => {
    const p = u ? picks.get(u) : null;
    if (!p) return null;
    return u.kind === "middle" || p.coverage >= o.saidDifferentlyUnder - EPS ? p : null;
  };
  const final = new Map();
  units.forEach((u, ui) => {
    const pick = picks.get(u) || null;
    if (u.kind === "middle") { if (pick) final.set(u, { cand: pick, state: "kept" }); return; }
    if (pick && pick.coverage >= o.saidDifferentlyUnder - EPS) { final.set(u, { cand: pick, state: "kept" }); return; }
    const prevPick = solid(units[ui - 1]), nextPick = solid(units[ui + 1]);
    if (prevPick && nextPick) {
      const mine = pick ? used.get(pick.take) : null;
      if (pick && mine) for (const k of pick.keep) mine.delete(k);
      const s = stretchCandidate(u.line, prevPick, nextPick, used, o, ctx);
      if (s) { claim(s); final.set(u, { cand: s, state: "said_differently", how: "between_neighbors" }); return; }
      if (pick) claim(pick);
    }
    if (pick) final.set(u, { cand: pick, state: "said_differently", how: "best_attempt" });
  });
  for (const u of units) {
    const f = final.get(u);
    if (!f || u.kind !== "middle") continue;
    const taken = used.get(f.cand.take);
    const keep = f.cand.keep.filter((k) => !taken?.has(k));
    if (!keep.some((k) => !f.cand.take.toks[k].um)) { final.delete(u); continue; }
    f.keep = keep;
    claim({ take: f.cand.take, keep });
  }

  /* The kept words, in play order. */
  const E = [];
  units.forEach((u, ui) => {
    const f = final.get(u);
    if (!f) return;
    const c = f.cand;
    const take = c.take;
    const keep = f.keep || c.keep;
    const protect = new Set();
    const textOf = u.lines.map((l) => l.tokens.map((t) => t.t).join(" ")).join(" ");
    if (/\blike\b/.test(textOf)) protect.add("like");
    if (/\byou know\b/.test(textOf)) protect.add("you know");
    const seen = new Set();
    const entries = [];
    for (const k of keep) {
      const tok = take.toks[k];
      if (seen.has(tok.wi)) {
        if (c.scripted.has(k)) entries[entries.length - 1].scripted = true;
        continue;
      }
      seen.add(tok.wi);
      const line_idx = u.kind === "middle" ? c.lineOf.get(k) : u.line.line_idx;
      entries.push({
        take, wi: tok.wi, unit: ui, line_idx, scripted: c.scripted.has(k), protect,
        plannedPause: u.lines[u.lines.length - 1].planned_pause, lastOfUnit: false
      });
    }
    /* Fillers out (rule 6), then mark the unit's last word for the gap rule. */
    const kept = [];
    for (let x = 0; x < entries.length;) {
      const drop = gatedFiller(entries, x, o);
      if (drop) { x += drop; continue; }
      kept.push(entries[x]);
      x++;
    }
    if (!kept.length) return;
    kept[kept.length - 1].lastOfUnit = true;
    f.entries = kept;
    E.push(...kept);
  });

  const built = buildPieces(E, o);
  const R = (x) => round(x, o.roundTo);
  let out = 0;
  const pieces = built.map((p) => {
    const start = R(p.start), end = R(p.end);
    const piece = {
      take_id: p.take.take_id,
      start, end,
      line_idx: p.entries[0].line_idx,
      lines: [...new Set(p.entries.map((e) => e.line_idx))],
      out_start: R(out),
      out_end: R(out + (end - start)),
      words: p.entries.map((e) => ({
        w: p.take.words[e.wi].w, start: R(p.take.words[e.wi].start), end: R(p.take.words[e.wi].end), line_idx: e.line_idx
      }))
    };
    out += end - start;
    return piece;
  });

  /* Each line's state, for the approval screen and the hold rule. */
  const heardText = (entries) => entries.map((e) => e.take.words[e.wi].w).join(" ").replace(/\s+/g, " ").trim();
  const lineState = new Map();
  const saidDifferently = [];
  const stalls = [];
  let matchedWords = 0, totalWords = 0;
  for (const u of units) {
    const f = final.get(u);
    if (u.kind === "line") {
      const line = u.line;
      totalWords += line.countable;
      if (!f || !f.entries) {
        lineState.set(line.line_idx, { state: "missing", take_id: null, coverage: 0, heard: null });
        continue;
      }
      matchedWords += f.cand.matched;
      const said = heardText(f.entries);
      const spoken = spokenWords(f.entries.map((e) => e.take.words[e.wi].w)).filter((t) => !t.opt).map((t) => t.t).join(" ");
      const script = line.tokens.filter((t) => !t.opt).map((t) => t.t).join(" ");
      lineState.set(line.line_idx, {
        state: f.state, take_id: f.cand.take.take_id, coverage: R(f.cand.coverage),
        heard: spoken === script ? null : said
      });
      if (f.state === "said_differently") {
        saidDifferently.push({ line_idx: line.line_idx, said, coverage: R(f.cand.coverage), how: f.how });
      }
      for (const s of f.cand.stalls) stalls.push({ line_idx: line.line_idx, take_id: f.cand.take.take_id, at: R(s.at), seconds: R(s.seconds) });
    } else {
      for (const ln of u.lines) totalWords += ln.countable;
      if (!f || !f.entries) {
        for (const ln of u.lines) lineState.set(ln.line_idx, { state: "missing", take_id: null, coverage: 0, heard: null });
        continue;
      }
      for (const cue of f.cand.cues) {
        const mine = f.entries.filter((e) => e.line_idx === cue.line_idx);
        const ln = lines[cue.line_idx];
        if (cue.pos >= 0) matchedWords += ln.countable;
        lineState.set(cue.line_idx, {
          state: cue.pos >= 0 ? "kept" : "missing", take_id: f.cand.take.take_id,
          coverage: cue.pos >= 0 ? 1 : 0, heard: mine.length ? heardText(mine) : null
        });
      }
      for (const s of f.cand.stalls) {
        stalls.push({
          line_idx: f.cand.lineOf.get(s.k) ?? u.lines[0].line_idx,
          take_id: f.cand.take.take_id, at: R(s.at), seconds: R(s.seconds)
        });
      }
    }
  }

  /* Bullets: where each cue lands in the finished cut (the anchors). */
  const cues = [];
  for (const u of units) {
    if (u.kind !== "middle") continue;
    const f = final.get(u);
    u.lines.forEach((ln, ci) => {
      const c = f?.cand.cues[ci];
      let at = null, out_start = null;
      if (c && c.pos >= 0) {
        const tok = f.cand.take.toks[f.cand.keep[c.pos]];
        at = tok.start;
        for (const p of pieces) {
          if (p.take_id !== f.cand.take.take_id) continue;
          const w = p.words.find((pw) => Math.abs(pw.start - R(tok.start)) <= EPS && pw.line_idx === ln.line_idx);
          if (w) { out_start = R(p.out_start + Math.max(0, w.start - p.start)); break; }
        }
      }
      cues.push({
        cue: ci + 1, line_idx: ln.line_idx, text: ln.text,
        heard: Boolean(c && c.pos >= 0 && out_start !== null),
        take_id: f ? f.cand.take.take_id : null,
        start: at === null ? null : R(at), out_start
      });
    });
  }

  const missing = lines.filter((l) => lineState.get(l.line_idx)?.state === "missing").map((l) => l.line_idx);
  const coverage = totalWords ? R(matchedWords / totalWords) : 0;
  const holdReasons = [];
  if (!lines.length) holdReasons.push("the script has no lines");
  for (const [kind, name] of Object.entries(HOLD_KINDS)) {
    if (lines.some((l) => l.kind === kind && missing.includes(l.line_idx))) holdReasons.push(`${name} is missing`);
  }
  if (lines.length && coverage < o.holdCoverage - EPS) {
    holdReasons.push(`only ${Math.round(coverage * 100)}% of the script was said (needs ${Math.round(o.holdCoverage * 100)}%)`);
  }

  return {
    version: 1,
    style: st,
    pieces,
    missing_lines: missing,
    said_differently: saidDifferently,
    coverage,
    stalls,
    ok: holdReasons.length === 0,
    hold_reasons: holdReasons,
    rematch: coverage < o.rematchCoverage - EPS,
    lines: lines.map((l) => ({
      line_idx: l.line_idx, part_idx: l.part_idx, kind: l.kind, text: l.text, planned_pause: l.planned_pause,
      ...lineState.get(l.line_idx)
    })),
    cues,
    takes: prepared.map((t) => ({ take_id: t.take_id, recorded_at: t.recorded_at, order: t.order })),
    duration: R(out)
  };
}

/* ═════════════════════════════════════════════════════════════════════════
   10. ANCHORS — where an animation lands in the finished cut (spec §9.4)
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * resolveAnchor(plan, anchor) → {found, time, line_idx, fallback, reason}
 *
 * Words style: the anchor is an exact phrase (a string, or {phrase}); the time
 * is where its first word starts in the cut. Bullets style: {cue, keyword}
 * with cue counted from 1 (the U01 contract example: cue 1 is the first cue);
 * the keyword is looked for inside that cue's part of the cut, and the anchor
 * falls back to the cue's start (§9.2). A cut line gives found: false, so the
 * animation is skipped and flagged (§9.4).
 */
export function resolveAnchor(plan, anchor, opts = {}) {
  const o = { ...ALIGN_DEFAULTS, ...opts };
  const words = [];
  for (const p of plan?.pieces || []) {
    for (const w of p.words || []) words.push({ ...w, out: p.out_start + Math.max(0, w.start - p.start) });
  }
  const R = (x) => round(x, o.roundTo);
  const flat = spokenWords(words.map((w) => w.w)).filter((t) => !t.opt).map((t) => ({ t: t.t, wi: t.src }));

  if (anchor && typeof anchor === "object" && anchor.cue !== undefined) {
    const cue = (plan?.cues || []).find((c) => c.cue === Number(anchor.cue));
    if (!cue) return { found: false, time: null, line_idx: null, fallback: false, reason: "no such cue" };
    const keys = anchor.keyword ? spokenWords(String(anchor.keyword).split(/\s+/)).filter((t) => !t.opt).map((t) => t.t) : [];
    if (keys.length) {
      for (let x = 0; x < flat.length; x++) {
        const w = words[flat[x].wi];
        if (w.line_idx !== cue.line_idx) continue;
        if (keys.every((k, y) => flat[x + y] && words[flat[x + y].wi].line_idx === cue.line_idx && wordsMatch(k, flat[x + y].t, o))) {
          return { found: true, time: R(w.out), line_idx: cue.line_idx, fallback: false, reason: null };
        }
      }
    }
    if (cue.out_start !== null && cue.out_start !== undefined) {
      return { found: true, time: cue.out_start, line_idx: cue.line_idx, fallback: true, reason: "keyword not heard; the cue's start" };
    }
    return { found: false, time: null, line_idx: cue.line_idx, fallback: false, reason: "the cue was cut" };
  }

  const phrase = typeof anchor === "string" ? anchor : anchor?.phrase ?? anchor?.text ?? "";
  const keys = spokenWords(String(phrase).split(/\s+/)).filter((t) => !t.opt).map((t) => t.t);
  if (!keys.length) return { found: false, time: null, line_idx: null, fallback: false, reason: "empty anchor" };
  for (let x = 0; x + keys.length <= flat.length; x++) {
    if (keys.every((k, y) => wordsMatch(k, flat[x + y].t, o))) {
      const w = words[flat[x].wi];
      return { found: true, time: R(w.out), line_idx: w.line_idx, fallback: false, reason: null };
    }
  }
  return { found: false, time: null, line_idx: null, fallback: false, reason: "the phrase was cut" };
}
