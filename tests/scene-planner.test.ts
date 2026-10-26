import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { planScene } from "../lib/scene-planner";
import { assertSceneReady, sceneQuality } from "../lib/scene-quality";
import {
  sceneRoles,
  reviewInputSchema,
  productIdentity,
  type SceneSegment,
} from "../lib/scene-model";
import {
  visibleSource,
  contains,
  focusForBox,
} from "../renderer/src/scene-framing";
import { emptyProduct, type Asset } from "../lib/models";
const product = {
  ...emptyProduct,
  name: "真实商品",
  audience: "家庭用户",
  benefits: ["已确认外观"],
};
function reviewed(group = "same-product"): Asset[] {
  return sceneRoles.map((role, i) => {
    const id = randomUUID(),
      sha256 = `source-${i}`;
    const segment: SceneSegment = {
      id: randomUUID(),
      role,
      start: 1,
      end: 5,
      label: `已核对${role}`,
      focusX: 50,
      focusY: 50,
      zoom: 1,
      subject: { left: 40, top: 40, right: 60, bottom: 60 },
    };
    return {
      id,
      projectId: "test",
      name: `clip-${i}.mp4`,
      mime: "video/mp4",
      kind: "video",
      width: 1080,
      height: 1920,
      duration: 10,
      sha256,
      source: "test",
      url: "/test",
      sceneReview: {
        id: randomUUID(),
        sha256,
        productIdentity: productIdentity(product),
        confirmed: true,
        continuityKey: group,
        segments: [segment],
      },
    };
  });
}
const project = (shots: ReturnType<typeof planScene>) => ({
  product,
  productionMode: "scene" as const,
  sceneGroup: "same-product",
  shots,
});
const stable = (shots: ReturnType<typeof planScene>) =>
  shots.map(({ id, ...s }) => s);
