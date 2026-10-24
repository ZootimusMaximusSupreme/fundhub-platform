"""Union (alpha>40) and core (alpha>200, no soft shadow) bounding boxes of everything a clip draws, in the 3840x2160 clip frame, plus the box of the last frame. python3 bbox.py <clips_dir> <out.json>"""
import json, subprocess, sys, os, glob, tempfile
import numpy as np
from PIL import Image
FF = '/Users/chrisstanbridge/.local/bin/ffmpeg'
d, out = sys.argv[1], sys.argv[2]
res = json.load(open(out)) if os.path.exists(out) else {}
for f in sorted(glob.glob(d + '/*.mov')):
    k = os.path.basename(f)[:-4]
    if k in res: continue
    tmp = tempfile.mkdtemp()
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', f, '-vf', 'fps=6,scale=960:540,format=rgba,alphaextract', f'{tmp}/a_%04d.png'], check=True)
    U = None; last = None; C = None
    for p in sorted(glob.glob(tmp + '/a_*.png')):
        im = np.array(Image.open(p)); a = im > 40; cc = im > 200
        C = cc if C is None else (C | cc)
        U = a if U is None else (U | a); last = a
    def bb(a):
        ys, xs = np.where(a); return [int(xs.min()) * 4, int(ys.min()) * 4, int(xs.max()) * 4 + 4, int(ys.max()) * 4 + 4] if len(xs) else None
    res[k] = {"union": bb(U), "last": bb(last), "core": bb(C)}
    print(k, res[k], flush=True)
    json.dump(res, open(out, 'w'), indent=1)
