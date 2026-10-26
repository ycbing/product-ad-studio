# 拾序 Ad Studio · 商品广告工作室

独立的商品广告创作项目，按 [产品设计 v0.1](docs/product-design.md) 实现。
当前版本为本机单用户 MVP：上传真实素材，编辑五镜头，后台生成样片，确认后导出 1080p MP4。

## 已能使用

- 项目列表、新建、复制、删除、数据库保存与修订版本。
- JPEG / PNG / WebP 商品图上传（单张 ≤15MB），MP4 实拍上传（≤100MB），每项目最多 10 份。
- 按真实字节读取图片类型，探测视频尺寸、时长，保存来源与 SHA-256。
- 三种可编辑剧情开头；缺少文本模型密钥时明确显示“规则方案”。
- 五镜头文案、字幕/旁白、素材、起点、时长、画面布局编辑。
- 单镜头配音试听与缓存；macOS 本机中文示例声音可直接运行。
- 独立 PostgreSQL 任务队列、租约与心跳、进度、错误原因和手动重试。
- 同版本重复提交去重，成功配音按内容复用。
- 540×960 样片 → 当前版本确认 → 1080×1920 H.264 MP4。
- 修改后旧样片与确认失效，未确认当前样片时拒绝正式导出。
- 视频播放的 HTTP Range 请求与下载，项目删除后文件接口不可访问。
- 可选 OpenAI 兼容文本与语音 API 适配器；尚未使用真实账号验证这些外部服务。

## 本机启动

本次开发环境：macOS ARM64、Node.js 24、PostgreSQL 17、Python 3.14。

```sh
cd product-ad-studio
npm ci --ignore-scripts
# 首次在其他目录安装时复制；不要覆盖已有服务配置
cp -n .env.example .env.local
npm run db:local
npm run dev
```

打开 http://127.0.0.1:3100 。`dev` 启动网页与独立 Worker，并先执行迁移、导入示例；已有项目会保留。
本工作区依赖和数据库已经初始化，重复启动只需 `npm run db:local` 后 `npm run dev`。

`db:local` 在本项目 `.local/postgres` 中创建独立数据库，只监听 `127.0.0.1:55432`，不会修改系统其他数据库。
需要 `pg_config` 能定位 PostgreSQL；也可通过 `PG_BIN` 指定二进制目录。
本机开发数据库使用仅监听 loopback 的信任认证，不作为公网数据库配置。
如果使用已有 PostgreSQL，请修改 `DATABASE_URL`，跳过 `db:local`。

首次渲染需要 Remotion 下载 Chromium。本工作区已准备好；新机器需要网络。
Python 检查需 Pillow（`python3 -m pip install Pillow`）；未安装时会记录专项检查不可用，仍执行基础参数检查。
FFmpeg/FFprobe 使用 Remotion 的对应平台二进制。

## 构建与独立运行

```sh
npm run typecheck
npm test
npm run build
npm run start       # 终端 1：网页，仅监听本机
npm run worker      # 终端 2：独立渲染进程
```

真实端到端验收需要网页与 Worker 已运行：

```sh
npm run test:integration
```

验收创建独立测试项目，验证上传、并发去重、真实渲染、确认门槛、视频播放和版本失效；完成后只删除该测试项目。
其中样片确认由测试程序模拟，不表示人工审美验收。记录在 `evidence/integration.json`。

## 模型服务

在 `.env.local` 中配置后重启服务。密钥只在服务端使用，不发送给浏览器。

| 配置 | 行为 |
| --- | --- |
| 不设置文本密钥 | 本地规则方案，页面明确标识 |
| `TEXT_API_BASE`、`TEXT_API_KEY`、`TEXT_MODEL` | OpenAI 兼容 `/chat/completions`，校验三种结构化开头 |
| `TTS_PROVIDER=system` | macOS Tingting 本机示例声音，不调用付费服务 |
| `TTS_PROVIDER=none` | 关闭供应商，界面可关闭旁白 |
| `TTS_PROVIDER=openai` | 配置 `TTS_API_BASE`、`TTS_API_KEY`、`TTS_MODEL`、`TTS_VOICE`，调用兼容 `/audio/speech` |

