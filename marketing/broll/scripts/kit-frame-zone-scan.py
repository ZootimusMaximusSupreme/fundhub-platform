"""Zone scan for the KitFrame templates (FileItems, HiddenDataPoints, SoftPull,
StepPath, QualifyToday) and their wide 4K versions.

Render every frame see-through, with decoration switched off (money drops
out), as PNG. From marketing/broll:

  npx remotion render src/index.ts FileItems out/zone/FileItems --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts FileItemsWide out/zone/FileItemsWide-left --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts FileItemsWide out/zone/FileItemsWide-right --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true,"side":"right"}'

then run:  python3 scripts/kit-frame-zone-scan.py out/zone/FileItems out/zone/FileItemsWide-left out/zone/FileItemsWide-right

A folder whose name ends in "-right" is checked against the right panel; any
other wide folder against the left panel. The frame size picks vertical or wide.

What it proves: no pixel with alpha above 0 lands outside the allowed zone, in
any frame.
- Vertical 1080x1920: allowed y 269-1247 (the text-safe band), full width.
- Wide 3840x2160: allowed x 192-1499 (left) or x 2340-3647 (right), y 108-1511.
  Nothing in the middle column (x 1500-2339) and nothing in the bottom 30%.
It also reports how many frames drew anything at all, so an empty render
cannot pass by accident.
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
    drawn_frames = 0
    worst = 0
    for fp in frames:
        im = Image.open(fp)
        if im.mode != "RGBA":
            bad.append((fp.name, f"mode {im.mode}, no alpha"))
            continue
        if mask is None:
            mask = allowed_mask(im.size, side)
        a = np.asarray(im)[:, :, 3]
        if (a > 0).any():
            drawn_frames += 1
        out = int(((a > 0) & ~mask).sum())
        worst = max(worst, out)
        if out:
            ys, xs = np.nonzero((a > 0) & ~mask)
            bad.append((fp.name, f"{out} pixels outside the zone, x {xs.min()}-{xs.max()}, y {ys.min()}-{ys.max()}"))
    kind = "vertical" if mask is not None and mask.shape == (VERTICAL[1], VERTICAL[0]) else f"wide {side}"
    ok = not bad and drawn_frames > 0
    print(f"{folder.name} ({kind}): {len(frames)} frames, {drawn_frames} drew something, frames with pixels outside the zone: {len(bad)}, worst frame: {worst} pixels")
    for name, why in bad[:10]:
        print(f"  {name}: {why}")
    return ok


if __name__ == "__main__":
    results = [scan(f) for f in sys.argv[1:]]
    sys.exit(0 if results and all(results) else 1)
