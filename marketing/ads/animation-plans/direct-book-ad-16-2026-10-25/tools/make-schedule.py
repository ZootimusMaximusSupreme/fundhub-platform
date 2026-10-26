#!/usr/bin/env python3
"""Direct Book Ad 16 (2026-10-25 redo): writes props/ and schedule.json from the real word times.

Every clip is a full 1080x1920 see-through render at scale 1, drawn for the open sky above his hair
(SkyDiagram, FundhubLogo with plateTop). Nothing is cropped, shifted or squeezed. Word times are the
burned-in caption times in ../direct-book-ad-16-test-2026-10-23/words-timeline-from-captions.txt.
Each step lands on its word; each clip starts about 0.1 s before its anchor word.

  python3 tools/make-schedule.py
"""
import json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROPS = os.path.join(HERE, "props")
FPS = 30
TOP, HEIGHT = 36, 340
# Card left edge 30 + 2 px border: local SVG x/y -> video x/y.
OX, OY = 32, TOP + 2


def fr(t):
    return round(t * FPS)


def box(x0, y0, x1, y1, top=TOP):
    oy = top + 2
    return [int(x0 + OX), int(y0 + oy), int(x1 + OX), int(y1 + oy)]


# start (s), end (s), kind, step times (s), labels, words boxes in card coords, smallest words px, anchor, why
ROWS = [
    dict(clip="01-precheck", start=5.2, end=10.0, kind="precheck",
         steps=[5.3, 6.6, 7.3, 7.8, 8.5],
         labels=["Checked first", "Bank", "Most can't do this"],
         boxes=[box(352, 246, 648, 306), box(820, 254, 920, 300), box(60, 5, 400, 63)],
         min_text=36, anchor="there's one thing we do with your file before it ever goes to a bank",
         why="File, a check, then the bank: the step done before a bank sees the file. 'Most can't do this' lands on 'almost nobody'."),
    dict(clip="02-box-program", start=10.9, end=21.4, kind="boxProgram",
         steps=[11.5, 13.2, 14.5, 16.4, 18.95, 19.75, 20.55],
         labels=["Off the shelf", "Bank data", "Out of date", "One path for all", "850", "400", "500"],
         boxes=[box(10, 258, 262, 300), box(270, 258, 450, 300), box(205, 125, 515, 215), box(630, 258, 970, 300), box(620, 28, 920, 90)],
         min_text=36, anchor="most of these programs are a business in a box system",
         why="The bought program, its stale bank data stamped on 'out of date', then 850, 400 and 500 each drop into one funnel on its word."),
    dict(clip="04-logo", start=23.5, end=25.5, kind="logo",
         anchor="Fundhub", why="The logo plays only on the Fundhub line. Plate sits in the sky (plateTop 90)."),
    dict(clip="05-feeds", start=25.6, end=33.9, kind="feeds",
         steps=[26.2, 27.3, 27.45, 27.6, 27.75, 27.9, 28.0, 28.5, 30.9, 32.5, 32.9],
         labels=["data feeds", "Our engine", "Same as banks", "Approve", "Deny"],
         boxes=[box(30, 60, 190, 272), box(380, 250, 560, 292), box(720, 8, 1000, 62), box(712, 226, 940, 324)],
         min_text=34, anchor="I built a real underwriting algorithm that pulls from 6 to 7 different data feeds",
         why="Feeds count up and the 7 lands on 'seven'; the bank shows on 'systems'; approve and deny on their words."),
    dict(clip="06-heat-map", start=34.0, end=40.87, kind="heatMap",
         steps=[34.1, 34.8, 38.8, 40.4],
         labels=["Hot", "Cold", "Hottest now", "You go here"],
         boxes=[box(110, 56, 200, 96), box(110, 236, 220, 276), box(740, 80, 1020, 140), box(740, 180, 1020, 240)],
         min_text=36, anchor="we're constantly watching the lending environment nationally and state by state",
         why="The state tiles warm up while he says nationally and state by state; the hot spot flares on 'hottest'; the pin drops on 'send you'."),
    dict(clip="07-score-range", start=40.9, end=44.4, kind="scoreRange",
         steps=[41.4, 42.6, 43.9],
         labels=["Scores we take", "400", "850"],
         boxes=[box(36, 36, 360, 82), box(130, 240, 276, 304), box(744, 240, 900, 304)],
         min_text=40, anchor="we work with credit scores anywhere from 400 to 850",
         why="The gauge fills from 400 on 'four hundred' to 850 on 'eight fifty'."),
    dict(clip="08-three-ways", start=44.4, end=48.0, kind="threeWays",
         steps=[44.9, 46.0, 47.0],
         labels=["Done for you", "Side by side", "On your own"],
         boxes=[box(30, 246, 310, 288), box(370, 246, 650, 288), box(718, 246, 982, 288)],
         min_text=38, anchor="we'll do it for you, we'll do it with you, or we'll set it up to do it yourself",
         why="Three icons, each lights on its phrase. Icons, not a word list (PathCards is banned)."),
    dict(clip="09-fund-types", start=48.1, end=51.4, kind="fundTypes",
         steps=[48.6, 49.2, 49.8, 50.4],
         labels=["Credit cards", "SBA loans", "MCA", "And more"],
         boxes=[box(10, 246, 268, 288), box(290, 246, 486, 288), box(600, 246, 676, 288), box(800, 246, 976, 288)],
         min_text=38, anchor="that goes for credit cards, SBA loans, MCA and more",
         why="A card, a loan, cash and a plus, each on its word."),
    dict(clip="10-verdict", start=51.7, end=61.6, kind="verdict",
         steps=[51.8, 54.0, 54.8, 57.0, 59.0, 60.8],
         labels=["Approved", "Denied", "Pre-vetted", "VIP handoff"],
         boxes=[box(270, 66, 570, 234), box(380, 240, 580, 300), box(760, 258, 990, 302)],
         min_text=36, anchor="because of that algorithm, we know whether you're going to get approved or denied",
         why="The engine checks the file; approved and denied light on their words; the file goes to the bank pre-vetted on 'pre-vetted'; VIP handoff on 'white glove'."),
    dict(clip="11-book-call", start=63.3, end=67.6, kind="bookCall", top=60, height=280,
         steps=[63.35, 63.8],
         labels=["Book a call"],
         boxes=[box(130, 65, 890, 195, top=60)],
         min_text=58, anchor="book a call below",
         why="A button pressed on 'call'. Small CTA in the sky, not a big calendar."),
]