test("reviewed planning is independent of upload order and repeat calls", () => {
  const assets = reviewed(),
    expected = planScene(product, assets);
  for (const list of [
    assets,
    [...assets].reverse(),
    [assets[3], assets[0], assets[4], assets[1], assets[2]],
  ])
    assert.deepEqual(stable(planScene(product, list)), stable(expected));
  assert.deepEqual(
    expected.map((s) => s.role),
    sceneRoles,
  );
  assertSceneReady(project(expected), assets);
});
test("scene mode refuses photo-only, unreviewed, or incomplete footage instead of silently substituting", () => {
  const assets = reviewed();
  assert.throws(() => planScene(product, []), /缺少已核对/);
  assert.throws(() => planScene(product, assets.slice(0, 4)), /使用结果/);
  assert.throws(
    () =>
      planScene(
        product,
        assets.map((a) => ({ ...a, sceneReview: undefined })),
      ),
    /缺少已核对/,
  );
});
test("never mixes identities to complete a story", () => {
  const a = reviewed("A"),
    b = reviewed("B");
  assert.throws(
    () => planScene(product, [...a.slice(0, 3), ...b.slice(3)]),
    /缺少已核对/,
  );
  assert.throws(() => planScene(product, [...a, ...b]), /多个完整拍摄组/);
  assert.equal(planScene(product, [...a, ...b], "B").length, 5);
});
test("sha mismatch and changing annotation ids invalidate existing cuts", () => {
  const a = reviewed(),
    shots = planScene(product, a);
  a[0].sha256 = "changed";
  assert.ok(
    sceneQuality(project(shots), a).blockers.some(
      (b) => b.code === "REVIEW_STALE",
    ),
  );
  a[0].sha256 = a[0].sceneReview!.sha256;
  a[0].sceneReview!.id = randomUUID();
  assert.throws(() => assertSceneReady(project(shots), a), /过期/);
});
test("manual crop, text placement, range and role edits cannot bypass the export gate", () => {
  const assets = reviewed(),
    shots = planScene(product, assets);
  const edits = [
    { role: "result" },
    { trimBefore: 0 },
    { seconds: 6 },
    { zoom: 1.6, focusX: 0 },
    { fit: "contain" },
  ];
  for (const edit of edits)
    assert.equal(
      sceneQuality(
        project(
          shots.map((s, i) => (i === 0 ? ({ ...s, ...edit } as typeof s) : s)),
        ),
        assets,
      ).ready,
      false,
      JSON.stringify(edit),
    );
  const wide = reviewed();
  wide[0].sceneReview!.segments[0].subject = {
    left: 5,
    top: 5,
    right: 95,
    bottom: 95,
  };
  const plan = planScene(product, wide);
  assert.equal(plan[0].textMode, "none");
  assert.equal(
    sceneQuality(
      project(plan.map((s, i) => (i === 0 ? { ...s, textMode: "title" } : s))),
      wide,
    ).ready,
    false,
  );
});
test("portrait crop math respects focal position and zoom; too-wide subjects are not squeezed to fit", () => {
  const subject = { left: 65, top: 25, right: 90, bottom: 75 },
    focus = focusForBox(3840, 2160, subject);
  assert.ok(
    contains(visibleSource(3840, 2160, focus.focusX, focus.focusY), subject),
  );
  assert.ok(
    !contains(
      visibleSource(3840, 2160, focus.focusX, focus.focusY, 1.6),
      subject,
    ),
  );
  assert.ok(
    !contains(visibleSource(3840, 2160, 50), {
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
    }),
  );
});
test("short footage and overlapping reuse are not stretched to fill a story", () => {
  const short = reviewed();
  short.forEach((a) => (a.sceneReview!.segments[0].end = 3));
  assert.throws(() => planScene(product, short), /只够/);
  const a = reviewed();
  a[1] = {
    ...a[0],
    sceneReview: {
      ...a[0].sceneReview!,
      segments: [
        ...a[0].sceneReview!.segments,
        { ...a[1].sceneReview!.segments[0] },
      ],
    },
  };
  assert.throws(() => planScene(product, a), /同一时间段/);
});
test("annotation input requires explicit confirmation and a nonempty, valid region", () => {
  const a = reviewed()[0],
    base = {
      expectedRevision: 1,
      assetId: a.id,
      continuityKey: "same-product",
      confirmed: true,
      segments: a.sceneReview!.segments,
    };
  assert.ok(reviewInputSchema.safeParse(base).success);
  assert.ok(
    !reviewInputSchema.safeParse({ ...base, confirmed: false }).success,
  );
  assert.ok(
    !reviewInputSchema.safeParse({
      ...base,
      segments: [
        {
          ...base.segments[0],
          subject: { left: 80, top: 10, right: 30, bottom: 50 },
        },
      ],
    }).success,
  );
});

test("changing product identity invalidates the review and prevents planning", () => {
  const assets = reviewed(),
    shots = planScene(product, assets);
  const changed = { ...product, name: "另一个商品" };
  assert.throws(() => planScene(changed, assets), /缺少已核对/);
  assert.ok(
    sceneQuality({ ...project(shots), product: changed }, assets).blockers.some(
      (b) => b.code === "PRODUCT_CHANGED",
    ),
  );
});
test("framing containment holds across landscape, square and portrait sources and zoom levels", () => {
  for (const [width, height] of [
    [3840, 2160],
    [1080, 1920],
    [1024, 1024],
  ])
    for (const zoom of [1, 1.2, 1.6])
      for (const x of [20, 50, 80])
        for (const y of [20, 50, 80]) {
          const subject = {
              left: x - 5,
              right: x + 5,
              top: y - 5,
              bottom: y + 5,
            },
            f = focusForBox(width, height, subject, zoom);
          assert(
            contains(
              visibleSource(width, height, f.focusX, f.focusY, zoom),
              subject,
            ),
            JSON.stringify({ width, height, zoom, x, y }),
          );
        }
});
test("expanding protection for a lifted hand or cup removes colliding end titles", () => {
  const assets = reviewed(),
    last = assets[4].sceneReview!.segments[0];
  last.subject = { left: 40, top: 42, right: 60, bottom: 90 };
  const before = planScene(product, assets);
  assert.equal(before[4].textPlacement, "top");
  last.subject = { left: 40, top: 5, right: 60, bottom: 90 };
  const after = planScene(product, assets);
  assert.equal(after[4].textMode, "none");
  assertSceneReady(project(after), assets);
});
