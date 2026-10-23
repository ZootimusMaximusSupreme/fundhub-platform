import numpy as np, sys
from PIL import Image, ImageFilter
H,W=1920,1080
CUT=140
WIN={1:(1.5,3.7),2:(12.6,16.1),3:(22.4,26.9),4:(33.6,37.1),5:(37.9,41.4),6:(46.3,49.8),7:(54.8,58.3)}
BOX={1:(145,627,934,893),2:(81,637,1015,984),3:(81,565,1019,1058),4:(81,626,1015,996),5:(81,637,1015,984),6:(81,637,1015,984),7:(81,626,1015,996)}
def union(k):
    a,b=WIN[k]; U=np.zeros((H,W),bool); tops=[]
    for i in range(round(a*30),round(b*30)):
        try:
            m=np.array(Image.open(f'masks/m_{i:05d}.png'))>127; U|=m; ys=np.where(m.sum(1)>60)[0]; tops.append(ys.min())
        except Exception: pass
    top=int(np.percentile(tops,5)); ycut=top+CUT; print('window',k,'head top',top,'cut',ycut,flush=True)
    U[1250:]=False; U[:ycut]=False   # head/neck only; shoulders and chest may be covered by the plate
    return U
def corr(P,m):
    h,w=m.shape
    A=np.fft.rfft2(P.astype(np.float32),s=(H+h,W+w)); K=np.fft.rfft2(m[::-1,::-1].astype(np.float32),s=(H+h,W+w))
    return np.fft.irfft2(A*K,s=(H+h,W+w))[h-1:h-1+H-h+1,w-1:w-1+W-w+1]
def fit(k,scales,margin=21,ymax=1430):
    U=union(k); np.save(f'u{k}.npy',U)
    Ud=np.array(Image.fromarray((U*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(margin)))>127
    x0,y0,x1,y1=BOX[k]; res=[]
    for s in scales:
        w=int(np.ceil((x1-x0)*s)); h=int(np.ceil((y1-y0)*s)); m=np.ones((h,w),np.float32)
        ov=corr(Ud,m); ok=np.zeros_like(ov,bool); ok[10:ymax-h+1,10:W-10-w+1]=True
        good=(ov<1)&ok
        if good.any():
            yy,xx=np.where(good)
            res.append((s,w,h,int(xx.min()),int(xx.max()),int(yy.min()),int(yy.max())))
    return res
if __name__=='__main__':
    k=int(sys.argv[1]); sc=[float(x) for x in sys.argv[2:]]
    for r in fit(k,sc): print(k,'scale %.2f words %dx%d x %d-%d y %d-%d'%r,flush=True)
