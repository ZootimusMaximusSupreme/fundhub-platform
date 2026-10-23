"""Step 2: schedule.json from plan.json (tools/make-plan.py) + the spots below. python3 -I tools/make-schedule.py
X,Y = top-left of each clip's WORDS box (settled frame, tools/clip-boxes.json) on the 1080x1920 video; scale from tools/fit-search.py.
mode "front": the whole clip is laid on top of everything (over the building B-roll, or over his body in the chest band, never over face or captions).
mode "behind": plate under his cut-out, and the words box (+10 px) also drawn in front (so words can cover hair; the fit keeps them off his face)."""
import json, os
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
plan = {c["id"]: c for c in json.load(open(os.path.join(DIR, "plan.json")))}
boxes = {int(k): v for k, v in json.load(open(os.path.join(DIR, "tools", "clip-boxes.json"))).items()}
PLACE = {  # id: (scale, X, Y)
 1: (1.0, 75, 330), 2: (0.8, 30, 20), 3: (0.6, 540, 30), 4: (0.8, 570, 20), 5: (0.55, 20, 20),
 6: (0.7, 440, 30), 7: (0.8, 470, 12), 8: (0.9, 20, 11), 9: (0.9, 144, 1195),
}
PAD = 10
clips = []
for i, c in plan.items():
    sc, X, Y = PLACE[i]; b = boxes[i]
    wv = [X, Y, round(X + (b[2] - b[0]) * sc), round(Y + (b[3] - b[1]) * sc)]
    row = dict(c)
    row.update({"scale": sc, "words_x": X, "words_y": Y, "words_box_clip": b, "words_on_video_box": wv,
                "width_pct_of_frame": round(100 * (wv[2] - wv[0]) / 1080),
                "dx": round(X - b[0] * sc), "dy": round(Y - b[1] * sc),
                "front_rect": [max(0, wv[0] - PAD), max(0, wv[1] - PAD), min(1080, wv[2] + PAD), min(1920, wv[3] + PAD)],
                "fade_out": not c["cta"]})
    clips.append(row)
json.dump({"video": "Direct Book Ad 11 — The penthouse (1)", "width": 1080, "height": 1920, "fps": 30, "video_seconds": 53.84, "clips": clips},
          open(os.path.join(DIR, "schedule.json"), "w"), indent=1, ensure_ascii=False)
prev = 0
for c in clips:
    assert c["start_frame"] >= prev, ("overlap", c["id"], c["start_frame"], prev)
    prev = c["start_frame"] + c["total_frames"]
    b = c["words_on_video_box"]; assert b[0] >= 10 and b[2] <= 1070 and b[1] >= 10 and b[3] <= 1480, ("edge/caption", c["id"], b)
    print(c["id"], c["template"], c["mode"], c["start_s"], c["end_s"], c["scale"], c["width_pct_of_frame"], "%", b)
