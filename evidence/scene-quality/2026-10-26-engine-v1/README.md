# 已核对实拍片段：稳定排片验收

[1080p 自动规划成片](automatic-scene-1080p.mp4) · [样片](automatic-scene-sample.mp4) · [五镜头预览](storyboard.jpg) · [实际成片抽帧](full-frame-review.jpg) · [标注界面](annotation-interface.png)

18.5 秒，1080 × 1920，30fps。四段同系列实拍、五个已核对片段；素材刻意打乱上传，镜头顺序、起点、时长、构图与文字避让由代码规划。开头采用已编辑的短句；没有事后手改生成分镜。

## 结果与代码行为

- 相同素材和标注重复生成，除新生成的对象 UUID 外，选片、时间、焦点、缩放与文字位置一致；上传顺序不影响环境→准备→动作→细节→结果的顺序。
- 素材未核对、缺失动作、混拍摄组、超出核对时间、重复片段、主体裁切或文字遮挡时，API/Worker 不会将其作为合格场景产物交付；图文展示需要明确选择。
- 商品名/品牌改变或标注更新会使旧分镜核对失效；文件哈希改变时 Worker 在渲染前拒绝，不自动重试同一损坏文件。
- 制作引擎版本进入缓存键及产物记录，旧引擎样片不能授权导出新版本，即使项目修订相同。
- 最终抽帧发现端杯动作进入上方文字区，扩大收尾片段保护范围后重新自动规划；系统取消收尾标题，没有通过手工改分镜绕开规则。初版报告以 initial- 前缀保留；初版视频仅留在本机，不重复提交仓库。

## 验证记录

32 项 TypeScript/领域及布局测试、4 项 Python 帧检测测试通过，类型检查和生产构建通过。完整链路通过 HTTP 创建隔离项目、上传四段实拍、保存标注、生成方案、选择方案、创建样片、测试确认与正式导出。

故障验证覆盖错误焦点、遮挡、越界、失效核对、商品身份改变、重复任务、旧引擎样片、素材字节改动和跨项目素材引用。素材损坏仅在新建可丢弃副本上注入，并在 finally 恢复源文件；该副本已软删除。

最终成片 FORMAT、RESOLUTION、AUDIO、STILL、BLACK 检查均通过。黑帧检测还用实际编码的一秒黑色视频确认会失败。

检查了 0.5–18.3 秒间 17 张实际1080p输出帧，包含切点前后；未宣称完成人工连续播放、听音或商家验收。网页中核对了已保存片段列表、角色/时间/拍摄组表单与保护区/裁切预览；浏览器未执行拖框保存操作，保存逻辑由真实接口验证。

[代码测试](tests.txt) · [帧检测测试](frame-tests.txt) · [类型检查](typecheck.txt) · [构建](build.txt) · [接口验收](api-validation.txt) · [动作保护范围修正](motion-protection-validation.txt) · [结构化来源、镜头与检查](report.json)

## 如何使用

在素材卡片中标注一次五类动作片段、拍摄组、时间及需要保留的商品部位/动作范围，之后可重复使用。保护框必须覆盖整段活动范围；错误标注不能由规则自行识别。详见 [操作与实现说明](../../../docs/reliable-scene-pipeline.md)。

该能力是基于已核对素材的剪辑规划，未接入视频语义识别，也没有单图生成同款商品交互视频。任意素材的审美、广告创意和转化效果不在这些规则的保证范围内。

## 素材及许可

法压壶仅确认品类，未确认厂家或 SKU；样片并非品牌委托或背书。所有源视频无音轨，本轮关闭旁白、使用已有原创合成配乐（CC0），没有声称录制了倒水或环境原声。Pexels 素材按其许可使用，进行了裁切、缩放、选段和文字叠加，没有生成或改变商品。

- 7301092.mp4：Taryn Elliott；[Pexels License](https://www.pexels.com/license/)；[来源页面](https://www.pexels.com/video/person-pouring-coffee-from-french-press-7301092/)；SHA-256 `5acefe5adc3d5c6218cedfcb6ecebea6463d83f0e1c3a77ed4e5481b81e05310`。
- 7301093.mp4：Taryn Elliott；[Pexels License](https://www.pexels.com/license/)；[来源页面](https://www.pexels.com/video/a-woman-pouring-coffee-7301093/)；SHA-256 `e9724456901b6afa1b0241129ffaa7cba9b26d189e231c433fdf6908764aee7b`。
- 7301090.mp4：Taryn Elliott；[Pexels License](https://www.pexels.com/license/)；[来源页面](https://www.pexels.com/video/person-pouring-hot-water-for-brewing-coffee-7301090/)；SHA-256 `54d4f9e207dfe51f6aabf33b89d9c2c13f87eee5eb8dc9b4f345f000c18b27dc`。
- 7301091.mp4：Taryn Elliott；[Pexels License](https://www.pexels.com/license/)；[来源页面](https://www.pexels.com/video/a-woman-making-coffee-in-the-kitchen-7301091/)；SHA-256 `7938aea837aaa4d0b01fffa35c6522c0de7512ed67d495c774724980c06b3fc6`。

脚本的标注确认和导出确认仅用于本机隔离验收，不代表商家已批准。最终可编辑项目保留，中间两份隔离项目已软删除，其导出证据仍保存。

本机项目：`f4760a82-9a53-4ba3-af95-820f1b6bf5a1`；修订 v19；制作引擎 `reviewed-scene-v1`。
