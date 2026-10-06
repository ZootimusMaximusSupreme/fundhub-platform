import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  whisperBytes,
  whisperWords,
  keepSegment,
  readVerboseJson,
  WHISPER_FILLER_PROMPT,
  WHISPER_WORDS_TIMEOUT_MS,
  WHISPER_MAX_BYTES,
  WHISPER_CREDITS_ERROR,
  WHISPER_RATE_LIMIT_ERROR,
  WHISPER_CREDITS_BACKOFF_MS,
  WHISPER_IDLE_BACKOFF_MS,
  WHISPER_SUCCESS_PAUSE_MS,
  isWhisperCreditsError,
  classifyWhisperFailure,
  whisperKeepAliveSleepMs
} from "./transcribe.mjs";

test("whisperBytes refuses an empty or huge file", async () => {
  const empty = await whisperBytes(Buffer.alloc(0), { env: { OPENAI_API_KEY: "sk-test" } });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, "empty_file");

  const huge = await whisperBytes(Buffer.alloc(WHISPER_MAX_BYTES + 1), {
    env: { OPENAI_API_KEY: "sk-test" }
  });
  assert.equal(huge.ok, false);
  assert.equal(huge.error, "too_large");
});

test("whisperBytes posts the file through the fence and returns words", async () => {
  let seen = null;
  const out = await whisperBytes(Buffer.from("ID3fake"), {
    fileName: "call.mp4",
    env: { OPENAI_API_KEY: "sk-test" },
    fetchImpl: async (url, init) => {
      seen = { url, hasBody: !!init.body };
      return {
        ok: true,
        status: 200,
        text: async () => "hello this is the call",
        headers: { forEach() {} }
      };
    }
  });
  assert.equal(out.ok, true);
  assert.equal(out.text, "hello this is the call");
  assert.match(seen.url, /audio\/transcriptions/);
  assert.equal(seen.hasBody, true);
});

test("429 with no credits is retryable, not a dead batch", async () => {
  assert.equal(isWhisperCreditsError({
    status: 429,
    error: '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}'
  }), true);
  const classified = classifyWhisperFailure({
    status: 429,
    error: "insufficient_quota"
  });
  assert.equal(classified.error, WHISPER_CREDITS_ERROR);
  assert.equal(classified.retryable, true);

  let calls = 0;
  const out = await whisperBytes(Buffer.from("ID3fake"), {
    env: { OPENAI_API_KEY: "sk-test" },
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({
          error: { type: "insufficient_quota", message: "You exceeded your current quota" }
        }),
        headers: { forEach() {} }
      };
    }
  });
  assert.equal(calls, 1);
  assert.equal(out.ok, false);
  assert.equal(out.error, WHISPER_CREDITS_ERROR);
  assert.equal(out.retryable, true);
});

test("plain 429 without quota text backs off as a rate limit", () => {
  const classified = classifyWhisperFailure({ status: 429, error: "HTTP 429" });
  assert.equal(classified.error, WHISPER_RATE_LIMIT_ERROR);
  assert.equal(classified.retryable, true);
});

test("keep-alive sleep waits ten minutes on no credits and does not rush", () => {
  assert.equal(whisperKeepAliveSleepMs(WHISPER_CREDITS_ERROR), WHISPER_CREDITS_BACKOFF_MS);
  assert.equal(whisperKeepAliveSleepMs("idle"), WHISPER_IDLE_BACKOFF_MS);
  assert.equal(whisperKeepAliveSleepMs(null), WHISPER_SUCCESS_PAUSE_MS);
  assert.ok(whisperKeepAliveSleepMs(WHISPER_RATE_LIMIT_ERROR, 0) >= 120_000);
  assert.ok(whisperKeepAliveSleepMs(WHISPER_RATE_LIMIT_ERROR, 9) <= 15 * 60 * 1000);
});

/* ═════════════════════════════════════════════════════════════════════════
   whisperWords — the ad-take transcriber (marketing machine spec §9.1 step 4).
   Fake fetch only. No network, no key.
   ═════════════════════════════════════════════════════════════════════════ */

