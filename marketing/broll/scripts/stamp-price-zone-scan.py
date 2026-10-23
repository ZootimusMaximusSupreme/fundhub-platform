"""Zone scan for StampCard and PriceTag (unit N5) and their wide 4K versions.

Render see-through PNGs, every frame or single stills. From marketing/broll:

  npx remotion render src/index.ts StampCard out/zone/StampCard --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts StampCardWide out/zone/StampCardWide-left --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts StampCardWide out/zone/StampCardWide-right --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true,"side":"right"}'

then run:  python3 scripts/stamp-price-zone-scan.py out/zone/StampCard out/zone/StampCardWide-left out/zone/StampCardWide-right

Each argument is a folder of PNG frames or one PNG file. A name that contains
"right" is checked against the right panel; any other wide image against the
left panel. The image size picks vertical or wide.

What it proves: no pixel with alpha above 0 lands outside the allowed zone.
- Vertical 1080x1920: allowed y 269-1247 (the text-safe band), full width.
- Wide 3840x2160: allowed x 192-1499 (left) or x 2340-3647 (right), y 108-1511.
  Nothing in the middle column (x 1500-2339) and nothing in the bottom 30%.
It also reports the corner alphas, how many frames drew anything, and how many
drawn pixels each image has, so an empty render cannot pass by accident.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

VERTICAL = (1080, 1920)
WIDE = (3840, 2160)


def allowed_mask(size, side):
    w, h = size
    m = np.zeros((h, w), dtype=bool)
    if size == VERTICAL:
        m[269:1248, :] = True
    elif size == WIDE:
        x0 = 2340 if side == "right" else 192
        m[108:1512, x0:x0 + 1308] = True
    else:
        raise ValueError(f"unknown frame size {size}")
    return m


def scan(target):
    target = Path(target)
    side = "right" if "right" in target.name else "left"
    frames = sorted(target.glob("*.png")) if target.is_dir() else [target]
    if not frames:
        print(f"{target}: no frames")
        return False
    mask = None
    bad = []
    drawn_frames = 0
    worst = 0
    corners_max = 0
    middle_max = 0
    drawn_px = 0
    for fp in frames:
        im = Image.open(fp)
        if im.mode != "RGBA":
            bad.append((fp.name, f"mode {im.mode}, no alpha"))
            continue
        if mask is None:
            mask = allowed_mask(im.size, side)
        a = np.asarray(im)[:, :, 3]
        h, w = a.shape
        corners_max = max(corners_max, int(a[0, 0]), int(a[0, w - 1]), int(a[h - 1, 0]), int(a[h - 1, w - 1]))
        if (w, h) == WIDE:
            middle_max = max(middle_max, int(a[:, 1500:2340].max()))
        n = int((a > 0).sum())
        drawn_px = max(drawn_px, n)
        if n:
            drawn_frames += 1
        out = int(((a > 0) & ~mask).sum())
        worst = max(worst, out)
        if out:
            ys, xs = np.nonzero((a > 0) & ~mask)
            bad.append((fp.name, f"{out} pixels outside the zone, x {xs.min()}-{xs.max()}, y {ys.min()}-{ys.max()}"))
    kind = "vertical" if mask is not None and mask.shape == (VERTICAL[1], VERTICAL[0]) else f"wide {side}"
    ok = not bad and drawn_frames > 0 and corners_max == 0 and middle_max == 0
    mid = f", middle column max alpha {middle_max}" if kind.startswith("wide") else ""
    print(
        f"{target.name} ({kind}): {len(frames)} frames, {drawn_frames} drew something (up to {drawn_px} px), "
        f"corner max alpha {corners_max}{mid}, frames with pixels outside the zone: {len(bad)}, worst frame: {worst} pixels"
    )
    for name, why in bad[:10]:
        print(f"  {name}: {why}")
    return ok


if __name__ == "__main__":
    results = [scan(f) for f in sys.argv[1:]]
    print("ALL PASS" if results and all(results) else "FAIL")
    sys.exit(0 if results and all(results) else 1)
