// Fake takes for src/ad-videos/align.test.mjs — whisper-shaped words plus the
// silences ffmpeg's silencedetect would report, built from plain text.
//
//   say("lenders read two files |0.6| before they say yes")
//
// Each word lasts 0.3 s, with 0.06 s between words (too short to count as a
// silence). "|0.6|" puts a 0.6 s pause there instead. Every gap of 0.12 s or
// more is a silence (silencedetect's d=0.12), and so is the air before the
// first word and after the last.

const PAUSE = /^\|(\d+(?:\.\d+)?)\|$/;

export function say(text, { start = 0.5, word = 0.3, gap = 0.06, tail = 1.0, minSilence = 0.12 } = {}) {
  const words = [];
  let t = start;
  let pending = null;
  for (const raw of String(text).split(/\s+/).filter(Boolean)) {
    const m = PAUSE.exec(raw);
    if (m) { pending = (pending ?? 0) + Number(m[1]); continue; }
    if (words.length) t += pending ?? gap;
    pending = null;
    words.push({ w: raw, start: round(t), end: round(t + word) });
    t += word;
  }
  const silences = [];
  if (words.length && words[0].start >= minSilence) silences.push({ start: 0, end: words[0].start });
  for (let i = 1; i < words.length; i++) {
    if (words[i].start - words[i - 1].end >= minSilence - 1e-9) silences.push({ start: words[i - 1].end, end: words[i].start });
  }
  const last = words.length ? words[words.length - 1].end : start;
  const duration = round(last + tail);
  if (tail >= minSilence) silences.push({ start: last, end: duration });
  return { words, silences, duration };
}

/** One take in the alignTakes() input shape. */
export function take(take_id, recorded_at, text, opts = {}) {
  const { words, silences, duration } = say(text, opts);
  return { take_id, recorded_at, words, silences: opts.noSilences ? null : silences, duration };
}

/** Where a word (its nth time, counting from 0) sits in a take. */
export function wordAt(t, w, nth = 0) {
  const hits = t.words.filter((x) => x.w.toLowerCase().replace(/[^a-z0-9$%']/g, "") === w);
  return hits[nth];
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
