// The ffmpeg argument lists for one ad master (spec §9.3), checked as text.
//
// No ffmpeg runs here. Every builder is pure, so each test pins the exact
// argument list the worker will hand to ffmpeg, and each parser is fed the
// shape ffmpeg / ffprobe 6 print.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  FPS, WIDTH, HEIGHT, SAMPLES_PER_FRAME, FADE_SAMPLES, LOUDNORM, TONEMAP_CHAIN, CUT_CHECKS,
  FINAL_VIDEO, FINAL_AUDIO, NotAnAdError,
  snapPiece, probeArgs, parseProbe, isHdr, audioExtractArgs, silenceArgs, parseSilence,
  pieceArgs, blackdetectArgs, parseBlackdetect,
  loudnormPass1Args, parseLoudnorm, loudnormPass2Args,
  concatList, concatArgs, finalArgs, cutChecks
} from "./ffmpeg-plan.mjs";

const AD = "ad";

/** ffprobe -print_format json -show_format -show_streams, as an iPhone take prints it. */
function iphoneProbe({ width = 3840, height = 2160, rotation = -90, transfer = "bt709", rotateTag = null, sideData = true } = {}) {
  const video = {
    index: 0, codec_name: "hevc", codec_type: "video",
    width, height, coded_width: width, coded_height: height,
    pix_fmt: transfer === "bt709" ? "yuv420p" : "yuv420p10le",
    color_range: "tv", color_space: transfer === "bt709" ? "bt709" : "bt2020nc",
    color_transfer: transfer, color_primaries: transfer === "bt709" ? "bt709" : "bt2020",
    r_frame_rate: "30/1", avg_frame_rate: "30000/1001",
    duration: "12.345000",
    tags: { creation_time: "2026-10-03T17:15:02.000000Z", ...(rotateTag !== null ? { rotate: String(rotateTag) } : {}) },
    ...(sideData ? { side_data_list: [{ side_data_type: "Display Matrix", displaymatrix: "\n00000000:            0       65536           0\n", rotation }] } : {})
  };
  const audio = { index: 1, codec_name: "aac", codec_type: "audio", sample_rate: "48000", channels: 2 };
  return {
    streams: [video, audio, { index: 2, codec_type: "data", codec_tag_string: "mebx" }],
    format: {
      filename: "IMG_4471.MOV", nb_streams: 3, format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: "12.345678", size: "61234567",
      tags: { creation_time: "2026-10-03T17:15:00.000000Z", "com.apple.quicktime.make": "Apple" }
    }
  };
}

const tallSdr = parseProbe(iphoneProbe());
const tallHlg = parseProbe(iphoneProbe({ transfer: "arib-std-b67" }));
const tallPq = parseProbe(iphoneProbe({ transfer: "smpte2084" }));

