"""Lay the see-through clips on the finished PORTRAIT ad (1080x1920), using schedule.json. ONE encode, audio copied.

  python3 -I marketing/ads/animation-plans/direct-book-ad-4-test-2026-10-23/tools/build-from-schedule.py <clips_dir> <out.mp4> [source.mp4] [--behind <masks_dir>]

Portrait version of the thank-you tool. Each schedule row has: start_s, frames, scale, x, y.
  scale : the clip (a 1080x1920 ProRes 4444 render) is scaled to scale*1080 x scale*1920 first.
  x, y  : where the top-left corner of that scaled clip frame sits on the video (may be negative; the clip is
          see-through outside its own cards, so a negative offset only moves the card).
--behind puts the animations BEHIND him, green-screen style: <masks_dir> holds m_%05d.png (white = person, frame index
at 30 fps) for every frame inside an animation window, made by tools/matte.swift (macOS Vision person segmentation).
Frames outside the windows get a black mask (nothing on top). His cut-out is laid back over the finished composite, so a
card that reaches behind his head is hidden by him. Without --behind the clips go over him.

The source is read only. Prints the ffmpeg command it runs.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHED = json.load(open(os.path.join(os.path.dirname(HERE), "schedule.json")))
FF = os.environ.get("FFMPEG", "/Users/chrisstanbridge/.local/bin/ffmpeg")
W, H = SCHED["width"], SCHED["height"]
argv = sys.argv[1:]
behind = None
if "--behind" in argv:
    i = argv.index("--behind")
    behind = argv[i + 1]
    del argv[i:i + 2]
clips, out = argv[0], argv[1]
src = argv[2] if len(argv) > 2 else os.path.expanduser("~/Downloads/direct-book-ad-4 (edited no animation).mp4")

args = [FF, "-hide_banner", "-nostats", "-y", "-i", src]
for c in SCHED["clips"]:
    args += ["-i", os.path.join(clips, c["clip"])]
matte_in = []
if behind:
    total = SCHED["video_frames"]
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
    matte_in = ["-framerate", "30", "-start_number", "0", "-i", os.path.join(full, "m_%05d.png")]
g, prev = [], "0:v"
for i, c in enumerate(SCHED["clips"], 1):
    sf, fr = round(c["start_s"] * 30), c["frames"]
    s = c.get("scale", 1.0)
    sw, sh = round(W * s / 2) * 2, round(H * s / 2) * 2
    scale = "" if s == 1.0 else f",scale={sw}:{sh}:flags=lanczos"
    # a short fade in and out, so a white plate never pops on or off in one frame (SCHED "fade_s", default 0.2 s)
    fd = SCHED.get("fade_s", 0.2)
    fade = f",fade=t=in:st={sf / 30:.4f}:d={fd}:alpha=1,fade=t=out:st={(sf + fr) / 30 - fd:.4f}:d={fd}:alpha=1" if fd else ""
    g.append(f"[{i}:v]trim=end_frame={fr},setpts=PTS-STARTPTS+{sf}/(30*TB){scale},format=yuva420p{fade}[a{i}]")
    g.append(f"[{prev}][a{i}]overlay=x={c.get('x', 0)}:y={c.get('y', 0)}:eof_action=pass:enable='between(t,{(sf - 0.5) / 30:.6f},{(sf + fr - 0.5) / 30:.6f})'[v{i}]")
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
         "-color_range", "tv", "-r", "30", "-c:a", "copy", "-movflags", "+faststart", out]
print(" ".join(f'"{a}"' if " " in a else a for a in args))
subprocess.run(args, check=True)
