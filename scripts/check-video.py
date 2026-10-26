import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'vendor/vvv/scripts'))
from vvv_check import check_video
report=check_video(Path(sys.argv[1]),sys.argv[2],sys.argv[3],expected=(1080,1920),max_still=3,music_required=False)
print(json.dumps(report,ensure_ascii=False))
