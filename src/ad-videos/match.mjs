// Which script is this take?
//
// The ad number is the spine of the whole pipeline — the file name, Paul's
// folder, and `utm_content` on the landing link all come from it — and the only
// place it can be recovered from a filmed take is the words Chris said. The
// phone names the file something like `VID_20260923_101455.mp4`, which tells
// nobody anything.
//
// SO THIS IS A READING TASK, NOT A SEARCH. A take is a spoken performance of a
// written script: stumbles, restarts, a dropped clause, an ad-libbed line. Exact
// text matching fails on all four. A language model reads both and says which
// one it is, the same way a person would.
//
// IT CALLS src/agents/model.mjs AND NEVER fetch. That module is already the one
// allowed place a model question leaves the building
// (src/lib/no-unfenced-transmit.test.mjs), it already classifies a dead key from
// an empty wallet, and duplicating it here would be a second thing to keep right.
//
// ANTHROPIC, DELIBERATELY. callModel() prefers OpenAI when OPENAI_API_KEY is
// set. The owner's decision for this pipeline is Claude, so the env handed down
// carries ANTHROPIC_API_KEY and nothing else. The key is read by NAME and its
// value never leaves this function.
//
// ═══════════════════════════════════════════════════════════════════════════
// A LOW-CONFIDENCE MATCH IS NOT A MATCH.
//
// Guessing costs a whole ad: the wrong number goes on the file, Paul uploads it
// against the wrong creative, and the results for two ads mix. So below the
// floor the answer is "I do not know", the row stops, and a person looks. That
// is the cheap failure. CLAUDE.md: never invent — if information is missing,
// that absence is the finding.
// ═══════════════════════════════════════════════════════════════════════════
//
// ═══════════════════════════════════════════════════════════════════════════
// THE FREE CHECK RUNS FIRST (marketing machine spec §9.1 step 5).
//
// Most takes are a straight read off the teleprompter, and for those nobody
// needs to be asked: count how many of each script's word pairs were actually
// said. When one script was clearly read — most of its word pairs heard, and
// well ahead of every other script — that is the match, and the model is never
// called. It costs nothing and it is the same answer every time.
//
// Only when that is unclear (a bullets script said in his own words, a partial
// pick-up, two scripts that share lines) does Claude read the take, and then it
// is shown the top 3 by overlap, not the whole library. Three is enough for the
// right one to be in the room and few enough that it reads instead of skims.
//
// THE SAME FLOOR HOLDS FOR BOTH. An overlap winner's confidence is the share of
// word pairs heard, and the free check only answers when that share clears the
// floor. Under it, the model is asked; under it again, a person is.
// ═══════════════════════════════════════════════════════════════════════════

import { callModel } from "../agents/model.mjs";
import { tokenize } from "./merge-takes.mjs";

/** Below this, the take is not matched and nothing downstream runs. 0–100. */
export const MATCH_CONFIDENCE_FLOOR = 80;

/** How much of a script the model is shown. A whole ad script is short; the cap
    is here so a pathological row cannot blow the request up. */
export const MAX_SCRIPT_CHARS = 4000;
export const MAX_TRANSCRIPT_CHARS = 8000;

/** How many candidate scripts the model is shown when the free check is
    unclear: the top 3 by word overlap (spec §9.1 step 5). It was 25, which is
    skimming, not reading. */
export const MAX_CANDIDATES = 3;

/** The free check's winner must be at least this far ahead of the next script
    (0–1, in share of word pairs heard). Two scripts that share lines land
    closer than this, and then the model reads them. */
export const OVERLAP_CLEAR_MARGIN = 0.3;

/** ...and must have had at least this many of its word pairs said. A script of
    four words is "fully heard" inside any take that happens to say them, so a
    tiny script can never win on overlap alone. */
export const OVERLAP_MIN_PAIRS = 8;

const SYSTEM = [
  "You match a filmed take to the written script it was read from.",
  "The take is a spoken performance: stumbles, restarts, dropped words and small",
  "ad-libs are normal and are NOT evidence against a match. Meaning and running",
  "order are the evidence.",
  "",
  "Answer with one JSON object and nothing else:",
  '{"scriptId": "<id or null>", "confidence": <0-100>, "reason": "<one short sentence>"}',
  "",
  "confidence is how sure you are that this take is that script.",
  "If two scripts are close, or none of them fits, return scriptId null and a low",
  "confidence. Never pick the nearest one to be helpful."
].join("\n");

const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/* The whole take as one line, uncut. Reads Submagic's words ({word}) and
   whisperWords' words ({w}) alike, and plain text. */
function fullText(input) {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    return input.map((w) => (typeof w === "string" ? w : w?.word ?? w?.w ?? w?.text ?? "")).join(" ");
  }
  return "";
}

