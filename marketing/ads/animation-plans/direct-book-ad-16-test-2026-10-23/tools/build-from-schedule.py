"""Lay the see-through clips on the finished Direct Book Ad 16 video (1080x1920), using schedule.json. ONE encode, audio copied.

  python3 -I marketing/ads/animation-plans/direct-book-ad-16-test-2026-10-23/tools/build-from-schedule.py <clips_dir> <out.mp4> [source.mp4] [--behind <masks_dir>]

Portrait version of the thank-you builder. Differences:
  * the clips are 1080x1920 ProRes 4444 rendered at scale 1; each row of schedule.json carries its own
    "scale" and "dx"/"dy" (the scaled clip's top-left corner on the 1080x1920 video; may be negative or
    run past the frame edge, only the words have to stay on screen);
  * --behind <masks_dir>: m_%05d.png (white = person, frame index at 30 fps) for every frame inside an
    animation window, made by tools/matte.swift. His cut-out is laid back on top of the finished composite,
    so a plate that reaches behind his head or shoulder is hidden by him. Frames with no mask file get a
    black mask (nothing on top).

The source is read only. Prints the ffmpeg command it runs.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHED = json.load(open(os.path.join(os.path.dirname(HERE), "schedule.json")))
FF = os.environ.get("FFMPEG", "/Users/chrisstanbridge/.local/bin/ffmpeg")
W, H, FPS = SCHED["width"], SCHED["height"], SCHED["fps"]
argv = sys.argv[1:]
behind = None
if "--behind" in argv:
    i = argv.index("--behind")
    behind = argv[i + 1]
    del argv[i:i + 2]
clips, out = argv[0], argv[1]
src = argv[2] if len(argv) > 2 else os.path.expanduser("~/Downloads/Direct-Book-Ad-16 (Edited no Animation).mp4")

args = [FF, "-hide_banner", "-nostats", "-y", "-i", src]
for c in SCHED["clips"]:
    args += ["-i", os.path.join(clips, c["clip"])]
matte_in = []
if behind:
    total = round(SCHED["video_seconds"] * FPS)
    full = os.path.join(behind, "_full")
    os.makedirs(full, exist_ok=True)
    black = os.path.join(behind, "_black.png")
    if not os.path.exists(black):
        subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H},format=gray", "-frames:v", "1", black], check=True)
    for k in range(total):
        link, real = os.path.join(full, "m_%05d.png" % k), os.path.join(behind, "m_%05d.png" % k)
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(real if os.path.exists(real) else black, link)
    matte_in = ["-framerate", str(FPS), "-start_number", "0", "-i", os.path.join(full, "m_%05d.png")]
g, prev = [], "0:v"
for i, c in enumerate(SCHED["clips"], 1):
    sf, fr, sc = c["start_frame"], c["frames"], c["scale"]
    sw, sh = round(W * sc), round(H * sc)
    g.append(f"[{i}:v]trim=end_frame={fr},setpts=PTS-STARTPTS+{sf}/({FPS}*TB),scale={sw}:{sh}:flags=lanczos[a{i}]")
    g.append(f"[{prev}][a{i}]overlay=x={c['dx']}:y={c['dy']}:eof_action=pass:enable='between(t,{(sf - 0.5) / FPS:.6f},{(sf + fr - 0.5) / FPS:.6f})'[v{i}]")
    prev = f"v{i}"
if behind:
    mi = len(SCHED["clips"]) + 1
    args += matte_in
    g.append(f"[{mi}:v]format=gray[mk]")
    g.append("[0:v]format=yuv420p[ov]")
    g.append("[ov][mk]alphamerge[fg]")
    g.append(f"[{prev}][fg]overlay=x=0:y=0:eof_action=pass[vfinal]")
    prev = "vfinal"
args += ["-filter_complex", ";".join(g), "-map", f"[{prev}]", "-map", "0:a:0",
         "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
         "-color_range", "tv", "-r", str(FPS), "-c:a", "copy", "-movflags", "+faststart", out]
print(" ".join(f'"{a}"' if " " in a else a for a in args))
subprocess.run(args, check=True)
