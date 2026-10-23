"""Fit search. For each clip, WORDS lists the boxes (clip pixels at scale 1) that hold its words. run(k, side) finds the biggest scale and the
positions where every word box stays clear of his silhouette (union map from person-union-maps.py, grown by `margin` px), inside the words band
y 269-1248 and inside the frame. Run from the scratch folder. Needs Pillow + numpy.
"""
import numpy as np, json
from PIL import Image, ImageFilter
NAMES={1:'PriceTag',2:'StepPath',3:'MoneyClimb',4:'CompanyLine',5:'PathCards'}
# word boxes at scale 1: (x0,y0,x1,y1) in clip coordinates (hold frame)
WORDS={
1:[(243,485,860,1135)],
2:[(150,620,865,1000)],
3:[(120,400,805,1000)],
4:[(75,405,1000,660)],
5:[(86,640,1000,990)],
}
H,W=1920,1080
def corr(person,m):
    h,w=m.shape
    P=np.fft.rfft2(person.astype(np.float32),s=(H+h,W+w)); K=np.fft.rfft2(m[::-1,::-1].astype(np.float32),s=(H+h,W+w))
    return np.fft.irfft2(P*K,s=(H+h,W+w))[h-1:h-1+H-h+1, w-1:w-1+W-w+1]
def run(k,side=None,smin=0.2,smax=0.8,margin=29):
    U=np.load(f'vis/union{k}.npy')
    Ud=np.array(Image.fromarray((U*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(margin)))>127
    boxes=WORDS[k]
    x0=min(b[0] for b in boxes); y0=min(b[1] for b in boxes); x1=max(b[2] for b in boxes); y1=max(b[3] for b in boxes)
    out=None
    for s in np.arange(smax,smin,-0.01):
        w=int(np.ceil((x1-x0)*s)); h=int(np.ceil((y1-y0)*s))
        m=np.zeros((h,w),np.float32)
        for (a,b,c,d) in boxes:
            m[int((b-y0)*s):int(np.ceil((d-y0)*s)),int((a-x0)*s):int(np.ceil((c-x0)*s))]=1
        ov=corr(Ud,m)
        ok=np.zeros_like(ov,bool); ok[269:1248-h+1,10:W-10-w+1]=True
        if side=='L': ok[:, w+10 if False else 0:][:, :0]  # no-op
        good=(ov<1)&ok
        if side=='L': good[:, 540:]=False
        if side=='R': good[:, :540]=False
        if good.any():
            yy,xx=np.where(good); out=(round(float(s),2),(int(xx.min()),int(xx.max())),(int(yy.min()),int(yy.max())),(w,h),(x0,y0)); break
    return out
if __name__=='__main__':
    for k in range(1,6):
        print(k,NAMES[k],'any',run(k),'| L',run(k,'L'),'| R',run(k,'R'))
