import subprocess,json,re,numpy as np,wave
FF='/Users/chrisstanbridge/.local/bin/ffmpeg'; R='/Users/chrisstanbridge/Developer/fundhub-platform/credentials/hormozi-kb-work'
T=[("B1","he",12.6),("B2","to",14.5),("B3","sitting",16.8),("B4","the",28.15),("B5","give",37.3),("B6","within",24.7),("B7","mentally",14.1),("B8","and",12.5)]
w=wave.open('audio.wav'); sr=w.getframerate(); x=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(float)/32768
hop=int(sr*0.005); win=int(sr*0.02); env=np.array([np.sqrt((x[i:i+win]**2).mean()+1e-10) for i in range(0,len(x)-win,hop)]); le=20*np.log10(env+1e-6)
out={}
for k,word,t in T:
    a=max(0,t-0.8)
    subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(a),'-t','2.4','-i','audio.wav','pin/%s.wav'%k],check=True)
    subprocess.run([f'{R}/whisper.cpp/build/bin/whisper-cli','-m',f'{R}/models/ggml-small.en.bin','-f',f'pin/{k}.wav','-ml','1','-sow','-ojf','-of',f'pin/{k}'],capture_output=True)
    d=json.load(open(f'pin/{k}.json')); ws=[(s['offsets']['from']/1000+a,re.sub(r"[^a-z']","",s['text'].lower())) for s in d['transcription'] if s['text'].strip()]
    cand=[(abs(tt-t),tt) for tt,ww in ws if ww==re.sub(r"[^a-z']","",word)]
    chunk=min(cand)[1] if cand else None
    # energy onset: biggest rise of smoothed log-energy within +-0.25 s of t
    i0,i1=int((t-0.25)/0.005),int((t+0.25)/0.005); sm=np.convolve(le,np.ones(3)/3,'same'); d1=sm[i0+6:i1+6]-sm[i0:i1]
    onset=(i0+int(np.argmax(d1))+3)*0.005
    out[k]=(word,t,chunk,round(onset,3))
    print(k,word,'whisper-full',t,'chunk',chunk,'energy-onset',round(onset,3),flush=True)
json.dump(out,open('pin2.json','w'))