/** A stand-in OpenAI that keeps what it was sent and answers with `body`. */
function whisperSaying(body, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), form: init.body, headers: init.headers });
    return {
      ok: status === 200,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      headers: { forEach() {} }
    };
  };
  impl.calls = calls;
  return impl;
}

const VERBOSE = {
  task: "transcribe",
  language: "english",
  duration: 9.5,
  text: "Most people apply in the wrong order. Thank you.",
  segments: [
    { id: 0, start: 0, end: 4, text: " Most people apply in the wrong order.", avg_logprob: -0.2, no_speech_prob: 0.01 },
    { id: 1, start: 4.2, end: 6, text: " Umm, the bank says no.", avg_logprob: -0.4, no_speech_prob: 0.05 },
    // Silence Whisper filled in. Probably not speech.
    { id: 2, start: 6.5, end: 8, text: " Thank you.", avg_logprob: -0.3, no_speech_prob: 0.92 },
    // A guess Whisper barely believed.
    { id: 3, start: 8, end: 9.5, text: " Subscribe.", avg_logprob: -1.4, no_speech_prob: 0.1 }
  ],
  words: [
    { word: "Most", start: 0, end: 0.3 },
    { word: "people", start: 0.3, end: 0.7 },
    { word: "apply", start: 0.7, end: 1.1 },
    { word: "in", start: 1.1, end: 1.2 },
    { word: "the", start: 1.2, end: 1.3 },
    { word: "wrong", start: 1.3, end: 1.7 },
    { word: "order", start: 1.7, end: 2.2 },
    { word: "Umm", start: 4.2, end: 4.6 },
    { word: "the", start: 4.8, end: 4.9 },
    { word: "bank", start: 4.9, end: 5.2 },
    { word: "says", start: 5.2, end: 5.5 },
    { word: "no", start: 5.5, end: 5.8 },
    { word: "Thank", start: 6.6, end: 6.9 },
    { word: "you", start: 6.9, end: 7.1 },
    { word: "Subscribe", start: 8.2, end: 8.9 }
  ]
};

const KEY = { OPENAI_API_KEY: "sk-test" };

test("whisperWords asks for words with their times, in English, at temperature 0", async () => {
  const impl = whisperSaying(VERBOSE);
  const out = await whisperWords(Buffer.from("OggSfake"), { env: KEY, fetchImpl: impl });
  assert.equal(out.ok, true);
  assert.equal(impl.calls.length, 1);
  const { url, form } = impl.calls[0];
  assert.match(url, /\/v1\/audio\/transcriptions$/);
  assert.equal(form.get("model"), "whisper-1");
  assert.equal(form.get("language"), "en");
  assert.equal(form.get("temperature"), "0");
  assert.equal(form.get("response_format"), "verbose_json");
  assert.deepEqual(form.getAll("timestamp_granularities[]").sort(), ["segment", "word"]);
  assert.ok(form.get("file"), "the audio itself is sent");
});

test("the prompt is the spec's filler prompt, word for word, and never the script", async () => {
  assert.equal(WHISPER_FILLER_PROMPT,
    "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking. Fundhub, UnderwriteIQ.");
  const impl = whisperSaying(VERBOSE);
  await whisperWords(Buffer.from("OggSfake"), { env: KEY, fetchImpl: impl });
  assert.equal(impl.calls[0].form.get("prompt"), WHISPER_FILLER_PROMPT);
});

test("the timeout is 300 seconds: a call still hanging at 299.999 s is not cut, at 300 s it is", async () => {
  assert.equal(WHISPER_WORDS_TIMEOUT_MS, 300_000);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let aborted = false;
    const hanging = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
    const pending = whisperWords(Buffer.from("OggSfake"), { env: KEY, fetchImpl: hanging });
    mock.timers.tick(299_999);
    await Promise.resolve();
    assert.equal(aborted, false, "a long take must get its full five minutes");
    mock.timers.tick(1);
    const out = await pending;
    assert.equal(aborted, true);
    assert.equal(out.ok, false);
    assert.match(out.error, /timed out after 300000ms/);
  } finally {
    mock.timers.reset();
  }
});

