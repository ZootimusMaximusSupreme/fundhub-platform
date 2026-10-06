// Matching a take to its script.
//
// NO NETWORK — `fetchImpl` is injected into callModel.
//
// The property this file exists for is the last block: a low-confidence answer
// is NOT a match. Getting that wrong puts the wrong ad number on a file, Paul
// uploads it against the wrong creative, and two ads' results mix. Nobody finds
// out from looking at the video.
//
// THE FREE CHECK (spec §9.1 step 5) runs before the model. A take that clearly
// reads one script is matched by word overlap and the model is never called;
// everything else goes to the model with the top 3 only. So every test below
// that is about the MODEL uses a take the free check cannot decide (UNCLEAR),
// and the free check has its own block.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  matchTakeToScript, readVerdict, transcriptText,
  overlapScore, rankByOverlap, clearOverlapWinner,
  MATCH_CONFIDENCE_FLOOR, MAX_CANDIDATES, OVERLAP_CLEAR_MARGIN, OVERLAP_MIN_PAIRS
} from "./match.mjs";

const LIVE = { ANTHROPIC_API_KEY: "sk-ant-test" };

/** An Anthropic stand-in: whatever text you give it comes back as the reply. */
function modelSaying(text, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const body = status === 200
      ? { content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }
      : { error: { message: text } };
    return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  impl.calls = calls;
  return impl;
}

const CANDIDATES = [
  { id: "s1", adId: "43", title: "wrong order", body: "Most people apply in the wrong order and the bank says no." },
  { id: "s2", adId: "44", title: "inquiries", body: "Every inquiry on your file is a reason to decline you." }
];

/** A clear read of s1, stumbles and all. */
const TAKE = "most people apply in the the wrong order uh and the bank just says no";

/** A take the free check cannot place: it says none of either script's word pairs. */
const UNCLEAR = "so here is the thing about banks and your file";

const sentScripts = (impl) => impl.calls[0].body.messages[0].content.split("--- script ").length - 1;

describe("reading the transcript", () => {
  test("Submagic words[], whisperWords words[] and plain text all work", () => {
    assert.equal(transcriptText([{ word: "a" }, { word: "b" }]), "a b");
    assert.equal(transcriptText([{ w: "a", start: 0, end: 1 }, { w: "b", start: 1, end: 2 }]), "a b");
    assert.equal(transcriptText("a b"), "a b");
    assert.equal(transcriptText(null), "");
  });
});

describe("reading the model's answer", () => {
  test("a fenced or chatty answer is still read", () => {
    const out = readVerdict('Sure!\n```json\n{"scriptId":"s1","confidence":95,"reason":"same order"}\n```');
    assert.equal(out.ok, true);
    assert.equal(out.scriptId, "s1");
    assert.equal(out.confidence, 95);
  });

  test("no JSON at all is a failure, not an empty match", () => {
    assert.equal(readVerdict("I think it is the first one").ok, false);
    assert.equal(readVerdict("").ok, false);
  });

  test("confidence is clamped to 0-100", () => {
    assert.equal(readVerdict('{"scriptId":"s1","confidence":900}').confidence, 100);
    assert.equal(readVerdict('{"scriptId":"s1","confidence":"nonsense"}').confidence, 0);
  });
});

