"""Text-only safe-zone scan for the OfferStack and BookCall clips.

Render every frame with decoration switched off (money drops out), as PNG:

  npx remotion render src/index.ts OfferStack out/zone/OfferStack --sequence --image-format=png --props='{"checkTextOnly":true}'
  npx remotion render src/index.ts BookCall out/zone/BookCall --sequence --image-format=png --props='{"checkTextOnly":true}'

then run:  python3 scripts/offer-cta-zone-scan.py out/zone/OfferStack out/zone/BookCall

What it proves: in the no-text zones (y 0-268 and y 1248-1919) every frame
matches the bare brand grid exactly, so no word, number, card or shadow ever
lands there. The bare grid is the paper (#FCFCFC) and the faint grid lines,
nothing else; any other pixel counts as drawn.
"""
import sys
from pathlib import Path

from PIL import Image

TOP_END = 269  # first allowed row
BOTTOM_START = 1248  # first banned row at the bottom
W, H = 1080, 1920


def zones(im):
    top = im.crop((0, 0, W, TOP_END))
    bottom = im.crop((0, BOTTOM_START, W, H))
    return top, bottom


def grid_only(img):
    """True when every pixel is a neutral gray no darker than a grid crossing (paper ~252, line ~240, crossing ~229)."""
    for r, g, b in img.getdata():
        if max(r, g, b) - min(r, g, b) > 2 or min(r, g, b) < 225:
            return False
    return True


def scan(folder):
    frames = sorted(Path(folder).glob("*.png"))
    if not frames:
        print(f"{folder}: no frames")
        return False
    ref_top, ref_bottom = (z.convert("RGB") for z in zones(Image.open(frames[0])))
    clean_ref = grid_only(ref_top) and grid_only(ref_bottom)
    bad = []
    for fp in frames:
        im = Image.open(fp).convert("RGB")
        if im.size != (W, H):
            bad.append((fp.name, f"size {im.size}"))
            continue
        top, bottom = zones(im)
        for name, z, ref in (("top", top, ref_top), ("bottom", bottom, ref_bottom)):
            diff = sum(1 for a, b in zip(z.getdata(), ref.getdata()) if a != b)
            if diff:
                bad.append((fp.name, f"{name}: {diff} drawn pixels"))
    ok = clean_ref and not bad
    print(f"{folder}: {len(frames)} frames, reference zones grid-only: {clean_ref}, frames with drawn pixels in a no-text zone: {len(bad)}")
    for name, why in bad[:10]:
        print(f"  {name}: {why}")
    return ok


if __name__ == "__main__":
    results = [scan(f) for f in sys.argv[1:]]
    sys.exit(0 if results and all(results) else 1)
