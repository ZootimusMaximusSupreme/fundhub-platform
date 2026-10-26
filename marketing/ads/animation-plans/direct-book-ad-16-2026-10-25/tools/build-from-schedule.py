#!/usr/bin/env python3
"""Lay the see-through clips on the leveled Direct Book Ad 16, his cut-out back on top. ONE encode, audio copied.

  python3 tools/build-from-schedule.py <clips_dir> <masks_dir> <out.mp4> [--crf 14] [--preset slow]

Base: /tmp/ad16-redo/ad16-leveled.mp4 (picture copied from the captioned master, sound at -14 LUFS).
Each clip is a full 1080x1920 ProRes 4444 at scale 1, faded in and out over 0.2 s. masks_dir holds
m_%05d.png (white = person, every frame, tools/matte.swift from the Oct 23 folder); his cut-out goes over
the finished composite, so the card's lower middle sits behind his hair. Captions are part of the
original frames and are never drawn on. Quality bar: video bitrate at or above 16320 kb/s (the Oct 23 file).
"""
import json, os, subprocess, sys

PLAN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(PLAN, "schedule.json")))
FF = os.environ.get("FFMPEG", "/Users/chrisstanbridge/.local/bin/ffmpeg")
SRC = os.environ.get("AD16_BASE", "/tmp/ad16-redo/ad16-leveled.mp4")
FPS, W, H = S["fps"], S["width"], S["height"]

argv = sys.argv[1:]
crf, preset = "14", "slow"
if "--crf" in argv:
    i = argv.index("--crf"); crf = argv[i + 1]; del argv[i:i + 2]
if "--preset" in argv:
    i = argv.index("--preset"); preset = argv[i + 1]; del argv[i:i + 2]
clips, masks, out = argv

total = round(S["video_seconds"] * FPS)
full = os.path.join(masks, "_full")
os.makedirs(full, exist_ok=True)
black = os.path.join(masks, "_black.png")
if not os.path.exists(black):
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H},format=gray", "-frames:v", "1", black], check=True)
for k in range(total):
    link, real = os.path.join(full, "m_%05d.png" % k), os.path.join(masks, "m_%05d.png" % k)
    if os.path.lexists(link):
        os.remove(link)
    os.symlink(real if os.path.exists(real) else black, link)

args = [FF, "-hide_banner", "-nostats", "-y", "-i", SRC]
for c in S["clips"]:
    args += ["-i", os.path.join(clips, c["clip"])]
mi = len(S["clips"]) + 1
args += ["-framerate", str(FPS), "-start_number", "0", "-i", os.path.join(full, "m_%05d.png")]
g, prev = [], "0:v"
for i, c in enumerate(S["clips"], 1):
    sf, fr = c["start_frame"], c["frames"]
    dur = fr / FPS
    g.append(
        f"[{i}:v]trim=end_frame={fr},setpts=PTS-STARTPTS,format=yuva444p10le,"
        f"fade=t=in:st=0:d=0.2:alpha=1,fade=t=out:st={dur - 0.2:.3f}:d=0.2:alpha=1,"
        f"setpts=PTS-STARTPTS+{sf}/({FPS}*TB)[a{i}]"
    )
    g.append(f"[{prev}][a{i}]overlay=x=0:y=0:eof_action=pass:enable='between(t,{(sf - 0.5) / FPS:.6f},{(sf + fr - 0.5) / FPS:.6f})'[v{i}]")
    prev = f"v{i}"
g.append(f"[{mi}:v]format=gray[mk]")
g.append("[0:v]format=yuva420p[ov0]")
g.append("[ov0][mk]alphamerge[fg]")
g.append(f"[{prev}][fg]overlay=x=0:y=0:eof_action=pass[vfinal]")
args += ["-filter_complex", ";".join(g), "-map", "[vfinal]", "-map", "0:a:0",
         "-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p",
         "-colorspace", "bt709", "-color_range", "tv",
         "-r", str(FPS), "-c:a", "copy", "-movflags", "+faststart", out]
print(" ".join(f'"{a}"' if " " in a or "'" in a else a for a in args))
subprocess.run(args, check=True)
