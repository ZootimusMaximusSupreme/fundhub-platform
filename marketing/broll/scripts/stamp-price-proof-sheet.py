"""Marked proof sheet for StampCard or PriceTag (unit N5): the see-through
vertical still and the see-through wide stills (left and right panel) over a
checkerboard, red boxes on the allowed zones, a legend on the image, and a
strip of the other script lines (vertical, see-through).

  python3 scripts/stamp-price-proof-sheet.py <Id> <vertical.png> <wide-left.png> <wide-right.png> <out.png> [<caption>=<vertical.png> ...]

The stills are `npx remotion still ... --image-format=png --props='{"transparent":true}'`
renders (wide right: add "side":"right").
"""
import sys

from PIL import Image, ImageDraw, ImageFont

RED = (220, 38, 38)


def font(size, bold=False):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        try:
            return ImageFont.truetype(path, size, index=1 if bold and path.endswith(".ttc") else 0)
        except OSError:
            continue
    return ImageFont.load_default()


def checker(size, cell=24):
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
    assert im.getpixel((0, 0))[3] == 0, f"{path}: corner is not see-through"
    w, h = round(im.width * scale), round(im.height * scale)
    small = im.resize((w, h), Image.LANCZOS)
    bg = checker((w, h)).convert("RGBA")
    bg.alpha_composite(small)
    return bg.convert("RGB")


def box(d, x0, y0, x1, y1, n, f):
    d.rectangle([x0, y0, x1, y1], outline=RED, width=5)
    d.rectangle([x0, y0, x0 + 46, y0 + 46], fill=RED)
    d.text((x0 + 14, y0 + 6), str(n), fill=(255, 255, 255), font=f)


def main(tid, vertical, wide_left, wide_right, out, extras):
    VS = 0.56  # 1080x1920 -> 605x1075
    WS = 0.375  # 3840x2160 -> 1440x810
    XS = 0.3  # extra strip: 1080x1920 -> 324x576
    pad, top = 50, 120
    v = over_checker(vertical, VS)
    wl = over_checker(wide_left, WS)
    wr = over_checker(wide_right, WS)
    xs = [(cap, over_checker(p, XS)) for cap, p in extras]
    W = pad * 3 + v.width + wl.width
    body_h = wl.height * 2 + pad
    strip_top = top + body_h + 90
    strip_h = (xs[0][1].height + 50) if xs else 0
    legend_top = strip_top + strip_h + 40
    H = legend_top + 330
    sheet = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    f_title, f_num, f_leg, f_cap = font(52, True), font(32, True), font(30), font(26)
    d.text((pad, 34), f"{tid} / {tid}Wide - see-through (transparent: true) over a checkerboard", fill=(10, 10, 10), font=f_title)

    vx, vy = pad, top + (body_h - v.height) // 2
    sheet.paste(v, (vx, vy))
    d.text((vx, vy - 38), "Vertical 1080x1920 (default props)", fill=(82, 82, 91), font=f_cap)
    box(d, vx, vy + round(269 * VS), vx + v.width - 1, vy + round(1248 * VS), 1, f_num)

    wx = pad * 2 + v.width
    for i, (im, side) in enumerate(((wl, "left"), (wr, "right"))):
        wy = top + i * (wl.height + pad)
        sheet.paste(im, (wx, wy))
        over = Image.new("RGBA", im.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(over)
        od.rectangle([round(1500 * WS), 0, round(2340 * WS), im.height], fill=(220, 38, 38, 40))
        od.rectangle([0, round(1512 * WS), im.width, im.height], fill=(220, 38, 38, 40))
        base = sheet.crop((wx, wy, wx + im.width, wy + im.height)).convert("RGBA")
        base.alpha_composite(over)
        sheet.paste(base.convert("RGB"), (wx, wy))
        x0 = 192 if side == "left" else 2340
        box(d, wx + round(x0 * WS), wy + round(108 * WS), wx + round((x0 + 1308) * WS), wy + round(1512 * WS), 2 if side == "left" else 3, f_num)
        d.text((wx + im.width - 420, wy + im.height - 40), f"Wide 3840x2160, side: \"{side}\"", fill=(82, 82, 91), font=f_cap)

    if xs:
        d.text((pad, strip_top - 46), "4  The other script lines, vertical, see-through (same zone rule)", fill=RED, font=f_leg)
        x = pad
        for cap, im in xs:
            sheet.paste(im, (x, strip_top))
            d.rectangle([x, strip_top + round(269 * XS), x + im.width - 1, strip_top + round(1248 * XS)], outline=RED, width=3)
            d.text((x, strip_top + im.height + 10), cap, fill=(82, 82, 91), font=f_cap)
            x += im.width + 40

    d.text((pad, legend_top - 10), "Legend", fill=(10, 10, 10), font=f_num)
    lines = [
        "1  Vertical allowed zone: y 269-1248 (text-safe band). Nothing in the top 14% or the bottom 35%.",
        "2  Wide, side \"left\": everything inside x 192-1500, y 108-1512. No wordmark in the wide format.",
        "3  Wide, side \"right\": everything inside x 2340-3648, y 108-1512.",
        "Faint red on the wide stills: the middle column (x 1500-2340, the face) and the bottom 30% (the captions). Must stay empty.",
        "Checkerboard = see-through (alpha 0). Every word sits on a solid card, chip, tag or plate so it reads over film.",
    ]
    for i, t in enumerate(lines):
        d.text((pad, legend_top + 40 + i * 50), t, fill=RED if i < 3 else (40, 40, 46), font=f_leg)
    sheet.save(out, optimize=True)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    args = sys.argv[1:]
    extras = [tuple(a.split("=", 1)) for a in args[5:]]
    main(*args[:5], extras)