/** transcriptText — the take's words as one readable line, capped for the prompt. */
export function transcriptText(input) {
  return clip(fullText(input), MAX_TRANSCRIPT_CHARS);
}

/* ─────────────────────────────────────────────────────────────────────────
   The free word-overlap check.
   ───────────────────────────────────────────────────────────────────────── */

/** Sounds with no words in them. Whisper is told to keep them (the cut needs
    them), so they are dropped here before word pairs are counted — otherwise
    "the wrong order, uh, and the bank" would lose the pair "order and". */
const FILLER = /^(u+h*m+|u+h+|h+m+|m+h?m+|e+r+m*|a+h+)$/;

/** Text → the spoken words, compared the way the cut compares them
    (merge-takes.mjs tokenize: lower case, no punctuation, small numbers as
    digits), with fillers and stutters ("the the") taken out. */
function spokenWords(text) {
  const out = [];
  for (const t of tokenize(text)) {
    if (FILLER.test(t)) continue;
    if (out.length && out[out.length - 1] === t) continue;
    out.push(t);
  }
  return out;
}

function wordPairs(words) {
  const pairs = new Set();
  for (let i = 1; i < words.length; i += 1) pairs.add(`${words[i - 1]} ${words[i]}`);
  return pairs;
}

function overlapOf(heardPairs, scriptText) {
  const scriptPairs = wordPairs(spokenWords(scriptText));
  let heard = 0;
  for (const p of scriptPairs) if (heardPairs.has(p)) heard += 1;
  return { pairs: scriptPairs.size, heard, score: scriptPairs.size ? heard / scriptPairs.size : 0 };
}

/* What a candidate's words are, for the free check: its hook and its body.
   The hook is often stored on its own as well as inside the body; the pairs
   are a set, so saying it twice changes nothing. */
const scriptWordsOf = (c) => [c?.hook_text, c?.body ?? c?.text].filter(Boolean).join("\n");

/**
 * overlapScore(transcript, scriptText) → 0–1
 *
 * The share of the script's word pairs that were said in the take. Extra words
 * in the take (ad-libs, restarts) do not lower it; lines that were skipped do.
 * Word pairs rather than single words because scripts in one campaign share
 * most of their vocabulary ("bank", "credit", "funding") but not their pairs.
 */
export function overlapScore(transcript, scriptText) {
  return overlapOf(wordPairs(spokenWords(fullText(transcript))), scriptText).score;
}

/**
 * rankByOverlap(transcript, candidates) → [{ candidate, score, heard, pairs }]
 * Highest score first. Ties keep the order the candidates came in.
 */
export function rankByOverlap(transcript, candidates = []) {
  const heardPairs = wordPairs(spokenWords(fullText(transcript)));
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, i) => ({ candidate, i, ...overlapOf(heardPairs, scriptWordsOf(candidate)) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map(({ i, ...rest }) => rest);
}

/**
 * clearOverlapWinner(ranked, floor) → the top entry when the free check alone
 * may decide, or null when the model has to read.
 *
 * Clear means all three: its share of pairs heard clears the same floor the
 * model is held to, it is OVERLAP_CLEAR_MARGIN ahead of the next script, and
 * at least OVERLAP_MIN_PAIRS of its pairs were said.
 */
export function clearOverlapWinner(ranked, floor = MATCH_CONFIDENCE_FLOOR) {
  const top = ranked?.[0];
  if (!top) return null;
  /* Whole percents, so 70% against 40% is the 30-point margin it looks like
     rather than 0.29999999999999993. */
  const topPct = Math.round(top.score * 100);
  const nextPct = Math.round((ranked[1]?.score ?? 0) * 100);
  if (topPct < floor) return null;
  if (top.heard < OVERLAP_MIN_PAIRS) return null;
  if (topPct - nextPct < Math.round(OVERLAP_CLEAR_MARGIN * 100)) return null;
  return top;
}

const pct = (x) => `${Math.round((x || 0) * 100)}%`;

/* readVerdict — pull the JSON object out of whatever the model said.

   Defensive on purpose. A model that wraps its answer in a code fence, or adds
   a sentence before it, is ordinary; treating that as a failure would stall a
   row for a formatting habit. A model that says something with no JSON in it at
   all is a real failure and is reported as one. */
export function readVerdict(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, error: "the model returned no JSON object" };
  let parsed;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); }
  catch { return { ok: false, error: "the model's JSON could not be read" }; }

  const scriptId = parsed?.scriptId === null || parsed?.scriptId === undefined
    ? null
    : String(parsed.scriptId).trim() || null;
  const confidence = Number(parsed?.confidence);
  return {
    ok: true,
    scriptId,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, Math.round(confidence))) : 0,
    reason: clip(parsed?.reason, 200)
  };
}

