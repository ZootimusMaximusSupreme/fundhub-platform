"""The animation plan for Direct Book VSL 1 (Watch page): one row per clip. Writes props/NN-Template.json.
python3 -I tools/plan.py            -> props/*.json and plan.json (start, window, side, props)
Times are seconds on the video, read from whisper small.en word times (words-timeline.txt). s = first word of the idea, e = where the next idea starts.
Every word printed on a clip is a word he says (filmed words beat the script). Template numbers/amounts: only what he says, except QualifyToday (labelled sample file)."""
import json, os
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = {"format": "wide", "transparent": True}
def P(**k):
    d = dict(W); d.update(k); return d
CLIPS = [
 # n, template, s, e, side, hold_s (frozen last picture), props, shows
 (1, "MoneyClimbWide", 2.35, 9.3, "right", 0, P(mode="steps", eyebrow="The condition of your credit decides", headline=None,
   amounts=[{"value": 20000, "label": "In funding"}, {"value": 400000}, {"value": 1000000, "prefix": "Even", "label": "Across multiple businesses"}], goal=None, unit=None, footer="Plus personal funding if you want it"),
   "$20,000, $400,000, even a million, across multiple businesses"),
 (2, "FileItemsWide", 10.55, 14.25, "left", 0, P(eyebrow="Small details in your file", docTitle="Your file", docSubtitle="", items=[{"label": "Your personal data"}, {"label": "Your business codes"}], tag="Holding you back"),
   "your file, your personal data and business codes flagged"),
 (3, "ScoreBadgeWide", 14.3, 17.0, "right", 0, P(mode="threshold", eyebrow="Small details hold back even", score=800, scoreNote="from the MAXIMUM amount"),
   "score gauge, even 800 scores held back"),
 (4, "FundhubLogoWide", 20.9, 23.4, "left", 0, P(), "the fundhub. logo on 'Fundhub'"),
 (5, "MoneyClimbWide", 23.5, 26.6, "right", 0, P(mode="single", eyebrow="10 years ago I learned the funding game", headline=None,
   amounts=[{"value": 1000000, "prefix": "A little over", "label": "Funded for myself"}], goal=None, unit=None, footer=None),
   "a little over $1,000,000 funded for himself"),
 (6, "StampCardWide", 26.6, 32.4, "left", 0, P(object="document", eyebrow="When a bank denies you", title="Your file", amount=None, paidCheck=False, stamp="Denied", stampSub=None, tone="bad", drain=[], subline="Nobody checks your file against what that bank approves"),
   "your file stamped Denied, nobody checks it against what the bank approves"),
 (7, "FileItemsWide", 32.6, 38.7, "right", 0, P(eyebrow="Your file to every lender on their list", docTitle="Your report", docSubtitle="", items=[{"label": "Two approvals"}, {"label": "Hard inquiries", "tag": "A report full of them"}], tag=None),
   "report: two approvals, a report full of hard inquiries"),
 (8, "StampCardWide", 38.8, 43.5, "left", 0, P(object="card", eyebrow="Because you don't want a hard pull", title="Your application", amount=None, paidCheck=False, stamp="Skipped", stampSub=None, tone="bad", drain=[], subline="You never find out what you qualify for"),
   "your application stamped Skipped, you never find out what you qualify for"),
 (9, "StampCardWide", 43.55, 49.6, "right", 0, P(object="file", eyebrow="All three come from the same mistake", title="Your file", amount=None, paidCheck=False, stamp="Not checked", stampSub=None, tone="bad", drain=[], subline="Nobody checks it against what each bank approves"),
   "your file stamped Not checked against what each bank approves"),
 (10, "QualifyTodayWide", 49.95, 55.9, "left", 0, P(eyebrow="Sample file: how much you qualify for", today={"label": "Today · sample file", "value": 199350}),
   "sample file: today vs once fixed (UnderwriteIQ sample client)"),
 (11, "LenderMatchScrollWide", 56.25, 60.45, "right", 0, P(eyebrow="Your file against thousands of lenders", count="30–50", countLabel="lenders that fit you"),
   "bank list scrolls, 30-50 lenders that fit you"),
 (12, "SoftPullWide", 60.5, 63.95, "left", 0, P(eyebrow="We apply", score=None, scoreLabel="Your score", headline="In the order that protects your score.", chip="In funding rounds"),
   "dial that does not move: in the order that protects your score"),
 (13, "FundingStackWide", 64.0, 71.95, "right", 0, P(types=["Credit cards", "Lines of credit", "SBA loans", "Merchant cash advances", "Personal funding"], caption="Stacked together at the lowest rates"),
   "five funding types stack into one block"),
 (14, "FileItemsWide", 72.15, 80.9, "left", 0, P(eyebrow="The step most people miss", docTitle="Your report", docSubtitle="", items=[{"label": "Hard inquiries", "tag": "From every application"}, {"label": "The next lender approves less", "tag": "Or just denies you"}], tag=None),
   "hard inquiries stay on the report, the next lender approves less"),
 (15, "InquiriesOffWide", 81.0, 85.3, "right", 0, P(eyebrow="Between every round", fromLabel="This funding round", itemLabel="Hard inquiries", beforeTag="On your report", afterTag="Removed", toLabel="Next funding round", toNote="Goes in clean"),
   "inquiries struck off, file goes into the next round clean"),
 (16, "FundingRoundsWide", 85.4, 89.4, "left", 0, P(eyebrow="A funding sequence", rounds=6, roundLabel="Round", inquiryChip="Inquiries", captionStruck="Hard inquiries", captionRest="removed between rounds", amounts=None),
   "funding sequence: rounds stack real capital"),
 (17, "MoneyClimbWide", 92.5, 99.0, "right", 0, P(mode="range", eyebrow="Aiming for", headline=None, amounts=[{"value": 250000}, {"value": 400000}], goal=None, unit=None, footer="Most of the people we work with"),
   "$250,000 to $400,000"),
 (18, "FundhubLogoWide", 100.9, 103.0, "left", 0, P(), "the fundhub. logo on 'Fundhub'"),
 (19, "DeadlineClocksWide", 105.3, 113.0, "right", 0, P(clocks=[{"lead": "Within", "hours": 24, "unit": "hours", "label": "A funding advisor starts on your file"}, {"lead": "Within", "hours": 72, "unit": "hours", "label": "Your first applications go out"}], guarantee="If you qualify and we can't fund you, you don't pay."),
   "24 and 72 hour clocks, you don't pay"),
 (20, "FileItemsWide", 113.25, 120.0, "left", 0, P(eyebrow="We show you exactly what it is", docTitle="Your report", docSubtitle="", items=[{"label": "Something on your report"}], tag="Holding you back"),
   "report: the item holding you back, shown"),
 (21, "HiddenDataPointsWide", 121.8, 127.9, "right", 0, P(eyebrow="The Capital Blueprint", count=13, label="optimization points", subline="In the order that actually gets you funded"),
   "13 dots around the count 13 optimization points"),
 (22, "FileItemsWide", 128.45, 134.8, "left", 0, P(eyebrow="It tells you", docTitle="Your file", docSubtitle="", items=[{"label": "Which balances to bring down"}, {"label": "Which negative items to get removed"}, {"label": "What to add to your file"}], tag="To make it stronger"),
   "balances down, negative items removed, what to add"),
 (23, "FundingStackWide", 134.95, 142.4, "right", 0, P(types=["Bank relationships", "Your deposits", "Your business data"], caption="So banks see a company they can trust"),
   "bank relationships, deposits, business data stack"),
 (24, "FundabilityMeterWide", 142.55, 150.0, "left", 0, P(eyebrow="Every step comes with a timeline", steps=["Bring balances down", "Get negative items removed", "Add to your file", "Build bank relationships", "Set up your business data"], meterLabel="Fundability", maxLabel="Maximum"),
   "fundability meter climbs to Maximum"),
 (25, "StampCardWide", 152.9, 159.0, "right", 0, P(object="document", eyebrow=None, title="Capital Blueprint", amount=None, paidCheck=False, stamp="Guaranteed", stampSub=None, tone="ok", drain=[], subline="The last tool you'll ever need to learn the funding game"),
   "Capital Blueprint stamped Guaranteed"),
 (26, "ProofWallWide", 159.2, 165.8, "left", 0, P(proofLines=["Hundreds of files", "Thousands of data points"]),
   "real client approvals, hundreds of files, thousands of data points"),
 (27, "BookCallWide", 165.9, 170.0, "right", 0, P(eyebrow="Click the button below", line="Pick a time for your call", pickDay=15, times=["9:00 AM", "11:30 AM", "2:30 PM", "4:00 PM"], pickTime=2, booked="Time picked", detail=None),
   "CTA: calendar, pick a time for your call"),
 (28, "SoftPullWide", 170.15, 175.9, "left", 0, P(eyebrow="A 3-bureau report", score=None, scoreLabel="Your score", headline="No impact on your score.", chip="You pay $32"),
   "3-bureau report, $32, no impact on your score"),
 (29, "QualifyTodayWide", 176.15, 185.0, "right", 0, P(eyebrow="Sample file: how much you qualify for", today={"label": "Today · sample file", "value": 199350}),
   "sample file: how much you qualify for"),
 (30, "BookCallWide", 186.2, 189.3, "left", 0, P(eyebrow="Click the link below", line="Book your call today", pickDay=15, times=["9:00 AM", "11:30 AM", "2:30 PM", "4:00 PM"], pickTime=2, booked="Booked", detail=None),
   "CTA: click the link below, book your call (held to the last frame)"),
]
# Timing, set from frame strips of each clip (strip.py) against his word times (words-timeline.txt).
# n: (start_s, L_s = length the clip is RENDERED at, so its parts land on his words, play_s = how long it plays (the clip is trimmed there), hold_s = last picture frozen)
TIMING = {
 1: (1.0, 6.2, 6.2, 2.1), 2: (10.7, 4.6, 2.7, 0), 3: (13.45, 3.3, 3.3, 2.2), 4: (20.85, 2.0, 2.0, 0), 5: (22.9, 3.1, 3.1, 0.7),
 6: (26.7, 4.4, 4.4, 1.6), 7: (34.5, 7.0, 4.3, 0), 8: (38.8, 5.0, 4.7, 0), 9: (44.6, 3.6, 3.6, 1.7), 10: (49.95, 6.2, 6.2, 0),
 11: (56.2, 3.5, 3.5, 0.8), 12: (60.5, 3.0, 3.0, 0.5), 13: (64.0, 9.5, 7.95, 0), 14: (73.4, 9.5, 6.4, 0), 15: (79.9, 5.0, 4.6, 0),
 16: (84.6, 4.4, 4.4, 2.0), 17: (93.0, 5.0, 5.0, 1.0), 18: (100.8, 2.0, 2.0, 0), 19: (105.7, 7.2, 7.2, 0), 20: (112.95, 6.0, 6.0, 1.05),
 21: (121.5, 6.1, 6.1, 0.3), 22: (127.9, 8.5, 6.9, 0), 23: (135.2, 9.0, 7.2, 0), 24: (143.0, 5.2, 5.2, 1.9), 25: (152.5, 2.8, 2.8, 3.7),
 26: (159.5, 3.6, 3.6, 2.7), 27: (165.9, 4.6, 4.2, 0), 28: (170.15, 5.9, 5.9, 0), 29: (176.15, 7.5, 7.5, 1.4), 30: (186.2, 3.1, 3.1, 0),
}
# prop fixes after looking at the renders
FIX = {
 8: {"object": "document"},
 17: {"eyebrow": "Most of the people we work with are aiming for", "footer": None},
 22: {"tag": None},
 27: {"line": "Fill out the 10 second application", "booked": "Pick a time for your call"},
}
def main():
    out = []
    for n, tpl, s0, e0, side, hold0, props, shows in CLIPS:
        S, L, Pl, H = TIMING[n]
        props = dict(props); props.update(FIX.get(n, {}))
        sf = round(S * 30); lf = round(L * 30); pf = round(Pl * 30); hf = round(H * 30)
        pr = dict(props); pr["side"] = side; pr["durationInFrames"] = lf
        key = f"{n:02d}-{tpl}"
        json.dump(pr, open(os.path.join(DIR, "props", key + ".json"), "w"), indent=1, ensure_ascii=False)
        out.append({"n": n, "template": tpl, "key": key, "start_s": S, "start_frame": sf, "render_frames": lf, "play_frames": min(pf, lf), "hold_frames": hf, "frames": pf + hf, "end_s": round((sf + pf + hf) / 30, 3), "side": side, "shows": shows})
    json.dump(out, open(os.path.join(DIR, "plan.json"), "w"), indent=1, ensure_ascii=False)
    p = 0
    for c in out:
        assert c["start_frame"] >= p, ("overlap", c["n"], c["start_frame"], p); p = c["start_frame"] + c["frames"]
    tot = sum(c["frames"] for c in out) / 30
    print(len(out), "clips; on screen", round(tot, 1), "s of 189.3 s; last ends", out[-1]["end_s"])
main()
