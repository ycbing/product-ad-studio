# 多商品验证与复验

本轮实际验证 Nintendo Switch（2017）、Logitech MX Master（初代）、FUJIFILM X100V，以及法压壶实拍品类。

结果与四条视频：[修复后验证报告](../evidence/real-products/2026-10-26-revised/README.md)。
首轮原始结果保留作布局与裁切对照：[原始报告](../evidence/real-products/2026-10-26/report.json)。

## 复现

按 `fixtures/real-products.json` 的源页面下载对应授权素材，按 `file` 字段命名。
法压壶 `coffee-poster.jpg` 为同一个视频第 5 秒抽帧。原始下载不存入 Git，哈希和许可记录在每条结果中。
启动本机数据库、网页和 Worker 后：

```sh
REAL_PRODUCTS_ASSET_DIR=/path/to/assets VALIDATION_RUN_ID=my-validation npm run validate:products
PRODUCT_VALIDATION_OUTPUT=evidence/real-products/my-validation python3 scripts/product-contact-sheets.py
```

复验已存在的验证项目时可指定 `REAL_PRODUCTS_REUSE_REPORT`；只有修订号、素材哈希仍与旧记录一致时才复用，不覆盖用户后续修改。
每次使用新的 run ID；已有报告不会被覆盖。项目会保留在本机，便于继续编辑。

本轮关闭旁白，以原创音乐进行视觉对照；没有调用付费模型，也不把自动确认解释为人工作品验收。

## 一并完成的修复

- 标题按安全区域适配字号，商品完整展示布局增加顶部留白。
- 主文案限制为最多三行，避免过长文案盖住商品。
- 增加 0–100% 横纵焦点，旧镜头默认居中；网页预览与 Remotion 使用相同参数。
- 背后 Worker 一并携带布局辅助文件，避免网页与独立渲染工程脱节。
- 新增六个回归用例，总计 15 项测试通过。