def main():
    os.makedirs(PROPS, exist_ok=True)
    clips = []
    for n, r in enumerate(ROWS, 1):
        sf, ef = fr(r["start"]), fr(r["end"])
        frames = ef - sf
        if r["kind"] == "logo":
            template = "FundhubLogo"
            props = {"format": "vertical", "plateTop": 90, "transparent": True, "durationInFrames": frames}
            words = [[152, 90, 928, 345]]
            min_text = 120
        else:
            template = "SkyDiagram"
            top, height = r.get("top", TOP), r.get("height", HEIGHT)
            props = {"kind": r["kind"], "top": top, "height": height,
                     "at": [fr(t) - sf for t in r["steps"]], "labels": r["labels"],
                     "transparent": True, "durationInFrames": frames}
            words = r["boxes"]
            min_text = r["min_text"]
        with open(os.path.join(PROPS, r["clip"] + ".json"), "w") as fh:
            json.dump(props, fh, indent=1)
        clips.append({
            "n": n, "template": template, "clip": r["clip"] + ".mov", "props": "props/" + r["clip"] + ".json",
            "start_s": round(sf / FPS, 3), "start_frame": sf, "frames": frames, "scale": 1, "dx": 0, "dy": 0,
            "mode": "behind", "spot": "top one-third, the sky above his hair; lower middle of the card slightly behind his hair",
            "words_band": "top", "words_boxes": words, "min_text_px_clip": min_text,
            "anchor_phrase": r["anchor"], "why": r["why"],
        })
    sched = {
        "video": "Direct Book Ad 16 — Advanced funding algorithm",
        "source_file": "Downloads/Direct-Book-Ad-16 (Edited no Animation).mp4 (picture), /tmp/ad16-redo/ad16-leveled.mp4 (base with leveled sound)",
        "mode": "overlay (see-through), top one-third, behind his cut-out",
        "width": 1080, "height": 1920, "fps": FPS, "video_seconds": 67.6,
        "placement_note": ("Close selfie: his head covers x 240-780 and his hair top runs y 322-422 (person cut-out, every frame). "
                           "Every clip is drawn for the sky band (card y 36-376), full width, at scale 1. Words in the middle column end above his hair; "
                           "the card's lower middle sits slightly behind his hair. Nothing is cropped or squeezed. Opus layout 2026-10-25."),
        "clips": clips,
    }
    with open(os.path.join(HERE, "schedule.json"), "w") as fh:
        json.dump(sched, fh, indent=1, ensure_ascii=False)
    print("wrote", len(clips), "clips")


if __name__ == "__main__":
    main()
