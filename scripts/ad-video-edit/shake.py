# usage: ffmpeg ... -vf scale=270:480,format=gray -f rawvideo - | python3 shake.py 270 480
# Measure camera shake. Skill: .cursor/skills/fundhub-ad-editor/SKILL.md
# Phase-correlation shift between frames; reports high-frequency jitter in px at 480p.
import sys, numpy as np
W,H=int(sys.argv[1]),int(sys.argv[2]); n=W*H; buf=sys.stdin.buffer
prev=None; dx=[]; dy=[]; win=np.outer(np.hanning(H),np.hanning(W))
while True:
    b=buf.read(n)
    if len(b)<n: break
    f=np.frombuffer(b,np.uint8).reshape(H,W).astype(np.float32)*win
    F=np.fft.fft2(f)
    if prev is not None:
        R=F*np.conj(prev); R/=np.abs(R)+1e-9
        c=np.fft.ifft2(R).real; y,x=np.unravel_index(np.argmax(c),c.shape)
        dy.append(y if y<H/2 else y-H); dx.append(x if x<W/2 else x-W)
    prev=F
x=np.cumsum(dx); y=np.cumsum(dy); k=np.ones(31)/31
jx=x-np.convolve(x,k,'same'); jy=y-np.convolve(y,k,'same')
s=slice(15,-15)
print("frames %d  jitter px@480p x %.2f y %.2f  total drift x %d y %d"%(len(dx),np.sqrt(np.mean(jx[s]**2)),np.sqrt(np.mean(jy[s]**2)),x[-1],y[-1]))
