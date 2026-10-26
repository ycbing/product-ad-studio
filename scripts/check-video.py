import json,sys,subprocess,tempfile
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'vendor/vvv/scripts'))
from vvv_check import check_video
from quality_frames import black_frame_check
report=check_video(Path(sys.argv[1]),sys.argv[2],sys.argv[3],expected=(1080,1920),max_still=3,music_required=False)
if len(sys.argv)>4 and sys.argv[4]=='scene':
    rate=report['video']['fps']
    with tempfile.TemporaryDirectory(prefix='ad-black-check-') as folder:
        subprocess.run([sys.argv[2],'-v','error','-nostdin','-i',sys.argv[1],'-an','-r',str(rate),'-s','32x32','-f','image2',str(Path(folder)/'%06d.png')],capture_output=True,check=True,timeout=60)
        samples=[]
        for frame in sorted(Path(folder).glob('*.png')):
            with Image.open(frame) as image:samples.append(image.convert('RGB').tobytes())
        black=black_frame_check(b''.join(samples),rate=rate)
        report['checks'].append(black)
        if black['status']=='failed':report['status']='failed'
print(json.dumps(report,ensure_ascii=False))
