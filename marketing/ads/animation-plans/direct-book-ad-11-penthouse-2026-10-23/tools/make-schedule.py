"""Write schedule.json for Direct Book Ad 11 (The penthouse). python3 -I <this file>
Word times: whisper small.en on the real audio (words-timeline.txt), checked against the burned-in captions.
Row: n, template, clip, start_s, frames, scale, X, Y (words box top-left on the video), box (x0,y0,x1,y1 at scale 1), spot, why."""
import json, os
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROWS = [
 (1,"PriceTag","01-PriceTag.mov",12.3,90,0.41,817,835,(243,485,860,1135),"right, lower middle",
  "tag settles 0.5 s in (12.8 s) on 'dollar penthouse' (12.8-13.1 s); 'He was struggling' appears 1.6 s in (13.9 s), on 'struggling' (13.9 s)"),
 (2,"StepPath","02-StepPath.mov",25.3,90,0.31,14,273,(150,620,865,1000),"left, top",
  "step 1 lights 0.5 s in (25.8 s) on 'his credit' (25.6-26.0 s); step 2 lights 2.0 s in (27.3 s) on 'put it to work' (27.1-27.5 s)"),
 (3,"MoneyClimb","03-MoneyClimb.mov",30.0,120,0.45,757,275,(120,400,805,1000),"right, top",
  "'Within six months' at 30.0 s on 'within six months' (29.9-30.5 s); count reaches $400,000 at 2.6 s in (32.6 s) on '$400,000' (32.6 s); 'a month' printed at 2.7 s (32.7 s), said at 34.8 s"),
 (4,"CompanyLine","04-CompanyLine.mov",46.5,105,0.42,680,272,(75,405,1000,660),"right, top",
  "headline up 0.3 s in (46.8 s), the whole line on screen while he says 'the ones who do it most efficiently use other people's money' (47.0-49.9 s)"),
 (5,"PathCards","05-PathCards.mov",54.2,120,0.34,758,955,(86,640,1000,990),"right, lower middle",
  "card 1 solid 0.7 s in (54.9 s) on 'credit is that lever' (54.1-55.1 s); card 2 lands 1.6 s in (55.8 s) on 'building with only your own cash' (55.3-56.7 s)"),
]
FPS=30; VS=69.8
clips=[]
for n,tpl,clip,st,fr,sc,X,Y,b,spot,why in ROWS:
    clips.append({"n":n,"template":tpl,"clip":clip,"start_s":st,"start_frame":round(st*FPS),"frames":fr,"end_s":round(st+fr/FPS,3),
      "scale":sc,"words_x":X,"words_y":Y,"words_box_clip":list(b),
      "words_on_video_box":[X,Y,round(X+(b[2]-b[0])*sc),round(Y+(b[3]-b[1])*sc)],
      "dx":round(X-b[0]*sc),"dy":round(Y-b[1]*sc),"spot":spot,"why":why})
json.dump({"video":"Direct Book Ad 11 — The penthouse","mode":"overlay (see-through), behind him (person cut-out laid back on top)",
 "width":1080,"height":1920,"fps":FPS,"video_seconds":VS,"clips":clips},open(os.path.join(DIR,"schedule.json"),"w"),indent=1,ensure_ascii=False)
p=0
for c in clips:
    assert c["start_frame"]>=p,("overlap",c["n"]); p=c["start_frame"]+c["frames"]
    print(c["n"],c["template"],c["start_s"],c["end_s"],c["scale"],c["dx"],c["dy"],c["spot"])
print(sum(c["frames"] for c in clips)/FPS,"s of animation")
