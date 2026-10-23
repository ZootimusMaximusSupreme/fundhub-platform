"""Lay the see-through clips on the finished thank-you video, using schedule.json. ONE encode, audio copied.

  python3 -I marketing/ads/animation-plans/thank-you-test-2026-10-23/tools/build-from-schedule.py <clips_dir> <out.mp4> [source.mp4]

<clips_dir> holds the 8 ProRes 4444 clips named like schedule.json "clip" (rendered 2560x1440, scale 0.6667).
The source is read only. Prints the ffmpeg command it runs.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHED = json.load(open(os.path.join(os.path.dirname(HERE), "schedule.json")))
FF = os.environ.get("FFMPEG", "/Users/chrisstanbridge/.local/bin/ffmpeg")
clips, out = sys.argv[1], sys.argv[2]
src = sys.argv[3] if len(sys.argv) > 3 else os.path.expanduser("~/Downloads/Direct Book Thank You Take 1 (Edited Pre Animation).mp4")

args = [FF, "-hide_banner", "-nostats", "-y", "-i", src]
for c in SCHED["clips"]:
    args += ["-i", os.path.join(clips, c["clip"])]
g, prev = [], "0:v"
for i, c in enumerate(SCHED["clips"], 1):
    sf, fr = round(c["start_s"] * 30), c["frames"]
    g.append(f"[{i}:v]trim=end_frame={fr},setpts=PTS-STARTPTS+{sf}/(30*TB)[a{i}]")
    g.append(f"[{prev}][a{i}]overlay=x=0:y=0:eof_action=pass:enable='between(t,{(sf - 0.5) / 30:.6f},{(sf + fr - 0.5) / 30:.6f})'[v{i}]")
    prev = f"v{i}"
args += ["-filter_complex", ";".join(g), "-map", f"[{prev}]", "-map", "0:a:0",
         "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
         "-color_range", "tv", "-r", "30", "-c:a", "copy", "-movflags", "+faststart", out]
print(" ".join(f'"{a}"' if " " in a else a for a in args))
subprocess.run(args, check=True)
