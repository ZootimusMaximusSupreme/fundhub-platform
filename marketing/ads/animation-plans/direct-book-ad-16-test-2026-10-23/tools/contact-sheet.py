"""One frame per animation, taken where its payoff is on screen, captions visible. Writes a JPEG under 1 MB. Needs Pillow.

  python3 marketing/ads/animation-plans/direct-book-ad-16-test-2026-10-23/tools/contact-sheet.py <test.mp4> <out.jpg> [work_dir]
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

FF = os.environ.get("FFMPEG", "/Users/chrisstanbridge/.local/bin/ffmpeg")
video, out = sys.argv[1], sys.argv[2]
work = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(os.path.abspath(out))
# (animation number, time in seconds where the payoff is on screen, label)
SHOTS = [
    (1, 15.2, "1 StampCard: OUT OF DATE (stamp on 'out of date')"),
    (2, 24.15, "2 FundhubLogo (on 'Fundhub')"),
    (3, 29.2, "3 HiddenDataPoints: 7 feeds (on 'seven different data feeds')"),
    (4, 39.1, "4 LenderList (on 'where the lending is hottest right now')"),
    (5, 43.8, "5 ScoreBadge: 400 to 850 (on 'to 850')"),
    (6, 47.1, "6 PathCards: three ways (on 'set it up to do it yourself')"),
    (7, 55.5, "7 StampCard: APPROVED or DENIED (on 'approved or denied')"),
]
SCHED = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schedule.json")))
BOX = {c["n"]: c["words_on_video_box"] for c in SCHED["clips"]}
TW, TH = 432, 768
font = ImageFont.load_default(size=17)
tiles = []
for n, t, label in SHOTS:
    p = os.path.join(work, f"cs_{n}.png")
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(t), "-i", video, "-frames:v", "1", p], check=True)
    im = Image.open(p).convert("RGB").resize((TW, TH), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    k = TW / 1080
    x0, y0, x1, y1 = BOX[n]
    d.rectangle([x0 * k - 5, y0 * k - 5, x1 * k + 5, y1 * k + 5], outline=(230, 30, 30), width=3)
    d.rectangle([0, 0, TW, 26], fill=(20, 20, 20))
    d.text((6, 3), label, fill=(255, 255, 255), font=font)
    tiles.append(im)
cols = 4
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (TW * cols, TH * rows), (0, 0, 0))
legend = ["Legend", "", "Red box = the words of that animation.", "Each box stays clear of his head", "(person cut-out, 21 px margin) and above", "the captions. The white plate behind", "the words may go behind him.", "", "Frame taken where the payoff is on screen.", "Sizes 0.37-0.8 of the template."]
ld = ImageDraw.Draw(sheet)
for i, line in enumerate(legend):
    ld.text(((len(tiles) % cols) * TW + 12, (len(tiles) // cols) * TH + 14 + i * 24), line, fill=(255, 255, 255), font=font)
for i, im in enumerate(tiles):
    sheet.paste(im, ((i % cols) * TW, (i // cols) * TH))
sheet.save(out, quality=80, optimize=True)
print(out, os.path.getsize(out) // 1024, "KB", sheet.size)
