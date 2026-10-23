"""Where is he, during each animation window? Reads masks/m_%05d.png (made by matte.swift) and writes vis/union<N>.npy (every pixel he covers at any
frame of window N) plus a red-tinted overview. Run from the scratch folder (paths are relative to it: masks/, vis/). Needs Pillow + numpy.
The windows in WIN are the start/end seconds of schedule.json.
"""
import numpy as np, subprocess, sys
from PIL import Image, ImageDraw
FF='/Users/chrisstanbridge/.local/bin/ffmpeg'
V="/Users/chrisstanbridge/Downloads/Direct-Book-Ad-16 (Edited no Animation).mp4"
WIN={1:(14.05,17.05),2:(23.3,25.3),3:(27.0,30.0),4:(37.8,39.8),5:(41.3,44.5),6:(44.5,49.0),7:(53.15,57.15)}
def frame(t,out):
    subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',V,'-frames:v','1',out],check=True)
tiles=[]
for k,(a,b) in WIN.items():
    i0,i1=round(a*30),round(b*30)
    U=np.zeros((1920,1080),bool); cnt=np.zeros((1920,1080),np.float32); n=0
    for i in range(i0,i1):
        try: m=np.array(Image.open(f'masks/m_{i:05d}.png'))>127
        except Exception: continue
        U|=m; cnt+=m; n+=1
    np.save(f'vis/union{k}.npy',U); np.save(f'vis/freq{k}.npy',cnt/max(n,1))
    frame((a+b)/2,f'vis/mid{k}.png')
    im=Image.open(f'vis/mid{k}.png').convert('RGB')
    arr=np.array(im).astype(np.float32)
    arr[U]=arr[U]*0.5+np.array([255,0,0])*0.5
    im2=Image.fromarray(arr.astype(np.uint8))
    d=ImageDraw.Draw(im2)
    for y in (269,1248): d.line([(0,y),(1080,y)],fill=(255,255,0),width=3)
    im2=im2.resize((270,480)); tiles.append(im2); print(k,n)
W=Image.new('RGB',(270*len(tiles),480))
for j,t in enumerate(tiles): W.paste(t,(270*j,0))
W.save('vis/heat.png')