外部服务可能收费；数据库记录调用量与供应商请求编号，未配置单价时费用显示未知，不伪造价格。
付费语音请求结果不明时不会直接自动重发，以免重复计费。
本机系统声音仅用于开发样片；生产应换用有明确许可的音源。

## 目录

```text
app/                 Next.js 页面、API、样式
components/          四步创作工作台
lib/                 模型、数据库、上传、文件与服务适配
worker/              PostgreSQL 队列与实际视频生产
migrations/          版本化数据库迁移
renderer/            Remotion 广告模板及 VVV 渲染脚本
vendor/vvv/          保留来源与版权的 VVV Python 工具
scripts/             本机数据库、迁移、示例、验收脚本
tests/               输入、版本、文件权限等行为测试
docs/                原始产品设计和实现状态
evidence/            实际截图、端到端验收记录与视频
.local/              本机数据库、原始素材、缓存、任务产物（不提交）
```

## VVV 实际使用

复用 VVV commit `03afc282f6699e84e99f129f3379685cd67028ac`：
- 原样保留 `render.mjs` 与 `render-support.mjs`，用于样片、正式渲染和输入指纹。
- 原样保留 Python 媒体/检查工具，用于渲染后的画幅、音频与静止画面检测。
- WebStory 是为本项目新写的商品广告模板，支持真实图片与实拍视频。
- 原始版权声明见 `renderer/licenses/VVV-MIT.txt` 和 `vendor/vvv/LICENSE`。

示例实拍来自 RDNE / Pexels，来源及许可见 [素材说明](docs/real-footage-demo.md)。
库存素材是品类演示，不视为某商家品牌或 SKU 已获验证。
VVV 的 MIT 不替代 Remotion、字体、声音及媒体自身许可。

## 当前边界

- 仅本机单用户；尚未实现公网登录、团队隔离和对象存储，不应直接开放公网。
- 图片与视频来自用户上传；没有把生成背景、人物动作或口型伪装为已支持功能。
- 供货方 API 接口已写好，真实模型账号、费用及输出质量尚待配置后验证。
- 队列重试与配音缓存可用；当前重新渲染仍会编码整条视频，未实现单镜头视频编码缓存。
- 删除为数据库软删除并禁止访问；磁盘素材和任务中间文件暂保留，自动物理清理待后续实现。
- 自动检查和抽帧不替代完整观看、听音与商家事实确认。

完整进度见 [实现状态](docs/implementation-status.md)。

## 多款真实商品验证

已用三款可确认型号的商品照片及一组法压壶实拍完成真实上传、样片和正式渲染。
[查看结果与四条视频](evidence/real-products/2026-10-26-revised/README.md) · [复现说明](docs/real-product-validation.md)。
这轮验证一并修复了多行标题压图和横屏视频主体裁切问题，新增可编辑的横纵画面焦点。

## 真实场景剪辑（2026-10-26）

固定商品卡片不能替代剧情广告。新增以实拍为主的全屏场景剪辑，支持逐镜文字模式、放大、裁切焦点与原片音量；照片模式明确标记为图文展示。
[法压壶生活场景样片与说明](evidence/real-products/2026-10-26-scene-final/README.md) · [生产策略与验收标准](docs/product-design.md)。
样片基于同系列的四段真实素材，分镜和动作顺序由人工匹配，尚未实现单图自动生成同款商品交互视频。

## 稳定排片与质量校验

新项目默认使用已核对的真实场景片段：标注一次动作时间、同款商品/拍摄组和保护区域，后续按用途稳定排片。素材不足、裁切/文字遮挡或核对过期时明确指出问题，不自动改成图片轮播。
[操作与实现说明](docs/reliable-scene-pipeline.md) · [完整验收结果](evidence/scene-quality/2026-10-26-engine-v1/README.md)。

制作引擎版本参与缓存与样片确认，升级后的代码不会继续返回旧版本成片。上述规则不能代替素材核对、成片观看和广告创意判断。
