"""Marked proof sheet for one N3 template (BureauMatch or PathCards).

Takes the vertical and wide see-through stills (PNG with alpha), lays each over
a checkerboard so the see-through parts show, draws red boxes on the allowed
zones, and writes a short legend on the image.

  npx remotion still src/index.ts BureauMatch out/bm-v.png --frame=112 --image-format=png --props='{"transparent":true}'
  npx remotion still src/index.ts BureauMatchWide out/bm-w.png --frame=112 --image-format=png --props='{"transparent":true}'
  python3 scripts/n3-proof-sheet.py BureauMatch out/bm-v.png out/bm-w.png previews/bureau-match-overlay.png
"""
import sys

from PIL import Image, ImageDraw, ImageFont

RED = (220, 38, 38, 255)
INK = (10, 10, 10, 255)
GRAY = (82, 82, 91, 255)


def font(size, bold=False):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        try:
            return ImageFont.truetype(path, size, index=1 if bold and path.endswith(".ttc") else 0)
        except OSError:
            continue
    return ImageFont.load_default()


def checker(w, h, cell=24):
    im = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(214, 214, 219, 255))
    return im


def over_checker(path, scale):
    src = Image.open(path).convert("RGBA")
    corners = [src.getpixel(p)[3] for p in ((0, 0), (src.width - 1, 0), (0, src.height - 1), (src.width - 1, src.height - 1))]
    w, h = round(src.width * scale), round(src.height * scale)
    small = src.resize((w, h), Image.LANCZOS)
    bg = checker(w, h)
    bg.alpha_composite(small)
    return bg, corners


def main(name, vertical, wide, out):
    vs, ws = 0.5, 0.36
    v, vc = over_checker(vertical, vs)
    w, wc = over_checker(wide, ws)
    pad, top = 60, 150
    legend_h = 300
    W = pad + v.width + pad + w.width + pad
    H = top + max(v.height, w.height) + legend_h
    sheet = Image.new("RGBA", (W, H), (252, 252, 252, 255))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 50), f"{name} — see-through proof (transparent: true)", font=font(46, True), fill=INK)

    vx, vy = pad, top
    wx, wy = pad + v.width + pad, top
    sheet.alpha_composite(v, (vx, vy))
    sheet.alpha_composite(w, (wx, wy))
    d.rectangle([vx - 1, vy - 1, vx + v.width, vy + v.height], outline=(180, 180, 185, 255), width=2)
    d.rectangle([wx - 1, wy - 1, wx + w.width, wy + w.height], outline=(180, 180, 185, 255), width=2)

    # 1: vertical words band y 269-1248
    d.rectangle([vx, vy + 269 * vs, vx + v.width, vy + 1248 * vs], outline=RED, width=5)
    d.text((vx + 10, vy + 269 * vs + 8), "1", font=font(40, True), fill=RED)
    # 2: wide left panel x 192-1500, y 108-1512
    d.rectangle([wx + 192 * ws, wy + 108 * ws, wx + 1500 * ws, wy + 1512 * ws], outline=RED, width=5)
    d.text((wx + 192 * ws + 10, wy + 108 * ws + 8), "2", font=font(40, True), fill=RED)
    # 3: wide no-go: middle column and bottom 30%
    d.rectangle([wx + 1500 * ws, wy, wx + 2340 * ws, wy + w.height], outline=RED, width=3)
    d.text((wx + 1500 * ws + 10, wy + 10), "3", font=font(40, True), fill=RED)
    d.line([wx, wy + 1512 * ws, wx + w.width, wy + 1512 * ws], fill=RED, width=3)
    d.text((wx + 2340 * ws + 10, wy + 1512 * ws + 8), "3", font=font(40, True), fill=RED)

    ly = top + max(v.height, w.height) + 40
    f = font(30)
    lines = [
        "1  Vertical 1080x1920: every word and card inside y 269-1248 (top 14% and bottom 35% stay clear).",
        "2  Wide 3840x2160: everything in ONE side panel, here side=left (x 192-1500, y 108-1512). side=right uses x 2340-3648.",
        "3  Wide no-go: the middle column (x 1500-2340, the face) and the bottom 30% (y below 1512, Submagic captions).",
        f"Checkerboard = see-through. Corner alpha, vertical {vc}, wide {wc} (0 = clear).",
    ]
    for i, line in enumerate(lines):
        d.text((pad, ly + i * 52), line, font=f, fill=INK if i < 3 else GRAY)
    sheet.convert("RGB").save(out, optimize=True)
    print(f"wrote {out} ({W}x{H})")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit("usage: n3-proof-sheet.py <Name> <vertical.png> <wide.png> <out.png>")
    main(*sys.argv[1:])
