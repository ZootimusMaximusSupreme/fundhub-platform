// Whisper a short Meet file. Long calls use the Drive transcript doc instead.
// Outbound HTTP goes through src/lib/outbound-fetch.mjs (INTERNAL).

import { postFormTo, INTERNAL } from "../lib/outbound-fetch.mjs";
import { embedConfigFromEnv } from "./embed.mjs";

export const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
export const WHISPER_MODEL = "whisper-1";
export const WHISPER_CREDITS_ERROR = "credits_exhausted";
export const WHISPER_RATE_LIMIT_ERROR = "rate_limited";

export function whisperConfigFromEnv(env = process.env) {
  return embedConfigFromEnv(env);
}

/** 429 / empty wallet / quota. Leave files pending and try the next sweeper tick. */
export function isWhisperCreditsError({ status, error } = {}) {
  const t = String(error || "").toLowerCase();
  if (/insufficient_quota|credits_exhausted|no credits|exceeded your current quota|check your plan and billing/.test(t)) {
    return true;
  }
  return Number(status) === 429 && /quota|billing|credit/.test(t);
}

export function classifyWhisperFailure({ status, error } = {}) {
  if (isWhisperCreditsError({ status, error })) {
    return { error: WHISPER_CREDITS_ERROR, retryable: true };
  }
  if (Number(status) === 429) {
    return { error: WHISPER_RATE_LIMIT_ERROR, retryable: true };
  }
  return {
    error: error || (status ? `whisper_http_${status}` : "whisper_failed"),
    retryable: Number(status) >= 500
  };
}

/** Local keep-alive wait. Credits / idle: 10 min. Rate limit: 2–15 min. After a hit: 30s. */
export const WHISPER_CREDITS_BACKOFF_MS = 10 * 60 * 1000;
export const WHISPER_IDLE_BACKOFF_MS = 10 * 60 * 1000;
export const WHISPER_SUCCESS_PAUSE_MS = 30 * 1000;

export function whisperKeepAliveSleepMs(reason, attempt = 0) {
  if (reason === WHISPER_CREDITS_ERROR) return WHISPER_CREDITS_BACKOFF_MS;
  if (reason === WHISPER_RATE_LIMIT_ERROR) {
    const n = Math.max(0, Math.min(Number(attempt) || 0, 4));
    return Math.min(15 * 60 * 1000, 120_000 * (2 ** n));
  }
  if (
    reason === "idle"
    || reason === "ffmpeg_missing"
    || reason === "drive_not_ready"
    || String(reason || "").startsWith("not_configured")
  ) {
    return WHISPER_IDLE_BACKOFF_MS;
  }
  return WHISPER_SUCCESS_PAUSE_MS;
}

/**
 * Turn audio/video bytes into words. Never throws.
 * @returns {{ ok: boolean, text: string, error?: string, retryable?: boolean }}
 */
export async function whisperBytes(bytes, {
  fileName = "call.mp4",
  env = process.env,
  fetchImpl,
  timeoutMs = 120_000
} = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buf.length) return { ok: false, text: "", error: "empty_file" };
  if (buf.length > WHISPER_MAX_BYTES) {
    return { ok: false, text: "", error: "too_large" };
  }

  const cfg = whisperConfigFromEnv(env);
  if (!cfg.ready) {
    return { ok: false, text: "", error: `not_configured:${cfg.missing.join(",")}` };
  }

  const form = new FormData();
  form.append("file", new Blob([buf]), fileName);
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "text");

  const res = await postFormTo(`${cfg.baseUrl}/v1/audio/transcriptions`, {
    headers: { authorization: `Bearer ${cfg.apiKey}` },
    body: form,
    timeoutMs,
    fetchImpl,
    fence: INTERNAL,
    what: "whisper",
    asText: true
  });

  if (!res.ok) {
    const classified = classifyWhisperFailure({
      status: res.status,
      error: res.error || `whisper_http_${res.status}`
    });
    return { ok: false, text: "", ...classified };
  }
  const text = String(res.body || "").trim();
  if (!text) return { ok: false, text: "", error: "empty_transcript" };
  return { ok: true, text };
}

/* ═════════════════════════════════════════════════════════════════════════
   whisperWords — every word of a filmed ad take, with its own start and end.

   Marketing machine spec §9.1 step 4 (`transcribed`). A NEW function, on
   purpose: whisperBytes above answers plain text and meet-transcript.mjs:204
   reads that text, so it is left exactly as it was.

   What the cut needs and plain text cannot give: the second each word starts
   and ends, so the aligner (§9.2) can keep the best attempt at every line and
   snip the rest. So this asks for verbose_json with word AND segment times.

   THE PROMPT IS A STYLE HINT, NEVER THE SCRIPT. Whisper copies the style of
   its prompt. A prompt full of "umm" and "like" keeps the fillers in the
   transcript, which is what lets the cut find and remove them. The script as a
   prompt would do the opposite: Whisper would "hear" the script even where
   Chris stumbled, and the cut would keep the stumble. The brand words at the
   end are there so "Fundhub" and "UnderwriteIQ" are spelled right.

   SEGMENTS WHISPER WAS NOT SURE OF ARE DROPPED, with their words. A segment
   that is probably not speech (no_speech_prob over 0.6) or that it barely
   believed (avg_logprob under -1) is where Whisper invents words over silence
   or room noise. A made-up word in the transcript is a made-up line in the cut.

   Not wired into the live pipeline yet: `transcribed` reads the take's audio
   from R2, which the video worker (§9.5) makes. Live use also needs credit on
   the OpenAI account (it answers 429 insufficient_quota today).

   NEVER THROWS.
   ═════════════════════════════════════════════════════════════════════════ */

