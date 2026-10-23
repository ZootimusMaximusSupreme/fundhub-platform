"""Write schedule.json for Direct Book Ad 16 from the anchors and the placements below.

  python3 -I marketing/ads/animation-plans/direct-book-ad-16-test-2026-10-23/tools/make-schedule.py

Every start time is REAL: read from the burned-in captions (anchors.json) and then moved so each clip's payoff lands on
the spoken words (payoff offsets measured from 3-per-second frame strips of each clip).

Placement: "words_box" is the box (in the clip's own 1080x1920 pixels, at scale 1) that holds every WORD of the clip;
(X, Y) is where that box's top-left corner goes on the video after scaling. Everything else in the clip (the white plate,
money, dots, list rows) may reach behind him. dx, dy = X - box_x0 * scale, Y - box_y0 * scale (the scaled clip's top-left).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.dirname(HERE)
anchors = {a["n"]: a for a in json.load(open(os.path.join(DIR, "anchors.json")))["anchors"]}

# n: (template, clip file, start_s, frames, scale, X, Y, words_box_x0, words_box_y0, spot, why)
ROWS = [
    (1, "StampCard", "01-StampCard.mov", 14.05, 90, 0.47, 818, 420, 300, 456, "right, upper middle",
     "OUT OF DATE stamp slams 0.9 s into the clip (14.95 s) and settles at 15.1 s, on 'out of date'; the card lands on 'usually'"),
    (2, "FundhubLogo", "02-FundhubLogo.mov", 23.3, 60, 0.80, 288, 272, 225, 690, "center, above his head",
     "letters rise 0.33-0.67 s in, on 'Fundhub' (caption 23.6 s); 2 seconds, only where he says Fundhub"),
    (3, "HiddenDataPoints", "03-HiddenDataPoints.mov", 27.0, 90, 0.44, 11, 271, 214, 508, "left, top",
     "the count reaches 7 about 1.6 s in (28.6 s), on 'seven'; 'different data feeds' lands about 1.9 s in (28.9 s), on 'different'"),
    (4, "LenderList", "04-LenderList.mov", 37.8, 60, 0.49, 698, 271, 191, 455, "right, top",
     "headline is up 0.3 s in, on 'where the lending is hottest'; the five rows fill while he says 'hottest right now'"),
    (5, "ScoreBadge", "05-ScoreBadge.mov", 41.3, 96, 0.37, 791, 833, 170, 479, "right, low",
     "eyebrow on 'we work with credit scores', gauge sweeps on 'anywhere from 400', check lands at 43.5 s on 'to' and 'Anywhere from 400 to 850' is complete at 43.9 s, on '850'"),
    (6, "PathCards", "06-PathCards.mov", 44.5, 135, 0.37, 10, 271, 82, 585, "left, top",
     "stretched to the longest allowed (4.5 s): cards land at about 45.2, 45.9 and 46.6 s, on 'for you', 'with you', 'set it up'"),
    (7, "StampCard", "07-StampCard.mov", 53.15, 120, 0.47, 800, 600, 281, 436, "right, lower middle",
     "folder lands on 'going to get', APPROVED / OR DENIED stamp slams about 1.2 s in (54.35 s) and settles at 54.6 s, on 'approved or denied'; subline at about 54.85 s"),
]
# union of every word box of each clip at scale 1: (x0, y0, x1, y1), read from the clip's hold frame
WORDS_BOX = {1: (300, 456, 830, 999), 2: (225, 690, 854, 815), 3: (214, 508, 906, 1129), 4: (191, 455, 947, 670),
             5: (170, 479, 916, 1140), 6: (82, 585, 875, 1043), 7: (281, 436, 848, 1178)}
clips = []
for n, tpl, clip, start_s, frames, sc, X, Y, bx, by, spot, why in ROWS:
    a = anchors[n]
    wb = WORDS_BOX[n]
    assert (wb[0], wb[1]) == (bx, by)
    clips.append({
        "n": n, "template": tpl, "clip": clip,
        "start_s": start_s, "start_frame": round(start_s * 30), "frames": frames,
        "end_s": round(start_s + frames / 30, 3),
        "timing": "REAL (read from the burned-in captions, then moved so the payoff lands on the words)",
        "anchor_phrase": a["phrase"], "anchor_start_s": a["start_s"], "anchor_end_s": a["end_s"], "anchor_match": a["match"],
        "plan_start_s": a["planned_start_s"],
        "spot": spot, "scale": sc, "words_x": X, "words_y": Y, "words_box_clip_xy": [bx, by],
        "words_on_video_box": [X, Y, round(X + (wb[2] - wb[0]) * sc), round(Y + (wb[3] - wb[1]) * sc)],
        "dx": round(X - bx * sc), "dy": round(Y - by * sc),
        "why": why,
    })
out = {
    "video": "Direct Book Ad 16 — Advanced funding algorithm",
    "mode": "overlay (see-through), behind him (person cut-out laid back on top)",
    "width": 1080, "height": 1920, "fps": 30, "video_seconds": 67.6,
    "rule_note": "Overlay mode forbids overlaps only. The full-frame 4 s face gap / 3 s cap / 35% share do not apply.",
    "clips": clips,
}
json.dump(out, open(os.path.join(DIR, "schedule.json"), "w"), indent=1, ensure_ascii=False)
tot = sum(c["frames"] for c in clips) / 30
print(f"{len(clips)} clips, {tot:.1f} s of animation ({tot / 67.6:.0%} of the video)")
prev_end = 0
for c in clips:
    assert c["start_frame"] >= prev_end, ("overlap", c["n"])
    prev_end = c["start_frame"] + c["frames"]
    print(c["n"], c["template"], c["start_s"], "-", c["end_s"], "scale", c["scale"], "dx,dy", c["dx"], c["dy"], c["spot"])
