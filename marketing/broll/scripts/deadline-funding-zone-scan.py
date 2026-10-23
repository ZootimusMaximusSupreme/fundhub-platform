"""Alpha safe-zone scan for DeadlineClocks and FundingStack (unit N2,
ops/workflows/animation-builds-2026-10-22.md). Same idea as
offer-cta-zone-scan.py, but on see-through renders: there is no page, so any
pixel with alpha > 0 is something drawn.

Render every frame see-through with decoration off, as PNG (a props file keeps
the JSON out of the shell):

  echo '{"transparent":true,"checkTextOnly":true}' > out/tc.json
  echo '{"transparent":true,"checkTextOnly":true,"side":"right"}' > out/tc-right.json
  npx remotion render src/index.ts DeadlineClocks out/zone/dc-v --sequence --image-format=png --props=out/tc.json
  npx remotion render src/index.ts DeadlineClocksWide out/zone/dc-w-left --sequence --image-format=png --props=out/tc.json
  npx remotion render src/index.ts DeadlineClocksWide out/zone/dc-w-right --sequence --image-format=png --props=out/tc-right.json

then run:

  python3 scripts/deadline-funding-zone-scan.py vertical out/zone/dc-v
  python3 scripts/deadline-funding-zone-scan.py wide-left out/zone/dc-w-left
  python3 scripts/deadline-funding-zone-scan.py wide-right out/zone/dc-w-right

Allowed zones (the board's shared rules):
  vertical    x 0-1079,    y 269-1247
  wide-left   x 192-1499,  y 108-1511
  wide-right  x 2340-3647, y 108-1511
It prints, per folder: frames, frames with a drawn pixel outside the zone, the
total of such pixels, and the box that holds every drawn pixel across all
frames. Exit 1 when any pixel lands outside.

`corners <png...>` prints the alpha of the four corner pixels (and, on a wide
frame, the highest alpha anywhere in the middle column x 1500-2339) of
see-through stills.
"""
import sys
from pathlib import Path

from PIL import Image

ZONES = {
    "vertical": ((1080, 1920), (0, 269, 1080, 1248)),
    "wide-left": ((3840, 2160), (192, 108, 1500, 1512)),
    "wide-right": ((3840, 2160), (2340, 108, 3648, 1512)),
}


def outside_count(alpha, box):
    """Pixels with alpha > 0 outside `box` (x0, y0, x1, y1; x1/y1 exclusive)."""
    w, h = alpha.size
    x0, y0, x1, y1 = box
    mask = Image.new("L", (w, h), 255)
    mask.paste(0, box)
    hidden = Image.composite(alpha, Image.new("L", (w, h), 0), mask)
    hist = hidden.histogram()
    return sum(hist[1:])


def scan(kind, folder):
    size, box = ZONES[kind]
    frames = sorted(Path(folder).glob("*.png"))
    if not frames:
        print(f"{folder}: no frames")
        return False
    bad = []
    total = 0
    union = None
    edge = 0  # highest alpha in the 3 px just inside the zone's edges (a hard cut shows as a high number)
    for fp in frames:
        im = Image.open(fp)
        if im.size != size or im.mode != "RGBA":
            bad.append((fp.name, f"size {im.size} mode {im.mode}"))
            continue
        a = im.split()[3]
        bb = a.getbbox()
        if bb:
            union = bb if union is None else (min(union[0], bb[0]), min(union[1], bb[1]), max(union[2], bb[2]), max(union[3], bb[3]))
        x0, y0, x1, y1 = box
        bands = [(x0, y0, x0 + 3, y1), (x1 - 3, y0, x1, y1), (x0, y0, x1, y0 + 3), (x0, y1 - 3, x1, y1)]
        if kind == "vertical":
            bands = bands[2:]  # the vertical zone is the full width; its sides are the frame edge
        edge = max([edge] + [a.crop(b).getextrema()[1] for b in bands])
        n = outside_count(a, box)
        if n:
            total += n
            bad.append((fp.name, f"{n} drawn pixels outside the zone"))
    print(
        f"{folder} [{kind}, allowed x {box[0]}-{box[2] - 1} y {box[1]}-{box[3] - 1}]: {len(frames)} frames, "
        f"frames with a drawn pixel outside: {len(bad)}, pixels outside: {total}, drawn box over all frames: {union}, "
        f"highest alpha at the zone edge: {edge}"
    )
    for name, why in bad[:10]:
        print(f"  {name}: {why}")
    return not bad


def corners(paths):
    ok = True
    for p in paths:
        im = Image.open(p)
        if im.mode != "RGBA":
            print(f"{p}: mode {im.mode}, no alpha")
            ok = False
            continue
        w, h = im.size
        a = im.split()[3]
        c = [a.getpixel(xy) for xy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
        line = f"{p}: corners alpha {c}"
        if w == 3840:
            mid = a.crop((1500, 0, 2340, h)).getextrema()[1]
            line += f", middle column max alpha {mid}"
            ok = ok and mid == 0
        ok = ok and c == [0, 0, 0, 0]
        print(line)
    return ok


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    if sys.argv[1] == "corners":
        sys.exit(0 if corners(sys.argv[2:]) else 1)
    kind = sys.argv[1]
    results = [scan(kind, f) for f in sys.argv[2:]]
    sys.exit(0 if results and all(results) else 1)
