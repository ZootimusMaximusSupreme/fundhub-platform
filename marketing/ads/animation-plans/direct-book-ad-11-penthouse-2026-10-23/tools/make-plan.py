"""Step 1 of the Ad 11 build: write props/*.json and plan.json (clip starts, lengths, holds) from the pinned word times.
Every card gets cardAt so it POPS ON THE WORD (50% visible on the word's start). Word times: whisper small.en on the 53.84 s audio,
each pinned against a re-transcribe of a short chunk and the audio energy onset (tools/pin.py; pinned values below).
python3 -I tools/make-plan.py"""
import json, math, os
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS, BASE, POP = 30, 96, 8
HALF = 2  # base frames from card start to 50% visible with POP=8 (Remotion spring, damping 200)
VS = 53.84
# id, template, mode, cards [(title, line, word_time, word)], end_s (last frame of the animation), note
A = [
 dict(id=1, tpl="PathCards", mode="front", spot="center, over the building B-roll", end=8.8, cards=[
   ("Your parents won't tell you",None,3.76,"your"),("Your friends won't",None,4.92,"your"),("Maybe not even your business partner",None,6.22,"maybe")]),
 dict(id=2, tpl="PriceTag", mode="behind", spot="top, left", end=12.45, word=("one",10.70),
   props=dict(eyebrow=None,tag=dict(amount=1500000,upTo=None,per=None,label="Penthouse"),second=None,pileLabel=None,pile=[],pileCount=0,subline=None)),
 dict(id=3, tpl="PathCards", mode="behind", spot="top", end=18.85, cards=[
   ("He was struggling",None,12.65,"he"),("Get his businesses off the ground",None,14.5,"to"),("Sitting in a penthouse he owned outright",None,16.9,"sitting")]),
 dict(id=4, tpl="PathCards", mode="behind", spot="top, right", end=24.5, cards=[
   ("Cut out the distractions",None,19.6,"cut"),("Optimized his credit",None,20.8,"optimize"),("Put it to work alongside investors and credit partners",None,22.1,"put")]),
 dict(id=5, tpl="PriceTag", mode="behind", spot="top, right", end=28.2, word=("his",25.45),
   props=dict(eyebrow=None,tag=dict(amount=400000,upTo=None,per="a month",label="His income, over"),second=None,pileLabel=None,pile=[],pileCount=0,subline=None)),
 dict(id=6, tpl="PathCards", mode="front", spot="chest band, in front of him", end=31.2, cards=[
   ("The one thing he figured out is how to leverage your credit correctly",None,28.3,"the")]),
 dict(id=7, tpl="PathCards", mode="behind", spot="top", end=37.3, cards=[
   ("Plenty of people up here run companies and scale businesses",None,31.3,"I"),("Once you do it most efficiently, use other people's money",None,34.55,"and")]),
 dict(id=8, tpl="PathCards", mode="front", spot="chest band, in front of him", end=40.2, cards=[
   ("Give me a lever long enough and I can move the world",None,37.4,"give")]),
 dict(id=9, tpl="PathCards", mode="behind", spot="top", end=44.6, cards=[
   ("Credit is that lever",None,40.3,"credit"),("And building with only your own cash is the slowest way to build wealth",None,41.25,"and")]),
 dict(id=10, tpl="PathCards", mode="behind", spot="top (CTA, stays to the end)", end=VS, cta=True, cards=[
   ("Click the link below",None,44.75,"click"),("We'll walk you through how to optimize it and how to get your own funding",None,47.35,"we'll")]),
]
os.makedirs(os.path.join(DIR,"props"),exist_ok=True)
plan=[]
for a in A:
    if a["tpl"]=="PriceTag":
        w,t=a["word"]; S=t-6/FPS; D=90
        props=dict(format="vertical",side="left",transparent=True,durationInFrames=D,**a["props"])
        ent=[dict(text="Penthouse $1,500,000" if a["id"]==2 else "His income, over $400,000 a month",word=w,word_t=t,entrance_t=round(S+6/FPS,3))]
        name=f"{a['id']:02d}-PriceTag"
    else:
        cs=a["cards"]; n=len(cs)
        starts=[t-(HALF*0)/FPS for (_,_,t,_) in cs]  # filled below once D is known
        first=cs[0][2]; last=cs[-1][2]
        D=max(75,min(135,math.ceil((last-first)*FPS+0.45*FPS+HALF*0)))
        ent=[]; at=[]
        S=first-(HALF*D/BASE)/FPS          # card 1 starts HALF*D/96 frames before its word
        for (tx,ln,t,w) in cs:
            real_start=t-(HALF*D/BASE)/FPS
            at.append(round((real_start-S)*FPS*BASE/D,3))
            ent.append(dict(text=tx,word=w,word_t=t,entrance_t=round(real_start+(HALF*D/BASE)/FPS,3)))
        props=dict(format="vertical",side="left",eyebrow=None,cards=[dict(title=tx,line=ln) for tx,ln,_,_ in cs],highlight=None,tone="info",layout="stack",cardAt=at,pop=POP,transparent=True,durationInFrames=D)
        name=f"{a['id']:02d}-PathCards"
    json.dump(props,open(os.path.join(DIR,"props",name+".json"),"w"),indent=1,ensure_ascii=False)
    total=round((a["end"]-S)*FPS)
    plan.append(dict(id=a["id"],template=a["tpl"],clip=name+".mov",mode=a["mode"],spot=a["spot"],start_s=round(S,3),start_frame=round(S*FPS),render_frames=D,
       total_frames=total,hold_frames=max(0,total-D),end_s=round(a["end"],3),cta=a.get("cta",False),entrances=ent))
    print(a["id"],a["tpl"],"S=%.2f"%S,"D",D,"total",total,"hold",max(0,total-D),[e["entrance_t"] for e in ent])
json.dump(plan,open(os.path.join(DIR,"plan.json"),"w"),indent=1,ensure_ascii=False)
