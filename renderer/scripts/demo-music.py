"""Original synthesized demo bed; no external music recordings."""
import math,struct,wave
from pathlib import Path
rate=22050;duration=20
notes=[(0,48),(0.55,55),(1.2,60),(2.0,64),(3.0,55),(4.0,57),(4.6,60),(5.2,64),(6.2,67),(7.2,60),(8.0,53),(8.6,60),(9.2,65),(10.2,69),(11.2,60),(12.0,55),(12.6,59),(13.2,62),(14.2,67),(15.2,59),(16.0,48),(16.6,55),(17.2,60),(18.0,64)]
buf=[0.0]*(rate*duration)
for start,midi in notes:
 freq=440*2**((midi-69)/12)
 for j in range(min(round(rate*2.6),len(buf)-round(start*rate))):
  t=j/rate;env=(1-math.exp(-t*45))*math.exp(-t*2.1)
  value=math.sin(2*math.pi*freq*t)+0.25*math.sin(2*math.pi*freq*2*t)+0.07*math.sin(2*math.pi*freq*3*t)
  buf[round(start*rate)+j]+=value*env*0.14
out=Path(__file__).resolve().parents[1]/'public/music-real.wav'
with wave.open(str(out),'wb') as f:
 f.setparams((1,2,rate,0,'NONE','not compressed'))
 f.writeframes(b''.join(struct.pack('<h',round(max(-1,min(1,v))*32767)) for v in buf))
print('Original 20-second synthesized music bed created.')
