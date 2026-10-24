"""Contact sheet for Direct Book VSL 1: one frame per animation at the moment every part has landed, red box = the animation's drawing, width % of the 2560 frame in each title.
python3 tools/contact-sheet.py <animated.mp4> <out.jpg>   (needs Pillow)"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
FF = '/Users/chrisstanbridge/.local/bin/ffmpeg'
V, OUT = sys.argv[1], sys.argv[2]
S = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'schedule.json')))
TW, TH = 512, 288 + 24
f = ImageFont.load_default(size=14); tmp = tempfile.mkdtemp(); tiles = []
for c in S['clips']:
    t = c['start_frame'] / 30 + min(c['play_frames'] - 14, 0.88 * c['render_frames']) / 30
    p = f'{tmp}/{c["n"]}.png'
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{t:.3f}', '-i', V, '-frames:v', '1', p], check=True)
    im = Image.new('RGB', (TW, TH), (20, 20, 20)); im.paste(Image.open(p).convert('RGB').resize((TW, 288)), (0, 24))
    d = ImageDraw.Draw(im); k = TW / 2560; x0, y0, x1, y1 = c['box']
    d.rectangle([x0 * k - 1, 24 + y0 * k - 1, x1 * k + 1, 24 + y1 * k + 1], outline=(235, 30, 30), width=2)
    d.text((4, 4), f"{c['n']} {c['template'].replace('Wide','')} {t:.1f}s - {c['width_pct_of_frame']:.0f}% wide", fill=(255, 255, 255), font=f); tiles.append(im)
cols = 5; rows = (len(tiles) + cols - 1) // cols
sh = Image.new('RGB', (TW * cols, TH * rows + 56), (0, 0, 0))
for i, im in enumerate(tiles): sh.paste(im, ((i % cols) * TW, (i // cols) * TH))
d = ImageDraw.Draw(sh)
d.text((10, TH * rows + 6), "Red box = the drawing of that animation; its width as % of the 2560 frame is in each title. Frame = a moment where every part of the diagram has landed. Face and captions (burned in) are clear in every tile.", fill=(255, 255, 255), font=f)
d.text((10, TH * rows + 28), "Animations sit behind him (his cut-out is laid back over them). No numbered lists, no text-only plates. Logo only on the two lines where he says Fundhub.", fill=(200, 200, 200), font=f)
sh.save(OUT, quality=88, optimize=True)
