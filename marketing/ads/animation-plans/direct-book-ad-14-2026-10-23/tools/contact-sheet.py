"""Contact sheet for Direct Book Ad 14: one frame per animation (all cards in), red box = the words box, size % in the title.
python3 tools/contact-sheet.py <animated.mp4> <out.jpg>   (run where Pillow is installed; frames go to a temp dir)"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
FF = '/Users/chrisstanbridge/.local/bin/ffmpeg'
V, OUT = sys.argv[1], sys.argv[2]
S = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'schedule.json')))
LAB = {1: "logo on 'Fundhub'", 2: "funding: personal, business, both", 3: "high score / no tax returns / no statements", 4: "lowest terms, fastest, maximum", 5: "credit cards, SBA, MCA, personal",
       6: "mismatch / 13 points", 7: "double odds / fewer denials", 8: "AI matching / bigger bank list", 9: "inquiries removed / faster rounds", 10: "CTA: click the link below"}
TW, TH = 360, 640 + 26
f = ImageFont.load_default(size=15); tmp = tempfile.mkdtemp(); tiles = []
for c in S['clips']:
    t = c['payoff_s']
    p = f'{tmp}/{c["n"]}.png'
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{t:.3f}', '-i', V, '-frames:v', '1', p], check=True)
    im = Image.new('RGB', (TW, TH), (20, 20, 20)); im.paste(Image.open(p).convert('RGB').resize((TW, 640)), (0, 26))
    d = ImageDraw.Draw(im); k = TW / 1080; x0, y0, x1, y1 = c['words_on_video_box']
    d.rectangle([x0 * k - 2, 26 + y0 * k - 2, x1 * k + 2, 26 + y1 * k + 2], outline=(230, 30, 30), width=3)
    d.text((4, 4), f"{c['n']} {c['template']} {c['start_s']:.1f}s - {c['width_pct_of_frame']}% wide - {'front' if c['in_front'] else 'behind'}", fill=(255, 255, 255), font=f); tiles.append(im)
cols = 5; rows = (len(tiles) + cols - 1) // cols
sh = Image.new('RGB', (TW * cols, TH * rows + 70), (0, 0, 0))
for i, im in enumerate(tiles): sh.paste(im, ((i % cols) * TW, (i // cols) * TH))
d = ImageDraw.Draw(sh)
d.text((10, TH * rows + 6), "Red box = the words of that animation (width % of the 1080 frame in each title). front = plate drawn in front of him (over hair, never the face); behind = behind him.", fill=(255, 255, 255), font=f)
d.text((10, TH * rows + 28), "Frames: a moment where every part of the diagram has landed. Captions are the original burned-in ones, untouched. No numbered lists, no text-only plates.", fill=(200, 200, 200), font=f)
sh.save(OUT, quality=85, optimize=True)
