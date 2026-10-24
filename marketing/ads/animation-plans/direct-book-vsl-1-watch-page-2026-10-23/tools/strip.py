"""Contact strip of one clip, cropped to what it draws, over a green checker, with seconds-into-clip labels.
python3 strip.py <clip.mov> <out.jpg> [tiles=18] [bbox.json]"""
import subprocess, sys, tempfile, glob, os, json
from PIL import Image, ImageDraw, ImageFont
FF = '/Users/chrisstanbridge/.local/bin/ffmpeg'
clip, out = sys.argv[1], sys.argv[2]; tiles = int(sys.argv[3]) if len(sys.argv) > 3 else 18
bj = sys.argv[4] if len(sys.argv) > 4 else None
k = os.path.basename(clip)[:-4]
crop = 'null'
if bj and os.path.exists(bj):
    u = json.load(open(bj)).get(k)
    if u:
        x0, y0, x1, y1 = u['union']; crop = f'crop={x1-x0}:{y1-y0}:{x0}:{y0}'
n = int(subprocess.run([FF, '-hide_banner', '-i', clip], capture_output=True, text=True).stderr.split('Duration: ')[1][:11].replace(':', ' ').split()[2].split('.')[0]) if False else None
dur = subprocess.run([FF, '-hide_banner', '-i', clip], capture_output=True, text=True).stderr.split('Duration: ')[1][:11]
h_, m_, s_ = dur.split(':'); dur = int(h_) * 3600 + int(m_) * 60 + float(s_)
fps = tiles / dur
tmp = tempfile.mkdtemp()
subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', clip, '-vf', f'{crop},fps={fps:.4f},scale=420:-1', f'{tmp}/f_%03d.png'], check=True)
fs = sorted(glob.glob(tmp + '/f_*.png'))[:tiles]
w, h = Image.open(fs[0]).size; cols = 6; rows = (len(fs) + cols - 1) // cols
sh = Image.new('RGB', (w * cols, h * rows), (60, 60, 60)); f = ImageFont.load_default(size=16)
for i, p in enumerate(fs):
    im = Image.open(p).convert('RGBA'); bg = Image.new('RGBA', im.size, (90, 130, 90, 255)); bg.alpha_composite(im)
    d = ImageDraw.Draw(bg); d.text((6, 4), f'{i / fps:.2f}s', fill=(255, 255, 0), font=f)
    sh.paste(bg.convert('RGB'), ((i % cols) * w, (i // cols) * h))
sh.save(out, quality=80)
