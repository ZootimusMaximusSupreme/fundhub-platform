import json,subprocess,sys
from PIL import Image,ImageDraw,ImageFont
FF='/Users/chrisstanbridge/.local/bin/ffmpeg'
V="/Users/chrisstanbridge/Downloads/Direct Book Ad 11 — The penthouse (1) Animated.mp4"
S=json.load(open('/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/ad11-anim/marketing/ads/animation-plans/direct-book-ad-11-penthouse-2026-10-23/schedule.json'))
BOX={c['n']:c['words_on_video_box'] for c in S['clips']}; PCT={c['n']:c['width_pct_of_frame'] for c in S['clips']}
SH=[(1,6.6,"1 PathCards, hook (parents/friends/partner)"),(2,11.4,"2 PriceTag $1.5M penthouse"),(3,22.0,"3 PathCards: his three steps"),(4,26.8,"4 PriceTag: $400,000 a month"),(5,36.2,"5 PathCards: other people's money"),(6,42.0,"6 PathCards: credit is that lever")]
TW,TH=432,768; f=ImageFont.load_default(size=16); tiles=[]
for n,t,l in SH:
    subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',V,'-frames:v','1',f'cs_{n}.png'],check=True)
    raw=Image.open(f'cs_{n}.png').convert('RGB').resize((TW,TH-24)); im=Image.new('RGB',(TW,TH),(20,20,20)); im.paste(raw,(0,24)); d=ImageDraw.Draw(im); k=TW/1080*(TH-24)/768*768/ (TH-24)*(TH-24)/ (TW/1080*1920) if False else (TH-24)/1920
    x0,y0,x1,y1=BOX[n]; kx=TW/1080; d.rectangle([x0*kx-3,24+y0*k-3,x1*kx+3,24+y1*k+3],outline=(230,30,30),width=3)
    d.text((5,3),f"{l} - {PCT[n]}% wide",fill=(255,255,255),font=f); tiles.append(im)
sh=Image.new('RGB',(TW*3,TH*2+60),(0,0,0))
for i,im in enumerate(tiles): sh.paste(im,((i%3)*TW,(i//3)*TH))
d=ImageDraw.Draw(sh); d.text((10,TH*2+8),"Red box = words of that animation (width % of frame in the title). Words stay off his face and above the captions; plates sit behind him, words box may cover hair. No Fundhub line, so no logo.",fill=(255,255,255),font=f)
d.text((10,TH*2+32),"Frames taken at the payoff of each animation, captions visible.",fill=(255,255,255),font=f)
sh.save('contact-sheet-final.jpg',quality=82,optimize=True)
