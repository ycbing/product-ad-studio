# 商品广告渲染器

独立的 Remotion 工程，实际复用 VVV 渲染脚本，制作 20 秒五镜头竖屏广告。
本阶段没有 Web 界面、模型 API 或商品上传接口。示例商品为原创虚构插画。

## 运行

```sh
npm ci --ignore-scripts
npm run test
npm run typecheck
npm run sample
npm run render
npm run poster
```

首次渲染可能需要下载 Remotion 对应的 Chromium 与平台二进制程序。
样片为 540×960，正式版为 1080×1920，30 fps。输出与证据报告在 out/。
编辑 inputs.json 修改五个镜头的文字、时长和商品图片；素材置于 public/。
修改总时长时同步 catalog/product-story.json 的 sample 范围。

macOS 本地示例配音可用 `python3 scripts/demo-voice.py` 重新生成。
该脚本依赖 say、Tingting 与 afconvert，只用于当前示例；生产配音适配器尚未实现。
未配置配音时可将 props.voice 设为 null，画面不会冒充已有旁白。

VVV 来源与依赖许可边界见 UPSTREAM.md。

## 实拍版本

当前 inputs.json 默认选择 real-product 模板，视频源放在 public/footage/。
原插画模板输入保存在 examples/illustration.json，实拍默认输入保存在 examples/real-product.json。
每个视频镜头指定 source、trimBefore、sourceDuration 和 seconds，范围会在渲染前校验。
构图仍需人工检查；源时长字段在导入新素材时需要由媒体探测确认。
原创音乐可用 `python3 scripts/demo-music.py` 生成。

## 15 秒精修版

当前 inputs.json 默认选择 real-refined，五镜头共 15 秒；旧版输入保存在 examples/real-product-20s.json。
composition 默认数据置于 src/presets，纳入 VVV 渲染指纹。
使用 `python3 scripts/refined-audio.py` 生成分镜配音、实际字幕时间和音乐压低混音。
该脚本仅供 macOS 本地演示使用；不会冒充生产 TTS 服务或真人配音。

公开仓库不包含本机系统语音生成的 voice-demo.wav、voice-real.wav 和 mix-refined.wav。历史模板样片需要先运行对应本机配音脚本；网页工作流在后台按需生成配音，不依赖这些文件。
