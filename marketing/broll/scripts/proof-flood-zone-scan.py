"""Text-only safe-zone scan for ProofFlood (vertical) and ProofFloodWide.

Render every frame with decoration switched off (money and flashes drop out), as PNG:

  npx remotion render src/index.ts ProofFlood out/zone/ProofFlood --sequence --image-format=png --gl=angle --props='{"checkTextOnly":true}'
  npx remotion render src/index.ts ProofFloodWide out/zone/ProofFloodWide --sequence --image-format=png --gl=angle --scale=0.5 --props='{"format":"wide","checkTextOnly":true}'

then run:  python3 scripts/proof-flood-zone-scan.py out/zone/ProofFlood out/zone/ProofFloodWide

What it proves:
- vertical (1080x1920): in the no-text zones (y 0-268 and y 1248-1919) every frame
  holds only the bare brand grid, so no card, word, number or shadow lands there.
- wide (3840x2160, or a half-scale render): in the outer 5% of the frame
  (the title-safe margin) every frame holds only the bare brand grid.
The bare grid is the paper (#FCFCFC) and the faint grid lines: neutral grays no
darker than a grid crossing. Any other pixel counts as drawn.
"""
import sys
from pathlib import Path

from PIL import Image


def drawn(img):
    """Count pixels that are not bare grid: not neutral, or darker than a grid crossing (paper ~252, line ~240, crossing ~229)."""
    n = 0
    for r, g, b in img.getdata():
        if max(r, g, b) - min(r, g, b) > 2 or min(r, g, b) < 225:
            n += 1
    return n


def zones(im):
    w, h = im.size
    if h > w:  # vertical: top 14% and bottom 35%
        top_end = round(h * 0.14)
        bottom_start = round(h * 0.65)
        return [("top", im.crop((0, 0, w, top_end))), ("bottom", im.crop((0, bottom_start, w, h)))]
    mx, my = round(w * 0.05), round(h * 0.05)
    return [
        ("top margin", im.crop((0, 0, w, my))),
        ("bottom margin", im.crop((0, h - my, w, h))),
        ("left margin", im.crop((0, my, mx, h - my))),
        ("right margin", im.crop((w - mx, my, w, h - my))),
    ]


def scan(folder):
    frames = sorted(Path(folder).glob("*.png"))
    if not frames:
        print(f"{folder}: no frames")
        return False
    bad = []
    size = None
    for fp in frames:
        im = Image.open(fp).convert("RGB")
        size = im.size
        for name, z in zones(im):
            n = drawn(z)
            if n:
                bad.append((fp.name, f"{name}: {n} drawn pixels"))
    print(f"{folder}: {len(frames)} frames at {size[0]}x{size[1]}, frames with drawn pixels in a no-text zone: {len(bad)}")
    for name, why in bad[:12]:
        print(f"  {name}: {why}")
    return not bad


if __name__ == "__main__":
    results = [scan(f) for f in sys.argv[1:]]
    sys.exit(0 if results and all(results) else 1)
