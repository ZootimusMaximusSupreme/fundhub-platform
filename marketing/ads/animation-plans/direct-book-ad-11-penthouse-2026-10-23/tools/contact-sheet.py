import json,subprocess
from PIL import Image,ImageDraw,ImageFont
FF='/Users/chrisstanbridge/.local/bin/ffmpeg'
V="/Users/chrisstanbridge/Downloads/Direct Book Ad 11 — The penthouse (1) Animated.mp4"
S=json.load(open('/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/ad11-anim/marketing/ads/animation-plans/direct-book-ad-11-penthouse-2026-10-23/schedule.json'))['clips']
BOX={c['id']:c['words_on_video_box'] for c in S}; PCT={c['id']:c['width_pct_of_frame'] for c in S}; MODE={c['id']:c['mode'] for c in S}
SH=[(1,7.3,"1 hook cards (over B-roll)"),(2,11.9,"2 tag: penthouse"),(3,17.6,"3 he was struggling"),(4,23.2,"4 his three steps"),(5,27.2,"5 tag: $400,000 a month"),(6,29.9,"6 leverage (in front, chest)"),
 (7,36.5,"7 other people's money"),(8,39.0,"8 lever quote (in front, chest)"),(9,43.5,"9 credit is that lever"),(10,45.6,"10 CTA: click the link below"),(10,52.5,"10 CTA at the end (still up)")]
TW,TH=324,576; f=ImageFont.load_default(size=14); tiles=[]
for n,t,l in SH:
    subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',V,'-frames:v','1','cs_t.png'],check=True)
    raw=Image.open('cs_t.png').convert('RGB').resize((TW,TH-22)); im=Image.new('RGB',(TW,TH),(20,20,20)); im.paste(raw,(0,22)); d=ImageDraw.Draw(im)
    kx=TW/1080; ky=(TH-22)/1920; x0,y0,x1,y1=BOX[n]; d.rectangle([x0*kx-2,22+y0*ky-2,x1*kx+2,22+y1*ky+2],outline=(230,30,30),width=2)
    d.text((4,3),f"{l} - {PCT[n]}% wide",fill=(255,255,255),font=f); tiles.append(im)
cols=4; rows=3
sh=Image.new('RGB',(TW*cols,TH*rows),(0,0,0))
for i,im in enumerate(tiles): sh.paste(im,((i%cols)*TW,(i//cols)*TH))
d=ImageDraw.Draw(sh); x=(len(tiles)%cols)*TW+10; y=(len(tiles)//cols)*TH+10
for j,line in enumerate(["Legend","Red box = the words of that animation","(width % of the frame in the title).","Words stay off his face and above","the captions. 6 and 8 sit IN FRONT of","his body (chest band). The rest sit above","his head and cover only hair.","1 is over the B-roll (he is not on screen).","CTA (10) stays up to the last frame.","No Fundhub line, so no logo.","Frames taken once every card is in."]): d.text((x,y+j*20),line,fill=(255,255,255),font=f)
sh.save('contact-sheet-final.jpg',quality=82,optimize=True)