/* ═════════════════════════════════════════════════════════════════════════ */
describe("prepare: probe, sound for Whisper, silences", () => {
  test("probeArgs asks ffprobe for the whole file as JSON", () => {
    assert.deepEqual(probeArgs({ video_kind: AD, src: "/w/take.mov" }),
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "/w/take.mov"]);
  });

  test("parseProbe reads size, fps, length, sound, color_transfer and creation_time", () => {
    assert.deepEqual(tallSdr, {
      ok: true, width: 2160, height: 3840, rotation: -90, fps: 29.97,
      color_transfer: "bt709", creation_time: "2026-10-03T17:15:00.000Z",
      duration: 12.345678, has_audio: true
    });
    assert.equal(tallHlg.color_transfer, "arib-std-b67");
    assert.equal(tallPq.color_transfer, "smpte2084");
    assert.equal(isHdr(tallHlg), true);
    assert.equal(isHdr(tallPq), true);
    assert.equal(isHdr(tallSdr), false);
    assert.equal(isHdr(null), false);
  });

  test("parseProbe: rotation ±90 swaps width and height; 0 and 180 do not", () => {
    for (const rotation of [90, -90, 270, -270]) {
      const p = parseProbe(iphoneProbe({ rotation }));
      assert.deepEqual([p.width, p.height, Math.abs(p.rotation)], [2160, 3840, 90], `rotation ${rotation}`);
    }
    for (const rotation of [0, 180, -180]) {
      const p = parseProbe(iphoneProbe({ rotation }));
      assert.deepEqual([p.width, p.height], [3840, 2160], `rotation ${rotation}`);
    }
    const old = parseProbe(iphoneProbe({ sideData: false, rotateTag: 90 }));
    assert.deepEqual([old.width, old.height, old.rotation], [2160, 3840, -90], "tags.rotate is clockwise; the display matrix is not");
    const none = parseProbe(iphoneProbe({ sideData: false }));
    assert.deepEqual([none.width, none.height, none.rotation], [3840, 2160, 0]);
  });

  test("parseProbe: string input, stream clock when the format has none, unknown is null", () => {
    const raw = iphoneProbe();
    delete raw.format.tags.creation_time;
    const p = parseProbe(JSON.stringify(raw));
    assert.equal(p.creation_time, "2026-10-03T17:15:02.000Z");

    const bare = parseProbe({ streams: [{ codec_type: "video", width: 1080, height: 1920, avg_frame_rate: "0/0", r_frame_rate: "30/1" }], format: { duration: "5" } });
    assert.deepEqual(bare, {
      ok: true, width: 1080, height: 1920, rotation: 0, fps: 30,
      color_transfer: null, creation_time: null, duration: 5, has_audio: false
    });
    assert.equal(parseProbe("not json").ok, false);
    assert.equal(parseProbe({ streams: [{ codec_type: "audio" }], format: { duration: "3" } }).ok, false, "no picture");
    assert.equal(parseProbe({ streams: [], format: { tags: { creation_time: "junk" } } }).creation_time, null);
  });

  test("audioExtractArgs: mono 16 kHz Opus at 32 kbps in .ogg", () => {
    assert.deepEqual(audioExtractArgs({ video_kind: AD, src: "/w/take.mov", out: "/w/take.ogg" }), [
      "-hide_banner", "-nostats", "-y", "-i", "/w/take.mov",
      "-map", "0:a:0", "-vn",
      "-ac", "1", "-ar", "16000",
      "-c:a", "libopus", "-b:a", "32k",
      "-map_metadata", "-1",
      "-f", "ogg", "/w/take.ogg"
    ]);
  });

  test("silenceArgs: noise -35 dB, at least 0.12 s; parseSilence reads the lines", () => {
    assert.deepEqual(silenceArgs({ video_kind: AD, src: "/w/take.ogg" }), [
      "-hide_banner", "-nostats", "-i", "/w/take.ogg",
      "-map", "0:a:0", "-vn",
      "-af", "silencedetect=noise=-35dB:d=0.12",
      "-f", "null", "-"
    ]);
    const err = [
      "[silencedetect @ 0x6000] silence_start: 0",
      "[silencedetect @ 0x6000] silence_end: 0.612 | silence_duration: 0.612",
      "size=N/A time=00:00:03.00 bitrate=N/A speed= 500x",
      "[silencedetect @ 0x6000] silence_start: 2.48104",
      "[silencedetect @ 0x6000] silence_end: 2.79 | silence_duration: 0.30896",
      "[silencedetect @ 0x6000] silence_start: 11.9"
    ].join("\n");
    assert.deepEqual(parseSilence(err, 12.345678), [
      { start: 0, end: 0.612 }, { start: 2.48104, end: 2.79 }, { start: 11.9, end: 12.345678 }
    ]);
    assert.deepEqual(parseSilence("[silencedetect @ 0x1] silence_start: 4"), [{ start: 4, end: 3604 }]);
    assert.deepEqual(parseSilence(""), []);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("cut: one piece at a time", () => {
  const SDR_PIECE = [
    "-hide_banner", "-nostats", "-y",
    "-ss", "1.000000", "-t", "2.533333", "-i", "/w/take.mov",
    "-map", "0:v:0", "-map", "0:a:0",
    "-vf", "scale=1080:1920:flags=lanczos,fps=30,setsar=1,trim=end_frame=76",
    "-af", "aresample=48000,atrim=end_sample=121600,apad=whole_len=121600," +
      "afade=t=in:ss=0:ns=720,afade=t=out:ss=120880:ns=720",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
    "-map_metadata", "-1",
    "-f", "mov", "/w/piece-0001.mov"
  ];
  const base = { video_kind: AD, src: "/w/take.mov", out: "/w/piece-0001.mov", start: 1.01, end: 3.52, probe: tallSdr };

  test("snapPiece: both edges on the 1/30 s grid, frames = round(30·D), sound = frames × 1600", () => {
    assert.deepEqual(snapPiece({ start: 1.01, end: 3.52 }), {
      start: 1, end: 106 / 30, duration: 76 / 30, frames: 76, samples: 121600
    });
    assert.equal(SAMPLES_PER_FRAME, 1600);
    assert.equal(FADE_SAMPLES, 720, "15 ms at 48 kHz");
    assert.equal(snapPiece({ start: -0.01, end: 0.1 }).start, 0, "never before the file starts");
    assert.throws(() => snapPiece({ start: Number.NaN, end: 1 }), /numbers of seconds/);
  });

  test("an SDR piece: exact argv, exact frame count, sample-exact padding and 15 ms fades", () => {
    assert.deepEqual(pieceArgs(base), SDR_PIECE);
    assert.equal(pieceArgs(base).includes("-frames:v"), false,
      "-frames:v stops the whole file at the Nth frame and cuts the sound short (measured on ffmpeg 6.0), so the cap is trim=end_frame");
  });

  test("an HDR piece (HLG and PQ): the tonemap chain goes first, word for word", () => {
    const chain =
      "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0," +
      "zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
    assert.equal(TONEMAP_CHAIN, chain);
    for (const probe of [tallHlg, tallPq]) {
      const args = pieceArgs({ ...base, probe });
      const vf = args[args.indexOf("-vf") + 1];
      assert.equal(vf, `${chain},scale=1080:1920:flags=lanczos,fps=30,setsar=1,trim=end_frame=76`);
      assert.deepEqual(args.filter((_, i) => i !== args.indexOf("-vf") + 1), SDR_PIECE.filter((_, i) => i !== SDR_PIECE.indexOf("-vf") + 1),
        "nothing else changes");
    }
  });

  test("flip: hflip after fps, before setsar and the frame cap; only when flip is exactly true", () => {
    const vf = (o) => { const a = pieceArgs({ ...base, ...o }); return a[a.indexOf("-vf") + 1]; };
    assert.equal(vf({ flip: true }), "scale=1080:1920:flags=lanczos,fps=30,hflip,setsar=1,trim=end_frame=76");
    assert.equal(vf({ probe: tallHlg, flip: true }), `${TONEMAP_CHAIN},scale=1080:1920:flags=lanczos,fps=30,hflip,setsar=1,trim=end_frame=76`);
    assert.equal(vf({ flip: "yes" }), "scale=1080:1920:flags=lanczos,fps=30,setsar=1,trim=end_frame=76");
  });

  test("frame counts and padding follow the snapped length, for many lengths", () => {
    for (const [start, end, frames] of [[0, 0.3, 9], [0.25, 0.5, 7], [10.016, 14.983, 149], [59.99, 61.0, 30], [3, 3.04, 1]]) {
      const args = pieceArgs({ ...base, start, end, probe: { ...tallSdr, duration: 120 } });
      const n = Number(/,trim=end_frame=(\d+)$/.exec(args[args.indexOf("-vf") + 1])?.[1]);
      assert.equal(n, frames, `${start}-${end}`);
      const samples = n * 1600;
      assert.equal(args[args.indexOf("-af") + 1],
        `aresample=48000,atrim=end_sample=${samples},apad=whole_len=${samples},` +
        `afade=t=in:ss=0:ns=720,afade=t=out:ss=${samples - 720}:ns=720`);
      assert.equal(args[args.indexOf("-t") + 1], (frames / 30).toFixed(6));
    }
  });

  test("gainDb: volume after the resample, held to ±12 dB, left out when 0 or missing", () => {
    const af = (gainDb) => { const a = pieceArgs({ ...base, gainDb }); return a[a.indexOf("-af") + 1]; };
    assert.ok(af(3.456).startsWith("aresample=48000,volume=3.46dB,atrim=end_sample=121600,"));
    assert.ok(af(-40).startsWith("aresample=48000,volume=-12.00dB,"));
    assert.ok(af(20).startsWith("aresample=48000,volume=12.00dB,"));
    assert.ok(af(0).startsWith("aresample=48000,atrim="));
    assert.ok(af(null).startsWith("aresample=48000,atrim="));
  });

  test("a turned phone take is tall after the ±90 swap and is accepted; a wide take is refused, never squashed", () => {
    assert.doesNotThrow(() => pieceArgs({ ...base, probe: parseProbe(iphoneProbe({ rotation: 90 })) }));
    assert.doesNotThrow(() => pieceArgs({ ...base, probe: parseProbe(iphoneProbe({ width: 1080, height: 1920, rotation: 0 })) }));
    assert.throws(() => pieceArgs({ ...base, probe: parseProbe(iphoneProbe({ rotation: 0 })) }), /3840x2160, not tall 9:16/);
    assert.throws(() => pieceArgs({ ...base, probe: parseProbe(iphoneProbe({ width: 1440, height: 1920, rotation: 0 })) }), /squash/);
  });

  test("refuses a piece that runs past the take's end (half a frame of slack), but not when the length is unknown", () => {
    const probe = { ...tallSdr, duration: 6 };
    assert.throws(() => pieceArgs({ ...base, probe, start: 4.873, end: 6.494 }), /ends at 6\.500000 s but the take ends at 6\.000000 s/);
    assert.doesNotThrow(() => pieceArgs({ ...base, probe, start: 5, end: 6 }));
    assert.doesNotThrow(() => pieceArgs({ ...base, probe: { ...probe, duration: 5.99 }, start: 5, end: 6 }), "under half a frame over");
    assert.throws(() => pieceArgs({ ...base, probe: { ...probe, duration: 5.98 }, start: 5, end: 6 }), /made-up silence/);
    assert.doesNotThrow(() => pieceArgs({ ...base, probe: { ...probe, duration: null }, start: 50, end: 52 }));
  });

  test("refuses a take with no size, no sound, or a piece under one frame", () => {
    assert.throws(() => pieceArgs({ ...base, probe: { ...tallSdr, width: null } }), /size is unknown/);
    assert.throws(() => pieceArgs({ ...base, probe: undefined }), /size is unknown/);
    assert.throws(() => pieceArgs({ ...base, probe: { ...tallSdr, has_audio: false } }), /no sound/);
    assert.throws(() => pieceArgs({ ...base, start: 2, end: 2.01 }), /shorter than one frame/);
    assert.throws(() => pieceArgs({ ...base, start: 3, end: 2 }), /shorter than one frame/);
  });

  test("blackdetectArgs catches a single black frame; parseBlackdetect reads the lines", () => {
    assert.deepEqual(blackdetectArgs({ video_kind: AD, src: "/w/piece-0001.mov" }), [
      "-hide_banner", "-nostats", "-i", "/w/piece-0001.mov",
      "-map", "0:v:0", "-an",
      "-vf", "scale=320:-2,blackdetect=d=0.03:pic_th=0.98:pix_th=0.10",
      "-f", "null", "-"
    ]);
    assert.ok(0.03 < 1 / FPS, "d is under one frame");
    assert.deepEqual(parseBlackdetect("[blackdetect @ 0x1] black_start:0 black_end:0.0333333 black_duration:0.0333333\n" +
      "[blackdetect @ 0x1] black_start:2.1 black_end:2.3 black_duration:0.2"),
    [{ start: 0, end: 0.0333333 }, { start: 2.1, end: 2.3 }]);
    assert.deepEqual(parseBlackdetect(""), []);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("loudness: two passes", () => {
  const PASS1 = [
    "[Parsed_loudnorm_0 @ 0x600001] ",
    "{",
    "\t\"input_i\" : \"-23.41\",",
    "\t\"input_tp\" : \"-4.10\",",
    "\t\"input_lra\" : \"1.00\",",
    "\t\"input_thresh\" : \"-33.66\",",
    "\t\"output_i\" : \"-14.02\",",
    "\t\"output_tp\" : \"-1.50\",",
    "\t\"output_lra\" : \"0.90\",",
    "\t\"output_thresh\" : \"-24.20\",",
    "\t\"normalization_type\" : \"dynamic\",",
    "\t\"target_offset\" : \"0.02\"",
    "}",
    "[out#0/null @ 0x600002] video:0kB audio:1kB"
  ].join("\n");

  test("loudnormPass1Args measures only: I=-14, TP=-1.5, LRA=11, JSON out, nothing written", () => {
    assert.deepEqual(LOUDNORM, { I: -14, TP: -1.5, LRA: 11 });
    assert.deepEqual(loudnormPass1Args({ video_kind: AD, src: "/w/joined.mov" }), [
      "-hide_banner", "-nostats", "-i", "/w/joined.mov",
      "-map", "0:a:0", "-vn",
      "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
      "-f", "null", "-"
    ]);
  });

  test("parseLoudnorm reads the pass-1 JSON block out of stderr", () => {
    assert.deepEqual(parseLoudnorm(PASS1), {
      ok: true,
      input_i: -23.41, input_tp: -4.1, input_lra: 1, input_thresh: -33.66, target_offset: 0.02,
      output_i: -14.02, output_tp: -1.5, normalization_type: "dynamic"
    });
    const silent = parseLoudnorm('{ "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00", "input_thresh" : "-inf", "target_offset" : "inf" }');
    assert.equal(silent.ok, false);
    assert.equal(silent.input_i, null, "a silent file is unknown, never 0");
    assert.equal(parseLoudnorm("no block here").ok, false);
    assert.equal(parseLoudnorm({ input_i: "-20", input_tp: "-3", input_lra: "4", input_thresh: "-30", target_offset: "0.1" }).ok, true, "an object already parsed");
  });

  test("loudnormPass2Args: pass 1's numbers, linear=true, then aresample=48000", () => {
    assert.deepEqual(loudnormPass2Args({ video_kind: AD, loudness: parseLoudnorm(PASS1) }), [
      "-af",
      "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-23.41:measured_TP=-4.10:measured_LRA=1.00:" +
        "measured_thresh=-33.66:offset=0.02:linear=true:print_format=json,aresample=48000"
    ]);
    const extreme = parseLoudnorm({ input_i: "-120", input_tp: "2", input_lra: "120", input_thresh: "-130", target_offset: "0" });
    assert.match(loudnormPass2Args({ video_kind: AD, loudness: extreme })[1], /measured_I=-99\.00:measured_TP=2\.00:measured_LRA=99\.00:measured_thresh=-99\.00:/,
      "held inside the ranges loudnorm accepts");
    assert.throws(() => loudnormPass2Args({ video_kind: AD, loudness: parseLoudnorm("") }), /could not be measured/);
    assert.throws(() => loudnormPass2Args({ video_kind: AD, loudness: null }), /could not be measured/);
  });

  test("concatList + concatArgs: join with no re-encode", () => {
    assert.equal(concatList(["/w/piece-0001.mov", "/w/it's.mov"]), "file '/w/piece-0001.mov'\nfile '/w/it'\\''s.mov'\n");
    assert.throws(() => concatList([]), /no pieces/);
    assert.deepEqual(concatArgs({ video_kind: AD, list: "/w/pieces.txt", out: "/w/joined.mov" }), [
      "-hide_banner", "-nostats", "-y",
      "-f", "concat", "-safe", "0", "-i", "/w/pieces.txt",
      "-map", "0:v:0", "-map", "0:a:0",
      "-c", "copy",
      "-f", "mov", "/w/joined.mov"
    ]);
  });

  test("finalArgs: pass 2 plus the one final encode (H.264 High crf 18, 12M/24M, bt709, 30 fps, AAC 192k 48 kHz stereo, +faststart)", () => {
    assert.deepEqual(finalArgs({ video_kind: AD, src: "/w/joined.mov", out: "/w/master.mp4", loudness: parseLoudnorm(PASS1) }), [
      "-hide_banner", "-nostats", "-y", "-i", "/w/joined.mov",
      "-map", "0:v:0", "-map", "0:a:0",
      "-af",
      "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-23.41:measured_TP=-4.10:measured_LRA=1.00:" +
        "measured_thresh=-33.66:offset=0.02:linear=true:print_format=json,aresample=48000",
      "-c:v", "libx264", "-profile:v", "high", "-preset", "medium",
      "-crf", "18", "-maxrate", "12M", "-bufsize", "24M",
      "-pix_fmt", "yuv420p",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
      "-fps_mode", "cfr", "-r", "30",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-map_metadata", "-1",
      "-movflags", "+faststart",
      "-f", "mp4", "/w/master.mp4"
    ]);
    assert.ok(Object.isFrozen(FINAL_VIDEO) && Object.isFrozen(FINAL_AUDIO), "the overlay step reuses these, so nobody can change them in place");
    assert.throws(() => finalArgs({ video_kind: AD, src: "/w/joined.mov", out: "/w/master.mp4", loudness: parseLoudnorm("") }), /could not be measured/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("cut checks (best-of-clips law): any failure blocks the master", () => {
  const pieces = [
    { take_id: "t1", start: 0.5, end: 3.5, line_idx: 0 },
    { take_id: "t2", start: 10.0, end: 12.0, line_idx: 1 },
    { take_id: "t1", start: 7.0, end: 9.4, line_idx: 2 }
  ];
  const lufs = (i, tp = -6) => ({ ok: true, input_i: i, input_tp: tp, input_lra: 3, input_thresh: i - 10, target_offset: 0 });

  test("a clean cut passes", () => {
    const r = cutChecks({ video_kind: AD, pieces, loudness: [lufs(-20), lufs(-21.5), lufs(-19)], blackdetect: [[], [], []] });
    assert.deepEqual(r, { ok: true, reasons: [], gain_db: [0, 1.5, -1] });
  });

  test("loudness mismatch: a piece more than 3 dB off the middle piece blocks, with a plain reason", () => {
    const r = cutChecks({ video_kind: AD, pieces, loudness: [lufs(-20), lufs(-25.2), lufs(-19.5)] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.reasons, ["Piece 2 is 5.2 dB quieter than the other pieces. The sound would jump at the join."]);
    assert.deepEqual(r.gain_db, [0, 5.2, -0.5]);
    const loud = cutChecks({ video_kind: AD, pieces, loudness: [-20, -15.5, -20.5] });
    assert.deepEqual(loud.reasons, ["Piece 2 is 4.5 dB louder than the other pieces. The sound would jump at the join."], "plain numbers work too");
    assert.equal(CUT_CHECKS.loudnessToleranceDb, 3);
  });

  test("loudness: pieces under a second are not matched (no steady reading); unmeasured pieces are skipped", () => {
    const shortOne = [pieces[0], { start: 20, end: 20.6 }, pieces[2]];
    assert.equal(cutChecks({ video_kind: AD, pieces: shortOne, loudness: [lufs(-20), lufs(-30), lufs(-20)] }).ok, true);
    assert.equal(cutChecks({ video_kind: AD, pieces, loudness: [lufs(-20), null, parseLoudnorm("")] }).ok, true);
  });

  test("true peak above -1 dBTP blocks; exactly -1 passes", () => {
    const r = cutChecks({ video_kind: AD, pieces, loudness: [lufs(-20, -1), lufs(-20, -0.4), lufs(-20, -3)] });
    assert.deepEqual(r.reasons, ["Piece 2 peaks at -0.4 dB. The loudest point must stay at -1 dB or lower."]);
    const viaPeaks = cutChecks({ video_kind: AD, pieces, loudness: [-20, -20, -20], peaks: [-2, -1.5, 0.3] });
    assert.deepEqual(viaPeaks.reasons, ["Piece 3 peaks at 0.3 dB. The loudest point must stay at -1 dB or lower."]);
  });

  test("any blackdetect hit blocks: per piece, or on the joined master's clock", () => {
    const perPiece = cutChecks({ video_kind: AD, pieces, blackdetect: [[], [{ start: 0, end: 0.0333 }], []] });
    assert.deepEqual(perPiece.reasons, ["Piece 2 goes black at 0.00-0.03 s of that piece."]);
    const joined = cutChecks({ video_kind: AD, pieces, blackdetect: [{ start: 4.1, end: 4.2 }] });
    assert.deepEqual(joined.reasons, ["The picture goes black at 4.10-4.20 s of the master (piece 2)."]);
    assert.equal(cutChecks({ video_kind: AD, pieces, blackdetect: [] }).ok, true);
  });

  test("a piece shorter than 8 frames blocks; exactly 8 frames passes", () => {
    const r = cutChecks({ video_kind: AD, pieces: [pieces[0], { start: 5, end: 5.2 }, { start: 6, end: 6 + 8 / 30 }] });
    assert.deepEqual(r.reasons, ["Piece 2 is too short: 6 frames (0.20 s). Each piece needs at least 8 frames."]);
  });

  test("several failures give one reason each; no pieces blocks", () => {
    const r = cutChecks({
      video_kind: AD,
      pieces: [{ start: 0, end: 0.1 }, pieces[1], pieces[2], pieces[0]],
      loudness: [null, lufs(-20, 0), lufs(-28), lufs(-20)],
      blackdetect: [[{ start: 0, end: 0.1 }], [], [], []]
    });
    assert.equal(r.ok, false);
    assert.equal(r.reasons.length, 4);
    assert.deepEqual(cutChecks({ video_kind: AD, pieces: [] }), { ok: false, reasons: ["There are no pieces to join."], gain_db: [] });
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
describe("ads only: non-ad videos keep 4K end to end", () => {
  const probe = tallSdr;
  const loudness = parseLoudnorm({ input_i: "-20", input_tp: "-3", input_lra: "4", input_thresh: "-30", target_offset: "0" });
  const builders = {
    probeArgs: (k) => probeArgs({ video_kind: k, src: "/w/a.mov" }),
    audioExtractArgs: (k) => audioExtractArgs({ video_kind: k, src: "/w/a.mov", out: "/w/a.ogg" }),
    silenceArgs: (k) => silenceArgs({ video_kind: k, src: "/w/a.mov" }),
    pieceArgs: (k) => pieceArgs({ video_kind: k, src: "/w/a.mov", out: "/w/p.mov", start: 0, end: 2, probe }),
    blackdetectArgs: (k) => blackdetectArgs({ video_kind: k, src: "/w/p.mov" }),
    loudnormPass1Args: (k) => loudnormPass1Args({ video_kind: k, src: "/w/p.mov" }),
    loudnormPass2Args: (k) => loudnormPass2Args({ video_kind: k, loudness }),
    concatArgs: (k) => concatArgs({ video_kind: k, list: "/w/l.txt", out: "/w/j.mov" }),
    finalArgs: (k) => finalArgs({ video_kind: k, src: "/w/j.mov", out: "/w/m.mp4", loudness })
  };

  for (const [name, call] of Object.entries(builders)) {
    test(`${name} refuses a non-ad video, and a missing video_kind`, () => {
      assert.ok(Array.isArray(call("ad")), "an ad gets its argv");
      for (const kind of ["not_ad", "vsl", "AD", "", null, undefined]) {
        assert.throws(() => call(kind), (err) => {
          assert.ok(err instanceof NotAnAdError, `${name} with ${String(kind)}`);
          assert.equal(err.code, "not_an_ad");
          assert.match(err.message, new RegExp(`^${name}: this video is not an ad`));
          assert.match(err.message, /keeps 4K end to end/);
          return true;
        });
      }
    });
  }

  test("cutChecks blocks a non-ad video with a plain reason", () => {
    const r = cutChecks({ video_kind: "not_ad", pieces: [{ start: 0, end: 2 }] });
    assert.equal(r.ok, false);
    assert.match(r.reasons[0], /not an ad \(video_kind 'not_ad'\).*keeps 4K end to end/);
    assert.match(cutChecks({ pieces: [{ start: 0, end: 2 }] }).reasons[0], /video_kind missing/);
  });

  test("the master is 1080x1920 at 30 fps: legal for a paid ad only", () => {
    assert.deepEqual([WIDTH, HEIGHT, FPS], [1080, 1920, 30]);
  });
});
