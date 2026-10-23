"""Alpha safe-zone scan for BureauMatch and PathCards (Unit N3, animation-builds-2026-10-22).

Render every frame see-through with decoration switched off, as PNG:

  npx remotion render src/index.ts BureauMatch out/zone/BureauMatch --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts BureauMatchWide out/zone/BureauMatchWide-left --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts BureauMatchWide out/zone/BureauMatchWide-right --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true,"side":"right"}'
  (same three for PathCards / PathCardsWide)

then run:  python3 scripts/n3-zone-scan.py out/zone/BureauMatch out/zone/BureauMatchWide-left ...

The zone is picked from the folder name and frame size:
- vertical 1080x1920: drawn pixels only in y 269-1247 (top 14% and bottom 35% empty);
- wide 3840x2160, "-left": only in x 192-1499, y 108-1511;
- wide 3840x2160, "-right": only in x 2340-3647, y 108-1511.
Nothing in the middle column (x 1500-2339) or the bottom 30% (y >= 1512).

What it proves: every pixel outside the zone has alpha 0, in every frame. A
drawn pixel is any alpha > 0, so shadows count too.
"""
import sys
from pathlib import Path

from PIL import Image

VERTICAL = (1080, 1920)
WIDE = (3840, 2160)


def zone_for(folder, size):
    name = Path(folder).name.lower()
    if size == VERTICAL:
        return (0, 269, 1080, 1248), "vertical y 269-1247"
    if size == WIDE:
        if name.endswith("-right"):
            return (2340, 108, 3648, 1512), "wide right panel x 2340-3647, y 108-1511"
        return (192, 108, 1500, 1512), "wide left panel x 192-1499, y 108-1511"
    return None, f"unknown size {size}"


def scan(folder):
    frames = sorted(Path(folder).glob("*.png"))
    if not frames:
        print(f"{folder}: no frames")
        return False
    bad = []
    total_outside = 0
    union = None  # bounding box of drawn pixels over every frame
    zone = label = None
    for fp in frames:
        im = Image.open(fp)
        if im.mode != "RGBA":
            bad.append((fp.name, f"no alpha (mode {im.mode})"))
            continue
        zone, label = zone_for(folder, im.size)
        if zone is None:
            bad.append((fp.name, label))
            continue
        a = im.getchannel("A")
        box = a.getbbox()
        if box:
            union = box if union is None else (min(union[0], box[0]), min(union[1], box[1]), max(union[2], box[2]), max(union[3], box[3]))
        # Blank the zone, then anything left with alpha > 0 is outside it.
        outside = a.copy()
        outside.paste(0, zone)
        n = sum(1 for v in outside.getdata() if v > 0) if outside.getbbox() else 0
        if n:
            total_outside += n
            bad.append((fp.name, f"{n} drawn pixels outside the zone, box {outside.getbbox()}"))
    ok = not bad
    print(
        f"{folder}: {len(frames)} frames, zone {label}, "
        f"drawn area over all frames {union}, pixels outside the zone {total_outside}, frames with any: {len(bad)}"
    )
    for name, why in bad[:10]:
        print(f"  {name}: {why}")
    return ok


if __name__ == "__main__":
    results = [scan(f) for f in sys.argv[1:]]
    sys.exit(0 if results and all(results) else 1)
