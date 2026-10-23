"""Fine time strips of a test copy: ROWS = (label, first second, step, tiles, crop box x0,y0,x1,y1). Each tile is stamped with its time. Used to read when each payoff lands.
  python3 event-strips.py <test.mp4> <out.jpg>   (writes frames into chk/ under the current folder). Needs Pillow."""
import subprocess, sys
from PIL import Image, ImageDraw, ImageFont
FF='/Users/chrisstanbridge/.local/bin/ffmpeg'
video=sys.argv[1]; out=sys.argv[2]
# (label, t_start, step, count, crop box)
ROWS=[('1 stamp',14.7,0.1,8,(800,420,1080,700)),
      ('2 logo',23.3,0.1,8,(270,250,810,390)),
      ('3 seven',28.2,0.1,8,(0,250,330,560)),
      ('5 check',43.3,0.1,8,(770,820,1080,1100)),
      ('6 cards',45.0,0.25,8,(0,250,330,460)),
      ('7 stamp',54.2,0.1,8,(790,590,1080,960))]
font=ImageFont.load_default(size=14)
TW=200
rows=[]
for label,t0,st,n,box in ROWS:
    tiles=[]
    for i in range(n):
        t=t0+i*st; p=f'chk/ev_{label[0]}_{i}.png'
        subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',f'{t:.3f}','-i',video,'-frames:v','1',p],check=True)
        im=Image.open(p).convert('RGB').crop(box); im=im.resize((TW,int(TW*im.height/im.width)))
        d=ImageDraw.Draw(im); d.rectangle([0,0,60,16],fill=(0,0,0)); d.text((2,1),f'{t:.1f}s',fill=(255,255,0),font=font)
        tiles.append(im)
    H=max(t.height for t in tiles); row=Image.new('RGB',(TW*n,H))
    for i,t in enumerate(tiles): row.paste(t,(i*TW,0))
    rows.append(row)
W=rows[0].width; H=sum(r.height for r in rows)
sheet=Image.new('RGB',(W,H)); y=0
for r in rows: sheet.paste(r,(0,y)); y+=r.height
sheet.save(out,quality=82); print(sheet.size)
