import test from "node:test";
import assert from "node:assert/strict";
import {
  meetTitleStem,
  looksLikeTranscriptName,
  looksLikeRecordingMime,
  looksLikeMeetRecordingName
} from "./meet-title.mjs";

test("Meet recording and transcript files share a stem", () => {
  const rec = "Funding Call - Jane Doe (2026-08-24 15:00 GMT-7) - Recording.mp4";
  const doc = "Funding Call - Jane Doe (2026-08-24 15:00 GMT-7) - Transcript";
  assert.equal(meetTitleStem(rec), meetTitleStem(doc));
  assert.equal(looksLikeTranscriptName(doc), true);
  assert.equal(looksLikeTranscriptName(rec), false);
  assert.equal(looksLikeRecordingMime("video/mp4"), true);
});

test("Gemini notes count as a transcript sibling", () => {
  assert.equal(looksLikeTranscriptName("Strategy - Gemini notes"), true);
  assert.ok(meetTitleStem("Strategy - Gemini notes"));
});

test("only Google Meet names count as recordings to Whisper", () => {
  assert.equal(looksLikeMeetRecordingName("Meet Recording 2026-08-24"), true);
  assert.equal(looksLikeMeetRecordingName("Meeting Recording - Funding Call"), true);
  assert.equal(looksLikeMeetRecordingName("Google Meet - closer"), true);
  assert.equal(looksLikeMeetRecordingName("GMT20260824-funding"), true);
  assert.equal(looksLikeMeetRecordingName("Funding Call - Jane Doe (2026-08-24 15:00 GMT-7) - Recording.mp4"), true);
  assert.equal(looksLikeMeetRecordingName("1. Intro to funding.mp4"), false);
  assert.equal(looksLikeMeetRecordingName("VSL - offer.mp4"), false);
  assert.equal(looksLikeMeetRecordingName("Screen Recording 2026-08-24.mov"), false);
});