describe("the free word-overlap check", () => {
  test("a word-for-word read scores 1; an unrelated take scores 0", () => {
    assert.equal(overlapScore(CANDIDATES[0].body, CANDIDATES[0].body), 1);
    assert.equal(overlapScore(UNCLEAR, CANDIDATES[0].body), 0);
  });

  test("fillers and stutters do not count against a take, and extra words do not either", () => {
    const clean = "Most people apply in the wrong order and the bank says no";
    const messy = "okay so umm most people apply in the the wrong order uh and the bank says no right";
    assert.equal(overlapScore(messy, CANDIDATES[0].body), overlapScore(clean, CANDIDATES[0].body));
    assert.equal(overlapScore(messy, CANDIDATES[0].body), 1);
  });

  test("skipped lines do count: half the script said is about half the score", () => {
    const half = overlapScore("most people apply in the wrong", CANDIDATES[0].body);
    assert.ok(half > 0.3 && half < 0.6, `got ${half}`);
  });

  test("whisperWords' {w} words are read the same as text", () => {
    const words = TAKE.split(" ").map((w, i) => ({ w, start: i, end: i + 0.5 }));
    assert.equal(overlapScore(words, CANDIDATES[0].body), overlapScore(TAKE, CANDIDATES[0].body));
  });

  test("the scripts are ranked best first", () => {
    const ranked = rankByOverlap(TAKE, [CANDIDATES[1], CANDIDATES[0]]);
    assert.equal(ranked[0].candidate.id, "s1");
    assert.equal(ranked[1].candidate.id, "s2");
  });

  test("A CLEAR OVERLAP WINNER SKIPS THE MODEL", async () => {
    const impl = modelSaying("never reached");
    const res = await matchTakeToScript({ transcript: TAKE, candidates: CANDIDATES, env: LIVE, fetchImpl: impl });
    assert.equal(impl.calls.length, 0, "a straight read off the teleprompter costs nothing to place");
    assert.equal(res.ok, true);
    assert.equal(res.method, "overlap");
    assert.equal(res.scriptId, "s1");
    assert.equal(res.adId, "43");
    assert.ok(res.confidence >= MATCH_CONFIDENCE_FLOOR, `confidence ${res.confidence}`);
    assert.match(res.reason, /no model call/);
  });

  test("a clear winner needs no key at all", async () => {
    const res = await matchTakeToScript({ transcript: TAKE, candidates: CANDIDATES, env: {} });
    assert.equal(res.ok, true);
    assert.equal(res.scriptId, "s1");
  });

  /* THE 80 FLOOR HOLDS FOR THE FREE CHECK TOO. Eleven words is ten word pairs:
     eight heard is 80% and clear; seven heard is 70% and the model reads. */
  const NATO = { id: "n1", adId: "91", body: "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo" };
  const OTHER = { id: "o1", adId: "92", body: "nothing in this one sounds like the other script at all ok" };

  test("exactly at the floor, with a clear lead, the free check decides", async () => {
    const impl = modelSaying("never reached");
    const res = await matchTakeToScript({
      transcript: "alpha bravo charlie delta echo foxtrot golf hotel india",
      candidates: [NATO, OTHER], env: LIVE, fetchImpl: impl
    });
    assert.equal(impl.calls.length, 0);
    assert.equal(res.method, "overlap");
    assert.equal(res.confidence, MATCH_CONFIDENCE_FLOOR);
  });

  test("one pair under the floor, the model is asked instead", async () => {
    const impl = modelSaying('{"scriptId":"n1","confidence":90,"reason":"partial read"}');
    const res = await matchTakeToScript({
      transcript: "alpha bravo charlie delta echo foxtrot golf hotel",
      candidates: [NATO, OTHER], env: LIVE, fetchImpl: impl
    });
    assert.equal(impl.calls.length, 1);
    assert.equal(res.method, "model");
    assert.equal(res.scriptId, "n1");
  });

  test("two scripts that share lines are not decided by overlap — the model reads them", async () => {
    const a = { id: "a", adId: "95", body: "Most people apply in the wrong order and the bank says no. Book the call today." };
    const b = { id: "b", adId: "96", body: "Most people apply in the wrong order and the bank says no. Grab the book tonight." };
    const ranked = rankByOverlap("most people apply in the wrong order and the bank says no book the call today", [a, b]);
    assert.ok(ranked[0].score - ranked[1].score < OVERLAP_CLEAR_MARGIN, "the two are close by construction");
    const impl = modelSaying('{"scriptId":"a","confidence":92,"reason":"call close"}');
    const res = await matchTakeToScript({
      transcript: "most people apply in the wrong order and the bank says no book the call today",
      candidates: [a, b], env: LIVE, fetchImpl: impl
    });
    assert.equal(impl.calls.length, 1);
    assert.equal(res.scriptId, "a");
  });

  test("a tiny script fully said inside another take never wins on overlap alone", () => {
    const tiny = { id: "t", adId: "97", body: "book the call" };
    const ranked = rankByOverlap("so just go ahead and book the call today", [tiny, CANDIDATES[1]]);
    assert.equal(ranked[0].score, 1);
    assert.ok(ranked[0].heard < OVERLAP_MIN_PAIRS);
    assert.equal(clearOverlapWinner(ranked), null);
  });
});

