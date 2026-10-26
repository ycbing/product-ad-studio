"""macOS-only fictional demo voice; production TTS is not connected."""
import json, subprocess, tempfile, wave
from pathlib import Path
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'inputs.json').read_text())
parts=[]
with tempfile.TemporaryDirectory() as folder:
    for i,shot in enumerate(data['props']['shots']):
        aiff=Path(folder)/f'{i}.aiff'
        wav=Path(folder)/f'{i}.wav'
        text=shot['headline'].replace('\n','')
        subprocess.run(['say','-v','Tingting','-r','190','-o',str(aiff),text],check=True)
        subprocess.run(['afconvert','-f','WAVE','-d','LEI16@22050',str(aiff),str(wav)],check=True)
        with wave.open(str(wav),'rb') as audio:
            if audio.getnchannels()!=1 or audio.getsampwidth()!=2: raise ValueError('Expected mono PCM16')
            raw=audio.readframes(audio.getnframes())
            budget=round(shot['seconds']*22050)*2
            if len(raw)>budget-4410: raise ValueError(f'Voice exceeds shot {shot["id"]}; shorten text')
            raw=b'\x00'*4410+raw
            parts.append(raw+b'\x00'*(budget-len(raw)))
with wave.open(str(root/'public'/data['props'].get('voice','voice-demo.wav')),'wb') as out:
    out.setparams((1,2,22050,0,'NONE','not compressed'))
    out.writeframes(b''.join(parts))
data['props']['voice']=data['props'].get('voice') or 'voice-demo.wav'
(root/'inputs.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('Generated local system-voice demo: 20 seconds, aligned per shot.')