/** The spec's prompt, word for word (§9.1 step 4). Keeps the fillers in. */
export const WHISPER_FILLER_PROMPT =
  "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking. Fundhub, UnderwriteIQ.";

/** A take can run long and the file is the whole take, so five minutes, not two. */
export const WHISPER_WORDS_TIMEOUT_MS = 300_000;

/** Whisper's own "this was silence" line: over this, the segment goes. */
export const NO_SPEECH_DROP_ABOVE = 0.6;
/** Whisper's own "this was a guess" line: under this, the segment goes. */
export const AVG_LOGPROB_DROP_BELOW = -1;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** keepSegment — false for a segment Whisper probably made up. Exported for the test. */
export function keepSegment(seg) {
  const noSpeech = num(seg?.no_speech_prob);
  const logprob = num(seg?.avg_logprob);
  if (noSpeech !== null && noSpeech > NO_SPEECH_DROP_ABOVE) return false;
  if (logprob !== null && logprob < AVG_LOGPROB_DROP_BELOW) return false;
  return true;
}

/* readVerboseJson — Whisper's answer, cut down to what the pipeline keeps.

   The words come back as one flat list, not inside their segments, so a word
   is dropped when its middle falls inside a dropped segment. */
export function readVerboseJson(body) {
  const rawSegments = Array.isArray(body?.segments) ? body.segments : [];
  const dropped = rawSegments.filter((s) => !keepSegment(s));
  const inDropped = (mid) => dropped.some((s) => {
    const a = num(s.start);
    const b = num(s.end);
    return a !== null && b !== null && mid >= a && mid <= b;
  });

  const words = [];
  for (const w of Array.isArray(body?.words) ? body.words : []) {
    const text = String(w?.word ?? "").trim();
    const start = num(w?.start);
    const end = num(w?.end);
    if (!text || start === null || end === null) continue;
    if (inDropped((start + end) / 2)) continue;
    words.push({ w: text, start, end: Math.max(end, start) });
  }

  const segments = rawSegments.filter(keepSegment).map((s) => ({
    start: num(s.start),
    end: num(s.end),
    text: String(s.text ?? "").trim(),
    avg_logprob: num(s.avg_logprob),
    no_speech_prob: num(s.no_speech_prob)
  }));

  return { words, segments, duration: num(body?.duration), droppedSegments: dropped.length };
}

/**
 * whisperWords(bytes, { env, fetchImpl, prompt, fileName, timeoutMs })
 *
 * @returns {{ ok: boolean, words: {w: string, start: number, end: number}[],
 *             segments: object[], duration: number|null, droppedSegments?: number,
 *             error?: string, retryable?: boolean }}
 */
export async function whisperWords(bytes, {
  fileName = "take.ogg",
  env = process.env,
  fetchImpl,
  prompt = WHISPER_FILLER_PROMPT,
  timeoutMs = WHISPER_WORDS_TIMEOUT_MS
} = {}) {
  const none = { ok: false, words: [], segments: [], duration: null };
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buf.length) return { ...none, error: "empty_file" };
  if (buf.length > WHISPER_MAX_BYTES) return { ...none, error: "too_large" };

  const cfg = whisperConfigFromEnv(env);
  if (!cfg.ready) return { ...none, error: `not_configured:${cfg.missing.join(",")}` };
  /* A MASKED KEY IS NOT A KEY (spec §9.1 step 4: "confirm the code sees an
     unmasked OpenAI key"). A real OpenAI key never holds an asterisk; the
     hidden-password form copied out of a dashboard does. Sending it buys a
     401 and nothing else. The stored value is left exactly where it is. */
  if (String(cfg.apiKey).includes("*")) {
    return { ...none, error: "not_configured:OPENAI_API_KEY is masked" };
  }

  const form = new FormData();
  form.append("file", new Blob([buf]), fileName);
  form.append("model", WHISPER_MODEL);
  form.append("language", "en");
  form.append("temperature", "0");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (prompt) form.append("prompt", String(prompt));

  const res = await postFormTo(`${cfg.baseUrl}/v1/audio/transcriptions`, {
    headers: { authorization: `Bearer ${cfg.apiKey}` },
    body: form,
    timeoutMs,
    fetchImpl,
    fence: INTERNAL,
    what: "whisper-words"
  });

  if (!res.ok) {
    const classified = classifyWhisperFailure({
      status: res.status,
      error: res.error || `whisper_http_${res.status}`
    });
    return { ...none, ...classified };
  }
  if (!res.body || typeof res.body !== "object") {
    return { ...none, error: "whisper_bad_json" };
  }

  const out = readVerboseJson(res.body);
  if (!out.words.length) return { ...none, duration: out.duration, error: "empty_transcript" };
  return { ok: true, ...out };
}
