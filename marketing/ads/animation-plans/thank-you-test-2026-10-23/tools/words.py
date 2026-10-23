import json,sys
rows=[json.loads(l) for l in open('ocr.jsonl')]
out=[]
prev=None
for r in rows:
    t=(r['i']-1)/10.0
    ws=r['words']; hl=r['hl']
    if not ws or not hl: 
        cur=None
    else:
        c=(hl[0]+hl[1])/2
        best=None;bd=1e9
        for k,w in enumerate(ws):
            if w['x0']-30<=c<=w['x1']+30: d=abs((w['x0']+w['x1'])/2-c)
            else: d=1e9
            if d<bd: bd=d;best=k
        if best is None or bd>=1e9:
            # nearest
            for k,w in enumerate(ws):
                d=abs((w['x0']+w['x1'])/2-c)
                if d<bd: bd=d;best=k
        cur=(r['text'], best, ws[best]['w'])
    key=(cur[0][:12],cur[1]) if cur else None
    if key!=prev:
        out.append((t, cur[2] if cur else '-', cur[0] if cur else ''))
        prev=key
for t,w,tx in out:
    print(f"{t:5.1f} {w:14s} | {tx}")
