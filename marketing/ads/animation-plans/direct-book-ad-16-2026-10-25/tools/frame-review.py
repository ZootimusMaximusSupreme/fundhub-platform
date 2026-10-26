#!/usr/bin/env python3
"""Frame review on the final mux: frames at each clip's start, middle and end, at each payoff step, and every 5 s.

  python3 tools/frame-review.py <final.mp4> <frames_dir>

Writes <frames_dir>/t<sec>.jpg (full size) and contact-sheet-final.jpg in the plan folder
(one labeled tile per frame, 270x480). Needs Pillow.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw

PLAN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(PLAN, "schedule.json")))
FF = "/Users/chrisstanbridge/.local/bin/ffmpeg"
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

times = {}
for c in S["clips"]:
    a, n = c["start_frame"] / 30, c["frames"] / 30
    tag = f"#{c['n']}"
    times[round(a + 0.3, 1)] = f"{tag} start"
    times[round(a + n / 2, 1)] = f"{tag} mid"
    times[round(a + n - 0.3, 1)] = f"{tag} end"
    props = json.load(open(os.path.join(PLAN, c["props"])))
    for k in props.get("at", []):
        t = round(a + (k + 10) / 30, 1)
        times.setdefault(t, f"{tag} step")
for t in range(0, 68, 5):
    times.setdefault(float(t) + 0.5, "spot")
times = dict(sorted(times.items()))
tiles = []
for t, why in times.items():
    p = os.path.join(out, f"t{t:04.1f}.jpg")
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{t}", "-i", src, "-frames:v", "1", "-q:v", "3", p], check=True)
    im = Image.open(p).convert("RGB").resize((270, 480))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 456, 270, 480], fill=(0, 0, 0))
    d.text((6, 461), f"{t:.1f}s  {why}", fill=(255, 255, 255))
    tiles.append(im)
cols = 10
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (270 * cols, 480 * rows), (0, 0, 0))
for i, im in enumerate(tiles):
    sheet.paste(im, ((i % cols) * 270, (i // cols) * 480))
sheet.save(os.path.join(PLAN, "contact-sheet-final.jpg"), quality=85)
print(len(tiles), "frames")
json.dump({f"{t:.1f}": w for t, w in times.items()}, open(os.path.join(out, "times.json"), "w"), indent=1)
