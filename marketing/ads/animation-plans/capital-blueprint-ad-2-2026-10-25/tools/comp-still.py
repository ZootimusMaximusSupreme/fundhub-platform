"""Lay one rendered see-through still on one frame of the video, with his cut-out back on top (behind mode) or not (beside mode).

  python3 comp-still.py <still.png> <video> <seconds> <out.jpg> [--masks <dir>] [--behind] [--scale S --dx X --dy Y] [--label 'LINE 1|LINE 2'] [--color bad|ok]

Used for the example stills (BAD too small, BAD empty behind head, OK behind head shows dash) and for checking
each shot of BlueprintDashboardReal on the real frame before the full render. Needs Pillow + numpy.
"""
import argparse, subprocess, os, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont
FF = os.environ.get('FFMPEG', '/Users/chrisstanbridge/.local/bin/ffmpeg')
ap = argparse.ArgumentParser()
ap.add_argument('still'); ap.add_argument('video'); ap.add_argument('t', type=float); ap.add_argument('out')
ap.add_argument('--masks'); ap.add_argument('--behind', action='store_true')
ap.add_argument('--scale', type=float, default=1.0); ap.add_argument('--dx', type=int, default=0); ap.add_argument('--dy', type=int, default=0)
ap.add_argument('--label'); ap.add_argument('--color', default='ok'); ap.add_argument('--half', action='store_true')
a = ap.parse_args()
tmp = tempfile.mktemp(suffix='.png')
subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{a.t:.3f}', '-i', a.video, '-frames:v', '1', tmp], check=True)
base = Image.open(tmp).convert('RGBA')
W, H = base.size
ov = Image.open(a.still).convert('RGBA')
if a.scale != 1.0:
    ov = ov.resize((round(ov.width * a.scale), round(ov.height * a.scale)), Image.LANCZOS)
layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
layer.paste(ov, (a.dx, a.dy), ov)
comp = Image.alpha_composite(base, layer)
if a.behind and a.masks:
    idx = round(a.t * 30)
    m = Image.open(os.path.join(a.masks, f'm_{idx:05d}.png')).convert('L').resize((W, H))
    comp = Image.composite(base, comp, m)
comp = comp.convert('RGB')
if a.label:
    d = ImageDraw.Draw(comp)
    try:
        f = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 50)
    except Exception:
        f = ImageFont.load_default()
    col = (214, 48, 49) if a.color == 'bad' else (39, 174, 96)
    lines = a.label.split('|')
    d.rectangle([0, 0, W, 30 + 62 * len(lines)], fill=col)
    for k, line in enumerate(lines):
        d.text((28, 18 + 62 * k), line.strip(), fill=(255, 255, 255), font=f)
if a.half:
    comp = comp.resize((W // 2, H // 2), Image.LANCZOS)
comp.save(a.out, quality=90)
print(a.out)
