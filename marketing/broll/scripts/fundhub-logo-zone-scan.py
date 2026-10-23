"""Full-frame zone scan for the FundhubLogo sting (see-through renders).

Render every frame see-through as PNG (alpha kept), with decoration off and on:

  npx remotion render src/index.ts FundhubLogo     out/zone/v-text  --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts FundhubLogoWide out/zone/wl-text --sequence --image-format=png --props='{"transparent":true,"checkTextOnly":true}'
  npx remotion render src/index.ts FundhubLogoWide out/zone/wr-text --sequence --image-format=png --props='{"side":"right","transparent":true,"checkTextOnly":true}'

then run:  python3 scripts/fundhub-logo-zone-scan.py vertical out/zone/v-text wide-left out/zone/wl-text wide-right out/zone/wr-text

What it proves: on every frame, no pixel with alpha > 0 sits outside the allowed
zone. Vertical: y 269-1247, full width. Wide: one side panel, left x 192-1499 or
right x 2340-3647, y 108-1511; so the middle column (x 1500-2339, the face) and
the bottom 30% (y >= 1512, the captions) stay fully clear. It also prints the
box that holds every drawn pixel across the clip.
"""
import sys
from pathlib import Path

from PIL import Image

ZONES = {
    "vertical": ((1080, 1920), (0, 269, 1080, 1248)),
    "wide-left": ((3840, 2160), (192, 108, 1500, 1512)),
    "wide-right": ((3840, 2160), (2340, 108, 3648, 1512)),
}


def scan(mode, folder):
    size, (x0, y0, x1, y1) = ZONES[mode]
    frames = sorted(Path(folder).glob("*.png"))
    if not frames:
        print(f"{folder}: no frames")
        return False
    bad = []
    union = None
    for fp in frames:
        im = Image.open(fp)
        if im.mode != "RGBA" or im.size != size:
            bad.append((fp.name, f"mode {im.mode} size {im.size}"))
            continue
        alpha = im.getchannel("A")
        box = alpha.point(lambda a: 255 if a > 0 else 0).getbbox()
        if box:
            union = box if union is None else (min(union[0], box[0]), min(union[1], box[1]), max(union[2], box[2]), max(union[3], box[3]))
        # Count drawn pixels outside the allowed box: total drawn minus drawn inside.
        drawn = alpha.point(lambda a: 1 if a > 0 else 0)
        total = sum(drawn.getdata())
        inside = sum(drawn.crop((x0, y0, x1, y1)).getdata())
        if total - inside:
            bad.append((fp.name, f"{total - inside} drawn pixels outside the zone"))
    ok = not bad
    print(
        f"{mode} {folder}: {len(frames)} frames, allowed x {x0}-{x1 - 1} y {y0}-{y1 - 1}, "
        f"drawn box across clip {union}, frames with pixels outside: {len(bad)}"
    )
    for name, why in bad[:10]:
        print(f"  {name}: {why}")
    return ok


if __name__ == "__main__":
    args = sys.argv[1:]
    pairs = list(zip(args[0::2], args[1::2]))
    results = [scan(m, f) for m, f in pairs]
    sys.exit(0 if results and all(results) else 1)
