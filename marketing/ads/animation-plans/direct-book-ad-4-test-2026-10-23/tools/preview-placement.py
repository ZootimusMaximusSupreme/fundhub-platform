"""Try a placement before rendering the video: each animation's hero still, scaled and moved as in schedule.json,
over the real video frame, with his cut-out back on top. Red line = caption band top (y 1560), orange line = Reels top
safe line (y 269).

  python3 preview-placement.py <video.mp4> <stills_dir> <masks_dir> <out.png>

<stills_dir> holds one PNG per animation named by its number, 1.png ... (a see-through hero frame made with
`npx remotion still src/index.ts <Template> <n>.png --frame=<hero> --props=<props file> --image-format=png`).
<masks_dir> holds m_%05d.png from matte.swift. The frame shown is at start_s + 0.8 x length (or "preview_t" in the row).
Needs Pillow and numpy; nothing is written but the picture.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(os.path.dirname(HERE), "schedule.json")))
FF = os.environ.get("FFMPEG", "/Users/chrisstanbridge/.local/bin/ffmpeg")
video, stills, masks, out = sys.argv[1:5]
tiles = []
for c in S["clips"]:
    t = c.get("preview_t", c["start_s"] + 0.8 * c["frames"] / 30)
    idx = round(t * 30)
    fr = f"/tmp/_prev_{idx}.png"
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-i", video, "-vf", f"select=eq(n\\,{idx})", "-vframes", "1", fr], check=True)
    base = Image.open(fr).convert("RGBA")
    still = Image.open(os.path.join(stills, f"{c['n']}.png")).convert("RGBA")
    s = c["scale"]
    still = still.resize((round(S["width"] * s), round(S["height"] * s)), Image.LANCZOS)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(still, (c["x"], c["y"]))
    comp = Image.alpha_composite(base, layer)
    mp = os.path.join(masks, "m_%05d.png" % idx)
    if os.path.exists(mp):
        comp = Image.composite(base, comp, Image.open(mp).convert("L"))
    d = ImageDraw.Draw(comp)
    d.line([(0, 1560), (S["width"], 1560)], fill=(255, 0, 0, 255), width=3)
    d.line([(0, 269), (S["width"], 269)], fill=(255, 165, 0, 255), width=2)
    tiles.append(comp.convert("RGB").resize((540, 960), Image.LANCZOS))
sheet = Image.new("RGB", (540 * len(tiles), 960))
for i, t in enumerate(tiles):
    sheet.paste(t, (540 * i, 0))
sheet.save(out)
print("saved", out)
