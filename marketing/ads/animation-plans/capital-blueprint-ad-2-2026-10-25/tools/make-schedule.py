"""Write schedule.json for Capital Blueprint Ad 2 (Opus layout, owner order 2026-10-25).

  python3 marketing/ads/animation-plans/capital-blueprint-ad-2-2026-10-25/tools/make-schedule.py
  python3 marketing/ads/animation-plans/capital-blueprint-ad-2-2026-10-25/tools/visible-check.py <schedule.json> <masks_dir> --write
  node marketing/broll/scripts/validate-overlay-schedule.mjs <schedule.json>

Word times are whisper on the clean master (/tmp/cap-blueprint-ad2-2026-10-25/whisper/words.json). Each clip starts 0.1 s
before its anchor word. The frame layout scan (person cut-out, every frame) leaves two open zones on this close, centered
selfie: the strip above his head (y 269 to about 335-395) and the column right of him (x 770-1060, y 380-1110). Both
clips run Behind him at full width so nothing is shrunk; their words sit in those zones.

Beats 3, 4 and 5 (ChessRightMove, LenderMatchScroll, ChessCallCTA) are held out: their words and payoff sit in the
middle of the plate, under his face. They need a behind-him layout first (new-animations-needed.md).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.dirname(HERE)
FPS = 30
DASH_SRC = "marketing/broll/public/blueprint/blueprint-6-month-timelapse.mp4"

ROWS = [
    {
        "n": 1, "template": "RatesRising", "clip": "01-RatesRising.mov", "props": "props/01-RatesRising.json",
        "anchor_phrase": "Higher interest rates", "anchor_start_s": 0.29, "start_s": 0.19, "frames": 190,
        "mode": "behind", "spot": "behind, headline in the strip above his head, chart behind his head",
        "scale": 1.0, "dx": 0, "dy": -277,
        "words_boxes": [[111, 300, 963, 376], [666, 456, 870, 504]], "min_text_px_clip": 30,
        "why": "Owner beat 1. One full-width line above his head while he says rates, sequences and verification; the chart behind him climbs year by year and the Tighter chip lands at the top right. Holds to 'every single year' (6.49 s).",
    },
    {
        "n": 2, "template": "BlueprintDashboardReal", "clip": "02-BlueprintDashboardReal.mov", "props": "props/02-BlueprintDashboardReal.json",
        "anchor_phrase": "exists", "anchor_start_s": 33.39, "start_s": 33.29, "frames": 1011,
        "mode": "behind", "spot": "behind, full-width window; key line in the strip above his head, lens card in the right column",
        "scale": 1.0, "dx": 0, "dy": 0,
        "words_boxes": [[40, 282, 880, 338], [740, 396, 1052, 950]], "min_text_px_clip": 28,
        "content_source": DASH_SRC,
        "why": "Owner beat 2. The real 6-month sample-file recording from 'exists' through 'focus on making money' (66.99 s): home, next move, checklist, due dates, dispute letters, bank menu, cards used and balance falling, every step done six months on, money menu. Each shot leads its words by 2 to 6 frames.",
    },
]

clips = []
for r in ROWS:
    c = dict(r)
    c["start_frame"] = round(r["start_s"] * FPS)
    c["end_s"] = round(r["start_s"] + r["frames"] / FPS, 3)
    c["timing"] = "REAL (whisper word times on the clean master, 0.1 s lead)"
    clips.append(c)

out = {
    "video": "Capital Blueprint Ad 2 — Learn it yourself",
    "source": "/Users/chrisstanbridge/Desktop/Fundhub Ads/Capital Blueprint Ad 2 — Learn it yourself.mp4",
    "mode": "overlay (see-through), behind him (person cut-out laid back on top)",
    "layout_by": "Opus (animation-size-readable, model-by-job 2026-10-25)",
    "width": 1080, "height": 1920, "fps": FPS, "video_seconds": 115.63,
    "held_out": [
        {"n": 3, "template": "ChessRightMove", "anchor_phrase": "next move", "anchor_start_s": 76.03,
         "reason": "Board and chips sit mid-plate, under his face. Beside at 0.65+ covers his face; behind hides the payoff. Needs a behind-him layout."},
        {"n": 4, "template": "LenderMatchScroll", "anchor_phrase": "data point", "anchor_start_s": 87.11,
         "reason": "Lender table and the count box sit mid-plate and low, under his face and chin. Needs a behind-him layout."},
        {"n": 5, "template": "ChessCallCTA", "anchor_phrase": "hop on a call", "anchor_start_s": 110.48,
         "reason": "The phone square is mid-board, under his face. Needs a behind-him layout."},
    ],
    "clips": clips,
}
path = os.path.join(DIR, "schedule.json")
old = {}
if os.path.exists(path):
    for c in json.load(open(path)).get("clips", []):
        old[c["n"]] = c
for c in clips:
    o = old.get(c["n"], {})
    if o.get("start_frame") == c["start_frame"] and o.get("frames") == c["frames"] and o.get("words_boxes") == c["words_boxes"]:
        for k in ("visible_words_fraction", "visible_measured_by"):
            if k in o:
                c[k] = o[k]
json.dump(out, open(path, "w"), indent=1, ensure_ascii=False)
prev = 0
for c in clips:
    assert c["start_frame"] >= prev, ("overlap", c["n"])
    prev = c["start_frame"] + c["frames"]
    print(c["n"], c["template"], c["start_s"], "-", c["end_s"], "scale", c["scale"], c["spot"])
print("wrote", path)
