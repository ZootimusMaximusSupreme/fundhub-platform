"""Step 1: plan.json from the diagram clips. Round 4 (Chris: "diagrams, not 1234, on ALL of them").
Every animation is a real kit template (marketing/broll) with his words in its props; each is started so the payoff beat of the
template (tag settled, stamp slammed, check landed, button pressed, row in) lands on the word it shows. Offsets inside each clip were read off
3-per-second frame strips of the rendered clip. Word times are pinned (tools/pin.py): whisper on the full file, whisper on a chunk, audio energy onset.
python3 -I tools/make-plan.py"""
import json, os
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30
# id, template, clip (also the props file), start S, render frames D, end, mode, spot, what it shows, events: (what, word, word_t, offset_in_clip_s)
A = [
 dict(id=1, tpl="ToolMatch", clip="01-ToolMatch", S=3.51, D=120, end=8.8, mode="front", spot="center, over the building B-roll",
      shows="Who won't tell you: Your parents / Your friends / Your business partner, each joined to what they do",
      ev=[("row: Your parents - Won't tell you","your",3.76,0.25),("row: Your friends - Won't tell you","your",4.92,0.25+1.16),("row: Your business partner - Maybe not even","maybe",6.22,0.25+2.46)]),
 dict(id=2, tpl="PriceTag", clip="02-PriceTag", S=11.0, D=90, end=18.85, mode="behind", spot="top, left",
      shows="Price tag: Penthouse $1,500,000, then the chip \"He was struggling\"",
      ev=[("tag settles: Penthouse $1,500,000","million",11.3,0.2),("chip: He was struggling","he",12.65,1.6)]),
 dict(id=3, tpl="StampCard", clip="03-StampCard", S=19.65, D=120, end=24.5, mode="behind", spot="top, right",
      shows="Credit card \"His credit\" stamped OPTIMIZED, then \"Put it to work alongside investors and credit partners\"",
      ev=[("card lands: He moved out of state / His credit","cut",19.6,0.3),("stamp slams: OPTIMIZED","optimize",20.8,1.3),("line: Put it to work alongside investors and credit partners","put",22.1,2.1)]),
 dict(id=4, tpl="PriceTag", clip="04-PriceTag", S=25.25, D=90, end=28.2, mode="behind", spot="top, right",
      shows="Price tag: His income, over $400,000 a month",
      ev=[("tag settles: His income, over $400,000 a month","his",25.45,0.2)]),
 dict(id=5, tpl="StampCard", clip="05-StampCard", S=28.5, D=120, end=31.3, mode="behind", spot="top, left",
      shows="Credit card \"Your credit\" stamped LEVERAGED, with \"How to leverage your credit correctly\"",
      ev=[("card lands: The one thing he figured out / Your credit","the",28.3,0.3),("stamp slams: LEVERAGED","leverage",29.8,1.3),("line: How to leverage your credit correctly","correctly",30.6,2.1)]),
 dict(id=6, tpl="StampCard", clip="06-StampCard", S=34.05, D=120, end=37.3, mode="behind", spot="top, right",
      shows="Card \"Other people's money\" under \"Run companies and scale businesses\", stamped MOST EFFICIENTLY",
      ev=[("card lands: Run companies and scale businesses / Other people's money","and",34.5,0.3),("stamp slams: MOST EFFICIENTLY","most",35.35,1.3)]),
 dict(id=7, tpl="StampCard", clip="07-StampCard", S=38.95, D=120, end=41.3, mode="behind", spot="top, right",
      shows="Card \"Credit\" under \"Give me a lever long enough\", stamped THAT LEVER",
      ev=[("card lands: Give me a lever long enough / Credit","give",37.4,0.3),("stamp slams: THAT LEVER","credit",40.3,1.3)]),
 dict(id=8, tpl="StampCard", clip="08-StampCard", S=41.9, D=120, end=44.6, mode="behind", spot="top, left",
      shows="Card \"Only your own cash\" stamped SLOWEST (way to build wealth)",
      ev=[("card lands: Only your own cash","only",42.0,0.3),("stamp slams: SLOWEST way to build wealth","slowest",43.3,1.3)]),
 dict(id=9, tpl="LinkButton", clip="09-LinkButton", S=44.6, D=120, end=53.84, mode="front", spot="chest band, in front of him (CTA, stays to the end)", cta=True,
      shows="Button \"Click the link below\", a cursor presses it, an arrow points down at the link",
      ev=[("button drops in: Click the link below","click",44.75,0.2),("cursor presses it","link",45.3,1.4)]),
]
plan = []
for a in A:
    S = a["S"]; D = a["D"]; total = round((a["end"] - S) * FPS)
    ev = [dict(text=t, word=w, word_t=wt, entrance_t=round(S + o, 3)) for (t, w, wt, o) in a["ev"]]
    plan.append(dict(id=a["id"], template=a["tpl"], clip=a["clip"] + ".mov", mode=a["mode"], spot=a["spot"], shows=a["shows"], start_s=round(S, 3), start_frame=round(S * FPS),
                     render_frames=D, total_frames=total, hold_frames=max(0, total - D), end_s=a["end"], cta=a.get("cta", False), entrances=ev))
    print(a["id"], a["tpl"], "S", S, "D", D, "total", total, "hold", max(0, total - D), [(e["word"], e["word_t"], e["entrance_t"]) for e in ev])
json.dump(plan, open(os.path.join(DIR, "plan.json"), "w"), indent=1, ensure_ascii=False)
