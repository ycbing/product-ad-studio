# VVV 源码核对与接入决策

核对日期：2026-10-25。
上游：https://github.com/actionow-ai/vvv
本次核对 commit：03afc282f6699e84e99f129f3379685cd67028ac。
本地研究副本位于工作区 work/vvv-upstream；不是本项目已完成的运行依赖。

## 已核对事实

- `kits/remotion/package.json` 的套件版本为 0.1.2，Remotion 固定为 4.0.534，React 为 19.2.3。
- `kits/remotion/scripts/render.mjs` 支持 sample/render/still，读取 inputs.json 与 catalog/<template>.json。
- 渲染使用 bundle、selectComposition、renderMedia；输出命名含输入指纹，并检查非空文件。
- `skills/vvv/scripts/vvv_check.py` 检查画幅、声音、静止段和节拍；它依赖 vvv_media、vvv_project 和 Pillow，并非可任意复制的独立脚本。
- `skills/vvv/scripts/vvv_media.py` 支持 doctor/probe/clip/audio/frames，调用本机 FFmpeg/FFprobe。
- VVV 主许可为 MIT；THIRD_PARTY_NOTICES.md 明确 Remotion、字体、FFmpeg 和配乐保留各自许可。
- 当前宿主 Node.js 为 v24.21.0，Python 为 3.14.8；尚未安装或运行 VVV 渲染依赖，不声称此环境已经兼容验证。

## 接入方式

优先采用“固定上游版本 + 薄适配层”，先验证一个自制商品广告 composition。
第一步让自制 composition 满足 VVV 渲染工具的项目目录与 catalog 契约，再评估直接调用其 sample/render 命令。
广告数据先转换为 inputs.json，而不是让网页请求动态生成并执行任意 React 源码。
VVV 工具调用在后台任务进程执行，参数使用数组传递，限制项目和输出路径。
检查工具需要完整保留相关模块；采用适配方式调整广告阈值，不能无差别采用婚礼模板阈值。
如契约成本过高，明确记录分叉文件与修改内容，再进行有来源的局部复用。

## 许可证与边界

复制 VVV 代码时保留原版权及完整 MIT 文本，并记录来源文件、上游 commit 和本地变更。
不因 VVV 的 MIT 许可推定 Remotion 托管商业服务免费；生产部署前核对其当时适用条款。
首版不搬运婚礼人物、音乐或整套字体，使用明确许可的自有测试素材。
不采用 c2c 登录桥接作为多人 SaaS 的默认生图后端；采用明确配置的服务端 API 适配器。

## 当前完成状态

已完成：拉取上游、阅读仓库说明、核对以上源码入口与许可声明、形成产品与接入设计。
未完成：广告模板、Web 应用、模型接口、依赖安装、真实渲染与部署。
