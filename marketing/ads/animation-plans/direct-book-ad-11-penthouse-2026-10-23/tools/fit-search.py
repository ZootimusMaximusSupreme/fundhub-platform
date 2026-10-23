import numpy as np, sys, json
from PIL import Image, ImageFilter
H,W=1920,1080; CUT=140
D='/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/ad11-anim/marketing/ads/animation-plans/direct-book-ad-11-penthouse-2026-10-23/'
plan={c['id']:c for c in json.load(open(D+'plan.json'))}; boxes={int(k):v for k,v in json.load(open('boxes.json')).items()}
def union(k):
    c=plan[k]; a=c['start_s']; b=c['end_s']; U=np.zeros((H,W),bool); tops=[]; xs=[]
    for i in range(round(a*30),min(round(b*30),1615)):
        try: m=np.array(Image.open(f'masks/m_{i:05d}.png'))>127
        except Exception: continue
        U|=m; r=np.where(m.sum(1)>60)[0]
        if len(r): tops.append(r.min())
        cols=np.where(m[500:900].any(0))[0]
        if len(cols): xs.append((cols.min(),cols.max()))
    top=int(np.percentile(tops,5)); xl=min(x[0] for x in xs); xr=max(x[1] for x in xs)
    return U,top,xl,xr
def corr(P,m):
    h,w=m.shape
    A=np.fft.rfft2(P.astype(np.float32),s=(H+h,W+w)); K=np.fft.rfft2(m[::-1,::-1].astype(np.float32),s=(H+h,W+w))
    return np.fft.irfft2(A*K,s=(H+h,W+w))[h-1:h-1+H-h+1,w-1:w-1+W-w+1]
def fit(k,scales,mode,margin=21):
    U,top,xl,xr=union(k)
    if mode=='top':
        F=U.copy(); F[:top+CUT]=False; F[1250:]=False; ymin,ymax=10,1440
    else:  # chest: face + neck forbidden; shoulders may be covered
        F=np.zeros_like(U); F[:1180,max(0,xl-30):xr+30]=U[:1180,max(0,xl-30):xr+30]; ymin,ymax=1100,1470
    Fd=np.array(Image.fromarray((F*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(margin)))>127
    x0,y0,x1,y1=boxes[k]; out=[]
    for s in scales:
        w=int(np.ceil((x1-x0)*s)); h=int(np.ceil((y1-y0)*s)); m=np.ones((h,w),np.float32)
        ov=corr(Fd,m); ok=np.zeros_like(ov,bool); ok[ymin:ymax-h+1,10:W-10-w+1]=True
        good=(ov<1)&ok
        if good.any():
            yy,xx=np.where(good); out.append((s,w,h,int(xx.min()),int(xx.max()),int(yy.min()),int(yy.max())))
    return out,top
if __name__=='__main__':
    k=int(sys.argv[1]); mode=sys.argv[2]; sc=[float(x) for x in sys.argv[3:]]
    r,top=fit(k,sc,mode); print('id',k,mode,'head top',top)
    for t in r: print(' scale %.2f words %dx%d  x %d-%d  y %d-%d'%t,flush=True)
