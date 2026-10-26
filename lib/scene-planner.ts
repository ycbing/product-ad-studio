import { randomUUID } from "node:crypto";
import type { Asset, Product, Shot } from "./models";
import {
  sceneRoles,
  roleNames,
  productIdentity,
  type SceneSegment,
} from "./scene-model";
import {
  visibleSource,
  contains,
  screenSubject,
  safeText,
} from "../renderer/src/scene-framing";
function fail(message: string): never {
  throw Object.assign(Error(message), { status: 422 });
}
export type Candidate = { asset: Asset; segment: SceneSegment };
export function reviewedCandidates(
  assets: Asset[],
  group?: string,
): Candidate[] {
  return assets.flatMap((asset) => {
    const r = asset.sceneReview;
    if (
      asset.kind !== "video" ||
      !r?.confirmed ||
      r.sha256 !== asset.sha256 ||
      (group && r.continuityKey !== group)
    )
      return [];
    return r.segments
      .filter(
        (s) =>
          s.start >= 0 &&
          s.end <= (asset.duration ?? 0) + 0.001 &&
          s.end - s.start >= 1 &&
          contains(
            visibleSource(
              asset.width,
              asset.height,
              s.focusX,
              s.focusY,
              s.zoom,
            ),
            s.subject,
          ),
      )
      .map((segment) => ({ asset, segment }));
  });
}
export function planScene(
  p: Product,
  assets: Asset[],
  requestedGroup?: string,
): Shot[] {
  assets = assets.filter(
    (a) => a.sceneReview?.productIdentity === productIdentity(p),
  );
  const groups = [
    ...new Set(
      reviewedCandidates(assets, requestedGroup).map(
        (c) => c.asset.sceneReview!.continuityKey,
      ),
    ),
  ].sort();
  const complete = groups.filter((g) =>
    sceneRoles.every((role) =>
      reviewedCandidates(assets, g).some((c) => c.segment.role === role),
    ),
  );
  if (complete.length > 1 && !requestedGroup)
    fail("发现多个完整拍摄组，请先指定本次使用的拍摄组，避免混用商品和人物");
  const group = requestedGroup || complete[0] || groups[0];
  const candidates = group ? reviewedCandidates(assets, group) : [];
  const missing = sceneRoles.filter(
    (role) => !candidates.some((c) => c.segment.role === role),
  );
  if (missing.length)
    fail(
      `真实场景素材未就绪：缺少已核对的${missing.map((r) => roleNames[r]).join("、")}片段。请先标注时间段、同款商品/拍摄组及保护区域；不会自动降级为图片轮播。`,
    );
  const shots = sceneRoles.map((role, i) => {
    const { asset, segment: s } = candidates
      .filter((c) => c.segment.role === role)
      .sort((a, b) => {
        const resolution = (c: Candidate) =>
          Math.min(
            (c.asset.width *
              (visibleSource(
                c.asset.width,
                c.asset.height,
                c.segment.focusX,
                c.segment.focusY,
                c.segment.zoom,
              ).right -
                visibleSource(
                  c.asset.width,
                  c.asset.height,
                  c.segment.focusX,
                  c.segment.focusY,
                  c.segment.zoom,
                ).left)) /
              100,
            1080,
          );
        return (
          resolution(b) - resolution(a) ||
          b.segment.end - b.segment.start - (a.segment.end - a.segment.start) ||
          `${a.asset.sha256}:${a.segment.id}`.localeCompare(
            `${b.asset.sha256}:${b.segment.id}`,
          )
        );
      })[0];
    const seconds = Math.floor(Math.min(5, s.end - s.start) * 2) / 2;
    const text = safeText(
      screenSubject(
        visibleSource(asset.width, asset.height, s.focusX, s.focusY, s.zoom),
        s.subject,
      ),
      i === 0 || i === 4 ? "title" : "subtitle",
    );
    const headline = (
      i === 0
        ? `${p.name}，走进日常`
        : i === 4
          ? p.cta || "了解商品详情"
          : s.label
    ).slice(0, 48);
    return {
      id: randomUUID(),
      role,
      assetId: asset.id,
      reviewId: asset.sceneReview!.id,
      segmentId: s.id,
      trimBefore: s.start,
      seconds,
      headline,
      caption: "",
      description: s.label,
      allowGenerated: false as const,
      fit: "cover" as const,
      focusX: s.focusX,
      focusY: s.focusY,
      zoom: s.zoom,
      sourceVolume: 0,
      ...text,
    };
  });
  const total = shots.reduce((n, s) => n + s.seconds, 0);
  if (total < 15)
    fail(
      `已核对片段只够 ${total} 秒，请补足至少 15 秒，不会拉长或循环素材凑时长`,
    );
  // Segment choice must also be temporally distinct; retries must not hide reuse.
  for (let i = 0; i < shots.length; i++)
    for (let j = 0; j < i; j++)
      if (
        shots[i].assetId === shots[j].assetId &&
        Math.max(shots[i].trimBefore, shots[j].trimBefore) <
          Math.min(
            shots[i].trimBefore + shots[i].seconds,
            shots[j].trimBefore + shots[j].seconds,
          )
      )
        fail("已核对分镜重用了同一时间段，请标注不重叠的片段");
  return shots;
}
