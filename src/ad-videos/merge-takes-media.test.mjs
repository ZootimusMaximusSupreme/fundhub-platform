// The media half of joining takes.
//
// Two kinds of proof:
//   * the parsers and the argument lists, with no ffmpeg at all;
//   * a real join of tiny SYNTHETIC clips made by ffmpeg itself (a test
//     pattern with tone bursts for "words"), when ffmpeg is on this machine.
//     The transcriber is a fake that says which words sit in which burst, so
//     no speech-to-text runs and nothing is downloaded or paid for.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  parseProbe, parseSilence, parseBlack, parseLoudnorm, parseWhisperJson,
  segmentArgs, concatArgs, fpsExpr, masterFormat, silenceFloor, findFfmpeg,
  resolveLocalJoiner, buildMaster, probe, measureLoudness, TARGET_LUFS
} from "./merge-takes-media.mjs";

/* ═════════════════════════════════════════════════════════════════════════ */
describe("reading what ffmpeg and whisper.cpp print", () => {
  test("probe: size, frame rate, length, sound — and a phone's turned picture", () => {
    const wide = parseProbe([
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'take.mp4':",
      "  Duration: 00:01:47.53, start: 0.000000, bitrate: 41000 kb/s",
      "  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 3840x2160, 40000 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)",
      "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 191 kb/s (default)"
    ].join("\n"));
    assert.deepEqual(
      [wide.ok, wide.width, wide.height, wide.fps, wide.hasAudio, Math.round(wide.duration * 100) / 100],
      [true, 3840, 2160, 29.97, true, 107.53]);
    const tall = parseProbe([
      "  Duration: 00:00:10.00, start: 0.000000, bitrate: 41000 kb/s",
      "  Stream #0:0[0x1](und): Video: h264 (High), yuv420p(tv, bt709), 3840x2160 [SAR 1:1 DAR 16:9], 29.97 fps",
      "      Side data:",
      "        displaymatrix: rotation of -90.00 degrees",
      "  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo"
    ].join("\n"));
    assert.deepEqual([tall.width, tall.height, tall.rotation], [2160, 3840, -90]);
  });

  test("silence, black frames and loudness", () => {
    assert.deepEqual(parseSilence("[silencedetect @ 0x1] silence_start: 1.5\n[silencedetect @ 0x1] silence_end: 2.25 | silence_duration: 0.75\n[silencedetect @ 0x1] silence_start: 4", 5),
      [{ start: 1.5, end: 2.25 }, { start: 4, end: 5 }]);
    assert.deepEqual(parseBlack("[blackdetect @ 0x1] black_start:0 black_end:0.6 black_duration:0.6"), [{ start: 0, end: 0.6 }]);
    const loud = parseLoudnorm('[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-23.41",\n\t"input_tp" : "-4.10",\n\t"input_lra" : "1.0"\n}\n');
    assert.deepEqual(loud, { inputI: -23.41, inputTp: -4.1 });
    assert.deepEqual(parseLoudnorm('{ "input_i" : "-inf", "input_tp" : "-inf" }'), { inputI: null, inputTp: null });
    assert.equal(silenceFloor(-20), -45, "the floor follows the take's own level");
    assert.equal(silenceFloor(null), -45);
    assert.equal(silenceFloor(-50), -60);
  });

  test("whisper.cpp word JSON (the shape measured on this Mac 2026-10-05)", () => {
    const words = parseWhisperJson({ transcription: [
      { offsets: { from: 0, to: 40 }, text: "" },
      { offsets: { from: 40, to: 570 }, text: " Hook," },
      { offsets: { from: 2450, to: 2980 }, text: " um," }
    ] });
    assert.deepEqual(words, [{ word: "Hook,", start: 0.04, end: 0.57 }, { word: "um,", start: 2.45, end: 2.98 }]);
  });
});

