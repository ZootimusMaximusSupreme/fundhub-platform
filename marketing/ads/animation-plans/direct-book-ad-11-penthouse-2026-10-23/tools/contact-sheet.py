import json,subprocess
from PIL import Image,ImageDraw,ImageFont
FF='/Users/chrisstanbridge/.local/bin/ffmpeg'
V="/Users/chrisstanbridge/Downloads/Direct Book Ad 11 — The penthouse Animated.mp4"
S=json.load(open('/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/ad11-anim/marketing/ads/animation-plans/direct-book-ad-11-penthouse-2026-10-23/schedule.json'))
BOX={c['n']:c['words_on_video_box'] for c in S['clips']}
SH=[(1,13.9,"1 PriceTag $1,500,000 (on 'penthouse... struggling')"),(2,27.4,"2 StepPath (on 'put it to work')"),(3,32.9,"3 MoneyClimb (on '$400,000')"),(4,48.6,"4 CompanyLine (on 'efficiently use')"),(5,56.0,"5 PathCards (on 'only your own cash')")]
TW,TH=432,768; f=ImageFont.load_default(size=17); tiles=[]
for n,t,l in SH:
    subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',V,'-frames:v','1',f'cs_{n}.png'],check=True)
    im=Image.open(f'cs_{n}.png').convert('RGB').resize((TW,TH)); d=ImageDraw.Draw(im); k=TW/1080
    x0,y0,x1,y1=BOX[n]; d.rectangle([x0*k-4,y0*k-4,x1*k+4,y1*k+4],outline=(230,30,30),width=3)
    d.rectangle([0,0,TW,26],fill=(20,20,20)); d.text((6,3),l,fill=(255,255,255),font=f); tiles.append(im)
sh=Image.new('RGB',(TW*3,TH*2),(0,0,0))
for i,im in enumerate(tiles): sh.paste(im,((i%3)*TW,(i//3)*TH))
d=ImageDraw.Draw(sh)
for i,line in enumerate(["Legend","Red box = words of that animation.","Clear of his head, above captions.","Plates may go behind him.","No Fundhub line, so no logo."]): d.text((2*TW+12,TH+14+i*24),line,fill=(255,255,255),font=f)
sh.save('contact-sheet-final.jpg',quality=80,optimize=True)
