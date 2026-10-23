"""Write schedule.json for Direct Book Ad 14 (780 and up, 13 optimization points), 74.13 s, 1080x1920, 30 fps. python3 -I <this file>
Every animation is a template diagram from the plan (marketing/ads/animation-plans/2026-10-22.json), re-timed to this filmed take.
Each row: start second on the video, play frames (the rendered clip is cut here), hold frames (last picture held), scale, X side, why.
The clip was rendered with REMOTION_UNCLAMP=1 at length L so its parts land on his words: if the default render has an event at frame e,
the stretched render has it at e * L / L0 (L0 = the template's default length). Words box = settled bounding box of the clip (words-box-in-clip.json)."""
import json, os
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BB = json.load(open(os.path.join(DIR, "words-box-in-clip.json")))
FPS = 30
PAY = {1: 3.3, 2: 10.8, 3: 13.6, 4: 27.4, 5: 31.7, 6: 35.2, 7: 39.4, 8: 45.5, 9: 50.0, 10: 57.6, 11: 61.5}  # a moment where every part of the diagram has landed
SHOWS = {1: "the fundhub. logo", 2: "score gauge, 780 or higher", 3: "tax-return document stamped Not asked, bank-statements plate", 4: "funding types stack into one block", 5: "three credit reports, one mismatch, approvals cut in HALF", 6: "13 dots around the count 13 optimization points", 7: "13 dots, we double your approval odds", 8: "folder stamped Approves you", 9: "a much bigger list of banks, row by row", 10: "inquiries struck off, money rides to the next round", 11: "calendar picks a time, We'll pull your reports"}
# n, template, key, clip, start_frame, play, hold, scale, align(L,C,R), why
ROWS = [
 (1, "FundhubLogo", "01-FundhubLogo", 57, 60, 0, 1.1, "C", "logo sting on 'Fundhub' (1.9 s)"),
 (2, "ScoreBadge", "02-ScoreBadge", 286, 52, 0, 0.74, "L", "threshold mode: marker rides the gauge on 'high', 780 lands on 'score' (10.4-10.7 s)"),
 (3, "StampCard", "03-StampCard", 339, 111, 0, 0.82, "R", "document: 'Banks don't ask for / Your tax returns', stamp slams on 'tax returns' (13.1 s), bank-statements plate on 'bank statements' (14.3 s)"),
 (4, "FundingStack", "04-FundingStack", 614, 231, 0, 1.0, "C", "rows slide in on credit cards 21.8, lines of credit 22.4, SBA 23.2, MCA 24.0, personal 24.8; block closes and caption lands on 'stack all of it ... blend it together' (26.6-27.2 s)"),
 (5, "BureauMatch", "05-BureauMatch", 845, 119, 0, 0.94, "C", "three credit reports, one mismatches, 'cuts your approvals in HALF' lands on 'half' (31.3 s)"),
 (6, "HiddenDataPoints", "06-HiddenDataPoints", 966, 104, 43, 0.74, "R", "13 dots light up to 13 on '13 optimization points' (33.9 s); held through 'before a single application goes out'"),
 (7, "HiddenDataPoints", "07-HiddenDataPoints", 1115, 77, 57, 0.74, "L", "'When we optimize those 13 points' (38.5 s) / 'We double your approval odds' on 'double' (38.9 s); held through the sentence"),
 (8, "StampCard", "08-StampCard", 1287, 88, 0, 0.88, "R", "folder 'Every application goes to a bank', stamp 'Approves you' slams on 'approves you' (45.1-45.4 s)"),
 (9, "LenderList", "09-LenderList", 1376, 171, 43, 0.76, "L", "AI matching system, a much bigger list of banks fills row by row, 'Than anyone else' on 'than anyone else' (49.6 s); held to the end of 'fit your file'"),
 (10, "InquiriesOff", "10-InquiriesOff", 1592, 162, 8, 0.79, "C", "inquiries struck off on 'after every round' (55.6 s), money rides down to 'Next round' on 'so we run each round' (56.8 s), 'Faster than everyone else' (57.3 s)"),
 (11, "BookCall", "11-BookCall", 1763, 84, 377, 0.84, "C", "CTA: calendar on 'click the link below', day and time picked, 'We'll pull your reports' lands on 'reports' (60.8 s); held to the end of the ad"),
]
clips = []
for n, tpl, key, st, play, hold, sc, al, why in ROWS:
    b = BB[key]["settled"] if key in BB else [144, 627, 935, 897]
    if n == 1: b = [144, 627, 935, 897]
    w = round((b[2] - b[0]) * sc); h = round((b[3] - b[1]) * sc)
    X = {"L": 24, "C": round((1080 - w) / 2), "R": 1080 - 24 - w}[al]
    Y = 40 if n == 1 else 10
    c = {"n": n, "template": tpl, "clip": key + ".mov", "start_s": round(st / FPS, 3), "start_frame": st, "play_frames": play, "hold_frames": hold,
         "frames": play + hold, "end_s": round((st + play + hold) / FPS, 3), "scale": sc, "width_pct_of_frame": round(100 * w / 1080),
         "words_on_video_box": [X, Y, X + w, Y + h], "dx": round(X - b[0] * sc), "dy": round(Y - b[1] * sc),
         "payoff_s": PAY[n], "shows": SHOWS[n], "in_front": n != 1, "front": False, "fade_in_s": 0.15, "fade_out": True, "why": why}
    clips.append(c)
json.dump({"video": "Direct Book Ad 14 - 780 and up, 13 optimization points", "mode": "see-through diagrams, in front of his hair (never his face or the captions); the logo behind him",
           "width": 1080, "height": 1920, "fps": FPS, "video_seconds": 2224 / FPS, "clips": clips}, open(os.path.join(DIR, "schedule.json"), "w"), indent=1, ensure_ascii=False)
p = 0
for c in clips:
    assert c["start_frame"] >= p, ("overlap", c["n"], c["start_frame"], p); p = c["start_frame"] + c["frames"]
    x0, y0, x1, y1 = c["words_on_video_box"]
    assert x0 >= 10 and x1 <= 1070 and y0 >= 10 and y1 <= 660, (c["n"], c["words_on_video_box"])
    print(c["n"], c["template"], c["start_s"], c["end_s"], c["width_pct_of_frame"], "%", c["words_on_video_box"])