describe("the call, when the free check is unclear", () => {
  test("IT GOES TO ANTHROPIC, even when an OpenAI key is sitting there", async () => {
    const impl = modelSaying('{"scriptId":"s1","confidence":96,"reason":"same order"}');
    await matchTakeToScript({
      transcript: UNCLEAR, candidates: CANDIDATES,
      env: { ...LIVE, OPENAI_API_KEY: "sk-openai-should-not-be-used" },
      fetchImpl: impl
    });
    assert.match(impl.calls[0].url, /api\.anthropic\.com/,
      "the owner's decision for this pipeline is Claude; callModel prefers OpenAI unless the env says otherwise");
  });

  test("a model match comes back with its ad number", async () => {
    const impl = modelSaying('{"scriptId":"s1","confidence":96,"reason":"same order, same close"}');
    const res = await matchTakeToScript({ transcript: UNCLEAR, candidates: CANDIDATES, env: LIVE, fetchImpl: impl });
    assert.equal(res.ok, true);
    assert.equal(res.method, "model");
    assert.equal(res.scriptId, "s1");
    assert.equal(res.adId, "43");
    assert.equal(res.confidence, 96);
  });

  test("the take and every candidate (there are only two) reach the prompt", async () => {
    const impl = modelSaying('{"scriptId":"s1","confidence":96}');
    await matchTakeToScript({ transcript: UNCLEAR, candidates: CANDIDATES, env: LIVE, fetchImpl: impl });
    const sent = impl.calls[0].body.messages[0].content;
    assert.match(sent, /thing about banks/);
    assert.match(sent, /scriptId: s1/);
    assert.match(sent, /scriptId: s2/);
  });

  test("AN UNCLEAR CASE SENDS AT MOST 3 CANDIDATES, best overlap first", async () => {
    assert.equal(MAX_CANDIDATES, 3);
    const impl = modelSaying('{"scriptId":null,"confidence":0}');
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, adId: String(100 + i), body: `filler script number ${i} about nothing` }));
    // A half read of s1: it ranks first but is under the floor, so the model reads.
    const halfRead = "most people apply in the wrong order";
    await matchTakeToScript({ transcript: halfRead, candidates: [...many, CANDIDATES[0]], env: LIVE, fetchImpl: impl });
    assert.equal(impl.calls.length, 1);
    assert.equal(sentScripts(impl), 3);
    const sent = impl.calls[0].body.messages[0].content;
    assert.ok(sent.indexOf("scriptId: s1") !== -1 && sent.indexOf("scriptId: s1") < sent.indexOf("--- script 2 ---"),
      "the script the take most overlaps is the first one the model sees");
  });

  test("the model may only pick from the 3 it was shown", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, adId: String(100 + i), body: `script ${i}` }));
    const impl = modelSaying('{"scriptId":"x9","confidence":99,"reason":"picked one it was not shown"}');
    const res = await matchTakeToScript({ transcript: UNCLEAR, candidates: many, env: LIVE, fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.scriptId, null);
  });
});

describe("when it cannot answer", () => {
  test("no key and an unclear take means no call and a RETRYABLE wait, not a guess", async () => {
    const impl = modelSaying("never reached");
    const res = await matchTakeToScript({ transcript: UNCLEAR, candidates: CANDIDATES, env: {}, fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.retryable, true);
    assert.match(res.reason, /ANTHROPIC_API_KEY/);
    assert.equal(impl.calls.length, 0);
  });

  test("a vendor error is retryable — the take is fine, the vendor is not", async () => {
    const impl = modelSaying("no credits remaining", { status: 429 });
    const res = await matchTakeToScript({ transcript: UNCLEAR, candidates: CANDIDATES, env: LIVE, fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.retryable, true);
  });

  test("no transcript and no candidates are both refused without a call", async () => {
    const impl = modelSaying("never reached");
    assert.equal((await matchTakeToScript({ transcript: "", candidates: CANDIDATES, env: LIVE, fetchImpl: impl })).ok, false);
    assert.equal((await matchTakeToScript({ transcript: TAKE, candidates: [], env: LIVE, fetchImpl: impl })).ok, false);
    assert.equal(impl.calls.length, 0);
  });
});

describe("THE ONE THAT MATTERS — a low-confidence match is not a match", () => {
  test("the floor is still 80", () => {
    assert.equal(MATCH_CONFIDENCE_FLOOR, 80);
  });

  test("under the floor, nothing is matched and a person is named as the next step", async () => {
    const impl = modelSaying(`{"scriptId":"s1","confidence":${MATCH_CONFIDENCE_FLOOR - 1},"reason":"could be either"}`);
    const res = await matchTakeToScript({ transcript: UNCLEAR, candidates: CANDIDATES, env: LIVE, fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.scriptId, null, "a near-miss must not become a fact downstream");
    assert.equal(res.retryable, false, "trying the same question again gives the same answer");
    assert.match(res.reason, /person/);
  });

  test("exactly at the floor is a match", async () => {
    const impl = modelSaying(`{"scriptId":"s1","confidence":${MATCH_CONFIDENCE_FLOOR}}`);
    const res = await matchTakeToScript({ transcript: UNCLEAR, candidates: CANDIDATES, env: LIVE, fetchImpl: impl });
    assert.equal(res.ok, true);
  });

  test("a script id the model invented is not accepted", async () => {
    const impl = modelSaying('{"scriptId":"s999","confidence":99,"reason":"made it up"}');
    const res = await matchTakeToScript({ transcript: UNCLEAR, candidates: CANDIDATES, env: LIVE, fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.scriptId, null);
  });

  test("an explicit null is honoured rather than nudged to the nearest", async () => {
    const impl = modelSaying('{"scriptId":null,"confidence":20,"reason":"none of these"}');
    const res = await matchTakeToScript({ transcript: UNCLEAR, candidates: CANDIDATES, env: LIVE, fetchImpl: impl });
    assert.equal(res.ok, false);
    assert.equal(res.adId, null);
  });
});
