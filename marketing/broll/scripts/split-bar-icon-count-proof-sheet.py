"""Marked proof sheet for SplitBar or IconCount (unit N6): see-through stills
over a checkerboard, red boxes on the allowed zones, and a legend on the image.

  python3 scripts/split-bar-icon-count-proof-sheet.py <Id> <out.png> <label>=<vertical.png>,<wide-left.png>,<wide-right.png> [<label>=...]

Each group is one set of props (e.g. SplitBar line 1 and line 2). The stills are
`npx remotion still ... --image-format=png --props='{"transparent":true}'`
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
    for xy in ((0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)):
        assert im.getpixel(xy)[3] == 0, f"{path}: corner {xy} is not see-through"
    w, h = round(im.width * scale), round(im.height * scale)
    small = im.resize((w, h), Image.LANCZOS)
    bg = checker((w, h)).convert("RGBA")
    bg.alpha_composite(small)
    return bg.convert("RGB")


def box(d, x0, y0, x1, y1, n, f):
    d.rectangle([x0, y0, x1, y1], outline=RED, width=5)
    d.rectangle([x0, y0, x0 + 46, y0 + 46], fill=RED)
    d.text((x0 + 14, y0 + 6), str(n), fill=(255, 255, 255), font=f)


def main(tid, out, groups):
    VS, WS = 0.42, 0.28  # 1080x1920 -> 454x806, 3840x2160 -> 1075x605
    pad, top = 50, 120
    f_title, f_num, f_leg, f_cap = font(46, True), font(32, True), font(28), font(24)
    row_h = 806 + 110
    W = pad * 4 + 454 + 1075 * 2
    legend_top = top + row_h * len(groups) + 20
    H = legend_top + 320
    sheet = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 34), f"{tid} / {tid}Wide - see-through (transparent: true) over a checkerboard", fill=(10, 10, 10), font=f_title)
    for gi, (label, (vp, wlp, wrp)) in enumerate(groups):
        y = top + gi * row_h + 40
        d.text((pad, y - 40), label, fill=(10, 10, 10), font=f_num)
        v = over_checker(vp, VS)
        sheet.paste(v, (pad, y))
        box(d, pad, y + round(269 * VS), pad + v.width - 1, y + round(1248 * VS), 1, f_num)
        d.text((pad, y + v.height + 4), "Vertical 1080x1920", fill=(82, 82, 91), font=f_cap)
        for i, (p, side) in enumerate(((wlp, "left"), (wrp, "right"))):
            im = over_checker(p, WS)
            wx = pad * 2 + v.width + i * (im.width + pad)
            wy = y + (v.height - im.height) // 2
            over = Image.new("RGBA", im.size, (0, 0, 0, 0))
            od = ImageDraw.Draw(over)
            od.rectangle([round(1500 * WS), 0, round(2340 * WS), im.height], fill=(220, 38, 38, 40))
            od.rectangle([0, round(1512 * WS), im.width, im.height], fill=(220, 38, 38, 40))
            base = im.convert("RGBA")
            base.alpha_composite(over)
            sheet.paste(base.convert("RGB"), (wx, wy))
            x0 = 192 if side == "left" else 2340
            box(d, wx + round(x0 * WS), wy + round(108 * WS), wx + round((x0 + 1308) * WS), wy + round(1512 * WS), 2 if side == "left" else 3, f_num)
            d.text((wx, wy + im.height + 6), f"Wide 3840x2160, side: \"{side}\"", fill=(82, 82, 91), font=f_cap)
    d.text((pad, legend_top), "Legend", fill=(10, 10, 10), font=f_num)
    lines = [
        "1  Vertical allowed zone: y 269-1248 (text-safe band). Nothing in the top 14% or the bottom 35%.",
        "2  Wide, side \"left\": everything inside x 192-1500, y 108-1512.",
        "3  Wide, side \"right\": everything inside x 2340-3648, y 108-1512.",
        "Faint red on the wide stills: the middle column (x 1500-2340, the face) and the bottom 30% (the captions). Must stay empty.",
        "Checkerboard = see-through (alpha 0). Every word sits on the white card, so it reads over any film.",
    ]
    for i, t in enumerate(lines):
        d.text((pad, legend_top + 44 + i * 46), t, fill=RED if i < 3 else (40, 40, 46), font=f_leg)
    sheet.save(out, optimize=True)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    tid, out = sys.argv[1], sys.argv[2]
    groups = []
    for g in sys.argv[3:]:
        label, paths = g.split("=", 1)
        groups.append((label, paths.split(",")))
    main(tid, out, groups)
