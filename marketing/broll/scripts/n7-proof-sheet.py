"""Marked proof sheet for one N7 template (TwoPeople, ReturnMultiple,
CalendarStrip): see-through stills over a checkerboard, red boxes on the
allowed zones, and a legend on the image.

  python3 scripts/n7-proof-sheet.py "<title>" <out.png> v:"<caption>"=<vertical.png> ... wl:"<caption>"=<wide.png> wr:"<caption>"=<wide.png>

Each still is a `npx remotion still ... --image-format=png
--props='{"transparent":true,...}'` render. `v` = vertical, `wl` = wide with
side "left", `wr` = wide with side "right". Verticals go in a row on the left,
wides stack on the right.
"""
import sys

from PIL import Image, ImageDraw, ImageFont

RED = (220, 38, 38)
VS = 0.5  # 1080x1920 -> 540x960
WS = 0.3125  # 3840x2160 -> 1200x675


def font(size, bold=False):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        try:
            return ImageFont.truetype(path, size, index=1 if bold and path.endswith(".ttc") else 0)
        except OSError:
            continue
    return ImageFont.load_default()


def checker(size, cell=20):
    w, h = size
    im = Image.new("RGB", size, (255, 255, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(204, 204, 208))
    return im


def over_checker(path, scale):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        assert im.getpixel((x, y))[3] == 0, f"{path}: corner {x},{y} is not see-through"
    small = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    bg = checker(small.size).convert("RGBA")
    bg.alpha_composite(small)
    return bg.convert("RGB")


def box(d, x0, y0, x1, y1, n, f):
    d.rectangle([x0, y0, x1, y1], outline=RED, width=4)
    d.rectangle([x0, y0, x0 + 40, y0 + 40], fill=RED)
    d.text((x0 + 12, y0 + 4), str(n), fill=(255, 255, 255), font=f)


def main(title, out, items):
    verts, wides = [], []
    for it in items:
        kind, rest = it.split(":", 1)
        cap, path = rest.split("=", 1)
        (verts if kind == "v" else wides).append((kind, cap, path))
    pad, top = 40, 110
    vw, vh = round(1080 * VS), round(1920 * VS)
    ww, wh = round(3840 * WS), round(2160 * WS)
    left_w = len(verts) * (vw + pad)
    body_h = max(vh + 40, len(wides) * (wh + pad + 40))
    legend_top = top + body_h + 20
    W = pad + left_w + ww + pad
    H = legend_top + 300
    sheet = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    f_title, f_num, f_leg, f_cap = font(46, True), font(28, True), font(27), font(24)
    d.text((pad, 30), title, fill=(10, 10, 10), font=f_title)

    for i, (_, cap, path) in enumerate(verts):
        im = over_checker(path, VS)
        x, y = pad + i * (vw + pad), top + 36
        sheet.paste(im, (x, y))
        d.text((x, y - 32), cap, fill=(82, 82, 91), font=f_cap)
        box(d, x, y + round(269 * VS), x + vw - 1, y + round(1248 * VS), 1, f_num)

    wx = pad + left_w
    for i, (kind, cap, path) in enumerate(wides):
        im = over_checker(path, WS)
        wy = top + 36 + i * (wh + pad + 40)
        over = Image.new("RGBA", im.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(over)
        od.rectangle([round(1500 * WS), 0, round(2340 * WS), im.height], fill=(220, 38, 38, 40))
        od.rectangle([0, round(1512 * WS), im.width, im.height], fill=(220, 38, 38, 40))
        base = im.convert("RGBA")
        base.alpha_composite(over)
        sheet.paste(base.convert("RGB"), (wx, wy))
        d.text((wx, wy - 32), cap, fill=(82, 82, 91), font=f_cap)
        side = "right" if kind == "wr" else "left"
        x0 = 2340 if side == "right" else 192
        box(d, wx + round(x0 * WS), wy + round(108 * WS), wx + round((x0 + 1308) * WS), wy + round(1512 * WS), 3 if side == "right" else 2, f_num)

    d.text((pad, legend_top), "Legend", fill=(10, 10, 10), font=f_num)
    lines = [
        "1  Vertical allowed zone: y 269-1248 (text-safe band). Nothing in the top 14% or the bottom 35%.",
        "2  Wide, side \"left\": everything inside x 192-1500, y 108-1512.",
        "3  Wide, side \"right\": everything inside x 2340-3648, y 108-1512.",
        "Faint red on the wide stills: the middle column (x 1500-2340, the face) and the bottom 30% (the captions). Must stay empty.",
        "Checkerboard = see-through (alpha 0). The white card is the see-through plate: every word and card sits on it.",
    ]
    for i, t in enumerate(lines):
        d.text((pad, legend_top + 40 + i * 44), t, fill=RED if i < 3 else (40, 40, 46), font=f_leg)
    sheet.save(out, optimize=True)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
