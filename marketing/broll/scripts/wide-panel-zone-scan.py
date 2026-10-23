"""Caption-safe scan for see-through renders, vertical and wide (animation-builds-2026-10-22).

Render with decoration switched off and the page dropped (PNG keeps the alpha):

  npx remotion still src/index.ts InquiriesOffWide out/check.png --frame=86 --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts InquiriesOffWide out/zone/InquiriesOffWide --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'

then run:  python3 scripts/wide-panel-zone-scan.py [--side left|right] <png or folder> ...

What it proves: no pixel with alpha > 0 lands outside the allowed zone, so no
word, card or shadow sits where the face or the captions go.
  vertical 1080x1920: y 269-1248 (the kit's words band), any x
  wide 3840x2160:     the chosen side panel only; left x 192-1500, right
                      x 2340-3648, both y 108-1512
It also reads the transparent frame's four corners and, for wide, the middle
column (x 1500-2340), which must all be alpha 0.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

VERTICAL = (1080, 1920)
WIDE = (3840, 2160)
PANELS = {"left": (192, 1500), "right": (2340, 3648)}
PANEL_Y = (108, 1512)
BAND_Y = (269, 1248)


def allowed_mask(size, side):
    w, h = size
    m = np.zeros((h, w), dtype=bool)
    if size == VERTICAL:
        m[BAND_Y[0]:BAND_Y[1], :] = True
    elif size == WIDE:
        x0, x1 = PANELS[side]
        m[PANEL_Y[0]:PANEL_Y[1], x0:x1] = True
    else:
        raise SystemExit(f"unknown frame size {size}")
    return m


def scan_file(fp, side):
    im = Image.open(fp)
    if im.mode != "RGBA":
        return {"file": fp.name, "error": f"no alpha channel (mode {im.mode})"}
    a = np.asarray(im)[:, :, 3]
    size = im.size
    outside = (a > 0) & ~allowed_mask(size, side)
    h, w = a.shape
    corners = [int(a[0, 0]), int(a[0, w - 1]), int(a[h - 1, 0]), int(a[h - 1, w - 1])]
    middle = int(a[:, 1500:2340].max()) if size == WIDE else None
    inside = int(((a > 0) & allowed_mask(size, side)).sum())
    return {"file": fp.name, "size": size, "outside": int(outside.sum()), "inside": inside, "corners": corners, "middle_max": middle}


def main(argv):
    side = "left"
    paths = []
    it = iter(argv)
    for arg in it:
        if arg == "--side":
            side = next(it)
        else:
            paths.append(Path(arg))
    files = []
    for p in paths:
        files.extend(sorted(p.glob("*.png")) if p.is_dir() else [p])
    if not files:
        print("no frames")
        return 1
    bad = 0
    total_outside = 0
    for fp in files:
        r = scan_file(fp, side)
        if "error" in r:
            print(f"{r['file']}: {r['error']}")
            bad += 1
            continue
        total_outside += r["outside"]
        ok = r["outside"] == 0 and max(r["corners"]) == 0 and (r["middle_max"] in (None, 0))
        if not ok:
            bad += 1
        if not ok or len(files) <= 12:
            print(
                f"{r['file']}: {r['size'][0]}x{r['size'][1]} side={side if r['size'] == WIDE else '-'} "
                f"drawn outside zone={r['outside']} drawn inside={r['inside']} corners alpha={r['corners']} "
                f"middle column max alpha={r['middle_max']} {'OK' if ok else 'FAIL'}"
            )
    print(f"{len(files)} frames scanned, {bad} failing, {total_outside} pixels drawn outside the zone in all")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
