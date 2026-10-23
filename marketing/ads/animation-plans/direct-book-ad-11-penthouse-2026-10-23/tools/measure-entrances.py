import subprocess,numpy as np,json,sys
FF='/Users/chrisstanbridge/.local/bin/ffmpeg'
D='/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/ad11-anim/marketing/ads/animation-plans/direct-book-ad-11-penthouse-2026-10-23/'
plan=json.load(open(D+'plan.json')); res={}
for c in plan:
    p=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-i','clips2/'+c['clip'],'-vf','format=rgba,scale=540:960','-f','rawvideo','-pix_fmt','rgba','-'],stdout=subprocess.PIPE)
    raw=p.stdout.read(); n=len(raw)//(540*960*4); A=np.frombuffer(raw,np.uint8).reshape(n,960,540,4)[:,:,:,3]/255.
    fin=A[-1]; rows=(fin>0.5).sum(1)>20
    # bands
    bands=[];st=None
    for y,v in enumerate(rows):
        if v and st is None: st=y
        if not v and st is not None:
            if y-st>12: bands.append((st,y))
            st=None
    if st is not None: bands.append((st,960))
    ent=[]
    if c['template']=='PriceTag':
        a=A.sum((1,2)); f=a/a[-1]; ent=[int(np.argmax(f>=0.5))]
        bands=[(0,960)]
    else:
        # merge bands into card count (cards = len entrances)
        k=len(c['entrances'])
        # card bands: split final-frame alpha rows into k groups by largest gaps
        ys=np.where(rows)[0]; gaps=np.diff(ys); cut=np.argsort(gaps)[::-1][:k-1]; cut=sorted(cut)
        edges=[ys[0]]+[ys[i+1] for i in cut]+[ys[-1]+1]; bands=[(edges[i],edges[i+1]) for i in range(k)]
        # first frame fully-visible check; entrance = first frame region mean alpha >= .5 of its final
        for (y0,y1) in bands:
            m=A[:,y0:y1].mean((1,2)); f=m/m[-1]; ent.append(int(np.argmax(f>=0.5)))
    real=[round(c['start_s']+e/30,3) for e in ent]
    res[c['id']]=real
    print(c['id'],c['template'],'planned',[e['entrance_t'] for e in c['entrances']],'measured 50%',real,'diff',[round(r-e['word_t'],2) for r,e in zip(real,c['entrances'])],flush=True)
json.dump(res,open('measured.json','w'))
