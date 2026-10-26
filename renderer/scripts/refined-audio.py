"""Local-only 15s demo: aligned speech + original music with voice ducking."""
import json,math,struct,subprocess,tempfile,wave
from pathlib import Path
root=Path(__file__).resolve().parents[1]
preset=root/'examples/real-refined.json'
data=json.loads(preset.read_text())
rate=22050;duration=sum(s['seconds'] for s in data['props']['shots']);count=round(duration*rate)
voice=[0.0]*count;timeline=[];start=0
with tempfile.TemporaryDirectory() as folder:
 for i,shot in enumerate(data['props']['shots']):
  text=shot['caption'];budget=round(shot['seconds']*rate)
  if text:
   aiff=Path(folder)/f'{i}.aiff';wav=Path(folder)/f'{i}.wav'
   subprocess.run(['say','-v','Tingting','-r','185','-o',str(aiff),text],check=True)
   subprocess.run(['afconvert','-f','WAVE','-d','LEI16@22050',str(aiff),str(wav)],check=True)
   with wave.open(str(wav),'rb') as f:
    if f.getnchannels()!=1 or f.getsampwidth()!=2:raise ValueError('Expected mono PCM16')
    raw=f.readframes(f.getnframes());samples=[v[0]/32768 for v in struct.iter_unpack('<h',raw)]
   # Discard only silent head/tail; do not cut spoken material to fit.
   active=[j for j,v in enumerate(samples) if abs(v)>0.006]
   if not active:raise ValueError('Empty voice result')
   samples=samples[max(0,active[0]-int(.025*rate)):min(len(samples),active[-1]+int(.09*rate))]
   lead=round(.16*rate)
   if lead+len(samples)>budget-round(.12*rate):raise ValueError(f'Voice too long for {shot["id"]}: {len(samples)/rate:.2f}s; shorten copy')
   peak=max(abs(x) for x in samples);gain=min(1.65,.68/peak)
   for j,v in enumerate(samples):voice[start+lead+j]=v*gain
   shot['captionFrom']=lead/rate;shot['captionTo']=(lead+len(samples))/rate
   timeline.append({'id':shot['id'],'from':start/rate+shot['captionFrom'],'to':start/rate+shot['captionTo'],'text':text})
  start+=budget
music=[0.0]*count
notes=[(0,48),(0.65,55),(1.3,64),(2.0,60),(3.0,55),(4.0,57),(4.65,64),(5.3,67),(6.0,60),(7.0,64),(8.0,53),(8.65,60),(9.3,69),(10.0,65),(11.0,60),(12.0,48),(12.65,55),(13.3,64)]
for at,midi in notes:
 freq=440*2**((midi-69)/12);offset=round(at*rate)
 for j in range(min(round(2.6*rate),count-offset)):
  t=j/rate;envelope=(1-math.exp(-t*60))*math.exp(-t*1.7)
  music[offset+j]+=.105*envelope*(math.sin(2*math.pi*freq*t)+.13*math.sin(4*math.pi*freq*t))
# A smooth phrase-level envelope avoids pumping between Chinese syllables.
spoken=[False]*count
for item in timeline:
 for j in range(max(0,round((item['from']-.05)*rate)),min(count,round((item['to']+.12)*rate))):spoken[j]=True
mix=[];duck=1
for j in range(count):
 target=.28 if spoken[j] else .85
 coeff=1-math.exp(-1/(rate*(.07 if target<duck else .30)))
 duck+=(target-duck)*coeff
 t=j/rate;fade=min(1,t/.25,max(0,(duration-t)/.65))
 mix.append((voice[j]+music[j]*duck)*fade)
peak=max(abs(v) for v in mix)
if peak>.92:mix=[v*.92/peak for v in mix]
with wave.open(str(root/'public/mix-refined.wav'),'wb') as f:
 f.setparams((1,2,rate,0,'NONE','not compressed'));f.writeframes(b''.join(struct.pack('<h',round(max(-1,min(1,v))*32767)) for v in mix))
for name in ['inputs.json','examples/real-refined.json','src/presets/real-refined.json']:(root/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
(root/'public/refined-voice-timing.json').write_text(json.dumps({'duration':duration,'voice':'macOS Tingting, 185wpm, local demonstration','music':'Original synthesized composition','ducking':'phrase-level 0.28 speaking / 0.85 gap, 70ms attack, 300ms release','captions':timeline},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'seconds':duration,'peakDbfs':round(20*math.log10(max(abs(v) for v in mix)),2),'captions':timeline},ensure_ascii=False,indent=2))
