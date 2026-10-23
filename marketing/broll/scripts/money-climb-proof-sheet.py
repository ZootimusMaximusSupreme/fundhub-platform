"""MoneyClimb marked proof sheet: see-through stills (frame 88) over a checkerboard, red boxes on the allowed zones, numbered legend."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

STILLS = Path(sys.argv[1])
OUT = Path(sys.argv[2])
NAMES = [
    ("steps-vsl", "steps · VSL $20,000 > $400,000 > a million"),
    ("range-vsl", "range · VSL $250,000 to $400,000"),
    ("range-ad13", "range · Ad 13 $100,000 to $300,000"),
    ("ladder-ad10", "ladder · Ad 10 a month, up to past $100,000"),
    ("single-ad11", "single · Ad 11 over $400,000"),
]
RED = (220, 38, 38, 255)


def font(n, bold=False):
    for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(p, n)
        except OSError:
            pass
    return ImageFont.load_default()


def checker(w, h, c=12):
    bg = Image.new("RGBA", (w, h), (205, 205, 205, 255))
    d = ImageDraw.Draw(bg)
    for y in range(0, h, c):
        for x in range(0, w, c):
            if (x // c + y // c) % 2:
                d.rectangle([x, y, x + c - 1, y + c - 1], fill=(160, 160, 160, 255))
    return bg


def tile(path, scale, zone, mark):
    im = Image.open(path).convert("RGBA")
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    t = checker(im.width, im.height)
    t.alpha_composite(im)
    d = ImageDraw.Draw(t)
    x0, y0, x1, y1 = (round(v * scale) for v in zone)
    d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=RED, width=3)
    r = 15
    d.ellipse([x0 + 4, y0 + 4, x0 + 4 + 2 * r, y0 + 4 + 2 * r], fill=RED)
    d.text((x0 + 4 + r, y0 + 4 + r), str(mark), fill="white", font=font(18, True), anchor="mm")
    return t


V_ZONE = (0, 269, 1080, 1248)
L_ZONE = (192, 108, 1500, 1512)
R_ZONE = (2340, 108, 3648, 1512)
vs, ws = 0.3, 0.125
pad, head = 24, 70
cols = []
for i, (n, cap) in enumerate(NAMES):
    v = tile(STILLS / f"mc-{n}-v.png", vs, V_ZONE, 1)
    w = tile(STILLS / f"mc-{n}-wl.png", ws, L_ZONE, 2)
    wr = tile(STILLS / f"mc-{n}-wr.png", ws, R_ZONE, 3)
    cols.append((cap, v, w, wr))
colw = max(c[2].width for c in cols)
W = pad + len(cols) * (colw + pad)
legend_h = 150
H = head + cols[0][1].height + cols[0][2].height * 2 + 4 * pad + 40 + legend_h
sheet = Image.new("RGBA", (W, H), (255, 255, 255, 255))
d = ImageDraw.Draw(sheet)
d.text((pad, 20), "MoneyClimb — see-through (transparent: true), frame 88, every mode in both formats", fill=(10, 10, 10), font=font(30, True))
x = pad
for cap, v, w, wr in cols:
    y = head
    d.text((x, y), cap, fill=(60, 60, 60), font=font(19, True))
    y += 32
    sheet.paste(v, (x + (colw - v.width) // 2, y))
    y += v.height + pad
    sheet.paste(w, (x, y))
    y += w.height + pad
    sheet.paste(wr, (x, y))
    x += colw + pad
ly = H - legend_h + 10
lines = [
    "1  Vertical 1080x1920 (ads): red box = the word band, y 269-1248. Words and cards stay inside it; only faint rising bills pass the sides.",
    "2  Wide 3840x2160, side \"left\": red box = left panel x 192-1500, y 108-1512. Middle column (the face) and bottom 30% (captions) stay empty.",
    "3  Wide 3840x2160, side \"right\": red box = right panel x 2340-3648, y 108-1512.",
    "Checkerboard = see-through. Corners, middle column and bottom 30% measured alpha 0 on every wide still; corners alpha 0 on every vertical still.",
]
for i, line in enumerate(lines):
    d.text((pad, ly + i * 32), line, fill=RED if i < 3 else (60, 60, 60), font=font(21, i < 3))
sheet.convert("RGB").save(OUT)
print(OUT, sheet.size)
