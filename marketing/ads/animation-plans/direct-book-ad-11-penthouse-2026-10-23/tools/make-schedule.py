"""Write schedule.json for Direct Book Ad 11 (The penthouse), the 53.84 s cut ("(1)"). python3 -I <this file>
Word times: whisper small.en on this file's audio (words-timeline.txt). X,Y = top-left of the clip's WORDS box on the 1080x1920 video.
front=True: the words box (+10 px) is also drawn in FRONT of him (hair only; the fit keeps every word box off his face and neck)."""
import json, os
DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# n, template, clip, start_s, frames, scale, X, Y, words box (clip px at scale 1), front, spot, why
ROWS = [
 (1,"PathCards","01-PathCards.mov",3.7,135,1.0,77,330,(80,555,1007,1069),False,"center, over the building B-roll (he is not on screen until 8.9 s)",
  "card 1 solid 0.7 s in (4.4 s) on 'your parents won't tell you' (3.8-4.6 s); card 2 about 5.3 s on 'your friends won't' (5.1-5.8 s); card 3 about 6.2 s on 'maybe not even your business partner' (6.1-7.2 s)"),
 (2,"PriceTag","02-PriceTag.mov",10.3,90,1.2,40,10,(241,620,856,1023),True,"top, left",
  "tag settles 0.5 s in (10.8 s) on 'one and a half million' (10.8-11.7 s); held through 'dollar penthouse' (11.7-12.4 s) and 'he was struggling'"),
 (3,"PathCards","03-PathCards.mov",19.2,105,0.85,258,12,(80,555,1007,1069),True,"top, right",
  "card 1 at about 19.9 s on 'cut out the distractions' (19.5-20.4 s); card 2 about 20.8 s on 'optimize his credit' (20.7-21.6 s); card 3 about 21.7 s on 'put it to work alongside investors and credit partners' (21.9-24.0 s)"),
 (4,"PriceTag","04-PriceTag.mov",25.2,90,0.8,570,25,(241,571,860,1072),True,"top, right",
  "tag settles 0.5 s in (25.7 s) on 'his income was over'; '$400,000 a month' on the tag while he says '$400,000' (26.4 s) and 'a month' (27.6 s)"),
 (5,"PathCards","05-PathCards.mov",34.0,105,1.0,70,15,(81,629,1006,996),True,"top, full width",
  "card 1 at about 34.7 s on 'scale businesses' (33.6-34.5 s); card 2 about 35.6 s on 'most efficiently use other people's money' (35.3-37.3 s)"),
 (6,"PathCards","06-PathCards.mov",39.9,135,1.0,118,15,(81,639,1006,986),True,"top, full width",
  "card 1 solid at about 40.6 s on 'credit is that lever' (40.2-41.2 s); card 2 about 41.5 s on 'building with only your own cash' (41.3-43.0 s), subline 'the slowest way to build wealth' (43.3-44.3 s)"),
]
FPS=30; VS=53.84; PAD=10
clips=[]
for n,tpl,clip,st,fr,sc,X,Y,b,front,spot,why in ROWS:
    wv=[X,Y,round(X+(b[2]-b[0])*sc),round(Y+(b[3]-b[1])*sc)]
    clips.append({"n":n,"template":tpl,"clip":clip,"start_s":st,"start_frame":round(st*FPS),"frames":fr,"end_s":round(st+fr/FPS,3),
      "scale":sc,"width_pct_of_frame":round(100*(wv[2]-wv[0])/1080),"words_x":X,"words_y":Y,"words_box_clip":list(b),"words_on_video_box":wv,
      "dx":round(X-b[0]*sc),"dy":round(Y-b[1]*sc),"front":front,
      "front_rect":[max(0,wv[0]-PAD),max(0,wv[1]-PAD),min(1080,wv[2]+PAD),min(1920,wv[3]+PAD)],"spot":spot,"why":why})
json.dump({"video":"Direct Book Ad 11 — The penthouse (1)","mode":"overlay, behind him; words box also in front over hair",
 "width":1080,"height":1920,"fps":FPS,"video_seconds":VS,"clips":clips},open(os.path.join(DIR,"schedule.json"),"w"),indent=1,ensure_ascii=False)
p=0
for c in clips:
    assert c["start_frame"]>=p,("overlap",c["n"]); p=c["start_frame"]+c["frames"]
    assert c["words_on_video_box"][0]>=10 and c["words_on_video_box"][2]<=1070 and c["words_on_video_box"][1]>=10,c["n"]
    print(c["n"],c["template"],c["start_s"],c["end_s"],c["scale"],c["width_pct_of_frame"],"%",c["words_on_video_box"])
