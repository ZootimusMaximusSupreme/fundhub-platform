"""How much of each clip's words his cut-out leaves visible, on every frame of the clip's window.

  python3 visible-check.py <schedule.json> <masks_dir> [--write]

For each row with `words_on_video_box` ([x0, y0, x1, y1] on the video) or `words_boxes` (a list of them), it reads
m_%05d.png (white = person, made by matte.swift) for every frame from start_frame to start_frame + frames and
prints the share of word pixels NOT covered by him: the mean over the window and the worst 5% frame. With --write
it saves the worst-5% value as `visible_words_fraction` (and `visible_measured_by`) into schedule.json, which
marketing/broll/scripts/validate-overlay-schedule.mjs then checks (animation-size-readable, owner-set 2026-10-25).
Needs Pillow + numpy.
"""
import json, os, sys
import numpy as np
from PIL import Image

sched_path, masks = sys.argv[1], sys.argv[2]
write = '--write' in sys.argv
S = json.load(open(sched_path))
W, H = S['width'], S['height']
for c in S['clips']:
    boxes = c.get('words_boxes') or ([c['words_on_video_box']] if c.get('words_on_video_box') else [])
    if not boxes:
        print(c.get('n'), c.get('template'), 'no words box')
        continue
    sel = np.zeros((H, W), bool)
    for x0, y0, x1, y1 in boxes:
        sel[max(0, y0):min(H, y1), max(0, x0):min(W, x1)] = True
    area = sel.sum()
    vis = []
    for i in range(c['start_frame'], c['start_frame'] + c['frames']):
        p = os.path.join(masks, f'm_{i:05d}.png')
        if not os.path.exists(p):
            continue
        m = np.array(Image.open(p).convert('L')) > 127
        vis.append(1 - (m & sel).sum() / area)
    if not vis:
        print(c.get('n'), c.get('template'), 'no masks in window')
        continue
    v = np.array(vis)
    worst = float(np.percentile(v, 5))
    print(f"{c.get('n')} {c.get('template')}: mean visible {v.mean():.2f}, worst-5% frame {worst:.2f}, frames {len(v)}")
    if write:
        c['visible_words_fraction'] = round(worst, 3)
        c['visible_measured_by'] = f'visible-check.py, worst 5% of {len(v)} frames'
if write:
    json.dump(S, open(sched_path, 'w'), indent=1, ensure_ascii=False)
    print('wrote', sched_path)