/**
 * matchTakeToScript({ transcript, candidates, env, fetchImpl, floor })
 *
 * candidates: [{ id, adId, title?, hook_text?, body }] — the locked scripts that
 * have an ad number. The caller does that filtering (store.candidateScripts);
 * this function only reads.
 *
 * → {
 *     ok:          true when a candidate cleared the floor
 *     scriptId:    the winner, or null
 *     adId:        that candidate's ad number, or null
 *     confidence:  0–100
 *     reason:      one sentence, for the row and for a person reading it later
 *     retryable:   true when the model could not be reached (try again later)
 *     method:      "overlap" (the free check decided, no model call) or "model"
 *   }
 *
 * NEVER THROWS.
 */
export async function matchTakeToScript({
  transcript, candidates = [], env = process.env, fetchImpl, floor = MATCH_CONFIDENCE_FLOOR
} = {}) {
  const words = transcriptText(transcript);
  if (!words) {
    return { ok: false, retryable: false, scriptId: null, adId: null, confidence: 0,
      reason: "there is no transcript to read" };
  }

  const all = (Array.isArray(candidates) ? candidates : []).filter((c) => c && c.id);
  if (!all.length) {
    return { ok: false, retryable: false, scriptId: null, adId: null, confidence: 0,
      reason: "no scripts were offered to match against" };
  }

  /* THE FREE CHECK. A clear winner is the answer and nobody is asked. */
  const ranked = rankByOverlap(transcript, all);
  const clear = clearOverlapWinner(ranked, floor);
  if (clear) {
    const c = clear.candidate;
    return {
      ok: true, retryable: false, method: "overlap",
      scriptId: String(c.id),
      adId: c.adId === undefined || c.adId === null ? null : String(c.adId),
      confidence: Math.round(clear.score * 100),
      reason: `${clear.heard} of the script's ${clear.pairs} word pairs were said (${pct(clear.score)}); ` +
        `the next closest script was ${pct(ranked[1]?.score)} — matched by word overlap, no model call`
    };
  }

  /* UNCLEAR, SO THE MODEL READS — the top 3 by overlap, not the library. */
  const list = ranked.slice(0, MAX_CANDIDATES).map((r) => r.candidate);

  const user = [
    "THE TAKE (what was said):",
    words,
    "",
    "THE SCRIPTS:",
    ...list.map((c, i) => [
      `--- script ${i + 1} ---`,
      `scriptId: ${c.id}`,
      c.title ? `title: ${clip(c.title, 160)}` : null,
      clip(c.body ?? c.text, MAX_SCRIPT_CHARS)
    ].filter(Boolean).join("\n"))
  ].join("\n");

  /* ANTHROPIC ONLY. callModel picks OpenAI first when it sees that key, and the
     owner's decision for this pipeline is Claude. Narrowing the env is how that
     is said without editing a shared module. */
  const res = await callModel({
    system: SYSTEM,
    user,
    env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY },
    fetchImpl,
    maxTokens: 300
  });

  if (res.mode === "shadow") {
    /* No key, so no call was made. Retryable: the take is fine and the match
       should happen once a key is set. The row waits rather than guessing. */
    return { ok: false, retryable: true, method: "model", scriptId: null, adId: null, confidence: 0,
      reason: "ANTHROPIC_API_KEY is not set, so no match was attempted" };
  }
  if (res.error) {
    return { ok: false, retryable: true, method: "model", scriptId: null, adId: null, confidence: 0,
      reason: String(res.error).slice(0, 200) };
  }

  const verdict = readVerdict(res.text);
  if (!verdict.ok) {
    return { ok: false, retryable: true, method: "model", scriptId: null, adId: null, confidence: 0, reason: verdict.error };
  }

  const picked = verdict.scriptId ? list.find((c) => String(c.id) === verdict.scriptId) : null;
  if (!picked) {
    return { ok: false, retryable: false, method: "model", scriptId: null, adId: null,
      confidence: verdict.confidence,
      reason: verdict.reason || "the model matched no script" };
  }
  if (verdict.confidence < floor) {
    return { ok: false, retryable: false, method: "model", scriptId: null, adId: null,
      confidence: verdict.confidence,
      reason: `closest was ${picked.id} at ${verdict.confidence}, under the ${floor} floor — a person has to look` };
  }

  const adId = picked.adId === undefined || picked.adId === null ? null : String(picked.adId);
  return {
    ok: true, retryable: false, method: "model",
    scriptId: String(picked.id),
    adId,
    confidence: verdict.confidence,
    reason: verdict.reason || "matched"
  };
}

export default matchTakeToScript;