describe("the argument lists", () => {
  test("a cut seeks before the input (frame-exact on re-encode) and only scales when it must", () => {
    const same = segmentArgs({ input: "a.mp4", start: 1.2, end: 3.4, width: 320, height: 240, srcWidth: 320, srcHeight: 240, fps: 25 }, "o.mp4");
    assert.ok(same.indexOf("-ss") < same.indexOf("-i"));
    assert.equal(same[same.indexOf("-t") + 1], "2.200");
    assert.ok(!same.join(" ").includes("scale="), "same size: no scaling at all");
    const down = segmentArgs({ input: "a.mp4", start: 0, end: 1, width: 1920, height: 1080, srcWidth: 3840, srcHeight: 2160, fps: 29.97 }, "o.mp4");
    assert.match(down.join(" "), /scale=1920:1080:flags=lanczos,fps=30000\/1001/);
    assert.match(down.join(" "), /afade=t=in.*afade=t=out/, "every cut fades in and out over a few milliseconds, so a join never clicks");
    assert.match(concatArgs("l.txt", "m.mp4").join(" "), /-c:v copy -af loudnorm=I=-16/);
  });

  test("frame rates", () => {
    assert.equal(fpsExpr(29.97), "30000/1001");
    assert.equal(fpsExpr(59.94), "60000/1001");
    assert.equal(fpsExpr(25), "25");
  });

  test("the master is never bigger than any take, and different shapes are refused", () => {
    const f = masterFormat([{ takeNo: 1, width: 3840, height: 2160, fps: 30 }, { takeNo: 2, width: 1920, height: 1080, fps: 30 }]);
    assert.deepEqual([f.ok, f.width, f.height], [true, 1920, 1080]);
    const same = masterFormat([{ takeNo: 1, width: 3840, height: 2160, fps: 29.97 }, { takeNo: 2, width: 3840, height: 2160, fps: 29.97 }]);
    assert.deepEqual([same.width, same.height, same.fps], [3840, 2160, "30000/1001"], "4K takes give a 4K master");
    const odd = masterFormat([{ takeNo: 1, width: 2160, height: 3840 }, { takeNo: 2, width: 3840, height: 2160 }]);
    assert.equal(odd.ok, false);
    assert.match(odd.error, /different shapes/);
  });

  test("a machine with no ffmpeg says so, and nothing is downloaded", async () => {
    const spawn = () => ({ status: 1, stdout: "" });
    assert.equal(findFfmpeg({ env: {}, spawn, exists: () => false }), null);
    const j = await resolveLocalJoiner({ env: {}, spawn, exists: () => false });
    assert.equal(j.ok, false);
    assert.match(j.why, /no ffmpeg/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   A real join, with ffmpeg, of synthetic clips.
   ═════════════════════════════════════════════════════════════════════════ */
const FFMPEG = findFfmpeg();
const real = { skip: FFMPEG ? false : "ffmpeg is not on this machine" };

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-join-test-")); });
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

/* A clip: a moving test pattern, a 440 Hz tone that is ON only inside the
   given bursts (the "words"), optional black at the start. */
function makeClip(file, { size = "320x240", duration = 5, bursts = [], level = 1, blackUntil = 0 }) {
  const on = bursts.map(([a, b]) => `between(t,${a},${b})`).join("+") || "0";
  const vf = blackUntil > 0
    ? `drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,${blackUntil})'`
    : "null";
  const r = spawnSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=25:duration=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${duration}`,
    "-vf", vf,
    "-af", `volume='${level}*if(${on},1,0)':eval=frame`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", file
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return file;
}

/* Words spread evenly over one burst. Whisper stretches word ends into the
   silence after them; so does this fake, by 0.4 s on the last word. */
function wordsIn([a, b], text, { stretch = 0.4 } = {}) {
  const ws = text.split(" ");
  const step = (b - a) / ws.length;
  return ws.map((w, i) => ({
    word: w,
    start: +(a + i * step).toFixed(3),
    end: +(a + (i + 1) * step - 0.01 + (i === ws.length - 1 ? stretch : 0)).toFixed(3)
  }));
}

const LINES = ["Alpha bravo charlie delta echo.", "Foxtrot golf hotel india juliet.", "Kilo lima mike november oscar."];

describe("a real join of synthetic takes", () => {
  test("two takes become one master: best line of each, in script order, same size, levelled, dead air cut", real, async () => {
    /* Take 1: line 1 clean; line 2 with an "um" in it; no line 3. QUIET.
       Take 2: line 2 clean; line 3 clean; a long dead start. LOUD (+12 dB). */
    const t1 = makeClip(path.join(dir, "t1.mp4"), { duration: 5, level: 1, bursts: [[0.5, 1.5], [2.5, 3.9]] });
    const t2 = makeClip(path.join(dir, "t2.mp4"), { duration: 7, level: 4, bursts: [[2.0, 3.0], [4.0, 5.0]] });
    const heard = {
      [t1]: [...wordsIn([0.5, 1.5], "Alpha bravo charlie delta echo"), ...wordsIn([2.5, 3.9], "Foxtrot golf um hotel india juliet")],
      [t2]: [...wordsIn([2.0, 3.0], "Foxtrot golf hotel india juliet"), ...wordsIn([4.0, 5.0], "Kilo lima mike november oscar")]
    };
    const files = { 1: t1, 2: t2 };
    const work = fs.mkdtempSync(path.join(dir, "w-"));
    const built = await buildMaster({
      members: [{ id: "r2", takeNo: 2 }, { id: "r1", takeNo: 1 }],
      script: { lines: LINES },
      fetchTake: async (m) => ({ ok: true, path: files[m.takeNo] }),
      transcribe: async (file) => ({ ok: true, words: heard[file] }),
      ffmpeg: FFMPEG,
      workDir: work,
      encode: { preset: "ultrafast" }
    });
    assert.equal(built.ok, true, built.error);

    assert.deepEqual(built.plan.lines.map((l) => l.pick?.takeNo), [1, 2, 2], "line 2 from the take with no um");
    assert.deepEqual(built.segments.map((s) => s.lineIndex), [0, 1, 2], "script order, each line once");

    /* Dead air: the master is the three bursts plus the pads, not the 12 s
       of the two takes. Each burst ends where the tone stops, not 0.4 s later
       where the fake "whisper" said it did. */
    const speech = 1.0 + 1.0 + 1.0;
    assert.ok(built.duration < speech + 1.0, `master ${built.duration}s is the speech plus pads`);
    assert.ok(built.duration > speech - 0.2, `master ${built.duration}s keeps every word`);

    const info = probe(FFMPEG, built.path);
    assert.deepEqual([info.width, info.height, info.hasAudio], [320, 240, true], "the takes' own size, with sound");

    const t1Take = built.takes.find((t) => t.takeNo === 1);
    const t2Take = built.takes.find((t) => t.takeNo === 2);
    assert.ok(t1Take.gainDb - t2Take.gainDb > 8,
      `the quiet take is brought up to the loud one before the join (gains ${t1Take.gainDb} vs ${t2Take.gainDb})`);
    const level = measureLoudness(FFMPEG, built.path);
    assert.ok(Math.abs(level.inputI - TARGET_LUFS) < 3, `master levelled to ${TARGET_LUFS} LUFS, measured ${level.inputI}`);
  });

  test("a bigger take is scaled down to the smaller one, never the other way", real, async () => {
    const big = makeClip(path.join(dir, "big.mp4"), { size: "640x480", duration: 3, bursts: [[0.5, 1.5]] });
    const small = makeClip(path.join(dir, "small.mp4"), { size: "320x240", duration: 3, bursts: [[0.5, 1.5]] });
    const files = { 1: big, 2: small };
    const built = await buildMaster({
      members: [{ id: "a", takeNo: 1 }, { id: "b", takeNo: 2 }],
      script: { lines: [LINES[0], LINES[1]] },
      fetchTake: async (m) => ({ ok: true, path: files[m.takeNo] }),
      transcribe: async (file) => ({ ok: true, words: wordsIn([0.5, 1.5], file === big ? "Alpha bravo charlie delta echo" : "Foxtrot golf hotel india juliet") }),
      ffmpeg: FFMPEG, workDir: fs.mkdtempSync(path.join(dir, "w-")), encode: { preset: "ultrafast" }
    });
    assert.equal(built.ok, true, built.error);
    const info = probe(FFMPEG, built.path);
    assert.deepEqual([info.width, info.height], [320, 240]);
  });

  test("black frames where a cut would start are trimmed off it", real, async () => {
    const t = makeClip(path.join(dir, "black.mp4"), { duration: 3, bursts: [[0.3, 1.3]], blackUntil: 0.6 });
    const built = await buildMaster({
      members: [{ id: "a", takeNo: 1 }],
      script: { lines: [LINES[0]] },
      fetchTake: async () => ({ ok: true, path: t }),
      transcribe: async () => ({ ok: true, words: wordsIn([0.3, 1.3], "Alpha bravo charlie delta echo") }),
      ffmpeg: FFMPEG, workDir: fs.mkdtempSync(path.join(dir, "w-")), encode: { preset: "ultrafast" }
    });
    assert.equal(built.ok, true, built.error);
    assert.ok(built.segments[0].start >= 0.55, `the cut starts after the black, at ${built.segments[0].start}`);
  });

  test("takes that do not follow the script are refused for a person, not joined", real, async () => {
    const t = makeClip(path.join(dir, "adlib.mp4"), { duration: 3, bursts: [[0.5, 1.5]] });
    const built = await buildMaster({
      members: [{ id: "a", takeNo: 1 }],
      script: { lines: LINES },
      fetchTake: async () => ({ ok: true, path: t }),
      transcribe: async () => ({ ok: true, words: wordsIn([0.5, 1.5], "something else entirely said here") }),
      ffmpeg: FFMPEG, workDir: fs.mkdtempSync(path.join(dir, "w-")), encode: { preset: "ultrafast" }
    });
    assert.equal(built.ok, false);
    assert.equal(built.retryable, false);
    assert.match(built.error, /do not follow this script/);
  });
});
