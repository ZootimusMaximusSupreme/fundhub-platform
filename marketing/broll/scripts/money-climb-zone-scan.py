"""Alpha zone scan for MoneyClimb (same idea as scripts/offer-cta-zone-scan.py, on alpha instead of the paper).

Render every frame see-through with decoration off, as PNG:

  npx remotion render src/index.ts MoneyClimb out/zone/MoneyClimb --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts MoneyClimbWide out/zone/MoneyClimbWide --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'

then run:  python3 scripts/money-climb-zone-scan.py out/zone/MoneyClimb out/zone/MoneyClimbWide
(add --right for folders rendered with "side":"right").

Each folder holds PNG frames rendered with {"transparent":true,"checkTextOnly":true}.
Vertical 1080x1920: allowed rows y 269-1247. Wide 3840x2160: allowed box is the
side panel (left x 192-1499 or right x 2340-3647, y 108-1511). Any pixel with
alpha > 0 outside the allowed box fails.

usage: python3 zone_scan.py [--right] <folder>...
"""
import sys
from pathlib import Path

from PIL import Image

right = "--right" in sys.argv
folders = [a for a in sys.argv[1:] if not a.startswith("--")]


def allowed(w, h):
    if (w, h) == (1080, 1920):
        return (0, 269, 1080, 1248)
    if (w, h) == (3840, 2160):
        return (2340, 108, 3648, 1512) if right else (192, 108, 1500, 1512)
    raise SystemExit(f"unexpected size {w}x{h}")


ok_all = True
for folder in folders:
    frames = sorted(Path(folder).glob("*.png"))
    bad = 0
    worst = 0
    drawn_inside = 0
    for fp in frames:
        im = Image.open(fp)
        if im.mode != "RGBA":
            print(f"{fp}: no alpha channel ({im.mode})")
            bad += 1
            continue
        a = im.getchannel("A")
        x0, y0, x1, y1 = allowed(*im.size)
        m = a.point(lambda v: 255 if v > 0 else 0)
        total = m.histogram()[255]
        inside = m.crop((x0, y0, x1, y1)).histogram()[255]
        out = total - inside
        drawn_inside = max(drawn_inside, inside)
        if out:
            bad += 1
            worst = max(worst, out)
    ok = bool(frames) and bad == 0 and drawn_inside > 0
    ok_all &= ok
    print(f"{Path(folder).name}: {len(frames)} frames, frames with alpha>0 outside the zone: {bad} (worst {worst} px), most drawn px inside: {drawn_inside}")
sys.exit(0 if ok_all else 1)
