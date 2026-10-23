#!/usr/bin/env python3
# Edit one talking-head video before Submagic: cut the mess-ups you list, shorten
# long pauses, clean and level the sound for Facebook (-14 LUFS, peak under -1.5).
# Skill: .cursor/skills/fundhub-ad-editor/SKILL.md
#
# usage: python3 scripts/ad-video-edit/edit.py <cuts.json> <in.mp4> <out.mp4>
#
# cuts.json:
#   { "start": 0.05,            # first frame kept (seconds)
#     "end": 78.25,             # last moment kept
#     "mess": [[44.58, 45.48, "so that way - false start"], ...] }
#
#   optional: "pause_max": 0.28, "pause_keep": 0.20
#
# Only the "mess" cuts remove words. Pauses are found by ffmpeg and only shortened
# (anything over 0.28 s becomes 0.20 s), so no word is ever cut by the pause step.
# Chris 2026-10-23: 0.45 -> 0.30 was not tight enough.
# The source picture size is kept. The input file is never changed.
import json, os, re, subprocess, sys

FPS = 30
PAUSE_MAX, PAUSE_KEEP = 0.28, 0.20
FADE = 0.012  # 12 ms fade at every cut so a join never clicks
CHAIN = ("highpass=f=70,afftdn=nr=8:nf=-50:tn=1,"
         "acompressor=threshold=-30dB:ratio=2.5:attack=8:release=150:knee=6")
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")


def run(args):
    return subprocess.run([FFMPEG, "-hide_banner", "-nostats", *args],
                          capture_output=True, text=True).stderr


def silences(src, min_len=0.2):
    """Pauses, including HANGING TAILS: the dead air after a trailing word
    ("somebody else......"), with any breath or room noise in it.

    ffmpeg's silencedetect misses these: it checks single sample peaks, so a
    breath or room hiss in the gap reads as sound. This uses loudness over
    40 ms windows instead. Quiet = under the room's own noise + 9 dB.
    """
    import numpy as np
    pcm = subprocess.run([FFMPEG, "-loglevel", "error", "-i", src, "-vn", "-ac", "1",
                          "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    x = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
    hop, win = 160, 640  # 10 ms steps, 40 ms windows
    n = max(0, (len(x) - win) // hop)
    db = np.array([10 * np.log10(np.mean(x[i * hop:i * hop + win] ** 2) + 1e-10) for i in range(n)])
    quiet = db < np.percentile(db, 10) + 9
    out, i = [], 0
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            # window i covers i*hop .. i*hop+win; the quiet part is its middle
            a, b = (i * hop + win / 2) / 16000, ((j - 1) * hop + win / 2) / 16000
            if b - a >= min_len:
                out.append((a, b))
            i = j
        else:
            i += 1
    return out


def keep_list(plan, sil):
    start, end = plan["start"], plan["end"]
    pmax, pkeep = plan.get("pause_max", PAUSE_MAX), plan.get("pause_keep", PAUSE_KEEP)
    cuts = [(a, b) for a, b, *_ in plan["mess"]]
    for a, b in sil:
        if b - a > pmax and start < a and b < end:
            # 70% of the kept air goes after the word: word ends ("-s", "-th") fade
            # out softly and get clipped first; word starts are sharp.
            cuts.append((a + pkeep * 0.7, b - pkeep * 0.3))
    cuts.sort()
    merged = []
    for a, b in cuts:  # a pause inside a mess cut is already gone
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else:
            merged.append((a, b))
    snap = lambda t: round(t * FPS) / FPS
    keep, t = [], start
    for a, b in merged:
        keep.append((snap(t), snap(a)))
        t = b
    keep.append((snap(t), snap(end)))
    return [(a, b) for a, b in keep if b - a > 2 / FPS], merged


def graph(keep, tail, video):
    f = []
    for i, (a, b) in enumerate(keep):
        if video:
            f.append(f"[0:v]trim={a:.4f}:{b:.4f},setpts=PTS-STARTPTS[v{i}]")
        f.append(f"[0:a]atrim={a:.4f}:{b:.4f},asetpts=PTS-STARTPTS,"
                 f"afade=t=in:d={FADE},afade=t=out:st={b - a - FADE:.4f}:d={FADE}[a{i}]")
    n = len(keep)
    ins = "".join(f"[v{i}][a{i}]" if video else f"[a{i}]" for i in range(n))
    f.append(f"{ins}concat=n={n}:v={int(video)}:a=1" + ("[v][ac]" if video else "[ac]"))
    f.append(f"[ac]{CHAIN},{tail},aresample=48000,aformat=channel_layouts=stereo[a]")
    return ";".join(f)


def main():
    plan_path, src, out = sys.argv[1:4]
    plan = json.load(open(plan_path))
    keep, cuts = keep_list(plan, silences(src))
    for a, b in cuts:
        print(f"cut {a:.2f}-{b:.2f}")
    print(f"{len(keep)} pieces, new length {sum(b - a for a, b in keep):.2f}s")

    # pass 1: how loud is the cut voice after cleanup
    log = run(["-i", src, "-filter_complex",
               graph(keep, "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", False),
               "-map", "[a]", "-f", "null", "-"])
    measured = float(re.search(r'"input_i" : "(-?[\d.]+)"', log).group(1))
    tail = f"volume={-14 - measured:.2f}dB,alimiter=limit=0.79:attack=2:release=60:level=false"

    # pass 2: one encode
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", src,
                    "-filter_complex", graph(keep, tail, True), "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-profile:v", "high", "-preset", "fast", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
                    "-colorspace", "bt709", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k",
                    "-ar", "48000", "-movflags", "+faststart", out], check=True)

    # check the result
    log = run(["-i", out, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])
    summary = log[log.rfind("Summary"):]
    loud = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1))
    peak = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))
    longest = max([b - a for a, b in silences(out, 0.05)] or [0])
    ok = abs(loud + 14) <= 1 and peak <= -1.5 and longest <= plan.get("pause_max", PAUSE_MAX) + 0.02
    print(f"loudness {loud} LUFS, peak {peak} dBFS, longest pause {longest:.2f}s -> "
          f"{'PASS' if ok else 'FAIL'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
