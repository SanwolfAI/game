# Builds the gusheshe engine loops in src/assets/audio/ (see src/game/engineE30.js).
# Sources (Freesound HQ previews, put them in SRC first):
#   21741.mp3  = https://cdn.freesound.org/previews/21/21741_118241-hq.mp3   "car-start.mp3" by Erdie (BMW Z3), CC BY 4.0
#   415276.mp3 = https://cdn.freesound.org/previews/415/415276_754558-hq.mp3 "BMWM3_01.wav" by ikbenraar, CC BY 4.0
# Each loop: track the firing tone, time-warp it to one steady pitch, cut a
# whole number of engine cycles and crossfade the seam. Then encode each loop
# played twice (the game loops the middle stretch):
#   ffmpeg -stream_loop 1 -i idle.wav -c:a aac -b:a 64k -ac 1 -ar 32000 e30_idle.m4a
#   ffmpeg -stream_loop 1 -i idle.wav -c:a libopus -b:a 48k -ac 1 e30_idle.ogg
# (start.wav is encoded once, not doubled)
# Needs numpy + scipy + ffmpeg.
import numpy as np, json, sys, subprocess
from scipy.io import wavfile
from scipy.signal import medfilt, savgol_filter
SR=32000
import os
SRC=os.environ.get('SRC','./engine-src/')
OUT=os.environ.get('OUT','./engine-build/')
def load(name):
    subprocess.run(['ffmpeg','-v','error','-y','-i',SRC+name,'-ac','1','-ar',str(SR),'/tmp/_l.wav'],check=True)
    sr,x=wavfile.read('/tmp/_l.wav'); return x.astype(np.float64)/32768
def track(x,a,b,guess,hop=0.005,win=0.09,lo=0.86,hi=1.16,fixed=False):
    n=int(win*SR); h=int(hop*SR); N=1<<16; fr=np.fft.rfftfreq(N,1/SR); hw=np.hanning(n)
    ts=[];Fs=[];F=guess
    i0=int(a*SR)-n//2; i1=int(b*SR)-n//2
    for i in range(i0,i1,h):
        S=np.abs(np.fft.rfft(x[i:i+n]*hw,N))
        c=guess if fixed else F; idx=np.where((fr>c*lo)&(fr<c*hi))[0]; j=idx[np.argmax(S[idx])]
        y0,y1,y2=np.log(S[j-1:j+2]+1e-12); d=0.5*(y0-y2)/(y0-2*y1+y2-1e-12)
        d=float(np.clip(np.nan_to_num(d),-0.5,0.5)); F=(j+d)*SR/N; ts.append((i+n/2)/SR); Fs.append(F)
    F=np.array(Fs); F=medfilt(F,9); F=savgol_filter(F,31,2)
    return np.array(ts),F
def flatten(x,a,b,guess,F0):
    t,F=track(x,a,b,guess,fixed=abs(guess-F0)<2,lo=0.9 if abs(guess-F0)<2 else 0.86,hi=1.1 if abs(guess-F0)<2 else 1.16)
    # phase-time mapping: u = integral(F/F0) dt
    dt=np.diff(t,prepend=t[0]); u=np.cumsum(F/F0*dt); u-=u[0]
    uk=np.arange(0,u[-1],1/SR)
    tk=np.interp(uk,u,t)
    y=np.interp(tk,np.arange(len(x))/SR,x)  # (linear interp; signal band << SR/2)
    return y,(F.min(),F.max())
def make_loop(y,F0,cycles,X=0.12,start=0.0):
    per=6.0/F0   # one 4-stroke cycle of an inline-6 = 6 firings
    L=int(round(cycles*per*SR)); Xn=int(X*SR); s=int(start*SR)
    seg=y[s:s+L+Xn]
    assert len(seg)==L+Xn, (len(seg),L+Xn,len(y))
    loop=seg[Xn:Xn+L].copy()
    w=np.linspace(0,1,Xn); fi=np.sin(w*np.pi/2); fo=np.cos(w*np.pi/2)
    loop[L-Xn:L]=seg[L:L+Xn]*fo+seg[0:Xn]*fi
    return loop
def hp(y,fc=25):
    # gentle DC/rumble high-pass (1-pole)
    a=np.exp(-2*np.pi*fc/SR); out=np.zeros_like(y); prev=0; px=0
    for i,v in enumerate(y): prev=a*(prev+v-px); px=v; out[i]=prev
    return out
def norm(y,rms_db):
    r=np.sqrt(np.mean(y**2)); return y*(10**(rms_db/20)/r)
z3=load('21741.mp3'); m3=load('415276.mp3')
specs={
 # name: (src, a, b, guess F, flatten-to F0, cycles, target rms dB)
 'idle': (z3, 5.55, 9.45, 47.9, 48.0, 14, -20),   # BMW Z3 inline-6, ~960 rpm
 'low':  (m3, 19.6, 22.5, 97.0, 85.0, 38, -19),   # M3 off-throttle coast ~2000->1500 rpm
 'mid':  (m3, 76.0, 78.05,145.0,150.0, 45, -18),  # M3 part/full throttle ~3000 rpm
 'high': (m3, 10.0, 13.45,276.0,300.0,140, -17),  # M3 full throttle ~5500-6600 rpm
}
meta={}
for k,(x,a,b,g,F0,cyc,db) in specs.items():
    y,rng=flatten(x,a,b,g,F0)
    y=hp(y)
    per=6/F0; maxcyc=int((len(y)/SR-0.13)/per)
    cyc=min(cyc,maxcyc)
    loop=norm(make_loop(y,F0,cyc),db)
    loop=np.clip(loop,-0.99,0.99)
    wavfile.write(OUT+f'{k}.wav',SR,(loop*32767).astype(np.int16))
    meta[k]={'F0':F0,'rpm':F0*20,'loopSec':len(loop)/SR,'loopSamples':len(loop),'srcF':[round(rng[0],1),round(rng[1],1)]}
    print(k,meta[k],'avail cycles',maxcyc)
# start-up: Z3 0.0 -> 5.55 s (crank + catch + flare), fade into idle level
st=hp(z3[:int(5.2*SR)].copy())
w=int(0.2*SR); peak=max(np.sqrt(np.mean(st[i:i+w]**2)) for i in range(0,len(st)-w,w))
st*=10**(-13/20)/peak
st[-int(0.9*SR):]*=np.linspace(1,0,int(0.9*SR))**1.5
st=np.clip(st,-0.99,0.99)
wavfile.write(OUT+'start.wav',SR,(st*32767).astype(np.int16)); meta['start']={'sec':len(st)/SR}
json.dump(meta,open(OUT+'meta.json','w'),indent=1)
