import type { Asset, Project, Shot } from "./models";
import { sceneRoles, roleNames, productIdentity } from "./scene-model";
import {
  visibleSource,
  contains,
  screenSubject,
  textIntersects,
} from "../renderer/src/scene-framing";
export type QualityIssue = { code: string; message: string; shot?: number };
export function sceneQuality(
  p: Pick<Project, "productionMode" | "sceneGroup" | "shots" | "product">,
  assets: Asset[],
) {
  const blockers: QualityIssue[] = [],
    warnings: QualityIssue[] = [];
  if (p.productionMode !== "scene")
    return {
      mode: "presentation",
      ready: true,
      blockers,
      warnings: [
        {
          code: "PRESENTATION",
          message: "商品图展示模式；不作为真实场景剧情验收。",
        },
      ],
    };
  const add = (code: string, message: string, shot?: number) =>
    blockers.push({ code, message, shot });
  if (p.shots.length !== 5)
    add("STORY_INCOMPLETE", "请先标注五类实拍片段，再生成真实场景分镜");
  const groups = new Set<string>();
  p.shots.forEach((shot, i) => {
    const n = i + 1,
      a = assets.find((a) => a.id === shot.assetId),
      r = a?.sceneReview;
    if (shot.role !== sceneRoles[i])
      add(
        "ROLE_ORDER",
        `镜头 ${n} 应为${roleNames[sceneRoles[i]]}，请按动作顺序重新规划`,
        n,
      );
    if (!a || a.kind !== "video") {
      add("REAL_FOOTAGE", `镜头 ${n} 缺少真实使用视频，不能用商品图片替代`, n);
      return;
    }
    if (!r?.confirmed || r.sha256 !== a.sha256 || r.id !== shot.reviewId) {
      add(
        "REVIEW_STALE",
        `镜头 ${n} 的素材核对已缺失或过期，请重新标注并生成分镜`,
        n,
      );
      return;
    }
    if (r.productIdentity !== productIdentity(p.product))
      add(
        "PRODUCT_CHANGED",
        `镜头 ${n} 的商品名或品牌已改变，请重新核对同款商品`,
        n,
      );
    groups.add(r.continuityKey);
    if (p.sceneGroup && p.sceneGroup !== r.continuityKey)
      add("GROUP_MISMATCH", `镜头 ${n} 不属于指定拍摄组`, n);
    const s = r.segments.find((s) => s.id === shot.segmentId);
    if (!s || s.role !== shot.role) {
      add("SEGMENT_MISMATCH", `镜头 ${n} 没有匹配到已核对的动作片段`, n);
      return;
    }
    if (
      shot.trimBefore < s.start - 0.001 ||
      shot.trimBefore + shot.seconds > s.end + 0.001
    )
      add(
        "UNREVIEWED_RANGE",
        `镜头 ${n} 超出已核对的 ${s.start}–${s.end} 秒，请调整起点/时长`,
        n,
      );
    if (shot.fit !== "cover")
      add("SCENE_LAYOUT", `镜头 ${n} 请使用全屏场景，不能回退到固定图卡`, n);
    const visible = visibleSource(
      a.width,
      a.height,
      shot.focusX ?? 50,
      shot.focusY ?? 50,
      shot.zoom ?? 1,
    );
    if (!contains(visible, s.subject))
      add(
        "SUBJECT_CROPPED",
        `镜头 ${n} 的裁切截掉了已标注商品/动作保护区域，请调整焦点或减少放大`,
        n,
      );
    const subject = screenSubject(visible, s.subject),
      textMode = shot.textMode ?? (i === 0 || i === 4 ? "title" : "subtitle");
    if (textIntersects(subject, shot.textPlacement ?? "bottom", textMode))
      add(
        "TEXT_OVER_SUBJECT",
        `镜头 ${n} 的文字遮住了商品/动作区域，请换文字位置或选择纯画面`,
        n,
      );
    if ((a.width * (visible.right - visible.left)) / 100 < 720)
      warnings.push({
        code: "LOW_NATIVE_RESOLUTION",
        message: `镜头 ${n} 裁切后原生横向像素不足 720，建议补竖屏或更高清素材`,
        shot: n,
      });
    for (let j = 0; j < i; j++) {
      const prev = p.shots[j];
      if (
        prev.assetId === shot.assetId &&
        Math.max(prev.trimBefore, shot.trimBefore) <
          Math.min(
            prev.trimBefore + prev.seconds,
            shot.trimBefore + shot.seconds,
          ) -
            0.001
      )
        add(
          "REPEATED_RANGE",
          `镜头 ${j + 1} 与 ${n} 重复使用同一时间段，请替换或重剪`,
          n,
        );
    }
  });
  if (groups.size > 1)
    add("CONTINUITY", "分镜混用了不同拍摄组，请保持同一商品、人物和场景连续性");
  return { mode: "scene", ready: blockers.length === 0, blockers, warnings };
}
export function assertSceneReady(
  p: Pick<Project, "productionMode" | "sceneGroup" | "shots" | "product">,
  assets: Asset[],
) {
  const q = sceneQuality(p, assets);
  if (!q.ready)
    throw Object.assign(Error(q.blockers.map((b) => b.message).join("；")), {
      status: 422,
    });
  return q;
}
