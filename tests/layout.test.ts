import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  titleFontSize,
  IMAGE_TOP,
  IMAGE_WITH_PRICE_TOP,
} from "../renderer/src/web-layout";
import { shotSchema } from "../lib/models";
test("two-line hero title leaves space before product imagery", () => {
  const font = titleFontSize("桌面上的，\n一位老搭档。", true);
  const bottom = 280 + 24 * 1.5 + 25 + font * 1.3 * 2;
  assert.ok(bottom + 24 < IMAGE_TOP);
});
test("long CJK titles shrink to fit the title safe area", () => {
  assert.ok(
    titleFontSize(
      "这是一段用于验证商品标题自动换行与商品图片留白边界的较长中文主文案",
      true,
    ) < 84,
  );
});
test("pricing reserves a separate area above the product", () =>
  assert.ok(IMAGE_WITH_PRICE_TOP >= IMAGE_TOP + 200));
const shot = {
  id: randomUUID(),
  headline: "真实商品",
  caption: "",
  seconds: 3,
  assetId: randomUUID(),
  trimBefore: 0,
  description: "",
  allowGenerated: false,
  fit: "cover",
};
test("legacy shots without a focal point remain valid", () =>
  assert.equal(shotSchema.safeParse(shot).success, true));
test("focal coordinates are preserved and constrained", () => {
  const parsed = shotSchema.parse({ ...shot, focusX: 70, focusY: 50 });
  assert.equal(parsed.focusX, 70);
  assert.equal(shotSchema.safeParse({ ...shot, focusX: 101 }).success, false);
  assert.equal(shotSchema.safeParse({ ...shot, focusY: -1 }).success, false);
});
test("rejects four hard lines instead of silently covering the product", () =>
  assert.equal(
    shotSchema.safeParse({ ...shot, headline: "一\n二\n三\n四" }).success,
    false,
  ));
