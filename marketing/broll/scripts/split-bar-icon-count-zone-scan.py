"""Zone scan for SplitBar and IconCount (vertical and Wide, unit N6).

Render every frame see-through with decoration off, as PNG. From marketing/broll:

  npx remotion render src/index.ts SplitBar out/zone/SplitBar --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts SplitBarWide out/zone/SplitBarWide-left --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts SplitBarWide out/zone/SplitBarWide-right --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true,"side":"right"}'

(same for IconCount, and SplitBar again with the fill-in props), then run:

  python3 scripts/split-bar-icon-count-zone-scan.py out/zone/SplitBar out/zone/SplitBarWide-left out/zone/SplitBarWide-right ...

A folder whose name ends in "-right" is checked against the right panel; any
other wide folder against the left panel. The frame size picks vertical or wide.

What it proves: no pixel with alpha above 0 lands outside the allowed zone, in
any frame (board rule, ops/workflows/animation-builds-2026-10-22.md).
- Vertical 1080x1920: allowed y 269-1247 (the text-safe band), full width.
- Wide 3840x2160: allowed x 192-1499 (left) or x 2340-3647 (right), y 108-1511.
  Nothing in the middle column (x 1500-2339), nothing in the bottom 30%.
It also counts frames that drew anything, so an empty render cannot pass, and
checks the four corners (and, wide, the middle column) are alpha 0.
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


def scan(folder):
    folder = Path(folder)
    side = "right" if folder.name.endswith("-right") else "left"
    frames = sorted(folder.glob("*.png"))
    if not frames:
        print(f"{folder}: no frames")
        return False
    mask = None
    bad = []
    drawn = 0
    worst = 0
    drawn_px = 0
    for fp in frames:
        im = Image.open(fp)
        if im.mode != "RGBA":
            bad.append((fp.name, f"mode {im.mode}, no alpha"))
            continue
        if mask is None:
            mask = allowed_mask(im.size, side)
        a = np.asarray(im)[:, :, 3]
        on = a > 0
        if on.any():
            drawn += 1
        drawn_px = max(drawn_px, int(on.sum()))
        out = int((on & ~mask).sum())
        corners = [int(a[0, 0]), int(a[0, -1]), int(a[-1, 0]), int(a[-1, -1])]
        if any(corners):
            bad.append((fp.name, f"corner alpha {corners}"))
        if im.size == WIDE and int(a[:, 1500:2340].max()) > 0:
            bad.append((fp.name, "middle column not empty"))
        worst = max(worst, out)
        if out:
            ys, xs = np.nonzero(on & ~mask)
            bad.append((fp.name, f"{out} pixels outside the zone, x {xs.min()}-{xs.max()}, y {ys.min()}-{ys.max()}"))
    kind = "vertical" if mask is not None and mask.shape == (VERTICAL[1], VERTICAL[0]) else f"wide {side}"
    ok = not bad and drawn > 0
    print(f"{folder.name} ({kind}): {len(frames)} frames, {drawn} drew something (most {drawn_px} px), "
          f"frames failing: {len(bad)}, worst frame: {worst} pixels outside the zone")
    for name, why in bad[:10]:
        print(f"  {name}: {why}")
    return ok


if __name__ == "__main__":
    results = [scan(f) for f in sys.argv[1:]]
    sys.exit(0 if results and all(results) else 1)
