"""Marked proof sheets for DeadlineClocks and FundingStack (unit N2,
ops/workflows/animation-builds-2026-10-22.md).

Each sheet shows the see-through stills over a checkerboard: the vertical ad
and the wide 4K frame with `side` left and right. Red boxes are the allowed
zones; the legend under the pictures says what each numbered box is.

  python3 scripts/deadline-funding-sheets.py <id> <vertical.png> <wide-left.png> <wide-right.png> <out.png> "<title>"

The stills come from `npx remotion still ... --image-format=png` with
{"transparent":true} (and {"transparent":true,"side":"right"} for the right one).
"""
import sys

from PIL import Image, ImageDraw, ImageFont

RED = (220, 38, 38, 255)
FONT = "/System/Library/Fonts/Helvetica.ttc"


def font(size, bold=False):
    try:
        return ImageFont.truetype(FONT, size, index=1 if bold else 0)
    except OSError:
        return ImageFont.load_default()


def checker(w, h, cell=24):
    im = Image.new("RGBA", (w, h), (236, 236, 239, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(206, 206, 212, 255))
    return im


def placed(path, scale):
    src = Image.open(path).convert("RGBA")
    w, h = round(src.width * scale), round(src.height * scale)
    small = src.resize((w, h), Image.LANCZOS)
    bg = checker(w, h)
    bg.alpha_composite(small)
    return bg


def mark(d, ox, oy, scale, box, n, label_font):
    x0, y0, x1, y1 = (round(v * scale) for v in box)
    d.rectangle([ox + x0, oy + y0, ox + x1, oy + y1], outline=RED, width=5)
    r = 22
    cx, cy = ox + x0 + r + 6, oy + y0 + r + 6
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED)
    d.text((cx, cy), str(n), fill=(255, 255, 255, 255), font=label_font, anchor="mm")


def main(tid, vertical, wide_left, wide_right, out, title):
    pad = 40
    v_scale = 1350 / 1920
    w_scale = 1200 / 3840
    v = placed(vertical, v_scale)
    wl = placed(wide_left, w_scale)
    wr = placed(wide_right, w_scale)
    legend_h = 300
    W = pad + v.width + pad + wl.width + pad
    H = pad + 70 + v.height + legend_h
    sheet = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(sheet)
    d.text((pad, pad), f"{title}: see-through stills over a checkerboard", fill=(10, 10, 10, 255), font=font(40, True))
    top = pad + 70
    sheet.alpha_composite(v, (pad, top))
    wx = pad + v.width + pad
    sheet.alpha_composite(wl, (wx, top))
    sheet.alpha_composite(wr, (wx, top + wl.height))
    n_font = font(26, True)
    mark(d, pad, top, v_scale, (0, 269, 1079, 1247), 1, n_font)
    mark(d, wx, top, w_scale, (192, 108, 1499, 1511), 2, n_font)
    mark(d, wx, top + wl.height, w_scale, (2340, 108, 3647, 1511), 3, n_font)
    d.line([wx, top + wl.height, wx + wl.width, top + wl.height], fill=(120, 120, 128, 255), width=2)
    lf = font(30)
    lines = [
        f"1  Vertical ad, {tid} (1080x1920): every word and card inside y 269-1248. Nothing in the top 14% or bottom 35%.",
        f"2  Wide 4K, {tid}Wide with side \"left\" (3840x2160): all content in the left panel, x 192-1500, y 108-1512.",
        f"3  Wide 4K, {tid}Wide with side \"right\": all content in the right panel, x 2340-3648, y 108-1512.",
        "   The face's middle column (x 1500-2340) and the caption band (bottom 30%) stay empty: alpha 0 there.",
        "   Checkerboard = see-through. The cards are solid white with a soft shadow, so they read over any footage.",
    ]
    y = top + v.height + 30
    for line in lines:
        d.text((pad, y), line, fill=(24, 24, 27, 255), font=lf)
        y += 50
    sheet.convert("RGB").save(out, optimize=True)
    print(f"wrote {out} ({W}x{H})")


if __name__ == "__main__":
    if len(sys.argv) != 7:
        print(__doc__)
        sys.exit(2)
    main(*sys.argv[1:])
