import type { Asset, Shot } from "./models";
/** Material sufficiency only; never claims to understand actions in a video. */
export function storyWarnings(shots: Shot[], assets: Asset[]): string[] {
  const used = assets.filter((a) => shots.some((s) => s.assetId === a.id));
  const videos = used.filter((a) => a.kind === "video");
  const warnings: string[] = [];
  if (!videos.length)
    warnings.push(
      "当前只有商品照片，输出为图文展示片。要制作真实使用场景，请补充环境、操作和结果视频。",
    );
  else if (videos.length < 3)
    warnings.push(
      "实拍角度不足：建议补充环境、操作细节、使用结果三个不同镜头，避免反复使用同一段视频。",
    );
  const repeated = shots.some(
    (s, i) =>
      videos.some((a) => a.id === s.assetId) &&
      shots
        .slice(0, i)
        .some(
          (p) =>
            p.assetId === s.assetId &&
            Math.max(p.trimBefore, s.trimBefore) <
              Math.min(p.trimBefore + p.seconds, s.trimBefore + s.seconds),
        ),
  );
  if (repeated)
    warnings.push("部分镜头重复使用同一时间段，请调整起点或替换素材。");
  if (videos.length)
    warnings.push(
      "分镜是剪辑草稿：请逐镜核对动作顺序、商品型号与裁切，系统尚未识别视频里的具体动作。",
    );
  return warnings;
}
