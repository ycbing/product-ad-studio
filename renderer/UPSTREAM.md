# 实际复用的 VVV 代码

来源：https://github.com/actionow-ai/vvv
固定 commit：03afc282f6699e84e99f129f3379685cd67028ac

以下文件从上游原样复制：
- scripts/render.mjs ← kits/remotion/scripts/render.mjs
- scripts/render-support.mjs ← kits/remotion/scripts/render-support.mjs
- licenses/VVV-MIT.txt ← LICENSE
- tsconfig.json ← kits/remotion/tsconfig.json

新增 composition、catalog、商品插画、输入校验与测试为本项目代码。
VVV 的 MIT 许可见 licenses/VVV-MIT.txt；Remotion 与运行时依赖适用自身条款。
本项目没有复制 VVV 的婚礼人物照片、预览音乐或字体包。

示例图 product.svg 是虚构收纳架插画，按 CC0-1.0 提供，用于工程验证，不是真实商品照片。
voice-demo.wav 使用当前 macOS 的 Tingting 本地系统语音生成，仅用于本地开发样片；没有接入生产配音 API，也未完成该声音的生产分发许可评估。商用部署应替换为有明确授权的声音来源。

## 实拍素材版本

新增 RealProduct composition 使用 RDNE Stock project 的两段 Pexels 厨房实拍视频。
许可与文件哈希见 assets.json；两段拍摄素材都不是本项目生成，不标注为本项目实拍。
是玻璃收纳罐品类演示，不保证库存素材中的物件对应任何商家 SKU。
音乐 music-real.wav 为 scripts/demo-music.py 生成的原创合成旋律，按 CC0-1.0 提供。
