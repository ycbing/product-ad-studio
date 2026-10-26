"""Extract five actual output frames per product, without altering the videos."""
import json,os,platform,subprocess,tempfile
from pathlib import Path
from PIL import Image,ImageDraw
folder=Path(os.environ.get('PRODUCT_VALIDATION_OUTPUT','evidence/real-products/2026-10-26'))
report=json.loads((folder/'report.json').read_text())
architecture='arm64' if platform.machine() in ['arm64','aarch64'] else 'x64'
system='darwin' if platform.system()=='Darwin' else 'linux'
bin=Path('node_modules/@remotion')/f'compositor-{system}-{architecture}'
ffmpeg=(bin/'ffmpeg').resolve();env=dict(os.environ,DYLD_LIBRARY_PATH=str(bin.resolve()))
rows=[]
for case in report['results']:
 if not case.get('video'):continue
 video=folder/case['video'];sheet=Image.new('RGB',(1350,520),'#f4f3ec');draw=ImageDraw.Draw(sheet)
 draw.text((15,12),case['slug']+' / 1080 x 1920 / 15 seconds',fill='#284437')
 with tempfile.TemporaryDirectory() as tmp:
  for i,t in enumerate([1,4,7,10,13]):
   target=Path(tmp)/f'{i}.png'
   subprocess.run([str(ffmpeg),'-v','error','-ss',str(t),'-i',str(video),'-frames:v','1','-s','270x480','-y',str(target)],env=env,check=True)
   with Image.open(target) as im:sheet.paste(im.convert('RGB'),(i*270,40))
 sheet.save(folder/(case['slug']+'-storyboard.png'));rows.append(sheet)
if rows:
 grid=Image.new('RGB',(1350,len(rows)*520),'white')
 for i,sheet in enumerate(rows):grid.paste(sheet,(0,i*520))
 grid.save(folder/'comparison.png')
print('Extracted actual frames for',len(rows),'products.')
