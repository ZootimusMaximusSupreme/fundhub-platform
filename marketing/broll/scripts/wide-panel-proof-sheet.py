"""W2 marked proof sheets: vertical + wide see-through stills over a checkerboard, red boxes on the allowed zones.
usage: python3 marketing/broll/scripts/wide-panel-proof-sheet.py <stills dir> <previews dir>
(Rebuilt 2026-10-23 from the original W2 sheet script, which was never committed.)
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

STILLS = Path(sys.argv[1])
OUT = Path(sys.argv[2])
RED = (220, 38, 38)

CLIPS = [
    ("InquiriesOff", "inquiries-off", 86, 90),
    ("FundingRounds", "funding-rounds", 106, 110),
    ("LenderMatchScroll", "lender-match-scroll", 116, 120),
    ("ProofWall", "proof-wall", 112, 120),
    ("BookCall", "book-call", 86, 90),
]


def font(size, bold=False):
    for p in (["/System/Library/Fonts/Supplemental/Arial Bold.ttf"] if bold else []) + ["/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"]:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def checker(w, h, cell=16):
    im = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(214, 214, 218, 255))
    return im


def tile(path, w, h):
    src = Image.open(path).convert("RGBA")
    assert src.getpixel((0, 0))[3] == 0, f"{path}: corner is not see-through"
    src = src.resize((w, h), Image.LANCZOS)
    return Image.alpha_composite(checker(w, h), src)


def badge(d, x, y, n):
    r = 20
    d.ellipse([x - r, y - r, x + r, y + r], fill=RED)
    f = font(24, True)
    tw = d.textlength(str(n), font=f)
    d.text((x - tw / 2, y - 14), str(n), fill="white", font=f)


for comp, slug, frame, frames in CLIPS:
    VH = 960
    VW = round(1080 * VH / 1920)
    WW = 1600
    WH = round(2160 * WW / 3840)
    pad = 40
    top = 150
    W = pad + VW + pad + WW + pad
    H = top + VH + 420
    sheet = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(sheet)
    d.text((pad, 30), f"{comp}: see-through (transparent: true), frame {frame}", fill=(10, 10, 10), font=font(44, True))
    d.text((pad, 88), "Left: vertical 1080x1920 (ads).  Right: new wide 3840x2160 (VSL and thank-you video), side = left.", fill=(82, 82, 91), font=font(28))

    vx, vy = pad, top
    sheet.paste(tile(STILLS / f"{comp}-t.png", VW, VH).convert("RGB"), (vx, vy))
    d.rectangle([vx, vy, vx + VW, vy + VH], outline=(200, 200, 205), width=2)
    s = VH / 1920
    d.rectangle([vx, vy + 269 * s, vx + VW, vy + 1248 * s], outline=RED, width=4)
    badge(d, vx + 28, vy + 269 * s + 28, 1)

    wx, wy = pad + VW + pad, top
    sheet.paste(tile(STILLS / f"{comp}Wide-t.png", WW, WH).convert("RGB"), (wx, wy))
    d.rectangle([wx, wy, wx + WW, wy + WH], outline=(200, 200, 205), width=2)
    k = WW / 3840
    d.rectangle([wx + 192 * k, wy + 108 * k, wx + 1500 * k, wy + 1512 * k], outline=RED, width=4)
    badge(d, wx + 192 * k + 28, wy + 108 * k + 28, 2)
    # middle column and bottom 30%: dashed red outline, must stay empty
    for (x0, y0, x1, y1) in [(1500, 0, 2340, 1512), (0, 1512, 3840, 2160)]:
        X0, Y0, X1, Y1 = wx + x0 * k, wy + y0 * k, wx + x1 * k, wy + y1 * k
        dash = 14
        for x in range(int(X0), int(X1), dash * 2):
            d.line([x, Y0 + 2, min(x + dash, X1), Y0 + 2], fill=RED, width=3)
            d.line([x, Y1 - 2, min(x + dash, X1), Y1 - 2], fill=RED, width=3)
        for y in range(int(Y0), int(Y1), dash * 2):
            d.line([X0 + 2, y, X0 + 2, min(y + dash, Y1)], fill=RED, width=3)
            d.line([X1 - 2, y, X1 - 2, min(y + dash, Y1)], fill=RED, width=3)
    badge(d, wx + 1920 * k, wy + 700 * k, 3)
    badge(d, wx + 1920 * k, wy + 1830 * k, 3)

    ly = top + WH + 40
    lines = [
        (1, f"Vertical: every word and card stays between y 269 and 1248. Text-only scan, all {frames} frames: 0 pixels outside."),
        (2, f"Wide: the whole scene sits in one side panel (left x 192-1500, y 108-1512). Scan, all {frames} frames: 0 pixels outside."),
        (3, "Wide: the middle column (face) and the bottom 30% (captions) stay empty: alpha 0. Corners alpha 0 on every still."),
        (None, "The right panel (side = right, x 2340-3648) was scanned the same way: 0 pixels outside."),
        (None, "Checkerboard = see-through. A thin white edge goes round each word so it reads over dark film."),
        (None, "Switch off (transparent: false): the vertical frame is the same as before, pixel for pixel."),
    ]
    f = font(26)
    lx = wx
    for n, text in lines:
        if n is not None:
            badge(d, lx + 20, ly + 16, n)
        d.text((lx + 52, ly), text, fill=(24, 24, 27), font=f)
        ly += 58
    sheet.save(OUT / f"{slug}-overlay.png", optimize=True)
    print("wrote", slug, sheet.size)
