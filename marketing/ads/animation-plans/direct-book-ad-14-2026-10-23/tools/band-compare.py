"""Frame-by-frame compare of a band of rows (e.g. the caption band) between the original and the test copy:
  python3 band-compare.py <original.mp4> <test.mp4> <first_row> <rows> <out.json>
Prints PSNR (min / mean); the json holds (frame, psnr, max abs pixel difference) for every frame. ffmpeg's psnr filter pairs frames wrongly on these two files, so this reads both streams in step. Needs numpy.
"""
import subprocess, sys, numpy as np
FF='/Users/chrisstanbridge/.local/bin/ffmpeg'
orig,test=sys.argv[1],sys.argv[2]
y0,h=int(sys.argv[3]),int(sys.argv[4])   # band rows
W=1080
def stream(p):
    return subprocess.Popen([FF,'-hide_banner','-loglevel','error','-i',p,'-vf',f'crop={W}:{h}:0:{y0},format=gray','-f','rawvideo','-pix_fmt','gray','-'],stdout=subprocess.PIPE)
a,b=stream(orig),stream(test)
n=0; res=[]
size=W*h
while True:
    x=a.stdout.read(size); y=b.stdout.read(size)
    if len(x)<size or len(y)<size: break
    xa=np.frombuffer(x,np.uint8).astype(np.float32); ya=np.frombuffer(y,np.uint8).astype(np.float32)
    mse=((xa-ya)**2).mean(); res.append((n,float(99.0 if mse==0 else 10*np.log10(255**2/mse)),float(np.abs(xa-ya).max())))
    n+=1
import json; json.dump(res,open(sys.argv[5],'w'))
v=[r[1] for r in res]; print('frames',n,'psnr min',round(min(v),1),'mean',round(float(np.mean(v)),1))
