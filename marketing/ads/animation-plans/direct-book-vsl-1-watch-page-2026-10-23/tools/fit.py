"""Place and size every clip: the biggest scale at which the clip's drawing (union box from bbox.py) stays clear of his head and shoulders
(person cut-out from matte.swift, summed over the clip's window, plus a margin), inside x 40-2520 and y 24-CAPY (above the captions).
python3 -I tools/fit.py <masks_dir> <bbox.json>   -> schedule.json
Row prefs in PREF: (side, vertical) where vertical is top | mid | low."""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
masks, bbj = sys.argv[1], sys.argv[2]
W, H, FPS = 2560, 1440, 30
CAPY = 1085          # the burned-in captions start about y 1130; nothing below this
OBS_Y = 1040         # his shoulders below this only hide card shadow; ignore them
MARGIN = 28          # clear space around his outline
KMAX, KMIN = 1.5, 0.55
BASE = 2560 / 3840
plan = json.load(open(os.path.join(DIR, "plan.json")))
BB = json.load(open(bbj))
PREF = json.load(open(os.path.join(DIR, "pref.json"))) if os.path.exists(os.path.join(DIR, "pref.json")) else {}
def union(sf, fr):
    U = np.zeros((H, W), bool)
    for i in range(sf, min(sf + fr, 5679), 2):
        p = os.path.join(masks, "m_%05d.png" % i)
        if os.path.exists(p):
            U |= np.array(Image.open(p)) > 100
    U[OBS_Y:] = False
    im = Image.fromarray((U * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * (MARGIN // 2) + 1))
    return np.array(im) > 127
def feasible(U, w, h, ymax):
    I = np.zeros((H + 1, W + 1), np.int64); I[1:, 1:] = U.cumsum(0).cumsum(1)
    ys = np.arange(24, ymax - h + 1); xs = np.arange(40, W - 40 - w + 1)
    if len(ys) == 0 or len(xs) == 0: return None
    Y, X = np.meshgrid(ys, xs, indexing="ij")
    s = I[Y + h, X + w] - I[Y, X + w] - I[Y + h, X] + I[Y, X]
    return ys, xs, s == 0
out = []
for c in plan:
    n = c["n"]; b = BB[c["key"]]["union"]; bw, bh = b[2] - b[0], b[3] - b[1]
    side, vert = PREF.get(str(n), (c["side"], "mid"))
    U = union(c["start_frame"], c["frames"])
    best = None
    for k in np.arange(KMAX, KMIN - 1e-9, -0.025):
        s = BASE * k; w = int(np.ceil(bw * s)); h = int(np.ceil(bh * s))
        r = feasible(U, w, h, CAPY)
        if r is None: continue
        ys, xs, ok = r
        if side == "left": ok2 = ok & (xs[None, :] < W / 2 - w / 2)
        else: ok2 = ok & (xs[None, :] > W / 2 - w / 2)
        if not ok2.any(): continue
        yy, xx = np.where(ok2)
        if side == "left": x = xs[xx.min()] if False else xs[xx.min()]
        else: x = xs[xx.max()]
        # choose y among feasible rows for that x
        rows = ys[np.where(ok2[:, list(xs).index(x)])[0]]
        y = rows.min() if vert == "top" else rows.max() if vert == "low" else rows[len(rows) // 2]
        best = (k, w, h, int(x), int(y)); break
    if best is None:
        print("NO FIT", n); continue
    k, w, h, x, y = best
    s = BASE * k
    dx = int(round(x - b[0] * s)); dy = int(round(y - b[1] * s))
    d = dict(c); d.update({"scale_vs_2560": round(s, 4), "k": round(k, 3), "width_pct_of_frame": round(100 * w / W, 1), "box": [x, y, x + w, y + h], "dx": dx, "dy": dy, "side_used": side, "vertical": vert})
    out.append(d)
    print(n, c["template"], side, vert, "k", round(k, 2), f"{round(100*w/W,1)}%", [x, y, x + w, y + h], flush=True)
json.dump({"video": "Direct Book VSL 1 - Watch page", "width": W, "height": H, "fps": FPS, "video_frames": 5679, "video_seconds": 189.3,
           "mode": "see-through diagrams behind him (his cut-out is laid back over them); words stay clear of his head", "clips": out}, open(os.path.join(DIR, "schedule.json"), "w"), indent=1, ensure_ascii=False)
