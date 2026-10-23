"""Write schedule.json for Direct Book Ad 14 (780 and up, 13 optimization points), 74.13 s, 1080x1920, 30 fps. python3 -I <this file>
Inputs: anchors.json (clip start frame, length, card entrance frames, spoken words) and words-box-in-clip.json
(union bounding box of each rendered clip's plates, clip pixels, scale 1). Y = top of the words box on the video."""
import json, os
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = {p["n"]: p for p in json.load(open(os.path.join(DIR, "anchors.json")))}
BB = {int(k): v for k, v in json.load(open(os.path.join(DIR, "words-box-in-clip.json"))).items()}
FPS = 30
# n, template, clip, scale, Y, in_front, spot
ROWS = [
 (1, "FundhubLogo", "01-FundhubLogo.mov", 1.1, 40, False, "top, behind him (he says Fundhub)"),
 (2, "PathCards", "02-PathCards.mov", 1.0, 40, False, "top, behind him"),
 (3, "PathCards", "03-PathCards.mov", 1.0, 55, True, "in front of him, over his hair and forehead"),
 (4, "PathCards", "04-PathCards.mov", 1.0, 75, True, "in front of him, over his hair and forehead"),
 (5, "PathCards", "05-PathCards.mov", 1.0, 100, True, "in front of him, over his hair and forehead"),
 (6, "PathCards", "06-PathCards.mov", 1.0, 30, True, "in front of him, over his hair and forehead"),
 (7, "PathCards", "07-PathCards.mov", 1.0, 55, True, "in front of him, over his hair and forehead"),
 (8, "PathCards", "08-PathCards.mov", 1.0, 55, True, "in front of him, over his hair and forehead"),
 (9, "PathCards", "09-PathCards.mov", 1.0, 30, False, "top, behind him"),
 (10, "PathCards", "10-PathCards.mov", 1.0, 40, False, "top, behind him, stays to the end"),
]
clips = []
for n, tpl, clip, sc, Y, front, spot in ROWS:
    b = BB[n]; w = round((b[2] - b[0]) * sc); h = round((b[3] - b[1]) * sc)
    X = round((1080 - w) / 2)
    if n == 1:
        st, fr, cards = 57, 60, [[1.90, "FunHub", "the fundhub. logo"]]
        starts = [1]
    else:
        st, fr, cards, starts = A[n]["start_frame"], A[n]["frames"], A[n]["words"], A[n]["starts"]
    wv = [X, Y, X + w, Y + h]
    c = {"n": n, "template": tpl, "clip": clip, "start_s": round(st / FPS, 3), "start_frame": st, "frames": fr,
         "end_s": round((st + fr) / FPS, 3), "scale": sc, "width_pct_of_frame": round(100 * w / 1080),
         "words_on_video_box": wv, "dx": round(X - b[0] * sc), "dy": round(Y - b[1] * sc),
         "in_front": front, "front": False, "spot": spot, "fade_in_s": 0.1 if n == 1 else 0,
         "fade_out": True, "card_start_frames": starts, "cards": cards}
    clips.append(c)
for a, b in zip(clips, clips[1:]):  # a clip never runs into the next one (trim the tail, it is only held picture)
    if a["start_frame"] + a["frames"] > b["start_frame"]:
        a["frames"] = b["start_frame"] - a["start_frame"]; a["end_s"] = round((a["start_frame"] + a["frames"]) / FPS, 3)
json.dump({"video": "Direct Book Ad 14 — 780 and up, 13 optimization points", "mode": "overlay; plates behind him (person cut-out on top) or in front of him (drawn after the cut-out)",
           "width": 1080, "height": 1920, "fps": FPS, "video_seconds": 2224 / FPS, "clips": clips},
          open(os.path.join(DIR, "schedule.json"), "w"), indent=1, ensure_ascii=False)
p = 0
for c in clips:
    assert c["start_frame"] >= p, ("overlap", c["n"], c["start_frame"], p); p = c["start_frame"] + c["frames"]
    x0, y0, x1, y1 = c["words_on_video_box"]
    assert x0 >= 10 and x1 <= 1070 and y0 >= 10 and y1 <= 1450, c["n"]
    print(c["n"], c["template"], c["start_s"], c["end_s"], c["width_pct_of_frame"], "%", c["words_on_video_box"], "front" if c["in_front"] else "behind")
