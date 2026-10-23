"""One marked contact sheet from the finished test video: one frame per animation, taken at its anchor line.

  python3 make-sheet.py <test.mp4> <out.jpg>

Reads ../schedule.json for each animation's box. Red box + number on each animation; one legend line per frame
(template, run time, where it sits, the words on screen). Needs Pillow.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(os.path.dirname(HERE), "schedule.json")))
FF = os.environ.get("FFMPEG", "/Users/chrisstanbridge/.local/bin/ffmpeg")
video, out = sys.argv[1], sys.argv[2]
# the card's box inside its own 1080x1920 clip frame (alpha bbox of the hero still), and the frame time to show
BOX = {1: (36, 277, 1043, 1224), 2: (72, 345, 1013, 1182), 3: (72, 345, 1013, 1182), 4: (36, 277, 1043, 1224), 5: (80, 629, 1007, 1001)}
AT = {1: 32.4, 2: 49.5, 3: 59.7, 4: 63.0, 5: 66.4}
SAY = {1: "he says: so 200K run through a system that already has proven returns, turns into 800K pretty quickly",
       2: "he says: one business is 100K at minimum, and the older one gets up to 300K",
       3: "he says: if you have two, that's up to 600K, and if you have three, that's up to $900,000",
       4: "he says: sitting in your account in the next 7 to 30 days",
       5: "he says: do you want access to that capital to put into a proven system you already make money with"}
for f in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"):
    if os.path.exists(f):
        font, big = ImageFont.truetype(f, 22), ImageFont.truetype(f, 34)
        break
else:
    font = big = ImageFont.load_default()
K = 0.5
tiles = []
for c in S["clips"]:
    n = c["n"]
    tmp = f"/tmp/_sheet_{n}.png"
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(AT[n]), "-i", video, "-frames:v", "1", tmp], check=True)
    im = Image.open(tmp).convert("RGB")
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = BOX[n]
    s = c["scale"]
    r = [round(c["x"] + x0 * s) - 6, round(c["y"] + y0 * s) - 6, round(c["x"] + x1 * s) + 6, round(c["y"] + y1 * s) + 6]
    d.rectangle(r, outline=(230, 30, 30), width=7)
    cx, cy = max(r[0], 8) + 30, max(r[1], 8) + 30
    tiles.append((im.resize((round(1080 * K), round(1920 * K))), n, c, (cx, cy)))
legend_h = 150
W = sum(t[0].width for t in tiles)
sheet = Image.new("RGB", (W, tiles[0][0].height + legend_h), (255, 255, 255))
x = 0
for im, n, c, _ in tiles:
    sheet.paste(im, (x, 0))
    d = ImageDraw.Draw(sheet)
    # number badge on the box corner
    bx = x + round(max(c["x"] + BOX[n][0] * c["scale"], 0) * K) + 14
    by = round(max(c["y"] + BOX[n][1] * c["scale"], 0) * K) + 14
    d.ellipse([bx - 16, by - 16, bx + 16, by + 16], fill=(230, 30, 30))
    d.text((bx - 7, by - 19), str(n), fill="white", font=big)
    t = f"{n}  {c['template']}{(' ' + c['mode']) if 'mode' in c else ''}  {c['start_s']:.1f}-{c['end_s']:.1f} s  (frame at {AT[n]} s)"
    d.text((x + 8, im.height + 8), t, fill=(0, 0, 0), font=font)
    words, line = SAY[n].split(), ""
    yy = im.height + 38
    for w in words:
        if d.textlength(line + " " + w, font=font) > im.width - 16:
            d.text((x + 8, yy), line.strip(), fill=(70, 70, 70), font=font); yy += 26; line = ""
        line += " " + w
    d.text((x + 8, yy), line.strip(), fill=(70, 70, 70), font=font)
    x += im.width
sheet.save(out, quality=80, optimize=True)
print("saved", out, sheet.size, os.path.getsize(out))