test("segments Whisper probably made up are dropped, and so are their words", async () => {
  const out = await whisperWords(Buffer.from("OggSfake"), { env: KEY, fetchImpl: whisperSaying(VERBOSE) });
  assert.equal(out.ok, true);
  assert.equal(out.droppedSegments, 2);
  assert.deepEqual(out.segments.map((s) => s.text), [
    "Most people apply in the wrong order.",
    "Umm, the bank says no."
  ]);
  const said = out.words.map((w) => w.w);
  assert.deepEqual(said, ["Most", "people", "apply", "in", "the", "wrong", "order", "Umm", "the", "bank", "says", "no"]);
  assert.ok(!said.includes("Thank"), "no_speech_prob 0.92 is silence Whisper filled in");
  assert.ok(!said.includes("Subscribe"), "avg_logprob -1.4 is a guess");
  assert.equal(out.duration, 9.5);
  assert.deepEqual(out.words[0], { w: "Most", start: 0, end: 0.3 }, "each word is {w, start, end}");
});

test("the fillers stay in — the cut needs them to find and remove them", () => {
  const out = readVerboseJson(VERBOSE);
  assert.ok(out.words.some((w) => w.w === "Umm"));
});

test("the drop lines sit exactly where the contract puts them", () => {
  assert.equal(keepSegment({ no_speech_prob: 0.6, avg_logprob: -1 }), true, "0.6 and -1 themselves are kept");
  assert.equal(keepSegment({ no_speech_prob: 0.61, avg_logprob: -0.1 }), false);
  assert.equal(keepSegment({ no_speech_prob: 0.01, avg_logprob: -1.01 }), false);
  assert.equal(keepSegment({}), true, "a segment with no scores is not thrown away on a guess");
});

test("whisperWords refuses an empty file, a huge file, no key and a masked key, all without a call", async () => {
  const impl = whisperSaying(VERBOSE);
  assert.equal((await whisperWords(Buffer.alloc(0), { env: KEY, fetchImpl: impl })).error, "empty_file");
  assert.equal((await whisperWords(Buffer.alloc(WHISPER_MAX_BYTES + 1), { env: KEY, fetchImpl: impl })).error, "too_large");
  assert.match((await whisperWords(Buffer.from("x"), { env: {}, fetchImpl: impl })).error, /not_configured:OPENAI_API_KEY/);
  const masked = await whisperWords(Buffer.from("x"), {
    env: { OPENAI_API_KEY: "****************abcd" },
    fetchImpl: impl
  });
  assert.equal(masked.ok, false);
  assert.match(masked.error, /masked/);
  assert.equal(impl.calls.length, 0, "a masked key buys a 401 and nothing else, so nothing is sent");
});

test("whisperWords: no credits is retryable, same as whisperBytes", async () => {
  const out = await whisperWords(Buffer.from("OggSfake"), {
    env: KEY,
    fetchImpl: whisperSaying({ error: { type: "insufficient_quota", message: "You exceeded your current quota" } }, { status: 429 })
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, WHISPER_CREDITS_ERROR);
  assert.equal(out.retryable, true);
  assert.deepEqual(out.words, []);
});

test("whisperWords: an answer with no words left is a failure, not an empty success", async () => {
  const out = await whisperWords(Buffer.from("OggSfake"), {
    env: KEY,
    fetchImpl: whisperSaying({ duration: 3, segments: [], words: [] })
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "empty_transcript");
});

test("whisperBytes is unchanged: plain text, no timestamps, no prompt (meet-transcript.mjs reads its text)", async () => {
  let form = null;
  const out = await whisperBytes(Buffer.from("ID3fake"), {
    env: KEY,
    fetchImpl: async (url, init) => {
      form = init.body;
      return { ok: true, status: 200, text: async () => "hello", headers: { forEach() {} } };
    }
  });
  assert.equal(out.text, "hello");
  assert.equal(form.get("model"), "whisper-1");
  assert.equal(form.get("response_format"), "text");
  assert.deepEqual(form.getAll("timestamp_granularities[]"), []);
  assert.equal(form.get("prompt"), null);
  assert.equal(form.get("language"), null);
});
